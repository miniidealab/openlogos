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

### Step 3: 逐场景细化交互规格

为每个场景定义完整的交互细节（格式见下方示例）。不同产品类型侧重不同的交互维度。

### Step 4: 补充交互级验收条件

在 Phase 1 的 GIVEN/WHEN/THEN 基础上，细化到交互元素级别。

### Step 5: 生成原型

根据产品类型生成对应形式的原型（见示例）。

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
