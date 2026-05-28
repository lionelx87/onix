import { describe, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureOperationalStoreGitignore } from "../src/operational-store/gitignore.js";
import { startSession } from "../src/session-start.js";

describe("Operational Store .gitignore scaffolding", () => {
  test("creates .onix/.gitignore with the transient entries on a fresh vault", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-gitignore-fresh-"));

    await startSession(vault, new Date("2026-05-27T10:00:00.000Z"));

    const gitignore = await readFile(join(vault, ".onix", ".gitignore"), "utf8");
    const lines = gitignore.split("\n").map((line) => line.trim());

    expect(lines).toContain("state/");
    expect(lines).toContain("indexes/");
    expect(lines).toContain("plans/");
    expect(lines).toContain("approvals/");
    expect(lines).toContain("logs/");
    expect(lines).toContain("cache/");
  });

  test("leaves an existing user-edited .onix/.gitignore untouched", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-gitignore-custom-"));
    await mkdir(join(vault, ".onix"), { recursive: true });
    const customGitignore = "# user-managed entries\nstate/\nmy-private-notes.md\n";
    await writeFile(join(vault, ".onix", ".gitignore"), customGitignore);

    await startSession(vault, new Date("2026-05-27T10:01:00.000Z"));

    await expect(readFile(join(vault, ".onix", ".gitignore"), "utf8")).resolves.toBe(customGitignore);
  });

  test("does not duplicate entries when the scaffold runs twice", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-gitignore-twice-"));

    await ensureOperationalStoreGitignore(vault);
    const firstContent = await readFile(join(vault, ".onix", ".gitignore"), "utf8");

    await ensureOperationalStoreGitignore(vault);
    const secondContent = await readFile(join(vault, ".onix", ".gitignore"), "utf8");

    expect(secondContent).toBe(firstContent);
    for (const entry of ["state/", "indexes/", "plans/", "approvals/", "logs/", "cache/"]) {
      expect(secondContent.split("\n").filter((line) => line.trim() === entry)).toHaveLength(1);
    }
  });

  test("does not ignore Versioned Tool State files", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-gitignore-versioned-"));

    await ensureOperationalStoreGitignore(vault);

    const gitignore = await readFile(join(vault, ".onix", ".gitignore"), "utf8");

    expect(gitignore).not.toContain("config.json");
    expect(gitignore).not.toContain("classification-rules.json");
  });
});
