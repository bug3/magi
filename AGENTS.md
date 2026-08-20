# MAGI

An advisory-council layer over three AI coding harnesses (Claude Code,
Codex CLI, Grok CLI). The orchestrator does the work; the council only
thinks. `README.md` is the tour; `docs/protocol.md` is the protocol every
mechanism here implements.

## Stack and commands

- TypeScript with no build step in development: source runs directly on
  Node's type stripping, and relative imports carry explicit `.ts`
  extensions. Publishing is the exception. Node refuses to strip types under
  `node_modules`, so `npm run build` emits `dist/` through
  `tsconfig.build.json` and the tarball ships that instead of the sources;
  `prepack` runs it, and `bin/magi.js` prefers the build when it is there.
- Node is pinned by `.mise.toml`.
- Zero runtime dependencies. Dev dependencies: `typescript`,
  `@types/node` and `publish-preflight`, all pinned exact.
- `npm run check` = `tsc --noEmit` + every `test/**/*.test.ts` file. Green at
  every commit.
- `npm run preflight` packs the package and installs it the way a consumer
  would. `prepublishOnly` runs the check, then the preflight.

## Where things live

- Cases are catalogs, not branches: seat briefs are `prompts/*.md`, the
  opinion contract is `schemas/opinion.v1.schema.json`, seat profiles and
  pins are `src/seats/`, the check vocabulary is
  `src/checks/vocabulary.ts`, the trigger thresholds are
  `src/consult/triggers.ts`.
- A folder beside a same-named `.ts` facade is the split shape: callers
  import `src/consult.ts`, never `src/consult/*`.
- Rules that must hold over the whole tree have a guard under `test/spec/`:
  module size, template contents, fixture coverage, publication hygiene.

## File size

| Target | Rule |
|---|---|
| ~150 lines | where most files land |
| 300 lines | hard ceiling for `src/**`, enforced by `test/spec/modularity.test.ts` |
| 400 lines | hard ceiling for `test/**`, whose length follows its case count |
