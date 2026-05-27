import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCli } from "../src/cli.js";

describe("Session Closing without LLM credentials", () => {
  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalApiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ONIX_PROPOSAL_ENGINE;
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  });

  test("fails with a clear hint and leaves the session state untouched", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    const stderr: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "start"]);

      const sessionInboxFiles = await readdir(join(vault, "Onix", "Sessions"));
      const inboxPath = join(vault, "Onix", "Sessions", sessionInboxFiles[0] ?? "");
      await writeFile(inboxPath, `${await readFile(inboxPath, "utf8")}\nA durable learning worth keeping.\n`);
      const inboxBefore = await readFile(inboxPath, "utf8");

      await expect(
        createCli()
          .exitOverride()
          .configureOutput({ writeErr: (value) => stderr.push(value) })
          .parseAsync(["node", "onix", "--vault", vault, "close", "--no-review"])
      ).rejects.toThrow();

      expect(stderr.join("")).toContain("OPENAI_API_KEY");

      expect(await readFile(inboxPath, "utf8")).toBe(inboxBefore);
      const activeSession = await stat(join(vault, ".onix", "state", "active-session.json"));
      expect(activeSession.isFile()).toBe(true);
    } finally {
      consoleLog.mockRestore();
    }
  });
});
