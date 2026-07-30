# S34: 管理 feature 分组 — 测试用例

> **测试边界（回应 delta-F2）**：CLI **不**取号、**不**分配 feature ID、**不**写 `logos-project.yaml`、**不**执行 AI 回写。`feature_counter` 取号与两步式冲突恢复是 **AI/Skill 指令**，以「生成的 backfill prompt 内容 + scenario-architect Skill 文本」的**静态/快照校验**锁定（校验语义等价的算法表述，字面串以 Skill/prompt 实际用词 `configured_next_id` 为准），而非 CLI 分配逻辑。`feature-backfill` 命令只生成 prompt、打印路径、保证 YAML 字节不变与幂等；AI 按 prompt 回写 YAML 属人工/文档契约后续步骤，不作为 CLI 场景测试的执行动作。

## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S34-01 | 解析 features[] 与 scenario.feature | `project-yaml.normalizeProjectYaml` | yaml 含 `features[]` + `feature_counter` + 场景带 `feature` | 读取 yaml | `ProjectYamlData` 含 `features`、`feature_counter`，`scenario.feature` 被解析 |
| UT-S34-02 | 旧 yaml 无 feature 字段向后兼容 | `project-yaml.normalizeProjectYaml` | 旧 yaml 无 `features`/`feature_counter`/`scenario.feature` | 读取 yaml | 解析成功，feature 相关字段为 undefined，不报错 |
| UT-S34-03 | feature ID 重复取首现（分组派生，非分配） | status feature 分组派生 | `features[]` 出现两个 `F01` | 分组 | 取 YAML 首现 F01，其余忽略（不抛错、CLI 不改写 yaml） |
| UT-S34-04 | backfill prompt/skill 含两步式冲突恢复指令（静态快照，回应 F2） | `feature-backfill` prompt 生成 + `scenario-architect` SKILL 文本 | — | 读生成的 prompt 与 skill 文本 | 两处均含语义等价的两步式规则 `allocated = max(configured_next_id, max(existing)+1)`（`configured_next_id = feature_counter?.next_id ?? 1`）与工作示例「已有 F05 + next_id=3 → 分配 F06、持久化 next_id=7、下次 F07、绝不复用」 |
| UT-S34-05 | backfill prompt/skill 含计数器缺失默认与正常前移指令（静态快照，回应 F2/F7） | `feature-backfill` prompt + `scenario-architect` SKILL 文本 | — | 读 prompt 与 skill 文本 | 两处均声明 `configured_next_id = feature_counter?.next_id ?? 1`（首次回填从 F01 起）与正常取号「读→用→+1 写回」 |
| UT-S34-06 | 有注册 feature 时三态降级为未分组 | status feature 分组 | 有 ≥1 注册 feature；场景 feature 缺失、指向未知 F、指向跨 module 的 F | 分组 | 三种场景一律入所属 module 的 `__ungrouped__` 桶，不报错 |
| UT-S34-07 | features[] 成员列表按 YAML 顺序 | status feature 分组 | module 下多 feature、各含多场景 | 分组 | `features[]` 按声明顺序，`scenarios:[{id,name}]` 按 scenarios[] 顺序；`__ungrouped__` 恒末位 |
| UT-S34-08 | 已登记空成员 feature 仍展示（回应 F4） | status/next/feature list 分组 | `features[]` 登记 F01（module==core）但无场景归属 F01 | 分组 | F01 输出 `scenarios:[]`；status/next 与 feature list 对已输出 feature 集合一致（均含 F01）；无未归属场景时不出 `__ungrouped__` |
| UT-S34-09 | 纯 pre-feature 项目逐字节完全一致（含 contract.version，回应 F1=B/F9） | status 文本渲染 `status()` + JSON `collectStatusData`→envelope；next 文本 `next()` + JSON next envelope | module 既无注册 feature、且无任何场景带 `feature` 键 | status/next 的文本与 JSON 两种渲染入口 | 省略 `features` 字段；`data.contract.version` **保持 `1.0.0`**；对旧 YAML 的 status/next **文本与 JSON 分别**逐字节 golden 对比，**允许变化集合 = ∅（完全零漂移，含版本字段）** |
| UT-S34-10 | 条件版本发射：含 features → 1.1.0，无 features → 1.0.0（回应 F1=B） | `step-registry` 版本发射 / json-output / schema | ①带 feature 项目 ②纯 pre-feature 项目 | 读 status/next `--format json` | ①响应 `contract.version==1.1.0` 且含 `modules[].features`；②响应 `contract.version==1.0.0` 且无 `features`；两版均与打包 schema（`x-contract-version` superset 支持集 {1.0.0,1.1.0}）一致（包内容验证测试） |
| UT-S34-14 | 条件版本 schema 约束反例（回应 F1=B） | `status.schema.json`/`next.schema.json` 根级 allOf | — | 构造响应对象校验 | `{contract.version:"1.0.0", modules:[{id,features:[…]}]}` **不通过**（1.0.0 禁带 features）；`{contract.version:"1.1.0", modules:[{id,features:[…]}]}` 通过；`{contract.version:"1.0.0", modules:[{id}]}`（无 features）通过 |
| UT-S34-11 | feature-backfill 打印 prompt_path 且不改 yaml（回应 F9） | `feature-backfill` 命令 | 存量项目场景平铺 | 执行 backfill（文本 + `--format json`） | 文本模式 stdout 含路径 `logos/feature-backfill-prompt.md`；`--format json` 的 `data.prompt_path` 等于该路径；写入该 prompt 文件；`logos-project.yaml` 字节不变；重复执行幂等覆盖、退出码 0 |
| UT-S34-12 | 无注册 feature + 未知引用仍出降级桶（回应 F10） | status feature 分组 | module 无注册 feature；≥1 场景显式写 `feature: F99`（未知） | 分组 | **不**省略 `features`；输出末位 `__ungrouped__` 含该 module 全部未归属场景（含 F99 与无 key 场景） |
| UT-S34-13 | 无注册 feature + 跨 module 引用仍出降级桶（回应 F10） | status feature 分组 | F01 注册在 module B；module A 场景写 `feature: F01`（跨 module） | 分组 | module A **不**省略 `features`；输出末位 `__ungrouped__` 含 module A 该场景 |

## 二、场景测试用例
### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S34-01 | feature list 只读查看分组 | Step 1 | 场景部分带 feature 归属、含空成员 feature | `openlogos feature list --format json` | `data.modules[].features[]` 含全部注册 feature（空成员 `scenarios:[]`）+ 有未归属场景时 `__ungrouped__`（末位），成员列表 `scenarios:[{id,name}]` |
| ST-S34-02 | status/next 分组导航且旧项目完全零漂移（文本+JSON 四调用，回应 F9/F1=B） | Step 4 | ①有 feature 项目 ②纯 pre-feature 旧项目 | 依次执行四次：`openlogos status`（文本）、`openlogos status --format json`、`openlogos next`（文本）、`openlogos next --format json` | ①`modules[].features` 同构呈现、响应 `contract.version==1.1.0`；②对旧项目**四路输出各自绑定旧版 golden 逐字节对比，全部完全零漂移（含 `data.contract.version` 保持 `1.0.0`，无任何允许变化字节）** |
| ST-S34-03 | 存量一键回填 CLI 边界（生成 prompt，不改 yaml） | Step 2 | 存量项目场景平铺 | `openlogos feature-backfill` | 生成 `logos/feature-backfill-prompt.md`、打印/返回路径；`logos-project.yaml` 字节不变；重复执行幂等覆盖。**AI 按 prompt 回写 YAML 为文档契约后续步骤（见 Step 3 叙事），不在本 CLI ST 执行范围** |

### 2.2 异常路径
| ID | 描述 | 前置条件 | 操作序列 | 预期结果 |
|----|------|---------|---------|---------|
| ST-S34-EX-01 | feature list 未注册 module | 传入不存在的 `--module` | `openlogos feature list --module ghost --format json` | 通用错误 envelope，错误码 `MODULE_NOT_FOUND`，非零退出码 |
| ST-S34-EX-02 | feature list：真正空 module 返回 [] / 有场景无注册出降级桶（回应 F10） | ①真正空 module（无注册 feature 且无场景）②module 有场景但无注册 feature | `openlogos feature list --format json` | ①该 module `features: []`；②该 module 返回 `features:[{"id":"__ungrouped__",...}]`（含全部未归属场景），**非** `[]`；退出码 0 |

> **F8 schema 反例（在 s34-feature.test.ts 内断言）**：`{id:"F00"}` / `{id:"F001"}` / `{id:"F0"}` / 缺 `spec` 键的 feature item 均**不**通过 `status.schema.json`/`next.schema.json` 的 `$defs/feature` 校验；`{id:"F01"}` / `{id:"F100"}` / `{id:"__ungrouped__"}` 且含 `spec`（可为 null）通过。

## 三、feature-backfill 纳入逆向候选（feature-backfill-brownfield）

> 测试边界：CLI 只生成 prompt、不改 `logos-project.yaml`、不改 `## 逆向基线来源` 章节;AI 回写（scenario 取号 + 登记 scenarios[] + 分配 feature）为文档契约后续步骤,以 prompt/Skill 静态快照锁定,不在 CLI 执行范围。

### 3.1 单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S34-15 | 只纳入 active&&verified==false 的 scenario-candidates,排除 system-map 与 verified:true;同 module 坏 system-map 不阻断（回应 F1） | `feature-backfill` 候选查询（只读 manifest scenario-candidates target） | 项目有 `system-map` + `scenario-candidates` 两类逆向产物;scenario-candidates 中含 active `verified:false`、active `verified:true`、tombstone 各若干;**另有一份同 module 坏 fenced YAML 的 system-map 文档**;`scenarios[]` 不含它们 | 执行 backfill | prompt **只含 active && verified==false 的 scenario-candidates**（如实标注 verified:false）;**不含** system-map 候选、**不含** verified:true 候选、不含 tombstone;**坏 system-map 文档不阻断**（只读 scenario-candidates target,不做全局扫描）;`baseline_candidates_total` == 纳入的 verified:false 候选数 |
| UT-S34-16 | `baseline_candidates_total` 键恒在场且等于最终纳入数（回应 F4） | `feature-backfill --format json` | N 个存活 scenario 候选 | `--format json` | `data.baseline_candidates_total === N`（integer,键在场） |
| UT-S34-17 | 非存量→0 / 无 run 按命名约定回退→N / 不可定类→报错 / 约定目标坏 YAML→报错（回应 F2/F4） | `feature-backfill` 候选查询回退分类器（按**文件名**枚举、不依赖内容解析） | ①真·非存量（无 provenance/无 baseline_index/无 run manifest）②有合法 `<module>-scenario-candidates.md` 但无 committed run manifest ③有 provenance 迹象但无 manifest 且无约定命名文档 ④无 run/无 index，但约定命名目标 `<module>-scenario-candidates.md` **本身坏 fenced YAML**、预置哨兵 prompt | text + json | ①prompt 无候选段、`baseline_candidates_total === 0`（键在场）、成功;②**按命名约定回退纳入**、`baseline_candidates_total === N`（**绝不静默计 0 冒充非存量**）;③降级 → `BASELINE_PROVENANCE_INVALID`、非零退出、不写 prompt;④**回退目标发现按文件名（不依赖解析），坏 YAML 目标读取失败** → `BASELINE_PROVENANCE_INVALID`、非零退出、哨兵 prompt 字节不变（**不伪装成真·非存量计 0**）|
| UT-S34-18 | CLI 不改 yaml、不改 provenance verified、幂等（红线） | `feature-backfill` | 有场景候选 | 重复执行 | `logos-project.yaml` 字节不变;`## 逆向基线来源` 候选 `verified` 不变;重复覆盖同一 prompt、退出码 0 |
| UT-S34-19 | 提交进行中 → BASELINE_COMMIT_IN_PROGRESS、不写 prompt（回应 F2） | `feature-backfill` + `withRecoveredReadLocks` | 构造未终结 `prepared`/`committing` journal（不可恢复） | `--format json` | 错误码 `BASELINE_COMMIT_IN_PROGRESS`、非零退出;`feature-backfill-prompt.md` **未被写入/覆盖** |
| UT-S34-20 | prompt/Skill 含 scenario 取号契约（静态快照，回应 F3） | `feature-backfill` prompt + `scenario-architect`/backfill Skill 文本 | — | 读生成 prompt | 含 scenario 全局取号指令:`configured_next_id = scenario_counter.next_id ?? 1`、`allocated = max(configured_next_id, max(existing S)+1)`、多候选逐个 `SXX`+1、多 module、持久化 `next_id=最后分配+1`;及"不改候选 verified"红线 |
| UT-S34-21 | 索引 stale 重算 / 权威目标坏 fenced YAML 报错(哨兵字节) / 无关坏文档不阻断（回应 F6+F3+F1） | `feature-backfill` | ①索引 stale 但权威目标有效 ②权威 scenario-candidates 目标坏 fenced YAML(未终止引号)、预置哨兵 prompt ③`--module core`、另一 module(admin)有坏 provenance | 执行 backfill | ①锁内只读 manifest 目标文档重算、命令成功正常纳入;②**错误码 `BASELINE_PROVENANCE_INVALID`、非零退出、哨兵 prompt 字节完全不变(不覆盖)**（不以 `baseline_candidates_total=0` 冒充非存量);③**只读 core scenario-candidates target,admin 坏文档不阻断**、core 正常纳入 |
| UT-S34-22 | S33 覆盖率命令前后深相等（回应 F7） | S33 覆盖率读取入口 | 存量项目含 active `verified:false` + tombstone 共存 | 命令前/后各算覆盖率 | 前后 `denominator` / `tombstones` / `freshness` **深相等**;YAML/provenance/ prompt 幂等字节断言并存 |

### 3.2 场景测试用例
| ID | 描述 | 覆盖 | 前置条件 | 操作序列 | 预期结果 |
|----|------|------|---------|---------|---------|
| ST-S34-04 | 存量项目 feature-backfill 纳入场景候选（CLI 边界） | 补充时序 Step 0→2 | 存量项目:有 scenario 候选、`scenarios[]` 空 | `openlogos feature-backfill` | 生成含场景候选（标注 verified:false/未进 scenarios[]）的 prompt、返回 `prompt_path` + `baseline_candidates_total`;`logos-project.yaml` 与 `## 逆向基线来源` 均字节不变。**AI 取号+登记 scenarios[]+分配 feature 为文档契约后续步骤（见 Step 3），不在本 CLI ST 执行范围** |
| ST-S34-05 | `--module` 与全项目候选口径（回应 F5） | Step 1 | 两 module（core/admin）各有 scenario 候选 | ①`feature-backfill --module core --format json` ②不带 `--module` ③`--module ghost` | ①只纳入 core 候选、`baseline_candidates_total`==core 数;②按 `modules[]` 顺序聚合两 module、total==合计;③未注册 module → `MODULE_NOT_FOUND`、非零退出 |

## 四、feature-backfill 防文档示例毒化 + 错误 envelope 富化（provenance-scan-canonical-recompute）

> 测试边界：CLI 只生成 prompt、不改 yaml / 不改 `## 逆向基线来源`；断言扫描侧 canonical 采信在 `feature-backfill` 端的可观察行为 + `BASELINE_PROVENANCE_INVALID` envelope 的 `paths[]` + `reason`。

### 4.1 单元测试用例

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S34-23 | 含示例章节的文档不使真·非存量项目误报（provenance-scan-canonical-recompute） | `feature-backfill` 候选查询（扫描侧 canonical 采信） | 从未 baseline-seed 的项目（无 `scenarios[]/features[]/baseline_index`、无 committed run manifest），`logos/resources/reference/` 存有含 `## 逆向基线来源` 示例章节的文档，示例候选 `key` 格式合法但与 anchor 重算失配（如 `core::a1b2c3d4e5f6`/`cli:baseline-seed-commit`） | `openlogos feature-backfill --format json` | 成功、退出码 0、`data.baseline_candidates_total === 0`（键在场）、prompt 无候选段、**不报** `BASELINE_PROVENANCE_INVALID`；`logos-project.yaml` 与示例文档字节不变 |
| UT-S34-24 | `BASELINE_PROVENANCE_INVALID` envelope 含触发文件路径 + 失败分类（回应可诊断性） | `feature-backfill` 错误 envelope | ①权威/约定目标 `<module>-scenario-candidates.md` 坏 fenced YAML（`unparseable`）；②有 provenance 迹象但无 manifest 且无约定命名文件（`unclassifiable-evidence`） | `openlogos feature-backfill --format json` | 两情形均：错误码 `BASELINE_PROVENANCE_INVALID`、非零退出、不写/不覆盖 prompt；`error.paths` 为非空数组且含**触发文件相对路径**；`error.reason` 分别为 `unparseable` / `unclassifiable-evidence` |

### 4.2 覆盖度校验
- [ ] 含示例章节文档不使真·非存量项目误报、候选数计 0：UT-S34-23
- [ ] 错误 envelope 带 `paths[]`（触发文件）+ `reason` 分类（unparseable / unclassifiable-evidence）：UT-S34-24

## 五、feature-backfill 已登记去重（幂等硬门，scenario-registry-duplicate-on-rescan）

> **场景**：`feature-backfill` 的逆向候选查询此前不与现有 `scenarios[]` 对账，重扫/重跑会把已登记场景当新候选再登记，`scenario_counter` 铸出逐字同名、无文档的孤儿。本节锁定「候选入 prompt 前，以 `scenarios[]` 为对账基准、按 `(module, name)` 剔除已登记候选」的幂等硬门（见 `core-S34-feature-management.md` 补充时序 Step 1.5 / EX-S34.5、`spec/cli-json-output.md` §1.5「已登记去重」）。**去重只作用于读侧候选过滤，`## 逆向基线来源` 章节候选的 `state` / `verified` 不变。**

### 5.1 单元测试用例

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S34-25 | 候选与 scenarios[] 同 module 同 name → 剔除、不入 prompt、不计数 | `feature-backfill` 候选查询已登记去重 | 一份 scenario-candidates 含 active `verified:false` 候选 name=「用户注册与登录」(module=core)；`scenarios[]` 已有 `{id:S01, name:用户注册与登录, module:core}` | 执行 backfill（text + `--format json`） | prompt 候选段**不含**「用户注册与登录」；`baseline_candidates_total` 不计该项；`scenario_counter` 未因其自增；`## 逆向基线来源` 该候选 `state`/`verified` 字节不变 |
| UT-S34-26 | 真·新增候选（scenarios[] 无同名）仍照常纳入（不误杀） | `feature-backfill` 候选查询已登记去重 | scenario-candidates 含两个 active `verified:false` 候选：A name 已在 `scenarios[]` 登记、B name 不在 `scenarios[]` | `--format json` | prompt 候选段含 B、不含 A；`baseline_candidates_total === 1`（只计 B） |
| UT-S34-27 | 重跑 backfill 对已登记候选幂等 | `feature-backfill` 幂等 + 已登记去重 | 候选全部已在 `scenarios[]` 有同 module 同 name 登记条目 | 连续执行两次 backfill | 两次 `baseline_candidates_total` 相等且候选段无这些候选；`logos-project.yaml` 与 `## 逆向基线来源` 字节不变；退出码 0；不产生同名孤儿 |
| UT-S34-28 | 去重键为 `(module, name)`——跨 module 同名不误剔除 | `feature-backfill` 候选查询已登记去重键 | 候选 name=「登录」module=admin；`scenarios[]` 已有 `{name:登录, module:core}`（同名不同 module） | `--format json` | admin 的「登录」候选**仍纳入**（module 不同、非已登记）；`baseline_candidates_total` 计入该项 |

### 5.2 场景测试用例

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S34-06 | 存量项目重扫不产生同名孤儿场景（CLI 边界，回应 scenario-registry-duplicate-on-rescan / EX-S34.5） | 补充时序 Step 1→2 + Step 1.5 | 存量项目：scenario-candidates 的候选**已全部登记进 `scenarios[]`**（上一轮 backfill 结果，name/module 一一对应） | 再次 `openlogos feature-backfill --format json` | 生成的 prompt 候选段为空（已登记候选被剔除）；`data.baseline_candidates_total === 0`（键在场）；`logos-project.yaml` 与 `## 逆向基线来源` 均字节不变；退出码 0。**AI 回写属文档契约后续步骤，不在本 CLI ST 执行范围** |

### 5.3 覆盖度校验

- [ ] 已登记候选（同 module 同 name）剔除、不入 prompt、不计数：UT-S34-25
- [ ] 真·新增候选不误杀、仍纳入：UT-S34-26
- [ ] 重跑幂等、不产生同名孤儿、yaml/provenance 字节不变：UT-S34-27、ST-S34-06
- [ ] 去重键为 `(module, name)`、跨 module 同名不误剔除：UT-S34-28
