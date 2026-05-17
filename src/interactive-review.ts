import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type * as Blessed from "blessed";
import {
  readApprovalState,
  readPatchPlan,
  recordReviewAction,
  type ReviewActionInput
} from "./approval-state.js";
import { createPalette, type Palette } from "./cli/color.js";
import type { PatchPlan } from "./proposal-engine/contract.js";

export type InteractiveReviewIo = {
  input: Readable;
  output: Writable;
};

export async function runInteractiveReview(vaultPath: string, planId: string, io: InteractiveReviewIo): Promise<void> {
  if (shouldUseDashboard(io.output)) {
    await runBlessedReview(vaultPath, planId);
    return;
  }

  await runLinePromptReview(vaultPath, planId, io);
}

function shouldUseDashboard(output: Writable): boolean {
  return output === process.stdout && process.stdout.isTTY === true;
}

type PendingItem = PatchPlan["items"][number];
type InteractiveAction = ReviewActionInput | "next" | "previous" | "skip" | "quit";

async function runBlessedReview(vaultPath: string, planId: string): Promise<void> {
  const blessedModule = await import("blessed");
  const blessed = ((blessedModule as { default?: unknown }).default ?? blessedModule) as typeof Blessed;
  const plan = await readPatchPlan(vaultPath, planId);
  const approvalState = await readApprovalState(vaultPath, planId);
  const decisions = new Map<string, ReviewActionInput["action"]>(
    approvalState.decisions.map((decision) => [decision.itemId, decision.action])
  );
  const items = plan.items;
  if (items.length === 0) {
    process.stdout.write("No items to review.\n");
    return;
  }

  const originals = items.map((item) => ({
    proposedContent: item.proposedContent,
    destinationPath: item.destinationPath
  }));
  const vaultNotePaths = await loadVaultNotePaths(vaultPath);

  const firstPendingIndex = items.findIndex((item) => !decisions.has(item.id));
  let cursor = firstPendingIndex === -1 ? 0 : firstPendingIndex;

  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title: `Onix · Review ${plan.planId}`
  });

  const topBar = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    tags: true,
    style: { fg: "white", bg: "blue", bold: true },
    content: ""
  });

  const planList = blessed.list({
    parent: screen,
    label: " Plan Items ",
    top: 1,
    left: 0,
    width: "30%",
    bottom: 1,
    border: { type: "line" },
    style: {
      border: { fg: "gray" },
      selected: { bg: "blue", fg: "white", bold: true }
    },
    keys: false,
    tags: true,
    items: []
  });

  const sourcePane = blessed.box({
    parent: screen,
    label: " Source Trace ",
    top: 1,
    left: "30%",
    width: "35%",
    bottom: 1,
    border: { type: "line" },
    style: { border: { fg: "gray" } },
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: false
  });

  const proposedPane = blessed.box({
    parent: screen,
    label: " Proposed Content ",
    top: 1,
    left: "65%",
    right: 0,
    bottom: 1,
    border: { type: "line" },
    style: { border: { fg: "cyan" } },
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: false
  });

  const defaultHint = " [a]pprove [e]dit [m]ove [s]plit [d]iscard · ↑↓ navigate · [u]ndo · q quit ";
  const hintBar = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
    style: { fg: "white", bg: "gray" },
    content: defaultHint
  });

  type KeyEvent = { name?: string; ctrl?: boolean; full?: string };
  type ModalKeyHandler = (ch: string, key: KeyEvent | undefined) => void;
  let modalKeyHandler: ModalKeyHandler | undefined;
  const isModalOpen = (): boolean => modalKeyHandler !== undefined;
  let transientHintTimer: NodeJS.Timeout | undefined;
  const flashHint = (message: string, ms = 1800): void => {
    hintBar.setContent(` ${message} `);
    screen.render();
    if (transientHintTimer !== undefined) clearTimeout(transientHintTimer);
    transientHintTimer = setTimeout(() => {
      hintBar.setContent(defaultHint);
      screen.render();
    }, ms);
  };

  const repaint = (): void => {
    const program = screen.program as unknown as {
      hideCursor: () => void;
      clear: () => void;
      flush: () => void;
    };
    program.hideCursor();
    program.clear();
    program.flush();
    (screen as unknown as { realloc: () => void }).realloc();
  };

  const refresh = (): void => {
    const current = items[cursor]!;
    const decidedCount = decisions.size;
    topBar.setContent(
      ` Onix › Plan {bold}${plan.planId}{/} › Item {bold}${cursor + 1}/${items.length}{/}   {green-fg}${decidedCount}{/} decided  ·  {yellow-fg}${items.length - decidedCount}{/} pending `
    );

    planList.setItems(
      items.map((item, index) => {
        const meta = kindMeta(item.kind);
        const dest = (item.destinationPath ?? "(no consolidation)").padEnd(22).slice(0, 22);
        const marker = index === cursor ? "▸" : " ";
        return ` ${marker} ${decisionGlyph(decisions.get(item.id))} {${meta.tone}-fg}${meta.glyph}{/} ${dest}`;
      }) as never
    );
    planList.select(cursor);

    sourcePane.setContent(buildSourcePane(current, decisions.get(current.id)));
    proposedPane.setContent(buildProposedPane(current));

    screen.render();
  };

  const recordDecision = async (decision: ReviewActionInput): Promise<void> => {
    await recordReviewAction(vaultPath, planId, decision);
    decisions.set(decision.itemId, decision.action);
    if (cursor < items.length - 1) cursor += 1;
    refresh();
  };

  const handleApprove = async (): Promise<void> => {
    const current = items[cursor]!;
    await recordDecision({ action: "approve", itemId: current.id });
  };

  const handleDiscard = async (): Promise<void> => {
    const current = items[cursor]!;
    await recordDecision({ action: "discard", itemId: current.id });
  };

  const handleEdit = async (): Promise<void> => {
    const current = items[cursor]!;
    try {
      const edited = await suspendAndEdit(screen, current.proposedContent, ".md");
      if (edited === undefined || edited.trim().length === 0) {
        flashHint("Edit canceled · item remains pending");
        return;
      }
      current.proposedContent = edited;
      await recordDecision({ action: "edit", itemId: current.id, content: edited });
    } finally {
      repaint();
      refresh();
    }
  };

  const handleSplit = async (): Promise<void> => {
    const current = items[cursor]!;
    try {
      const template = splitTemplate(current.proposedContent);
      const edited = await suspendAndEdit(screen, template, ".md");
      if (edited === undefined) {
        flashHint("Split canceled · item remains pending");
        return;
      }
      const parts = parseSplitTemplate(edited);
      if (parts.length < 2) {
        flashHint("Split needs at least two non-empty parts");
        return;
      }
      await recordDecision({ action: "split", itemId: current.id, parts });
    } finally {
      repaint();
      refresh();
    }
  };

  const handleMove = async (): Promise<void> => {
    const current = items[cursor]!;
    try {
      const destinationPath = await promptForPath(
        blessed,
        screen,
        vaultNotePaths,
        current.destinationPath ?? "",
        (handler) => { modalKeyHandler = handler; },
        () => { modalKeyHandler = undefined; }
      );
      if (destinationPath === undefined || destinationPath.trim().length === 0) {
        flashHint("Move canceled · item remains pending");
        return;
      }
      current.destinationPath = destinationPath.trim();
      await recordDecision({ action: "move", itemId: current.id, destinationPath: destinationPath.trim() });
    } finally {
      repaint();
      refresh();
    }
  };

  const handleUndo = (): void => {
    const current = items[cursor]!;
    const snapshot = originals[cursor]!;
    current.proposedContent = snapshot.proposedContent;
    if (snapshot.destinationPath !== undefined) {
      current.destinationPath = snapshot.destinationPath;
    } else {
      delete (current as { destinationPath?: string }).destinationPath;
    }
    decisions.delete(current.id);
    refresh();
  };

  return await new Promise<void>((resolve, reject) => {
    const failFast = (error: unknown): void => {
      screen.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const run = (handler: () => Promise<void>): void => {
      void handler().catch(failFast);
    };

    let lastKeyAt = 0;
    let lastKeySignature: string | undefined;
    screen.on("keypress", (ch: string, key: KeyEvent | undefined) => {
      const now = Date.now();
      const name = key?.name;
      const signature = `${name ?? ""}|${ch ?? ""}`;
      if (signature === lastKeySignature && now - lastKeyAt < 50) {
        return;
      }
      lastKeyAt = now;
      lastKeySignature = signature;

      if (modalKeyHandler !== undefined) {
        modalKeyHandler(ch, key);
        return;
      }
      if (key === undefined) return;
      if (key.ctrl === true && name === "c") {
        screen.destroy();
        resolve();
        return;
      }
      switch (name) {
        case "up":
          cursor = Math.max(0, cursor - 1);
          refresh();
          return;
        case "down":
          cursor = Math.min(items.length - 1, cursor + 1);
          refresh();
          return;
        case "q":
          screen.destroy();
          resolve();
          return;
        case "a":
          run(handleApprove);
          return;
        case "d":
          run(handleDiscard);
          return;
        case "e":
          run(handleEdit);
          return;
        case "s":
          run(handleSplit);
          return;
        case "m":
          run(handleMove);
          return;
        case "u":
          handleUndo();
          return;
        default:
          return;
      }
    });

    repaint();
    refresh();
  });
}

function kindMeta(kind: PendingItem["kind"]): { glyph: string; tone: string; label: string } {
  switch (kind) {
    case "consolidated-knowledge":
      return { glyph: "+", tone: "green", label: "New knowledge" };
    case "knowledge-refinement":
      return { glyph: "~", tone: "blue", label: "Refine existing" };
    case "research-candidate":
      return { glyph: "?", tone: "yellow", label: "Research" };
    case "reference-item":
      return { glyph: "@", tone: "magenta", label: "Reference" };
    case "sensitive-candidate":
      return { glyph: "!", tone: "red", label: "Sensitive" };
    case "no-consolidation-candidate":
      return { glyph: "x", tone: "gray", label: "No consolidation" };
  }
}

function decisionGlyph(decision: ReviewActionInput["action"] | undefined): string {
  if (decision === undefined) return " ";
  if (decision === "approve") return "{green-fg}✓{/}";
  if (decision === "discard") return "{red-fg}✗{/}";
  return "{yellow-fg}✎{/}";
}

function buildSourcePane(current: PendingItem, decision: ReviewActionInput["action"] | undefined): string {
  const meta = kindMeta(current.kind);
  const decisionBadge = (() => {
    if (decision === undefined) return "";
    if (decision === "approve") return "  {green-fg}✓ approved{/}";
    if (decision === "discard") return "  {red-fg}✗ discarded{/}";
    if (decision === "edit") return "  {yellow-fg}✎ edited{/}";
    if (decision === "move") return "  {yellow-fg}→ moved{/}";
    if (decision === "split") return "  {yellow-fg}⎇ split{/}";
    return `  {yellow-fg}${decision}{/}`;
  })();
  const lines: string[] = [
    "",
    `  {bold}ID{/}        ${current.id}${decisionBadge}`,
    `  {bold}Kind{/}      {${meta.tone}-fg}${meta.label}{/}`,
    `  {bold}Source{/}    ${current.sourceTrace}`,
    `  {bold}Topic{/}     ${current.primaryTopic ?? "—"}`,
    `  {bold}Related{/}   ${current.relatedTopics.length > 0 ? current.relatedTopics.join(", ") : "—"}`,
    "",
    "  {gray-fg}── Learning Capture (original){/}",
    ...wrap(current.learningCapture, 36).map((line) => `  {gray-fg}${line}{/}`)
  ];
  if (current.refinementReason !== undefined) {
    lines.push("", "  {blue-fg}── Refinement reason ──{/}");
    lines.push(...wrap(current.refinementReason, 36).map((line) => `  ${line}`));
  }
  if (current.existingContent !== undefined) {
    lines.push("", "  {gray-fg}── Existing content ──{/}");
    lines.push(...current.existingContent.split("\n").map((line) => `  {gray-fg}${line}{/}`));
  }
  return lines.join("\n");
}

function buildProposedPane(current: PendingItem): string {
  return [
    "",
    `  {bold}Destination{/} ${current.destinationPath ?? "(no consolidation)"}`,
    "",
    ...current.proposedContent.split("\n").map((line) => `  ${line}`)
  ].join("\n");
}

async function suspendAndEdit(
  screen: Blessed.Widgets.Screen,
  initialContent: string,
  extension: string
): Promise<string | undefined> {
  const editor = process.env.VISUAL ?? process.env.EDITOR;
  if (editor === undefined || editor.trim().length === 0) {
    return undefined;
  }

  const directory = await mkdtemp(join(tmpdir(), "onix-review-"));
  const filePath = join(directory, `review-action${extension}`);

  try {
    await writeFile(filePath, initialContent);
    const exitCode = await runEditorSuspending(screen, editor, filePath);
    if (exitCode !== 0) {
      return undefined;
    }

    return await readFile(filePath, "utf8");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function runEditorSuspending(
  screen: Blessed.Widgets.Screen,
  editor: string,
  filePath: string
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = (screen as unknown as {
      spawn: (file: string, args: string[], options?: { stdio?: "inherit" }) => {
        on: (event: "exit" | "error", listener: (value: unknown) => void) => void;
      };
    }).spawn("sh", ["-c", `${editor} ${quoteShellArgument(filePath)}`]);
    child.on("error", (error) => reject(error as Error));
    child.on("exit", (code) => resolve(typeof code === "number" ? code : null));
  });
}

type ModalKey = { name?: string; ctrl?: boolean; full?: string };

async function loadVaultNotePaths(vaultPath: string): Promise<string[]> {
  const indexPath = join(vaultPath, ".onix", "indexes", "vault-index.json");
  try {
    const raw = await readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw) as { notes?: Array<{ path?: string }> };
    return (parsed.notes ?? [])
      .map((note) => note.path)
      .filter((path): path is string => typeof path === "string" && path.length > 0);
  } catch {
    return [];
  }
}

async function promptForPath(
  blessed: typeof Blessed,
  screen: Blessed.Widgets.Screen,
  candidates: string[],
  initialValue: string,
  attach: (handler: (ch: string, key: ModalKey | undefined) => void) => void,
  detach: () => void
): Promise<string | undefined> {
  return await new Promise((resolve) => {
    const maxVisible = 8;

    const overlay = blessed.box({
      parent: screen,
      top: "center",
      left: "center",
      width: "80%",
      height: maxVisible + 8,
      border: { type: "line" },
      style: { border: { fg: "cyan" } },
      label: " Move destination ",
      tags: true
    });

    blessed.text({
      parent: overlay,
      top: 0,
      left: 1,
      right: 1,
      height: 2,
      tags: true,
      content:
        "{gray-fg}Type a path. Matching notes appear below.{/}\n" +
        "{gray-fg}↑↓ pick a match · Tab autocomplete · Enter confirm (free path allowed) · Esc cancel{/}"
    });

    const inputField = blessed.box({
      parent: overlay,
      top: 3,
      left: 1,
      right: 1,
      height: 1,
      tags: false,
      style: { fg: "white", bg: "black" }
    });

    const matchesPane = blessed.box({
      parent: overlay,
      top: 5,
      left: 1,
      right: 1,
      height: maxVisible,
      tags: true,
      style: { fg: "white" }
    });

    const footer = blessed.text({
      parent: overlay,
      top: 5 + maxVisible,
      left: 1,
      right: 1,
      height: 1,
      tags: true,
      content: ""
    });

    let buffer = initialValue;
    let highlight = -1;
    let scrollOffset = 0;
    let matches: string[] = [];

    const filterMatches = (): string[] => {
      const needle = buffer.toLowerCase();
      if (needle.length === 0) return candidates.slice();
      return candidates.filter((path) => path.toLowerCase().includes(needle));
    };

    const renderInput = (): void => {
      inputField.setContent(` ${buffer}█`);
    };

    const ensureHighlightVisible = (): void => {
      if (highlight < 0) {
        scrollOffset = 0;
        return;
      }
      if (highlight < scrollOffset) {
        scrollOffset = highlight;
      } else if (highlight >= scrollOffset + maxVisible) {
        scrollOffset = highlight - maxVisible + 1;
      }
    };

    const renderFooter = (): void => {
      if (matches.length <= maxVisible) {
        footer.setContent("");
        return;
      }
      const visibleStart = scrollOffset + 1;
      const visibleEnd = Math.min(matches.length, scrollOffset + maxVisible);
      const hasAbove = scrollOffset > 0;
      const hasBelow = visibleEnd < matches.length;
      const arrows = `${hasAbove ? "↑" : " "}${hasBelow ? "↓" : " "}`;
      footer.setContent(
        `  {gray-fg}${visibleStart}-${visibleEnd} of ${matches.length}  ${arrows}{/}`
      );
    };

    const renderMatches = (): void => {
      if (matches.length === 0) {
        matchesPane.setContent("  {gray-fg}(no matches — Enter will create a new path){/}");
        renderFooter();
        return;
      }
      const visibleEnd = Math.min(matches.length, scrollOffset + maxVisible);
      const visible = matches.slice(scrollOffset, visibleEnd);
      matchesPane.setContent(
        visible
          .map((path, index) => {
            const absoluteIndex = scrollOffset + index;
            const marker = absoluteIndex === highlight ? "▸" : " ";
            const styled =
              absoluteIndex === highlight ? `{cyan-fg}{bold}${path}{/bold}{/cyan-fg}` : path;
            return `  ${marker} ${styled}`;
          })
          .join("\n")
      );
      renderFooter();
    };

    const recompute = (): void => {
      matches = filterMatches();
      if (highlight >= matches.length) highlight = matches.length - 1;
      ensureHighlightVisible();
      renderInput();
      renderMatches();
      screen.render();
    };

    let settled = false;
    const finish = (value: string | undefined): void => {
      if (settled) return;
      settled = true;
      detach();
      overlay.destroy();
      screen.render();
      resolve(value);
    };

    attach((ch, key) => {
      if (key === undefined) return;
      const name = key.name;
      if (name === "escape" || (key.ctrl === true && name === "c")) {
        finish(undefined);
        return;
      }
      if (name === "return" || name === "enter") {
        if (highlight >= 0 && matches[highlight] !== undefined) {
          finish(matches[highlight]);
        } else {
          finish(buffer);
        }
        return;
      }
      if (name === "tab") {
        const target = highlight >= 0 ? matches[highlight] : matches[0];
        if (target !== undefined) {
          buffer = target;
          matches = filterMatches();
          highlight = matches.length > 0 ? 0 : -1;
          ensureHighlightVisible();
          renderInput();
          renderMatches();
          screen.render();
        }
        return;
      }
      if (name === "down") {
        if (matches.length === 0) return;
        highlight = Math.min(matches.length - 1, highlight + 1);
        ensureHighlightVisible();
        renderMatches();
        screen.render();
        return;
      }
      if (name === "up") {
        if (matches.length === 0) return;
        if (highlight <= 0) {
          highlight = -1;
          scrollOffset = 0;
        } else {
          highlight -= 1;
          ensureHighlightVisible();
        }
        renderMatches();
        screen.render();
        return;
      }
      if (name === "pageup") {
        if (matches.length === 0) return;
        highlight = Math.max(0, (highlight < 0 ? 0 : highlight) - maxVisible);
        ensureHighlightVisible();
        renderMatches();
        screen.render();
        return;
      }
      if (name === "pagedown") {
        if (matches.length === 0) return;
        highlight = Math.min(matches.length - 1, (highlight < 0 ? -1 : highlight) + maxVisible);
        ensureHighlightVisible();
        renderMatches();
        screen.render();
        return;
      }
      if (name === "backspace") {
        buffer = buffer.slice(0, -1);
        highlight = -1;
        recompute();
        return;
      }
      if (typeof ch === "string" && ch.length === 1 && ch >= " " && ch !== "\x7f") {
        buffer += ch;
        highlight = -1;
        recompute();
      }
    });

    recompute();
  });
}


async function runLinePromptReview(vaultPath: string, planId: string, io: InteractiveReviewIo): Promise<void> {
  const plan = await readPatchPlan(vaultPath, planId);
  const approvalState = await readApprovalState(vaultPath, planId);
  const decidedItemIds = new Set(approvalState.decisions.map((decision) => decision.itemId));
  const pendingItems = plan.items.filter((item) => !decidedItemIds.has(item.id));
  const palette = createPalette(io.output as { isTTY?: boolean });

  writeLine(io.output, "");
  writeLine(io.output, palette.cyan("Interactive Integrated Review"));
  writeLine(io.output, `${palette.dim("Patch Plan:")} ${plan.planId}`);
  writeLine(io.output, `${palette.dim("Pending Review Items:")} ${pendingItems.length}`);
  writeLine(io.output, `${palette.dim("Already Decided Items:")} ${decidedItemIds.size}`);

  if (pendingItems.length === 0) {
    writeLine(io.output, palette.dim("No pending Review Actions."));
    return;
  }

  const review = new LinePrompt(io.input, io.output);
  let currentIndex = 0;

  while (currentIndex < pendingItems.length) {
    const item = pendingItems[currentIndex];
    if (item === undefined) {
      return;
    }

    renderItem(io.output, palette, item, currentIndex, pendingItems.length);

    const action = await askForAction(review, io.output, palette, item);
    if (action === "quit") {
      writeLine(io.output, palette.yellow("Review paused."));
      return;
    }

    if (action === "next" || action === "skip") {
      if (action === "skip") {
        writeLine(io.output, palette.yellow(`Skipped ${item.id}`));
      }

      if (currentIndex === pendingItems.length - 1) {
        if (action === "next") {
          writeLine(io.output, palette.yellow("Already at last pending item."));
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
        writeLine(io.output, palette.yellow("Already at first pending item."));
      } else {
        currentIndex -= 1;
      }

      continue;
    }

    await recordReviewAction(vaultPath, planId, action);
    writeLine(io.output, palette.green(`Recorded ${action.action} for ${action.itemId}`));
    currentIndex += 1;
  }
}

async function askForAction(
  review: LinePrompt,
  output: Writable,
  palette: Palette,
  item: PendingItem
): Promise<InteractiveAction> {
  const promptText = buildActionPrompt(palette);

  while (true) {
    const answerInput = await review.question(promptText);
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
        writeLine(output, palette.yellow(`Edit canceled for ${item.id}; item remains pending.`));
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
        writeLine(output, palette.yellow(`Split canceled for ${item.id}; item remains pending.`));
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

function renderItem(
  output: Writable,
  palette: Palette,
  item: PendingItem,
  index: number,
  total: number
): void {
  writeLine(output, "");
  writeLine(output, palette.cyan(`Item ${index + 1} of ${total}`));
  writeLine(
    output,
    `${palette.dim("Destination:")} ${item.destinationPath ?? palette.dim("No Consolidation")}`
  );
  writeLine(output, `${palette.dim("ID:")} ${palette.dim(item.id)}`);
  writeLine(output, `${palette.dim("Kind:")} ${colorizeKind(palette, item.kind)}`);
  writeLine(output, `${palette.dim("Source:")} ${palette.dim(item.sourceTrace)}`);
  writeLine(output, `${palette.dim("Learning Capture:")} ${item.learningCapture}`);

  if (item.primaryTopic !== undefined) {
    writeLine(output, `${palette.dim("Primary Topic:")} ${item.primaryTopic}`);
  }

  if (item.relatedTopics.length > 0) {
    writeLine(output, `${palette.dim("Related Topics:")} ${item.relatedTopics.join(", ")}`);
  }

  writeLine(output, `${palette.dim("Proposed Content:")} ${item.proposedContent}`);
}

function colorizeKind(palette: Palette, kind: PendingItem["kind"]): string {
  switch (kind) {
    case "consolidated-knowledge":
      return palette.green(kind);
    case "knowledge-refinement":
      return palette.blue(kind);
    case "research-candidate":
      return palette.yellow(kind);
    case "reference-item":
      return palette.magenta(kind);
    case "sensitive-candidate":
      return palette.red(kind);
    case "no-consolidation-candidate":
      return palette.dim(kind);
  }
}

function buildActionPrompt(palette: Palette): string {
  const key = (letter: string): string => `[${palette.bold(letter)}]`;
  return `Choose action ${key("a")}pprove, ${key("e")}dit, ${key("m")}ove, ${key("s")}plit, ${key("d")}iscard, ${key("n")}ext, ${key("p")}revious, s${key("k")}ip, ${key("q")}uit: `;
}

function normalizeAnswer(answer: string): string {
  return answer.trim().toLowerCase();
}

function writeLine(output: Writable, line: string): void {
  output.write(`${line}\n`);
}

function wrap(value: string, width: number): string[] {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > width) {
      if (current.length > 0) lines.push(current);
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
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
