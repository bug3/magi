import assert from "node:assert/strict";
import { test } from "node:test";

import { NON_PACK_FENCE_BUDGET_LINES, gateBrief } from "../../src/consult/brief-gate.ts";

const HEADER = "Consult: 0001-x\nMode: review\n";

function fence(lines: number, marker = "```", stamp = "line"): string {
  const body = Array.from({ length: lines }, (_, at) => `${stamp} ${at}`).join("\n");
  return `${marker}\n${body}\n${marker}\n`;
}

function gate(brief: string, packMarkdown = "") {
  return gateBrief({ brief, consult: "0001-x", mode: "review", packMarkdown });
}

test("the cumulative non-pack fence budget is the owner number, 20 lines", () => {
  assert.equal(NON_PACK_FENCE_BUDGET_LINES, 20);
});

test("a clean brief passes and reports its non-pack fence accounting", () => {
  const report = gate(`${HEADER}\nprose\n${fence(3)}`);
  assert.deepEqual(report.failures, []);
  assert.equal(report.nonPackFencedLines, 3);
  assert.equal(typeof report.nonPackFencedSha256, "string");
});

test("a header that disagrees with the manifest fails by field", () => {
  const report = gateBrief({ brief: HEADER, consult: "0002-y", mode: "plan", packMarkdown: "" });
  assert.equal(report.failures.length, 2);
  assert.match(report.failures.join(" "), /Consult:/);
  assert.match(report.failures.join(" "), /Mode:/);
});

test("sub-budget fences summing over the budget fail: the budget is cumulative", () => {
  // Three 8-line fences, none a pack excerpt: each passed the old per-block
  // rule, together they are 24 lines of unconstrained inlining.
  const report = gate(`${HEADER}\n${fence(8, "```", "a")}\n${fence(8, "```", "b")}\n${fence(8, "```", "c")}`);
  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0] as string, /24/);
  assert.equal(report.nonPackFencedLines, 24);
});

test("fences that are pack excerpts spend no budget, whatever their length", () => {
  const big = fence(50, "````");
  const report = gate(`${HEADER}\n${big}${fence(8, "```", "extra")}`, `# pack\n${big}`);
  assert.deepEqual(report.failures, []);
  assert.equal(report.nonPackFencedLines, 8);
});

test("a single long non-pack fence still fails: the old rule is subsumed", () => {
  const report = gate(`${HEADER}\n${fence(NON_PACK_FENCE_BUDGET_LINES + 1)}`);
  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0] as string, /not pack excerpts/);
});

test("the hash is absent when every fence is a pack excerpt", () => {
  const block = fence(30, "````");
  const report = gate(`${HEADER}\n${block}`, `# pack\n${block}`);
  assert.deepEqual(report.failures, []);
  assert.equal(report.nonPackFencedLines, 0);
  assert.equal(report.nonPackFencedSha256, undefined);
});

test("a three-backtick line inside a four-backtick block is content, not a fence", () => {
  const inner = Array.from({ length: 25 }, () => "```").join("\n");
  const block = `\`\`\`\`\n${inner}\n\`\`\`\`\n`;
  const report = gate(`${HEADER}\n${block}`, block);
  assert.deepEqual(report.failures, []);
  assert.equal(report.nonPackFencedLines, 0);
});
