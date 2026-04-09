# FlowTask

一款本地优先的个人桌面任务管理工具，支持 macOS 和 Windows。数据完全存储在本地 SQLite，无需网络连接，保护用户隐私。

> 本项目是 [OpenLogos](https://github.com/miniidealab/openlogos) monorepo 中的 **Claude Code 集成官方演示**（小型桌面应用），完整展示了从需求 → 设计 → 架构 → 编码的 AI 辅助研发全流程。  
> 若你使用 **OpenCode** 并希望对照含 `.opencode/commands/` 的同类示例，请优先参考同目录下的 [money-log](../money-log/README.md)（Electron）。

---

## 功能特性

- 账号注册与登录（密码 bcrypt 加密存储）
- 任务增删改查，支持标记完成
- 自定义分类，按分类筛选任务
- 账号密码修改
- 完全本地化，数据不离开本机

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri 2 |
| 前端 | React 18 + TypeScript + Vite |
| 样式 | Tailwind CSS v4 |
| 状态管理 | Zustand |
| 路由 | React Router v7 |
| 后端 | Rust（Tauri Commands） |
| 数据库 | SQLite（tauri-plugin-sql） |
| 密码加密 | bcrypt（Rust） |
| 包管理 | pnpm |

---

## 本地开发

### 环境要求

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 10
- [Rust](https://www.rust-lang.org/tools/install)（含 cargo）
- [Tauri 前置依赖](https://tauri.app/start/prerequisites/)（macOS 需要 Xcode Command Line Tools）

### 启动开发服务

```bash
# 安装依赖
pnpm install

# 启动开发模式（Vite 热更新 + Tauri 窗口）
pnpm tauri dev
```

### 构建发布包

```bash
pnpm tauri build
```

构建产物在 `src-tauri/target/release/bundle/`：
- macOS：`.dmg` + `.app`
- Windows：`.msi` + `.exe`

---

## 项目结构

```
flowtask/
├── src/                  # 前端 React 代码
│   ├── pages/            # 页面组件（注册、登录、主界面、设置）
│   ├── components/       # 通用组件
│   ├── store/            # Zustand 状态管理
│   └── lib/              # 工具函数
├── src-tauri/            # Rust 后端代码
│   ├── src/              # Tauri Commands（认证、任务、分类）
│   ├── migrations/       # SQLite 数据库迁移
│   └── tauri.conf.json   # Tauri 配置
└── logos/                # OpenLogos 方法论文档
    ├── resources/        # 需求、设计、API、测试用例等
    └── changes/          # 变更提案记录
```

---

## OpenLogos 研发过程

本项目完整使用 [OpenLogos](https://github.com/miniidealab/openlogos) 方法论研发，所有设计文档均保存在 `logos/resources/` 目录下，可作为学习参考。

### 什么是 OpenLogos？

OpenLogos 是一套 AI 辅助软件研发方法论，核心理念是 **Why → What → How** 三层推进：

1. **Why**（为什么做）— 产品需求文档，明确用户痛点和场景
2. **What**（做什么）— 产品设计、技术架构、业务场景时序图
3. **How**（怎么做）— API 设计、数据库设计、测试用例、代码实现

每一层都有对应的 AI Skill 辅助生成，确保 AI 产出有据可查、可追溯。

### 本项目的研发阶段

```
Phase 1  需求文档        logos/resources/prd/1-product-requirements/
Phase 2  产品设计        logos/resources/prd/2-product-design/
Phase 3  技术架构        logos/resources/prd/3-technical-plan/1-architecture/
         业务场景时序图   logos/resources/prd/3-technical-plan/2-scenario-implementation/
         API 设计        logos/resources/api/
         数据库设计       logos/resources/database/
         测试用例         logos/resources/test/
         代码实现         src/ + src-tauri/
```

### 如何用 OpenLogos 研发这个项目

**推荐前置条件**：安装 [Claude Code](https://claude.ai/code) 与 OpenLogos CLI（本示例的定位即 **Claude Code + 插件 / CLAUDE.md** 工作流）。  
使用 **OpenCode** 的读者可直接阅读仓库内 `AGENTS.md`，或改用官方 OpenCode 演示示例 [money-log](../money-log/README.md)。

```bash
# 1. 初始化 OpenLogos 项目
openlogos init

# 2. 查看当前阶段，获取下一步提示
openlogos next

# 3. 每次修改源代码前，先创建变更提案
openlogos change <slug>

# 4. 完成编码后，运行测试并生成验收报告
openlogos verify
```

在 Claude Code 中，直接说"下一步做什么"，AI 会自动检测当前阶段并给出可直接使用的提示词。

### 核心设计文档索引

| 文档 | 路径 |
|------|------|
| 产品需求 | `logos/resources/prd/1-product-requirements/01-requirements.md` |
| 功能规格 | `logos/resources/prd/2-product-design/1-feature-specs/01-feature-specs.md` |
| 技术架构 | `logos/resources/prd/3-technical-plan/1-architecture/01-architecture-overview.md` |
| 业务场景 | `logos/resources/prd/3-technical-plan/2-scenario-implementation/` |
| API 设计 | `logos/resources/api/` |
| 数据库设计 | `logos/resources/database/schema.sql` |
| 测试用例 | `logos/resources/test/` |

---

## 架构概览

```
┌─────────────────────────────────────────┐
│           Tauri 2 桌面应用               │
│                                         │
│  ┌─────────────────┐  ┌───────────────┐ │
│  │  React + TS      │  │  Rust 命令层  │ │
│  │  页面 / 状态管理  │◄─►  认证 / CRUD  │ │
│  └─────────────────┘  └──────┬────────┘ │
│                              │          │
│                       ┌──────▼───────┐  │
│                       │  SQLite 本地  │  │
│                       └──────────────┘  │
└─────────────────────────────────────────┘
```

业务逻辑（表单校验、状态管理、路由）放在 TypeScript 层，Rust 仅负责数据库读写和密码 bcrypt 加密，降低 Rust 代码量，对前端开发者更友好。

---

## License

MIT
