# MAGI

**Multi-Advisor Grounded Inference.** MAGI hands three independent AI
coding assistants the same self-contained brief and stages their blind
answers into one synthesis for you to decide with.

An advisory council over three coding harnesses, each on its own
subscription. The assistant doing the actual work convenes the council at
moments that need judgment: before committing to a plan, or to have a plan
or a diff criticised by models that did not write it. Three seats answer the
same brief blind. The orchestrator recommends a disposition for every
finding; you decide.

**The council thinks. It never works.**

## Why three, and why blind

A model reviewing its own output finds what it already knows to look for.
A different family finds the gaps the first one cannot see in itself, which
is the whole reason this exists. They answer independently and never see
each other, because sharing before answering collapses three opinions into
one.

Everything a seat is allowed to use arrives in the brief and its evidence
pack. Ambient context is off where the harness has a switch and recorded
where it does not, so a seat's answer is grounded in what you gave it and
you can check whether it stayed that way. That is isolation with recorded
limits, not sensory deprivation: what cannot be switched off is snapshotted
as residue, and every seat's output is canary-scanned.

## The three seats

| Slot | Harness | Isolation |
|---|---|---|
| `melchior-1` | Claude Code | safe mode, built-in tools denied |
| `balthasar-2` | Codex CLI | user config and project docs ignored, read-only sandbox |
| `casper-3` | Grok CLI | memory and web search off, read-only sandbox, residual layers recorded |

Slot names are fixed; the harness behind a slot is configuration. Every seat
call records its exact argv, the CLI version it captured, and its model and
effort policy: either an explicit pin or `cli-default`. A default is never
written down as a resolved model id nobody looked up.

## Trust boundary

Seat calls and commands run on the host are two different things:

- Seats get a scrubbed environment and the profile above. They read and
  answer; they never implement.
- Evidence curation makes hardened git reads and runs the one check command
  `package.json` declares, so the pack carries real output instead of a
  claim about it. That command is the repository's own, never a seat's.
- `magi checks` runs only the built-in read-only vocabulary: selected git
  reads, `grep`, `rg`, `ls`, `cat`, `head`, `tail` and `wc`. No shell, only
  `PATH` inherited, bounded time and output. `npm`, `node` and every other
  project-code entry point is refused and recorded, because a proposal may
  name any script your repository happens to define.
- Checks run on the host, not inside an OS-level sandbox. Read a refused
  command before you decide to run it yourself.
- `magi skill --install` and `magi doctor --calibrate` are the only
  operations that write to harness configuration. The first links this skill
  into a harness's skills directory and refuses to replace what it did not
  create; the second writes a nonce into an ambient layer and restores it.

Consult records carry source excerpts and raw model output, so `.magi/` must
be untracked and ignored before a consult convenes. MAGI refuses rather than
editing your `.gitignore` for you.

## Requirements

- Node 24 or newer. Working from a clone there is no build step: the
  TypeScript sources run directly under Node's type stripping. The published
  package ships compiled JavaScript instead, because Node refuses to strip
  types under `node_modules`.
- The three CLIs installed and already logged in with their own
  subscriptions. A seat is passed `HOME` and `PATH` and nothing else: no API
  keys, no copied credentials.
- `.magi/` ignored by the target repository, normally through `.gitignore`.
- Zero runtime dependencies.

## Install

```
npm install -g @bug3/magi
```

That puts `magi` on your PATH. To work on MAGI itself instead of installing
it, see [Development](#development).

### The skill

The CLI is half of it. `skills/magi/` is the other half: it teaches an
orchestrating assistant when to convene, what a brief must contain and what
to do with the answers. Install it once:

```
magi skill --install
```

That links the skill into the orchestrating harness, which is Claude Code by
default; `--harness codex` or `--harness grok` installs it for one of the
others, and repeating the flag covers several. All three discover a skill the
same way, as a directory under their own config root, so the shape is one
rule. Only the skill's name and its one-line description sit in a session's
context: the body loads when you type `/magi` or when that description
matches what the assistant is about to do. [From a session](#from-a-session)
is what happens next.

## Start here

Run MAGI from the root of the repository you are working in. Once per
repository: add `.magi/` to its `.gitignore` and run `magi doctor`. Doctor
spends no quota, and a fresh repository is unhealthy on purpose until its
isolation canaries have been calibrated.

### From a session

Type `/magi`, or simply put the decision in front of the assistant: the
skill's description names the triggers, so an assistant that has it reaches
for the council on its own before committing to a plan, or when a diff
crosses a risk domain like auth, migrations, concurrency or public API.
`/magi plan` and `/magi review` name the mode outright when you already know
which one you want.

What follows is mechanical work the assistant does for you, with two stops
that are yours:

- It picks the mode, writes the self-contained brief and shows it to you.
  **Nothing is spawned before you approve.** The CLI asks nothing once it
  starts, so that approval has to happen first, out here.
- It convenes, reads the validity gate, runs the checks the seats proposed
  and spot-checks a citation before it believes the finding hanging on it.
  A canary warning or a refused check comes back to you as it is, not
  smoothed over.
- It returns a recommended disposition per finding, adopted and rejected
  alike with the dissent intact. **You approve or change them**, and only
  then does it finalize `synthesis.md`, append the ledger backfill and pick
  the work back up.

A degraded consult, meaning fewer than two families answered or no
non-Claude voice survived, also stops for your decision instead of being
quietly averaged into one.

Ask for the record whenever you want it: every consult leaves the brief,
the raw answers, the checks and the ledger row under `.magi/`.

### By hand

The skill drives the same CLI you can run yourself:

1. Write a self-contained brief: the goal, the constraints, the concrete
   question, what a good answer looks like. Never refer to conversation
   history.

2. Convene, then run the checks the seats proposed:

   ```
   magi plan --slug auth-boundary --brief brief.md
   magi checks <consult-id>
   ```

3. Read `synthesis.md`. It arrives as a scaffold with every finding marked
   `PENDING`; the dispositions you settle on are what reach the ledger.

Either way, a preflight prints the projected token burn and the disposition
lag before anything is spent, and refuses when a configured budget or an
overdue disposition says no. The projection is an estimate from rendered
size and recent usage, not a reading of what your subscription has left.
`--waive-headroom` and `--waive-backfill` are your overrides, recorded in
the ledger.

## Command reference

`magi --help` is the canonical reference:

```
usage:
  magi doctor [--live] [--calibrate]
  magi skill  [--harness <claude|codex|grok>]... [--install]
  magi plan   --brief <file> [--slug <slug>] [--excerpt <path[:start-end]>]...
              [--test-output <file>] [--waive-headroom] [--waive-backfill]
  magi review --brief <file> [--slug <slug>] [--base <ref>] [--patch <file>]
              [--excerpt <path[:start-end]>]... [--test-output <file>]
              [--waive-headroom] [--waive-backfill]
  magi checks <consult-id>
  magi triggers [--base <ref>]
```

`--slug` is optional and defaults to the mode name. `--base` and `--patch`
are review-only. `--excerpt` is additive commentary: it can add context, but
it cannot remove the rule-derived floor or narrow the patch-derived scope.

### `skill`

Reports where each harness would find the skill and, with `--install`, links
it there. The link points at this clone, so an installed skill cannot drift
from the source; anything already sitting at that path is reported and left
alone, never replaced. See [The skill](#the-skill).

### `plan`

Asks for approaches before one exists. Each seat proposes one independently,
on the same repository floor plus whatever commentary you added.

### `review`

Hands the seats a plan or a diff to criticise. With `--base` the patch
derives from git and the manifest pins base and head SHAs plus dirtiness. A
patch supplied beside a `--base` is checked against the full delta and every
scoped-out file becomes a named exclusion; a patch alone is recorded
unpinned.

Selection is rule-driven: every touched file comes back whole, and the
current collector adds its mirrored or sibling test, one direct
relative-import hop and the modules a facade re-exports. Relationships it
does not recognise in another stack need an additive excerpt. No flag
removes derived evidence.

### `checks`

Runs what the vocabulary above admits and records everything else as refused
with its reason, at the same prominence as a result. Deterministic evidence
outranks opinion.

### `triggers`

Evaluates the tracked delta from `HEAD`, or from `--base`, out to the
worktree, plus non-ignored untracked files, against the size thresholds and
risk domains. Staged, unstaged and untracked scope all count. Proposing
never convenes.

## Doctor and calibration

`magi doctor` is quota-free. It renders every seat profile, probes the
installed CLI versions and help text, checks every short and long flag the
profiles rely on against that help, verifies `.magi/` is untracked and
ignored, reports chronic seat failures with the disposition, skew and value
telemetry, and fails when a seated CLI version has no calibration behind it.
Three fast-moving CLIs mean flags rot in weeks, so thin glue has to fail
loudly rather than quietly lose its isolation.

Help text proves a flag is documented, not that it behaves, so two explicit
modes spend quota to test behaviour. `--live` spends one minimal call per
harness. `--calibrate` spends six seat calls over two rounds: it writes a
nonce into each ambient configuration layer, asserts the nonce surfaces
without isolation and stays out with it, then restores the original bytes,
leaving a recovery sidecar behind if a restore is refused. Calibration is
per repository, so a new one exits non-zero until you run it.

## What it leaves behind

```
.magi/
  consults/<id>/
    brief.md         the self-contained brief, with its evidence pack
    manifest.json    hashes, evidence provenance, argv, versions, policies
    gate.json        validity verdicts and the normalized valid opinions
    raw/             per-seat output, launch records and residue snapshots
    checks/          proposed check commands, run or refused, with reasons
    synthesis.md     the PENDING scaffold, finalized after your decision
  ledger.jsonl       append-only: what each consult cost and what came of it
```

Rejected findings stay visible at the same prominence as adopted ones.
Unresolved dissent is an output, not a failure. Cost fields exist only where
a harness reports them; a missing price is never invented.

## Failure policy

A seat that fails, times out or answers off-schema degrades that seat only.
A consult is `complete` when at least two distinct harness families returned
valid opinions and at least one is non-Claude; anything less is `degraded`
and proceeds only on your explicit decision.

## Non-goals

- **Not a product.** Personal infrastructure, shared as is. No support is
  implied.
- **No coded judgment.** Nothing here scores the quality of an opinion. What
  the code does is mechanical: validate against a schema, count families,
  apply numeric thresholds, tally the ledger. The orchestrator recommends;
  you decide.
- **No implementation fan-out.** Seats never redo the work. They advise.
- **No anonymization.** With three known candidates, stylometry defeats
  label shuffling. Bias is measured in the ledger instead of masked.
- **No API-key spend.** Subscriptions only.
- **No claim of perfect isolation.** Residue and canaries make the limits
  visible instead of asserting there are none.

## Development

Node is pinned through mise, and `npm install` pulls dev dependencies only
(`typescript`, `@types/node`):

```
mise install
npm install
npm run check
```

`npm run check` typechecks the tree and runs every `test/**/*.test.ts` file;
`prepublishOnly` runs the same command. `npm link` puts a checkout's `magi`
on your PATH in place of the published one, and `node bin/magi.js` works just
as well. If `npm run check` cannot find its test files, the shell is
resolving an older `node` than the pinned one.

## Documentation

[docs/protocol.md](docs/protocol.md) is the full protocol: what a consult
does step by step, how evidence is curated, what the isolation model does
and does not claim, and what the ledger measures. The skill that teaches an
orchestrating assistant to follow it is
[skills/magi/SKILL.md](skills/magi/SKILL.md), installed as above, so
`/magi plan` and `/magi review` do the right thing from inside a session.
[AGENTS.md](AGENTS.md) points the other way: what an agent needs in order to
work on this repository rather than with it.

## License

MIT. See [LICENSE](LICENSE).
