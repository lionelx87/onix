import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  MissingLlmCredentialsError,
  resolveModel,
  resolveProposalEngine
} from "../src/proposal-engine/factory.js";

const ENV_KEYS = ["OPENAI_API_KEY", "ONIX_MODEL", "ONIX_PROPOSAL_ENGINE"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

describe("Proposal Engine factory", () => {
  test("fails with a clear hint when OPENAI_API_KEY is missing", async () => {
    await expect(resolveProposalEngine()).rejects.toBeInstanceOf(MissingLlmCredentialsError);
    await expect(resolveProposalEngine()).rejects.toThrow(/OPENAI_API_KEY/);
  });

  test("forces the deterministic stub when ONIX_PROPOSAL_ENGINE=stub", async () => {
    process.env.ONIX_PROPOSAL_ENGINE = "stub";

    const engine = await resolveProposalEngine();
    const plan = await engine.propose({
      schemaVersion: 1,
      sessionInboxPath: "Onix/Sessions/session-inbox-20260527-120000.md",
      freeformCapture: "- Primary Topics answer the durable question.",
      vaultIndexRef: ".onix/indexes/vault-index.json",
      vaultIndex: { schemaVersion: 1, generatedAt: "2026-05-27T12:00:00.000Z", notes: [] },
      candidateNotes: [],
      classificationRules: []
    });

    expect(plan.planId).toBe("stubbed-plan");
  });

  test("resolves model from ONIX_MODEL, then config, then the default", () => {
    expect(resolveModel({})).toBe("gpt-5.5");
    expect(resolveModel({ model: "gpt-5.4" })).toBe("gpt-5.4");

    process.env.ONIX_MODEL = "gpt-5.5-preview";
    expect(resolveModel({ model: "gpt-5.4" })).toBe("gpt-5.5-preview");
  });
});
