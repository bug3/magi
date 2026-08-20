// Stand-in for a seat CLI, so the fan-out guards never touch a live harness.
// Plain JS on purpose: tsconfig compiles .ts only, and this file is spawned,
// never imported.
//
// Flags: --payload <text> (printed verbatim), --sleep-ms <n> (before printing),
// --echo-stdin (prints "stdin:" plus whatever arrived on stdin, so a test can
// prove delivery or absence), --exit-code <n>, --record <path> (appends one
// line per run, so a test can count attempts).

import { appendFileSync } from "node:fs";

function flag(name, fallback) {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
}

function has(name) {
  return process.argv.includes(name);
}

async function readStdin() {
  process.stdin.setEncoding("utf8");
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

const record = flag("--record", undefined);
if (record !== undefined) appendFileSync(record, "run\n");

const stdin = has("--echo-stdin") ? await readStdin() : "";

const sleepMs = Number(flag("--sleep-ms", "0"));
if (sleepMs > 0) await new Promise((resolve) => setTimeout(resolve, sleepMs));

const payload = flag("--payload", undefined);
if (payload !== undefined) process.stdout.write(`${payload}\n`);
if (has("--echo-stdin")) process.stdout.write(`stdin:${stdin}\n`);

process.exit(Number(flag("--exit-code", "0")));
