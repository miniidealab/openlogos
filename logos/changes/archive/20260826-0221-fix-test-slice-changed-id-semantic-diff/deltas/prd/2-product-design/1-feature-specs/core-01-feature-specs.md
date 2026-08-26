## MODIFIED — 2.37 切片感知 verify 与 manifest 自动恢复

### 2.37 切片感知 verify 与 manifest 自动恢复

### 2.37.1 双层权威输入

多切片代码提案使用两层、职责不同的机器事实：

1. `SPEC_MERGED.test_change_set` 由 OpenLogos `merge-apply` 在规格原子提交时生成，schema 为 `openlogos/test-change-set@1`，权威声明本提案真实新增/修改集合 C、删除集合 R 及正式测试 target 的 before/after identity。
2. `TEST_SLICE_MANIFEST.json` 由 `slice-planner` 在 spec-complete 后原子写入，schema 仍为 `openlogos/test-slice-manifest@1`，只负责把 C 唯一分配到已规划代码切片。

change set 先于 slice manifest 校验。slice-planner、verify 和宿主均不得从 Delta、Git 历史或 `tasks.md` 自行推断 C；`tasks.md` 只用于切片生成输入与人读展示。

`openlogos/test-change-set@1` 顶层精确字段为 `schema`、`change`、`module`、`source`、`changed_test_ids`、`removed_test_ids`、`targets`、`sha256`。`source` 固定为 `semantic-before-after-diff`；`targets[]` 精确包含 `target_path`、`before_sha256`、`after_sha256`。数组去重并按 ASCII 排序，payload hash 排除自身字段且不含时间戳。

### 2.37.2 语义差异与集合公式

设：

- `D`：已合并测试规格中全部非 manual 测试 ID；
- `C`：已校验 change set 的 `changed_test_ids`，即本提案新增或规范化定义真实变化的 ID；
- `R`：已校验 change set 的 `removed_test_ids`；
- `O`：slice manifest 中全部 `owned_test_ids` 的并集；
- `B = D − C`：未被本提案修改的基线回归集合；
- `P`：已有 PASS checkpoint 的切片集合；
- `A`：按 manifest 顺序第一个没有 PASS checkpoint 的 attempted slice；
- `owned(X)`：切片集合 X 拥有的测试 ID 并集。

必须先满足：

```text
O = C
C ∩ R = ∅
∀i≠j: owned(slice_i) ∩ owned(slice_j) = ∅
```

同 ID 前后规范化记录相同则留在 B；不同则进入 C。新增进入 C；删除只进入 R；跨 target 迁移视为修改。`MODIFIED` Delta 中原样携带测试行不构成 C。

当 `A` 存在时，`mode=slice-checkpoint`：

```text
eligible_test_ids = B ∪ owned(P) ∪ owned({A})
pending_test_ids  = C − owned(P) − owned({A})
```

当不存在 `A` 且 `[code]` 顶层及子任务全部完成时，`mode=final`：`eligible_test_ids=D`、`pending_test_ids=[]`。不存在 `A` 但任务未完成属于状态不一致，保守诊断且不得写最终通过。

### 2.37.3 结构化测试定义

只解析 authority 区域内具有表头与分隔行、首个逻辑单元格精确为 canonical UT/ST/SMOKE ID 的 Markdown 数据行。围栏代码、HTML 注释、普通散文与示例字符串不构成定义；escaped pipe 和 inline-code pipe 必须按逻辑单元格处理。

规范化记录由 target 路径、列身份、列顺序和有序单元格语义组成。LF/CRLF、表格对齐、单元格外围空白和测试行顺序差异不构成修改；列身份、列顺序、内部文本、代码、前置、输入或期望变化均构成修改。任一前态/后态全局重复 ID、非法 UTF-8 或不可唯一解析表格在首写前失败。

### 2.37.4 checkpoint Gate

- checkpoint 只按 `eligible_test_ids` 计算 covered/uncovered/pass/fail/skip；`pending_test_ids` 单独呈现，不进入分母或 reporter。
- PASS 向 `SLICE_CHECKPOINTS.jsonl` 追加绑定 slice manifest 哈希的事实，不写 `VERIFY_PASS`；等价 PASS 幂等。
- FAIL 写 `VERIFY_FAIL` 与带稳定 `attempted_slice_id` 的 `LOOP_ITERS`；repair 锁定同一 slice。
- checkpoint PASS 后清除该切片失败态，下一次选择新的首个未通过切片。

### 2.37.5 final Gate

final 保持既有全量定义、合法状态、去重、一致性和 100% 覆盖要求。final PASS 才写 `VERIFY_PASS` 并允许进入 deliver；final FAIL 不得把缺失结果改列 pending。

### 2.37.6 恢复与阻塞分层

change set 有效而 slice manifest 缺失、schema 非法或 fingerprint 漂移时，保持既有恢复态：

- `reason` 为 `test-slice-manifest-missing|invalid|stale`；
- `next_node.id=plan-slices`、`skill=slice-planner`；
- recovery 只重建 manifest，保留 `[code]`、checkbox、批准与有效 checkpoint；
- 不写 `VERIFY_FAIL`、`LOOP_ITERS` 或 checkpoint。

change set 缺失、未知 schema、payload hash/target identity 失配时，不得派 `plan-slices`。输出 `manifest_status=invalid`、`reason=test-slice-manifest-invalid`、精确 `test-slice-change-set-*` violation 与 `human_action_required=true`，runner/Gate/loop/checkpoint 均零副作用。slice-planner 无权伪造 merge 前态。

### 2.37.7 机器输出与单一入口

`verify --format json` 继续输出 `verify_mode`、`attempted_slice_id`、`eligible_test_ids`、`pending_test_ids`、manifest 与 checkpoint 摘要；status/next 暴露同源 `slice_verification_state`。所有命令必须调用同一 change-set reader 与 slice-state 派生函数，命令层不得直接扫描 Delta 或解析 marker 建立第二套算法。

### 2.37.8 兼容边界

- 单切片或无需代码的历史提案继续按既有 final 全量语义。
- 已有合法 final `VERIFY_PASS` 的 legacy marker 不因升级回退。
- `type=no_delta_spec_complete` 且确无 mergeable delta 时可信派生 `C=[]、R=[]`。
- 旧活跃 marker 无可信 before snapshot 时保守阻塞，迁移必须另立带可信快照的流程。
- 未知 change-set 或 slice-manifest 主版本均 fail-closed，不得自动覆盖。
- RunLogos 的 invalid manifest 消费与 recovery 生产接线不在本功能内改变。
