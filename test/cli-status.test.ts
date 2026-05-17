import { describe, expect, test, vi } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCli } from "../src/cli.js";

describe("onix status", () => {
  test("reports a missing default vault when neither --vault nor a stored default is set", async () => {
    const stdout = await runStatus([]);

    expect(stdout).toContain("No default vault set");
    expect(stdout).toContain("onix use <path>");
    expect(stdout).not.toContain("Active Session");
  });

  test("shows resolved vault, no active session, no plans, and zero rules for a fresh vault", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-status-vault-"));

    const stdout = await runStatus(["--vault", vault]);

    expect(stdout).toContain(`Vault: ${vault}`);
    expect(stdout).toContain("Active Session: none");
    expect(stdout).toContain("Patch Plans: none");
    expect(stdout).toContain("Classification Rules: 0 approved");
  });

  test("shows the Active Session id, inbox path, and start time when a session is open", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-status-vault-"));
    await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "start"]);

    const stdout = await runStatus(["--vault", vault]);

    expect(stdout).toContain("Active Session");
    expect(stdout).toMatch(/ID: [0-9a-f-]+/i);
    expect(stdout).toMatch(/Inbox: Onix\/Sessions\/session-inbox-\d{8}-\d{6}\.md/);
    expect(stdout).toMatch(/Started: \d{4}-\d{2}-\d{2}T/);
  });

  test("lists each Patch Plan with decision progress and pending Rule Candidates", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-status-vault-"));
    await mkdir(join(vault, ".onix", "plans"), { recursive: true });
    await mkdir(join(vault, ".onix", "approvals"), { recursive: true });

    await writeFile(
      join(vault, ".onix", "plans", "test-plan.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          planId: "test-plan",
          summary: "Test plan summary.",
          items: [
            {
              id: "item-1",
              kind: "consolidated-knowledge",
              destinationPath: "Knowledge/X.md",
              learningCapture: "Capture A.",
              relatedTopics: [],
              sourceTrace: "Onix/Sessions/session.md line 1",
              proposedContent: "Capture A."
            },
            {
              id: "item-2",
              kind: "consolidated-knowledge",
              destinationPath: "Knowledge/X.md",
              learningCapture: "Capture B.",
              relatedTopics: [],
              sourceTrace: "Onix/Sessions/session.md line 2",
              proposedContent: "Capture B."
            },
            {
              id: "item-3",
              kind: "consolidated-knowledge",
              destinationPath: "Knowledge/X.md",
              learningCapture: "Capture C.",
              relatedTopics: [],
              sourceTrace: "Onix/Sessions/session.md line 3",
              proposedContent: "Capture C."
            }
          ]
        },
        null,
        2
      )
    );

    await writeFile(
      join(vault, ".onix", "approvals", "test-plan.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          planId: "test-plan",
          decisions: [
            { itemId: "item-1", action: "approve", destinationPath: "Knowledge/X.md", content: "Capture A." }
          ],
          ruleCandidates: [
            { id: "rule-candidate-1", fromItemId: "item-1", pattern: "Capture A.", destinationPath: "Knowledge/X.md" }
          ]
        },
        null,
        2
      )
    );

    const stdout = await runStatus(["--vault", vault]);

    expect(stdout).toContain("Patch Plans");
    expect(stdout).toContain("test-plan");
    expect(stdout).toContain("1 of 3 decided");
    expect(stdout).toContain("2 pending");
    expect(stdout).toContain("rule-candidate-1");
  });

  test("reports the count of approved Classification Rules", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-status-vault-"));
    await mkdir(join(vault, ".onix"), { recursive: true });
    await writeFile(
      join(vault, ".onix", "classification-rules.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          rules: [
            { id: "rule-1", pattern: "p", destinationPath: "Knowledge/P.md", approvedAt: "2026-01-01T00:00:00Z" },
            { id: "rule-2", pattern: "q", destinationPath: "Knowledge/Q.md", approvedAt: "2026-01-02T00:00:00Z" }
          ]
        },
        null,
        2
      )
    );

    const stdout = await runStatus(["--vault", vault]);

    expect(stdout).toContain("Classification Rules: 2 approved");
  });

  test("shows both the default vault and the resolved vault when they differ", async () => {
    const defaultVault = await mkdtemp(join(tmpdir(), "onix-status-default-"));
    const flagVault = await mkdtemp(join(tmpdir(), "onix-status-flag-"));

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await createCli().exitOverride().parseAsync(["node", "onix", "use", defaultVault]);
    } finally {
      consoleLog.mockRestore();
    }

    const stdout = await runStatus(["--vault", flagVault]);

    expect(stdout).toContain(`Default vault: ${defaultVault}`);
    expect(stdout).toContain(`Vault: ${flagVault}`);
  });
});

async function runStatus(extraArgs: string[]): Promise<string> {
  const stdout: string[] = [];
  const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

  try {
    await createCli().exitOverride().parseAsync(["node", "onix", ...extraArgs, "status"]);
  } finally {
    consoleLog.mockRestore();
  }

  return stdout.join("\n");
}
