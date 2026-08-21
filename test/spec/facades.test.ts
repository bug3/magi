import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { test } from "node:test";

// AGENTS.md "Where things live": a folder beside a same-named `.ts` facade is
// the split shape, and callers import the facade, never the folder. The rule
// held by habit; the module-size, template, fixture and publication rules all
// have guards here, and this one did not, so a reach around the facade passed
// a green check. The scope is src/: a test reads the module it is about, and
// several deliberately import internals.

const SRC = "src";

/** `from "x"`, `from 'x'`, `import("x")` and a bare side-effect import. */
const IMPORT = /(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/gu;

function sourceFiles(): readonly string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((name) => extname(name) === ".ts")
    .map((name) => name.replaceAll("\\", "/"));
}

/**
 * Every folder that has a facade beside it, at any depth: `consult/` under
 * `consult.ts`, and `schema/validator/` under `schema/validator.ts` just the
 * same. Anchored at the folder, so the check is about the shape and not about
 * a list of names that would go stale.
 */
function facadeFolders(files: readonly string[]): ReadonlySet<string> {
  const modules = new Set(files.map((file) => file.replace(/\.ts$/u, "")));
  const folders = new Set<string>();
  for (const file of files) {
    const parts = file.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) {
      const folder = parts.slice(0, depth).join("/");
      if (modules.has(folder)) folders.add(folder);
    }
  }
  return folders;
}

test("a split folder is reached through its facade, never around it", () => {
  const files = sourceFiles();
  const folders = facadeFolders(files);
  const reaches: string[] = [];

  for (const file of files) {
    for (const match of readFileSync(join(SRC, file), "utf8").matchAll(IMPORT)) {
      const target = relative(SRC, resolve(dirname(join(SRC, file)), match[1] as string))
        .replaceAll("\\", "/")
        .replace(/\.ts$/u, "");
      for (const folder of folders) {
        if (!target.startsWith(`${folder}/`)) continue;
        // The facade itself and the folder's own modules are inside the shape.
        const from = file.replace(/\.ts$/u, "");
        if (from === folder || from.startsWith(`${folder}/`)) continue;
        reaches.push(`src/${file} imports ${match[1] as string}`);
      }
    }
  }

  assert.deepEqual(reaches, [], "import src/<folder>.ts instead of src/<folder>/*");
});

test("the guard sees the shapes it claims to, including a nested one", () => {
  const folders = facadeFolders(sourceFiles());
  for (const shape of ["consult", "doctor", "cli", "checks", "schema/validator"]) {
    assert.ok(folders.has(shape), `${shape}/ sits beside ${shape}.ts and counts as a facade`);
  }
});
