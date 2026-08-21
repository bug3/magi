/**
 * The project's own check output, made fit to travel in every pack.
 *
 * The floor runs the repository's declared check and carried its transcript
 * verbatim. On this tree that is some four hundred lines of per-case ticks,
 * which every seat pays for in tokens and reads nothing from. Worse, the
 * transcript carries per-case timings, a total duration and whatever notices
 * the package manager felt like printing, so two consults on the identical
 * commit produced different bytes and therefore a different pack hash: a
 * pack that cannot be compared to itself is a poor witness.
 *
 * What a seat needs from a check is whether it passed and, if not, exactly
 * what failed. So a passing case collapses to a count and a failing one
 * survives byte for byte, and everything that varies between two runs of the
 * same commit is dropped rather than hashed.
 *
 * The patterns are deliberately narrow. This runs against whatever check a
 * repository declares, and a line this cannot recognise is kept, because
 * dropping an unrecognised line would be the one failure mode worth avoiding.
 */

/** A case that passed: node:test's tick and TAP's `ok`, at any indent. */
const PASSING = /^\s*(?:✔|ok \d+)/u;

/** What differs between two runs of the same commit. */
const RUN_VARYING = /^\s*(?:npm notice|npm warn deprecated|(?:ℹ|#) duration_ms\b)/u;

/** A trailing `(1.234ms)` a case reports for itself. */
const CASE_TIMING = /\s*\(\d+(?:\.\d+)?m?s\)\s*$/u;

export interface CondensedCheck {
  readonly text: string;
  /** Passing cases folded away; reported so the count is not simply lost. */
  readonly collapsed: number;
}

export function condenseCheckOutput(output: string): CondensedCheck {
  const kept: string[] = [];
  let collapsed = 0;

  for (const raw of output.split("\n")) {
    if (RUN_VARYING.test(raw)) continue;
    if (PASSING.test(raw)) {
      collapsed += 1;
      continue;
    }
    kept.push(raw.replace(CASE_TIMING, ""));
  }

  while (kept.length > 0 && (kept[kept.length - 1] as string).trim() === "") kept.pop();
  if (collapsed > 0) kept.push(`(${collapsed} passing cases collapsed; failures are verbatim)`);
  return { text: kept.length === 0 ? "" : `${kept.join("\n")}\n`, collapsed };
}
