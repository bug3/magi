import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  CALIBRATION_LAYERS,
  NONCE_MARKER,
  RECOVERY_FILE,
  calibrateCanaries,
  calibrationHealth,
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
    const capture = join(workDir, "melchior-1.calibration-isolated.txt");
    writeFileSync(capture, "magi-canary-residue\n");
    await assert.rejects(calibrateCanaries({
      home: space.home,
      repoDir: space.repo,
      user: "nobody",
      workDir,
      path: space.bin,
      ledgerPath: join(workDir, "ledger.jsonl"),
      nonce: "magi-canary-new-run",
      runRound: async () => assert.fail("a pending recovery must not launch a round"),
      captureVersion: async () => assert.fail("a pending recovery must not probe versions"),
    }), (error: Error) => {
      assert.ok(error.message.includes(sidecar), "the refusal must name the sidecar");
      assert.match(error.message, /restore.*by hand/u);
      return true;
    });
    assert.equal(readFileSync(sidecar, "utf8"), recovery);
    assert.equal(readFileSync(capture, "utf8"), "magi-canary-residue\n");
    assert.equal(readFileSync(join(space.repo, "AGENTS.md"), "utf8"), "# owner edit after a refused restore\n");
    for (const layer of CALIBRATION_LAYERS.filter((entry) => entry.harness !== "codex")) {
      const path = layer.target({ home: space.home, repoDir: space.repo });
      assert.equal(existsSync(path), false, `${path} must not be created`);
    }
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
    }), (error: Error) => {
      // Doctor, handed the same leftovers, reports each one the refusal names.
      const [sidecarFailure, layerFailure] = calibrationHealth({
        rows: [],
        seated: [],
        layers: [{
          harness: "codex",
          path: join(space.repo, "AGENTS.md"),
          currentSha256: "unused",
          hasNonceMarker: true,
        }],
        recoveryPending: sidecar,
        strandedWrites: [],
      }).failures;
      assert.ok(sidecarFailure !== undefined && error.message.includes(sidecarFailure));
      assert.ok(layerFailure !== undefined && error.message.includes(layerFailure));
      return true;
    });
    assert.equal(readFileSync(sidecar, "utf8"), recovery);
    assert.equal(readFileSync(capture, "utf8"), "magi-canary-residue\n");
    assert.equal(existsSync(join(workDir, "ledger.jsonl")), false);
  } finally {
    space.remove();
  }
});

// A kill between a durable write's temp open and its rename strands the
// nonce-bearing image beside the layer, where no layer read ever looks.
for (const dirty of CALIBRATION_LAYERS) {
  test(`a stranded nonce-bearing write beside the ${dirty.harness} layer refuses calibration`, async () => {
    const space = workspace();
    try {
      const workDir = join(space.repo, ".magi", "doctor");
      const stranded = join(dirname(dirty.target({ home: space.home, repoDir: space.repo })), ".tmp-1-a-b");
      mkdirSync(dirname(stranded), { recursive: true });
      writeFileSync(stranded, `# rules\n${NONCE_MARKER} magi-canary-residue\n`);
      await assert.rejects(calibrateCanaries({
        home: space.home,
        repoDir: space.repo,
        user: "nobody",
        workDir,
        path: space.bin,
        ledgerPath: join(workDir, "ledger.jsonl"),
        nonce: "magi-canary-new-run",
        runRound: async () => assert.fail("a stranded write must not launch a round"),
      }), (error: Error) => {
        assert.ok(error.message.includes(stranded), "the refusal must name the stranded file");
        assert.match(error.message, /by hand/u);
        return true;
      });
      assert.equal(existsSync(workDir), false, "refusal must not create scratch or a sidecar");
      assert.equal(existsSync(stranded), true, "the stranded file is left for the person");
    } finally {
      space.remove();
    }
  });
}

test("a temp file without a nonce beside a layer is not a dirty start", async () => {
  const space = workspace();
  try {
    const workDir = join(space.repo, ".magi", "doctor");
    writeFileSync(join(space.repo, ".tmp-1-a-b"), "someone else's half-written file\n");
    let rounds = 0;
    await calibrateCanaries({
      home: space.home,
      repoDir: space.repo,
      user: "nobody",
      workDir,
      path: space.bin,
      ledgerPath: join(workDir, "ledger.jsonl"),
      nonce: "magi-canary-new-run",
      runRound: async () => { rounds += 1; return []; },
      captureVersion: async () => "1.0.0",
    });
    assert.equal(rounds, 2);
  } finally {
    space.remove();
  }
});
