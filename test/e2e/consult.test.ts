/**
 * `magi plan` and `magi review`, run as processes that really convene.
 *
 * This is the command the rest of the tool exists for, and the one with the
 * most between the argument and the answer: curation, two preflights, a
 * rendered brief per seat, three binaries resolved through PATH, three
 * different envelope shapes parsed back, a validity gate, and a state
 * directory written durably. Every piece has a unit test. Nothing but a real
 * run has the whole chain.
 *
 * The seats are `fixtures/seats/stub-harness.mjs` under the three names the
 * launch profiles resolve, so the fan-out is real and the model is not. Each
 * stub answers with the id of the brief it was handed and cites the last
 * evidence id in it, which is the one this run's own pack minted.
 *
 * Both halves have to be asserted, and only the first one used to be. A seat
 * handed no pack still answers: the stub cites nothing and returns no finding,
 * and an opinion carrying no finding passes the gate. So a convene whose pack
 * never arrived would have passed this suite on the consult id alone.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  convenedId,
  git,
  initRepo,
  installStubHarnesses,
  magi,
  workspace,
  writeBrief,
  type Workspace,
} from "../support/cli.ts";

const BRIEF = "# Brief\n\nShould the greeting move into its own module?\n";

/**
 * Review derives its patch from git and refuses to guess which delta it is
 * about, so every review here pins one. `HEAD` means the working tree against
 * the last commit, which is the pending change a reviewer would be looking at.
 */
const REVIEW = ["review", "--brief", "brief.md", "--base", "HEAD"];

/** A repository with a real tracked change, which is what review reviews. */
async function repoWithChange(space: Workspace): Promise<void> {
  await initRepo(space.repo);
  writeFileSync(join(space.repo, "greet.ts"), "export const greet = () => 'hi';\n");
  await git(space.repo, ["add", "greet.ts"]);
  await git(space.repo, ["commit", "--quiet", "-m", "feat: add a greeting"]);
  writeFileSync(join(space.repo, "greet.ts"), "export const greet = () => 'hello there';\n");
  writeBrief(space.repo, BRIEF);
}

test("--dry-run runs everything a consult runs except the spending", async () => {
  const space = workspace();
  try {
    await repoWithChange(space);
    installStubHarnesses(space.bin);
    const run = await magi([...REVIEW, "--dry-run"], space);

    assert.equal(run.code, 0);
    assert.match(run.out, /headroom/u, "the preflight ran");
    assert.match(run.out, /dry run: review would convene 3 seats/u);
    assert.match(run.out, /nothing was spent/u);
    // The claim is that nothing was spent, so the proof is that no run was
    // recorded: a dry run that wrote a record spent something.
    assert.ok(!existsSync(join(space.repo, ".magi", "ledger.jsonl")));
  } finally {
    space.remove();
  }
});

test("plan needs no patch, and dry-runs on a repository with nothing pending", async () => {
  const space = workspace();
  try {
    await initRepo(space.repo);
    writeBrief(space.repo, BRIEF);
    const run = await magi(["plan", "--brief", "brief.md", "--dry-run"], space);

    assert.equal(run.code, 0);
    assert.match(run.out, /dry run: plan would convene 3 seats/u);
  } finally {
    space.remove();
  }
});

test("review with nothing pending refuses rather than convening on an empty patch", async () => {
  const space = workspace();
  try {
    await initRepo(space.repo);
    writeBrief(space.repo, BRIEF);
    const run = await magi([...REVIEW, "--dry-run"], space);

    assert.equal(run.code, 2);
    assert.match(run.err, /nothing to review/u);
    // Refused before a line reached stdout, so no block was opened for a
    // command that had nothing to put in it.
    assert.equal(run.out, "");
  } finally {
    space.remove();
  }
});

test("a brief that is not there is refused before any work happens", async () => {
  const space = workspace();
  try {
    await repoWithChange(space);
    const run = await magi(["review", "--brief", "no-such-brief.md", "--base", "HEAD"], space);

    assert.equal(run.code, 2);
    assert.notEqual(run.err, "");
    assert.equal(run.out, "", "nothing was reported, because nothing ran");
  } finally {
    space.remove();
  }
});

test("a repository that does not ignore the state directory refuses to convene", async () => {
  const space = workspace();
  try {
    await repoWithChange(space);
    writeFileSync(join(space.repo, ".gitignore"), "node_modules/\n");
    const run = await magi(REVIEW, space);

    assert.equal(run.code, 1);
    assert.match(run.err, /not ignored by this repository/u);
    assert.equal(run.out, "");
  } finally {
    space.remove();
  }
});

test("a review convenes three seats for real and records what each one said", async () => {
  const space = workspace();
  try {
    await repoWithChange(space);
    installStubHarnesses(space.bin);
    const run = await magi(REVIEW, space);

    assert.equal(run.code, 0, run.err);
    const id = convenedId(run.out);
    assert.match(run.out, /: complete/u, "three valid answers is a complete run");
    for (const label of ["Melchior-1", "Balthasar-2", "Casper-3"]) {
      assert.ok(run.out.includes(`${label}: valid`), `${label} passed the gate`);
    }
    assert.ok(!run.out.includes("INVALID"));

    // The gate record is the run's own account of the three answers, and it
    // is what `magi checks` reads afterwards.
    const gate = readFileSync(join(space.repo, ".magi", "consults", id, "gate.json"), "utf8");
    for (const harness of ["claude", "codex", "grok"]) {
      // Each seat quotes back the id of the brief it was handed. Three
      // different transports carry it, two on stdin and one through a file,
      // so this is the assertion that all three arrived.
      assert.ok(
        gate.includes(`stub seat for ${harness} on ${id}`),
        `${harness} was handed this run's own brief`,
      );
    }

    // The id the pack minted, read off the tail of the brief this run wrote to
    // disk: it sits past everything the caller's own text could have put in
    // front of it, so a seat quoting it back received the pack and not just a
    // header carrying the run id.
    const brief = readFileSync(join(space.repo, ".magi", "consults", id, "brief.md"), "utf8");
    const minted = [...brief.matchAll(/^##\s+(E[1-9][0-9]*)\s/gmu)].at(-1)?.[1];
    assert.ok(minted !== undefined, "the rendered brief carries an evidence pack at all");
    for (const verdict of JSON.parse(gate).verdicts) {
      assert.deepEqual(
        verdict.opinion.findings.flatMap((finding: { citations: string[] }) => finding.citations),
        [minted],
        `${verdict.slot} cited the evidence id this run's own pack minted`,
      );
    }

    assert.ok(existsSync(join(space.repo, ".magi", "ledger.jsonl")), "the run reached the ledger");
    const synthesis = /scaffold: (\S+)/u.exec(run.out)?.[1];
    assert.ok(synthesis !== undefined && existsSync(synthesis), "the synthesis scaffold is on disk");
  } finally {
    space.remove();
  }
});

test("a plan convenes on a repository with no pending change at all", async () => {
  const space = workspace();
  try {
    await initRepo(space.repo);
    writeBrief(space.repo, BRIEF);
    installStubHarnesses(space.bin);
    const run = await magi(["plan", "--brief", "brief.md", "--slug", "greeting-shape"], space);

    assert.equal(run.code, 0, run.err);
    const id = convenedId(run.out);
    assert.match(id, /-greeting-shape$/u, "the slug the user chose names the run");

    // Plan and review are different briefs, and a seat answers the one it was
    // given: the mode in the answer is read back out of the recorded opinion.
    const gate = readFileSync(join(space.repo, ".magi", "consults", id, "gate.json"), "utf8");
    assert.ok(gate.includes('"mode":"plan"') || gate.includes('"mode": "plan"'));
    assert.equal(
      readdirSync(join(space.repo, ".magi", "consults")).length,
      1,
      "one invocation, one run",
    );
  } finally {
    space.remove();
  }
});

test("a supplied patch and an excerpt both reach the brief every seat is handed", async () => {
  // Curation is rule-driven and unit-tested, but what it curates only matters
  // if it arrives. The rendered brief on disk is the exact text the three
  // seats were given, so it is where the two caller-supplied channels are
  // checked: a patch nobody derived from git, and an excerpt whose only job
  // is to add commentary the rules would not have collected.
  const space = workspace();
  try {
    await repoWithChange(space);
    installStubHarnesses(space.bin);
    writeFileSync(
      join(space.repo, "change.patch"),
      [
        "diff --git a/greet.ts b/greet.ts",
        "--- a/greet.ts",
        "+++ b/greet.ts",
        "@@ -1 +1 @@",
        "-export const greet = () => 'hi';",
        "+export const greet = () => 'hello there';",
        "",
      ].join("\n"),
    );

    const run = await magi(
      ["review", "--brief", "brief.md", "--patch", "change.patch", "--excerpt", "greet.ts:1-1"],
      space,
    );

    assert.equal(run.code, 0, run.err);
    const id = convenedId(run.out);
    const brief = readFileSync(join(space.repo, ".magi", "consults", id, "brief.md"), "utf8");
    assert.match(brief, /Mode: review/u, "the seats were handed the review template");
    assert.ok(brief.includes("hello there"), "the supplied patch is in the brief");
    assert.ok(brief.includes("greet.ts:1-1"), "the excerpt is cited in the pack");
  } finally {
    space.remove();
  }
});
