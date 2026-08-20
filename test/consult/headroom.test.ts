import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  estimateBriefTokens,
  headroomReport,
  loadHeadroomConfig,
  type HeadroomConfig,
} from "../../src/consult/headroom.ts";
import type { FoldedConsult, LedgerSeat } from "../../src/consult/ledger.ts";

const NOW = new Date("2026-08-20T12:00:00Z");

function seat(slot: string, tokens: number): LedgerSeat {
  return {
    slot,
    valid: true,
    reasons: [],
    durationMs: 1000,
    retried: false,
    usage: { inputTokens: tokens, outputTokens: 0 },
  };
}

function consult(id: string, startedAt: string, seats: readonly LedgerSeat[]): FoldedConsult {
  return { consult: id, startedAt, seats, dispositions: [], overrides: [] };
}

const CONFIG: HeadroomConfig = { windowHours: 5, budgets: { claude: 1000 } };

test("window spend counts only consults started inside the window", () => {
  const consults = [
    consult("0001-old", "2026-08-20T05:00:00Z", [seat("melchior-1", 900)]),
    consult("0002-new", "2026-08-20T10:00:00Z", [seat("melchior-1", 300)]),
  ];
  const report = headroomReport(consults, CONFIG, NOW);
  const claude = report.harnesses.find((h) => h.harness === "claude");
  assert.equal(claude?.spentInWindow, 300);
  assert.equal(claude?.remaining, 700);
});

test("projected burn is the mean of the harness's recent appearances", () => {
  const consults = [
    consult("0001-a", "2026-08-20T10:00:00Z", [seat("melchior-1", 100)]),
    consult("0002-b", "2026-08-20T10:30:00Z", [seat("melchior-1", 300)]),
  ];
  const report = headroomReport(consults, CONFIG, NOW);
  assert.equal(report.harnesses.find((h) => h.harness === "claude")?.projectedBurn, 200);
});

test("refuses when the projection does not fit the remaining allotment", () => {
  const consults = [
    consult("0001-a", "2026-08-20T10:00:00Z", [seat("melchior-1", 600)]),
  ];
  // spent 600 of 1000, projection 600 > remaining 400.
  assert.equal(headroomReport(consults, CONFIG, NOW).refuse, true);
});

test("refuses on an exhausted budget even without a projection", () => {
  const consults = [
    consult("0001-a", "2026-08-20T11:00:00Z", [
      { ...seat("melchior-1", 0), usage: undefined } as unknown as LedgerSeat,
    ]),
  ];
  const exhausted: HeadroomConfig = { windowHours: 5, budgets: { claude: 0 } };
  assert.equal(headroomReport(consults, exhausted, NOW).refuse, true);
});

test("an unknown projection with room left reports, but does not refuse", () => {
  const report = headroomReport([], CONFIG, NOW);
  const claude = report.harnesses.find((h) => h.harness === "claude");
  assert.equal(claude?.projectedBurn, undefined);
  assert.equal(report.refuse, false);
});

test("without config the report is report-only and never refuses", () => {
  const consults = [
    consult("0001-a", "2026-08-20T11:00:00Z", [seat("melchior-1", 999999)]),
  ];
  const report = headroomReport(consults, undefined, NOW);
  assert.equal(report.configured, false);
  assert.equal(report.refuse, false);
  assert.equal(report.harnesses.find((h) => h.harness === "claude")?.budget, undefined);
});

test("absent config file means undefined; the default window is five hours", () => {
  const dir = mkdtempSync(join(tmpdir(), "magi-headroom-"));
  assert.equal(loadHeadroomConfig(dir), undefined);
  writeFileSync(join(dir, "headroom.local.json"), JSON.stringify({ budgets: { claude: 1000 } }));
  assert.deepEqual(loadHeadroomConfig(dir), { windowHours: 5, budgets: { claude: 1000 } });
});

test("a malformed config throws rather than silently disabling the floor", () => {
  const dir = mkdtempSync(join(tmpdir(), "magi-headroom-"));
  writeFileSync(join(dir, "headroom.local.json"), "not json");
  assert.throws(() => loadHeadroomConfig(dir), /headroom\.local\.json/);
  writeFileSync(join(dir, "headroom.local.json"), JSON.stringify({ budgets: { gemini: 5 } }));
  assert.throws(() => loadHeadroomConfig(dir), /unknown harness/);
});

test("the brief estimate raises a projection that history alone would pass", () => {
  const consults = [consult("0001-a", "2026-08-20T10:00:00Z", [seat("melchior-1", 100)])];
  // Spent 100 of 1000, mean 100 fits; the rendered brief alone is ~2000.
  const report = headroomReport(consults, CONFIG, NOW, 2000);
  const claude = report.harnesses.find((h) => h.harness === "claude");
  assert.equal(claude?.projection, 2000);
  assert.equal(report.estimatedBriefTokens, 2000);
  assert.equal(report.refuse, true);
});

test("history stays the projection when it exceeds the brief estimate", () => {
  const consults = [consult("0001-a", "2026-08-20T05:00:00Z", [seat("melchior-1", 800)])];
  const report = headroomReport(consults, CONFIG, NOW, 100);
  const claude = report.harnesses.find((h) => h.harness === "claude");
  assert.equal(claude?.projectedBurn, 800);
  assert.equal(claude?.projection, 800);
  assert.equal(report.refuse, false);
});

test("the token estimate is chars over four, rounded up", () => {
  assert.equal(estimateBriefTokens(9), 3);
  assert.equal(estimateBriefTokens(8), 2);
  assert.equal(estimateBriefTokens(0), 0);
});
