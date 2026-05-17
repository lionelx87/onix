import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { storeLayout } from "./operational-store/layout.js";
import { parsePatchPlan, type PatchPlan } from "./proposal-engine/contract.js";

export type ReviewActionInput =
  | { action: "approve"; itemId: string }
  | { action: "edit"; itemId: string; content: string }
  | { action: "move"; itemId: string; destinationPath: string }
  | { action: "split"; itemId: string; parts: string[] }
  | { action: "discard"; itemId: string };

export type ApprovalDecision =
  | {
      itemId: string;
      action: "approve" | "edit" | "move";
      destinationPath?: string;
      content: string;
    }
  | {
      itemId: string;
      action: "split";
      parts: Array<{ destinationPath?: string; content: string }>;
    }
  | {
      itemId: string;
      action: "discard";
    };

export type RuleCandidate = {
  id: string;
  fromItemId: string;
  pattern: string;
  destinationPath: string;
};

export type ApprovalState = {
  schemaVersion: 1;
  planId: string;
  decisions: ApprovalDecision[];
  ruleCandidates: RuleCandidate[];
};

export async function recordReviewAction(vaultPath: string, planId: string, input: ReviewActionInput): Promise<ApprovalState> {
  const layout = storeLayout(".onix");
  const plan = await readPatchPlan(vaultPath, planId);
  const decision = decisionFor(plan, input);
  const existingApprovalState = await readApprovalState(vaultPath, planId);
  const nextDecisions = [
    ...existingApprovalState.decisions.filter((existingDecision) => existingDecision.itemId !== input.itemId),
    decision
  ];
  const nextRuleCandidates = updateRuleCandidates(plan, existingApprovalState.ruleCandidates, input);
  const approvalState: ApprovalState = {
    schemaVersion: 1,
    planId,
    decisions: nextDecisions,
    ruleCandidates: nextRuleCandidates
  };

  await mkdir(join(vaultPath, layout.transient.approvalState), { recursive: true });
  await writeFile(
    join(vaultPath, layout.transient.approvalState, `${planId}.json`),
    JSON.stringify(approvalState, null, 2)
  );

  return approvalState;
}

function updateRuleCandidates(
  plan: PatchPlan,
  existing: RuleCandidate[],
  input: ReviewActionInput
): RuleCandidate[] {
  const withoutThisItem = existing.filter((candidate) => candidate.fromItemId !== input.itemId);

  if (input.action !== "move") {
    return withoutThisItem;
  }

  const item = plan.items.find((candidate) => candidate.id === input.itemId);
  if (item === undefined) {
    return withoutThisItem;
  }

  const nextId = `rule-candidate-${withoutThisItem.length + 1}`;
  return [
    ...withoutThisItem,
    {
      id: nextId,
      fromItemId: input.itemId,
      pattern: item.learningCapture,
      destinationPath: input.destinationPath
    }
  ];
}

export async function readPatchPlan(vaultPath: string, planId: string): Promise<PatchPlan> {
  const layout = storeLayout(".onix");
  const planJson = await readFile(join(vaultPath, layout.transient.patchPlans, `${planId}.json`), "utf8");

  return parsePatchPlan(JSON.parse(planJson));
}

export async function readApprovalState(vaultPath: string, planId: string): Promise<ApprovalState> {
  const layout = storeLayout(".onix");

  try {
    const approvalJson = await readFile(join(vaultPath, layout.transient.approvalState, `${planId}.json`), "utf8");
    const parsed = JSON.parse(approvalJson) as Partial<ApprovalState> & { decisions?: ApprovalDecision[] };
    return {
      schemaVersion: 1,
      planId,
      decisions: parsed.decisions ?? [],
      ruleCandidates: parsed.ruleCandidates ?? []
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        schemaVersion: 1,
        planId,
        decisions: [],
        ruleCandidates: []
      };
    }

    throw error;
  }
}

function decisionFor(plan: PatchPlan, input: ReviewActionInput): ApprovalDecision {
  const item = plan.items.find((candidate) => candidate.id === input.itemId);

  if (item === undefined) {
    throw new Error(`Patch Plan item not found: ${input.itemId}`);
  }

  if (input.action === "approve") {
    return {
      itemId: input.itemId,
      action: "approve",
      ...(item.destinationPath === undefined ? {} : { destinationPath: item.destinationPath }),
      content: item.proposedContent
    };
  }

  if (input.action === "edit") {
    return {
      itemId: input.itemId,
      action: "edit",
      ...(item.destinationPath === undefined ? {} : { destinationPath: item.destinationPath }),
      content: input.content
    };
  }

  if (input.action === "move") {
    return {
      itemId: input.itemId,
      action: "move",
      destinationPath: input.destinationPath,
      content: item.proposedContent
    };
  }

  if (input.action === "split") {
    return {
      itemId: input.itemId,
      action: "split",
      parts: input.parts.map((content) => ({
        ...(item.destinationPath === undefined ? {} : { destinationPath: item.destinationPath }),
        content
      }))
    };
  }

  return {
    itemId: input.itemId,
    action: "discard"
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
