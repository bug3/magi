/**
 * The exit code an interrupted wait reports.
 *
 * This is the whole reason MAGI shipped 0.6.0 without a progress spinner. The
 * renderer draws one by seizing the terminal: raw mode, its own keypress
 * reader, and `process.exit(0)` on the cancel key. Exit 0 is this tool's word
 * for "the command did its job", so a fan-out interrupted halfway through,
 * with nothing gated and nothing in the ledger, reported success. The hazard
 * was real. The conclusion, that the spinner had to go, was not: a handler on
 * `process.on("exit")` runs after `process.exit(0)` has set the code and can
 * still overwrite it.
 *
 * So the claim is measured here rather than argued, and it is measured the
 * only way it can be: in a process that really exits. Nothing in-process can
 * assert what a process exited with.
 *
 * The child needs no terminal. It hands the writer a sink that says it is one,
 * which is exactly what the writer asks, so this runs the same on a build
 * agent as on a laptop.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const WRITER = pathToFileURL(resolve("src", "util", "ui.ts")).href;

/**
 * A process that opens a wait and then exits the way the cancel key does.
 *
 * `close` decides whether the wait is closed first, which is the difference
 * between an interrupt and an ordinary finish; `code` is what the process asks
 * to exit with.
 */
function child(options: { readonly close: boolean; readonly code: number }): string {
  return [
    `import { Writable } from "node:stream";`,
    `import { announce, setStreams } from ${JSON.stringify(WRITER)};`,
    // A build agent's terminal is a pipe to the writer, and this suite may run
    // on one. The child is asked about a terminal, so it must not be in CI.
    `delete process.env.CI;`,
    `const sink = Object.assign(new Writable({ write(chunk, encoding, done) { done(); } }),`,
    `  { isTTY: true, columns: 80, rows: 24 });`,
    `setStreams({ out: sink, err: sink });`,
    `const wait = announce("convening 3 seats, blind and in parallel");`,
    options.close ? `wait.done("3 seats answered");` : `// interrupted with the wait still open`,
    // What the renderer's cancel key does, from inside its own keypress
    // handler, before anything else gets to run.
    `process.exit(${String(options.code)});`,
  ].join("\n");
}

async function exitCodeOf(source: string): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), "magi-wait-"));
  try {
    const script = join(dir, "wait.mjs");
    writeFileSync(script, `${source}\n`);
    const run = spawn(process.execPath, [script], { stdio: "ignore", timeout: 20_000 });
    return await new Promise<number>((settle, fail) => {
      run.on("error", fail);
      run.on("close", (code, signal) => {
        if (code === null) fail(new Error(`the child died on ${String(signal)}`));
        else settle(code);
      });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a wait interrupted at exit 0 reports 130, not success", async () => {
  // The three lines that were never measured, and the whole reason the
  // spinner could come back.
  assert.equal(await exitCodeOf(child({ close: false, code: 0 })), 130);
});

test("a wait that finished leaves an ordinary success alone", async () => {
  // The other half, and the one a missing `finally` breaks: a guard held past
  // the end of the work turns every successful run into an interrupt.
  assert.equal(await exitCodeOf(child({ close: true, code: 0 })), 0);
});

test("Ctrl-C during a wait ends the command, and ends it at 130", async () => {
  // The other way an interrupt arrives. Where nothing is reading raw
  // keypresses the cancel key is a signal, and attaching any handler to SIGINT
  // is what stops it from killing the process: the renderer attaches one, so
  // before this the fan-out kept running behind a stopped progress line.
  const dir = mkdtempSync(join(tmpdir(), "magi-wait-"));
  try {
    const script = join(dir, "wait.mjs");
    writeFileSync(
      script,
      [
        child({ close: false, code: 0 }).replace("process.exit(0);", ""),
        // The real stream, so the parent knows the wait is open before it
        // signals: signalling too early would prove nothing.
        `process.stdout.write("open\\n");`,
        `setTimeout(() => undefined, 20_000);`,
      ].join("\n"),
    );
    const run = spawn(process.execPath, [script], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 20_000,
    });
    run.stdout.once("data", () => run.kill("SIGINT"));

    const code = await new Promise<number>((settle, fail) => {
      run.on("error", fail);
      run.on("close", (status, signal) => {
        if (status === null) fail(new Error(`the child died on ${String(signal)}`));
        else settle(status);
      });
    });
    assert.equal(code, 130);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a wait interrupted at a refusal keeps the refusal's own code", async () => {
  // 1 is doctor finding problems and a preflight refusing. Rewriting that to
  // 130 would report an interrupt for a command that decided something.
  assert.equal(await exitCodeOf(child({ close: false, code: 1 })), 1);
});
