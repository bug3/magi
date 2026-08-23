#!/usr/bin/env node
// Stand-in for a whole harness CLI, so an end-to-end run can convene a real
// council without a live model or a spent subscription.
//
// `stub-seat.mjs` beside this file stands in for one seat inside the fan-out
// unit tests, where the launch profile is injected. This one stands in for the
// binary itself: it is installed on a temporary PATH under the three names the
// real launch profiles resolve, `claude`, `codex` and `grok`, and answers
// everything those profiles and `magi doctor` ask of them. So the run under
// test is the real one, all the way down to `spawn`, and only the model is
// not.
//
// Plain JS on purpose: tsconfig compiles .ts only, and this file is spawned,
// never imported.
//
// It answers as whichever of the three it was invoked as, taken from its own
// filename, because that is exactly what the profile resolved through PATH:
//
//   <name> --version        the version string doctor probes for
//   <name> --help           the flag documentation doctor checks for drift,
//                           read from `<name>.help.txt` beside this file so a
//                           test can generate it from the real profiles
//                           rather than restate them and go stale
//   grok inspect --json     the residue probe the casper-3 profile carries
//   anything else           a seat call: read the brief, answer the contract
//
// The answer quotes the consult id out of the brief it was given, so a test
// can prove the brief reached the seat rather than only that something did.

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const name = basename(process.argv[1] ?? "claude");
const argv = process.argv.slice(2);

/** Every stub reports the same version; doctor only needs one to exist. */
const VERSION = "0.0.0-stub";

/**
 * One proposed check per harness, chosen to exercise both halves of the check
 * vocabulary from a single consult: two shapes it admits and one it refuses.
 * A seat proposing something the catalog does not know is the ordinary case,
 * not an error, and `magi checks` has to record it as such.
 */
const PROPOSED_CHECK = {
  claude: "git status --short",
  codex: "npm test",
  grok: "git log --oneline -1",
};

// Written, then returned from, never exited from. Node writes to a pipe
// asynchronously, so a `process.exit` on the line after a write is how an
// envelope arrives at its adapter with the tail missing.
process.stdout.write(await answer());

async function answer() {
  if (argv.includes("--version")) return `${VERSION}\n`;

  if (argv.includes("--help")) {
    // Written beside the stub by whoever installed it. Absent, the help is
    // empty, which doctor reads as every profile flag being undocumented: a
    // loud, correct answer rather than a quiet pass.
    const file = join(HERE, `${name}.help.txt`);
    return existsSync(file) ? readFileSync(file, "utf8") : "";
  }

  // The casper-3 residue probe. It snapshots what the harness would not let
  // go of; a stub holds nothing, and says so in the shape the probe reads.
  if (argv[0] === "inspect") {
    return `${JSON.stringify({ rules: [], skills: [], mcp: [], hooks: [] })}\n`;
  }

  const brief = await readBrief();
  const cited = lastCitation(brief);
  const opinion = {
    schema: "magi/opinion.v1",
    mode: /^Mode:\s*plan\s*$/mu.test(brief) ? "plan" : "review",
    // The consult id is quoted back so a caller can prove the rendered brief
    // arrived here whole, rather than that some brief did.
    position: `stub seat for ${name} on ${consultId(brief)}: the brief arrived and this is the shape of an answer.`,
    // A finding needs a citation that resolves in this consult's own pack,
    // and evidence ids are minted per consult, so the id is read back out of
    // the pack that was just handed over rather than written down here. No
    // pack, no finding: the smoke brief carries none and gets none, which is
    // why the caller has to assert the finding is here rather than trust that
    // a valid answer means the pack arrived.
    findings:
      cited === undefined
        ? []
        : [
            {
              id: "F1",
              severity: "minor",
              claim: `the evidence pack reached this seat, whose first citation is ${cited}`,
              citations: [cited],
              check: PROPOSED_CHECK[name] ?? null,
              fix: null,
            },
          ],
    answers: [],
    keep_list: [{ claim: "a stub seat proposes no change", citations: [] }],
    assumptions: [],
    confidence: 0.5,
  };
  return `${envelope(name, JSON.stringify(opinion))}\n`;
}

/**
 * The last evidence id in the pack, taken from the heading that mints it.
 *
 * The last rather than the first: the caller's own brief is rendered ahead of
 * the pack, so a heading it happens to contain would be picked up by a scan
 * from the top and would stand in for a pack that never arrived. Nothing the
 * caller wrote can follow the pack.
 */
function lastCitation(text) {
  return [...text.matchAll(/^##\s+(E[1-9][0-9]*)\s/gmu)].at(-1)?.[1];
}

/** The brief, from wherever this harness's launch profile put it. */
async function readBrief() {
  const at = argv.indexOf("--prompt-file");
  if (at !== -1 && argv[at + 1] !== undefined) return readFileSync(argv[at + 1], "utf8");
  process.stdin.setEncoding("utf8");
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

function consultId(text) {
  return /^Consult:\s*(\S+)\s*$/mu.exec(text)?.[1] ?? "no-consult-id-in-brief";
}

/**
 * The same message in each harness's own envelope, because the whole point of
 * three adapters is that no two of them are the same shape.
 */
function envelope(harness, message) {
  const usage = { input_tokens: 100, output_tokens: 200 };
  if (harness === "claude") {
    return JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: message,
      usage,
      total_cost_usd: 0.01,
    });
  }
  if (harness === "codex") {
    // Line-delimited events, ending in the turn that carries the usage.
    return [
      JSON.stringify({ type: "thread.started" }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: message } }),
      JSON.stringify({ type: "turn.completed", usage }),
    ].join("\n");
  }
  return JSON.stringify({ text: message, stopReason: "end_turn", usage });
}
