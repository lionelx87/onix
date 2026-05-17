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
      lines.push(`  ID: ${item.id}`);
      lines.push(`  Kind: ${item.kind}`);
      lines.push(`  Learning Capture: ${item.learningCapture}`);
      lines.push(`  Source: ${item.sourceTrace}`);

      if (item.primaryTopic !== undefined) {
        lines.push(`  Primary Topic: ${item.primaryTopic}`);
      }

      if (item.relatedTopics.length > 0) {
        lines.push(`  Related Topics: ${item.relatedTopics.join(", ")}`);
      }

      lines.push(`  Proposed Content: ${item.proposedContent}`);
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
