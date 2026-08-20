import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { FoldedConsult, LedgerDisposition, LedgerSeat } from "../../src/consult/ledger.ts";
import {
  COMPLETENESS_PARAMS,
  completenessFromLedger,
  gateExpectedReader,
  type ExpectedFinding,
} from "../../src/doctor/completeness.ts";

function disp(slot: string, finding: string): LedgerDisposition {
  return { slot, finding, disposition: "adopted", reason: "r" };
}

function seat(slot: string, valid: boolean): LedgerSeat {
  return { slot, valid, reasons: [], durationMs: 1, retried: false };
}

function consult(
  id: string,
  dispositions: readonly LedgerDisposition[],
  seats: readonly LedgerSeat[] = [],
): FoldedConsult {
  return { consult: id, seats, dispositions, overrides: [] };
}

function reader(
  map: Readonly<Record<string, readonly ExpectedFinding[] | undefined>>,
): (id: string) => readonly ExpectedFinding[] | undefined {
  return (id) => map[id];
}

test("the owner-set overdue deadline is 2 newer consults", () => {
  assert.deepEqual(COMPLETENESS_PARAMS, { overdueAfterConsults: 2 });
});

test("a consult is complete when every expected finding has exactly one disposition", () => {
  const entries = completenessFromLedger(
    [consult("0001-a", [disp("melchior-1", "F1"), disp("casper-3", "F1")])],
    reader({
      "0001-a": [
        { slot: "melchior-1", finding: "F1" },
        { slot: "casper-3", finding: "F1" },
      ],
    }),
  );
  assert.deepEqual(
    entries.map((entry) => ({ complete: entry.complete, missing: entry.missing })),
    [{ complete: true, missing: [] }],
  );
});

test("missing dispositions are named slot/finding and counted", () => {
  const entries = completenessFromLedger(
    [consult("0001-a", [disp("melchior-1", "F1")])],
    reader({
      "0001-a": [
        { slot: "melchior-1", finding: "F1" },
        { slot: "melchior-1", finding: "F2" },
        { slot: "casper-3", finding: "F1" },
      ],
    }),
  );
  const entry = entries[0];
  assert.equal(entry?.complete, false);
  assert.deepEqual(entry?.missing, ["melchior-1/F2", "casper-3/F1"]);
  assert.equal(entry?.expected, 3);
  assert.equal(entry?.dispositioned, 1);
});

test("two dispositions for one finding is a conflict, not completeness", () => {
  const entries = completenessFromLedger(
    [consult("0001-a", [disp("melchior-1", "F1"), disp("melchior-1", "F1")])],
    reader({ "0001-a": [{ slot: "melchior-1", finding: "F1" }] }),
  );
  const entry = entries[0];
  assert.equal(entry?.complete, false);
  assert.deepEqual(entry?.conflicting, ["melchior-1/F1"]);
});

test("an incomplete consult becomes overdue only after 2 newer consults", () => {
  const expected = { "0001-a": [{ slot: "melchior-1", finding: "F1" }] };
  const fresh = completenessFromLedger([consult("0001-a", [])], reader(expected));
  assert.deepEqual(
    fresh.map((entry) => ({ age: entry.ageConsults, overdue: entry.overdue })),
    [{ age: 0, overdue: false }],
  );
  const aged = completenessFromLedger(
    [consult("0001-a", []), consult("0002-b", []), consult("0003-c", [])],
    reader({ ...expected, "0002-b": [], "0003-c": [] }),
  );
  assert.deepEqual(
    aged.map((entry) => ({ age: entry.ageConsults, overdue: entry.overdue })),
    [
      { age: 2, overdue: true },
      { age: 1, overdue: false },
      { age: 0, overdue: false },
    ],
  );
});

test("a consult with no gate record is untracked, never overdue", () => {
  const entries = completenessFromLedger(
    [consult("0001-a", [disp("melchior-1", "F1")]), consult("0002-b", []), consult("0003-c", [])],
    reader({ "0002-b": [], "0003-c": [] }),
  );
  const entry = entries[0];
  assert.equal(entry?.tracked, false);
  assert.equal(entry?.overdue, false);
});

test("the gate reader enumerates valid opinions, restricted to consult-time-valid seats", () => {
  // 0005 precedent: a later re-gate revalidated a seat the consult-time
  // ledger row recorded as invalid; that must not manufacture retroactive
  // debt, so expected ids come from the intersection.
  const dir = mkdtempSync(join(tmpdir(), "magi-completeness-"));
  const consultDir = join(dir, "consults", "0001-a");
  mkdirSync(consultDir, { recursive: true });
  writeFileSync(
    join(consultDir, "gate.json"),
    JSON.stringify({
      verdicts: [
        { slot: "melchior-1", valid: true, opinion: { findings: [{ id: "F1" }, { id: "F2" }] } },
        { slot: "balthasar-2", valid: true, opinion: { findings: [{ id: "F1" }] } },
        { slot: "casper-3", valid: false },
      ],
    }),
  );
  const ledger = [
    consult("0001-a", [], [seat("melchior-1", false), seat("balthasar-2", true), seat("casper-3", false)]),
  ];
  const expected = gateExpectedReader(dir, ledger)("0001-a");
  assert.deepEqual(expected, [{ slot: "balthasar-2", finding: "F1" }]);
});

test("the gate reader returns undefined for a consult without a gate record", () => {
  const dir = mkdtempSync(join(tmpdir(), "magi-completeness-"));
  assert.equal(gateExpectedReader(dir, [])("0009-x"), undefined);
});
