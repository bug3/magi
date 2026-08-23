/**
 * Every byte a command writes goes through here.
 *
 * This module is the facade over `src/util/ui/`, and the rule it exists for is
 * that nothing else under `src/` reaches a stream or imports the renderer.
 * Whether a line is a result or a refusal, which stream carries it, and how
 * much of it is drawn are three decisions taken once, here, rather than
 * re-taken at forty call sites.
 *
 * The renderer is `@clack/prompts`, and how much of it runs is decided by one
 * question: is a person looking? `ui/streams.ts` answers it per stream.
 *
 * - On a terminal, a command is drawn: boxes, notes, a spinner over a long
 *   wait, folded subprocess output, and a prompt where the user has a decision
 *   to make.
 * - Down a pipe, the same command emits exactly the bytes it emitted before
 *   any of that existed. `--version` is parsed, the usage block is copied out,
 *   and MAGI's own check transcript is carried into evidence packs, so nothing
 *   may animate, move a cursor, or wait on an answer that is never coming.
 *
 * Interaction is never required. Every prompt here carries the answer it falls
 * through to when stdin is not a terminal, when CI is set, or when the user
 * passed the flag that says not to ask.
 */

export {
  decorated,
  interactive,
  setStreams,
  type Streams,
} from "./ui/streams.ts";
export {
  close,
  detail,
  info,
  open,
  plain,
  plainError,
  problem,
  step,
  success,
  warn,
} from "./ui/write.ts";
export { report } from "./ui/report.ts";
