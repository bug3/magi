/**
 * Calibration staleness and crash residue. The canaries' positive control
 * is manual and per-CLI-update; this module is the clock that couples it to
 * flag rot.
 * Every unproved state is a failure: a seated CLI version no PASSING
 * calibration row proved, version-less legacy rows, a ledger with no
 * calibration at all, and any leftover of an interrupted calibration (a
 * recovery sidecar, a nonce still in a live layer). Only a drifted
 * ambient layer warns, because editing your own config is routine.
 */

import type { LedgerCalibration } from "../consult/ledger.ts";

/** Calibration rows are not consult rows: the fold skips them, so doctor
 * reads them straight from the raw lines. */
export function readCalibrationRows(lines: readonly string[]): readonly LedgerCalibration[] {
  const rows: LedgerCalibration[] = [];
  for (const line of lines) {
    const text = line.trim();
    if (text === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    if (typeof (parsed as { readonly calibration?: unknown }).calibration === "string") {
      rows.push(parsed as LedgerCalibration);
    }
  }
  return rows;
}

export interface SeatedVersion {
  readonly harness: string;
  readonly version?: string;
}

export interface LayerFact {
  readonly harness: string;
  readonly path: string;
  /** sha256 of the current content, or "absent" when the file is missing. */
  readonly currentSha256: string;
  /** True when the layer still carries a calibration nonce line. */
  readonly hasNonceMarker: boolean;
}

export interface CalibrationHealthReport {
  readonly lastCalibratedAt?: string;
  /** Doctor fails on these: every unproved state, and crash residue (r19). */
  readonly failures: readonly string[];
  /** Doctor prints these and stays healthy (owner choice: layer drift). */
  readonly warnings: readonly string[];
}

export function calibrationHealth(inputs: {
  readonly rows: readonly LedgerCalibration[];
  readonly seated: readonly SeatedVersion[];
  readonly layers: readonly LayerFact[];
  readonly recoveryPending: boolean;
}): CalibrationHealthReport {
  const failures: string[] = [];
  const warnings: string[] = [];

  if (inputs.recoveryPending) {
    failures.push(
      "an interrupted calibration left a recovery sidecar; restore the layers from it by hand",
    );
  }
  for (const layer of inputs.layers) {
    if (layer.hasNonceMarker) {
      failures.push(`${layer.path} still carries a calibration nonce; restore it by hand`);
    }
  }

  // Owner revision (r19): an unproved state fails, it does not warn. The
  // canaries are per-repo artifacts scanned on every consult, so a fresh
  // ledger is honestly red until its own calibration runs, and a row that
  // cannot name what it proved proves nothing.
  const versioned = inputs.rows.filter((row) => row.cliVersions !== undefined);
  if (inputs.rows.length === 0) {
    failures.push(
      "no calibration recorded in this ledger; the canaries are unproved: " +
        "run magi doctor --calibrate",
    );
  } else if (versioned.length === 0) {
    failures.push(
      "calibration rows predate version recording and prove no seated version; " +
        "run magi doctor --calibrate",
    );
  } else {
    for (const seat of inputs.seated) {
      if (seat.version === undefined) continue;
      // Proof requires a PASSING row for this harness: a calibration that
      // watched a harness's isolation fail proves the opposite (the first
      // live run caught codex 0.148.0 leaking exactly this way).
      const proved = versioned.some(
        (row) =>
          (row.cliVersions ?? []).some(
            (entry) => entry.harness === seat.harness && entry.version === seat.version,
          ) &&
          row.results
            .filter((result) => result.harness === seat.harness)
            .every((result) => result.pass),
      );
      if (!proved) {
        failures.push(
          `${seat.harness} ${seat.version} has no passing calibration row; ` +
            "run magi doctor --calibrate",
        );
      }
    }
  }

  const lastHashes = [...versioned].reverse().find((row) => row.layerHashes !== undefined);
  for (const recorded of lastHashes?.layerHashes ?? []) {
    const layer = inputs.layers.find((fact) => fact.path === recorded.path);
    if (layer !== undefined && layer.currentSha256 !== recorded.sha256) {
      warnings.push(
        `${recorded.path} changed since the last calibration; recalibrate to re-prove its canary`,
      );
    }
  }

  const last = inputs.rows[inputs.rows.length - 1];
  return {
    ...(last === undefined ? {} : { lastCalibratedAt: last.recordedAt }),
    failures,
    warnings,
  };
}
