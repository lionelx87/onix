import { describe, expect, test, vi } from "vitest";
import { mkdtemp, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCli } from "../src/cli.js";

describe("CLI scaffold", () => {
  test("exposes the MVP command surfaces in help output", () => {
    const help = createCli().helpInformation();

    expect(help).toContain("onix");
    expect(help).toContain("start");
    expect(help).toContain("close");
    expect(help).toContain("review");
    expect(help).toContain("apply");
    expect(help).toContain("status");
  });
});

describe("Session Start", () => {
  test("requires an explicit vault path", async () => {
    const stderr: string[] = [];

    await expect(
      createCli()
        .exitOverride()
        .configureOutput({ writeErr: (value) => stderr.push(value) })
        .parseAsync(["node", "onix", "start"])
    ).rejects.toThrow("Missing vault path");

    expect(stderr.join("")).toContain("Missing vault path. Run: onix --vault <path> start");
  });

  test("starts an Ephemeral Session by creating a dated Session Inbox and recording it as active", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "start"]);
    } finally {
      consoleLog.mockRestore();
    }

    const sessionInboxFiles = await readdir(join(vault, "Onix", "Sessions"));

    expect(sessionInboxFiles).toHaveLength(1);
    expect(sessionInboxFiles[0]).toMatch(/^session-inbox-\d{8}-\d{6}\.md$/);

    const inboxPath = join(vault, "Onix", "Sessions", sessionInboxFiles[0] ?? "");
    const inboxContent = await readFile(inboxPath, "utf8");
    expect(inboxContent).toContain("onix_session_id:");
    expect(inboxContent).toContain("onix_started_at:");
    expect((await stat(inboxPath)).isFile()).toBe(true);

    const activeSession = JSON.parse(
      await readFile(join(vault, ".onix", "state", "active-session.json"), "utf8")
    ) as { inboxPath?: string; sessionId?: string };

    expect(activeSession.sessionId).toBeTruthy();
    expect(activeSession.inboxPath).toBe(`Onix/Sessions/${sessionInboxFiles[0]}`);
    expect(stdout.join("\n")).toContain("Started Ephemeral Session");
    expect(stdout.join("\n")).toContain(activeSession.inboxPath);
  });

  test("fails clearly without creating another inbox when an Active Session already exists", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    const stderr: string[] = [];

    await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "start"]);
    const initialSessionInboxFiles = await readdir(join(vault, "Onix", "Sessions"));

    await expect(
      createCli()
        .exitOverride()
        .configureOutput({ writeErr: (value) => stderr.push(value) })
        .parseAsync(["node", "onix", "--vault", vault, "start"])
    ).rejects.toThrow("An Ephemeral Session is already active");

    await expect(readdir(join(vault, "Onix", "Sessions"))).resolves.toEqual(initialSessionInboxFiles);
    expect(stderr.join("")).toContain("An Ephemeral Session is already active");
    expect(stderr.join("")).toContain(initialSessionInboxFiles[0]);
  });
});

describe("Session Closing", () => {
  test("closes an Active Session by generating a structured Patch Plan and grouped Review Rendering", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "start"]);

      const sessionInboxFiles = await readdir(join(vault, "Onix", "Sessions"));
      const inboxPath = join(vault, "Onix", "Sessions", sessionInboxFiles[0] ?? "");
      await writeFile(inboxPath, `${await readFile(inboxPath, "utf8")}\nCLI scaffolds should keep provider calls behind a contract.\n`);

      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "close"]);
    } finally {
      consoleLog.mockRestore();
    }

    const planFiles = await readdir(join(vault, ".onix", "plans"));
    expect(planFiles).toEqual(["stubbed-plan.json"]);

    const plan = JSON.parse(await readFile(join(vault, ".onix", "plans", "stubbed-plan.json"), "utf8")) as {
      items?: Array<{ destinationPath?: string; proposedContent?: string }>;
    };

    expect(plan.items?.[0]?.destinationPath).toBe("Knowledge/Session Inbox.md");
    expect(plan.items?.[0]?.proposedContent).toBe("CLI scaffolds should keep provider calls behind a contract.");

    const output = stdout.join("\n");
    expect(output).toContain("Generated Patch Plan: stubbed-plan");
    expect(output).toContain("## Knowledge/Session Inbox.md");
    expect(output).toContain("- CLI scaffolds should keep provider calls behind a contract.");
  });

  test("closing an empty Session Inbox produces a valid no-op Patch Plan", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "start"]);
      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "close"]);
    } finally {
      consoleLog.mockRestore();
    }

    const plan = JSON.parse(await readFile(join(vault, ".onix", "plans", "stubbed-plan.json"), "utf8")) as {
      items?: unknown[];
      summary?: string;
    };

    expect(plan.items).toEqual([]);
    expect(plan.summary).toBe("No Freeform Captures found in the Session Inbox.");

    const output = stdout.join("\n");
    expect(output).toContain("No proposed durable knowledge changes.");
    expect(output).not.toContain("## Knowledge/Session Inbox.md");
  });

  test("closes a session after the visible Session Inbox is renamed", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "start"]);

      const sessionInboxFiles = await readdir(join(vault, "Onix", "Sessions"));
      const originalInboxPath = join(vault, "Onix", "Sessions", sessionInboxFiles[0] ?? "");
      const renamedInboxPath = join(vault, "Onix", "Sessions", "renamed-session-inbox.md");

      await writeFile(originalInboxPath, `${await readFile(originalInboxPath, "utf8")}\nRenamed inboxes should still close.\n`);
      await rename(originalInboxPath, renamedInboxPath);

      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "close"]);
    } finally {
      consoleLog.mockRestore();
    }

    const plan = JSON.parse(await readFile(join(vault, ".onix", "plans", "stubbed-plan.json"), "utf8")) as {
      items?: Array<{ proposedContent?: string; sourceTrace?: string }>;
    };

    expect(plan.items?.[0]?.proposedContent).toBe("Renamed inboxes should still close.");
    expect(plan.items?.[0]?.sourceTrace).toBe("Onix/Sessions/renamed-session-inbox.md line 1");
    expect(stdout.join("\n")).toContain("## Knowledge/Session Inbox.md");
  });
});
