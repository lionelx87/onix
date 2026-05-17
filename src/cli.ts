import { Command } from "@commander-js/extra-typings";
import type { Readable, Writable } from "node:stream";
import { recordReviewAction, type ReviewActionInput } from "./approval-state.js";
import { runInteractiveReview } from "./interactive-review.js";
import { renderIntegratedReview } from "./integrated-review.js";
import { storeLayout } from "./operational-store/layout.js";
import { closeSession, NoActiveSessionError, SessionInboxNotFoundError } from "./session-close.js";
import { ActiveSessionAlreadyExistsError, startSession } from "./session-start.js";

export type CliIo = {
  input?: Readable;
  output?: Writable;
};

export function createCli(io: CliIo = {}): Command {
  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;
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
    .option("--no-review", "generate the Patch Plan without launching interactive Integrated Review")
    .action(async (closeOptions) => {
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

      if (closeOptions.review !== false && plan.items.length > 0) {
        await runInteractiveReview(vaultPath, plan.planId, { input, output });
      }
    });

  program
    .command("review")
    .description("render or update the Integrated Review for a Patch Plan")
    .argument("<plan-id>", "Patch Plan identifier")
    .option("--approve <item-id>", "record approve Review Action for a Patch Plan item")
    .option("--edit <item-id>", "record edit Review Action for a Patch Plan item")
    .option("--move <item-id>", "record move Review Action for a Patch Plan item")
    .option("--split <item-id>", "record split Review Action for a Patch Plan item")
    .option("--discard <item-id>", "record discard Review Action for a Patch Plan item")
    .option("--content <markdown>", "edited Consolidated Knowledge content for --edit")
    .option("--destination <path>", "new destination note path for --move")
    .option("--part <markdown>", "split part content for --split", collectOption, [] as string[])
    .option("--render", "render Review Markdown without recording Approval State")
    .action(async (planId, reviewOptions) => {
      const options = program.opts();
      const vaultPath = requireVaultPath(program, options.vault);

      const action = reviewActionFromOptions(program, reviewOptions);
      if (action !== undefined) {
        await recordReviewAction(vaultPath, planId, action);
        console.log(`Recorded ${action.action} for ${action.itemId}`);
        return;
      }

      if (reviewOptions.render === true) {
        console.log(await renderIntegratedReview(vaultPath, planId));
        return;
      }

      await runInteractiveReview(vaultPath, planId, { input, output });
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

function reviewActionFromOptions(
  program: Command,
  options: {
    approve?: string;
    edit?: string;
    move?: string;
    split?: string;
    discard?: string;
    content?: string;
    destination?: string;
    part?: string[];
  }
): ReviewActionInput | undefined {
  if (options.approve !== undefined) {
    return { action: "approve", itemId: options.approve };
  }

  if (options.edit !== undefined) {
    if (options.content === undefined) {
      program.error("Missing edited content. Run: onix --vault <path> review <plan-id> --edit <item-id> --content <markdown>");
    }

    return { action: "edit", itemId: options.edit, content: options.content };
  }

  if (options.move !== undefined) {
    if (options.destination === undefined) {
      program.error("Missing destination. Run: onix --vault <path> review <plan-id> --move <item-id> --destination <path>");
    }

    return { action: "move", itemId: options.move, destinationPath: options.destination };
  }

  if (options.split !== undefined) {
    if (options.part === undefined || options.part.length < 2) {
      program.error(
        "Missing split parts. Run: onix --vault <path> review <plan-id> --split <item-id> --part <markdown> --part <markdown>"
      );
    }

    return { action: "split", itemId: options.split, parts: options.part };
  }

  if (options.discard !== undefined) {
    return { action: "discard", itemId: options.discard };
  }

  return undefined;
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
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
