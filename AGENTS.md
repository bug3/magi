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
- Runtime dependency: `@clack/prompts`, for the command-line rendering in
  `src/util/ui.ts` and the folder behind it: the frames, the progress, the
  folded subprocess output and the questions. Dev dependencies: `typescript`, `@types/node` and
  `publish-preflight`. Every dependency is pinned exact.
- `npm run check` = `tsc --noEmit` + every `test/**/*.test.ts` file. Green at
  every commit.
- `npm run preflight` packs the package and installs it the way a consumer
  would. `prepublishOnly` runs the check, then the preflight.

## Releasing

One order: bump the version, publish, tag the commit that was published, push
the branch and the tag together, then draw a GitHub release from that tag.

- `prepublishOnly` runs the check and the preflight, so a version is proved
  before it exists. Nothing else needs to run first.
- Every tag carries a release, written for someone deciding whether to
  upgrade: what changed, and what it was wrong about before. `gh release
  create <tag> --verify-tag` binds it to the tag already pushed rather than
  minting a new one. Five releases were once tagged and published with no
  release drawn at all, which is invisible from the npm side and obvious from
  the repository.
- A tag names the tree the registry received. Where that is not the bump
  commit it still follows the tarball: `v0.3.0` marks a later commit because
  work landed while a publish was blocked on credentials. A tag that is
  already published is never moved.
- Nothing is published that a council review has not seen. Three releases in
  one day each shipped ahead of the review that found what was wrong with
  them, and 0.2.1 went out carrying a canary that would record a real
  isolation leak as a pass.

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
- Every byte a command prints goes through `src/util/ui.ts` and the folder it
  fronts. It decides the stream (a result on stdout, a refusal on stderr), and
  it is where the `@clack/prompts` rendering lives. Nothing else under `src/`
  calls `console`, touches `process.stdout`/`process.stderr`, or imports the
  renderer directly, and no command prints undecorated text on its own
  say-so; `test/spec/writers.test.ts` guards both halves.
- How much is drawn is decided once, on whether a person is looking. A
  terminal gets the framed reports, the progress, the folded subprocess output
  and the questions. A pipe gets the bytes it got before any of that existed,
  because `--version` is parsed, the usage block is copied out of a terminal,
  and MAGI's own check transcript travels in every evidence pack. CI counts as
  a pipe, and so does a terminal too narrow to frame a block or one that will
  not say how wide it is.
- Interaction is never required, and asking is not drawing: a terminal too
  narrow to frame a block is still a terminal with a person at it, and is
  still asked. MAGI is driven by an orchestrating assistant through a pipe, so
  every question states the answer it falls through to.
  Spending quota falls through to yes, because invoking the command is the
  approval, and `--yes` skips the question a terminal would ask; replacing
  something this installation did not put there falls through to no, and no
  flag unlocks it.
- A long wait on a terminal is drawn, and while it is drawn an exit of zero is
  rewritten to 130. The renderer draws a spinner by seizing stdin and calling
  `process.exit(0)` on the cancel key, so without that guard an interrupted
  fan-out reports success with nothing gated and nothing in the ledger;
  `test/util/ui-progress.test.ts` measures both directions in a real process.
- `test/e2e/` runs each command as a spawned process against a temporary
  repository, HOME and PATH. The PATH holds only that workspace, so a test
  cannot reach a real harness CLI; `fixtures/seats/stub-harness.mjs` is
  installed into it under the three names the launch profiles resolve.

## File size

| Target | Rule |
|---|---|
| ~150 lines | where most files land |
| 300 lines | hard ceiling for `src/**`, enforced by `test/spec/modularity.test.ts` |
| 400 lines | hard ceiling for `test/**`, whose length follows its case count |
