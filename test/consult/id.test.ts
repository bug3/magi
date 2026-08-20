import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { nextConsultId } from "../../src/consult/id.ts";

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "magi-id-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the first consult in an empty tree is 0001", () => {
  withTempDir((dir) => {
    assert.equal(nextConsultId(join(dir, "consults"), "first"), "0001-first");
  });
});

test("the next ordinal follows the highest on disk, holes ignored", () => {
  withTempDir((dir) => {
    mkdirSync(join(dir, "0001-old"), { recursive: true });
    mkdirSync(join(dir, "0007-later"), { recursive: true });
    mkdirSync(join(dir, "not-a-consult"), { recursive: true });
    assert.equal(nextConsultId(dir, "next"), "0008-next");
  });
});

test("a slug the id grammar refuses fails at mint time", () => {
  withTempDir((dir) => {
    assert.throws(() => nextConsultId(dir, "Bad Slug"));
  });
});
