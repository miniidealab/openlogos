# S32：切片规划与 manifest 生成/恢复

### 场景目标

在 spec-complete 后基于已合并规格与真实测试 ID 同时产出良构 `[code]` 切片和稳定机器 manifest；缺失或漂移时能保留既有切片身份并安全重建 manifest。

### 参与者

- 用户或 RunLogos
- 使用 `slice-planner` Skill 的 Agent
- OpenLogos manifest validator
- `tasks.md`、已合并测试规格与提案目录

### 前置条件

- `SPEC_MERGED` 存在，测试规格包含真实 UT/ST/SMOKE ID。
- 初次模式下 `[code]` 仍为占位；恢复模式下 `[code]` 已规划且可能部分完成。
- 不存在未恢复的 seed commit journal。

### 后置条件

- 初次模式：`[code]` 良构切片与 `TEST_SLICE_MANIFEST.json` 同一轮原子收敛。
- 恢复模式：既有切片文本、顺序、checkbox、稳定 slice ID 和有效 checkpoint 均保留。

```mermaid
sequenceDiagram
    participant Host as 用户/RunLogos
    participant Agent as slice-planner Agent
    participant Specs as merged specs + tests
    participant Files as tasks.md + manifest
    participant Valid as OpenLogos validator

    Host->>Agent: plan-slices(initial|recover)
    Agent->>Specs: 读取规格、真实测试 ID、runner 能力
    alt 初次规划
        Agent->>Agent: 六维评分、垂直判别、删后续证伪
        Agent->>Files: 写 [code] + manifest 临时文件
    else 恢复 manifest
        Agent->>Files: 读取既有 [code]/checkbox/checkpoint
        Agent->>Agent: 保持切片边界并重算归属/fingerprint
        Agent->>Files: 仅原子替换 manifest
    end
    Agent->>Valid: 校验 schema/唯一归属/已知 ID/fingerprint
    alt 有效
        Valid-->>Host: slices_planned + manifest_valid
    else 可修复 violation
        Valid-->>Agent: 精确 violation
        Agent->>Files: 幂等修正后重验
    else 归属歧义
        Valid-->>Host: blocked，不猜测
    end
```

### 步骤

1. Agent 从规格提取本提案变更测试 ID，为每个 ID确定唯一 owning slice 和 runner selector。
2. 初次规划先完成 slice-planner 的六维评分、垂直/横向判别与删后续证伪，再给切片分配稳定 ID。
3. `slice_id` 从规范化顺序和切片语义生成；重复运行输入相同则逐字节稳定。
4. 计算 `task_fingerprint` 与 `spec_fingerprint`，写入 manifest。
5. 原子落盘后调用 validator；只有 schema、唯一归属、ID 存在性、selector 与 fingerprint 全部通过才完成。

### 恢复模式

- 禁止重新打分或调整既有切片边界。
- 以既有 manifest 可验证 slice ID 为优先；manifest 完全缺失时，依据既有 `[code]` 的规范化顺序和文本确定性重建。
- 已完成 checkbox 与有效 checkpoint 原样保留；若切片文本改变导致无法保持身份，必须报告歧义。

### 异常与边界

- 测试 ID 漏配、重复归属、未知 ID、空 selector、fingerprint 漂移均在实现/verify 前失败。
- 一个测试跨多个能力线时仍必须选择唯一 owning slice；共享回归通过基线集合运行，不重复 owned。
- 未知 manifest 主版本不覆盖。
- 文件存在但未通过 validator 不得宣布 slice 规划完成。

### 追溯

- 需求：S32、S28。
- 规格：功能规格 §2.37.1、§2.37.5；`skills/slice-planner/SKILL.md`、`spec/test-slice-manifest.md`。
- 测试：UT-S32-32～UT-S32-42、ST-S32-10～ST-S32-13。

## Canonical 测试变更集驱动的切片规划

### 目标

slice-planner 只为 merge 时已固化的真实 changed 测试集合规划唯一 owner；原样携带的 baseline 与已删除测试不得进入切片归属。

### 参与者

- 用户或 RunLogos
- 使用 `slice-planner` Skill 的 Agent
- OpenLogos `TestChangeSetReader`
- OpenLogos slice manifest validator
- `SPEC_MERGED`、`tasks.md`、正式测试规格与 `TEST_SLICE_MANIFEST.json`

### 前置条件

- `SPEC_MERGED` 存在并通过 spec-complete 身份检查。
- `[code]` 为初次规划空承载区，或处于仅重建 manifest 的恢复模式。
- 正式测试规格与 change set 的 `targets[].after_sha256` 一致。

```mermaid
sequenceDiagram
    participant Host as 用户/RunLogos
    participant Agent as slice-planner Agent
    participant Change as TestChangeSetReader
    participant Specs as merged tests
    participant Files as tasks + slice manifest
    participant Valid as SliceManifestValidator

    Host->>Change: 请求 plan-slices 状态
    Change->>Change: 校验 schema/change/module/hash/target identity
    alt change set 不可信
        Change-->>Host: human block + test-slice-change-set-* violation
        Note over Host,Files: 不派 slice-planner，不写 tasks/manifest/checkpoint
    else change set 有效
        Change-->>Agent: C、R、target identity
        Agent->>Specs: 读取 C 对应正式定义与 runner 能力
        Agent->>Agent: 六维评分、垂直判别、删后续证伪、唯一 owner
        Agent->>Files: 初次写 [code] + manifest，或恢复时仅替换 manifest
        Files->>Valid: 校验 O=C、唯一归属、定义、selector、fingerprint
        alt slice manifest 有效
            Valid-->>Host: manifest_valid，停 slice-exit 门
        else 可恢复失效
            Valid-->>Agent: 精确 violation，保持既有切片后重建
        else 归属歧义
            Valid-->>Host: blocked，不猜测
        end
    end
```

### 步骤

1. OpenLogos 先读取并严格校验 `SPEC_MERGED.test_change_set`；不得从 Delta 或 Git 回退推导。
2. Agent 只把 `changed_test_ids` 分配给切片；`removed_test_ids` 仅供诊断，baseline 不进入 owned。
3. 初次规划按已合并规格与真实 ID 形成 `[code]` 切片，再生成稳定 `slice_id`、owner、selector 与 fingerprint。
4. validator 强制 `O=C`、切片间无交集、owned ID 在唯一 spec target 中存在且 selector 可执行。
5. change set 有效但 manifest 非法时，恢复模式保留 task 文本、顺序、checkbox、slice identity 与有效 checkpoint，只原子替换 manifest。
6. 合法 manifest 后停在 `slice-exit` 人类门，不因恢复自动越门进入实现。

### 事故样本

对完整 `MODIFIED` 测试章节，C 只能包含 `UT-S10-129`、`UT-S10-137`～`UT-S10-140`、`ST-S10-44`。`UT-S10-121`～`UT-S10-128`、`ST-S10-36`～`ST-S10-39` 留在 baseline；若 manifest owned 任一原样 ID，报 unknown；漏掉 `UT-S10-129`，报 missing。

### 异常与边界

- change set missing/unsupported/hash/target 漂移：`human_action_required=true`，不得派 `plan-slices`。
- changed ID 多片归属：ambiguous fail-closed，不自动选择。
- removed ID 被 owned：unknown；不得因它已从正式规格消失而放宽定义门。
- no-delta marker 且确无 mergeable delta：可信空 C/R；不得把任意既有测试猜成 changed。
- final `VERIFY_PASS` 已存在的 legacy 提案不回退。

### 追溯

- 需求：S32/S39 测试变更 ID 语义差异与持久化要求。
- 功能规格：§2.37。
- 方法论：`spec/test-slice-manifest.md`、`spec/baseline-closure.md`。
- 测试：UT-S32-43～UT-S32-49、ST-S32-14～ST-S32-16。

## S32 此前不可见的测试 ID 进入切片归属

### 场景目标

让此前对 `test-change-set` 不可见的 JSON 系测试 ID 进入 changed / owned 计算，使对这些用例的改动不再绕过切片归属校验。

### 参与者与前置条件

| 别名 | 组件 | 说明 |
|---|---|---|
| M | `merge` | 写入 `SPEC_MERGED.test_change_set` |
| C | `test-change-set` | 变更 ID 集合的权威 |
| S | `test-slice-manifest` | 切片归属校验 |
| G | 测试 ID 语法权威 | 结构化判定读法的唯一来源 |

### 归属校验时序

```mermaid
sequenceDiagram
    participant M as merge
    participant C as test-change-set
    participant G as 语法权威
    participant S as slice manifest

    M->>C: Step 1: 从本次 test delta 求变更 ID 集合
    C->>G: Step 2: 以结构化判定读法筛选
    G-->>C: Step 3: 放宽后的语法接纳 JSON 系 ID
    C-->>M: Step 4: 写入 SPEC_MERGED.test_change_set
    Note over M,S: slice-planner 划分切片
    S->>C: Step 5: 读 changed ID 集合
    S->>S: Step 6: 逐个校验是否被某切片 owned
    alt 存在未归属 ID
        S-->>S: Step 7a: 判 test-slice-test-id-missing，manifest invalid
    else 全部归属
        S-->>S: Step 7b: manifest valid，进入 slice-checkpoint 模式
    end
```

**Step 3 的缺陷形态**：此前严格读法要求 ID 形如 `(?:UT|ST)-S\d{2}-…`，JSON 系 ID 不符，在 Step 2 即被丢弃。于是 Step 6 根本看不到它们——修改这些用例的提案可以不为其规划任何切片，校验也不会报错。

**Step 7a 的行为不变**：未归属即 invalid，判据本身不放宽。变化只是**被校验的集合变大了**。

### 对切片规划的影响

| | 此前 | 此后 |
|---|---|---|
| 改动 JSON 系用例是否需规划切片 | 否（看不见） | 是 |
| 未规划时 manifest 状态 | valid（假阴性） | invalid，点名未归属 ID |
| ID 是否需携带场景号 | —— | 否，归属以 `owned_test_ids` 为准 |

**ID 无场景号不妨碍归属**：切片的归属关系由 manifest 的 `owned_test_ids` 显式声明，不从 ID 中的场景编号推断。`spec_targets` 同样由切片作者显式给出。

### 不变量

1. 变更 ID 集合的筛选判据只有一处，即权威语法的结构化判定读法。
2. 归属校验的判据不因集合变大而放宽——未归属仍判 invalid。
3. 集合变化只增不减；不存在此前被捕获、此后遗漏的 ID。

### 异常与边界

- 已归档提案的 manifest 不受影响：其 `test_change_set` 在 merge 时已固化。
- 若某 JSON 系 ID 被改动但作者未规划切片：manifest 判 invalid 并点名该 ID，属正确拦截。

### 追溯

- 需求：AC-MERGEGATE-08、AC-MERGEGATE-09。
- 功能规格：§2.51.7；架构：§四十一.6.1。
- 测试：UT-S32-50～UT-S32-51、ST-S32-17。

## S32 切片规划单条受控写入口时序

### 场景目标

把切片规划的落盘从「六动作事务」收敛为**一次 CLI 调用**：AI 产出结构化 `slices.json`，`openlogos slice plan` 校验后一次性写 `[code]` 段与 `TEST_SLICE_MANIFEST.json` 并自算指纹。结构化产物的生成权留在 CLI，不交给 AI 自行写入。

### 参与者

- **slice-planner（AI）**：按六维打分与删后续证伪门划分切片，产出**结构化** `slices.json`。
- **openlogos slice plan（CLI）**：结构化输入的唯一校验者与写入者。
- **verify**：下游消费者，读 manifest 计算 `eligible` 完成增量验收。

### 前置条件

活跃提案已 spec-complete（`SPEC_MERGED` 在场）、需要代码实现（`[code]` 标题在场且切片未填）、测试 ID 已在已合并规格中真实存在。

### 成功后置条件

`tasks.md` 的 `[code]` 段与 `TEST_SLICE_MANIFEST.json` 同时落盘且互相一致；`task_fingerprint` 依刚写出的 `tasks.md` 计算；`[delta]` / `[deploy]` 段与其勾选状态字节恒等。

### 时序图

```mermaid
sequenceDiagram
    participant P as slice-planner（AI）
    participant C as openlogos slice plan
    participant F as 提案目录
    participant V as openlogos verify
    P->>P: Step 1: 六维打分 + 删后续证伪门划分切片
    P->>C: Step 2: 产出结构化 slices.json 并调用 slice plan --file
    C->>C: Step 3: 校验（非空/slice_id 唯一/ID 存在于已合并规格）
    C->>F: Step 4: 写 tasks.md 的 [code] 段（整段替换）
    C->>F: Step 5: 写 TEST_SLICE_MANIFEST.json（temp + 原子 rename）
    C->>C: Step 6: 依刚写出的 tasks.md 自算 task_fingerprint
    C-->>P: Step 7: 返回切片摘要（一次调用完成）
    V->>F: Step 8: 读 manifest 计算 eligible，逐片增量验收
```

### 步骤说明

1. **slice-planner** 按既有六维打分与删后续证伪门划分切片——切片划分方法论逐字不变。
2. **slice-planner** 把结果表达为**结构化** `slices.json`（`slice_id` / `owned_test_ids` / `runner_selectors` / `spec_targets`），一次调用 `openlogos slice plan --file`。
3. **CLI** 校验结构化输入：数组非空；`slice_id` 提案内唯一；三个数组字段非空；`owned_test_ids` 中每个 ID 存在于已合并测试规格。任一不满足即非零退出、零副作用。
4. **CLI** 写 `tasks.md` 的 `[code]` 段（整段替换；`[delta]` / `[deploy]` 段与勾选状态字节恒等）。
5. **CLI** 写 `TEST_SLICE_MANIFEST.json`（temp + fsync + 原子 rename）。
6. **CLI** 依**刚写出的** `tasks.md` 自算 `task_fingerprint`、依 `spec_targets` 算 `spec_fingerprint`——写入者与指纹计算者同一方同一时刻，漂移窗口从构造上消失。
7. **CLI** 返回切片摘要；至此一次 CLI 往返完成全部落盘（此前需 6 次）。
8. **verify** 照既有 `slice-checkpoint` 逻辑读 manifest 计算 `eligible`，逐片增量验收——该能力零改动。

### 异常与边界

#### EX-32.20：结构化输入非法
- **触发条件**：`slices.json` 缺字段、`slice_id` 重复、`owned_test_ids` 含未定义 ID、数组为空。
- **期望响应**：非零退出并报稳定错误码，`tasks.md` 与 `TEST_SLICE_MANIFEST.json` 均不被修改（零副作用）。
- **副作用**：无。

#### EX-32.21：重复执行（重新规划）
- **触发条件**：对同一提案再次执行 `slice plan`（切片调整或纠错）。
- **期望响应**：幂等覆盖——同一输入得到同一 `[code]` 与同一 manifest；不需要「重开」通道，不产生终态相位。
- **副作用**：无。

#### EX-32.22：指纹 stale
- **触发条件**：`[code]` 段或 spec targets 在 `slice plan` 之后被手工改动，导致 manifest 指纹与现状不一致。
- **期望响应**：**告警而非阻塞**——`status` / `next` / `verify` 输出 stale 诊断并建议重跑 `slice plan`，但不阻断流程推进（审计产物不得出现在流程分支的条件里）。
- **副作用**：无。

### 追溯

- 需求：切片规划单条受控写入口要求。
- 功能规格：§2.68。
- 测试：UT-S32-90、UT-S32-91、ST-S32-40。

## S32 change set 提案级语义与二次合并后切片归属

### 场景目标

明确 `SPEC_MERGED.test_change_set` 的消费语义为**提案级累计事实**：二次合并（`git checkout logos/resources/` 回滚重来）后，切片规划与校验读到的 changed/removed 表达「本提案引入/修改/删除了哪些测试 ID」，多切片方案（owned 归属 + 删后续证伪门）在二次合并后依然成立。消费侧代码零变化。

删除合并事务后这条性质从「需要前滚合并去构造」变成**结构上自动成立**：二次合并的 `before` 是回滚后的合并前基线，单次语义 diff 天然覆盖本提案引入的全部 ID，不再需要跨轮前滚。消费方读法不变。

### 参与者

- **slice-planner**：以 changed 为 C/R 唯一来源划分切片。
- **validateTestSliceManifest**：owned⊆changed 双向强校验。
- **slice-aware verify**：按切片归属豁免未完成切片 ID。
- **merge（生产者）**：一次调用合并后写出提案级 change set（时序见 S09）。

### 前置条件

提案经二次合并完成，`SPEC_MERGED.test_change_set` 为对合并前基线的完整语义 diff。

### 成功后置条件

本提案真实新增的每个测试 ID 均可被某切片 own（不再触发 `test-slice-test-id-unknown`）；多切片规划与删后续全量 verify 成立。

### 时序图

```mermaid
sequenceDiagram
    participant P as slice-planner
    participant R as TestChangeSetReader
    participant M as SPEC_MERGED
    participant V as validateTestSliceManifest
    P->>R: Step 1: 读取 change set
    R->>M: Step 2: 读当前 marker（唯一权威）
    M-->>R: Step 3: 提案级 changed/removed
    R-->>P: Step 4: C/R 唯一来源
    P->>V: Step 5: 多切片 manifest（owned 覆盖全部本提案 ID）
    V-->>P: Step 6: owned⊆changed 通过，切片规划成立
```

### 步骤说明

1. **slice-planner** 经共享 TestChangeSetReader 读取 change set，不感知提案经历过几次合并。
2. **TestChangeSetReader** 只读当前 `SPEC_MERGED.test_change_set` 并校验 payload hash 与 target after hash。
3. 二次合并的 diff 基线是回滚后的合并前字节，故 changed 含本提案引入且未删除的全部 ID。
4. **slice-planner** 按 C/R 正常划分多切片。
5. **validateTestSliceManifest** 的 owned⊆changed 校验对本提案真实 ID 全部放行；被本轮删除的 ID 不在 changed、出现在 removed，own 之即报 `test-slice-test-id-unknown`。
6. slice-aware verify 按归属豁免未完成切片 ID，删后续证伪门可成立。

### 异常与边界

#### EX-49.1：消费者试图读别处补齐
- **触发条件**：任何消费者在 changed 缺失时读取当前 marker 之外的来源并集裁决。
- **期望响应**：禁止（forbidden fallback）；change set 不可信时按既有分层阻断（`manifest_status=invalid` / human action required），不回退推导。
- **副作用**：无。

#### EX-49.2：change set 被篡改
- **触发条件**：payload hash 或 target hash 漂移。
- **期望响应**：与既有行为一致——精确 `test-slice-change-set-*` violation 阻断，零 Gate/loop/runner 副作用。
- **副作用**：无。

### 追溯

- 需求：merge 直接合并与规格结构检查要求。
- 测试：UT-S32-69～70、ST-S32-23。
