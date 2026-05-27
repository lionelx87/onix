import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

let configDir: string | undefined;
let originalXdgConfigHome: string | undefined;
let originalProposalEngine: string | undefined;

beforeEach(async () => {
  originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  configDir = await mkdtemp(join(tmpdir(), "onix-test-config-"));
  process.env.XDG_CONFIG_HOME = configDir;

  originalProposalEngine = process.env.ONIX_PROPOSAL_ENGINE;
  process.env.ONIX_PROPOSAL_ENGINE = "stub";
});

afterEach(async () => {
  if (originalXdgConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
  }

  if (originalProposalEngine === undefined) {
    delete process.env.ONIX_PROPOSAL_ENGINE;
  } else {
    process.env.ONIX_PROPOSAL_ENGINE = originalProposalEngine;
  }

  if (configDir !== undefined) {
    await rm(configDir, { recursive: true, force: true });
    configDir = undefined;
  }
});
