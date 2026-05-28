import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readGlobalConfig } from "../src/global-config.js";
import {
  MissingLlmCredentialsError,
  resolveModel,
  resolveProposalEngine,
  resolveProvider
} from "../src/proposal-engine/factory.js";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "ONIX_MODEL",
  "ONIX_PROVIDER",
  "ONIX_PROPOSAL_ENGINE"
] as const;
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
  test("resolves the provider from ONIX_PROVIDER, then config, then the gemini default", () => {
    expect(resolveProvider({})).toBe("gemini");
    expect(resolveProvider({ provider: "openai" })).toBe("openai");

    process.env.ONIX_PROVIDER = "openai";
    expect(resolveProvider({ provider: "gemini" })).toBe("openai");
  });

  test("fails with a GEMINI_API_KEY hint when the default provider has no credentials", async () => {
    await expect(resolveProposalEngine()).rejects.toBeInstanceOf(MissingLlmCredentialsError);
    await expect(resolveProposalEngine()).rejects.toThrow(/GEMINI_API_KEY/);
  });

  test("fails with an OPENAI_API_KEY hint when the openai provider has no credentials", async () => {
    process.env.ONIX_PROVIDER = "openai";

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

  test("shows the Gemini free-tier privacy notice once and persists the flag", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const warnings: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((value: string) => warnings.push(value));

    try {
      await resolveProposalEngine();
      await resolveProposalEngine();
    } finally {
      warn.mockRestore();
    }

    expect(warnings.filter((message) => message.includes("free tier"))).toHaveLength(1);
    const config = await readGlobalConfig();
    expect(config.geminiPrivacyNoticeShown).toBe(true);
  });

  test("resolves model from ONIX_MODEL, then config, then the provider default", () => {
    expect(resolveModel({}, "gemini")).toBe("gemini-2.5-flash");
    expect(resolveModel({}, "openai")).toBe("gpt-5.5");
    expect(resolveModel({ model: "custom-model" }, "gemini")).toBe("custom-model");

    process.env.ONIX_MODEL = "env-model";
    expect(resolveModel({ model: "custom-model" }, "openai")).toBe("env-model");
  });
});
