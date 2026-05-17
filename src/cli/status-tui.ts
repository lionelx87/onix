import type * as Blessed from "blessed";
import type { StatusReport } from "../status.js";

export async function runStatusDashboard(report: StatusReport): Promise<string | undefined> {
  const blessedModule = await import("blessed");
  const blessed = ((blessedModule as { default?: unknown }).default ?? blessedModule) as typeof Blessed;

  const vaultLabel = report.vault ?? "no vault";

  return await new Promise((resolve) => {
    const screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      title: "Onix · Status"
    });

    blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      right: 0,
      height: 1,
      tags: true,
      style: { fg: "white", bg: "blue", bold: true },
      content: ` Onix · {bold}${vaultLabel}{/} `
    });

    blessed.box({
      parent: screen,
      label: " Active Session ",
      top: 1,
      left: 0,
      width: "50%",
      height: 8,
      border: { type: "line" },
      style: { border: { fg: "cyan" } },
      tags: true,
      content: buildActiveSessionContent(report)
    });

    blessed.box({
      parent: screen,
      label: " Classification Rules ",
      top: 1,
      left: "50%",
      right: 0,
      height: 8,
      border: { type: "line" },
      style: { border: { fg: "magenta" } },
      tags: true,
      content: `\n  {bold}${report.approvedClassificationRulesCount}{/} approved`
    });

    const plansList = blessed.list({
      parent: screen,
      label: " Patch Plans ",
      top: 9,
      left: 0,
      right: 0,
      bottom: 1,
      border: { type: "line" },
      style: {
        border: { fg: "gray" },
        selected: { bg: "blue", fg: "white", bold: true }
      },
      keys: true,
      vi: true,
      tags: true,
      items: report.plans.length === 0
        ? [" {gray-fg}No Patch Plans yet. Run `onix close` to generate one.{/}"]
        : report.plans.map(formatPlanRow)
    });

    blessed.box({
      parent: screen,
      bottom: 0,
      left: 0,
      right: 0,
      height: 1,
      tags: true,
      style: { fg: "white", bg: "gray" },
      content: report.plans.length === 0
        ? " q quit "
        : " ↑↓ navigate · {bold}Enter{/} open review · q quit "
    });

    plansList.focus();

    const close = (planId?: string): void => {
      screen.destroy();
      resolve(planId);
    };

    plansList.on("select", (_item: unknown, index: number) => {
      const selected = report.plans[index];
      if (selected === undefined) return;
      close(selected.planId);
    });

    screen.key(["q", "C-c", "escape"], () => close());

    screen.render();
  });
}

function buildActiveSessionContent(report: StatusReport): string {
  if (report.activeSession === undefined) {
    return "\n  {gray-fg}No Active Session.{/}\n  Run {bold}onix start{/} to begin capturing.";
  }
  const session = report.activeSession;
  return [
    "",
    `  {bold}ID{/}      ${session.sessionId}`,
    `  {bold}Inbox{/}   ${session.inboxPath}`,
    `  {bold}Started{/} ${session.startedAt}`
  ].join("\n");
}

function formatPlanRow(plan: StatusReport["plans"][number]): string {
  const isDone = plan.pendingItems === 0;
  const badge = isDone ? "{green-fg}✓{/}" : "{yellow-fg}○{/}";
  const ratio = `${plan.decidedItems}/${plan.totalItems}`;
  const bar = renderProgressBar(plan.decidedItems, plan.totalItems);
  const rules = plan.pendingRuleCandidates.length > 0
    ? ` · {yellow-fg}⚑ ${plan.pendingRuleCandidates.length} rule cand.{/}`
    : "";
  return ` ${badge}  {bold}${plan.planId}{/}   ${bar}  ${ratio} decided${rules}`;
}

function renderProgressBar(decided: number, total: number, width = 18): string {
  if (total === 0) return "{gray-fg}".concat("░".repeat(width), "{/}");
  const filled = Math.round((decided / total) * width);
  const empty = width - filled;
  return `{green-fg}${"█".repeat(filled)}{/}{gray-fg}${"░".repeat(empty)}{/}`;
}
