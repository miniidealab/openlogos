---
title: "openlogos index"
description: Generate an AI-ready prompt for rebuilding logos-project.yaml resource_index.
---

Generate `logos/index-prompt.md`, a prompt that asks an AI assistant to rebuild or improve `logos-project.yaml`'s `resource_index` based on actual file contents.

## Synopsis

```bash
openlogos index
```

Must be run from the project root.

## What it does

1. Reads `logos/logos.config.json`
2. Scans configured document directories, excluding `changes`
3. Scans root `spec/` and `skills/*/SKILL.md`
4. Reads the first 80 lines of each candidate file
5. Writes `logos/index-prompt.md`

The command does not directly edit `logos-project.yaml`. It prepares a reviewable AI prompt so the assistant can update descriptions with file-content context.

## Example output

```
Scanning project files for index generation...

  Found 35 files to index.
  ✓ Generated: logos/index-prompt.md

Next step:
  Tell your AI assistant: "Read logos/index-prompt.md and execute the instructions"
```

## Related commands

- [`sync`](/cli/sync) — Automatically backfill missing resource index entries
- [`status`](/cli/status) — View project state
