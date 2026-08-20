import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// The seat-brief templates MAGI renders per consult.
// Prompts live as markdown templates, never string-assembled in code, so the
// rules that make a seat answerable are asserted over the real files.
const TEMPLATES = ["review", "plan"] as const;

// Every token the renderer substitutes. Each must appear exactly once per
// template: a missing token silently drops context, a duplicated one would
// send the same block twice.
const PLACEHOLDERS = [
  "{{consult_id}}",
  "{{brief_md}}",
  "{{evidence_pack_md}}",
  "{{opinion_schema_json}}",
] as const;

// The rules whose wording the templates are held to. Chosen as stable
// phrases: rewording the surrounding prose is fine, dropping the rule is not.
const REQUIRED_PHRASES: Readonly<Record<(typeof TEMPLATES)[number], readonly string[]>> = {
  // The evidence rule, plus the framing that a finding is offered for
  // testing and never handed down. The single-turn rule exists because a
  // real seat once answered "reading the brief first" as its whole opinion;
  // the bare-command rule because another mixed prose into check fields.
  review: [
    "resolve inside the evidence pack",
    "a claim, not a fact",
    "This is your only turn",
    "one bare command and nothing else",
  ],
  // Evidence rule, plus the keep-list the orchestrator checks the diff against.
  plan: [
    "resolve inside the evidence pack",
    "keep-list",
    "must not change",
    "This is your only turn",
    "one bare command and nothing else",
  ],
};

// Repo prose style: ASCII hyphen only, never an em dash or an en dash.
const DASHES: ReadonlyArray<{ char: string; name: string }> = [
  { char: "—", name: "em dash" },
  { char: "–", name: "en dash" },
];

function templatePath(name: string): string {
  return join("prompts", `${name}.md`);
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// A required phrase is a rule, not a line: the templates are hard-wrapped, so
// a phrase may straddle a newline. Compare on whitespace-collapsed text.
function unwrapped(body: string): string {
  return body.replace(/\s+/g, " ");
}

test("every seat-brief template file exists", () => {
  for (const name of TEMPLATES) {
    const path = templatePath(name);
    assert.ok(existsSync(path), `${path} is missing`);
  }
});

test("every seat-brief template carries each placeholder exactly once", () => {
  for (const name of TEMPLATES) {
    const path = templatePath(name);
    const body = readFileSync(path, "utf8");
    for (const placeholder of PLACEHOLDERS) {
      assert.equal(
        occurrences(body, placeholder),
        1,
        `${path} must contain ${placeholder} exactly once`,
      );
    }
  }
});

test("every seat-brief template states the rules it is held to", () => {
  for (const name of TEMPLATES) {
    const path = templatePath(name);
    const body = unwrapped(readFileSync(path, "utf8"));
    for (const phrase of REQUIRED_PHRASES[name]) {
      assert.ok(
        body.includes(phrase),
        `${path} must state the rule phrased "${phrase}"`,
      );
    }
  }
});

test("no seat-brief template uses an em dash or an en dash", () => {
  for (const name of TEMPLATES) {
    const path = templatePath(name);
    const body = readFileSync(path, "utf8");
    for (const { char, name: dashName } of DASHES) {
      assert.equal(
        occurrences(body, char),
        0,
        `${path} uses an ${dashName}; this repo uses the ASCII hyphen`,
      );
    }
  }
});
