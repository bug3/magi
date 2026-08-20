import assert from "node:assert/strict";
import { test } from "node:test";

import type { SeatVerdict } from "../../src/consult/gate.ts";
import { renderSynthesisScaffold } from "../../src/consult/synthesis.ts";

const valid: SeatVerdict = {
  slot: "balthasar-2",
  parse: { ok: true, message: "{}" },
  valid: true,
  reasons: [],
  opinion: {
    mode: "review",
    position: "p",
    findings: [
      {
        id: "F1",
        severity: "blocker",
        claim: "The rename loses the fsync.",
        citations: ["E1"],
        check: "node --test",
        fix: "Keep the fsync after rename.",
      },
    ],
    keepList: [],
    assumptions: [],
    confidence: 0.4,
  },
};

const invalid: SeatVerdict = {
  slot: "casper-3",
  parse: { ok: false, reason: "not-json" },
  valid: false,
  reasons: ["parse: not-json"],
};

test("the scaffold stages every finding for an explicit disposition", () => {
  const scaffold = renderSynthesisScaffold({
    consult: "0002-fs-review",
    status: "degraded",
    verdicts: [valid, invalid],
  });
  assert.ok(scaffold.includes("# Synthesis: 0002-fs-review"));
  assert.ok(scaffold.includes("Status: degraded (proceeds only on explicit user decision)"));
  assert.ok(scaffold.includes("| Balthasar-2 | yes | - |"));
  assert.ok(scaffold.includes("| Casper-3 | NO | parse: not-json |"));
  assert.ok(scaffold.includes("### Balthasar-2 F1 [blocker]"));
  assert.ok(scaffold.includes("- proposed check: node --test"));
  assert.ok(scaffold.includes("disposition: PENDING"));
  assert.ok(scaffold.includes("## Dissent"));
});

test("no findings from valid seats is said out loud, not left blank", () => {
  const scaffold = renderSynthesisScaffold({
    consult: "0003-quiet",
    status: "degraded",
    verdicts: [invalid],
  });
  assert.ok(scaffold.includes("No findings from valid seats."));
});
