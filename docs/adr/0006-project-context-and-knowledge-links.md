# ADR 0006: Project Context and Knowledge Links

## Status

Accepted.

## Context

Users close sessions by dumping raw text, such as notes, chat excerpts, commands, and logs, into the **Session Inbox**. The **Live Proposal Engine** asked only for "atomic **Learning Captures**". On large dumps this produced fragments: one procedure split across several items, or several items with no context on when to apply them.

Much of that learning comes up while working on a specific project. The vault keeps one note per project under `Projects/`. The domain had no project concept, so the engine had two bad options:
- store reusable knowledge inside a project note, where other projects cannot find it;
- store it in a **Knowledge Topic** and lose the trace of where it was applied.

`relatedTopics` was never rendered as a link, so nothing connected the two places.

## Decision

- **Applicable Blocks.** The system prompt requires each item to be an **Applicable Block**: it says when it applies, what it is, and how to apply it. Scattered lines about the same subject are grouped into one block, and unrelated subjects are never merged.
- **Projects Folder.** Project notes are detected by folder. Every Vault Index note under `Projects/` is a **Project Note**. Their paths and titles are sent to the engine as `projects`.
- **Routing.** The engine asks whether a block would still be useful outside the project where it came up.
  - If yes, it is `consolidated-knowledge` / `knowledge-refinement` in its **Knowledge Topic**. It may carry `project` (a listed Project Note path) and `projectUsage` (one sentence on how it was used there).
  - If no, it is the new `project-context` kind, written to the Project Note.
- **Validation after the LLM** (`sanitizeProjectRouting`):
  - `project` / `projectUsage` are dropped when the project is not listed or the kind is not a knowledge kind.
  - A `project-context` outside the Projects Folder is demoted to `consolidated-knowledge`.
- **Knowledge Links are deterministic.** `apply`, not the LLM, writes `- <projectUsage> → [[<topic path>#<first heading>]]` into the Project Note.
  - The link is derived from the reviewed destination and content, so edit and move keep it valid.
  - Links go under `## Knowledge links`. The section is created when missing.
  - A discarded item produces no link.

## Rationale

Keeping reusable knowledge in one place avoids duplicates that drift apart. The project still records where and why the knowledge was used, which is the part that is truly project-specific.

Deriving the link at apply time means the model never invents targets. The link always points to the destination the user approved.

Folder detection needs no configuration and fits the PARA-style vaults Onix targets. It can become configurable later, like the **Write Boundary** in ADR 0004.

## Consequences

- `ProposalEngineInput` gains `projects` (defaults to `[]`). `PatchPlan` items gain `project-context`, `project` and `projectUsage`. The schema stays at version 1 because every new field is optional.
- The stub engine does not produce the new fields.
- The Projects Folder is fixed to `Projects/` for now.
