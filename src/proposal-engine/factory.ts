import { readGlobalConfig, type GlobalConfig } from "../global-config.js";
import type { ProposalEngine } from "./contract.js";
import { createLiveProposalEngine } from "./live.js";
import { createOpenAiCompletionClient } from "./openai-client.js";
import { createStubProposalEngine } from "./stub.js";

export const DEFAULT_MODEL = "gpt-5.5";

export class MissingLlmCredentialsError extends Error {
  constructor() {
    super(
      "Missing OpenAI credentials. Set OPENAI_API_KEY in your environment, e.g.:\n" +
        "  export OPENAI_API_KEY=sk-...\n" +
        "Or force the deterministic engine with: ONIX_PROPOSAL_ENGINE=stub"
    );
    this.name = "MissingLlmCredentialsError";
    Object.setPrototypeOf(this, MissingLlmCredentialsError.prototype);
  }
}

export function resolveModel(config: Pick<GlobalConfig, "model">): string {
  const fromEnv = process.env.ONIX_MODEL?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }

  const fromConfig = config.model?.trim();
  if (fromConfig !== undefined && fromConfig.length > 0) {
    return fromConfig;
  }

  return DEFAULT_MODEL;
}

export async function resolveProposalEngine(): Promise<ProposalEngine> {
  if (process.env.ONIX_PROPOSAL_ENGINE === "stub") {
    return createStubProposalEngine();
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    throw new MissingLlmCredentialsError();
  }

  const config = await readGlobalConfig();
  return createLiveProposalEngine({
    client: createOpenAiCompletionClient({ apiKey }),
    model: resolveModel(config)
  });
}
