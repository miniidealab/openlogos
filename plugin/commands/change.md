---
description: Create an OpenLogos change proposal for tracking modifications to the project
---

Create a new OpenLogos change proposal with the slug provided as argument: "$ARGUMENTS"

1. If `$ARGUMENTS` is empty, ask the user to provide a slug (short kebab-case name describing the change).
2. Run `openlogos change $ARGUMENTS` in the project root directory.
3. If `openlogos` CLI is not found, create the change proposal manually:
   - Create directory `logos/changes/$ARGUMENTS/`
   - Create `logos/changes/$ARGUMENTS/proposal.md` with the standard template
   - Create `logos/changes/$ARGUMENTS/tasks.md` with the standard template
   - Create `logos/changes/$ARGUMENTS/deltas/` directory
4. Tell the user the proposal was created and suggest next steps:
   - Fill in `proposal.md` with the change reason, scope, and summary
   - Fill in `tasks.md` with the implementation tasks
   - After approval, implement the changes
   - Run `openlogos merge $ARGUMENTS` and `openlogos archive $ARGUMENTS` when done
