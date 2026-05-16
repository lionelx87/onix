import { describe, expect, test } from "vitest";
import { parsePatchPlan } from "../src/proposal-engine/contract.js";

describe("Proposal Engine contract", () => {
  test("accepts deterministic Patch Plan fixtures without an LLM provider", () => {
    const plan = parsePatchPlan({
      schemaVersion: 1,
      planId: "fixture-plan",
      summary: "Stubbed proposal for smoke testing.",
      items: [
        {
          id: "item-1",
          kind: "consolidated-knowledge",
          destinationPath: "Knowledge/Local CLI.md",
          sourceTrace: "Session Inbox line 1",
          proposedContent: "CLI scaffolds should keep provider calls behind a contract."
        }
      ]
    });

    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]?.kind).toBe("consolidated-knowledge");
  });
});
