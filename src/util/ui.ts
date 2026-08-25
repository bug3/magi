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
 *
 * Two writers are deliberately not offered here: the ones that put text on a
 * stream exactly as given. They are how the pipe gets its plain bytes, and
 * they are reached only from inside this folder, by the screens that decide
 * between the two renderings. A command that could call them could opt out of
 * being drawn, which is precisely how `magi help`, `--version` and every
 * refusal came to look untouched while the renderer was said to own the
 * output. `test/spec/writers.test.ts` guards the rule by name as well.
 */

export {
  columns,
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
  problem,
  step,
  success,
  verdict,
  warn,
} from "./ui/write.ts";
export {
  approve,
  choose,
  type Answer,
  type Choice,
  type Fallthrough,
} from "./ui/ask.ts";
export { announce, waiting, type Wait } from "./ui/progress.ts";
export { report } from "./ui/report.ts";
export { transcript, type Transcript } from "./ui/transcript.ts";
export {
  commandUsage,
  noteText,
  refuseCommand,
  refuseUsage,
  usage,
  usageText,
  version,
  type CommandNote,
  type UsageScreen,
} from "./ui/usage.ts";
