import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  CALIBRATION_LAYERS,
  NONCE_PREFIX,
  RECOVERY_FILE,
  calibrateCanaries,
  unisolatedProfile,
} from "../../src/doctor/calibrate.ts";
import { tokenWasFetched } from "../../src/doctor/calibration-evidence.ts";
import { formatCalibration } from "../../src/doctor/format.ts";
import { foldLedger } from "../../src/consult/ledger.ts";
import { seatProfile, type SeatInputs } from "../../src/seats/profiles.ts";

const NONCE = "magi-canary-test-1";

const SEAT_INPUTS: SeatInputs = {
  briefPath: "/w/brief.md",
  schemaPath: "/w/contract.json",
  schemaJson: "{}",
  repoDir: "/work/repo",
  home: "/work/home",
  path: "/usr/bin",
};

interface World {
  readonly home: string;
  readonly repoDir: string;
  readonly workDir: string;
  readonly ledgerPath: string;
}

function world(): World {
  const root = mkdtempSync(join(tmpdir(), "magi-calibrate-"));
  const home = join(root, "home");
  const repoDir = join(root, "repo");
  const workDir = join(root, "work");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(home, ".grok", "rules"), { recursive: true });
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  writeFileSync(join(home, ".claude", "CLAUDE.md"), "# original global\n");
  return { home, repoDir, workDir, ledgerPath: join(root, "ledger.jsonl") };
}

function stubRound(byRound: Readonly<Record<string, string>>) {
  return (round: "isolated" | "unisolated") =>
    Promise.resolve(
      ["melchior-1", "balthasar-2", "casper-3"].map((slot) => ({
        slot,
        stdout: byRound[round] ?? "",
      })),
    );
}

function inputsFor(w: World, runRound: ReturnType<typeof stubRound>) {
  return {
    home: w.home,
    repoDir: w.repoDir,
    workDir: w.workDir,
    path: "/usr/bin",
    ledgerPath: w.ledgerPath,
    nonce: NONCE,
    now: () => new Date("2026-08-20T15:00:00Z"),
    runRound,
  };
}

test("the layer table names the three ambient targets and their expectations", () => {
  const targets = CALIBRATION_LAYERS.map((layer) => [
    layer.harness,
    layer.target({ home: "/h", repoDir: "/r" }),
    layer.isolated,
  ]);
  assert.deepEqual(targets, [
    ["claude", "/h/.claude/CLAUDE.md", "absent"],
    ["codex", "/r/AGENTS.md", "absent"],
    ["grok", "/h/.grok/rules/99-magi-calibration.md", "informational"],
  ]);
});

test("a clean calibration passes and restores every layer byte for byte", async () => {
  const w = world();
  const report = await calibrateCanaries(
    inputsFor(w, stubRound({ isolated: '{"echo":"NONE"}', unisolated: `{"echo":"${NONCE}"}` })),
  );
  assert.equal(report.pass, true);
  assert.equal(readFileSync(join(w.home, ".claude", "CLAUDE.md"), "utf8"), "# original global\n");
  assert.ok(!existsSync(join(w.repoDir, "AGENTS.md")), "the created AGENTS.md was deleted");
  assert.ok(
    !existsSync(join(w.home, ".grok", "rules", "99-magi-calibration.md")),
    "the grok calibration rule was deleted",
  );
});

test("an unisolated round that never surfaces the nonce fails: the canary is inert", async () => {
  const w = world();
  const report = await calibrateCanaries(
    inputsFor(w, stubRound({ isolated: '{"echo":"NONE"}', unisolated: '{"echo":"NONE"}' })),
  );
  assert.equal(report.pass, false);
  const failed = report.results.filter((result) => !result.pass);
  assert.equal(failed.length, 3);
  assert.ok(failed.every((result) => result.direction === "unisolated"));
});

test("a leak in an isolated claude or codex run fails; grok residue is informational", async () => {
  const w = world();
  const report = await calibrateCanaries(
    inputsFor(
      w,
      stubRound({ isolated: `{"echo":"${NONCE}"}`, unisolated: `{"echo":"${NONCE}"}` }),
    ),
  );
  assert.equal(report.pass, false);
  const isolated = report.results.filter((result) => result.direction === "isolated");
  assert.deepEqual(
    isolated.map((result) => [result.harness, result.pass]),
    [
      ["claude", false],
      ["codex", false],
      ["grok", true],
    ],
  );
});

test("layers are restored even when a probe round throws", async () => {
  const w = world();
  writeFileSync(join(w.repoDir, "AGENTS.md"), "# repo rules\n");
  await assert.rejects(
    calibrateCanaries({
      ...inputsFor(w, () => Promise.reject(new Error("seat exploded"))),
    }),
    /seat exploded/,
  );
  assert.equal(readFileSync(join(w.home, ".claude", "CLAUDE.md"), "utf8"), "# original global\n");
  assert.equal(readFileSync(join(w.repoDir, "AGENTS.md"), "utf8"), "# repo rules\n");
});

test("both directions land in the ledger and the fold ignores the row", async () => {
  const w = world();
  await calibrateCanaries(
    inputsFor(w, stubRound({ isolated: '{"echo":"NONE"}', unisolated: `{"echo":"${NONCE}"}` })),
  );
  const lines = readFileSync(w.ledgerPath, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const row = JSON.parse(lines[0] as string);
  assert.equal(row.calibration, NONCE);
  assert.equal(row.results.length, 6);
  assert.deepEqual(foldLedger(lines), [], "a calibration row is not a consult");
});

test("the unisolated variants drop exactly the isolation switches", () => {
  const claude = seatProfile("melchior-1", SEAT_INPUTS);
  const claudeOpen = unisolatedProfile(claude);
  assert.deepEqual(
    claude.args.filter((arg) => arg !== "--safe-mode"),
    [...claudeOpen.args],
  );

  const codex = seatProfile("balthasar-2", SEAT_INPUTS);
  const codexOpen = unisolatedProfile(codex);
  assert.ok(!codexOpen.args.includes("--ignore-user-config"));
  assert.ok(!codexOpen.args.includes("--ignore-rules"));
  assert.ok(!codexOpen.args.includes("project_doc_max_bytes=0"));
  assert.ok(codexOpen.args.includes("--sandbox"), "the sandbox is not an isolation switch");

  const grok = seatProfile("casper-3", SEAT_INPUTS);
  const grokOpen = unisolatedProfile(grok);
  assert.equal(grokOpen.env["GROK_MEMORY"], undefined);
  assert.deepEqual(grokOpen.args, grok.args);
});

test("a concurrently edited layer is refused, not clobbered; the sidecar survives", async () => {
  const w = world();
  const claudeLayer = join(w.home, ".claude", "CLAUDE.md");
  const report = await calibrateCanaries(
    inputsFor(w, (round: "isolated" | "unisolated") => {
      // A concurrent edit lands while the probe rounds are running.
      if (round === "unisolated") writeFileSync(claudeLayer, "# concurrent owner edit\n");
      return Promise.resolve(
        ["melchior-1", "balthasar-2", "casper-3"].map((slot) => ({
          slot,
          stdout: round === "unisolated" ? `{"echo":"${NONCE}"}` : '{"echo":"NONE"}',
        })),
      );
    }),
  );
  assert.equal(report.pass, false, "a refused restore fails the calibration");
  assert.equal(report.restoreFailures.length, 1);
  assert.equal(
    readFileSync(claudeLayer, "utf8"),
    "# concurrent owner edit\n",
    "the concurrent edit was not clobbered",
  );
  const sidecar = join(w.workDir, RECOVERY_FILE);
  assert.ok(existsSync(sidecar), "the recovery sidecar stays for hand restoration");
  assert.ok(readFileSync(sidecar, "utf8").includes("# original global"));
});

test("a clean calibration removes the recovery sidecar and records versions and hashes", async () => {
  const w = world();
  await calibrateCanaries({
    ...inputsFor(w, stubRound({ isolated: '{"echo":"NONE"}', unisolated: `{"echo":"${NONCE}"}` })),
    captureVersion: (command: string) => Promise.resolve(`${command} 9.9.9`),
  });
  assert.ok(!existsSync(join(w.workDir, RECOVERY_FILE)), "no sidecar after a clean run");
  const lines = readFileSync(w.ledgerPath, "utf8").trim().split("\n");
  const row = JSON.parse(lines[lines.length - 1] as string);
  assert.equal(row.cliVersions.length, 3);
  assert.match(row.cliVersions[0].version, /9\.9\.9/);
  assert.equal(row.layerHashes.length, 3);
  assert.match(row.layerHashes[0].sha256, /^[0-9a-f]{64}$/, "the restored claude layer is hashed");
  assert.equal(row.layerHashes[1].sha256, "absent", "a created-then-deleted layer hashes as absent");
});

test("the calibration brief describes the nonce and never contains it", async () => {
  // The first live calibration produced a brief-echo false positive: codex
  // matched the nonce inside the brief itself and reported it as seen. The
  // brief may carry only the fixed prefix; the secret suffix lives in the
  // layers alone, so an echo of the full token proves layer visibility.
  const w = world();
  await calibrateCanaries(
    inputsFor(w, stubRound({ isolated: '{"echo":"NONE"}', unisolated: `{"echo":"${NONCE}"}` })),
  );
  const brief = readFileSync(join(w.workDir, "calibration-brief.md"), "utf8");
  assert.ok(!brief.includes(NONCE), "the nonce itself must not travel in the brief");
  assert.ok(brief.includes(NONCE_PREFIX), "the brief names the fixed prefix");
  assert.match(brief, /does not appear in this message/);
});

test("a nonce without the fixed prefix is refused before any layer mutates", async () => {
  const w = world();
  await assert.rejects(
    calibrateCanaries({
      ...inputsFor(w, stubRound({})),
      nonce: "wrong-prefix-123",
    }),
    /nonce must start with/,
  );
  assert.equal(
    readFileSync(join(w.home, ".claude", "CLAUDE.md"), "utf8"),
    "# original global\n",
    "no layer was touched",
  );
});

test("a token a retrieval returned in its own output is the seat fetching it", () => {
  const stream = [
    '{"type":"turn.started"}',
    `{"type":"item.completed","item":{"type":"command_execution","aggregated_output":"./AGENTS.md:${NONCE}"}}`,
    `{"type":"item.completed","item":{"type":"agent_message","text":"${NONCE}"}}`,
  ].join("\n");
  assert.equal(tokenWasFetched("codex", stream, NONCE), true);
});

test("a token the seat only said is not fetched, whatever it ran first", () => {
  // The leak this rule exists to keep: isolation is broken and the token was
  // in context, but the seat happened to run something unrelated first.
  const stream = [
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"type":"command_execution","aggregated_output":"no token here"}}',
    `{"type":"item.completed","item":{"type":"agent_message","text":"${NONCE}"}}`,
  ].join("\n");
  assert.equal(tokenWasFetched("codex", stream, NONCE), false);
});

test("a harness whose stream cannot answer keeps the whole of its evidence", () => {
  const stream = `{"type":"command_execution","output":"${NONCE}"}`;
  for (const harness of ["claude", "grok"] as const) {
    assert.equal(tokenWasFetched(harness, stream, NONCE), false);
  }
});

test("a seat that greps the layer out of its own repository is not a leak", async () => {
  const w = world();
  // What codex 0.147.0 actually did: no injection, so it searched the tree it
  // was pointed at, read AGENTS.md and echoed what it had just read.
  const fetched = [
    '{"type":"turn.started"}',
    `{"type":"item.completed","item":{"type":"command_execution",` +
      `"aggregated_output":"./AGENTS.md:${NONCE}"}}`,
    `{"type":"item.completed","item":{"type":"agent_message","text":"${NONCE}"}}`,
  ].join("\n");
  const injected = `{"type":"item.completed","item":{"type":"agent_message","text":"${NONCE}"}}`;
  const runRound = (round: "isolated" | "unisolated") =>
    Promise.resolve([
      { slot: "melchior-1", stdout: round === "unisolated" ? injected : "" },
      { slot: "balthasar-2", stdout: round === "unisolated" ? injected : fetched },
      { slot: "casper-3", stdout: injected },
    ]);

  const report = await calibrateCanaries(inputsFor(w, runRound));
  const isolated = report.results.find(
    (result) => result.harness === "codex" && result.direction === "isolated",
  );
  assert.equal(isolated?.nonceSeen, false, "the layer did not reach the seat on its own");
  assert.equal(isolated?.nonceFetched, true, "the seat read it with a command");
  assert.equal(isolated?.pass, true);
  assert.equal(report.pass, true);
  assert.match(formatCalibration(report), /nonce not injected, the seat fetched it/u);
});

test("a real leak behind an unrelated retrieval still fails the isolated round", async () => {
  const w = world();
  const leaked = [
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"type":"command_execution","aggregated_output":"ls, no token"}}',
    `{"type":"item.completed","item":{"type":"agent_message","text":"${NONCE}"}}`,
  ].join("\n");
  const runRound = (round: "isolated" | "unisolated") =>
    Promise.resolve([
      { slot: "melchior-1", stdout: round === "unisolated" ? NONCE : "" },
      { slot: "balthasar-2", stdout: leaked },
      { slot: "casper-3", stdout: NONCE },
    ]);

  const report = await calibrateCanaries(inputsFor(w, runRound));
  const isolated = report.results.find(
    (result) => result.harness === "codex" && result.direction === "isolated",
  );
  assert.equal(isolated?.nonceSeen, true, "the token was not fetched, so it reached the seat");
  assert.equal(isolated?.nonceFetched, false);
  assert.equal(isolated?.pass, false, "a leak behind a retrieval is still a leak");
  assert.equal(report.pass, false);
});

test("the marker list is matched against a real codex stream, not one written here", () => {
  const capture = readFileSync(
    join("fixtures", "seat-capture", "balthasar-fetched-token.ndjson"),
    "utf8",
  );
  const token = "magi-canary-fixture1";
  assert.ok(capture.includes(token), "the capture carries its own token");
  assert.equal(tokenWasFetched("codex", capture, token), true);
  assert.equal(tokenWasFetched("claude", capture, token), false, "scope is enforced, not documented");
});
