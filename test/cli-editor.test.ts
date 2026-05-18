import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createCli } from "../src/cli.js";

type StoredConfig = {
  schemaVersion?: number;
  defaultVault?: string;
  editor?: string;
  editorPromptDeclined?: boolean;
};

async function readStoredConfig(): Promise<StoredConfig> {
  return JSON.parse(
    await readFile(join(process.env.XDG_CONFIG_HOME ?? "", "onix", "config.json"), "utf8")
  ) as StoredConfig;
}

describe("onix editor", () => {
  let originalVisual: string | undefined;
  let originalEditor: string | undefined;

  beforeEach(() => {
    originalVisual = process.env.VISUAL;
    originalEditor = process.env.EDITOR;
    delete process.env.VISUAL;
    delete process.env.EDITOR;
  });

  afterEach(() => {
    if (originalVisual === undefined) delete process.env.VISUAL;
    else process.env.VISUAL = originalVisual;
    if (originalEditor === undefined) delete process.env.EDITOR;
    else process.env.EDITOR = originalEditor;
  });

  test("persists an editor command under the user config directory", async () => {
    await createCli().exitOverride().parseAsync(["node", "onix", "editor", "vim"]);

    const stored = await readStoredConfig();
    expect(stored).toEqual({ schemaVersion: 1, editor: "vim" });
  });

  test("preserves the default vault when setting the editor", async () => {
    const vault = "/tmp"; // any existing absolute directory works for the read step

    await createCli().exitOverride().parseAsync(["node", "onix", "use", vault]);
    await createCli().exitOverride().parseAsync(["node", "onix", "editor", "code -w"]);

    const stored = await readStoredConfig();
    expect(stored.defaultVault).toBe(vault);
    expect(stored.editor).toBe("code -w");
  });

  test("prints the current editor when called without arguments", async () => {
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "editor", "nano"]);
      stdout.length = 0;
      await createCli().exitOverride().parseAsync(["node", "onix", "editor"]);
    } finally {
      consoleLog.mockRestore();
    }

    expect(stdout.join("\n")).toContain("Editor: nano (from global config)");
  });

  test("reports env-sourced editor when VISUAL is set", async () => {
    process.env.VISUAL = "emacs";
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "editor"]);
    } finally {
      consoleLog.mockRestore();
    }

    expect(stdout.join("\n")).toContain("Editor: emacs (from $VISUAL)");
  });

  test("prints a helpful message when nothing is configured", async () => {
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "editor"]);
    } finally {
      consoleLog.mockRestore();
    }

    expect(stdout.join("\n")).toContain("No editor configured");
    expect(stdout.join("\n")).toContain("onix editor <command>");
  });

  test("--clear removes the stored editor and re-enables the first-run prompt", async () => {
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "editor", "vim"]);
      stdout.length = 0;
      await createCli().exitOverride().parseAsync(["node", "onix", "editor", "--clear"]);
    } finally {
      consoleLog.mockRestore();
    }

    const stored = await readStoredConfig();
    expect(stored.editor).toBeUndefined();
    expect(stored.editorPromptDeclined).toBeUndefined();
    expect(stdout.join("\n")).toContain("Cleared editor: vim");
  });

  test("--clear without a stored editor reports nothing to clear", async () => {
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "editor", "--clear"]);
    } finally {
      consoleLog.mockRestore();
    }

    expect(stdout.join("\n")).toContain("No editor preference to clear");
  });

  test("setting an editor clears a previously declined first-run prompt", async () => {
    // Simulate a prior decline by writing the file directly through updateGlobalConfig.
    const { updateGlobalConfig } = await import("../src/global-config.js");
    await updateGlobalConfig({ editorPromptDeclined: true });

    await createCli().exitOverride().parseAsync(["node", "onix", "editor", "nano"]);

    const stored = await readStoredConfig();
    expect(stored.editor).toBe("nano");
    expect(stored.editorPromptDeclined).toBeUndefined();
  });

  test("rejects an empty editor command", async () => {
    const stderr: string[] = [];

    await expect(
      createCli()
        .exitOverride()
        .configureOutput({ writeErr: (value) => stderr.push(value) })
        .parseAsync(["node", "onix", "editor", "   "])
    ).rejects.toThrow();

    expect(stderr.join("")).toContain("Editor command cannot be empty");
  });
});
