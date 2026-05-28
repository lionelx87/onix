import { describe, expect, test, vi } from "vitest";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCli } from "../src/cli.js";

describe("Write Boundary covers the whole vault", () => {
  test("applies an approved destination under a top-level topic folder", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "start"]);

      const sessionInboxFiles = await readdir(join(vault, "Onix", "Sessions"));
      const inboxPath = join(vault, "Onix", "Sessions", sessionInboxFiles[0] ?? "");
      await writeFile(
        inboxPath,
        `${await readFile(inboxPath, "utf8")}\nCLI scaffolds should keep provider calls behind a contract.\n`
      );

      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "close", "--no-review"]);

      await createCli()
        .exitOverride()
        .parseAsync([
          "node",
          "onix",
          "--vault",
          vault,
          "review",
          "stubbed-plan",
          "--move",
          "item-1",
          "--destination",
          "Git/GitHub CLI.md"
        ]);

      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "apply", "stubbed-plan"]);
    } finally {
      consoleLog.mockRestore();
    }

    const written = await readFile(join(vault, "Git", "GitHub CLI.md"), "utf8");
    expect(written).toContain("CLI scaffolds should keep provider calls behind a contract.");
  });

  test("still rejects a destination that escapes the vault", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "start"]);

      const sessionInboxFiles = await readdir(join(vault, "Onix", "Sessions"));
      const inboxPath = join(vault, "Onix", "Sessions", sessionInboxFiles[0] ?? "");
      await writeFile(inboxPath, `${await readFile(inboxPath, "utf8")}\nDurable knowledge worth keeping.\n`);

      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "close", "--no-review"]);
      await createCli()
        .exitOverride()
        .parseAsync(["node", "onix", "--vault", vault, "review", "stubbed-plan", "--move", "item-1", "--destination", "../Outside.md"]);

      await expect(
        createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "apply", "stubbed-plan"])
      ).rejects.toThrow("Destination is outside the Write Boundary");

      const activeSession = await stat(join(vault, ".onix", "state", "active-session.json"));
      expect(activeSession.isFile()).toBe(true);
    } finally {
      consoleLog.mockRestore();
    }
  });
});
