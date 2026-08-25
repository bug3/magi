import assert from "node:assert/strict";
import { test } from "node:test";

import { COMMAND_USAGE, SUBCOMMANDS } from "../../src/cli.ts";
import { commandScreen, flagsOf } from "../../src/cli/parse.ts";
import { noteText, type CommandNote } from "../../src/util/ui.ts";

/**
 * The two registers a command's screen is written in, held apart.
 *
 * The generated half says what a flag is called and what it does; the note
 * beside it says what running the command costs, what it refuses, what it
 * writes down, and which part of the decision was never the tool's. The prose
 * used to sit in `src/cli.ts` beside no flag it was about, so renaming a flag
 * left it stale and nothing noticed. It lives beside the grammar now, and
 * these are the two things that can be decided about it rather than argued.
 */

/** A flag whose presence is the command admitting it does the thing. */
const OBLIGED: ReadonlyArray<{
  readonly flag: string;
  readonly category: keyof CommandNote;
}> = [
  { flag: "--live", category: "spends" },
  { flag: "--calibrate", category: "spends" },
  { flag: "--yes", category: "spends" },
  { flag: "--waive-headroom", category: "refuses" },
  { flag: "--waive-backfill", category: "refuses" },
  { flag: "--install", category: "records" },
  { flag: "--calibrate", category: "records" },
  { flag: "--dry-run", category: "decides" },
];

/**
 * Words that make a claim about cost. They belong to the note, which is drawn
 * beside the generated screen and never inside it: what commander is handed
 * ends up in the block README.md carries verbatim, and that block is a list of
 * commands rather than the place a user is told what a command will spend.
 */
const COST = /\b(spend|spends|spending|quota)\b/iu;

test("a command that says it spends carries the note that says what", () => {
  // Decidable from the catalogue, which is the whole reason the obligation is
  // written against flags: `--yes` is a command admitting it asks before
  // spending, and `--waive-headroom` is one admitting it refuses.
  for (const [name, { grammar, note }] of Object.entries(SUBCOMMANDS)) {
    const declared = new Set(flagsOf(grammar));
    for (const { flag, category } of OBLIGED) {
      if (!declared.has(flag)) continue;
      const body = note[category];
      assert.ok(
        body !== undefined && body.trim() !== "",
        `magi ${name} declares ${flag} and must say what it ${category}`,
      );
    }
  }
});

test("what a command costs is said in the note and nowhere else", () => {
  // Not every note category can be derived from a flag: checks refuses what
  // its vocabulary refuses and triggers decides nothing at all, and neither
  // has a flag that admits it. Those notes are written and reviewed, not
  // guarded here. What is guarded is the register: the generated half of the
  // screen makes no claim about cost, in either direction.
  assert.doesNotMatch(COMMAND_USAGE, COST, "the block README.md carries makes no cost claim");
  for (const [name, { grammar, note }] of Object.entries(SUBCOMMANDS)) {
    assert.doesNotMatch(
      commandScreen(`magi ${name}`, grammar),
      COST,
      `magi ${name} --help says what it spends in its note, not in its flags`,
    );
    if (noteText(note) === "") continue;
    assert.ok(
      noteText(note).length > 40,
      `magi ${name} has a note worth drawing, or it should have none`,
    );
  }
});

test("a flag a note names is a flag that command takes", () => {
  // The defect this whole arrangement was moved to fix, one level up: the note
  // sits beside the grammar now, but its prose names flags, and a rename would
  // leave those names behind exactly as it left the old paragraphs behind.
  for (const [name, { grammar, note }] of Object.entries(SUBCOMMANDS)) {
    const declared = new Set(flagsOf(grammar));
    const named = new Set([...noteText(note).matchAll(/--[a-z][a-z-]*/gu)].map((hit) => hit[0]));

    for (const flag of named) {
      assert.ok(declared.has(flag), `magi ${name} says ${flag} in its note and does not take it`);
    }
  }
});

test("every command carries a note, because every command costs something", () => {
  // Time and attention count: `magi triggers` spends neither quota nor bytes
  // and still decides nothing, and saying so is the point of its note.
  for (const [name, { note }] of Object.entries(SUBCOMMANDS)) {
    assert.notEqual(noteText(note), "", `magi ${name} says what it costs`);
  }
});
