import assert from "node:assert/strict";
import { test } from "node:test";

import { consultStatus } from "../../src/consult/status.ts";

test("no valid seats is degraded", () => {
  assert.equal(consultStatus([]), "degraded");
});

test("claude alone is degraded: the party under review cannot stand alone", () => {
  assert.equal(consultStatus(["melchior-1"]), "degraded");
});

test("one foreign family alone is still degraded: two families are required", () => {
  assert.equal(consultStatus(["casper-3"]), "degraded");
});

test("claude plus one foreign family is complete", () => {
  assert.equal(consultStatus(["melchior-1", "balthasar-2"]), "complete");
});

test("two foreign families are complete without claude", () => {
  assert.equal(consultStatus(["balthasar-2", "casper-3"]), "complete");
});
