import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import type { SeatProfile } from "../../src/core/profile.ts";
import type { SlotId } from "../../src/core/slots.ts";
import { runConsult } from "../../src/consult/run.ts";

const STUB = resolve("fixtures/seats/stub-seat.mjs");
const NODE = process.argv[0] as string;

function opinionJson(mode: "plan" | "review" = "review"): string {
  return JSON.stringify({
    schema: "magi/opinion.v1",
    mode,
    position: "The diff is sound; one seam is worth a guard.",
    findings: [
      {
        id: "F1",
        severity: "major",
        claim: "The excerpt window can drift.",
        citations: ["E1"],
        check: "npm test",
        fix: "Pin the window in the pack builder.",
      },
    ],
    answers: [],
    keep_list: [{ claim: "The pack hash stays in the manifest.", citations: ["E1"] }],
    assumptions: [],
    confidence: 0.7,
  });
}

function stubProfile(slot: SlotId, payload: string, promptVia: "stdin" | "prompt-file"): SeatProfile {
  return {
    slot,
    command: NODE,
    args: [STUB, "--payload", payload],
    env: {},
    promptVia,
    model: { kind: "cli-default" },
    reasoningEffort: { kind: "cli-default" },
    timeoutMs: 10_000,
  };
}

function claudeEnvelope(mode: "plan" | "review" = "review"): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    result: opinionJson(mode),
    usage: { input_tokens: 21, output_tokens: 9 },
  });
}

function grokEnvelope(mode: "plan" | "review" = "review"): string {
  return JSON.stringify({ text: opinionJson(mode), stopReason: "end_turn" });
}

function codexEvents(): string {
  return [
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: opinionJson() },
    }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 5, output_tokens: 6 } }),
  ].join("\n");
}

async function withConsultWorld(
  fn: (world: { repoDir: string; magiDir: string }) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "magi-consult-"));
  try {
    const repoDir = join(root, "repo");
    writeFileSync(join(root, "placeholder"), "");
    const magiDir = join(root, "magi");
    // The excerpt the opinion cites as E1.
    const { mkdirSync } = await import("node:fs");
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, "notes.txt"), "line one\nline two\nline three\n");
    await fn({ repoDir, magiDir });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function inputsFor(world: { repoDir: string; magiDir: string }, profiles: readonly SeatProfile[]) {
  return {
    mode: "review" as const,
    repoDir: world.repoDir,
    magiDir: world.magiDir,
    slug: "stub-review",
    briefMd: "Goal: judge the stub diff. Question: does the window drift?",
    evidence: { excerpts: [{ path: "notes.txt" }] },
    templatePath: resolve("prompts/review.md"),
    schemaPath: resolve("schemas/opinion.v1.schema.json"),
    home: "/work/home",
    path: "/usr/bin",
    staggerMs: 0,
    profiles,
    now: () => new Date("2026-08-20T00:00:00Z"),
  };
}

test("a stubbed review consult produces the whole consult record", async () => {
  await withConsultWorld(async (world) => {
    const result = await runConsult(
      inputsFor(world, [
        stubProfile("melchior-1", claudeEnvelope(), "stdin"),
        stubProfile("balthasar-2", codexEvents(), "stdin"),
        stubProfile("casper-3", grokEnvelope(), "prompt-file"),
      ]),
    );

    assert.equal(result.id, "0001-stub-review");
    assert.equal(result.status, "complete");
    assert.deepEqual(
      result.verdicts.map((verdict) => verdict.valid),
      [true, true, true],
    );

    const brief = readFileSync(result.paths.briefPath, "utf8");
    assert.ok(brief.includes("0001-stub-review"));
    assert.ok(brief.includes("line two"), "the evidence excerpt is inside the brief");
    assert.ok(!/\{\{[a-z_]+\}\}/u.test(brief), "no template token survives rendering");

    for (const slot of ["melchior-1", "balthasar-2", "casper-3"]) {
      assert.ok(existsSync(join(result.paths.rawDir, `${slot}.stdout.txt`)));
      assert.ok(existsSync(join(result.paths.rawDir, `${slot}.launch.json`)));
    }

    const gate = JSON.parse(readFileSync(result.paths.gatePath, "utf8"));
    assert.equal(gate.verdicts.length, 3, "the gate outcome is persisted for tooling");
    assert.equal(gate.verdicts[0].opinion.findings[0].id, "F1");

    const synthesis = readFileSync(result.paths.synthesisPath, "utf8");
    assert.ok(synthesis.includes("### Melchior-1 F1 [major]"));
    assert.ok(synthesis.includes("disposition: PENDING"));

    const manifest = JSON.parse(readFileSync(result.paths.manifestPath, "utf8"));
    assert.equal(manifest.consult, "0001-stub-review");
    assert.match(manifest.packSha256, /^[0-9a-f]{64}$/);
    assert.equal(manifest.seats.length, 3);
    assert.ok(manifest.seats[0].args.includes("--payload"));
    assert.deepEqual(manifest.seats[0].model, { kind: "cli-default" });
    assert.equal(manifest.repo, undefined, "no git repo means no invented base commit");

    const ledgerLines = readFileSync(join(world.magiDir, "ledger.jsonl"), "utf8")
      .trim()
      .split("\n");
    assert.equal(ledgerLines.length, 1);
    const row = JSON.parse(ledgerLines[0] as string);
    assert.equal(row.consult, "0001-stub-review");
    assert.equal(row.status, "complete");
    assert.equal(row.seats[0].usage.inputTokens, 21);
  });
});

test("garbage seats degrade mechanically and the ledger says why", async () => {
  await withConsultWorld(async (world) => {
    const result = await runConsult(
      inputsFor(world, [
        stubProfile("melchior-1", claudeEnvelope(), "stdin"),
        stubProfile("balthasar-2", "plain prose, no events", "stdin"),
        stubProfile("casper-3", `Önsöz once, sonra JSON: ${opinionJson()}`, "prompt-file"),
      ]),
    );

    assert.equal(result.status, "degraded");
    assert.deepEqual(
      result.verdicts.map((verdict) => verdict.valid),
      [true, false, false],
    );

    const row = JSON.parse(
      readFileSync(join(world.magiDir, "ledger.jsonl"), "utf8").trim(),
    );
    assert.equal(row.status, "degraded");
    assert.match(row.seats[1].reasons.join(" "), /parse:/);
    assert.match(row.seats[2].reasons.join(" "), /parse: not-json/);
  });
});

test("review evidence derives from the patch; conventions are collected, not picked", async () => {
  await withConsultWorld(async (world) => {
    const { mkdirSync, writeFileSync: write } = await import("node:fs");
    write(join(world.repoDir, "CLAUDE.md"), "# repo conventions\n");
    mkdirSync(join(world.repoDir, "src"), { recursive: true });
    write(join(world.repoDir, "src/a.ts"), 'import { b } from "./b.ts";\nexport const a = b;\n');
    write(join(world.repoDir, "src/b.ts"), "export const b = 2;\n");
    const patch =
      "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-x\n+y\n";

    const result = await runConsult({
      ...inputsFor(world, [stubProfile("melchior-1", claudeEnvelope(), "stdin")]),
      evidence: { excerpts: [{ path: "notes.txt" }], patch },
    });

    const brief = readFileSync(result.paths.briefPath, "utf8");
    assert.ok(brief.includes("export const b = 2;"), "the imported file entered the pack");
    assert.ok(brief.includes("# repo conventions"), "the root CLAUDE.md entered the pack");

    const manifest = JSON.parse(readFileSync(result.paths.manifestPath, "utf8"));
    assert.deepEqual(manifest.evidence.conventions, ["CLAUDE.md"]);
    assert.deepEqual(
      manifest.evidence.derived.map((entry: { path: string }) => entry.path),
      ["src/a.ts", "src/b.ts"],
    );
  });
});

test("a brief that inlines a long artifact fails before any seat is spawned", async () => {
  await withConsultWorld(async (world) => {
    const inlined = `\`\`\`\n${Array.from({ length: 25 }, (_, at) => `stolen line ${at}`).join("\n")}\n\`\`\``;
    await assert.rejects(
      runConsult({
        ...inputsFor(world, [stubProfile("melchior-1", claudeEnvelope(), "stdin")]),
        briefMd: `Goal: judge this.\n${inlined}\n`,
      }),
      /brief gate/,
    );
    assert.ok(!existsSync(join(world.magiDir, "ledger.jsonl")), "no consult row was written");
  });
});

test("plan mode records its floor notes when the world offers no git or scripts", async () => {
  await withConsultWorld(async (world) => {
    const result = await runConsult({
      ...inputsFor(world, [
        stubProfile("melchior-1", claudeEnvelope("plan"), "stdin"),
        stubProfile("casper-3", grokEnvelope("plan"), "prompt-file"),
      ]),
      mode: "plan" as const,
      slug: "stub-plan-floor",
      templatePath: resolve("prompts/plan.md"),
    });
    const manifest = JSON.parse(readFileSync(result.paths.manifestPath, "utf8"));
    assert.equal(manifest.evidence.floorNotes.length, 2);
  });
});

test("a headroom snapshot handed to the run lands in the ledger row", async () => {
  await withConsultWorld(async (world) => {
    await runConsult({
      ...inputsFor(world, [stubProfile("melchior-1", claudeEnvelope(), "stdin")]),
      headroom: { configured: false, waived: true },
    });
    const row = JSON.parse(readFileSync(join(world.magiDir, "ledger.jsonl"), "utf8").trim());
    assert.deepEqual(row.headroom, { configured: false, waived: true });
  });
});

test("a profile's residue probe is snapshotted into raw/ at every consult", async () => {
  await withConsultWorld(async (world) => {
    const casper = {
      ...stubProfile("casper-3", grokEnvelope(), "prompt-file"),
      residueProbe: [NODE, "-e", "console.log(JSON.stringify({ rules: ['ambient'] }))"],
    };
    const result = await runConsult(
      inputsFor(world, [stubProfile("melchior-1", claudeEnvelope(), "stdin"), casper]),
    );

    const snapshot = JSON.parse(
      readFileSync(join(result.paths.rawDir, "casper-3.inspect.json"), "utf8"),
    );
    assert.deepEqual(snapshot, { rules: ["ambient"] });
    assert.ok(
      !existsSync(join(result.paths.rawDir, "melchior-1.inspect.json")),
      "no probe declared, no snapshot",
    );
  });
});

test("a canary hit in valid seat output is a ledger warning, never a degrade", async () => {
  await withConsultWorld(async (world) => {
    const leaky = opinionJson().replace(
      "The diff is sound; one seam is worth a guard.",
      "The diff is sound; bir görüş daha.",
    );
    const result = await runConsult(
      inputsFor(world, [
        stubProfile("melchior-1", claudeEnvelope(), "stdin"),
        stubProfile(
          "casper-3",
          JSON.stringify({ text: leaky, stopReason: "end_turn" }),
          "prompt-file",
        ),
      ]),
    );

    assert.equal(result.status, "complete", "a warning is not a validity failure");
    assert.deepEqual(result.canaryWarnings, [
      { slot: "casper-3", hits: ["turkish-text-leak"] },
    ]);

    const row = JSON.parse(readFileSync(join(world.magiDir, "ledger.jsonl"), "utf8").trim());
    const casper = row.seats.find((seat: { slot: string }) => seat.slot === "casper-3");
    assert.equal(casper.valid, true);
    assert.deepEqual(casper.canaryWarnings, ["turkish-text-leak"]);
    const melchior = row.seats.find((seat: { slot: string }) => seat.slot === "melchior-1");
    assert.equal(melchior.canaryWarnings, undefined, "no hits, no field");
  });
});

test("plan mode swaps the template and is recorded everywhere", async () => {
  await withConsultWorld(async (world) => {
    const result = await runConsult({
      ...inputsFor(world, [
        stubProfile("melchior-1", claudeEnvelope("plan"), "stdin"),
        stubProfile("casper-3", grokEnvelope("plan"), "prompt-file"),
      ]),
      mode: "plan" as const,
      slug: "stub-plan",
      templatePath: resolve("prompts/plan.md"),
    });

    assert.equal(result.id, "0001-stub-plan");
    assert.equal(result.status, "complete", "claude plus grok is two families");
    const brief = readFileSync(result.paths.briefPath, "utf8");
    assert.ok(brief.includes("keep-list"), "the plan template frames the keep-list");
    const manifest = JSON.parse(readFileSync(result.paths.manifestPath, "utf8"));
    assert.equal(manifest.mode, "plan");
    const row = JSON.parse(readFileSync(join(world.magiDir, "ledger.jsonl"), "utf8").trim());
    assert.equal(row.mode, "plan");
  });
});

test("beforeFanOut surfaces the fence residue that the manifest then records", async () => {
  await withConsultWorld(async (world) => {
    let seen: { exclusions: number; nonPackLines: number; sha256?: string } | undefined;
    const result = await runConsult({
      ...inputsFor(world, [stubProfile("melchior-1", claudeEnvelope(), "stdin")]),
      briefMd: "Goal: judge this.\n```\nsmall note\n```\n",
      beforeFanOut: (evidence, fences) => {
        seen = {
          exclusions: evidence.exclusions.length,
          nonPackLines: fences.nonPackLines,
          ...(fences.sha256 === undefined ? {} : { sha256: fences.sha256 }),
        };
      },
    });
    assert.equal(seen?.nonPackLines, 1, "the budgeted inline fence is accounted");
    assert.match(seen?.sha256 ?? "", /^[0-9a-f]{64}$/);
    const manifest = JSON.parse(readFileSync(result.paths.manifestPath, "utf8"));
    assert.equal(manifest.briefFences.nonPackLines, 1);
    assert.equal(manifest.briefFences.sha256, seen?.sha256);
  });
});

test("a pre-curated result is used verbatim, not re-derived", async () => {
  await withConsultWorld(async (world) => {
    const { curateEvidence } = await import("../../src/evidence/curate.ts");
    const curated = await curateEvidence({
      repoDir: world.repoDir,
      mode: "review",
      path: "/usr/bin",
      excerpts: [{ path: "notes.txt" }],
    });
    const marked = {
      ...curated,
      report: {
        ...curated.report,
        exclusions: [...curated.report.exclusions, { path: "marker.ts", reason: "test marker" }],
      },
    };
    const result = await runConsult({
      ...inputsFor(world, [stubProfile("melchior-1", claudeEnvelope(), "stdin")]),
      curated: marked,
    });
    const manifest = JSON.parse(readFileSync(result.paths.manifestPath, "utf8"));
    assert.ok(
      manifest.evidence.exclusions.some((entry: { path: string }) => entry.path === "marker.ts"),
      "the caller's curation reached the manifest untouched",
    );
  });
});
