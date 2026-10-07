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

## S40: 版本管理范围配置 — 交互规格

S40 包含两个 CLI 命令（`openlogos ignore`、`openlogos exempt`），维护 `logos/logos.config.json` 的 `guard.unversioned` 与 `guard.exempt`，以及 `.gitignore` 托管区块。行为规则以功能规格「2.88 版本管理范围配置：两张清单、托管区块与人类确认」为准，本节规定命令形态、输出文案、退出码与 JSON 结构。

**通用约定**：

- 必须在项目根（`logos/logos.config.json` 所在目录）运行。
- 输出语言跟随 `logos.config.json` 的 `locale`（`en` / `zh`），下文每条文案给出两种语言；`Error: ` 前缀在两种语言下都保留，输出到 stderr。
- 成功项用 `  ✓ ` 前缀，未改动项用 `  · ` 前缀，警告用 `⚠ `，提示用 `ℹ `。
- 参数校验在写盘前对整批参数完成：任一参数非法，整批不写。
- CLI 本身不做审批：用户在终端自行执行（含 Claude Code 中的 `! <命令>`）时直接生效；AI 发起时由 guard 交宿主审批，见 S40-3。

### S40-1: openlogos ignore — 维护不入库清单

**命令格式**：

```
openlogos ignore add <pattern...>
openlogos ignore remove <pattern...>
openlogos ignore list [--format json]
```

**参数设计**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| pattern | string（可多个） | add / remove 必填 | 单行 gitignore 模式；不能为空串、不能含换行、不能以 `#` 或 `!` 开头、不能含 `..` 段 |
| `--format json` | flag | 否 | 仅 `list` 支持，输出 JSON envelope |

**交互流程（add / remove）**：

1. 读取并解析 `logos/logos.config.json`，校验现有 `guard.unversioned` 条目。
2. 校验全部参数；任一非法 → 逐个点名后退出 1。
3. 读取 `.gitignore`，检查托管区块标记；损坏 → 退出 1。
4. 计算新清单（add 去重追加；remove 删除命中项）；无变化 → 输出「无变化」后退出 0。
5. 先写 `logos.config.json`，再渲染并写入托管区块；区块写入失败时把配置回滚为原字节，退出 1。
6. `add` 成功后，在 git 仓库内用 `git ls-files -z -ci --exclude=<pattern>` 列出每个新增模式命中的已跟踪文件，按实际文件生成移出命令并输出提示（不代为执行任何 git 命令）；超过 20 个文件时把 NUL 分隔的清单写入 `logos/.openlogos-runtime/untrack-<时间戳>.lst`。

**输出文案**：

| 情形 | en | zh |
|------|----|----|
| 标题行 | `Updating ignore list...` | `更新忽略清单...` |
| 新增条目 | `  ✓ Added: dist/` | `  ✓ 已添加：dist/` |
| 删除条目 | `  ✓ Removed: dist/` | `  ✓ 已移除：dist/` |
| add 已存在 | `  · Already present: dist/` | `  · 已存在：dist/` |
| remove 不存在 | `  · Not found: dist/` | `  · 不存在：dist/` |
| add 固定运行时条目 | `  · logos/.openlogos-runtime/ is always ignored by the managed block` | `  · logos/.openlogos-runtime/ 已固定在托管区块中` |
| 配置已写 | `  ✓ logos/logos.config.json updated` | `  ✓ 已更新 logos/logos.config.json` |
| 区块已写 | `  ✓ .gitignore managed block updated` | `  ✓ 已更新 .gitignore 托管区块` |
| 新建 `.gitignore` | `  ✓ .gitignore created with openlogos managed block` | `  ✓ 已新建 .gitignore（含 openlogos 托管区块）` |
| 整体无变化 | `No changes; no files were written.` | `无变化，未写入任何文件。` |
| 非 git 仓库 | `ℹ Not inside a git repository; guard's version-control criterion is not in effect.` | `ℹ 当前目录不在 git 仓库中，guard 新判据不生效。` |

**已跟踪文件提示**（`add` 成功后，某个新增模式命中已跟踪文件时；示例至多 5 个，超过时追加省略行；移出命令按实际匹配文件生成，路径按 POSIX 单引号转义，`'` 写作 `'\''`）：

≤ 20 个文件，en：

```
⚠ 3 tracked file(s) match "*.pyc". They stay in version control and remain protected by guard:
    a/x.pyc
    b c/y.pyc
    lit*.pyc
  To stop tracking them, run this yourself (openlogos does not run it):
    git --literal-pathspecs rm --cached -- 'a/x.pyc' 'b c/y.pyc' 'lit*.pyc'
```

≤ 20 个文件，zh：

```
⚠ 有 3 个已跟踪文件命中 "*.pyc"，它们仍在版本控制中，继续受 guard 保护：
    a/x.pyc
    b c/y.pyc
    lit*.pyc
  如需移出版本控制，请自行执行（openlogos 不会代为执行）：
    git --literal-pathspecs rm --cached -- 'a/x.pyc' 'b c/y.pyc' 'lit*.pyc'
```

> 20 个文件，en：

```
⚠ 37 tracked file(s) match "/build/". They stay in version control and remain protected by guard:
    build/a.js
    build/b.js
    build/c.js
    build/d.js
    build/e.js
    ... and 32 more
  The full list was written to logos/.openlogos-runtime/untrack-20261007T080000Z.lst.
  To stop tracking them, run this yourself (openlogos does not run it):
    git --literal-pathspecs rm --cached --pathspec-file-nul --pathspec-from-file=logos/.openlogos-runtime/untrack-20261007T080000Z.lst
```

> 20 个文件，zh：

```
⚠ 有 37 个已跟踪文件命中 "/build/"，它们仍在版本控制中，继续受 guard 保护：
    build/a.js
    build/b.js
    build/c.js
    build/d.js
    build/e.js
    …… 另有 32 个
  完整清单已写入 logos/.openlogos-runtime/untrack-20261007T080000Z.lst。
  如需移出版本控制，请自行执行（openlogos 不会代为执行）：
    git --literal-pathspecs rm --cached --pathspec-file-nul --pathspec-from-file=logos/.openlogos-runtime/untrack-20261007T080000Z.lst
```

统计失败时：en `⚠ Could not check tracked files for "dist/": <git 错误摘要>`；zh `⚠ 无法统计 "dist/" 命中的已跟踪文件：<git 错误摘要>`。退出码仍为 0。

**输出文案（list，文本）**：

en：

```
Ignored by openlogos (guard.unversioned):
  node_modules/
  dist/
```

zh：

```
openlogos 忽略清单（guard.unversioned）：
  node_modules/
  dist/
```

清单为空时输出一行 `  (none)` / `  （无）`。固定运行时条目 `logos/.openlogos-runtime/` 不列出。

**输出（list --format json）**：stdout 输出 JSON envelope，`command` 为 `ignore list`：

```json
{
  "command": "ignore list",
  "version": "0.15.18",
  "timestamp": "2026-10-07T08:00:00.000Z",
  "data": {
    "entries": [
      { "value": "node_modules/", "source": "config" },
      { "value": "dist/", "source": "config" }
    ]
  }
}
```

`ignore` 的条目 `source` 恒为 `config`。失败时 stderr 输出错误 envelope（`error.code` 见 S40-4），stdout 无输出。

**退出码**：成功（含「已存在」「不存在」「无变化」）为 0；参数非法、缺少参数、未知动作、配置缺失或不可解析、配置中已有非法条目、托管区块损坏、写入失败为 1，且零写入。

#### 验收条件（交互级）

##### 正常：添加新条目
- **GIVEN** 项目已初始化，`.gitignore` 有用户内容、无托管区块，`guard.unversioned` 缺省
- **WHEN** 用户运行 `openlogos ignore add dist/`
- **THEN** 输出 `✓ Added: dist/`、配置与区块更新两行，`.gitignore` 原有内容逐字节不变，末尾追加空行与托管区块（含 `logos/.openlogos-runtime/` 与 `dist/`），退出码 0

##### 正常：重复添加
- **GIVEN** `guard.unversioned` 已含 `dist/`
- **WHEN** 用户运行 `openlogos ignore add dist/`
- **THEN** 输出 `· Already present: dist/` 与 `No changes; no files were written.`，两个文件 mtime 不变，退出码 0

##### 正常：已跟踪文件提示
- **GIVEN** git 仓库中 `dist/app.dmg` 已被跟踪
- **WHEN** 用户运行 `openlogos ignore add dist/`
- **THEN** 写入成功并输出已跟踪文件提示，含数量、示例与 `git --literal-pathspecs rm --cached -- 'dist/app.dmg'`；`git ls-files dist/` 结果不变，退出码 0
- **AND** 在该仓库实际执行提示命令后，恰好 `dist/app.dmg` 被移出索引，其他文件不变

##### 正常：列出清单（JSON）
- **GIVEN** `guard.unversioned` 为 `["node_modules/", "dist/"]`
- **WHEN** 用户运行 `openlogos ignore list --format json`
- **THEN** stdout 为 envelope，`data.entries` 按配置顺序两项、`source` 均为 `config`，退出码 0

##### 异常：非法模式
- **WHEN** 用户运行 `openlogos ignore add build/ "!dist/"`
- **THEN** stderr 输出 `Error: Invalid ignore pattern "!dist/": must not start with '#' or '!'.`，`build/` 也不写入，退出码 1

##### 异常：移除固定运行时条目
- **WHEN** 用户运行 `openlogos ignore remove logos/.openlogos-runtime/`
- **THEN** stderr 输出 `Error: logos/.openlogos-runtime/ is a fixed entry of the managed block and cannot be removed.`，零写入，退出码 1

##### 异常：托管区块损坏
- **GIVEN** `.gitignore` 含两个 `# >>> openlogos managed >>>`
- **WHEN** 用户运行 `openlogos ignore add dist/`
- **THEN** stderr 输出托管区块损坏错误，`logos.config.json` 与 `.gitignore` 均不变，退出码 1

### S40-2: openlogos exempt — 维护入库但免立案清单

**命令格式**：

```
openlogos exempt add <path...>
openlogos exempt remove <path...>
openlogos exempt list [--format json]
```

**参数设计**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| path | string（可多个） | add / remove 必填 | 项目根相对路径，`/` 分隔；以 `/` 结尾表示目录及其后代，否则为单个文件；`*` 只匹配一个路径段 |
| `--format json` | flag | 否 | 仅 `list` 支持 |

**路径校验**（任一不满足即非法）：非绝对路径；不含 `..`、`.` 或空段；不含 `\`；非空串、非 `/`、非单独 `*`；`*` 所在段被匹配的值须满足 `^[A-Za-z0-9][A-Za-z0-9._-]*$`；不以 `logos/.openlogos-runtime/` 开头；不指向忽略规则来源（任意层级 `.gitignore`、`.git/info/exclude`）或 `logos/logos.config.json`；不位于 `.git/` 下。

**交互流程（add / remove）**：

1. 读取并解析 `logos/logos.config.json`，校验现有 `guard.exempt` 条目。
2. 校验全部参数；任一非法 → 逐个点名后退出 1。
3. `guard.exempt` 缺省时，先把内置默认（`logos/resources/reference/`、`logos/resources/verify/baseline-seed-runs/*/staging/`）物化为显式数组。
4. add 去重追加 / remove 删除命中项；删光时写显式 `[]`。
5. 无变化（且无需物化）→ 输出「无变化」后退出 0；否则写 `logos.config.json`。

**输出文案**：

| 情形 | en | zh |
|------|----|----|
| 标题行 | `Updating exempt list...` | `更新免立案清单...` |
| 物化默认 | `  · Built-in defaults written to guard.exempt so they can be edited` | `  · 已将内置默认项写入 guard.exempt，便于修改` |
| 新增 | `  ✓ Added: docs/notes/` | `  ✓ 已添加：docs/notes/` |
| 删除 | `  ✓ Removed: logos/resources/reference/` | `  ✓ 已移除：logos/resources/reference/` |
| add 已存在 | `  · Already present: docs/notes/` | `  · 已存在：docs/notes/` |
| remove 不存在 | `  · Not found: docs/notes/` | `  · 不存在：docs/notes/` |
| 删光 | `  ℹ guard.exempt is now empty; built-in defaults no longer apply` | `  ℹ guard.exempt 已清空，内置默认项不再生效` |
| 配置已写 | `  ✓ logos/logos.config.json updated` | `  ✓ 已更新 logos/logos.config.json` |
| 整体无变化 | `No changes; no files were written.` | `无变化，未写入任何文件。` |
| 生效说明（add 成功后） | `ℹ Writes under these paths no longer require a change proposal; they are still committed to git.` | `ℹ 这些路径下的写入不再需要立案，仍会正常入库。` |

**输出（list，文本）**：

en：

```
Exempt from change proposals (guard.exempt):
  logos/resources/reference/                                 (default)
  logos/resources/verify/baseline-seed-runs/*/staging/      (default)
```

zh：

```
免立案清单（guard.exempt）：
  logos/resources/reference/                                 （内置默认）
  logos/resources/verify/baseline-seed-runs/*/staging/      （内置默认）
```

显式写出后不再带「默认」标注；清单为显式 `[]` 时输出 `  (none)` / `  （无）`。

**输出（list --format json）**：`command` 为 `exempt list`，`data.entries[].source` 在 `guard.exempt` 缺省时为 `default`，显式写出后为 `config`：

```json
{
  "command": "exempt list",
  "version": "0.15.18",
  "timestamp": "2026-10-07T08:00:00.000Z",
  "data": {
    "entries": [
      { "value": "logos/resources/reference/", "source": "default" },
      { "value": "logos/resources/verify/baseline-seed-runs/*/staging/", "source": "default" }
    ]
  }
}
```

**退出码**：同 S40-1。

#### 验收条件（交互级）

##### 正常：缺省时添加
- **GIVEN** `guard.exempt` 缺省
- **WHEN** 用户运行 `openlogos exempt add docs/notes/`
- **THEN** `guard.exempt` 变为内置默认两项 + `docs/notes/`，输出物化与新增两行，退出码 0

##### 正常：删除内置默认项
- **GIVEN** `guard.exempt` 缺省
- **WHEN** 用户运行 `openlogos exempt remove logos/resources/reference/`
- **THEN** `guard.exempt` 只剩 staging 一项，`exempt list --format json` 中该项 `source` 为 `config`，退出码 0

##### 正常：删光
- **GIVEN** `guard.exempt` 为 `["docs/notes/"]`
- **WHEN** 用户运行 `openlogos exempt remove docs/notes/`
- **THEN** `guard.exempt` 为 `[]`，输出「已清空，内置默认项不再生效」，退出码 0

##### 异常：豁免忽略规则来源
- **WHEN** 用户运行 `openlogos exempt add .gitignore`
- **THEN** stderr 输出 `Error: Invalid exempt path ".gitignore": ignore-rule sources, logos/logos.config.json and paths under .git/ cannot be exempted.`，零写入，退出码 1

##### 异常：路径越界
- **WHEN** 用户运行 `openlogos exempt add ../shared/`
- **THEN** stderr 输出 `Error: Invalid exempt path "../shared/": must be a project-relative path without '..', '.' or empty segments.`，零写入，退出码 1

### S40-3: AI 发起保护范围变更的宿主审批交互

**受限命令**：`openlogos exempt add|remove`、`openlogos ignore add|remove`（`list` 不受限），在任何提案状态下都受限。AI 发起时由宿主对这一次实际工具调用弹出原生审批，用户批准后由 AI 执行，不要求用户自己去终端执行；guard 不采信 AI 在对话中转述的同意，也不读取任何本地授权文件。

**命令形态**：一条 Bash 调用只能包含一条受限命令，只允许 `cd <目录> &&` 前缀；与其他命令组成的复合形态一律阻断。

**AI 的做法**：

1. 直接发起受限命令（如 `openlogos exempt add docs/notes/`），不需要先在对话中询问；宿主的审批界面就是确认环节。
2. 宿主弹出审批时，用户批准则命令执行，按 S40-1 / S40-2 输出；用户拒绝则命令不执行，AI 不得改用 Edit / Bash 直接修改 `logos.config.json` 或 `.gitignore`（这些写入同样受保护）。
3. 被 guard 以「当前权限模式下宿主不会弹出确认」阻断时，把阻断信息中的命令原文告诉用户，请用户在终端用 `! <命令原文>` 自行执行，或切换到默认权限模式后重试。

**Claude Code PreToolUse 输出**（按 hook 输入的 `permission_mode`）：

`default` / `acceptEdits`：stdout 输出以下 JSON，exit 0，由宿主弹出审批：

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "ask",
    "permissionDecisionReason": "该命令会改变 guard 的保护范围（openlogos exempt add docs/notes/），需要您确认后执行"
  }
}
```

`bypassPermissions`、`dontAsk`、`auto`、`plan`、字段缺失或未知值、非交互运行：exit 2，stderr 为可读文本，stdout 为 `{"reason":"..."}`（与既有 guard 文案一致只用中文）：

```
⛔ 保护范围变更需要用户在宿主界面批准：该命令会修改 guard 的保护范围（exempt / ignore 清单与 .gitignore 托管区块）。

命令：openlogos exempt add docs/notes/

当前权限模式（bypassPermissions）下宿主不会弹出确认，无法证明由用户批准。请让用户在终端用 `! openlogos exempt add docs/notes/` 自行执行，或切换到默认权限模式后重试；不要用对话中的口头同意替代。
```

`permission_mode` 字段缺失时，括号内写 `未知`。

复合形态（任何权限模式）：exit 2：

```
⛔ 保护范围变更命令必须单独执行：一次调用只能包含一条 openlogos exempt / ignore 的 add / remove，只允许 `cd <目录> &&` 前缀，不能与其他命令组合。

命令：cd /repo && openlogos exempt add docs/notes/ && npm test

请拆成单独的调用后重试。
```

**Cursor**：`beforeShellExecution` 对受限命令返回：

```json
{
  "permission": "ask",
  "user_message": "OpenLogos：该命令会修改 guard 保护范围，需要你确认后才能执行：openlogos exempt add docs/notes/",
  "agent_message": "该命令会修改 guard 保护范围，已请求用户审批；若被拒绝，不要改用其他方式修改 exempt / ignore 清单、.gitignore 或 logos.config.json。"
}
```

实测不能保证宿主弹出审批时（含自动运行模式）改为 `"permission": "deny"`，`agent_message` 为「该命令会修改 guard 保护范围，当前宿主无法保证弹出审批，已阻断；请让用户在终端自行执行」。

**无人值守（`--auto`）**：通常运行在 `bypassPermissions` / `auto` / 非交互模式下，受限命令被阻断，不另设机制。

#### 验收条件（交互级）

##### 正常：默认模式交宿主审批
- **GIVEN** launched、无提案，hook 输入 `permission_mode` 为 `default`
- **WHEN** AI 执行 `openlogos exempt add docs/notes/`
- **THEN** guard stdout 输出 `permissionDecision: "ask"` 且 reason 含命令原文，exit 0；用户批准后命令执行并按 S40-2 输出

##### 正常：acceptEdits 模式同样交审批
- **GIVEN** `permission_mode` 为 `acceptEdits`
- **WHEN** AI 执行 `openlogos ignore add dist/`
- **THEN** guard 返回 `ask`，exit 0

##### 异常：不弹审批的模式
- **GIVEN** `permission_mode` 为 `bypassPermissions`、`dontAsk`、`auto`、`plan` 之一，或字段缺失
- **WHEN** AI 执行 `openlogos ignore add src/`
- **THEN** guard exit 2，stderr 含当前模式与 `! openlogos ignore add src/` 提示，`logos.config.json` 与 `.gitignore` 不变

##### 异常：复合形态
- **GIVEN** `permission_mode` 为 `default`
- **WHEN** AI 执行 `openlogos exempt add a/ && npm test`
- **THEN** guard exit 2，stderr 为「保护范围变更命令必须单独执行」文案

##### 异常：伪造授权无效
- **GIVEN** `permission_mode` 为 `bypassPermissions`，项目中被写入任意自称「授权」的文件
- **WHEN** AI 执行 `openlogos exempt add src/`
- **THEN** guard 仍 exit 2

### S40-4: 帮助信息与错误码增补

全局帮助（`openlogos --help`）的 Commands 段增加：

```
  ignore <add|remove|list> [pattern...]   Manage paths kept out of version control (.gitignore managed block)
  exempt <add|remove|list> [path...]      Manage committed paths that do not require a change proposal
```

Examples 段增加：

```
  openlogos ignore add dist/
  openlogos exempt list --format json
```

错误文案与 JSON 错误码（`list --format json` 失败时用于错误 envelope；文本模式只输出文案）：

| 场景 | en 文案 | zh 文案 | 错误码 | 退出码 |
|------|---------|---------|--------|--------|
| 未初始化 | `Error: logos/logos.config.json not found.` + `Run 'openlogos init' first to initialize the project.` | 同 en（沿用既有全局文案） | `PROJECT_NOT_INITIALIZED` | 1 |
| 配置不可解析 | `Error: logos/logos.config.json is not valid JSON: <detail>` | `Error: logos/logos.config.json 不是合法 JSON：<detail>` | `CONFIG_INVALID` | 1 |
| 配置中已有非法条目 | `Error: guard.exempt contains an invalid entry "<value>": <reason>. Fix it manually; no files were changed.` | `Error: guard.exempt 中有非法条目 "<value>"：<reason>。请手工修正，未改动任何文件。` | `GUARD_ENTRY_INVALID` | 1 |
| 缺少参数 | `Error: Missing pattern.` + `Usage: openlogos ignore add <pattern...>` | `Error: 缺少参数。` + `Usage: openlogos ignore add <pattern...>` | — | 1 |
| 未知动作 | `Error: Unknown action 'xxx'.` + `Usage: openlogos ignore <add\|remove\|list>` | `Error: 未知动作 'xxx'。` + 同一用法行 | — | 1 |
| 非法 ignore 模式 | `Error: Invalid ignore pattern "<value>": <reason>.` | `Error: 忽略模式 "<value>" 非法：<reason>。` | — | 1 |
| 非法 exempt 路径 | `Error: Invalid exempt path "<value>": <reason>.` | `Error: 免立案路径 "<value>" 非法：<reason>。` | — | 1 |
| 移除固定运行时条目 | `Error: logos/.openlogos-runtime/ is a fixed entry of the managed block and cannot be removed.` | `Error: logos/.openlogos-runtime/ 是托管区块的固定条目，不能移除。` | — | 1 |
| 托管区块损坏 | `Error: The openlogos managed block in .gitignore is corrupted (<detail>). Fix it manually; no files were changed.` | `Error: .gitignore 中的 openlogos 托管区块已损坏（<detail>），请手工修复，未改动任何文件。` | `MANAGED_BLOCK_CORRUPT` | 1 |
| 写入失败 | `Error: Failed to write <path>: <detail>. Changes were rolled back.` | `Error: 写入 <path> 失败：<detail>，已回滚。` | — | 1 |

`<detail>` 示例：`found 2 start markers` / `发现 2 个起始标记`、`start marker without end marker` / `只有起始标记没有结束标记`。

## S01 / S20: 技术栈建议忽略 — 交互规格

`openlogos init` 与 `openlogos adopt` 在首次写入任何文件之前检查 `.gitignore` 托管区块；在创建 / 接入项目结构后、输出 Next steps 之前，处理托管区块与建议忽略。`openlogos sync` 遇托管区块损坏的输出也在本节规定。规则以功能规格「2.88.7 init / adopt 技术栈建议忽略（C04）」「2.88.8 sync 重渲染」为准。

**交互流程**：

0. 首次写入前检查 `.gitignore` 托管区块；损坏 → stderr 点名报错，退出 1，不创建任何文件。
1. 写入托管区块的固定运行时条目 `logos/.openlogos-runtime/`（不询问），输出告知行。
2. 识别技术栈（Node：`package.json`；Python：`pyproject.toml` / `requirements.txt` / `setup.py`；Rust：`Cargo.toml`），合并去重得到建议条目。
3. 过滤已被忽略的条目；结果为空 → 不提示，流程结束。
4. 交互环境（`stdin` 为 TTY）→ 列出整份建议清单，一次性确认 `[Y/n]`，直接回车为接受；接受 → 整份写入 `guard.unversioned` 与托管区块；拒绝 → 一条都不写，输出后续可用的命令。即使通过 `--locale` / `--ai-tool` 跳过了其他问题，此问仍然出现。
5. 非交互环境（无 TTY）→ 不写入建议条目，只输出可复制的 `openlogos ignore add <条目...>` 命令。

**语言**：提示语言跟随本次确定的 locale——`init` 为语言选择结果或 `--locale` 参数，`adopt` 为其语言选择结果（非交互默认 `zh`）。

**输出文案**：

| 情形 | en | zh |
|------|----|----|
| 固定条目已写入 | `  ✓ .gitignore managed block: logos/.openlogos-runtime/ (OpenLogos runtime files)` | `  ✓ 已在 .gitignore 托管区块写入 logos/.openlogos-runtime/（OpenLogos 运行时文件）` |
| 固定条目已存在 | 无输出 | 无输出 |
| 建议标题 | `Detected Node, Rust project. These paths are not ignored by git yet:` | `检测到 Node、Rust 项目，以下路径尚未被 git 忽略：` |
| 建议条目 | `  node_modules/`（每行一条） | 同左 |
| 询问 | `Add them to .gitignore (openlogos managed block)? [Y/n]: ` | `是否加入 .gitignore（openlogos 托管区块）？[Y/n]：` |
| 接受 | `  ✓ .gitignore managed block: added node_modules/, dist/, target/` | `  ✓ 已加入 .gitignore 托管区块：node_modules/、dist/、target/` |
| 拒绝 | `  · Skipped. You can add them later: openlogos ignore add node_modules/ dist/ target/` | `  · 已跳过。之后可运行：openlogos ignore add node_modules/ dist/ target/` |
| 非交互 | `ℹ Suggested ignore entries were not written (non-interactive). To add them: openlogos ignore add node_modules/ dist/ target/` | `ℹ 非交互环境，未写入建议忽略条目。如需加入：openlogos ignore add node_modules/ dist/ target/` |
| init / adopt 区块损坏（首写前，stderr） | `Error: The openlogos managed block in .gitignore is corrupted (<detail>). Fix it manually and rerun; no files were created.` | `Error: .gitignore 中的 openlogos 托管区块已损坏（<detail>），请手工修复后重试，未创建任何文件。` |
| sync 区块损坏（stderr） | `Error: The openlogos managed block in .gitignore is corrupted (<detail>); .gitignore was not changed.` | `Error: .gitignore 中的 openlogos 托管区块已损坏（<detail>），未改动 .gitignore。` |
| sync 部分完成（结尾行，退出 1） | `Sync partially completed: .gitignore managed block was not updated.` | `sync 部分完成：.gitignore 托管区块未更新。` |

询问的回答：回车、`y`、`Y`、`yes` 视为接受；其他任何输入视为拒绝。

非交互环境下输出的 `openlogos ignore add …` 命令若由 AI 执行，属于保护范围变更，按 S40-3 交宿主审批（不弹审批的权限模式下由用户用 `! <命令>` 自行执行）。

### 验收条件（交互级）

#### 正常：Node 项目接受建议
- **GIVEN** 当前目录有 `package.json`、`.gitignore` 只含 `node_modules/`，终端为 TTY
- **WHEN** 用户运行 `openlogos init --locale zh my-app`，建议询问时直接回车
- **THEN** 建议列表为 `dist/`、`build/`、`coverage/`（不含已忽略的 `node_modules/`）；`guard.unversioned` 为这三项；`.gitignore` 原有行不变，末尾托管区块含 `logos/.openlogos-runtime/` 与三项；退出码 0

#### 正常：拒绝建议
- **GIVEN** 同上
- **WHEN** 建议询问时输入 `n`
- **THEN** `guard.unversioned` 未写入，托管区块只含 `logos/.openlogos-runtime/`，输出「已跳过」与 `openlogos ignore add` 命令

#### 正常：全部已忽略
- **GIVEN** `Cargo.toml` 存在，`.gitignore` 已含 `target/`
- **WHEN** 用户运行 `openlogos init`
- **THEN** 不出现建议询问，只写入固定运行时条目

#### 正常：非交互环境
- **GIVEN** 标准输入为管道，`package.json` 存在
- **WHEN** 运行 `echo | openlogos init --locale en my-app`
- **THEN** 不询问、不写入建议条目，输出非交互提示与 `openlogos ignore add …` 命令；托管区块只含固定运行时条目

#### 正常：adopt 存量项目
- **GIVEN** 已有代码的 Python 项目（`pyproject.toml`），`.gitignore` 不含 `__pycache__/`，终端为 TTY
- **WHEN** 用户运行 `openlogos adopt`，建议询问时输入 `y`
- **THEN** `__pycache__/`、`.venv/`、`*.pyc` 中尚未被忽略的条目写入 `guard.unversioned` 与托管区块，区块外内容逐字节不变

#### 正常：显式参数不跳过建议询问
- **GIVEN** `package.json` 存在且无 `.gitignore`，终端为 TTY
- **WHEN** 用户运行 `openlogos init --locale en --ai-tool claude-code my-app`
- **THEN** 语言与工具不再询问，但建议忽略询问 `Add them to .gitignore (openlogos managed block)? [Y/n]: ` 仍然出现

#### 异常：init / adopt 托管区块损坏
- **GIVEN** `.gitignore` 只有起始标记没有结束标记
- **WHEN** 用户运行 `openlogos adopt`
- **THEN** stderr 输出区块损坏错误，`logos/` 等任何文件都未创建，`.gitignore` 不变，退出码 1

#### 异常：sync 托管区块损坏
- **GIVEN** 已初始化项目，`.gitignore` 含两个起始标记
- **WHEN** 用户运行 `openlogos sync`
- **THEN** 指令文件、Skills 等其余同步照常完成；`.gitignore` 逐字节不变；stderr 点名区块损坏，结尾输出「sync 部分完成」，退出码 1
