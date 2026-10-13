---
title: slice-planner
description: merge 后基于已合并规格与真实测试 ID 规划 launched 变更的 [code] 切片，并用 openlogos slice plan 落盘。
---

`slice-planner` Skill 用在 launched 变更 merge 之后、开始写代码之前。它把已合并规格拆成良构的 `[code]` 切片，是切片的**唯一事实源**：切几片、每片做什么，只在这里决定一次。下游的 [`code-implementor`](/zh/skills/code-implementor) 逐行消费这些切片，不再重新打分或自行分批。

本 Skill 产出结构化的 `slices.json`，由 [`openlogos slice plan`](/zh/cli/slice) 写入 `tasks.md` 的 `## [code]` 段与 `TEST_SLICE_MANIFEST.json`。它不产 delta，不写业务代码，也绝不手工编辑这两个产物。

## 触发条件

- `openlogos next` 返回 `proposal_step == "ready-to-implement"` 且 `next_node.id == "plan-slices"`，并且没有 `gate_id`（宿主注入「规划切片」上下文）。
- `next_node.id == "plan-slices"`，原因为 `test-slice-manifest-missing` / `-invalid` / `-stale`（manifest 恢复）。
- merge 完成后，用户说「划分切片」「写 `[code]`」「规划实现任务」。

如果 `next_node` 同时带有 `gate_id: "slice-exit"`，说明切片已规划、正等待批准，不要再次运行本 Skill。

## 前置条件

1. 活跃提案已有 `SPEC_MERGED`（或 `MERGED`）。没有 `[delta]` 的纯代码提案也必须先执行 `openlogos merge <slug>`，由这次 no-delta merge 写入带 `type: "no_delta_spec_complete"` 的 `SPEC_MERGED`。缺少该 marker 时，状态是 `spec-complete-required`，而不是 `plan-slices`。
2. 规格 delta 已合并进主文档，或 no-delta marker 已记录本次无需文档 delta。
3. **已有真实测试 ID**：已合并的 `logos/resources/test/*-test-cases.md`（或显式复用声明）中有真实的 `UT-*` / `ST-*` / `SMOKE-*` ID。spec-complete 后仍缺测试 ID 时，状态是 `test-id-required`。

禁止用占位 ID 切片。前置条件不满足时停止，并提示用户先完成 merge 或补齐测试 ID。

## 执行步骤

完整规则见 [切片规划规范](/zh/specs/slice-planner)，要点如下：

1. **读已合并规格与真实测试 ID。** 读提案范围、已合并的架构 / 场景 / 功能规格与测试用例文件，列出要落地的能力与可用 ID。
2. **六维打分。** 影响范围、行为复杂度、契约变化、测试规模、风险等级、不确定性，每项 0～2 分。**0～7 分：单切片**；**8 分及以上：尝试垂直拆分**。
3. **垂直/横向判别器。** 每片必须是一条端到端能力线、一个场景或一个子模块的完整闭环。「地基」「管道」「helper」「schema」「写测试」「补 reporter」「仅 UI」这类片名是横向红旗，命中即重切。
4. **删后续证伪门。** 对每片 i 自问两题：(a) 删掉切片 i+1..N 后 verify 能否变绿？(b) 切片 i 是否交付了端到端、可观察的能力？任一为「否」，就把它向前合并进依赖它的那一片，再重跑本门。
5. **逃生口。** 评分 ≥8 但没有任何垂直切法能过本门时，保留单切片并写明原因。不确定时一律合并。
6. **确定每个切片。** 每片自闭环：业务代码 + 该片 UT/ST + OpenLogos reporter + 必要的 golden baseline；排序保证不依赖后续切片；`task_text` 末尾标注覆盖的真实 ID。提案改动了 smoke 用例时，切片还要列出新增 `SMOKE-*` ID，并要求实现 runner、写 `smoke-results.jsonl` reporter、接入配置、跑 smoke 覆盖预检。
7. **写 `slices.json` 并执行命令。**

```bash
openlogos slice plan --file slices.json
```

成功后从磁盘读回 `[code]` 段，向用户展示原文。失败时每条违规都会列出 `code`、`path` 与 `fix_hint`，且不写入任何内容；修改 `slices.json` 后重跑即可。

## `slices.json`

```json
{
  "slices": [
    {
      "slice_id": "slice-01-capability",
      "task_text": "端到端能力切片：实现 X 并同步 UT/ST + reporter（覆盖 UT-S01-01、ST-S01-01）",
      "owned_test_ids": ["UT-S01-01", "ST-S01-01"],
      "runner_selectors": ["UT-S01-01", "ST-S01-01"],
      "spec_targets": ["logos/resources/test/core-S01-test-cases.md"]
    }
  ]
}
```

| 字段 | 内容 |
|------|------|
| `slice_id` | 稳定、kebab-case、提案内唯一；推荐 `slice-<两位序号>-<短名>` |
| `task_text` | `[code]` 条目文本，末尾标注覆盖的真实 ID |
| `owned_test_ids` | 本变更新增或修改的每个测试 ID 恰好归属一片；禁止占位、通配与不存在的 ID |
| `runner_selectors` | 非空，能执行该片所属测试的 selector |
| `spec_targets` | `logos/resources/test/` 下的已合并测试规格文件 |

不要提供指纹、`schema`、`change`、`module`、`generated_at`，这些由命令写入。

## 恢复模式

当 `openlogos next` 因 manifest 缺失、非法或过期而要求 `plan-slices` 时：

- **不要重新打分或重新切片。** 切片划分没有问题，坏的只是 manifest。沿用旧的 `slice_id` 与 `task_text`（从旧 manifest 读取，或按现有 `[code]` 条目的顺序重建）。
- 用同一份输入重跑 `openlogos slice plan --file <slices.json>`。未改动的切片保留勾选，已有 checkpoint 继续有效，不要手工补回 `[x]`。
- 不要删除或改名 `TEST_SLICE_MANIFEST.json`，不要编辑 `SLICE_CHECKPOINTS.jsonl` 或 `SLICES_APPROVED`。
- 某个 ID 无法唯一归属时，报告歧义并停止，不做猜测。

切片划分确实有误时，修改 `slices.json` 后重跑同一命令即可；文本被改写的切片会重置为未勾选。

## 产物

| 产物 | 写入者 |
|------|--------|
| `slices.json`（输入文件，路径自定） | 本 Skill |
| `logos/changes/<slug>/tasks.md` 的 `## [code]` 段 | `openlogos slice plan` |
| `logos/changes/<slug>/TEST_SLICE_MANIFEST.json` | `openlogos slice plan` |

`proposal.md`、`[delta]`、`[deploy]` 逐字节不变。

切片写出后，告诉用户切片已就绪，`slice-exit` 门批准后即可进入实现。`openlogos next --auto` 模式下该门会自动放行，并写入 `SLICES_APPROVED`。

## 推荐提示词

```text
请按 slice-planner 规划本提案的 [code] 切片：先读已合并规格与真实测试 ID，六维打分，再用垂直/横向判别器与删后续证伪门逐片自检并写出结论，拆不开就显式单切。把结果写成结构化 slices.json（slice_id / task_text / owned_test_ids / runner_selectors / spec_targets），执行 openlogos slice plan --file <slices.json> 落盘，并读回 [code] 段确认。
```

## 相关

- [`openlogos slice`](/zh/cli/slice)：写出 `[code]` 与 manifest 的命令
- [切片规划规范](/zh/specs/slice-planner)：完整切片规则
- [测试切片清单](/zh/specs/test-slice-manifest)：manifest、checkpoint 与恢复
- 上一步：[`merge-executor`](/zh/skills/merge-executor) / [`openlogos merge`](/zh/cli/merge)
- 下一步：[`code-implementor`](/zh/skills/code-implementor)：逐片实现切片
