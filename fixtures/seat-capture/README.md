# Captured seat output

Real bytes from real seat calls, kept because the failures they carry cannot
be written from imagination. A synthetic malformed capture proves a parser
rejects what its author expected; these prove it rejects what a harness
actually did.

Each file is trimmed to the smallest contiguous slice that still carries its
claim, and altered in exactly one way: an absolute path naming the machine
that produced it was replaced. Nothing else is edited, because the point of a
capture is that nobody arranged it.

A file here that no test reads is a record kept for its own sake, and
`test/spec/fixtures.test.ts` deletes that possibility mechanically.

### balthasar-plain-log.log

The opening of a codex exec log: prose with a header block, and not one line
of NDJSON. The claim: a human-readable log is a typed parse failure, never a
crash and never a payload fished out of the middle.

Read by `test/adapters/codex.test.ts`.

### casper-leaked-preamble.md

The first line a grok seat wrote in answer to an English brief: a preamble in
the language of the machine's own local configuration, which is how ambient
config reaching a seat was first seen at all. Two claims rest on it. The
parser and the validity gate must both refuse it rather than recover the
answer behind it, because a parser that rescues a payload hides the isolation
breach. And the Turkish canary must trip on it, which is the only evidence
that the canary matches a real leak rather than its own author's idea of one.

Read by `test/adapters/grok.test.ts`, `test/consult/gate.test.ts` and
`test/seats/canaries.test.ts`.

### balthasar-fetched-token.ndjson

Three events from a codex exec run pointed at a directory holding a
calibration nonce: the command it started, the same command completed with
`./AGENTS.md:magi-canary-fixture1` in its own output, and the answer echoing
that token back. The claim: a nonce a seat reached by tool is separable from
one that reached it ambiently, and what separates them is where the token
sits, not when it appears. The started event carries the retrieval marker
with an empty output, which is why a line matching a marker is not on its own
evidence of anything.

Read by `test/doctor/calibrate.test.ts`.
