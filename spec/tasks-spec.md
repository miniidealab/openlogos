# tasks.md 结构化格式规范

> 版本：1.0.0
>
> 本文档定义 OpenLogos 变更提案中 `tasks.md` 的结构化格式。CLI 依赖此格式对各阶段任务进行精确的状态判断。

## 格式规范

tasks.md 使用带标记的 section 组织任务，每个 section 对应提案流程中的一个阶段：

```markdown
# 实现任务

## [delta] 规格变更
- [ ] 产出 delta 文件到 deltas/prd/1-product-requirements/ — 更新需求文档
- [ ] 产出 delta 文件到 deltas/api/ — 更新 API YAML

## [code] 代码实现
- [ ] 实现 src/xxx 中的业务逻辑
- [ ] 编写对应测试
```

### Section 标记

Section 标题格式为 `## [<tag>] <描述>`，其中 `<tag>` 为小写英文标识符：

| 标记 | 阶段 | 说明 |
|------|------|------|
| `[delta]` | delta-writing | delta 文档产出任务。该 section 全部勾选 → 可进入 ready-to-merge |
| `[code]` | coding | 代码实现任务。该 section 全部勾选 → coding 阶段完成 |

### 规则

1. **`[delta]` section 只列 delta 任务**：每条任务必须对应一个 delta 文件的产出，不得混入代码任务
2. **`[code]` section 只列代码任务**：直接修改 `src/`、`test/` 等源文件的任务，不得混入 delta 任务
3. **两个 section 均为可选**：
   - 纯代码提案（无规格变更）：只有 `[code]` section，无 `[delta]` section
   - 纯规格提案（无代码实现）：只有 `[delta]` section，无 `[code]` section
4. **Section 内可有子标题**：用于分组，不影响 CLI 解析（CLI 只识别 `## [tag]` 级别的 section 边界）
5. **Section 顺序**：建议 `[delta]` 在前，`[code]` 在后，与流程顺序一致

## 状态判断规则

CLI 的 `detectProposalStep()` 按以下规则判断各阶段是否完成：

| tasks.md 格式 | `[delta]` section 状态 | 判断结果 |
|---|---|---|
| 有 `[delta]` section | 全部勾选 | → `ready-to-merge` |
| 有 `[delta]` section | 未全部勾选 | → `delta-writing` |
| 无 `[delta]` section（纯代码提案） | — | → `ready-to-merge`（直接跳过） |
| 旧格式（无任何 section 标记） | — | → 降级为全局 `allTasksChecked` 判断（向后兼容） |

## 向后兼容

没有 `## [tag]` 标记的旧格式 tasks.md 继续使用原有的全局勾选判断逻辑，不破坏已有提案。

## 示例

### 需求级变更（有 delta + 有代码）

```markdown
# 实现任务

## [delta] 规格变更
- [ ] 产出 delta 文件到 deltas/prd/1-product-requirements/ — 更新 S03 验收条件
- [ ] 产出 delta 文件到 deltas/prd/3-technical-plan/2-scenario-implementation/ — 更新 S03 时序图
- [ ] 产出 delta 文件到 deltas/api/ — 更新 /orders API

## [code] 代码实现
- [ ] 修改 src/orders/handler.ts — 新增退款逻辑
- [ ] 编写 test/orders/refund.test.ts
```

### 纯代码修复（无 delta）

```markdown
# 实现任务

## [code] 代码实现
- [ ] 修复 src/auth/token.ts 中的 token 过期判断
- [ ] 更新 test/auth/token.test.ts
```

### 纯规格变更（无代码）

```markdown
# 实现任务

## [delta] 规格变更
- [ ] 产出 delta 文件到 deltas/prd/1-product-requirements/ — 补充非功能性需求
- [ ] 产出 delta 文件到 deltas/prd/2-product-design/1-feature-specs/ — 更新交互说明
```
