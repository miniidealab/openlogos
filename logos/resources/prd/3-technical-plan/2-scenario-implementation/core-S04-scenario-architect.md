# S04: AI 辅助场景建模 — 场景实现

> Phase 3 Step 1 · 场景建模

## 参与方

| 别名 | 组件 | 说明 |
|------|------|------|
| U | 开发者 | 在 AI 编程工具中输入自然语言 |
| AI | AI 编程工具 | Cursor / Claude Code / OpenCode |
| SK | scenario-architect Skill | `skills/scenario-architect/SKILL.md` |
| FS | 本地文件系统 | 资源目录 |

## 时序图

```mermaid
sequenceDiagram
    participant U as 开发者
    participant AI as AI 编程工具
    participant SK as scenario-architect Skill
    participant FS as 本地文件系统

    U->>AI: Step 1: "帮我画 S01 的时序图"
    AI->>FS: Step 2: 读取需求文档（S01 的定义 + 验收条件）
    AI->>FS: Step 3: 读取产品设计文档（S01 的交互规格 + 对话流程）
    AI->>FS: Step 4: 读取技术架构概要（参与方、技术选型）
    AI->>SK: Step 5: 读取 skills/scenario-architect/SKILL.md

    alt 架构概要不存在
        AI-->>U: EX-4.1: 提示先完成 Phase 3 Step 0
    end

    AI->>AI: Step 6: 从架构图提取参与方
    AI->>AI: Step 7: 按验收条件主路径绘制 Mermaid 时序图
    AI->>AI: Step 8: 补充异常路径（EX-N.M）
    AI->>AI: Step 9: 撰写逐步叙事（每步有主语 + 动作）

    AI-->>U: Step 10: 展示完整文档（时序图 + 步骤叙事 + 异常）
    U->>AI: Step 11: 确认或要求调整
    AI->>FS: Step 12: 写入 3-technical-plan/2-scenario-implementation/S01-*.md

    AI-->>U: Step 13: 建议下一个场景或进入 Step 2
```

## 步骤说明

1. **开发者**在 AI 编程工具中输入「帮我画 S01 的时序图」（或指定其他场景编号）。如果场景编号在需求文档中未定义 → 见 EX-1.1。
2. **AI 编程工具**读取 `logos/resources/prd/1-product-requirements/01-requirements.md`，从中提取 S01 的场景定义、触发条件和 GIVEN/WHEN/THEN 验收条件。
3. **AI 编程工具**读取 `logos/resources/prd/2-product-design/` 下与 S01 相关的交互规格和对话流程设计。
4. **AI 编程工具**读取 `logos/resources/prd/3-technical-plan/1-architecture/01-architecture-overview.md`，获取系统参与方和技术选型。如果架构概要不存在 → 见 EX-4.1。
5. **AI 编程工具**读取 `skills/scenario-architect/SKILL.md`，获取时序图编写规范（编号规则、参与方规范、格式模板、步骤叙事格式）。
6. **AI 编程工具**从架构图中提取该场景涉及的参与方，确定短别名和全名（如 CLI 场景：U = 用户终端、CLI = openlogos CLI、FS = 本地文件系统）。
7. **AI 编程工具**按需求文档中的 GIVEN/WHEN/THEN 主路径，绘制 Mermaid 时序图，每个箭头带 `Step N:` 编号前缀和行为描述。
8. **AI 编程工具**从需求文档的异常验收条件和产品设计的异常对话流程中提取异常用例，使用 `EX-N.M` 编号补充到时序图中。

> 编号规则：`EX-{触发步骤编号}.{该步骤下的异常序号}`。每个涉及外部调用的步骤至少补充 1 个技术异常。

9. **AI 编程工具**撰写步骤叙事：用连续编号列表将时序图的每一步翻译为人类可读的线性叙事，每步以粗体主语开头，简单步骤一行带过，复杂步骤用 blockquote 补充设计决策。异常用例在正常流程之后单独成段。
10. **AI 编程工具**向开发者展示完整的场景实现文档：参与方表 + 时序图 + 步骤叙事 + 异常用例。
11. **开发者**审阅文档，确认或要求调整（如补充异常用例、修改参与方粒度、调整步骤顺序）。
12. **AI 编程工具**将最终文档写入 `logos/resources/prd/3-technical-plan/2-scenario-implementation/S01-*.md`。
13. **AI 编程工具**根据上下文智能建议下一步：如果还有未建模的 P0 场景，建议继续（如「帮我画 S08 的时序图」）；如果所有 P0 场景已建模，建议进入 Phase 3 Step 2（「帮我设计 API」）。

## 异常用例

### EX-1.1: 场景编号不存在

- **触发条件**：Step 1 中用户指定的场景编号在需求文档中未定义
- **期望响应**：AI 提示该编号不存在，询问是否需要先在 Phase 1 补充此场景
- **副作用**：不生成时序图

### EX-4.1: 架构概要不存在

- **触发条件**：Step 4 检测到 `logos/resources/prd/3-technical-plan/1-architecture/` 为空
- **期望响应**：AI 提示「未找到技术架构概要，请先完成 Phase 3 Step 0」
- **副作用**：不生成时序图

## S04 Authority Closure 时序建模扩展

### 场景目标

当场景涉及共享业务事实时，sequence diagram 必须让唯一 authority、mutation entry、projection 和 consumer decision 可见；若两个参与者能独立 write/decide 同一 `fact_id`，在写场景文档前回退架构设计。

### 参与者与时序

```mermaid
sequenceDiagram
    participant SA as scenario-architect
    participant AR as Authority Registry
    participant ME as Mutation Entry
    participant AU as Authority
    participant PJ as Projection
    participant CO as Consumer
    SA->>AR: Step 1: 读取 fact_id 与 owner/writer
    SA->>SA: Step 2: 标注 command/query/refresh/recovery
    alt 双 writer 或双 decision
        SA-->>AR: Step 3: 返回架构阶段补齐唯一权威
    else 权威闭合
        CO->>ME: Step 3: command(fact_id)
        ME->>AU: Step 4: authority write
        AU-->>PJ: Step 5: refresh + freshness identity
        CO->>AU: Step 6: decision/read
        SA-->>SA: Step 7: 生成异常与恢复路径
    end
```

### 步骤说明

1. 读取 Authority Registry，只引用稳定 `fact_id`，不从代码或文件名自造 owner。
2. 每条消息标注 command、authority read/write、projection refresh 或 decision；投影显示 freshness proof。
3. 两个参与者都能改变 canonical state 或给出最终决定时停止交付，回到 architecture-designer。
4. 恢复从 authority/receipt 开始；不得把目录扫描、mtime、marker 存在性画成恢复来源。
5. 场景追溯 AC-01～AC-08 及真实 UT/ST。

### 异常与边界

- **EX-AC-1 双 writer**：报告未闭合，不生成“最后写入胜出”方案。
- **EX-AC-2 stale projection**：identity 不匹配时读 authority 或返回 unavailable，不接受旧值。
- **EX-AC-3 response lost**：按 authority transaction/receipt 查询，不重放不确定写入。

### 追溯

- 规范：`spec/authority-closure.md` AC-01～AC-06。
- 测试：UT-S04-01～UT-S04-04、ST-S04-01。
