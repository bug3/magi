import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
    const target = (harness: string) =>
      CALIBRATION_LAYERS.find((layer) => layer.harness === harness)?.target(paths) ??
      assert.fail(`no ${harness} layer`);
    const layers = CALIBRATION_LAYERS.map((layer) => layer.target(paths));
    layers.map((path) => mkdirSync(join(path, ".."), { recursive: true }));
    layers.map((path) => chmodSync(join(path, ".."), 0o755));
    // The claude and codex layers exist beforehand, readable by group and
    // world; grok's is created by calibration and removed again.
    const existing = [target("claude"), target("codex")];
    existing.map((path) => writeFileSync(path, "# owner rules\n"));
    existing.map((path) => chmodSync(path, 0o644));
    const mode = (path: string) => statSync(path).mode & 0o777;
    // Every layer directory, and the layer files that outlive the run.
    const modes = () => [...layers.map((path) => mode(join(path, ".."))), ...existing.map(mode)];
    const before = modes();

    await calibrate(space);

    assert.deepEqual(modes(), before);
    const workDir = join(space.repo, ".magi", "doctor");
    assert.equal(mode(workDir), 0o700, "MAGI's own state stays private");
  } finally {
    space.remove();
  }
});

function calibrate(space: ReturnType<typeof workspace>) {
  const workDir = join(space.repo, ".magi", "doctor");
  return calibrateCanaries({
    home: space.home,
    repoDir: space.repo,
    user: "nobody",
    workDir,
    path: space.bin,
    ledgerPath: join(workDir, "ledger.jsonl"),
    nonce: "magi-canary-links",
    runRound: async () => [],
    captureVersion: async () => "1.0.0",
  });
}

test("a layer that is a link stays a link, and its target gets the original back", async () => {
  const space = workspace();
  try {
    const target = join(space.home, "dotfiles", "CLAUDE.md");
    const layer = join(space.home, ".claude", "CLAUDE.md");
    mkdirSync(join(space.home, "dotfiles"), { recursive: true });
    mkdirSync(join(space.home, ".claude"), { recursive: true });
    writeFileSync(target, "# owner rules\n");
    symlinkSync(target, layer);

    await calibrate(space);

    assert.ok(lstatSync(layer).isSymbolicLink(), "the owner's link survives the round trip");
    assert.equal(readFileSync(target, "utf8"), "# owner rules\n");
  } finally {
    space.remove();
  }
});

test("a layer that is a link to nothing refuses calibration before any write", async () => {
  const space = workspace();
  try {
    const layer = join(space.home, ".claude", "CLAUDE.md");
    mkdirSync(join(space.home, ".claude"), { recursive: true });
    symlinkSync(join(space.home, "missing.md"), layer);

    await assert.rejects(calibrate(space), (error: Error) => {
      assert.ok(error.message.includes(layer), "the refusal names the layer");
      return true;
    });
    assert.ok(lstatSync(layer).isSymbolicLink(), "the link is left as it was");
    assert.equal(existsSync(join(space.repo, ".magi", "doctor")), false, "nothing was written");
  } finally {
    space.remove();
  }
});
