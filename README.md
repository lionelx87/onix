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

`--vault` is required. `close` reads the Active Session, finds the Session Inbox even if the visible note was renamed, strips the session frontmatter, updates the Vault Index, selects Candidate Notes, and sends that input to the Proposal Engine.

The current Proposal Engine is deterministic and provider-independent. It writes a structured Patch Plan and prints a Markdown Review Rendering:

```text
/path/to/vault/.onix/indexes/vault-index.json
/path/to/vault/.onix/plans/stubbed-plan.json
```

The generated Patch Plan can contain Consolidated Knowledge, Research Candidates, Sensitive Candidates, and No Consolidation Candidates. It records the original Learning Capture, source trace, Primary Topic, Related Topics, destination path when applicable, and proposed content. Tests use deterministic fixtures and do not call a live LLM.

### Review an Organization Proposal

Render the Integrated Review for a generated Patch Plan:

```bash
pnpm onix --vault /path/to/vault review stubbed-plan
```

`--vault` is required. The argument is the Patch Plan identifier stored under `.onix/plans/<plan-id>.json`. Rendering the Markdown Review Rendering is read-only and does not create Approval State.

Record structured Approval State with one of the supported Review Actions:

```bash
pnpm onix --vault /path/to/vault review stubbed-plan --approve item-1
pnpm onix --vault /path/to/vault review stubbed-plan --edit item-1 --content "Updated durable learning."
pnpm onix --vault /path/to/vault review stubbed-plan --move item-1 --destination "Knowledge/Review Workflows.md"
pnpm onix --vault /path/to/vault review stubbed-plan --split item-1 --part "First durable learning." --part "Second durable learning."
pnpm onix --vault /path/to/vault review stubbed-plan --discard item-1
```

Approval State is written as structured transient Operational Store state:

```text
/path/to/vault/.onix/approvals/stubbed-plan.json
```

Editing copied Review Markdown directly is not treated as approval. The apply step will use the Approval State file, not freeform Markdown edits.

### Scaffolded Commands

These command surfaces exist for the MVP workflow but are not fully implemented yet:

```bash
pnpm onix apply
pnpm onix status
```

`apply` is scaffolded. `status` currently prints the Operational Store layout.

## Development

```bash
pnpm test
pnpm typecheck
pnpm build
```
