import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";

import { calibrateCanaries, unisolatedProfile } from "../../src/doctor.ts";
import type { SeatProfile } from "../../src/core/profile.ts";
import { workspace } from "../support/cli.ts";

// Every other calibration test injects a round that ignores the profiles it
// is handed, so handing the unisolated round the isolated profiles passed the
// whole suite. Live, that makes every unisolated row read as an inert canary.
test("each round is handed its own profiles: isolated first, then exactly those minus isolation", async () => {
  const space = workspace();
  try {
    const workDir = join(space.repo, ".magi", "doctor");
    const seen: Record<string, readonly SeatProfile[]> = {};
    await calibrateCanaries({
      home: space.home,
      repoDir: space.repo,
      user: "nobody",
      workDir,
      path: space.bin,
      ledgerPath: join(workDir, "ledger.jsonl"),
      nonce: "magi-canary-wiring",
      runRound: async (round, profiles) => {
        seen[round] = profiles;
        return profiles.map((profile) => ({
          slot: profile.slot,
          stream: '{"echo":"NONE"}',
          answered: true,
        }));
      },
      captureVersion: async () => "1.0.0",
    });

    const isolated = seen["isolated"] ?? assert.fail("the isolated round never ran");
    const unisolated = seen["unisolated"] ?? assert.fail("the unisolated round never ran");
    assert.deepEqual(isolated.map((profile) => profile.slot), ["melchior-1", "balthasar-2", "casper-3"]);
    assert.deepEqual(
      isolated.map((profile) => isDeepStrictEqual(profile, unisolatedProfile(profile))),
      [false, false, false],
      "the isolated round carries every seat's isolation switches",
    );
    assert.deepEqual(unisolated, isolated.map(unisolatedProfile));
  } finally {
    space.remove();
  }
});
