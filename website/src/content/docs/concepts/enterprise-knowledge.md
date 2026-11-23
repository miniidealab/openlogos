---
title: "Enterprise knowledge"
description: "Connect business rules and evidence to scenarios."
---

Use `logos/resources/knowledge/` for versioned entries. An entry’s `KXX` ID identifies the topic; `KXX-Rn` identifies a rule. Include applicability, tags, status, and the source reference. Store source materials in `logos/resources/reference/knowledge/` after reviewing what will be shared with repository users.

Link requirements and scenarios to entry or rule IDs in their applicable business constraints. A proposal can add or update entries in `deltas/knowledge/`; use [knowledge apply](/cli/knowledge/) if the batch only records material. List and show can include proposal changes in the effective view.

Retire published entries by marking them deprecated; keep their IDs stable. Use the tag table and reverse references to find impacted scenarios before changing a rule.
