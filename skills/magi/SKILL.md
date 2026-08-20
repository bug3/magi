---
name: magi
description: Convene the MAGI council on one brief: three seats answer blind, you synthesize and recommend, and the user decides. Modes are `plan` (propose an approach before one exists, always before plan approval) and `review` (critique the orchestrator's own plan or diff). Use when a deterministic trigger fires (auth or credentials, persistence or migrations, concurrency, public API surface, release or CI config, `.magi/` and the seat profiles, a diff over the size thresholds) or when the user asks for a council consult.
---

# MAGI consult

The council thinks. It never works. Three seats answer the same brief blind;
you synthesize and recommend. The USER decides. You are the party under
review: triggers propose, the USER approves, and your judgment may add
consults but never suppress a triggered one.

## Pick the mode

`/magi plan` and `/magi review` name it outright. Without an argument, pick
from the state and say which you picked: no approach on the table yet means
`plan`, an approach or a diff to be criticised means `review`. The user
approves every convene, so a wrong pick is caught before quota is spent.

| | `plan` | `review` |
|---|---|---|
| The question | propose an approach, independently | critique this plan or diff |
| Trigger | always before plan approval | `magi triggers`: size thresholds and risk domains |
| Evidence you supply | the question, plus commentary excerpts | the patch, pinned; test output when it is evidence |

## Protocol

1. **Approval and state.** No approval, no consult. Direct invocation is the
   CLI-level approval because there is no interactive confirmation. Before
   invoking, ensure `.magi/` is untracked and ignored; MAGI refuses a Git
   repository where either condition fails. The preflight prints an estimated
   token burn and disposition lag before any seat call, and refuses by default
   when either fails.
   `--waive-headroom` and `--waive-backfill` are the USER's overrides, never
   yours, and both land in the ledger.
2. **Brief.** Write a self-contained brief file: goal, constraints, the
   concrete question, directed questions when present. State what a good
   answer looks like. Never reference conversation history. Do not paste
   artifacts into fenced blocks: the prebuild gate refuses a brief whose
   fences are not pack excerpts beyond a small cumulative budget, and what
   the budget admits is hashed into the manifest.
3. **Evidence.** Curation is rule-driven and there is no flag that removes
   derived evidence: conventions, the repository floor, the patch's own files,
   recognized TypeScript tests, one facade-aware import hop and the exclusions
   are all derived. Other stack relationships need additive commentary. What
   you supply is the pin and the commentary:
   - `review`: `--base <ref>` so the patch derives from git and the manifest
     records base and head SHAs. A `--patch <file>` alone is recorded
     caller-supplied-unpinned; beside a `--base` it is checked against the
     full delta and every scoped-out file becomes an exclusion.
   - either mode: `--excerpt <path[:start-end]>` adds commentary beside the
     floor without narrowing derived scope.
   - either mode: `--test-output <file>` when a run's output is evidence.

   The floor runs the check command `package.json` declares and carries its
   output; `--test-output` is for a run the floor does not make.

   Read what the tool prints before fan-out: exclusions and fence residue are
   surfaced there so a thin pack is caught while it is still cheap.
4. **Run** from the target repo root. Use `magi --help` for the canonical
   syntax. `--base` and `--patch` are review-only; `--slug` is optional and
   defaults to the mode.
   The tool renders the seat brief, fans out the three seats, gates their
   answers mechanically and writes the consult dir under
   `.magi/consults/<id>/`.
5. **Degraded?** If the consult is labeled degraded, stop and ask the user
   whether to proceed on it. A canary warning is not a degrade: read it
   against that consult's residue snapshot in `raw/` and carry it forward.
6. **Checks before judgment.** Run `magi checks <consult-id>`: it plans every
   seat-proposed check against the built-in read-only vocabulary, executes
   only what matches (no shell, only PATH inherited, repo cwd, bounded time
   and output) and records every proposal, run or refused, under the consult's
   `checks/` dir. Project-code commands such as npm and node are refused. Run
   one manually only after reading it yourself. Deterministic evidence
   outranks opinion.
7. **Spot-check citations** before recommending adoption of any finding; a
   citation that does not support its claim is counter-evidence, record it.
8. **Synthesis recommendation.** Draft a recommendation for every PENDING
   finding: adopt or reject with a one-line reason. Recommend rejecting an
   evidence-backed finding only by citing counter-evidence; an owner
   preference is not counter-evidence. Keep rejected findings visible.
   When `magi doctor` reports family skew TRIPPED, the foreign-draft
   contingency is on: a non-Claude seat's opinion drafts the synthesis and
   that draft is your default. Deviate from it only by citing
   counter-evidence, and record every deviation.
9. **User decision.** Show every recommendation and unresolved dissent to the
   USER. Do not finalize synthesis or continue the work until the USER
   approves or changes the dispositions.
10. **Ledger backfill.** After that decision, finalize `synthesis.md`. The
    ledger is append-only: never rewrite the consult row. Append a backfill
    row naming the consult, carrying one disposition per finding (slot,
    finding, disposition, reason) and `duplicateOf` when a second family
    raised the same point, so family credit stands while the unique count does
    not double. `magi doctor` must show the consult complete afterwards.
11. **Proceed** with the work, telling the user what was adopted, what was
    rejected and why, and where the raw record lives.
