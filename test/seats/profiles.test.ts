import assert from "node:assert/strict";
import { test } from "node:test";

import { SLOTS } from "../../src/core/slots.ts";
import { SEAT_PINS } from "../../src/seats/pins.ts";
import { type SeatInputs, seatProfile } from "../../src/seats/profiles.ts";

const INPUTS: SeatInputs = {
  briefPath: "/consults/0001/brief.md",
  schemaPath: "/magi/schema/opinion.json",
  schemaJson: '{"type":"object"}',
  repoDir: "/work/target-repo",
  home: "/work/home",
  path: "/usr/local/bin:/usr/bin",
};

// The manifest records the launch verbatim, so the render is asserted whole:
// a flag that silently appears or disappears is a different experiment.
test("melchior renders the exact claude argv", () => {
  assert.deepEqual(seatProfile("melchior-1", INPUTS).args, [
    "--safe-mode",
    "-p",
    "--output-format",
    "json",
    "--tools",
    "",
    "--disallowed-tools",
    "Bash,WebFetch,WebSearch",
  ]);
});

test("balthasar renders the exact codex argv and omits the model flag", () => {
  const profile = seatProfile("balthasar-2", INPUTS);
  assert.deepEqual(profile.args, [
    "exec",
    "--ignore-user-config",
    "--ignore-rules",
    "--ephemeral",
    "--strict-config",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--json",
    "--output-schema",
    "/magi/schema/opinion.json",
    "-C",
    "/work/target-repo",
    "-c",
    "project_doc_max_bytes=0",
    "-c",
    "tools.web_search=false",
  ]);
  assert.equal(SEAT_PINS["balthasar-2"].model, undefined);
  assert.equal(profile.args.includes("--model"), false);
});

test("casper renders the exact grok argv", () => {
  assert.deepEqual(seatProfile("casper-3", INPUTS).args, [
    "--prompt-file",
    "/consults/0001/brief.md",
    "--verbatim",
    "--json-schema",
    '{"type":"object"}',
    "--sandbox",
    "read-only",
    "--permission-mode",
    "plan",
    "--disable-web-search",
    "--no-subagents",
    "--max-turns",
    "8",
    "--model",
    "grok-4.6",
    "--reasoning-effort",
    "high",
  ]);
});

test("every profile records whether model and effort are pinned or CLI defaults", () => {
  assert.deepEqual(seatProfile("melchior-1", INPUTS).model, { kind: "cli-default" });
  assert.deepEqual(seatProfile("balthasar-2", INPUTS).model, { kind: "cli-default" });
  assert.deepEqual(seatProfile("casper-3", INPUTS).model, {
    kind: "pinned",
    value: "grok-4.6",
  });
  assert.deepEqual(seatProfile("casper-3", INPUTS).reasoningEffort, {
    kind: "pinned",
    value: "high",
  });
});

test("each profile runs its own harness and reports its own slot", () => {
  for (const { id, harness } of SLOTS) {
    const profile = seatProfile(id, INPUTS);
    assert.equal(profile.slot, id);
    assert.equal(profile.command, harness);
  }
});

const DENY_FLAGS = new Set(["--disallowed-tools", "--disallowedTools", "--deny"]);

test("Bash, WebFetch and WebSearch are only ever named to deny them", () => {
  for (const { id } of SLOTS) {
    const args = seatProfile(id, INPUTS).args;
    args.forEach((arg, index) => {
      if (!/\b(?:Bash|WebFetch|WebSearch)\b/.test(arg)) return;
      const flag = args[index - 1] ?? "";
      assert.ok(DENY_FLAGS.has(flag), `${id} names a banned tool under ${flag || "no flag"}`);
    });
  }
});

// Nothing is inherited implicitly: the child env is the declared set exactly.
test("every profile env is exactly HOME and PATH plus its declared additions", () => {
  const expected: Record<string, readonly string[]> = {
    "melchior-1": ["HOME", "PATH"],
    "balthasar-2": ["HOME", "PATH"],
    "casper-3": ["HOME", "PATH", "GROK_MEMORY"],
  };
  for (const { id } of SLOTS) {
    const { env } = seatProfile(id, INPUTS);
    assert.deepEqual(Object.keys(env).sort(), [...(expected[id] ?? [])].sort());
    assert.equal(env["HOME"], INPUTS.home);
    assert.equal(env["PATH"], INPUTS.path);
  }
});

test("grok carries GROK_MEMORY=0, the replacement for the removed --no-memory", () => {
  assert.equal(seatProfile("casper-3", INPUTS).env["GROK_MEMORY"], "0");
});

test("the prompt travels by stdin except for grok, which takes a file path", () => {
  assert.equal(seatProfile("melchior-1", INPUTS).promptVia, "stdin");
  assert.equal(seatProfile("balthasar-2", INPUTS).promptVia, "stdin");
  assert.equal(seatProfile("casper-3", INPUTS).promptVia, "prompt-file");
});

test("only the prompt-file seat names the brief in its argv", () => {
  assert.equal(seatProfile("casper-3", INPUTS).args.includes(INPUTS.briefPath), true);
  assert.equal(seatProfile("melchior-1", INPUTS).args.includes(INPUTS.briefPath), false);
  assert.equal(seatProfile("balthasar-2", INPUTS).args.includes(INPUTS.briefPath), false);
});

test("rendering is pure: the same inputs give the same argv", () => {
  for (const { id } of SLOTS) {
    assert.deepEqual(seatProfile(id, INPUTS).args, seatProfile(id, INPUTS).args);
  }
});

test("only casper declares a residue probe, and it is grok inspect --json", () => {
  for (const definition of SLOTS) {
    const profile = seatProfile(definition.id, INPUTS);
    if (definition.id === "casper-3") {
      assert.deepEqual(profile.residueProbe, ["grok", "inspect", "--json"]);
    } else {
      assert.equal(profile.residueProbe, undefined);
    }
  }
});

test("every seat gets a wall-clock cap", () => {
  for (const { id } of SLOTS) {
    assert.ok(seatProfile(id, INPUTS).timeoutMs > 0);
  }
});
