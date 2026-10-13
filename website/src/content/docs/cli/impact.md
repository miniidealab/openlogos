---
title: "openlogos impact"
description: Classify a git change range as pure OpenLogos lifecycle bookkeeping or not — a read-only check for CI pipelines.
---

Tell a CI pipeline whether a push only touched **OpenLogos lifecycle bookkeeping** — for example the commit produced by `openlogos archive`, verify results, or the guard file — so it can skip building and deploying artifacts. Everything else is reported as "not lifecycle-only" and left for the project to judge.

The command is read-only (it writes nothing, inside or outside the project) and is not a human confirmation point.

## Synopsis

```bash
openlogos impact --base <rev> --head <rev> [--format json]
git diff --no-relative --name-status -z <base> <head> | openlogos impact --stdin [--prefix <dir/>] [--format json]
```

## Options

| Option | Description |
|--------|-------------|
| `--base <rev> --head <rev>` | Git range mode. Both are required together. Each revision is resolved safely to a commit ID before diffing; values that are empty or start with `-` are rejected. |
| `--stdin` | Read `git diff --no-relative --name-status -z` bytes from stdin instead of calling git. Mutually exclusive with `--base` / `--head`. |
| `--prefix <dir/>` | `--stdin` mode only: the OpenLogos project's directory inside a monorepo (git top-level relative). In range mode the prefix is detected automatically. |
| `--format json` | Print a JSON envelope (schema `openlogos-change-impact.v1`). |

## How paths are classified

Paths are matched relative to the OpenLogos project root, on path-segment boundaries:

| Class | Paths | Meaning |
|-------|-------|---------|
| `lifecycle` | `logos/.openlogos-guard`, `logos/changes/**` (including `archive/`), `logos/resources/verify/**`, `logos/.runtime/**` | Pure bookkeeping; guaranteed not to end up in a deployable artifact |
| `project` | Anything else under `logos/` (specs, `logos.config.json`, …) | The project decides; OpenLogos does not vouch for it |
| `external` | Everything outside `logos/` or outside the project prefix | Business code; OpenLogos does not judge it |

`lifecycle_only` is `true` only when the change set is non-empty, every record parses, and every file (for renames and copies, both sides) is `lifecycle`. An empty diff, an unknown status letter, or a malformed stream gives `lifecycle_only: false` with the reason listed — it fails closed toward "build it".

## Output and exit codes

`lifecycle_only` is the **only** field CI should decide on. `files[]`, `non_lifecycle_paths`, `operations`, `changes` and `reasons` are for display.

| Exit | Meaning |
|------|---------|
| `0` | Classification finished — whether `lifecycle_only` is true **or** false. The exit code does not encode the verdict. |
| `1` | Operational error: `IMPACT_INPUT_INVALID` (bad option combination or value) or `IMPACT_GIT_DIFF_FAILED` (git unavailable, not a repository, unknown revision) |

## CI example

```bash
result=$(openlogos impact --base "$BASE_SHA" --head "$HEAD_SHA" --format json)
if [ "$(echo "$result" | jq -r '.data.lifecycle_only')" = "true" ]; then
  echo "Lifecycle-only change — skipping build and deploy"
  exit 0
fi
```

Pin the CLI version in CI so the classification rules do not change underneath you; breaking changes to the contract ship as a new schema version.

## Related commands

- [`archive`](/cli/archive) — Produces typical lifecycle-only commits
- [`verify`](/cli/verify) — Writes results under `logos/resources/verify/`
