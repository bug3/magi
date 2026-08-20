import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { gateSeatOutput } from "../../src/consult/gate.ts";
import { compileSchema } from "../../src/schema/validator.ts";

const contract = compileSchema(
  JSON.parse(readFileSync("schemas/opinion.v1.schema.json", "utf8")),
);
const packCitations: ReadonlySet<string> = new Set(["E1", "E2"]);

/** grok's stdout is a result envelope; text carries the contract bytes. */
function grokEnvelope(document: Record<string, unknown>): string {
  return JSON.stringify({ text: JSON.stringify(document), stopReason: "end_turn" });
}

function opinion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "magi/opinion.v1",
    mode: "review",
    position: "The change is sound.",
    findings: [
      {
        id: "F1",
        severity: "major",
        claim: "The gate accepts what it should refuse.",
        citations: ["E1"],
        check: "npm test",
        fix: null,
      },
    ],
    answers: [],
    keep_list: [{ claim: "The facade surface stays.", citations: ["E2"] }],
    assumptions: [],
    confidence: 0.6,
    ...overrides,
  };
}

test("a grok seat passing the whole gate yields a normalized opinion", () => {
  const verdict = gateSeatOutput("casper-3", grokEnvelope(opinion()), contract, packCitations);
  assert.equal(verdict.valid, true);
  assert.ok(verdict.opinion);
  assert.equal(verdict.opinion.findings[0]?.id, "F1");
  assert.deepEqual(verdict.reasons, []);
});

test("a claude seat's envelope is unwrapped and its usage survives the gate", () => {
  const stdout = JSON.stringify({
    type: "result",
    subtype: "success",
    result: JSON.stringify(opinion()),
    usage: { input_tokens: 11, output_tokens: 7 },
  });
  const verdict = gateSeatOutput("melchior-1", stdout, contract, packCitations);
  assert.equal(verdict.valid, true);
  assert.equal(verdict.parse.usage?.inputTokens, 11);
});

test("a codex seat's event stream is unwrapped through its parser", () => {
  const stdout = [
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: JSON.stringify(opinion()) },
    }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 3, output_tokens: 4 } }),
  ].join("\n");
  const verdict = gateSeatOutput("balthasar-2", stdout, contract, packCitations);
  assert.equal(verdict.valid, true);
  assert.equal(verdict.parse.usage?.outputTokens, 4);
});

test("a citation outside the pack degrades the seat mechanically", () => {
  const stray = opinion({
    findings: [
      { id: "F1", severity: "minor", claim: "Cites thin air.", citations: ["E9"], check: null, fix: null },
    ],
  });
  const verdict = gateSeatOutput("casper-3", grokEnvelope(stray), contract, packCitations);
  assert.equal(verdict.valid, false);
  assert.match(verdict.reasons.join(" "), /E9.*do not resolve/);
});

test("a contract violation is a schema reason, not an opinion about quality", () => {
  const wrong = opinion({ severity_scale: "custom" });
  const verdict = gateSeatOutput("casper-3", grokEnvelope(wrong), contract, packCitations);
  assert.equal(verdict.valid, false);
  assert.match(verdict.reasons.join(" "), /^schema: /);
});

test("a final message that is not one JSON document fails before the contract", () => {
  const stdout = JSON.stringify({ type: "result", subtype: "success", result: "prose answer" });
  const verdict = gateSeatOutput("melchior-1", stdout, contract, packCitations);
  assert.equal(verdict.valid, false);
  assert.match(verdict.reasons.join(" "), /not one JSON document/);
});

test("a grok seat that leaked its local config stays a parse failure at the gate", () => {
  const leaked = readFileSync("fixtures/seat-capture/casper-leaked-preamble.md", "utf8");
  const verdict = gateSeatOutput("casper-3", leaked, contract, packCitations);
  assert.equal(verdict.valid, false);
  assert.deepEqual(verdict.reasons, ["parse: not-json"]);
});
