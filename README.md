# OpenLogos

**开源的 AI 时代软件研发方法论**

> OpenLogos 定义研发规范，[RunLogos](https://runlogos.com) 让规范落地。

---

## 什么是 OpenLogos？

OpenLogos 是一套开源的软件研发方法论，专为 AI 时代打造，由拥有 20 余年经验的软件研发专家沉淀而成。它将成熟的软件工程方法论编码为可执行的 AI Skills，使开发者能在 AI 编程工具（Cursor、Claude Code 等）中直接使用这套方法论。

**核心立场：反 Vibe Coding。** 不是一上来就让 AI 写代码，而是分层推进——先搞清楚为什么做，再设计做什么，最后决定如何做。AI 是强大的执行者，但它需要清晰的指令和约束。

## 核心理念

### 三层推进模型

```
WHY  — 为什么做 → 需求文档（用户痛点、竞品分析、功能需求）
WHAT — 做什么   → 产品设计（功能规格、HTML 原型、设计规范）
HOW  — 如何做   → 技术实现（场景建模 → API → DB → 测试编排 → 代码）
```

每一层的产出是下一层的输入。跳过任何一层都会导致后续工作的歧义指数级增长。

### 场景驱动 + 测试先行

- **场景驱动**：从真实业务场景出发设计技术方案，时序图是场景到技术的桥梁
- **测试先行**：写代码之前先设计 API 编排测试用例，编排既是开发规格也是验收标准

### AI 的角色

人做决策，AI 做执行。方法论确保 AI 的执行在正确的轨道上。

## 快速开始

### 方式一：使用 CLI 工具（推荐）

```bash
# 安装
npm install -g @miniidealab/openlogos

# 初始化项目
openlogos init my-project

# 开始开发——按方法论的三层推进模型逐步推进
```

### 方式二：手动集成

1. 将 `skills/` 目录下的 SKILL.md 文件复制到你的项目中
2. 在 Cursor 中配置 `.cursor/rules/` 引用这些 Skills
3. 或在 Claude Code 中通过 `CLAUDE.md` 引用

### 方式三：参考可运行示例（TaskFlow API）

```bash
git clone https://github.com/miniidealab/openlogos.git
cd openlogos/examples/taskflow-api
npm install
cd ../../cli && npm install && npm run build && cd ../examples/taskflow-api
npm test && npm run verify
```

详见 [examples/README.md](examples/README.md)（含 **TaskFlow** 与占位 demo 的说明）。

## 仓库结构

```
openlogos/
├── spec/           # 核心规范（平台无关）
│   ├── logos.config.schema.json
│   ├── logos-project.md
│   ├── directory-convention.md
│   ├── workflow.md
│   ├── change-management.md
│   ├── agents-md.md
│   └── test-results.md
│
├── skills/         # AI Skills（平台无关的 Markdown 定义）
│   ├── project-init/          # 项目初始化引导
│   ├── prd-writer/            # Phase 1 · 需求文档
│   ├── product-designer/      # Phase 2 · 产品设计
│   ├── architecture-designer/ # Phase 3-0 · 技术架构
│   ├── scenario-architect/    # Phase 3-1 · 场景建模
│   ├── api-designer/          # Phase 3-2 · API 设计
│   ├── db-designer/           # Phase 3-2 · 数据库设计
│   ├── test-writer/           # Phase 3-3a · 测试用例设计
│   ├── test-orchestrator/     # Phase 3-3b · API 编排测试
│   ├── code-reviewer/         # 代码评审
│   ├── change-writer/         # 变更提案填写
│   └── merge-executor/        # 变更合并执行
│
├── cli/            # openlogos CLI 工具
├── plugin/         # Claude Code 原生插件
├── examples/       # 示例项目（taskflow-api 为可运行参考实现）
└── website/        # openlogos.ai 官网源码
```

### 采用 OpenLogos 后的项目结构

运行 `openlogos init` 后，所有方法论资产收纳在 `logos/` 目录下，对项目结构零侵入：

```
your-project/
├── AGENTS.md               # AI 指令入口（根目录，AI 工具要求）
├── logos/                   # OpenLogos 方法论资产
│   ├── logos.config.json    # 项目配置
│   ├── logos-project.yaml   # AI 协作索引
│   ├── resources/           # 研发资源文档
│   └── changes/             # 变更提案工作区
└── src/                     # 你的源代码
```

## AI 工具兼容性

OpenLogos Skills 的核心内容是平台无关的 Markdown 文档。只要 AI 工具支持项目级 prompt 注入，就可以使用。

| 工具 | 适配方式 | 状态 |
|------|---------|------|
| **Cursor** | `AGENTS.md` + `.cursor/rules/` | 已支持 |
| **Claude Code** | 原生插件（推荐）或 `CLAUDE.md` | 已支持 |
| **OpenCode** | `AGENTS.md` | 已支持 |
| GitHub Copilot | 规划中 | Phase 1.5 |
| Windsurf | 规划中 | Phase 1.5 |

### Claude Code 插件（推荐）

Claude Code 用户可以通过原生插件获得最佳体验。插件提供：

- **12 个 AI Skills 自动发现** — Claude 根据任务上下文自动激活正确的 Skill
- **斜杠命令** — 无需切终端，在对话中直接操作
- **SessionStart Hook** — 每次启动自动检测项目 Phase 并注入上下文
- **change-reviewer 代理** — 只读审查变更提案的合规性

#### 安装

```bash
# 1. 添加 OpenLogos 插件市场（一次性操作）
/plugin marketplace add miniidealab/openlogos

# 2. 安装插件
/plugin install openlogos@miniidealab-openlogos
```

#### 可用命令

| 命令 | 说明 |
|------|------|
| `/openlogos:status` | 查看当前 Phase 进度和下一步建议 |
| `/openlogos:next` | 获取下一步操作的详细引导和可用提示词 |
| `/openlogos:change <slug>` | 创建变更提案（项目 active 后使用） |
| `/openlogos:launch` | 将项目从初始开发切换为 active，激活变更管理 |

#### 工作流示例

```
1. 启动 Claude Code → SessionStart Hook 自动检测 Phase
2. 输入 /openlogos:next → Claude 告诉你"当前是 Phase 1，建议写需求文档"
3. 说 "帮我写需求文档" → Claude 自动激活 prd-writer Skill，按步骤引导
4. 需求写完后再次 /openlogos:next → 进入 Phase 2 产品设计
5. 逐步推进到 Phase 3（架构 → 场景 → API → 测试 → 代码）
6. 全部完成后 /openlogos:launch → 激活变更管理
7. 后续修改用 /openlogos:change <slug> 创建变更提案
```

#### 与 CLI 的关系

| 场景 | 使用方式 |
|------|---------|
| 初始化新项目 | CLI: `openlogos init` |
| 查看进度 | 插件: `/openlogos:status` 或 CLI: `openlogos status` |
| Phase 推进（写文档） | 插件: 自动激活 Skill |
| 创建变更提案 | 插件: `/openlogos:change` 或 CLI: `openlogos change` |
| 运行测试验收 | CLI: `openlogos verify` |

> **不安装插件也能用**：`openlogos init` 选择 Claude Code 时会自动生成 `CLAUDE.md`，提供基础方法论指导。插件是增强体验，不是必须。

## 渐进式采纳

不需要一次性全部采纳，按你的节奏逐步深入：

1. **Level 1**：运行 `openlogos init`，规范化项目结构（5 分钟上手）
2. **Level 2**：写代码前先完成需求文档和产品设计（文档驱动）
3. **Level 3**：采用完整的场景驱动 + 测试先行流程（工程化）
4. **Level 4**：全流程闭环 + Delta 变更管理（企业级）

## 许可证

- 代码和规范：[Apache License 2.0](./LICENSE)
- 文档和教程：[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

## 贡献

欢迎参与贡献！请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解如何参与。

## 链接

- 官网：[openlogos.ai](https://openlogos.ai)
- 商业工具：[RunLogos](https://runlogos.com)
- GitHub：[github.com/miniidealab/openlogos](https://github.com/miniidealab/openlogos)
- MiniIdea：[miniidealab.com](https://miniidealab.com)
