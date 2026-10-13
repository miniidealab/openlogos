---
title: "openlogos archive"
description: Move a completed change proposal to the archive directory and release the active-change guard.
---

Move a finished change proposal from `logos/changes/<slug>/` to `logos/changes/archive/YYYYMMDD-HHmm-<slug>/`, and remove the guard file if it points at this proposal.

`openlogos archive` is a **human confirmation point**: in semi-auto mode the AI runs it only after you explicitly authorize it (under `openlogos next --auto` it is covered by the standing authorization).

## Synopsis

```bash
openlogos archive <slug>
```

Must be run from the project root.

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `slug` | **Yes** | The change proposal slug to archive |

## What it does

1. **Checks the completion chain** before touching anything. Archiving is refused (non-zero exit, nothing moved) when:
   - verify has not passed (`VERIFY_PASS` missing, or `VERIFY_FAIL` present) — `ARCHIVE_VERIFY_NOT_PASSED`
   - the proposal requires deployment but `DEPLOY_DONE` is missing — `ARCHIVE_DEPLOY_NOT_DONE`
   - the proposal requires deployment and smoke, but smoke has not passed — `ARCHIVE_SMOKE_NOT_PASSED`
2. Generates a timestamped directory name `YYYYMMDD-HHmm-<slug>` (e.g., `20261012-1430-fix-redirect-bug`).
3. Moves `logos/changes/<slug>/` → `logos/changes/archive/YYYYMMDD-HHmm-<slug>/`.
4. If `logos/.openlogos-guard` names this slug as `activeChange`, closes the proposal boundary for the guard's post-execution checks and deletes the guard file. From then on, version-controlled code and specs are protected again until the next `openlogos change`.

The archived directory keeps everything the proposal produced — `proposal.md`, `tasks.md`, `deltas/` and lifecycle markers such as `SPEC_MERGED`, `VERIFY_PASS` and `GATE_AUTO_PASSED`. The archive is an audit trail only: the current truth lives in `logos/resources/`.

After archiving, the AI commits the move automatically; pushing (`git push`) is a separate human confirmation point.

## Example output

```
  ✓ logos/.openlogos-guard removed

✓ Change proposal 'fix-redirect-bug' archived.
  logos/changes/20261012-1430-fix-redirect-bug/ → logos/changes/archive/20261012-1430-fix-redirect-bug/
```

## Archive structure

```
logos/changes/archive/
└── 20261012-1430-fix-redirect-bug/
    ├── proposal.md
    ├── tasks.md
    ├── SPEC_MERGED
    ├── VERIFY_PASS
    └── deltas/
        ├── prd/
        ├── api/
        ├── database/
        └── scenario/
```

Entries sort chronologically by their timestamp prefix. A CI pipeline can recognise an archive-only commit as lifecycle bookkeeping with [`openlogos impact`](/cli/impact).

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Missing change proposal name` | No slug provided | `openlogos archive fix-redirect-bug` |
| `Change proposal 'X' not found` | No directory at `logos/changes/<slug>/` | Check spelling — maybe already archived? |
| `[ARCHIVE_VERIFY_NOT_PASSED]` / `[ARCHIVE_DEPLOY_NOT_DONE]` / `[ARCHIVE_SMOKE_NOT_PASSED]` | The completion chain is not finished | Run the missing step (`openlogos verify`, deployment + `openlogos deploy-done`, `openlogos smoke`) first |
| `Archive 'X' already exists` | The timestamped target already exists in `logos/changes/archive/` | Wait a minute and retry, or check whether it was already archived |
| `logos/logos.config.json not found` | Not in project root | `cd` to project root |

On Windows, `archive` coordinates with a running `openlogos watch` before renaming the directory; if a legacy watcher still holds the directory, stop it and retry.

## Related commands

- [`verify`](/cli/verify) — Gate 3.6, required before archiving
- [`deploy-done`](/cli/deploy-done) / [`smoke`](/cli/smoke) — Gate 3.7 / 3.8, required when the proposal deploys
- [`change`](/cli/change) — Start the next proposal
- [`impact`](/cli/impact) — Classify archive commits in CI
