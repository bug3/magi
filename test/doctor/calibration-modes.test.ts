import assert from "node:assert/strict";
import { chmodSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { CALIBRATION_LAYERS, calibrateCanaries } from "../../src/doctor.ts";
import { workspace } from "../support/cli.ts";

// Calibration writes into the owner's own configuration and repository. Its
// mutation and its restore must leave the modes it found there: MAGI's own
// state is private, the owner's directories and files are not MAGI's to re-mode.
test("a calibration round trip leaves every layer file and directory at its mode", async () => {
  const space = workspace();
  try {
    const paths = { home: space.home, repoDir: space.repo };
    const layers = CALIBRATION_LAYERS.map((layer) => layer.target(paths));
    for (const path of layers) {
      mkdirSync(join(path, ".."), { recursive: true });
      chmodSync(join(path, ".."), 0o755);
    }
    // Two layers exist beforehand, readable by group and world; grok's is
    // created by calibration and removed again.
    for (const path of layers.slice(0, 2)) {
      writeFileSync(path, "# owner rules\n");
      chmodSync(path, 0o644);
    }
    const mode = (path: string) => statSync(path).mode & 0o777;
    const before = layers.map((path) => [path, mode(join(path, "..")), ...layers.slice(0, 2).includes(path) ? [mode(path)] : []]);

    const workDir = join(space.repo, ".magi", "doctor");
    await calibrateCanaries({
      ...paths,
      user: "nobody",
      workDir,
      path: space.bin,
      ledgerPath: join(workDir, "ledger.jsonl"),
      nonce: "magi-canary-modes",
      runRound: async () => [],
      captureVersion: async () => "1.0.0",
    });

    const after = layers.map((path) => [path, mode(join(path, "..")), ...layers.slice(0, 2).includes(path) ? [mode(path)] : []]);
    assert.deepEqual(after, before);
    assert.equal(mode(workDir), 0o700, "MAGI's own state stays private");
  } finally {
    space.remove();
  }
});
