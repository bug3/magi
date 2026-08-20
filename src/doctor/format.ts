/**
 * Rendering doctor reports for the terminal. Seat stdout is foreign text and
 * goes through the sanitizer; everything else here is our own strings.
 */

import type { StateIgnoreStatus } from "../consult.ts";
import { slot } from "../core/slots.ts";
import { sanitizeLine } from "../util/text.ts";
import type { CalibrationReport } from "./calibrate.ts";
import type { CalibrationHealthReport } from "./calibration-health.ts";
import { COMPLETENESS_PARAMS, type ConsultCompleteness } from "./completeness.ts";
import type { SmokeResult } from "./live-smoke.ts";
import type { SkewReport } from "./skew.ts";
import type { StaticReport } from "./static-checks.ts";
import { VALUE_BAND, VALUE_CHECKPOINT_CONSULTS, type ValueReport } from "./value.ts";

/** One line per status; the two upper-case ones are what the report fails on. */
const STATE_IGNORE_LINE: Readonly<Record<StateIgnoreStatus, string>> = {
  ignored: ".magi/ is ignored",
  "not-git": "not a git repository; no ignore rule required",
  tracked: "TRACKED, remove .magi/ from version control",
  "not-ignored": "NOT IGNORED, add .magi/ to the repository's ignore rules",
};

export function formatStaticReport(report: StaticReport): string {
  const lines: string[] = ["magi doctor", ""];
  for (const seat of report.seats) {
    lines.push(`${slot(seat.slot).label} (${seat.profile.command})`);
    lines.push(`  version: ${seat.cliVersion ?? "NOT FOUND"}`);
    if (seat.undocumented === undefined) {
      lines.push("  flags:   help text unavailable, drift unknown");
    } else if (seat.undocumented.length === 0) {
      lines.push("  flags:   all documented in installed help");
    } else {
      lines.push(`  flags:   UNDOCUMENTED ${seat.undocumented.join(", ")}`);
    }
    lines.push(`  env:     ${Object.keys(seat.profile.env).sort().join(", ")}`);
  }
  lines.push("");
  lines.push(`state:  ${STATE_IGNORE_LINE[report.stateIgnore]}`);
  lines.push("");
  if (report.ledgerHealth.length === 0) {
    lines.push("ledger: no consult history");
  } else {
    for (const seat of report.ledgerHealth) {
      const flag = seat.chronic ? "  CHRONIC FAILURE" : "";
      lines.push(`ledger: ${seat.slot} ${seat.invalid}/${seat.appearances} invalid${flag}`);
    }
  }
  lines.push("", report.healthy ? "healthy" : "PROBLEMS FOUND", "");
  return lines.join("\n");
}

export function formatTelemetry(skew: SkewReport, value: ValueReport): string {
  const p = skew.params;
  const perFamily = skew.families
    .map((family) => {
      const gap =
        family.gapPoints === undefined ? "no data" : `gap ${family.gapPoints.toFixed(1)}`;
      return `${family.harness} ${family.adopted}/${family.total} (${gap})`;
    })
    .join(", ");
  const lines: string[] = [
    `family skew (window ${p.windowConsults} consults, floor ${p.minPerSide} per side, trip >${p.tripPoints}, clear <${p.clearPoints} or ${p.clearDwellConsults} under the line)`,
    `  window: ${skew.consultsInWindow} consults, ${skew.findingsInWindow} dispositioned findings`,
    `  melchior ${skew.melchior.adopted}/${skew.melchior.total} adopted, foreign ${skew.foreign.adopted}/${skew.foreign.total} adopted`,
    `  per-family: ${perFamily}`,
    `  armed:  ${skew.armed ? "yes" : "no"} (per-side floor ${p.minPerSide}: melchior ${skew.melchior.total}, foreign ${skew.foreign.total})`,
  ];
  const gap =
    skew.gapPoints === undefined ? "no gap computable" : `gap ${skew.gapPoints.toFixed(1)} points`;
  lines.push(
    skew.state === "tripped"
      ? `  state:  TRIPPED (${gap}): the foreign-draft contingency is ON` +
          (skew.armed ? "" : ", latched under the arming floor")
      : skew.state === "clear"
        ? `  state:  clear (${gap})`
        : "  state:  unarmed, the tripwire cannot fire",
  );
  const band = VALUE_BAND;
  lines.push(
    "",
    `value checkpoint (every ${VALUE_CHECKPOINT_CONSULTS} consults; provisional band pre-registered, revisions are ledger overrides)`,
    `  consults: ${value.consults}, adopted unique findings: ${value.adoptedUnique}`,
    value.adoptionRate === undefined
      ? "  adoption rate: no dispositions yet"
      : `  adoption rate: ${(value.adoptionRate * 100).toFixed(1)}% of ${value.dispositioned} dispositions adopted`,
    `  spend: ${value.inputTokens} in + ${value.outputTokens} out tokens, $${value.costUsd.toFixed(2)} where reported`,
    `  band: continue >=${band.continueAdoptedPerConsult} adopted-unique/consult; stop-consider <${band.stopConsiderAdoptedPerConsult} at ${band.stopConsiderConsecutiveCheckpoints} consecutive checkpoints;`,
    `        adjust over ${band.adjustTokensPerAdopted} tokens or $${band.adjustCostUsdPerAdopted} per adopted; stop locks after ${band.stopLockNonSelfConsults} non-self consults`,
  );
  if (value.checkpoint) {
    lines.push(`  adopted findings per consult: ${(value.adoptedPerConsult ?? 0).toFixed(2)}`);
    lines.push(
      value.costPerAdoptedUsd === undefined
        ? "  cost per adopted finding: n/a, nothing adopted"
        : `  cost per adopted finding: $${value.costPerAdoptedUsd.toFixed(3)} where reported`,
    );
    lines.push(
      "  checkpoint due: record an explicit continue/adjust/stop disposition and a proved-right/wrong pass (ledger override)",
    );
  } else {
    lines.push(`  next report in ${value.consultsUntilCheckpoint} consults`);
  }
  lines.push("");
  return lines.join("\n");
}

export function formatCompleteness(
  entries: readonly ConsultCompleteness[],
  params = COMPLETENESS_PARAMS,
): string {
  const lines = [
    `telemetry completeness (one disposition per consult-time-valid finding; overdue after ${params.overdueAfterConsults} newer consults)`,
  ];
  const tracked = entries.filter((entry) => entry.tracked);
  for (const entry of tracked.filter((candidate) => !candidate.complete)) {
    const conflicts =
      entry.conflicting.length === 0 ? "" : `, ${entry.conflicting.length} conflicting`;
    lines.push(
      `  ${entry.overdue ? "OVERDUE " : ""}${entry.consult}: ` +
        `${entry.missing.length} undispositioned of ${entry.expected}${conflicts} ` +
        `(${entry.ageConsults} consults old)`,
    );
  }
  const complete = tracked.filter((entry) => entry.complete).length;
  const untracked = entries.length - tracked.length;
  lines.push(
    `  complete: ${complete}/${tracked.length} tracked consults` +
      (untracked === 0 ? "" : `; ${untracked} pre-gate consults untracked`),
    "",
  );
  return lines.join("\n");
}

export function formatCalibration(report: CalibrationReport): string {
  const lines = [`canary calibration (nonce ${report.nonce})`];
  for (const result of report.results) {
    const seen = result.nonceSeen ? "nonce seen" : "nonce not seen";
    lines.push(
      `  ${result.harness} ${result.direction}: expected ${result.expectation}, ${seen}: ` +
        (result.pass ? "ok" : "FAILED"),
    );
  }
  for (const failure of report.restoreFailures) {
    lines.push(
      `  RESTORE REFUSED: ${failure.path} changed during calibration; ` +
        "recover it by hand from the recovery sidecar",
    );
  }
  lines.push(
    "",
    report.pass
      ? "calibration passed: the canaries were watched failing and recovering"
      : "CALIBRATION FAILED: an inert canary, an isolation leak or a refused restore, see above",
    "",
  );
  return lines.join("\n");
}

export function formatCalibrationHealth(report: CalibrationHealthReport): string {
  const lines = [
    `calibration health (last calibrated: ${report.lastCalibratedAt ?? "never in this ledger"})`,
  ];
  for (const failure of report.failures) lines.push(`  STALE ${failure}`);
  for (const warning of report.warnings) lines.push(`  warn: ${warning}`);
  if (report.failures.length === 0 && report.warnings.length === 0) {
    lines.push("  seated versions and ambient layers match the last calibration");
  }
  lines.push("");
  return lines.join("\n");
}

export function formatSmokeResults(results: readonly SmokeResult[]): string {
  const lines: string[] = ["live smoke (one minimal call per harness)", ""];
  for (const result of results) {
    lines.push(`${slot(result.slot).label}: ${result.outcome}, ${result.durationMs} ms`);
    lines.push(
      result.parsed
        ? "  output parsed as the launch profile promised"
        : `  OUTPUT DID NOT PARSE: ${result.parseReason ?? "unknown"}`,
    );
    if (result.canaryHits.length > 0) {
      lines.push(`  CANARY HIT: ${result.canaryHits.join(", ")}`);
    }
    lines.push(`  stdout: ${sanitizeLine(result.stdout, 120)}`);
  }
  lines.push("");
  return lines.join("\n");
}
