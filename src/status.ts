import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { readApprovalState } from "./approval-state.js";
import { readClassificationRules } from "./classification-rules.js";
import { storeLayout } from "./operational-store/layout.js";
import { parsePatchPlan } from "./proposal-engine/contract.js";
import type { ActiveSession } from "./session-start.js";

export type StatusReport = {
  defaultVault?: string;
  vault?: string;
  activeSession?: ActiveSession;
  plans: Array<{
    planId: string;
    totalItems: number;
    decidedItems: number;
    pendingItems: number;
    pendingRuleCandidates: string[];
  }>;
  approvedClassificationRulesCount: number;
};

export type StatusInput = {
  defaultVault?: string;
  vault?: string;
};

export async function buildStatusReport(input: StatusInput): Promise<StatusReport> {
  const report: StatusReport = {
    plans: [],
    approvedClassificationRulesCount: 0,
    ...(input.defaultVault === undefined ? {} : { defaultVault: input.defaultVault }),
    ...(input.vault === undefined ? {} : { vault: input.vault })
  };

  if (input.vault === undefined) {
    return report;
  }

  const vault = input.vault;
  const layout = storeLayout(".onix");

  const activeSession = await readActiveSession(vault, layout.transient.activeSession);
  if (activeSession !== undefined) {
    report.activeSession = activeSession;
  }

  report.plans = await readPlanSummaries(vault, layout.transient.patchPlans);
  report.approvedClassificationRulesCount = (await readClassificationRules(vault)).rules.length;

  return report;
}

export function renderStatusReport(report: StatusReport): string {
  const lines: string[] = ["Onix status"];

  if (report.defaultVault !== undefined) {
    lines.push(`Default vault: ${report.defaultVault}`);
  }

  if (report.vault === undefined) {
    lines.push("No default vault set. Run: onix use <path>");
    return lines.join("\n");
  }

  lines.push(`Vault: ${report.vault}`);
  lines.push("");

  if (report.activeSession === undefined) {
    lines.push("Active Session: none");
  } else {
    lines.push("Active Session");
    lines.push(`  ID: ${report.activeSession.sessionId}`);
    lines.push(`  Inbox: ${report.activeSession.inboxPath}`);
    lines.push(`  Started: ${report.activeSession.startedAt}`);
  }

  lines.push("");

  if (report.plans.length === 0) {
    lines.push("Patch Plans: none");
  } else {
    lines.push("Patch Plans");
    for (const plan of report.plans) {
      lines.push(`  ${plan.planId}`);
      lines.push(`    ${plan.decidedItems} of ${plan.totalItems} decided, ${plan.pendingItems} pending`);
      if (plan.pendingRuleCandidates.length > 0) {
        lines.push(`    Rule Candidates pending approval: ${plan.pendingRuleCandidates.join(", ")}`);
      }
    }
  }

  lines.push("");
  lines.push(`Classification Rules: ${report.approvedClassificationRulesCount} approved`);

  return lines.join("\n");
}

async function readActiveSession(vaultPath: string, activeSessionFile: string): Promise<ActiveSession | undefined> {
  try {
    const json = await readFile(join(vaultPath, activeSessionFile), "utf8");
    return JSON.parse(json) as ActiveSession;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function readPlanSummaries(
  vaultPath: string,
  patchPlansDir: string
): Promise<StatusReport["plans"]> {
  let planFiles: string[];

  try {
    planFiles = (await readdir(join(vaultPath, patchPlansDir))).filter((file) => file.endsWith(".json"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const summaries: StatusReport["plans"] = [];
  for (const file of planFiles.sort()) {
    const planJson = await readFile(join(vaultPath, patchPlansDir, file), "utf8");
    const plan = parsePatchPlan(JSON.parse(planJson));
    const approvalState = await readApprovalState(vaultPath, plan.planId);

    summaries.push({
      planId: plan.planId,
      totalItems: plan.items.length,
      decidedItems: approvalState.decisions.length,
      pendingItems: plan.items.length - approvalState.decisions.length,
      pendingRuleCandidates: approvalState.ruleCandidates.map((candidate) => candidate.id)
    });
  }

  return summaries;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
