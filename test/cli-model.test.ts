import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createCli } from "../src/cli.js";

type StoredConfig = {
  schemaVersion?: number;
  defaultVault?: string;
  model?: string;
};

async function readStoredConfig(): Promise<StoredConfig> {
  return JSON.parse(
    await readFile(join(process.env.XDG_CONFIG_HOME ?? "", "onix", "config.json"), "utf8")
  ) as StoredConfig;
}

describe("onix model", () => {
  let originalModelEnv: string | undefined;

  beforeEach(() => {
    originalModelEnv = process.env.ONIX_MODEL;
    delete process.env.ONIX_MODEL;
  });

  afterEach(() => {
    if (originalModelEnv === undefined) delete process.env.ONIX_MODEL;
    else process.env.ONIX_MODEL = originalModelEnv;
  });

  test("persists a model id under the user config directory", async () => {
    await createCli().exitOverride().parseAsync(["node", "onix", "model", "gpt-5.4"]);

    const stored = await readStoredConfig();
    expect(stored.model).toBe("gpt-5.4");
  });

  test("prints the resolved model and its source when called without arguments", async () => {
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "model", "gpt-5.4"]);
      stdout.length = 0;
      await createCli().exitOverride().parseAsync(["node", "onix", "model"]);
    } finally {
      consoleLog.mockRestore();
    }

    expect(stdout.join("\n")).toContain("Model: gpt-5.4 (from global config)");
  });

  test("reports the default model for the resolved provider when nothing is configured", async () => {
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "model"]);
    } finally {
      consoleLog.mockRestore();
    }

    expect(stdout.join("\n")).toContain("Model: gemini-3.5-flash (default for gemini)");
  });

  test("reports the env-sourced model when ONIX_MODEL is set", async () => {
    process.env.ONIX_MODEL = "gpt-5.5-preview";
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "model"]);
    } finally {
      consoleLog.mockRestore();
    }

    expect(stdout.join("\n")).toContain("Model: gpt-5.5-preview (from $ONIX_MODEL)");
  });

  test("--clear removes the stored model", async () => {
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "model", "gpt-5.4"]);
      stdout.length = 0;
      await createCli().exitOverride().parseAsync(["node", "onix", "model", "--clear"]);
    } finally {
      consoleLog.mockRestore();
    }

    const stored = await readStoredConfig();
    expect(stored.model).toBeUndefined();
    expect(stdout.join("\n")).toContain("Cleared model: gpt-5.4");
  });

  test("preserves the default vault when setting the model", async () => {
    await createCli().exitOverride().parseAsync(["node", "onix", "use", "/tmp"]);
    await createCli().exitOverride().parseAsync(["node", "onix", "model", "gpt-5.4"]);

    const stored = await readStoredConfig();
    expect(stored.defaultVault).toBe("/tmp");
    expect(stored.model).toBe("gpt-5.4");
  });
});
