import type { ClassificationRule, PatchPlan, ProposalEngine, ProposalEngineInput } from "./contract.js";
import { parsePatchPlan } from "./contract.js";
import { isProjectNotePath } from "../vault-index.js";

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
          const ruled = applyClassificationRules(plan, input.classificationRules);
          const verified = demoteUnverifiableRefinements(ruled, input.candidateNotes);
          return sanitizeProjectRouting(verified, input.projects);
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

function demoteUnverifiableRefinements(
  plan: PatchPlan,
  candidateNotes: ProposalEngineInput["candidateNotes"]
): PatchPlan {
  const contentByPath = new Map(candidateNotes.map((note) => [note.path, note.content]));

  return {
    ...plan,
    items: plan.items.map((item) => {
      if (item.kind !== "knowledge-refinement") {
        return item;
      }

      const target = item.existingContent?.trim();
      const noteContent = item.destinationPath === undefined ? undefined : contentByPath.get(item.destinationPath);
      if (target !== undefined && target.length > 0 && noteContent !== undefined && noteContent.includes(target)) {
        return item;
      }

      const { existingContent: _existingContent, refinementReason: _refinementReason, ...rest } = item;
      return { ...rest, kind: "consolidated-knowledge" };
    })
  };
}

const projectUsageKinds = new Set<PatchPlan["items"][number]["kind"]>(["consolidated-knowledge", "knowledge-refinement"]);

function sanitizeProjectRouting(plan: PatchPlan, projects: ProposalEngineInput["projects"]): PatchPlan {
  const knownProjects = new Set(projects.map((project) => project.path));

  return {
    ...plan,
    items: plan.items.map((item) => {
      const { project, projectUsage, ...rest } = item;
      const routed =
        item.kind === "project-context" && (item.destinationPath === undefined || !isProjectNotePath(item.destinationPath))
          ? { ...rest, kind: "consolidated-knowledge" as const }
          : rest;

      if (
        project === undefined ||
        projectUsage === undefined ||
        !knownProjects.has(project) ||
        !projectUsageKinds.has(routed.kind)
      ) {
        return routed;
      }

      return { ...routed, project, projectUsage };
    })
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
    "Interpret the Freeform Capture into Learning Captures and produce a Patch Plan as JSON only.",
    "The Freeform Capture is often a raw dump of notes, chat excerpts, commands, and logs, in no particular order.",
    "",
    "Extract Applicable Blocks, not fragments. An Applicable Block is Consolidated Knowledge someone can act on by reading it alone:",
    "- It states when it applies (the context or problem), what the answer or decision is, and how to apply it (steps, commands, snippets, caveats).",
    "- Gather every line of the Freeform Capture that belongs to the same block, even when the lines are scattered; never split one procedure or explanation across several items.",
    "- Never merge unrelated subjects into one item; one Applicable Block answers one question.",
    "- Leave out conversational noise, dead ends, and repetition; classify leftovers that are not durable as no-consolidation-candidate.",
    "",
    "Classify each Learning Capture into exactly one kind:",
    "- consolidated-knowledge: Consolidated Knowledge to store under a Knowledge Topic.",
    "- knowledge-refinement: a Knowledge Refinement that strengthens an existing paragraph in a Candidate Note instead of duplicating it. Only use this kind when the paragraph truly exists in a provided Candidate Note, and set existingContent to that paragraph copied verbatim, character for character. Otherwise use consolidated-knowledge.",
    "- research-candidate: a Research Candidate, a link or reference worth investigating later.",
    "- reference-item: a Reference Item, a link or reference that stays useful to access after producing learning.",
    "- no-consolidation-candidate: a No Consolidation Candidate, not durable learning as written (e.g. reminders, pure duplicates).",
    "- sensitive-candidate: a Sensitive Candidate that may contain private, secret, or identifying information; never set a destinationPath.",
    "- project-context: Project Context, learning that only makes sense inside one project (its decisions, status, configuration, conventions, or people). Set destinationPath to that project's Project Note.",
    "",
    "Route every Applicable Block by asking: would it still be useful outside the project where it came up?",
    "- Yes: it is reusable knowledge. Store it once, in its Knowledge Topic, as consolidated-knowledge or knowledge-refinement; never store reusable knowledge inside a Project Note.",
    "  When it came up while working on a listed project, also set project to that Project Note path and projectUsage to one short sentence on why or how it was used there. Do not repeat the knowledge in projectUsage; Onix links the Project Note to the block.",
    "- No: it is project-context stored in that Project Note. Reference reusable knowledge by name instead of restating it.",
    "Only use Project Note paths from the provided Projects list for project, and omit project when no listed project clearly applies.",
    "",
    "Set the Primary Topic to the single Knowledge Topic where Consolidated Knowledge is stored,",
    "and Related Topics to secondary Knowledge Topics that improve discovery without duplicating content.",
    "Consult the Vault Index before proposing destinations; prefer existing Knowledge Topics over inventing new ones.",
    "Each item must include a sourceTrace pointing back to the Session Inbox line it came from.",
    "",
    "Write each item's proposedContent (the Consolidated Knowledge) in the Destination Language:",
    "the dominant language of the destination note, or the language of the Learning Capture itself when",
    "the destination is new. Preserve real tool names, commands, APIs, and established technical terms in",
    "their original form; do not translate them. Never translate the learning into a different language.",
    "",
    "Structure each proposedContent so it reads as durable knowledge, not loose prose:",
    "- When the knowledge introduces a distinct subject, open it with a descriptive Markdown heading that names what the knowledge is about; pick a heading level consistent with the destination note's existing structure. Separate the heading from the body with a blank line so they render as distinct blocks. Omit the heading when the content belongs under an existing heading and adding one would fragment it.",
    "- Put commands, file contents, and configuration or code snippets inside fenced code blocks tagged with the snippet's real language (bash, json, yaml, ts, ...). Use inline code for tool names, flags, paths, and API identifiers instead of bold. Reserve bold and italics for genuine emphasis.",
    "A Knowledge Refinement may add its own heading or restructure the paragraph when that improves readability, as long as existingContent still copies the original paragraph verbatim.",
    "",
    "Return only a single JSON object (never a top-level array) with this exact shape:",
    '{ "summary": string, "items": [ { "id": string, "kind": one of the kinds above,',
    '  "destinationPath"?: string, "learningCapture": string, "primaryTopic"?: string,',
    '  "relatedTopics": string[], "sourceTrace": string, "proposedContent": string,',
    '  "existingContent"?: string, "refinementReason"?: string, "project"?: string, "projectUsage"?: string } ] }',
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
    JSON.stringify(input.candidateNotes, null, 2),
    "",
    "Projects (existing Project Notes):",
    JSON.stringify(input.projects, null, 2)
  ].join("\n");
}
