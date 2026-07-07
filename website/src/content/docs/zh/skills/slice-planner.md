---
title: slice-planner
description: 在 spec-complete 后，基于已合并规格与真实测试 ID 规划 launched 变更的 [code] 切片。
---

`slice-planner` Skill 用在 launched 变更完成 spec-complete 之后、开始代码实现之前。它只写 `tasks.md` 的 `## [code]` section；不产 delta，也不写业务代码。

## 何时使用

- `openlogos next --format json` 返回 `proposal_step=="ready-to-implement"` 且 `next_node.id=="plan-slices"`。
- 活跃提案已有 `SPEC_MERGED` 或 `MERGED`。
- 已能从合并后的测试文档、proposal 文本或显式复用声明中获得真实 `UT-*` / `ST-*` / `SMOKE-*` ID。

纯代码 no-delta 提案也必须先执行 `openlogos merge <slug>`。该 no-op merge 会写入带 `type:"no_delta_spec_complete"` 的 `SPEC_MERGED`。缺少该 marker 时，正确状态是 `spec-complete-required`，不是 `plan-slices`。spec-complete 后若缺测试 ID，正确状态是 `test-id-required`。

## 产出

更新 `logos/changes/<slug>/tasks.md`，写入良构 `[code]` 切片。每片必须自闭环：业务代码 + 测试 + OpenLogos reporter + 必要 golden/smoke 证据，并在每行末尾标注覆盖的真实用例 ID。

完整切片规则见 [切片规划](/zh/specs/slice-planner)。
