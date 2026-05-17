import { describe, expect, test, vi } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { PassThrough, Writable } from "node:stream";
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

      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "close", "--no-review"]);
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
      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "close", "--no-review"]);
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

      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "close", "--no-review"]);
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

describe("Integrated Review", () => {
  test("renders a persisted Patch Plan grouped by destination note with source traces", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await writeReviewPlan(vault);

      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "review", "review-plan", "--render"]);
    } finally {
      consoleLog.mockRestore();
    }

    const output = stdout.join("\n");
    expect(output).toContain("# Review Rendering");
    expect(output).toContain("## Knowledge/CLI.md");
    expect(output).toContain("ID: item-1");
    expect(output).toContain("Source: Onix/Sessions/session.md line 1");
    expect(output).toContain("## Onix/Research Inbox.md");
    expect(output).toContain("ID: item-2");
    expect(output).toContain("Source: Onix/Sessions/session.md line 2");
  });

  test("does not create Approval State when only rendering Review Markdown", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await writeReviewPlan(vault);

      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "review", "review-plan", "--render"]);
    } finally {
      consoleLog.mockRestore();
    }

    await expect(readFile(join(vault, ".onix", "approvals", "review-plan.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  test("records approve as structured Approval State without parsing edited Markdown", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await writeReviewPlan(vault);

      await createCli()
        .exitOverride()
        .parseAsync(["node", "onix", "--vault", vault, "review", "review-plan", "--approve", "item-1"]);
    } finally {
      consoleLog.mockRestore();
    }

    const approvalState = JSON.parse(
      await readFile(join(vault, ".onix", "approvals", "review-plan.json"), "utf8")
    ) as { decisions?: Array<{ itemId?: string; action?: string; content?: string; destinationPath?: string }> };

    expect(approvalState).toMatchObject({
      schemaVersion: 1,
      planId: "review-plan",
      decisions: [
        {
          itemId: "item-1",
          action: "approve",
          destinationPath: "Knowledge/CLI.md",
          content: "CLI decisions should stay testable."
        }
      ]
    });
    expect(stdout.join("\n")).toContain("Recorded approve for item-1");
  });

  test("records edit as structured Approval State content", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));

    await writeReviewPlan(vault);
    await createCli()
      .exitOverride()
      .parseAsync([
        "node",
        "onix",
        "--vault",
        vault,
        "review",
        "review-plan",
        "--edit",
        "item-1",
        "--content",
        "CLI decisions stay testable when review actions are explicit."
      ]);

    const approvalState = await readApprovalState(vault);
    expect(approvalState.decisions).toEqual([
      {
        itemId: "item-1",
        action: "edit",
        destinationPath: "Knowledge/CLI.md",
        content: "CLI decisions stay testable when review actions are explicit."
      }
    ]);
  });

  test("records move as structured Approval State destination", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));

    await writeReviewPlan(vault);
    await createCli()
      .exitOverride()
      .parseAsync([
        "node",
        "onix",
        "--vault",
        vault,
        "review",
        "review-plan",
        "--move",
        "item-1",
        "--destination",
        "Knowledge/Review Workflows.md"
      ]);

    const approvalState = await readApprovalState(vault);
    expect(approvalState.decisions).toEqual([
      {
        itemId: "item-1",
        action: "move",
        destinationPath: "Knowledge/Review Workflows.md",
        content: "CLI decisions should stay testable."
      }
    ]);
  });

  test("records split as structured Approval State parts", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));

    await writeReviewPlan(vault);
    await createCli()
      .exitOverride()
      .parseAsync([
        "node",
        "onix",
        "--vault",
        vault,
        "review",
        "review-plan",
        "--split",
        "item-1",
        "--part",
        "CLI decisions should stay testable.",
        "--part",
        "Review actions should be explicit."
      ]);

    const approvalState = await readApprovalState(vault);
    expect(approvalState.decisions).toEqual([
      {
        itemId: "item-1",
        action: "split",
        parts: [
          {
            destinationPath: "Knowledge/CLI.md",
            content: "CLI decisions should stay testable."
          },
          {
            destinationPath: "Knowledge/CLI.md",
            content: "Review actions should be explicit."
          }
        ]
      }
    ]);
  });

  test("records discard as structured Approval State", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));

    await writeReviewPlan(vault);
    await createCli()
      .exitOverride()
      .parseAsync(["node", "onix", "--vault", vault, "review", "review-plan", "--discard", "item-1"]);

    const approvalState = await readApprovalState(vault);
    expect(approvalState.decisions).toEqual([
      {
        itemId: "item-1",
        action: "discard"
      }
    ]);
  });

  test("runs an interactive review from close and records Review Actions without low-level flags", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    const output = createWritableCapture();

    await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "start"]);

    const sessionInboxFiles = await readdir(join(vault, "Onix", "Sessions"));
    const inboxPath = join(vault, "Onix", "Sessions", sessionInboxFiles[0] ?? "");
    await writeFile(
      inboxPath,
      `${await readFile(inboxPath, "utf8")}\nApprove this durable learning.\nEdit this durable learning.\nMove this durable learning.\nSplit this durable learning.\nDiscard this reminder.\n`
    );

    await createCli({
      input: createReadableInput([
        "a",
        "e",
        "Edited durable learning.",
        "m",
        "Knowledge/Moved.md",
        "s",
        "First split learning.",
        "Second split learning.",
        "",
        "d"
      ]),
      output
    })
      .exitOverride()
      .parseAsync(["node", "onix", "--vault", vault, "close"]);

    const approvalState = JSON.parse(
      await readFile(join(vault, ".onix", "approvals", "stubbed-plan.json"), "utf8")
    ) as { decisions?: unknown[] };

    expect(approvalState.decisions).toEqual([
      {
        itemId: "item-1",
        action: "approve",
        destinationPath: "Knowledge/Session Inbox.md",
        content: "Approve this durable learning."
      },
      {
        itemId: "item-2",
        action: "edit",
        destinationPath: "Knowledge/Session Inbox.md",
        content: "Edited durable learning."
      },
      {
        itemId: "item-3",
        action: "move",
        destinationPath: "Knowledge/Moved.md",
        content: "Move this durable learning."
      },
      {
        itemId: "item-4",
        action: "split",
        parts: [
          {
            destinationPath: "Knowledge/Session Inbox.md",
            content: "First split learning."
          },
          {
            destinationPath: "Knowledge/Session Inbox.md",
            content: "Second split learning."
          }
        ]
      },
      {
        itemId: "item-5",
        action: "discard"
      }
    ]);
    expect(output.content()).toContain("Interactive Integrated Review");
    expect(output.content()).toContain("Destination: Knowledge/Session Inbox.md");
    expect(output.content()).toContain("Source: Onix/Sessions/");
    expect(output.content()).toContain("Choose action");
  });

  test("can skip an item and resume the interactive review later", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));

    await writeReviewPlan(vault);

    await createCli({ input: createReadableInput(["k", "a"]), output: createWritableCapture() })
      .exitOverride()
      .parseAsync(["node", "onix", "--vault", vault, "review", "review-plan"]);

    expect((await readApprovalState(vault)).decisions).toEqual([
      {
        itemId: "item-2",
        action: "approve",
        destinationPath: "Onix/Research Inbox.md",
        content: "Research: command UX examples."
      }
    ]);

    await createCli({ input: createReadableInput(["a"]), output: createWritableCapture() })
      .exitOverride()
      .parseAsync(["node", "onix", "--vault", vault, "review", "review-plan"]);

    expect((await readApprovalState(vault)).decisions).toEqual([
      {
        itemId: "item-2",
        action: "approve",
        destinationPath: "Onix/Research Inbox.md",
        content: "Research: command UX examples."
      },
      {
        itemId: "item-1",
        action: "approve",
        destinationPath: "Knowledge/CLI.md",
        content: "CLI decisions should stay testable."
      }
    ]);
  });
});

async function writeReviewPlan(vault: string): Promise<void> {
  await mkdir(join(vault, ".onix", "plans"), { recursive: true });
  await writeFile(
    join(vault, ".onix", "plans", "review-plan.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        planId: "review-plan",
        summary: "Review two proposed destinations.",
        items: [
          {
            id: "item-1",
            kind: "consolidated-knowledge",
            destinationPath: "Knowledge/CLI.md",
            learningCapture: "CLI decisions should stay testable.",
            primaryTopic: "CLI",
            relatedTopics: ["Testing"],
            sourceTrace: "Onix/Sessions/session.md line 1",
            proposedContent: "CLI decisions should stay testable."
          },
          {
            id: "item-2",
            kind: "research-candidate",
            destinationPath: "Onix/Research Inbox.md",
            learningCapture: "Research: command UX examples.",
            primaryTopic: "CLI",
            relatedTopics: [],
            sourceTrace: "Onix/Sessions/session.md line 2",
            proposedContent: "Research: command UX examples."
          }
        ]
      },
      null,
      2
    )
  );
}

async function readApprovalState(vault: string): Promise<{ decisions?: unknown[] }> {
  return JSON.parse(await readFile(join(vault, ".onix", "approvals", "review-plan.json"), "utf8")) as {
    decisions?: unknown[];
  };
}

function createWritableCapture(): Writable & { content(): string } {
  const chunks: string[] = [];
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    }
  }) as Writable & { content(): string };

  writable.content = () => chunks.join("");

  return writable;
}

function createReadableInput(answers: string[]): PassThrough {
  const input = new PassThrough();
  input.write(`${answers.join("\n")}\n`);

  return input;
}
