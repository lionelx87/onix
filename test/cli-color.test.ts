import { describe, expect, test } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { PassThrough, Writable } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCli } from "../src/cli.js";
import { createPalette } from "../src/cli/color.js";

describe("createPalette", () => {
  test("wraps text with ANSI codes when output is a TTY and NO_COLOR is unset", () => {
    const palette = withNoColorUnset(() => createPalette({ isTTY: true }));

    expect(palette.red("error")).toBe("\x1b[31merror\x1b[0m");
    expect(palette.green("ok")).toBe("\x1b[32mok\x1b[0m");
    expect(palette.bold("bold")).toBe("\x1b[1mbold\x1b[0m");
    expect(palette.dim("dim")).toBe("\x1b[2mdim\x1b[0m");
    expect(palette.cyan("hi")).toBe("\x1b[36mhi\x1b[0m");
    expect(palette.yellow("warn")).toBe("\x1b[33mwarn\x1b[0m");
    expect(palette.blue("blue")).toBe("\x1b[34mblue\x1b[0m");
    expect(palette.magenta("magenta")).toBe("\x1b[35mmagenta\x1b[0m");
  });

  test("returns plain text when NO_COLOR is set", () => {
    const palette = withNoColorSet("1", () => createPalette({ isTTY: true }));

    expect(palette.red("error")).toBe("error");
    expect(palette.green("ok")).toBe("ok");
    expect(palette.bold("bold")).toBe("bold");
  });

  test("returns plain text when output is not a TTY", () => {
    const palette = withNoColorUnset(() => createPalette({ isTTY: false }));

    expect(palette.red("error")).toBe("error");
    expect(palette.cyan("hi")).toBe("hi");
  });
});

describe("interactive review color output", () => {
  test("applies ANSI color codes when output is a TTY and NO_COLOR is unset", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-color-vault-"));
    await writeReviewPlan(vault);
    const output = createTtyWritableCapture();

    await withNoColorUnsetAsync(async () => {
      await createCli({ input: createReadableInput(["q"]), output })
        .exitOverride()
        .parseAsync(["node", "onix", "--vault", vault, "review", "review-plan"]);
    });

    expect(output.content()).toContain("\x1b[");
    expect(output.content()).toMatch(/\x1b\[36m.*Item 1 of 2.*\x1b\[0m/);
  });

  test("omits ANSI color codes when NO_COLOR is set even on a TTY", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-color-vault-"));
    await writeReviewPlan(vault);
    const output = createTtyWritableCapture();

    await withNoColorSetAsync("1", async () => {
      await createCli({ input: createReadableInput(["q"]), output })
        .exitOverride()
        .parseAsync(["node", "onix", "--vault", vault, "review", "review-plan"]);
    });

    expect(output.content()).not.toContain("\x1b[");
    expect(output.content()).toContain("Item 1 of 2");
  });

  test("omits ANSI color codes when output is not a TTY", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-color-vault-"));
    await writeReviewPlan(vault);
    const output = createWritableCapture();

    await withNoColorUnsetAsync(async () => {
      await createCli({ input: createReadableInput(["q"]), output })
        .exitOverride()
        .parseAsync(["node", "onix", "--vault", vault, "review", "review-plan"]);
    });

    expect(output.content()).not.toContain("\x1b[");
    expect(output.content()).toContain("Item 1 of 2");
  });
});

function withNoColorUnset<T>(fn: () => T): T {
  const original = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    return fn();
  } finally {
    if (original !== undefined) {
      process.env.NO_COLOR = original;
    }
  }
}

function withNoColorSet<T>(value: string, fn: () => T): T {
  const original = process.env.NO_COLOR;
  process.env.NO_COLOR = value;
  try {
    return fn();
  } finally {
    if (original === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = original;
    }
  }
}

async function withNoColorUnsetAsync<T>(fn: () => Promise<T>): Promise<T> {
  const original = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    return await fn();
  } finally {
    if (original !== undefined) {
      process.env.NO_COLOR = original;
    }
  }
}

async function withNoColorSetAsync<T>(value: string, fn: () => Promise<T>): Promise<T> {
  const original = process.env.NO_COLOR;
  process.env.NO_COLOR = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = original;
    }
  }
}

function createTtyWritableCapture(): Writable & { content(): string } {
  const chunks: string[] = [];
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    }
  }) as Writable & { content(): string; isTTY?: boolean };

  writable.content = () => chunks.join("");
  writable.isTTY = true;

  return writable;
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

async function writeReviewPlan(vault: string): Promise<void> {
  await mkdir(join(vault, ".onix", "plans"), { recursive: true });
  await writeFile(
    join(vault, ".onix", "plans", "review-plan.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        planId: "review-plan",
        summary: "Color test plan.",
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
