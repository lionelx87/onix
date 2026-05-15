# Ideas Explorer

This context describes the language for capturing, clarifying, and later recovering learning gathered during work sessions.

## Language

**Learning Capture**:
A minimal unit of learning, discovery, correction, or understanding gathered during a work session before its final destination is known.
_Avoid_: note, log, task

**Discovery Context**:
The situation in which a **Learning Capture** was found, which may differ from where the learning should be organized.
_Avoid_: category, topic

**Knowledge Topic**:
The stable subject under which a **Learning Capture** should be recoverable after it is organized.
_Avoid_: source, session, bug

**Organization Proposal**:
A reviewable plan for placing **Learning Captures** under **Knowledge Topics** before they are committed to the knowledge base.
_Avoid_: automatic sync, final notes

**Patch Plan**:
A human-readable set of proposed note changes generated before any vault files are modified.
_Avoid_: direct write, hidden patch

**Plan Schema**:
The structured machine-readable representation of a **Patch Plan** used for validation and application.
_Avoid_: prose-only plan, unstructured output

**Review Rendering**:
The human-readable presentation of a **Patch Plan** used during **Integrated Review**.
_Avoid_: raw JSON review, implementation format

**Approval State**:
The structured record of accepted, edited, moved, split, or discarded plan items used by the apply step.
_Avoid_: parsed markdown edits, implicit approval

**Proposal Engine**:
The component that interprets captures and produces a **Patch Plan** without directly modifying vault files.
_Avoid_: vault writer, autonomous organizer

**Local Validator**:
The component that checks a **Patch Plan** against the vault, write boundaries, and file state before approved changes are applied.
_Avoid_: model trust, unchecked output

**Topic Candidate**:
A proposed new **Knowledge Topic** created when no existing topic clearly fits a **Learning Capture**.
_Avoid_: uncategorized, miscellaneous

**Destination Review**:
A review of an **Organization Proposal** grouped by target **Knowledge Topic** rather than by capture chronology.
_Avoid_: chronological review, session replay

**Consolidated Knowledge**:
Final note content rewritten from one or more **Learning Captures** so it reads as stable knowledge rather than as session notes.
_Avoid_: raw capture, diary entry

**Ephemeral Session**:
A temporary work session used to collect **Learning Captures** until approved knowledge is written to **Knowledge Topics**.
_Avoid_: daily note, historical log

**Freeform Capture**:
Unstructured input recorded during an **Ephemeral Session** without requiring predefined fields or categorization.
_Avoid_: form, template, structured entry

**Session Inbox**:
A temporary Obsidian note named with its creation date and time that stores **Freeform Captures** until **Session Closing**.
_Avoid_: daily note, permanent inbox

**Capture Interpretation**:
The process of extracting one or more atomic **Learning Captures** from a **Freeform Capture** during session closing.
_Avoid_: manual splitting, raw import

**Integrated Review**:
A single review flow that combines interpreted **Learning Captures**, proposed destinations, and source traces.
_Avoid_: extraction review, multi-step approval

**Review Action**:
An allowed correction applied to an item during **Integrated Review** before it becomes **Consolidated Knowledge**.
_Avoid_: full editing workflow, vault maintenance

**Primary Topic**:
The single **Knowledge Topic** where a piece of **Consolidated Knowledge** is stored.
_Avoid_: duplicate destination, copied note

**Related Topic**:
A secondary **Knowledge Topic** linked from **Consolidated Knowledge** to improve discovery without duplicating content.
_Avoid_: duplicate destination, copied note

**No Consolidation Candidate**:
A captured item that should not become **Consolidated Knowledge** unless edited into durable learning.
_Avoid_: miscellaneous, forced category

**Sensitive Candidate**:
A captured item that may contain private, secret, or identifying information and must be reviewed before consolidation.
_Avoid_: automatic consolidation, copied secret

**Sanitized Capture**:
A cleaned version of a **Sensitive Candidate** that preserves transferable learning while removing sensitive details.
_Avoid_: redacted secret, raw sensitive capture

**Research Candidate**:
A link or reference saved with a short description because it may produce learning after future investigation.
_Avoid_: source, bookmark, consolidated knowledge

**Research Inbox**:
A separate holding area for **Research Candidates** grouped by suggested topic until they produce learning.
_Avoid_: thematic note, final destination

**Reference Item**:
A link or reference kept with a short description because it remains useful to access after producing learning.
_Avoid_: raw bookmark, consolidated knowledge

**Reference Library**:
A separate collection of **Reference Items** grouped by topic and linked to the learning they informed.
_Avoid_: thematic note, raw bookmarks

**Valuable Link**:
A connection between notes or references that improves future retrieval, understanding, or navigation.
_Avoid_: decorative link, link-for-linking

**Knowledge Refinement**:
An improvement to existing **Consolidated Knowledge** using new captures to make it clearer, stronger, or more complete.
_Avoid_: append-only update, duplicate note

**Destination Language**:
The dominant language and terminology style of the destination note.
_Avoid_: capture language, forced translation

**Refinement Review**:
A before-and-after presentation of a proposed **Knowledge Refinement** with the reason for the change.
_Avoid_: raw diff, patch review

**Write Boundary**:
The approved area of the knowledge base that the closing flow is allowed to modify.
_Avoid_: vault reorganization, unrestricted write access

**Vault Index**:
A readable summary of the existing knowledge base structure used to avoid duplicate topics and propose better destinations.
_Avoid_: blank taxonomy, generated taxonomy

**Candidate Note**:
An existing note selected from the **Vault Index** for deeper reading because it may fit a **Learning Capture**.
_Avoid_: full-vault scan, random note

**Session Closing**:
The end-of-session flow that indexes the vault, interprets captures, proposes organization, and commits approved knowledge.
_Avoid_: daily note creation, automatic import

**Session Start**:
An explicit action that creates a dated **Session Inbox** and marks it as the active capture target.
_Avoid_: manual note creation, implicit session

**Active Session**:
The single **Ephemeral Session** currently open for capture.
_Avoid_: parallel sessions, ambiguous inbox

**Commit Validation**:
A check performed before writing approved changes to ensure destination notes still match the proposal's source state.
_Avoid_: blind write, overwrite

**Versioning Review**:
A post-consolidation review of changed vault files before the user commits them to Git.
_Avoid_: automatic commit, hidden versioning

**Local Vault Operation**:
The tool operates only on an existing local Obsidian vault and does not provide its own sync, backend, or multi-user state.
_Avoid_: cloud sync, hosted workspace

**CLI Interface**:
The initial local command interface for starting sessions, closing sessions, reviewing plans, applying approved changes, and checking status.
_Avoid_: graphical app, hosted UI

**Structural Question**:
A clarification asked during **Session Closing** only when uncertainty could create or modify durable knowledge structure incorrectly.
_Avoid_: minor clarification, wording question

**Classification Rule**:
An approved preference derived from review corrections that guides future topic selection and organization.
_Avoid_: hidden learning, implicit preference

**Classification Rules Store**:
A system-owned location for approved **Classification Rules** separate from thematic knowledge.
_Avoid_: thematic note, personal knowledge

**Operational Store**:
A hidden local folder that stores tool state such as active session metadata, vault index, patch plans, approval state, and classification rules.
_Avoid_: Obsidian note, thematic knowledge

**Versioned Tool State**:
Stable operational state worth committing to Git, such as configuration and approved classification rules.
_Avoid_: session state, generated plan, cache

## Relationships

- A **Learning Capture** can reference one or more links as supporting context.
- A **Learning Capture** has one **Discovery Context** within an **Ephemeral Session**.
- A **Learning Capture** can have one **Primary Topic** and one or more **Related Topics**.
- An **Organization Proposal** assigns one or more **Learning Captures** to **Knowledge Topics**.
- An **Organization Proposal** can include **Topic Candidates** when existing **Knowledge Topics** are insufficient.
- **Topic Candidates** exist only inside an **Organization Proposal** until approved.
- **Topic Candidates** should be named as stable concepts compatible with the vault's existing style, not as discovery events.
- Newly approved **Knowledge Topics** use minimal structure and do not include empty sections.
- **Session Closing** produces a **Patch Plan** before writing any vault files.
- A **Patch Plan** has a **Plan Schema** for machines and a **Review Rendering** for the user.
- **Review Rendering** is for human reading; **Approval State** records decisions through the **CLI Interface**.
- A **Proposal Engine** can use an LLM to generate a **Patch Plan**.
- The **Proposal Engine** should expose a stable input and output contract independent of a specific LLM provider.
- A **Local Validator** must validate paths, note existence, write boundaries, and file state before approved changes are applied.
- A **Destination Review** presents an **Organization Proposal** by **Knowledge Topic**.
- Approved **Learning Captures** become **Consolidated Knowledge** when written into the knowledge base.
- An **Ephemeral Session** is not retained as a historical note after its approved captures are consolidated.
- A **Discovery Context** is retained in **Consolidated Knowledge** only when it contributes a reusable pattern.
- A **Freeform Capture** can contain one or more **Learning Captures** after interpretation.
- A **Session Inbox** stores **Freeform Captures** for one **Ephemeral Session**.
- A **Session Inbox** is persisted only until approved captures are consolidated.
- A **Session Inbox** is deleted after successful **Session Closing** and successful write verification.
- **Session Start** creates the **Session Inbox** for an **Ephemeral Session**.
- There can be at most one **Active Session**.
- An empty **Session Inbox** does not produce an **Organization Proposal**.
- A **Session Inbox** without durable learning can produce only **No Consolidation Candidates** or **Research Candidates**.
- **Capture Interpretation** happens before an **Organization Proposal** is reviewed.
- An **Integrated Review** presents each interpreted **Learning Capture** with its proposed destination and source trace.
- Valid **Review Actions** are approve, edit, move, split, and discard.
- The **Primary Topic** is the conceptual question answered by the learning; tools, errors, and discovery situations become **Related Topics** unless they are the core subject.
- An **Organization Proposal** can include **No Consolidation Candidates** for captured items that are tasks, vague ideas, reminders, or links without explicit learning.
- An **Organization Proposal** must isolate **Sensitive Candidates** from automatic consolidation.
- A **Sensitive Candidate** can become a **Sanitized Capture** before consolidation.
- A link can become a **Research Candidate** when it has a clear description but has not yet produced **Consolidated Knowledge**.
- A **Research Candidate** belongs in the **Research Inbox** until it produces **Learning Captures**.
- A **Research Candidate** can become a **Reference Item** when the link should remain accessible after learning is extracted.
- A **Reference Item** belongs in the **Reference Library**.
- Notes and references should use **Valuable Links** rather than linking every possible related term.
- A **Valuable Link** exists only when it improves retrieval, explanation, application, or source traceability.
- An **Organization Proposal** can recommend adding a new section, updating an existing section, or applying **Knowledge Refinement**.
- A **Knowledge Refinement** is reviewed through a **Refinement Review**.
- Duplicate learning is handled as **Knowledge Refinement** when it strengthens existing knowledge, or as a **No Consolidation Candidate** when already fully covered.
- **Consolidated Knowledge** is written in the **Destination Language** while preserving real tool names, commands, APIs, and established technical terms.
- The initial **Write Boundary** includes approved thematic notes, approved new thematic notes, the **Research Inbox**, and the **Reference Library**.
- An **Organization Proposal** must use the **Vault Index** before creating **Topic Candidates** or recommending **Knowledge Refinement**.
- The **Vault Index** is lightweight; only **Candidate Notes** are read deeply during proposal generation.
- **Session Closing** starts by updating the **Vault Index**.
- Approved changes require **Commit Validation** before they are written.
- **Session Closing** asks **Structural Questions** only when low confidence could damage the knowledge structure.
- Repeated review corrections can produce proposed **Classification Rules**, but only approved rules guide future proposals.
- **Classification Rules** live in the **Classification Rules Store**, not in thematic notes.
- Tool state lives in the **Operational Store**, separate from thematic knowledge.
- Only **Versioned Tool State** should be committed from the **Operational Store**; active sessions, plans, approval state, indexes, logs, and caches are transient.
- **Session Closing** does not automatically commit Git changes; it ends with **Versioning Review**.
- The initial product uses **Local Vault Operation** and relies on the user's existing Obsidian and Git synchronization.
- The initial product uses a **CLI Interface**.

## Example dialogue

> **Dev:** "I found a yarn subcommand while fixing an error; is that a task or a note?"
> **Domain expert:** "It is a **Learning Capture** if the important part is what you learned and want to recover later."
> **Dev:** "Should it live under the bug I was fixing?"
> **Domain expert:** "The bug is the **Discovery Context**; Yarn is the **Knowledge Topic** where it should be recoverable."
> **Dev:** "Can the system write that directly into Obsidian?"
> **Domain expert:** "Only after I approve the **Organization Proposal**."
> **Dev:** "What if no existing topic fits?"
> **Domain expert:** "Then the proposal can include a **Topic Candidate** instead of forcing the capture into a weak match."
> **Dev:** "Should I review the proposal in the order I captured things?"
> **Domain expert:** "No, use a **Destination Review** so each destination can be evaluated as a coherent note."
> **Dev:** "Should the final note say 'I learned yarn why today'?"
> **Domain expert:** "No, write it as **Consolidated Knowledge** and keep only minimal discovery context when useful."
> **Dev:** "Should today's session remain as a daily note?"
> **Domain expert:** "No, it is an **Ephemeral Session**; the durable output is the consolidated thematic notes."
> **Dev:** "Should the final note remember that I learned this during today's bug?"
> **Domain expert:** "Only if that context teaches a reusable pattern; otherwise discard it."
> **Dev:** "Do I need to fill in fields while capturing?"
> **Domain expert:** "No, write a **Freeform Capture** and let the closing flow interpret it later."
> **Dev:** "Where do I write captures during the day?"
> **Domain expert:** "Use a dated **Session Inbox** in Obsidian that disappears after consolidation."
> **Dev:** "Can I just create the note manually?"
> **Domain expert:** "Use **Session Start** so the active **Session Inbox** is explicit."
> **Dev:** "Can I have two capture sessions open?"
> **Domain expert:** "No, there is only one **Active Session** at a time."
> **Dev:** "What if I close an empty session?"
> **Domain expert:** "Do not generate an **Organization Proposal**; offer to discard or keep the **Session Inbox**."
> **Dev:** "Should the session inbox remain after closing?"
> **Domain expert:** "No, delete it after successful consolidation and rely on Git for exceptional recovery."
> **Dev:** "What if one freeform note contains three things I learned?"
> **Domain expert:** "**Capture Interpretation** should split it into atomic **Learning Captures** before proposing destinations."
> **Dev:** "Do I need to validate extraction and organization in separate steps?"
> **Domain expert:** "No, use an **Integrated Review** so each item can be corrected in place."
> **Dev:** "Can I reorganize the whole vault during review?"
> **Domain expert:** "No, a **Review Action** is limited to approving, editing, moving, splitting, or discarding proposed knowledge."
> **Dev:** "Should the same learning be copied into Yarn and Debugging?"
> **Domain expert:** "No, choose one **Primary Topic** and connect any **Related Topics** with links."
> **Dev:** "What happens to a reminder I captured by accident?"
> **Domain expert:** "It becomes a **No Consolidation Candidate** unless you edit it into durable learning."
> **Dev:** "What if a capture includes a token or private client name?"
> **Domain expert:** "Treat it as a **Sensitive Candidate** and require explicit cleanup or approval before consolidation."
> **Dev:** "Do I have to discard sensitive captures?"
> **Domain expert:** "No, create a **Sanitized Capture** that preserves the transferable learning without sensitive details."
> **Dev:** "What if I saved a link to investigate later?"
> **Domain expert:** "If it has a clear description, keep it as a **Research Candidate** instead of treating it as consolidated knowledge."
> **Dev:** "Should pending links go inside thematic notes?"
> **Domain expert:** "No, keep them in the **Research Inbox** until they produce real learning."
> **Dev:** "Should the link disappear after I extract learning from it?"
> **Domain expert:** "No, keep it as a **Reference Item** when it remains useful to access later."
> **Dev:** "Should every related term become an Obsidian link?"
> **Domain expert:** "No, only create a **Valuable Link** when it improves retrieval, understanding, or navigation."
> **Dev:** "How do I know if a link is worth creating?"
> **Domain expert:** "Create it only when it improves retrieval, explanation, application, or source traceability."
> **Dev:** "What if a new capture improves something already written?"
> **Domain expert:** "Use **Knowledge Refinement** instead of appending a duplicate idea."
> **Dev:** "Should I review refinements as file diffs?"
> **Domain expert:** "No, use a **Refinement Review** that shows before, after, and reason."
> **Dev:** "Can the closing flow reorganize my whole vault?"
> **Domain expert:** "No, it must stay inside the **Write Boundary** unless that boundary is deliberately expanded later."
> **Dev:** "Can the system invent a new topic if one already exists?"
> **Domain expert:** "No, it must consult the **Vault Index** before proposing destinations or new topics."
> **Dev:** "Should the system read every full note every time?"
> **Domain expert:** "No, use the **Vault Index** first and read deeply only the **Candidate Notes**."
> **Dev:** "When should the vault index update?"
> **Domain expert:** "At the start of **Session Closing**, before interpreting and organizing captures."
> **Dev:** "What if I edit a destination note after reviewing the proposal?"
> **Domain expert:** "**Commit Validation** must stop the write and regenerate that part of the proposal."
> **Dev:** "Should the system ask about every uncertain wording choice?"
> **Domain expert:** "No, ask a **Structural Question** only when uncertainty could create the wrong durable structure."
> **Dev:** "Should closing the session commit my vault repo?"
> **Domain expert:** "No, end with **Versioning Review** so the user controls Git commits."
> **Dev:** "Does the tool need its own sync?"
> **Domain expert:** "No, use **Local Vault Operation** and rely on the user's existing Obsidian and Git workflow."
> **Dev:** "Can the system learn from my corrections?"
> **Domain expert:** "Yes, but only by proposing an explicit **Classification Rule** for approval."
> **Dev:** "Do classification rules belong in my knowledge notes?"
> **Domain expert:** "No, keep them in the **Classification Rules Store** outside thematic knowledge."

## Flagged ambiguities

- "link" may mean either a standalone **Learning Capture** or supporting context attached to one; unresolved.
