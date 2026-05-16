import { Command } from "@commander-js/extra-typings";
import { storeLayout } from "./operational-store/layout.js";

export function createCli(): Command {
  const program = new Command()
    .name("onix")
    .description("Local CLI for Learning Capture workflows in an Obsidian vault")
    .version("0.1.0")
    .option("--vault <path>", "path to the local Obsidian vault", process.cwd());

  program
    .command("start")
    .description("start an Ephemeral Session and create a dated Session Inbox")
    .action(() => {
      printPlaceholder("Session Start");
    });

  program
    .command("close")
    .description("close the Active Session and generate a reviewable Patch Plan")
    .option("--stub <fixture>", "use a deterministic Proposal Engine fixture")
    .action(() => {
      printPlaceholder("Session Closing");
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
