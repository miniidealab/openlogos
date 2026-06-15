---
title: OpenCode 插件
description: OpenCode 平台的原生插件规格——命令桥接、hook 注入与双模式架构。
---

OpenCode 插件在 OpenCode 平台上提供增强的集成体验，从基础的「AGENTS.md 兼容模式」升级为「插件优先 + 文档回退」的双轨架构。

## 目标

1. 提供接近 Claude Code 插件的交互体验（命令桥接 + 生命周期上下文）
2. 最大化复用现有的 CLI（`openlogos *`）和 Skill（`logos/skills/*`）
3. 保留 `AGENTS.md` 作为回退，确保插件不可用时工作流的连续性

## 运行模式

### 模式 A：兼容模式

- **输入**：`AGENTS.md` + `logos/skills/*/SKILL.md`
- **何时使用**：插件未安装，或插件出错
- **特点**：零额外安装，体验更基础

### 模式 B：原生插件模式（推荐）

- **输入**：自动生成的 `.opencode/plugins/openlogos.js` 和 `opencode.json`
- **何时使用**：插件已安装时的默认模式
- **特点**：增强体验，含命令入口、自动 Phase 注入、统一工作流控制

## 构建与分发

1. 插件模板随 `@miniidealab/openlogos`（CLI 单包）一起发布，不作为独立 npm 包发布
2. 插件只负责「命令路由 + hook 注入 + 结果格式化」——不重复 CLI 业务逻辑
3. 插件模板版本与 CLI 版本保持同步
4. `openlogos init --ai-tool opencode` 和 `openlogos sync` 会将插件模板自动部署到 `.opencode/plugins/`

## 事件模型

### session.created

新会话启动时触发：

1. 检查项目是否已初始化（`logos/logos.config.json` 是否存在）
2. 调用 `openlogos status`（优先 JSON 输出）
3. 构建注入上下文：当前 Phase、下一步建议、关键阻塞项（缺失的文档）
4. 失败时：静默降级，绝不阻塞会话

### tui.command.execute

输入 `/openlogos:*` 命令时触发：

1. 识别 `/openlogos:*` 前缀命令
2. 校验参数
3. 调用 `cli-bridge` 执行对应的 CLI 命令
4. 统一格式化输出（成功/失败）
5. 对高价值操作显示提示（如「变更提案已创建」）

### 可选增强事件

- `tool.execute.before`——限制高风险调用（如读取敏感文件）
- `tui.toast.show`——关键结果通知

## 命令映射

| OpenCode 命令 | CLI 等价 | 描述 |
|-----------------|---------------|-------------|
| `/openlogos:status` | `openlogos status` | 显示阶段状态 |
| `/openlogos:next` | `openlogos status` | 显示下一步建议 |
| `/openlogos:init [name]` | `openlogos init [name]` | 初始化项目 |
| `/openlogos:sync` | `openlogos sync` | 同步指令和 Skill |
| `/openlogos:change <slug>` | `openlogos change <slug>` | 创建变更提案 |
| `/openlogos:merge <slug>` | `openlogos merge <slug>` | 生成合并指令 |
| `/openlogos:archive <slug>` | `openlogos archive <slug>` | 归档变更 |
| `/openlogos:verify` | `openlogos verify` | 运行验收验证 |
| `/openlogos:launch` | `openlogos launch` | 激活变更管理 |

### 参数约定

- 无参命令：`status`、`next`、`sync`、`verify`、`launch`
- 可选参数命令：`init [name]`
- 必填参数命令：`change <slug>`、`merge <slug>`、`archive <slug>`

解析规则：

1. 统一前缀：`/openlogos:`
2. 参数以空格分隔，不做 shell 字符串拼接
3. `slug` 校验：`^[a-z0-9]+(-[a-z0-9]+)*$`
4. 缺少必填参数时返回用户可读的错误，不触发 CLI

## 错误处理

### 错误码约定

| 错误码 | 场景 | 用户提示 |
|------|----------|--------------|
| `E_CLI_NOT_FOUND` | `openlogos` 不在 PATH 中 | 请安装 `openlogos` 或将其加入 PATH |
| `E_PROJECT_NOT_INIT` | 缺少 `logos/logos.config.json` | 请在项目根目录运行 `openlogos init` |
| `E_ARG_INVALID` | 参数缺失或无效 | 检查命令参数（如 `slug`）后重试 |
| `E_CMD_TIMEOUT` | CLI 超时 | 稍后重试或在终端手动运行 |
| `E_CMD_FAILED` | CLI 非零退出 | 查看错误详情并相应修复 |
| `E_PERMISSION_DENIED` | OpenCode 权限被拒 | 在 `opencode.json` 中允许该能力 |

### 错误分支

插件至少必须处理：

- CLI 未找到（`openlogos` 不在 PATH 中）
- 项目未初始化（缺少 `logos/logos.config.json`）
- 命令参数不完整（如 `change` 缺少 slug）
- 命令超时或非零退出
- 权限被拒（OpenCode 权限拦截）

## 安全

### 推荐权限

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

### 内部安全策略

1. 绝不执行与 OpenLogos 无关的任意 shell 字符串
2. 所有 CLI 调用使用参数数组，不做字符串拼接
3. 仅允许工作区内部路径作为命令上下文
4. 结构化日志（命令名、耗时、退出码、错误码）——不记录敏感内容

## 回退策略

当插件不可用时：

1. AI 读取项目根目录的 `AGENTS.md` → 理解方法论和规则
2. AI 直接读取 `logos/skills/*/SKILL.md` → 可遵循任何 Skill 指引
3. 用户在终端手动运行 `openlogos *` CLI 命令

插件增强体验，但绝非硬性要求。这种双轨设计确保无论插件是否可用，OpenLogos 都能可靠工作。

## 相关规格

- [AGENTS.md 规格](/zh/specs/agents-md)——回退指令文件格式
- [项目结构](/zh/specs/project-structure)——插件文件的部署位置
- [`openlogos init`](/zh/cli/init)——为 OpenCode 自动部署插件模板
- [`openlogos sync`](/zh/cli/sync)——重新部署并更新插件文件
