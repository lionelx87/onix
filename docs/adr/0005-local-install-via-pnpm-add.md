# ADR 0005: Local terminal installation via pnpm add -g

## Status

Accepted for slice #13.

## Context

The Learning Capture MVP **CLI Interface** is functionally complete but can only
be run from inside the repository through `pnpm onix <command>`. Slice #13 is the
final delivery step: make `onix` installable as a regular terminal command for
**Local Vault Operation**, documented, validated, and covered by a deterministic
smoke test, without introducing automatic npm publishing.

The existing packaging configuration is broken:

- `package.json` declares `"bin": { "onix": "./dist/main.js" }`, but the build
  uses `tsconfig.json` with `rootDir: "."` and an `include` that adds
  `test/**/*.ts` and `vitest.config.ts`. `tsc` therefore emits the entrypoint at
  `dist/src/main.js`, so the declared `bin` target does not exist.
- The same build pollutes `dist/` with `dist/test/` and `dist/vitest.config.js`,
  which would ship alongside the command because `"files": ["dist"]`.
- The compiled entrypoint preserves its `#!/usr/bin/env node` shebang but is
  emitted without an execute bit.

## Decision

Support a local, source-based installation and fix the packaging so it works.

- **Installation mechanism: `pnpm add -g .`.** Run from the repository after a
  build, it registers the package's `onix` bin globally. pnpm 11 removed
  `pnpm link --global`; `pnpm add -g .` is its documented replacement. Verified
  behavior: pnpm symlinks the global package back to the repository
  (`global/v11/.../node_modules/onix -> <repo>`), so the global shim runs the
  repository's `dist/main.js` and a later `git pull && pnpm build` updates the
  command in place with no re-install.
- **Packaging fix: a dedicated `tsconfig.build.json`** that narrows the build to
  production sources (`include: ["src/**/*.ts"]`, `rootDir: "src"`,
  `outDir: "dist"`). It emits the entrypoint at `dist/main.js`, matching the
  existing `bin` value (unchanged), and keeps `dist/` free of test artifacts. The
  base `tsconfig.json` is unchanged and continues to drive editor typechecking
  and `pnpm typecheck` across both `src` and `test`. The `build` script targets
  the new config.
- **Execute bit:** a `postbuild` step runs `chmod +x dist/main.js` so the shebang
  is directly executable regardless of how the symlink is invoked.
- **Deterministic smoke test: `pnpm smoke`.** It builds, then runs the compiled
  `node dist/main.js --help` from a temporary working directory and asserts exit
  code `0` plus the expected command surface, with no live LLM calls.
- **No automatic npm publishing** or hosted distribution. Publishing, if ever
  wanted, is a separate decision.

## Rationale

`pnpm add -g .` fits a "production-ish from source" workflow with the lowest
update friction: because pnpm links the global package back to the repository,
the global command always reflects the latest local build. `npm install -g .`
copies the package and forces a reinstall after every pull; a manual shell alias
or PATH entry is fragile and undocumented. Linking keeps the single source of
truth in the repository.

A dedicated build config is preferable to repointing `bin` at `./dist/src/main.js`
because it keeps `dist/` a clean, publishable artifact and leaves the `bin` value
correct and conventional. Splitting build from typecheck also keeps editor and
`pnpm typecheck` coverage over `test/` intact.

`chmod +x` guarantees the entrypoint runs via its shebang even if a consumer
invokes the file directly. The smoke test validates the built artifact
end-to-end, deterministically, satisfying the slice's "no live LLM" requirement
while proving the command works from outside the repository.

The PATH caveat is documented rather than automated: pnpm's global bin directory
must be on `PATH`, which `pnpm setup` configures once. Calling this out in the
README avoids a confusing "command not found" on first install.

## Consequences

`README.md` documents the supported install path (`pnpm install` -> `pnpm build`
-> `pnpm add -g .`, plus `pnpm setup` if needed), the update-after-pull path
(`pnpm install && pnpm build`, no re-install), and uninstall (`pnpm remove -g
onix`), including the Node `>=24 <27` and pnpm 11 requirements already declared
in `engines`/`packageManager`.

`dist/` becomes a clean artifact containing only compiled production sources. The
existing CLI command surface and behavior are unchanged; this slice only fixes
packaging and documentation.

A future slice can add real npm publishing or OS-level packaging if distribution
beyond local source installs is decided. After #13 is merged and verified, PRD #1
can be closed: #13 is its last open child slice.
