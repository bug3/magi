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
// allowlist: it is the path the rule points at, and it is the only place whose
// job is to hold the two streams.

const SRC = "src";

/**
 * The rule's subject: the facade and the folder it fronts. It was one file
 * until the renderer grew a TTY split, a spinner, folded subprocess output and
 * prompts, and outgrew the module ceiling. Excluding the folder rather than
 * renaming the exception keeps the rule the same one: there is a single place
 * that holds the streams, and it is allowed to be more than one file.
 */
const WRITER = "util/ui";

/** Whether a walked path is the writer itself, facade or folder. */
function isWriter(file: string): boolean {
  return file === `${WRITER}.ts` || file.startsWith(`${WRITER}/`);
}

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
  {
    // The quietest way around the rule, and so the one worth catching: a
    // renderer imported straight from the dependency writes to the real
    // stdout unless every call is handed an output, which is precisely the
    // decision the writer exists to make once.
    pattern: new RegExp(`from\\s*["']@clack/[a-z]+["']`, "u"),
    instead: "the renderer is reached through src/util/ui.ts",
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
  assert.ok(
    files.includes(`${WRITER}.ts`),
    `the walk missed ${WRITER}.ts, which is the rule's subject`,
  );
  // The folder is excluded from the rule, so a walk that never entered it
  // would exclude nothing and prove nothing.
  assert.ok(
    files.some((file) => file.startsWith(`${WRITER}/`)),
    `the walk missed the ${WRITER}/ modules the facade fronts`,
  );

  const reaches: string[] = [];
  for (const file of files) {
    if (isWriter(file)) continue;
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
    [["import { log } from ", '"@clack/', 'prompts"'].join(""), 2],
  ];
  for (const [source, at] of cases) {
    assert.ok(WRITERS[at]?.pattern.test(source), `${source} is a reach the guard must see`);
  }

  // The exclusion is the facade and its folder, and nothing that merely
  // starts with the same letters: a sibling module named ui-something is an
  // ordinary file the rule still binds.
  assert.ok(isWriter("util/ui.ts"), "the facade is the writer");
  assert.ok(isWriter("util/ui/streams.ts"), "a module behind the facade is the writer");
  assert.ok(!isWriter("util/ui-helpers.ts"), "a sibling is not the writer");
  assert.ok(!isWriter("cli/ui.ts"), "another ui elsewhere is not the writer");

  // And does not see what is not one: the writer's own name in prose, and a
  // local variable that merely shares a word with the shapes above.
  for (const innocent of ["the console output", "const stdout = run.stdout;"]) {
    for (const { pattern } of WRITERS) {
      assert.ok(!pattern.test(innocent), `${innocent} is not a reach`);
    }
  }
});
