import { describe, expect, test } from "vitest";
import { createLiveProposalEngine, type CaptureCompletionClient } from "../src/proposal-engine/live.js";
import type { ProposalEngineInput } from "../src/proposal-engine/contract.js";

function baseInput(overrides: Partial<ProposalEngineInput> = {}): ProposalEngineInput {
  return {
    schemaVersion: 1,
    sessionInboxPath: "Onix/Sessions/session-inbox-20260527-120000.md",
    freeformCapture: "- Primary Topics answer the durable question.",
    vaultIndexRef: ".onix/indexes/vault-index.json",
    vaultIndex: {
      schemaVersion: 1,
      generatedAt: "2026-05-27T12:00:00.000Z",
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
        content: "# Knowledge Topics\n\nStable subjects used to recover Consolidated Knowledge.\n"
      }
    ],
    classificationRules: [],
    ...overrides
  };
}

function clientReturning(...responses: string[]): CaptureCompletionClient {
  const queue = [...responses];
  return {
    async complete() {
      const next = queue.shift();
      if (next === undefined) {
        throw new Error("No more mocked completions");
      }
      return next;
    }
  };
}

const validPlan = JSON.stringify({
  schemaVersion: 1,
  planId: "live-plan-1",
  summary: "Live Organization Proposal generated from the Session Inbox.",
  items: [
    {
      id: "item-1",
      kind: "consolidated-knowledge",
      destinationPath: "Knowledge/Knowledge Topics.md",
      learningCapture: "Primary Topics answer the durable question.",
      primaryTopic: "Knowledge Topics",
      relatedTopics: [],
      sourceTrace: "Onix/Sessions/session-inbox-20260527-120000.md line 1",
      proposedContent: "Primary Topics answer the durable question."
    }
  ]
});

describe("Live Proposal Engine", () => {
  test("returns a validated Patch Plan from the provider response", async () => {
    const engine = createLiveProposalEngine({ client: clientReturning(validPlan), model: "gpt-5.5" });

    const plan = await engine.propose(baseInput());

    expect(plan.planId).toBe("live-plan-1");
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({
      kind: "consolidated-knowledge",
      destinationPath: "Knowledge/Knowledge Topics.md",
      learningCapture: "Primary Topics answer the durable question."
    });
  });

  test("retries after an invalid response and recovers within the retry budget", async () => {
    let calls = 0;
    const client: CaptureCompletionClient = {
      async complete(request) {
        calls += 1;
        if (calls === 1) {
          return "this is not json";
        }
        expect(request.userPrompt).toContain("Invalid Patch Plan");
        return validPlan;
      }
    };

    const engine = createLiveProposalEngine({ client, model: "gpt-5.5", maxRetries: 2 });

    const plan = await engine.propose(baseInput());

    expect(calls).toBe(2);
    expect(plan.planId).toBe("live-plan-1");
  });

  test("aborts with a clear error after exhausting the retry budget", async () => {
    let calls = 0;
    const client: CaptureCompletionClient = {
      async complete() {
        calls += 1;
        return "still not json";
      }
    };

    const engine = createLiveProposalEngine({ client, model: "gpt-5.5", maxRetries: 2 });

    await expect(engine.propose(baseInput())).rejects.toThrow(
      /could not produce a valid Patch Plan after 3 attempts/
    );
    expect(calls).toBe(3);
  });

  test("applies Classification Rules precedence over the provider's destination", async () => {
    const planWithWrongDestination = JSON.stringify({
      schemaVersion: 1,
      planId: "live-plan-2",
      summary: "Live Organization Proposal generated from the Session Inbox.",
      items: [
        {
          id: "item-1",
          kind: "consolidated-knowledge",
          destinationPath: "Knowledge/Misc.md",
          learningCapture: "Docker layer caching speeds up rebuilds.",
          primaryTopic: "Misc",
          relatedTopics: [],
          sourceTrace: "Onix/Sessions/session-inbox-20260527-120000.md line 1",
          proposedContent: "Docker layer caching speeds up rebuilds."
        }
      ]
    });

    const engine = createLiveProposalEngine({
      client: clientReturning(planWithWrongDestination),
      model: "gpt-5.5"
    });

    const plan = await engine.propose(
      baseInput({
        classificationRules: [
          {
            id: "rule-1",
            pattern: "docker",
            destinationPath: "Knowledge/Docker.md",
            approvedAt: "2026-05-27T12:00:00.000Z"
          }
        ]
      })
    );

    expect(plan.items[0]?.destinationPath).toBe("Knowledge/Docker.md");
  });

  test("builds a Capture Interpretation Prompt using the domain language and the input", async () => {
    let captured: { systemPrompt: string; userPrompt: string } | undefined;
    const client: CaptureCompletionClient = {
      async complete(request) {
        captured = { systemPrompt: request.systemPrompt, userPrompt: request.userPrompt };
        return validPlan;
      }
    };

    const engine = createLiveProposalEngine({ client, model: "gpt-5.5" });
    await engine.propose(baseInput());

    expect(captured?.systemPrompt).toContain("Learning Capture");
    expect(captured?.systemPrompt).toContain("Primary Topic");
    expect(captured?.systemPrompt).toContain("Knowledge Refinement");
    expect(captured?.systemPrompt).toContain("Sensitive Candidate");
    expect(captured?.userPrompt).toContain("Primary Topics answer the durable question.");
    expect(captured?.userPrompt).toContain("Knowledge/Knowledge Topics.md");
  });
});
