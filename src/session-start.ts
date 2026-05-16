import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { storeLayout } from "./operational-store/layout.js";

const visibleSessionInboxDirectory = posix.join("Onix", "Sessions");

export type ActiveSession = {
  schemaVersion: 1;
  startedAt: string;
  inboxPath: string;
};

export type StartSessionResult = {
  activeSession: ActiveSession;
};

export class ActiveSessionAlreadyExistsError extends Error {
  constructor(readonly activeSession: ActiveSession) {
    super(`An Ephemeral Session is already active: ${activeSession.inboxPath}`);
    this.name = "ActiveSessionAlreadyExistsError";
    Object.setPrototypeOf(this, ActiveSessionAlreadyExistsError.prototype);
  }
}

export async function startSession(vaultPath: string, now = new Date()): Promise<StartSessionResult> {
  const layout = storeLayout(".onix");
  const existingActiveSession = await readActiveSession(vaultPath);

  if (existingActiveSession !== undefined) {
    throw new ActiveSessionAlreadyExistsError(existingActiveSession);
  }

  const timestamp = formatTimestamp(now);
  const inboxPath = posix.join(visibleSessionInboxDirectory, `session-inbox-${timestamp}.md`);
  const activeSession: ActiveSession = {
    schemaVersion: 1,
    startedAt: now.toISOString(),
    inboxPath
  };

  await mkdir(join(vaultPath, visibleSessionInboxDirectory), { recursive: true });
  await mkdir(join(vaultPath, ".onix", "state"), { recursive: true });
  await writeFile(join(vaultPath, inboxPath), "", { flag: "wx" });
  await writeFile(join(vaultPath, layout.transient.activeSession), JSON.stringify(activeSession, null, 2), {
    flag: "wx"
  });

  return { activeSession };
}

async function readActiveSession(vaultPath: string): Promise<ActiveSession | undefined> {
  const layout = storeLayout(".onix");

  try {
    const activeSessionJson = await readFile(join(vaultPath, layout.transient.activeSession), "utf8");

    return JSON.parse(activeSessionJson) as ActiveSession;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

function formatTimestamp(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");

  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
