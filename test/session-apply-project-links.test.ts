import { describe, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { recordReviewAction, type ReviewActionInput } from "../src/approval-state.js";
import type { PatchPlan } from "../src/proposal-engine/contract.js";
import { applySession, renderKnowledgeLink } from "../src/session-apply.js";

const dockerBlock = "## Rebuild without cache\n\nUse it when a stale layer hides a dependency change.\n\n```bash\ndocker build --no-cache .\n```";

function planWith(items: PatchPlan["items"]): PatchPlan {
  return { schemaVersion: 1, planId: "project-plan", summary: "Project links.", items };
}

function knowledgeItem(overrides: Partial<PatchPlan["items"][number]> = {}): PatchPlan["items"][number] {
  return {
    id: "item-1",
    kind: "consolidated-knowledge",
    destinationPath: "Docker/Docker.md",
    learningCapture: "docker build --no-cache fixed the stale layer in Onix",
    primaryTopic: "Docker",
    relatedTopics: [],
    sourceTrace: "Onix/Sessions/session-inbox.md line 1",
    proposedContent: dockerBlock,
    project: "Projects/Onix.md",
    projectUsage: "Fixed the stale dependency layer in the CI image",
    ...overrides
  };
}

async function vaultWith(files: Record<string, string>, plan: PatchPlan): Promise<string> {
  const vault = await mkdtemp(join(tmpdir(), "onix-project-links-"));
  const inboxPath = "Onix/Sessions/session-inbox.md";
  const allFiles = {
    ...files,
    [inboxPath]: "---\nonix_session_id: s1\n---\n",
    ".onix/state/active-session.json": JSON.stringify({
      schemaVersion: 1,
      sessionId: "s1",
      startedAt: "2026-09-25T00:00:00.000Z",
      inboxPath
    })
  };

  for (const [path, content] of Object.entries(allFiles)) {
    await mkdir(dirname(join(vault, path)), { recursive: true });
    await writeFile(join(vault, path), content);
  }

  await mkdir(join(vault, ".onix", "plans"), { recursive: true });
  await writeFile(join(vault, ".onix", "plans", `${plan.planId}.json`), JSON.stringify(plan, null, 2));
  return vault;
}

async function review(vault: string, ...actions: ReviewActionInput[]): Promise<void> {
  for (const action of actions) {
    await recordReviewAction(vault, "project-plan", action);
  }
}

describe("renderKnowledgeLink", () => {
  test("links to the first heading of the knowledge block", () => {
    expect(renderKnowledgeLink("Fixed the CI image", "Docker/Docker.md", dockerBlock)).toBe(
      "- Fixed the CI image → [[Docker/Docker#Rebuild without cache]]"
    );
  });

  test("links to the note when the block has no heading", () => {
    expect(renderKnowledgeLink("Fixed the CI image", "Docker/Docker.md", "Plain paragraph.")).toBe(
      "- Fixed the CI image → [[Docker/Docker]]"
    );
  });

  test("ignores heading-like lines inside fenced code blocks", () => {
    expect(renderKnowledgeLink("Used it", "Git/Git.md", "```bash\n# not a heading\n```\n\n### Real heading")).toBe(
      "- Used it → [[Git/Git#Real heading]]"
    );
  });
});

describe("apply with Project Context", () => {
  test("stores reusable knowledge in its topic and links it from the Project Note", async () => {
    const vault = await vaultWith(
      { "Docker/Docker.md": "# Docker\n", "Projects/Onix.md": "# Onix\n" },
      planWith([knowledgeItem()])
    );
    await review(vault, { action: "approve", itemId: "item-1" });

    const result = await applySession(vault, "project-plan");

    expect(result.changedFiles).toEqual(["Docker/Docker.md", "Projects/Onix.md"]);
    await expect(readFile(join(vault, "Docker/Docker.md"), "utf8")).resolves.toBe(`# Docker\n\n${dockerBlock}\n`);
    await expect(readFile(join(vault, "Projects/Onix.md"), "utf8")).resolves.toBe(
      "# Onix\n\n## Knowledge links\n\n- Fixed the stale dependency layer in the CI image → [[Docker/Docker#Rebuild without cache]]\n"
    );
  });

  test("derives the link from the reviewed destination after a move", async () => {
    const vault = await vaultWith({ "Projects/Onix.md": "# Onix\n" }, planWith([knowledgeItem()]));
    await review(vault, { action: "move", itemId: "item-1", destinationPath: "Containers/Docker.md" });

    await applySession(vault, "project-plan");

    await expect(readFile(join(vault, "Projects/Onix.md"), "utf8")).resolves.toContain(
      "[[Containers/Docker#Rebuild without cache]]"
    );
  });

  test("appends to an existing Knowledge links section without disturbing later sections", async () => {
    const vault = await vaultWith(
      {
        "Projects/Onix.md": "# Onix\n\n## Knowledge links\n\n- Earlier → [[Git/Git]]\n\n## Decisions\n\nKeep the CLI local.\n"
      },
      planWith([
        knowledgeItem(),
        knowledgeItem({
          id: "item-2",
          kind: "project-context",
          destinationPath: "Projects/Onix.md",
          proposedContent: "## Release decision\n\nShip the CI image weekly.",
          project: undefined,
          projectUsage: undefined
        })
      ])
    );
    await review(vault, { action: "approve", itemId: "item-1" }, { action: "approve", itemId: "item-2" });

    await applySession(vault, "project-plan");

    await expect(readFile(join(vault, "Projects/Onix.md"), "utf8")).resolves.toBe(
      [
        "# Onix",
        "",
        "## Knowledge links",
        "",
        "- Earlier → [[Git/Git]]",
        "- Fixed the stale dependency layer in the CI image → [[Docker/Docker#Rebuild without cache]]",
        "",
        "## Decisions",
        "",
        "Keep the CLI local.",
        "",
        "## Release decision",
        "",
        "Ship the CI image weekly.",
        ""
      ].join("\n")
    );
  });

  test("writes no link when the knowledge item is discarded", async () => {
    const vault = await vaultWith({ "Projects/Onix.md": "# Onix\n" }, planWith([knowledgeItem()]));
    await review(vault, { action: "discard", itemId: "item-1" });

    const result = await applySession(vault, "project-plan");

    expect(result.changedFiles).toEqual([]);
    await expect(readFile(join(vault, "Projects/Onix.md"), "utf8")).resolves.toBe("# Onix\n");
  });
});
