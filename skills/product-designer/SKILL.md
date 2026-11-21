# Skill: Product Designer

> 基于 Phase 1 需求文档中的场景，细化交互流程和功能规格，生成产品原型。原型形式根据产品类型自动适配（Web/CLI/Library 等）。场景编号与 Phase 1 保持一致。

## 触发条件

- 用户要求写产品设计文档或功能规格
- 用户要求画原型或设计交互
- 用户提到 "Phase 2"、"产品设计层"、"WHAT"
- 已有需求文档（含场景定义），需要开始设计解决方案

## 核心能力

1. **识别产品类型**，确定对应的原型形式（见下方产品类型与原型策略）
2. 设计信息架构（页面结构 / 命令结构 / API 结构）
3. 以 Phase 1 场景为骨架，细化交互流程和功能规格
4. 为每个场景补充交互级 GIVEN/WHEN/THEN 验收条件
5. 生成适合产品类型的原型
6. 当场景粒度过大时，拆分为子场景（`S01.1`, `S01.2`）

## 产品类型与原型策略

执行本 Skill 前，先判断产品类型（可从需求文档的约束与边界、`logos-project.yaml` 的 `tech_stack` 推断），选择对应的原型形式：

| 产品类型 | 典型特征 | 原型形式 | 交互规格重点 |
|---------|---------|---------|-------------|
| **Web 应用** | 有 UI 页面、用户登录 | HTML 可交互页面 | 页面流转、表单校验、状态变化 |
| **CLI 工具** | 终端命令、无 GUI | 终端交互示例（命令 + 输出模拟） | 命令格式、参数设计、输出格式、错误提示 |
| **AI Skills / 对话式产品** | 用户通过自然语言与 AI 交互 | 对话流程图 + 示例对话脚本 | 对话步骤、AI 提问策略、产出物格式 |
| **库 / SDK** | 被其他程序调用 | API 使用示例（代码片段） | 公开接口、参数设计、返回值、错误码 |
| **移动应用** | 手机端 UI | HTML 页面（移动视口） | 手势交互、导航模式、离线状态 |
| **桌面应用** | 本地安装、含 GUI、独立窗口（Electron / Tauri / SwiftUI / Jetpack Compose / Qt / WPF / GTK 等） | HTML 模拟桌面布局（含菜单栏 / 工具栏 / 状态栏）或对应栈风格指南 | 窗口管理、菜单栏 / 上下文菜单、快捷键、系统托盘、多窗口协作、文件系统交互 |
| **混合型** | 多种交付物组合 | 按交付物分别选择对应形式 | 各交付物间的交互衔接 |

## 执行步骤

### Step 1: 读取需求文档，识别产品类型

读取 Phase 1 需求文档，提取：
- 场景清单（`S01`, `S02`...）及优先级
- 约束与边界 → 判断产品类型
- `logos-project.yaml` 的 `tech_stack` → 确认技术形态

**场景粒度检查**：在阅读场景列表时，留意场景是否实际上是单个 CRUD 操作（如"创建任务"、"获取任务列表"、"更新任务"、"删除任务"作为 4 个独立场景）。如果发现此模式，建议回到 Phase 1 按业务目标重新组织场景，再进行产品设计。为 CRUD 级别的"场景"设计交互规格只会产出浅层规格，无法反映真实的用户工作流。

输出产品类型判断和原型策略选择理由。

### Step 2: 设计信息架构

根据产品类型设计不同层面的架构：

- **Web 应用**：页面结构、导航层级、路由设计
- **CLI 工具**：命令树结构、子命令层级、全局选项
- **AI Skills**：Skill 触发关系、对话步骤编排、产出物依赖链
- **库 / SDK**：模块结构、公开 API 分组
- **桌面应用**：窗口结构、菜单 / 快捷键体系、IPC 设计（主进程↔渲染进程 / 各 native 层）、本地存储与文件系统

### Step 3: 逐场景细化交互规格

为每个场景定义完整的交互细节（格式见下方示例）。不同产品类型侧重不同的交互维度。

### Step 4: 补充交互级验收条件

在 Phase 1 的 GIVEN/WHEN/THEN 基础上，细化到交互元素级别。

### Step 5: 生成原型

#### Step 5a（仅 GUI 类产品）：调用 ui-ux-pro-max 获取设计系统

**适用条件**：凡产品交付物中包含图形用户界面（GUI）的产品类型——
- ✅ 触发：Web 应用 / 移动应用 / 桌面应用（Electron / Tauri / SwiftUI / Jetpack Compose / Qt / WPF / GTK 等）/ 混合型中含 GUI 交付物的部分
- ❌ 不触发：纯 CLI 工具 / Library / AI Skills / 纯 API 服务 等无 GUI 交付物的产品

**执行步骤**：

1. 从 Phase 1 需求文档提取关键词：产品类型（SaaS / e-commerce / dashboard / portfolio 等）+ 行业 + 风格倾向
2. 调用 `ui-ux-pro-max`：
   ```bash
   python3 logos/skills/ui-ux-pro-max/scripts/search.py "<product_type> <industry> <style_keywords>" --design-system -p "<项目名>"
   ```
3. 消费输出：风格 + 调色板 + 字体配对 + 登陆页模式 + 反模式清单作为 Step 5 生成原型的视觉基础
   - Web 应用：用 HTML 实现风格指南
   - 桌面 / 移动应用：按对应技术栈输出风格指南（Electron / Tauri 直接复用 react / shadcn / html-tailwind 数据；SwiftUI / Jetpack Compose / Flutter 直接命中对应 stack 数据；其余 native 栈使用 stack 无关的风格/配色/字体推荐）

**降级路径**：

检测不到 `python3` 时跳过本步并提示用户「检测到 ui-ux-pro-max 依赖的 Python 3 不可用。原型将使用通用风格生成。如需专业级设计系统建议，请安装 Python 3 后重试。」原型用通用风格继续生成，不阻塞 Step 5。

### Step 5a 补充：UI/UX 子流程可被 change-writer 在提案阶段复用（proposal-ui-ux-first）

Step 5a 的 UI/UX 子流程（调用 `ui-ux-pro-max` 设计系统 → 落地 `design-system.json` 令牌 → 以设计系统为基础产出 page-design 原型）**不仅用于 Phase 2 全新产品设计**——对已 `launched` 的 **GUI 产品项目**，同一子流程**可被 `change-writer` 在变更提案阶段（plan 节点、`plan-exit` 门前）复用**，把 UI/UX 确认从「批准后自动实现期间」**前移到「批准提案」门**。

**复用点（前移，非仅 Phase 2）**：

- **谁调用**：变更走 Delta 流程时，由 driver 在 plan 节点派发的 `change-writer`（producer）复用本 Step 5a 子流程，而非 Phase 2 的 product-designer 主流程。触发与产出规则见 `skills/change-writer/SKILL.md` 的「Step 6 补充二：GUI 项目提案阶段前置 UI/UX 原型」。
- **何时调用**：提案阶段（`plan-exit` 门**前**），当 `product_type ∈ GUI` 且本次 `ui_impact:true` 时。区别于 Phase 2 在完整需求就绪后一次性产出全部页面设计。

**产物与 Step 5a 完全一致**（复用即产出一致）：

1. **原型**：以 ui-ux-pro-max 设计系统为视觉基础产出的裸 HTML 原型（关键几屏 + 各交互状态）。提案阶段复用时，原型作为 page-design delta 写入 `logos/changes/<slug>/deltas/prd/2-product-design/2-page-design/*.html`（Phase 2 则直接写 `logos/resources/prd/2-product-design/2-page-design/`）。
2. **`design-system.json`**：ui-ux-pro-max 令牌产物，用于追溯「原型出自设计系统」。提案阶段复用时留存于提案目录 `logos/changes/<slug>/` 作审计产物。**仅 `design_system_mode: generated`（走了设计系统）时产出并要求；`fallback`（降级）时不产 / 不要求 `design-system.json`、禁伪造令牌**（详见下「降级路径」）。

**两种 `design_system_mode`（机器可读，提案阶段复用时写入声明段）**：

- `generated`：`python3` 可用、正常走 ui-ux-pro-max 设计系统 → 产出 `design-system.json` 令牌。
- `fallback`：降级 → 声明段填 `design_system_fallback_reason`（如「Python3 缺失」），**不产 / 不要求 `design-system.json`、禁伪造令牌**。

**降级路径一致**：检测不到 `python3` 时，两处（Phase 2 主流程 / 提案阶段复用）均以通用风格兜底、置 `design_system_mode: fallback` 并填 `design_system_fallback_reason`（不产令牌），不阻塞、不报错。字段与对账契约详见 `skills/change-writer/SKILL.md` 的「Step 6 补充二」④/⑥。

**适用/不适用一致**：仅 GUI 类产品触发（Web / 移动 / 桌面 / 含 GUI 交付物的混合型）；纯 CLI / Library / AI Skills / 纯 API 服务不触发。

#### Step 5b：根据产品类型生成对应形式的原型

根据产品类型生成对应形式的原型（见示例）。GUI 类产品在 Step 5a 已获取设计系统的基础上落地视觉/交互；非 GUI 类产品直接按产品类型选择对应原型形式。

### Step 6: 输出产品设计文档

按场景组织，每个场景包含交互规格 + 对应原型。

## 场景展开示例

### Web 应用示例

```markdown
### S01: 邮箱注册 — 交互规格

**涉及页面**：注册页、邮件验证等待页、验证成功页

**交互流程**：
1. 用户在首页点击「注册」→ 跳转注册页
2. 注册页包含：邮箱输入框、密码输入框、确认密码输入框、注册按钮
3. 实时校验：邮箱格式、密码长度 ≥ 8、两次密码一致
4. 提交成功 → 跳转邮件验证等待页

#### 验收条件（交互级）

##### 正常：成功注册
- **GIVEN** 用户在注册页面，所有字段为空
- **WHEN** 用户填写 test@example.com、密码 "Pass1234"、确认密码 "Pass1234"，点击「注册」按钮
- **THEN** 「注册」按钮变为 loading 状态，1-3 秒后跳转到邮件验证等待页
```

**原型**：`01-register-prototype.html`（可交互的 HTML 页面）

### CLI 工具示例

````markdown
### S01: CLI 初始化项目 — 交互规格

**命令格式**：`openlogos init [name]`

**参数设计**：
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| name | string | 否 | 当前目录名 | 项目名称 |

**交互流程**：
1. 用户在终端运行 `openlogos init my-project`
2. CLI 检查 `logos/logos.config.json` 是否已存在
3. 不存在 → 创建目录结构，逐行输出创建的文件清单
4. 存在 → 输出错误提示并退出

**终端输出模拟**：

正常路径：
```
$ openlogos init my-project

Creating OpenLogos project structure...

  ✓ logos/resources/prd/1-product-requirements/
  ✓ logos/resources/prd/2-product-design/
  ✓ logos/resources/prd/3-technical-plan/1-architecture/
  ✓ logos/resources/prd/3-technical-plan/2-scenario-implementation/
  ✓ logos/resources/api/
  ✓ logos/resources/database/
  ✓ logos/resources/scenario/
  ✓ logos/changes/
  ✓ logos/logos.config.json
  ✓ logos/logos-project.yaml
  ✓ AGENTS.md
  ✓ CLAUDE.md

Project initialized. Next steps:
  1. Edit logos/logos.config.json to configure your project
  2. Start with Phase 1: tell AI "帮我写需求文档"
  3. Run `openlogos status` to check progress at any time
```

错误路径：
```
$ openlogos init
Error: logos/logos.config.json already exists in current directory.
This directory has already been initialized as an OpenLogos project.
```

#### 验收条件（交互级）

##### 正常：全新项目
- **GIVEN** 当前目录无 `logos/logos.config.json`
- **WHEN** 用户运行 `openlogos init my-project`
- **THEN** 终端逐行输出创建的 12 个文件/目录，最后输出 "Next steps" 引导，退出码为 0

##### 异常：已初始化
- **GIVEN** 当前目录已存在 `logos/logos.config.json`
- **WHEN** 用户运行 `openlogos init`
- **THEN** 终端输出红色错误提示，不创建任何文件，退出码为 1
````

**原型**：`01-init-terminal.md`（终端交互模拟文档）

### AI Skills / 对话式产品示例

```markdown
### S02: AI 辅助写需求文档 — 交互规格

**触发方式**：用户在 AI 编程工具中输入自然语言

**对话流程**：
1. 用户说「帮我写需求文档」
2. AI 读取 prd-writer Skill
3. AI 追问：「请先告诉我你的产品定位——这个产品要解决什么人的什么问题？」
4. 用户描述产品想法
5. AI 追问：「核心用户是谁？能描述一个具体的人吗？」
6. 用户描述用户画像
7. AI 汇总信息，开始输出结构化需求文档
8. AI 输出后询问：「需求文档初稿已生成，请 review 后告诉我需要修改的地方」

**AI 行为规范**：
- 追问不超过 3 轮，每轮聚焦 1 个关键信息
- 如果用户在第一条消息中提供了充分信息，跳过追问直接输出
- 输出的文档格式严格遵循 prd-writer 规范

#### 验收条件（交互级）

##### 正常：信息充分
- **GIVEN** 用户在第一条消息中描述了产品定位、目标用户和核心痛点
- **WHEN** AI 开始执行 prd-writer Skill
- **THEN** AI 直接输出结构化需求文档，不进行追问

##### 正常：信息不足
- **GIVEN** 用户只说了「帮我写需求文档」
- **WHEN** AI 开始执行 prd-writer Skill
- **THEN** AI 追问产品定位（第 1 轮）→ 用户回答 → AI 追问目标用户（第 2 轮）→ 用户回答 → AI 输出需求文档
```

**原型**：`02-prd-writer-dialogue.md`（对话流程脚本）

## 输出规范

- 功能规格：`logos/resources/prd/2-product-design/1-feature-specs/`
- 原型：`logos/resources/prd/2-product-design/2-page-design/`
- 设计文档与原型成对出现：`<module>-{序号}-{名称}-design.md` + `<module>-{序号}-{名称}-prototype.{ext}`（从 `logos-project.yaml` 的 `modules[]` 读取当前模块，默认为 `core`）
  - Web 应用：`.html`
  - CLI 工具：`-terminal.md`（终端交互模拟）
  - AI Skills：`-dialogue.md`（对话流程脚本）
  - 库 / SDK：`-api-examples.md`（使用示例）
- **场景编号必须与 Phase 1 一致**，如需拆分使用子编号（`S01.1`）

## 实践经验

- **场景是骨架**：不要按"页面"或"命令"组织文档，按"场景"组织
- **Phase 1 的验收条件是输入**：Phase 2 不是重写验收条件，而是在 Phase 1 的基础上细化到交互元素级别
- **子场景拆分要有理由**：只在 Phase 1 的场景确实包含两条独立的交互路径时才拆分
- **CLI 的"原型"是终端输出模拟**：不需要 HTML，用代码块模拟终端的输入输出即可
- **AI Skills 的"原型"是对话脚本**：模拟用户和 AI 的多轮对话，明确 AI 在每个节点的行为
- **混合型产品按场景分**：同一个产品中 CLI 场景用终端模拟、Web 场景用 HTML，不需要统一形式
- **Markdown 嵌套代码块**：当文档内容本身包含 ` ``` ` 代码围栏时（如对话脚本中 AI 输出代码片段、终端模拟中嵌套命令输出），**外层围栏必须使用 4 个反引号**（` ```` `），内层保持 3 个。这是 Markdown 标准语法，避免解析器误判层级导致格式错乱。上方 CLI 工具示例已体现此规则

## 推荐提示词

以下提示词可以直接复制给 AI 使用：

- `基于需求文档做产品设计`
- `帮我设计 S01 的交互流程和原型`
- `帮我把所有场景的产品设计做出来`
- `帮我设计 CLI 命令的交互流程`
- `帮我设计 AI Skill 的对话流程`

## ⚠️ 收尾步骤（强制）：更新 resource_index

完成本 Skill 的所有文档产出后，**必须**将新生成的文档追加写入 `logos/logos-project.yaml` 的 `resource_index` 字段：

```yaml
resource_index:
  # ...已有条目...
  - path: logos/resources/prd/2-product-design/1-feature-specs/<文件名>.md
    desc: <功能规格/信息架构描述>。涉及 <相关场景> 的交互设计、功能规格时必读。
  - path: logos/resources/prd/2-product-design/2-page-design/<文件名>.md
    desc: <原型描述>。涉及 <相关场景> 的页面交互、对话脚本时必读。
```

**不执行此步骤将导致后续 AI 无法感知已完成的产品设计文档，影响场景建模和代码生成阶段的上下文质量。**

## 加载相关企业知识（S45）

> 来源变更：enterprise-knowledge-base（S45）；knowledge-direct-intake（直接录入、标签表、索引与检索）。规则权威：功能规格 §2.102、§2.103；目录约定：`spec/directory-convention.md`「logos/resources/knowledge/」。跳过条件只有一种：项目没有任何知识条目、本提案没有 `deltas/knowledge/`，**并且本轮用户没有提供企业资料**——此时跳过本节，其余步骤不变。

### 录入入口（先于加载，不受跳过条件影响）

本轮用户提供了待沉淀的企业资料（制度原文、接口说明、术语表等）时，先录入再加载，即使项目还没有 `logos/resources/knowledge/`、`logos/resources/reference/knowledge/` 与 `deltas/knowledge/`（例如升级前就已 launched 的存量项目第一次录入）：

1. **选择通道**：只提供资料、没有需求变更（或新知识可以先于需求生效）→ **直接录入，不立案**（第 2～5 步）。知识修订必须与场景修改同批生效（如退役旧规则的同时改写引用它的场景）→ 走提案通道（第 7 步）。
2. **取号与标签**：运行 `openlogos knowledge list --format json`，读取有效知识视图中的条目与 `tag_state`。新条目编号取最大 KXX（含 `deprecated`）+ 1，视图为空时为 K01；修订既有条目时新规则取该条目最大 Rn（含 `deprecated`）+ 1。标签优先使用 `logos/resources/knowledge/TAGS.md` 中已有的标签或别名。
3. **准备候选目录**：在**项目根之外**新建一次性目录（如 `mktemp -d` 的结果），写入：
   - 完整条目文件 `<module>-KXX-<slug>.md`：新建；或修订时整文件替换——必须保留原有全部规则行，退役只改状态，已退役的内容逐字不动；
   - 需要新增标签时，写完整的 `TAGS.md`：复制现有全部行再追加，表头为「标签 | 别名 | 说明」；
   - 原文放在 `sources/<文件名>`；同名原文已存在且内容不同时改用新文件名（如 `-v4`）。条目 `source.path` 写 `logos/resources/reference/knowledge/<文件名>`。

   不要用文件工具直接写 `logos/resources/knowledge/`——该目录受 guard 保护，会被拦截。候选目录放在项目根之外，因此不受项目 `guard.exempt` 配置影响。
4. **录入**：在项目根**单独**运行 `openlogos knowledge apply <候选目录> --format json`，不要与其他命令用 `&&` 组合。
5. **按结果处理**：
   - 退出码 1：整批被拒，项目里没有写入任何文件。按 `errors[]` 逐条修正候选后重跑第 4 步。
   - 退出码 0：读回 `written[]` 中的条目，并提示用户：「原文将随仓库 push 扩散，push 前请确认可公开范围」。`warnings[]` 中的 `knowledge_tag_synonym`（疑似同义标签）转告用户，由人类负责人决定是否合并，不要自行合并。
   - 项目第一次 apply 时会自动从已有条目生成 `TAGS.md`，不会让既有条目失效。
   - 退出码 2 且 `rolled_back=false`，或任何命令报 `knowledge_apply_incomplete`：上一次录入被中断或回滚失败。先运行 `openlogos knowledge apply --recover`，成功后再继续；仍失败时把输出交给用户处理。
   - 报 `knowledge_apply_busy`：另一个录入正在进行，稍后重跑第 4 步；不要删除 `logos/.openlogos-runtime/` 下的锁或事务文件。
   - 报 `knowledge_apply_conflict`：候选与活跃提案的知识 delta 同名或同编号，改用其他编号，或改在提案内修改。
6. **条目必须结构有效**：H1 以 KXX 开头；「元数据」YAML 含合法的 `type`、`scope`、`status`（`scope: module` 时含 `module`）、非空 `tags`，以及非空 `source`——每项写原文的仓库相对 `path`（必须指向 `logos/resources/reference/knowledge/` 内存在的文件，或本批 `sources/` 中的文件；指向该目录之外的仓库文件如 `README.md` 视为无效）与非空 `version`；`type: rule` 时有「规则」表，表中每一行首列都是本条目的 `KXX-Rn`、「状态」为 `active` 或 `deprecated`；标签表已启用时，每个标签都必须是 `TAGS.md` 中的标签或别名（或在同批 `TAGS.md` 中加入）。不满足时 apply 以 `knowledge_entry_invalid` / `knowledge_tag_unknown` 整批拒绝，提案通道中 change-lint 同样拒绝。
7. **提案通道**：由 change-writer 在 `tasks.md` 的 `[delta]` 中规划 `deltas/knowledge/<module>-KXX-<slug>.md` 并预定 KXX（取号同第 2 步），产出知识 delta，合并时落盘。原文：项目 `guard.exempt` 仍含 `logos/resources/reference/` 时直接写入 `reference/knowledge/`；不含时（如显式 `guard.exempt: []`），在项目根之外建一个**只含 `sources/`** 的候选目录，运行 `openlogos knowledge apply <候选目录>` 写入原文（不写条目），条目仍经 delta 与场景同批合并。`deltas/knowledge/` 只放条目文件；需要的新标签先按第 3～5 步经 apply 加入 `TAGS.md`。initial 项目也默认使用直接录入。
8. 录入完成后，按下文在有效知识视图上加载；刚录入或同一提案新录入的条目立即可被引用。

### 有效知识视图

加载对象是**有效知识视图**：当前提案视角下知识条目的候选后态。提案尚未合并时，是磁盘上的 `logos/resources/knowledge/` 条目叠加本提案 `deltas/knowledge/` 后的结果；提案已合并且没有待应用的修正时，直接读磁盘上的条目（delta 已应用，不再叠加）；有待应用的修正时，以合并基线叠加修正后的 delta。没有活跃提案时就是磁盘上的条目。只看当前提案，不读其他提案或 archive。`openlogos knowledge list` 输出的就是这一视图的元数据。

标签表状态（`knowledge list` 的 `tag_state`）：

- `never`：从未启用标签表，条目有效性沿用原判据；
- `enabled`：条目的每个标签都必须在 `TAGS.md` 中（含别名），标签不在表中的条目不能作为依据或引用目标；
- `missing`：已启用但 `TAGS.md` 丢失——停止录入与引用，请用户从 git 恢复 `TAGS.md`，或运行 `openlogos knowledge apply --init-tags` 重新初始化。

### 加载步骤

1. 运行 `openlogos knowledge list --module <当前模块> --format json`（需要时加 `--tag <标签>`，按标签表的行匹配别名），得到有效元数据（含本提案知识 delta）。不要以 `INDEX.md` 作为筛选依据——它只是已落盘条目的总索引，不含本提案的知识 delta。
2. 在结果中按 `scope`（`global` 一律命中）与 `tags` 收窄到与当前需求 / 场景相关的条目。不依赖 `resource_index` 的描述，不做语义检索。
3. 对每个命中条目运行 `openlogos knowledge show <KXX> --format json`，读取它在同一有效知识视图中的**合成后全文**（`content`）与规则（`rules`）。不要沿 `list` 返回的 `path` 直接读 delta 文件——只修改了「元数据」的 delta 不含原有规则。`type: rule` 的条目以「规则」表中状态为 `active` 的 `KXX-Rn` 为约束；`deprecated` 的条目或规则只作背景，不作为新设计的依据。
4. 同一 KXX 出现在两个文件、或同一条目内重复 Rn 时，不得解析该 ID，先提示用户修复重号（会被报 `knowledge_id_duplicate`）。
5. `valid=false` 的条目（`problems` 说明原因：结构无效或标签不在表中）不作为依据，先提示用户经录入入口修正（引用它会被 change-lint 报 `knowledge_reference_unknown`）。
6. 需要知道某个条目或规则被哪些场景使用时（退役、修订、评估影响面），运行 `openlogos knowledge refs <KXX|KXX-Rn>`。

### 写明依据与冲突处理

- 产出中凡受企业知识约束的内容，写明依据的 `KXX` 或 `KXX-Rn`。
- 发现需求或设计与某条 `active` 规则冲突时，**不硬阻断、不静默取舍**：列出冲突（规则 ID、冲突点、可选处理：遵守 / 本次例外 / 规则需更新）并停下询问用户，一次只问一个决定。用户裁决「本次例外」时，在场景「适用业务约束」的「例外」列记录理由；裁决「规则需更新」时，按录入入口修订规则（只改知识时直接录入；须与场景同批生效时交由 change-writer 规划知识 delta）。

### 本 Skill 的加载时机与产出

- **时机**：编写功能规格与交互设计之前。
- **产出**：交互流程、字段约束与提示文案受企业规则约束时写明依据；交互方案与规则冲突时按上文冲突处理停下询问，不自行改动规则或绕开规则。
