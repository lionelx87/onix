import { describe, expect, test, vi } from "vitest";
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
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
    await expect(readFile(inboxPath, "utf8")).resolves.toBe("");
    expect((await stat(inboxPath)).isFile()).toBe(true);

    const activeSession = JSON.parse(
      await readFile(join(vault, ".onix", "state", "active-session.json"), "utf8")
    ) as { inboxPath?: string };

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
