import { z } from "zod";
import type { VaultIndex } from "../vault-index.js";

const vaultIndexNoteSchema = z.object({
  path: z.string().min(1),
  title: z.string(),
  aliases: z.array(z.string()),
  headings: z.array(z.string()),
  tags: z.array(z.string()),
  summary: z.string(),
  outgoingLinks: z.array(z.string())
});

const vaultIndexSchema: z.ZodType<VaultIndex> = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().min(1),
  notes: z.array(vaultIndexNoteSchema)
});

export const proposalEngineInputSchema = z.object({
  schemaVersion: z.literal(1),
  sessionInboxPath: z.string().min(1),
  freeformCapture: z.string(),
  vaultIndexRef: z.string().min(1),
  vaultIndex: vaultIndexSchema,
  candidateNotes: z.array(
    z.object({
      path: z.string().min(1),
      content: z.string()
    })
  )
});

export const patchPlanSchema = z.object({
  schemaVersion: z.literal(1),
  planId: z.string().min(1),
  summary: z.string(),
  items: z.array(
    z.object({
      id: z.string().min(1),
      kind: z.enum([
        "consolidated-knowledge",
        "knowledge-refinement",
        "research-candidate",
        "reference-item",
        "no-consolidation-candidate",
        "sensitive-candidate"
      ]),
      destinationPath: z.string().min(1).optional(),
      sourceTrace: z.string().min(1),
      proposedContent: z.string()
    })
  )
});

export type ProposalEngineInput = z.infer<typeof proposalEngineInputSchema>;
export type PatchPlan = z.infer<typeof patchPlanSchema>;

export type ProposalEngine = {
  propose(input: ProposalEngineInput): Promise<PatchPlan>;
};

export function parsePatchPlan(candidate: unknown): PatchPlan {
  const result = patchPlanSchema.safeParse(candidate);
  if (!result.success) {
    throw new Error(`Invalid Patch Plan: ${z.prettifyError(result.error)}`);
  }

  return result.data;
}
