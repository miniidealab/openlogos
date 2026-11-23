---
title: "openlogos branch"
description: "Inspect and merge a base branch with generated-file handling."
---

Run `openlogos branch status --format json` to inspect the current branch, resolved base, merge base and ahead/behind counts. Run `openlogos branch sync --base <ref> --format json` to merge that local ref and handle eligible generated files. Both commands accept `--base`.

The base is resolved from `--base`, `branch_sync.base_branch`, or the local reference to the remote default branch. Update your references before syncing if needed. The command neither fetches nor pushes and does not create branches.

Conflicts in code or specifications are left for manual resolution. Check the status and any remaining conflicts before continuing. See [Branch sync rules](/specs/branch-sync/).
