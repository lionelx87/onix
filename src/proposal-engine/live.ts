import type { ClassificationRule, PatchPlan, ProposalEngine, ProposalEngineInput } from "./contract.js";
import { parsePatchPlan } from "./contract.js";

export type CaptureCompletionRequest = {
  model: string;
  systemPrompt: string;
  userPrompt: string;
};

export type CaptureCompletionClient = {
  complete(request: CaptureCompletionRequest): Promise<string>;
};

export type LiveProposalEngineOptions = {
  client: CaptureCompletionClient;
  model: string;
  maxRetries?: number;
};

export function createLiveProposalEngine(options: LiveProposalEngineOptions): ProposalEngine {
  const { client, model } = options;
  const maxRetries = options.maxRetries ?? 2;

  return {
    async propose(input: ProposalEngineInput): Promise<PatchPlan> {
      const basePrompt = buildUserPrompt(input);
      let userPrompt = basePrompt;
      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const response = await client.complete({
          model,
          systemPrompt: buildSystemPrompt(),
          userPrompt
        });

        try {
          const plan = parsePatchPlan(assemblePatchPlanEnvelope(parseJsonResponse(response)));
          return applyClassificationRules(plan, input.classificationRules);
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          userPrompt = `${basePrompt}\n\nYour previous response was rejected: ${lastError.message}\nReturn only valid JSON for the Patch Plan.`;
        }
      }

      throw new Error(
        `Live Proposal Engine could not produce a valid Patch Plan after ${maxRetries + 1} attempts: ${lastError?.message ?? "unknown error"}`
      );
    }
  };
}

function applyClassificationRules(plan: PatchPlan, rules: ClassificationRule[]): PatchPlan {
  if (rules.length === 0) {
    return plan;
  }

  return {
    ...plan,
    items: plan.items.map((item) => {
      const matchedRule = matchClassificationRule(item.learningCapture, rules);
      if (matchedRule === undefined) {
        return item;
      }

      return { ...item, destinationPath: matchedRule.destinationPath };
    })
  };
}

function matchClassificationRule(
  captureText: string,
  rules: ClassificationRule[]
): { destinationPath: string } | undefined {
  const haystack = captureText.toLowerCase();
  for (const rule of rules) {
    if (rule.pattern.length > 0 && haystack.includes(rule.pattern.toLowerCase())) {
      return { destinationPath: rule.destinationPath };
    }
  }

  return undefined;
}

function assemblePatchPlanEnvelope(parsed: unknown): unknown {
  const source = Array.isArray(parsed) ? { items: parsed } : parsed;
  if (typeof source !== "object" || source === null) {
    return parsed;
  }

  const record = source as Record<string, unknown>;
  const planId =
    typeof record.planId === "string" && record.planId.trim().length > 0 ? record.planId : "live-plan";
  const summary = typeof record.summary === "string" ? record.summary : "";

  return { ...record, schemaVersion: 1, planId, summary };
}

function parseJsonResponse(response: string): unknown {
  try {
    return JSON.parse(response);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Patch Plan: response was not valid JSON (${detail})`);
  }
}

function buildSystemPrompt(): string {
  return [
    "You are the Proposal Engine for Onix, a Learning Capture tool for Obsidian vaults.",
    "Interpret the Freeform Capture into atomic Learning Captures and produce a Patch Plan as JSON only.",
    "",
    "Classify each Learning Capture into exactly one kind:",
    "- consolidated-knowledge: Consolidated Knowledge to store under a Knowledge Topic.",
    "- knowledge-refinement: a Knowledge Refinement that strengthens an existing paragraph in a Candidate Note instead of duplicating it.",
    "- research-candidate: a Research Candidate, a link or reference worth investigating later.",
    "- reference-item: a Reference Item, a link or reference that stays useful to access after producing learning.",
    "- no-consolidation-candidate: a No Consolidation Candidate, not durable learning as written (e.g. reminders, pure duplicates).",
    "- sensitive-candidate: a Sensitive Candidate that may contain private, secret, or identifying information; never set a destinationPath.",
    "",
    "Set the Primary Topic to the single Knowledge Topic where Consolidated Knowledge is stored,",
    "and Related Topics to secondary Knowledge Topics that improve discovery without duplicating content.",
    "Consult the Vault Index before proposing destinations; prefer existing Knowledge Topics over inventing new ones.",
    "Each item must include a sourceTrace pointing back to the Session Inbox line it came from.",
    "",
    "Return only a single JSON object (never a top-level array) with this exact shape:",
    '{ "summary": string, "items": [ { "id": string, "kind": one of the kinds above,',
    '  "destinationPath"?: string, "learningCapture": string, "primaryTopic"?: string,',
    '  "relatedTopics": string[], "sourceTrace": string, "proposedContent": string,',
    '  "existingContent"?: string, "refinementReason"?: string } ] }',
    "Output JSON only, with no prose or code fences."
  ].join("\n");
}

function buildUserPrompt(input: ProposalEngineInput): string {
  return [
    "Produce a Patch Plan for the following Session Closing input.",
    `Session Inbox path: ${input.sessionInboxPath}`,
    "",
    "Freeform Capture:",
    input.freeformCapture,
    "",
    "Vault Index (existing Knowledge Topics):",
    JSON.stringify(input.vaultIndex, null, 2),
    "",
    "Candidate Notes (read deeply for duplicates and Knowledge Refinement):",
    JSON.stringify(input.candidateNotes, null, 2)
  ].join("\n");
}
