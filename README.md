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
pnpm onix -- <command>
```

The extra `--` passes the following arguments through pnpm to Onix.

## Commands

### Start an Ephemeral Session

```bash
pnpm onix -- --vault /path/to/vault start
```

`--vault` is required. Onix does not infer the target vault from the current working directory, so session state is not created in the wrong place by accident.

This creates:

```text
/path/to/vault/.onix/sessions/session-inbox-YYYYMMDD-HHMMSS.md
/path/to/vault/.onix/state/active-session.json
```

The Session Inbox is plain Markdown and starts empty. Write Freeform Captures directly into that file during the session.

Only one Active Session can exist at a time. Running `start` again for the same vault fails until the current session is closed.

### Other Commands

These command surfaces exist for the MVP workflow:

```bash
pnpm onix -- --vault /path/to/vault close
pnpm onix -- review
pnpm onix -- apply
pnpm onix -- status
```

`close`, `review`, and `apply` are scaffolded. `status` currently prints the Operational Store layout.

## Development

```bash
pnpm test
pnpm typecheck
pnpm build
```
