/**
 * Mechanical review-pack derivation: the patch, not the orchestrator,
 * decides what a review consult sees. Every file the patch touches comes
 * back whole, each touched file brings its test file and its direct relative
 * imports; an import that resolves to a pure re-export facade pulls the
 * modules it re-exports one more hop, because this repo's own
 * facade-and-folder split rule must not hide the code under review.
 * Everything that cannot be included is an exclusion with a reason, and every remaining cut edge (a direct
 * import of an included file that the hop rule stops at) is recorded too:
 * curation is visible, never silent.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

import type { ExcerptRequest } from "./types.ts";

export interface DerivedEvidence {
  readonly excerpts: readonly ExcerptRequest[];
  readonly exclusions: readonly { readonly path: string; readonly reason: string }[];
}

/** `import ... from "./x.ts"` and `import("./x.ts")`, relative targets only. */
const IMPORT_SPECIFIER = /(?:from\s+|import\()\s*"(\.{1,2}\/[^"]+)"/g;

export function deriveFromPatch(repoDir: string, patch: string): DerivedEvidence {
  const excerpts: ExcerptRequest[] = [];
  const exclusions: { path: string; reason: string }[] = [];
  const included = new Set<string>();
  const add = (path: string, note: string): void => {
    if (included.has(path)) return;
    included.add(path);
    excerpts.push({ path, note });
  };

  const touched: string[] = [];
  for (const { path, deleted } of patchTouchedPaths(patch)) {
    if (deleted || !existsSync(join(repoDir, path))) {
      exclusions.push({ path, reason: "deleted by the patch, no tree content to excerpt" });
      continue;
    }
    touched.push(path);
    add(path, "touched by the patch");
  }

  for (const path of touched) {
    for (const candidate of testCandidates(path)) {
      if (existsSync(join(repoDir, candidate))) add(candidate, `test file of ${path}`);
    }
  }

  for (const path of touched) {
    for (const target of relativeImports(repoDir, path)) {
      if (!existsSync(join(repoDir, target))) {
        exclusions.push({ path: target, reason: `import target missing (imported by ${path})` });
        continue;
      }
      add(target, `imported by ${path}`);
      // The facade hop: a pure re-export facade holds no code, so the
      // one-hop rule would stop exactly where the split rule hid the modules.
      if (isReExportFacade(readFileSync(join(repoDir, target), "utf8"))) {
        for (const pulled of relativeImports(repoDir, target)) {
          if (existsSync(join(repoDir, pulled))) add(pulled, `re-exported by ${target}`);
          else {
            exclusions.push({
              path: pulled,
              reason: `re-export target missing (re-exported by ${target})`,
            });
          }
        }
      }
    }
  }

  // Every cut edge is visible: a direct import of an included file that the
  // hop rule leaves out is recorded, never silently absent.
  for (const path of [...included]) {
    for (const target of relativeImports(repoDir, path)) {
      if (included.has(target) || !existsSync(join(repoDir, target))) continue;
      if (exclusions.some((exclusion) => exclusion.path === target)) continue;
      exclusions.push({
        path: target,
        reason: `direct import of ${path}, beyond the one-hop rule`,
      });
    }
  }

  return { excerpts, exclusions };
}

/** Relative import/re-export targets of a file, resolved repo-relative. */
function relativeImports(repoDir: string, path: string): readonly string[] {
  const text = readFileSync(join(repoDir, path), "utf8");
  const targets: string[] = [];
  for (const match of text.matchAll(IMPORT_SPECIFIER)) {
    targets.push(normalize(join(dirname(path), match[1] as string)));
  }
  return targets;
}

/** True when, comments aside, the file is nothing but export-from statements. */
function isReExportFacade(text: string): boolean {
  const withoutComments = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .trim();
  if (withoutComments === "") return false;
  return /^(export\s+(type\s+)?(\{[\s\S]*?\}|\*)\s+from\s+"[^"]+";?\s*)+$/.test(withoutComments);
}

/** Unified-diff headers: `+++ b/<path>`, with `+++ /dev/null` marking deletion. */
export function patchTouchedPaths(patch: string): readonly { path: string; deleted: boolean }[] {
  const out: { path: string; deleted: boolean }[] = [];
  let previous: string | undefined;
  for (const line of patch.split("\n")) {
    if (line.startsWith("--- ")) {
      previous = line.slice(4).trim();
      continue;
    }
    if (!line.startsWith("+++ ")) continue;
    const target = line.slice(4).trim();
    if (target === "/dev/null") {
      const from = previous?.replace(/^a\//u, "");
      if (from !== undefined && from !== "/dev/null") out.push({ path: from, deleted: true });
    } else {
      out.push({ path: target.replace(/^b\//u, ""), deleted: false });
    }
  }
  return out;
}

/** The repo's test layout as data: a `test/` mirror and a sibling `.test.ts`. */
function testCandidates(path: string): readonly string[] {
  const candidates: string[] = [];
  const mirrored = /^src\/(.+)\.ts$/u.exec(path);
  if (mirrored !== null) candidates.push(`test/${mirrored[1]}.test.ts`);
  candidates.push(path.replace(/\.ts$/u, ".test.ts"));
  return candidates.filter((candidate) => candidate !== path);
}
