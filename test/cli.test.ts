import { describe, expect, test, vi } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, stat, utimes, writeFile } from "node:fs/promises";
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

  test("routes a Freeform Capture to a stored Classification Rule destination on later close", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await mkdir(join(vault, ".onix"), { recursive: true });
      await writeFile(
        join(vault, ".onix", "classification-rules.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            rules: [
              {
                id: "rule-1",
                pattern: "Review Workflows",
                destinationPath: "Knowledge/Review Workflows.md",
                approvedAt: "2026-05-17T00:00:00.000Z"
              }
            ]
          },
          null,
          2
        )
      );

      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "start"]);

      const sessionInboxFiles = await readdir(join(vault, "Onix", "Sessions"));
      const inboxPath = join(vault, "Onix", "Sessions", sessionInboxFiles[0] ?? "");
      await writeFile(
        inboxPath,
        `${await readFile(inboxPath, "utf8")}\nReview Workflows should keep human approval explicit.\n`
      );

      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "close", "--no-review"]);
    } finally {
      consoleLog.mockRestore();
    }

    const plan = JSON.parse(await readFile(join(vault, ".onix", "plans", "stubbed-plan.json"), "utf8")) as {
      items?: Array<{ destinationPath?: string; proposedContent?: string; learningCapture?: string }>;
    };

    expect(plan.items?.[0]).toMatchObject({
      destinationPath: "Knowledge/Review Workflows.md",
      learningCapture: "Review Workflows should keep human approval explicit."
    });
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

  test("renders Knowledge Refinement items as Before/After/Reason", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await writeRefinementPlan(vault);

      await createCli()
        .exitOverride()
        .parseAsync(["node", "onix", "--vault", vault, "review", "refinement-plan", "--render"]);
    } finally {
      consoleLog.mockRestore();
    }

    const output = stdout.join("\n");
    expect(output).toContain("## Knowledge/Knowledge Topics.md");
    expect(output).toContain("Kind: knowledge-refinement");
    expect(output).toContain("Before: Primary Topics answer the durable question.");
    expect(output).toContain(
      "After: Primary Topics answer the durable question, and bug contexts become Related Topics."
    );
    expect(output).toContain("Reason: Strengthens existing Consolidated Knowledge with additional detail.");
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

  test("records a Rule Candidate alongside a move Review Action without persisting a Classification Rule", async () => {
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

    const approvalState = JSON.parse(
      await readFile(join(vault, ".onix", "approvals", "review-plan.json"), "utf8")
    ) as { ruleCandidates?: unknown[] };

    expect(approvalState.ruleCandidates).toEqual([
      {
        id: "rule-candidate-1",
        fromItemId: "item-1",
        pattern: "CLI decisions should stay testable.",
        destinationPath: "Knowledge/Review Workflows.md"
      }
    ]);

    await expect(readFile(join(vault, ".onix", "classification-rules.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  test("persists an approved Classification Rule to the versioned store after explicit approval", async () => {
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

    await createCli()
      .exitOverride()
      .parseAsync([
        "node",
        "onix",
        "--vault",
        vault,
        "review",
        "review-plan",
        "--approve-rule",
        "rule-candidate-1"
      ]);

    const rulesStore = JSON.parse(
      await readFile(join(vault, ".onix", "classification-rules.json"), "utf8")
    ) as { schemaVersion?: number; rules?: Array<Record<string, unknown>> };

    expect(rulesStore.schemaVersion).toBe(1);
    expect(rulesStore.rules).toEqual([
      {
        id: "rule-1",
        pattern: "CLI decisions should stay testable.",
        destinationPath: "Knowledge/Review Workflows.md",
        approvedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
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
    const editor = await writeSequentialFakeEditor("interactive-review-editor.mjs", [
      "Edited durable learning.",
      "--- part ---\nFirst split learning.\n--- part ---\nSecond split learning.\n"
    ]);
    const originalVisual = process.env.VISUAL;
    const originalEditor = process.env.EDITOR;

    await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "start"]);

    const sessionInboxFiles = await readdir(join(vault, "Onix", "Sessions"));
    const inboxPath = join(vault, "Onix", "Sessions", sessionInboxFiles[0] ?? "");
    await writeFile(
      inboxPath,
      `${await readFile(inboxPath, "utf8")}\nApprove this durable learning.\nEdit this durable learning.\nMove this durable learning.\nSplit this durable learning.\nDiscard this reminder.\n`
    );

    process.env.VISUAL = editor;
    delete process.env.EDITOR;

    try {
      await createCli({
        input: createReadableInput([
          "a",
          "e",
          "m",
          "Knowledge/Moved.md",
          "s",
          "d"
        ]),
        output
      })
        .exitOverride()
        .parseAsync(["node", "onix", "--vault", vault, "close"]);
    } finally {
      restoreEnv("VISUAL", originalVisual);
      restoreEnv("EDITOR", originalEditor);
    }

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

  test("opens VISUAL for interactive edit and records the saved content as Approval State", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    const editor = await writeFakeEditor("edited-by-visual.mjs", "CLI decisions stay testable after editor review.");
    const originalVisual = process.env.VISUAL;
    const originalEditor = process.env.EDITOR;

    await writeReviewPlan(vault);
    process.env.VISUAL = editor;
    delete process.env.EDITOR;

    try {
      await createCli({ input: createReadableInput(["e", "q"]), output: createWritableCapture() })
        .exitOverride()
        .parseAsync(["node", "onix", "--vault", vault, "review", "review-plan"]);
    } finally {
      restoreEnv("VISUAL", originalVisual);
      restoreEnv("EDITOR", originalEditor);
    }

    expect((await readApprovalState(vault)).decisions).toEqual([
      {
        itemId: "item-1",
        action: "edit",
        destinationPath: "Knowledge/CLI.md",
        content: "CLI decisions stay testable after editor review."
      }
    ]);
  });

  test("opens VISUAL for interactive split and records valid template parts as Approval State", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    const editor = await writeFakeEditor(
      "split-by-visual.mjs",
      "Split item guidance ignored before first marker.\n--- part ---\nCLI decisions should stay testable.\n--- part ---\nReview actions should be explicit.\n"
    );
    const originalVisual = process.env.VISUAL;
    const originalEditor = process.env.EDITOR;

    await writeReviewPlan(vault);
    process.env.VISUAL = editor;
    delete process.env.EDITOR;

    try {
      await createCli({ input: createReadableInput(["s", "q"]), output: createWritableCapture() })
        .exitOverride()
        .parseAsync(["node", "onix", "--vault", vault, "review", "review-plan"]);
    } finally {
      restoreEnv("VISUAL", originalVisual);
      restoreEnv("EDITOR", originalEditor);
    }

    expect((await readApprovalState(vault)).decisions).toEqual([
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

  test("leaves an item pending when the editor fails during interactive edit", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    const editor = await writeFailingFakeEditor("failing-editor.mjs");
    const output = createWritableCapture();
    const originalVisual = process.env.VISUAL;
    const originalEditor = process.env.EDITOR;

    await writeReviewPlan(vault);
    process.env.VISUAL = editor;
    delete process.env.EDITOR;

    try {
      await createCli({ input: createReadableInput(["e", "q"]), output })
        .exitOverride()
        .parseAsync(["node", "onix", "--vault", vault, "review", "review-plan"]);
    } finally {
      restoreEnv("VISUAL", originalVisual);
      restoreEnv("EDITOR", originalEditor);
    }

    await expect(readFile(join(vault, ".onix", "approvals", "review-plan.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect(output.content()).toContain("Edit canceled for item-1; item remains pending.");
  });

  test("leaves an item pending when the split template is invalid", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    const editor = await writeFakeEditor("invalid-split-editor.mjs", "--- part ---\nOnly one part.\n");
    const output = createWritableCapture();
    const originalVisual = process.env.VISUAL;
    const originalEditor = process.env.EDITOR;

    await writeReviewPlan(vault);
    process.env.VISUAL = editor;
    delete process.env.EDITOR;

    try {
      await createCli({ input: createReadableInput(["s", "q"]), output })
        .exitOverride()
        .parseAsync(["node", "onix", "--vault", vault, "review", "review-plan"]);
    } finally {
      restoreEnv("VISUAL", originalVisual);
      restoreEnv("EDITOR", originalEditor);
    }

    await expect(readFile(join(vault, ".onix", "approvals", "review-plan.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect(output.content()).toContain("Split canceled for item-1; item remains pending.");
  });

  test("shows review progress and supports next and previous without recording decisions", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    const output = createWritableCapture();

    await writeReviewPlan(vault);

    await createCli({ input: createReadableInput(["n", "p", "a", "q"]), output })
      .exitOverride()
      .parseAsync(["node", "onix", "--vault", vault, "review", "review-plan"]);

    expect((await readApprovalState(vault)).decisions).toEqual([
      {
        itemId: "item-1",
        action: "approve",
        destinationPath: "Knowledge/CLI.md",
        content: "CLI decisions should stay testable."
      }
    ]);
    expect(output.content()).toContain("Pending Review Items: 2");
    expect(output.content()).toContain("Item 1 of 2");
    expect(output.content()).toContain("Item 2 of 2");
  });
});

describe("Apply", () => {
  test("applies approved Consolidated Knowledge, cleans up the Session Inbox, and renders Versioning Review", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    const stdout: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation((value: string) => stdout.push(value));

    try {
      await writeActiveSession(vault);
      await writeApplyPlan(vault);
      await writeApprovalState(vault, {
        planId: "apply-plan",
        decisions: [
          {
            itemId: "approved",
            action: "approve",
            destinationPath: "Knowledge/CLI.md",
            content: "Approved durable learning."
          },
          {
            itemId: "edited",
            action: "edit",
            destinationPath: "Knowledge/CLI.md",
            content: "Edited durable learning."
          },
          {
            itemId: "moved",
            action: "move",
            destinationPath: "Knowledge/Moved.md",
            content: "Moved durable learning."
          },
          {
            itemId: "split",
            action: "split",
            parts: [
              {
                destinationPath: "Knowledge/Split.md",
                content: "First split durable learning."
              },
              {
                destinationPath: "Knowledge/Split.md",
                content: "Second split durable learning."
              }
            ]
          },
          {
            itemId: "discarded",
            action: "discard"
          }
        ]
      });

      await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "apply", "apply-plan"]);
    } finally {
      consoleLog.mockRestore();
    }

    await expect(readFile(join(vault, "Knowledge", "CLI.md"), "utf8")).resolves.toBe(
      "Approved durable learning.\n\nEdited durable learning.\n"
    );
    await expect(readFile(join(vault, "Knowledge", "Moved.md"), "utf8")).resolves.toBe("Moved durable learning.\n");
    await expect(readFile(join(vault, "Knowledge", "Split.md"), "utf8")).resolves.toBe(
      "First split durable learning.\n\nSecond split durable learning.\n"
    );
    await expect(readFile(join(vault, "Knowledge", "Discarded.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(vault, "Knowledge", "Pending.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(vault, "Onix", "Sessions", "session-inbox.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readFile(join(vault, ".onix", "state", "active-session.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });

    const output = stdout.join("\n");
    expect(output).toContain("Versioning Review");
    expect(output).toContain("Knowledge/CLI.md");
    expect(output).toContain("Knowledge/Moved.md");
    expect(output).toContain("Knowledge/Split.md");
    expect(output).not.toContain("Knowledge/Discarded.md");
    expect(output).not.toContain("Knowledge/Pending.md");
  });

  test("never persists a Classification Rule during apply when --approve-rule was not invoked", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));

    await writeActiveSession(vault);
    await writeApplyPlan(vault);
    await writeApprovalState(vault, {
      planId: "apply-plan",
      decisions: [
        {
          itemId: "moved",
          action: "move",
          destinationPath: "Knowledge/Moved.md",
          content: "Moved durable learning."
        }
      ],
      ruleCandidates: [
        {
          id: "rule-candidate-1",
          fromItemId: "moved",
          pattern: "Moved durable learning.",
          destinationPath: "Knowledge/Moved.md"
        }
      ]
    });

    await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "apply", "apply-plan"]);

    await expect(readFile(join(vault, ".onix", "classification-rules.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  test("writes approved Research Candidates and Reference Items outside Consolidated Knowledge", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));

    await writeActiveSession(vault);
    await writeApplyPlan(vault);
    await writeApprovalState(vault, {
      planId: "apply-plan",
      decisions: [
        {
          itemId: "research-candidate",
          action: "approve",
          destinationPath: "Onix/Research Inbox.md",
          content: "Research: https://example.com/vector-search for future vault indexing."
        },
        {
          itemId: "reference-item",
          action: "approve",
          destinationPath: "Reference Library/CLI.md",
          content: "Reference: https://example.com/cli-docs documents command UX patterns."
        },
        {
          itemId: "discarded-reference",
          action: "discard"
        }
      ]
    });

    await createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "apply", "apply-plan"]);

    await expect(readFile(join(vault, "Onix", "Research Inbox.md"), "utf8")).resolves.toBe(
      "## CLI\n\n- Research: https://example.com/vector-search for future vault indexing.\n"
    );
    await expect(readFile(join(vault, "Reference Library", "CLI.md"), "utf8")).resolves.toBe(
      "## CLI\n\n- Reference: https://example.com/cli-docs documents command UX patterns.\n\nInformed learning: [[CLI]]\n"
    );
    await expect(readFile(join(vault, "Knowledge", "CLI.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(vault, "Reference Library", "Discarded.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  test("applies an approved Knowledge Refinement by replacing existingContent in the destination note", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));

    await writeActiveSession(vault);
    await mkdir(join(vault, "Knowledge"), { recursive: true });
    await writeFile(
      join(vault, "Knowledge", "Knowledge Topics.md"),
      "# Knowledge Topics\n\nPrimary Topics answer the durable question.\n\nUnchanged paragraph stays intact.\n"
    );
    await writeApplyRefinementPlan(vault);
    await writeApprovalState(vault, {
      planId: "refinement-apply-plan",
      decisions: [
        {
          itemId: "refinement",
          action: "approve",
          destinationPath: "Knowledge/Knowledge Topics.md",
          content:
            "Primary Topics answer the durable question, and bug contexts become Related Topics."
        }
      ]
    });

    await createCli()
      .exitOverride()
      .parseAsync(["node", "onix", "--vault", vault, "apply", "refinement-apply-plan"]);

    await expect(readFile(join(vault, "Knowledge", "Knowledge Topics.md"), "utf8")).resolves.toBe(
      "# Knowledge Topics\n\nPrimary Topics answer the durable question, and bug contexts become Related Topics.\n\nUnchanged paragraph stays intact.\n"
    );
  });

  test("stops when an approved Knowledge Refinement no longer matches the destination note", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));

    await writeActiveSession(vault);
    await mkdir(join(vault, "Knowledge"), { recursive: true });
    await writeFile(
      join(vault, "Knowledge", "Knowledge Topics.md"),
      "# Knowledge Topics\n\nThis paragraph no longer matches the refinement target.\n"
    );
    await writeApplyRefinementPlan(vault);
    await writeApprovalState(vault, {
      planId: "refinement-apply-plan",
      decisions: [
        {
          itemId: "refinement",
          action: "approve",
          destinationPath: "Knowledge/Knowledge Topics.md",
          content:
            "Primary Topics answer the durable question, and bug contexts become Related Topics."
        }
      ]
    });

    await expect(
      createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "apply", "refinement-apply-plan"])
    ).rejects.toThrow("Refinement target not found in destination: Knowledge/Knowledge Topics.md");

    await expect(readFile(join(vault, "Knowledge", "Knowledge Topics.md"), "utf8")).resolves.toBe(
      "# Knowledge Topics\n\nThis paragraph no longer matches the refinement target.\n"
    );
    await expect(readFile(join(vault, "Onix", "Sessions", "session-inbox.md"), "utf8")).resolves.toContain(
      "onix_session_id"
    );
  });

  test("rejects destination paths outside the Write Boundary before writing or cleanup", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));

    await writeActiveSession(vault);
    await writeApplyPlan(vault);
    await writeApprovalState(vault, {
      planId: "apply-plan",
      decisions: [
        {
          itemId: "approved",
          action: "move",
          destinationPath: "../Outside.md",
          content: "This must not be written."
        }
      ]
    });

    await expect(
      createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "apply", "apply-plan"])
    ).rejects.toThrow("Destination is outside the Write Boundary: ../Outside.md");

    await expect(readFile(join(vault, "..", "Outside.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(vault, "Onix", "Sessions", "session-inbox.md"), "utf8")).resolves.toContain(
      "onix_session_id"
    );
  });

  test("stops when Commit Validation finds a stale destination file", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    const destination = join(vault, "Knowledge", "CLI.md");

    await writeActiveSession(vault);
    await writeApplyPlan(vault);
    await mkdir(join(vault, "Knowledge"), { recursive: true });
    await writeFile(destination, "Existing knowledge edited after review.\n");
    await utimes(destination, new Date(Date.now() + 60_000), new Date(Date.now() + 60_000));
    await writeApprovalState(vault, {
      planId: "apply-plan",
      decisions: [
        {
          itemId: "approved",
          action: "approve",
          destinationPath: "Knowledge/CLI.md",
          content: "Approved durable learning."
        }
      ]
    });

    await expect(
      createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "apply", "apply-plan"])
    ).rejects.toThrow("Destination changed after Patch Plan generation: Knowledge/CLI.md");

    await expect(readFile(destination, "utf8")).resolves.toBe("Existing knowledge edited after review.\n");
    await expect(readFile(join(vault, "Onix", "Sessions", "session-inbox.md"), "utf8")).resolves.toContain(
      "onix_session_id"
    );
  });

  test("reports failed Session Inbox cleanup after verified writes and keeps Active Session state", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));

    await writeActiveSession(vault);
    await rename(join(vault, "Onix", "Sessions", "session-inbox.md"), join(vault, "Onix", "Sessions", "missing.md"));
    await writeApplyPlan(vault);
    await writeApprovalState(vault, {
      planId: "apply-plan",
      decisions: [
        {
          itemId: "approved",
          action: "approve",
          destinationPath: "Knowledge/CLI.md",
          content: "Approved durable learning."
        }
      ]
    });

    await expect(
      createCli().exitOverride().parseAsync(["node", "onix", "--vault", vault, "apply", "apply-plan"])
    ).rejects.toThrow("Failed to clean up Session Inbox");

    await expect(readFile(join(vault, "Knowledge", "CLI.md"), "utf8")).resolves.toBe("Approved durable learning.\n");
    await expect(readFile(join(vault, ".onix", "state", "active-session.json"), "utf8")).resolves.toContain(
      "test-session"
    );
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

async function writeRefinementPlan(vault: string): Promise<void> {
  await mkdir(join(vault, ".onix", "plans"), { recursive: true });
  await writeFile(
    join(vault, ".onix", "plans", "refinement-plan.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        planId: "refinement-plan",
        summary: "Refine existing Consolidated Knowledge.",
        items: [
          {
            id: "item-1",
            kind: "knowledge-refinement",
            destinationPath: "Knowledge/Knowledge Topics.md",
            learningCapture: "Primary Topics answer the durable question, and bug contexts become Related Topics.",
            primaryTopic: "Knowledge Topics",
            relatedTopics: [],
            sourceTrace: "Onix/Sessions/session.md line 1",
            proposedContent:
              "Primary Topics answer the durable question, and bug contexts become Related Topics.",
            existingContent: "Primary Topics answer the durable question.",
            refinementReason: "Strengthens existing Consolidated Knowledge with additional detail."
          }
        ]
      },
      null,
      2
    )
  );
}

async function writeApplyPlan(vault: string): Promise<void> {
  await mkdir(join(vault, ".onix", "plans"), { recursive: true });
  await writeFile(
    join(vault, ".onix", "plans", "apply-plan.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        planId: "apply-plan",
        summary: "Apply approved knowledge.",
        items: [
          {
            id: "approved",
            kind: "consolidated-knowledge",
            destinationPath: "Knowledge/CLI.md",
            learningCapture: "Approved durable learning.",
            sourceTrace: "Onix/Sessions/session-inbox.md line 1",
            proposedContent: "Approved durable learning."
          },
          {
            id: "edited",
            kind: "consolidated-knowledge",
            destinationPath: "Knowledge/CLI.md",
            learningCapture: "Edit this durable learning.",
            sourceTrace: "Onix/Sessions/session-inbox.md line 2",
            proposedContent: "Edit this durable learning."
          },
          {
            id: "moved",
            kind: "consolidated-knowledge",
            destinationPath: "Knowledge/Original.md",
            learningCapture: "Moved durable learning.",
            sourceTrace: "Onix/Sessions/session-inbox.md line 3",
            proposedContent: "Moved durable learning."
          },
          {
            id: "split",
            kind: "consolidated-knowledge",
            destinationPath: "Knowledge/Split.md",
            learningCapture: "Split durable learning.",
            sourceTrace: "Onix/Sessions/session-inbox.md line 4",
            proposedContent: "Split durable learning."
          },
          {
            id: "discarded",
            kind: "consolidated-knowledge",
            destinationPath: "Knowledge/Discarded.md",
            learningCapture: "Discarded durable learning.",
            sourceTrace: "Onix/Sessions/session-inbox.md line 5",
            proposedContent: "Discarded durable learning."
          },
          {
            id: "pending",
            kind: "consolidated-knowledge",
            destinationPath: "Knowledge/Pending.md",
            learningCapture: "Pending durable learning.",
            sourceTrace: "Onix/Sessions/session-inbox.md line 6",
            proposedContent: "Pending durable learning."
          },
          {
            id: "research-candidate",
            kind: "research-candidate",
            destinationPath: "Onix/Research Inbox.md",
            learningCapture: "Research: https://example.com/vector-search for future vault indexing.",
            primaryTopic: "CLI",
            relatedTopics: [],
            sourceTrace: "Onix/Sessions/session-inbox.md line 7",
            proposedContent: "Research: https://example.com/vector-search for future vault indexing."
          },
          {
            id: "reference-item",
            kind: "reference-item",
            destinationPath: "Reference Library/CLI.md",
            learningCapture: "Reference: https://example.com/cli-docs documents command UX patterns.",
            primaryTopic: "CLI",
            relatedTopics: [],
            sourceTrace: "Onix/Sessions/session-inbox.md line 8",
            proposedContent: "Reference: https://example.com/cli-docs documents command UX patterns."
          },
          {
            id: "discarded-reference",
            kind: "reference-item",
            destinationPath: "Reference Library/Discarded.md",
            learningCapture: "Reference: https://example.com/discarded is not useful.",
            primaryTopic: "Discarded",
            relatedTopics: [],
            sourceTrace: "Onix/Sessions/session-inbox.md line 9",
            proposedContent: "Reference: https://example.com/discarded is not useful."
          }
        ]
      },
      null,
      2
    )
  );
}

async function writeApplyRefinementPlan(vault: string): Promise<void> {
  await mkdir(join(vault, ".onix", "plans"), { recursive: true });
  await writeFile(
    join(vault, ".onix", "plans", "refinement-apply-plan.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        planId: "refinement-apply-plan",
        summary: "Refine existing Consolidated Knowledge.",
        items: [
          {
            id: "refinement",
            kind: "knowledge-refinement",
            destinationPath: "Knowledge/Knowledge Topics.md",
            learningCapture:
              "Primary Topics answer the durable question, and bug contexts become Related Topics.",
            primaryTopic: "Knowledge Topics",
            relatedTopics: [],
            sourceTrace: "Onix/Sessions/session-inbox.md line 1",
            proposedContent:
              "Primary Topics answer the durable question, and bug contexts become Related Topics.",
            existingContent: "Primary Topics answer the durable question.",
            refinementReason: "Strengthens existing Consolidated Knowledge with additional detail."
          }
        ]
      },
      null,
      2
    )
  );
}

async function writeApprovalState(
  vault: string,
  approvalState: { planId: string; decisions: unknown[]; ruleCandidates?: unknown[] }
): Promise<void> {
  await mkdir(join(vault, ".onix", "approvals"), { recursive: true });
  await writeFile(
    join(vault, ".onix", "approvals", `${approvalState.planId}.json`),
    JSON.stringify({ schemaVersion: 1, ruleCandidates: [], ...approvalState }, null, 2)
  );
}

async function writeActiveSession(vault: string): Promise<void> {
  await mkdir(join(vault, "Onix", "Sessions"), { recursive: true });
  await mkdir(join(vault, ".onix", "state"), { recursive: true });
  await writeFile(join(vault, "Onix", "Sessions", "session-inbox.md"), "---\nonix_session_id: test-session\n---\n");
  await writeFile(
    join(vault, ".onix", "state", "active-session.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        sessionId: "test-session",
        startedAt: "2026-05-16T00:00:00.000Z",
        inboxPath: "Onix/Sessions/session-inbox.md"
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

async function writeFakeEditor(fileName: string, content: string): Promise<string> {
  return await writeSequentialFakeEditor(fileName, [content]);
}

async function writeSequentialFakeEditor(fileName: string, contents: string[]): Promise<string> {
  const editorPath = join(await mkdtemp(join(tmpdir(), "onix-editor-")), fileName);
  await writeFile(
    editorPath,
    [
      "#!/usr/bin/env node",
      'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
      'const counterPath = `${process.argv[1]}.count`;',
      "const count = existsSync(counterPath) ? Number(readFileSync(counterPath, 'utf8')) : 0;",
      `const contents = ${JSON.stringify(contents)};`,
      "writeFileSync(process.argv[2], contents[Math.min(count, contents.length - 1)]);",
      "writeFileSync(counterPath, String(count + 1));",
      ""
    ].join("\n")
  );
  await chmod(editorPath, 0o755);

  return editorPath;
}

async function writeFailingFakeEditor(fileName: string): Promise<string> {
  const editorPath = join(await mkdtemp(join(tmpdir(), "onix-editor-")), fileName);
  await writeFile(editorPath, "#!/usr/bin/env node\nprocess.exit(1);\n");
  await chmod(editorPath, 0o755);

  return editorPath;
}

function restoreEnv(name: "VISUAL" | "EDITOR", value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
