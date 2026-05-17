import type { PatchPlan, ProposalEngine, ProposalEngineInput } from "./contract.js";
import { parsePatchPlan } from "./contract.js";
import type { VaultIndexNote } from "../vault-index.js";

type InterpretedCapture = {
  text: string;
  sourceLine: number;
};

export function createStubProposalEngine(): ProposalEngine {
  return {
    async propose(input: ProposalEngineInput): Promise<PatchPlan> {
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
          const kind = classifyCapture(capture.text);
          const destination = destinationFor(kind, primaryDestination?.path);
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
