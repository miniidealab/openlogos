# S16: 输出机器可读 JSON — 测试用例

## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S16-01 | 解析 format=json | parseFormat | CLI 参数 | --format json | 返回 json |
| UT-S16-02 | `next`/`status --format json` 活跃提案下暴露 `code_required` 布尔字段 | collectStatusData / next 派生 | 存在活跃提案 | `next --format json` | `modules[].active_change.code_required` 存在且类型为 boolean |
| UT-S16-03 | `code_required` 取值等于 `isCodeRequiredForProposal` | isCodeRequiredForProposal | A: 纯文档提案（无 `[code]`、无测试 delta、未声明代码级）；B: 含 `[code]` 或新增 `UT-*` 的代码提案 | 分别 `next --format json` | A: `code_required==false` 且 `next_node.id` ∉ {`code`,`plan-slices`}；B: `code_required==true` |
| UT-S16-04 | 零漂移边界：无活跃提案时不出现 `code_required` | collectStatusData | `initial` 模块或 launched 无活跃提案 | `status --format json` | `modules[].active_change==null`，输出**不含** `code_required` 字段（既有 golden 不漂移） |
| UT-JSON-09 | `collectDetectData` 在可恢复 YAML 损坏下仍返回 launched 生命周期 | collectDetectData | `logos-project.yaml` 前半段 modules 完整，后半段存在语法错误 | detect helper | `project.modules` 存在，`project.lifecycle=launched`，并返回 `yaml_diagnostics.parse_status=recovered` |
| UT-JSON-10 | `collectStatusData` 在可恢复 YAML 损坏下仍返回 modules | collectStatusData | 同上 | status helper | `modules` 存在，`lifecycle=launched`，并返回 `yaml_diagnostics.parse_status=recovered` |
| UT-JSON-11 | `collectVerifyData` 暴露单阶段 pre_run 状态 | collectVerifyData | 配置 pre_run_command | verify helper | `pre_run.mode=pre_run_command`，包含命令状态与 final result_path |
| UT-JSON-12 | `collectVerifyData` 暴露两阶段预跑状态 | collectVerifyData | 配置 regression_command + incremental_command | verify helper | `pre_run.mode=two_phase`，包含阶段命令、合并策略与阶段结果路径 |
| UT-JSON-13 | `collectVerifyData` 暴露覆盖不足诊断 | collectVerifyData | 未配置预跑命令且覆盖不足 | verify helper | `pre_run.mode=none`，包含局部测试诊断与配置建议 |

## 二、场景测试用例
### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S16-01 | 输出 JSON envelope | Step 1→5 | 传入 json | detect/status/verify --format json | 返回统一 envelope |
| ST-JSON-24 | verify --format json 暴露单阶段 pre_run 状态 | Step 1→5 | 配置 pre_run_command | verify --format json | 返回 `pre_run.mode=pre_run_command`，且 commands 中包含执行状态 |
| ST-JSON-25 | verify --format json 暴露两阶段状态与合并策略 | Step 1→5 | 配置 regression/incremental 命令 | verify --format json | 返回 `pre_run.mode=two_phase`、阶段命令状态、结果路径和合并策略 |

### 2.2 异常路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-JSON-21 | detect --format json 在局部损坏 YAML 下仍暴露 launched 模块 | Step 1→5 | `logos-project.yaml` 部分损坏但 `modules` 可恢复 | detect --format json | `project.modules[0].lifecycle=launched`，`project.lifecycle=launched`，`yaml_diagnostics.parse_status=recovered` |
| ST-JSON-22 | status --format json 在局部损坏 YAML 下仍暴露 launched 模块 | Step 1→5 | 同上 | status --format json | `modules[0].lifecycle=launched`，`lifecycle=launched`，`yaml_diagnostics.parse_status=recovered` |
| ST-JSON-23 | detect/status --format json 在无法恢复 YAML 时返回诊断 | Step 1→5 | `logos-project.yaml` 整体损坏，无法恢复任何模块信息 | detect/status --format json | 返回明确 `yaml_diagnostics.parse_status=error` 与错误摘要，不得静默回退为“看起来正常” |
| ST-JSON-26 | verify --format json 在覆盖不足且无预跑配置时返回诊断 | Step 1→5 | 未配置预跑命令且结果不完整 | verify --format json | `pre_run.mode=none`，`diagnostics` 与 `suggestions` 可供 RunLogos 展示 |

## 三、覆盖度校验
- [x] format=json envelope：已覆盖（UT-S16-01 / ST-S16-01）
- [x] `code_required` 契约字段（存在性 / 取值 / 零漂移边界）：已覆盖（UT-S16-02 / UT-S16-03 / UT-S16-04）
- [x] detect/status 容错：已覆盖（UT-JSON-09 / UT-JSON-10 / ST-JSON-21 / ST-JSON-22 / ST-JSON-23）
- [x] verify 单阶段 pre_run 状态：已覆盖（UT-JSON-11 / ST-JSON-24）
- [x] verify 两阶段状态与合并策略：已覆盖（UT-JSON-12 / ST-JSON-25）
- [x] verify 覆盖不足诊断：已覆盖（UT-JSON-13 / ST-JSON-26）

## 四、golden characterization 归属（机器可读 JSON 契约锚点）

`cli/test/golden-baseline.test.ts` 在录制 `status` / `next --format json` 快照时，同时**表征**
S16（输出机器可读 JSON）所定义的通用信封与 data schema 现状行为——golden 快照本身就是 S16
JSON 契约的字节级实例。

归属说明：
- 该 golden 测试**表征**（characterize）S16 现状 JSON 输出，而非定义新契约；本切片
  （flow-engine-foundation）应**全部通过**。
- 其作用是在后续 flow 派生切换切片（切片 B）时，作为"JSON 输出 1:1 不漂移"的等价锚点——
  若派生切换改变了 `--format json` 的字段或结构，golden 快照将立即失败。
- golden 测试不替代 S16 既有 UT/ST 用例，二者并存：S16 用例验证信封/字段契约定义；
  golden 快照锁定整段 JSON 的字节级等价。

## 五、contract 版本握手与 schema 发布测试（contract-self-description）

> 覆盖 D1（status/next data 顶层 `contract` 版本握手、版本-schema 一一映射）与 C7（发布 JSON Schema、prepack 打包与包内容验证、未知枚举保守语义的契约文档化）。验收边界按 D9：本节只验**生产者契约**；「未知 major/未知枚举 → 保守模式」的消费方行为验收归 runlogos R5 提案。按 D8 主动破例声明：data 顶层新增 `contract` 打破「data 顶层逐字节不变」→ 全部 9 个 golden 基线快照随本变更重拍属预期。本节用例编号顺延既有最大编号（UT-S16-04 / ST-S16-01）。用例实现必须写入 OpenLogos reporter，测试名包含对应 ID 供 verify 抽取。

### 5.1 单元测试用例补充

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S16-05 | status/next envelope data 顶层 contract 字段（初始 1.0.0） | D1 contract 握手 | 任意 fixture（initial / launched、有无活跃提案均取样） | `status --format json` 与 `next --format json` | 两命令 `data.contract` 恒在场且等于 `{"version":"1.0.0"}`；`version` 为合法 SemVer 字符串，独立于 envelope 顶层的 CLI 版本串（两者可不同） |
| UT-S16-06 | contract.version 与打包 schema 版本一一映射 | D1 版本-schema 映射 | `spec/schema/status.schema.json`、`spec/schema/next.schema.json` 内嵌契约版本号 | 读取响应 `contract.version` 与两份 schema 内嵌版本比对 | 三者完全一致（均为 `1.0.0`）；构造失配（改任一 schema 内嵌版本）→ 该 CI 校验测试失败 |
| UT-S16-07 | schema 随 npm prepack 打包 + 包内容验证 | C7 schema 发布 | 执行 `npm pack`（或等价 prepack 流程） | 检查 pack 产物文件清单并用打包 schema 校验真实输出 | 产物包含 `spec/schema/status.schema.json` 与 `spec/schema/next.schema.json`；解析真实 `status`/`next --format json` 的 envelope 后，**以 `output.data` 作为 schema 校验实例**通过对应 schema（两份 schema 的校验对象 = data 对象，非整份 envelope；含 `step_meta`、`dispatch` 必填字段）；另行断言 envelope 外层结构含 `command`/`version`/`timestamp`/`data` 四字段 |
| UT-S16-08 | 未知枚举保守语义在契约中文档化 | C5 未知值语义 | 已发布的两份 schema 与 `spec/cli-json-output.md` 契约文本 | 静态断言测试 | schema 对闭合枚举字段（`step_meta.phase`/`step_meta.kind` 等）附带「消费方遇未知值必须按保守分支处理」的契约描述；`artifacts_hint: []` ＝「产物未知，消费方不得据此判死、只能升级观察」语义在契约中明文可查；任一措辞缺失 → 测试失败 |
| UT-S16-09 | non-Markdown 整文件 delta 合并后产物机器校验 | F11 合并协议（skills/merge-executor） | 按合并协议应用 `deltas/spec/schema/*.json` 与 `deltas/spec/flow/*.yaml` 整文件 delta | 检查合并产物 | 目标 `spec/schema/status.schema.json`、`spec/schema/next.schema.json` 存在且可直接 `JSON.parse`，文件任意位置不含 `## MODIFIED`/`## ADDED` 标记行；目标 `spec/flow/*.yaml` 可被 YAML 解析且首行非标记行；构造「标记行未剥离」的坏产物 → 校验必须失败 |

### 5.2 场景测试用例补充

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S16-02 | schema 发布与契约版本一致性端到端 | Step 1→5 | launched 活跃提案 fixture | `npm pack` → 从 pack 产物取 schema → 执行 `status --format json` 与 `next --format json` → 解析 envelope 取 `data` → 用产物内 schema 逐一校验 `data` 实例 | 两命令的 **`output.data`** 均通过打包 schema 校验（校验对象 = data，另行断言 envelope 外层 `command`/`version`/`timestamp`/`data` 结构）；`data.contract.version` 与产物内两份 schema 内嵌版本一致（`1.0.0`）；本用例只验生产者侧字段与打包完整性，不验消费方保守模式（归 runlogos R5） |

### 5.3 覆盖度校验补充

- [ ] envelope data 顶层 contract 字段（初始 1.0.0）：UT-S16-05
- [ ] contract.version 与打包 schema 版本一致性：UT-S16-06、ST-S16-02
- [ ] schema 发布 / prepack 包内容验证：UT-S16-07、ST-S16-02
- [ ] 未知枚举保守语义契约文档化：UT-S16-08
- [ ] non-Markdown 整文件 delta 合并后产物可解析且无标记行：UT-S16-09

## 六、切片验收 JSON 与 Schema 测试

> 以下用例实现必须把精确 ID 写入测试名，并通过 OpenLogos reporter 产出结果。

### 6.1 单元测试用例补充

| ID | 描述 | 前置条件 | 输入 | 预期输出 |
|---|---|---|---|---|
| UT-S16-10 | checkpoint verify 字段完整 | 有效 3 切片 manifest，第2片 attempted | `verify --format json` | `verify_mode=slice-checkpoint`、attempted 非空、eligible/pending 互斥且排序稳定、manifest/checkpoint 对象完整 |
| UT-S16-11 | final 字段约束 | 全部 checkpoint 与任务完成 | `verify --format json` | `verify_mode=final`、`attempted_slice_id=null`、pending=[]、eligible=全部定义 ID |
| UT-S16-12 | pending 与 uncovered 分离 | checkpoint 缺未来片结果 | JSON 输出 | pending 含未来 ID，uncovered 不含；coverage 分母等于 eligible 长度 |
| UT-S16-13 | missing 恢复动作完整 | 多切片提案缺 manifest | `next --format json` | reason=`test-slice-manifest-missing`；plan-slices 的 8 hint 字段与 dispatch 三字段齐全 |
| UT-S16-14 | invalid/stale/unsupported 枚举分流 | 三类 manifest fixture | status/next | invalid/stale 可恢复派发；unsupported 保守阻塞、不覆盖 |
| UT-S16-15 | status/next 状态同源 | 同一磁盘 checkpoint 状态 | 分别取两命令 data | `slice_verification_state` 逐字段同义，无独立算法漂移 |
| UT-S16-16 | 1.1.0 Schema 正反例 | 打包 status/next/verify schema | 校验合法对象，再删除/错型关键字段 | 合法 data 全部通过；checkpoint attempted=null、final pending 非空、dispatch 缺字段等反例失败 |
| UT-S16-17 | legacy 可省略新增对象 | 单切片、docs-only、已越过 final 三 fixture | status/next/verify JSON | 兼容路径可省略 slice 状态且通过 1.1.0 schema，不被误派恢复 |

### 6.2 场景测试用例补充

| ID | 描述 | 覆盖步骤 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S16-03 | checkpoint→final JSON 状态序列 | S16/S13 | 三切片逐轮调用 status/next/verify 并保存 data | attempted、confirmed、eligible、pending 按 checkpoint 稳定演进；final 归零 pending；每份 data 过随包 schema |
| ST-S16-04 | RunLogos 只靠 JSON 完成恢复 | S16/S28 | consumer 不读文件，仅消费 missing action 派发恢复并重调 next | 可完成恢复并取得 code/verify 前沿；无 Markdown 解析或私有 Gate 判断 |

### 6.3 覆盖度校验

- [ ] verify mode 与集合字段：UT-S16-10～UT-S16-12、ST-S16-03
- [ ] 恢复动作与枚举：UT-S16-13、UT-S16-14、ST-S16-04
- [ ] 同源派生与 schema：UT-S16-15、UT-S16-16
- [ ] legacy：UT-S16-17

## S16 Authority Closure JSON 测试


### 单元测试

| ID | 场景 | 输入 | 精确期望 |
|---|---|---|---|
| UT-S16-35 | required summary shape | 一个闭合 fact、四个 projection、两个 retired source | 八字段全在场、snake_case、计数与 evaluator 一致、pass=true |
| UT-S16-36 | violation code 闭合枚举 | 分别触发缺声明/畸形/引用缺失/闭包缺失/cutover 缺失 | 仅返回五个规范 code，item 四字段必填 |
| UT-S16-37 | legacy 省略与 not_applicable 区分 | 已越过 plan legacy；合法 not_applicable | legacy 省略对象；not_applicable 对象在场且零计数/pass=true |

### 场景测试

| ID | 场景 | 操作序列 | 精确期望 |
|---|---|---|---|
| ST-S16-11 | 四消费者同源 | 对同一 proposal 运行 change-lint/status/next/flow JSON | 去除命令 envelope/timestamp 后 authority summary 深相等；issues 同源排序 |

### 追溯与 reporter

覆盖 JSON 规范、AC-05 和历史兼容。实现必须使用 OpenLogos reporter 写 `logos/resources/verify/test-results.jsonl`。

## status/next 错误 envelope 与瞬态码验收测试用例

> 承接上一节中与合并事务无关的两条：status/next 的失败路径一律结构化报码、瞬态码集合与合同版本绑定。ID 沿用不变（UT-S16-40 / UT-S16-41），仅脱离事务语境独立成节。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S16-40 | 失败路径结构化错误码枚举 | 枚举 status/next 既有失败路径（flow 配置错误、baseline 读锁、guard/提案状态损坏等）逐一断言 stderr error envelope 携带稳定 error.code，无一路径纯文本退化 |
| UT-S16-41 | 瞬态码集合稳定 | 瞬态类错误码集合（含 baseline_commit_in_progress）与合同版本绑定；集合快照回归，增删未走合同版本即红 |

### 自动化与证据要求

- 错误路径枚举用例维护「失败路径 → 期望 error.code」注册表，新增失败路径必须登记，防单路径退化。
- 每个用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S16"`；失败不得写 pass。
