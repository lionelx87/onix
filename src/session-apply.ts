import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { readApprovalState, readPatchPlan, type ApprovalDecision } from "./approval-state.js";
import { storeLayout } from "./operational-store/layout.js";
import type { PatchPlan } from "./proposal-engine/contract.js";
import type { ActiveSession } from "./session-start.js";

export type ApplySessionResult = {
  changedFiles: string[];
  versioningReview: string;
};

type WriteCandidate = {
  destinationPath: string;
  content: string;
};

export async function applySession(vaultPath: string, requestedPlanId?: string): Promise<ApplySessionResult> {
  const layout = storeLayout(".onix");
  const planId = requestedPlanId ?? (await readCurrentPlanId(vaultPath));
  const planPath = join(vaultPath, layout.transient.patchPlans, `${planId}.json`);
  const planStat = await stat(planPath);
  const plan = await readPatchPlan(vaultPath, planId);
  const approvalState = await readApprovalState(vaultPath, planId);
  const candidates = writeCandidatesFor(plan, approvalState.decisions);
  const writesByDestination = groupWritesByDestination(candidates);

  for (const destinationPath of writesByDestination.keys()) {
    validateDestinationPath(destinationPath);
    await validateDestinationIsFresh(vaultPath, destinationPath, planStat.mtimeMs);
  }

  for (const [destinationPath, contents] of writesByDestination) {
    const nextContent = renderDestinationContent(await readExistingContent(vaultPath, destinationPath), contents);
    await mkdir(dirname(join(vaultPath, destinationPath)), { recursive: true });
    await writeFile(join(vaultPath, destinationPath), nextContent);
  }

  for (const [destinationPath, contents] of writesByDestination) {
    const expectedContent = renderDestinationContent("", contents);
    const writtenContent = await readFile(join(vaultPath, destinationPath), "utf8");

    if (!writtenContent.endsWith(expectedContent)) {
      throw new Error(`Write verification failed for ${destinationPath}`);
    }
  }

  await cleanupActiveSession(vaultPath);

  const changedFiles = [...writesByDestination.keys()].sort();
  return {
    changedFiles,
    versioningReview: renderVersioningReview(changedFiles)
  };
}

function writeCandidatesFor(plan: PatchPlan, decisions: ApprovalDecision[]): WriteCandidate[] {
  const planItemIds = new Set(plan.items.map((item) => item.id));
  const candidates: WriteCandidate[] = [];

  for (const decision of decisions) {
    if (!planItemIds.has(decision.itemId) || decision.action === "discard") {
      continue;
    }

    if (decision.action === "split") {
      for (const part of decision.parts) {
        if (part.destinationPath !== undefined) {
          candidates.push({ destinationPath: part.destinationPath, content: part.content });
        }
      }
      continue;
    }

    if (decision.destinationPath !== undefined) {
      candidates.push({ destinationPath: decision.destinationPath, content: decision.content });
    }
  }

  return candidates;
}

function groupWritesByDestination(candidates: WriteCandidate[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const candidate of candidates) {
    const existing = grouped.get(candidate.destinationPath) ?? [];
    existing.push(candidate.content);
    grouped.set(candidate.destinationPath, existing);
  }

  return grouped;
}

function validateDestinationPath(destinationPath: string): void {
  const normalized = posix.normalize(destinationPath);

  if (
    destinationPath !== normalized ||
    destinationPath.startsWith("/") ||
    destinationPath.startsWith("../") ||
    destinationPath.includes("/../") ||
    destinationPath === ".onix" ||
    destinationPath.startsWith(".onix/") ||
    !isInsideWriteBoundary(destinationPath)
  ) {
    throw new Error(`Destination is outside the Write Boundary: ${destinationPath}`);
  }
}

function isInsideWriteBoundary(destinationPath: string): boolean {
  return (
    destinationPath.startsWith("Knowledge/") ||
    destinationPath === "Onix/Research Inbox.md" ||
    destinationPath.startsWith("References/") ||
    destinationPath.startsWith("Reference Library/")
  );
}

async function validateDestinationIsFresh(
  vaultPath: string,
  destinationPath: string,
  planModifiedAtMs: number
): Promise<void> {
  try {
    const destinationStat = await stat(join(vaultPath, destinationPath));

    if (destinationStat.mtimeMs > planModifiedAtMs) {
      throw new Error(`Destination changed after Patch Plan generation: ${destinationPath}`);
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }

    throw error;
  }
}

async function readExistingContent(vaultPath: string, destinationPath: string): Promise<string> {
  try {
    return await readFile(join(vaultPath, destinationPath), "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

function renderDestinationContent(existingContent: string, newContents: string[]): string {
  const existing = existingContent.trimEnd();
  const addition = newContents.map((content) => content.trim()).filter(Boolean).join("\n\n");

  if (existing.length === 0) {
    return `${addition}\n`;
  }

  return `${existing}\n\n${addition}\n`;
}

async function cleanupActiveSession(vaultPath: string): Promise<void> {
  const layout = storeLayout(".onix");
  const activeSession = JSON.parse(await readFile(join(vaultPath, layout.transient.activeSession), "utf8")) as ActiveSession;

  try {
    await unlink(join(vaultPath, activeSession.inboxPath));
    await unlink(join(vaultPath, layout.transient.activeSession));
  } catch (error) {
    throw new Error(`Failed to clean up Session Inbox: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readCurrentPlanId(vaultPath: string): Promise<string> {
  const layout = storeLayout(".onix");
  const planFiles = (await readdir(join(vaultPath, layout.transient.patchPlans))).filter((file) => file.endsWith(".json"));

  if (planFiles.length !== 1) {
    throw new Error("Missing Patch Plan identifier. Run: onix --vault <path> apply <plan-id>");
  }

  return planFiles[0]!.replace(/\.json$/, "");
}

function renderVersioningReview(changedFiles: string[]): string {
  const lines = ["# Versioning Review", "", "Changed vault files:"];

  if (changedFiles.length === 0) {
    lines.push("- No approved Consolidated Knowledge changes.");
    return lines.join("\n");
  }

  for (const changedFile of changedFiles) {
    lines.push(`- ${changedFile}`);
  }

  return lines.join("\n");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
