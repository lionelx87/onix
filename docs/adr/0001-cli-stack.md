# ADR 0001: CLI stack

## Status

Accepted for slice #2.

## Context

Onix starts as a local **CLI Interface** for **Local Vault Operation**. The first implementation must create a thin runnable scaffold for **Session Start**, **Session Closing**, **Integrated Review**, approved patch application, and status inspection before later tracer bullets implement the full workflow.

The stack must support deterministic local tests, provider-independent **Proposal Engine** contracts, and explicit separation between committed **Versioned Tool State** and transient **Operational Store** data.

## Decision

Use Node.js 24 LTS with TypeScript, pnpm scripts, Commander.js, Zod, and Vitest.

- Runtime: Node.js 24 LTS, ESM modules.
- Language: TypeScript with strict compiler settings.
- Package tooling: pnpm, because it is already installed in the project environment, gives deterministic lockfiles, and keeps dependency installs fast without changing the runtime model.
- CLI framework: Commander.js with typed command definitions from `@commander-js/extra-typings`.
- Validation/contracts: Zod 4 for runtime validation and inferred TypeScript types at plan and provider boundaries.
- Tests: Vitest 4 with explicit imports and deterministic fixtures.

## Rationale

Node.js 24 LTS fits a local CLI-first MVP because filesystem access, process execution, JSON handling, Markdown-oriented tooling, and future LLM SDK integrations are mature without introducing a backend or hosted runtime.

pnpm fits this repo because the user already has it installed locally, it produces an explicit `pnpm-lock.yaml`, and it avoids mixing package managers as the scaffold becomes the base for later AFK tracer bullets.

The pnpm workspace configuration approves only the `esbuild` install build needed by the current TypeScript execution/test toolchain.

TypeScript keeps the **Plan Schema**, **Approval State**, and **Proposal Engine** contracts explicit while the workflow is still changing. Zod makes those contracts executable at runtime, so provider output and fixture plans can be validated through the same path.

Commander is enough for the current command surface and keeps help output, subcommands, options, and async handlers straightforward. A heavier CLI framework would add structure before the product workflow has proven where it needs it.

Vitest supports fast local and CI tests for the CLI surface, vault fixtures, validator behavior, and patch applier without live LLM calls.

Session-state commands require an explicit `--vault <path>` argument. The CLI must not silently use the current working directory as the target vault for **Session Start**, because that can create an **Active Session** outside the vault that **Session Closing** later operates on.

The **Session Inbox** is user-editable vault content, so it is created in a visible vault folder rather than inside `.onix/`. The **Active Session** metadata remains transient hidden tool state under `.onix/state/active-session.json`.

## Operational Store Layout

The default **Operational Store** root is `.onix/` inside the target vault.

Committed **Versioned Tool State**:

- `.onix/config.json`
- `.onix/classification-rules.json`

Ignored transient **Operational Store** data:

- `.onix/state/active-session.json`
- `.onix/indexes/`
- `.onix/plans/`
- `.onix/approvals/`
- `.onix/logs/`
- `.onix/cache/`

## Consequences

Later slices should add behavior behind the established command names instead of changing the top-level CLI shape casually.

The **Proposal Engine** must remain provider-independent: tests should use deterministic fixtures or stub adapters, not live LLM calls.

The local validator and patch applier can depend on the shared `PatchPlan` type and schema, but they should not depend on a specific LLM SDK.
