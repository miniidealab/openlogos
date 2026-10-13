---
title: 测试切片清单
description: TEST_SLICE_MANIFEST.json、切片 checkpoint 账本，以及 verify 如何据此做切片增量验收与最终全量验收。
---

`TEST_SLICE_MANIFEST.json` 记录 launched 变更中每个 `[code]` 切片拥有哪些测试 ID。`openlogos verify` 据此对多切片变更**逐片验收**（切片 checkpoint），全部切片完成后再做一次全量验收。本页是该协议的摘要，命令用法见 [`openlogos slice`](/zh/cli/slice)。

## 适用范围

适用于活跃的 launched 提案，条件是 `[code]` 段有**两片及以上**、且每条切片都提及至少一个真实测试 ID。单切片提案、纯文档提案，以及已经通过最终 verify 的旧提案，照常走全量 verify；对它们而言，即使 manifest 在场也不影响结果。

## 文件与写入者

以下文件都位于 `logos/changes/<slug>/`。

| 文件 | 写入者 | 方式 |
|------|--------|------|
| `SPEC_MERGED` 中的 `test_change_set` | `openlogos merge` | 依据已合并测试规格前后的语义差异，记录本变更新增或修改（C）、删除（R）的测试 ID |
| `tasks.md` 的 `## [code]` 段 | `openlogos slice plan` | 整节替换；`task_text` 未变的切片保留勾选；`[delta]` / `[deploy]` 不动 |
| `TEST_SLICE_MANIFEST.json` | `openlogos slice plan` | 与 `[code]` 在同一次调用内写出；先校验，再原子替换 |
| `SLICE_CHECKPOINTS.jsonl` | `openlogos verify` | 只追加；每行一条切片 checkpoint 结果 |
| `LOOP_ITERS` | `openlogos verify` | 只追加；只记录真实的门禁尝试 |
| `VERIFY_PASS` / `VERIFY_FAIL` | `openlogos verify` | `VERIFY_PASS` 只在最终验收通过时写 |

[slice-planner](/zh/skills/slice-planner) Skill 以结构化 `slices.json` **产出**切片内容，但不**写入**上述文件。宿主与 Agent 不得手工写 manifest、checkpoint 或 marker，也不得从 `[code]` 正文反推切片归属。归属只认 manifest 中的 `owned_test_ids`。

## Manifest 格式（v1）

```json
{
  "schema": "openlogos/test-slice-manifest@1",
  "change": "add-order-flow",
  "module": "core",
  "task_fingerprint": "sha256:5f2f8f53…c5c9bb",
  "spec_fingerprint": "sha256:c2fda0fb…01bf29",
  "generated_at": "2026-08-15T00:00:00.000Z",
  "slices": [
    {
      "slice_id": "slice-01-order-api",
      "task_text": "订单 API 端到端：handler + DAO + UT/ST + reporter（覆盖 UT-S01-01、ST-S01-01）",
      "owned_test_ids": ["ST-S01-01", "UT-S01-01"],
      "runner_selectors": ["UT-S01-01", "ST-S01-01"],
      "spec_targets": ["logos/resources/test/core-S01-test-cases.md"]
    }
  ]
}
```

| 字段 | 含义 |
|------|------|
| `schema` | 精确为 `openlogos/test-slice-manifest@1`。主版本未知时判为 `unsupported`，不会被覆盖，也不做降级解析。 |
| `change`、`module` | 必须与活跃 guard 一致 |
| `task_fingerprint` | 对结构化 `[code]` 段（任务文本及顺序）求 SHA-256；勾选状态、列表标记与空白不参与 |
| `spec_fingerprint` | 对全部 `spec_targets` 文件按路径排序、行尾统一为 LF 后求 SHA-256 |
| `generated_at` | 仅作审计，不参与任何指纹或身份 |
| `slices[]` | 非空，顺序与 `[code]` 一致。每项含 `slice_id`（`^[a-z0-9][a-z0-9-]{2,63}$`，唯一）、`task_text`、`owned_test_ids`、`runner_selectors`、`spec_targets`（`logos/resources/test/` 下的已合并测试规格路径） |

两个指纹都由 CLI 依据它自己写出的文件计算，不接受外部输入。

## 归属规则

设 **D** 为已合并规格中定义的全部测试 ID，**C** 为本变更新增或修改的 ID，**R** 为本变更删除的 ID，**B = D − C** 为未改动的基线：

- 所有 `owned_test_ids` 的并集恰好等于 **C**：每个变更 ID 恰好归属一次，未改动的基线 ID 不得被归属。
- 一个 ID 不得被两片同时拥有；每个所属 ID 只在一个规格文件中定义。
- 删除的 ID 只属于 R，不会出现在 owned、eligible、pending 或 uncovered 中。
- 某个测试无法唯一归属到一片时，以 `test-slice-assignment-ambiguous` 停止，不做猜测。

原样带入最终规格的测试行属于 B，即使它出现在测试 delta 里。

## verify 如何使用

设 **P** 为已有有效 PASS checkpoint 的切片集合，**A** 为按 manifest 顺序第一个不在 P 中的切片。

| 状态 | `verify_mode` | 验收范围（eligible） | pending |
|------|---------------|----------------------|---------|
| 存在 A | `slice-checkpoint` | B + owned(P) + owned(A) | C 的其余部分 |
| 不存在 A 且 `[code]` 已全部完成 | `final` | 全部 D | 无 |

- checkpoint 对 eligible 集合执行 Gate 3.6 的常规判定（账本一致、零失败、零未覆盖）。**PASS** 追加 checkpoint 行，不写 `VERIFY_PASS`；**FAIL** 写 `VERIFY_FAIL`，并追加带 `verify_mode` 与 `attempted_slice_id` 的 `LOOP_ITERS` 行。
- pending 不是结果状态：既不算未覆盖，也不算失败。运行器如果输出了 pending ID，账本判为不一致（`result_outside_eligible_scope`）。
- 只有 **final** PASS 才写 `VERIFY_PASS`。

切片感知运行期间，verify 通过环境变量 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS`（JSON 数组）把 eligible ID 传给预跑命令，运行器可以据此收窄执行范围。

## checkpoint 账本

`SLICE_CHECKPOINTS.jsonl` 每行一个 JSON 对象：

```json
{"schema":"openlogos/slice-checkpoint@2","slice_id":"slice-01-order-api","manifest_sha256":"sha256:3b2f…daef","result":"PASS","eligible_test_ids_sha256":"sha256:ae3f…5c95","timestamp":"2026-08-15T00:10:00.000Z"}
```

- `manifest_sha256` 标识这一行属于**哪一份切片划分**：对 manifest 的判定实质（`schema`、`change`、`module`、`slices`、`task_fingerprint`、`spec_fingerprint`）求哈希，不含 `generated_at`。
- 只有身份与当前 manifest 一致、且 `result` 为 `PASS` 的行才算确认。重复的等价 PASS 不会重复追加。
- 旧的 `@1` 行按其原规则读取；未知主版本的行直接忽略。账本永不改写。

由此产生的结果：

| 情形 | 身份 | 已有 checkpoint |
|------|------|-----------------|
| 恢复：用同一份 `slices.json` 重跑 | 不变 | 继续有效，verify 从第一个未确认切片继续 |
| 重新划分：`slices` 改变 | 改变 | 不再采信 |
| 已合并测试规格变化（`spec_fingerprint`） | 改变 | 不再采信 |

## 诊断与恢复

verify、`status`、`next` 共用同一个校验器，它在任何测试命令启动之前运行：先校验测试变更集，再校验 manifest。

| 诊断码 | 含义 | 恢复 |
|--------|------|------|
| `test-change-set-missing` / `-invalid` / `-unsupported` / `-tampered` | `SPEC_MERGED` 中的 `test_change_set` 缺失、非法、版本未知，或与规格文件当前内容不一致 | 不能自动恢复，回到 merge 或人工处理 |
| `test-slice-manifest-missing` | 多切片实现阶段缺少 manifest | 重跑 `openlogos slice plan` |
| `test-slice-manifest-invalid` | schema、字段或路径不合法 | 修改 `slices.json` 后重跑 |
| `test-slice-manifest-stale` | `[code]` 或规格指纹不再匹配 | 重跑 `openlogos slice plan` |
| `test-slice-manifest-unsupported` | manifest 主版本未知 | 不能自动恢复 |
| `test-slice-id-duplicate` | `slice_id` 重复 | 修正后重跑 |
| `test-slice-test-id-missing` / `-unknown` | 有变更 ID 未被归属，或所属 ID 不是本提案的变更 / 未定义 | 修正后重跑 |
| `test-slice-test-id-duplicate`、`test-slice-assignment-ambiguous` | 一个 ID 有多个归属，或无法确定唯一归属 | 先消除歧义，再重跑 |
| `slice-task-state-inconsistent` | 事实互相矛盾，如 checkpoint 全部通过但仍有任务未勾选 | 修正任务状态 |

当 manifest 缺失、非法或过期**且**测试变更集有效时，`openlogos next` 返回 `next_node.id = "plan-slices"`、`skill: slice-planner`。恢复动作始终相同：用同一份输入重跑 `openlogos slice plan --file <slices.json>`。没有恢复事务、恢复相位，也没有 `--recover` 开关。已完成切片保留勾选与 checkpoint，`SLICES_APPROVED` 不受影响。

测试变更集本身损坏时，OpenLogos 保持在 merge / spec-complete 阶段阻塞，不会派发切片规划。

不要为了让提案「解卡」去删除或改名 `TEST_SLICE_MANIFEST.json`、手工编辑 `[code]`，或伪造 checkpoint 行。

## 安全

- 每条违规都带 `code`、`path`、`message`、`fix_hint`，顺序稳定，不会被折叠为一句摘要。
- 路径必须位于提案目录或声明的测试规格内；绝对路径、`..` 与逃逸 symlink 一律拒绝。
- 这些文件只保存 ID、哈希与状态，不含凭证、个人数据或测试输出正文。

## 相关

- [`openlogos slice`](/zh/cli/slice)：写出 `[code]` 与 manifest
- [`openlogos verify`](/zh/cli/verify)：切片 checkpoint 与最终全量验收（Gate 3.6）
- [切片规划](/zh/specs/slice-planner)：如何切片
- [CLI JSON 输出](/zh/specs/cli-json-output)：`slice_verification_state` 与 `contract.version`
