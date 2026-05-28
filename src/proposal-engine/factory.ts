import { readGlobalConfig, updateGlobalConfig, type GlobalConfig } from "../global-config.js";
import type { CaptureCompletionClient } from "./live.js";
import type { ProposalEngine } from "./contract.js";
import { createGeminiCompletionClient } from "./gemini-client.js";
import { createLiveProposalEngine } from "./live.js";
import { createOpenAiCompletionClient } from "./openai-client.js";
import { createStubProposalEngine } from "./stub.js";

export type Provider = "gemini" | "openai";

export const DEFAULT_PROVIDER: Provider = "gemini";

export const PROVIDER_DEFAULTS: Record<Provider, { model: string; apiKeyEnv: string }> = {
  gemini: { model: "gemini-2.5-flash", apiKeyEnv: "GEMINI_API_KEY" },
  openai: { model: "gpt-5.5", apiKeyEnv: "OPENAI_API_KEY" }
};

function isProvider(value: string | undefined): value is Provider {
  return value === "gemini" || value === "openai";
}

export function resolveProvider(config: Pick<GlobalConfig, "provider">): Provider {
  const fromEnv = process.env.ONIX_PROVIDER?.trim();
  if (isProvider(fromEnv)) {
    return fromEnv;
  }

  if (isProvider(config.provider)) {
    return config.provider;
  }

  return DEFAULT_PROVIDER;
}

const PROVIDER_LABELS: Record<Provider, string> = {
  gemini: "Gemini",
  openai: "OpenAI"
};

export class MissingLlmCredentialsError extends Error {
  constructor(provider: Provider) {
    const apiKeyEnv = PROVIDER_DEFAULTS[provider].apiKeyEnv;
    super(
      `Missing ${PROVIDER_LABELS[provider]} credentials. Set ${apiKeyEnv} in your environment, e.g.:\n` +
        `  export ${apiKeyEnv}=...\n` +
        "Or force the deterministic engine with: ONIX_PROPOSAL_ENGINE=stub"
    );
    this.name = "MissingLlmCredentialsError";
    Object.setPrototypeOf(this, MissingLlmCredentialsError.prototype);
  }
}

function createCompletionClient(provider: Provider, apiKey: string): CaptureCompletionClient {
  if (provider === "gemini") {
    return createGeminiCompletionClient({ apiKey });
  }

  return createOpenAiCompletionClient({ apiKey });
}

export function resolveModel(config: Pick<GlobalConfig, "model">, provider: Provider): string {
  const fromEnv = process.env.ONIX_MODEL?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }

  const fromConfig = config.model?.trim();
  if (fromConfig !== undefined && fromConfig.length > 0) {
    return fromConfig;
  }

  return PROVIDER_DEFAULTS[provider].model;
}

export async function resolveProposalEngine(): Promise<ProposalEngine> {
  if (process.env.ONIX_PROPOSAL_ENGINE === "stub") {
    return createStubProposalEngine();
  }

  const config = await readGlobalConfig();
  const provider = resolveProvider(config);

  const apiKey = process.env[PROVIDER_DEFAULTS[provider].apiKeyEnv]?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    throw new MissingLlmCredentialsError(provider);
  }

  if (provider === "gemini") {
    await showGeminiPrivacyNoticeOnce(config);
  }

  return createLiveProposalEngine({
    client: createCompletionClient(provider, apiKey),
    model: resolveModel(config, provider)
  });
}

async function showGeminiPrivacyNoticeOnce(config: GlobalConfig): Promise<void> {
  if (config.geminiPrivacyNoticeShown === true) {
    return;
  }

  console.warn(
    "Heads up: the Gemini free tier may use your inputs and outputs to improve Google's models.\n" +
      "Your whole capture is sent to Google, so do not capture secrets or other Sensitive Candidates while using it.\n" +
      "Use a paid tier or Vertex AI if you need privacy. This notice is shown once."
  );

  await updateGlobalConfig({ geminiPrivacyNoticeShown: true });
}
