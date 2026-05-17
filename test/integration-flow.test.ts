import { describe, expect, test, vi } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { Writable } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCli } from "../src/cli.js";

describe("Integration: full Learning Capture flow", () => {
  test("runs Session Start, Session Closing, review, apply, cleanup, and Versioning Review against a fixture vault", async () => {
    const vault = await buildFixtureVault();
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "start"]);

      const sessionInboxFiles = await readdir(join(vault, "Onix", "Sessions"));
      expect(sessionInboxFiles).toHaveLength(1);
      const inboxPath = join(vault, "Onix", "Sessions", sessionInboxFiles[0] ?? "");

      await writeFile(
        inboxPath,
        `${await readFile(inboxPath, "utf8")}\n${freeformCaptures().join("\n")}\n`
      );

      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "close", "--no-review"]);

      const plan = JSON.parse(
        await readFile(join(vault, ".onix", "plans", "stubbed-plan.json"), "utf8")
      ) as {
        items: Array<{ id: string; kind: string; destinationPath?: string }>;
      };

      expect(plan.items.map((item) => ({ id: item.id, kind: item.kind, destinationPath: item.destinationPath }))).toEqual([
        { id: "item-1", kind: "consolidated-knowledge", destinationPath: "Knowledge/CLI.md" },
        { id: "item-2", kind: "consolidated-knowledge", destinationPath: "Knowledge/CLI.md" },
        { id: "item-3", kind: "no-consolidation-candidate", destinationPath: undefined },
        { id: "item-4", kind: "research-candidate", destinationPath: "Onix/Research Inbox.md" },
        { id: "item-5", kind: "reference-item", destinationPath: "Reference Library/CLI.md" }
      ]);

      const vaultIndex = JSON.parse(
        await readFile(join(vault, ".onix", "indexes", "vault-index.json"), "utf8")
      ) as { notes: Array<{ path: string }> };
      expect(vaultIndex.notes.map((note) => note.path)).toEqual([
        "Knowledge/CLI.md",
        "Knowledge/Testing.md",
        "Onix/Research Inbox.md",
        "Reference Library/CLI.md"
      ]);

      const closeOutput = stdout.join("\n");
      expect(closeOutput).toContain("## Knowledge/CLI.md");
      expect(closeOutput).toContain("ID: item-1");
      expect(closeOutput).toContain("ID: item-2");
      expect(closeOutput).toContain("## Onix/Research Inbox.md");
      expect(closeOutput).toContain("## Reference Library/CLI.md");
      expect(closeOutput).toContain("## No Consolidation");

      await createCli()
        .exitOverride()
        .parseAsync(["node", "onix", "--vault", vault, "review", "stubbed-plan", "--approve", "item-1"]);
      await createCli()
        .exitOverride()
        .parseAsync([
          "node",
          "onix",
          "--vault",
          vault,
          "review",
          "stubbed-plan",
          "--edit",
          "item-2",
          "--content",
          "CLI flag parsing stays explicit so review actions remain auditable."
        ]);
      await createCli()
        .exitOverride()
        .parseAsync(["node", "onix", "--vault", vault, "review", "stubbed-plan", "--discard", "item-3"]);
      await createCli()
        .exitOverride()
        .parseAsync(["node", "onix", "--vault", vault, "review", "stubbed-plan", "--approve", "item-4"]);
      await createCli()
        .exitOverride()
        .parseAsync(["node", "onix", "--vault", vault, "review", "stubbed-plan", "--approve", "item-5"]);

      await expect(readFile(inboxPath, "utf8")).resolves.toContain("onix_session_id");

      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "apply", "stubbed-plan"]);
    } finally {
      consoleLog.mockRestore();
    }

    await expect(readFile(join(vault, "Knowledge", "CLI.md"), "utf8")).resolves.toBe(
      [
        "# CLI",
        "",
        "Stable CLI knowledge for Onix workflows.",
        "",
        "CLI commands stay testable when reviewed deterministically.",
        "",
        "CLI flag parsing stays explicit so review actions remain auditable.",
        ""
      ].join("\n")
    );

    await expect(readFile(join(vault, "Onix", "Research Inbox.md"), "utf8")).resolves.toBe(
      [
        "# Research Inbox",
        "",
        "Pending research links live here until they produce learning.",
        "",
        "## CLI",
        "",
        "- Research: https://example.com/cli-patterns for review automation tooling.",
        ""
      ].join("\n")
    );

    await expect(readFile(join(vault, "Reference Library", "CLI.md"), "utf8")).resolves.toBe(
      [
        "# CLI References",
        "",
        "Useful CLI sources kept after producing learning.",
        "",
        "## CLI",
        "",
        "- Reference: https://example.com/cli-handbook clarifies command UX.",
        "",
        "Informed learning: [[CLI]]",
        ""
      ].join("\n")
    );

    await expect(readdir(join(vault, "Onix", "Sessions"))).resolves.toEqual([]);
    await expect(readFile(join(vault, ".onix", "state", "active-session.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });

    const versioningReview = stdout.join("\n");
    expect(versioningReview).toContain("Versioning Review");
    expect(versioningReview).toContain("Knowledge/CLI.md");
    expect(versioningReview).toContain("Onix/Research Inbox.md");
    expect(versioningReview).toContain("Reference Library/CLI.md");
  });

  test("keeps the Session Inbox when apply aborts before write verification", async () => {
    const vault = await buildFixtureVault();
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "start"]);

      const sessionInboxFiles = await readdir(join(vault, "Onix", "Sessions"));
      const inboxPath = join(vault, "Onix", "Sessions", sessionInboxFiles[0] ?? "");
      await writeFile(
        inboxPath,
        `${await readFile(inboxPath, "utf8")}\nCLI commands stay testable when reviewed deterministically.\n`
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
          "../Outside.md"
        ]);

      await expect(
        createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "apply", "stubbed-plan"])
      ).rejects.toThrow("Destination is outside the Write Boundary");

      await expect(readFile(inboxPath, "utf8")).resolves.toContain("onix_session_id");
      await expect(readFile(join(vault, ".onix", "state", "active-session.json"), "utf8")).resolves.toContain(
        "sessionId"
      );
      await expect(readFile(join(vault, "Knowledge", "CLI.md"), "utf8")).resolves.toBe(
        "# CLI\n\nStable CLI knowledge for Onix workflows.\n"
      );
    } finally {
      consoleLog.mockRestore();
    }
  });
});

function freeformCaptures(): string[] {
  return [
    "CLI commands stay testable when reviewed deterministically.",
    "CLI flags must remain explicit in tests.",
    "TODO follow up with the docs team about review automation.",
    "Research: https://example.com/cli-patterns for review automation tooling.",
    "Reference: https://example.com/cli-handbook clarifies command UX."
  ];
}

async function buildFixtureVault(): Promise<string> {
  const vault = await mkdtemp(join(tmpdir(), "onix-integration-vault-"));

  await mkdir(join(vault, "Knowledge"), { recursive: true });
  await mkdir(join(vault, "Onix"), { recursive: true });
  await mkdir(join(vault, "Reference Library"), { recursive: true });

  await writeFile(
    join(vault, "Knowledge", "CLI.md"),
    "# CLI\n\nStable CLI knowledge for Onix workflows.\n"
  );
  await writeFile(
    join(vault, "Knowledge", "Testing.md"),
    "# Testing\n\nLocal tests rely on deterministic stubs.\n"
  );
  await writeFile(
    join(vault, "Onix", "Research Inbox.md"),
    "# Research Inbox\n\nPending research links live here until they produce learning.\n"
  );
  await writeFile(
    join(vault, "Reference Library", "CLI.md"),
    "# CLI References\n\nUseful CLI sources kept after producing learning.\n"
  );

  return vault;
}
