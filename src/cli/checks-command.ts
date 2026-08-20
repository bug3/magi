/**
 * `magi checks <consult-id>`: plans every seat-proposed check against the
 * vocabulary, runs only what matches, and records every proposal.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { runProposedChecks } from "../checks.ts";
import { consultPaths, type SeatVerdict } from "../consult.ts";
import { consultId } from "../core/ids.ts";
import { slot } from "../core/slots.ts";
import { sanitizeLine } from "../util/text.ts";
import { ambient } from "./environment.ts";

export async function checksCommand(
  rest: readonly string[],
  usage: string,
): Promise<number> {
  const rawId = rest[0];
  if (rawId === undefined) {
    console.error("checks needs a consult id");
    console.error(usage);
    return 2;
  }
  if (rest.length !== 1) {
    console.error(`unknown checks argument: ${rest[1]}`);
    return 2;
  }
  const { path } = ambient();
  const repoDir = process.cwd();
  let id;
  try {
    id = consultId(rawId);
  } catch (error) {
    console.error(String((error as Error).message));
    return 2;
  }
  const paths = consultPaths(join(repoDir, ".magi"), id);
  if (!existsSync(paths.gatePath)) {
    console.error(`no gate record at ${paths.gatePath}; run the consult first`);
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

  const records = await runProposedChecks({
    opinions,
    repoDir,
    path,
    checksDir: paths.checksDir,
  });
  for (const record of records) {
    const label = `${slot(record.slot).label} ${record.finding}`;
    if (record.decision === "refused") {
      console.log(`${label}: REFUSED (${sanitizeLine(record.reason ?? "", 120)})`);
    } else {
      const outcome =
        record.outcome?.kind === "exit" ? `exit ${record.outcome.code}` : record.outcome?.kind;
      console.log(
        `${label}: ran [${record.argv?.join(" ")}] -> ${outcome}, ${record.durationMs} ms`,
      );
    }
  }
  if (records.length === 0) console.log("no seat-proposed checks in this consult");
  console.log(`records: ${paths.checksDir}`);
  return 0;
}
