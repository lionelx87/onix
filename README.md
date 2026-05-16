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

### Other Commands

These command surfaces exist for the MVP workflow:

```bash
pnpm onix --vault /path/to/vault close
pnpm onix review
pnpm onix apply
pnpm onix status
```

`close` currently uses a deterministic stubbed Proposal Engine to write `.onix/plans/stubbed-plan.json` and print a Markdown Review Rendering. `review` and `apply` are scaffolded. `status` currently prints the Operational Store layout.

## Development

```bash
pnpm test
pnpm typecheck
pnpm build
```
