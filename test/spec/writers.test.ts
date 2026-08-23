import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { test } from "node:test";

// AGENTS.md "Where things live": every byte a command prints goes through
// `src/util/ui.ts`, which decides the stream and owns the rendering.
//
// The rule held by habit until it did not. Each command reached for
// `console.log` on its own, so whether a line was a result or a refusal was
// re-decided at every call site, and a refusal on stdout is invisible to the
// caller it was written for. The module-size, facade, template, fixture and
// publication rules all have a guard here, and a rule with no guard is the
// one that comes back.
//
// The writer is excluded structurally rather than by name-checking an
// allowlist: it is the file the rule points at, and it is the only file whose
// job is to hold the two streams.

const SRC = "src";
const WRITER = "util/ui.ts";

/** Reaching a stream directly, by either of the two spellings that work. */
const WRITERS: ReadonlyArray<{ pattern: RegExp; instead: string }> = [
  {
    // Written apart so this catalog does not match itself: the guard is a
    // file like any other, and a pattern spelled as the thing it forbids
    // would have to except its own source.
    pattern: new RegExp(`\\bconsole\\s*\\.\\s*(log|error|warn|info|debug|trace)\\s*\\(`, "u"),
    instead: "import the writer from src/util/ui.ts",
  },
  {
    pattern: new RegExp(`\\bprocess\\s*\\.\\s*std(out|err)\\b`, "u"),
    instead: "import plain or plainError from src/util/ui.ts",
  },
];

function sourceFiles(): readonly string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((name) => extname(name) === ".ts")
    .map((name) => name.replaceAll("\\", "/"));
}

test("nothing under src/ writes to a stream except the one writer", () => {
  const files = sourceFiles();
  // A walk that found nothing would pass every assertion under it.
  assert.ok(files.length >= 50, `only ${files.length} files walked: the walk is broken`);
  assert.ok(files.includes(WRITER), `the walk missed ${WRITER}, which is the rule's subject`);

  const reaches: string[] = [];
  for (const file of files) {
    if (file === WRITER) continue;
    const text = readFileSync(join(SRC, file), "utf8");
    for (const { pattern, instead } of WRITERS) {
      if (pattern.test(text)) reaches.push(`src/${file} reaches a stream directly; ${instead}`);
    }
  }

  assert.deepEqual(reaches, [], `\n${reaches.join("\n")}\n`);
});

test("the guard sees a reach it is written to catch", () => {
  // A pattern nobody has watched match anything is a pattern nobody has
  // proved. Both shapes are assembled here rather than spelled, so the
  // catalog above stays scannable by its own walk.
  const cases: ReadonlyArray<[string, number]> = [
    [["console", ".log('x')"].join(""), 0],
    [["console", ".error('x')"].join(""), 0],
    [["process", ".stdout.write('x')"].join(""), 1],
    [["process", ".stderr.write('x')"].join(""), 1],
  ];
  for (const [source, at] of cases) {
    assert.ok(WRITERS[at]?.pattern.test(source), `${source} is a reach the guard must see`);
  }

  // And does not see what is not one: the writer's own name in prose, and a
  // local variable that merely shares a word with the shapes above.
  for (const innocent of ["the console output", "const stdout = run.stdout;"]) {
    for (const { pattern } of WRITERS) {
      assert.ok(!pattern.test(innocent), `${innocent} is not a reach`);
    }
  }
});
