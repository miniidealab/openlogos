---
title: Codex Plugin
description: Native plugin specification for OpenLogos on OpenAI Codex CLI — SessionStart hook, phase context injection, and dual-mode architecture.
---

OpenLogos provides a native plugin for OpenAI Codex CLI, upgrading from the basic "AGENTS.md compatibility mode" to a "plugin-first + docs fallback" dual-track mechanism.

## Operating Modes

### Mode A: Compatibility Mode (always available)

- **Input**: `AGENTS.md` + `logos/skills/*/SKILL.md`
- **When**: Plugin not installed or plugin fails
- **Experience**: Zero extra installation, basic functionality

### Mode B: Native Plugin Mode (recommended)

- **Input**: Auto-generated `.codex-plugin/plugin.json`, `.codex-plugin/hooks/session-start.sh`, `.codex/config.toml`
- **When**: Full experience with SessionStart phase injection, auto-loaded Skills, unified workflow control
- **Experience**: Enhanced, easy to distribute and version

## Plugin Structure

After `openlogos init --ai-tool codex` or `openlogos init --ai-tool all`:

```
project-root/
├── .codex-plugin/
│   ├── plugin.json              # Plugin manifest
│   └── hooks/
│       └── session-start.sh     # SessionStart hook script
├── .codex/
│   └── config.toml              # Plugin and hook configuration
├── .agents/
│   └── skills/                  # Codex-native Skill files
│       ├── prd-writer/SKILL.md
│       ├── scenario-architect/SKILL.md
│       └── ...                  # 16 Skills total
└── AGENTS.md                    # Fallback instructions
```

## Plugin Manifest

`.codex-plugin/plugin.json`:

```json
{
  "name": "openlogos",
  "version": "0.10.3",
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
2. Review `.codex-plugin/hooks/session-start.sh`
3. Approve to enable OpenLogos phase context injection

## Configuration

`.codex/config.toml` is merged (not overwritten) during deployment:

```toml
[plugins]
openlogos = { path = ".codex-plugin" }

[hooks]
session-start = ".codex-plugin/hooks/session-start.sh"
```

## Comparison with Other Platforms

| Dimension | Claude Code | OpenCode | Codex |
|-----------|-------------|----------|-------|
| Plugin mechanism | `.claude/` native plugin | `.opencode/plugins/` JS | `.codex-plugin/` + hooks |
| SessionStart | settings.json hook | Plugin JS hook | shell hook script |
| Skill location | `logos/skills/` | `logos/skills/` | `.agents/skills/` |
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
