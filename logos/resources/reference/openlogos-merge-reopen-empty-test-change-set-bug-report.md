# Bug Report：merge transaction reopen 后幂等重合并使 SPEC_MERGED.test_change_set 为空，切片 owned_test_ids 被迫为空

> 发现于：cursor-adapter-parity 提案（0.14.17 现场，2026-09-05）｜severity：中（有规避，但削弱切片契约）｜**已修复**：提案 `fix-reopen-test-change-set-forward-merge`（0.14.20，2026-09-05 部署+smoke 通过；归档于 `logos/changes/archive/20260905-0422-fix-reopen-test-change-set-forward-merge/`，决策记录 D11）

## 现象

对 completed 合并事务执行 `openlogos merge transaction reopen` 后，若修正的 delta 只影响部分目标（其余目标幂等重放，before==after），重合并 apply 写入的 `SPEC_MERGED.test_change_set` 由**本次事务**的语义 before/after diff 计算——幂等目标全部算作零变化，`changed_test_ids` 为空（或严重缺失）。

下游影响链：

1. `validateTestSliceManifest` 强制 `owned_test_ids ⊆ changed_test_ids`（violation `test-slice-test-id-unknown`），空集下任何切片都不能 own 本提案真实新增的测试 ID；
2. slice-aware verify 失去按切片归属豁免未完成切片 ID 的能力，**多切片方案的「删后续全量 verify」必然无法成立**，切片规划被迫单切；
3. `TEST_SLICE_MANIFEST.json` 的 owned 维度失真（审计价值受损），只能以 `runner_selectors` 侧载真实 ID。

## 复现（cursor-adapter-parity 实际经历）

1. 提案首次 merge 全链 completed（`test_change_set` 含全部新增 UT/ST/SMOKE ID，本例 59 个）；
2. 发现某**非测试目标**（`spec/cursor-plugin.md` 章节标题混入控制注记）有误 → `reopen --confirm-spec-merged`（旧事务 `mtx_c76e632c…` 连 receipt 归档至 `merge-transactions/`，SPEC_MERGED 作废）；
3. 仅修正该目标的 delta，其余 delta 改写为幂等 MODIFIED（内容与已合并状态一致）；
4. 重跑 merge → submit → seal → apply：新 `SPEC_MERGED.test_change_set.changed_test_ids == []`（所有 test targets `before_sha256 == after_sha256`）；
5. `openlogos slice transaction` 规划切片：owned 任一真实新增 ID 均被判「owned_test_ids 含非本提案变更 ID」。

## 根因定位

- `cli/src/lib/test-change-set.ts` `buildTestChangeSet`：changed 判定 = after 记录在 before 中无字节等同者——只看当前事务快照对；
- `readTestChangeSet` 权威只认当前 `SPEC_MERGED.test_change_set`，无归档事务并集通道（且「归档 audit-only、禁作 fallback 真相源」契约禁止消费者自行读归档补齐）；
- `cli/src/lib/test-slice-manifest.ts` L477-483：`owned ⊆ changed` 双向强校验。

## 期望语义与修法方向

提案级 change set 应表达「**本提案**引入/修改了哪些测试 ID」，而非「最近一次事务改了哪些」。建议：reopen 重建的事务在 apply 写 `SPEC_MERGED` 时，由**核心受控**前滚合并归档事务（`merge-transactions/<old>.json` receipt 所携 change set）：changed 取并集、removed 按后写胜出。前滚发生在核心 apply 路径内，不违反归档 audit-only 契约（不是消费者读归档裁决）。

## 现场规避（修复落地前的操作建议）

- 任何 reopen 后的切片规划：直接按「显式单切 + `runner_selectors` 侧载真实 ID」处理，勿尝试多切片（删后续门必红）；
- 在 `[code]` 段删后续自检中留痕该边界（见 cursor-adapter-parity 提案 `tasks.md`）。

## 备注

- 0.14.17 §2.58 的 SMOKE-core-181 场景中修正 delta 恰好触及测试目标，故该边界未被安装态矩阵暴露；
- 关联记录：本仓曾开 GitHub issue #20（已按「本地 reference 记录即可」的决定关闭，内容与本文一致）。
