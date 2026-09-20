/**
 * What every command needs from the process: where the MAGI repo ships its
 * templates and schemas, and the ambient values seats resolve auth and
 * binaries through. Decided here and nowhere else.
 */

import { userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The MAGI repo root: templates and the opinion schema ship with the tool. */
export const MAGI_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The skill directory every harness links to. Named here and nowhere else. */
export const SKILL_SOURCE = join(MAGI_ROOT, "skills", "magi");

export function ambient(): { home: string; path: string; user: string } {
  const home = process.env["HOME"];
  const path = process.env["PATH"];
  if (home === undefined || path === undefined) {
    throw new Error("HOME and PATH must be set: seats resolve auth and binaries through them");
  }
  return { home, path, user: userName() };
}

/**
 * The POSIX user name: from the environment where there is one, from the
 * passwd entry otherwise. A seat needs it because claude resolves its macOS
 * keychain credential by account name, and a seat launched without `USER`
 * reports itself logged out and answers nothing (verified live against claude
 * 2.1.278: the same argv answers "Not logged in, please run /login" without
 * it and "PONG" with it).
 */
function userName(): string {
  const named = process.env["USER"];
  if (named !== undefined && named !== "") return named;
  try {
    return userInfo().username;
  } catch {
    throw new Error(
      "the POSIX user name must be resolvable: set USER, because a seat " +
        "resolves its stored credential by account name",
    );
  }
}
