import { Command } from "@commander-js/extra-typings";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { recordReviewAction, type ReviewActionInput } from "./approval-state.js";
import { approveClassificationRule } from "./classification-rules.js";
import { readGlobalConfig, updateGlobalConfig } from "./global-config.js";
import { ensureEditorConfigured, resolveEditor } from "./editor-resolver.js";
import { runCloseTui } from "./cli/close-tui.js";
import { runStatusDashboard } from "./cli/status-tui.js";
import { runInteractiveReview } from "./interactive-review.js";
import { renderIntegratedReview } from "./integrated-review.js";
import { applySession } from "./session-apply.js";
import { closeSession, NoActiveSessionError, SessionInboxNotFoundError } from "./session-close.js";
import { DEFAULT_MODEL, MissingLlmCredentialsError } from "./proposal-engine/factory.js";
import { ActiveSessionAlreadyExistsError, startSession } from "./session-start.js";
import { buildStatusReport, renderStatusReport } from "./status.js";

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
    .command("use")
    .description("set, show, or clear the default vault used when --vault is omitted")
    .argument("[path]", "absolute or relative path to an existing vault directory")
    .option("--clear", "remove the persisted default vault")
    .action(async (path, useOptions) => {
      if (useOptions.clear === true) {
        const config = await readGlobalConfig();
        if (config.defaultVault === undefined) {
          console.log("No default vault to clear.");
          return;
        }

        const previous = config.defaultVault;
        await updateGlobalConfig({ defaultVault: undefined });
        console.log(`Cleared default vault: ${previous}`);
        return;
      }

      if (path === undefined) {
        const config = await readGlobalConfig();
        if (config.defaultVault === undefined) {
          console.log("No default vault set. Run: onix use <path>");
          return;
        }

        console.log(`Default vault: ${config.defaultVault}`);
        return;
      }

      const absolutePath = resolve(path);
      const stats = await stat(absolutePath).catch(() => undefined);
      if (stats === undefined || !stats.isDirectory()) {
        program.error(`Vault path does not exist or is not a directory: ${absolutePath}`);
        return;
      }

      await updateGlobalConfig({ defaultVault: absolutePath });
      console.log(`Default vault set to: ${absolutePath}`);
    });

  program
    .command("editor")
    .description("set, show, or clear the editor used for edit/split review actions")
    .argument("[command]", "editor command, e.g. 'vim', 'nano', 'code -w'")
    .option("--clear", "remove the persisted editor")
    .action(async (command, editorOptions) => {
      if (editorOptions.clear === true) {
        const config = await readGlobalConfig();
        if (config.editor === undefined && config.editorPromptDeclined !== true) {
          console.log("No editor preference to clear.");
          return;
        }

        const previous = config.editor;
        await updateGlobalConfig({ editor: undefined, editorPromptDeclined: undefined });
        if (previous === undefined) {
          console.log("Cleared editor preference; first-run prompt is re-enabled.");
        } else {
          console.log(`Cleared editor: ${previous}`);
        }
        return;
      }

      if (command === undefined) {
        const config = await readGlobalConfig();
        const resolved = resolveEditor(config);
        if (resolved === undefined) {
          console.log("No editor configured. Run: onix editor <command>");
          return;
        }

        const sourceLabel = ((): string => {
          if (process.env.VISUAL !== undefined && process.env.VISUAL.trim().length > 0) {
            return "from $VISUAL";
          }
          if (process.env.EDITOR !== undefined && process.env.EDITOR.trim().length > 0) {
            return "from $EDITOR";
          }
          return "from global config";
        })();

        console.log(`Editor: ${resolved} (${sourceLabel})`);
        return;
      }

      const trimmed = command.trim();
      if (trimmed.length === 0) {
        program.error("Editor command cannot be empty.");
        return;
      }

      await updateGlobalConfig({ editor: trimmed, editorPromptDeclined: undefined });
      console.log(`Editor set to: ${trimmed}`);
    });

  program
    .command("model")
    .description("set, show, or clear the LLM model used by the live Proposal Engine")
    .argument("[id]", "model id, e.g. 'gpt-5.5', 'gpt-5.4'")
    .option("--clear", "remove the persisted model preference")
    .action(async (id, modelOptions) => {
      if (modelOptions.clear === true) {
        const config = await readGlobalConfig();
        if (config.model === undefined) {
          console.log("No model preference to clear.");
          return;
        }

        const previous = config.model;
        await updateGlobalConfig({ model: undefined });
        console.log(`Cleared model: ${previous}`);
        return;
      }

      if (id === undefined) {
        const config = await readGlobalConfig();
        const fromEnv = process.env.ONIX_MODEL?.trim();
        if (fromEnv !== undefined && fromEnv.length > 0) {
          console.log(`Model: ${fromEnv} (from $ONIX_MODEL)`);
          return;
        }
        if (config.model !== undefined) {
          console.log(`Model: ${config.model} (from global config)`);
          return;
        }

        console.log(`Model: ${DEFAULT_MODEL} (default)`);
        return;
      }

      const trimmed = id.trim();
      if (trimmed.length === 0) {
        program.error("Model id cannot be empty.");
        return;
      }

      await updateGlobalConfig({ model: trimmed });
      console.log(`Model set to: ${trimmed}`);
    });

  program
    .command("start")
    .description("start an Ephemeral Session and create a dated Session Inbox")
    .action(async () => {
      const options = program.opts();
      const vaultPath = await requireVaultPath(program, options.vault);

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
    .option("--no-review", "generate the Patch Plan without launching interactive Integrated Review")
    .action(async (closeOptions) => {
      const options = program.opts();
      const vaultPath = await requireVaultPath(program, options.vault);
      const reviewRequested = closeOptions.review !== false;

      if (output === process.stdout && process.stdout.isTTY === true && reviewRequested) {
        await ensureEditorConfigured();
        const tui = await runCloseTui(vaultPath).catch((error: unknown) => {
          if (isNoActiveSessionError(error) || isSessionInboxNotFoundError(error) || isMissingLlmCredentialsError(error)) {
            program.error(error.message);
          }

          throw error;
        });

        if (tui.shouldEnterReview) {
          await runInteractiveReview(vaultPath, tui.plan.planId, { input, output });
        }
        return;
      }

      const { plan, reviewRendering } = await closeSession(vaultPath).catch((error: unknown) => {
        if (isNoActiveSessionError(error) || isSessionInboxNotFoundError(error) || isMissingLlmCredentialsError(error)) {
          program.error(error.message);
        }

        throw error;
      });

      console.log(`Generated Patch Plan: ${plan.planId}`);
      console.log(reviewRendering);

      if (reviewRequested && plan.items.length > 0) {
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
    .option("--approve-rule <rule-id>", "persist a Rule Candidate as a Classification Rule")
    .option("--render", "render Review Markdown without recording Approval State")
    .action(async (planId, reviewOptions) => {
      const options = program.opts();
      const vaultPath = await requireVaultPath(program, options.vault);

      if (reviewOptions.approveRule !== undefined) {
        const rule = await approveClassificationRule(vaultPath, planId, reviewOptions.approveRule);
        console.log(`Persisted Classification Rule ${rule.id} from ${reviewOptions.approveRule}`);
        return;
      }

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

      if (output === process.stdout && process.stdout.isTTY === true) {
        await ensureEditorConfigured();
      }
      await runInteractiveReview(vaultPath, planId, { input, output });
    });

  program
    .command("apply")
    .description("apply approved changes after Commit Validation")
    .argument("[plan-id]", "Patch Plan identifier")
    .action(async (planId) => {
      const options = program.opts();
      const vaultPath = await requireVaultPath(program, options.vault);

      const { versioningReview } = await applySession(vaultPath, planId);
      console.log(versioningReview);
    });

  program
    .command("status")
    .description("show resolved vault, Active Session, Patch Plans, and Classification Rules summary")
    .action(async () => {
      const options = program.opts();
      const config = await readGlobalConfig();
      const resolvedVault = options.vault ?? config.defaultVault;
      const report = await buildStatusReport({
        ...(config.defaultVault === undefined ? {} : { defaultVault: config.defaultVault }),
        ...(resolvedVault === undefined ? {} : { vault: resolvedVault })
      });

      if (output === process.stdout && process.stdout.isTTY === true && resolvedVault !== undefined) {
        const selectedPlanId = await runStatusDashboard(report);
        if (selectedPlanId !== undefined) {
          await ensureEditorConfigured();
          await runInteractiveReview(resolvedVault, selectedPlanId, { input, output });
        }
        return;
      }

      console.log(renderStatusReport(report));
    });

  return program;
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

async function requireVaultPath(program: Command, vaultPath: string | undefined): Promise<string> {
  if (vaultPath !== undefined) {
    return vaultPath;
  }

  const config = await readGlobalConfig();
  if (config.defaultVault !== undefined) {
    return config.defaultVault;
  }

  program.error(
    "Missing vault path. Run: onix --vault <path> start, or set a default with: onix use <path>"
  );
  throw new Error("Missing vault path");
}

function isActiveSessionAlreadyExistsError(error: unknown): error is ActiveSessionAlreadyExistsError {
  return (
    error instanceof ActiveSessionAlreadyExistsError ||
    (error instanceof Error &&
      (error.name === "ActiveSessionAlreadyExistsError" ||
        error.message.startsWith("An Ephemeral Session is already active:")))
  );
}

function isMissingLlmCredentialsError(error: unknown): error is MissingLlmCredentialsError {
  return (
    error instanceof MissingLlmCredentialsError ||
    (error instanceof Error &&
      (error.name === "MissingLlmCredentialsError" || error.message.startsWith("Missing OpenAI credentials.")))
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
