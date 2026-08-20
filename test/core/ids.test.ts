import assert from "node:assert/strict";
import { test } from "node:test";

import { citationId, consultId } from "../../src/core/ids.ts";

test("consultId accepts the on-disk consult directory format", () => {
  assert.equal(consultId("0001-design-review"), "0001-design-review");
  assert.equal(consultId("0042-a"), "0042-a");
  assert.equal(consultId("9999-two-part-slug"), "9999-two-part-slug");
});

test("consultId refuses everything else", () => {
  const bad = [
    "",
    "0001",
    "0001-",
    "001-short-prefix",
    "0001-Design-Review",
    "0001-design--review",
    "abcd-design",
    "0001 design",
    "0001-design-",
  ];
  for (const value of bad) {
    assert.throws(() => consultId(value), `accepted: "${value}"`);
  }
});

test("citationId accepts E<n> starting at 1", () => {
  assert.equal(citationId("E1"), "E1");
  assert.equal(citationId("E42"), "E42");
});

test("citationId refuses everything else", () => {
  const bad = ["", "E0", "E01", "e1", "E", "1", "E1.2", "E-1", "EV1"];
  for (const value of bad) {
    assert.throws(() => citationId(value), `accepted: "${value}"`);
  }
});
