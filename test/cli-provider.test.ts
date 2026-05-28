import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createCli } from "../src/cli.js";

type StoredConfig = {
  schemaVersion?: number;
  defaultVault?: string;
  provider?: string;
};

async function readStoredConfig(): Promise<StoredConfig> {
  return JSON.parse(
    await readFile(join(process.env.XDG_CONFIG_HOME ?? "", "onix", "config.json"), "utf8")
  ) as StoredConfig;
}

describe("onix provider", () => {
  let originalProviderEnv: string | undefined;

  beforeEach(() => {
    originalProviderEnv = process.env.ONIX_PROVIDER;
    delete process.env.ONIX_PROVIDER;
  });

  afterEach(() => {
    if (originalProviderEnv === undefined) delete process.env.ONIX_PROVIDER;
    else process.env.ONIX_PROVIDER = originalProviderEnv;
  });

  test("persists a provider under the user config directory", async () => {
    await createCli().exitOverride().parseAsync(["node", "onix", "provider", "openai"]);

    const stored = await readStoredConfig();
    expect(stored.provider).toBe("openai");
  });

  test("rejects an unknown provider name", async () => {
    const stderr: string[] = [];

    await expect(
      createCli()
        .exitOverride()
        .configureOutput({ writeErr: (value) => stderr.push(value) })
        .parseAsync(["node", "onix", "provider", "anthropic"])
    ).rejects.toThrow();

    expect(stderr.join("")).toContain("gemini");
    expect(stderr.join("")).toContain("openai");
  });

  test("reports the resolved provider and its source when called without arguments", async () => {
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "provider", "openai"]);
      stdout.length = 0;
      await createCli().exitOverride().parseAsync(["node", "onix", "provider"]);
    } finally {
      consoleLog.mockRestore();
    }

    expect(stdout.join("\n")).toContain("Provider: openai (from global config)");
  });

  test("reports the default provider when nothing is configured", async () => {
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "provider"]);
    } finally {
      consoleLog.mockRestore();
    }

    expect(stdout.join("\n")).toContain("Provider: gemini (default)");
  });

  test("reports the env-sourced provider when ONIX_PROVIDER is set", async () => {
    process.env.ONIX_PROVIDER = "openai";
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "provider"]);
    } finally {
      consoleLog.mockRestore();
    }

    expect(stdout.join("\n")).toContain("Provider: openai (from $ONIX_PROVIDER)");
  });

  test("--clear removes the stored provider", async () => {
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "provider", "openai"]);
      stdout.length = 0;
      await createCli().exitOverride().parseAsync(["node", "onix", "provider", "--clear"]);
    } finally {
      consoleLog.mockRestore();
    }

    const stored = await readStoredConfig();
    expect(stored.provider).toBeUndefined();
    expect(stdout.join("\n")).toContain("Cleared provider: openai");
  });
});
