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

export type ApprovalState = {
  schemaVersion: 1;
  planId: string;
  decisions: ApprovalDecision[];
};

export async function recordReviewAction(vaultPath: string, planId: string, input: ReviewActionInput): Promise<ApprovalState> {
  const layout = storeLayout(".onix");
  const plan = await readPatchPlan(vaultPath, planId);
  const decision = decisionFor(plan, input);
  const approvalState: ApprovalState = {
    schemaVersion: 1,
    planId,
    decisions: [decision]
  };

  await mkdir(join(vaultPath, layout.transient.approvalState), { recursive: true });
  await writeFile(
    join(vaultPath, layout.transient.approvalState, `${planId}.json`),
    JSON.stringify(approvalState, null, 2)
  );

  return approvalState;
}

async function readPatchPlan(vaultPath: string, planId: string): Promise<PatchPlan> {
  const layout = storeLayout(".onix");
  const planJson = await readFile(join(vaultPath, layout.transient.patchPlans, `${planId}.json`), "utf8");

  return parsePatchPlan(JSON.parse(planJson));
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
