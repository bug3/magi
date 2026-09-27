import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { formatStaticReport } from "../../src/doctor/format.ts";
import { staticChecks, type StaticProbes } from "../../src/doctor/static-checks.ts";

const INPUTS = {
  briefPath: "/tmp/brief.md",
  schemaPath: "/tmp/contract.json",
  schemaJson: '{"type":"object"}',
  repoDir: "/tmp/repo",
  home: "/work/home",
  user: "seat",
  path: "/usr/bin",
  skills: [],
  ledgerPath: "/nonexistent/ledger.jsonl",
};

/** Every declared residue probe runs; a profile without one has nothing to run. */
const probesRun: StaticProbes["residue"] = (profile) =>
  Promise.resolve(profile.residueProbe === undefined ? undefined : { ok: true });

/** Help that documents everything: echo the probed argv's flags back. */
function allDocumented(): StaticProbes {
  return {
    residue: probesRun,
    capture: (argv) =>
      Promise.resolve(argv.includes("--version") ? "9.9.9" : "--".concat("everything --verbatim --safe-mode --tools --disallowed-tools -p -C -c --output-format --model --ignore-user-config --ignore-rules --ephemeral --strict-config --sandbox --skip-git-repo-check --json --output-schema --prompt-file --json-schema --permission-mode --disable-web-search --no-subagents --max-turns --reasoning-effort")),
  };
}

test("fully documented profiles with versions probe healthy", async () => {
  const report = await staticChecks(INPUTS, allDocumented());
  assert.equal(report.healthy, true);
  assert.equal(report.seats.length, 3);
  for (const seat of report.seats) {
    assert.equal(seat.cliVersion, "9.9.9");
    assert.deepEqual(seat.undocumented, []);
  }
  assert.ok(formatStaticReport(report).includes("healthy"));
});

test("a flag missing from help is named, and the report is unhealthy", async () => {
  const probes: StaticProbes = {
    residue: probesRun,
    capture: (argv) =>
      Promise.resolve(
        argv.includes("--version")
          ? "9.9.9"
          : "everything except the schema flags --verbatim --safe-mode --tools --disallowed-tools -p -C -c --output-format --model --ignore-user-config --ignore-rules --ephemeral --strict-config --sandbox --skip-git-repo-check --json --prompt-file --permission-mode --disable-web-search --no-subagents --max-turns --reasoning-effort",
      ),
  };
  const report = await staticChecks(INPUTS, probes);
  assert.equal(report.healthy, false);
  const balthasar = report.seats.find((seat) => seat.slot === "balthasar-2");
  assert.ok(balthasar?.undocumented?.includes("--output-schema"));
  assert.ok(formatStaticReport(report).includes("UNDOCUMENTED"));
});

test("a CLI that answers nothing is unhealthy, not silently skipped", async () => {
  const probes: StaticProbes = { capture: () => Promise.resolve(undefined), residue: probesRun };
  const report = await staticChecks(INPUTS, probes);
  assert.equal(report.healthy, false);
  assert.ok(formatStaticReport(report).includes("NOT FOUND"));
});

// A probe that stopped running is found at a consult only as a failure record
// nobody reads, and the snapshot a canary warning is read against is missing.
test("a residue probe that fails is named, and the report is unhealthy", async () => {
  const probes: StaticProbes = {
    ...allDocumented(),
    residue: (profile) =>
      Promise.resolve(
        profile.residueProbe === undefined
          ? undefined
          : profile.slot === "casper-3"
            ? { ok: false, reason: "exit 2: unknown command" }
            : { ok: true },
      ),
  };
  const report = await staticChecks(INPUTS, probes);
  assert.equal(report.healthy, false);
  const casper = report.seats.find((seat) => seat.slot === "casper-3");
  assert.deepEqual(casper?.residueProbe, { ok: false, reason: "exit 2: unknown command" });
  assert.match(
    formatStaticReport(report),
    /residue: PROBE FAILED \(grok inspect --json\): exit 2: unknown command/u,
  );
});

test("a seat without a residue probe reports nothing to probe and stays healthy", async () => {
  const report = await staticChecks(INPUTS, allDocumented());
  const melchior = report.seats.find((seat) => seat.slot === "melchior-1");
  assert.equal(melchior?.residueProbe, undefined);
  assert.equal(report.healthy, true);
  assert.match(formatStaticReport(report), /residue: probe runs \(grok inspect --json\)/u);
});

test("chronic ledger failure turns the report unhealthy", async () => {
  const dir = mkdtempSync(join(tmpdir(), "magi-doctor-"));
  try {
    const ledger = join(dir, "ledger.jsonl");
    const bad = JSON.stringify({ seats: [{ slot: "casper-3", valid: false }] });
    writeFileSync(ledger, `${bad}\n${bad}\n${bad}\n`);
    const report = await staticChecks({ ...INPUTS, ledgerPath: ledger }, allDocumented());
    assert.equal(report.healthy, false);
    assert.ok(formatStaticReport(report).includes("CHRONIC FAILURE"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a skill link that stopped resolving makes the whole report unhealthy", async () => {
  const report = await staticChecks(
    {
      ...INPUTS,
      skills: [{ harness: "claude", path: "/h/.claude/skills/magi", state: "stale" }],
    },
    allDocumented(),
  );
  assert.equal(report.healthy, false);
  const text = formatStaticReport(report);
  assert.match(text, /STALE/u, "the link is named above the verdict");
  assert.match(text, /PROBLEMS FOUND/u, "and the verdict is about it");
});
