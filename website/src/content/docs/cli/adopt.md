---
title: "openlogos adopt"
description: Onboard an existing project into OpenLogos with bootstrap=adopted mode, skipping the initial document baseline.
---

Initialize OpenLogos infrastructure for an **existing project** that already has code but no `logos/` directory. Unlike `init` (which starts a fresh project from Phase 1), `adopt` sets the module lifecycle directly to `launched` and marks `bootstrap: adopted`, skipping the initial document baseline requirement.

## Synopsis

```bash
openlogos adopt [name] [--locale <en|zh>] [--ai-tool <claude-code|opencode|codex|cursor|zcode|qoder|workbuddy|other|all>]
```

Must be run from the project root (where `package.json`, `Cargo.toml`, or similar exists).

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `name` | Project name | Auto-detected from `package.json`, `Cargo.toml`, `pyproject.toml`, or directory name |

## Options

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `--locale` | `en`, `zh` | Interactive prompt (defaults to `zh`); `zh` in non-interactive mode | Set the document language |
| `--ai-tool` | `claude-code`, `opencode`, `codex`, `cursor`, `zcode`, `qoder`, `workbuddy`, `other`, `all` | Interactive prompt; detected from the environment in non-interactive mode | Set the AI coding tool |
| `--aitool` | Same as `--ai-tool` | Same as `--ai-tool` | Alias for `--ai-tool` |

The AI tool menu and the non-interactive host detection are the same as in [`init`](/cli/init#interactive-mode). Unlike `init`, `adopt` does not require `--locale` in non-interactive mode; it falls back to `zh`.

## What it does

1. Checks that the target directories, host plugin locations, and the `.gitignore` managed block can be written safely. If any check fails, it stops before creating anything.
2. Suggests ignore entries for the detected tech stack (same rules as [`init`](/cli/init#suggested-ignore-entries)), before any file is written
3. Creates the full `logos/` directory structure (same as `init`)
4. Writes `logos/logos.config.json`. Accepted ignore entries go into `guard.unversioned`, and `verify.pre_run_command` is auto-configured based on project type
5. Renders the `.gitignore` managed block (always including `logos/.openlogos-runtime/`)
6. Writes `logos/logos-project.yaml` with `bootstrap: adopted`, `lifecycle: launched`, and `baseline_seed_state: required`
7. Generates the OpenLogos managed block in `AGENTS.md` and `CLAUDE.md` with change management rules active. Existing content in those files is preserved
8. Deploys Skills, specs, and host plugin assets. For Claude Code this includes the guard and post-check hooks, plus `language` in `.claude/settings.json` set from the locale (`"english"` / `"chinese"`)

## How it differs from `init`

| Aspect | `init` | `adopt` |
|--------|--------|---------|
| Target | New project (no existing code) | Existing project with code |
| Module lifecycle | `initial` | `launched` |
| Bootstrap mode | `normal` (default) | `adopted` |
| Document baseline | Required (Phase 1 → 2 → 3) | Skipped |
| Change management | Not enforced until `launch` | Active immediately |

## Bootstrap mode behavior

When `bootstrap: adopted` is set:

- **`status`**: missing Phase 1, Phase 2, and Phase 3-0 documents are not reported as errors. It shows "Documentation baseline skipped (adopted access mode)".
- **`next`**: when there is no active proposal, it suggests `openlogos change <slug>` directly. No standalone baseline is required first.
- **`launch`**: exempt from the initial document gate checks (already launched)
- **`detect --format json`**: outputs `bootstrap: "adopted"` in the module data

You do not need to back-fill a full documentation baseline before your first change. When you create a change, proposal planning covers the features and scenarios that change touches: it modifies a target document if it exists, and creates the full document if it is missing.

### Optional: reverse-engineered baseline seed

`baseline_seed_state: required` is kept as an optional evidence state and does **not** block any change. If you explicitly want the AI to scan the whole codebase up front and record a verifiable system map and scenario candidates, use the [brownfield-adopter](/skills/brownfield-adopter) Skill, which commits its results through `openlogos baseline-seed begin` / `commit`. Skipping it is fine. `change-writer` still fills in the formal specs for whatever each change touches.

## Example output

```
$ openlogos adopt

? 检测到已有项目：my-app（来自 package.json）
? 文档语言 (locale)：en
? AI 工具：claude-code

✓ 读取项目信息完成

Detected Node project. These paths are not ignored by git yet:
  node_modules/
  dist/
Add them to .gitignore (openlogos managed block)? [Y/n]:
✓ 创建 logos/ 标准目录结构
✓ 写入 logos.config.json
✓ verify pre-run config detected and written: npm test
  ✓ .gitignore managed block: logos/.openlogos-runtime/ (OpenLogos runtime files)
  ✓ .gitignore managed block: added node_modules/, dist/
✓ 写入 logos-project.yaml（bootstrap: adopted, lifecycle: launched）
✓ 标记待建现状基线（baseline_seed_state: required）
✓ 写入 AGENTS.md / CLAUDE.md
...
🎉 已有项目接入完成！

建议的下一步：直接运行 openlogos change <slug> 创建第一个变更提案。
```

The summary lines of `adopt` are printed in Chinese regardless of locale; the ignore-suggestion lines follow the chosen locale. The skill/spec deployment lines depend on the selected tool.

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `该项目已初始化（logos/logos.config.json 已存在）` | Project already has OpenLogos | Use `openlogos sync` to refresh, `openlogos init --ai-tool <tool>` to add a tool, or back up and remove `logos/` to start over |
| `unsupported AI tool "<value>"` | `--ai-tool` value is not supported | Use one of the nine values above |
| `.gitignore` managed block is corrupted | Duplicate or missing managed-block markers | Fix the markers by hand and rerun; nothing was written |

## Related commands

- [`init`](/cli/init): Initialize a brand-new project (starts from Phase 1)
- [`sync`](/cli/sync): Refresh AI instructions, Skills, and hooks for an existing OpenLogos project
- [`change`](/cli/change): Create a change proposal (suggested first action after adopt)
- [`ignore` / `exempt`](/cli/ignore-exempt): Adjust the paths guard does not protect
- [`status`](/cli/status): Check project phase and bootstrap state
