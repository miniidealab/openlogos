# OpenCode 原生插件规范（OpenLogos）

> 版本：0.1.0（草案）
>
> 本文档定义 OpenLogos 在 OpenCode 平台上的原生插件方案，目标是把当前“AGENTS 兼容模式”升级为“插件优先 + 文档兜底”的双轨机制。

## 目标

1. 提供与 Claude Code 插件接近的交互体验（命令桥接 + 生命周期上下文）
2. 最大化复用现有 CLI（`openlogos *`）与 Skills（`logos/skills/*`）
3. 保留 `AGENTS.md` 兜底，确保插件不可用时流程不中断

## 运行模式

### 模式 A：兼容模式（当前可用）

- 输入：`AGENTS.md` + `logos/skills/*/SKILL.md`
- 适用：未安装插件或插件异常时
- 特点：零额外安装，体验相对基础

### 模式 B：原生插件模式（推荐）

- 输入：`openlogos init/sync` 自动生成的 `.opencode/plugins/openlogos.js` 与 `opencode.json`
- 适用：希望获得命令入口、自动 Phase 注入、统一工作流控制
- 特点：体验增强，便于分发与版本管理

## 目录建议

```text
openlogos/
├── plugin-opencode/
│   ├── src/
│   │   ├── index.ts            # 插件入口
│   │   ├── hooks.ts            # hook 注册与分发
│   │   ├── commands.ts         # /openlogos:* 命令映射
│   │   ├── cli-bridge.ts       # 调用 openlogos CLI 的桥接层
│   │   └── types.ts
│   ├── package.json
│   └── README.md
└── spec/opencode-plugin.md
```

## 构建与发布边界

1. 插件模板随 `@miniidealab/openlogos`（CLI 单包）一起发布，不单独发布插件 npm 包。
2. 插件只负责“命令路由 + hook 注入 + 结果格式化”，不复制 CLI 业务逻辑。
3. 版本策略：
   - 插件模板版本与 CLI 版本保持同步
   - 当依赖 CLI 新参数/新输出时，在同一 CLI 版本内联动升级
4. 发布产物包含 `opencode-plugin-template/`，由 `init/sync` 自动部署到用户项目。

## 事件模型（MVP）

MVP 至少覆盖以下事件：

1. `session.created`
   - 目的：会话启动时注入当前 Phase 与下一步建议
   - 行为：调用 `openlogos status`（推荐支持 JSON 输出）并构建上下文

2. `tui.command.execute`
   - 目的：拦截并分发 `/openlogos:*` 命令
   - 行为：解析命令参数，调用 CLI，回传结构化结果（成功/失败）

可选增强事件：

- `tool.execute.before`：限制高风险调用（如误读敏感文件）
- `tui.toast.show`：关键结果提示（如已创建 change）

## 命令映射（建议）

| OpenCode 命令 | 对应 CLI | 说明 |
|---|---|---|
| `/openlogos:status` | `openlogos status` | 显示阶段状态 |
| `/openlogos:next` | `openlogos status`（兼容映射） | 显示下一步建议（当前由 status 输出承载） |
| `/openlogos:init [name]` | `openlogos init [name]` | 初始化项目 |
| `/openlogos:sync` | `openlogos sync` | 同步指令与技能 |
| `/openlogos:change <slug>` | `openlogos change <slug>` | 创建变更提案 |
| `/openlogos:merge <slug>` | `openlogos merge <slug>` | 生成合并指令 |
| `/openlogos:archive <slug>` | `openlogos archive <slug>` | 归档变更 |
| `/openlogos:verify` | `openlogos verify` | 执行验收 |
| `/openlogos:launch [module-id]` | `openlogos launch [module-id]` | 将指定模块标记为 launched，激活变更管理 |

### 命令参数契约（MVP）

- 无参命令：`status`、`next`、`sync`、`verify`
- 可选参命令：`init [name]`、`launch [module-id]`
- 必填参命令：`change <slug>`、`merge <slug>`、`archive <slug>`

解析规则：

1. 统一前缀：`/openlogos:`
2. 参数按空格分词，不做 shell 拼接
3. 对 `slug` 做白名单校验：`^[a-z0-9]+(-[a-z0-9]+)*$`
4. 参数缺失时直接返回用户可读错误，不触发 CLI 调用

## 安全边界

1. **最小权限原则**：仅放行插件必要的命令与路径访问
2. **路径约束**：仅在工作区内执行，不允许跨目录危险写入
3. **错误可观测性**：所有 CLI 失败返回统一错误码与可读提示
4. **降级策略**：插件不可用时，回退到 `AGENTS.md` 兼容模式

## 错误处理规范

至少覆盖以下错误分支：

- CLI 不存在（`openlogos` 不在 PATH）
- 项目未初始化（缺失 `logos/logos.config.json`）
- 命令参数不完整（如 `change` 缺 slug）
- 命令超时或非 0 退出
- 权限拒绝（OpenCode permission 拦截）

### 错误码约定（插件内）

| 错误码 | 场景 | 用户提示 |
|---|---|---|
| `E_CLI_NOT_FOUND` | 找不到 `openlogos` 命令 | 请先安装或将 `openlogos` 加入 PATH |
| `E_PROJECT_NOT_INIT` | 缺失 `logos/logos.config.json` | 请先在项目根执行 `openlogos init` |
| `E_ARG_INVALID` | 参数缺失或格式非法 | 检查命令参数（如 `slug`）后重试 |
| `E_CMD_TIMEOUT` | CLI 超时 | 稍后重试或改在终端手动执行 |
| `E_CMD_FAILED` | CLI 非 0 退出 | 查看错误详情并按提示修复 |
| `E_PERMISSION_DENIED` | OpenCode 权限拒绝 | 在 `opencode.json` 允许对应能力 |

## Hook 策略（详细）

### `session.created`

执行顺序：

1. 检查项目是否已初始化（`logos/logos.config.json`）
2. 调用 `openlogos status`（优先 JSON 输出）
3. 生成注入上下文：
   - 当前 Phase
   - 下一步建议
   - 关键阻塞项（如缺失文档）
4. 注入失败时降级为静默，不阻断会话

### `tui.command.execute`

执行顺序：

1. 识别 `/openlogos:*` 前缀命令
2. 参数校验
3. 调用 `cli-bridge` 执行对应 CLI
4. 统一格式化输出（成功/失败）
5. 对高价值动作显示提示（如 `change` 创建成功）

## 发布建议

1. 仅发布 `@miniidealab/openlogos`，不拆独立 OpenCode 插件包。
2. `openlogos init --ai-tool opencode` 与 `openlogos sync` 自动部署插件模板到 `.opencode/plugins/`。
3. 对外文档明确：原生插件为推荐路径，`AGENTS.md` 为兼容路径（降级兜底）。

## 权限与安全策略

建议在 OpenCode 配置中采用最小权限：

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

插件内部安全策略：

1. 禁止执行与 OpenLogos 无关的任意 shell 字符串
2. 所有 CLI 调用使用参数数组，不进行字符串拼接
3. 仅允许工作区内路径作为命令上下文
4. 记录结构化日志（命令名、耗时、退出码、错误码），不记录敏感内容

## 验收标准（文档阶段）

- `README.md` 已包含 OpenCode 原生插件安装说明
- `spec/agents-md.md` 已明确双轨模式
- 本文档定义了插件边界、事件、命令映射与安全策略
