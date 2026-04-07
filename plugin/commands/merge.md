---
description: Generate MERGE_PROMPT.md for an approved change proposal to guide AI-assisted delta merging
---

Generate the merge prompt for a change proposal: "$ARGUMENTS"

1. If `$ARGUMENTS` is empty, ask the user to provide the change slug (e.g., `/openlogos:merge my-change`).
2. Run `openlogos merge $ARGUMENTS` in the project root directory.
3. If the `openlogos` CLI is not found, tell the user to install it:
   ```
   npm install -g @miniidealab/openlogos
   ```
4. After the merge prompt is generated, inform the user:
   - A `MERGE_PROMPT.md` file has been created in `logos/changes/$ARGUMENTS/`
   - They should read and follow the merge prompt to apply the delta changes
   - After merging, run `/openlogos:archive $ARGUMENTS` to archive the completed proposal
