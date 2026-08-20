import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { patchShortfall, pinPatch } from "../../src/evidence/patch-pin.ts";
import { gitText } from "../../src/runtime/git.ts";

const IDENTITY = ["user.name=MAGI", "user.email=magi@example.invalid"];

async function tempRepo(files: Readonly<Record<string, string>>): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "magi-pin-"));
  await gitText(["init", "-b", "main"], { cwd: root });
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  await gitText(["add", "-A"], { cwd: root });
  await gitText(["commit", "--no-gpg-sign", "-m", "initial"], { cwd: root, config: IDENTITY });
  return root;
}

test("a pinned patch records base and head SHAs, dirtiness and the full delta", async () => {
  const repo = await tempRepo({ "src/a.ts": "export const a = 1;\n" });
  try {
    writeFileSync(join(repo, "src/a.ts"), "export const a = 2;\n");
    const pinned = await pinPatch(repo, "HEAD");
    assert.match(pinned.baseSha, /^[0-9a-f]{40}$/);
    assert.equal(pinned.baseSha, pinned.headSha, "base HEAD on a dirty tree pins the same commit");
    assert.equal(pinned.dirty, true);
    assert.deepEqual(pinned.deltaPaths, ["src/a.ts"]);
    assert.ok(pinned.patch.includes("+++ b/src/a.ts"));
    assert.ok(pinned.patch.includes("+export const a = 2;"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a committed delta pins distinct base and head, with a clean tree", async () => {
  const repo = await tempRepo({ "src/a.ts": "export const a = 1;\n" });
  try {
    const base = await gitText(["rev-parse", "HEAD"], { cwd: repo });
    writeFileSync(join(repo, "src/a.ts"), "export const a = 3;\n");
    await gitText(["add", "-A"], { cwd: repo });
    await gitText(["commit", "--no-gpg-sign", "-m", "change"], { cwd: repo, config: IDENTITY });
    const pinned = await pinPatch(repo, base);
    assert.equal(pinned.baseSha, base);
    assert.notEqual(pinned.headSha, base);
    assert.equal(pinned.dirty, false);
    assert.deepEqual(pinned.deltaPaths, ["src/a.ts"]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a supplied patch scoping out part of the delta yields first-class exclusions", () => {
  const suppliedPatch =
    "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-x\n+y\n";
  const shortfall = patchShortfall(["src/a.ts", "src/b.ts"], suppliedPatch);
  assert.equal(shortfall.length, 1);
  assert.equal(shortfall[0]?.path, "src/b.ts");
  assert.match(shortfall[0]?.reason ?? "", /delta but not in the supplied patch/);
});
