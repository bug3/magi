import assert from "node:assert/strict";
import { test } from "node:test";

import { healthFromLedger } from "../../src/doctor/health.ts";

function row(seats: readonly { slot: string; valid: boolean }[]): string {
  return JSON.stringify({ consult: "x", seats });
}

test("a seat whose last three appearances all failed is chronic", () => {
  const lines = [
    row([{ slot: "casper-3", valid: true }]),
    row([{ slot: "casper-3", valid: false }]),
    row([{ slot: "casper-3", valid: false }]),
    row([{ slot: "casper-3", valid: false }]),
  ];
  const [casper] = healthFromLedger(lines);
  assert.ok(casper);
  assert.equal(casper.appearances, 4);
  assert.equal(casper.invalid, 3);
  assert.equal(casper.chronic, true);
});

test("a recovery inside the window clears the chronic flag", () => {
  const lines = [
    row([{ slot: "casper-3", valid: false }]),
    row([{ slot: "casper-3", valid: false }]),
    row([{ slot: "casper-3", valid: true }]),
  ];
  assert.equal(healthFromLedger(lines)[0]?.chronic, false);
});

test("fewer appearances than the window can never be chronic", () => {
  const lines = [row([{ slot: "balthasar-2", valid: false }])];
  assert.equal(healthFromLedger(lines)[0]?.chronic, false);
});

test("garbage lines are skipped, not fatal: the ledger outlives its writers", () => {
  const lines = ["not json", "", row([{ slot: "melchior-1", valid: true }])];
  const health = healthFromLedger(lines);
  assert.equal(health.length, 1);
  assert.equal(health[0]?.appearances, 1);
});
