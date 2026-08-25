/**
 * `magi checks <consult-id>`: plans every seat-proposed check against the
 * vocabulary, runs only what matches, and records every proposal.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { runProposedChecks, type CheckRecord } from "../checks.ts";
import { consultPaths, type SeatVerdict } from "../consult.ts";
import { consultId } from "../core/ids.ts";
import { slot } from "../core/slots.ts";
import { sanitizeLine } from "../util/text.ts";
import {
  close,
  commandUsage,
  detail,
  open,
  problem,
  refuseCommand,
  transcript,
  verdict,
} from "../util/ui.ts";
import { ambient } from "./environment.ts";
import { commandScreen, parseArgv, type Grammar } from "./parse.ts";

/** Checks takes no flag: one consult id, and nothing beside it. */
export const CHECKS_GRAMMAR: Grammar = (command) =>
  command
    .description("run the checks the seats proposed for one consult")
    .argument("[consult-id]", "the consult whose proposed checks are run");

export async function checksCommand(rest: readonly string[]): Promise<number> {
  const parsed = parseArgv("magi checks", CHECKS_GRAMMAR, rest);
  if (parsed.kind === "help") {
    commandUsage(parsed.screen);
    return 0;
  }
  if (parsed.kind === "refused") {
    problem(parsed.reason);
    return 2;
  }
  const rawId = parsed.args[0];
  // Told what to do but not to what: the whole screen, because somebody who
  // types the command without its one argument is asking what it takes.
  if (rawId === undefined) {
    problem("checks needs a consult id");
    refuseCommand(commandScreen("magi checks", CHECKS_GRAMMAR));
    return 2;
  }
  const { path } = ambient();
  const repoDir = process.cwd();
  let id;
  try {
    id = consultId(rawId);
  } catch (error) {
    problem(String((error as Error).message));
    return 2;
  }
  const paths = consultPaths(join(repoDir, ".magi"), id);
  if (!existsSync(paths.gatePath)) {
    problem(`no gate record at ${paths.gatePath}; run the consult first`);
    return 2;
  }

  const verdicts = (
    JSON.parse(readFileSync(paths.gatePath, "utf8")) as { verdicts: SeatVerdict[] }
  ).verdicts;
  const opinions = verdicts
    .filter((verdict) => verdict.valid && verdict.opinion !== undefined)
    .map((verdict) => ({
      slot: verdict.slot,
      opinion: verdict.opinion as NonNullable<typeof verdict.opinion>,
    }));

  open(`magi checks ${id}`);
  // The proposals run as real subprocesses, one at a time, so the wait is
  // real. On a terminal each one keeps what it printed under its own line
  // while it runs; down a pipe it is the two lines it has always been.
  const runs = transcript(`planning the checks proposed by ${opinions.length} valid seats`);
  const records = await runProposedChecks({
    opinions,
    repoDir,
    path,
    checksDir: paths.checksDir,
    onRecord: (record) => {
      runs.ran(row(record), passed(record), printed(record));
    },
  });
  runs.done(`${records.length} proposed check${records.length === 1 ? "" : "s"}`);

  // Already said, run by run, where the runs were drawn as they happened.
  if (!runs.drawn) {
    for (const record of records) verdict(row(record), record.decision === "ran");
  }
  if (records.length === 0) detail("no seat-proposed checks in this consult");
  close(`records: ${paths.checksDir}`);
  return 0;
}

/**
 * One proposal's line. A refusal here is the vocabulary doing its job, not a
 * failed run, so it is reported on stdout beside the runs and never as a
 * stderr refusal.
 */
function row(record: CheckRecord): string {
  const label = `${slot(record.slot).label} ${record.finding}`;
  if (record.decision === "refused") {
    return `${label}: REFUSED (${sanitizeLine(record.reason ?? "", 120)})`;
  }
  const outcome =
    record.outcome?.kind === "exit" ? `exit ${record.outcome.code}` : record.outcome?.kind;
  return `${label}: ran [${record.argv?.join(" ")}] -> ${outcome}, ${record.durationMs} ms`;
}

/**
 * Whether a proposal needs no further reading: it ran, and it ran clean. The
 * piped rows keep their older and coarser split, where anything that reached a
 * subprocess is a run and only a refusal is not; what this decides is which
 * runs keep their output on screen, and a check that exited non-zero is
 * exactly the one somebody opened this command for.
 */
function passed(record: CheckRecord): boolean {
  return record.decision === "ran" && record.outcome?.kind === "exit" && record.outcome.code === 0;
}

/** What the run put on either stream, which is the part nobody could see. */
function printed(record: CheckRecord): string {
  return [record.stdout ?? "", record.stderr ?? ""].filter((text) => text !== "").join("\n");
}
