/**
 * Deterministic consult triggers. See `docs/protocol.md`, "Triggers".
 *
 * A trigger PROPOSES a consult: the user still approves every convene,
 * orchestrator judgment may add proposals and can never suppress a triggered
 * one. The size thresholds and the risk-domain seed are settings, imperfect
 * by design and revisable at value checkpoints: an unset trigger protects
 * nobody.
 */

export interface TriggerThresholds {
  /** Propose when the diff changes MORE than this many lines... */
  readonly diffLines: number;
  /** ...or touches MORE than this many files. Either alone is enough. */
  readonly touchedFiles: number;
}

/** An operator setting, revisable at the first value checkpoint. */
export const TRIGGER_THRESHOLDS: TriggerThresholds = { diffLines: 333, touchedFiles: 9 };

export interface RiskDomain {
  readonly id: string;
  readonly label: string;
  /** Matched against repo-relative paths; the contents are never read. */
  readonly pattern: RegExp;
}

/** The seed: six domains, grown by checkpoint revision. */
export const RISK_DOMAINS: readonly RiskDomain[] = [
  {
    id: "auth-credentials",
    label: "auth/credentials",
    pattern: /auth|credent|secret|token|passw/i,
  },
  {
    id: "persistence-migrations",
    label: "persistence/migrations",
    pattern: /migrat|\.sql$|schema/i,
  },
  {
    id: "concurrency",
    label: "concurrency primitives",
    pattern: /concurren|mutex|semaphore|atomic|(^|\/)worker/i,
  },
  {
    id: "public-api",
    label: "public API surfaces",
    pattern: /(^|\/)package\.json$|(^|\/)bin\/|(^|\/)cli(\.ts$|\/)|\.d\.ts$/,
  },
  {
    id: "release-ci",
    label: "release/CI config",
    pattern: /(^|\/)\.github\/|(^|\/)\.gitlab|(^|\/)Dockerfile|workflow|release/i,
  },
  {
    id: "magi-self",
    label: ".magi state and the seat profiles",
    pattern: /(^|\/)\.magi\/|(^|\/)seats\/profiles|(^|\/)prompts\//,
  },
];

export interface ChangedFile {
  readonly path: string;
  /** Added plus deleted lines; 0 for binary files. */
  readonly changedLines: number;
}

export interface TriggerProposal {
  /** "size", or "risk:<domain id>". */
  readonly id: string;
  readonly reason: string;
  /** The paths that put a risk domain on the table. */
  readonly paths?: readonly string[];
}

export function evaluateTriggers(
  changed: readonly ChangedFile[],
  thresholds: TriggerThresholds = TRIGGER_THRESHOLDS,
  domains: readonly RiskDomain[] = RISK_DOMAINS,
): readonly TriggerProposal[] {
  const proposals: TriggerProposal[] = [];
  const lines = changed.reduce((sum, file) => sum + file.changedLines, 0);
  if (lines > thresholds.diffLines || changed.length > thresholds.touchedFiles) {
    proposals.push({
      id: "size",
      reason:
        `${lines} changed lines across ${changed.length} files ` +
        `(over ${thresholds.diffLines} lines or ${thresholds.touchedFiles} files)`,
    });
  }
  for (const domain of domains) {
    const paths = changed
      .filter((file) => domain.pattern.test(file.path))
      .map((file) => file.path);
    if (paths.length > 0) {
      proposals.push({
        id: `risk:${domain.id}`,
        reason: `${domain.label}: ${paths.join(", ")}`,
        paths,
      });
    }
  }
  return proposals;
}

/** Parses `git diff --numstat`: "added<TAB>deleted<TAB>path", "-" for binary. */
export function parseNumstat(text: string): readonly ChangedFile[] {
  const lines = (value: string | undefined): number =>
    value === undefined || value === "-" ? 0 : Number(value) || 0;
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .flatMap((line) => {
      const [added, deleted, ...rest] = line.split("\t");
      const path = rest.join("\t");
      if (path === "") return [];
      return [{ path, changedLines: lines(added) + lines(deleted) }];
    });
}
