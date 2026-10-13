---
title: "openlogos slice"
description: 一次受校验的调用写出 launched 变更的 [code] 切片与 TEST_SLICE_MANIFEST.json。
---

`openlogos slice plan` 是为活跃变更写入 `tasks.md` 的 `## [code]` 段与 `TEST_SLICE_MANIFEST.json` 的唯一入口。你（或 [slice-planner](/zh/skills/slice-planner) Skill）把切片写成结构化的 `slices.json`，CLI 校验输入后，在一次调用内写出这两个产物。

没有切片事务：没有 content slot，没有 seal / apply / recover / abort / reopen 等步骤，也没有相位。初次规划、重新划分与恢复都是同一条命令。

> `openlogos --help` 目前没有列出 `slice`，但 0.16.0 中该命令可以正常使用。

## 命令格式

```bash
openlogos slice plan --file <slices.json>
openlogos slice plan --file <slices.json> --slug <slug>
openlogos slice plan --file <slices.json> --format json
```

在项目根目录运行。时机是变更已 merge（存在 `SPEC_MERGED`）之后、开始实现之前。

## 选项

| 选项 | 说明 |
|------|------|
| `--file <slices.json>` | 必填。结构化切片输入文件，项目根相对路径或绝对路径。 |
| `--slug <slug>` | 目标提案，默认取 `logos/.openlogos-guard` 中的活跃变更。 |
| `--format json` | 输出 JSON 信封（`command: "slice plan"`）。 |

## 输入：`slices.json`

可以是切片数组，也可以是含 `slices` 数组的对象：

```json
{
  "slices": [
    {
      "slice_id": "slice-01-order-api",
      "task_text": "订单 API 端到端：handler + DAO + UT/ST + reporter（覆盖 UT-S01-01、ST-S01-01）",
      "owned_test_ids": ["UT-S01-01", "ST-S01-01"],
      "runner_selectors": ["UT-S01-01", "ST-S01-01"],
      "spec_targets": ["logos/resources/test/core-S01-test-cases.md"]
    },
    {
      "slice_id": "slice-02-order-panel",
      "task_text": "订单面板端到端：组件 + UT/ST + reporter（覆盖 UT-S02-10、ST-S02-03）",
      "owned_test_ids": ["UT-S02-10", "ST-S02-03"],
      "runner_selectors": ["UT-S02-10", "ST-S02-03"],
      "spec_targets": ["logos/resources/test/core-S02-test-cases.md"]
    }
  ]
}
```

| 字段 | 规则 |
|------|------|
| `slice_id` | 稳定切片身份：小写 kebab-case，3～64 个字符（`^[a-z0-9][a-z0-9-]{2,63}$`），提案内唯一。推荐 `slice-<两位序号>-<短名>`。 |
| `task_text` | `[code]` 段中该 checkbox 行的文本，按原样写入，不能为空。末尾标注该片覆盖的真实测试 ID。 |
| `owned_test_ids` | 非空。来自已合并测试规格的真实 UT/ST/SMOKE ID。本变更新增或修改的每个测试 ID 必须**恰好**归属一个切片；禁止占位、通配和不存在的 ID。 |
| `runner_selectors` | 非空。能让测试运行器执行该片所属测试的 selector。 |
| `spec_targets` | 非空。该片依赖的**已合并测试规格文件**的项目根相对路径，必须位于 `logos/resources/test/` 下且存在；绝对路径与 `..` 会被拒绝。 |

不要在输入中提供 `schema`、`change`、`module`、`task_fingerprint`、`spec_fingerprint`、`generated_at`。这些由 CLI 写入，指纹一律依据它即将写出的 `tasks.md` 计算。

**两片及以上**、且每条 `task_text` 都提及至少一个真实测试 ID 时，verify 进入切片感知模式（先切片 checkpoint，最后全量验收）。单切片同样合法，此时 verify 照常做全量验收，manifest 不影响结果。

## 行为

1. 解析目标提案（`--slug` 或活跃 guard），确认 `tasks.md` 存在。
2. 检查输入形状：合法 JSON、`slices` 为非空数组、各字段类型正确。
3. 渲染新的 `[code]` 正文：按输入顺序，每片一行 `- [ ] <task_text>`。`## [code]` 标题保留，其下正文整体替换；`[delta]`、`[deploy]` 及其勾选状态逐字节不变。
4. 生成 manifest，计算 `task_fingerprint` / `spec_fingerprint`。
5. **先校验、后写入。** 两个产物先写成提案目录下的临时文件，再用与 `verify`、`status`、`next` 相同的校验器整体判定。校验通过才把两个临时文件原子替换为正式文件；任何失败都会删除临时文件，`tasks.md` 与 `TEST_SLICE_MANIFEST.json` 保持调用前的字节。不存在半写状态，也没有需要清理的中间态。

本命令不触碰 `SLICES_APPROVED` 与 `SLICE_CHECKPOINTS.jsonl`。

不要手工编辑 `[code]` 段或 manifest：它们是 verify 的判定输入，只能由本命令写出。切片理由（删后续证伪门结论）写进 `task_text`，或直接向用户说明，不要手工加进 `[code]`。

### 勾选保留规则

按 `slice_id` 逐条判断：`task_text` 与之前**逐字相同**的切片，沿用原来的 `[x]` / `[ ]` 状态；文本改了或是新增切片，写为未勾选。之前的文本取自旧 manifest；旧 manifest 缺失或不可读时，退化为在旧 `[code]` 段中查找同文本条目。同一文本出现多次且状态不一致时，按未勾选处理。该规则没有开关，也不需要手工恢复勾选。

## 恢复与重新划分

- **manifest 缺失、非法或过期**（`openlogos next` 指向 `plan-slices`，或 verify 以 `test-slice-manifest-*` 暂停）：用**同一份输入**重跑 `openlogos slice plan --file <slices.json>`。切片身份不变，已完成切片的勾选保留，已记录的切片 checkpoint 继续有效。
- **切片划分本身有误**：修改 `slices.json` 后重跑同一命令。`task_text` 被改写的切片重置为未勾选；旧划分下记录的 checkpoint 不再采信。
- 不要为了「腾位」或「触发恢复」去删除、改名 `TEST_SLICE_MANIFEST.json`，直接重跑命令即可。

## 输出

```
✓ 切片规划已写入 add-order-flow
  切片数：2
    - slice-01-order-api
    - slice-02-order-panel
  manifest：logos/changes/add-order-flow/TEST_SLICE_MANIFEST.json
  task_fingerprint：sha256:5f2f…c9bb

下一步：批准切片划分（slice-exit）后开始实现代码。
```

使用 `--format json` 时，`data` 包含 `slug`、`slice_count`、`slice_ids`、`task_fingerprint`、`spec_fingerprint`、`manifest_path`。

命令成功后，从磁盘读回 `[code]` 段确认落盘，再在 `slice-exit` 门确认切片划分，然后开始实现。

## 错误

| 错误码 | 退出码 | 原因 |
|--------|--------|------|
| `SLICE_PLAN_NO_ACTIVE_CHANGE` | 1 | 没有活跃变更、提案目录不存在，或缺少 `tasks.md` |
| `SLICE_PLAN_INPUT_INVALID` | 1 | 文件不存在、不是合法 JSON、缺少非空 `slices` 数组，或字段类型错误 |
| `SLICE_PLAN_DUPLICATE_SLICE_ID` | 1 | 两片使用了同一个 `slice_id` |
| `SLICE_PLAN_UNKNOWN_TEST_ID` | 1 | 所属 ID 不在已合并规格中或不属于本提案的变更；有变更 ID 未被任何切片拥有；或一个 ID 被多片拥有 |
| `SLICE_PLAN_ARTIFACT_INVALID` | 2 | 校验器的其他违规，如 `slice_id` 格式非法、`task_text` 或数组为空、`spec_targets` 不在 `logos/resources/test/` 下 |

校验器拒绝时，会逐条打印违规项的 `code`、`path`（如 `slices[1].spec_targets[0]`）、`message` 和 `fix_hint`，并说明两个产物均未落盘。JSON 模式下，stderr 上的错误信封在 `violations` 中带出同一组明细。按提示修改 `slices.json` 后重跑即可。

`openlogos slice` 不带 `plan`、或 `plan` 不带 `--file` 时，打印用法并以退出码 `1` 退出。

## 相关

- [slice-planner Skill](/zh/skills/slice-planner)：如何切片
- [切片规划规范](/zh/specs/slice-planner)：切片规则与 `slice-exit` 门
- [测试切片清单](/zh/specs/test-slice-manifest)：manifest 格式、checkpoint 与恢复
- [`verify`](/zh/cli/verify)：切片 checkpoint 与最终全量验收（Gate 3.6）
- [`merge`](/zh/cli/merge)：规划切片前必须已完成
