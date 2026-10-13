---
title: Qoder Plugin
description: Native OpenLogos plugin for Qoder CLI — deployment location, Skills/commands/agents, SessionStart and PreToolUse hooks, lifecycle support, and AGENTS.md as static memory.
---

OpenLogos ships a self-contained native plugin for the Qoder CLI. `openlogos init`, `adopt`, `sync`, and `launch` install it into the project and maintain the OpenLogos managed block in the root `AGENTS.md`, which Qoder CLI reads as static memory.

Qoder CLI is the validated target. Qoder IDE hook behavior is not covered by this integration.

## What gets deployed

After `openlogos init --ai-tool qoder` (or `all`):

```
project-root/
├── .qoder/
│   └── plugins/
│       └── openlogos/
│           ├── .qoder-plugin/
│           │   └── plugin.json        # Manifest (name: openlogos, version = CLI version)
│           ├── skills/<name>/SKILL.md # OpenLogos methodology Skills
│           ├── commands/<name>.md     # OpenLogos commands (status, next, change, merge, verify, ...)
│           ├── agents/change-reviewer.md
│           └── hooks/
│               ├── hooks.json         # SessionStart + PreToolUse
│               ├── runtime.mjs
│               └── runtime.cjs
└── AGENTS.md                          # OpenLogos managed block (static memory)
```

- Everything comes from the npm package; nothing is downloaded at install time.
- Qoder settings (`.qoder/settings.json`), user-level `~/.qoder/AGENTS.md`, `AGENTS.local.md`, `.qoder/rules/**`, and other plugins are **never modified**.
- Files you add inside `.qoder/plugins/openlogos/` are kept across `sync`.
- If the target directory belongs to a different owner or is incomplete, deployment stops instead of overwriting it.

## Hooks

`hooks/hooks.json` registers two hooks. Both run `node "${QODER_PLUGIN_ROOT}/hooks/runtime.mjs"`, passed as a single argument, so paths with spaces still work:

| Hook | Matcher | What it does |
|------|---------|--------------|
| `SessionStart` | `startup\|resume\|clear\|compact\|new` | Injects the current lifecycle, active change, `proposal_step`, allowed scope, and next confirmation point |
| `PreToolUse` | every tool | Allows or denies the call. A deny exits with code 2 and gives a reason |

No post-execution check hook is registered on Qoder.

### Write guard behavior

The guard re-reads the project from disk on every call; `SessionStart` context and `AGENTS.md` are never treated as permission.

- **Known read-only tools** (`Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Task`, `TodoRead`) are always allowed. **Unknown tools** that might write are denied (fail-closed).
- **Initial lifecycle**: no hard gate for write tools.
- **Launched module, no active proposal**: file writes are denied. Run `openlogos change <slug>` first.
- **Launched module, active proposal**: writes follow the proposal step. While the proposal is being written, only its `proposal.md` and `tasks.md` are writable. While deltas are being written, only its `deltas/**` and `tasks.md` are writable. While waiting for `openlogos merge`, nothing is writable. After merge, project files are writable, except other proposals' directories.
- **Shell commands** in a launched module: only a short list of single read-only commands is allowed: `pwd`, `ls`, `cat`, `sed`, `rg`, `git status|log|diff|show|branch|rev-parse|ls-files`, and `openlogos status|next|flow`. A command containing `;`, `&`, `|`, `>`, `<`, backticks, `$`, or parentheses is denied. Run other commands, such as `openlogos change`, `openlogos merge`, `openlogos verify`, tests, or builds, yourself in a terminal.
- Invalid input, path escapes, symlink escapes, and runtime errors are converted into a deny with exit code 2. Qoder treats other non-zero exits as non-blocking, so OpenLogos never relies on them.

## Lifecycle support

| Command | Plugin variant | Behavior |
|---------|----------------|----------|
| `init --ai-tool qoder` / `all` | initial | Full pre-check, then write |
| `adopt --ai-tool qoder` / `all` | launched | Existing assets are kept; ready for `openlogos change` right away |
| `sync` | current lifecycle | Idempotent refresh; the sync stamp is written only after every host succeeds |
| `launch` | launched | The lifecycle is committed only after every host's assets succeed |

The plugin directory is replaced in one step and restored on failure. **Start a new Qoder CLI session** after `init`, `sync`, or `launch` to load the refreshed plugin snapshot. An existing session still gets the latest guard decisions because they are read from disk.

## Relationship with AGENTS.md

Qoder CLI loads the root `AGENTS.md` as static memory. OpenLogos maintains only its managed block (`<!-- OPENLOGOS:BEGIN -->` … `<!-- OPENLOGOS:END -->`), and keeps everything outside it. The block is self-contained: it carries the language policy, Why → What → How, the delta/guard rules, the reporter requirement, and the human confirmation points. It does not depend on nested memory or Qoder rules being loaded. When Qoder is the only configured tool, the block adds a Qoder section that points to the plugin Skills. Static memory is guidance only; blocking comes from the `PreToolUse` hook. See [AGENTS.md](/specs/agents-md).

## Deployment

```bash
openlogos init --ai-tool qoder   # new project, or add Qoder to an existing one
openlogos sync                   # refresh after upgrading the CLI
```

Non-interactive `init` / `adopt` picks `qoder` automatically when `QODER_PLUGIN_ROOT` is set.

## Related

- [`openlogos init`](/cli/init) and [`openlogos sync`](/cli/sync)
- [ZCode Plugin](/specs/zcode-plugin) and [WorkBuddy Plugin](/specs/workbuddy-plugin)
- [PreToolUse Guard](/specs/pretooluse-guard)
- [AGENTS.md](/specs/agents-md)
