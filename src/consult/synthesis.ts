/**
 * The synthesis scaffold: every finding staged for an explicit disposition.
 *
 * Synthesis itself is orchestrator-authored judgment; this file only makes
 * the bookkeeping unavoidable. Every finding gets an adopt/reject line to
 * fill, an evidence-backed finding may be rejected only by citing
 * counter-evidence, and rejected findings stay in the document at the same
 * prominence as adopted ones: unresolved dissent is a first-class output.
 */

import type { ConsultStatus } from "../core/consult.ts";
import { slot } from "../core/slots.ts";
import type { SeatVerdict } from "./gate.ts";

export interface SynthesisInputs {
  readonly consult: string;
  readonly status: ConsultStatus;
  readonly verdicts: readonly SeatVerdict[];
}

export function renderSynthesisScaffold(inputs: SynthesisInputs): string {
  const lines: string[] = [
    `# Synthesis: ${inputs.consult}`,
    "",
    `Status: ${inputs.status}${inputs.status === "degraded" ? " (proceeds only on explicit user decision)" : ""}`,
    "",
    "## Seats",
    "",
    "| seat | valid | reasons |",
    "|---|---|---|",
  ];
  for (const verdict of inputs.verdicts) {
    const reasons = verdict.reasons.length === 0 ? "-" : verdict.reasons.join("; ");
    lines.push(`| ${slot(verdict.slot).label} | ${verdict.valid ? "yes" : "NO"} | ${reasons} |`);
  }

  lines.push("", "## Findings", "");
  let any = false;
  for (const verdict of inputs.verdicts) {
    if (verdict.opinion === undefined) continue;
    for (const finding of verdict.opinion.findings) {
      any = true;
      lines.push(
        `### ${slot(verdict.slot).label} ${finding.id} [${finding.severity}]`,
        "",
        `- claim: ${finding.claim}`,
        `- citations: ${finding.citations.join(", ")}`,
      );
      if (finding.check !== undefined) lines.push(`- proposed check: ${finding.check}`);
      if (finding.fix !== undefined) lines.push(`- proposed fix: ${finding.fix}`);
      lines.push(
        "- disposition: PENDING (adopt or reject with a one-line reason; an evidence-backed finding is rejected only by citing counter-evidence)",
        "",
      );
    }
  }
  if (!any) lines.push("No findings from valid seats.", "");

  lines.push(
    "## Dissent",
    "",
    "Rejected findings remain here at the same prominence as adopted ones.",
    "",
  );
  return `${lines.join("\n")}`;
}
