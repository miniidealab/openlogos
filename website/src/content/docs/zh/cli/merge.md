---
title: "openlogos merge"
description: 一次调用把变更提案的规格 delta 合并进主文档——原子落盘、全有或全无；已合并的提案可按合并基线增量修正。
---

把一个变更提案的全部规格 delta 合并进 `logos/resources/`（OpenLogos 自身项目还包括根 `spec/` / `skills/`），**一次调用完成**。0.15.0 起整件事由命令自己完成：解析 delta → 按章节锚合成每个目标的最终字节 → 一次性原子落盘 → 末步写 `SPEC_MERGED` 标记。要么全部目标都更新，要么一个都不动。

`openlogos merge` 是**人类确认点**：半自动模式下，AI 只有在你明确授权后才会执行它（见[两档授权](/zh/cli/next)）。

## 命令格式

```bash
openlogos merge <slug> [--format json]
```

必须在项目根目录下运行。

## 参数与选项

| 参数 / 选项 | 必填 | 说明 |
|-------------|------|------|
| `slug` | **是** | 变更提案 slug（`logos/changes/` 下的目录）。存在 guard 时须与 `logos/.openlogos-guard` 的 `activeChange` 一致。 |
| `--format json` | 否 | 在 stdout 输出 JSON envelope（进度行改走 stderr）。失败时 stderr 最后一行是带稳定错误码的错误 envelope。 |

## 执行过程

一次调用内按顺序完成：

1. **崩溃恢复**——上次运行若被中断，先把残留的恢复材料收敛到一致态（全旧或全新）。
2. **`[code]` 自动重置**——在 spec-complete 之前提前填写的 `[code]` 切片会被重置为空标题，旧内容备份到 `CODE_AUTORESET`。切片在 merge 之后由 [`slice-planner`](/zh/skills/slice-planner) 规划。
3. **准入判定**——重跑一次完整的 [`openlogos change-lint`](/zh/cli/change-lint) 结论。有任何违规即在写入前拒绝，并逐条打印错误码、路径与修复建议。
4. **解析 delta**——目标集由 `deltas/` 派生：每个可合并 delta 唯一对应一个 canonical target。目标已存在即修改，不存在即新建。
5. **按章节锚合成**——每个 `ADDED` / `MODIFIED` / `REMOVED`（以及 `REMOVED-ITEMS`）块作用于其标题锚定的章节。锚解析到 0 处或多处一律拒绝；可用标题路径（`父级 > 子级`）或序数后缀（`标题 [2]`）消歧。
6. **原子落盘**——全部合成后的目标一次性写入（临时文件 + fsync + rename）。
7. **最后写 `SPEC_MERGED`**——标记作为最后一步写入，记录结构化的 `test_change_set`（由测试规格语义差异得出的变更 / 删除测试 ID）以及供后续增量修正使用的合并基线。

### delta 与目标的映射

| Delta 类别 | 目标目录 |
|-----------|---------|
| `deltas/prd/` | `logos/resources/prd/` |
| `deltas/api/` | `logos/resources/api/` |
| `deltas/database/` | `logos/resources/database/` |
| `deltas/scenario/` | `logos/resources/scenario/` |
| `deltas/test/` | `logos/resources/test/` |

嵌套路径原样保留：`deltas/prd/3-technical-plan/1-architecture/core-01-architecture.md` → `logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture.md`。

### delta 文件格式

```markdown
## ADDED — 新章节标题
[完整的新内容]

## MODIFIED — 已有章节标题
[整节的完整替换内容]

## REMOVED — 要删除的章节标题
[删除原因]
```

`MODIFIED` 块的替换范围是锚定章节到下一个同级或更高级标题为止，不是整份文档；整篇改写多个同级章节时，每个章节各写一个 `MODIFIED` 块。`MODIFIED` 章节内未变更的结构化 ID（测试 ID、场景 ID、编号小节）必须原样带上；只删除部分条目时写成 `MODIFIED`（剩余全量内容）+ `REMOVED-ITEMS`（点名被删 ID）。

### 无 delta 的提案

没有 delta 文件的纯代码提案同样要执行 `openlogos merge <slug>`：命令写入 `type:"no_delta_spec_complete"` 的 `SPEC_MERGED`。这就是 spec-complete 步骤；在它写入之前，`status` / `next` 报告 `spec-complete-required`。

## 输出示例

```
📋 合并摘要：
  - 变更提案：add-remember-me
  - Delta 文件：3 个
    → logos/resources/prd/1-product-requirements/core-01-requirements.md
    → logos/resources/api/core-auth.yaml
    → logos/resources/test/core-S02-test-cases.md

  ✓ logos/changes/add-remember-me/SPEC_MERGED（3 个 canonical target 一次性原子落盘）
  test_change_set: C=4 R=0
```

使用 `--format json` 时，`data.result` 为 `"merged"`，envelope 携带 `target_count`、`targets`、`spec_merged_path`、`test_change_set` 与 `delta_digest`。

合并成功后 AI 自动提交规格变更，下一步是切片规划：由 `slice-planner` 产出 `slices.json` 并执行 [`openlogos slice plan --file <slices.json>`](/zh/cli/slice)。

## 已合并提案的增量修正

已合并的提案修改了 delta 后再次执行 `openlogos merge <slug>`，命令会按记录的合并基线做**增量修正**，而不是报错：

| 情形 | 结果 |
|------|------|
| delta 自上次合并后未变 | 幂等，不做任何事，`result:"already-merged"`，exit 0 |
| delta 有变化 | 从合并基线重新合成全部目标、重算 `test_change_set`、原子落盘、改写 `SPEC_MERGED`——`result:"amended"` |

增量修正会报告重修、新增、撤回的目标数（JSON 中为 `amend.targets_recomposed` / `targets_added` / `targets_restored`）。它不动 `[code]`、`SLICES_APPROVED` 与切片清单，但会**清除验收与交付标记**（`VERIFY_PASS`、`VERIFY_FAIL`、`DEPLOY_DONE`、`SMOKE_PASS`、`SMOKE_FAIL`，列在 `invalidated_markers` 中）——修正后的规格必须重新 verify（需部署的提案还要重新部署与 smoke）。

`openlogos status --format json` 提供只读投影 `modules[].active_change.spec_amend`（`pending`、`blocked_reason`、`amend_count` 与 delta 摘要），工具据此判断是否有待应用的修正，无需自己比较字节。

以下情形**拒绝**修正（不写任何东西）：

| 错误码 | 原因 | 处置 |
|--------|------|------|
| `MERGE_AMEND_DRIFT` | 上次合并后有目标主文档被手工修改 | 用 `git diff` 核对点名的文件，确定保留哪份修改，再另立新提案承载修正。不要用 checkout 类命令覆盖未提交的改动。 |
| `MERGE_AMEND_BASELINE_MISSING` / `MERGE_AMEND_BASELINE_UNREADABLE` | `SPEC_MERGED` 没有可用的合并基线（如旧版本合并的提案） | 保持本提案现状，另立新提案承载修正。 |
| `MERGE_AMEND_CREATE_WITHDRAW` | delta 不再覆盖首次合并时新建的文件 | 恢复对应 delta，或另立新提案删除该文件。 |
| `MERGE_AMEND_PROTOTYPE_UNSUPPORTED` | 合并后 GUI 原型资产有变化 | 原型变化走新提案。 |

## 合并失败时

每次失败都会打印稳定错误码、状态声明与后续动作，并以非零退出。状态声明分三档——先看清是哪一档再动手：

| 档位 | 声明 | 含义 | 处置 |
|------|------|------|------|
| **未写入** | 未进入写入阶段 | 在写入前被拒（准入、非法 delta、锚找不到、guard 不一致） | 按诊断修 delta，重跑 `openlogos merge <slug>` |
| **已整批回滚** | 落盘中途失败，已整批回滚 | `logos/resources/` 恢复为合并前字节，未写 `SPEC_MERGED`（增量修正时：保留上一次合并的状态） | 排除原因（IO、权限、delta）后重跑 |
| **可能已提交** | 状态不可确认 | 目标可能已是新字节，`SPEC_MERGED` 可能已写入 | 先核对 `git status`、`git diff logos/resources/` 以及 `SPEC_MERGED` 是否在场，核对前不要直接重跑 |

不要手工改主文档、marker、计数器或 resource index 来「补完」失败的合并——修 delta、重跑命令是唯一受支持的路径。

| 错误码 | 原因 |
|--------|------|
| `MERGE_ADMISSION_REJECTED` | `change-lint` 报告违规；运行 `openlogos change-lint --slug <slug>` 查看 |
| `MERGE_DELTA_INVALID` | 缺段标记、残留模板占位，或锚解析到 0 处 / 多处 |
| `MERGE_TARGET_MISMATCH` | `tasks.md` 规划的目标与实际 `deltas/` 不一致 |
| `MERGE_APPLY_FAILED` | 原子落盘失败（已回滚） |
| `MERGE_NO_ACTIVE_CHANGE` | 提案目录不存在 |

其他错误：`Missing change proposal name`（未给 slug）、`Change proposal 'X' not found`、活跃 guard 指向另一个提案、`logos/logos.config.json not found`（不在项目根目录）。

## 从旧版迁移

以下内容已在 0.15.0 移除——旧路径 → 新路径：

- **不再生成 `MERGE_PROMPT.md`。** 旧：`openlogos merge` 写出 `MERGE_PROMPT.md`，由 AI 手工应用 delta 后再写 `SPEC_MERGED`。新：`openlogos merge <slug>` 自己完成全部合并并写 `SPEC_MERGED`。提案目录里残留的 `MERGE_PROMPT.md` 是历史产物，不要据它合并，直接运行 `openlogos merge <slug>` 即可。
- **`openlogos merge-apply` 已移除。** 旧：单独的 apply 步骤。新：并入同一次 `openlogos merge` 调用。
- **`openlogos merge transaction *` 已移除**（`status` / `submit-content` / `seal` / `apply` / `recover` / `abort` / `reopen`）。新：没有事务相位；失败时按状态档位报告，修复后重跑同一条命令。
- **修改 delta 后重新合并。** 旧：手工回滚主文档并删除标记。新：直接重跑 `openlogos merge <slug>`，按增量修正处理（`result:"amended"`）。

## 相关命令

- [`change`](/zh/cli/change) — 创建提案与 delta 目录结构
- [`change-lint`](/zh/cli/change-lint) — 与 merge 准入同源的检查，申请合并前先跑
- [`slice`](/zh/cli/slice) — 下一步：基于已合并规格规划 `[code]` 切片
- [`status`](/zh/cli/status) — 展示 `proposal_step` 与 `spec_amend` 投影
- [`archive`](/zh/cli/archive) — verify（以及部署 / smoke）之后的最后一步
