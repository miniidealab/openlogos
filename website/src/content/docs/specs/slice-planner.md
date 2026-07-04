---
title: Slice Planner
description: How [code] slices are planned after merge — six-dimension scoring, the vertical/horizontal discriminator, and the delete-the-rest falsification gate.
---

The Slice Planner specification governs how a change proposal's `[code]` implementation work is cut into **well-formed slices** after the spec has merged. Under a launched change, this is the **single source of truth** for `[code]` slices — how many slices, and what each does, is decided **once, here**, using six-dimension scoring plus the delete-the-rest falsification gate. Downstream, `code-implementor` merely consumes each slice line by line; it never re-scores or re-batches.

## When It Runs (Post-Merge, Pre-Implement)

Slice planning was deliberately moved to run **after merge, before implement**. In the launched flow it is a dedicated `slice` subflow (single node `plan-slices`, `skill: slice-planner`) sitting between `merge` and `implement` (see the [Flow Specification](/specs/flow-spec)).

- `openlogos next` lands on the `ready-to-implement` step / `plan-slices` node (the host injects the "plan slices" context).
- The user says "cut the slices" / "write `[code]`" / "plan the implementation tasks" after the change has merged.

**Hard prerequisites (all required):**

1. The active proposal exists and has merged — a `SPEC_MERGED` (or `MERGED`) marker is present.
2. The spec deltas have merged into the main documents (architecture / scenario / feature specs under `logos/resources/prd/`).
3. **Test cases have merged and IDs are fixed** — the relevant `logos/resources/test/*-test-cases.md` contain real `UT-Sxx-..` / `ST-Sxx-..` IDs.

If any prerequisite fails (especially undefined test IDs), it is **not yet time to slice** — placeholder IDs are forbidden. Cutting against the *merged spec and real test IDs*, not against a draft guess, is precisely why this step lives after merge.

## The Only Deliverable

The `## [code]` section of `tasks.md` — a set of well-formed slices that **passed the delete-the-rest gate**, each ending with the real `UT-Sxx-..` / `ST-Sxx-..` IDs it covers. The slice planner does **not** produce `proposal.md`, `[delta]`, `[deploy]` (that is `change-writer`'s job) and does **not** write business code (that is `code-implementor`'s job).

## Step 1 — Read the Merged Spec + Real Test IDs

Read the proposal's change scope, then the architecture / scenario / feature specs and `test/*-test-cases.md` that have merged into `logos/resources/`. List the code capabilities to land and the full set of available `UT/ST` IDs.

## Step 2 — Six-Dimension Scoring (Is It a Big Task?)

| Dimension | 0 pts | 1 pt | 2 pts |
|-----------|-------|------|-------|
| Blast radius | 1 file / local function | 2–5 related files | Cross-module / service / client |
| Behavioral complexity | Single-path bugfix | 2–3 branches | Multi-scenario / state machine / async |
| Contract change | None | Small CLI/API output tweak | API/DB/flow/compat contract change |
| Test size | 1–3 cases | 4–8 cases | 9+ cases or multi-type matrix |
| Risk level | Easy rollback | Compatibility risk | Data / security / deploy / migration |
| Uncertainty | Cause clear | 1 hypothesis to verify | Multiple unknowns / needs exploration |

- **0–7 pts = not a big task → a single slice.** Even with code + tests + reporter + golden, write only one `[code]` line.
- **8+ pts = big task → go to Step 3 and attempt a vertical split.**

## Step 3 — Vertical / Horizontal Discriminator (Pick the Right Axis)

Only a **vertical split by sub-capability** is valid; **splitting by trade / layer / file is forbidden**. Name each slice, then check which category the name falls into:

- 🚩 **Horizontal red flags (forbidden — any hit means re-cut):** the name is a layer / file / trade — "foundation / base / read-write / plumbing / wiring / helper / utility / config hookup / schema / types / data layer (alone) / UI display (alone) / write tests / add reporter / re-shoot golden". A slice set that reads like "first build the base → then write logic → then add utilities → finally wire the UI" has mistaken **construction order** for slices and must be re-cut.
- ✅ **Valid vertical:** the name is **one end-to-end capability line / one scenario / one independent sub-module's complete closed loop** — data → logic → output → that slice's tests all land inside the same slice.

## Step 4 — Delete-the-Rest Falsification Gate (Mandatory)

With N slices drafted, ask two questions **per slice**:

- **(a) Delete the rest — can it independently pass full verify?** If slices i+1..N are all deleted and only slice i is done, can `openlogos verify` (always a full regression) go green?
- **(b) Is it end-to-end observable?** Does finishing slice i produce one end-to-end, observable capability — rather than just laying plumbing / wiring for later slices?

Any "no" → slice i **is not self-closed** → **merge it forward** into the slice that depends on it, and re-run the gate.

> **Why this gate:** a slice scopes only the `code` context injection, **not** verify. A "foundation slice" (built but unused, fails (b)) or a "forward-dependency slice" (logic depends on later slices not yet landed, fails (a)) will inevitably fail full verify, and the loop can never exit — it deadlocks at `verify-failed`. The delete-the-rest gate falsifies such horizontal cuts **at the slicing stage**.

The per-slice conclusions of this pass **must be written at the top of the `[code]` section** (which slices were merged, and why) as the audit trail of the slicing decision.

## Step 5 — Escape Hatch (Big Task That Won't Split → Explicit Single Slice)

Score ≥ 8 but **no vertical cut passes Step 4** (typical: an atomic capability whose parts are mutually locked, e.g. "a completion judgment from three inter-dependent signals") → **keep a single slice** and note in the task "score reaches big-task, but `<reason>` cannot be safely split vertically, hence single slice". This is a **compliant outcome, not laziness**. When unsure whether two slices can each close, always merge.

## Step 6 — Write the `[code]` Section

1. **Each line = one self-closed slice**: business code + that slice's UT/ST + OpenLogos reporter + necessary golden baseline, with **no dependency on later slices in the same batch**.
2. **Ordered, no forward dependencies**: implemented top to bottom serially (v1 does not model a DAG); depended-upon slices come first.
3. **Tag real case IDs**: each line ends with the `UT-Sxx-..` / `ST-Sxx-..` it covers, aligned with the merged `test/*-test-cases.md` (**IDs are fixed now — no more placeholders**).
4. **No splitting by trade**: implementation code / writing tests / writing the reporter / updating golden / doc notes must all merge into the same self-closed slice, never each into its own.
5. **Empty `[code]`**: a docs/delta-only proposal with no code output may leave `[code]` empty — the slice loop degenerates to `tests_green`.

**Smoke-case closure rule:** when the proposal adds/modifies `logos/resources/test/smoke/*.md`, the `[code]` slice text must list the new `SMOKE-*` IDs and require the runner, `smoke-results.jsonl` reporter, config hookup, and a post-implementation smoke coverage pre-check.

After writing, **read the `[code]` section back from disk** and show the original text to confirm it landed.

## Relationship to `tasks.md` and CLI Derivation

- `write-tasks` (in the plan segment, *before* merge) **no longer produces `[code]`**. Its completion predicate narrowed from `tasks_filled` to `tasks_delta_filled` — `[delta]`/`[deploy]` filled out of template is enough; slices wait for `plan-slices` after merge. A pure-code proposal with no delta must still keep an empty `## [code]` heading.
- `plan-slices` completes when `tasks_code_filled` holds (the `[code]` section is filled with real slices, all unchecked). This is distinct from `implement.code`'s `section_complete:code` (all checked = implementation done): the former judges "slices are planned", the latter "slices are implemented".
- A `CODE_AUTORESET` protection guards ordering: if `[code]` was filled early (by `write-tasks`, before `plan-slices` legitimately entered), the CLI auto-resets it back to a template placeholder on the deterministic entry into the slice stage, backing up the old text (append-only JSONL). This keeps slice-planner as the single source of truth even when a `[code]` block was pre-filled out of order.

The machine contracts (`slice_state`, `next_node.slice`, `ready-to-implement`, `slice-exit`, `SLICES_APPROVED`) are specified in [CLI JSON Output](/specs/cli-json-output).
