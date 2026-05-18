import { stat } from "node:fs/promises";
import { join } from "node:path";
import { intro, isCancel, note, outro, select, text } from "@clack/prompts";
import {
  readGlobalConfig,
  updateGlobalConfig,
  type GlobalConfig
} from "./global-config.js";

const UNIX_CANDIDATES = ["nvim", "vim", "nano", "code -w", "subl -w", "emacs -nw"] as const;
const WINDOWS_CANDIDATES = ["code -w", "notepad"] as const;

export function resolveEditor(config: Pick<GlobalConfig, "editor">): string | undefined {
  const fromEnv = (process.env.VISUAL ?? process.env.EDITOR)?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  if (typeof config.editor === "string" && config.editor.trim().length > 0) {
    return config.editor.trim();
  }
  return undefined;
}

export async function detectAvailableEditors(): Promise<string[]> {
  const candidates = process.platform === "win32" ? WINDOWS_CANDIDATES : UNIX_CANDIDATES;
  const available: string[] = [];
  for (const candidate of candidates) {
    const binary = candidate.split(" ", 1)[0]!;
    if (await isOnPath(binary)) {
      available.push(candidate);
    }
  }
  return available;
}

async function isOnPath(binary: string): Promise<boolean> {
  const pathEnv = process.env.PATH ?? "";
  const separator = process.platform === "win32" ? ";" : ":";
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
    : [""];

  for (const directory of pathEnv.split(separator)) {
    if (directory.length === 0) continue;
    for (const extension of extensions) {
      try {
        const candidate = join(directory, `${binary}${extension}`);
        const stats = await stat(candidate);
        if (stats.isFile()) return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

export type EnsureEditorResult = { editor: string | undefined; configured: boolean };

export async function ensureEditorConfigured(): Promise<EnsureEditorResult> {
  const config = await readGlobalConfig();
  const resolved = resolveEditor(config);
  if (resolved !== undefined) {
    return { editor: resolved, configured: false };
  }
  if (config.editorPromptDeclined === true) {
    return { editor: undefined, configured: false };
  }

  const choice = await runFirstRunPrompt();
  if (choice === "declined") {
    await updateGlobalConfig({ editorPromptDeclined: true });
    return { editor: undefined, configured: true };
  }

  await updateGlobalConfig({ editor: choice });
  return { editor: choice, configured: true };
}

async function runFirstRunPrompt(): Promise<string | "declined"> {
  const detected = await detectAvailableEditors();

  intro("Configure editor for Onix");
  note(
    "Onix needs an external editor for the edit and split review actions.\n" +
      "Pick one now and we will remember it for future runs.",
    "First-time setup"
  );

  const options = [
    ...detected.map((command) => ({ value: command, label: command })),
    { value: "__custom__", label: "Enter a custom command…" },
    { value: "__skip__", label: "Skip (don't ask again)" }
  ];

  const choice = await select({
    message: "Editor command",
    options
  });

  if (isCancel(choice) || choice === "__skip__") {
    outro("Editor setup deferred. Run `onix editor <cmd>` to configure later.");
    return "declined";
  }

  if (choice === "__custom__") {
    const custom = await text({
      message: "Editor command (e.g. 'code -w', 'vim')",
      placeholder: detected[0] ?? "vim",
      validate: (value) => {
        if (typeof value !== "string" || value.trim().length === 0) {
          return "Enter a non-empty command";
        }
        return undefined;
      }
    });

    if (isCancel(custom)) {
      outro("Editor setup canceled. Run `onix editor <cmd>` to configure later.");
      return "declined";
    }

    const trimmed = (custom as string).trim();
    outro(`Editor saved: ${trimmed}`);
    return trimmed;
  }

  const selected = choice as string;
  outro(`Editor saved: ${selected}`);
  return selected;
}
