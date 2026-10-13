---
title: ZCode Plugin
description: Native OpenLogos plugin for ZCode — deployment location, Skills/commands/agents, SessionStart and PreToolUse hooks, lifecycle support, and the root AGENTS.md.
---

OpenLogos ships a self-contained native plugin for ZCode. `openlogos init`, `adopt`, `sync`, and `launch` install it into the project, together with the OpenLogos managed block in the root `AGENTS.md`.

## What gets deployed

After `openlogos init --ai-tool zcode` (or `all`):

```
project-root/
├── .zcode/
│   └── plugins/
│       └── openlogos/
│           ├── .zcode-plugin/
│           │   └── plugin.json        # Manifest (name: openlogos, version = CLI version)
│           ├── skills/<name>/SKILL.md # OpenLogos methodology Skills
│           ├── commands/<name>.md     # OpenLogos commands (status, next, change, merge, verify, ...)
│           ├── agents/change-reviewer.md
│           ├── hooks/hooks.json       # SessionStart + PreToolUse
│           └── runtime/hook-runtime.js
└── AGENTS.md                          # OpenLogos managed block
```

- Everything comes from the npm package; nothing is downloaded at install time.
- Your project's `.zcode/config.json` is **never modified**, and OpenLogos does not register hooks there. Your user-level `~/.zcode/AGENTS.md` is never touched either.
- Files you add inside `.zcode/plugins/openlogos/` are kept across `sync`.
- If `.zcode/plugins/openlogos/` already contains a plugin with a different owner, or an incomplete directory, deployment stops instead of overwriting it.

## Hooks

`hooks/hooks.json` registers two hooks, both run by Node.js through `${ZCODE_PLUGIN_ROOT}/runtime/hook-runtime.js`:

| Hook | Matcher | What it does |
|------|---------|--------------|
| `SessionStart` | (all) | Injects the current lifecycle, active change, `proposal_step`, allowed scope, and next confirmation point |
| `PreToolUse` | `Edit\|Write\|MultiEdit\|NotebookEdit\|Bash` | Allows or denies the write. A deny exits with code 2 and gives a reason |

No post-execution check hook is registered on ZCode.

### Write guard behavior

The guard re-reads the project from disk on every call; `SessionStart` context is never treated as permission.

- **Initial lifecycle**: no hard gate.
- **Launched module, no active proposal**: file writes are denied. Run `openlogos change <slug>` first.
- **Launched module, active proposal**: writes follow the proposal step. While the proposal is being written, only `proposal.md` and `tasks.md` of that proposal are writable. While deltas are being written, only its `deltas/**` and `tasks.md` are writable. Once deltas are done and waiting for `openlogos merge`, nothing is writable. After merge, project files are writable, except other proposals' directories.
- **Shell commands** in a launched module: only a short list of read-only commands is allowed: `pwd`, `ls`, `cat`, `sed`, `rg`, `git status|log|diff|show|branch|rev-parse|ls-files`, and `openlogos status|next|flow`. Any other command is denied (fail-closed). Run commands such as `openlogos change`, `openlogos merge`, `openlogos verify`, tests, or builds yourself in a terminal.
- Invalid hook input, paths escaping the project root, symlink escapes, or runtime errors are denied.

## Lifecycle support

| Command | Plugin variant | Behavior |
|---------|----------------|----------|
| `init --ai-tool zcode` | initial | Pre-checks config, `AGENTS.md`, and the plugin target, then writes |
| `init --ai-tool zcode` (initialized project) | current lifecycle | Adds ZCode only; other hosts and your files are kept |
| `adopt --ai-tool zcode` | launched | Ready for `openlogos change` right away |
| `sync` | current lifecycle | Idempotent refresh; the sync stamp is written only after every host succeeds |
| `launch` | launched | The lifecycle is committed only after every host's assets succeed |

The plugin directory is replaced in one step. If the replacement fails, the previous directory is restored. If even that fails, the backup is kept and its location is reported so you can move it back.

**Start a new ZCode session** after `init`, `sync`, or `launch`. ZCode loads plugins and hooks as a snapshot when a session starts. An existing session still gets the latest guard decisions because they are read from disk.

## Relationship with AGENTS.md

ZCode reads the root `AGENTS.md`. OpenLogos maintains only its managed block (`<!-- OPENLOGOS:BEGIN -->` … `<!-- OPENLOGOS:END -->`), and keeps everything outside it. When ZCode is the only configured tool, the block lists the plugin's Skills and adds a ZCode section. That section tells the AI to read the root `AGENTS.md` and the plugin Skills directly, without relying on nested AGENTS files, include directives, or `CLAUDE.md`. Instruction text is guidance only; blocking comes from the `PreToolUse` hook. See [AGENTS.md](/specs/agents-md).

## Deployment

```bash
openlogos init --ai-tool zcode   # new project, or add ZCode to an existing one
openlogos sync                   # refresh after upgrading the CLI
```

Non-interactive `init` / `adopt` picks `zcode` automatically when `ZCODE_PLUGIN_ROOT` is set.

## Related

- [`openlogos init`](/cli/init) and [`openlogos sync`](/cli/sync)
- [Qoder Plugin](/specs/qoder-plugin) and [WorkBuddy Plugin](/specs/workbuddy-plugin): hosts with the same plugin model
- [PreToolUse Guard](/specs/pretooluse-guard)
- [AGENTS.md](/specs/agents-md)
