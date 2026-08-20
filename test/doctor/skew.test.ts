import assert from "node:assert/strict";
import { test } from "node:test";

import type { FoldedConsult, LedgerDisposition } from "../../src/consult/ledger.ts";
import { SKEW_PARAMS, skewFromLedger } from "../../src/doctor/skew.ts";

function disp(
  slot: string,
  disposition: "adopted" | "rejected",
  duplicateOf?: string,
): LedgerDisposition {
  return {
    slot,
    finding: "F1",
    disposition,
    reason: "r",
    ...(duplicateOf === undefined ? {} : { duplicateOf }),
  };
}

function consult(id: string, dispositions: readonly LedgerDisposition[]): FoldedConsult {
  return { consult: id, seats: [], dispositions, overrides: [] };
}

function repeat(
  count: number,
  slot: string,
  disposition: "adopted" | "rejected",
): LedgerDisposition[] {
  return Array.from({ length: count }, () => disp(slot, disposition));
}

test("the owner-set parameters are 10 consults, floor 6 per side, trip 33, clear 25 or dwell 3", () => {
  assert.deepEqual(SKEW_PARAMS, {
    windowConsults: 10,
    minPerSide: 6,
    tripPoints: 33,
    clearPoints: 25,
    clearDwellConsults: 3,
  });
});

test("below the per-side floor the tripwire is unarmed, however large the pooled sample", () => {
  // 25 pooled findings would have satisfied the old pooled floor; the
  // melchior side alone is below 6, so no comparison is made.
  const ledger = [
    consult("0001-a", [...repeat(5, "melchior-1", "adopted"), ...repeat(20, "casper-3", "rejected")]),
  ];
  const report = skewFromLedger(ledger);
  assert.equal(report.findingsInWindow, 25);
  assert.equal(report.armed, false);
  assert.equal(report.state, "unarmed");
});

test("one side missing means unarmed, however many findings", () => {
  const ledger = [consult("0001-a", repeat(25, "melchior-1", "adopted"))];
  const report = skewFromLedger(ledger);
  assert.equal(report.armed, false);
  assert.equal(report.state, "unarmed");
});

test("trips when the melchior rate exceeds the pooled foreign rate by more than 33 points", () => {
  const ledger = [
    consult("0001-a", [
      ...repeat(9, "melchior-1", "adopted"),
      ...repeat(1, "melchior-1", "rejected"),
      ...repeat(5, "balthasar-2", "adopted"),
      ...repeat(5, "casper-3", "rejected"),
    ]),
  ];
  const report = skewFromLedger(ledger);
  assert.equal(report.armed, true);
  assert.equal(report.state, "tripped");
  assert.equal(report.gapPoints, 40);
});

test("a gap of exactly 33 points does not trip: the rule is strictly more than", () => {
  const ledger = [
    consult("0001-a", [
      ...repeat(8, "melchior-1", "adopted"),
      ...repeat(2, "melchior-1", "rejected"),
      ...repeat(47, "balthasar-2", "adopted"),
      ...repeat(53, "casper-3", "rejected"),
    ]),
  ];
  const report = skewFromLedger(ledger);
  assert.equal(report.gapPoints, 33);
  assert.equal(report.state, "clear");
});

test("only the last 10 consults count: old skew outside the window is forgotten", () => {
  const skewed = consult("0000-old", [
    ...repeat(30, "melchior-1", "adopted"),
    ...repeat(30, "casper-3", "rejected"),
  ]);
  const balanced = Array.from({ length: 10 }, (_, at) =>
    consult(`00${at}-recent`, [disp("melchior-1", "adopted"), disp("casper-3", "adopted")]),
  );
  const report = skewFromLedger([skewed, ...balanced]);
  assert.equal(report.consultsInWindow, 10);
  assert.equal(report.findingsInWindow, 20);
  assert.equal(report.state, "clear");
  assert.equal(report.gapPoints, 0);
});

test("hysteresis: a trip holds between clear and trip lines and clears after a 3-consult dwell", () => {
  // Trip: melchior 10/10 vs foreign 6/10 -> gap 40.
  const tripping = consult("0001-a", [
    ...repeat(10, "melchior-1", "adopted"),
    ...repeat(6, "balthasar-2", "adopted"),
    ...repeat(4, "casper-3", "rejected"),
  ]);
  assert.equal(skewFromLedger([tripping]).state, "tripped");
  // Recovery pulls the gap to ~28.6: inside the hysteresis band, still tripped.
  const recovering = consult("0002-b", repeat(4, "balthasar-2", "adopted"));
  assert.equal(skewFromLedger([tripping, recovering]).state, "tripped");
  // Two more consults under the trip line: dwell 3 reached, the trip clears.
  const quiet1 = consult("0003-c", []);
  assert.equal(skewFromLedger([tripping, recovering, quiet1]).state, "tripped");
  const quiet2 = consult("0004-d", []);
  assert.equal(skewFromLedger([tripping, recovering, quiet1, quiet2]).state, "clear");
});

test("a gap falling below the clear line deactivates immediately, without a dwell", () => {
  const tripping = consult("0001-a", [
    ...repeat(10, "melchior-1", "adopted"),
    ...repeat(6, "balthasar-2", "adopted"),
    ...repeat(4, "casper-3", "rejected"),
  ]);
  // Foreign 16/20 -> gap 20, strictly below clear 25.
  const recovered = consult("0002-b", repeat(10, "casper-3", "adopted"));
  assert.equal(skewFromLedger([tripping, recovered]).state, "clear");
});

test("a trip is latched: the window rolling below the arming floor does not clear it", () => {
  const tripping = consult("0001-a", [
    ...repeat(10, "melchior-1", "adopted"),
    ...repeat(6, "balthasar-2", "adopted"),
    ...repeat(4, "casper-3", "rejected"),
  ]);
  const quiet = Array.from({ length: 10 }, (_, at) => consult(`000${at + 2}-q`, []));
  const report = skewFromLedger([tripping, ...quiet]);
  assert.equal(report.armed, false);
  assert.equal(report.state, "tripped");
});

test("family credit is mechanical: a duplicate-marked adoption still counts for its family", () => {
  // Balthasar independently re-raised an adopted melchior finding: the
  // duplicate marker dedupes the value metric only, never family credit.
  const ledger = [
    consult("0001-a", [
      ...repeat(6, "melchior-1", "adopted"),
      ...repeat(5, "balthasar-2", "adopted"),
      disp("balthasar-2", "adopted", "0001-a/melchior-1/F1"),
    ]),
  ];
  const report = skewFromLedger(ledger);
  assert.equal(report.foreign.total, 6);
  assert.equal(report.foreign.adopted, 6);
  assert.equal(report.armed, true);
});

test("per-family gaps are reported for each foreign family, informational only", () => {
  const ledger = [
    consult("0001-a", [
      ...repeat(6, "melchior-1", "adopted"),
      ...repeat(2, "melchior-1", "rejected"),
      ...repeat(4, "balthasar-2", "adopted"),
      ...repeat(2, "balthasar-2", "rejected"),
      ...repeat(3, "casper-3", "adopted"),
      ...repeat(3, "casper-3", "rejected"),
    ]),
  ];
  const report = skewFromLedger(ledger);
  const codex = report.families.find((family) => family.harness === "codex");
  const grok = report.families.find((family) => family.harness === "grok");
  assert.deepEqual(
    { adopted: codex?.adopted, total: codex?.total },
    { adopted: 4, total: 6 },
  );
  assert.ok(Math.abs((codex?.gapPoints ?? 0) - (75 - 400 / 6)) < 1e-9);
  assert.equal(grok?.gapPoints, 25);
});

test("dispositions on unknown slots are ignored, not fatal", () => {
  const ledger = [
    consult("0001-a", [
      ...repeat(10, "melchior-1", "adopted"),
      ...repeat(10, "casper-3", "rejected"),
      disp("gemini-4", "adopted"),
    ]),
  ];
  assert.equal(skewFromLedger(ledger).findingsInWindow, 20);
});
