## MODIFIED — 2. 文件与写入者

| 文件 | 位置 | 唯一写入者 | 更新方式 |
|---|---|---|---|
| `SPEC_MERGED.test_change_set` | `logos/changes/<slug>/SPEC_MERGED` | `openlogos merge-apply` | 与 resources、metadata、marker 同一 baseline apply 事务；marker 最后写 |
| `TEST_SLICE_MANIFEST.json` | `logos/changes/<slug>/` | slice-planner | 临时文件校验后原子 rename |
| `SLICE_CHECKPOINTS.jsonl` | 同上 | `openlogos verify` | append-only；等价 PASS 幂等 |
| `LOOP_ITERS` | 同上 | `openlogos verify` | 仅真实 Gate 尝试 append |
| `VERIFY_PASS` / `VERIFY_FAIL` | 同上 | `openlogos verify` | 既有 marker 规则；PASS 仅 final |

`merge-apply` 必须在掌握 category=`test` canonical targets 的 before/final 字节时生成 change set；slice-planner、verify、status、next、change-lint、宿主和 code-implementor 均只读。verify、status、next、宿主和 code-implementor 禁止写 manifest；宿主禁止写 checkpoint/marker 或从 `tasks.md`、Delta、Git 建立影子 changed-ID 清单。

## MODIFIED — 5. 归属与集合不变量

设 `D` 为当前已合并测试规格中定义的全部真实 UT/ST/SMOKE ID；`C` 和 `R` 必须来自有效 `openlogos/test-change-set@1`：

- `C`：before/final 结构化记录对账后，新增或记录语义实际修改的 ID；
- `R`：before 存在而 final 不存在的 ID；
- `B = D − C`：未被本提案修改、在 final 中仍存在的 baseline 回归；
- `O`：所有 `owned_test_ids` 的并集。

```text
O = C
∀i≠j: owned(slice_i) ∩ owned(slice_j) = ∅
∀id∈O: id exists in exactly one spec_target
C ∩ R = ∅
R ∩ D = ∅
```

原样携带到 final 的测试记录即使出现在本提案触及的整份测试 Delta 中，也属于 B，不得进入 C。删除项只进入 R，不进入 owned、eligible、pending 或 uncovered；规范化记录包含正式 target 路径，因此同一 ID 跨 target 移动必须进入 C。一个测试跨能力线时仍须选择一个唯一 owning slice；无法唯一选择则 `test-slice-assignment-ambiguous`，不得猜测。

## MODIFIED — 8. Validator 与诊断码

validator 必须先通过 TestChangeSetReader 验证 change set，再验证 slice manifest，且全部发生在 runner 启动前：

| code | 条件 | 可自动恢复 |
|---|---|---|
| `test-change-set-missing` | `SPEC_MERGED` 类型要求 change set，但字段缺失 | 否；回到 merge/人工边界 |
| `test-change-set-invalid` | schema、精确字段、排序、集合、target identity 或 payload hash 非法 | 否 |
| `test-change-set-unsupported` | 未知 change-set 主版本 | 否 |
| `test-change-set-tampered` | target 当前字节与记录的 after hash 不一致 | 否 |
| `test-slice-manifest-missing` | 多切片 implement 缺文件 | 是，前提是 change set 有效 |
| `test-slice-manifest-invalid` | v1 schema/字段/路径/selector 非法 | 是，前提是 change set 有效且归属无歧义 |
| `test-slice-manifest-stale` | task/spec fingerprint 不匹配 | 是，前提是 change set 有效 |
| `test-slice-manifest-unsupported` | 未知主版本 | 否 |
| `test-slice-id-duplicate` | slice ID 重复 | 是 |
| `test-slice-test-id-missing` | C 中 ID 未归属 | 是 |
| `test-slice-test-id-duplicate` | 一个 ID 多重归属 | 否，需消歧 |
| `test-slice-test-id-unknown` | owned ID 不在 D 或不在 C | 是 |
| `test-slice-assignment-ambiguous` | 无唯一 owning slice | 否 |
| `slice-task-state-inconsistent` | checkpoint 全过但 task 未完成等 | 否，修复任务事实 |

只有 change set 有效时，slice-manifest 的可恢复状态才可输出 `plan-slices`。任何 change-set violation 都不得写 `VERIFY_FAIL`、checkpoint、`LOOP_ITERS`、tasks 或 manifest，不得启动 runner，也不得派 slice-planner。validator 输出全部 violation、精确字段路径和修复提示，结果排序稳定。

## MODIFIED — 9. 恢复动作合同

有效 change set + slice manifest missing/invalid/stale 时，OpenLogos 输出 `next_node.id=plan-slices`、`skill=slice-planner`、`dispatch.idempotent=true` 和 artifacts。slice-planner 恢复模式必须从同一 TestChangeSetReader 返回的 C/R 规划，保留 `[code]` 文本/顺序/checkbox、`SLICES_APPROVED` 和 checkpoint，仅重建 manifest。完全缺失时从规范化 tasks 确定性恢复 slice ID；无法保持身份则阻塞。

change set missing/invalid/unsupported/tampered 时，OpenLogos 必须保持人类可操作的 merge/spec-complete 阻塞前沿，返回对应结构化诊断，禁止伪装成 slice manifest 问题或派 `plan-slices`。RunLogos 只消费该 canonical 动作；宿主不得扫描 Delta、解析 Markdown 表格、调用 Git 或自行推导 C/R。

RunLogos 负责有界派发、重投和完成屏障；屏障必须再次调用 OpenLogos validator。成功后重新调用 canonical `next/verify`。宿主不得自行扫描缺失、解析 tasks 归属、写状态或把恢复次数计入 code repair budget。

## ADDED — 13. Canonical Test Change Set v1

### 13.1 位置、来源与严格字段

`SPEC_MERGED` 的 `test_change_set` 字段是唯一持久化测试变化事实，schema 精确为 `openlogos/test-change-set@1`。顶层必须恰含：

| 字段 | 类型 | 约束 |
|---|---|---|
| `schema` | string | 精确为 `openlogos/test-change-set@1` |
| `change` | string | 等于 guard slug 与 marker change |
| `module` | string | 等于 guard module 与 marker module |
| `source` | string | 必须逐字为 `semantic-before-after-diff` |
| `changed_test_ids` | string[] | C，去重 ASCII 升序 |
| `removed_test_ids` | string[] | R，去重 ASCII 升序 |
| `targets` | object[] | category=`test` 的 canonical target 身份，按 `target_path` ASCII 升序 |
| `sha256` | string | 下述 canonical payload 的 `sha256:` 小写十六进制 |

每个 `targets[]` 必须恰含 `target_path`、`before_sha256`、`after_sha256`。路径必须是项目根相对 POSIX canonical test target；哈希均为对应原始 UTF-8 文件字节 SHA-256，其中只有 CREATE 的 `before_sha256` 必须为 `null`。禁止时间戳、Git identity、Delta 路径或未声明字段。

`sha256` 的输入是移除顶层 `sha256` 后、按上述固定键顺序及 targets 固定键顺序序列化的无空白 UTF-8 JSON。数组顺序已经规范化；实现不得依赖对象运行时枚举顺序。

### 13.2 测试记录 authority 与语义差异

TestDefinitionDiff 必须使用共享 Markdown authority scanner，只读取普通 Markdown 表格中首列匹配 `UT-*`、`ST-*` 或 `SMOKE-*` 的数据行。scanner 必须正确处理 escaped pipe、inline code、CRLF/LF 与 Unicode；忽略 fence、HTML comment、标题、散文和示例。记录 identity 为规范化 ID，记录语义由正式 target 路径、规范化列身份与该行有序单元格 canonical tuple 组成；不得只比较 ID 集合或整文件哈希。

在全部 test targets 上建立 before/final 全局映射：

```text
id ∉ before ∧ id ∈ final                 => C
id ∈ before ∧ id ∈ final ∧ row changed   => C
id ∈ before ∧ id ∈ final ∧ row unchanged => B
id ∈ before ∧ id ∉ final                 => R
```

任一侧出现重复 ID、非法 UTF-8、无法确定表格边界或歧义记录时，merge-apply 必须在首个正式写入前失败。正式 target 路径是记录语义的一部分，跨 target 移动必须进入 C。

### 13.3 读取、历史与完整性边界

TestChangeSetReader 必须验证 marker 类型、schema/精确字段、change/module/source、排序/去重/集合相交、payload hash、targets 与 baseline plan identity，以及当前正式 target 字节的 after hash。任一失败均 fail-closed，所有消费者得到同一个 invalid 结果；不得从 Delta、tasks、test-results 或 Git 回退重建。

新 apply marker 缺 change set 属损坏；未知 schema 主版本属 unsupported。`type=no_delta_spec_complete` 且磁盘确无 mergeable Delta 的旧 marker 可可信派生空 C/R，但不得改写旧 marker；合法 final `VERIFY_PASS` 的历史已完成提案不得因升级回退。其它历史 marker，尤其含测试 Delta 的旧 marker，不得推导为空集合。删除 ID 只供诊断与审计，不要求切片归属。

### 13.4 跨消费者一致性

`status`、`next`、`change-lint`、slice manifest validator 与 `verify` 必须调用同一 TestChangeSetReader。对同一磁盘快照，它们输出的 C/R、有效性和诊断必须一致；只有合法 change set + 非法 slice manifest 才能进入 `plan-slices` 恢复。
