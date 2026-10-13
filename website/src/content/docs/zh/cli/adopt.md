---
title: "openlogos adopt"
description: 以 bootstrap=adopted 模式将现有项目接入 OpenLogos，跳过初始文档基线。
---

为一个**已有代码但还没有 `logos/` 目录的现有项目**初始化 OpenLogos 基础设施。与 `init`（从 Phase 1 开始一个全新项目）不同，`adopt` 直接将模块 lifecycle 设为 `launched` 并标记 `bootstrap: adopted`，跳过初始文档基线要求。

## 命令格式

```bash
openlogos adopt [name] [--locale <en|zh>] [--ai-tool <claude-code|opencode|codex|cursor|zcode|qoder|workbuddy|other|all>]
```

必须在项目根目录下运行（即存在 `package.json`、`Cargo.toml` 或类似文件的位置）。

## 参数

| 参数 | 说明 | 默认值 |
|----------|-------------|---------|
| `name` | 项目名称 | 从 `package.json`、`Cargo.toml`、`pyproject.toml` 或目录名自动检测 |

## 选项

| 选项 | 取值 | 默认值 | 说明 |
|--------|--------|---------|-------------|
| `--locale` | `en`, `zh` | 交互式提示（默认 `zh`）；非交互环境为 `zh` | 设置文档语言 |
| `--ai-tool` | `claude-code`, `opencode`, `codex`, `cursor`, `zcode`, `qoder`, `workbuddy`, `other`, `all` | 交互式提示；非交互环境按环境变量识别 | 设置 AI 编码工具 |
| `--aitool` | 同 `--ai-tool` | 同 `--ai-tool` | `--ai-tool` 的等价别名 |

AI 工具菜单与非交互环境下的宿主识别规则与 [`init`](/zh/cli/init#交互模式) 相同。与 `init` 不同的是，`adopt` 在非交互环境下不强制要求 `--locale`，缺省为 `zh`。

## 功能说明

1. 先预检目标目录、宿主插件位置与 `.gitignore` 托管区块能否安全写入；任一项失败即在创建任何文件之前停止
2. 在写入任何文件之前，按识别到的技术栈建议忽略目录（规则与 [`init`](/zh/cli/init#按技术栈建议忽略目录) 相同）
3. 创建完整的 `logos/` 目录结构（与 `init` 相同）
4. 写入 `logos/logos.config.json`：接受的忽略条目写入 `guard.unversioned`，并根据项目类型自动配置 `verify.pre_run_command`
5. 渲染 `.gitignore` 托管区块（固定包含 `logos/.openlogos-runtime/`）
6. 写入带 `bootstrap: adopted`、`lifecycle: launched` 与 `baseline_seed_state: required` 的 `logos/logos-project.yaml`
7. 在 `AGENTS.md` 和 `CLAUDE.md` 中生成已激活变更管理规则的 OpenLogos 托管片段；文件中已有的内容保留
8. 部署 Skills、specs 以及宿主插件资产；对 Claude Code 还包括 guard 与事后检查 hooks，以及按 locale 写入 `.claude/settings.json` 的 `language`（`"chinese"` / `"english"`）

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

- **`status`**：Phase 1、Phase 2 和 Phase 3-0 缺失的文档不会报告为错误，而是显示文档基线已跳过（adopted 接入模式）
- **`next`**：没有活跃提案时，直接建议 `openlogos change <slug>`，无需先单独建立基线
- **`launch`**：豁免初始文档门禁检查（已经 launched）
- **`detect --format json`**：在模块数据中输出 `bootstrap: "adopted"`

第一次变更之前不必补齐整套文档基线。创建变更时，提案规划会按这次变更触达的功能 / 场景自动补齐：目标文档存在就修改（MODIFY），缺失就创建完整文档（CREATE）。

### 可选：逆向建立现状基线

`baseline_seed_state: required` 只作为可选的证据状态保留，**不会**阻断任何变更。如果你明确希望 AI 先扫描整个代码库，记录可验证的系统地图与场景候选清单，请使用 [brownfield-adopter](/zh/skills/brownfield-adopter) Skill，它通过 `openlogos baseline-seed begin` / `commit` 提交结果。完全跳过也没有问题，change-writer 仍会在每次变更中补齐触达部分的正式规格。

## 输出示例

```
$ openlogos adopt

? 检测到已有项目：my-app（来自 package.json）
? 文档语言 (locale)：zh
? AI 工具：claude-code

✓ 读取项目信息完成

检测到 Node 项目，以下路径尚未被 git 忽略：
  node_modules/
  dist/
是否加入 .gitignore（openlogos 托管区块）？[Y/n]：
✓ 创建 logos/ 标准目录结构
✓ 写入 logos.config.json
✓ 已检测到并写入 verify 预跑配置：npm test
  ✓ 已在 .gitignore 托管区块写入 logos/.openlogos-runtime/（OpenLogos 运行时文件）
  ✓ 已加入 .gitignore 托管区块：node_modules/、dist/
✓ 写入 logos-project.yaml（bootstrap: adopted, lifecycle: launched）
✓ 标记待建现状基线（baseline_seed_state: required）
✓ 写入 AGENTS.md / CLAUDE.md
...
🎉 已有项目接入完成！

建议的下一步：直接运行 openlogos change <slug> 创建第一个变更提案。
```

Skills / specs 部署相关的行随所选工具而不同。

## 错误

| 错误 | 原因 | 解决方法 |
|-------|-------|-----|
| `该项目已初始化（logos/logos.config.json 已存在）` | 项目已经接入 OpenLogos | 用 `openlogos sync` 刷新，用 `openlogos init --ai-tool <tool>` 补齐工具，或备份并删除 `logos/` 后重新开始 |
| `unsupported AI tool "<value>"` | `--ai-tool` 取值不受支持 | 使用上文 9 个取值之一 |
| `.gitignore` 托管区块已损坏 | 托管区块标记重复或缺失 | 手工修复标记后重试；此时没有写入任何内容 |

## 相关命令

- [`init`](/zh/cli/init)：初始化一个全新项目（从 Phase 1 开始）
- [`sync`](/zh/cli/sync)：为现有 OpenLogos 项目刷新 AI 指令、Skills 和 hooks
- [`change`](/zh/cli/change)：创建变更提案（adopt 之后建议的首个操作）
- [`ignore` / `exempt`](/zh/cli/ignore-exempt)：调整 guard 不保护的路径
- [`status`](/zh/cli/status)：检查项目阶段和 bootstrap 状态
