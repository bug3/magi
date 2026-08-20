import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// Publication hygiene, asserted over the real tree.
//
// The separation rule: an internal record id is a token that points at a
// document or a past run that does not exist in the published tree. A public
// identifier is one the shipped product uses at runtime. So the bare word
// `consult`, the `.magi` state directory and the `magi/opinion.v1` contract
// tag never match, while that same word followed by a run's four-digit
// ordinal does, and so does a citation of a numbered section.
//
// This comment may not spell one out, which is the point: the catalog is
// walked like every other file, so an example here would be a leak here.
//
// There is no allowlist. An exception list is where the next leak hides, so
// instead every pattern is written to not match its own source text, and this
// file is walked like any other. A pattern that needs an exception is the
// wrong pattern.

interface HygieneRule {
  readonly id: string;
  readonly pattern: RegExp;
  /** What a match would publish. */
  readonly leaks: string;
}

/**
 * Ids are words in prose, never fragments of an encoded blob, so the
 * boundaries exclude the base64 alphabet as well: a lockfile integrity hash
 * must not be able to spell one by accident.
 */
const EDGE = "[A-Za-z0-9_+/=]";

export const RULES: readonly HygieneRule[] = [
  {
    id: "design-doc",
    pattern: /DESIGN[.]md/u,
    leaks: "the internal design document, which does not ship",
  },
  {
    id: "internal-doc",
    pattern: /DISPOSITION[-]PLAN|IMPLEMENTATION[-]NOTES|night[-]report|docs[/]PLAN[.]md/u,
    leaks: "an internal working document, which does not ship",
  },
  {
    id: "section-cite",
    pattern: /\bSection\s+\d+/u,
    leaks: "a numbered section of a document the reader cannot open",
  },
  {
    id: "disposition-id",
    pattern: new RegExp(`(?<!${EDGE})K\\d{1,3}(?!${EDGE})`, "u"),
    leaks: "a decision id from the private disposition record",
  },
  {
    id: "note-id",
    pattern: new RegExp(`(?<!${EDGE})N-\\d{2,3}(?!${EDGE})`, "u"),
    leaks: "a row id from the private implementation notes",
  },
  {
    id: "consult-citation",
    pattern: /consults?[\s#-]{0,2}\d{4}/iu,
    leaks: "a past council run by its ordinal, whose record stays private",
  },
  {
    id: "finding-id",
    pattern: new RegExp(`(?<!${EDGE})[MBC]-F\\d{1,3}(?!${EDGE})`, "u"),
    leaks: "a seat finding id from a private consult record",
  },
  {
    id: "predecessor-ref",
    // A version token bound to an identifier is public: the contract tag and
    // the schema filename both carry one. A bare one in prose points at a
    // predecessor that does not exist in the published tree, so what
    // separates them is what precedes the token.
    pattern: /(?<![.@\w/])v[12]\b/u,
    leaks: "a version of this project that was never published",
  },
  {
    id: "home-path",
    pattern: /[/](home|Users)[/][A-Za-z0-9._-]+/u,
    leaks: "an absolute path naming an account on the machine that built this",
  },
  {
    id: "windows-profile",
    pattern: /[A-Z]:[\\]{1,2}Users/u,
    leaks: "an absolute path naming an account on the machine that built this",
  },
  {
    id: "address",
    // A routable address only. The reserved documentation domains exist so
    // examples and test fixtures can name one without naming a person, and a
    // rule that flagged them would be a rule with an exception list.
    pattern:
      /[A-Za-z0-9._%+-]+@(?![A-Za-z0-9.-]*\.(?:invalid|test|example|localhost)\b)(?!example\.(?:com|net|org)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u,
    leaks: "a personal mail address",
  },
];

/**
 * Sharper patterns drawn from the owner's own machine cannot live here: the
 * catalog ships, so a literal username or private phrase in it would publish
 * exactly what it defends. They live in `<magiDir>/hygiene.local.json`,
 * gitignored with the rest of the state directory, in the same shape the
 * canary layer already uses. Absent, the public catalog stands alone.
 */
function localRules(): readonly HygieneRule[] {
  const path = join(".magi", "hygiene.local.json");
  if (!existsSync(path)) return [];
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${path} must hold an array of rules`);
  return parsed.map((entry: unknown, at: number): HygieneRule => {
    const { id, pattern, flags, leaks } = entry as Record<string, unknown>;
    if (typeof id !== "string" || typeof pattern !== "string" || typeof leaks !== "string") {
      throw new Error(`${path}[${at}] needs string id, pattern and leaks fields`);
    }
    return { id, pattern: new RegExp(pattern, typeof flags === "string" ? flags : "u"), leaks };
  });
}

/**
 * Directories the published tree never contains: version control, installed
 * dependencies, the harness's own scratch, and the runtime state directory.
 * This is scope, not exception: nothing here is publishable at all, and the
 * gitignore assertion below is what keeps that true.
 */
const OUTSIDE_THE_TREE = [".git", ".claude", ".magi", "node_modules"];

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (OUTSIDE_THE_TREE.includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function hitsIn(path: string, rules: readonly HygieneRule[]): string[] {
  const text = readFileSync(path, "utf8");
  // Fail closed: a file the walk cannot read as text is not one it cleared.
  assert.ok(!text.includes("\u0000"), `${path} is not text and cannot be checked`);
  const hits: string[] = [];
  for (const rule of rules) {
    if (rule.pattern.test(path)) hits.push(`${path}: path carries ${rule.id} (${rule.leaks})`);
    const match = rule.pattern.exec(text);
    if (match) hits.push(`${path}:${lineOf(text, match.index)}: ${rule.id} (${rule.leaks})`);
  }
  return hits;
}

test("the runtime state directory is ignored, so skipping it is not an exception", () => {
  assert.match(readFileSync(".gitignore", "utf8"), /^[.]magi[/]$/mu);
});

test("no publishable file carries an internal record id or a machine path", () => {
  const files = filesUnder(".");
  // A walk that finds nothing would pass every assertion below it.
  assert.ok(files.length >= 100, `only ${files.length} files walked: the walk is broken`);
  assert.ok(files.includes("package.json"), "the walk missed the repository root");

  const rules = [...RULES, ...localRules()];
  const hits = files.flatMap((path) => hitsIn(path, rules));
  assert.deepEqual(hits, [], `\n${hits.join("\n")}\n`);
});

test("every rule refuses the identifiers the product itself uses", () => {
  const PUBLIC = [
    "magi/opinion.v1",
    "schemas/opinion.v1.schema.json",
    "src/consult/run.ts",
    "magi consult",
    ".magi/consults/",
    "npm run check",
    "2026-08-20",
  ];
  for (const rule of RULES) {
    for (const identifier of PUBLIC) {
      assert.ok(
        !rule.pattern.test(identifier),
        `${rule.id} matches the public identifier ${identifier}`,
      );
    }
  }
});

test("no pattern matches this file, so the catalog is scanned like any other", () => {
  // A pattern written as the thing it forbids would exclude its own catalog
  // from the walk, and an unscanned catalog is the one place a leak could sit
  // forever. Every pattern is written so its source text does not match it.
  const source = readFileSync(join("test", "spec", "release-hygiene.test.ts"), "utf8");
  const matched = RULES.filter((rule) => rule.pattern.test(source)).map((rule) => rule.id);
  assert.deepEqual(matched, [], "a rule that matches its own catalog hides the catalog");
});

// Source comments point at the protocol by heading name and never by number,
// because a numbered citation rots the moment a section moves. A name only
// helps while it resolves, so every reference is checked against the real
// document.
const ANCHOR = /`docs\/protocol\.md`,\s*"([^"]+)"/gu;

function commentReferences(path: string): string[] {
  // Comment continuations are joined first: a reference that wrapped across
  // two lines is still one reference.
  const flat = readFileSync(path, "utf8").replace(/\n[ \t]*(?:\*|\/\/)[ \t]?/gu, " ");
  return [...flat.matchAll(ANCHOR)].map((match) => match[1] as string);
}

test("every protocol reference in the tree resolves to a real heading", () => {
  const headings = new Set(
    [...readFileSync(join("docs", "protocol.md"), "utf8").matchAll(/^#{2,}\s+(.+)$/gmu)].map(
      (match) => (match[1] as string).trim(),
    ),
  );
  const sources = filesUnder("src").concat(filesUnder("test"));
  const dangling = sources
    .flatMap((path) => commentReferences(path).map((heading) => ({ path, heading })))
    .filter((reference) => !headings.has(reference.heading))
    .map((reference) => `${reference.path} points at a missing heading: "${reference.heading}"`);

  assert.deepEqual(dangling, []);
});
