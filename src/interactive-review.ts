import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import {
  readApprovalState,
  readPatchPlan,
  recordReviewAction,
  type ReviewActionInput
} from "./approval-state.js";
import type { PatchPlan } from "./proposal-engine/contract.js";

export type InteractiveReviewIo = {
  input: Readable;
  output: Writable;
};

export async function runInteractiveReview(vaultPath: string, planId: string, io: InteractiveReviewIo): Promise<void> {
  const plan = await readPatchPlan(vaultPath, planId);
  const approvalState = await readApprovalState(vaultPath, planId);
  const decidedItemIds = new Set(approvalState.decisions.map((decision) => decision.itemId));
  const pendingItems = plan.items.filter((item) => !decidedItemIds.has(item.id));

  writeLine(io.output, "");
  writeLine(io.output, "Interactive Integrated Review");
  writeLine(io.output, `Patch Plan: ${plan.planId}`);
  writeLine(io.output, `Pending Review Items: ${pendingItems.length}`);
  writeLine(io.output, `Already Decided Items: ${decidedItemIds.size}`);

  if (pendingItems.length === 0) {
    writeLine(io.output, "No pending Review Actions.");
    return;
  }

  const review = new LinePrompt(io.input, io.output);
  let currentIndex = 0;

  while (currentIndex < pendingItems.length) {
    const item = pendingItems[currentIndex];
    if (item === undefined) {
      return;
    }

    renderItem(io.output, item, currentIndex, pendingItems.length);

    const action = await askForAction(review, io.output, item);
    if (action === "quit") {
      writeLine(io.output, "Review paused.");
      return;
    }

    if (action === "next" || action === "skip") {
      if (action === "skip") {
        writeLine(io.output, `Skipped ${item.id}`);
      }

      if (currentIndex === pendingItems.length - 1) {
        if (action === "next") {
          writeLine(io.output, "Already at last pending item.");
          continue;
        }

        currentIndex += 1;
        continue;
      }

      currentIndex += 1;
      continue;
    }

    if (action === "previous") {
      if (currentIndex === 0) {
        writeLine(io.output, "Already at first pending item.");
      } else {
        currentIndex -= 1;
      }

      continue;
    }

    await recordReviewAction(vaultPath, planId, action);
    writeLine(io.output, `Recorded ${action.action} for ${action.itemId}`);
    currentIndex += 1;
  }
}

type PendingItem = PatchPlan["items"][number];
type InteractiveAction = ReviewActionInput | "next" | "previous" | "skip" | "quit";

async function askForAction(
  review: LinePrompt,
  output: Writable,
  item: PendingItem
): Promise<InteractiveAction> {
  while (true) {
    const answerInput = await review.question(
      "Choose action [a]pprove, [e]dit, [m]ove, [s]plit, [d]iscard, [n]ext, [p]revious, s[k]ip, [q]uit: "
    );
    if (answerInput === undefined) {
      return "quit";
    }

    const answer = normalizeAnswer(answerInput);

    if (answer === "a" || answer === "approve") {
      return { action: "approve", itemId: item.id };
    }

    if (answer === "e" || answer === "edit") {
      const content = await editContentInEditor(item.proposedContent);
      if (content === undefined) {
        writeLine(output, `Edit canceled for ${item.id}; item remains pending.`);
        continue;
      }

      return { action: "edit", itemId: item.id, content };
    }

    if (answer === "m" || answer === "move") {
      const destinationPath = (await review.question("Destination note path: ")) ?? "";
      return { action: "move", itemId: item.id, destinationPath };
    }

    if (answer === "s" || answer === "split") {
      const parts = await splitContentInEditor(item.proposedContent);
      if (parts === undefined) {
        writeLine(output, `Split canceled for ${item.id}; item remains pending.`);
        continue;
      }

      return { action: "split", itemId: item.id, parts };
    }

    if (answer === "d" || answer === "discard") {
      return { action: "discard", itemId: item.id };
    }

    if (answer === "k" || answer === "skip") {
      return "skip";
    }

    if (answer === "n" || answer === "next") {
      return "next";
    }

    if (answer === "p" || answer === "previous") {
      return "previous";
    }

    if (answer === "q" || answer === "quit") {
      return "quit";
    }
  }
}

async function editContentInEditor(initialContent: string): Promise<string | undefined> {
  const editedContent = await openEditor(initialContent, ".md");
  if (editedContent === undefined || editedContent.trim().length === 0) {
    return undefined;
  }

  return editedContent;
}

async function splitContentInEditor(proposedContent: string): Promise<string[] | undefined> {
  const editedTemplate = await openEditor(splitTemplate(proposedContent), ".md");
  if (editedTemplate === undefined) {
    return undefined;
  }

  const parts = parseSplitTemplate(editedTemplate);
  if (parts.length < 2) {
    return undefined;
  }

  return parts;
}

function splitTemplate(proposedContent: string): string {
  return [
    "# Onix split template",
    "# Keep at least two non-empty parts. Text before the first marker is ignored.",
    "# Separate parts with a line containing exactly: --- part ---",
    "--- part ---",
    proposedContent,
    "--- part ---",
    ""
  ].join("\n");
}

function parseSplitTemplate(template: string): string[] {
  const marker = /^--- part ---$/m;
  return template
    .split(marker)
    .slice(1)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

async function openEditor(initialContent: string, extension: string): Promise<string | undefined> {
  const editor = process.env.VISUAL ?? process.env.EDITOR;
  if (editor === undefined || editor.trim().length === 0) {
    return undefined;
  }

  const directory = await mkdtemp(join(tmpdir(), "onix-review-"));
  const filePath = join(directory, `review-action${extension}`);

  try {
    await writeFile(filePath, initialContent);
    const exitCode = await runEditor(editor, filePath);
    if (exitCode !== 0) {
      return undefined;
    }

    return await readFile(filePath, "utf8");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function runEditor(editor: string, filePath: string): Promise<number | null> {
  return await new Promise((resolve, reject) => {
    const child = spawn(`${editor} ${quoteShellArgument(filePath)}`, {
      shell: true,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });
}

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function renderItem(output: Writable, item: PendingItem, index: number, total: number): void {
  writeLine(output, "");
  writeLine(output, `Item ${index + 1} of ${total}`);
  writeLine(output, `Destination: ${item.destinationPath ?? "No Consolidation"}`);
  writeLine(output, `ID: ${item.id}`);
  writeLine(output, `Kind: ${item.kind}`);
  writeLine(output, `Source: ${item.sourceTrace}`);
  writeLine(output, `Learning Capture: ${item.learningCapture}`);

  if (item.primaryTopic !== undefined) {
    writeLine(output, `Primary Topic: ${item.primaryTopic}`);
  }

  if (item.relatedTopics.length > 0) {
    writeLine(output, `Related Topics: ${item.relatedTopics.join(", ")}`);
  }

  writeLine(output, `Proposed Content: ${item.proposedContent}`);
}

function normalizeAnswer(answer: string): string {
  return answer.trim().toLowerCase();
}

function writeLine(output: Writable, line: string): void {
  output.write(`${line}\n`);
}

class LinePrompt {
  private readonly chunks: AsyncIterator<Buffer | string>;
  private readonly lines: string[] = [];
  private pending = "";

  constructor(
    private readonly input: Readable,
    private readonly output: Writable
  ) {
    this.chunks = input[Symbol.asyncIterator]();
  }

  async question(prompt: string): Promise<string | undefined> {
    this.output.write(prompt);

    const line = await this.readLine();
    return line?.replace(/\r$/, "");
  }

  private async readLine(): Promise<string | undefined> {
    while (this.lines.length === 0) {
      const chunk = await this.chunks.next();
      if (chunk.done === true) {
        if (this.pending.length === 0) {
          return undefined;
        }

        const finalLine = this.pending;
        this.pending = "";
        return finalLine;
      }

      this.pending += String(chunk.value);

      let newlineIndex = this.pending.indexOf("\n");
      while (newlineIndex !== -1) {
        this.lines.push(this.pending.slice(0, newlineIndex));
        this.pending = this.pending.slice(newlineIndex + 1);
        newlineIndex = this.pending.indexOf("\n");
      }
    }

    return this.lines.shift() ?? "";
  }
}
