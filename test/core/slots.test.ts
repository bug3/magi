import assert from "node:assert/strict";
import { test } from "node:test";

import { SLOTS, slot } from "../../src/core/slots.ts";

test("the crew is fixed at three seats with unique ids", () => {
  assert.equal(SLOTS.length, 3);
  assert.equal(new Set(SLOTS.map((s) => s.id)).size, 3);
});

test("each seat runs a distinct harness so the council cannot collapse to one family", () => {
  assert.equal(new Set(SLOTS.map((s) => s.harness)).size, 3);
});

test("labels are the display form of the machine id, never a second id", () => {
  for (const { id, label } of SLOTS) {
    assert.equal(label.toLowerCase(), id);
  }
});

test("slot() resolves every declared id", () => {
  for (const { id } of SLOTS) {
    assert.equal(slot(id).id, id);
  }
});
