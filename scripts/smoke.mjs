import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const binPath = join(repoRoot, "dist", "main.js");
const expectedCommands = ["start", "close", "review", "apply", "status", "use", "editor", "provider", "model"];

function fail(message, detail) {
  console.error(`smoke: ${message}`);
  if (detail !== undefined && detail.trim().length > 0) {
    console.error(detail);
  }
  process.exit(1);
}

if (!existsSync(binPath)) {
  fail(`built entrypoint not found at ${binPath}; the package bin does not resolve`);
}

const result = spawnSync(binPath, ["--help"], { cwd: tmpdir(), encoding: "utf8" });

if (result.error !== undefined && result.error !== null) {
  fail(`could not launch the built entrypoint: ${result.error.message}`);
}

if (result.status !== 0) {
  fail(`"onix --help" exited with status ${result.status}`, result.stderr);
}

const missing = expectedCommands.filter((name) => !result.stdout.includes(name));
if (missing.length > 0) {
  fail(`"onix --help" output is missing commands: ${missing.join(", ")}`, result.stdout);
}

console.log(`smoke: onix --help launched from ${tmpdir()} and exposed: ${expectedCommands.join(", ")}`);
