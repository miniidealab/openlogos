---
title: "openlogos knowledge"
description: "Record, query, and audit enterprise knowledge."
---

Use `openlogos knowledge apply <candidate-dir>` to validate and accept a batch without opening a proposal. Put the candidate outside the project root, with Markdown entries and optional source files under `sources/`. A failed validation leaves the batch unapplied. Use `--recover` if an interrupted transaction needs recovery.

Use `openlogos knowledge list --module core --format json` to filter entries, `knowledge show K01` to read one, and `knowledge refs K01-R1` to find scenarios using a rule. `knowledge index` rebuilds the index; `knowledge check` reports validation issues without changing entries.

The first intake can initialize `TAGS.md`; `knowledge apply --init-tags` can initialize it explicitly. Use [Enterprise knowledge](/concepts/enterprise-knowledge/) to choose between standalone intake and a proposal delta.
