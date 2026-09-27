import assert from "node:assert/strict";
import { test } from "node:test";

import type { ExecResult } from "../../src/runtime/exec.ts";
import { probeFailure, probeSucceeded } from "../../src/seats/residue.ts";

function ran(overrides: Partial<ExecResult>): ExecResult {
  return {
    outcome: { kind: "exit", code: 0 },
    stdout: '{"rules":[]}\n',
    stderr: "",
    truncated: false,
    durationMs: 5,
    ...overrides,
  };
}

test("a probe succeeds only when it exits 0 with a whole, non-empty snapshot", () => {
  assert.equal(probeSucceeded(ran({})), true);
  assert.equal(probeSucceeded(ran({ stdout: "  \n" })), false);
  assert.equal(probeSucceeded(ran({ truncated: true })), false);
  assert.equal(probeSucceeded(ran({ outcome: { kind: "exit", code: 2 } })), false);
});

test("a failed probe says what happened in one line", () => {
  const exited = ran({ outcome: { kind: "exit", code: 2 }, stderr: "unknown command\nusage: ..." });
  assert.equal(probeFailure(exited), "exit 2: unknown command");
  assert.equal(probeFailure(ran({ outcome: { kind: "timeout" }, stdout: "" })), "timeout");
  const missing = ran({
    outcome: { kind: "spawn_error", message: "spawn codex ENOENT" },
    stdout: "",
  });
  assert.equal(probeFailure(missing), "spawn_error: spawn codex ENOENT");
  assert.equal(probeFailure(ran({ stdout: "" })), "exit 0, no output");
  assert.equal(
    probeFailure(ran({ truncated: true })),
    "exit 0, a stream cut at the capture ceiling",
  );
});
