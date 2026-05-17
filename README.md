# Onix

Local CLI-first Learning Capture tool for existing Obsidian vaults.

Onix starts an Ephemeral Session, gives you a temporary Session Inbox for freeform writing, and later consolidates reviewed learning into stable knowledge notes.

## Requirements

- Node.js 24 LTS
- pnpm 11
- An existing local Obsidian vault

## Local CLI

Run the development CLI from this repository with:

```bash
pnpm onix <command>
```

## Commands

### Start an Ephemeral Session

```bash
pnpm onix --vault /path/to/vault start
```

`--vault` is required. Onix does not infer the target vault from the current working directory, so session state is not created in the wrong place by accident.

This creates:

```text
/path/to/vault/Onix/Sessions/session-inbox-YYYYMMDD-HHMMSS.md
/path/to/vault/.onix/state/active-session.json
```

The Session Inbox is plain Markdown with minimal `onix_session_id` frontmatter, so closing can still find it if the visible note is renamed in Obsidian. It lives in a visible vault folder so you can open it from Obsidian and write Freeform Captures directly into that file during the session. The Active Session metadata stays hidden under `.onix/state/`.

Only one Active Session can exist at a time. Running `start` again for the same vault fails until the current session is closed.

### Close an Active Session

```bash
pnpm onix --vault /path/to/vault close
```

`--vault` is required. `close` reads the Active Session, finds the Session Inbox even if the visible note was renamed, strips the session frontmatter, updates the Vault Index, selects Candidate Notes, and sends that input to the Proposal Engine. After generating the Patch Plan, `close` starts an interactive Integrated Review by default.

The current Proposal Engine is deterministic and provider-independent. It writes a structured Patch Plan, prints a Markdown Review Rendering, and then prompts for Review Actions in the terminal:

```text
/path/to/vault/.onix/indexes/vault-index.json
/path/to/vault/.onix/plans/stubbed-plan.json
/path/to/vault/.onix/approvals/stubbed-plan.json
```

The generated Patch Plan can contain Consolidated Knowledge, Knowledge Refinements, Research Candidates, Reference Items, Sensitive Candidates, and No Consolidation Candidates. It records the original Learning Capture, source trace, Primary Topic, Related Topics, destination path when applicable, and proposed content. Tests use deterministic fixtures and do not call a live LLM.

Duplicate handling runs against the Candidate Notes selected from the Vault Index:

- A Freeform Capture that matches an existing paragraph becomes a No Consolidation Candidate.
- A Freeform Capture that contains an existing paragraph and adds new detail becomes a Knowledge Refinement, with the existing paragraph as `existingContent`, the strengthened text as `proposedContent`, and a `refinementReason`.

Knowledge Refinements appear in the Review Rendering as Before, After, and Reason instead of a single Proposed Content block.

Use `--no-review` when automation or tests need to generate the Patch Plan without launching the interactive review:

```bash
pnpm onix --vault /path/to/vault close --no-review
```

### Review an Organization Proposal

Resume or start the interactive Integrated Review for a generated Patch Plan:

```bash
pnpm onix --vault /path/to/vault review stubbed-plan
```

`--vault` is required. The argument is the Patch Plan identifier stored under `.onix/plans/<plan-id>.json`. The interactive review presents each pending item with progress, destination note, source trace, Learning Capture, and proposed content. Choose actions with the prompted keys: approve, edit, move, split, discard, next, previous, skip, or quit. `next`, `previous`, `skip`, and `quit` do not record a decision, so a review can be resumed later.

Human editing uses your terminal editor. Onix opens `$VISUAL` first, then `$EDITOR`, with the proposed content already written into a temporary Markdown file:

```bash
VISUAL="code --wait" pnpm onix --vault /path/to/vault review stubbed-plan
EDITOR=vim pnpm onix --vault /path/to/vault review stubbed-plan
```

For `edit`, saving and closing the editor records an `edit` Review Action with the saved file content. If no editor is configured, the editor exits with a failure code, or the saved content is empty, the item remains pending and no Approval State is recorded.

For `split`, Onix opens a template with the proposed content prefilled. Keep at least two non-empty sections separated by this marker line:

```text
--- part ---
```

Saving a valid template records a `split` Review Action. Invalid templates remain pending and do not write Approval State.

Review Actions write structured Approval State:

```text
/path/to/vault/.onix/approvals/stubbed-plan.json
```

Render the Markdown Review Rendering without recording Approval State:

```bash
pnpm onix --vault /path/to/vault review stubbed-plan --render
```

The low-level action flags remain available for automation and focused tests:


```bash
pnpm onix --vault /path/to/vault review stubbed-plan --approve item-1
pnpm onix --vault /path/to/vault review stubbed-plan --edit item-1 --content "Updated durable learning."
pnpm onix --vault /path/to/vault review stubbed-plan --move item-1 --destination "Knowledge/Review Workflows.md"
pnpm onix --vault /path/to/vault review stubbed-plan --split item-1 --part "First durable learning." --part "Second durable learning."
pnpm onix --vault /path/to/vault review stubbed-plan --discard item-1
```

Editing copied Review Markdown directly is not treated as approval. The apply step will use the Approval State file, not freeform Markdown edits.

### Approve a Classification Rule

Each `move` Review Action generates a Rule Candidate in the transient Approval State, recording the moved Learning Capture as a substring `pattern` paired with the new destination. Rule Candidates are not active until you approve them explicitly:

```bash
pnpm onix --vault /path/to/vault review stubbed-plan --approve-rule rule-candidate-1
```

`--vault` and the Patch Plan identifier are required. Approval writes a Classification Rule to the versioned Classification Rules Store:

```text
/path/to/vault/.onix/classification-rules.json
```

This file is the only piece of state under `.onix/` that is treated as Versioned Tool State suitable for Git. Generated plans, Approval State, indexes, logs, and caches stay transient. Without `--approve-rule`, a Rule Candidate never leaves the Approval State, so `apply` cannot silently turn corrections into rules.

On the next `close`, the Proposal Engine consults the Classification Rules Store. A Freeform Capture whose text contains a stored rule's `pattern` (case-insensitive substring match) is routed to that rule's `destinationPath` instead of the default heuristic, so repeated organization preferences stay applied without re-correcting every session.

### Apply Approved Consolidated Knowledge

```bash
pnpm onix --vault /path/to/vault apply stubbed-plan
```

`--vault` is required. The optional argument is the Patch Plan identifier stored under `.onix/plans/<plan-id>.json`; when there is exactly one Patch Plan, `apply` can infer it.

`apply` reads the Patch Plan and Approval State, validates every destination against the Write Boundary, runs Commit Validation to stop if a destination changed after proposal generation, and writes only approved, edited, moved, or split Review Actions. Discarded items are not written, and pending items are ignored.

Approved Knowledge Refinements replace the matching `existingContent` paragraph in the destination note in place rather than appending. If the paragraph no longer exists in the destination, `apply` stops with a `Refinement target not found` error so the proposal can be regenerated.

Approved Consolidated Knowledge is written to thematic vault files inside the initial Write Boundary:

```text
Knowledge/
Onix/Research Inbox.md
References/
Reference Library/
```

Approved Research Candidates are written to `Onix/Research Inbox.md` under their suggested topic. Approved Reference Items are written under `Reference Library/` by topic and include a link back to the learning topic when that improves traceability. Discarded and pending items are not written.

After write verification succeeds, `apply` deletes the Session Inbox and Active Session state. It ends with a Versioning Review that lists changed vault files for manual Git review. It does not create Git commits.

Minimal usage after review:

```bash
pnpm onix --vault /path/to/vault apply stubbed-plan
```

### Scaffolded Commands

These command surfaces exist for the MVP workflow but are not fully implemented yet:

```bash
pnpm onix status
```

`status` currently prints the Operational Store layout.

## Development

```bash
pnpm test
pnpm typecheck
pnpm build
```

`pnpm test` includes `test/integration-flow.test.ts`, which walks the full local Learning Capture flow against a fixture vault: Session Start, freeform captures, Session Closing with the deterministic Proposal Engine, structured Review Actions (one approve, one edit, one discard, two approves across Research Inbox and Reference Library), apply with destination grouping, Session Inbox cleanup, and Versioning Review output. The fixture pre-populates `Knowledge/`, `Onix/Research Inbox.md`, and `Reference Library/` to exercise existing Knowledge Topics. A second integration case asserts that an apply aborted before write verification (here, a Write Boundary violation) leaves the Session Inbox and Active Session state intact.
