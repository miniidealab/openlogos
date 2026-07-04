---
title: Orchestratable Flow
description: The declarative dev-flow engine, gates, loops, slices, and two-tier (semi-auto / full-auto) authorization behind OpenLogos automation.
---

OpenLogos models the **entire development lifecycle** as a declarative state machine — not as a script the tool runs, but as a single source of truth the tool *reads*. From that model, OpenLogos derives "where am I now, and what should run next." This page is the concept + glossary for that engine.

## What the flow engine is

A flow is a YAML file that describes the development process as an ordered structure of **subflow → node → gate → loop**. It is the single source of truth for the process shape.

The engine is **passively derived** (the "A architecture"): OpenLogos reads the flow file and scans the filesystem, then **derives** the current frontier — which node is `done` / `active` / `skipped` / `failed` / `pending`. It does **not** spawn agents, run scripts, or hold a long-running process. `status`, `next`, and `watch` all derive their view from the template; the engine keeps **no independent state of its own**. Execution is delegated to the host (Claude Code, a human, or CI). OpenLogos is "the score and the conductor," not "the musician's hands."

Projects don't copy the whole template. A project instance uses an **overlay** (`extends: builtin:launched`) and writes only the differences — so the methodology can evolve centrally while each project keeps just its deltas.

| Term | Meaning |
|------|---------|
| **subflow** | An ordered group of nodes with an optional entry/exit gate and an optional loop. |
| **node** | A single step, optionally bound to a `skill`, with a `done_when` completion predicate. |
| **gate** | A confirmation point at a subflow boundary (`type: human` / `none`). |
| **loop** | A convergence loop over a subflow (`until`, `max_iters`). |
| **overlay** | Per-node/subflow diffs (`skip` / `add` / `modify` / `reorder` / `set-loop`) applied on top of a builtin baseline. |

## The launched 7-stage flow

Once a project is launched, every change proposal flows through seven subflows:

| # | Subflow | What happens | Gate |
|---|---------|--------------|------|
| 1 | **plan** | Write `proposal.md` + split `tasks.md` into `[delta]` / `[deploy]` | human, skippable (`plan-exit`) |
| 2 | **spec** | Write the `[delta]` spec change (`when: delta_required`) | human, skippable (`spec-exit`) |
| 3 | **merge** | Generate `MERGE_PROMPT` and apply the delta (`when: delta_required`) | none |
| 4 | **slice** | Plan `[code]` slices from the merged spec (`when: code_required`) | human, skippable (`slice-exit`) |
| 5 | **implement** | `code` + `verify`, default slice loop until all slices green | none |
| 6 | **deliver** | `deploy` + `smoke` (each guarded by its own `when`) | human, entry, skippable (`deliver-entry`) |
| 7 | **close** | `archive` | none |

Pure-code proposals (no `[delta]`) skip **spec** and **merge**; pure-docs proposals (no `[code]`) skip **slice**. The stages that don't apply to a given proposal drop out via their subflow-level `when`.

## Gates

A **gate** is a confirmation point at the entry or exit of a subflow:

- `type: human` — a human confirmation point. `next` reports "needs human confirmation" and does not auto-advance.
- `type: none` — no gate; flow passes straight through.
- `skippable: true | false` — declares whether this human gate is **allowed to be auto-passed** in auto mode. `skippable: false` guards high-risk actions and stays blocked even under `--auto`.

## Loops, and the loop-exhausted hard red line

The **implement** subflow ships with the slice loop **active by default**:

```yaml
loop: { until: code_slices_green, max_iters: 30 }
```

`code_slices_green` converges when every `[code]` slice in `tasks.md` is checked **and** the last verify run is green. The convergence signal is an **objective number** (tests green / all slices checked ∧ tests green), never a subjective review verdict. While the loop is unconverged, the flow **must not advance** to any later subflow (deliver / close).

When iteration reaches `max_iters` without converging, the loop escalates to a dedicated exit gate: `gate:implement:loop-exhausted`, **`skippable: false` by default**.

This is the **hard red line**. It is the guardian of the premise that "what gets shipped is verified work": **no mode — including `--auto` — ever auto-passes code that has not passed tests.** Full-auto's standing authorization explicitly does *not* cover `loop-exhausted`; unconverged code is blocked in every mode. (The only opt-in relief is an explicit overlay `set-loop` with `exhausted_gate.skippable: true`, off by default.)

## Slices

A **slice** is the independent subflow that sits **after merge and before implement**. Its single node runs the [`slice-planner`](/skills/slice-planner) skill, which turns the *merged* spec plus *real* test IDs into well-formed `[code]` slices using a **six-dimension score** and a **delete-the-rest falsification gate** (for each slice: could it independently pass a full `verify` if all later slices were deleted, and is it end-to-end observable?).

The slice stage is the **single source of truth** for `[code]` under a launched change — how many slices there are and what each one does is decided **once, here**. Downstream, `code-implementor` only consumes the slices line by line; it does not re-score or re-batch. Slicing on merged spec + real test IDs (rather than guessing against a draft) is the whole reason this stage lives after merge.

## Residency states

Between stages, the derived frontier settles into stable **residency states** while it waits at a gate:

- `ready-to-delta` — plan done, waiting at the plan-exit gate.
- `ready-to-merge` — delta written, waiting at the spec-exit gate.
- `ready-to-implement` — slices planned, waiting at the slice-exit gate.
- `ready-to-deploy` — waiting at the deliver-entry gate before deploy.

(Others include `ready-to-verify` and `ready-to-smoke`.) These are the plateaus where a human — or, in full-auto, the standing authorization — decides whether to pass the gate.

## Two-tier authorization: semi-auto vs full-auto

The same flow supports two authorization tiers, chosen by the host at runtime.

**Semi-automatic (default, no `--auto`).** `merge`, `verify`, deployment, `smoke`, `archive`, and `git push` are **human confirmation points**. AI does not run them without explicit authorization. Every human gate behaves exactly as declared.

**Full-automatic / unattended (`openlogos next --auto`).** Choosing `--auto` is a one-time, **standing, run-scoped authorization** to run the proposal end-to-end. Beyond auto-passing `skippable: true` flow gates, the standing authorization also lets AI **automatically execute the CLI seal/publish steps that come *after code is green*** — `verify`, `smoke`, `archive`, and `git push`. (`git push` needs no marker: the PreToolUse guard's safety allowlist already permits it.) Each auto-pass **appends an append-only audit line** to `GATE_AUTO_PASSED` in the proposal directory — an audit trail, not a state source.

**Hard red line (both tiers):** `loop-exhausted` — unconverged code that hit the iteration limit without passing tests — **blocks in every mode, including `--auto`.** Full-auto ships verified results; it never ships untested code.

---

## Related

- [`openlogos flow show`](/cli/flow-show) — inspect the raw or `--resolved` (overlay-merged) flow.
- [`openlogos watch`](/cli/watch) — stream the derived frontier live.
- [flow-spec](/specs/flow-spec) — the field-level data-model contract behind this page.
- [Change management](/specs/change-management) — the delta workflow the launched flow drives.
