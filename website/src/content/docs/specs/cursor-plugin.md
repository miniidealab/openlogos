---
title: Cursor Plugin
description: How OpenLogos integrates with Cursor (IDE and cursor-agent CLI) — native Skills in .cursor/skills/, managed hooks.json entries, and a partial-strength guard with an afterShellExecution post-check.
---

OpenLogos integrates with Cursor through three kinds of project-level assets: native Agent Skills, a change-reviewer subagent, and managed entries in `.cursor/hooks.json`. The Cursor IDE and the `cursor-agent` CLI share the same project configuration, so one deployment covers both. Cursor has no marketplace-style plugin package, so everything is written directly into the project.

## What gets deployed

After `openlogos init --ai-tool cursor` (or `all`):

```
project-root/
├── .cursor/
│   ├── skills/
│   │   ├── prd-writer/SKILL.md           # OpenLogos methodology Skills
│   │   ├── change-writer/SKILL.md
│   │   ├── ...
│   │   ├── openlogos-next/SKILL.md       # Command Skills (disable-model-invocation: true)
│   │   └── openlogos-merge/SKILL.md
│   ├── agents/
│   │   └── change-reviewer.md            # Subagent
│   ├── hooks.json                        # OpenLogos managed entries merged in
│   └── hooks/
│       ├── openlogos-runtime.cjs         # Hook runtime
│       └── openlogos-guard-post.cjs      # Post-execution check engine
└── AGENTS.md                             # Instructions (OpenLogos managed block)
```

| Asset | Location | Notes |
|-------|----------|-------|
| Methodology Skills | `.cursor/skills/<name>/SKILL.md` | Frontmatter `name` matches the directory, `description` is non-empty; content follows the project locale |
| Command Skills | `.cursor/skills/openlogos-<command>/SKILL.md` | `disable-model-invocation: true`; trigger explicitly with `/openlogos-next`, `/openlogos-status`, `/openlogos-change`, `/openlogos-merge`, `/openlogos-verify`, `/openlogos-archive`, and so on |
| Subagent | `.cursor/agents/change-reviewer.md` | Reviews change proposals |
| Hooks | `.cursor/hooks.json` | Four managed entries, see below |
| Runtime and engine | `.cursor/hooks/` | The post-check engine is a byte-identical copy of the one Claude Code uses; `sync` refreshes it if it is missing or has drifted |

Multi-file Skill assets (such as the `ui-ux-pro-max` scripts) stay under `logos/skills/`.

**Ownership**: each OpenLogos Skill directory carries a `.openlogos-managed` marker. Your own directories under `.cursor/skills/` are never touched. If a directory with an OpenLogos Skill name already exists and is not managed by OpenLogos, deployment stops before writing anything.

## Hooks

`.cursor/hooks.json` is a shared file, so OpenLogos never replaces it wholesale. It only adds or updates its own entries, identified by the `openlogos-runtime.cjs` command. Your entries and unknown fields stay byte-identical, and a file that cannot be parsed stops the deployment with zero writes.

| Event | Managed command | Purpose |
|-------|-----------------|---------|
| `sessionStart` | `node .cursor/hooks/openlogos-runtime.cjs session` | Injects module, active change, `proposal_step`, writable scope, next confirmation point, and pending reports |
| `beforeShellExecution` | `node .cursor/hooks/openlogos-runtime.cjs shell` | Light pre-check of shell commands; snapshots protected content before the command runs |
| `afterShellExecution` | `node .cursor/hooks/openlogos-runtime.cjs shell-after` | Post-execution check: compares protected content before and after the command |
| `afterFileEdit` | `node .cursor/hooks/openlogos-runtime.cjs edit` | Reports out-of-scope file edits after the fact |

Projects created before `afterShellExecution` existed get it added by a single `openlogos sync`; running `sync` again produces no diff.

## Guard strength on Cursor

Guard on Cursor is **partial strength**, and OpenLogos says so in `AGENTS.md` and in CLI output:

- **Shell commands**: `beforeShellExecution` gives a light pre-check. Writes to targets it can determine as protected are denied. `afterShellExecution` then checks what actually changed. When it finds protected changes made without a proposal, it reports them and states that the command has already run and the changes were not blocked, so you can review and roll back or open a proposal first. Changes that cannot be reported immediately are delivered at the next `beforeShellExecution` or `sessionStart`.
- **File edits**: reported after the fact via `afterFileEdit`; they are never blocked beforehand.
- **No `preToolUse`**: OpenLogos does not wire Cursor's `preToolUse`. Cursor is not equivalent to Claude Code's hard pre-write block.

What is protected is the same as on Claude Code: in a launched module without an active proposal, version-controlled code and specs are protected, while ignored dependencies, build output, logs, and caches are not. See [PreToolUse Guard](/specs/pretooluse-guard).

**Protection-scope commands**: `openlogos exempt add|remove` and `openlogos ignore add|remove` return `permission: "ask"` in `beforeShellExecution`, so Cursor asks you to approve that single call. Compound forms are denied. See [`openlogos ignore` / `openlogos exempt`](/cli/ignore-exempt).

The `sessionStart` context is informational. It never grants write permission.

## Lifecycle support

| Command | Skills / subagent | hooks.json | Migration of older OpenLogos rule files |
|---------|-------------------|------------|-----------------------------------------|
| `init` | Deploy | Merge | Clean up if present |
| `adopt` | Deploy (conflict pre-check) | Merge | Clean up if present |
| `sync` | Idempotent refresh | Idempotent merge | Clean up |
| `launch` | Refresh with launched content | Idempotent merge | Clean up if not yet migrated |

If any step fails, the Skills directories are rolled back, `hooks.json` is restored, and older rule files are kept. No half-deployed state is left behind. Older OpenLogos versions used a different location for Cursor rules; how that is migrated is described in [`sync`: Migrating from earlier versions](/cli/sync#migrating-from-earlier-versions).

## Relationship with AGENTS.md

Cursor reads the root `AGENTS.md` natively. When Cursor is the only configured tool, the OpenLogos managed block lists Skills under `.cursor/skills/` and includes a fixed guard-strength line describing the partial-strength guard above. Content outside the managed block is never changed. See [AGENTS.md](/specs/agents-md).

## Deployment

```bash
# Add Cursor to a new or existing project
openlogos init --ai-tool cursor

# Refresh after upgrading the CLI
openlogos sync
```

Your global Cursor configuration (`~/.cursor/**`) is never read or modified.

## Related

- [`openlogos init`](/cli/init): Deploys the Cursor assets
- [`openlogos sync`](/cli/sync): Refreshes them and migrates older layouts
- [PreToolUse Guard](/specs/pretooluse-guard): What guard protects and how post-execution checks work
- [AGENTS.md](/specs/agents-md): Managed instruction block
