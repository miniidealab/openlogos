---
title: "openlogos slice"
description: Write the [code] slices of a launched change and its TEST_SLICE_MANIFEST.json in one validated call.
---

`openlogos slice plan` is the only way to write the `## [code]` section of `tasks.md` and `TEST_SLICE_MANIFEST.json` for an active change. You (or the [slice-planner](/skills/slice-planner) Skill) describe the slices in a structured `slices.json`. The CLI validates the input and writes both files in a single call.

There is no slice transaction: no content slots, no seal / apply / recover / abort / reopen steps, and no phases. Planning, re-planning and recovery are all the same command.

> `openlogos --help` does not list `slice` yet, but the command is available in 0.16.0.

## Synopsis

```bash
openlogos slice plan --file <slices.json>
openlogos slice plan --file <slices.json> --slug <slug>
openlogos slice plan --file <slices.json> --format json
```

Run it from the project root, after the change has merged (`SPEC_MERGED` is present) and before implementation starts.

## Options

| Option | Description |
|--------|-------------|
| `--file <slices.json>` | Required. Path to the structured slice input, relative to the project root or absolute. |
| `--slug <slug>` | Target proposal. Defaults to the active change in `logos/.openlogos-guard`. |
| `--format json` | Output a JSON envelope (`command: "slice plan"`). |

## Input: `slices.json`

Either a JSON array of slices, or an object with a `slices` array:

```json
{
  "slices": [
    {
      "slice_id": "slice-01-order-api",
      "task_text": "Order API end to end: handler + DAO + UT/ST + reporter (covers UT-S01-01, ST-S01-01)",
      "owned_test_ids": ["UT-S01-01", "ST-S01-01"],
      "runner_selectors": ["UT-S01-01", "ST-S01-01"],
      "spec_targets": ["logos/resources/test/core-S01-test-cases.md"]
    },
    {
      "slice_id": "slice-02-order-panel",
      "task_text": "Order panel end to end: component + UT/ST + reporter (covers UT-S02-10, ST-S02-03)",
      "owned_test_ids": ["UT-S02-10", "ST-S02-03"],
      "runner_selectors": ["UT-S02-10", "ST-S02-03"],
      "spec_targets": ["logos/resources/test/core-S02-test-cases.md"]
    }
  ]
}
```

| Field | Rule |
|-------|------|
| `slice_id` | Stable slice identity: lowercase kebab-case, 3–64 characters (`^[a-z0-9][a-z0-9-]{2,63}$`), unique within the proposal. Recommended form: `slice-<nn>-<short-name>`. |
| `task_text` | The text of the `[code]` checkbox line, used verbatim. It must not be empty. End it with the real test IDs the slice covers. |
| `owned_test_ids` | Non-empty. Real UT/ST/SMOKE IDs from the merged test specs. Every test ID that this change adds or modifies must be owned by **exactly one** slice. No placeholders, wildcards or unknown IDs. |
| `runner_selectors` | Non-empty. Selectors that let your test runner execute the slice's owned tests. |
| `spec_targets` | Non-empty. Project-relative paths of the **merged test spec files** the slice depends on. They must be under `logos/resources/test/` and exist. Absolute paths and `..` are rejected. |

Do not put `schema`, `change`, `module`, `task_fingerprint`, `spec_fingerprint` or `generated_at` in the input. The CLI computes them, and the fingerprints are always taken from the `tasks.md` it is about to write.

Slice-aware verify (slice checkpoints, then final acceptance) is used when there are **two or more slices** and every `task_text` mentions at least one real test ID. A single slice is valid too. Verify then runs normal full acceptance, and the manifest has no effect on the result.

## Behavior

1. Resolves the proposal (`--slug` or the active guard) and checks that `tasks.md` exists.
2. Checks the input shape: valid JSON, a non-empty `slices` array, and correct field types.
3. Renders the new `[code]` body, one `- [ ] <task_text>` line per slice, in input order. The whole body under `## [code]` is replaced, and the heading is kept. `[delta]`, `[deploy]` and their checkboxes are left byte-for-byte unchanged.
4. Builds the manifest and computes `task_fingerprint` / `spec_fingerprint`.
5. **Validates before it writes.** Both files are first written to temporary files in the proposal directory. The pair is then checked by the same validator that `verify`, `status` and `next` use. Only if the check passes are the two temporary files renamed into place. On any failure the temporary files are deleted, and `tasks.md` and `TEST_SLICE_MANIFEST.json` keep their previous bytes. There is never a half-written state and nothing to clean up.

The command does not touch `SLICES_APPROVED` or `SLICE_CHECKPOINTS.jsonl`.

Do not edit the `[code]` section or the manifest by hand. They are inputs to verify, so they are written only by this command. Show the slicing rationale (the delete-the-rest gate conclusions) in `task_text` or to the user. Do not add it by hand to `[code]`.

### Checkbox preservation

For each `slice_id`, if its `task_text` is **exactly the same** as before, its existing `[x]` / `[ ]` state is kept. If the text changed, or the slice is new, the line is written unchecked. The previous text comes from the old manifest. If that is missing or unreadable, the CLI looks for the same text in the old `[code]` section. When the same text appears with conflicting states, it is treated as unchecked. There is no switch to override this, and you never need to restore checkboxes by hand.

## Recovery and re-planning

- **Manifest missing, invalid or stale** (`openlogos next` points to `plan-slices`, or verify pauses with `test-slice-manifest-*`): re-run `openlogos slice plan --file <slices.json>` with the **same input**. The slice identities stay the same, completed slices keep their checkboxes, and existing slice checkpoints remain valid.
- **The slicing itself was wrong**: edit `slices.json` and run the command again. Slices whose `task_text` changed are reset to unchecked. Checkpoints recorded for the old slicing no longer count.
- Do not delete or rename `TEST_SLICE_MANIFEST.json` to "make room" or to trigger recovery. Just run the command.

## Output

```
✓ 切片规划已写入 add-order-flow
  切片数：2
    - slice-01-order-api
    - slice-02-order-panel
  manifest：logos/changes/add-order-flow/TEST_SLICE_MANIFEST.json
  task_fingerprint：sha256:5f2f…c9bb

下一步：批准切片划分（slice-exit）后开始实现代码。
```

The text output is currently in Chinese regardless of locale. With `--format json`, `data` contains `slug`, `slice_count`, `slice_ids`, `task_fingerprint`, `spec_fingerprint` and `manifest_path`.

After the command succeeds, read the `[code]` section back from disk to confirm it, then approve the slicing at the `slice-exit` gate before implementing.

## Errors

| Code | Exit | Cause |
|------|------|-------|
| `SLICE_PLAN_NO_ACTIVE_CHANGE` | 1 | No active change, the proposal directory does not exist, or it has no `tasks.md` |
| `SLICE_PLAN_INPUT_INVALID` | 1 | The file is missing, is not valid JSON, has no non-empty `slices` array, or a field has the wrong type |
| `SLICE_PLAN_DUPLICATE_SLICE_ID` | 1 | Two slices share a `slice_id` |
| `SLICE_PLAN_UNKNOWN_TEST_ID` | 1 | An owned ID is not in the merged specs or not changed by this proposal, a changed ID is owned by no slice, or an ID is owned by more than one slice |
| `SLICE_PLAN_ARTIFACT_INVALID` | 2 | Any other validator violation, such as an invalid `slice_id` format, empty `task_text` or arrays, or a `spec_targets` path outside `logos/resources/test/` |

When the validator rejects the input, every violation is printed with its `code`, `path` (for example `slices[1].spec_targets[0]`), `message` and `fix_hint`, followed by a note that neither file was written. In JSON mode the error envelope on stderr carries the same list in `violations`. Fix `slices.json` and run the command again.

`openlogos slice` without `plan`, or `plan` without `--file`, prints the usage and exits with `1`.

## Related

- [slice-planner Skill](/skills/slice-planner): how to cut the slices
- [Slice Planner spec](/specs/slice-planner): slicing rules and the `slice-exit` gate
- [Test Slice Manifest](/specs/test-slice-manifest): manifest format, checkpoints and recovery
- [`verify`](/cli/verify): slice checkpoints and final acceptance (Gate 3.6)
- [`merge`](/cli/merge): must have run before slices are planned
