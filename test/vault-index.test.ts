import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { ProposalEngine, ProposalEngineInput } from "../src/proposal-engine/contract.js";
import { closeSession } from "../src/session-close.js";
import { startSession } from "../src/session-start.js";
import { buildVaultIndex, selectCandidateNotes } from "../src/vault-index.js";

describe("Vault Index", () => {
  test("captures structural metadata from existing Knowledge Topics", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    await mkdir(join(vault, "Knowledge"), { recursive: true });
    await mkdir(join(vault, "Onix", "Sessions"), { recursive: true });

    await writeFile(
      join(vault, "Knowledge", "Node CLI.md"),
      `---
aliases: [Command line interfaces, Terminal apps]
tags: [node, cli]
summary: Build local terminal commands with provider-independent boundaries.
---
# Node CLI

Opening paragraph should not replace an explicit summary.

## Commander patterns

Link to [[Proposal Engine]] and [Node docs](https://nodejs.org/api/cli.html).
`
    );
    await writeFile(
      join(vault, "Onix", "Sessions", "session-inbox-20260516-120000.md"),
      "# Temporary capture\n\nThis active session content is not an existing Knowledge Topic.\n"
    );

    const index = await buildVaultIndex(vault, new Date("2026-05-16T12:00:00.000Z"));

    expect(index.notes).toHaveLength(1);
    expect(index.notes[0]).toMatchObject({
      path: "Knowledge/Node CLI.md",
      title: "Node CLI",
      aliases: ["Command line interfaces", "Terminal apps"],
      headings: ["Node CLI", "Commander patterns"],
      tags: ["node", "cli"],
      summary: "Build local terminal commands with provider-independent boundaries.",
      outgoingLinks: ["Proposal Engine", "https://nodejs.org/api/cli.html"]
    });
  });

  test("selects a bounded set of Candidate Notes from the Vault Index", async () => {
    const index = {
      schemaVersion: 1 as const,
      generatedAt: "2026-05-16T12:00:00.000Z",
      notes: [
        {
          path: "Knowledge/Node CLI.md",
          title: "Node CLI",
          aliases: ["Command line interfaces"],
          headings: ["Node CLI", "Commander patterns"],
          tags: ["node", "cli"],
          summary: "Build local terminal commands with Commander and pnpm.",
          outgoingLinks: []
        },
        {
          path: "Knowledge/Node Streams.md",
          title: "Node Streams",
          aliases: [],
          headings: ["Node Streams"],
          tags: ["node"],
          summary: "Streaming data in Node.",
          outgoingLinks: []
        },
        {
          path: "Knowledge/Vault Index.md",
          title: "Vault Index",
          aliases: ["Knowledge map"],
          headings: ["Candidate Notes"],
          tags: ["onix"],
          summary: "Select existing Knowledge Topics before proposing destinations.",
          outgoingLinks: []
        }
      ]
    };

    const candidates = selectCandidateNotes(
      index,
      "The close flow should inspect existing Knowledge Topics before proposing a Commander CLI destination.",
      2
    );

    expect(candidates).toEqual(["Knowledge/Node CLI.md", "Knowledge/Vault Index.md"]);
  });

  test("Session Closing updates the Vault Index and sends selected Candidate Notes to the Proposal Engine", async () => {
    const vault = await mkdtemp(join(tmpdir(), "onix-vault-"));
    await mkdir(join(vault, "Knowledge"), { recursive: true });
    await writeFile(
      join(vault, "Knowledge", "Vault Index.md"),
      "# Vault Index\n\nSelect existing Knowledge Topics before proposing destinations.\n"
    );
    await writeFile(
      join(vault, "Knowledge", "Cooking.md"),
      "# Cooking\n\nUnrelated household notes.\n"
    );
    const { activeSession } = await startSession(vault, new Date("2026-05-16T12:00:00.000Z"));
    await writeFile(
      join(vault, activeSession.inboxPath),
      `${await readFile(join(vault, activeSession.inboxPath), "utf8")}\nThe close flow should inspect the Vault Index before proposing destinations.\n`
    );

    let proposalInput: ProposalEngineInput | undefined;
    const proposalEngine: ProposalEngine = {
      async propose(input) {
        proposalInput = input;

        return {
          schemaVersion: 1,
          planId: "observed-input",
          summary: "Observed Proposal Engine input.",
          items: []
        };
      }
    };

    await closeSession(vault, proposalEngine);

    const persistedIndex = JSON.parse(await readFile(join(vault, ".onix", "indexes", "vault-index.json"), "utf8")) as {
      notes?: Array<{ path?: string }>;
    };

    expect(persistedIndex.notes?.map((note) => note.path)).toEqual([
      "Knowledge/Cooking.md",
      "Knowledge/Vault Index.md"
    ]);
    expect(proposalInput?.vaultIndexRef).toBe(".onix/indexes/vault-index.json");
    expect(proposalInput?.vaultIndex.notes.map((note) => note.path)).toContain("Knowledge/Vault Index.md");
    expect(proposalInput?.candidateNotes).toEqual([
      {
        path: "Knowledge/Vault Index.md",
        content: "# Vault Index\n\nSelect existing Knowledge Topics before proposing destinations.\n"
      }
    ]);
  });
});
