# Delta 变更管理规范

> 版本：0.1.0
>
> 本文档定义 OpenLogos 的 Delta 变更管理机制。每次功能迭代或 Bug 修复，先创建变更提案，审核通过后再合并回主文档。确保变更过程可追溯、可审核、可回滚。

## 核心原则

1. **不直接修改主文档**：每次变更先在 `changes/` 中创建提案
2. **影响分析先行**：在 `proposal.md` 中明确变更范围
3. **按需传播**：不是每次都全链路更新，只更新受影响的环节
4. **归档留痕**：变更完成后归档，保留完整历史

## 目录结构

```
project-root/
├── resources/                    # 主文档（当前已生效的"真相"）
│
├── changes/                      # 变更提案工作区
│   ├── add-remember-me/          # 一个变更提案
│   │   ├── proposal.md           # 变更说明
│   │   ├── tasks.md              # 实现任务清单
│   │   └── deltas/               # 增量修改（Delta）
│   │       ├── prd/
│   │       ├── api/
│   │       ├── database/
│   │       └── scenario/
│   │
│   └── archive/                  # 已完成变更的历史归档
│       └── add-remember-me/
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
- `deltas/prd/` → 对应 `resources/prd/` 的变更
- `deltas/api/` → 对应 `resources/api/` 的变更
- `deltas/database/` → 对应 `resources/database/` 的变更
- `deltas/scenario/` → 对应 `resources/scenario/` 的变更

## 变更工作流

```
1. 创建变更提案
   └── changes/{change-name}/proposal.md + tasks.md

2. 编写 Delta 文件
   └── changes/{change-name}/deltas/ 中写明所有增量变更

3. 审核变更提案
   └── 团队/自审 proposal.md 和 delta 文件

4. 按 tasks.md 逐项实现
   └── 更新主文档 → 更新代码 → 部署 → 验收

5. 验收通过，归档变更
   └── 将 changes/{change-name}/ 移入 changes/archive/
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
- 分支合并时，`changes/{change-name}/` 同步移入 `changes/archive/`
- 重大变更在文档顶部的"最后更新"时间戳中标注
- `changes/archive/` 提供完整变更历史

## CLI 命令

```bash
# 创建变更提案
openlogos change add-remember-me

# 归档已完成的变更
openlogos archive add-remember-me
```
