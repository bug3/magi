/**
 * The validator's contract is the keyword subset named in its header, not just
 * the keywords today's artifacts happen to use. These cover the rest of that
 * list: each keyword accepts what it should, rejects what it should, and
 * refuses a malformed schema at compile time rather than at validate time.
 *
 * If a keyword here ever looks not worth testing, the honest move is to delete
 * the keyword (the validator is fail-closed, so a schema using it would then be
 * a compile error) rather than to leave it untested.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { compileSchema, SchemaCompileError } from "../../src/schema/validator.ts";

function issues(schema: unknown, data: unknown): string[] {
  const result = compileSchema(schema).validate(data);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}:${issue.keyword}`);
}

test("prefixItems checks each position, and items covers the tail", () => {
  const schema = {
    type: "array",
    prefixItems: [{ type: "string" }, { type: "integer" }],
    items: { type: "boolean" },
  };
  assert.deepEqual(issues(schema, ["c1", 2, true, false]), []);
  assert.deepEqual(issues(schema, [1, 2]), ["/0:type"]);
  assert.deepEqual(issues(schema, ["c1", "two"]), ["/1:type"]);
  assert.deepEqual(issues(schema, ["c1", 2, "not a boolean"]), ["/2:type"]);
  // A short array is not a violation by itself: minItems says that.
  assert.deepEqual(issues(schema, ["c1"]), []);
});

test("prefixItems must be an array of schemas", () => {
  assert.throws(
    () => compileSchema({ type: "array", prefixItems: { type: "string" } }),
    (error: unknown) =>
      error instanceof SchemaCompileError &&
      /prefixItems must be an array/.test((error as Error).message),
  );
});

test("array bounds report the bound that was crossed", () => {
  const schema = { type: "array", minItems: 2, maxItems: 3 };
  assert.deepEqual(issues(schema, [1, 2]), []);
  assert.deepEqual(issues(schema, [1]), [":minItems"]);
  assert.deepEqual(issues(schema, [1, 2, 3, 4]), [":maxItems"]);
});

test("uniqueItems must be a boolean, not a truthy value", () => {
  assert.doesNotThrow(() => compileSchema({ type: "array", uniqueItems: false }));
  assert.throws(
    () => compileSchema({ type: "array", uniqueItems: "yes" }),
    (error: unknown) =>
      error instanceof SchemaCompileError &&
      /uniqueItems must be a boolean/.test((error as Error).message),
  );
});

test("patternProperties validates every key that matches, and stacks with properties", () => {
  const schema = {
    type: "object",
    properties: { name: { type: "string" } },
    patternProperties: { "^count_": { type: "integer" }, _total$: { minimum: 0 } },
    additionalProperties: false,
  };
  assert.deepEqual(issues(schema, { name: "x", count_a: 1, b_total: 5 }), []);
  assert.deepEqual(issues(schema, { count_a: "one" }), ["/count_a:type"]);
  assert.deepEqual(issues(schema, { b_total: -1 }), ["/b_total:minimum"]);
  // A key matching two patterns must satisfy both.
  assert.deepEqual(issues(schema, { count_total: -1 }), ["/count_total:minimum"]);
  // A declared property wins over a pattern that would also match it.
  assert.deepEqual(issues(schema, { name: 1, count_a: 1 }), ["/name:type"]);
  assert.deepEqual(issues(schema, { other: 1 }), ["/other:additionalProperties"]);
});

test("patternProperties refuses a malformed schema at compile time", () => {
  assert.throws(
    () => compileSchema({ type: "object", patternProperties: [], additionalProperties: false }),
    (error: unknown) =>
      error instanceof SchemaCompileError &&
      /patternProperties must be an object/.test((error as Error).message),
  );
  assert.throws(
    () =>
      compileSchema({
        type: "object",
        patternProperties: { "[": { type: "string" } },
        additionalProperties: false,
      }),
    (error: unknown) =>
      error instanceof SchemaCompileError && /not a valid regex/.test((error as Error).message),
  );
});

test("object size bounds count own properties", () => {
  const schema = { type: "object", minProperties: 1, maxProperties: 2, additionalProperties: true };
  assert.deepEqual(issues(schema, { a: 1 }), []);
  assert.deepEqual(issues(schema, {}), [":minProperties"]);
  assert.deepEqual(issues(schema, { a: 1, b: 2, c: 3 }), [":maxProperties"]);
});

test("anyOf passes on one match and reports one branch, not all of them", () => {
  const schema = {
    anyOf: [
      { type: "string", minLength: 3 },
      { type: "integer", minimum: 10 },
    ],
  };
  assert.deepEqual(issues(schema, "abc"), []);
  assert.deepEqual(issues(schema, 12), []);

  // Both branches produce one issue for 4 (a wrong type suppresses the rest of
  // its branch), so the first of the tie is the one explained.
  assert.deepEqual(issues(schema, 4), [":anyOf", ":type"]);
});

test("anyOf explains the branch with the fewest complaints", () => {
  const schema = {
    anyOf: [
      { type: "number", minimum: 10, multipleOf: 4 },
      { type: "number", exclusiveMinimum: 100 },
    ],
  };
  // The first branch fails twice, the second once: the shorter story wins.
  assert.deepEqual(issues(schema, 3), [":anyOf", ":exclusiveMinimum"]);
});

test("allOf applies every branch, not the first that passes", () => {
  const schema = { allOf: [{ type: "integer" }, { minimum: 5 }, { maximum: 9 }] };
  assert.deepEqual(issues(schema, 7), []);
  assert.deepEqual(issues(schema, 2), [":minimum"]);
  assert.deepEqual(issues(schema, 12), [":maximum"]);
});

test("not excludes a shape without saying what is allowed", () => {
  const schema = { not: { type: "string" } };
  assert.deepEqual(issues(schema, 1), []);
  assert.deepEqual(issues(schema, "a string"), [":not"]);
});

test("a combinator needs a non-empty array of schemas", () => {
  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    assert.throws(
      () => compileSchema({ [keyword]: [] }),
      (error: unknown) =>
        error instanceof SchemaCompileError &&
        /non-empty array of schemas/.test((error as Error).message),
      `${keyword} with an empty array`,
    );
  }
});

test("oneOf falls back to counting matches when the branches share no tag", () => {
  // Each branch pins a const on a different key, so no discriminator covers all
  // of them and the generic path has to count matches instead.
  const schema = {
    oneOf: [
      {
        type: "object",
        required: ["kind"],
        properties: { kind: { const: "a" } },
        additionalProperties: true,
      },
      {
        type: "object",
        required: ["mode"],
        properties: { mode: { const: "b" } },
        additionalProperties: true,
      },
    ],
  };
  assert.deepEqual(issues(schema, { kind: "a" }), []);
  assert.deepEqual(issues(schema, { mode: "b" }), []);
  assert.deepEqual(issues(schema, { kind: "z", mode: "z" }), [":oneOf"], "no branch matches");
  assert.deepEqual(
    issues(schema, { kind: "a", mode: "b" }),
    [":oneOf"],
    "exactly one means exactly one",
  );
});

test("multipleOf accepts what divides evenly, including fractions", () => {
  assert.deepEqual(issues({ type: "number", multipleOf: 0.5 }, 1.5), []);
  assert.deepEqual(issues({ type: "number", multipleOf: 0.5 }, 1.2), [":multipleOf"]);
  assert.deepEqual(issues({ type: "integer", multipleOf: 5 }, 20), []);
  assert.deepEqual(issues({ type: "integer", multipleOf: 5 }, 21), [":multipleOf"]);
  assert.throws(
    () => compileSchema({ type: "number", multipleOf: 0 }),
    (error: unknown) =>
      error instanceof SchemaCompileError &&
      /multipleOf must be > 0/.test((error as Error).message),
  );
});

test("exclusive bounds exclude the bound itself", () => {
  const schema = { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1 };
  assert.deepEqual(issues(schema, 0.5), []);
  assert.deepEqual(issues(schema, 0), [":exclusiveMinimum"]);
  assert.deepEqual(issues(schema, 1), [":exclusiveMaximum"]);
});

test("a numeric keyword must carry a finite number", () => {
  assert.throws(
    () => compileSchema({ type: "string", maxLength: "10" }),
    (error: unknown) =>
      error instanceof SchemaCompileError &&
      /maxLength must be a finite number/.test((error as Error).message),
  );
  assert.throws(
    () => compileSchema({ type: "array", maxItems: Number.POSITIVE_INFINITY }),
    SchemaCompileError,
  );
});

test("an unknown type name is refused, and a type union is allowed", () => {
  assert.throws(
    () => compileSchema({ type: "date" }),
    (error: unknown) =>
      error instanceof SchemaCompileError && /type must be one of/.test((error as Error).message),
  );
  assert.throws(() => compileSchema({ type: 5 }), SchemaCompileError);

  const schema = { type: ["string", "null"] };
  assert.deepEqual(issues(schema, "x"), []);
  assert.deepEqual(issues(schema, null), []);
  assert.deepEqual(issues(schema, 1), [":type"]);
});

test("an invalid pattern is a schema bug, not a validation failure", () => {
  assert.throws(
    () => compileSchema({ type: "string", pattern: "([a-z" }),
    (error: unknown) =>
      error instanceof SchemaCompileError &&
      /pattern is not a valid regular expression/.test((error as Error).message),
  );
});

test("a $ref that does not resolve fails at compile time", () => {
  assert.throws(
    () => compileSchema({ $defs: { a: { type: "string" } }, $ref: "#/$defs/missing" }),
    (error: unknown) =>
      error instanceof SchemaCompileError && /does not resolve/.test((error as Error).message),
  );
  // A ref without a leading # is a cross-artifact id: it goes to the resolver,
  // which decides whether it exists, so it is not a compile error here.
  assert.doesNotThrow(() =>
    compileSchema({ $ref: "magi/other@v1" }, { resolveExternal: () => compileSchema(true) }),
  );
  assert.throws(
    () => compileSchema({ $ref: "#$defs/a" }),
    (error: unknown) =>
      error instanceof SchemaCompileError && /is not a JSON pointer/.test((error as Error).message),
  );
});

test("pointers walk arrays as well as objects", () => {
  const document = {
    $defs: { pair: [{ type: "string" }, { type: "integer" }] },
    $ref: "#/$defs/pair/1",
  };
  assert.deepEqual(issues(document, 5), []);
  assert.deepEqual(issues(document, "five"), [":type"]);
});

test("a non-finite number is described as such rather than as a number", () => {
  const result = compileSchema({ type: "string" }).validate(Number.NaN);
  assert.ok(!result.ok);
  assert.match(result.issues[0]?.message ?? "", /got non-finite number/);
});
