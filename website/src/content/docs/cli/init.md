---
title: "openlogos init"
description: Initialize a new OpenLogos project with directory structure, configuration, AI Skills, host plugins, and spec files.
---

Create the standard OpenLogos project structure in the current directory. This is the first command you run when starting a new project.

## Synopsis

```bash
openlogos init [name] [--locale <en|zh>] [--ai-tool <claude-code|opencode|codex|cursor|zcode|qoder|workbuddy|other|all>]
```

For a project that is already initialized, passing `--ai-tool` explicitly switches `init` into "add target tool" mode:

```bash
openlogos init --ai-tool codex
```

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `name` | Project name | Auto-detected from `package.json`, `Cargo.toml`, `pyproject.toml`, or directory name |

## Options

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `--locale` | `en`, `zh` | Interactive prompt | Set the document language (skips prompt) |
| `--ai-tool` | `claude-code`, `opencode`, `codex`, `cursor`, `zcode`, `qoder`, `workbuddy`, `other`, `all` | Interactive prompt | Set the AI coding tool for a new project, or add a target tool to an initialized project |
| `--aitool` | Same as `--ai-tool` | Same as `--ai-tool` | Alias for `--ai-tool` |

`all` expands to every concrete host (Claude Code, OpenCode, Codex, Cursor, ZCode, Qoder, WorkBuddy) and excludes `other`. An unknown value exits with `unsupported AI tool` and lists the supported values.

## Interactive mode

When run in a TTY (terminal), `init` asks for the language, then the AI tool. The tool menu follows the language you picked:

```
Choose language / 选择语言:
  1. English (default)
  2. 中文

Your choice [1/2] (default: 1): 1

Choose AI coding tool / 选择 AI 编码工具:
  1. Claude Code (default)
  2. OpenCode
  3. Codex
  4. Cursor
  5. Other
  6. All (deploy for all tools)

  7. ZCode
  8. Qoder
  9. WorkBuddy

Your choice [1/2/3/4/5/6] (default: 1):
```

Entering `7`, `8`, or `9` selects ZCode, Qoder, or WorkBuddy, even though the prompt line only shows `1`–`6`.

If the project has a `package.json`, `pyproject.toml` / `requirements.txt` / `setup.py`, or `Cargo.toml`, `init` then suggests ignore entries for that stack. See [Suggested ignore entries](#suggested-ignore-entries) below.

## Non-interactive mode (CI)

In non-TTY environments (CI pipelines, scripts), `--locale` is **required**:

```bash
openlogos init my-project --locale en --ai-tool claude-code
```

If `--locale` is omitted in non-TTY mode, the command exits with an error. If `--ai-tool` is omitted, the host is detected from the environment:

- `CODEBUDDY_PLUGIN_ROOT` is set → `workbuddy`
- `QODER_PLUGIN_ROOT` is set → `qoder`
- `ZCODE_PLUGIN_ROOT` is set → `zcode`
- `CLAUDE_PLUGIN_ROOT` or `CLAUDE_CODE` is set → `claude-code`
- Otherwise → `claude-code` (default)

## Adding AI tool targets to an initialized project

If `logos/logos.config.json` already exists, `openlogos init` still refuses to rebuild the project. With an explicit `--ai-tool`, it performs an incremental update instead:

```bash
# A project initialized for Cursor can add Codex support
openlogos init --ai-tool codex

# Add every built-in deployment target
openlogos init --ai-tool all
```

In this mode `init`:

- Merges the requested tool into `aiTool` in `logos/logos.config.json`
- Regenerates the OpenLogos managed block in `AGENTS.md` and `CLAUDE.md` based on the current tool set and lifecycle
- Deploys the Skills, plugin, hooks, and commands the target tool needs
- Syncs methodology specs into `logos/spec/`
- Leaves `logos/resources/`, `logos/logos-project.yaml`, and existing project documents untouched

Running it repeatedly is idempotent. For example, running `openlogos init --ai-tool codex` twice keeps a single `codex` entry in `aiTool` and does not register the Codex SessionStart hook twice.

## What it creates

### Directories

```
logos/resources/prd/1-product-requirements/
logos/resources/prd/2-product-design/1-feature-specs/
logos/resources/prd/2-product-design/2-page-design/
logos/resources/prd/3-technical-plan/1-architecture/
logos/resources/prd/3-technical-plan/2-scenario-implementation/
logos/resources/prd/3-technical-plan/3-deployment/
logos/resources/api/
logos/resources/database/
logos/resources/test/
logos/resources/test/smoke/
logos/resources/scenario/
logos/resources/implementation/
logos/resources/verify/
logos/resources/reference/   (requirement/, todolist/, code/, image/, temp/, note/)
logos/changes/
logos/changes/archive/
```

Each directory contains a `.gitkeep` file so empty directories are tracked by Git.

### Configuration files

| File | Description |
|------|-------------|
| `logos/logos.config.json` | Project name, locale, `aiTool`, document paths, `sourceRoots`, verify/smoke settings; `guard.unversioned` when you accept the suggested ignore entries |
| `logos/logos-project.yaml` | AI-readable project resource index |
| `.gitignore` | OpenLogos managed block (always contains `logos/.openlogos-runtime/`); content outside the block is kept byte for byte |
| `.gitattributes` | OpenLogos managed block that keeps `logos/**` and managed hook/runtime files byte-stable across checkouts |

### AI instruction files

| File | Description |
|------|-------------|
| `AGENTS.md` | Universal AI instruction file (read by Cursor, OpenCode, Codex, ZCode, Qoder, and other tools) |
| `CLAUDE.md` | Claude Code-specific instruction file |

OpenLogos writes only inside the `<!-- OPENLOGOS:BEGIN -->` / `<!-- OPENLOGOS:END -->` managed block. If either file already exists with your own content, that content is preserved. See [AGENTS.md](/specs/agents-md).

### Skills deployment

Where Skills land depends on the AI tool:

| AI Tool | Skills target | Other managed assets |
|---------|---------------|----------------------|
| Claude Code | `logos/skills/<name>/SKILL.md` | `.claude/commands/openlogos/`, `.claude/agents/change-reviewer.md`, `.claude/openlogos/bin/`, `.claude/settings.json` |
| OpenCode | `logos/skills/<name>/SKILL.md` | `.opencode/plugins/openlogos.js`, `.opencode/commands/`, `opencode.json` |
| Codex | `.agents/plugins/openlogos/skills/<name>/SKILL.md` | `.agents/plugins/openlogos/`, `.agents/plugins/marketplace.json`, `.codex/config.toml` |
| Cursor | `.cursor/skills/<name>/SKILL.md` | `.cursor/agents/change-reviewer.md`, `.cursor/hooks.json`, `.cursor/hooks/` |
| ZCode | `.zcode/plugins/openlogos/skills/` | the whole `.zcode/plugins/openlogos/` plugin |
| Qoder | `.qoder/plugins/openlogos/skills/` | the whole `.qoder/plugins/openlogos/` plugin |
| WorkBuddy | `.workbuddy/plugins/openlogos/skills/` | the whole `.workbuddy/plugins/openlogos/` plugin |
| Other | `logos/skills/<name>/SKILL.md` | none |

Multi-file Skill assets (such as the `ui-ux-pro-max` scripts and data) are always placed under `logos/skills/`, whatever the host.

When `--ai-tool all` is selected, OpenLogos deploys every concrete target listed above except Other. `AGENTS.md` and `CLAUDE.md` are generated with multi-tool Skill paths.

### Spec files

The methodology specifications bundled with the CLI are copied to `logos/spec/`, including `test-results.md` (JSONL format for test results) and `sql-comment-convention.md` (SQL comment conventions).

### Tool-specific extras

**Claude Code**: when `--ai-tool` is `claude-code` or `all`:

- `.claude/commands/openlogos/`: slash commands (status, next, change, merge, archive, verify, sync, launch, init, index)
- `.claude/agents/change-reviewer.md`: change proposal reviewer sub-agent
- `.claude/openlogos/bin/`: `openlogos-phase` (SessionStart), `guard-check` (PreToolUse write guard), and `guard-post-check.cjs` (post-execution check engine)
- `.claude/settings.json`: hooks are merged in (never overwritten):
  - `SessionStart`: phase context
  - `PreToolUse`: write guard for `Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell`
  - `PostToolUse`, `PostToolUseFailure`, and `Stop`: post-execution check. After a shell command runs, it compares protected content and reports any change made without a proposal, with recovery commands
- `.claude/settings.json` also gets a top-level `language` that follows the project locale (`"english"` for `en`, `"chinese"` for `zh`). This keeps the reply language from drifting after long sessions are compacted. A custom value you set yourself is kept, and the CLI prints a notice. A `settings.json` whose top level is not a JSON object is left untouched.

Commands and agents are skipped if `.claude/commands/openlogos/` already has files, so your customizations survive. Guard scripts, hook registration, and `language` are always refreshed.

**OpenCode**:

- `.opencode/plugins/openlogos.js`: OpenCode plugin
- `.opencode/commands/`: `openlogos-*` slash command files
- `opencode.json`: permission defaults merged in (`bash: "ask"`, `edit: "ask"`, `read` / `glob` / `grep` / `skill: "allow"`); existing keys are kept

**Codex**: when `--ai-tool` is `codex` or `all`:

- `.agents/plugins/openlogos/`: plugin manifest (`.codex-plugin/plugin.json`), `hooks/session-start.sh`, and Skills
- `.agents/plugins/marketplace.json`: repo marketplace; only the `openlogos` entry is added or updated
- `.codex/config.toml`: plugin and hook configuration, merged without removing existing settings
- The plugin is also synced to your personal Codex marketplace, and the CLI runs `codex plugin add openlogos@personal`. If that fails, run it manually.

Each Codex Skill gets the YAML frontmatter Codex requires (`name` and `description`), so Codex does not skip it with a `missing YAML frontmatter` warning. On first launch Codex may show `hook needs review before it can run`. Open `/hooks` in Codex and approve `.agents/plugins/openlogos/hooks/session-start.sh`. See [Codex Plugin](/specs/codex-plugin).

**Cursor**: OpenLogos methodology Skills and command Skills (`openlogos-<command>`, with `disable-model-invocation: true`) go to `.cursor/skills/`. The change-reviewer subagent goes to `.cursor/agents/`. Four managed hook entries are merged into `.cursor/hooks.json`: `sessionStart`, `beforeShellExecution`, `afterShellExecution`, and `afterFileEdit`. Your own hook entries are preserved. Guard strength on Cursor is **partial**: shell commands get a pre-check plus an `afterShellExecution` post-check, while file edits are only reported afterwards. Rule files from older OpenLogos versions are migrated automatically, see [`sync`: Migrating from earlier versions](/cli/sync#migrating-from-earlier-versions). Details: [Cursor Plugin](/specs/cursor-plugin).

**ZCode / Qoder / WorkBuddy**: a self-contained native plugin is installed under `.zcode/plugins/openlogos/`, `.qoder/plugins/openlogos/`, or `.workbuddy/plugins/openlogos/`. It contains Skills, commands, the change-reviewer agent, and `SessionStart` + `PreToolUse` hooks. Host settings files (`.zcode/config.json`, `.qoder/settings.json`, `.workbuddy/settings.json`) are never modified. Start a new session in the host after deployment so it loads the plugin. See [ZCode Plugin](/specs/zcode-plugin), [Qoder Plugin](/specs/qoder-plugin), and [WorkBuddy Plugin](/specs/workbuddy-plugin).

## Suggested ignore entries

Before writing any file, `init` detects the tech stack from manifest files in the project root and suggests paths that git does not ignore yet:

| Stack | Detected by | Suggested entries |
|-------|-------------|-------------------|
| Node | `package.json` | `node_modules/`, `dist/`, `build/`, `coverage/` |
| Python | `pyproject.toml`, `requirements.txt`, `setup.py` | `__pycache__/`, `.venv/`, `*.pyc` |
| Rust | `Cargo.toml` | `target/` |

```
Detected Node project. These paths are not ignored by git yet:
  node_modules/
  dist/
Add them to .gitignore (openlogos managed block)? [Y/n]:
```

- Press Enter or `y` to accept. The entries are saved to `guard.unversioned` in `logos.config.json` and rendered into the `.gitignore` managed block. If any of those paths already contain tracked files, the CLI prints the commands to remove them from the index.
- Answer `n` to skip. The CLI prints the `openlogos ignore add …` command you can run later.
- In non-interactive mode, nothing is written for the suggestions; the CLI only prints the `openlogos ignore add …` command.
- `--locale` and `--ai-tool` do not skip this question.

`logos/.openlogos-runtime/` (guard runtime state) is always written to the managed block without asking. Ignored paths are outside guard protection, so writing dependencies, build output, logs, or caches there needs no proposal after `launch`. To change the list later, use [`openlogos ignore` / `openlogos exempt`](/cli/ignore-exempt).

## Project name resolution

The project name is resolved in this order:

1. Explicit `name` argument (e.g., `openlogos init my-project`)
2. `name` field from `package.json` (with `@scope/` prefix stripped)
3. `name` field from `Cargo.toml` (`[package]` section)
4. `name` field from `pyproject.toml` (`[project]` section)
5. Current directory name (basename of `cwd`)

If both an explicit name and a config file name exist and they differ, the CLI prompts you to choose.

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `logos/logos.config.json already exists` | The directory is already initialized and no target tool was requested | Run `openlogos init --ai-tool <tool>` to add a tool, `openlogos sync` to refresh, or `openlogos adopt` for an existing codebase |
| `--locale is required in non-interactive mode` | Running in CI without `--locale` | Add `--locale en` or `--locale zh` |
| `unsupported AI tool "<value>"` | `--ai-tool` value is not in the supported list | Use one of the nine values above |
| `.gitignore` managed block is corrupted | Duplicate or missing `# >>> openlogos managed >>>` / `# <<< openlogos managed <<<` markers | Fix the markers by hand and rerun; no files were created |
| `.cursor/hooks.json` cannot be parsed, or a Skills/plugin target is owned by something else | Invalid JSON, or a non-OpenLogos directory sits at the target path | Fix or move the file/directory and rerun; nothing was written |

## Related commands

- [`sync`](/cli/sync): Update AI instructions, Skills, and hooks after configuration changes or CLI upgrades
- [`adopt`](/cli/adopt): Onboard an existing codebase instead of starting from Phase 1
- [`ignore` / `exempt`](/cli/ignore-exempt): Manage the paths guard does not protect
- [`status`](/cli/status): Check project phase progression
