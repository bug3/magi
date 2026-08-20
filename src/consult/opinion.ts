/**
 * The opinion contract as TypeScript sees it after validation.
 *
 * Enforcement lives in schemas/opinion.v1.schema.json; these types mirror it
 * for readers inside the process, and the schema fixture tests hold the two
 * in step. normalizeOpinion runs only on documents the compiled schema has
 * already accepted, so it maps shapes and does not re-police them.
 */

import type { ConsultMode } from "../core/consult.ts";

export type Severity = "blocker" | "major" | "minor";

export interface OpinionFinding {
  readonly id: string;
  readonly severity: Severity;
  readonly claim: string;
  readonly citations: readonly string[];
  readonly check?: string;
  readonly fix?: string;
}

export interface OpinionAnswer {
  readonly question: string;
  readonly answer: string;
}

export interface OpinionKeep {
  readonly claim: string;
  readonly citations?: readonly string[];
}

export interface Opinion {
  readonly mode: ConsultMode;
  readonly position: string;
  readonly findings: readonly OpinionFinding[];
  readonly answers?: readonly OpinionAnswer[];
  readonly keepList: readonly OpinionKeep[];
  readonly assumptions: readonly string[];
  readonly confidence: number;
}

export function normalizeOpinion(validated: unknown): Opinion {
  const document = validated as Record<string, unknown>;
  const findings = (document["findings"] as readonly Record<string, unknown>[]).map(
    (finding) =>
      ({
        id: finding["id"],
        severity: finding["severity"],
        claim: finding["claim"],
        citations: finding["citations"],
        // Strict engines encode "no check offered" as null; absent stays
        // absent for readers either way.
        ...(finding["check"] == null ? {} : { check: finding["check"] }),
        ...(finding["fix"] == null ? {} : { fix: finding["fix"] }),
      }) as OpinionFinding,
  );
  const answers = document["answers"] as readonly OpinionAnswer[] | undefined;
  return {
    mode: document["mode"] as ConsultMode,
    position: document["position"] as string,
    findings,
    ...(answers === undefined ? {} : { answers }),
    keepList: (document["keep_list"] as readonly Record<string, unknown>[]).map(
      (keep) =>
        ({
          claim: keep["claim"],
          ...(keep["citations"] === undefined ? {} : { citations: keep["citations"] }),
        }) as OpinionKeep,
    ),
    assumptions: document["assumptions"] as readonly string[],
    confidence: document["confidence"] as number,
  };
}

/** Every citation the opinion leans on, findings and keep-list alike. */
export function citedIds(opinion: Opinion): readonly string[] {
  const ids = new Set<string>();
  for (const finding of opinion.findings) {
    for (const citation of finding.citations) ids.add(citation);
  }
  for (const keep of opinion.keepList) {
    for (const citation of keep.citations ?? []) ids.add(citation);
  }
  return [...ids];
}
