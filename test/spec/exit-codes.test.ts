import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { test } from "node:test";

/**
 * The exit codes `src/cli.ts` documents, held to the ones it can return.
 *
 * The header named three and the tool shipped four: 130 has been returned from
 * three commands since questions were added, and nothing said so. A number a
 * script branches on is the narrowest contract MAGI has, and it was the one
 * described rather than asserted.
 */

const CLI = "src/cli.ts";
const COMMANDS = "src/cli";

/** Every number the header offers as an exit code, as ` - <n> ` in its list. */
function documented(): ReadonlySet<number> {
  const header = readFileSync(CLI, "utf8").split("*/")[0] ?? "";
  return new Set([...header.matchAll(/^ \* - (\d+) /gmu)].map((match) => Number(match[1])));
}

/** Every number the command layer returns, whether written out or named. */
function returned(): ReadonlySet<number> {
  const files = [
    CLI,
    ...readdirSync(COMMANDS)
      .filter((name) => extname(name) === ".ts")
      .map((name) => join(COMMANDS, name)),
  ];
  const codes = new Set<number>();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\breturn (\d+);/gu)) codes.add(Number(match[1]));
    // The interrupt code is named rather than written out at the return.
    for (const match of source.matchAll(/\bCANCELLED = (\d+);/gu)) codes.add(Number(match[1]));
  }
  return codes;
}

test("every code the command layer returns is one the header names", () => {
  const names = documented();
  // A walk that found nothing would pass every assertion under it.
  assert.ok(names.size >= 3, `the header names ${names.size} codes; it is not being read`);

  const undocumented = [...returned()].filter((code) => !names.has(code));
  assert.deepEqual(undocumented, [], "add the code to the header in src/cli.ts, or stop returning it");
});

test("every code the header names is one the command layer returns", () => {
  // The drift runs both ways: a code documented and never returned is a branch
  // a caller writes and never reaches.
  const codes = returned();
  const unreachable = [...documented()].filter((code) => !codes.has(code));
  assert.deepEqual(unreachable, [], "the header names a code nothing returns");
});
