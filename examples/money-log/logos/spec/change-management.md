# Delta 变更管理规范

> 版本：0.3.0
>
> 本文档定义 OpenLogos 的 Delta 变更管理机制。每次功能迭代或 Bug 修复，先创建变更提案，审核通过后再合并回主文档。确保变更过程可追溯、可审核、可回滚。

## 核心原则

1. **不直接修改主文档**：每次变更先在 `logos/changes/` 中创建提案
2. **影响分析先行**：在 `proposal.md` 中明确变更范围
3. **按需传播**：不是每次都全链路更新，只更新受影响的环节
4. **归档留痕**：变更完成后归档，保留完整历史

## 目录结构

```
project-root/
└── logos/
    ├── resources/                    # 主文档（当前已生效的"真相"）
    │
    └── changes/                      # 变更提案工作区
        ├── add-remember-me/          # 一个变更提案
        │   ├── proposal.md           # 变更说明
        │   ├── tasks.md              # 实现任务清单
        │   └── deltas/               # 增量修改（Delta）
        │       ├── prd/
        │       ├── api/
        │       ├── database/
        │       └── scenario/
        │
        └── archive/                  # 已完成变更的历史归档
            └── add-remember-me/
```

## 文件规范

### proposal.md

变更说明文档，必须包含：

```markdown
# 变更提案：[变更名称]

## 变更原因
[为什么要做这个变更？来源于哪个需求/反馈/Bug？]

## 变更范围
- 影响的需求文档：[列表]
- 影响的功能规格：[列表]
- 影响的业务场景：[列表]
- 影响的 API：[列表]
- 影响的 DB 表：[列表]

## 变更概述
[用 1-3 段话概述具体改什么]
```

### tasks.md

实现任务清单，按 Phase 组织：

```markdown
# 实现任务

## Phase 1: 文档变更
- [ ] 更新需求文档的用户故事和验收条件
- [ ] 更新产品设计文档的功能规格

## Phase 2: 设计变更
- [ ] 更新 HTML 原型
- [ ] 更新场景时序图
- [ ] 更新 API YAML
- [ ] 更新 DB DDL

## Phase 3: 编排与代码
- [ ] 更新 API 编排测试用例
- [ ] 实现代码变更
- [ ] 部署到测试环境
- [ ] 运行编排验收
```

### deltas/ 目录

增量修改文件，使用标记格式：

```markdown
## ADDED — [新增内容标题]
[新增的完整内容]

## MODIFIED — [修改内容标题]
[修改后的完整内容，替换主文档中同名章节]

## REMOVED — [删除内容标题]
[说明删除原因]
```

Delta 文件的目录结构映射主文档目录：
- `deltas/prd/` → 对应 `logos/resources/prd/` 的变更
- `deltas/api/` → 对应 `logos/resources/api/` 的变更
- `deltas/database/` → 对应 `logos/resources/database/` 的变更
- `deltas/scenario/` → 对应 `logos/resources/scenario/` 的变更

## 变更工作流

```
1. 创建变更提案（CLI）
   └── openlogos change {slug}
   └── 生成 logos/changes/{slug}/proposal.md + tasks.md + deltas/

2. AI 辅助填写提案（change-writer Skill）
   └── AI 分析影响范围，填写 proposal.md 和 tasks.md

3. 按 tasks.md 逐项产出 Delta 文件（各阶段 Skill）
   └── 每完成一项任务，将增量变更写入 deltas/ 对应子目录

4. 审核变更提案
   └── 团队/自审 proposal.md 和 delta 文件

5. 生成合并指令（CLI）
   └── openlogos merge {slug}
   └── 扫描 deltas/，生成 MERGE_PROMPT.md

6. AI 执行合并（merge-executor Skill）
   └── AI 读取 MERGE_PROMPT.md，逐个 delta 合并到主文档

7. 归档变更（CLI）
   └── openlogos archive {slug}
   └── 将 logos/changes/{slug}/ 移入 logos/changes/archive/
```

## 变更传播规则

不是每次变更都需要全链路更新。根据变更类型决定影响范围：

| 变更类型 | 最少需要更新 | 说明 |
|---------|------------|------|
| 需求级变更 | 全链路 | 需求变了，所有下游都可能受影响 |
| 设计级变更 | 原型 + 场景 + API/DB + 编排 + 代码 | 需求不变，实现方案调整 |
| 接口级变更 | API/DB + 编排 + 代码 | 设计不变，接口细节调整 |
| 代码级修复 | 代码 + 重新验收 | Bug 修复，不涉及设计变更 |

## Git 集成

- 每个变更提案对应一个 Git 分支：`change/{change-name}`
- 分支合并时，`logos/changes/{change-name}/` 同步移入 `logos/changes/archive/`
- 重大变更在文档顶部的"最后更新"时间戳中标注
- `logos/changes/archive/` 提供完整变更历史

## MERGE_PROMPT.md 文件规范

`openlogos merge` 命令自动生成的指令文件，结构如下：

```markdown
# Merge Instruction

## 变更提案
- 提案名称：{slug}
- 提案目录：logos/changes/{slug}/

## 提案内容
[从 proposal.md 中读取的完整内容]

## 需要合并的 Delta 文件

### 1. {delta-relative-path}
- Delta 文件：`logos/changes/{slug}/deltas/{category}/{file}`
- 目标目录：`logos/resources/{category}/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

## 执行要求
1. 逐个 Delta 文件处理，每处理完一个报告修改摘要
2. 对于 ADDED 标记：在主文档的指定位置插入新内容
3. 对于 MODIFIED 标记：替换主文档中同名章节的内容
4. 对于 REMOVED 标记：从主文档中删除对应章节
5. 保持主文档的原有格式和风格
6. 如果主文档有"最后更新"时间戳，同步更新
7. 所有变更完成后，列出修改清单
8. 完成后提醒用户运行 `openlogos archive {slug}`
```

## CLI 命令

```bash
# 创建变更提案
openlogos change add-remember-me

# 生成合并指令（由 AI 执行实际合并）
openlogos merge add-remember-me

# 归档已完成的变更
openlogos archive add-remember-me
```

## AI Skills 集成

- **change-writer**：在 `openlogos change` 后使用，辅助填写 proposal.md 和 tasks.md
- **merge-executor**：在 `openlogos merge` 后使用，读取 MERGE_PROMPT.md 执行实际合并
