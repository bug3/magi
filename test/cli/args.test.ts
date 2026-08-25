import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  COMMAND_USAGE,
  COMMANDS,
  SUBCOMMANDS,
  main,
  parseExcerpt,
  parseReviewArgs,
} from "../../src/cli.ts";
import { flagsOf, parseArgv } from "../../src/cli/parse.ts";
import { capture } from "../support/capture.ts";

/**
 * `main` writes usage and versions through the UI facade. A suite that lets
 * that through puts the whole usage block in the repository check transcript,
 * which the evidence floor then carries into every pack, for every seat. So
 * both streams are held in memory here and asserted on rather than printed.
 */
async function runMain(argv: readonly string[]): Promise<{
  readonly code: number;
  readonly out: string;
  readonly err: string;
}> {
  const { result, out, err } = await capture(() => main(argv));
  return { code: result, out, err };
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
    /unknown option '--convention'/,
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
  assert.throws(() => parseReviewArgs(["--slug", "x"]), /required option '--brief <file>' not specified/);
});

test("a flag joined to its value with = is the same flag", () => {
  // The form every GNU-style CLI takes and this one refused: `--brief=b.md`
  // was read as one unknown token, so a documented invocation exited 2.
  const args = parseReviewArgs(["--brief=brief.md", "--slug=fs-review", "--excerpt=a.ts:1-5"]);

  assert.equal(args.briefFile, "brief.md");
  assert.equal(args.slug, "fs-review");
  assert.deepEqual(args.excerpts, [{ path: "a.ts", startLine: 1, endLine: 5 }]);
});

test("an unknown flag is refused by name", () => {
  assert.throws(() => parseReviewArgs(["--brief", "b", "--bogus"]), /unknown option '--bogus'/);
});

test("a flag at the end without its value is refused", () => {
  assert.throws(() => parseReviewArgs(["--brief"]), /option '--brief <file>' argument missing/);
});

test("an unknown command prints usage and exits 2", async () => {
  assert.equal(await quietMain(["frobnicate"]), 2);
});

test("help is an explicit successful command", async () => {
  assert.match(COMMAND_USAGE, /^ +plan\b/mu);
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
  // package reported something else. Compared whole rather than by substring:
  // the version is parsed by whatever asked for it, so a bar or a symbol
  // around it would be a break, and only an exact compare can see one.
  assert.equal(long.out, `${manifest.version}\n`);
  assert.equal(short.out, `${manifest.version}\n`);
  assert.equal(long.err, "");
});

test("the README command reference stays identical to CLI usage", () => {
  const readme = readFileSync("README.md", "utf8");
  assert.ok(readme.includes(`\`\`\`\n${COMMAND_USAGE}\n\`\`\``));
});

test("the usage text names every command the CLI accepts", () => {
  // The drift rule this tool applies to three harness CLIs, applied to its own
  // surface: a command that works and is not printed is the same defect.
  const missing = COMMANDS.filter(
    // A comma ends a token too: the generated screen prints the two spellings
    // of a flag together, as `-v, --version`.
    (command) => !new RegExp(String.raw`(?:^|[\s|])${command}(?:$|[\s|[,])`, "mu").test(COMMAND_USAGE),
  );
  assert.deepEqual(missing, [], "every accepted token belongs in the usage block");
});

test("a token the catalog does not name is an invocation error", async () => {
  // `magi delete` and `magi --live` were both typed at a real session and both
  // did nothing but print usage; the catalog is the line between the two.
  for (const word of ["delete", "--live", "consult", "calibrate"]) {
    assert.ok(!COMMANDS.includes(word), `${word} is not a command`);
    assert.equal(await quietMain([word]), 2, `${word} is refused as exit 2`);
  }
});

test("a command that is nearly one is named, not merely rejected", async () => {
  // The catalogue is parsed rather than compared, so the refusal can say what
  // was probably meant. Drawn only where a person is looking: down a pipe this
  // screen is the block alone, which is a byte contract older than the parser.
  const { result, err } = await capture(() => main(["revieww"]), { tty: true });

  assert.equal(result, 2);
  assert.match(err, /unknown command 'revieww'/u);
  assert.match(err, /Did you mean review/u);
});

test("the flag that says not to ask is a flag, and only that", () => {
  // It skips a question that already falls through to yes. Nothing it can be
  // passed to falls through to no, so there is nothing here for it to unlock.
  const asked = parseReviewArgs(["--brief", "b.md"]);
  const told = parseReviewArgs(["--brief", "b.md", "--yes"]);

  assert.equal(asked.yes, false);
  assert.equal(told.yes, true);
  assert.throws(() => parseReviewArgs(["--brief", "b.md", "--yes-really"]), /unknown option/u);
});

/** What `magi <command> --help` prints, as the parser generates it. */
function screenOf(name: string): string {
  const asked = parseArgv(`magi ${name}`, SUBCOMMANDS[name]!.grammar, ["--help"]);
  assert.equal(asked.kind, "help", `magi ${name} --help is answered, not refused`);
  return asked.kind === "help" ? asked.screen : "";
}

test("every command answers --help itself, and answering is not an error", async () => {
  // The screen is generated, so what a guard is still needed for is the
  // wiring: a command that forgets to settle the question refuses it instead,
  // and a documented invocation exits 2.
  for (const name of Object.keys(SUBCOMMANDS)) {
    const { code, out, err } = await runMain([name, "--help"]);

    assert.equal(code, 0, `magi ${name} --help exits 0`);
    assert.match(out, new RegExp(`^Usage: magi ${name}`, "mu"), `magi ${name} --help is its own`);
    assert.equal(err, "", `magi ${name} --help is a result, not a refusal`);
  }
});

test("help takes the command whose screen was asked for", async () => {
  // `magi help review` printed the screen for everything and ignored the word
  // that said which one, which is the same defect as a flag that is accepted
  // and does nothing.
  const named = await runMain(["help", "review"]);
  const flagged = await runMain(["review", "--help"]);

  assert.equal(named.code, 0);
  assert.equal(named.out, flagged.out, "one screen, whichever way it was asked for");
  assert.match(named.out, /--base <ref>/u);
});

test("a screen takes its one argument and no more", async () => {
  // `magi --version extra` and `magi help review extra` answered as though the
  // extra word were not there. Under the exit codes this file's module states,
  // a token the command cannot use makes the invocation itself wrong.
  assert.equal(await quietMain(["--version", "extra"]), 2);
  assert.equal(await quietMain(["-v", "extra"]), 2);
  assert.equal(await quietMain(["help", "review", "extra"]), 2);
  assert.equal(await quietMain(["--help", "doctor", "extra"]), 2);

  assert.equal(await quietMain(["--version"]), 0, "the right invocation is still right");
  assert.equal(await quietMain(["help", "review"]), 0, "and so is the one with an argument");
});

test("help asked for something that is not a command is still a mistake", async () => {
  const piped = await runMain(["help", "revieww"]);
  assert.equal(piped.code, 2);
  assert.equal(piped.out, "", "a refusal is not a result");

  // The reason is drawn where a person is reading it; a pipe gets the screen
  // alone on this path, which is the older contract of the two.
  const drawn = await capture(() => main(["help", "revieww"]), { tty: true });
  assert.match(drawn.err, /unknown command 'revieww'/u);
  assert.match(drawn.err, /Did you mean review/u);
});

test("each command's own screen prints every flag it accepts", () => {
  // The block is generated from these grammars now, so the drift that needed
  // watching is gone and what a guard can still ask is the other half: the
  // screen a person is sent to has to carry the flags in full.
  for (const [name, { grammar }] of Object.entries(SUBCOMMANDS)) {
    const screen = screenOf(name);
    for (const flag of flagsOf(grammar)) {
      assert.match(screen, new RegExp(`\\s${flag}[\\s<]`, "u"), `magi ${name} --help prints ${flag}`);
    }
  }
});

test("a flag only the other mode takes is refused by its own name", () => {
  // Declared on plan and hidden there, so the refusal names the flag rather
  // than calling it unknown, and no screen is asked to print a flag that
  // cannot work where it is printed.
  assert.match(screenOf("review"), /--base <ref>/u);
  assert.doesNotMatch(screenOf("plan"), /--base/u);
  assert.throws(() => parseReviewArgs(["--brief", "b.md", "--base", "main"], "plan"), /review/u);
});
