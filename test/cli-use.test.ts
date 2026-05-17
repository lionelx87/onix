import { describe, expect, test, vi } from "vitest";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { createCli } from "../src/cli.js";

describe("onix use", () => {
  test("persists the default vault path under the user config directory", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-default-vault-"));

    await createCli().exitOverride().parseAsync(["node", "onix", "use", vault]);

    const stored = JSON.parse(
      await readFile(join(process.env.XDG_CONFIG_HOME ?? "", "onix", "config.json"), "utf8")
    ) as { schemaVersion?: number; defaultVault?: string };

    expect(stored).toEqual({ schemaVersion: 1, defaultVault: vault });
  });

  test("normalizes a relative path to an absolute path before persisting", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-default-vault-"));
    const relativeVault = relative(process.cwd(), vault);

    await createCli().exitOverride().parseAsync(["node", "onix", "use", relativeVault]);

    const stored = JSON.parse(
      await readFile(join(process.env.XDG_CONFIG_HOME ?? "", "onix", "config.json"), "utf8")
    ) as { defaultVault?: string };

    expect(stored.defaultVault).toBe(vault);
  });

  test("rejects a vault path that does not exist", async () => {
    const stderr: string[] = [];

    await expect(
      createCli()
        .exitOverride()
        .configureOutput({ writeErr: (value) => stderr.push(value) })
        .parseAsync(["node", "onix", "use", "/no/such/vault"])
    ).rejects.toThrow();

    expect(stderr.join("")).toContain("Vault path does not exist");
  });

  test("prints the current default vault when called without arguments", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-default-vault-"));
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "use", vault]);
      stdout.length = 0;
      await createCli().exitOverride().parseAsync(["node", "onix", "use"]);
    } finally {
      consoleLog.mockRestore();
    }

    expect(stdout.join("\n")).toContain(`Default vault: ${vault}`);
  });

  test("prints a helpful message when no default is set", async () => {
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "use"]);
    } finally {
      consoleLog.mockRestore();
    }

    expect(stdout.join("\n")).toContain("No default vault set");
    expect(stdout.join("\n")).toContain("onix use <path>");
  });

  test("clears the default vault with --clear", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-default-vault-"));
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "use", vault]);
      await createCli().exitOverride().parseAsync(["node", "onix", "use", "--clear"]);
    } finally {
      consoleLog.mockRestore();
    }

    const stored = JSON.parse(
      await readFile(join(process.env.XDG_CONFIG_HOME ?? "", "onix", "config.json"), "utf8")
    ) as { defaultVault?: string };

    expect(stored.defaultVault).toBeUndefined();
    expect(stdout.join("\n")).toContain(`Cleared default vault: ${vault}`);
  });

  test("clearing without a stored default reports nothing to clear", async () => {
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "use", "--clear"]);
    } finally {
      consoleLog.mockRestore();
    }

    expect(stdout.join("\n")).toContain("No default vault to clear");
  });
});

describe("default vault fallback", () => {
  test("falls back to the stored default vault when --vault is omitted", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-fallback-vault-"));
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "use", vault]);
      await createCli().exitOverride().parseAsync(["node", "onix", "start"]);
    } finally {
      consoleLog.mockRestore();
    }

    const sessionFiles = await readdir(join(vault, "Onix", "Sessions"));
    expect(sessionFiles).toHaveLength(1);
  });

  test("--vault flag overrides the stored default vault", async () => {
    const defaultVault = await mkdtemp(join(tmpdir(), "onix-default-vault-"));
    const flagVault = await mkdtemp(join(tmpdir(), "onix-flag-vault-"));
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "use", defaultVault]);
      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", flagVault, "start"]);
    } finally {
      consoleLog.mockRestore();
    }

    await expect(readdir(join(defaultVault, "Onix", "Sessions")).catch(() => [])).resolves.toEqual([]);
    expect(await readdir(join(flagVault, "Onix", "Sessions"))).toHaveLength(1);
  });

  test("still errors when no --vault and no default vault is set", async () => {
    const stderr: string[] = [];

    await expect(
      createCli()
        .exitOverride()
        .configureOutput({ writeErr: (value) => stderr.push(value) })
        .parseAsync(["node", "onix", "start"])
    ).rejects.toThrow("Missing vault path");

    expect(stderr.join("")).toContain("onix use <path>");
  });
});
