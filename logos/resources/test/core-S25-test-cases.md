# S25: overlay 驱动 status/next/watch 派生 — 测试用例

> 复用 S22 临时项目 overlay 模式（`makeTempRoot` + `scaffoldProject` + 写 `root/logos/flow/<lifecycle>.yaml`）。
> **不改** `spec/flow/*.yaml`、真实 `logos/flow/`、`golden-baseline.test.ts` fixture。含 OpenLogos reporter。

## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S25-01 | 派生取 resolved flow（builtin + overlay 合并） | flow-derive resolved | initial overlay 存在 | 派生 | flow = applyOverlay(builtin, overlay) |
| UT-S25-02 | 无 overlay 文件 → resolved==builtin、派生逐字节不变 | flow-derive | 无 overlay | status/next 派生 | 与 loadBuiltinFlow 路径逐字节一致 |
| UT-S25-03 | initial `skip` builtin → 既有 phase 视图 skipped | initial 派生 | overlay skip orchestration-test | status | `phase_progress[...].skipped=true`，不进 overlay_nodes |
| UT-S25-04 | initial `modify`（非 id）→ next 生效 | initial 派生 | overlay modify code.review_agent | next | 字段变化体现于派生 |
| UT-S25-05 | initial `reorder` builtin → phases[] 顺序变化 | initial 派生 | overlay reorder | status | `phases[]` 数组顺序按 overlay |
| UT-S25-06 | initial `add` 新节点 → overlay_nodes 出现 | node 级承载 | overlay add lint after code | status --format json | `modules[].overlay_nodes[]` 含 lint（state/subflow_id/node_index/overlay_op=add）|
| UT-S25-07 | current 落 overlay-added → current_node 输出 | current_node | add 节点为当前 active | next --format json | `modules[].current_node` 含 id/name/state/subflow_id/node_index/phase_key=null/overlay_op |
| UT-S25-08 | launched `add` → overlay_nodes + current_node | launched 派生 | launched overlay add | status/next | overlay-added 节点经 node 级视图承载 |
| UT-S25-09 | launched `modify`（marker 名）→ proposal_step 生效 | launched 派生 | launched modify verify.done_when marker 名 | status | 检测随 modify 后的 marker 名变化 |
| UT-S25-09b | launched `modify` `section_complete` tag **不承诺生效**（F5 限制）| launched 派生限制 | modify write-delta.done_when=section_complete:custom | status | 仍按固定 `delta`/`code` tag 判定（记录为已知限制，非静默漂移）|
| UT-S25-10 | launched current 落 overlay-added → proposal_step=前序最近 builtin step | P2 | add 在 write-delta 后 | status | `proposal_step` = ready-to-merge（合法枚举、非 null）|
| UT-S25-11 | launched `add ... before` 首 builtin → proposal_step=writing | P2 | add before write-proposal | status | `proposal_step="writing"` |
| UT-S25-12 | launched builtin `skip` → FLOW_SCHEMA_INVALID | Q2/P1 fail loud | launched overlay skip verify | status 派生 | 抛 FlowError(FLOW_SCHEMA_INVALID) |
| UT-S25-13 | launched builtin `reorder` → FLOW_SCHEMA_INVALID | Q2/P1 fail loud | launched overlay reorder | next 派生 | 抛 FlowError(FLOW_SCHEMA_INVALID) |
| UT-S25-14 | `op:modify` 覆盖 `id` → FLOW_SCHEMA_INVALID | M3/F | overlay modify set.id | applyOverlay | 抛 FlowError(FLOW_SCHEMA_INVALID) |
| UT-S25-15 | overlay-add `dir_nonempty` 缺 produces → FLOW_SCHEMA_INVALID | R5 矩阵 | add 节点 done_when=dir_nonempty 无 produces | 派生入口 | FLOW_SCHEMA_INVALID |
| UT-S25-16 | initial overlay-add 用 `marker:` → FLOW_SCHEMA_INVALID | R5 矩阵 | add done_when=marker:X（initial 无提案目录）| 派生入口 | FLOW_SCHEMA_INVALID |
| UT-S25-17 | overlay-add `file:` 自含 → 合法可求值 | R5 矩阵 | add done_when=file:path | 派生入口 | 通过，节点正常派生 |
| UT-S25-18 | legacy 无 modules[] → overlay_nodes/current_node 回退顶层 | Q3 | 无 module registry + overlay add | status --format json | 顶层 `overlay_nodes`/`current_node` |
| UT-S25-19 | overlay 只做 builtin skip/modify/reorder（无 add）→ 不新增字段 | Q4 | initial overlay 无 add | status --format json | 无 `overlay_nodes`/`current_node` 字段 |
| UT-S25-19b | overlay 有 add 但**尚未到达** → `overlay_nodes` 省略（W1/X1） | 边界 | add 节点在当前节点之后、未到达 | status --format json | 无 `overlay_nodes` 字段（不输出空数组）；该 add 节点仅 flow show --resolved 可见 |
| UT-S25-20 | --auto 不越过未完成 overlay-added 节点 | R2 安全 | add active 节点在 gate 前 | next --auto | 不放行 gate、不写 GATE_AUTO_PASSED |
| UT-S25-21 | 派生 FlowError → makeErrorEnvelope(command, e.code, ...) | S1/T1 | launched skip 触发 | status --format json | stderr envelope，`code==="FLOW_SCHEMA_INVALID"`、非零退出 |

## 二、场景测试用例
### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S25-01 | initial overlay add 节点经 status/next 驱动 | Step 1→9 | initial overlay add | `status` / `next` | overlay_nodes/current_node 含新节点，参与 current 选取 |
| ST-S25-02 | launched add + modify 生效、proposal_step 回退正确 | Step 1→9 | launched overlay add+modify | `status` | proposal_step=前序最近 builtin step / writing（before 首节点）|
| ST-S25-03 | launched builtin skip/reorder fail loud | Step 6a/6b | launched overlay skip | `status`/`next`/`watch` | FLOW_SCHEMA_INVALID envelope + 非零退出；watch 不轮询 |
| ST-S25-04 | 无 overlay golden 零漂移 | golden | 同 fixture 无 overlay | `status`/`next --format json` | 与 golden-baseline 锚点逐字节一致 |
| ST-S25-05 | flow show --resolved 仍展示 launched skip（与派生 fail loud 解耦） | 分层 | launched overlay skip | `flow show --resolved` | 正常展示已应用（不报错），而派生报错 |

## 三、异常测试用例
| ID | 描述 | 覆盖异常 | 前置条件 | 操作序列 | 预期结果 |
|----|------|----------|---------|---------|---------|
| ST-S25-EX-2.1 | overlay-add 谓词不可求值 | EX-2.1 | add 节点谓词组合非法 | `status` | FLOW_SCHEMA_INVALID |
| ST-S25-EX-2.2 | launched builtin skip/reorder | EX-2.2 | launched overlay skip/reorder | `next` | FLOW_SCHEMA_INVALID（fail loud）|
| ST-S25-EX-2.3 | op:modify 覆盖 id | EX-2.3 | overlay modify set.id | `flow show` / 派生 | FLOW_SCHEMA_INVALID |

## 四、覆盖度校验清单
- [ ] resolved 合并 + 无 overlay 零漂移：UT-S25-01、UT-S25-02、ST-S25-04
- [ ] initial 四操作生效：UT-S25-03、UT-S25-04、UT-S25-05、UT-S25-06、ST-S25-01
- [ ] launched add/modify 生效 + proposal_step 回退（含 writing）：UT-S25-08、UT-S25-09、UT-S25-10、UT-S25-11、ST-S25-02
- [ ] launched builtin skip/reorder fail loud：UT-S25-12、UT-S25-13、ST-S25-03、ST-S25-EX-2.2
- [ ] modify-id 拦截：UT-S25-14、ST-S25-EX-2.3
- [ ] 谓词合法组合矩阵（含 invalid）：UT-S25-15、UT-S25-16、UT-S25-17、ST-S25-EX-2.1
- [ ] legacy 顶层回退 / 省略规则：UT-S25-18、UT-S25-19
- [ ] --auto 安全边界：UT-S25-20
- [ ] 错误信封 e.code（非硬编码）：UT-S25-21
- [ ] 分层解耦（flow show 宽松 vs 派生严格）：ST-S25-05

## 五、overlay-add 节点 dispatch 继承与保守默认（contract-self-description）

> 验证 C4/D6：`next_node.dispatch` 权威数据源 = flow 节点定义；overlay-add 节点显式声明则以声明为准；
> **未声明时输出完整保守默认对象**（`{idempotent:false, timeout_seconds: defaults.dispatch.timeout_seconds, artifacts_hint:[]}`），
> 不从 `produces`/`done_when` 推导；`artifacts_hint:[]` ＝「产物未知」契约语义（消费方不得据此判死，只能升级观察）。

### 单元测试用例补充
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S25-22 | overlay-add 节点显式声明 dispatch → resolved 原样透传 | C4/D6 | overlay add 节点声明 `dispatch:{idempotent:true, timeout_seconds:600, artifacts_hint:["out.md"]}` 与 `requires_reviewed:["proposal"]`、为当前节点 | `next --format json` | `next_node.dispatch` 三字段逐一等于声明值；`next_node.requires_reviewed` 同样透传；不被保守默认覆盖 |
| UT-S25-23 | overlay-add 未声明 dispatch → 输出完整保守默认对象且过 schema 校验 | C4/D6 | overlay add 节点**无** dispatch 声明；builtin flow `defaults.dispatch.timeout_seconds` 生效 | `next --format json` + 用打包 `spec/schema/next.schema.json` 校验 | `next_node.dispatch == {idempotent:false, timeout_seconds:<defaults.dispatch.timeout_seconds>, artifacts_hint:[]}`（完整对象、三字段齐备、无缺失分支）；解析 envelope 后以 **`output.data`** 为实例通过 next schema 校验（schema 校验对象 = data 对象；`artifacts_hint:[]` 是合法契约语义而非缺省缺失） |
| UT-S25-24 | 项目 overlay 覆盖 `defaults.dispatch.timeout_seconds` → 物化进未声明节点 | C4/D6 | overlay 顶层 `defaults:{dispatch:{timeout_seconds:120}}` + add 节点无 dispatch 声明 | resolved flow 派生 / `next --format json` | 该节点 `dispatch.timeout_seconds==120`（flow 文件 `defaults.dispatch.timeout_seconds` 为唯一默认值源（fallback），resolved 时物化进节点，输出层不存在第二处默认值） |

### 场景测试用例补充
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S25-06 | overlay-add 声明 / 未声明 dispatch 两路端到端 | C4/D6 | 同一 overlay 中一个 add 节点显式声明 dispatch、另一个不声明 | 依次让两节点成为当前节点 → `next --format json` → schema 校验 | 声明节点透传声明值；未声明节点输出保守默认完整对象；两路的 `output.data` 均通过 next schema 校验（以 data 为校验实例），`next_node.dispatch` 恒为完整对象、无二义分支 |

### 覆盖度校验补充
- [ ] overlay-add 显式 dispatch 声明原样透传（含 requires_reviewed）：UT-S25-22、ST-S25-06
- [ ] 未声明 dispatch → 完整保守默认对象 + schema 校验通过：UT-S25-23、ST-S25-06
- [ ] `defaults.dispatch.timeout_seconds` 唯一默认值源（fallback）、overlay 可覆盖并物化：UT-S25-24
