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
2. **Backfills `scenarios[].module` field** in `logos-project.yaml` — for any scenario entry missing a `module` field, infers the owning module from file system (looks for `<moduleId>-SXX-*.md` in the scenario-implementation directory), falls back to `core`. Idempotent: entries that already have a `module` field are left unchanged.
3. **Ensures `documents.changes`** section exists in `logos.config.json` (adds it if missing)
4. **Regenerates `AGENTS.md`** based on current locale, AI tool, and lifecycle
5. **Regenerates `CLAUDE.md`** based on current locale, AI tool, and lifecycle
6. **Re-deploys Skills** to every configured target directory
7. **Re-deploys specs** to `logos/spec/`
8. **Tool plugins**: re-deploys configured OpenCode, Codex, and Claude Code plugin assets

`aiTool` may be a single value, an array, or `all`. When it is an array or `all`, `sync` expands it and deploys every concrete tool target:

| Tool | Skills target | Extra assets |
|------|---------------|--------------|
| Claude Code | `logos/skills/` | `.claude/commands/openlogos/`, `.claude/agents/`, `.claude/openlogos/bin/`, `.claude/settings.json` |
| OpenCode | `logos/skills/` | `.opencode/plugins/openlogos.js`, `opencode.json`, `.opencode/commands/` |
| Codex | `.agents/skills/` | `.codex-plugin/`, `.codex/config.toml` |
| Cursor | `.cursor/rules/` | `.cursor/rules/openlogos-policy.mdc` |

`AGENTS.md` and `CLAUDE.md` are regenerated with multi-tool semantics when more than one tool is configured, so their Active Skills paths match the deployed targets.

For Codex projects, `sync` rewrites `.agents/skills/<name>/SKILL.md` using the native Codex Skill format, including the required YAML frontmatter (`name` and `description`). If an older OpenLogos version produced invalid Codex Skills without frontmatter, running `openlogos sync` after upgrading repairs those files.

Codex SessionStart hooks are also re-deployed idempotently. Codex may still require a one-time `/hooks` review before `.codex-plugin/hooks/session-start.sh` can run; that is expected Codex security behavior.

## Example output

```
Syncing project files...

  ✓ logos-project.yaml name synced to "my-project"
  ✓ 3 scenario(s) backfilled with module field in logos-project.yaml
  ✓ documents.changes added to logos.config.json
  ✓ AGENTS.md updated
  ✓ CLAUDE.md updated
  ✓ 16 skills synced to logos/skills/
  ✓ 16 skills synced to .agents/skills/
  ✓ 17 skills synced to .cursor/rules/
  ✓ 13 specs synced to logos/spec/

Sync complete.
```

The `scenarios backfilled` line only appears when there are scenario entries without a `module` field. On subsequent runs it is silent (idempotent).

## When to use

- After editing `logos/logos.config.json` (changing name, locale, or AI tool)
- After upgrading the `openlogos` CLI to a new version (to get updated Skill content)
- When switching AI tools mid-project (e.g., from Cursor to Claude Code)
- When `aiTool` is changed to an array or `all` and you need every tool target refreshed
- After running `openlogos launch` if you need to force-regenerate files

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `logos/logos.config.json not found` | Not in project root, or project not initialized | `cd` to project root, or run `openlogos init` first |

## Related commands

- [`init`](/cli/init) — First-time project setup (use `sync` for subsequent updates)
- [`launch`](/cli/launch) — Activate change management (also regenerates files internally)
