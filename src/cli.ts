import { Command } from "@commander-js/extra-typings";
import { storeLayout } from "./operational-store/layout.js";
import { closeSession, NoActiveSessionError, SessionInboxNotFoundError } from "./session-close.js";
import { ActiveSessionAlreadyExistsError, startSession } from "./session-start.js";

export function createCli(): Command {
  const program = new Command()
    .name("onix")
    .description("Local CLI for Learning Capture workflows in an Obsidian vault")
    .version("0.1.0")
    .option("--vault <path>", "path to the local Obsidian vault");

  program
    .command("start")
    .description("start an Ephemeral Session and create a dated Session Inbox")
    .action(async () => {
      const options = program.opts();
      const vaultPath = requireVaultPath(program, options.vault);

      const { activeSession } = await startSession(vaultPath).catch((error: unknown) => {
        if (isActiveSessionAlreadyExistsError(error)) {
          program.error(error.message);
        }

        throw error;
      });

      console.log("Started Ephemeral Session");
      console.log(`Session Inbox: ${activeSession.inboxPath}`);
    });

  program
    .command("close")
    .description("close the Active Session and generate a reviewable Patch Plan")
    .option("--stub <fixture>", "use a deterministic Proposal Engine fixture")
    .action(async () => {
      const options = program.opts();
      const vaultPath = requireVaultPath(program, options.vault);

      const { plan, reviewRendering } = await closeSession(vaultPath).catch((error: unknown) => {
        if (isNoActiveSessionError(error) || isSessionInboxNotFoundError(error)) {
          program.error(error.message);
        }

        throw error;
      });

      console.log(`Generated Patch Plan: ${plan.planId}`);
      console.log(reviewRendering);
    });

  program
    .command("review")
    .description("render or update the Integrated Review for a Patch Plan")
    .argument("[plan-id]", "Patch Plan identifier")
    .action(() => {
      printPlaceholder("Integrated Review");
    });

  program
    .command("apply")
    .description("apply approved changes after Commit Validation")
    .argument("[plan-id]", "Patch Plan identifier")
    .action(() => {
      printPlaceholder("patch application");
    });

  program
    .command("status")
    .description("show Active Session and Operational Store status")
    .action(() => {
      const layout = storeLayout(".onix");
      program.opts();
      console.log("Onix status");
      console.log(`Operational Store: ${layout.root}`);
      console.log(`Versioned Tool State: ${layout.versioned.config}, ${layout.versioned.classificationRules}`);
      console.log(`Transient state: ${Object.values(layout.transient).join(", ")}`);
    });

  return program;
}

function printPlaceholder(surface: string): void {
  console.log(`${surface} is scaffolded. Implementation will land in a later tracer bullet.`);
}

function requireVaultPath(program: Command, vaultPath: string | undefined): string {
  if (vaultPath === undefined) {
    program.error("Missing vault path. Run: onix --vault <path> start");
    throw new Error("Missing vault path");
  }

  return vaultPath;
}

function isActiveSessionAlreadyExistsError(error: unknown): error is ActiveSessionAlreadyExistsError {
  return (
    error instanceof ActiveSessionAlreadyExistsError ||
    (error instanceof Error &&
      (error.name === "ActiveSessionAlreadyExistsError" ||
        error.message.startsWith("An Ephemeral Session is already active:")))
  );
}

function isNoActiveSessionError(error: unknown): error is NoActiveSessionError {
  return (
    error instanceof NoActiveSessionError ||
    (error instanceof Error &&
      (error.name === "NoActiveSessionError" || error.message.startsWith("No Active Session found.")))
  );
}

function isSessionInboxNotFoundError(error: unknown): error is SessionInboxNotFoundError {
  return (
    error instanceof SessionInboxNotFoundError ||
    (error instanceof Error &&
      (error.name === "SessionInboxNotFoundError" ||
        error.message.startsWith("Active Session state exists, but its Session Inbox could not be located.")))
  );
}
