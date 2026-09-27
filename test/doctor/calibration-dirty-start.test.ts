import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  CALIBRATION_LAYERS,
  NONCE_MARKER,
  RECOVERY_FILE,
  calibrateCanaries,
} from "../../src/doctor.ts";
import { workspace } from "../support/cli.ts";

for (const dirty of CALIBRATION_LAYERS) {
  test(`a leftover nonce in the ${dirty.harness} layer refuses calibration before any write`, async () => {
    const space = workspace();
    try {
      const paths = { home: space.home, repoDir: space.repo };
      const target = dirty.target(paths);
      const workDir = join(space.repo, ".magi", "doctor");
      const originals = CALIBRATION_LAYERS.map((layer) => {
        const path = layer.target(paths);
        const text = path === target ? `${NONCE_MARKER} magi-canary-residue\n` : "# owner rules\n";
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
        return { path, text };
      });
      let rounds = 0;
      await assert.rejects(
        calibrateCanaries({
          ...paths,
          user: "nobody",
          workDir,
          path: space.bin,
          ledgerPath: join(workDir, "ledger.jsonl"),
          nonce: "magi-canary-new-run",
          runRound: async () => { rounds += 1; return []; },
          captureVersion: async () => assert.fail("a dirty start must not probe versions"),
        }),
        (error: Error) => {
          assert.ok(error.message.includes(target), "the refusal must name the dirty layer");
          assert.match(error.message, /restore.*by hand/u);
          return true;
        },
      );
      assert.equal(rounds, 0, "a dirty start must not spend quota on probe rounds");
      assert.equal(existsSync(workDir), false, "refusal must not create scratch or a sidecar");
      assert.deepEqual(
        originals.map(({ path }) => readFileSync(path, "utf8")),
        originals.map(({ text }) => text),
        "every layer must retain its original bytes",
      );
    } finally {
      space.remove();
    }
  });
}

test("a surviving recovery sidecar refuses calibration even when every layer is clean", async () => {
  // A refused restore the owner resolved by editing the layer: no marker is
  // left, but the sidecar still holds the only copy of the pre-edit image.
  const space = workspace();
  try {
    const workDir = join(space.repo, ".magi", "doctor");
    mkdirSync(workDir, { recursive: true });
    writeFileSync(join(space.repo, "AGENTS.md"), "# owner edit after a refused restore\n");
    const sidecar = join(workDir, RECOVERY_FILE);
    const recovery = '{"layers":[{"original":"# the pre-edit rules\\n"}]}\n';
    writeFileSync(sidecar, recovery);
    await assert.rejects(calibrateCanaries({
      home: space.home,
      repoDir: space.repo,
      user: "nobody",
      workDir,
      path: space.bin,
      ledgerPath: join(workDir, "ledger.jsonl"),
      nonce: "magi-canary-new-run",
      runRound: async () => assert.fail("a pending recovery must not launch a round"),
    }), (error: Error) => {
      assert.ok(error.message.includes(sidecar), "the refusal must name the sidecar");
      assert.match(error.message, /restore.*by hand/u);
      return true;
    });
    assert.equal(readFileSync(sidecar, "utf8"), recovery);
    assert.equal(readFileSync(join(space.repo, "AGENTS.md"), "utf8"), "# owner edit after a refused restore\n");
    assert.equal(existsSync(join(workDir, "ledger.jsonl")), false);
  } finally {
    space.remove();
  }
});

test("a dirty start preserves the previous recovery sidecar and captures", async () => {
  const space = workspace();
  try {
    const workDir = join(space.repo, ".magi", "doctor");
    mkdirSync(workDir, { recursive: true });
    writeFileSync(join(space.repo, "AGENTS.md"), `${NONCE_MARKER} magi-canary-residue\n`);
    const sidecar = join(workDir, RECOVERY_FILE);
    const capture = join(workDir, "melchior-1.calibration-isolated.txt");
    const recovery = '{"original":"magi-canary-residue"}\n';
    writeFileSync(sidecar, recovery);
    writeFileSync(capture, "magi-canary-residue\n");
    await assert.rejects(calibrateCanaries({
      home: space.home,
      repoDir: space.repo,
      user: "nobody",
      workDir,
      path: space.bin,
      ledgerPath: join(workDir, "ledger.jsonl"),
      nonce: "magi-canary-new-run",
      runRound: async () => assert.fail("a dirty start must not launch a round"),
    }), /restore.*by hand/u);
    assert.equal(readFileSync(sidecar, "utf8"), recovery);
    assert.equal(readFileSync(capture, "utf8"), "magi-canary-residue\n");
    assert.equal(existsSync(join(workDir, "ledger.jsonl")), false);
  } finally {
    space.remove();
  }
});
