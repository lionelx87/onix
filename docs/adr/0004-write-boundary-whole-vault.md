# ADR 0004: Write Boundary defaults to the whole vault

## Status

Accepted.

## Context

The apply step enforces a **Write Boundary**: the area of the vault the closing flow may modify. Until now `isInsideWriteBoundary` in `src/session-apply.ts` was **hardcoded** to a fixed convention — it only allowed destinations under `Knowledge/`, `Onix/Research Inbox.md`, `References/`, or `Reference Library/`.

Real vaults do not follow that convention. A user's vault organizes Knowledge Topics under top-level topic folders (`Git/`, `Web/`, `Linux/`, `Docker/`, `React/`, `Arquitectura/`, …) with no `Knowledge/` root. The live **Proposal Engine** correctly read the Vault Index and proposed destinations that matched the real structure (`Git/GitHub CLI.md`), but `apply` rejected every one of them with "Destination is outside the Write Boundary", making the whole flow unusable on that vault.

The dormant `src/config/onix-config.schema.json` already declared a configurable `writeBoundary` (`thematicNotes`/`researchInbox`/`referenceLibrary`), but no code ever read it.

## Decision

The Write Boundary defaults to the **entire vault**. `apply` rejects a destination only when it would escape the vault or touch the Operational Store:

- non-normalized paths,
- absolute paths (`/…`),
- parent-directory traversal (`../…`, `…/../…`),
- the Operational Store (`.onix` and `.onix/…`).

The hardcoded `Knowledge/`/`References/`/`Reference Library/` allow-list is removed.

Narrowing the boundary to an explicit allow-list via `.onix/config.json` (wiring the dormant schema, with a command to set it) is a deliberate follow-up, not part of this decision. Until then, the default is the whole vault.

## Rationale

A fixed folder convention cannot fit every vault, and silently rejecting valid, human-approved destinations is worse than a broad default: the user already reviews and approves each destination in the interactive **Integrated Review** before `apply` runs. The boundary's real job is to prevent writes that *escape* the vault or corrupt the Operational Store, not to impose a folder taxonomy.

The remaining safety guarantees are unchanged and are what actually protect the vault:

- every destination is human-approved during Integrated Review,
- the freshness check aborts if a destination changed after the Patch Plan was generated,
- post-write verification confirms the approved content landed,
- an aborted apply leaves the Session Inbox and Active Session untouched.

This matches the documented intent that the boundary may be "deliberately expanded": the default is now wide, and an explicit config can tighten it later.

## Consequences

`apply` writes Consolidated Knowledge, Knowledge Refinements, Research Candidates, and Reference Items anywhere in the vault except `.onix/`, following the destinations the Proposal Engine proposes and the user approves. The existing escape/traversal/Operational-Store rejections still hold and remain covered by tests.

A future slice can wire `.onix/config.json` `writeBoundary` to narrow the default to an explicit allow-list for users who want a tighter constraint.
