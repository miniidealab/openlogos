---
title: OpenCode Plugin
description: Native plugin specification for the OpenCode platform — command bridging, hook injection, and dual-mode architecture.
---

The OpenCode plugin provides an enhanced integration experience on the OpenCode platform, upgrading from a basic "AGENTS.md compatibility mode" to a "plugin-first + document-fallback" dual-track architecture.

## Goals

1. Deliver an interaction experience close to the Claude Code plugin (command bridging + lifecycle context)
2. Maximize reuse of existing CLI (`openlogos *`) and Skills (`logos/skills/*`)
3. Preserve `AGENTS.md` as a fallback to ensure workflow continuity when the plugin is unavailable

## Operating Modes

### Mode A: Compatibility Mode

- **Input**: `AGENTS.md` + `logos/skills/*/SKILL.md`
- **When to use**: Plugin not installed, or plugin encounters an error
- **Characteristics**: Zero additional installation, more basic experience

### Mode B: Native Plugin Mode (Recommended)

- **Input**: Auto-generated `.opencode/plugins/openlogos.js` and `opencode.json`
- **When to use**: Default when the plugin is installed
- **Characteristics**: Enhanced experience with command entry, auto Phase injection, unified workflow control

## Build & Distribution

1. Plugin template ships with `@miniidealab/openlogos` (CLI single package), not published as a separate npm package
2. Plugin only handles "command routing + hook injection + result formatting" — no CLI business logic duplication
3. Plugin template version stays in sync with CLI version
4. `openlogos init --ai-tool opencode` and `openlogos sync` auto-deploy the plugin template to `.opencode/plugins/`

## Event Model

### session.created

Fires when a new session starts:

1. Check if the project is initialized (`logos/logos.config.json` exists)
2. Call `openlogos status` (prefer JSON output)
3. Build injection context: current Phase, next step suggestion, key blockers (missing documents)
4. On failure: degrade silently, never block the session

### tui.command.execute

Fires when a `/openlogos:*` command is entered:

1. Identify the `/openlogos:*` prefix command
2. Validate parameters
3. Call `cli-bridge` to execute the corresponding CLI command
4. Format output uniformly (success/failure)
5. Show hints for high-value actions (e.g., "change proposal created")

### Optional Enhancement Events

- `tool.execute.before` — Restrict high-risk calls (e.g., reading sensitive files)
- `tui.toast.show` — Key result notifications

## Command Mapping

| OpenCode Command | CLI Equivalent | Description |
|-----------------|---------------|-------------|
| `/openlogos:status` | `openlogos status` | Show phase status |
| `/openlogos:next` | `openlogos status` | Show next step suggestion |
| `/openlogos:init [name]` | `openlogos init [name]` | Initialize project |
| `/openlogos:sync` | `openlogos sync` | Sync instructions and Skills |
| `/openlogos:change <slug>` | `openlogos change <slug>` | Create change proposal |
| `/openlogos:merge <slug>` | `openlogos merge <slug>` | Generate merge instructions |
| `/openlogos:archive <slug>` | `openlogos archive <slug>` | Archive change |
| `/openlogos:verify` | `openlogos verify` | Run acceptance verification |
| `/openlogos:launch` | `openlogos launch` | Activate change management |

### Parameter Conventions

- No-arg commands: `status`, `next`, `sync`, `verify`, `launch`
- Optional-arg command: `init [name]`
- Required-arg commands: `change <slug>`, `merge <slug>`, `archive <slug>`

Parsing rules:

1. Unified prefix: `/openlogos:`
2. Arguments are space-delimited, no shell string concatenation
3. `slug` validation: `^[a-z0-9]+(-[a-z0-9]+)*$`
4. Missing required arguments return a user-readable error without triggering CLI

## Error Handling

### Error Code Conventions

| Code | Scenario | User Message |
|------|----------|--------------|
| `E_CLI_NOT_FOUND` | `openlogos` not in PATH | Please install or add `openlogos` to PATH |
| `E_PROJECT_NOT_INIT` | Missing `logos/logos.config.json` | Please run `openlogos init` in the project root |
| `E_ARG_INVALID` | Missing or invalid argument | Check command arguments (e.g., `slug`) and retry |
| `E_CMD_TIMEOUT` | CLI timed out | Retry later or run manually in terminal |
| `E_CMD_FAILED` | CLI non-zero exit | See error details and fix accordingly |
| `E_PERMISSION_DENIED` | OpenCode permission rejected | Allow the capability in `opencode.json` |

### Error Branches

The plugin must handle at minimum:

- CLI not found (`openlogos` not in PATH)
- Project not initialized (missing `logos/logos.config.json`)
- Incomplete command arguments (e.g., `change` without slug)
- Command timeout or non-zero exit
- Permission denied (OpenCode permission block)

## Security

### Recommended Permissions

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "bash": "ask",
    "edit": "ask",
    "read": "allow",
    "glob": "allow",
    "grep": "allow",
    "skill": "allow"
  }
}
```

### Internal Security Policies

1. Never execute arbitrary shell strings unrelated to OpenLogos
2. All CLI calls use argument arrays, no string concatenation
3. Only workspace-internal paths allowed as command context
4. Structured logging (command name, duration, exit code, error code) — no sensitive content logged

## Fallback Strategy

When the plugin is unavailable:

1. AI reads `AGENTS.md` at project root → understands methodology and rules
2. AI reads `logos/skills/*/SKILL.md` directly → can follow any Skill guidance
3. User runs `openlogos *` CLI commands in terminal manually

The plugin enhances the experience but is never a hard requirement. This dual-track design ensures OpenLogos works reliably regardless of plugin availability.

## Related Specifications

- [AGENTS.md Specification](/specs/agents-md) — The fallback instruction file format
- [Project Structure](/specs/project-structure) — Where plugin files are deployed
- [`openlogos init`](/cli/init) — Auto-deploys plugin template for OpenCode
- [`openlogos sync`](/cli/sync) — Re-deploys and updates plugin files
