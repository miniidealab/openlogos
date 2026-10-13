---
title: WorkBuddy Plugin
description: Native OpenLogos plugin for WorkBuddy — deployment location, Skills/commands/agents, SessionStart and PreToolUse hooks, lifecycle support, AGENTS.md, and the native-memory boundary.
---

OpenLogos ships a self-contained native plugin for WorkBuddy (CodeBuddy plugin format). `openlogos init`, `adopt`, `sync`, and `launch` install it into the project and maintain the OpenLogos managed block in the root `AGENTS.md`. The adapter only maps WorkBuddy's protocol and file layout; the methodology state machine stays in the OpenLogos CLI.

WorkBuddy 5.3.5 or later is the validated host version.

## What gets deployed

After `openlogos init --ai-tool workbuddy` (or `all`):

```
project-root/
├── .workbuddy/
│   └── plugins/
│       └── openlogos/
│           ├── .workbuddy-plugin/
│           │   └── plugin.json        # Manifest (name: openlogos, version = CLI version)
│           ├── skills/<name>/SKILL.md # OpenLogos methodology Skills
│           ├── commands/<name>.md     # OpenLogos commands (status, next, change, merge, verify, ...)
│           ├── agents/change-reviewer.md
│           └── hooks/
│               ├── hooks.json         # SessionStart + PreToolUse
│               ├── runtime.mjs
│               └── runtime.cjs
└── AGENTS.md                          # OpenLogos managed block
```

- Everything comes from the npm package; nothing is downloaded at install time.
- WorkBuddy settings and permissions (`.workbuddy/settings.json`) and other plugins are **never modified**.
- Files you add inside `.workbuddy/plugins/openlogos/` are kept across `sync`.
- If the target directory belongs to a different owner or is incomplete, deployment stops instead of overwriting it.

## Native memory boundary

WorkBuddy's native memory belongs to you and the host. OpenLogos never reads, writes, clears, imports, exports, or migrates it, and never uses it to decide permissions. OpenLogos facts come only from the project on disk (guard, tasks, resource index).

## Hooks

Hooks are registered only in `hooks/hooks.json`, never in Skill, command, or agent frontmatter. Both run `node "${CODEBUDDY_PLUGIN_ROOT}/hooks/runtime.mjs"`:

| Hook | Matcher | What it does |
|------|---------|--------------|
| `SessionStart` | `startup\|resume\|clear\|compact\|new` | Injects module, lifecycle, active change, `proposal_step`, writable scope, and next confirmation point |
| `PreToolUse` | every tool (including `write_to_file`, `replace_in_file`, `execute_command`) | Allows or denies the call. A deny exits with code 2 and gives a reason |

No post-execution check hook is registered on WorkBuddy.

### Write guard behavior

The guard re-reads the project from disk on every call. Static instructions, `SessionStart` context, and native memory never grant permission.

- **Known read-only tools** (`Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Task`, `TodoRead`) are always allowed. **Unknown tools** that might write are denied (fail-closed).
- **Initial lifecycle**: no hard gate for write tools.
- **Launched module, no active proposal**: file writes are denied. Run `openlogos change <slug>` first.
- **Launched module, active proposal**: writes follow the proposal step. While the proposal is being written, only its `proposal.md` and `tasks.md` are writable. While deltas are being written, only its `deltas/**` and `tasks.md` are writable. While waiting for `openlogos merge`, nothing is writable. After merge, project files are writable, except other proposals' directories.
- **Shell commands** (`Bash` / `execute_command`) in a launched module: only a short list of single read-only commands is allowed: `pwd`, `ls`, `cat`, `sed`, `rg`, `git status|log|diff|show|branch|rev-parse|ls-files`, and `openlogos status|next|flow`. A command containing `;`, `&`, `|`, `>`, `<`, backticks, `$`, or parentheses is denied. Run other commands, such as `openlogos change`, `openlogos merge`, `openlogos verify`, tests, or builds, yourself in a terminal.
- Invalid input, path escapes, symlink escapes, and runtime errors are denied. Exit code 1 is never treated as a security block.

## Lifecycle support

| Command | Plugin variant | Behavior |
|---------|----------------|----------|
| `init --ai-tool workbuddy` | initial | Full pre-check, staging, and read-back before committing |
| `adopt --ai-tool workbuddy` | launched | Your existing assets are kept; ready for `openlogos change` right away |
| `sync` | current lifecycle | Idempotent refresh; the sync stamp is written only after every host succeeds |
| `launch` | launched | The lifecycle is committed only after every host's assets succeed |

If any step fails, the whole deployment is rolled back. No half-installed plugin, sync stamp, or lifecycle change is left behind. **Start a new WorkBuddy session** after `init`, `sync`, or `launch` to load the refreshed plugin.

## Relationship with AGENTS.md

OpenLogos maintains only its managed block in the root `AGENTS.md` (`<!-- OPENLOGOS:BEGIN -->` … `<!-- OPENLOGOS:END -->`) and keeps everything outside it. When WorkBuddy is the only configured tool, the block adds a WorkBuddy section. It says that methodology context comes from the plugin Skills/commands and `SessionStart`, that native memory is not authorization, and that write permission comes only from the `PreToolUse` hook. See [AGENTS.md](/specs/agents-md).

## Deployment

```bash
openlogos init --ai-tool workbuddy   # new project, or add WorkBuddy to an existing one
openlogos sync                       # refresh after upgrading the CLI
```

Non-interactive `init` / `adopt` picks `workbuddy` automatically when `CODEBUDDY_PLUGIN_ROOT` is set.

## Related

- [`openlogos init`](/cli/init) and [`openlogos sync`](/cli/sync)
- [ZCode Plugin](/specs/zcode-plugin) and [Qoder Plugin](/specs/qoder-plugin)
- [PreToolUse Guard](/specs/pretooluse-guard)
- [AGENTS.md](/specs/agents-md)
