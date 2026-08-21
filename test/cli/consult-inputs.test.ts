import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { inputProblem } from "../../src/cli/consult-command.ts";
import type { ReviewArgs } from "../../src/cli/args.ts";

/** The repository this suite runs in: the one git ref check that is real. */
const REPO = process.cwd();

function world(brief = "review the change\n"): string {
  const root = mkdtempSync(join(tmpdir(), "magi-inputs-"));
  const briefFile = join(root, "brief.md");
  writeFileSync(briefFile, brief);
  return briefFile;
}

function args(over: Partial<ReviewArgs> & { briefFile: string }): ReviewArgs {
  return {
    slug: "review",
    excerpts: [],
    waiveHeadroom: false,
    waiveBackfill: false,
    ...over,
  };
}

test("a brief that is not there is refused by its own flag", async () => {
  const problem = await inputProblem(args({ briefFile: "/nonexistent.md" }), REPO);
  assert.match(problem ?? "", /^--brief: no such file/u);
});

test("every other named file is refused by its own flag too", async () => {
  const briefFile = world();
  for (const [over, flag] of [
    [{ patchFile: "/nonexistent.patch" }, "--patch"],
    [{ testOutputFile: "/nonexistent.txt" }, "--test-output"],
    [{ excerpts: [{ path: "nonexistent.ts" }] }, "--excerpt"],
  ] as const) {
    const problem = await inputProblem(args({ briefFile, ...over }), REPO);
    assert.match(problem ?? "", new RegExp(`^${flag}: no such file`, "u"));
  }
});

test("an excerpt path is named relative to the repository", async () => {
  const briefFile = world();
  const problem = await inputProblem(args({ briefFile, excerpts: [{ path: "README.md" }] }), REPO);
  assert.equal(problem, undefined);
});

test("an empty brief is refused before any seat is spawned", async () => {
  for (const empty of ["", "   \n\t\n"]) {
    const problem = await inputProblem(args({ briefFile: world(empty) }), REPO);
    assert.match(problem ?? "", /^--brief: .* is empty/u);
  }
});

test("a base that is not a commit in this repository is refused by name", async () => {
  const briefFile = world();
  const problem = await inputProblem(args({ briefFile, base: "no-such-ref-anywhere" }), REPO);
  assert.match(problem ?? "", /^--base: not a commit/u);
});

test("inputs that are all there and a base that resolves are no problem", async () => {
  const briefFile = world();
  assert.equal(await inputProblem(args({ briefFile, base: "HEAD" }), REPO), undefined);
});
