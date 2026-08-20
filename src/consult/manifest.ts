/**
 * The run manifest: what exactly was launched, against what inputs. It is
 * written before synthesis is read, so a dispute about what a seat saw is
 * settled by this file, not by memory.
 */

import { tryCapture } from "../runtime/exec.ts";
import type { ProfileSelection, SeatProfile } from "../core/profile.ts";
import type { EvidenceReport } from "../evidence/curate.ts";
import { writeFileDurable } from "../util/fs.ts";

export interface ManifestSeat {
  readonly slot: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly promptVia: string;
  readonly model: ProfileSelection;
  readonly reasoningEffort: ProfileSelection;
  readonly cliVersion: string | undefined;
}

export interface ConsultManifest {
  readonly consult: string;
  readonly mode: string;
  readonly createdAt: string;
  readonly templateSha256: string;
  readonly packSha256: string;
  /** The brief's non-pack fenced residue: what the budget admitted. */
  readonly briefFences: { readonly nonPackLines: number; readonly sha256?: string };
  /** What curation collected, derived, excluded and could not build. */
  readonly evidence: EvidenceReport;
  readonly repo: { readonly headSha: string; readonly dirty: boolean } | undefined;
  readonly seats: readonly ManifestSeat[];
}

export async function manifestSeat(profile: SeatProfile): Promise<ManifestSeat> {
  return {
    slot: profile.slot,
    command: profile.command,
    args: profile.args,
    promptVia: profile.promptVia,
    model: profile.model,
    reasoningEffort: profile.reasoningEffort,
    cliVersion: await tryCapture([profile.command, "--version"]),
  };
}

export function writeManifest(path: string, manifest: ConsultManifest): void {
  writeFileDurable(path, `${JSON.stringify(manifest, null, 2)}\n`);
}
