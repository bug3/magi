/**
 * `magi doctor [--live] [--calibrate]`: quota-free static checks and
 * telemetry by default; live smoke and canary calibration spend quota and
 * run only behind their explicit flags.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { foldLedger } from "../consult.ts";
import { SLOTS } from "../core/slots.ts";
import {
  CALIBRATION_LAYERS,
  NONCE_MARKER,
  RECOVERY_FILE,
  calibrateCanaries,
  calibrationHealth,
  completenessFromLedger,
  formatCalibration,
  formatCalibrationHealth,
  formatCompleteness,
  formatSkillLinks,
  formatSmokeResults,
  formatStaticReport,
  formatTelemetry,
  gateExpectedReader,
  liveSmoke,
  readCalibrationRows,
  skewFromLedger,
  staticChecks,
  valueFromLedger,
} from "../doctor.ts";
import { skillProblem, skillStatus } from "../skill.ts";
import { sha256Text } from "../util/fs.ts";
import { MAGI_ROOT, SKILL_SOURCE, ambient } from "./environment.ts";

export async function doctorCommand(rest: readonly string[]): Promise<number> {
  const unknown = rest.find((flag) => flag !== "--live" && flag !== "--calibrate");
  if (unknown !== undefined) {
    console.error(`unknown doctor flag: ${unknown}`);
    return 2;
  }
  const live = rest.includes("--live");
  const repoDir = process.cwd();
  const { home, path } = ambient();
  const schemaPath = join(MAGI_ROOT, "schemas", "opinion.v1.schema.json");
  const ledgerFile = join(repoDir, ".magi", "ledger.jsonl");

  const report = await staticChecks({
    briefPath: "<consult>/brief.md",
    schemaPath,
    schemaJson: JSON.stringify(JSON.parse(readFileSync(schemaPath, "utf8"))),
    repoDir,
    home,
    path,
    ledgerPath: ledgerFile,
  });
  console.log(formatStaticReport(report));

  // An installation that moved leaves the harness link behind, and nothing
  // else notices until the orchestrator reaches for the skill.
  const skills = SLOTS.map((definition) => skillStatus(definition.harness, home, SKILL_SOURCE));
  console.log(formatSkillLinks(skills));

  const consults = existsSync(ledgerFile)
    ? foldLedger(readFileSync(ledgerFile, "utf8").split("\n"))
    : [];
  const magiDir = join(repoDir, ".magi");
  console.log(
    formatCompleteness(completenessFromLedger(consults, gateExpectedReader(magiDir, consults))),
  );
  console.log(formatTelemetry(skewFromLedger(consults), valueFromLedger(consults)));
  let healthy = report.healthy && !skills.some(skillProblem);

  if (live) {
    const workDir = join(repoDir, ".magi", "doctor");
    mkdirSync(workDir, { recursive: true });
    const results = await liveSmoke({ repoDir, home, path, workDir });
    console.log(formatSmokeResults(results));
    healthy =
      healthy && results.every((result) => result.parsed && result.canaryHits.length === 0);
  }

  if (rest.includes("--calibrate")) {
    const workDir = join(repoDir, ".magi", "doctor");
    mkdirSync(workDir, { recursive: true });
    const calibration = await calibrateCanaries({
      home,
      path,
      repoDir,
      workDir,
      ledgerPath: ledgerFile,
      nonce: `magi-canary-${Date.now().toString(36)}`,
    });
    console.log(formatCalibration(calibration));
    healthy = healthy && calibration.pass;
  }

  // Compute health after an optional calibration so a successful first
  // calibration proves the current state in the same command invocation.
  const ledgerLines = existsSync(ledgerFile)
    ? readFileSync(ledgerFile, "utf8").split("\n")
    : [];
  const health = calibrationHealth({
    rows: readCalibrationRows(ledgerLines),
    seated: report.seats.map((seat) => ({
      harness: SLOTS.find((definition) => definition.id === seat.slot)?.harness ?? seat.slot,
      ...(seat.cliVersion === undefined ? {} : { version: seat.cliVersion }),
    })),
    layers: CALIBRATION_LAYERS.map((layer) => {
      const target = layer.target({ home, repoDir });
      const content = existsSync(target) ? readFileSync(target, "utf8") : undefined;
      return {
        harness: layer.harness,
        path: target,
        currentSha256: content === undefined ? "absent" : sha256Text(content),
        hasNonceMarker: content?.includes(NONCE_MARKER) ?? false,
      };
    }),
    recoveryPending: existsSync(join(repoDir, ".magi", "doctor", RECOVERY_FILE)),
  });
  console.log(formatCalibrationHealth(health));
  healthy = healthy && health.failures.length === 0;
  return healthy ? 0 : 1;
}
