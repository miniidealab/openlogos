---
title: "openlogos sync"
description: Refresh AI instruction files, Skills, host plugins, hooks, guard scripts, and specs to match the current CLI version and project configuration.
---

Bring every OpenLogos-managed file in the project up to date with the installed CLI and the current `logos/logos.config.json`. Run it after upgrading the CLI, after editing the config, or after changing the AI tool.

:::caution[After upgrading the CLI]
Run `openlogos sync` **in the root of each existing project** after installing a new CLI version. Until you do, that project keeps running the old guard scripts and hooks. See [Upgrading from 0.13.x](/getting-started/upgrade-from-0-13).
:::

## Synopsis

```bash
openlogos sync
```

No arguments or options. Must be run from the project root (where `logos/logos.config.json` exists).

## What it refreshes

| Area | What `sync` does |
|------|------------------|
| Guard scripts and post-check engine | Rewrites the managed guard assets from the bytes bundled with the CLI: `.claude/openlogos/bin/guard-check` and `guard-post-check.cjs` for Claude Code, `.cursor/hooks/openlogos-runtime.cjs` and `openlogos-guard-post.cjs` for Cursor, plus the hook runtimes inside the ZCode / Qoder / WorkBuddy plugins |
| Claude Code hooks | Merges `SessionStart`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, and `Stop` into `.claude/settings.json`; older OpenLogos hook entries are migrated in place, other hooks are untouched |
| Reply language | Sets the top-level `language` in `.claude/settings.json` from the project locale (`"english"` / `"chinese"`); a custom value you set is kept and reported |
| Skills | Re-deploys Skills to every configured host target (see table below) |
| Host plugins | Re-deploys OpenCode, Codex, Cursor, ZCode, Qoder, and WorkBuddy assets for every configured tool |
| `.gitignore` managed block | Re-renders the `# >>> openlogos managed >>>` block from `guard.unversioned` (always including `logos/.openlogos-runtime/`); content outside the block is untouched |
| `.gitattributes` managed block | Keeps line endings byte-stable for `logos/**` and managed hook files; files already converted to CRLF are restored from the git index and reported |
| Instruction files | Regenerates the OpenLogos managed block in `AGENTS.md` and `CLAUDE.md` for the current locale, tools, and lifecycle |
| Specs | Copies the bundled methodology specs to `logos/spec/` |
| Project data | Syncs the project name into `logos-project.yaml`, backfills missing `scenarios[].module` fields, adds missing `resource_index` entries, and backfills `documents.changes`, `sourceRoots`, and `verify.pre_run_command` in `logos.config.json` |

On success it writes `logos/.openlogos-sync.json`, recording which bundled asset manifest the project is synced to.

### Per-host targets

`aiTool` may be a single value, an array, or `all`. `sync` expands it and refreshes every concrete target:

| Tool | Skills target | Other assets |
|------|---------------|--------------|
| Claude Code | `logos/skills/` | `.claude/commands/openlogos/`, `.claude/agents/`, `.claude/openlogos/bin/`, `.claude/settings.json` |
| OpenCode | `logos/skills/` | `.opencode/plugins/openlogos.js`, `.opencode/commands/`, `opencode.json` |
| Codex | `.agents/plugins/openlogos/skills/` | `.agents/plugins/openlogos/`, `.agents/plugins/marketplace.json`, `.codex/config.toml` |
| Cursor | `.cursor/skills/` | `.cursor/agents/`, `.cursor/hooks.json` (managed entries only), `.cursor/hooks/` |
| ZCode | `.zcode/plugins/openlogos/skills/` | `.zcode/plugins/openlogos/` |
| Qoder | `.qoder/plugins/openlogos/skills/` | `.qoder/plugins/openlogos/` |
| WorkBuddy | `.workbuddy/plugins/openlogos/skills/` | `.workbuddy/plugins/openlogos/` |
| Other | `logos/skills/` | none |

When more than one tool is configured, `AGENTS.md` and `CLAUDE.md` are generated with multi-tool Skill paths so that their Active Skills section matches what was deployed.

Notes per host:

- **Codex**: Skills are rewritten with the YAML frontmatter Codex requires (`name`, `description`). Only the `openlogos` entry in `.agents/plugins/marketplace.json` is touched. Codex may still ask for a one-time `/hooks` review of `.agents/plugins/openlogos/hooks/session-start.sh`.
- **Cursor**: `sync` adds any missing managed hook entry (for example `afterShellExecution` on projects created before it existed). Running it again produces no diff.
- **ZCode / Qoder / WorkBuddy**: the plugin directory is replaced in one step and rolled back on failure. Files you added inside the plugin directory are kept. Start a new host session to load the refreshed plugin.

## Migrating from earlier versions

If the project was set up with an older OpenLogos version, `sync` also performs these one-time migrations. You do not need to run anything else.

- **Cursor rules → Skills**: OpenLogos-managed rule files under `.cursor/rules/` (one `<skill>.mdc` per OpenLogos Skill plus `openlogos-policy.mdc`) are migrated to `.cursor/skills/<name>/SKILL.md`. Only those exact file names are removed, and only after the new Skills and hook entries are written successfully. Your own files in `.cursor/rules/` are never touched. The CLI lists what was removed and what was kept.
- **Old guard → current guard**: guard scripts and hook registrations from the old guard are replaced, and the post-check hooks (`PostToolUse` / `PostToolUseFailure` / `Stop` for Claude Code, `afterShellExecution` for Cursor) are added.
- **Project lifecycle**: an old project-level `lifecycle: "active"` is migrated to a per-module `launched` lifecycle.

Run this after upgrading **in each existing project**. See [Upgrading from 0.13.x](/getting-started/upgrade-from-0-13) for the full upgrade steps.

## Example output

```
Syncing project files... (openlogos v0.16.0)

  ✓ logos-project.yaml resource_index is already up to date
  ✓ AGENTS.md updated
  ✓ CLAUDE.md updated
  ✓ <n> skills synced to logos/skills/
  ✓ Claude Code plugin synced: <n> commands, <n> agents → .claude/
  ✓ <n> specs synced to logos/spec/
  ✓ .gitignore OpenLogos managed block updated

Sync complete.
```

The exact lines depend on the configured tools and on what actually changed. Lines such as `scenario(s) backfilled with module field` appear only when there is something to backfill.

## When to use

- After upgrading the `openlogos` CLI, once in every existing project
- After editing `logos/logos.config.json` (name, locale, AI tool, `guard.unversioned`)
- When switching AI tools mid-project, or after changing `aiTool` to an array or `all`
- After running `openlogos launch` if you need to force-regenerate files

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `logos/logos.config.json not found` | Not in project root, or project not initialized | `cd` to the project root, or run `openlogos init` first |
| `未知的 AI Adapter id：<value>` | `aiTool` in the config contains an unsupported value | Fix `aiTool` to one of `claude-code`, `opencode`, `codex`, `cursor`, `zcode`, `qoder`, `workbuddy`, `other`, `all`; nothing was written |
| `baseline_commit_in_progress` | A `baseline-seed` commit is in progress for a module | Wait for it to finish and rerun `openlogos sync`; nothing was written |
| `Sync partially completed: .gitignore managed block was not updated.` (exit code 1) | The `.gitignore` managed block is corrupted, or `guard.unversioned` has an invalid entry | Fix the markers or the entry as the message says and rerun; everything else was synced |
| Bundled guard post-check engine missing | The installed package is incomplete | Reinstall `openlogos`, then rerun `openlogos sync` |

## Related commands

- [`init`](/cli/init): First-time project setup, or adding a target tool with `--ai-tool`
- [`launch`](/cli/launch): Activate change management (also regenerates files internally)
- [`ignore` / `exempt`](/cli/ignore-exempt): Change the entries rendered into the `.gitignore` managed block
