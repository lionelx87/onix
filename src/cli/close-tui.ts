import { cancel, confirm, intro, isCancel, note, outro, spinner } from "@clack/prompts";
import { closeSession, type CloseSessionResult } from "../session-close.js";
import type { PatchPlan } from "../proposal-engine/contract.js";

export type CloseTuiResult = CloseSessionResult & { shouldEnterReview: boolean };

export async function runCloseTui(vaultPath: string): Promise<CloseTuiResult> {
  intro("Closing Active Session");

  const spin = spinner();
  spin.start("Updating Vault Index…");

  const result = await closeSession(vaultPath, {
    onStage: (event) => {
      if (event.stage === "vault-index-built") {
        spin.message(`Vault Index ready — ${event.noteCount} notes`);
      } else if (event.stage === "captures-interpreted") {
        spin.message("Interpreting Captures…");
      } else if (event.stage === "plan-generated") {
        spin.message(`Patch Plan generated — ${event.itemCount} items`);
      }
    }
  });

  spin.stop(`Patch Plan ready · ${result.plan.planId}`);

  note(buildKindSummary(result.plan), `${result.plan.items.length} items · ${result.plan.summary}`);

  if (result.plan.items.length === 0) {
    outro("No items to review. Nothing to apply.");
    return { ...result, shouldEnterReview: false };
  }

  const start = await confirm({
    message: "Start Integrated Review now?",
    initialValue: true
  });

  if (isCancel(start) || start === false) {
    cancel(`Deferred. Resume with: onix review ${result.plan.planId}`);
    return { ...result, shouldEnterReview: false };
  }

  return { ...result, shouldEnterReview: true };
}

function buildKindSummary(plan: PatchPlan): string {
  const counts = new Map<PatchPlan["items"][number]["kind"], number>();
  for (const item of plan.items) {
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }
  if (counts.size === 0) return "No items.";

  const labels: Record<PatchPlan["items"][number]["kind"], { glyph: string; label: string }> = {
    "consolidated-knowledge": { glyph: "+", label: "New knowledge" },
    "knowledge-refinement": { glyph: "~", label: "Refine existing" },
    "research-candidate": { glyph: "?", label: "Research" },
    "reference-item": { glyph: "@", label: "Reference" },
    "sensitive-candidate": { glyph: "!", label: "Sensitive" },
    "no-consolidation-candidate": { glyph: "x", label: "No consolidation" }
  };
  return [...counts.entries()]
    .map(([kind, count]) => `${labels[kind].glyph}  ${String(count).padStart(2)}  ${labels[kind].label}`)
    .join("\n");
}
