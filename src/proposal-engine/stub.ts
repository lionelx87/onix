import type { PatchPlan, ProposalEngine, ProposalEngineInput } from "./contract.js";
import { parsePatchPlan } from "./contract.js";

export function createStubProposalEngine(): ProposalEngine {
  return {
    async propose(input: ProposalEngineInput): Promise<PatchPlan> {
      const captures = input.freeformCapture
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      return parsePatchPlan({
        schemaVersion: 1,
        planId: "stubbed-plan",
        summary:
          captures.length === 0
            ? "No Freeform Captures found in the Session Inbox."
            : "Stubbed Organization Proposal generated from the Session Inbox.",
        items: captures.map((capture, index) => ({
          id: `item-${index + 1}`,
          kind: "consolidated-knowledge",
          destinationPath: "Knowledge/Session Inbox.md",
          sourceTrace: `${input.sessionInboxPath} line ${index + 1}`,
          proposedContent: capture
        }))
      });
    }
  };
}
