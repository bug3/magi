import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  CALIBRATION_LAYERS,
  NONCE_PREFIX,
  RECOVERY_FILE,
  calibrateCanaries,
} from "../../src/doctor/calibrate.ts";
import { sha256Text } from "../../src/util/fs.ts";

// The canary's whole claim is that a token reaching a seat came from an
// ambient layer. MAGI's own scratch directory sits inside the repository
// every seat is pointed at, and two of the three seats keep read tools, so a
// token MAGI leaves there is a second source for the same bytes and the claim
// stops being true. Both leaks were real: the recovery sidecar embedded the
// live nonce for the whole calibration, and each round's capture was written
// before the next round ran.
//
// These tests exist because the old world put workDir beside the repository
// while production put it inside, so the shape could not be expressed at all.

const NONCE = `${NONCE_PREFIX}hygiene-1`;

interface World {
  readonly home: string;
  readonly repoDir: string;
  readonly workDir: string;
  readonly ledgerPath: string;
}

function world(): World {
  const root = mkdtempSync(join(tmpdir(), "magi-hygiene-"));
  const home = join(root, "home");
  const repoDir = join(root, "repo");
  // Exactly what src/cli/doctor-command.ts passes.
  const workDir = join(repoDir, ".magi", "doctor");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(home, ".grok", "rules"), { recursive: true });
  mkdirSync(workDir, { recursive: true });
  writeFileSync(join(home, ".claude", "CLAUDE.md"), "# original global\n");
  return { home, repoDir, workDir, ledgerPath: join(root, "ledger.jsonl") };
}

/**
 * Every seat answers with the live token. This is the case the scratch has to
 * survive: a round whose capture carries the nonce is what turns a per-round
 * record into a second source for the next round's seats, so a stub that
 * echoes NONE would leave the deferral untested and did.
 */
const ECHOING = ["melchior-1", "balthasar-2", "casper-3"].map((slot) => ({
  slot,
  stream: `{"echo":"${NONCE}"}`,
  answered: true,
}));

function inputsFor(w: World) {
  return {
    home: w.home,
    user: "seat",
    repoDir: w.repoDir,
    workDir: w.workDir,
    path: "/usr/bin",
    ledgerPath: w.ledgerPath,
    nonce: NONCE,
    now: () => new Date("2026-09-20T15:00:00Z"),
    // Hermetic: the real default shells out to `<command> --version`.
    captureVersion: (command: string) => Promise.resolve(`${command} 9.9.9`),
  };
}

/**
 * What a seat reading its own working root would find, minus the calibration
 * layers themselves. Codex's layer IS `<repoDir>/AGENTS.md`, so the token is
 * in the tree by design for exactly that file, and a seat reading it is the
 * documented `fetched` case which is judged as nothing. Everything else under
 * the repository is MAGI's own leavings and has no business carrying a token.
 */
function magiScratchCarryingTheToken(w: World): readonly string[] {
  const layers = new Set(CALIBRATION_LAYERS.map((layer) => layer.target(w)));
  return readdirSync(w.repoDir, { recursive: true, encoding: "utf8" })
    .map((name) => join(w.repoDir, name))
    .filter((path) => !layers.has(path) && statSync(path).isFile())
    .filter((path) => readFileSync(path, "utf8").includes(NONCE));
}

test("no MAGI scratch file carries the live nonce while a probe round runs", async () => {
  const w = world();
  // Read the tree at the moment a seat would: once per round, before it
  // answers. A read-only sandbox is not a blind one.
  const found: string[][] = [];
  await calibrateCanaries({
    ...inputsFor(w),
    runRound: () => {
      found.push([...magiScratchCarryingTheToken(w)]);
      return Promise.resolve(ECHOING);
    },
  });
  assert.deepEqual(
    found,
    [[], []],
    "MAGI left the live nonce under the repository while a seat was running",
  );
});

test("each round's capture is deferred, not dropped", async () => {
  const w = world();
  await calibrateCanaries({ ...inputsFor(w), runRound: () => Promise.resolve(ECHOING) });
  for (const round of ["isolated", "unisolated"]) {
    const record = join(w.workDir, `melchior-1.calibration-${round}.txt`);
    assert.ok(existsSync(record), `the ${round} capture is the evidence: ${record}`);
    assert.equal(readFileSync(record, "utf8"), `{"echo":"${NONCE}"}`);
  }
});

test("a sidecar that outlives a refused restore still restores by hand", async () => {
  const w = world();
  const claudeLayer = join(w.home, ".claude", "CLAUDE.md");
  const report = await calibrateCanaries({
    ...inputsFor(w),
    runRound: (round) => {
      if (round === "unisolated") writeFileSync(claudeLayer, "# concurrent owner edit\n");
      return Promise.resolve(ECHOING);
    },
  });
  assert.equal(report.restoreFailures.length, 1, "the concurrent edit is refused, not clobbered");
  const sidecar = readFileSync(join(w.workDir, RECOVERY_FILE), "utf8");
  assert.ok(sidecar.includes("# original global"), "the original image is what hand recovery needs");
  assert.ok(!sidecar.includes(NONCE), "the hand-recovery copy must not carry the live token");
  assert.ok(sidecar.includes(sha256Text(NONCE)), "the digest names the run without the token");
});
