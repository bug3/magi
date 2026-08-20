import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compileSchema,
  formatIssues,
  SchemaCompileError,
  SchemaValidationError,
} from "../../src/schema/validator.ts";

function issues(schema: unknown, data: unknown): string[] {
  const result = compileSchema(schema).validate(data);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}:${issue.keyword}`);
}

test("rejects schemas that use unimplemented keywords instead of ignoring them", () => {
  assert.throws(
    () => compileSchema({ type: "string", format: "email" }),
    (error: unknown) =>
      error instanceof SchemaCompileError &&
      /unsupported keyword "format"/.test((error as Error).message),
  );
  assert.throws(
    () => compileSchema({ if: { type: "string" }, then: true }),
    SchemaCompileError,
  );
});

test("requires objects with properties to declare additionalProperties", () => {
  assert.throws(
    () => compileSchema({ type: "object", properties: { a: { type: "string" } } }),
    (error: unknown) =>
      error instanceof SchemaCompileError && /additionalProperties/.test((error as Error).message),
  );
  assert.doesNotThrow(() =>
    compileSchema(
      { type: "object", properties: { a: { type: "string" } } },
      { allowImplicitAdditionalProperties: true },
    ),
  );
});

test("rejects $ref with sibling constraints, which would be silently dropped", () => {
  assert.throws(
    () => compileSchema({ $defs: { s: { type: "string" } }, $ref: "#/$defs/s", maxLength: 3 }),
    (error: unknown) =>
      error instanceof SchemaCompileError && /sibling/.test((error as Error).message),
  );
});

test("does not coerce types", () => {
  assert.deepEqual(issues({ type: "integer" }, "3"), [":type"]);
  assert.deepEqual(issues({ type: "boolean" }, "true"), [":type"]);
  assert.deepEqual(issues({ type: "number" }, Number.NaN), [":type"]);
  assert.deepEqual(issues({ type: "number" }, Number.POSITIVE_INFINITY), [":type"]);
  assert.deepEqual(issues({ type: "integer" }, 3.0), []);
  assert.deepEqual(issues({ type: "object" }, []), [":type"]);
  assert.deepEqual(issues({ type: "object" }, null), [":type"]);
});

test("suppresses cascading issues once the type is wrong", () => {
  const schema = {
    type: "object",
    required: ["a"],
    properties: { a: { type: "string" } },
    additionalProperties: false,
  };
  assert.deepEqual(issues(schema, "not an object"), [":type"]);
});

test("reports unknown properties by name", () => {
  const schema = {
    type: "object",
    properties: { a: { type: "string" } },
    additionalProperties: false,
  };
  const result = compileSchema(schema).validate({ a: "x", b: 1 });
  assert.ok(!result.ok);
  assert.deepEqual(result.issues, [
    { path: "/b", keyword: "additionalProperties", message: 'unknown property "b"' },
  ]);
});

test("escapes JSON pointer tokens in paths", () => {
  const schema = { type: "object", additionalProperties: { type: "string" } };
  assert.deepEqual(issues(schema, { "a/b": 1, "c~d": 2 }), ["/a~1b:type", "/c~0d:type"]);
});

test("uniqueItems compares deeply", () => {
  const schema = { type: "array", uniqueItems: true };
  assert.deepEqual(issues(schema, [{ a: [1] }, { a: [1] }]), [":uniqueItems"]);
  assert.deepEqual(issues(schema, [{ a: [1] }, { a: [2] }]), []);
});

test("string lengths count code points, not UTF-16 units", () => {
  assert.deepEqual(issues({ type: "string", maxLength: 2 }, "🙂🙂"), []);
  assert.deepEqual(issues({ type: "string", maxLength: 1 }, "🙂🙂"), [":maxLength"]);
});

test("resolves recursive local refs", () => {
  const schema = {
    $defs: {
      node: {
        type: "object",
        required: ["value"],
        additionalProperties: false,
        properties: {
          value: { type: "integer" },
          children: { type: "array", items: { $ref: "#/$defs/node" } },
        },
      },
    },
    $ref: "#/$defs/node",
  };
  assert.deepEqual(
    issues(schema, { value: 1, children: [{ value: 2, children: [{ value: 3 }] }] }),
    [],
  );
  assert.deepEqual(
    issues(schema, { value: 1, children: [{ value: 2, children: [{ value: "x" }] }] }),
    ["/children/0/children/0/value:type"],
  );
});

test("names the failing branch of a discriminated union", () => {
  const schema = {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "count"],
        properties: { kind: { const: "a" }, count: { type: "integer" } },
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "name"],
        properties: { kind: { const: "b" }, name: { type: "string" } },
      },
    ],
  };
  // The reported issue is the one inside branch "b", not a generic "no match".
  assert.deepEqual(issues(schema, { kind: "b", name: 42 }), ["/name:type"]);
  assert.deepEqual(issues(schema, { kind: "c" }), ["/kind:oneOf"]);
});

test("plain oneOf requires exactly one match", () => {
  const schema = { oneOf: [{ type: "integer" }, { type: "number" }] };
  assert.deepEqual(issues(schema, 1), [":oneOf"]);
  assert.deepEqual(issues(schema, 1.5), []);
});

test("cross-artifact refs go through the resolver, and are an error without one", () => {
  assert.throws(() => compileSchema({ $ref: "magi/other@v1" }), SchemaCompileError);

  const other = compileSchema({ type: "string", minLength: 2 });
  const seen: string[] = [];
  const schema = compileSchema(
    { type: "array", items: { $ref: "magi/other@v1" } },
    {
      resolveExternal: (ref) => {
        seen.push(ref);
        return other;
      },
    },
  );
  const result = schema.validate(["ok", "x"]);
  assert.ok(!result.ok);
  assert.deepEqual(
    result.issues.map((i) => i.path),
    ["/1"],
  );
  assert.deepEqual(seen, ["magi/other@v1"]);
});

test("entryPointer compiles a subschema while keeping local refs resolvable", () => {
  const document = {
    $defs: {
      id: { type: "string", pattern: "^c[0-9]+$" },
      wrapper: {
        type: "object",
        required: ["id"],
        additionalProperties: false,
        properties: { id: { $ref: "#/$defs/id" } },
      },
    },
  };
  const compiled = compileSchema(document, { entryPointer: "/$defs/wrapper" });
  assert.ok(compiled.validate({ id: "c1" }).ok);
  assert.ok(!compiled.validate({ id: "x1" }).ok);
});

test("assert throws a readable SchemaValidationError", () => {
  const compiled = compileSchema({
    $id: "magi/thing@v1",
    type: "object",
    required: ["a"],
    properties: { a: { type: "integer" } },
    additionalProperties: false,
  });
  assert.throws(
    () => compiled.assert({ b: 1 }),
    (error: unknown) => {
      assert.ok(error instanceof SchemaValidationError);
      assert.match(error.message, /magi\/thing@v1 failed validation/);
      assert.equal(error.issues.length, 2);
      return true;
    },
  );
});

test("formatIssues caps the listing", () => {
  const many = Array.from({ length: 12 }, (_unused, index) => ({
    path: `/x/${index}`,
    keyword: "type",
    message: "must be string",
  }));
  const formatted = formatIssues(many, 3);
  assert.match(formatted, /and 9 more/);
  assert.equal(formatted.split("\n").length, 4);
});
