/**
 * Running a command with both its streams held in memory.
 *
 * A suite that lets CLI output through puts the whole usage block in the
 * repository check transcript, which the evidence floor then carries into
 * every pack, for every seat. So nothing here prints: the command writes into
 * a buffer and the test asserts on the buffer.
 *
 * Held streams are also the only way to tell the two halves of the contract
 * apart. `console.log` and `console.error` used to be swapped for one shared
 * array, which could prove a line was printed and never that it landed on the
 * stream a piped caller reads.
 */

import { Writable } from "node:stream";

import { setStreams } from "../../src/util/ui.ts";

export interface Captured {
  readonly out: string;
  readonly err: string;
}

/** A sink that is explicitly not a TTY, so nothing tries to animate into it. */
function sink(into: string[]): Writable {
  return new Writable({
    write(chunk, _encoding, done) {
      into.push(String(chunk));
      done();
    },
  });
}

export async function capture<T>(
  run: () => T | Promise<T>,
): Promise<Captured & { readonly result: T }> {
  const out: string[] = [];
  const err: string[] = [];
  const restore = setStreams({ out: sink(out), err: sink(err) });
  try {
    return { result: await run(), out: out.join(""), err: err.join("") };
  } finally {
    restore();
  }
}
