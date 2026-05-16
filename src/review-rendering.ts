import type { PatchPlan } from "./proposal-engine/contract.js";

export function renderReview(plan: PatchPlan): string {
  const lines = [`# Review Rendering`, "", plan.summary, ""];

  if (plan.items.length === 0) {
    lines.push("No proposed durable knowledge changes.");
    return lines.join("\n");
  }

  const itemsByDestination = Map.groupBy(
    plan.items,
    (item) => item.destinationPath ?? "No Consolidation"
  );

  for (const [destination, items] of itemsByDestination) {
    lines.push(`## ${destination}`, "");

    for (const item of items) {
      lines.push(`- ${item.proposedContent}`);
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
