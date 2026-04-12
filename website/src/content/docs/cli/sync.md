---
title: "openlogos sync"
description: Regenerate AI instruction files, Skills, and specs to reflect current project configuration.
---

Synchronize all generated files (`AGENTS.md`, `CLAUDE.md`, Skills, specs) with the current `logos.config.json` settings. Run this after manually editing the config or changing the AI tool.

## Synopsis

```bash
openlogos sync
```

No arguments or options. Must be run from the project root (where `logos/logos.config.json` exists).

## What it does

1. **Syncs project name** in `logos-project.yaml` to match `logos.config.json`
2. **Ensures `documents.changes`** section exists in `logos.config.json` (adds it if missing)
3. **Regenerates `AGENTS.md`** based on current locale, AI tool, and lifecycle
4. **Regenerates `CLAUDE.md`** based on current locale, AI tool, and lifecycle
5. **Re-deploys Skills** to the appropriate target directory
6. **Re-deploys specs** to `logos/spec/`
7. **OpenCode only**: Re-deploys plugin, syncs `opencode.json` permissions, re-deploys slash commands

## Example output

```
Syncing project files...

  ✓ logos-project.yaml name synced to "my-project"
  ✓ documents.changes added to logos.config.json
  ✓ AGENTS.md updated
  ✓ CLAUDE.md updated
  ✓ 13 skills synced to logos/skills/
  ✓ 8 specs synced to logos/spec/

Sync complete.
```

## When to use

- After editing `logos/logos.config.json` (changing name, locale, or AI tool)
- After upgrading the `openlogos` CLI to a new version (to get updated Skill content)
- When switching AI tools mid-project (e.g., from Cursor to Claude Code)
- After running `openlogos launch` if you need to force-regenerate files

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `logos/logos.config.json not found` | Not in project root, or project not initialized | `cd` to project root, or run `openlogos init` first |

## Related commands

- [`init`](/cli/init) — First-time project setup (use `sync` for subsequent updates)
- [`launch`](/cli/launch) — Activate change management (also regenerates files internally)
