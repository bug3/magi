import assert from "node:assert/strict";
import { test } from "node:test";

import { exec, tryCapture } from "../../src/runtime/exec.ts";

test("a successful command reports a typed exit outcome", async () => {
  const result = await exec({ argv: ["/bin/sh", "-c", "printf hello"] });
  assert.deepEqual(result.outcome, { kind: "exit", code: 0 });
  assert.equal(result.stdout, "hello");
});

test("a nonzero exit stays an exit outcome, distinct from could-not-run", async () => {
  const result = await exec({ argv: ["/bin/sh", "-c", "echo boom >&2; exit 3"] });
  assert.deepEqual(result.outcome, { kind: "exit", code: 3 });
  assert.match(result.stderr, /boom/);
});

test("a missing binary is a spawn error, never an exit outcome", async () => {
  const result = await exec({ argv: ["/nonexistent/binary-for-tests"] });
  assert.equal(result.outcome.kind, "spawn_error");
});

test("a child killed by a signal reports the signal, not an exit code", async () => {
  const result = await exec({ argv: ["/bin/sh", "-c", "kill -TERM $$"] });
  assert.deepEqual(result.outcome, { kind: "signal", signal: "SIGTERM" });
});

test("stdin carries the prompt, so it never appears in /proc/<pid>/cmdline", async () => {
  const result = await exec({ argv: ["/bin/cat"], stdin: "a secret prompt\n" });
  assert.equal(result.stdout, "a secret prompt\n");
});

test("a timeout kills the whole process group and reports a timeout", async () => {
  const started = Date.now();
  const result = await exec({
    // The shell waits on a background child: only a group-wide signal ends this.
    argv: ["/bin/sh", "-c", "sleep 30 & wait"],
    timeoutMs: 300,
    killGraceMs: 200,
  });
  assert.equal(result.outcome.kind, "timeout");
  assert.ok(Date.now() - started < 10_000, "the timeout must not wait for the child to finish");
});

test("cancellation is distinguishable from a timeout", async () => {
  const controller = new AbortController();
  const pending = exec({
    argv: ["/bin/sh", "-c", "sleep 30"],
    signal: controller.signal,
    killGraceMs: 200,
  });
  controller.abort();
  const result = await pending;
  assert.equal(result.outcome.kind, "cancelled");
});

test("a signal already aborted before the call cancels without spawning", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await exec({
    // A command that would take far longer than this test: it must never run.
    argv: ["/bin/sh", "-c", "sleep 30"],
    signal: controller.signal,
  });
  assert.equal(result.outcome.kind, "cancelled");
  assert.equal(result.durationMs, 0);
});

test("output is capped and the truncation is reported, never silent", async () => {
  const result = await exec({
    argv: ["/bin/sh", "-c", "for i in $(seq 1 2000); do echo 0123456789; done"],
    maxOutputBytes: 1024,
  });
  assert.ok(result.stdout.length <= 1024);
  assert.equal(result.truncated, true);
});

test("the child environment is exactly what was passed", async () => {
  const result = await exec({ argv: ["/usr/bin/env"], env: { ONLY: "this" } });
  const names = result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("=")[0])
    // Node propagates NODE_V8_COVERAGE to children when coverage is on; it
    // never reaches a jailed session, which is built with --clearenv.
    .filter((name) => name !== "NODE_V8_COVERAGE");
  assert.deepEqual(names.sort(), ["ONLY"]);
});

test("tryCapture returns trimmed stdout on success and nothing otherwise", async () => {
  assert.equal(await tryCapture(["/bin/sh", "-c", "printf ' hi \n'"], 5_000), "hi");
  assert.equal(await tryCapture(["/bin/sh", "-c", "exit 1"], 5_000), undefined);
});
