/**
 * `magi doctor`, run as a process against a real repository and a real PATH.
 *
 * Everything doctor reports is derived by modules the unit suites already
 * cover. What only a real run can show is that it derives them from the
 * machine at all: that a version probe spawns the binary PATH resolves, that
 * the drift check reads the help that binary prints rather than a fixture,
 * and that a red report leaves the process with a non-zero status.
 *
 * The three harness stubs stand in for the CLIs, so no subscription is spent.
 * The help they print is generated from the real launch profiles, so the
 * drift check is answered by today's flags and cannot go stale.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { NONCE_MARKER, RECOVERY_FILE } from "../../src/doctor.ts";
import { initRepo, installStubHarnesses, magi, workspace } from "../support/cli.ts";

test("with no harness on PATH every seat reports NOT FOUND and the run is red", async () => {
  const space = workspace();
  try {
    await initRepo(space.repo);
    const run = await magi(["doctor"], space);

    assert.equal(run.code, 1, "doctor exits 1 on problems, which is not an invocation error");
    assert.match(run.out, /NOT FOUND/u);
    assert.match(run.out, /PROBLEMS FOUND/u);
    // The verdict is on stderr too: a caller that only pipes stdout still has
    // to be able to tell a red doctor from a green one.
    assert.match(run.err, /doctor found problems/u);
  } finally {
    space.remove();
  }
});

test("a CLI on PATH is probed for real: its version and its help both land", async () => {
  const space = workspace();
  try {
    await initRepo(space.repo);
    installStubHarnesses(space.bin);
    const run = await magi(["doctor"], space);

    // The version came out of the binary, and the flag check out of the help
    // that same binary printed. Neither is available to an in-process test.
    assert.match(run.out, /0\.0\.0-stub/u);
    assert.match(run.out, /all documented in installed help/u);
    assert.ok(!run.out.includes("NOT FOUND"));
    assert.ok(!run.out.includes("UNDOCUMENTED"));
    assert.match(run.out, /[.]magi\/ is ignored/u);

    // The report is titled by what it is, and the command names itself once.
    // Both lines said "magi doctor" before the command banner existed, which
    // put the same words on screen twice with nothing distinguishing them.
    assert.match(run.out, /static checks \(nothing here spends quota\)/u);
    // Counted without the repair instructions, which name the command on
    // purpose: what must appear once is the banner.
    assert.equal(run.out.match(/magi doctor(?! --)/gu)?.length, 1);
  } finally {
    space.remove();
  }
});

test("a repository that never calibrated is red, and says which proof is missing", async () => {
  // The canaries are per-repository artifacts, so a fresh one is honestly red
  // until its own calibration has run. Asserted rather than assumed: this is
  // the state every new installation is in, and a doctor that quietly passed
  // it would be claiming a proof nobody performed.
  const space = workspace();
  try {
    await initRepo(space.repo);
    installStubHarnesses(space.bin);
    const run = await magi(["doctor"], space);

    assert.equal(run.code, 1);
    assert.match(run.out, /no calibration recorded in this ledger/u);
    assert.match(run.out, /run magi doctor --calibrate/u);
  } finally {
    space.remove();
  }
});

test("a state directory the repository does not ignore is reported as such", async () => {
  const space = workspace();
  try {
    await initRepo(space.repo);
    writeFileSync(join(space.repo, ".gitignore"), "node_modules/\n");
    const run = await magi(["doctor"], space);

    assert.equal(run.code, 1);
    assert.match(run.out, /NOT IGNORED/u);
  } finally {
    space.remove();
  }
});

test("--live really calls each harness and keeps the raw answer for diagnosis", async () => {
  const space = workspace();
  try {
    await initRepo(space.repo);
    installStubHarnesses(space.bin);
    const run = await magi(["doctor", "--live"], space);

    assert.match(run.out, /live smoke/u);
    // Three calls, three answers, each parsed by its own adapter: the whole
    // point of the smoke is that the envelope shapes differ per harness.
    assert.equal(run.out.match(/output parsed as the launch profile promised/gu)?.length, 3);
    assert.ok(!run.out.includes("OUTPUT DID NOT PARSE"));
    for (const slot of ["melchior-1", "balthasar-2", "casper-3"]) {
      const raw = join(space.repo, ".magi", "doctor", `${slot}.stdout.txt`);
      assert.ok(existsSync(raw), `${slot} left its raw answer at ${raw}`);
    }
  } finally {
    space.remove();
  }
});

test("--calibrate catches a canary that proves nothing, and restores every layer", async () => {
  // Calibration is the one command that edits config files outside the state
  // directory, so it is the one command whose real failure mode is damage
  // rather than a wrong answer. Both halves are asserted here: that an inert
  // canary is reported as a failure rather than a pass, and that the layer it
  // wrote through comes back byte for byte.
  //
  // The stubs read no configuration at all, so the nonce can never surface:
  // that is exactly the shape of the canary a release once shipped, which
  // would have recorded a real isolation leak as a pass.
  const space = workspace();
  try {
    await initRepo(space.repo);
    installStubHarnesses(space.bin);
    const layer = join(space.repo, "AGENTS.md");
    const before = "# conventions\n\nthe project's own instructions\n";
    writeFileSync(layer, before);

    const run = await magi(["doctor", "--calibrate"], space);

    assert.equal(run.code, 1, "an unproved canary is a red doctor, not a quiet pass");
    assert.match(run.out, /CALIBRATION FAILED/u);

    assert.equal(readFileSync(layer, "utf8"), before, "the layer is exactly as it was");
    assert.ok(!readFileSync(layer, "utf8").includes(NONCE_MARKER));
    assert.ok(
      !existsSync(join(space.repo, ".magi", "doctor", RECOVERY_FILE)),
      "a restore that succeeded leaves no recovery sidecar behind",
    );
  } finally {
    space.remove();
  }
});
