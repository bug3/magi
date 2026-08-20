import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  appendLedgerBackfill,
  appendLedgerRow,
  foldLedger,
  type LedgerRow,
} from "../../src/consult/ledger.ts";

function consultRow(consult: string): LedgerRow {
  return {
    consult,
    mode: "review",
    startedAt: "2026-08-20T00:00:00.000Z",
    finishedAt: "2026-08-20T00:01:00.000Z",
    status: "complete",
    seats: [],
  };
}

function backfillLine(consult: string, findings: readonly string[]): string {
  return JSON.stringify({
    backfill: consult,
    recordedAt: "2026-08-20T12:00:00.000Z",
    dispositions: findings.map((finding) => ({
      slot: "melchior-1",
      finding,
      disposition: "adopted",
      reason: "r",
    })),
    overrides: [],
  });
}

test("backfill rows fold onto their consult, in order", () => {
  const lines = [
    JSON.stringify(consultRow("0001-a")),
    JSON.stringify(consultRow("0002-b")),
    backfillLine("0001-a", ["F1", "F2"]),
    backfillLine("0001-a", ["F3"]),
  ];
  const folded = foldLedger(lines);
  assert.equal(folded.length, 2);
  assert.deepEqual(
    folded[0]?.dispositions.map((d) => d.finding),
    ["F1", "F2", "F3"],
  );
  assert.equal(folded[1]?.dispositions.length, 0);
});

test("a backfill for an unknown consult is skipped, not fatal", () => {
  const lines = [JSON.stringify(consultRow("0001-a")), backfillLine("9999-ghost", ["F1"])];
  const folded = foldLedger(lines);
  assert.equal(folded.length, 1);
  assert.equal(folded[0]?.dispositions.length, 0);
});

test("garbage lines are skipped: the ledger outlives its writers", () => {
  const lines = ["not json", "", JSON.stringify(consultRow("0001-a"))];
  assert.equal(foldLedger(lines).length, 1);
});

test("append functions write lines the fold reads back", () => {
  const dir = mkdtempSync(join(tmpdir(), "magi-ledger-"));
  const path = join(dir, "ledger.jsonl");
  appendLedgerRow(path, consultRow("0001-a"));
  appendLedgerBackfill(path, {
    backfill: "0001-a",
    recordedAt: "2026-08-20T12:00:00.000Z",
    dispositions: [
      { slot: "casper-3", finding: "F2", disposition: "rejected", reason: "conflicts" },
    ],
    overrides: ["noted"],
  });
  const folded = foldLedger(readFileSync(path, "utf8").split("\n"));
  assert.equal(folded.length, 1);
  assert.equal(folded[0]?.dispositions[0]?.disposition, "rejected");
  assert.deepEqual(folded[0]?.overrides, ["noted"]);
});

test("the fold keeps each consult's start time for window arithmetic", () => {
  const folded = foldLedger([JSON.stringify(consultRow("0001-a"))]);
  assert.equal(folded[0]?.startedAt, "2026-08-20T00:00:00.000Z");
});

test("wrong-shaped fields on legacy rows are ignored, not fatal", () => {
  const legacy = JSON.stringify({
    ...consultRow("0001-a"),
    seats: undefined,
    dispositions: { adopted: 14, rejected: 1 },
  });
  const folded = foldLedger([legacy, backfillLine("0001-a", ["F1"])]);
  assert.equal(folded.length, 1);
  assert.deepEqual(folded[0]?.seats, []);
  assert.deepEqual(
    folded[0]?.dispositions.map((d) => d.finding),
    ["F1"],
  );
});

test("old rows carrying inline dispositions still fold", () => {
  const legacy = JSON.stringify({
    ...consultRow("0001-a"),
    dispositions: [{ slot: "balthasar-2", finding: "F1", disposition: "adopted", reason: "r" }],
  });
  const folded = foldLedger([legacy, backfillLine("0001-a", ["F2"])]);
  assert.deepEqual(
    folded[0]?.dispositions.map((d) => d.finding),
    ["F1", "F2"],
  );
});
