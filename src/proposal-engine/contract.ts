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

export const classificationRuleSchema = z.object({
  id: z.string().min(1),
  pattern: z.string().min(1),
  destinationPath: z.string().min(1),
  approvedAt: z.string().min(1)
});

export type ClassificationRule = z.infer<typeof classificationRuleSchema>;

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
  ),
  classificationRules: z.array(classificationRuleSchema).default([])
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
      learningCapture: z.string().min(1),
      primaryTopic: z.string().min(1).optional(),
      relatedTopics: z.array(z.string().min(1)).default([]),
      sourceTrace: z.string().min(1),
      proposedContent: z.string(),
      existingContent: z.string().min(1).optional(),
      refinementReason: z.string().min(1).optional()
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
