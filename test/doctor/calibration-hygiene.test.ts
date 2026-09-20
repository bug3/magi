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
  CALIBRATION_TOKEN,
  NONCE_PREFIX,
  RECOVERY_FILE,
  calibrateCanaries,
} from "../../src/doctor/calibrate.ts";
import { sha256Text } from "../../src/util/fs.ts";

// The canary's whole claim is that a token reaching a seat came from an
// ambient layer. MAGI's own scratch directory sits inside the repository
// every seat is pointed at, and two of the three seats keep read tools, so a
// token MAGI leaves there is a second source for the same bytes and the claim
// stops being true. Three leaks were real: the recovery sidecar embedded the
// live nonce, each round's capture was written before the next round ran, and
// nothing removed the previous calibration's captures at all.
//
// The token searched for here is any token carrying the prefix, not this
// run's, because that is what the brief asks a seat for. A stale token cannot
// produce a false pass, since the row tests for this run's nonce; it produces
// the opposite, a round that fails naming isolation when the fault is residue.
//
// These tests exist because the old world put workDir beside the repository
// while production puts it inside, so the shape could not be expressed at all.

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
  // Exactly what src/cli/doctor-command.ts passes, both of them.
  const workDir = join(repoDir, ".magi", "doctor");
  const ledgerPath = join(repoDir, ".magi", "ledger.jsonl");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(home, ".grok", "rules"), { recursive: true });
  mkdirSync(workDir, { recursive: true });
  writeFileSync(join(home, ".claude", "CLAUDE.md"), "# original global\n");
  return { home, repoDir, workDir, ledgerPath };
}

/**
 * Every seat answers with the token. This is the case the scratch has to
 * survive: a round whose capture carries a token is what turns a per-round
 * record into a second source for a later round's seats, so a stub that
 * echoed NONE would leave the deferral untested, and did.
 */
function echoing(token: string) {
  return ["melchior-1", "balthasar-2", "casper-3"].map((slot) => ({
    slot,
    stream: `{"echo":"${token}"}`,
    answered: true,
  }));
}

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
 * layers themselves. Codex's layer IS `<repoDir>/AGENTS.md`, so a token is in
 * the tree by design for that one file, and a seat reading it is the
 * documented `fetched` case which is judged as nothing. Everything else under
 * the repository is MAGI's own leavings and has no business carrying one.
 */
function magiScratchCarryingAToken(w: World): readonly string[] {
  const layers = new Set(CALIBRATION_LAYERS.map((layer) => layer.target(w)));
  return readdirSync(w.repoDir, { recursive: true, encoding: "utf8" })
    .map((name) => join(w.repoDir, name))
    .filter((path) => !layers.has(path) && statSync(path).isFile())
    .filter((path) => CALIBRATION_TOKEN.test(readFileSync(path, "utf8")));
}

test("no MAGI scratch file carries a calibration token while a probe round runs", async () => {
  const w = world();
  // Read the tree at the moment a seat would: once per round, before it
  // answers. A read-only sandbox is not a blind one.
  const found: string[][] = [];
  await calibrateCanaries({
    ...inputsFor(w),
    runRound: () => {
      found.push([...magiScratchCarryingAToken(w)]);
      return Promise.resolve(echoing(NONCE));
    },
  });
  assert.deepEqual(
    found,
    [[], []],
    "MAGI left a calibration token under the repository while a seat was running",
  );
});

test("a previous calibration's token is gone before the next one's rounds", async () => {
  const w = world();
  const first = `${NONCE_PREFIX}run-one`;
  await calibrateCanaries({
    ...inputsFor(w),
    nonce: first,
    runRound: () => Promise.resolve(echoing(first)),
  });
  assert.ok(
    magiScratchCarryingAToken(w).length > 0,
    "the first run must leave its captures behind, or this proves nothing",
  );

  const found: string[][] = [];
  await calibrateCanaries({
    ...inputsFor(w),
    nonce: `${NONCE_PREFIX}run-two`,
    runRound: () => {
      found.push([...magiScratchCarryingAToken(w)]);
      return Promise.resolve(echoing(`${NONCE_PREFIX}run-two`));
    },
  });
  assert.deepEqual(
    found,
    [[], []],
    "a seat asked for any token with the prefix could have echoed the previous run's",
  );
});

test("each round's capture is deferred, not dropped", async () => {
  const w = world();
  await calibrateCanaries({ ...inputsFor(w), runRound: () => Promise.resolve(echoing(NONCE)) });
  for (const round of ["isolated", "unisolated"]) {
    const record = join(w.workDir, `melchior-1.calibration-${round}.txt`);
    assert.ok(existsSync(record), `the ${round} capture is the evidence: ${record}`);
    assert.equal(readFileSync(record, "utf8"), `{"echo":"${NONCE}"}`);
  }
});

test("a capture that cannot be written does not replace the round's own failure", async () => {
  const w = world();
  await assert.rejects(
    calibrateCanaries({
      ...inputsFor(w),
      runRound: (round) => {
        if (round === "isolated") return Promise.resolve(echoing(NONCE));
        // A directory where the isolated round's capture must go: the write
        // fails while the round's own failure is already on its way out.
        mkdirSync(join(w.workDir, "melchior-1.calibration-isolated.txt"));
        return Promise.reject(new Error("the seat exploded"));
      },
    }),
    /the seat exploded/,
    "the filesystem error replaced the reason the calibration ended",
  );
});

test("a sidecar that outlives a refused restore still restores by hand", async () => {
  const w = world();
  const claudeLayer = join(w.home, ".claude", "CLAUDE.md");
  const report = await calibrateCanaries({
    ...inputsFor(w),
    runRound: (round) => {
      if (round === "unisolated") writeFileSync(claudeLayer, "# concurrent owner edit\n");
      return Promise.resolve(echoing(NONCE));
    },
  });
  assert.equal(report.restoreFailures.length, 1, "the concurrent edit is refused, not clobbered");
  const sidecar = readFileSync(join(w.workDir, RECOVERY_FILE), "utf8");
  assert.ok(sidecar.includes("# original global"), "the original image is what hand recovery needs");
  assert.ok(!CALIBRATION_TOKEN.test(sidecar), "the hand-recovery copy carries no token at all");
  assert.ok(sidecar.includes(sha256Text(NONCE)), "the digest names the run without the token");
  assert.ok(
    sidecar.includes(sha256Text(`# original global\n\nMAGI calibration nonce: ${NONCE} ` +
      "(temporary; written and removed by magi doctor --calibrate)\n")),
    "the mutated image's digest says whether the layer still holds MAGI's line",
  );
});
