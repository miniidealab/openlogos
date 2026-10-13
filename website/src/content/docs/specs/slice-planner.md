---
title: Slice Planner
description: How [code] slices are planned after merge — six-dimension scoring, the vertical/horizontal discriminator, the delete-the-rest falsification gate, and writing them with openlogos slice plan.
---

The Slice Planner specification governs how a change proposal's `[code]` implementation work is cut into **well-formed slices** after the spec has merged. Under a launched change, this is the **single source of truth** for `[code]` slices — how many slices, and what each does, is decided **once, here**, using six-dimension scoring plus the delete-the-rest falsification gate. Downstream, `code-implementor` merely consumes each slice line by line; it never re-scores or re-batches.

## When It Runs (Post-Merge, Pre-Implement)

Slice planning was deliberately moved to run **after merge, before implement**. In the launched flow it is a dedicated `slice` subflow (single node `plan-slices`, `skill: slice-planner`) sitting between `merge` and `implement` (see the [Flow Specification](/specs/flow-spec)).

- `openlogos next` lands on the `ready-to-implement` step / `plan-slices` node (the host injects the "plan slices" context).
- The user says "cut the slices" / "write `[code]`" / "plan the implementation tasks" after the change has merged.

**Hard prerequisites (all required):**

1. The active proposal exists and has merged — a `SPEC_MERGED` (or `MERGED`) marker is present.
2. The spec deltas have merged into the main documents (architecture / scenario / feature specs under `logos/resources/prd/`), or the marker explicitly records `type:"no_delta_spec_complete"` for a pure-code proposal with no document delta.
3. **Test cases have merged or been explicitly referenced and IDs are fixed** — the relevant `logos/resources/test/*-test-cases.md`, `proposal.md`, or `tasks.md` contain real `UT-*` / `ST-*` / `SMOKE-*` IDs.

If any prerequisite fails, it is **not yet time to slice**. Missing `SPEC_MERGED`/`MERGED` must route to `spec-complete-required`; missing real test IDs after spec-complete must route to `test-id-required`. Placeholder IDs are forbidden. Cutting against the *merged spec and real test IDs*, not against a draft guess, is precisely why this step lives after merge.

## The Only Deliverable

A structured **`slices.json`**: a set of well-formed slices that **passed the delete-the-rest gate**. Each slice has a `slice_id`, a `task_text` that ends with the real `UT-Sxx-..` / `ST-Sxx-..` IDs it covers, `owned_test_ids`, `runner_selectors` and `spec_targets`.

The slice planner **produces** the slice content. It does not **write** the canonical files. `openlogos slice plan --file <slices.json>` writes both the `## [code]` section of `tasks.md` and `TEST_SLICE_MANIFEST.json` in one validated call (see [`openlogos slice`](/cli/slice)). Never hand-edit `[code]` or the manifest: `owned_test_ids` decides what verify checks, so it must come from the CLI-written manifest, not from prose.

There is **no slice transaction**. There are no content slots, no seal / apply / recover / abort / reopen steps, and no phases. If you find guidance that points to those commands, it is outdated.

The slice planner does **not** produce `proposal.md`, `[delta]`, `[deploy]` (that is `change-writer`'s job) and does **not** write business code (that is `code-implementor`'s job).

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

- **(a) Delete the rest — can it independently pass verify?** If slices i+1..N are all deleted and only slices 1..i are done, can `openlogos verify` go green? Verify always includes the baseline regression tests. In a slice checkpoint it adds the tests owned by slices 1..i; final acceptance checks everything.
- **(b) Is it end-to-end observable?** Does finishing slice i produce one end-to-end, observable capability — rather than just laying plumbing / wiring for later slices?

Any "no" → slice i **is not self-closed** → **merge it forward** into the slice that depends on it, and re-run the gate.

> **Why this gate:** a slice narrows the `code` context injection, but verify still runs the baseline regression on every checkpoint. A "foundation slice" (built but unused, fails (b)) or a "forward-dependency slice" (logic depends on later slices not yet landed, fails (a)) will fail verify, and the loop can never exit. It deadlocks at `verify-failed`. The delete-the-rest gate catches such horizontal cuts **at the slicing stage**.

Record the per-slice conclusions of this pass (which slices were merged, and why) as the audit trail of the slicing decision. Put them in the slices' `task_text`, or show them to the user with the command output. `openlogos slice plan` renders the whole `[code]` body from `slices.json`, so do not add notes to `[code]` by hand.

## Step 5 — Escape Hatch (Big Task That Won't Split → Explicit Single Slice)

Score ≥ 8 but **no vertical cut passes Step 4** (typical: an atomic capability whose parts are mutually locked, e.g. "a completion judgment from three inter-dependent signals") → **keep a single slice** and note in the task "score reaches big-task, but `<reason>` cannot be safely split vertically, hence single slice". This is a **compliant outcome, not laziness**. When unsure whether two slices can each close, always merge.

## Step 6 — Shape Each `[code]` Slice

1. **Each line = one self-closed slice**: business code + that slice's UT/ST + OpenLogos reporter + necessary golden baseline, with **no dependency on later slices in the same batch**.
2. **Ordered, no forward dependencies**: implemented top to bottom serially (v1 does not model a DAG); depended-upon slices come first.
3. **Tag real case IDs**: each line ends with the `UT-Sxx-..` / `ST-Sxx-..` it covers, aligned with the merged `test/*-test-cases.md` (**IDs are fixed now — no more placeholders**).
4. **No splitting by trade**: implementation code / writing tests / writing the reporter / updating golden / doc notes must all merge into the same self-closed slice, never each into its own.
5. **Empty `[code]`**: a docs/delta-only proposal with no code output may leave `[code]` empty — the slice loop degenerates to `tests_green`.

**Smoke-case closure rule:** when the proposal adds/modifies `logos/resources/test/smoke/*.md`, the `[code]` slice text must list the new `SMOKE-*` IDs and require the runner, `smoke-results.jsonl` reporter, config hookup, and a post-implementation smoke coverage pre-check.

## Step 7 — Write the Slices with `openlogos slice plan`

Write the slices to `slices.json`, then run:

```bash
openlogos slice plan --file slices.json
```

```json
{
  "slices": [
    {
      "slice_id": "slice-01-capability",
      "task_text": "End-to-end capability: implement X with UT/ST + reporter (covers UT-S01-01, ST-S01-01)",
      "owned_test_ids": ["UT-S01-01", "ST-S01-01"],
      "runner_selectors": ["UT-S01-01", "ST-S01-01"],
      "spec_targets": ["logos/resources/test/core-S01-test-cases.md"]
    }
  ]
}
```

- `slice_id`: stable, kebab-case, unique (recommended `slice-<nn>-<short-name>`). If the input does not change, re-running produces the same output.
- `owned_test_ids`: every test ID that this change adds or modifies is owned by **exactly one** slice. Shared baseline regression tests are not owned.
- `runner_selectors`: non-empty selectors that run the slice's owned tests.
- `spec_targets`: merged test spec files under `logos/resources/test/`.
- Do not supply fingerprints, `schema`, `change`, `module` or `generated_at`. The CLI writes them.

The command validates everything **before** writing. On failure it lists each violation with `code`, `path` and `fix_hint`, and leaves `tasks.md` and the manifest untouched. Fix `slices.json` and run it again. On success, **read the `[code]` section back from disk** and show it to the user.

## Recovery and Re-planning

- **Manifest missing, invalid or stale** (`next_node.id == "plan-slices"` with a `test-slice-manifest-*` reason): do **not** re-score or re-cut. Re-run `openlogos slice plan` with the **same** `slices.json` (same `slice_id` / `task_text`). The command keeps the checkboxes of unchanged slices, and existing checkpoints stay valid.
- **The slicing itself was wrong**: change `slices.json` and run the same command again. Slices whose `task_text` changed are reset to unchecked, and checkpoints of the old slicing no longer count.
- Never delete or rename `TEST_SLICE_MANIFEST.json`, restore `[x]` by hand, or edit `SLICE_CHECKPOINTS.jsonl`.

Manifest format and verify behavior are described in [Test Slice Manifest](/specs/test-slice-manifest).

## Relationship to `tasks.md` and CLI Derivation

- `write-tasks` (in the plan segment, *before* merge) **no longer produces `[code]`**. Its completion predicate narrowed from `tasks_filled` to `tasks_delta_filled` — `[delta]`/`[deploy]` filled out of template is enough; slices wait for `plan-slices` after merge. A pure-code proposal with no delta must still keep an empty `## [code]` heading.
- For pure-code proposals, the empty `## [code]` heading is only the structural anchor for `code_required`; it does not mean slice planning may start. `openlogos merge <slug>` must first write the no-delta `SPEC_MERGED` marker.
- `plan-slices` completes when `tasks_code_filled` holds (the `[code]` section is filled with real slices, all unchecked). This is distinct from `implement.code`'s `section_complete:code` (all checked = implementation done): the former judges "slices are planned", the latter "slices are implemented".
- After `plan-slices` completes, the proposal stays at `ready-to-implement` until the `slice-exit` gate is approved. `next_node` then carries `id: "plan-slices"` plus `gate_id: "slice-exit"`, so the host must not re-dispatch slice-planner. `openlogos next --auto` releases this gate and writes `SLICES_APPROVED`, but only after `[code]` is really filled. After approval the step becomes `coding`.
- A `CODE_AUTORESET` protection guards ordering: if `[code]` was filled early (by `write-tasks`, before `plan-slices` legitimately entered), the CLI auto-resets it back to a template placeholder on the deterministic entry into the slice stage, backing up the old text (append-only JSONL). This keeps slice-planner as the single source of truth even when a `[code]` block was pre-filled out of order.

The machine contracts (`slice_state`, `next_node.slice`, `ready-to-implement`, `slice-exit`, `SLICES_APPROVED`) are specified in [CLI JSON Output](/specs/cli-json-output).
