import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { deriveFromPatch } from "../../src/evidence/derive.ts";

function world(files: Readonly<Record<string, string>>): string {
  const repo = mkdtempSync(join(tmpdir(), "magi-derive-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
  return repo;
}

function patchFor(...paths: readonly string[]): string {
  return paths
    .map(
      (path) =>
        `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`,
    )
    .join("");
}

test("touched files come back whole, with their existing test files", () => {
  const repo = world({
    "src/consult/ledger.ts": "export const x = 1;\n",
    "test/consult/ledger.test.ts": "// test\n",
  });
  const derived = deriveFromPatch(repo, patchFor("src/consult/ledger.ts"));
  assert.deepEqual(
    derived.excerpts.map((excerpt) => excerpt.path),
    ["src/consult/ledger.ts", "test/consult/ledger.test.ts"],
  );
  assert.match(derived.excerpts[0]?.note ?? "", /touched by the patch/);
  assert.match(derived.excerpts[1]?.note ?? "", /test file of/);
});

test("files the touched code imports are included one level deep", () => {
  const repo = world({
    "src/a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
    "src/b.ts": "export const b = 2;\n",
  });
  const derived = deriveFromPatch(repo, patchFor("src/a.ts"));
  assert.deepEqual(
    derived.excerpts.map((excerpt) => excerpt.path),
    ["src/a.ts", "src/b.ts"],
  );
  assert.match(derived.excerpts[1]?.note ?? "", /imported by src\/a\.ts/);
});

test("a file the patch deletes is an exclusion, not a read failure", () => {
  const repo = world({});
  const patch = "diff --git a/gone.ts b/gone.ts\n--- a/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n";
  const derived = deriveFromPatch(repo, patch);
  assert.deepEqual(derived.excerpts, []);
  assert.equal(derived.exclusions.length, 1);
  assert.match(derived.exclusions[0]?.reason ?? "", /deleted by the patch/);
});

test("a missing relative import target is recorded, never silently dropped", () => {
  const repo = world({ "src/a.ts": 'import { gone } from "./gone.ts";\n' });
  const derived = deriveFromPatch(repo, patchFor("src/a.ts"));
  assert.equal(derived.exclusions.length, 1);
  assert.match(derived.exclusions[0]?.reason ?? "", /import target missing/);
});

test("duplicates keep their first appearance only", () => {
  const repo = world({
    "src/a.ts": 'import { b } from "./b.ts";\n',
    "src/b.ts": "export const b = 1;\n",
  });
  const derived = deriveFromPatch(repo, patchFor("src/a.ts", "src/b.ts"));
  assert.deepEqual(
    derived.excerpts.map((excerpt) => excerpt.path),
    ["src/a.ts", "src/b.ts"],
  );
  assert.match(derived.excerpts[1]?.note ?? "", /touched by the patch/);
});

test("an import resolving to a pure re-export facade pulls its modules one more hop", () => {
  const repo = world({
    "src/app.ts": 'import { thing } from "./consult.ts";\nexport const app = thing;\n',
    "src/consult.ts":
      "/**\n * The facade.\n */\n\nexport { thing } from \"./consult/thing.ts\";\nexport type { Shape } from \"./consult/types.ts\";\n",
    "src/consult/thing.ts": "export const thing = 1;\n",
    "src/consult/types.ts": "export interface Shape { x: number }\n",
  });
  const derived = deriveFromPatch(repo, patchFor("src/app.ts"));
  const paths = derived.excerpts.map((excerpt) => excerpt.path);
  assert.ok(paths.includes("src/consult.ts"), "the facade itself is included");
  assert.ok(paths.includes("src/consult/thing.ts"), "the facade's module is pulled");
  assert.ok(paths.includes("src/consult/types.ts"), "the facade's type module is pulled");
  const pulled = derived.excerpts.find((excerpt) => excerpt.path === "src/consult/thing.ts");
  assert.match(pulled?.note ?? "", /re-exported by src\/consult\.ts/);
});

test("a code-carrying module is not a facade: no extra hop through it", () => {
  const repo = world({
    "src/app.ts": 'import { helper } from "./helper.ts";\n',
    "src/helper.ts": 'import { deep } from "./deep.ts";\nexport const helper = deep + 1;\n',
    "src/deep.ts": "export const deep = 1;\n",
  });
  const derived = deriveFromPatch(repo, patchFor("src/app.ts"));
  const paths = derived.excerpts.map((excerpt) => excerpt.path);
  assert.ok(paths.includes("src/helper.ts"));
  assert.ok(!paths.includes("src/deep.ts"), "one hop only through a real module");
});

test("every remaining cut edge is an exclusion, never a silent omission", () => {
  const repo = world({
    "src/app.ts": 'import { helper } from "./helper.ts";\n',
    "src/helper.ts": 'import { deep } from "./deep.ts";\nexport const helper = deep + 1;\n',
    "src/deep.ts": "export const deep = 1;\n",
  });
  const derived = deriveFromPatch(repo, patchFor("src/app.ts"));
  const cut = derived.exclusions.find((exclusion) => exclusion.path === "src/deep.ts");
  assert.ok(cut !== undefined, "the cut edge is recorded");
  assert.match(cut?.reason ?? "", /beyond the one-hop rule/);
});
