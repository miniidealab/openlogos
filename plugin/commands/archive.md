---
description: Archive a completed change proposal after implementation is done
---

Archive the completed change proposal: "$ARGUMENTS"

1. If `$ARGUMENTS` is empty, ask the user to provide the change slug (e.g., `/openlogos:archive my-change`).
2. Run `openlogos archive $ARGUMENTS` in the project root directory.
3. If the `openlogos` CLI is not found, tell the user to install it:
   ```
   npm install -g @miniidealab/openlogos
   ```
4. After archiving, inform the user that the change proposal has been moved to `logos/changes/archive/` and is now complete.
