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

  if (pendingItems.length === 0) {
    writeLine(io.output, "No pending Review Actions.");
    return;
  }

  const review = new LinePrompt(io.input, io.output);

  for (const item of pendingItems) {
    renderItem(io.output, item);

    const action = await askForAction(review, item);
    if (action === "quit") {
      writeLine(io.output, "Review paused.");
      return;
    }

    if (action === "skip") {
      writeLine(io.output, `Skipped ${item.id}`);
      continue;
    }

    await recordReviewAction(vaultPath, planId, action);
    writeLine(io.output, `Recorded ${action.action} for ${action.itemId}`);
  }
}

type PendingItem = PatchPlan["items"][number];

async function askForAction(review: LinePrompt, item: PendingItem): Promise<ReviewActionInput | "skip" | "quit"> {
  while (true) {
    const answerInput = await review.question(
      "Choose action [a]pprove, [e]dit, [m]ove, [s]plit, [d]iscard, s[k]ip, [q]uit: "
    );
    if (answerInput === undefined) {
      return "quit";
    }

    const answer = normalizeAnswer(answerInput);

    if (answer === "a" || answer === "approve") {
      return { action: "approve", itemId: item.id };
    }

    if (answer === "e" || answer === "edit") {
      const content = (await review.question("Edited content: ")) ?? "";
      return { action: "edit", itemId: item.id, content };
    }

    if (answer === "m" || answer === "move") {
      const destinationPath = (await review.question("Destination note path: ")) ?? "";
      return { action: "move", itemId: item.id, destinationPath };
    }

    if (answer === "s" || answer === "split") {
      return { action: "split", itemId: item.id, parts: await askForSplitParts(review) };
    }

    if (answer === "d" || answer === "discard") {
      return { action: "discard", itemId: item.id };
    }

    if (answer === "k" || answer === "skip") {
      return "skip";
    }

    if (answer === "q" || answer === "quit") {
      return "quit";
    }
  }
}

async function askForSplitParts(review: LinePrompt): Promise<string[]> {
  const parts = [
    (await review.question("First split part: ")) ?? "",
    (await review.question("Second split part: ")) ?? ""
  ];

  while (true) {
    const part = await review.question("Additional split part, blank to finish: ");
    if (part === undefined || part.trim().length === 0) {
      return parts;
    }

    parts.push(part);
  }
}

function renderItem(output: Writable, item: PendingItem): void {
  writeLine(output, "");
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
