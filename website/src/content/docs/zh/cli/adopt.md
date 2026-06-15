---
title: "openlogos adopt"
description: 以 bootstrap=adopted 模式将现有项目接入 OpenLogos，跳过初始文档基线。
---

为一个**已有代码但还没有 `logos/` 目录的现有项目**初始化 OpenLogos 基础设施。与 `init`（从 Phase 1 开始一个全新项目）不同，`adopt` 直接将模块 lifecycle 设为 `launched` 并标记 `bootstrap: adopted`，跳过初始文档基线要求。

## 命令格式

```bash
openlogos adopt [name] [--locale <en|zh>] [--ai-tool <claude-code|opencode|codex|cursor|other|all>]
```

必须在项目根目录下运行（即存在 `package.json`、`Cargo.toml` 或类似文件的位置）。

## 参数

| 参数 | 说明 | 默认值 |
|----------|-------------|---------|
| `name` | 项目名称 | 从 `package.json`、`Cargo.toml`、`pyproject.toml` 或目录名自动检测 |

## 选项

| 选项 | 取值 | 默认值 | 说明 |
|--------|--------|---------|-------------|
| `--locale` | `en`, `zh` | 交互式提示 | 设置文档语言 |
| `--ai-tool` | `claude-code`, `opencode`, `codex`, `cursor`, `other`, `all` | 交互式提示 | 设置 AI 编码工具 |

## 功能说明

1. 创建完整的 `logos/` 目录结构（与 `init` 相同）
2. 写入带项目配置的 `logos/logos.config.json`
3. 写入带 `bootstrap: adopted` 和 `lifecycle: launched` 的 `logos/logos-project.yaml`
4. 生成已激活变更管理规则的 `AGENTS.md` 和 `CLAUDE.md`
5. 部署 Skills、specs 以及工具专属的插件资源
6. 根据项目类型自动检测并配置 `verify.pre_run_command`

## 与 `init` 的区别

| 方面 | `init` | `adopt` |
|--------|--------|---------|
| 目标 | 新项目（无现有代码） | 已有代码的现有项目 |
| 模块 lifecycle | `initial` | `launched` |
| Bootstrap 模式 | `normal`（默认） | `adopted` |
| 文档基线 | 必需（Phase 1 → 2 → 3） | 跳过 |
| 变更管理 | `launch` 之前不强制 | 立即激活 |

## Bootstrap 模式行为

当设置了 `bootstrap: adopted` 时：

- **`status`**：Phase 1、Phase 2 和 Phase 3-0 缺失的文档不会报告为错误 —— 显示 "Document baseline skipped (existing project onboarding)"
- **`next`**：当没有活跃提案时，建议运行 `openlogos change add-baseline-docs` 来回填文档
- **`launch`**：豁免初始文档门禁检查（已经 launched）
- **`detect --format json`**：在模块数据中输出 `bootstrap: "adopted"`

## 输出示例

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

## 错误

| 错误 | 原因 | 解决方法 |
|-------|-------|-----|
| `该项目已初始化（logos/logos.config.json 已存在）` | 项目已经接入 OpenLogos | 使用 `openlogos sync` 刷新，或删除 `logos/` 重新开始 |

## 相关命令

- [`init`](/zh/cli/init) — 初始化一个全新项目（从 Phase 1 开始）
- [`sync`](/zh/cli/sync) — 为现有 OpenLogos 项目刷新 AI 指令和 Skills
- [`change`](/zh/cli/change) — 创建变更提案（adopt 之后建议的首个操作）
- [`status`](/zh/cli/status) — 检查项目阶段和 bootstrap 状态
