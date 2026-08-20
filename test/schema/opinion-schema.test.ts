import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { compileSchema, type JsonValue } from "../../src/schema/validator.ts";

// The one contract every council seat's answer must validate against, so
// three harnesses normalize onto one structured schema.
//
// Two rules are asserted over the real file rather than a copy:
//
// 1. Compilation must succeed. The validator is fail closed, so a schema that
//    reaches for a keyword it does not implement is a compile error, never a
//    silently dropped constraint. Compiling here is what keeps the shipped
//    contract inside the subset.
// 2. The schema is flat: no $ref, no $defs. JSON carries no comments, so the
//    rationale lives here. The same file is handed verbatim to
//    `codex --output-schema` and `grok --json-schema`, whose $ref support is
//    unverified; inline nesting is the only shape all three enforcement paths
//    (this validator plus the two harnesses) are known to share.
const SCHEMA_PATH = join("schemas", "opinion.v1.schema.json");
const FIXTURES = join("fixtures", "opinion");

function readJson(path: string): JsonValue {
  return JSON.parse(readFileSync(path, "utf8")) as JsonValue;
}

function fixture(name: string): JsonValue {
  return readJson(join(FIXTURES, `${name}.json`));
}

const schemaDocument = readJson(SCHEMA_PATH);
const compiled = compileSchema(schemaDocument);

const VALID_FIXTURES = ["valid-review-full", "valid-plan-minimal"] as const;

// Each rejection names the path and keyword the validator reports, so a bound
// that quietly stops being enforced fails here instead of passing in silence.
const INVALID_FIXTURES: ReadonlyArray<{
  readonly name: string;
  readonly path: string;
  readonly keyword: string;
}> = [
  { name: "invalid-unknown-top-level-field", path: "/notes", keyword: "additionalProperties" },
  {
    name: "invalid-unknown-finding-field",
    path: "/findings/0/evidence",
    keyword: "additionalProperties",
  },
  { name: "invalid-missing-citations", path: "/findings/0", keyword: "required" },
  { name: "invalid-bad-severity", path: "/findings/0/severity", keyword: "enum" },
  { name: "invalid-confidence-out-of-range", path: "/confidence", keyword: "maximum" },
  { name: "invalid-wrong-schema-tag", path: "/schema", keyword: "enum" },
  { name: "invalid-blank-check", path: "/findings/0/check", keyword: "minLength" },
  { name: "invalid-bad-citation-id-format", path: "/findings/0/citations/0", keyword: "pattern" },
];

test("the opinion schema compiles under the fail-closed validator", () => {
  // compileSchema above already threw if it could not; assert the surface too.
  assert.ok(compiled.validate({}).ok === false);
});

test("the opinion schema stays flat: no $ref and no $defs", () => {
  const source = readFileSync(SCHEMA_PATH, "utf8");
  assert.ok(!source.includes('"$ref"'), "opinion schema must not use $ref");
  assert.ok(!source.includes('"$defs"'), "opinion schema must not use $defs");
});

test("every valid opinion fixture is accepted", () => {
  for (const name of VALID_FIXTURES) {
    const result = compiled.validate(fixture(name));
    assert.ok(
      result.ok,
      `${name} must validate; issues: ${result.ok ? "" : JSON.stringify(result.issues)}`,
    );
  }
});

test("every invalid opinion fixture is rejected at the expected path and keyword", () => {
  for (const { name, path, keyword } of INVALID_FIXTURES) {
    const result = compiled.validate(fixture(name));
    assert.ok(!result.ok, `${name} must be rejected`);
    if (result.ok) continue;
    assert.ok(
      result.issues.some((issue) => issue.path === path && issue.keyword === keyword),
      `${name} must report ${keyword} at "${path}"; got ${JSON.stringify(result.issues)}`,
    );
  }
});

test("the contract tag is required, not merely checked when present", () => {
  const document = fixture("valid-plan-minimal") as Record<string, JsonValue>;
  delete document["schema"];
  const result = compiled.validate(document);
  assert.ok(!result.ok);
  if (result.ok) return;
  assert.ok(
    result.issues.some((issue) => issue.path === "" && issue.keyword === "required"),
    `a tagless document must be rejected; got ${JSON.stringify(result.issues)}`,
  );
});
