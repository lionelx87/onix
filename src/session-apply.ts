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
  existingContent?: string;
  knowledgeLink?: true;
};

const knowledgeLinksHeading = "## Knowledge links";

export async function applySession(vaultPath: string, requestedPlanId?: string): Promise<ApplySessionResult> {
  const layout = storeLayout(".onix");
  const planId = requestedPlanId ?? (await readCurrentPlanId(vaultPath));
  const planPath = join(vaultPath, layout.transient.patchPlans, `${planId}.json`);
  const planStat = await stat(planPath);
  const plan = await readPatchPlan(vaultPath, planId);
  const approvalState = await readApprovalState(vaultPath, planId);
  const candidates = writeCandidatesFor(plan, approvalState.decisions);
  const writesByDestination = groupWritesByDestination(candidates);

  for (const [destinationPath, candidates] of writesByDestination) {
    validateDestinationPath(destinationPath);
    await validateDestinationIsFresh(vaultPath, destinationPath, planStat.mtimeMs);
    await validateRefinementTargets(vaultPath, destinationPath, candidates);
  }

  for (const [destinationPath, candidates] of writesByDestination) {
    const nextContent = renderDestinationContent(await readExistingContent(vaultPath, destinationPath), candidates);
    await mkdir(dirname(join(vaultPath, destinationPath)), { recursive: true });
    await writeFile(join(vaultPath, destinationPath), nextContent);
  }

  for (const [destinationPath, candidates] of writesByDestination) {
    const writtenContent = await readFile(join(vaultPath, destinationPath), "utf8");

    for (const candidate of candidates) {
      if (!writtenContent.includes(candidate.content.trim())) {
        throw new Error(`Write verification failed for ${destinationPath}`);
      }
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
  const planItemsById = new Map(plan.items.map((item) => [item.id, item]));
  const candidates: WriteCandidate[] = [];

  for (const decision of decisions) {
    const item = planItemsById.get(decision.itemId);
    if (item === undefined || decision.action === "discard") {
      continue;
    }

    if (decision.action === "split") {
      const writtenParts = decision.parts.filter(
        (part): part is { destinationPath: string; content: string } => part.destinationPath !== undefined
      );
      for (const part of writtenParts) {
        candidates.push({ destinationPath: part.destinationPath, content: renderApprovedContent(item, part.content) });
      }
      const linkedPart = writtenParts[0];
      if (linkedPart !== undefined) {
        candidates.push(...knowledgeLinkCandidateFor(item, linkedPart.destinationPath, linkedPart.content));
      }
      continue;
    }

    if (decision.destinationPath !== undefined) {
      candidates.push({
        destinationPath: decision.destinationPath,
        content: renderApprovedContent(item, decision.content),
        ...(item.kind === "knowledge-refinement" && item.existingContent !== undefined && decision.action !== "move"
          ? { existingContent: item.existingContent }
          : {})
      });
      candidates.push(...knowledgeLinkCandidateFor(item, decision.destinationPath, decision.content));
    }
  }

  return candidates;
}

function knowledgeLinkCandidateFor(
  item: PatchPlan["items"][number],
  knowledgePath: string,
  knowledgeContent: string
): WriteCandidate[] {
  if (item.project === undefined || item.projectUsage === undefined || item.project === knowledgePath) {
    return [];
  }

  return [
    {
      destinationPath: item.project,
      content: renderKnowledgeLink(item.projectUsage, knowledgePath, knowledgeContent),
      knowledgeLink: true
    }
  ];
}

export function renderKnowledgeLink(projectUsage: string, knowledgePath: string, knowledgeContent: string): string {
  const noteTarget = knowledgePath.replace(/\.md$/, "");
  const heading = firstHeading(knowledgeContent);
  const target = heading === undefined ? noteTarget : `${noteTarget}#${heading}`;
  return `- ${projectUsage.trim()} → [[${target}]]`;
}

function firstHeading(content: string): string | undefined {
  let insideFence = false;

  for (const line of content.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      insideFence = !insideFence;
      continue;
    }

    const match = insideFence ? null : /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (match?.[1] !== undefined) {
      return match[1];
    }
  }

  return undefined;
}

function renderApprovedContent(item: PatchPlan["items"][number], content: string): string {
  if (item.kind === "research-candidate") {
    return `## ${item.primaryTopic ?? "Unsorted"}\n\n- ${content.trim()}`;
  }

  if (item.kind === "reference-item") {
    const topic = item.primaryTopic ?? "Unsorted";
    return `## ${topic}\n\n- ${content.trim()}\n\nInformed learning: [[${topic}]]`;
  }

  return content;
}

function groupWritesByDestination(candidates: WriteCandidate[]): Map<string, WriteCandidate[]> {
  const grouped = new Map<string, WriteCandidate[]>();

  for (const candidate of candidates) {
    const existing = grouped.get(candidate.destinationPath) ?? [];
    existing.push(candidate);
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
    destinationPath.startsWith(".onix/")
  ) {
    throw new Error(`Destination is outside the Write Boundary: ${destinationPath}`);
  }
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

async function validateRefinementTargets(
  vaultPath: string,
  destinationPath: string,
  candidates: WriteCandidate[]
): Promise<void> {
  const refinementTargets = candidates
    .map((candidate) => candidate.existingContent?.trim())
    .filter((target): target is string => target !== undefined && target.length > 0);

  if (refinementTargets.length === 0) {
    return;
  }

  const existing = await readExistingContent(vaultPath, destinationPath);

  for (const target of refinementTargets) {
    if (!existing.includes(target)) {
      throw new Error(`Refinement target not found in destination: ${destinationPath}`);
    }
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

function renderDestinationContent(existingContent: string, candidates: WriteCandidate[]): string {
  let working = existingContent;

  for (const candidate of candidates) {
    if (candidate.existingContent !== undefined) {
      working = replaceParagraph(working, candidate.existingContent, candidate.content);
    }
  }

  const additions = candidates
    .filter((candidate) => candidate.existingContent === undefined && candidate.knowledgeLink === undefined)
    .map((candidate) => candidate.content.trim())
    .filter(Boolean);

  const knowledgeLinks = candidates
    .filter((candidate) => candidate.knowledgeLink !== undefined)
    .map((candidate) => candidate.content.trim());

  if (knowledgeLinks.length > 0) {
    const withSection = insertIntoKnowledgeLinksSection(working, knowledgeLinks);
    if (withSection === undefined) {
      additions.push(`${knowledgeLinksHeading}\n\n${knowledgeLinks.join("\n")}`);
    } else {
      working = withSection;
    }
  }

  const trimmedExisting = working.trimEnd();

  if (additions.length === 0) {
    return `${trimmedExisting}\n`;
  }

  const additionBlock = additions.join("\n\n");

  if (trimmedExisting.length === 0) {
    return `${additionBlock}\n`;
  }

  return `${trimmedExisting}\n\n${additionBlock}\n`;
}

function insertIntoKnowledgeLinksSection(content: string, links: string[]): string | undefined {
  const lines = content.split("\n");
  const headingIndex = lines.findIndex((line) => line.trim() === knowledgeLinksHeading);
  if (headingIndex === -1) {
    return undefined;
  }

  const nextSectionOffset = lines.slice(headingIndex + 1).findIndex((line) => /^#{1,2}\s/.test(line));
  const sectionEnd = nextSectionOffset === -1 ? lines.length : headingIndex + 1 + nextSectionOffset;
  let insertAt = sectionEnd;
  while (insertAt > headingIndex + 1 && lines[insertAt - 1]!.trim() === "") {
    insertAt -= 1;
  }

  const separator = insertAt === headingIndex + 1 ? [""] : [];
  const trailing = sectionEnd < lines.length ? [""] : [];
  return [...lines.slice(0, insertAt), ...separator, ...links, ...trailing, ...lines.slice(sectionEnd)].join("\n");
}

function replaceParagraph(content: string, existingParagraph: string, replacement: string): string {
  const target = existingParagraph.trim();
  if (target.length === 0 || !content.includes(target)) {
    return content;
  }

  return content.replace(target, replacement.trim());
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
