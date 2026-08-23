/**
 * A block some formatter rendered whole, given the shape its length asks for.
 *
 * The formatters return text and are tested on that text. Nothing about
 * appearance is pushed back into them, or their tests start asserting how
 * MAGI looks instead of what it found.
 */

import { detail, step } from "./write.ts";

/**
 * Its first line is already its title, so that line gets the step symbol and
 * the rest hangs under it; the text itself is passed through untouched.
 *
 * The blank line every formatter puts under its title is dropped rather than
 * carried: the renderer already spaces a body from its title, so passing the
 * blank through printed the gap twice, once per report.
 */
export function report(body: string): void {
  const [title, ...rest] = body.trimEnd().split("\n");
  const under = rest.join("\n").replace(/^\n+/u, "").trimEnd();
  step(title ?? "");
  if (under !== "") detail(under);
}
