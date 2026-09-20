/**
 * The per-row verdict, where a seat that could not answer used to score a
 * pass for the same reason an isolated one did.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Harness } from "../../src/core/slots.ts";
import { calibrationHealth } from "../../src/doctor/calibration-health.ts";
import { judgeDirections, type RoundOutput } from "../../src/doctor/calibration-verdict.ts";
import { formatCalibration } from "../../src/doctor/format.ts";

const NONCE = "magi-canary-test-1";
/** The launch failed, or the seat reported its own failure: no answer either way. */
const SILENT: RoundOutput = { stream: "", answered: false };
const CLEAN: RoundOutput = { stream: '{"echo":"NONE"}', answered: true };
const LEAKED: RoundOutput = { stream: `{"echo":"${NONCE}"}`, answered: true };

function rounds(
  isolated: Partial<Record<Harness, RoundOutput>>,
  unisolated: Partial<Record<Harness, RoundOutput>>,
): Record<"isolated" | "unisolated", ReadonlyMap<Harness, RoundOutput>> {
  return {
    isolated: new Map(Object.entries(isolated) as [Harness, RoundOutput][]),
    unisolated: new Map(Object.entries(unisolated) as [Harness, RoundOutput][]),
  };
}

function verdicts(
  results: readonly { harness: Harness; direction: string; answered: boolean; pass: boolean }[],
  harness: Harness,
): [string, boolean, boolean][] {
  return results
    .filter((result) => result.harness === harness)
    .map((result) => [result.direction, result.answered, result.pass]);
}

// The defect, exactly: the isolated row read an absent nonce as isolation
// when the seat had produced no nonce because it produced nothing at all.
test("a seat that did not answer is inconclusive in both rounds, never ok", () => {
  const results = judgeDirections(
    rounds(
      { claude: SILENT, codex: CLEAN, grok: CLEAN },
      { claude: SILENT, codex: LEAKED, grok: LEAKED },
    ),
    NONCE,
  );
  assert.deepEqual(verdicts(results, "claude"), [
    ["isolated", false, false],
    ["unisolated", false, false],
  ]);
});

test("the seats that did answer are judged exactly as before", () => {
  const results = judgeDirections(
    rounds(
      { claude: SILENT, codex: CLEAN, grok: CLEAN },
      { claude: SILENT, codex: LEAKED, grok: LEAKED },
    ),
    NONCE,
  );
  assert.deepEqual(verdicts(results, "codex"), [
    ["isolated", true, true],
    ["unisolated", true, true],
  ]);
});

test("the same absence from a seat that answered is the isolation it claims", () => {
  const results = judgeDirections(
    rounds({ claude: CLEAN }, { claude: LEAKED }),
    NONCE,
  );
  assert.deepEqual(verdicts(results, "claude"), [
    ["isolated", true, true],
    ["unisolated", true, true],
  ]);
});

// Grok's isolated row asserts nothing, so it passed unconditionally. A row
// that asserts nothing still has to have been measured.
test("a silent seat fails even the informational row", () => {
  const results = judgeDirections(rounds({ grok: SILENT }, { grok: LEAKED }), NONCE);
  const isolated = results.find(
    (result) => result.harness === "grok" && result.direction === "isolated",
  );
  assert.equal(isolated?.expectation, "informational");
  assert.equal(isolated?.pass, false);
});

// The one direction a false negative must not be possible in: the token is
// in the stream, so the leak was measured whatever the seat then reported
// about its own turn.
test("a leak beside a harness error is a leak, not an absent measurement", () => {
  const leakedAndBroken: RoundOutput = { stream: `{"echo":"${NONCE}"}`, answered: false };
  const results = judgeDirections(rounds({ claude: leakedAndBroken }, {}), NONCE);
  const isolated = results.find(
    (result) => result.harness === "claude" && result.direction === "isolated",
  );
  assert.equal(isolated?.nonceSeen, true);
  assert.equal(isolated?.pass, false);
  const screen = formatCalibration({ nonce: NONCE, results, restoreFailures: [], pass: false });
  assert.match(screen, /claude isolated: expected absent, nonce seen: FAILED/u);
});

test("a harness that produced no output at all is inconclusive, not isolated", () => {
  const results = judgeDirections(rounds({}, {}), NONCE);
  assert.deepEqual(
    results
      .filter((result) => result.answered || result.pass)
      .map((result) => `${result.harness} ${result.direction}`),
    [],
    "no round produced output, so no row can claim to have measured one",
  );
});

test("the line names the seat and says nothing was measured", () => {
  const results = judgeDirections(
    rounds({ claude: SILENT }, { claude: SILENT }),
    NONCE,
  );
  const screen = formatCalibration({ nonce: NONCE, results, restoreFailures: [], pass: false });
  assert.match(screen, /claude isolated: INCONCLUSIVE, the seat did not answer/u);
  assert.match(screen, /nothing was measured/u);
  assert.match(screen, /CALIBRATION FAILED: a seat that did not answer/u);
});

// The row is where the proof is kept, so an inconclusive direction has to
// leave the seated version unproved on every later doctor run. A seat silent
// in one round only is the case that would otherwise pass whole: the vacuous
// isolated row and a real unisolated one agree, and the version is proved by
// a calibration that measured isolation once, not at all.
test("a seat silent in one round only still proves no seated version", () => {
  const results = judgeDirections(
    rounds({ claude: SILENT }, { claude: LEAKED }),
    NONCE,
  );
  const health = calibrationHealth({
    rows: [
      {
        calibration: NONCE,
        recordedAt: "2026-09-20T12:00:00Z",
        results: [...results],
        cliVersions: [{ harness: "claude", version: "2.1.278" }],
      },
    ],
    seated: [{ harness: "claude", version: "2.1.278" }],
    layers: [],
    recoveryPending: false,
  });
  assert.deepEqual(health.failures, [
    "claude 2.1.278 has no passing calibration row; run magi doctor --calibrate",
  ]);
});
