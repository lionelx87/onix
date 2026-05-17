import { describe, expect, test } from "vitest";
import { parsePatchPlan } from "../src/proposal-engine/contract.js";
import { createStubProposalEngine } from "../src/proposal-engine/stub.js";

describe("Proposal Engine contract", () => {
  test("accepts deterministic Patch Plan fixtures without an LLM provider", () => {
    const plan = parsePatchPlan({
      schemaVersion: 1,
      planId: "fixture-plan",
      summary: "Stubbed proposal for smoke testing.",
      items: [
        {
          id: "item-1",
          kind: "consolidated-knowledge",
          destinationPath: "Knowledge/Local CLI.md",
          learningCapture: "Provider calls should stay behind a contract.",
          primaryTopic: "Local CLI",
          relatedTopics: ["Proposal Engine"],
          sourceTrace: "Session Inbox line 1",
          proposedContent: "CLI scaffolds should keep provider calls behind a contract."
        }
      ]
    });

    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]?.kind).toBe("consolidated-knowledge");
  });

  test("generates atomic Learning Captures and special candidates from deterministic input", async () => {
    const engine = createStubProposalEngine();

    const plan = await engine.propose({
      schemaVersion: 1,
      sessionInboxPath: "Onix/Sessions/session-inbox-20260516-120000.md",
      freeformCapture: [
        "- Primary Topics answer the durable question; bug contexts should be Related Topics.",
        "- Research: https://example.com/vector-search for future vault indexing.",
        "- Reference: https://example.com/cli-docs documents command UX patterns.",
        "- Secret: production API token was pasted during debugging.",
        "- TODO: buy coffee after the session."
      ].join("\n"),
      vaultIndexRef: ".onix/indexes/vault-index.json",
      vaultIndex: {
        schemaVersion: 1,
        generatedAt: "2026-05-16T12:00:00.000Z",
        notes: [
          {
            path: "Knowledge/Knowledge Topics.md",
            title: "Knowledge Topics",
            aliases: ["Primary Topics"],
            headings: ["Knowledge Topics"],
            tags: ["onix"],
            summary: "Stable subjects used to recover Consolidated Knowledge.",
            outgoingLinks: []
          }
        ]
      },
      candidateNotes: [
        {
          path: "Knowledge/Knowledge Topics.md",
          content: "# Knowledge Topics\n\nStable subjects used to recover Consolidated Knowledge.\n"
        }
      ],
      classificationRules: []
    });

    expect(plan.items).toHaveLength(5);
    expect(plan.items.map((item) => item.kind)).toEqual([
      "consolidated-knowledge",
      "research-candidate",
      "reference-item",
      "sensitive-candidate",
      "no-consolidation-candidate"
    ]);
    expect(plan.items[0]).toMatchObject({
      learningCapture: "Primary Topics answer the durable question; bug contexts should be Related Topics.",
      destinationPath: "Knowledge/Knowledge Topics.md",
      primaryTopic: "Knowledge Topics",
      relatedTopics: ["Debugging"]
    });
    expect(plan.items[1]).toMatchObject({
      learningCapture: "Research: https://example.com/vector-search for future vault indexing.",
      destinationPath: "Onix/Research Inbox.md",
      primaryTopic: "Knowledge Topics"
    });
    expect(plan.items[2]).toMatchObject({
      learningCapture: "Reference: https://example.com/cli-docs documents command UX patterns.",
      destinationPath: "Reference Library/Knowledge Topics.md",
      primaryTopic: "Knowledge Topics"
    });
    expect(plan.items[3]).toMatchObject({
      learningCapture: "Secret: production API token was pasted during debugging."
    });
    expect(plan.items[3]).not.toHaveProperty("destinationPath");
    expect(plan.items[4]).toMatchObject({
      learningCapture: "TODO: buy coffee after the session."
    });
    expect(plan.items[4]).not.toHaveProperty("destinationPath");
  });

  test("classifies a pure duplicate capture as a No Consolidation Candidate", async () => {
    const engine = createStubProposalEngine();

    const plan = await engine.propose({
      schemaVersion: 1,
      sessionInboxPath: "Onix/Sessions/session-inbox-20260517-100000.md",
      freeformCapture: "- Primary Topics answer the durable question.",
      vaultIndexRef: ".onix/indexes/vault-index.json",
      vaultIndex: {
        schemaVersion: 1,
        generatedAt: "2026-05-17T10:00:00.000Z",
        notes: [
          {
            path: "Knowledge/Knowledge Topics.md",
            title: "Knowledge Topics",
            aliases: [],
            headings: ["Knowledge Topics"],
            tags: [],
            summary: "Stable subjects used to recover Consolidated Knowledge.",
            outgoingLinks: []
          }
        ]
      },
      candidateNotes: [
        {
          path: "Knowledge/Knowledge Topics.md",
          content: "# Knowledge Topics\n\nPrimary Topics answer the durable question.\n"
        }
      ],
      classificationRules: []
    });

    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({
      kind: "no-consolidation-candidate",
      learningCapture: "Primary Topics answer the durable question."
    });
    expect(plan.items[0]).not.toHaveProperty("destinationPath");
  });

  test("classifies a strengthening duplicate as a Knowledge Refinement", async () => {
    const engine = createStubProposalEngine();

    const plan = await engine.propose({
      schemaVersion: 1,
      sessionInboxPath: "Onix/Sessions/session-inbox-20260517-100000.md",
      freeformCapture: "- Primary Topics answer the durable question, and bug contexts become Related Topics.",
      vaultIndexRef: ".onix/indexes/vault-index.json",
      vaultIndex: {
        schemaVersion: 1,
        generatedAt: "2026-05-17T10:00:00.000Z",
        notes: [
          {
            path: "Knowledge/Knowledge Topics.md",
            title: "Knowledge Topics",
            aliases: [],
            headings: ["Knowledge Topics"],
            tags: [],
            summary: "Stable subjects used to recover Consolidated Knowledge.",
            outgoingLinks: []
          }
        ]
      },
      candidateNotes: [
        {
          path: "Knowledge/Knowledge Topics.md",
          content: "# Knowledge Topics\n\nPrimary Topics answer the durable question.\n"
        }
      ],
      classificationRules: []
    });

    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({
      kind: "knowledge-refinement",
      destinationPath: "Knowledge/Knowledge Topics.md",
      existingContent: "Primary Topics answer the durable question.",
      proposedContent: "Primary Topics answer the durable question, and bug contexts become Related Topics.",
      refinementReason: "Strengthens existing Consolidated Knowledge with additional detail from the Session Inbox."
    });
  });

  test("adds Valuable Links only when a Related Topic improves retrieval", async () => {
    const engine = createStubProposalEngine();

    const plan = await engine.propose({
      schemaVersion: 1,
      sessionInboxPath: "Onix/Sessions/session-inbox-20260516-120000.md",
      freeformCapture: [
        "- TypeScript error messages can point at the caller instead of the broken generic.",
        "- CLI help output should name each workflow command."
      ].join("\n"),
      vaultIndexRef: ".onix/indexes/vault-index.json",
      vaultIndex: {
        schemaVersion: 1,
        generatedAt: "2026-05-16T12:00:00.000Z",
        notes: [
          {
            path: "Knowledge/TypeScript.md",
            title: "TypeScript",
            aliases: [],
            headings: ["TypeScript"],
            tags: [],
            summary: "TypeScript language behavior.",
            outgoingLinks: []
          }
        ]
      },
      candidateNotes: [],
      classificationRules: []
    });

    expect(plan.items[0]).toMatchObject({
      relatedTopics: ["Debugging"],
      proposedContent:
        "TypeScript error messages can point at the caller instead of the broken generic.\n\nRelated: [[Debugging]]"
    });
    expect(plan.items[1]).toMatchObject({
      relatedTopics: [],
      proposedContent: "CLI help output should name each workflow command."
    });
  });
});
