import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const operationalStoreDirectoryName = ".onix";
const operationalStoreGitignoreFileName = ".gitignore";

const transientEntries = ["state/", "indexes/", "plans/", "approvals/", "logs/", "cache/"];

export async function ensureOperationalStoreGitignore(vaultPath: string): Promise<void> {
  const operationalStoreRoot = join(vaultPath, operationalStoreDirectoryName);
  const gitignorePath = join(operationalStoreRoot, operationalStoreGitignoreFileName);

  await mkdir(operationalStoreRoot, { recursive: true });

  try {
    await writeFile(gitignorePath, renderGitignore(), { flag: "wx" });
  } catch (error) {
    if (isFileAlreadyExistsError(error)) {
      return;
    }

    throw error;
  }
}

function renderGitignore(): string {
  return `${transientEntries.join("\n")}\n`;
}

function isFileAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST";
}
