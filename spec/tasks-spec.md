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

## [deploy] 部署任务
- [ ] 按部署方案部署到 staging
- [ ] 确认迁移、配置、服务启动和回滚预案
```

`[deploy]` section 只能在 `openlogos verify` 通过后执行，且必须由人类明确确认后发起。AI 不得因为 `[deploy]` 任务存在而自动执行部署。

### Section 标记

Section 标题格式为 `## [<tag>] <描述>`，其中 `<tag>` 为小写英文标识符：

| 标记 | 阶段 | 说明 |
|------|------|------|
| `[delta]` | delta-writing | delta 文档产出任务。该 section 全部勾选 → 可进入 ready-to-merge |
| `[code]` | coding | 代码实现任务。该 section 全部勾选 → coding 阶段完成 |
| `[deploy]` | deployment | 部署执行任务。只在 verify PASS 后展示，必须人类确认后执行 |

### 规则

1. **`[delta]` section 只列 delta 任务**：每条任务必须对应一个 delta 文件的产出，不得混入代码或部署任务
2. **`[code]` section 只列代码任务**：直接修改 `src/`、`test/` 等源文件的任务，不得混入 delta 或部署任务
3. **`[deploy]` section 只列部署任务**：部署、迁移、发布、重启、配置检查、回滚准备等任务写入此 section，不得混入代码实现任务
4. **三个 section 均为可选**：
   - 纯代码提案（无规格变更）：只有 `[code]` section，无 `[delta]` section
   - 纯规格提案（无代码实现）：只有 `[delta]` section，无 `[code]` section
   - 不需要部署的提案：不得创建 `[deploy]` section
5. **Section 内可有子标题**：用于分组，不影响 CLI 解析（CLI 只识别 `## [tag]` 级别的 section 边界）
6. **Section 顺序**：建议 `[delta]` 在前，`[code]` 居中，`[deploy]` 最后，与流程顺序一致

## 状态判断规则

CLI 的 `detectProposalStep()` 按以下规则判断各阶段是否完成：

| tasks.md / 标记状态 | 判断结果 |
|---|---|
| 提案模板未填写完整 | → `writing` |
| 有 `[delta]` section 且未全部勾选 | → `delta-writing` |
| 有 `[delta]` section 且全部勾选，且未生成 MERGE_PROMPT | → `ready-to-merge` |
| 已生成 `MERGE_PROMPT.md` / `MERGE_PROMPT_GENERATED`，但未写入 `SPEC_MERGED` | → `merge-generated` |
| `SPEC_MERGED` 存在，且 `[code]` section 未全部勾选 | → `coding` |
| `SPEC_MERGED` 存在，且无 `[code]` section 或 `[code]` 全部勾选 | → `ready-to-verify` |
| `VERIFY_FAIL` 存在 | → `verify-failed` |
| `VERIFY_PASS` 存在，且无 `[deploy]` section | → `verify-passed` |
| `VERIFY_PASS` 存在，`[deploy]` section 存在，但 `DEPLOY_DONE` 不存在或 `[deploy]` 未全勾 | → `ready-to-deploy` |
| `DEPLOY_DONE` 存在且 `[deploy]` 全部勾选 | → `deploy-done` |
| `DEPLOY_DONE` 存在，但 `SMOKE_PASS` / `SMOKE_FAIL` 均不存在 | → `ready-to-smoke` |
| `SMOKE_FAIL` 存在 | → `smoke-failed` |
| `SMOKE_PASS` 存在 | → `smoke-passed` |

优先级规则：

1. `VERIFY_FAIL` 高于 `VERIFY_PASS`、`DEPLOY_DONE` 和 `SMOKE_PASS`
2. `SMOKE_FAIL` 高于 `SMOKE_PASS`
3. 重新运行 `openlogos verify` 且失败时，必须清理过期的 `VERIFY_PASS`、`DEPLOY_DONE`、`SMOKE_PASS`、`SMOKE_FAIL`
4. 重新部署时，必须清理过期的 `SMOKE_PASS` / `SMOKE_FAIL`

## 部署与冒烟测试设计要求

当提案 `proposal.md` 的部署影响为“需要部署”时：

- `change-writer` 必须创建 `[deploy]` section
- delta-writing 阶段必须产出部署方案 delta，通常位于 `deltas/prd/3-technical-plan/3-deployment/`
- 测试设计阶段必须一并设计部署冒烟测试，建议写入 `logos/resources/test/smoke/<module>-smoke-test-cases.md`
- 部署完成后必须运行 `openlogos smoke`，通过后才能 archive 或在 Initial 阶段 launch

冒烟测试不写入 `[deploy]` section 作为可勾选任务。`[deploy]` 只表示部署执行完成；冒烟测试由 `openlogos smoke` 命令独立管理。

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
