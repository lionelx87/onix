import type { ClassificationRule, PatchPlan, ProposalEngine, ProposalEngineInput } from "./contract.js";
import { parsePatchPlan, proposalEngineInputSchema } from "./contract.js";
import type { VaultIndexNote } from "../vault-index.js";

type InterpretedCapture = {
  text: string;
  sourceLine: number;
};

export function createStubProposalEngine(): ProposalEngine {
  return {
    async propose(rawInput: ProposalEngineInput): Promise<PatchPlan> {
      const input = proposalEngineInputSchema.parse(rawInput);
      const captures = interpretFreeformCaptures(input.freeformCapture);
      const primaryDestination = selectPrimaryDestination(input);

      return parsePatchPlan({
        schemaVersion: 1,
        planId: "stubbed-plan",
        summary:
          captures.length === 0
            ? "No Freeform Captures found in the Session Inbox."
            : "Stubbed Organization Proposal generated from the Session Inbox.",
        items: captures.map((capture, index) => {
          const duplicate = findPureDuplicate(capture.text, input.candidateNotes);
          if (duplicate !== undefined) {
            return {
              id: `item-${index + 1}`,
              kind: "no-consolidation-candidate",
              learningCapture: capture.text,
              relatedTopics: [],
              sourceTrace: `${input.sessionInboxPath} line ${capture.sourceLine}`,
              proposedContent: "No Consolidation Candidate: capture already exists in Consolidated Knowledge."
            };
          }

          const refinement = findStrengtheningRefinement(capture.text, input.candidateNotes, input.vaultIndex.notes);
          if (refinement !== undefined) {
            return {
              id: `item-${index + 1}`,
              kind: "knowledge-refinement",
              destinationPath: refinement.notePath,
              learningCapture: capture.text,
              primaryTopic: refinement.primaryTopic,
              relatedTopics: [],
              sourceTrace: `${input.sessionInboxPath} line ${capture.sourceLine}`,
              proposedContent: capture.text,
              existingContent: refinement.existingParagraph,
              refinementReason: "Strengthens existing Consolidated Knowledge with additional detail from the Session Inbox."
            };
          }

          const matchedRule = matchClassificationRule(capture.text, input.classificationRules);
          const kind = classifyCapture(capture.text);
          const destination = matchedRule?.destinationPath ?? destinationFor(kind, primaryDestination?.path);
          const primaryTopic = primaryTopicFor(kind, primaryDestination);
          const relatedTopics = relatedTopicsFor(capture.text, primaryTopic);

          return {
            id: `item-${index + 1}`,
            kind,
            ...(destination === undefined ? {} : { destinationPath: destination }),
            learningCapture: capture.text,
            ...(primaryTopic === undefined ? {} : { primaryTopic }),
            relatedTopics,
            sourceTrace: `${input.sessionInboxPath} line ${capture.sourceLine}`,
            proposedContent: proposedContentFor(kind, capture.text, relatedTopics)
          };
        })
      });
    }
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

function findPureDuplicate(
  captureText: string,
  candidateNotes: ProposalEngineInput["candidateNotes"]
): { notePath: string; existingParagraph: string } | undefined {
  const captureKey = normalizeForComparison(captureText);
  if (captureKey.length === 0) {
    return undefined;
  }

  for (const note of candidateNotes) {
    for (const paragraph of splitParagraphs(note.content)) {
      if (normalizeForComparison(paragraph) === captureKey) {
        return { notePath: note.path, existingParagraph: paragraph };
      }
    }
  }

  return undefined;
}

function findStrengtheningRefinement(
  captureText: string,
  candidateNotes: ProposalEngineInput["candidateNotes"],
  vaultIndexNotes: VaultIndexNote[]
): { notePath: string; existingParagraph: string; primaryTopic: string } | undefined {
  const captureTokens = tokenSet(captureText);
  if (captureTokens.size === 0) {
    return undefined;
  }

  for (const note of candidateNotes) {
    for (const paragraph of splitParagraphs(note.content)) {
      const paragraphTokens = tokenSet(paragraph);
      if (paragraphTokens.size === 0 || paragraphTokens.size >= captureTokens.size) {
        continue;
      }

      const isSubset = [...paragraphTokens].every((token) => captureTokens.has(token));
      if (isSubset) {
        const indexedNote = vaultIndexNotes.find((candidate) => candidate.path === note.path);
        return {
          notePath: note.path,
          existingParagraph: paragraph,
          primaryTopic: indexedNote?.title ?? note.path
        };
      }
    }
  }

  return undefined;
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3)
  );
}

function splitParagraphs(content: string): string[] {
  return content
    .split(/\r?\n\r?\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0 && !paragraph.startsWith("#"));
}

function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function interpretFreeformCaptures(freeformCapture: string): InterpretedCapture[] {
  return freeformCapture
    .split(/\r?\n/)
    .map((line) => normalizeCaptureLine(line))
    .filter((text) => text.length > 0)
    .map((text, index) => ({ text, sourceLine: index + 1 }));
}

function normalizeCaptureLine(line: string): string {
  return line.trim().replace(/^[-*]\s+/, "");
}

function classifyCapture(
  capture: string
): PatchPlan["items"][number]["kind"] {
  if (/\b(secret|api token|api key|password|credential|private key)\b/i.test(capture)) {
    return "sensitive-candidate";
  }

  if (/^(reference|reference item)\b/i.test(capture)) {
    return "reference-item";
  }

  if (/^(research|read later|investigate)\b/i.test(capture) || /https?:\/\//i.test(capture)) {
    return "research-candidate";
  }

  if (/^(todo|reminder|remember to)\b/i.test(capture)) {
    return "no-consolidation-candidate";
  }

  return "consolidated-knowledge";
}

function selectPrimaryDestination(input: ProposalEngineInput): VaultIndexNote | undefined {
  const candidatePaths = new Set(input.candidateNotes.map((note) => note.path));
  return input.vaultIndex.notes.find((note) => candidatePaths.has(note.path)) ?? input.vaultIndex.notes[0];
}

function destinationFor(kind: PatchPlan["items"][number]["kind"], primaryDestinationPath: string | undefined): string | undefined {
  if (kind === "sensitive-candidate" || kind === "no-consolidation-candidate") {
    return undefined;
  }

  if (kind === "research-candidate") {
    return "Onix/Research Inbox.md";
  }

  if (kind === "reference-item") {
    return `Reference Library/${primaryDestinationPath === undefined ? "Session Inbox" : titleFromPath(primaryDestinationPath)}.md`;
  }

  return primaryDestinationPath ?? "Knowledge/Session Inbox.md";
}

function titleFromPath(path: string): string {
  return path.split("/").at(-1)?.replace(/\.md$/, "") ?? "Session Inbox";
}

function primaryTopicFor(
  kind: PatchPlan["items"][number]["kind"],
  primaryDestination: VaultIndexNote | undefined
): string | undefined {
  if (kind === "sensitive-candidate" || kind === "no-consolidation-candidate") {
    return undefined;
  }

  return primaryDestination?.title ?? "Session Inbox";
}

function relatedTopicsFor(capture: string, primaryTopic: string | undefined): string[] {
  const topics = [];

  if (/\b(bug|debug|debugging|error|failure)\b/i.test(capture)) {
    topics.push("Debugging");
  }

  return topics.filter((topic) => topic !== primaryTopic);
}

function proposedContentFor(
  kind: PatchPlan["items"][number]["kind"],
  capture: string,
  relatedTopics: string[]
): string {
  if (kind === "sensitive-candidate") {
    return "Sensitive Candidate requires review and sanitization before consolidation.";
  }

  if (kind === "no-consolidation-candidate") {
    return "No Consolidation Candidate: capture is not durable learning as written.";
  }

  if (kind === "consolidated-knowledge" && relatedTopics.length > 0) {
    return `${capture}\n\nRelated: ${relatedTopics.map((topic) => `[[${topic}]]`).join(", ")}`;
  }

  return capture;
}
