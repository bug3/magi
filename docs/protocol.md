# The council protocol

What a consult does, step by step, and what each mechanism promises. Source
comments point here by heading name.

## The shape of a consult

```
you <-> orchestrator (does the work; synthesizes and recommends)
              |
              | convene (plan / review); triggers propose, you approve
              v
   brief.md + evidence pack
              |
              +--> melchior-1  (claude)  \
              +--> balthasar-2 (codex)    > parallel, blind, tools off
              +--> casper-3    (grok)    /
              |
   collect -> validate mechanically -> normalize onto one schema
              |
              +--> run the checks the seats proposed
              |
              v
   synthesis.md (PENDING scaffold, then recommended dispositions)
              |
              v
   your decision -> ledger backfill -> the orchestrator continues the work
```

## Modes

**`plan`** asks each seat to propose an approach independently, before one
exists. The synthesis becomes the plan you are shown.

**`review`** hands the seats a plan or a finished diff to criticise, and each
finding is dispositioned one by one. This is where the council earns its
keep: models find each other's gaps.

## The brief

The brief is self-contained. Goal, constraints, the concrete question, any
directed questions, and what a good answer looks like. It never references a
conversation, because the seats were not in it.

The brief body is the orchestrator's own voice, and that is a real limit,
recorded rather than papered over. What holds it honest: the evidence floor
below, rule-driven derivation, the brief gate, and the seats' standing rule
that quoted material is data to be judged and never instructions to follow.

## The evidence pack

The pack carries numbered excerpts with stable citation ids and a hash per
excerpt. Its floor and patch-derived scope are curated by rule. There is no
flag that removes derived evidence; `--excerpt` can only add commentary.

**Review packs derive from the patch.** Every touched file comes back whole.
Recognized test files and direct relative imports are added. An import that
resolves to a pure re-export facade pulls the modules it re-exports one hop
further, so a facade-and-folder split cannot hide the code under review. Every
remaining cut edge is recorded as an exclusion with a reason.

The relationship rules currently encode this repository's TypeScript layout:
mirrored or sibling `.test.ts` files and explicit double-quoted relative
imports. Other stacks still receive every touched file, but relationships the
collector does not recognize must enter as additive commentary excerpts.

**The patch is pinned.** Given a base ref, the patch derives from git and the
manifest records base and head SHAs plus dirtiness. A caller-supplied patch
beside a base is checked against the full delta, and every scoped-out file
becomes a first-class exclusion. A patch with no base is recorded as
caller-supplied-unpinned, so a reader can tell what the reviewers were
actually shown.

A bounded transitive closure was declined on purpose: one facade-aware hop
with visible cut edges, rather than a crawl whose depth would be another
arbitrary number.

**Both modes carry the same repository floor:** HEAD and dirtiness, porcelain
status, the tracked file list, and the output of the repository's own check
command. That command is the one `package.json` declares, never one a seat
proposed, so it runs through the check execution profile without passing the
seat vocabulary. Uncommitted and untracked scope stays visible beside a review
patch, not only beside a plan question. Excerpts you name ride beside the floor
as additive commentary.

**Conventions come from a deterministic collector:** an enumerated filename
catalog, a root-to-file walk for every cited path, hits included root-first,
and the same filename at two depths reported as a conflict, with the file
closer to the cited path winning where the texts disagree.

The pack is identical for every seat, hashed into the manifest, and the
manifest records what curation collected, derived, excluded, and could not
build.

## The brief gate

Before any seat is spawned, the rendered brief is checked against the
manifest. The header must carry the manifest's consult id and mode, and a
fenced block of any length must be a pack excerpt byte for byte.

The one exception is a cumulative budget of non-pack fenced lines per brief.
It is cumulative rather than per block, because a per-block allowance can be
split under. What the budget admits is accounted for: the manifest records
the line count and a hash over that content, so an artifact can neither be
inlined stale nor smuggled in slices.

Exclusions and fence residue print at the convene surface before fan-out, so
a thin pack is caught while it is still cheap.

## Fan-out and isolation

Parallel headless calls, staggered on spawn, each with its own timeout
counted from its own start. A seat is retried exactly once, and only when it
never started.

The principle is **symmetric starting conditions and recorded trajectories**,
not sensory deprivation. Seat tools are off by default and the network is
default-deny. Model and reasoning-effort selection is explicit per slot: each
is either pinned or recorded as `cli-default`. The exact argv, captured CLI
version when available, and selection policies go into the manifest. A CLI
default is not mislabeled as a known resolved model id.

**The ban is on hidden context, not capability.** Anything from the ambient
layers that earns its place comes back through an explicit channel: project
conventions through the evidence pack and model or effort tuning through the
selection policy. Pinning your preferred model is not banned; an unrecorded
selection policy is.

**Residue is recorded, never denied.** Where a harness has no switch for a
layer, the profile declares a residue probe, every fan-out snapshots that
probe's output into the consult's `raw/` directory as a first-class
artifact, and every seat's raw output is canary-scanned.

None of this touches interactive use. Stripping applies only to MAGI's own
headless seat calls; your daily sessions keep every customization.

MAGI supplies no API-key environment variables and expects existing
subscription sessions. It does not independently prove a CLI's billing mode.

## The validity gate

Mechanical, never a matter of opinion: schema-valid, citations resolve,
length bounds respected. Output that fails degrades that seat alone.
"Garbage" is defined by the gate, so no one has to argue about it.

Valid opinions are normalized onto one structured schema before the
synthesizer reads them.

## Seat-proposed checks

An opinion may propose a concrete check command or a falsification test. A
proposal is data until it clears the built-in read-only vocabulary: selected
Git reads, grep, ripgrep and bounded file reads. Project-code entry points such
as npm and node are refused for manual review, because a proposal may name any
script the repository happens to define. The repository's own declared check
command is not a proposal, and the evidence floor runs it directly.

Planning never involves a shell. The proposal is tokenized, any unquoted
shell metacharacter disqualifies it, and a match yields an argv or a
refusal. What runs, runs through the exec wrapper with an explicit working
directory, only PATH inherited, fixed hardening variables, a wall-clock
timeout and bounded output. The commands run on the host, not in an OS-level
sandbox. Nothing network-capable or project-code-capable is in the catalog.

Refused proposals are recorded with their reason at the same prominence as
results. You may run one by hand after reading it.

**Deterministic evidence outranks opinion.**

## Synthesis

The CLI first writes a scaffold with every finding marked PENDING. The
orchestrator recommends an adopt or reject plus a one-line reason. An
evidence-backed finding may be recommended for rejection only by citing
counter-evidence; a preference is not counter-evidence, and saying so plainly
is the honest recommendation.

Rejected findings are shown at the same prominence as adopted ones.

The user approves or changes those recommendations before they become final
dispositions and ledger backfill. The orchestrator is also the party under
review; that conflict is additionally measured through **Family skew**.

## Triggers

Deterministic triggers propose a consult. They cover the tracked
base-to-worktree delta plus non-ignored untracked files, so staged, unstaged
and visible untracked scope all count. Size thresholds and a risk-domain seed
are matched before plan approval.

An imperfect deterministic trigger protects against orchestrator
overconfidence. An unset one protects nobody. Orchestrator judgment may add
proposals and may never suppress a triggered one, because the party under
review cannot be the sole judge of when review is needed.

You approve every convene. There is no automatic convening and no interactive
confirmation inside the CLI: invoking `plan` or `review` directly constitutes
approval for that call.

## Failure policy

A seat that fails, times out, or fails the validity gate degrades that seat
only. Synthesis proceeds and records the gap.

A consult is labeled **complete** or **degraded**. Complete requires opinions
from at least two distinct harness families, including at least one non-Claude
seat. A degraded consult proceeds only on your explicit decision.

The ledger keeps per-seat failure counters and `magi doctor` alerts on
chronic failure, so the council cannot quietly collapse into a monoculture.

## The opinion contract

One JSON schema for all seats: position, findings (id, severity, claim,
evidence citation ids, proposed check, proposed fix), answers to directed
questions when present, a keep-list, assumptions, and confidence. It is
enforced natively where the CLI supports it and by prompt where it does not.

The schema is written flat, with no `$ref` and no `$defs`: the same file is
handed verbatim to more than one CLI's structured-output flag, and inline
nesting is the only shape every enforcement path is known to share. Every
object lists every property in `required`, and optional strings are nullable
unions with a minimum length, so an empty string can never masquerade as
absent.

**The evidence rule:** a claim about the codebase must cite citation ids that
resolve inside the pack. Links to external documentation carry no weight,
and neither does a model's general memory of how a tool behaves. The
orchestrator spot-checks citations before adopting a point; a citation that
does not support its claim is counter-evidence.

## The ledger

`ledger.jsonl` is append-only and holds two kinds of line.

A **consult row**, written at consult time: timestamps, mode, seats with
durations and validity, usage and tokens where the CLI reports them,
headroom observations, and the complete-or-degraded label.

A **backfill row**, written after the user decides or when a later reversal
records outcomes: one disposition per finding, a duplicate marker when an
adoption re-records a finding already counted elsewhere, and later
proved-right-or-wrong notes.

Readers fold backfill rows onto their consult. Per-family tallies are derived
from the folded dispositions and never stored, so there is no counter that
can drift from the record.

Measuring cost while ignoring value is how a tool like this fools its owner,
so the ledger carries both where a harness reports them. Missing prices are
never invented.

## Runtime state

Consult state may contain source excerpts and raw model output. In a Git
repository, `.magi/` must be untracked and ignored before a consult can
convene. MAGI checks both rules and refuses when either fails, but never edits
the target repository's `.gitignore`. In a non-Git directory there is no
publication boundary to enforce.

## Headroom

No CLI reports its remaining subscription quota, so headroom is a budget
model rather than a measurement. You allot each harness a token budget per
rolling window in a gitignored local config.

The projection is size-aware: curation runs before the preflight, the
rendered brief and pack are estimated at roughly four characters per token,
and the preflight compares the window's spend plus the larger of the
harness's historical mean and this consult's estimate against the allotment.
It refuses by default when the projection does not fit. Both numbers print in
the preflight report, because after rule-driven derivation the pack scales
with the patch and history alone under-projects a large review. The report is
a token-burn estimate, not remaining-quota telemetry or a dollar-price quote.

Everything outside the allotment stays reserved for your own session.
`--waive-headroom` is your override, recorded in the ledger with the
preflight snapshot. With no config, the report is informational.

## Family skew

The orchestrator frames recommendations for reviews of its own work, while
the user approves the final dispositions. The tripwire measures that combined
decision stream. It cannot attribute skew to either party. It is recomputed
from the folded ledger on every doctor run, with no stored trip state.

Over a rolling window of consults, the tripwire arms once each side, the
Claude seat and the pooled foreign families, carries a minimum number of
dispositioned findings. A pooled floor alone would let one side stay nearly
empty. Armed, it trips when the Claude adoption rate exceeds the pooled
foreign rate by more than the configured gap.

Deactivation is automatic but hysteretic: a trip clears only when the gap
falls well below the trip line, or after several consecutive armed
evaluations at or under it. A trip outlasts a window that drops back below
the arming floor, until there is an adequate sample to clear on.

Attribution is mechanical. Every family that independently raised an adopted
finding is credited one adoption, and the duplicate marker deduplicates only
the unique-finding count, never family credit.

While tripped, a non-Claude seat drafts the synthesis and that draft is the
default recommendation. The orchestrator deviates from it only by citing
counter-evidence, the same rule as rejecting an evidence-backed finding, and
every deviation is recorded so the deviation rate is readable beside the gap.
The user still decides.

Adoption rate is a proxy, not a verdict on who was right. The
proved-right-or-wrong backfill is the quality correction.

## Telemetry completeness

Both telemetry rules read final, user-approved dispositions from backfill
rows, so missing or delayed decisions must be measured too.

Expected finding ids enumerate mechanically from the persisted gate record,
restricted to the seats the consult-time row marked valid: re-gating old raw
output must not manufacture retroactive debt. A consult is complete when
every expected id carries exactly one folded disposition. A second
disposition for the same finding is a conflict, not completeness.

`magi doctor` prints per-consult undispositioned counts and flags anything
still incomplete after two newer consults as overdue. The consult preflight
shows the same report and refuses by default while anything is overdue;
`--waive-backfill` is your override, recorded like the headroom waiver.

## The value checkpoint

Every tenth consult, doctor reports two numbers from the folded ledger:
adopted unique findings per consult, and cost per adopted finding in tokens
and in currency where the CLI reports it. Both print beside the pooled
adoption rate, because the generosity that would inflate them should be
visible next to them.

A provisional threshold band is pre-registered before the first checkpoint,
so the bar cannot be set after seeing the score. Revisions carry a written
reason, land as a ledger override, and apply only to future windows.

Each checkpoint ends in an explicit continue, adjust or stop, plus a
proved-right-or-wrong pass over the window's adopted findings, so the
quality correction accrues instead of staying planned.

## Isolation canaries

A canary is a pattern that can only appear in seat output if an ambient
layer reached the seat, because the brief never contains it. The catalog is
deliberately small: a pattern that also matches legitimate output is worse
than no canary at all, and every entry names the layer it betrays.

The canaries scan every seat's raw output at consult time. A hit lands in the
ledger as a warning and prints at the console. It is never an automatic
degrade: a match is evidence of a leak, not proof of one, and degradation
stays mechanical.

Where a harness has unstrippable residue, a hit is read against that
consult's residue snapshot first. A marker the snapshot already carries is
residue, not news. Warnings stay warnings either way.

Sharper canaries drawn from your own configuration belong in the gitignored
local catalog, not in this repository. The mechanism ships; your markers do
not.

## Canary calibration

A canary that has never been watched failing proves nothing.

On CLI updates, and only with your approval, `magi doctor --calibrate` writes
a nonce into each ambient layer, runs one probe round with and without each
seat's isolation switches, asserts presence where the layer must leak and
absence where isolation must strip it, removes the nonce again, and records
both directions in the ledger.

The calibration brief describes the nonce by its fixed prefix and never
contains the token. The first live calibration produced a false positive
exactly this way, when a seat echoed the nonce straight out of the brief and
reported it as seen. An echo of the full token now proves brief visibility
and nothing else.

Calibration is crash-safe. A recovery sidecar holding every original image is
written before the first layer changes. A layer restores only while its
content still equals the expected nonce-bearing image; a concurrent edit is
refused rather than clobbered, and the sidecar outlives a refused restore as
the hand-recovery copy. The row records the seated CLI versions and the
restored layers' hashes.

Every doctor run then checks residue and clock, and every unproved state
fails: a leftover sidecar, a nonce still in a live layer, a seated version
that no passing calibration proved, and a ledger with no calibration at all.
The canaries are per-repository artifacts scanned on every consult, so a
fresh target repository is honestly red until its own calibration runs. Only
a layer whose hash drifted since the last calibration warns instead of
failing, because editing your own config is routine.
