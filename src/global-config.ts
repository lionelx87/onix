import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type GlobalConfig = {
  schemaVersion: 1;
  defaultVault?: string;
  editor?: string;
  editorPromptDeclined?: boolean;
  model?: string;
};

export function globalConfigPath(): string {
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(configHome, "onix", "config.json");
}

export async function readGlobalConfig(): Promise<GlobalConfig> {
  try {
    const raw = await readFile(globalConfigPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<GlobalConfig>;
    return {
      schemaVersion: 1,
      ...(typeof parsed.defaultVault === "string" && parsed.defaultVault.length > 0
        ? { defaultVault: parsed.defaultVault }
        : {}),
      ...(typeof parsed.editor === "string" && parsed.editor.length > 0
        ? { editor: parsed.editor }
        : {}),
      ...(parsed.editorPromptDeclined === true ? { editorPromptDeclined: true } : {}),
      ...(typeof parsed.model === "string" && parsed.model.length > 0 ? { model: parsed.model } : {})
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { schemaVersion: 1 };
    }

    throw error;
  }
}

export async function writeGlobalConfig(config: GlobalConfig): Promise<void> {
  const path = globalConfigPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2));
}

export type GlobalConfigPatch = {
  [K in keyof Omit<GlobalConfig, "schemaVersion">]?: GlobalConfig[K] | undefined;
};

export async function updateGlobalConfig(patch: GlobalConfigPatch): Promise<GlobalConfig> {
  const current = await readGlobalConfig();
  const merged: Record<string, unknown> = { ...current, ...patch };
  const next: GlobalConfig = { schemaVersion: 1 };

  if (typeof merged.defaultVault === "string" && merged.defaultVault.length > 0) {
    next.defaultVault = merged.defaultVault;
  }
  if (typeof merged.editor === "string" && merged.editor.length > 0) {
    next.editor = merged.editor;
  }
  if (merged.editorPromptDeclined === true) {
    next.editorPromptDeclined = true;
  }
  if (typeof merged.model === "string" && merged.model.length > 0) {
    next.model = merged.model;
  }

  await writeGlobalConfig(next);
  return next;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
