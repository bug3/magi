import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RISK_DOMAINS,
  TRIGGER_THRESHOLDS,
  evaluateTriggers,
  parseNumstat,
  type ChangedFile,
} from "../../src/consult/triggers.ts";

function files(count: number, linesEach: number, prefix = "src/plain"): ChangedFile[] {
  return Array.from({ length: count }, (_, at) => ({
    path: `${prefix}-${at}.ts`,
    changedLines: linesEach,
  }));
}

test("the owner-set size thresholds are 333 lines or 9 files", () => {
  assert.deepEqual(TRIGGER_THRESHOLDS, { diffLines: 333, touchedFiles: 9 });
});

test("the size trigger fires strictly over either threshold, not at it", () => {
  assert.equal(evaluateTriggers(files(9, 37)).length, 0); // 333 lines, 9 files: at both
  assert.equal(evaluateTriggers(files(9, 38))[0]?.id, "size"); // 342 lines
  assert.equal(evaluateTriggers(files(10, 1))[0]?.id, "size"); // 10 files
});

test("the size trigger fires on lines OR files: either alone is enough", () => {
  assert.equal(evaluateTriggers(files(1, 334))[0]?.id, "size");
  assert.equal(evaluateTriggers(files(10, 0))[0]?.id, "size");
});

test("every seeded risk domain matches its own territory and not a plain module", () => {
  const territory: Readonly<Record<string, string>> = {
    "auth-credentials": "src/session/auth-token.ts",
    "persistence-migrations": "db/migrations/002-add-users.sql",
    concurrency: "src/util/concurrency.ts",
    "public-api": "package.json",
    "release-ci": ".github/workflows/release.yml",
    "magi-self": "src/seats/profiles.ts",
  };
  for (const domain of RISK_DOMAINS) {
    const path = territory[domain.id];
    assert.ok(path !== undefined, `no territory sample for ${domain.id}`);
    const hit = evaluateTriggers([{ path, changedLines: 1 }]);
    assert.equal(hit[0]?.id, `risk:${domain.id}`, `${domain.id} must match ${path}`);
  }
  assert.equal(evaluateTriggers([{ path: "src/evidence/derive.ts", changedLines: 1 }]).length, 0);
});

test("a risk proposal names the paths that put it on the table", () => {
  const proposals = evaluateTriggers([
    { path: "src/seats/profiles.ts", changedLines: 2 },
    { path: ".magi/headroom.local.json", changedLines: 1 },
  ]);
  assert.equal(proposals.length, 1);
  assert.deepEqual(proposals[0]?.paths, ["src/seats/profiles.ts", ".magi/headroom.local.json"]);
});

test("numstat parses added plus deleted, and a binary file counts as a file with 0 lines", () => {
  const parsed = parseNumstat("10\t2\tsrc/a.ts\n-\t-\tassets/logo.png\n\n3\t0\tsrc/b.ts");
  assert.deepEqual(parsed, [
    { path: "src/a.ts", changedLines: 12 },
    { path: "assets/logo.png", changedLines: 0 },
    { path: "src/b.ts", changedLines: 3 },
  ]);
});
