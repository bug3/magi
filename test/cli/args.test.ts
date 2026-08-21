import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { COMMAND_USAGE, COMMANDS, main, parseExcerpt, parseReviewArgs } from "../../src/cli.ts";

/**
 * `main` writes usage and versions to the console. A suite that lets that
 * through puts the whole usage block in the repository check transcript,
 * which the evidence floor then carries into every pack, for every seat. So
 * the output is captured and asserted on here rather than printed.
 */
async function runMain(argv: readonly string[]): Promise<{
  readonly code: number;
  readonly printed: readonly string[];
}> {
  const { log, error } = console;
  const printed: string[] = [];
  const capture = (...args: unknown[]): void => {
    printed.push(args.map(String).join(" "));
  };
  console.log = capture;
  console.error = capture;
  try {
    return { code: await main(argv), printed };
  } finally {
    console.log = log;
    console.error = error;
  }
}

/** The exit code alone, for the cases that only assert refusal. */
async function quietMain(argv: readonly string[]): Promise<number> {
  return (await runMain(argv)).code;
}

test("an excerpt spec with a window splits into path and lines", () => {
  assert.deepEqual(parseExcerpt("src/util/fs.ts:12-40"), {
    path: "src/util/fs.ts",
    startLine: 12,
    endLine: 40,
  });
});

test("a colon that is not a line window stays part of the path", () => {
  assert.deepEqual(parseExcerpt("notes:final.md"), { path: "notes:final.md" });
  assert.deepEqual(parseExcerpt("plain.md"), { path: "plain.md" });
});

test("review args collect repeatable flags in order", () => {
  const args = parseReviewArgs([
    "--brief",
    "brief.md",
    "--slug",
    "fs-review",
    "--excerpt",
    "a.ts:1-5",
    "--excerpt",
    "b.ts",
    "--patch",
    "diff.patch",
  ]);
  assert.equal(args.slug, "fs-review");
  assert.equal(args.briefFile, "brief.md");
  assert.deepEqual(args.excerpts.map((excerpt) => excerpt.path), ["a.ts", "b.ts"]);
  assert.equal(args.patchFile, "diff.patch");
  assert.equal(args.testOutputFile, undefined);
  assert.equal(args.waiveHeadroom, false);
});

test("the hand-pick channel is gone: --convention is refused by name", () => {
  assert.throws(
    () => parseReviewArgs(["--brief", "b", "--convention", "CLAUDE.md"]),
    /unknown flag: --convention/,
  );
});

test("--waive-headroom is the user's explicit override, off by default", () => {
  const args = parseReviewArgs(["--brief", "b.md", "--waive-headroom"]);
  assert.equal(args.waiveHeadroom, true);
});

test("--base pins the review patch to a git ref", () => {
  assert.equal(parseReviewArgs(["--brief", "b", "--base", "main"]).base, "main");
  assert.equal(parseReviewArgs(["--brief", "b"]).base, undefined);
});

test("--waive-backfill is the user's explicit override, off by default", () => {
  assert.equal(parseReviewArgs(["--brief", "b.md"]).waiveBackfill, false);
  assert.equal(parseReviewArgs(["--brief", "b.md", "--waive-backfill"]).waiveBackfill, true);
});

test("the default slug follows the consult mode", () => {
  assert.equal(parseReviewArgs(["--brief", "b.md"], "review").slug, "review");
  assert.equal(parseReviewArgs(["--brief", "b.md"], "plan").slug, "plan");
});

test("plan refuses review-only patch pins", () => {
  assert.throws(() => parseReviewArgs(["--brief", "b.md", "--base", "main"], "plan"), /review/);
  assert.throws(() => parseReviewArgs(["--brief", "b.md", "--patch", "p.diff"], "plan"), /review/);
});

test("a missing brief is refused before anything runs", () => {
  assert.throws(() => parseReviewArgs(["--slug", "x"]), /--brief is required/);
});

test("an unknown flag is refused by name", () => {
  assert.throws(() => parseReviewArgs(["--brief", "b", "--bogus"]), /unknown flag: --bogus/);
});

test("a flag at the end without its value is refused", () => {
  assert.throws(() => parseReviewArgs(["--brief"]), /--brief needs a value/);
});

test("an unknown command prints usage and exits 2", async () => {
  assert.equal(await quietMain(["frobnicate"]), 2);
});

test("help is an explicit successful command", async () => {
  assert.match(COMMAND_USAGE, /magi plan/);
  assert.equal(await quietMain(["--help"]), 0);
});

test("subcommands reject arguments they do not understand", async () => {
  assert.equal(await quietMain(["doctor", "--bogus"]), 2);
  assert.equal(await quietMain(["triggers", "--bogus"]), 2);
  assert.equal(await quietMain(["checks", "0001-review", "extra"]), 2);
  assert.equal(await quietMain(["skill", "--bogus"]), 2);
  assert.equal(await quietMain(["skill", "--harness", "gemini"]), 2);
});

test("version is a successful command that reports the shipped manifest", async () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  const long = await runMain(["--version"]);
  const short = await runMain(["-v"]);
  assert.equal(long.code, 0);
  assert.equal(short.code, 0);
  // Read, never hardcoded: a literal here would pass while the published
  // package reported something else.
  assert.deepEqual([...long.printed, ...short.printed], [manifest.version, manifest.version]);
});

test("the README command reference stays identical to CLI usage", () => {
  const readme = readFileSync("README.md", "utf8");
  assert.ok(readme.includes(`\`\`\`\n${COMMAND_USAGE}\n\`\`\``));
});

test("the usage text names every command the CLI accepts", () => {
  // The drift rule this tool applies to three harness CLIs, applied to its own
  // surface: a command that works and is not printed is the same defect.
  const missing = COMMANDS.filter(
    (token) => !new RegExp(String.raw`(?:^|[\s|])${token}(?:$|[\s|[])`, "mu").test(COMMAND_USAGE),
  );
  assert.deepEqual(missing, [], "every accepted token belongs in the usage block");
});

test("a token the catalog does not name is an invocation error", async () => {
  // `magi delete` and `magi --live` were both typed at a real session and both
  // did nothing but print usage; the catalog is the line between the two.
  for (const token of ["delete", "--live", "consult", "calibrate"]) {
    assert.ok(!COMMANDS.includes(token), `${token} is not a command`);
    assert.equal(await quietMain([token]), 2, `${token} is refused as exit 2`);
  }
});
