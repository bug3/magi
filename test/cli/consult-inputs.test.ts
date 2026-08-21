import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { ReviewArgs } from "../../src/cli/args.ts";
import { checkInputs } from "../../src/cli/consult-inputs.ts";

/** The repository this suite runs in: the one git ref check that is real. */
const REPO = process.cwd();

function world(brief = "review the change\n"): string {
  const briefFile = join(mkdtempSync(join(tmpdir(), "magi-inputs-")), "brief.md");
  writeFileSync(briefFile, brief);
  return briefFile;
}

function args(over: Partial<ReviewArgs> & { briefFile: string }): ReviewArgs {
  return { slug: "review", excerpts: [], waiveHeadroom: false, waiveBackfill: false, ...over };
}

/** What the check refused, or nothing when it passed. */
async function problem(over: Partial<ReviewArgs> & { briefFile: string }): Promise<string> {
  const result = await checkInputs(args(over), REPO);
  return result.ok ? "" : result.problem;
}

test("a brief that is not there is refused by its own flag", async () => {
  assert.match(await problem({ briefFile: "/nonexistent.md" }), /^--brief: no such file/u);
});

test("every other named file is refused by its own flag too", async () => {
  const briefFile = world();
  for (const [over, flag] of [
    [{ patchFile: "/nonexistent.patch" }, "--patch"],
    [{ testOutputFile: "/nonexistent.txt" }, "--test-output"],
    [{ excerpts: [{ path: "nonexistent.ts" }] }, "--excerpt"],
  ] as const) {
    assert.match(await problem({ briefFile, ...over }), new RegExp(`^${flag}: no such file`, "u"));
  }
});

test("an empty brief is refused before any seat is spawned", async () => {
  for (const empty of ["", "   \n\t\n"]) {
    assert.match(await problem({ briefFile: world(empty) }), /^--brief: .* is empty/u);
  }
});

test("a directory where a file was named is refused, not thrown", async () => {
  const dir = mkdtempSync(join(tmpdir(), "magi-dir-"));
  assert.match(
    await problem({ briefFile: world(), patchFile: dir }),
    /^--patch: cannot read .* \(EISDIR\)/u,
  );
  assert.match(await problem({ briefFile: dir }), /^--brief: cannot read /u);
});

test("a file the process cannot read is refused, not thrown", async () => {
  const locked = join(mkdtempSync(join(tmpdir(), "magi-locked-")), "patch.diff");
  writeFileSync(locked, "diff\n");
  chmodSync(locked, 0o000);
  try {
    readFileSync(locked);
    return; // a user the mode does not bite: nothing to assert
  } catch {
    // the mode holds, so the check below is meaningful
  }
  assert.match(
    await problem({ briefFile: world(), patchFile: locked }),
    /^--patch: cannot read .* \(EACCES\)/u,
  );
});

test("a slug no consult id could carry is refused by name", async () => {
  const briefFile = world();
  for (const slug of ["Review", "two words", "trailing-", "sl/ash", ""]) {
    assert.match(await problem({ briefFile, slug }), /^--slug: not a kebab slug/u);
  }
});

test("an excerpt window past the end of its file is refused by name", async () => {
  const briefFile = world();
  const lines = readFileSync(join(REPO, "README.md"), "utf8").split("\n").length;
  assert.match(
    await problem({ briefFile, excerpts: [{ path: "README.md", startLine: 1, endLine: lines + 50 }] }),
    /^--excerpt: README\.md has \d+ lines/u,
  );
  assert.match(
    await problem({ briefFile, excerpts: [{ path: "README.md", startLine: 40, endLine: 2 }] }),
    /^--excerpt: not a line window/u,
  );
  assert.match(
    await problem({ briefFile, excerpts: [{ path: "README.md", startLine: 0, endLine: 3 }] }),
    /^--excerpt: not a line window/u,
  );
});

test("a review with nothing to review is refused before any seat", async () => {
  const result = await checkInputs(args({ briefFile: world() }), REPO, "review");
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.problem, /^review needs something to review/u);
});

test("plan needs no target, and a review with one passes", async () => {
  assert.equal((await checkInputs(args({ briefFile: world() }), REPO, "plan")).ok, true);
  assert.equal((await checkInputs(args({ briefFile: world(), base: "HEAD" }), REPO, "review")).ok, true);
});

test("a base that is not a commit in this repository is refused by name", async () => {
  assert.match(
    await problem({ briefFile: world(), base: "no-such-ref-anywhere" }),
    /^--base: not a commit/u,
  );
});

test("a working directory that is no repository says so, not \"no such commit\"", async () => {
  const outside = mkdtempSync(join(tmpdir(), "magi-norepo-"));
  const result = await checkInputs(args({ briefFile: world(), base: "HEAD" }), outside);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.problem, /^--base: .* is not a git repository/u);
});

test("inputs that are all there come back with the brief that was checked", async () => {
  const briefFile = world("the question\n");
  const result = await checkInputs(
    args({ briefFile, base: "HEAD", excerpts: [{ path: "README.md", startLine: 1, endLine: 3 }] }),
    REPO,
    "review",
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.briefMd : "", "the question\n");
});
