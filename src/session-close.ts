import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { readClassificationRules } from "./classification-rules.js";
import { storeLayout } from "./operational-store/layout.js";
import type { PatchPlan, ProposalEngine } from "./proposal-engine/contract.js";
import { createStubProposalEngine } from "./proposal-engine/stub.js";
import { renderReview } from "./review-rendering.js";
import type { ActiveSession } from "./session-start.js";
import { buildVaultIndex, selectCandidateNotes } from "./vault-index.js";

export type CloseSessionResult = {
  plan: PatchPlan;
  reviewRendering: string;
};

export type CloseSessionStage =
  | { stage: "vault-index-built"; noteCount: number }
  | { stage: "captures-interpreted"; captureChars: number }
  | { stage: "plan-generated"; itemCount: number };

export type CloseSessionOptions = {
  proposalEngine?: ProposalEngine;
  onStage?: (stage: CloseSessionStage) => void;
};

export class NoActiveSessionError extends Error {
  constructor() {
    super("No Active Session found. Run: onix --vault <path> start");
    this.name = "NoActiveSessionError";
    Object.setPrototypeOf(this, NoActiveSessionError.prototype);
  }
}

export class SessionInboxNotFoundError extends Error {
  constructor(readonly activeSession: ActiveSession) {
    super(
      `Active Session state exists, but its Session Inbox could not be located. Expected ${activeSession.inboxPath} or a file under Onix/Sessions with onix_session_id: ${activeSession.sessionId}`
    );
    this.name = "SessionInboxNotFoundError";
    Object.setPrototypeOf(this, SessionInboxNotFoundError.prototype);
  }
}

export async function closeSession(
  vaultPath: string,
  options: ProposalEngine | CloseSessionOptions = {}
): Promise<CloseSessionResult> {
  const normalized = isProposalEngine(options) ? { proposalEngine: options } : options;
  const proposalEngine = normalized.proposalEngine ?? createStubProposalEngine();
  const onStage = normalized.onStage;
  const layout = storeLayout(".onix");
  const activeSession = await readActiveSession(vaultPath);
  const inbox = await readSessionInbox(vaultPath, activeSession);
  const freeformCapture = stripSessionFrontmatter(inbox.content);
  const vaultIndex = await buildVaultIndex(vaultPath);
  onStage?.({ stage: "vault-index-built", noteCount: vaultIndex.notes.length });
  const vaultIndexRef = posix.join(layout.transient.vaultIndexes, "vault-index.json");
  const candidateNotePaths = selectCandidateNotes(vaultIndex, freeformCapture);
  const candidateNotes = await Promise.all(
    candidateNotePaths.map(async (candidatePath) => ({
      path: candidatePath,
      content: await readFile(join(vaultPath, candidatePath), "utf8")
    }))
  );
  onStage?.({ stage: "captures-interpreted", captureChars: freeformCapture.length });

  await mkdir(join(vaultPath, layout.transient.vaultIndexes), { recursive: true });
  await writeFile(join(vaultPath, vaultIndexRef), JSON.stringify(vaultIndex, null, 2));

  const classificationRulesStore = await readClassificationRules(vaultPath);
  const plan = await proposalEngine.propose({
    schemaVersion: 1,
    sessionInboxPath: inbox.relativePath,
    freeformCapture,
    vaultIndexRef,
    vaultIndex,
    candidateNotes,
    classificationRules: classificationRulesStore.rules
  });
  const reviewRendering = renderReview(plan);

  await mkdir(join(vaultPath, layout.transient.patchPlans), { recursive: true });
  await writeFile(join(vaultPath, layout.transient.patchPlans, `${plan.planId}.json`), JSON.stringify(plan, null, 2));
  onStage?.({ stage: "plan-generated", itemCount: plan.items.length });

  return { plan, reviewRendering };
}

function isProposalEngine(value: ProposalEngine | CloseSessionOptions): value is ProposalEngine {
  return typeof (value as ProposalEngine).propose === "function";
}

async function readSessionInbox(
  vaultPath: string,
  activeSession: ActiveSession
): Promise<{ relativePath: string; content: string }> {
  try {
    return {
      relativePath: activeSession.inboxPath,
      content: await readFile(join(vaultPath, activeSession.inboxPath), "utf8")
    };
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  const sessionDirectory = posix.join("Onix", "Sessions");
  const sessionFiles = await readdir(join(vaultPath, sessionDirectory)).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new SessionInboxNotFoundError(activeSession);
    }

    throw error;
  });

  for (const sessionFile of sessionFiles) {
    const relativePath = posix.join(sessionDirectory, sessionFile);
    const content = await readFile(join(vaultPath, relativePath), "utf8");

    if (content.includes(`onix_session_id: ${activeSession.sessionId}`)) {
      return { relativePath, content };
    }
  }

  throw new SessionInboxNotFoundError(activeSession);
}

function stripSessionFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) {
    return content;
  }

  const frontmatterEnd = content.indexOf("\n---", 4);
  if (frontmatterEnd === -1) {
    return content;
  }

  return content.slice(frontmatterEnd + "\n---".length).replace(/^\r?\n/, "");
}

async function readActiveSession(vaultPath: string): Promise<ActiveSession> {
  const layout = storeLayout(".onix");

  try {
    const activeSessionJson = await readFile(join(vaultPath, layout.transient.activeSession), "utf8");

    return JSON.parse(activeSessionJson) as ActiveSession;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new NoActiveSessionError();
    }

    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
