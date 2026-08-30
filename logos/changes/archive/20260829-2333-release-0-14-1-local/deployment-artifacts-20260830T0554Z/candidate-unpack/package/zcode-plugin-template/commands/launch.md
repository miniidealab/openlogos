---
description: Transition the OpenLogos project from initial development to active lifecycle, enabling change management
---

Transition the project lifecycle from "initial" to "active":

1. Run `openlogos launch` in the project root directory.
2. If `openlogos` CLI is not found, perform the transition manually:
   - Read `logos/logos.config.json`
   - Change the `lifecycle` field from `"initial"` to `"active"`
   - Write the updated config back
   - Inform the user that change management is now active
3. Explain to the user what this means:
   - From now on, any modification to source code or methodology documents requires a change proposal first
   - Use `/openlogos:change <slug>` to create proposals before making changes
   - Exception: pure typo fixes and non-methodology files (README, .gitignore, etc.)
