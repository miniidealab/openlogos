---
title: "Branch sync"
description: "How branch_sync selects the base and handles generated files."
---

OpenLogos resolves the base once for each invocation, using `--base`, `branch_sync.base_branch`, or the locally recorded default branch of `origin`. `branch status` is read-only; `branch sync` performs the local merge.

Generated-file handling takes the base version for eligible regenerated artifacts such as shared verification results. `branch_sync.replace_paths` can add eligible paths in `logos/resources/verify/`. Protected baseline runs, baseline ledgers and deployment reports retain their normal merge rules.

Files already occupied by untracked or ignored content can cause a pre-merge refusal. Remaining code/spec conflicts are reported for manual resolution. This command does not settle shared identifiers.
