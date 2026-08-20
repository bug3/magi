/**
 * What every command needs from the process: where the MAGI repo ships its
 * templates and schemas, and the two ambient variables seats resolve auth
 * and binaries through. Decided here and nowhere else.
 */

import { fileURLToPath } from "node:url";

/** The MAGI repo root: templates and the opinion schema ship with the tool. */
export const MAGI_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export function ambient(): { home: string; path: string } {
  const home = process.env["HOME"];
  const path = process.env["PATH"];
  if (home === undefined || path === undefined) {
    throw new Error("HOME and PATH must be set: seats resolve auth and binaries through them");
  }
  return { home, path };
}
