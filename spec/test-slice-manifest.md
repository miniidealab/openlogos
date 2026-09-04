# 测试—切片 Manifest 协议

## 1. 目的与适用范围

本规范定义多切片 launched 代码提案的测试归属、稳定切片身份、checkpoint/final 验收和缺清单恢复。它适用于 `[code]` 含两个及以上顶层切片的活跃提案；单切片、docs-only 与已越过 final 的 legacy 提案可沿用既有全量 verify。

OpenLogos 是协议判定和状态持久化的唯一事实源。slice-planner 是 manifest 唯一生产者；verify 是 checkpoint/marker/loop 账本唯一写入者；RunLogos 等宿主只消费结构化动作并调度 Agent。

## 2. 文件与写入者

| 文件 | 位置 | 唯一写入者 | 更新方式 |
|---|---|---|---|
| `SPEC_MERGED.test_change_set` | `logos/changes/<slug>/SPEC_MERGED` | `openlogos merge-apply` | 与 resources、metadata、marker 同一 baseline apply 事务；marker 最后写 |
| `TEST_SLICE_MANIFEST.json` | `logos/changes/<slug>/` | `openlogos slice transaction apply` | 与 `tasks.md` 的 `[code]` 段在同一事务中原子写出；临时文件校验后原子 rename |
| `tasks.md` 的 `## [code]` 段 | 同上 | `openlogos slice transaction apply` | 整节替换；`[delta]` / `[deploy]` 段与其 checkbox 状态字节恒等 |
| `SLICE_CHECKPOINTS.jsonl` | 同上 | `openlogos verify` | append-only；等价 PASS 幂等 |
| `LOOP_ITERS` | 同上 | `openlogos verify` | 仅真实 Gate 尝试 append |
| `VERIFY_PASS` / `VERIFY_FAIL` | 同上 | `openlogos verify` | 既有 marker 规则；PASS 仅 final |

`merge-apply` 必须在掌握 category=`test` canonical targets 的 before/final 字节时生成 change set；slice-planner、verify、status、next、change-lint、宿主和 code-implementor 均只读。verify、status、next、宿主和 code-implementor 禁止写 manifest；宿主禁止写 checkpoint/marker 或从 `tasks.md`、Delta、Git 建立影子 changed-ID 清单。

### 2.1 写入权与判定权同源

`TEST_SLICE_MANIFEST.json` 与 `tasks.md` 的 `## [code]` 段是 OpenLogos 判定切片验收前沿的两个 canonical 产物，因此**必须由 OpenLogos 自己写出**（架构 §四十三.1）。

slice-planner 是这两个产物内容的**生产者**，不是**写入者**：它向 `openlogos slice transaction` 的 content slot 提交内容，正式产物、receipt 与 marker 一律由 OpenLogos 写入。此前规格把 slice-planner 记为 manifest 的唯一生产者，而 OpenLogos 虽已导出 `writeTestSliceManifestAtomic()` 却零调用方——实际写出字节的是 Agent，判定权与写入权分离。

### 2.2 两产物的原子一致性

manifest 的 `task_fingerprint` 是对 `tasks.md` 的 `[code]` 段求得的指纹，二者存在硬性一致性约束。该一致性**由构造保证**（架构 §四十三.2）：

- 两个产物在同一次 `apply` 中写出，任一失败整体回滚，不存在半写态；
- `task_fingerprint` 由 OpenLogos 依其**刚写出**的 `tasks.md` 计算，不接受外部提供。

禁止以纪律、约定或生产者自查替代该保证。特别地，禁止由被检查者自己运行的「交付前自查」充当硬门。

#### 2.2.1 终态条件：completed 当且仅当判定器未给出负面结论

「写盘成功」不是终态条件。`apply` 必须在写盘完成之后、置 `phase=completed` 之前，用**本规范 §8 的同一 validator**（`deriveSliceVerificationState()`，经 `verifyAppliedManifest()` 消费）复核它刚写出的两个产物。复核的**适用性是前置条件**：`shouldUseSliceVerification()` 为假时（当前唯一形态：`tasks.length < 2` 的单切片计划——单切片下 `owned_test_ids` 的确定性恢复没有意义，切片验证按设计不启用）判定器返回 `null`，表示**不适用而非负面结论**。

| 复核结论 | 终态 | 产物 |
|---|---|---|
| `null`（判定器按设计不适用） | `completed`，出具 receipt | 保留；manifest 为**惰性产物**——所有消费者统一经 `deriveSliceVerificationState()` 取态，其在盘与否不改变行为 |
| `valid` | `completed`，出具 receipt | 保留 |
| `invalid` / `stale` / `unsupported` | `failed`，`classification=recovery_required` | **整体回滚**到 `apply` 前状态 |

放行分支必须**显式区分** `null` 与 `valid` 两种来源，不得无差别合并——未来新增的 `null` 来源不得被静默放行。禁止把「不适用」读成失败（0.14.12～0.14.13 的缺陷形态：`status !== 'valid'` 使所有单切片提案永久无法写出 `[code]`），也禁止以「把单切片拆成两片满足判定器」作为替代。

判非法时的回滚**复用与写盘异常完全相同的那一条路径**：`tasks.md` 与 manifest 同时恢复，不留半写态。这样「产出不合法」与「写盘异常」在消费方看来是同一种失败，只需一套语义——修正 slot 内容后重新提交。

失败投影必须把 validator 的 violations **原样带出**（保留 `code`、`path`、`message`、`fix_hint`），不得压缩为单条摘要：消费方要靠它定位到底是哪个 `spec_targets` 或哪个 `task_text` 不合格。**失败终态必伴随非零 violations**；失败文案不得渲染 `unknown`——「失败终态 + 0 条违规」的组合意味着守门把「没有结论」读成了结论，属违规实现。

不得为此新建第二套宽松 validator。判定权与写入权在同一进程内（§2.1），若在提交终态前不互相对账，判定方就只能事后发现问题、无法事前阻止——这正是「约束没有失败信号」（架构 §四十一.6.2）的形态。**一个只被定义、没有调用方的复核函数，等于没有这条约束。**

本节仅放宽 `completed` 的达成条件（解除对合法单切片形态的误拒），`openlogos/test-slice-transaction@1` 的 schema、字段与 slot 契约零变化，不做版本跃迁；消费方对 `completed` 的既有理解不受收紧。

### 2.3 恢复事务

manifest 失效（missing / invalid / stale）时，由 OpenLogos 依 `deriveSliceVerificationState()` 自身结论创建 `origin=manifest-recovery` 的切片事务，`content_slots.required` 收窄为仅切片归属内容，`[code]` 段冻结、拒绝改写。

消费方不得自行判断「这是不是一次恢复」，也不得自行推导可写作用域——两者都从事务投影读出。

#### 2.3.1 「已存在活跃事务」只含非终态

同一提案同时至多一个**活跃**切片事务。「活跃」的定义是**非终态**：

| phase | 是否占用活跃名额 |
|---|---|
| `collecting` / `ready` / `sealed` / `applying` | 是 |
| `completed` / `failed` | **否**——视为可归档历史 |

终态事务在场时，仍必须按当前 canonical 判定另起 `origin=manifest-recovery` 事务。把终态计入「已存在」会让恢复入口永久短路：`completed` 的 `allowed_actions` 为空，既不能提交也不能中止，而恢复事务又创建不出来，提案被永久锁死在 `plan-slices`。

由此派生两条硬性要求：

- **禁止要求消费方删除或改名 `TEST_SLICE_TRANSACTION.json`。** 该文件由 OpenLogos 拥有，让消费方去改它与「事务产物只由 OpenLogos 写」（§2.1）直接冲突。任何把「人工删除事务文件」写进恢复步骤的文档、Skill 或测试夹具都是违规的——**测试夹具尤其**：在夹具里预先删除该文件，等于把人工绕过写进前提，会使本条约束在测试中天然不可见。
- **投影必须与事实一致。** 终态事务不得被渲染成恢复事务；`allowed_actions` 为空的事务不得被提示「提交内容后 seal、apply」；拒绝动作的文案不得断言未发生的前提（例如在 `apply` 成功的现场声称「apply 失败已整体回滚」）。

### 2.4 已完成规划的受控重划

`completed` 不等于永久冻结。切片划分本身被证实有误时（manifest 可完全有效，§2.3 的恢复路径不触发），消费方经受控重开动作重划，**不得**以手工编辑 `[code]` 段、手工写 manifest 或删除/改名 `TEST_SLICE_TRANSACTION.json` 替代——那些是 §2.1 写入权合同下的违规路径。

**准入**：`reopen` 仅对 `phase=completed` 开放（两种 origin 均适用），`--reason` 非空为留痕前置。`SLICES_APPROVED` 不在场可自由重开；在场须显式确认参数，确认重开即作废该 marker（旧批准不得覆盖新划分）。事务文件不可读或 marker 状态不可判定时 fail-closed 拒绝，无任何写副作用。

**动作语义**（单一动作内按序完成，任一步失败整体不生效）：追加 `SLICE_REPLANS.jsonl` 留痕（`schema: openlogos/slice-replan@1`——旧 `transaction_id`、重开时刻、非空原因、批准在场标记、确认标记；append-only，历史行不得改写）→ 归档旧终态事务至 `slice-transactions/<id>.json`（不销毁，receipt 可审计）→（确认路径）作废 `SLICES_APPROVED` → 新建 `origin=initial-plan` 的 `collecting` 事务（`required=2`）。

**产物处置**：重开时 `[code]` 段与 manifest **保持旧值**；整体替换发生且仅发生在新划分的 apply（§2.2 的原子语义复用）——任何时刻不得半新半旧。重划 apply 后 manifest 的 `sha256` 必然变化，**verify 只采信 `manifest_sha256` 与当前 manifest 一致的 checkpoint 行**（§6）——旧划分的 PASS checkpoint 不得冒充新划分的收敛证据。

**与恢复路径互不顶替**：manifest 失效走 §2.3（`manifest-recovery`，`required=1`、`[code]` 冻结）；规划错误走本节（`initial-plan`，`required=2`、新 apply 整体替换）。用恢复路径改划分会破坏 `[code]` 冻结不变量，用重划路径修 manifest 会把机械重建变成重新规划。

**兼容**：本节仅扩充 `completed` 的 `allowed_actions` 域（新值 `reopen`），schema、字段与 slot 契约零变化；未执行 `reopen` 时 `completed` 行为与 0.14.14 逐项一致。

## 3. Manifest Schema v1

顶层对象：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `schema` | string | 是 | 精确为 `openlogos/test-slice-manifest@1` |
| `change` | string | 是 | 等于活跃 guard slug |
| `module` | string | 是 | 等于活跃 guard module |
| `task_fingerprint` | string | 是 | `sha256:` 加 64 位小写十六进制 |
| `spec_fingerprint` | string | 是 | 同上 |
| `generated_at` | ISO 8601 string | 是 | 审计字段，不参与 fingerprint |
| `slices` | array | 是 | 非空、有序、slice ID 唯一 |

每个 `slices[]` 项：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `slice_id` | string | 是 | `^[a-z0-9][a-z0-9-]{2,63}$`；同 manifest 唯一且重建稳定 |
| `task_text` | string | 是 | 对应 `[code]` 顶层 task 的非空规范化文本 |
| `owned_test_ids` | string[] | 是 | 非空、去重、稳定排序；每个 ID 存在于已合并规格 |
| `runner_selectors` | string[] | 是 | 非空、去重；可执行 owned tests |
| `spec_targets` | string[] | 是 | 非空、项目根相对测试规格文件路径；无绝对路径或 `..` |

v1 对未知顶层/切片字段允许读取并保留，以支持 1.x 增量；未知 `schema` 主版本不得覆盖，状态为 `unsupported`。

示例：

```json
{
  "schema": "openlogos/test-slice-manifest@1",
  "change": "make-verify-slice-aware",
  "module": "core",
  "task_fingerprint": "sha256:5f2f8f536ab387bd9b2738e70c4e5416c328e4c91e8f4bb90ff0d99688c5c9bb",
  "spec_fingerprint": "sha256:c2fda0fb20b808d3eb0953c71b37b1fefdbbb5b7c2e5bb2a1ed086e3a101bf29",
  "generated_at": "2026-08-15T00:00:00.000Z",
  "slices": [
    {
      "slice_id": "slice-01-manifest-validation",
      "task_text": "实现 manifest schema、校验与恢复诊断闭环",
      "owned_test_ids": ["ST-S32-10", "UT-S32-32"],
      "runner_selectors": ["ST-S32-10", "UT-S32-32"],
      "spec_targets": ["logos/resources/test/core-S32-test-cases.md"]
    }
  ]
}
```

## 4. Fingerprint 规范

### 4.1 task_fingerprint

输入为 `[code]` section 的结构化模型：按顶层顺序保留规范化 `task_text` 与父子关系，子任务按文档顺序保留；checked 状态、列表标记、行尾空白和无语义空行不参与。序列化为 UTF-8 canonical JSON 后计算 SHA-256。

### 4.2 spec_fingerprint

输入为所有 `spec_targets` 的有序集合。路径按字典序排序，每项由项目根相对 POSIX 路径、NUL 分隔符和文件规范化 UTF-8 字节组成；行尾统一 LF，保留其余内容。结果整体计算 SHA-256。测试 ID 定义增删改必然改变该值，test-results JSONL 不参与。

## 5. 归属与集合不变量

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

## 6. Checkpoint Ledger v1

每行是独立 JSON 对象：

```json
{"schema":"openlogos/slice-checkpoint@1","slice_id":"slice-01-manifest-validation","manifest_sha256":"sha256:3b2f6dd12f46176766b38f21a55d58265f0c6f9f4f221f5c49c88b91b618daef","result":"PASS","eligible_test_ids_sha256":"sha256:ae3fca61d0d812c565ed97c82ff9e779df3fdd879faccc623733425983af5c95","timestamp":"2026-08-15T00:10:00.000Z"}
```

字段均必填；`result` 为 `PASS|FAIL`。当前完成判定只采信 manifest_sha256 等于当前 manifest 字节哈希的 PASS。相同 `slice_id + manifest_sha256 + eligible_test_ids_sha256 + PASS` 重试不得重复追加。旧哈希行保留审计但不参与确认集合。

## 7. verify 模式与集合

有效 PASS checkpoint 对应的切片集合为 `P`；按 manifest 顺序第一个不在 P 的切片为 A：

```text
A exists:
  mode = slice-checkpoint
  eligible = B ∪ owned(P) ∪ owned(A)
  pending = C − owned(P) − owned(A)

A absent and code section complete:
  mode = final
  eligible = D
  pending = ∅
```

checkpoint 对 eligible 执行既有 100% 覆盖、合法状态、去重和通过率 Gate。PASS 追加 checkpoint、不写 `VERIFY_PASS`；FAIL 写 `VERIFY_FAIL` 与 `LOOP_ITERS{verify_mode:"slice-checkpoint",attempted_slice_id:A}`。final 保持全量硬门，只有 PASS 写 `VERIFY_PASS`。

pending 不是 reporter status，不生成结果、不进入 uncovered。runner 输出 pending ID 时返回 `result_outside_eligible_scope`。

## 8. Validator 与诊断码

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

## 9. 恢复动作合同

有效 change set + slice manifest missing/invalid/stale 时，OpenLogos 输出 `next_node.id=plan-slices`、`skill=slice-planner`、`dispatch.idempotent=true` 和 artifacts。slice-planner 恢复模式必须从同一 TestChangeSetReader 返回的 C/R 规划，保留 `[code]` 文本/顺序/checkbox、`SLICES_APPROVED` 和 checkpoint，仅重建 manifest。完全缺失时从规范化 tasks 确定性恢复 slice ID；无法保持身份则阻塞。

恢复入口的可达性是本合同的一部分：**只要判定为可自动恢复（§8 表中「可自动恢复=是」且 `human_action_required=false`），就必须存在一个可创建的恢复事务**，与该提案是否残留终态事务无关（§2.3.1）。若因任何原因无法创建，OpenLogos 必须给出结构化诊断说明原因，而不是返回一个不接受任何动作的事务投影充数——后者会让消费方按错误指引反复撞墙。

change set missing/invalid/unsupported/tampered 时，OpenLogos 必须保持人类可操作的 merge/spec-complete 阻塞前沿，返回对应结构化诊断，禁止伪装成 slice manifest 问题或派 `plan-slices`。RunLogos 只消费该 canonical 动作；宿主不得扫描 Delta、解析 Markdown 表格、调用 Git 或自行推导 C/R。

RunLogos 负责有界派发、重投和完成屏障；屏障必须再次调用 OpenLogos validator。成功后重新调用 canonical `next/verify`。宿主不得自行扫描缺失、解析 tasks 归属、写状态或把恢复次数计入 code repair budget。

## 10. 崩溃一致性与安全

- manifest 先写同目录临时文件，fsync/关闭后校验，再原子 rename；失败不覆盖旧有效文件。
- `apply` 的原子性同时覆盖**写盘失败**与**产出非法**两种情形，二者走同一条回滚路径（§2.2.1）；回滚后 `tasks.md` 与 manifest 均恢复到 `apply` 前字节。
- checkpoint 使用单行 append；截断/非法尾行不采信并返回诊断，不从半行恢复 PASS。
- checkbox 先勾但 checkpoint 未写：A 不变；checkpoint 已写但响应丢失：重试幂等并前移。
- 路径必须位于当前提案或声明的测试规格内，拒绝绝对路径、`..` 与符号链接逃逸。
- 文件不包含凭证、个人数据或测试输出正文，只存 ID、哈希与状态。

## 11. 兼容与版本演进

- v1 新增字段遵循只增不改；unknown field 保留，unknown enum 保守。
- unknown major 不覆盖、不降级解析。
- 单切片和已完成 legacy 提案维持旧 final 行为。
- 正在实现的 legacy 多切片提案必须走恢复动作，禁止以全量 uncovered 误失败。

## 12. 验收要求

实现必须覆盖：schema 正反例、稳定 fingerprint、唯一归属/漏配/重复/未知 ID、selector、checkpoint 幂等、checkbox 前移、跨进程重启、eligible/pending 集合、final 全量硬门、missing/invalid/stale 恢复、unknown major 阻塞、RunLogos 消费边界及 OpenLogos reporter。

## 13. Canonical Test Change Set v1

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

## completed receipt 驱动的切片规划

### 激活门

`TEST_SLICE_MANIFEST` 只能在对应 merge transaction 为 `completed` 且 completed receipt 通过 schema、seal、target set、after hash 与 metadata closure 复核后创建或刷新。`SPEC_MERGED`、外部 manifest、Agent done 或 Delta checkbox 不得单独开启切片规划。

### 输入权威

slice-planner 的规格输入是 receipt 指向的正式 canonical targets；测试输入是这些正式目标中真实存在的 UT/ST ID。规划器必须：

1. 从 receipt 读取 transaction id、seal hash、target set hash 与 receipt hash；
2. 在同一正式快照中扫描测试规格并验证每个引用 ID 唯一存在；
3. 将上述四个事务指纹写入 manifest provenance；
4. 拒绝仅存在于未合并 Delta、历史 checkout 或自然语言计划中的测试 ID。

### 自闭环切片

每个 `[code]` 切片继续同时包含业务代码、对应 UT/ST 测试代码和 OpenLogos reporter。切片必须显式列出真实 ID、覆盖的正式规格 target，以及对事务行为的可观察断言；跨切片依赖必须有序，不能把事务核心、原子 writer 或恢复测试全部推迟到最后一片。

### 漂移与恢复

若 receipt hash、正式 target hash、tasks `[code]` 或真实测试 ID 集合发生漂移，既有 manifest 立即失效并返回稳定诊断。只有新的 completed receipt 或在同一 receipt 下重新生成完全一致的 manifest 才可恢复；不得通过编辑 fingerprint 绕过。

### no-delta 与历史兼容

no-delta 若后续确实需要代码，仍以其 completed receipt 为规划输入。旧 manifest 缺少 transaction provenance 时只能用于历史只读展示，不能驱动 0.14.0 的实现、verify 或 archive。本节覆盖本文档中把 `SPEC_MERGED` 单独视为切片激活门的旧规则。
