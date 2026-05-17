import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { storeLayout } from "./operational-store/layout.js";
import { parsePatchPlan } from "./proposal-engine/contract.js";
import { renderReview } from "./review-rendering.js";

export async function renderIntegratedReview(vaultPath: string, planId: string): Promise<string> {
  const layout = storeLayout(".onix");
  const planJson = await readFile(join(vaultPath, layout.transient.patchPlans, `${planId}.json`), "utf8");
  const plan = parsePatchPlan(JSON.parse(planJson));

  return renderReview(plan);
}
