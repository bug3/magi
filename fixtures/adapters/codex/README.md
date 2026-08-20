# Codex stdout fixtures

Recorded-shape `codex exec --json` streams, read by the real parser in
`test/adapters/codex.test.ts`. They are shape, not recordings: `magi doctor`
smoke-tests the live launch profile, and observed bytes from it are what
eventually replace these files.

NDJSON carries no comments, so this file is their header. Every fixture below
states why it parses the way it does and names, word for word, the claim that
covers it; the test asserts both, because a fixture nobody explains can pass
for the wrong reason and a fixture nobody reads is dead code.

### golden-success.ndjson

The event family a healthy turn emits, in order: `thread.started`,
`turn.started`, two `item.completed` frames, `turn.completed`. The answer is
the `agent_message` item, never the `command_execution` output beside it, and
the token counts come off the completed turn.

Claim: `the golden-shape stream is read as one completed session`

### split-frame.ndjson

A capture cut one `item.completed` frame in half at a newline inside its
`aggregated_output` string. Each line stands alone, so both halves are dropped
rather than stitched: rejoining them would report an item the seat never
finished writing. The whole frames around the cut are still read.

Claim: `a frame split across lines is dropped, and the whole frames around it still read`

### missing-usage.ndjson

A turn that completed and reported no usage. Absent stays absent: a zero here
would be indistinguishable afterwards from a measured zero.

Claim: `a turn that reported no usage yields no usage, never zeros`

### nonzero-exit-after-turn.ndjson

A `command_execution` item whose command exited 3, followed by a completed
turn. The exit code is a fact about a command the seat ran, not about the seat,
so it is not read as the session reporting an error.

Claim: `a command the session ran exiting nonzero is not the session reporting an error`

### error-event.ndjson

An `error` event before a completed turn. The session reached a conclusion of
its own and reported a failure inside it, and its message is not outage-shaped,
so the retry class cannot be reached through this file.

Claim: `an error event fails a session whose turn completed`

### turn-failed.ndjson

`turn.failed` arrives instead of `turn.completed`, with the failure text nested
in the turn frame. No turn completed, so the outage rule is allowed to look at
that text; "tool call loop" is not outage-shaped, so the claim cannot pass for
that reason.

Claim: `a failed turn is the session's own failure, not an outage`

### truncated-frames.ndjson

Every line is a half-written frame. The words a text search would want are all
present: `turn.completed`, `agent_message`, an `input_tokens` key. An event is
a JSON object, so none of them is evidence of anything but bytes.

Claim: `a stream of truncated frames is never read as a finished session`
