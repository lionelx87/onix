# Learning Capture MVP PRD

## Problem Statement

During a work session, the user learns small, useful things that are not always related to the original task. These learnings can come from debugging an unexpected issue, discovering a command, reading a link, or understanding a reusable pattern.

The user wants to capture this information quickly and freely, without stopping to classify or structure it. At the end of the session, the captured material should be interpreted, reviewed, and consolidated into the correct places in an existing Obsidian vault.

The durable result should be thematic, consolidated knowledge, not a daily log. The system must respect the existing vault structure, avoid duplicate knowledge, preserve useful references, and only create links when they improve retrieval, explanation, application, or source traceability.

## Solution

Build a local CLI-first tool that operates on an existing Obsidian vault.

The tool starts an **Ephemeral Session** by creating a dated **Session Inbox** note inside the vault. During the session, the user writes **Freeform Captures** in that note without following a template.

At **Session Closing**, the tool updates a lightweight **Vault Index**, interprets the inbox into atomic **Learning Captures**, detects links, sensitive material, possible duplicates, and candidate destinations, then generates a structured **Patch Plan** plus a human-readable **Review Rendering**.

The user reviews an **Integrated Review** grouped by destination note, applies **Review Actions**, and only approved changes are written to the vault. The final output is **Consolidated Knowledge** in thematic notes, **Research Candidates** in a **Research Inbox**, and **Reference Items** in a **Reference Library** where appropriate.

After successful write verification, the **Session Inbox** is deleted. The tool does not create a Git commit automatically; it ends with a **Versioning Review** showing changed files.

## User Stories

1. As a knowledge worker, I want to start a capture session with one command, so that I have a clear temporary place to write session learnings.
2. As a knowledge worker, I want the session inbox to be named with creation date and time, so that it is traceable while it exists.
3. As a knowledge worker, I want to write captures in freeform text, so that I do not interrupt my work to classify information.
4. As a knowledge worker, I want one freeform capture to be split into multiple learning captures, so that each reusable idea can be organized independently.
5. As a knowledge worker, I want the system to distinguish discovery context from knowledge topic, so that a bug context does not force the final destination.
6. As a knowledge worker, I want the system to inspect my existing vault before proposing destinations, so that it does not duplicate topics I already have.
7. As a knowledge worker, I want proposed changes grouped by destination note, so that I can evaluate whether each note will remain coherent.
8. As a knowledge worker, I want to approve, edit, move, split, or discard proposed items, so that I control what becomes durable knowledge.
9. As a knowledge worker, I want new topic candidates to be proposed only when existing notes do not fit, so that the vault grows deliberately.
10. As a knowledge worker, I want new topic names to represent stable concepts, so that notes are not named after temporary debugging events.
11. As a knowledge worker, I want final notes to be written as consolidated knowledge, so that my vault does not read like a diary.
12. As a knowledge worker, I want discovery context retained only when it teaches a reusable pattern, so that notes stay focused.
13. As a knowledge worker, I want duplicate captures to refine existing knowledge or be discarded, so that the vault does not accumulate repeated content.
14. As a knowledge worker, I want refinements shown as before/after with a reason, so that I can make decisions based on meaning rather than line diffs.
15. As a knowledge worker, I want links to become sources, research candidates, reference items, or discarded items depending on their value, so that raw bookmarks do not pollute knowledge notes.
16. As a knowledge worker, I want pending research links grouped in a research inbox, so that I can revisit them without treating them as learned knowledge.
17. As a knowledge worker, I want useful investigated links preserved in a reference library, so that I can find source material again later.
18. As a knowledge worker, I want links between notes only when they add value, so that my graph remains useful instead of noisy.
19. As a knowledge worker, I want sensitive captures isolated and sanitized before consolidation, so that private details do not enter durable notes.
20. As a knowledge worker, I want the tool to validate destination files before writing, so that it does not overwrite changes made after proposal generation.
21. As a knowledge worker, I want the temporary session inbox deleted after successful consolidation, so that daily session notes do not become another archive to maintain.
22. As a knowledge worker, I want Git commits to remain manual, so that I keep control over versioning.
23. As a knowledge worker, I want the tool to learn from repeated corrections only through approved classification rules, so that organization preferences remain explicit.
24. As a knowledge worker, I want the first version to be local and CLI-based, so that the core workflow can be validated before investing in a richer UI.

## Implementation Decisions

- Use the glossary in `CONTEXT.md` as the domain language for implementation and documentation.
- Start with a local **CLI Interface**, not a graphical application.
- Use **Local Vault Operation** only. The tool does not provide cloud sync, hosted accounts, backend state, or multi-user behavior.
- Commands that create or modify session state require an explicit vault path; **Session Start** must not infer the target vault from the current working directory.
- A **Session Start** action creates a dated **Session Inbox** note and records it as the only **Active Session**.
- Only one **Active Session** can exist at a time.
- The **Session Inbox** lives inside a visible Obsidian vault folder so the user can open and edit it during the session, and is deleted after successful **Session Closing** and write verification.
- **Session Closing** begins by updating a lightweight **Vault Index**.
- The **Vault Index** includes structural metadata such as note paths, titles, aliases, headings, tags, summaries or opening paragraphs, and important outgoing links.
- The tool reads full note contents only for **Candidate Notes** selected from the index.
- A **Proposal Engine** may use an LLM to perform **Capture Interpretation** and produce a **Patch Plan**.
- The **Proposal Engine** must expose a stable input/output contract independent of any specific LLM provider.
- The **Patch Plan** has a structured **Plan Schema** for validation/application and a Markdown **Review Rendering** for human review.
- The Markdown review is not the source of truth for approval. The CLI records **Approval State**.
- The **Integrated Review** is grouped by destination note, not by capture chronology.
- Supported **Review Actions** for MVP are approve, edit, move, split, and discard.
- A **Primary Topic** is the conceptual question answered by the learning. Tools, errors, and discovery situations are **Related Topics** unless they are the core subject.
- Each piece of consolidated knowledge has one **Primary Topic** and optional **Related Topics**.
- New **Topic Candidates** exist only inside the proposal until approved.
- Newly approved **Knowledge Topics** use minimal structure and do not include empty sections.
- The system writes **Consolidated Knowledge** in the **Destination Language** while preserving real tool names, commands, APIs, and established technical terms.
- The initial **Write Boundary** includes approved thematic notes, approved new thematic notes, the **Research Inbox**, and the **Reference Library**.
- The tool must not reorganize folders, rename existing notes, or delete existing thematic content in the MVP unless covered by an explicit approved action.
- **Commit Validation** checks destination file state before applying approved changes. If a destination changed since the proposal, the affected part is regenerated instead of blindly applied.
- The tool ends with **Versioning Review** and does not automatically commit Git changes.
- Use an **Operational Store** for tool state such as active session metadata, vault index, plans, approval state, and classification rules. The visible **Session Inbox** is user-editable vault content, not hidden operational state.
- Only stable **Versioned Tool State**, such as configuration and approved classification rules, should be committed. Active session state, generated plans, approval state, indexes, logs, and caches are transient.

## Suggested Modules

- Session manager: owns **Session Start**, active session tracking, Session Inbox creation, and successful cleanup.
- Vault indexer: builds the lightweight **Vault Index** and selects **Candidate Notes** for deeper reading.
- Capture interpreter: converts **Freeform Captures** into atomic **Learning Captures**, **Research Candidates**, **Sensitive Candidates**, and **No Consolidation Candidates**.
- Proposal engine adapter: wraps the LLM provider behind a stable contract and produces the **Plan Schema**.
- Local validator: validates plan structure, paths, write boundary, candidate notes, file state, and sensitive-item handling.
- Review renderer: renders the plan into Markdown for human review.
- Approval workflow: records approve, edit, move, split, and discard actions as **Approval State**.
- Patch applier: applies approved changes after **Commit Validation**.
- Reference manager: writes **Research Candidates** and **Reference Items** to their dedicated areas.
- Classification rules store: persists approved organization preferences outside thematic notes.

## Testing Decisions

- Test external behavior and file outcomes, not the internal wording choices of the LLM.
- Unit test the vault indexer with sample vault structures containing aliases, headings, tags, links, and similarly named notes.
- Unit test the local validator against invalid paths, writes outside the boundary, stale destination files, malformed plans, and unsafe sensitive candidates.
- Unit test the patch applier with temporary Markdown vault fixtures.
- Unit test session lifecycle behavior: start, prevent second active session, close empty session, successful cleanup, and failed cleanup.
- Integration test the full local flow using a fixture vault and a stubbed proposal engine.
- Use deterministic proposal fixtures for tests instead of live LLM calls.
- Add regression tests for duplicate handling: pure duplicate becomes **No Consolidation Candidate**, strengthening duplicate becomes **Knowledge Refinement**.
- Add tests for language behavior using destination notes in Spanish with English command/tool names.
- Add tests for valuable link policy using accepted and rejected related links.

## Out of Scope

- Graphical UI or full local web app.
- Multiple active sessions.
- Automatic Git commits.
- Own sync system, cloud backend, accounts, or multi-user collaboration.
- Full-vault reorganization, folder restructuring, or automatic note renaming.
- Parsing freeform edits made directly to the Markdown review as approval state.
- Advanced semantic search or embeddings as a hard requirement for MVP.
- Automatic creation of classification rules without explicit approval.
- Permanent daily notes or historical session logs.
- Writing outside the approved write boundary.

## Further Notes

- The MVP is intentionally narrow so real usage can reveal whether the review flow, destination proposals, and refinements are useful before investing in a richer UI.
- The strongest product risk is not command execution; it is whether the system can propose useful organization without over-linking, duplicating, or polluting the vault.
- The system should prefer asking **Structural Questions** only when uncertainty could damage durable knowledge structure.
- The first implementation should make it easy to inspect generated plans and changed files, because trust will come from repeated successful review cycles.
