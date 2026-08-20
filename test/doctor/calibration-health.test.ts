import assert from "node:assert/strict";
import { test } from "node:test";

import type { LedgerCalibration } from "../../src/consult/ledger.ts";
import { calibrationHealth, readCalibrationRows } from "../../src/doctor/calibration-health.ts";

function row(overrides: Partial<LedgerCalibration> = {}): LedgerCalibration {
  return {
    calibration: "magi-canary-x",
    recordedAt: "2026-08-20T15:00:00Z",
    results: [],
    ...overrides,
  };
}

const SEATED = [
  { harness: "claude", version: "2.1.227" },
  { harness: "codex", version: "codex-cli 0.148.0" },
  { harness: "grok", version: "grok 1.0.5" },
];

const LAYERS = [
  { harness: "claude", path: "/h/.claude/CLAUDE.md", currentSha256: "aaa", hasNonceMarker: false },
  { harness: "codex", path: "/r/AGENTS.md", currentSha256: "absent", hasNonceMarker: false },
  { harness: "grok", path: "/h/.grok/rules/99.md", currentSha256: "absent", hasNonceMarker: false },
];

const VERSIONED = row({
  cliVersions: SEATED,
  layerHashes: [
    { harness: "claude", path: "/h/.claude/CLAUDE.md", sha256: "aaa" },
    { harness: "codex", path: "/r/AGENTS.md", sha256: "absent" },
    { harness: "grok", path: "/h/.grok/rules/99.md", sha256: "absent" },
  ],
});

test("calibration rows are read from raw lines; the fold never sees them", () => {
  const rows = readCalibrationRows([
    JSON.stringify(row()),
    JSON.stringify({ consult: "0001-x" }),
    "garbage",
    "",
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.calibration, "magi-canary-x");
});

test("matching versions and hashes are healthy: no failures, no warnings", () => {
  const health = calibrationHealth({
    rows: [VERSIONED],
    seated: SEATED,
    layers: LAYERS,
    recoveryPending: false,
  });
  assert.deepEqual(health.failures, []);
  assert.deepEqual(health.warnings, []);
  assert.equal(health.lastCalibratedAt, "2026-08-20T15:00:00Z");
});

test("a seated version with no matching calibration row is a failure (owner: fail)", () => {
  const health = calibrationHealth({
    rows: [VERSIONED],
    seated: [{ harness: "claude", version: "2.2.0" }],
    layers: LAYERS,
    recoveryPending: false,
  });
  assert.equal(health.failures.length, 1);
  assert.match(health.failures[0] as string, /claude 2\.2\.0.*no passing calibration/);
});

test("a failed direction does not prove its harness: the leak keeps doctor red", () => {
  // The first live calibration caught exactly this: codex 0.148.0 echoed the
  // nonce in its isolated round. A row that watched a harness's isolation
  // FAIL proves the opposite of calibrated.
  const failed = row({
    cliVersions: SEATED,
    results: [
      { harness: "claude", direction: "isolated", expectation: "absent", nonceSeen: false, pass: true },
      { harness: "codex", direction: "isolated", expectation: "absent", nonceSeen: true, pass: false },
      { harness: "codex", direction: "unisolated", expectation: "present", nonceSeen: true, pass: true },
    ],
  });
  const health = calibrationHealth({
    rows: [failed],
    seated: SEATED,
    layers: LAYERS,
    recoveryPending: false,
  });
  assert.equal(health.failures.length, 1);
  assert.match(health.failures[0] as string, /codex codex-cli 0\.148\.0.*no passing calibration/);
});

test("a drifted ambient layer is a warning, not a failure (owner: warn)", () => {
  const layers = [{ ...LAYERS[0]!, currentSha256: "bbb" }, LAYERS[1]!, LAYERS[2]!];
  const health = calibrationHealth({
    rows: [VERSIONED],
    seated: SEATED,
    layers,
    recoveryPending: false,
  });
  assert.deepEqual(health.failures, []);
  assert.equal(health.warnings.length, 1);
  assert.match(health.warnings[0] as string, /changed since the last calibration/);
});

test("legacy rows without versions prove nothing: unverifiable is a failure", () => {
  // Owner revision (r19): the unverifiable softening is gone; a row that
  // cannot name what it proved does not keep doctor green.
  const health = calibrationHealth({
    rows: [row()],
    seated: SEATED,
    layers: LAYERS,
    recoveryPending: false,
  });
  assert.equal(health.failures.length, 1);
  assert.match(health.failures[0] as string, /predate version recording/);
  assert.deepEqual(health.warnings, []);
});

test("no calibration rows at all is a failure: unproved canaries fail doctor", () => {
  // Owner revision (r19): canaries are per-repo artifacts scanned on every
  // consult; a fresh target repo is honestly red until its calibration runs.
  const health = calibrationHealth({
    rows: [],
    seated: SEATED,
    layers: LAYERS,
    recoveryPending: false,
  });
  assert.equal(health.failures.length, 1);
  assert.match(health.failures[0] as string, /no calibration recorded/);
  assert.deepEqual(health.warnings, []);
});

test("leftover nonce residue and a pending recovery sidecar are failures", () => {
  const layers = [{ ...LAYERS[0]!, hasNonceMarker: true }, LAYERS[1]!, LAYERS[2]!];
  const health = calibrationHealth({
    rows: [VERSIONED],
    seated: SEATED,
    layers,
    recoveryPending: true,
  });
  assert.equal(health.failures.length, 2);
  assert.match(health.failures.join(" "), /nonce/);
  assert.match(health.failures.join(" "), /recovery/);
});
