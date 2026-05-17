import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type GlobalConfig = {
  schemaVersion: 1;
  defaultVault?: string;
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
        : {})
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
