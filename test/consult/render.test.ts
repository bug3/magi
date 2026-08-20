import assert from "node:assert/strict";
import { test } from "node:test";

import { renderTemplate, templateTokens } from "../../src/consult/render.ts";

const TEMPLATE = "id: {{consult_id}}\n\n{{brief_md}}\n\npack:\n{{evidence_pack_md}}\n";

test("templateTokens reads the token set off the template", () => {
  assert.deepEqual(
    [...templateTokens(TEMPLATE)].sort(),
    ["brief_md", "consult_id", "evidence_pack_md"],
  );
});

test("rendering substitutes every token", () => {
  const out = renderTemplate(TEMPLATE, {
    consult_id: "0002-x",
    brief_md: "the brief",
    evidence_pack_md: "the pack",
  });
  assert.equal(out, "id: 0002-x\n\nthe brief\n\npack:\nthe pack\n");
});

test("a value containing a token survives verbatim: values are never rescanned", () => {
  const out = renderTemplate(TEMPLATE, {
    consult_id: "0002-x",
    brief_md: "quoting {{evidence_pack_md}} inside evidence",
    evidence_pack_md: "code with {{weird}} braces",
  });
  assert.ok(out.includes("quoting {{evidence_pack_md}} inside evidence"));
  assert.ok(out.includes("code with {{weird}} braces"));
});

test("a token without a value refuses to render", () => {
  assert.throws(
    () => renderTemplate(TEMPLATE, { consult_id: "0002-x", brief_md: "b" }),
    /no value for template token \{\{evidence_pack_md\}\}/,
  );
});

test("a value without a token refuses to render", () => {
  assert.throws(
    () =>
      renderTemplate(TEMPLATE, {
        consult_id: "0002-x",
        brief_md: "b",
        evidence_pack_md: "p",
        opinion_schema_json: "{}",
      }),
    /template has no \{\{opinion_schema_json\}\} token/,
  );
});
