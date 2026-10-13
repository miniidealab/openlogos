---
title: Test Slice Manifest
description: TEST_SLICE_MANIFEST.json, the slice checkpoint ledger, and how verify uses them for slice checkpoints and final acceptance.
---

`TEST_SLICE_MANIFEST.json` records which `[code]` slice owns which test IDs in a launched change. `openlogos verify` uses it to accept a multi-slice change **one slice at a time** (slice checkpoints), then runs full acceptance once all slices are done. This page summarizes the protocol. For the command, see [`openlogos slice`](/cli/slice).

## Scope

The protocol applies to an active launched proposal whose `[code]` section has **two or more slices**, where every slice line mentions at least one real test ID. Single-slice proposals, docs-only proposals, and older proposals that already passed final verify use the normal full verify. For them the manifest, if present, has no effect.

## Files and who writes them

All files live in `logos/changes/<slug>/`.

| File | Written by | How |
|------|------------|-----|
| `SPEC_MERGED` → `test_change_set` | `openlogos merge` | Records which test IDs this change added or modified (C) and removed (R), computed from a semantic before/after diff of the merged test specs |
| `tasks.md` → `## [code]` | `openlogos slice plan` | Whole section replaced. Checkboxes are kept per slice when `task_text` is unchanged. `[delta]` / `[deploy]` are untouched. |
| `TEST_SLICE_MANIFEST.json` | `openlogos slice plan` | Written in the same call as `[code]`. Validated first, then atomically renamed into place. |
| `SLICE_CHECKPOINTS.jsonl` | `openlogos verify` | Append-only. One line per slice checkpoint result. |
| `LOOP_ITERS` | `openlogos verify` | Append-only. Only real gate attempts are recorded. |
| `VERIFY_PASS` / `VERIFY_FAIL` | `openlogos verify` | `VERIFY_PASS` only on final acceptance |

The [slice-planner](/skills/slice-planner) Skill **produces** the slice content as a structured `slices.json`. It does not **write** these files. Hosts and Agents must not write the manifest, checkpoints or markers by hand, and must not work out slice ownership by parsing `[code]` prose. Ownership comes only from `owned_test_ids` in the manifest.

## Manifest format (v1)

```json
{
  "schema": "openlogos/test-slice-manifest@1",
  "change": "add-order-flow",
  "module": "core",
  "task_fingerprint": "sha256:5f2f8f53…c5c9bb",
  "spec_fingerprint": "sha256:c2fda0fb…01bf29",
  "generated_at": "2026-08-15T00:00:00.000Z",
  "slices": [
    {
      "slice_id": "slice-01-order-api",
      "task_text": "Order API end to end: handler + DAO + UT/ST + reporter (covers UT-S01-01, ST-S01-01)",
      "owned_test_ids": ["ST-S01-01", "UT-S01-01"],
      "runner_selectors": ["UT-S01-01", "ST-S01-01"],
      "spec_targets": ["logos/resources/test/core-S01-test-cases.md"]
    }
  ]
}
```

| Field | Meaning |
|-------|---------|
| `schema` | Exactly `openlogos/test-slice-manifest@1`. A manifest with an unknown major version is `unsupported` and is never overwritten or partly parsed. |
| `change`, `module` | Must match the active guard |
| `task_fingerprint` | SHA-256 of the structured `[code]` section: task texts and their order. Checkbox state, list markers and whitespace are ignored. |
| `spec_fingerprint` | SHA-256 over all `spec_targets` files, sorted by path, with line endings normalized to LF |
| `generated_at` | Audit only. It is not part of any fingerprint or identity. |
| `slices[]` | Non-empty and ordered like `[code]`. Each item has `slice_id` (`^[a-z0-9][a-z0-9-]{2,63}$`, unique), `task_text`, `owned_test_ids`, `runner_selectors` and `spec_targets` (merged test spec paths under `logos/resources/test/`). |

Both fingerprints are computed by the CLI from the files it writes. They are never supplied as input.

## Ownership rules

Let **D** be all test IDs defined in the merged specs, **C** the IDs this change added or modified, **R** the IDs it removed, and **B = D − C** the unchanged baseline:

- The union of all `owned_test_ids` equals **C** exactly. Every changed ID is owned once, and no unchanged baseline ID is owned.
- No ID is owned by two slices, and each owned ID is defined in exactly one spec target.
- Removed IDs belong only to R. They never appear in owned, eligible, pending or uncovered.
- If a test cannot be assigned to a single slice, planning stops with `test-slice-assignment-ambiguous`. It does not guess.

A test row that is carried into the final spec unchanged is part of B, even if it appears in a test delta.

## How verify uses it

Let **P** be the slices that already have a valid PASS checkpoint, and **A** the first slice in manifest order that is not in P.

| State | `verify_mode` | Tests checked (eligible) | Pending |
|-------|---------------|--------------------------|---------|
| A exists | `slice-checkpoint` | B + owned(P) + owned(A) | The rest of C |
| A absent and `[code]` complete | `final` | All of D | None |

- A checkpoint applies the normal Gate 3.6 rules (consistent ledger, zero failed, zero uncovered) to the eligible set. **PASS** appends a checkpoint line and does not write `VERIFY_PASS`. **FAIL** writes `VERIFY_FAIL` and a `LOOP_ITERS` row with `verify_mode` and `attempted_slice_id`.
- Pending tests are not results. They are neither uncovered nor failed. If a runner reports a pending ID, the ledger is marked inconsistent (`result_outside_eligible_scope`).
- Only a **final** PASS writes `VERIFY_PASS`.

During a slice-aware run, verify passes the eligible IDs to the pre-run command in the environment variable `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` (a JSON array), so a runner can narrow its selection.

## Checkpoint ledger

Each line of `SLICE_CHECKPOINTS.jsonl` is one JSON object:

```json
{"schema":"openlogos/slice-checkpoint@2","slice_id":"slice-01-order-api","manifest_sha256":"sha256:3b2f…daef","result":"PASS","eligible_test_ids_sha256":"sha256:ae3f…5c95","timestamp":"2026-08-15T00:10:00.000Z"}
```

- `manifest_sha256` identifies **which slicing** the line belongs to. It is a hash of the manifest's substance (`schema`, `change`, `module`, `slices`, `task_fingerprint`, `spec_fingerprint`) and excludes `generated_at`.
- Only lines whose identity matches the current manifest and whose `result` is `PASS` count as confirmed. Retrying an identical PASS does not add a duplicate line.
- Older `@1` lines are read with their original rule, and lines with an unknown major version are ignored. The ledger is never rewritten.

The identity has these consequences:

| Situation | Identity | Existing checkpoints |
|-----------|----------|----------------------|
| Recovery: same `slices.json` re-run | Unchanged | Still count. Verify resumes at the first unconfirmed slice. |
| Re-slicing: `slices` changed | Changed | No longer count |
| Merged test specs changed (`spec_fingerprint`) | Changed | No longer count |

## Diagnostics and recovery

Verify, `status` and `next` all use the same validator. It runs before any test command starts. It checks the test change set first, then the manifest.

| Code | Meaning | Recovery |
|------|---------|----------|
| `test-change-set-missing` / `-invalid` / `-unsupported` / `-tampered` | The `test_change_set` in `SPEC_MERGED` is missing, invalid, of an unknown version, or no longer matches the spec files | Not automatic. Go back to merge, or resolve manually. |
| `test-slice-manifest-missing` | Multi-slice implement without a manifest | Re-run `openlogos slice plan` |
| `test-slice-manifest-invalid` | Schema, field or path problem | Fix `slices.json` and re-run |
| `test-slice-manifest-stale` | `[code]` or spec fingerprints no longer match | Re-run `openlogos slice plan` |
| `test-slice-manifest-unsupported` | Unknown manifest major version | Not automatic |
| `test-slice-id-duplicate` | Duplicate `slice_id` | Fix and re-run |
| `test-slice-test-id-missing` / `-unknown` | A changed ID has no owner, or an owned ID is not changed by this proposal or not defined | Fix and re-run |
| `test-slice-test-id-duplicate`, `test-slice-assignment-ambiguous` | An ID has more than one owner, or no single owner can be chosen | Resolve the ambiguity, then re-run |
| `slice-task-state-inconsistent` | Facts disagree, for example all checkpoints passed but a task is unchecked | Fix the task state |

When the manifest is missing, invalid or stale **and** the change set is valid, `openlogos next` returns `next_node.id = "plan-slices"` with `skill: slice-planner`. The recovery action is always the same: run `openlogos slice plan --file <slices.json>` again with the same input. There is no recovery transaction, phase or `--recover` flag. Completed slices keep their checkboxes and checkpoints, and `SLICES_APPROVED` is left alone.

If the change set itself is broken, OpenLogos stays blocked at merge / spec-complete. It does not dispatch slice planning.

Never delete or rename `TEST_SLICE_MANIFEST.json`, edit `[code]` by hand, or forge checkpoint lines to "unstick" a proposal.

## Safety

- Every violation is reported with `code`, `path`, `message` and `fix_hint`, in a stable order. Violations are never collapsed into one summary line.
- Paths must stay inside the proposal or the declared test specs. Absolute paths, `..` and escaping symlinks are rejected.
- The files hold only IDs, hashes and states. They contain no credentials, personal data or test output.

## Related

- [`openlogos slice`](/cli/slice): write `[code]` and the manifest
- [`openlogos verify`](/cli/verify): slice checkpoints and final acceptance (Gate 3.6)
- [Slice Planner](/specs/slice-planner): how slices are cut
- [CLI JSON Output](/specs/cli-json-output): `slice_verification_state` and `contract.version`
