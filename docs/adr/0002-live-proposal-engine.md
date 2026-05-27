# ADR 0002: Live Proposal Engine provider and configuration UX

## Status

Accepted for slice #16.

## Context

The **Proposal Engine** contract in `src/proposal-engine/contract.ts` is already provider-independent, and the deterministic stub (`createStubProposalEngine`) satisfies it. What is missing is the set of product-level decisions that bind the contract to a real LLM provider and shape the `onix close` UX once the call is no longer instant or guaranteed to succeed.

This ADR records those decisions so the **Live Proposal Engine** can be implemented in slice #17 without re-deciding them. No production code changes belong to this slice.

## Decision

### Provider and default model

Use **OpenAI** through the official `openai` Node SDK (v6).

The default model is **`gpt-5.5`**. The exact API model string is confirmed against the SDK and the user's available models when slice #17 is implemented; this ADR fixes the product intent (newest available model as the default), not the literal string if it differs.

### Structured output strategy

The adapter does **not** use the SDK's `zodResponseFormat` / `zodTextFormat` helpers, because those helpers are bound to `zod/v3` and the project standardizes on Zod 4 at the contract boundary. Instead the adapter requests JSON from the model and validates the response through the existing `patchPlanSchema` via `parsePatchPlan`.

This keeps a single validation path shared with fixtures and the stub, and decouples the engine from the SDK's bundled Zod version.

### Credential sourcing

The API key comes from the **environment only**, under the canonical name **`OPENAI_API_KEY`** (the SDK default). The secret is never persisted to `~/.config/onix/config.json` or to the vault's **Operational Store**, so it is never written to committed **Versioned Tool State** in plaintext.

### Model override surface

Model selection mirrors how `onix use` and `onix editor` already persist preferences:

- A persisted CLI command `onix model <id>` writes the chosen model to the global config (a new `model` field alongside `defaultVault` and `editor`). `onix model` with no argument shows the resolved model; `onix model --clear` removes the preference.
- An environment variable `ONIX_MODEL` overrides the persisted value for a single run.

Resolution order: `ONIX_MODEL` → persisted `config.model` → default `gpt-5.5`.

### First-run UX when credentials are missing

When `onix close` runs without `OPENAI_API_KEY`, it **fails with a clear hint** that names the variable and shows how to export it. It does **not** interactively prompt for the key (unlike the editor first-run picker in commit `ec64308`), because the key is a secret that this ADR has decided not to persist.

The failure happens before any vault mutation, leaving the **Session Inbox** and the **Active Session** (`.onix/state/active-session.json`) untouched, consistent with the existing apply-abort behavior.

### In-flight progress UX

While the LLM call is running, `close` shows a **spinner with elapsed seconds** using `@clack/prompts` (already a dependency), only when attached to a TTY. In non-TTY contexts the spinner is suppressed so logs stay clean.

### Validation and retry policy

The model response is validated through `patchPlanSchema`. On a validation failure the adapter **retries up to 2 times (3 attempts total)**, re-injecting the validation error into the prompt so the model can correct the structure.

After the attempts are exhausted, the adapter **aborts with a clear error** describing the validation failure. An aborted run leaves the **Session Inbox** and **Active Session** untouched, mirroring the apply-abort guarantee already covered by `test/integration-flow.test.ts`.

### Test boundary

Tests must never reach a live LLM. The deterministic stub stays the engine used by every existing test through the dependency-injection seam already present in `closeSession` (`src/session-close.ts`).

In addition, the env var **`ONIX_PROPOSAL_ENGINE=stub`** forces the stub from the CLI, so manual runs and automation can exercise the full `close` path without credentials or network access. Any value other than `stub` (or an unset variable) selects the **Live Proposal Engine** by default.

## Rationale

OpenAI is the provider the user already has a subscription and available models for, so it is the lowest-friction path to a working live engine.

Keeping the key out of persisted config avoids storing a secret in plaintext inside files that live next to committed **Versioned Tool State**. Failing with a hint (rather than prompting) keeps the secret-handling story simple and predictable.

Persisting the model through `onix model` reuses the established global-config pattern, so the configuration surface stays consistent with `onix use` and `onix editor`. The `ONIX_MODEL` override matches the editor's `$VISUAL`/`$EDITOR` precedence idea: environment beats persisted preference.

Validating through the existing `patchPlanSchema` instead of the SDK's Zod helper keeps the contract authoritative and avoids coupling the live engine to the SDK's bundled Zod major version. Two retries balance resilience against a one-off formatting glitch with bounded token cost.

The `ONIX_PROPOSAL_ENGINE=stub` seam complements the existing injection: injection serves unit and integration tests, while the env var lets a human force determinism from the terminal.

## Contract impact

The existing `ProposalEngine`, `ProposalEngineInput`, and `PatchPlan` definitions in `src/proposal-engine/contract.ts` **do not need to change** to satisfy these decisions. The **Live Proposal Engine** implements the same `propose(input): Promise<PatchPlan>` shape, consumes the same `ProposalEngineInput`, and returns a `PatchPlan` validated by the same `patchPlanSchema`.

## Glossary additions

`CONTEXT.md` gains two terms in the existing `_Avoid_` style:

- **Live Proposal Engine** — the production **Proposal Engine** backed by a real LLM provider.
- **Capture Interpretation Prompt** — the instruction sent to the provider that uses the domain language to produce a valid **Patch Plan**.

The retry policy and credential source are described in this ADR and do not introduce new glossary terms.

## Consequences

Slice #17 implements the **Live Proposal Engine** under `src/proposal-engine/`, wires it as the default engine in `session-close.ts`, adds the `onix model` command, the `OPENAI_API_KEY` hint, the spinner, the retry loop, and the `ONIX_PROPOSAL_ENGINE=stub` seam, and documents all of it in `README.md`.

The Capture Interpretation Prompt must use the domain language from `CONTEXT.md` (Learning Capture, Knowledge Topic, Primary Topic, Related Topic, Knowledge Refinement, Research Candidate, Reference Item, Sensitive Candidate, No Consolidation Candidate, Destination Language) so the generated **Patch Plan** stays aligned with the rest of the system.
