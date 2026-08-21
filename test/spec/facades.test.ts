import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { test } from "node:test";

// AGENTS.md "Where things live": a folder beside a same-named `.ts` facade is
// the split shape, and callers import the facade, never the folder. The rule
// held by habit; the module-size, template, fixture and publication rules all
// have guards here, and this one did not, so a reach around the facade passed
// a green check.

const SRC = "src";
const RELATIVE_IMPORT = /from\s+"(\.[^"]+)"/gu;

function sourceFiles(): readonly string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((name) => extname(name) === ".ts")
    .map((name) => join(SRC, name));
}

/** The folders that have a facade beside them, by name. */
function facades(files: readonly string[]): ReadonlySet<string> {
  const roots = new Set(
    files
      .map((file) => relative(SRC, file))
      .filter((rel) => rel.includes("/"))
      .map((rel) => rel.split("/")[0] as string),
  );
  const named = new Set(
    files
      .map((file) => relative(SRC, file))
      .filter((rel) => !rel.includes("/"))
      .map((rel) => rel.replace(/\.ts$/u, "")),
  );
  return new Set([...roots].filter((root) => named.has(root)));
}

test("a split folder is reached through its facade, never around it", () => {
  const files = sourceFiles();
  const split = facades(files);
  const reaches: string[] = [];

  for (const file of files) {
    const from = relative(SRC, file);
    for (const match of readFileSync(file, "utf8").matchAll(RELATIVE_IMPORT)) {
      const target = relative(SRC, resolve(dirname(file), match[1] as string));
      const folder = target.split("/")[0] as string;
      if (!target.includes("/") || !split.has(folder)) continue;
      // The facade itself and the folder's own modules are inside the shape.
      if (from === `${folder}.ts` || from.split("/")[0] === folder) continue;
      reaches.push(`${file} imports ${match[1] as string}`);
    }
  }

  assert.deepEqual(reaches, [], `import src/<folder>.ts instead of src/<folder>/*`);
});
