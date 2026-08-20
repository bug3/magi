/**
 * Fan-out guards. Every seat here is the stub CLI under fixtures/seats: the
 * runner is never allowed to reach a live harness from a test, and every
 * timeout stays in the tens of ms so the suite stays fast.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

import type { SeatProfile } from "../../src/core/profile.ts";
import type { SlotId } from "../../src/core/slots.ts";
import { type SeatCall, runSeats } from "../../src/seats/runner.ts";

const STUB = resolve("fixtures", "seats", "stub-seat.mjs");
const NODE = resolve(process.argv[0] ?? "node");

interface StubOptions {
  readonly slot?: SlotId;
  readonly promptVia?: "stdin" | "prompt-file";
  readonly timeoutMs?: number;
  readonly args?: readonly string[];
  readonly command?: string;
}

function stubProfile(options: StubOptions = {}): SeatProfile {
  return {
    slot: options.slot ?? "melchior-1",
    command: options.command ?? NODE,
    args: [STUB, ...(options.args ?? ["--payload", "ok"])],
    env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin" },
    promptVia: options.promptVia ?? "stdin",
    model: { kind: "cli-default" },
    reasoningEffort: { kind: "cli-default" },
    timeoutMs: options.timeoutMs ?? 5_000,
  };
}

function call(options: StubOptions = {}, brief = "the brief"): SeatCall {
  return { profile: stubProfile(options), brief };
}

test("a stdin seat receives the brief on stdin, a prompt-file seat receives none", async () => {
  const runs = await runSeats({
    seats: [
      call({ slot: "melchior-1", promptVia: "stdin", args: ["--echo-stdin"] }, "BRIEF-BODY"),
      call({ slot: "casper-3", promptVia: "prompt-file", args: ["--echo-stdin"] }, "BRIEF-BODY"),
    ],
    staggerMs: 0,
  });

  assert.equal(runs[0]?.result.stdout, "stdin:BRIEF-BODY\n");
  // The prompt path is already inside argv; a stdin write here would be a
  // second, divergent copy of the brief.
  assert.equal(runs[1]?.result.stdout, "stdin:\n");
});

test("the launch stagger spaces the spawns in order without extending any seat's timeout", async () => {
  const staggerMs = 120;
  const runs = await runSeats({
    seats: [
      call({ slot: "melchior-1" }),
      call({ slot: "balthasar-2" }),
      call({ slot: "casper-3", timeoutMs: 400, args: ["--sleep-ms", "250", "--payload", "late"] }),
    ],
    staggerMs,
  });

  const offsets = runs.map((run) => run.startedAtMs);
  assert.ok((offsets[1] ?? 0) - (offsets[0] ?? 0) >= staggerMs / 2, `offsets: ${offsets.join(",")}`);
  assert.ok((offsets[2] ?? 0) - (offsets[1] ?? 0) >= staggerMs / 2, `offsets: ${offsets.join(",")}`);
  // The last seat sleeps longer than its own start offset: if the stagger ate
  // into its timeout budget it would come back as a timeout instead.
  assert.deepEqual(runs[2]?.result.outcome, { kind: "exit", code: 0 });
  assert.equal(runs[2]?.result.stdout, "late\n");
});

test("a seat over its timeout comes back as a timeout while its siblings succeed", async () => {
  const runs = await runSeats({
    seats: [
      call({ slot: "melchior-1" }),
      call({ slot: "balthasar-2", timeoutMs: 120, args: ["--sleep-ms", "5000"] }),
      call({ slot: "casper-3", promptVia: "prompt-file" }),
    ],
    staggerMs: 0,
  });

  assert.deepEqual(runs[0]?.result.outcome, { kind: "exit", code: 0 });
  assert.equal(runs[1]?.result.outcome.kind, "timeout");
  assert.equal(runs[1]?.retried, false);
  assert.deepEqual(runs[2]?.result.outcome, { kind: "exit", code: 0 });
});

test("a seat that never started is retried exactly once and marked retried", async () => {
  const runs = await runSeats({
    seats: [call({ slot: "melchior-1", command: "/nonexistent/magi-stub-seat" })],
    staggerMs: 0,
  });

  assert.equal(runs[0]?.result.outcome.kind, "spawn_error");
  assert.equal(runs[0]?.retried, true);
});

test("a seat that started and exited nonzero is not retried", async () => {
  const dir = mkdtempSync(join(process.cwd(), ".magi-runner-test-"));
  const ledger = join(dir, "attempts");
  writeFileSync(ledger, "");
  try {
    const runs = await runSeats({
      seats: [
        call({
          slot: "balthasar-2",
          args: ["--record", ledger, "--exit-code", "3", "--payload", "boom"],
        }),
      ],
      staggerMs: 0,
    });

    assert.deepEqual(runs[0]?.result.outcome, { kind: "exit", code: 3 });
    assert.equal(runs[0]?.retried, false);
    // A nonzero exit is a result the seat produced: rerunning it would spend a
    // second subscription call on the same answer.
    assert.equal(readFileSync(ledger, "utf8"), "run\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("results come back in input order whatever order the seats finished in", async () => {
  const runs = await runSeats({
    seats: [
      call({ slot: "melchior-1", args: ["--sleep-ms", "150", "--payload", "first"] }),
      call({ slot: "balthasar-2", args: ["--sleep-ms", "60", "--payload", "second"] }),
      call({ slot: "casper-3", args: ["--payload", "third"] }),
    ],
    staggerMs: 0,
  });

  assert.deepEqual(
    runs.map((run) => run.slot),
    ["melchior-1", "balthasar-2", "casper-3"],
  );
  assert.deepEqual(
    runs.map((run) => run.result.stdout),
    ["first\n", "second\n", "third\n"],
  );
  assert.deepEqual(runs[0]?.argv, [NODE, STUB, "--sleep-ms", "150", "--payload", "first"]);
});

test("an abort cancels the seats that have not finished, stagger included", async () => {
  const controller = new AbortController();
  const pending = runSeats({
    seats: [
      call({ slot: "melchior-1", args: ["--sleep-ms", "5000"] }),
      call({ slot: "balthasar-2", args: ["--sleep-ms", "5000"] }),
      // Staggered far past the abort: it must not sit out its own stagger.
      call({ slot: "casper-3", args: ["--sleep-ms", "5000"] }),
    ],
    staggerMs: 2_000,
    signal: controller.signal,
  });

  await new Promise<void>((resolvePromise) => setTimeout(() => resolvePromise(), 80));
  controller.abort();
  const runs = await pending;

  assert.deepEqual(
    runs.map((run) => run.result.outcome.kind),
    ["cancelled", "cancelled", "cancelled"],
  );
  assert.equal(
    runs.every((run) => run.retried === false),
    true,
  );
});
