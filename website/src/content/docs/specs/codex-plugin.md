---
title: Codex Plugin
description: Native plugin specification for OpenLogos on OpenAI Codex CLI — SessionStart hook, phase context injection, and dual-mode architecture.
---

OpenLogos provides a native plugin for OpenAI Codex CLI, upgrading from the basic "AGENTS.md compatibility mode" to a "plugin-first + docs fallback" dual-track mechanism.

## Operating Modes

### Mode A: Compatibility Mode (always available)

- **Input**: `AGENTS.md` plus legacy `logos/skills/*/SKILL.md`, `.codex-plugin/`, or `.agents/skills/*`
- **When**: Plugin not installed, plugin fails, or an older project has not migrated to the repo marketplace yet
- **Experience**: Zero extra installation, basic functionality

### Mode B: Native Plugin Mode (recommended)

- **Input**: Auto-generated `.agents/plugins/marketplace.json`, `.agents/plugins/openlogos/`, and `.codex/config.toml`
- **When**: Full experience with SessionStart phase injection, auto-loaded Skills, unified workflow control
- **Experience**: Enhanced, easy to distribute and version

## Plugin Structure

After `openlogos init --ai-tool codex` or `openlogos init --ai-tool all`:

```
project-root/
├── .agents/
│   ├── plugins/
│   │   ├── marketplace.json     # Repo marketplace with the openlogos entry
│   │   ├── openlogos/
│   │   │   ├── .codex-plugin/
│   │   │   │   └── plugin.json
│   │   │   ├── hooks/
│   │   │   │   └── session-start.sh
│   │   │   └── skills/
│   │   │       ├── prd-writer/SKILL.md
│   │   │       ├── scenario-architect/SKILL.md
│   │   │       └── ...          # OpenLogos methodology Skills
│   │   └── <project-plugin>/
│   │       └── skills/<project-skill>/SKILL.md
│   └── skills/                  # Legacy or repo-scoped project Skills
├── .codex/
│   └── config.toml              # Plugin and hook configuration
└── AGENTS.md                    # Fallback instructions
```

## Plugin Manifest

`.agents/plugins/openlogos/.codex-plugin/plugin.json`:

```json
{
  "name": "openlogos",
  "version": "0.12.9",
  "description": "OpenLogos methodology plugin for Codex CLI",
  "hooks": {
    "session-start": "./hooks/session-start.sh"
  }
}
```

## SessionStart Hook

The hook script (`session-start.sh`) runs at the beginning of each Codex session and injects:

1. Current project phase (detected via `openlogos detect`)
2. Active change proposal status
3. Suggested next step
4. Language policy reminder

This gives Codex the same phase-aware context that Claude Code gets via its native plugin system.

## Skill Namespace Boundary

Codex OpenLogos methodology Skills use the `openlogos` namespace, for example `$openlogos:prd-writer`, `$openlogos:scenario-architect`, and `$openlogos:change-writer`. These Skills live under `.agents/plugins/openlogos/skills/`.

Project-specific Skills must remain outside the OpenLogos namespace. Project plugins use their own namespace, such as `$adcn:release-guard` from `.agents/plugins/adcn/skills/`. Legacy or repo-scoped local Skills can stay under `.agents/skills/`, and `AGENTS.md` groups them as project-specific Skills instead of official OpenLogos capabilities.

`openlogos init` and `openlogos sync` update or insert only the `openlogos` entry in `.agents/plugins/marketplace.json`; existing project plugin entries are preserved in place. Historical `.codex-plugin/` directories are left intact for compatibility, while new OpenLogos assets are written under `.agents/plugins/openlogos/`.

## Skill Format for Codex

Codex requires YAML frontmatter in Skill files. OpenLogos automatically converts each Skill during deployment:

```markdown
---
name: prd-writer
description: "Write scenario-driven requirements with GIVEN/WHEN/THEN acceptance criteria"
---
# Skill: PRD Writer
...
```

Without this frontmatter, Codex shows `missing YAML frontmatter` warnings and skips the Skill.

## Hook Security Review

Codex may show `hook needs review before it can run` on first launch after plugin deployment. This is Codex's standard hook security review:

1. Open `/hooks` in Codex
2. Review `.agents/plugins/openlogos/hooks/session-start.sh`
3. Approve to enable OpenLogos phase context injection

## Configuration

`.codex/config.toml` is merged (not overwritten) during deployment:

```toml
[plugins]
openlogos = { path = ".agents/plugins/openlogos" }

[hooks]
session-start = ".agents/plugins/openlogos/hooks/session-start.sh"
```

## Comparison with Other Platforms

| Dimension | Claude Code | OpenCode | Codex |
|-----------|-------------|----------|-------|
| Plugin mechanism | `.claude/` native plugin | `.opencode/plugins/` JS | repo marketplace + `.agents/plugins/openlogos/` |
| SessionStart | settings.json hook | Plugin JS hook | shell hook script |
| Skill location | `logos/skills/` plus `.claude/skills/` project Skills | `logos/skills/` | `.agents/plugins/openlogos/skills/` for `$openlogos:<skill>`; project Skills stay in project namespaces |
| Slash commands | `.claude/commands/` | `.opencode/commands/` | N/A (AGENTS.md) |
| Fallback | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` |

## Deployment

```bash
# Deploy Codex plugin for an existing project
openlogos init --ai-tool codex

# Deploy all tool targets
openlogos init --ai-tool all

# Refresh after updates
openlogos sync
```

## Related

- [OpenCode Plugin](/specs/opencode-plugin) — OpenCode integration specification
- [AGENTS.md](/specs/agents-md) — Universal AI instruction file (fallback for all tools)
- [Project Structure](/specs/project-structure) — Standard directory layout
