import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runProposedChecks } from "../../src/checks/run.ts";
import type { Opinion } from "../../src/consult/opinion.ts";

function opinionWithChecks(checks: ReadonlyArray<string | undefined>): Opinion {
  return {
    mode: "review",
    position: "p",
    findings: checks.map((check, at) => ({
      id: `F${at + 1}`,
      severity: "minor" as const,
      claim: "c",
      citations: ["E1"],
      ...(check === undefined ? {} : { check }),
    })),
    keepList: [],
    assumptions: [],
    confidence: 0.5,
  };
}

test("checks run without a shell in the repo cwd and every proposal is recorded", async () => {
  const root = mkdtempSync(join(tmpdir(), "magi-checks-"));
  try {
    const repoDir = join(root, "repo");
    const checksDir = join(root, "checks");
    mkdirSync(repoDir, { recursive: true });
    mkdirSync(checksDir, { recursive: true });
    writeFileSync(join(repoDir, "witness.txt"), "present\n");

    const records = await runProposedChecks({
      opinions: [
        {
          slot: "balthasar-2",
          opinion: opinionWithChecks([
            "ls witness.txt",
            "cat /etc/passwd",
            undefined, // a finding with no check proposes nothing
          ]),
        },
      ],
      repoDir,
      path: process.env["PATH"] as string,
      checksDir,
    });

    assert.equal(records.length, 2, "the checkless finding produces no record");

    const ran = records[0];
    assert.ok(ran);
    assert.equal(ran.decision, "ran");
    assert.deepEqual(ran.argv, ["ls", "witness.txt"]);
    assert.deepEqual(ran.outcome, { kind: "exit", code: 0 });
    assert.match(ran.stdout ?? "", /witness\.txt/);

    const refused = records[1];
    assert.ok(refused);
    assert.equal(refused.decision, "refused");
    assert.match(refused.reason ?? "", /absolute path/);
    assert.equal(refused.outcome, undefined, "a refused proposal never ran");

    assert.ok(existsSync(join(checksDir, "01-balthasar-2-F1.json")));
    const onDisk = JSON.parse(readFileSync(join(checksDir, "02-balthasar-2-F2.json"), "utf8"));
    assert.equal(onDisk.decision, "refused");
    assert.equal(onDisk.proposal, "cat /etc/passwd");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
