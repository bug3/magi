/**
 * A block some formatter rendered whole, given the shape its length asks for.
 *
 * The formatters return text and are tested on that text. Nothing about
 * appearance is pushed back into them, or their tests start asserting how MAGI
 * looks instead of what it found. So the shape is decided here, from the one
 * thing the text already carries: its first line is its title, and the rest is
 * the body under it.
 */

import { note } from "@clack/prompts";

import { decorated, outStream } from "./streams.ts";
import { detail, step } from "./write.ts";

/**
 * On a terminal the body is framed under its own title, because `magi doctor`
 * prints five of these and one bar down the left of all of them is a wall of
 * text with five headings somewhere in it.
 *
 * Down a pipe the title takes the step symbol and the rest hangs under it,
 * exactly as before: these bytes are read by an orchestrating assistant and
 * carried into evidence packs, and a frame is not information there.
 *
 * The blank line every formatter puts under its title is dropped rather than
 * carried: the renderer already spaces a body from its title, so passing the
 * blank through printed the gap twice, once per report.
 */
export function report(body: string): void {
  const [title, ...rest] = body.trimEnd().split("\n");
  const under = rest.join("\n").replace(/^\n+/u, "").trimEnd();
  if (decorated(outStream()) && under !== "") {
    note(under, title ?? "", { output: outStream() });
    return;
  }
  step(title ?? "");
  if (under !== "") detail(under);
}
