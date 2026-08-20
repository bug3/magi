/**
 * The recorded-shape Codex fixtures, read by the real parser.
 *
 * One question underneath every one of them: given these bytes, what did the
 * seat say? The seam is `parseCodexOutput`, so a claim here fails for exactly
 * one reason. The fixtures live as files rather than strings built in a test,
 * and `fixtures/adapters/codex/README.md` is their header; the last two tests
 * keep that header honest.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { parseCodexOutput } from "../../src/adapters/codex.ts";
import type { ParseResult } from "../../src/adapters/types.ts";

const FIXTURE_DIR = join("fixtures", "adapters", "codex");

function fixtureText(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf8");
}

interface FixtureCase {
  readonly file: string;
  /** The test name, and the words the README must name as this file's claim. */
  readonly claim: string;
  check(parsed: ParseResult): void;
}

const CASES: readonly FixtureCase[] = [
  {
    file: "golden-success.ndjson",
    claim: "the golden-shape stream is read as one completed session",
    check: (parsed) => {
      assert.equal(parsed.ok, true);
      assert.equal(
        parsed.ok && parsed.message,
        "added the retry policy",
        "the answer is an agent_message item, never the command output beside it",
      );
      assert.deepEqual(parsed.usage, {
        inputTokens: 8000,
        outputTokens: 640,
        cachedInputTokens: 2000,
      });
      assert.deepEqual(parsed.signals, ["completed"]);
    },
  },
  {
    file: "split-frame.ndjson",
    claim: "a frame split across lines is dropped, and the whole frames around it still read",
    check: (parsed) => {
      assert.equal(parsed.ok, true);
      assert.equal(parsed.ok && parsed.message, "kept the split frame as bytes");
      assert.deepEqual(parsed.usage, { inputTokens: 1200, outputTokens: 90 });
      assert.deepEqual(
        parsed.signals,
        ["completed"],
        "the halves are bytes, so nothing about them is read as an event",
      );
    },
  },
  {
    file: "missing-usage.ndjson",
    claim: "a turn that reported no usage yields no usage, never zeros",
    check: (parsed) => {
      assert.equal(parsed.ok, true, "reporting no usage is not a failure");
      assert.equal(parsed.ok && parsed.message, "done");
      assert.equal(parsed.usage, undefined, "an absent measurement is absent");
      assert.deepEqual(parsed.signals, ["completed"]);
    },
  },
  {
    file: "nonzero-exit-after-turn.ndjson",
    claim: "a command the session ran exiting nonzero is not the session reporting an error",
    check: (parsed) => {
      assert.equal(parsed.ok, true);
      assert.equal(parsed.ok && parsed.message, "the retry test still fails");
      assert.equal(parsed.usage?.outputTokens, 220);
      assert.deepEqual(parsed.signals, ["completed"]);
    },
  },
  {
    file: "error-event.ndjson",
    claim: "an error event fails a session whose turn completed",
    check: (parsed) => {
      assert.equal(parsed.ok, false, "the seat left no agent message behind");
      assert.equal(!parsed.ok && parsed.reason, "no-final-message");
      assert.deepEqual(
        parsed.signals,
        ["completed", "error"],
        "it still reached a conclusion of its own, and reported a failure inside it",
      );
    },
  },
  {
    file: "turn-failed.ndjson",
    claim: "a failed turn is the session's own failure, not an outage",
    check: (parsed) => {
      assert.equal(parsed.ok, false);
      assert.equal(!parsed.ok && parsed.reason, "no-final-message");
      assert.deepEqual(
        parsed.signals,
        ["error"],
        "no turn completed, so the outage rule did look at the nested text and refused it",
      );
      assert.equal(parsed.usage, undefined);
    },
  },
  {
    file: "truncated-frames.ndjson",
    claim: "a stream of truncated frames is never read as a finished session",
    check: (parsed) => {
      assert.equal(parsed.ok, false);
      assert.equal(!parsed.ok && parsed.reason, "not-json");
      assert.deepEqual(parsed.signals, undefined, "nothing is invented in either direction");
      assert.equal(parsed.usage, undefined);
    },
  },
];

for (const { file, claim, check } of CASES) {
  test(claim, () => {
    check(parseCodexOutput(fixtureText(file)));
  });
}

test("an outage that ends a turn before it completes is the one retryable class", () => {
  // No fixture: this is the shape a real outage would take, and the rule that
  // separates it from turn-failed.ndjson is the one being asserted.
  const parsed = parseCodexOutput(
    [
      JSON.stringify({ type: "thread.started", thread_id: "th_outage" }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({ type: "turn.failed", error: { message: "429 rate limited upstream" } }),
    ].join("\n"),
  );
  assert.deepEqual(parsed.signals, ["error", "provider-trouble"]);
});

test("a human-readable codex log is a typed failure, not a crash", () => {
  // A real capture: prose with a header block, and not one line of NDJSON.
  const log = readFileSync(join("fixtures", "seat-capture", "balthasar-plain-log.log"), "utf8");
  const parsed = parseCodexOutput(log);
  assert.equal(parsed.ok, false);
  assert.equal(!parsed.ok && parsed.reason, "not-json");
});

test("every fixture on disk is driven through the parser by a claim above", () => {
  const onDisk = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".ndjson"));
  assert.deepEqual(
    onDisk.sort(),
    CASES.map((fixture) => fixture.file).sort(),
    "an unread fixture is dead code, and an unwritten one is a claim with nothing under it",
  );
});

test("every fixture states in the README why it parses that way, and names its claim", () => {
  const sections = new Map<string, string>();
  for (const section of fixtureText("README.md").split(/^### /mu).slice(1)) {
    sections.set(section.split("\n")[0]?.trim() ?? "", section);
  }

  assert.deepEqual(
    [...sections.keys()].sort(),
    CASES.map((fixture) => fixture.file).sort(),
    "the README documents these fixtures and no others",
  );
  for (const { file, claim } of CASES) {
    assert.ok(
      (sections.get(file) ?? "").includes(`Claim: \`${claim}\``),
      `${file} must name the test that covers it, word for word`,
    );
  }
});
