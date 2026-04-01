# OpenLogos

**AI 时代的开源软件研发方法论**

> OpenLogos 定义研发规范，[RunLogos](https://runlogos.com) 让规范落地。

---

## 什么是 OpenLogos？

OpenLogos 是一套面向 AI 时代的开源软件研发方法论，由拥有 20 余年经验的软件研发专家沉淀而成。它将成熟的软件工程方法论编码为可执行的 AI Skills，使开发者能在 AI 编程工具（Cursor、Claude Code 等）中直接使用这套方法论。

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
npm install -g @miniidea/openlogos

# 初始化项目
openlogos init my-project

# 开始开发——按方法论的三层推进模型逐步推进
```

### 方式二：手动集成

1. 将 `skills/` 目录下的 SKILL.md 文件复制到你的项目中
2. 在 Cursor 中配置 `.cursor/rules/` 引用这些 Skills
3. 或在 Claude Code 中通过 `CLAUDE.md` 引用

### 方式三：参考示例项目

```bash
git clone https://github.com/miniidea/openlogos.git
cd openlogos/examples/demo-saas-project
# 查看一个遵循 OpenLogos 方法论的完整项目结构
```

## 仓库结构

```
openlogos/
├── spec/           # 核心规范（平台无关）
│   ├── logos.config.schema.json
│   ├── logos-project.md
│   ├── directory-convention.md
│   ├── workflow.md
│   ├── change-management.md
│   └── agents-md.md
│
├── skills/         # AI Skills（平台无关的 Markdown 定义）
│   ├── project-init/
│   ├── prd-writer/
│   ├── product-designer/
│   ├── scenario-architect/
│   ├── api-designer/
│   ├── db-designer/
│   ├── test-orchestrator/
│   └── code-reviewer/
│
├── cli/            # openlogos CLI 工具
├── examples/       # 示例项目
└── website/        # openlogos.ai 官网源码
```

## AI 工具兼容性

OpenLogos Skills 的核心内容是平台无关的 Markdown 文档。只要 AI 工具支持项目级 prompt 注入，就可以使用。

| 工具 | 适配方式 | 状态 |
|------|---------|------|
| **Cursor** | `AGENTS.md` + `.cursor/rules/` | 已支持 |
| **Claude Code** | `CLAUDE.md` | 已支持 |
| **OpenCode** | `AGENTS.md` | 已支持 |
| GitHub Copilot | 规划中 | Phase 1.5 |
| Windsurf | 规划中 | Phase 1.5 |

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
- GitHub：[github.com/miniidea/openlogos](https://github.com/miniidea/openlogos)
- MiniIdea：[miniidealab.com](https://miniidealab.com)
