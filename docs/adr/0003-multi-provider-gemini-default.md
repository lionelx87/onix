# ADR 0003: Multi-provider Proposal Engine with Gemini default

## Status

Accepted for slice #18.

## Context

ADR-0002 decided an OpenAI-backed **Live Proposal Engine** and confirmed the `ProposalEngine` contract is provider-independent. Slice #17 implemented it behind a small `CaptureCompletionClient` seam (`complete(request): Promise<string>`), so the engine logic — Capture Interpretation Prompt, retry policy, Classification Rules precedence, and `patchPlanSchema` validation — is decoupled from any specific SDK.

Neither the OpenAI nor the Anthropic developer API is covered by a ChatGPT Plus/Pro or Claude Max subscription; both bill API usage separately and require credits. Google AI Studio, by contrast, issues an API key with a real free tier (no billing required), which makes a Gemini-backed engine the lowest-friction way to run the live engine at no cost.

This ADR extends ADR-0002 to support more than one provider, makes Gemini the default, and records the selection, defaults, credentials, and privacy posture. No production code changes belong to this slice; they are implemented in slice #19.

## Decision

### Provider strategy

Keep both providers behind the existing `CaptureCompletionClient` seam. The **Live Proposal Engine** (`live.ts`) and the `ProposalEngine` contract do not change; each provider supplies its own client implementation.

Provider selection resolves in this order: `ONIX_PROVIDER` environment variable → persisted `provider` in the global config → default **`gemini`**.

Valid provider names are `gemini` and `openai`. The deterministic stub remains selectable above all providers through `ONIX_PROPOSAL_ENGINE=stub`.

### Provider selection UX

A persisted CLI command `onix provider <name>` sets, shows, and clears the provider preference, mirroring `onix use`, `onix editor`, and `onix model`:

- `onix provider gemini` persists the provider.
- `onix provider` with no argument shows the resolved provider and its source (`$ONIX_PROVIDER`, global config, or default).
- `onix provider --clear` removes the preference.

### Default model per provider

- `gemini` → `gemini-3.5-flash` (updated from the original `gemini-2.5-flash`; see Rationale)
- `openai` → `gpt-5.5` (unchanged from ADR-0002)

Model override is unchanged: `ONIX_MODEL` → persisted `config.model` → the resolved provider's default.

### Credential sourcing

Credentials come from the environment only, never persisted, one canonical variable per provider:

- `gemini` → `GEMINI_API_KEY` (canonical for the `@google/genai` SDK)
- `openai` → `OPENAI_API_KEY`

When the selected provider's variable is missing, `close` fails with a provider-specific hint and changes nothing, leaving the **Session Inbox** and **Active Session** untouched (consistent with the apply-abort guarantee).

### Privacy posture for the Gemini free tier

The Gemini free tier may use request inputs and outputs to improve Google's models. Because the engine sends the whole **Freeform Capture** to the provider before classification, anything that would become a **Sensitive Candidate** is exposed; it cannot be filtered out in advance.

On the first resolution of the Gemini provider, `onix` shows a one-time, **non-blocking** warning: the free tier is not private, and Sensitive Candidates should not be captured while using it. A persisted flag prevents the warning from repeating. The same caveat is documented in `README.md`. Users who need privacy should use a paid tier or Vertex AI (out of scope here).

### Shared model caveat

`config.model` is a single value shared across providers. A model persisted for one provider may be invalid for another. This ADR accepts that simplicity for now; the implementation documents that switching providers may require `onix model --clear`.

### Test boundary

Tests never reach a live provider. The dependency-injection seam in `closeSession` and the `ONIX_PROPOSAL_ENGINE=stub` env var remain the way tests and automation force the deterministic stub. New provider clients are exercised only through mocked clients.

## Rationale

The `CaptureCompletionClient` seam introduced in slice #17 already isolates provider details, so adding Gemini is a new leaf adapter plus selection logic — the deep engine module stays untouched. This keeps the change small and the existing OpenAI path and tests intact.

Gemini is the default because it is the only one of the three providers with a usable free tier, matching the immediate goal of running the live engine without paid API credits.

The Gemini default model is `gemini-3.5-flash`, the newest generally-available model in the Gemini 3 family (its `pro` members are preview-only). The original default was `gemini-2.5-flash`, chosen because `pro` carried tighter free-tier quota; that reasoning assumed meaningful request volume. The expected **Session Closing** volume is low — a handful per day, one request each — so the per-day request limit is not the binding constraint. The newer, stronger model is therefore preferred for higher-quality **Consolidated Knowledge** interpretation and structuring. The override order is unchanged.

Per-provider credential variables follow each SDK's canonical name, so existing environments work without remapping. Keeping secrets out of persisted config matches ADR-0002.

A one-time non-blocking warning (rather than a hard block or a required confirmation) keeps the free-tier path usable while making the privacy trade-off explicit, which matters because the system has a first-class notion of Sensitive Candidate.

## Contract impact

The `ProposalEngine` and `ProposalEngineInput`/`PatchPlan` definitions and the `CaptureCompletionClient` seam **do not need to change**. The Gemini client implements the same `complete(request): Promise<string>` shape the OpenAI client already implements.

## Glossary additions

No new domain terms are introduced. "Provider" and "model" are infrastructure concerns, not part of the Learning Capture domain language; **Live Proposal Engine** (added in ADR-0002) already covers the production engine regardless of provider.

## Consequences

Slice #19 implements the Gemini client (`@google/genai`, JSON output), provider selection in the factory, the `onix provider` command and `provider` config field, the first-run privacy warning, tests with a mocked client, and `README.md` documentation. The OpenAI provider and the deterministic stub keep their behavior.
