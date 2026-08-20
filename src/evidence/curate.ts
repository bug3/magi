/**
 * Mode-aware evidence curation. See `docs/protocol.md`, "The evidence
 * pack". What buildEvidencePack is handed gets assembled here by rule, and everything the rules did
 * (collected conventions and their conflicts, derivations, patch provenance,
 * exclusions, floor notes) is reported for the manifest, so curation stays
 * inspectable after the fact.
 */

import type { ConsultMode } from "../core/consult.ts";
import { collectConventions } from "./conventions.ts";
import { deriveFromPatch, type DerivedEvidence } from "./derive.ts";
import { patchShortfall, pinPatch } from "./patch-pin.ts";
import { repoFloor } from "./repo-floor.ts";
import type { EvidencePackInputs, ExcerptRequest } from "./types.ts";

export interface CurateInputs {
  readonly repoDir: string;
  readonly mode: ConsultMode;
  readonly excerpts: readonly ExcerptRequest[];
  readonly patch?: string;
  /** Pin the review patch against this git ref: without a caller
   * patch the diff derives from git; beside one, the delta is compared and
   * every scoped-out file recorded as an exclusion. */
  readonly base?: string;
  readonly testOutput?: string;
  /** PATH for the repository floor's check run. */
  readonly path: string;
}

/** The manifest's record of what curation did, and what it left out. */
export interface EvidenceReport {
  readonly conventions: readonly string[];
  readonly conflicts: readonly string[];
  readonly derived: readonly { readonly path: string; readonly note: string }[];
  readonly exclusions: readonly { readonly path: string; readonly reason: string }[];
  readonly floorNotes: readonly string[];
  /** Where the review patch came from; absent when there is none. */
  readonly patch?: {
    readonly provenance: "derived-from-git" | "caller-supplied-checked" | "caller-supplied-unpinned";
    readonly baseSha?: string;
    readonly headSha?: string;
    readonly dirty?: boolean;
  };
}

export interface CuratedEvidence {
  readonly pack: EvidencePackInputs;
  readonly report: EvidenceReport;
}

const NO_DERIVATION: DerivedEvidence = { excerpts: [], exclusions: [] };


export async function curateEvidence(inputs: CurateInputs): Promise<CuratedEvidence> {
  const manual =
    inputs.mode === "plan"
      ? inputs.excerpts.map((excerpt) => ({
          ...excerpt,
          note: excerpt.note ?? "orchestrator-chosen excerpt: commentary beside the floor",
        }))
      : inputs.excerpts;

  // Patch provenance: pin against the base where one is given.
  let patch = inputs.patch;
  let provenance: EvidenceReport["patch"];
  const shortfall: { path: string; reason: string }[] = [];
  if (inputs.mode === "review" && inputs.base !== undefined) {
    const pinned = await pinPatch(inputs.repoDir, inputs.base);
    const facts = { baseSha: pinned.baseSha, headSha: pinned.headSha, dirty: pinned.dirty };
    if (patch === undefined) {
      patch = pinned.patch;
      provenance = { provenance: "derived-from-git", ...facts };
    } else {
      provenance = { provenance: "caller-supplied-checked", ...facts };
      shortfall.push(...patchShortfall(pinned.deltaPaths, patch));
    }
  } else if (inputs.mode === "review" && patch !== undefined) {
    provenance = { provenance: "caller-supplied-unpinned" };
  }

  const derived =
    inputs.mode === "review" && patch !== undefined
      ? deriveFromPatch(inputs.repoDir, patch)
      : NO_DERIVATION;
  const manualPaths = new Set(manual.map((excerpt) => excerpt.path));
  const derivedExcerpts = derived.excerpts.filter((excerpt) => !manualPaths.has(excerpt.path));
  const excerpts = [...manual, ...derivedExcerpts];

  const conventions = collectConventions(
    inputs.repoDir,
    excerpts.map((excerpt) => excerpt.path),
  );
  // Both modes carry the repository floor: a review pack must show
  // dirtiness and untracked scope beside the patch, not just plan packs.
  const floor = await repoFloor(inputs.repoDir, inputs.path);

  return {
    pack: {
      repoDir: inputs.repoDir,
      excerpts,
      conventions: conventions.paths,
      floor: floor.sections,
      ...(patch === undefined ? {} : { patch }),
      ...(inputs.testOutput === undefined ? {} : { testOutput: inputs.testOutput }),
    },
    report: {
      conventions: conventions.paths,
      conflicts: conventions.conflicts,
      derived: derivedExcerpts.map((excerpt) => ({
        path: excerpt.path,
        note: excerpt.note ?? "",
      })),
      exclusions: [...shortfall, ...derived.exclusions],
      floorNotes: floor.notes,
      ...(provenance === undefined ? {} : { patch: provenance }),
    },
  };
}
