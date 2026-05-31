---
title: "openlogos adopt"
description: Onboard an existing project into OpenLogos with bootstrap=adopted mode, skipping the initial document baseline.
---

Initialize OpenLogos infrastructure for an **existing project** that already has code but no `logos/` directory. Unlike `init` (which starts a fresh project from Phase 1), `adopt` sets the module lifecycle directly to `launched` and marks `bootstrap: adopted`, skipping the initial document baseline requirement.

## Synopsis

```bash
openlogos adopt [name] [--locale <en|zh>] [--ai-tool <claude-code|opencode|codex|cursor|other|all>]
```

Must be run from the project root (where `package.json`, `Cargo.toml`, or similar exists).

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `name` | Project name | Auto-detected from `package.json`, `Cargo.toml`, `pyproject.toml`, or directory name |

## Options

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `--locale` | `en`, `zh` | Interactive prompt | Set the document language |
| `--ai-tool` | `claude-code`, `opencode`, `codex`, `cursor`, `other`, `all` | Interactive prompt | Set the AI coding tool |

## What it does

1. Creates the full `logos/` directory structure (same as `init`)
2. Writes `logos/logos.config.json` with project configuration
3. Writes `logos/logos-project.yaml` with `bootstrap: adopted` and `lifecycle: launched`
4. Generates `AGENTS.md` and `CLAUDE.md` with change management rules active
5. Deploys Skills, specs, and tool-specific plugin assets
6. Auto-detects and configures `verify.pre_run_command` based on project type

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

- **`status`**: Phase 1, Phase 2, and Phase 3-0 missing documents don't report as errors — shows "Document baseline skipped (existing project onboarding)"
- **`next`**: When no active proposal exists, suggests `openlogos change add-baseline-docs` to backfill documentation
- **`launch`**: Exempted from initial document gate checks (already launched)
- **`detect --format json`**: Outputs `bootstrap: "adopted"` in the module data

## Example output

```
$ openlogos adopt

? 检测到已有项目：my-app（来自 package.json）
? 文档语言 (locale)：zh
? AI 工具：claude-code

✓ 读取项目信息完成

✓ 创建 logos/ 标准目录结构
✓ 写入 logos.config.json
  ✓ verify.pre_run_command auto-configured: cd cli && npm test
✓ 写入 logos-project.yaml（bootstrap: adopted, lifecycle: launched）
✓ 写入 AGENTS.md / CLAUDE.md
✓ 16 skills deployed to logos/skills/
✓ 13 specs deployed to logos/spec/

🎉 已有项目接入完成！

项目已进入存量项目接入模式（bootstrap: adopted）：
  · OpenLogos 基础设施已完整初始化
  · Initial 文档基线已跳过，不强制要求
  · 模块生命周期直接设为 launched

建议的下一步：先补充项目基线文档
  → openlogos change add-baseline-docs
  在变更提案中逐步补写需求、架构、场景、测试用例，
  把 TDD 思想贯彻到每一次迭代中。
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `该项目已初始化（logos/logos.config.json 已存在）` | Project already has OpenLogos | Use `openlogos sync` to refresh, or remove `logos/` to start over |

## Related commands

- [`init`](/cli/init) — Initialize a brand-new project (starts from Phase 1)
- [`sync`](/cli/sync) — Refresh AI instructions and Skills for an existing OpenLogos project
- [`change`](/cli/change) — Create a change proposal (suggested first action after adopt)
- [`status`](/cli/status) — Check project phase and bootstrap state
