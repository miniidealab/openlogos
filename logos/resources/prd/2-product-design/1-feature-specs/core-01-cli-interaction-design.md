# CLI 交互设计

> Phase 2 产品设计 · CLI 场景交互规格
>
> 涵盖场景：S01、S08、S09、S11
>
> 最后更新：2026-04-05

---

## S01: CLI 初始化项目 — 交互规格

**命令格式**：`openlogos init [name]`

**参数设计**：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 否 | 自动探测 | 项目名称，写入 `logos.config.json` 的 `name` 字段 |

**项目名自动探测**（优先级从高到低）：

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1 | 用户显式传入的参数 | `openlogos init my-project` |
| 2 | `package.json` 的 `name` 字段 | 自动去除 scoped 前缀（`@org/name` → `name`） |
| 3 | `Cargo.toml` / `pyproject.toml` 的 `name` | 支持 Rust / Python 项目 |
| 4 | 当前目录名 | `basename(cwd)` 作为兜底 |

**项目名冲突确认**：当用户显式传入了项目名，且配置文件（`package.json` / `Cargo.toml` / `pyproject.toml`）中存在不同的项目名时，CLI 提示用户选择：

| 条件 | 行为 |
|------|------|
| 用户传入 name 且配置文件无 name（或不存在） | 直接使用用户传入的 name |
| 用户传入 name 且与配置文件一致 | 直接使用，无提示 |
| 用户传入 name 且与配置文件不一致 | 提示冲突，让用户输入 `1`（用户传入）或 `2`（配置文件），默认回车选 `1` |
| 用户未传入 name | 按原有优先级自动探测，无冲突提示 |

**全局选项**：`--help`（显示命令帮助）

**语言选择**：初始化时通过交互提示用户选择 CLI 输出语言，写入 `logos.config.json` 的 `locale` 字段。

| 条件 | 行为 |
|------|------|
| TTY 终端 | 显示语言选择提示，默认 English |
| 非 TTY（CI 环境等） | 跳过交互，默认 `"en"` |

语言选择后，所有 CLI 输出、生成的模板文件（proposal.md / tasks.md / MERGE_PROMPT.md）和配置文件（logos-project.yaml conventions / AGENTS.md conventions）均跟随 locale 切换。后续可通过编辑 `logos.config.json` 的 `locale` 字段 + `openlogos sync` 切换语言。

**AI 编码工具选择**：语言选择后，提示用户选择 AI 编码工具，决定 Skills 的部署位置。选择结果写入 `logos.config.json` 的 `aiTool` 字段，供 `openlogos sync` 读取。

| 条件 | 行为 |
|------|------|
| TTY 终端 | 显示工具选择提示，默认 Cursor |
| 非 TTY（CI 环境等） | 跳过交互，默认 `"cursor"` |

| 选项 | aiTool 值 | Skills 部署目录 | 指令文件适配 |
|------|----------|---------------|-------------|
| 1. Cursor (default) | `"cursor"` | `.cursor/rules/{skill-name}.mdc` | `AGENTS.md` 含 Active Skills |
| 2. Claude Code | `"claude-code"` | `logos/skills/{skill-name}/SKILL.md` | `CLAUDE.md` 含 Active Skills |
| 3. Other | `"other"` | `logos/skills/{skill-name}/SKILL.md` | 两者均含 Active Skills |

**交互流程**：
1. 用户在项目根目录运行 `openlogos init [name]`
2. CLI 检查 `logos/logos.config.json` 是否已存在
3. 不存在 → 语言选择（Choose language / 选择语言: 1. English 2. 中文）
4. AI 工具选择（Choose AI coding tool / 选择 AI 编码工具: 1. Cursor 2. Claude Code 3. Other）
5. 执行项目名确定流程：
   - a. 如果用户传入了 name → 同时读取配置文件中的 name → 比较两者
   - b. 如果不一致 → 输出冲突提示，等待用户选择（`1` 或 `2`，默认 `1`）
   - c. 如果用户未传入 name → 按优先级自动探测
6. 输出标题行标注项目名和来源（如 `← from package.json`）
7. 依次创建目录和文件，逐行输出创建结果
8. 根据 AI 工具类型，将 12 个 Skills 部署到对应目录
9. 生成带 Active Skills 段的 AGENTS.md / CLAUDE.md
10. 创建完成 → 输出 "Next steps" 引导（语言跟随 locale）
11. 如果项目名是自动探测的，额外输出 Tip 提示修改方式
12. 已存在 → 输出错误提示并以退出码 1 退出

**项目名修改方式**：
- 编辑 `logos/logos.config.json` 中的 `name` 字段
- 运行 `openlogos sync`，CLI 自动将 name 同步到 `logos-project.yaml` 和 AI 指令文件

**输出格式规范**：
- 标题行：`Creating OpenLogos project structure for "项目名" ← from 来源...`
- 每个创建成功的项用 `  ✓ ` 前缀（2 空格缩进 + ✓ + 空格）
- Skills 部署汇总：`✓ 12 skills deployed to {target}`
- 错误用 `Error: ` 前缀输出到 stderr
- 结尾的 Next steps 用编号列表
- 自动探测时额外输出 Tip 提示修改方式

### 验收条件（交互级）

#### 正常：显式指定项目名（无冲突）
- **GIVEN** 当前目录无 `logos/logos.config.json`，无 `package.json`
- **WHEN** 用户运行 `openlogos init my-project`
- **THEN** 标题行显示 `for "my-project"`（无来源标注），创建文件，输出 Next steps，退出码为 0

#### 正常：显式指定项目名与配置文件一致
- **GIVEN** 当前目录无 `logos/logos.config.json`，存在 `package.json`（`name: "my-project"`）
- **WHEN** 用户运行 `openlogos init my-project`
- **THEN** 两者一致，无冲突提示，标题行显示 `for "my-project"`，正常创建

#### 正常：显式指定项目名与配置文件不一致（用户选择传入名）
- **GIVEN** 当前目录无 `logos/logos.config.json`，存在 `package.json`（`name: "old-name"`）
- **WHEN** 用户运行 `openlogos init my-project`
- **THEN** CLI 提示「检测到 package.json 中的项目名为 "old-name"，与传入的 "my-project" 不一致」，用户选择 `1` 或直接回车 → 使用 "my-project" 创建

#### 正常：显式指定项目名与配置文件不一致（用户选择配置名）
- **GIVEN** 当前目录无 `logos/logos.config.json`，存在 `package.json`（`name: "old-name"`）
- **WHEN** 用户运行 `openlogos init my-project`，冲突提示后用户输入 `2`
- **THEN** 使用 "old-name" 创建，标题行显示 `for "old-name" ← from package.json`

#### 正常：自动探测（有 package.json）
- **GIVEN** 当前目录无 `logos/logos.config.json`，存在 `package.json`（`name: "my-saas-app"`）
- **WHEN** 用户运行 `openlogos init`（不带参数）
- **THEN** 标题行显示 `for "my-saas-app" ← from package.json`，创建文件，Next steps 中输出 Tip 提示修改方式

#### 正常：自动探测（无包管理文件）
- **GIVEN** 当前目录无 `logos/logos.config.json`、无 `package.json`，当前目录名为 `cool-project`
- **WHEN** 用户运行 `openlogos init`
- **THEN** 标题行显示 `for "cool-project" ← from directory name`，创建文件，Next steps 中输出 Tip 提示修改方式

#### 正常：选择中文语言
- **GIVEN** 当前目录无 `logos/logos.config.json`，终端为 TTY
- **WHEN** 用户运行 `openlogos init my-project`，语言选择时输入 `2`
- **THEN** `logos.config.json` 中 `locale` 为 `"zh"`，后续所有 CLI 输出、生成的模板和配置文件使用中文

#### 正常：默认英文语言
- **GIVEN** 当前目录无 `logos/logos.config.json`，终端为 TTY
- **WHEN** 用户运行 `openlogos init my-project`，语言选择时直接回车
- **THEN** `logos.config.json` 中 `locale` 为 `"en"`，所有输出使用英文

#### 正常：非 TTY 环境跳过语言选择
- **GIVEN** 当前目录无 `logos/logos.config.json`，标准输入为管道（非 TTY）
- **WHEN** 运行 `echo | openlogos init my-project`
- **THEN** 跳过语言选择交互，默认 `locale` 为 `"en"`

#### 正常：选择 Cursor（默认）
- **GIVEN** 当前目录无 `logos/logos.config.json`，终端为 TTY
- **WHEN** 用户运行 `openlogos init my-project`，语言选择默认英文，AI 工具选择直接回车（默认 Cursor）
- **THEN** `logos.config.json` 中 `aiTool` 为 `"cursor"`，12 个 `.mdc` 文件出现在 `.cursor/rules/`，`AGENTS.md` 包含 Active Skills 段

#### 正常：选择 Claude Code
- **GIVEN** 当前目录无 `logos/logos.config.json`，终端为 TTY
- **WHEN** 用户运行 `openlogos init my-project`，AI 工具选择时输入 `2`
- **THEN** `logos.config.json` 中 `aiTool` 为 `"claude-code"`，12 个 `SKILL.md` 文件出现在 `logos/skills/`，`CLAUDE.md` 包含 Active Skills 段

#### 正常：选择 Other
- **GIVEN** 当前目录无 `logos/logos.config.json`，终端为 TTY
- **WHEN** 用户运行 `openlogos init my-project`，AI 工具选择时输入 `3`
- **THEN** `logos.config.json` 中 `aiTool` 为 `"other"`，Skills 部署到 `logos/skills/`，两个指令文件均含 Active Skills 段

#### 正常：非 TTY 环境跳过工具选择
- **GIVEN** 标准输入为管道（非 TTY）
- **WHEN** 运行 `echo | openlogos init my-project`
- **THEN** 跳过 AI 工具选择，默认 `"cursor"`，Skills 部署到 `.cursor/rules/`

#### 异常：项目已初始化
- **GIVEN** 当前目录已存在 `logos/logos.config.json`
- **WHEN** 用户运行 `openlogos init`
- **THEN** stderr 输出 `Error: logos/logos.config.json already exists in current directory.`，不创建任何文件，退出码为 1

---

## S08: 同步 AI 指令文件 — 交互规格

**命令格式**：`openlogos sync`

**参数设计**：无参数

**同步逻辑**：
- `logos.config.json` 是项目名和 AI 工具配置的**唯一真相源**（Single Source of Truth）
- sync 时将 `logos.config.json` 的 `name` 同步到 `logos-project.yaml` 的 `project.name`
- sync 时根据 `logos.config.json` 的 `aiTool` 字段，重新部署 Skills 到对应目录
- 用户只需修改 `logos.config.json`，然后运行 sync 即可

**交互流程**：
1. 用户修改了 `logos.config.json`（如改项目名、切换 aiTool）或 `logos-project.yaml`（如更新技术栈）
2. 运行 `openlogos sync`
3. CLI 读取 `logos/logos.config.json`
4. 将 name 同步到 `logos/logos-project.yaml`（如果有变化）
5. 重新生成带 Active Skills 段的 `AGENTS.md` 和 `CLAUDE.md`
6. 根据 `aiTool` 配置，重新部署 12 个 Skills 到对应目录
7. 逐行输出更新结果

**输出格式规范**：
- 标题行：`Syncing project files...`
- 如果 name 有同步：`✓ logos-project.yaml name synced to "项目名"`
- 每个更新成功的文件用 `  ✓ ` 前缀
- 结尾输出 `Sync complete.`
- 错误统一用 `Error: ` 前缀

### 验收条件（交互级）

#### 正常：同步成功
- **GIVEN** `logos/logos.config.json` 存在
- **WHEN** 用户运行 `openlogos sync`
- **THEN** 终端输出 `Syncing AI instruction files...`，然后输出 `✓ AGENTS.md updated` 和 `✓ CLAUDE.md updated`，最后输出 `Sync complete.`，退出码为 0

#### 异常：未初始化
- **GIVEN** 当前目录无 `logos/logos.config.json`
- **WHEN** 用户运行 `openlogos sync`
- **THEN** stderr 输出 `Error: logos/logos.config.json not found.` 和 `Run 'openlogos init' first to initialize the project.`，退出码为 1

---

## S09: 变更管理 — 交互规格

S09 包含三个 CLI 命令（change / merge / archive）和两个 AI Skill（change-writer / merge-executor），构成完整的变更生命周期。

### S09-1: openlogos change — 创建变更提案

**命令格式**：`openlogos change <slug>`

**参数设计**：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| slug | string | 是 | — | 变更提案的唯一标识，kebab-case 格式（如 `add-remember-me`） |

**交互流程**：
1. 开发者发现需要迭代某个场景或新增功能
2. 运行 `openlogos change add-remember-me`
3. CLI 检查 `logos/.openlogos-guard` 是否存在，以及是否已有活动提案
4. 若已有活动提案 → 输出错误提示，要求先完成并归档当前提案
5. 若无活动提案 → 再检查 `logos/changes/add-remember-me/` 是否已存在
6. 不存在 → 创建提案目录和模板文件
7. 已存在 → 输出错误提示

**创建的文件结构**：
```
logos/changes/add-remember-me/
├── proposal.md       # 变更提案（目标、影响范围、关联场景）
├── tasks.md          # 任务拆解清单
└── deltas/           # 增量变更文件目录
    ├── prd/
    ├── api/
    ├── database/
    └── scenario/
```

**输出格式规范**：
- 标题行：`Creating change proposal: add-remember-me`
- 每个创建成功的项用 `  ✓ ` 前缀
- 结尾输出 Next steps 引导（提示让 AI 填写提案）

#### 验收条件（交互级）

##### 正常：创建变更提案
- **GIVEN** 项目已初始化，`logos/changes/add-remember-me/` 不存在
- **WHEN** 用户运行 `openlogos change add-remember-me`
- **THEN** 终端输出 `Creating change proposal: add-remember-me`，然后输出 3 个 `✓` 条目（proposal.md、tasks.md、deltas/），最后输出 Next steps 引导对 AI 说"帮我填写变更提案"，退出码为 0

##### 异常：缺少 slug 参数
- **GIVEN** 项目已初始化
- **WHEN** 用户运行 `openlogos change`（不带 slug）
- **THEN** stderr 输出 `Error: Missing change proposal name.`，并显示用法示例 `Usage: openlogos change <slug>`，退出码为 1

##### 异常：同名提案已存在
- **GIVEN** `logos/changes/add-remember-me/` 已存在
- **WHEN** 用户运行 `openlogos change add-remember-me`
- **THEN** stderr 输出 `Error: Change proposal 'add-remember-me' already exists.`，不覆盖任何文件，退出码为 1

##### 异常：已有活动 guard
- **GIVEN** `logos/.openlogos-guard` 存在，且其中 `activeChange=active-feature`，同时 `logos/changes/active-feature/` 仍存在
- **WHEN** 用户运行 `openlogos change add-remember-me`
- **THEN** stderr 输出当前活动提案冲突提示，要求先归档 `active-feature`，退出码为 1
- **AND** 不创建 `logos/changes/add-remember-me/`
- **AND** 不覆盖现有 `logos/.openlogos-guard`

##### 异常：未初始化
- **GIVEN** 当前目录无 `logos/logos.config.json`
- **WHEN** 用户运行 `openlogos change add-remember-me`
- **THEN** stderr 输出 `Error: logos/logos.config.json not found.` + 初始化引导，退出码为 1

### S09-2: openlogos merge — 生成合并指令

**命令格式**：`openlogos merge <slug>`

**参数设计**：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| slug | string | 是 | — | 变更提案标识 |

**核心设计**：merge 命令不执行实际的文档合并，而是生成 `MERGE_PROMPT.md` 指令文件，由 AI 读取后执行合并。这是"CLI 生成指令 → AI 执行"的桥接模式。

**交互流程**：
1. 用户完成所有 delta 文件的编写
2. 运行 `openlogos merge add-remember-me`
3. CLI 检查提案目录和 delta 文件
4. 扫描 `deltas/` 子目录，建立 delta 文件到主文档的映射
5. 读取 `proposal.md` 提取变更元信息
6. 生成 `MERGE_PROMPT.md`
7. 终端输出合并摘要 + AI 提示词

**输出格式规范**：
- 标题行带 📋 图标：`Merge Summary:`
- 列出提案名和 delta 文件数量
- 逐行列出每个 delta 文件及其目标目录
- `✓` 标注 MERGE_PROMPT.md 已生成
- 结尾输出可直接复制的 AI 提示词

#### 验收条件（交互级）

##### 正常：生成合并指令
- **GIVEN** `logos/changes/add-remember-me/deltas/` 下有 delta 文件
- **WHEN** 用户运行 `openlogos merge add-remember-me`
- **THEN** 生成 `logos/changes/add-remember-me/MERGE_PROMPT.md`，终端输出摘要和提示词，退出码为 0

##### 异常：无 delta 文件
- **GIVEN** `logos/changes/add-remember-me/deltas/` 为空（仅有空子目录）
- **WHEN** 用户运行 `openlogos merge add-remember-me`
- **THEN** stderr 输出 `Error: No delta files found`，不生成 MERGE_PROMPT.md，退出码为 1

##### 异常：缺少 slug 参数
- **GIVEN** 项目已初始化
- **WHEN** 用户运行 `openlogos merge`（不带 slug）
- **THEN** stderr 输出 `Error: Missing change proposal name.`，退出码为 1

##### 异常：提案不存在
- **GIVEN** `logos/changes/add-remember-me/` 不存在
- **WHEN** 用户运行 `openlogos merge add-remember-me`
- **THEN** stderr 输出 `Error: Change proposal 'add-remember-me' not found.`，退出码为 1

### S09-3: openlogos archive — 归档变更提案

**命令格式**：`openlogos archive <slug>`

**参数设计**：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| slug | string | 是 | — | 变更提案标识 |

**交互流程**：
1. AI 完成合并后，用户确认修改无误
2. 运行 `openlogos archive add-remember-me`
3. CLI 检查提案目录存在
4. 确保 `logos/changes/archive/` 目录存在
5. 将提案目录移动到归档目录
6. 输出归档确认

**输出格式规范**：
- `✓` 标注归档成功
- 显示原路径和目标路径

#### 验收条件（交互级）

##### 正常：归档成功
- **GIVEN** `logos/changes/add-remember-me/` 存在
- **WHEN** 用户运行 `openlogos archive add-remember-me`
- **THEN** 将目录移动到 `logos/changes/archive/add-remember-me/`，终端输出归档确认，退出码为 0

##### 异常：提案不存在
- **GIVEN** `logos/changes/add-remember-me/` 不存在
- **WHEN** 用户运行 `openlogos archive add-remember-me`
- **THEN** stderr 输出 `Error: Change proposal 'add-remember-me' not found.`，退出码为 1

##### 异常：归档目标已存在
- **GIVEN** `logos/changes/archive/add-remember-me/` 已存在
- **WHEN** 用户运行 `openlogos archive add-remember-me`
- **THEN** stderr 输出 `Error: Archive 'add-remember-me' already exists`，退出码为 1

##### 异常：缺少 slug 参数
- **GIVEN** 项目已初始化
- **WHEN** 用户运行 `openlogos archive`（不带 slug）
- **THEN** stderr 输出 `Error: Missing change proposal name.`，退出码为 1

---

## S11: 查看项目进度 — 交互规格

**命令格式**：`openlogos status`

**参数设计**：无参数

**交互流程**：
1. 开发者想了解当前处于哪个阶段
2. 运行 `openlogos status`
3. CLI 扫描 `logos/resources/` 各子目录
4. 输出各阶段完成状态（✅ / 🔲）
5. 在末尾给出下一步建议和推荐提示词

**输出格式规范**：
- 标题行：`📊 OpenLogos Project Status`
- 分隔线：`─` 字符重复 50 次
- 每个阶段：`✅` / `🔲` + 阶段名称
- 已完成阶段下方缩进列出具体文件：`     └─ filename`
- 分隔线后输出建议：`💡 建议下一步：` + 阶段名 + 推荐提示词

### 验收条件（交互级）

#### 正常：有部分进度
- **GIVEN** Phase 1 需求文档已完成，其余阶段为空
- **WHEN** 用户运行 `openlogos status`
- **THEN** 终端输出 Phase 1 为 ✅（列出文件名），其余阶段为 🔲，建议 `对 AI 说：「基于需求文档做产品设计」`，退出码为 0

#### 正常：空项目
- **GIVEN** 刚执行 `openlogos init`，所有 `logos/resources/` 子目录为空
- **WHEN** 用户运行 `openlogos status`
- **THEN** 所有阶段为 🔲，建议 `对 AI 说：「帮我写需求文档」`

#### 正常：全部完成
- **GIVEN** 所有阶段的目录均有内容
- **WHEN** 用户运行 `openlogos status`
- **THEN** 所有阶段为 ✅，输出 `🎉 所有阶段已完成！` + 代码生成提示词

#### 异常：未初始化
- **GIVEN** 当前目录无 `logos/logos.config.json`
- **WHEN** 用户运行 `openlogos status`
- **THEN** stderr 输出错误 + 初始化引导，退出码为 1

---

## 全局交互规范

### 帮助信息

运行 `openlogos` 或 `openlogos --help` 输出全局帮助：

```
openlogos - CLI tool for the OpenLogos methodology

Usage:
  openlogos <command> [options]

Commands:
  init [name]        Initialize a new OpenLogos project structure
  sync               Regenerate AI instruction files (AGENTS.md, CLAUDE.md)
  status             Show current project phase and suggest next steps
  change <slug>      Create a change proposal for iterative updates
  merge <slug>       Generate MERGE_PROMPT.md for AI to execute delta merging
  archive <slug>     Archive a completed change proposal

Options:
  --help, -h         Show this help message
  --version, -v      Show version number

Examples:
  openlogos init my-saas-project
  openlogos sync
  openlogos status
  openlogos change add-remember-me
  openlogos merge add-remember-me
  openlogos archive add-remember-me

Learn more: https://openlogos.ai
```

### 错误处理统一规范

| 场景 | 错误消息 | 退出码 |
|------|---------|--------|
| 未知命令 | `Unknown command: xxx` + 帮助信息 | 1 |
| 项目未初始化 | `Error: logos/logos.config.json not found.` + `Run 'openlogos init' first` | 1 |
| 项目已初始化（init） | `Error: logos/logos.config.json already exists in current directory.` | 1 |
| 缺少必填参数（change/merge/archive） | `Error: Missing change proposal name.` + 用法示例 | 1 |
| 同名资源冲突 | `Error: ... already exists.` | 1 |
| 提案不存在（merge/archive） | `Error: Change proposal '...' not found.` | 1 |
| 无 delta 文件（merge） | `Error: No delta files found in ...` | 1 |
| 归档目标已存在（archive） | `Error: Archive '...' already exists in logos/changes/archive/.` | 1 |
