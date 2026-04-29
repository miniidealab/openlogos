---
description: Archive a completed change proposal after implementation is done
---

This slash command is treated as explicit human authorization to run `openlogos archive $ARGUMENTS`.

Archive the completed change proposal: "$ARGUMENTS"

1. If `$ARGUMENTS` is empty, ask the user to provide the change slug (e.g., `/openlogos:archive my-change`).
2. Before running, inform the user:
   - **Prerequisite**: `openlogos verify` must have passed (PASS) before archiving
   - Archiving will move `logos/changes/$ARGUMENTS/` to `logos/changes/archive/`
   - If the active guard points to this proposal, it will be removed
   - This action is irreversible
3. Run `openlogos archive $ARGUMENTS` in the project root directory.
4. If the `openlogos` CLI is not found, tell the user to install it:
   ```
   npm install -g @miniidealab/openlogos
   ```
5. After archiving, inform the user that the change proposal has been moved to `logos/changes/archive/` and is now complete.

Note: `openlogos archive` is a human confirmation point. AI must not execute it without explicit user authorization. This slash command itself constitutes that authorization.
