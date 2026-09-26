import { describe, expect, test } from "vitest";
import type { ProposalEngineInput, ProviderRetryEvent } from "../src/proposal-engine/contract.js";
import { createLiveProposalEngine, type CaptureCompletionClient } from "../src/proposal-engine/live.js";
import { asProviderUnavailableError, ProviderUnavailableError } from "../src/proposal-engine/provider-errors.js";

const input: ProposalEngineInput = {
  schemaVersion: 1,
  sessionInboxPath: "Onix/Sessions/session-inbox.md",
  freeformCapture: "- A durable learning.",
  vaultIndexRef: ".onix/indexes/vault-index.json",
  vaultIndex: { schemaVersion: 1, generatedAt: "2026-09-26T00:00:00.000Z", notes: [] },
  candidateNotes: [],
  classificationRules: [],
  projects: []
};

const validPlan = JSON.stringify({ summary: "Plan.", items: [] });

function clientFailingThenReturning(failures: unknown[], response = validPlan): CaptureCompletionClient & { calls: number } {
  const queue = [...failures];
  return {
    calls: 0,
    async complete() {
      this.calls += 1;
      const failure = queue.shift();
      if (failure !== undefined) {
        throw failure;
      }
      return response;
    }
  };
}

const unavailable = () => new ProviderUnavailableError("Gemini", "gemini-3.8-flash", 503);

describe("Live Proposal Engine with an unavailable provider", () => {
  test("retries a transient provider failure with backoff and reports each retry", async () => {
    const client = clientFailingThenReturning([unavailable(), unavailable()]);
    const sleeps: number[] = [];
    const events: ProviderRetryEvent[] = [];
    const engine = createLiveProposalEngine({
      client,
      model: "gemini-3.8-flash",
      providerRetryDelaysMs: [5_000, 20_000],
      sleep: async (ms) => {
        sleeps.push(ms);
      }
    });

    const plan = await engine.propose(input, { onProviderRetry: (event) => events.push(event) });

    expect(plan.summary).toBe("Plan.");
    expect(client.calls).toBe(3);
    expect(sleeps).toEqual([5_000, 20_000]);
    expect(events).toEqual([
      { provider: "Gemini", status: 503, nextAttempt: 2, maxAttempts: 3, delayMs: 5_000 },
      { provider: "Gemini", status: 503, nextAttempt: 3, maxAttempts: 3, delayMs: 20_000 }
    ]);
  });

  test("gives up with an actionable error once the retries are exhausted", async () => {
    const client = clientFailingThenReturning([unavailable(), unavailable(), unavailable()]);
    const engine = createLiveProposalEngine({
      client,
      model: "gemini-3.8-flash",
      providerRetryDelaysMs: [1, 1],
      sleep: async () => undefined
    });

    const failure = engine.propose(input);

    await expect(failure).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(failure).rejects.toThrow("Your Active Session and Session Inbox are untouched");
    expect(client.calls).toBe(3);
  });

  test("does not retry errors that are not transient provider failures", async () => {
    const client = clientFailingThenReturning([new Error("invalid API key")]);
    const engine = createLiveProposalEngine({ client, model: "gemini-3.8-flash", sleep: async () => undefined });

    await expect(engine.propose(input)).rejects.toThrow("invalid API key");
    expect(client.calls).toBe(1);
  });
});

describe("asProviderUnavailableError", () => {
  test.each([408, 429, 500, 502, 503, 504])("wraps HTTP %i as ProviderUnavailableError", (status) => {
    const wrapped = asProviderUnavailableError(Object.assign(new Error("boom"), { status }), "Gemini", "gemini-3.8-flash");

    expect(wrapped).toBeInstanceOf(ProviderUnavailableError);
    expect((wrapped as ProviderUnavailableError).message).toContain(`HTTP ${status}, model gemini-3.8-flash`);
  });

  test("passes other errors through unchanged", () => {
    const badRequest = Object.assign(new Error("bad request"), { status: 400 });

    expect(asProviderUnavailableError(badRequest, "OpenAI", "gpt-5.5")).toBe(badRequest);
  });
});
