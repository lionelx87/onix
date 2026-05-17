# Agent Instructions

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

This repo uses the default triage label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo with `CONTEXT.md` at the root and future ADRs under `docs/adr/`. See `docs/agents/domain.md`.

## Slice completion

When finishing a development slice:
- If the slice introduced a new command, document it in `README.md`.
- Include the command name, purpose, required env vars/options, and one minimal usage example.
- As done criteria, include a brief example of how to use the new command in the final response.
