/**
 * A `$ref` must stay a reference all the way down: the compiled schema has to
 * apply the definition it points at, including through a chain of refs that
 * hop from one definition to the next. Tooling that inlines a `$ref` by hand
 * loses the deeper hops silently, so these cases pin an accepting and a
 * rejecting instance for every hop depth the validator claims to handle.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { compileSchema } from "../../src/schema/validator.ts";

const CHAINED_DEFS = {
  type: "object",
  required: ["id", "label"],
  additionalProperties: false,
  properties: {
    // One hop: straight to a leaf definition.
    id: { $ref: "#/$defs/identifier" },
    // Three hops: label -> shortText -> boundedText -> the leaf constraint.
    label: { $ref: "#/$defs/label" },
  },
  $defs: {
    identifier: { type: "string", pattern: "^id-[0-9]+$" },
    label: { $ref: "#/$defs/shortText" },
    shortText: { $ref: "#/$defs/boundedText" },
    boundedText: { type: "string", minLength: 2, maxLength: 8 },
  },
};

function issues(schema: unknown, data: unknown): string[] {
  const result = compileSchema(schema).validate(data);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}:${issue.keyword}`);
}

test("a $ref chain into $defs applies every hop's constraints", () => {
  assert.deepEqual(issues(CHAINED_DEFS, { id: "id-7", label: "ready" }), []);
  assert.deepEqual(issues(CHAINED_DEFS, { id: "seven", label: "ready" }), ["/id:pattern"]);
  // The rejection comes from the far end of the chain, three hops in.
  assert.deepEqual(issues(CHAINED_DEFS, { id: "id-7", label: "x" }), ["/label:minLength"]);
  assert.deepEqual(issues(CHAINED_DEFS, { id: "id-7", label: "far too long" }), [
    "/label:maxLength",
  ]);
});

test("a $ref chain resolves through a nested pointer, not by keyword name", () => {
  // `definitions` is not a validator keyword: it is reachable only because a
  // JSON pointer names it inside `$defs`. The chain must still resolve hop by
  // hop rather than stopping at the group it lives in.
  const schema = {
    type: "object",
    required: ["count"],
    additionalProperties: false,
    properties: { count: { $ref: "#/$defs/definitions/count" } },
    $defs: {
      definitions: {
        count: { $ref: "#/$defs/definitions/positiveInteger" },
        positiveInteger: { type: "integer", minimum: 1 },
      },
    },
  };
  assert.deepEqual(issues(schema, { count: 3 }), []);
  assert.deepEqual(issues(schema, { count: 0 }), ["/count:minimum"]);
  assert.deepEqual(issues(schema, { count: "3" }), ["/count:type"]);
});

test("a $ref shared by two properties stays one compiled definition", () => {
  const schema = {
    type: "object",
    required: ["from", "to"],
    additionalProperties: false,
    properties: { from: { $ref: "#/$defs/port" }, to: { $ref: "#/$defs/port" } },
    $defs: { port: { $ref: "#/$defs/portNumber" }, portNumber: { type: "integer", maximum: 65535 } },
  };
  assert.deepEqual(issues(schema, { from: 80, to: 443 }), []);
  assert.deepEqual(issues(schema, { from: 80, to: 70000 }), ["/to:maximum"]);
});
