import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readApprovalState } from "./approval-state.js";
import { storeLayout } from "./operational-store/layout.js";
import type { ClassificationRule } from "./proposal-engine/contract.js";

export type { ClassificationRule };

export type ClassificationRulesStore = {
  schemaVersion: 1;
  rules: ClassificationRule[];
};

export async function readClassificationRules(vaultPath: string): Promise<ClassificationRulesStore> {
  const layout = storeLayout(".onix");

  try {
    const storeJson = await readFile(join(vaultPath, layout.versioned.classificationRules), "utf8");
    const parsed = JSON.parse(storeJson) as Partial<ClassificationRulesStore>;

    return {
      schemaVersion: 1,
      rules: parsed.rules ?? []
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { schemaVersion: 1, rules: [] };
    }

    throw error;
  }
}

export async function approveClassificationRule(
  vaultPath: string,
  planId: string,
  ruleCandidateId: string,
  now: Date = new Date()
): Promise<ClassificationRule> {
  const approvalState = await readApprovalState(vaultPath, planId);
  const candidate = approvalState.ruleCandidates.find((entry) => entry.id === ruleCandidateId);

  if (candidate === undefined) {
    throw new Error(`Rule Candidate not found in Approval State: ${ruleCandidateId}`);
  }

  const store = await readClassificationRules(vaultPath);
  const rule: ClassificationRule = {
    id: `rule-${store.rules.length + 1}`,
    pattern: candidate.pattern,
    destinationPath: candidate.destinationPath,
    approvedAt: now.toISOString()
  };

  const nextStore: ClassificationRulesStore = {
    schemaVersion: 1,
    rules: [...store.rules, rule]
  };

  const layout = storeLayout(".onix");
  const storePath = join(vaultPath, layout.versioned.classificationRules);
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(nextStore, null, 2));

  return rule;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
