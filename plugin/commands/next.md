---
description: Detect current OpenLogos phase and provide actionable next-step guidance with a ready-to-use prompt
---

Help the user determine their next step in the OpenLogos methodology:

1. Run `${CLAUDE_PLUGIN_ROOT}/bin/openlogos-phase --plain` to detect the current project phase.
2. Based on the detected phase and suggested skill, provide:
   - A clear explanation of what this phase involves
   - The specific skill that should be used (it will be auto-activated)
   - A ready-to-use prompt the user can say to start the work, for example:
     - Phase 1: "Help me write the product requirements document for this project"
     - Phase 2: "Help me create the product design based on the requirements"
     - Phase 3 Step 0: "Help me design the technical architecture"
     - Phase 3 Step 1: "Help me model the business scenarios as sequence diagrams"
     - etc.
3. If all phases are complete and lifecycle is "initial", suggest running `/openlogos:launch`.
4. If lifecycle is "active", remind the user about change management workflow.
