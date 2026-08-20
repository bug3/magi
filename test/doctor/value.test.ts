import assert from "node:assert/strict";
import { test } from "node:test";

import type { FoldedConsult, LedgerDisposition, LedgerSeat } from "../../src/consult/ledger.ts";
import { VALUE_BAND, VALUE_CHECKPOINT_CONSULTS, valueFromLedger } from "../../src/doctor/value.ts";

function seat(usage?: LedgerSeat["usage"]): LedgerSeat {
  return {
    slot: "casper-3",
    valid: true,
    reasons: [],
    durationMs: 1000,
    retried: false,
    ...(usage === undefined ? {} : { usage }),
  };
}

function consult(
  id: string,
  dispositions: readonly LedgerDisposition[] = [],
  seats: readonly LedgerSeat[] = [],
): FoldedConsult {
  return { consult: id, seats, dispositions, overrides: [] };
}

function adopted(finding: string, duplicateOf?: string): LedgerDisposition {
  return {
    slot: "melchior-1",
    finding,
    disposition: "adopted",
    reason: "r",
    ...(duplicateOf === undefined ? {} : { duplicateOf }),
  };
}

test("the checkpoint cadence is every 10 consults", () => {
  assert.equal(VALUE_CHECKPOINT_CONSULTS, 10);
});

test("adopted unique counts adoptions and skips duplicate re-records", () => {
  const ledger = [
    consult("0001-a", [adopted("F1"), adopted("F2")]),
    consult("0002-b", [adopted("F1", "0001-a/F1")]),
  ];
  assert.equal(valueFromLedger(ledger).adoptedUnique, 2);
});

test("spend sums tokens, and USD only where the CLI reported it", () => {
  const ledger = [
    consult("0001-a", [], [
      seat({ inputTokens: 100, outputTokens: 40, costUsd: 0.5 }),
      seat({ inputTokens: 10, outputTokens: 5 }),
      seat(),
    ]),
  ];
  const report = valueFromLedger(ledger);
  assert.equal(report.inputTokens, 110);
  assert.equal(report.outputTokens, 45);
  assert.equal(report.costUsd, 0.5);
});

test("before the first checkpoint the derived metrics are withheld", () => {
  const ledger = Array.from({ length: 7 }, (_, at) => consult(`000${at}-x`, [adopted("F1")]));
  const report = valueFromLedger(ledger);
  assert.equal(report.checkpoint, false);
  assert.equal(report.consultsUntilCheckpoint, 3);
  assert.equal(report.adoptedPerConsult, undefined);
  assert.equal(report.costPerAdoptedUsd, undefined);
});

test("at the checkpoint the two owner metrics appear", () => {
  const ledger = Array.from({ length: 10 }, (_, at) =>
    consult(`000${at}-x`, [adopted("F1")], [seat({ inputTokens: 1, outputTokens: 1, costUsd: 0.2 })]),
  );
  const report = valueFromLedger(ledger);
  assert.equal(report.checkpoint, true);
  assert.equal(report.adoptedPerConsult, 1);
  assert.ok(Math.abs((report.costPerAdoptedUsd ?? 0) - 0.2) < 1e-9);
});

test("cost per adopted finding is undefined when nothing was adopted", () => {
  const ledger = Array.from({ length: 10 }, (_, at) =>
    consult(`000${at}-x`, [], [seat({ inputTokens: 1, outputTokens: 1, costUsd: 0.2 })]),
  );
  assert.equal(valueFromLedger(ledger).costPerAdoptedUsd, undefined);
});

test("the pre-registered band still carries the numbers it was registered with", () => {
  assert.deepEqual(VALUE_BAND, {
    continueAdoptedPerConsult: 1,
    stopConsiderAdoptedPerConsult: 0.3,
    stopConsiderConsecutiveCheckpoints: 2,
    adjustTokensPerAdopted: 50_000,
    adjustCostUsdPerAdopted: 2,
    stopLockNonSelfConsults: 3,
  });
});

test("the adoption rate counts every disposition, duplicates included: inflation stays visible", () => {
  const rejected: LedgerDisposition = {
    slot: "casper-3",
    finding: "F9",
    disposition: "rejected",
    reason: "r",
  };
  const ledger = [
    consult("0001-a", [adopted("F1"), adopted("F2"), rejected]),
    consult("0002-b", [adopted("F1", "0001-a/melchior-1/F1")]),
  ];
  const report = valueFromLedger(ledger);
  assert.equal(report.dispositioned, 4);
  assert.equal(report.adoptionRate, 3 / 4);
});

test("the adoption rate is withheld while nothing is dispositioned", () => {
  assert.equal(valueFromLedger([consult("0001-a")]).adoptionRate, undefined);
});
