# S13: 运行测试验收并生成报告 — 测试用例

## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-01 | 解析 JSONL | parseJsonl | 结果文件内容 | JSONL | 返回测试结果 |
| UT-S13-02 | 兼容执行 pre_run_command | verify 预跑 | 配置了单阶段测试命令 | verify | 先执行预跑命令，再读取结果 |
| UT-S13-03 | 两阶段预跑按回归 → 增量顺序执行 | verify 预跑 | 同时配置 regression / incremental 命令 | verify | 两阶段按顺序执行，重复 ID 最后一次结果生效 |
| UT-S13-04 | 覆盖不足且无预跑配置时输出诊断 | verify 诊断 | 无预跑配置且 JSONL 覆盖不足 | verify | 产生 FAIL 和局部测试诊断 |
| UT-S13-05 | verify JSON 输出包含 pre_run 状态 | verify JSON | 传入 --format json | verify --format json | 返回 pre_run.mode、commands、diagnostics 和 suggestions |
| UT-S13-24 | release 摘要双语字段与回退原因 | release summary parser | CHANGELOG 含中英文摘要映射 | version list | 生成英文主摘要、中文原文摘要和英文缺失回退原因 |

## 二、场景测试用例
### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-01 | 生成验收报告 | Step 1→9 | 存在测试结果 | verify | 写入 acceptance-report.md |
| ST-S13-02 | 单阶段 pre_run_command 验收通过 | Step 1→9 | 配置 pre_run_command 且结果完整 | verify | 先跑预执行命令，再生成 PASS 报告 |
| ST-S13-03 | 两阶段 regression + incremental 验收通过 | Step 1→9 | 配置两阶段命令且阶段结果完整 | verify | 两阶段结果合并后生成 PASS 报告 |

### 2.2 异常路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-04 | 无预跑配置且覆盖不足 | Step 1→9 | 未配置任何预跑命令且结果不完整 | verify | FAIL，并输出可能只运行局部测试的诊断和配置建议 |

## 三、覆盖度校验
- [x] JSONL 解析：已覆盖（UT-S13-01）
- [x] 单阶段 pre_run_command 兼容：已覆盖（UT-S13-02 / ST-S13-02）
- [x] 两阶段 regression + incremental：已覆盖（UT-S13-03 / ST-S13-03）
- [x] 覆盖不足诊断：已覆盖（UT-S13-04 / ST-S13-04）
- [x] verify JSON 状态输出：已覆盖（UT-S13-05）

## 四、smoke 覆盖预检测试用例

### 4.1 单元测试用例补充
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-SMOKE-01 | 提取当前提案新增 smoke case ID | smoke coverage precheck | 活跃提案 deltas/test/smoke 中新增 `SMOKE-NEW-01` | proposal slug | 返回新增 ID 列表，不包含历史 smoke ID |
| UT-S13-SMOKE-02 | verify/code gate 发现新增 smoke case uncovered | smoke coverage precheck | 新增 smoke ID 存在，`smoke-results.jsonl` 缺少对应结果 | precheck | 返回 FAIL，诊断 `smoke_cases_uncovered` 并列出缺失 ID |

### 4.2 场景测试用例补充
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-SMOKE-01 | code 完成前阻断遗漏 smoke runner 的提案 | S13 Step 7a→7d | 活跃提案新增 smoke 用例，`[code]` 任务已尝试完成但无 runner/reporter | smoke 覆盖预检或 verify | 输出 `smoke_runner_missing` / `smoke_reporter_missing` / `smoke_cases_uncovered`，不允许把 code completion 视为通过 |

### 4.3 覆盖度校验补充
- [ ] smoke 覆盖预检提取新增 ID：UT-S13-SMOKE-01
- [ ] smoke 覆盖预检 uncovered 诊断：UT-S13-SMOKE-02、ST-S13-SMOKE-01

## 八、verify 证据分层回归

| ID | 用例 | 前置条件 | 操作 | 期望 |
|---|---|---|---|---|
| UT-S13-30 | focused reporter pass + global verify failed 输出可恢复诊断 | `test-results.jsonl` 中本片要求的 UT/ST 均 pass；acceptance report 中存在其它失败测试 | 读取 verify JSON / 派生自动诊断 | 输出 `reason="global-verify-failed"`、`completion_state="slice_done_global_verify_failed"`、`failed_tests` 非空、`human_action_required=false` |
| UT-S13-31 | reporter 缺失本片 test ID 不等价全量失败 | 本片要求 `UT-Sxx-*`，但 `test-results.jsonl` 无对应记录 | 派生自动诊断 | 输出 `reporter-missing` 或 `focused-tests-missing`，`missing_artifacts` 或 `required_test_ids` 指明缺口 |
| ST-S13-09 | verify 失败列表可驱动 repair | 全量 verify 失败，失败用例可解析 | `next --auto --format json` 或等价 driver 诊断 | `suggested_next_node` 指向 `code` / repair，携带 `failed_tests`，不输出 `retry-exhausted` |

### 覆盖度校验

- [ ] focused tests / reporter pass 与全量 verify failed 可同时表达：UT-S13-30
- [ ] reporter 缺失有独立诊断：UT-S13-31
- [ ] 全量失败可驱动 repair：ST-S13-09

## 九、verify 诊断传播边界测试

> 以下用例含 OpenLogos reporter。用例名必须带 `UT-S13-32` / `ST-S13-10` 等 ID，供 verify 抽取覆盖。

### 9.1 单元测试用例补充

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|---|---|---|---|---|---|
| UT-S13-32 | verify JSON 保留本次失败诊断 | verify JSON | 全量 verify 失败且可解析失败测试 | `openlogos verify --format json` | 输出 `automation_diagnostic.reason=="global-verify-failed"`、`failed_tests` 非空 |
| UT-S13-33 | verify 诊断不在 plan/spec 前沿自动传播为 repair | 诊断传播 | 同 UT-S13-32 后，活跃提案回到 `ready-to-merge` fixture | `next --auto --format json` | 不消费该 verify 诊断为 `suggested_next_node:"code"`；保留 merge command |
| UT-S13-34 | 只有当前实现/验证前沿消费 global verify failed | 诊断传播 | A: `coding` 且当前失败测试存在；B: `ready-to-delta` 且只有历史失败 | 分别执行 `next --format json` | A 可输出 repair/code 诊断；B 不输出可驱动 repair/code 诊断 |

### 9.2 场景测试用例补充

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S13-10 | verify 输出诊断但后续非实现前沿不被抢占 | Step 1→9 + status/next | 先产生一次 verify failed，再构造同提案 `ready-to-merge` | `verify --format json` → `next --auto --format json` | verify 响应含失败诊断；next 响应仍返回 `openlogos merge <slug>` |

### 9.3 覆盖度校验补充

- [ ] verify 本身输出全量失败诊断：UT-S13-32
- [ ] verify 诊断不跨前沿覆盖 plan/spec/merge：UT-S13-33、ST-S13-10
- [ ] 当前实现/验证前沿仍可消费 repair 诊断：UT-S13-34

## 十、verify 结果账本一致性回归

### 10.1 单元测试用例补充

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-35 | 非法 status 不得被判 PASS | verify consistency | 已定义 1 个自动化用例且该用例 pass；JSONL 另含同轮非法 `status:"unknown"` 结果 | `collectVerifyData` / `verify --format json` | `gate.result="FAIL"`，`gate.reason` 非空，`consistency.reasons` 包含 `invalid_test_result_status` |
| UT-S13-36 | 未定义结果 ID 不得污染 PASS | verify consistency | 已定义用例全部 pass；JSONL 另含 `UT-S13-GHOST` pass | `collectVerifyData` / `verify --format json` | `gate.result="FAIL"`，`consistency.unknown_result_ids` 包含 `UT-S13-GHOST`，不得写 `VERIFY_PASS` |
| UT-S13-37 | 统计守恒不成立时 FAIL | verify consistency | 结果集合可构造 `executed_count > defined_count` 或 `passed + failed + skipped != executed` | `collectVerifyData` | 输出 `result_ledger_inconsistent`，`pass_rate_pct < 100` 时不得 PASS |
| UT-S13-38 | 合法重复 ID 保持 last-write-wins | parse / consistency | 同一已定义 ID 先 fail 后 pass，且无额外非法行 | `parseJsonl` / `collectVerifyData` | 只保留最后一次结果；若所有定义用例最终 pass，则 Gate PASS |

### 10.2 场景测试用例补充

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-11 | 不自洽 verify 账本阻断全自动归档 | Step 7→9 | 活跃提案处于 ready-to-verify；JSONL 中 defined 用例均 pass，但另有非法 status 或未定义 ID 造成 pass_rate < 100 / executed > defined | `openlogos verify --format json` 后由 driver 读取 Gate | verify 退出非零，`gate.result="FAIL"`，不写 `VERIFY_PASS`，driver 不得继续 archive |

### 10.3 覆盖度校验补充

- [ ] 非法 status 硬门：UT-S13-35
- [ ] 未定义结果 ID 硬门：UT-S13-36
- [ ] 统计守恒硬门：UT-S13-37
- [ ] last-write-wins 正常兼容：UT-S13-38
- [ ] 全自动归档阻断：ST-S13-11

## 十一、verify skip 有效通过回归

### 11.1 单元测试用例补充

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-39 | 合法 skip 不阻塞 verify Gate | verify Gate | 定义 2 个自动化用例；JSONL 中 1 个 `pass`、1 个 `skip`；无失败、无未覆盖、无 checklist / AC 缺口 | `collectVerifyData` | `gate.result="PASS"`，`summary.pass_rate_pct=100`，`summary.skipped_count=1`，`skipped_cases` 包含 skip ID |
| UT-S13-40 | skip 计入有效通过率但保留审计列表 | verify summary | 定义用例均被 pass / skip 覆盖 | `collectVerifyData` / report data | `passed_count + skipped_count == executed_count`，`pass_rate_pct=100`，报告仍展示 Skipped Cases |

### 11.2 场景测试用例补充

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-12 | verify 含环境性 skip 时仍允许流程通过 | Step 7→9 | 活跃提案 ready-to-verify；全部定义用例均有结果，其中部分为 `skip`；无 fail / uncovered / consistency error | `openlogos verify --format json` 或等价 collector | verify 输出 PASS，不写 `VERIFY_FAIL`，不得返回 `gate.reason="skipped_cases"` |

### 11.3 覆盖度校验补充

- [ ] 合法 skip 不阻塞 Gate：UT-S13-39、ST-S13-12
- [ ] skip 计入有效通过率但保留审计：UT-S13-40

## 十二、verify 同 ID timestamp 去重全序测试（contract-self-description）

> 覆盖 D7：verify 同一用例 ID 多条记录的去重从「文件行序 last-wins」改为「timestamp 最新优先」，并完整覆盖可选 `timestamp` 字段的全序规则——(1) 逐条严格解析 ISO 8601（时区归一为绝对时刻），非法格式按缺失处理；(2) 该 ID 全部合法 → 绝对时刻最新优先，同刻（含异时区同刻）→ 文件行序后者优先；(3) 该 ID 存在任一缺失/非法 → 整组退回文件行序 last-wins（等价旧行为，不做时间猜测，宁慢勿错杀）。守恒不变量（executed≤defined 等既有 `consistency` 契约）在去重后计算、契约不变。本节用例编号顺延既有最大编号（UT-S13-40 / ST-S13-12）。用例实现必须写入 OpenLogos reporter，测试名包含对应 ID 供 verify 抽取。

### 12.1 单元测试用例补充

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-41 | 乱序追加、全部合法 timestamp → 取绝对时刻最新 | D7 规则 2 | 同一已定义 ID 两条记录：先写入 `pass`（timestamp=T2），后追加 `fail`（timestamp=T1，T1<T2） | `parseJsonl` / `collectVerifyData` | 该 ID 最终结果为 `pass`（绝对时刻最新优先，**不**按文件行序取后写入的 `fail`）；所有定义用例最终 pass 时 Gate PASS |
| UT-S13-42 | 缺失+合法混排 → 该 ID 整组退回行序 last-wins | D7 规则 3 | 同一 ID 三条记录：`fail`（合法 timestamp、时刻最新）→ `pass`（无 timestamp）→ `pass`（合法 timestamp、时刻最旧），行序如此排列 | `parseJsonl` / `collectVerifyData` | 因该 ID 存在缺失 timestamp，整组不比较时间、退回文件行序 last-wins：最终结果取最后一行（等价旧行为，不做时间猜测） |
| UT-S13-43 | 非法 timestamp 格式按「缺失」处理 | D7 规则 1+3 | 同一 ID 两条记录：`fail`（timestamp 为非法串，如 `"yesterday"` / `"2026-13-99"`）在前、`pass`（合法 timestamp）在后 | `parseJsonl` / `collectVerifyData` | 非法格式按缺失处理 → 该 ID 整组退回文件行序 last-wins（最终 `pass`）；不抛异常、不猜测时间 |
| UT-S13-44 | 异时区同刻 → 文件行序后者优先 | D7 规则 2 同刻分支 | 同一 ID 两条记录：`fail`（`2026-07-17T10:00:00+08:00`）在前、`pass`（`2026-07-17T02:00:00Z`，与前者为同一绝对时刻）在后 | `parseJsonl` / `collectVerifyData` | 时区归一后判定同刻 → 按文件行序后者优先，最终结果为 `pass` |
| UT-S13-45 | 重复追加幂等重放 | D7 确定性 | 先构造任意混合结果集（含 UT-S13-41/42 两类分布）得出去重结论，再将同一批记录原样整体重复追加一遍 | 两次 `collectVerifyData` 对比 | 每个 ID 的去重结果与 Gate 结论（PASS/FAIL）与追加前完全一致（同一磁盘状态派生同一结论、重复重放不翻转）；去重后守恒不变量计算不受重复行影响 |
| UT-S13-46 | 两阶段合并路径（regression+incremental）沿用同一 timestamp 去重全序规则 | D7 / C6 两阶段合并 | 配置 regression/incremental 两阶段，同一 ID 在两阶段各有一条：场景 A 两条均带合法 timestamp（回归晚于增量）；场景 B 增量记录缺 timestamp | 两阶段执行合并后读 result_path 并 `collectVerifyData` | 场景 A：取绝对时刻最新的记录（非合并文件末行）；场景 B：该 ID 整组退回合并后行序 last-wins（等价 `merge_results:"last-write-wins"` 旧字面行为，配置枚举名保留、语义升级为统一全序算法）；两阶段合并与单文件去重同一实现、不得两套语义 |

### 12.2 场景测试用例补充

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-13 | 乱序 jsonl 端到端：verify 结论跟随最新 timestamp | Step 1→9 | 活跃提案 ready-to-verify；`test-results.jsonl` 中某定义 ID 先有 `pass`（较旧时刻），后追加 `fail`（较新时刻） | `openlogos verify --format json` → 再追加更新时刻的 `pass` → 再次 `verify --format json` | 第一次 verify 判 FAIL（fail 时刻最新，不因 pass 行在前/在后翻盘）；第二次判 PASS；全程含无 timestamp 记录的其它 ID 保持行序 last-wins；`consistency` 既有契约（守恒/非法 status/未定义 ID 硬门）在去重后照常生效 |

### 12.3 覆盖度校验补充

- [ ] 乱序追加取最新（全合法）：UT-S13-41、ST-S13-13
- [ ] 缺失+合法混排整组退回行序：UT-S13-42
- [ ] 非法格式按缺失处理：UT-S13-43
- [ ] 异时区同刻按行序后者优先：UT-S13-44
- [ ] 重复追加幂等重放：UT-S13-45
- [ ] 两阶段合并路径 merge_results 语义与统一全序算法同源：UT-S13-46

## 十三、verify 沙箱依赖目录豁免测试（fix-sandbox-node-modules-write-audit）

> 覆盖沙箱写入审计的依赖目录豁免（S13 EX-3.3 / 功能规格 §2.9）、symlink 隔离与运行期写保护不变量（EX-3.4，含启动前拓扑与运行期动态逃逸、能力分层）与白名单定点采集回收：豁免匹配规则为「规范化并统一分隔符后存在完整路径段严格等于 `node_modules`」，禁止子串/前缀/后缀匹配；豁免说明走 `sandbox.infos` 信息级通道；白名单回收优先于豁免；`node_modules` 之外的审计语义一字不改。本节用例编号顺延既有最大编号（UT-S13-46 / ST-S13-13）。用例实现必须写入 OpenLogos reporter，测试名包含对应 ID 供 verify 抽取。

### 13.1 单元测试用例补充

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-47 | always 模式下仅写 node_modules 不判非白名单，豁免说明走 infos 通道 | EX-3.3 / §2.9 依赖目录豁免 | `verify.sandbox_mode=always`、`sandbox_deny_workspace_write=true`；项目含 `node_modules` 目录；预跑命令仅写入 `node_modules/.bin/*`（新增/改写文件）并正常写结果文件 | `runSandboxedCommand` 或 `openlogos verify --format json` | 命令 `status="pass"`，`sandbox.status="pass"`（不 FAIL、不 warn）；`sandbox.infos` 含一条信息级豁免说明；`sandbox.diagnostics` 与 `pre_run.diagnostics` 均**不含**该说明且无「检测到非白名单写入」；文本输出该说明以 `ℹ️` 渲染且全程仅出现一次，不以 `⚠️` 渲染 |
| UT-S13-48 | 精确段匹配边界：近似名称与豁免外路径语义不变（回归 + 负例） | EX-3.2 回归 / §2.9 匹配规则 | 同上配置；预跑命令写入 `node_modules/.bin/x` 及以下四类路径：`src/evil.txt`、`src/node_modules-cache/evil.txt`、`vendor/my-node_modules/data`、`node_modules.txt` | `runSandboxedCommand`（分别以 `always` / `auto` 执行）；路径含 Windows 分隔符形态（如 `src\\node_modules-cache\\evil.txt`）时先归一再判定 | `always`：命令 FAIL，非白名单列表**恰好**包含四条近似/无关路径且**不含**任何完整段等于 `node_modules` 的路径；`auto`：`sandbox.status="warn"` 并建议改用 `always`；分隔符归一化后判定结果一致；白名单构成不变 |
| UT-S13-49 | monorepo 嵌套 node_modules 同样豁免（完整段等于，非根前缀） | EX-3.3 嵌套形态 | 同 UT-S13-47 配置；预跑命令仅写入 `packages/a/node_modules/.bin/*` | `runSandboxedCommand`（`always` 模式） | 不判非白名单、不 FAIL；豁免按「存在完整路径段严格等于 `node_modules`」匹配而非仅根目录前缀，也非子串匹配 |
| UT-S13-50 | 内部相对 symlink 保持相对语义，穿透写入不落原 workspace | EX-3.4 / §2.9 symlink 隔离不变量 | monorepo 布局：`node_modules/pkg -> ../packages/pkg`（相对链接）；`verify.sandbox_mode=always`；预跑命令经 `node_modules/pkg/**` 写入文件 | `runSandboxedCommand` 后比对原 workspace | 沙箱副本内该链接目标仍为相对字面量且解析落在沙箱 workspace 内；写入发生在沙箱副本；**原 workspace `packages/pkg` 目录字节不变**（不得出现 cpSync 默认改写为指向原 workspace 绝对路径后穿透写入） |
| UT-S13-51 | 逃逸 symlink 按无法隔离处理，不得静默豁免 | EX-3.4 | 项目内存在解析目标位于 workspace 之外的 symlink（绝对目标外链，或复制后无法收敛进沙箱的链接），且该链接位于 `node_modules` 下 | 分别以 `always` / `auto` 执行 `runSandboxedCommand` | `always`：沙箱建立失败路径生效，命令 FAIL 并输出逃逸链接路径与修复建议；`auto`：降级为非隔离执行且 `sandbox.status="warn"`；两种模式下均不得把逃逸链接按依赖目录豁免静默放过 |
| UT-S13-52 | 白名单结果文件位于 node_modules 下仍被定点采集回收 | §2.9 白名单回收优先 | `verify.result_path="node_modules/.cache/openlogos/test-results.jsonl"`（合法配置）；`sandbox_mode=always`；预跑命令在沙箱内写出该结果文件 | `runSandboxedCommand` / `openlogos verify --format json` | 结果文件被定点采集回收到原 workspace 对应路径，verify 正常读取结果（不报无结果/覆盖不足）；回收不依赖快照 diff；该路径回收不触发非白名单判定 |
| UT-S13-53 | 运行期新建绝对逃逸 symlink 后写入被写保护阻断 | EX-3.4 运行期 / §2.9 运行期不可逃逸 | 运行期写保护机制可用；原 workspace 含哨兵文件；预跑命令在通过启动前校验后于沙箱 `node_modules/` 下新建指向原 workspace 的绝对 symlink，再经该链接写文件 | 分别以 `always` / `auto` 执行 `runSandboxedCommand` 后比对原 workspace | 写入尝试在文件系统层被拒绝（写入发生前阻断，非事后检测）；**原 workspace 字节零改动**（哨兵文件与目录内容不变）；`always` 下命令失败；任一模式均不得以依赖目录豁免静默通过 |
| UT-S13-54 | 运行期 retarget 内部链接指向原 workspace 后写入被写保护阻断 | EX-3.4 运行期 | 同 UT-S13-53 前置；沙箱内存在已通过启动前校验的内部相对链接；预跑命令运行期将其 retarget 到原 workspace 后经该链接写文件 | 分别以 `always` / `auto` 执行 `runSandboxedCommand` 后比对原 workspace | 同 UT-S13-53：写入发生前被阻断，原 workspace 字节零改动，不得以豁免静默通过 |
| UT-S13-55 | 运行期写保护不可用时按能力分层处理 | §2.9 能力分层 | 模拟运行期写保护机制不可用（如强制关闭 OS 隔离能力探测） | 分别以 `always` / `auto` 执行 `runSandboxedCommand` | `always`：命令失败，输出「无法启用运行期写保护」原因与修复建议；`auto`：继续沙箱复制执行但 `sandbox.status="warn"`，告警披露运行期动态 symlink 逃逸残留风险；两种模式均不得静默视为已隔离 |

### 13.2 场景测试用例补充

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-14 | 模拟 pnpm 依赖修复式写入的项目在 always 沙箱下 verify PASS | Step 1→9 | 活跃提案 ready-to-verify；`verify.sandbox_mode=always`、`sandbox_deny_workspace_write=true`；预跑命令模拟 pnpm 依赖准备（改写 `node_modules/.bin/*` 后运行测试并写 `test-results.jsonl`），全部定义用例 pass | `openlogos verify --format json` | verify Gate PASS，生成 `acceptance-report.md`；`sandbox.isolated=true`、`sandbox.status="pass"`；`sandbox.infos` 含信息级豁免说明，`sandbox.diagnostics` / `pre_run.diagnostics` 无「检测到非白名单写入」告警且不含该说明；结果文件正常回收，`node_modules` 变更不回收到原 workspace |

### 13.3 覆盖度校验补充

- [ ] always 模式 node_modules 写入豁免 + infos 信息级通道（不入 diagnostics / pre_run.diagnostics、ℹ️ 单次渲染）：UT-S13-47
- [ ] 精确段匹配负例（node_modules-cache / my-node_modules / node_modules.txt）+ 豁免外语义不变（always FAIL / auto warn）+ 分隔符归一：UT-S13-48
- [ ] monorepo 嵌套 node_modules 豁免：UT-S13-49
- [ ] 内部相对 symlink 保持相对语义、原 workspace 字节不变：UT-S13-50
- [ ] 启动前逃逸 symlink 按无法隔离处理（always FAIL / auto 降级告警）：UT-S13-51
- [ ] 运行期新建绝对逃逸链接写入被写保护阻断、原 workspace 零改动：UT-S13-53
- [ ] 运行期 retarget 内部链接写入被写保护阻断：UT-S13-54
- [ ] 运行期写保护不可用时能力分层（always FAIL / auto warn 披露残留风险）：UT-S13-55
- [ ] 白名单结果文件位于 node_modules 下定点采集回收：UT-S13-52
- [ ] pnpm 依赖修复式写入端到端 verify PASS：ST-S13-14

## 十四、切片 checkpoint/final verify 测试

> 覆盖 S13 切片感知 Gate。以下用例实现必须使用测试名中的精确 ID，并通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`；pending 不得伪造 reporter 行。

### 14.1 单元测试用例补充

| ID | 描述 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|
| UT-S13-56 | checkpoint eligible/pending 集合公式 | 3 切片 manifest；第 1 片已 PASS；第 2 片 attempted | 派生 verify scope | eligible=基线∪第1片∪第2片；pending=第3片；集合互斥、稳定排序 |
| UT-S13-57 | pending 不进入 uncovered 分母 | 同上，仅 reporter 缺第3片结果 | 收集并计算覆盖率 | uncovered 不含第3片；coverage 只按 eligible，Gate 可 PASS |
| UT-S13-58 | checkpoint PASS 只写检查点 | attempted eligible 全部 pass | 执行 marker/ledger 写入 | 追加当前 manifest 哈希的 PASS checkpoint；不写 `VERIFY_PASS`，不追加失败迭代 |
| UT-S13-59 | checkpoint FAIL 锁定稳定 slice | task checkbox 已提前勾选，attempted eligible 有 fail | 执行 verify | 写 `VERIFY_FAIL` 与 `LOOP_ITERS.attempted_slice_id`；下一次仍选原 slice |
| UT-S13-60 | checkpoint PASS 幂等 | 同一 manifest/eligible 已有等价 PASS 行 | 重复 verify | 不重复追加等价 checkpoint；状态前移一次 |
| UT-S13-61 | final 使用全部 defined ID | 所有 slice checkpoint PASS 且 code 完成 | 派生 scope | mode=final、attempted=null、eligible=全部非 manual、pending=[] |
| UT-S13-62 | final 覆盖不足硬失败 | final 缺任一后期 slice 结果 | 执行 verify | uncovered 含缺失 ID、写 `VERIFY_FAIL`、不写 `VERIFY_PASS` |
| UT-S13-63 | reporter 输出 pending ID 越界 | checkpoint runner 意外写未来 ID | 收集结果 | 返回 `result_outside_eligible_scope`；未来 slice 不提前确认 |
| UT-S13-64 | manifest 恢复态零失败副作用 | 多切片提案缺 manifest，已有 marker/loop 快照 | 调 verify 预检 | 返回恢复诊断；runner 未启动；`VERIFY_FAIL`、checkpoint、`LOOP_ITERS` 字节不变 |

### 14.2 场景测试用例补充

| ID | 描述 | 覆盖步骤 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S13-15 | 三切片 checkpoint 到 final 闭环 | S13 主路径 | 逐片实现并各执行 verify，最后再执行 final | 前三轮分别只确认当前片且不写最终 PASS；final 全量通过后才写 `VERIFY_PASS` |
| ST-S13-16 | checkbox 前移与进程重启不串片 | S13 重启边界 | 第2片 checkbox 先勾→checkpoint FAIL→退出进程→重启 verify | 两次失败均归属第2片，repair budget 只计真实失败，不误指第3片 |
| ST-S13-17 | 缺 manifest 恢复后续跑 | S13/S28/S32 恢复 | 删除 manifest→verify→按动作重建→重试 | 首次无 Gate 副作用；重建有效后从原 attempted slice 继续，已确认 checkpoint 保留 |

### 14.3 覆盖度校验

- [ ] eligible/pending 与分母：UT-S13-56、UT-S13-57、UT-S13-63
- [ ] checkpoint marker/账本/幂等：UT-S13-58～UT-S13-60
- [ ] final 全量硬门：UT-S13-61、UT-S13-62、ST-S13-15
- [ ] 恢复与重启：UT-S13-64、ST-S13-16、ST-S13-17

## S13 权威测试 ID 语法放宽后的 defined 集合测试

### 单元测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S13-65 | defined 集合接纳此前不可见的 ID | Step 1→4 | 已合并测试规格含 `UT-JSON-*` / `ST-JSON-*` 表格首列 ID | 调用 `extractDefinedVerificationIds` | 这些 ID 全部进入 defined 集合。**修复前它们被严格语法丢弃**——本用例即该遗漏的回归锁 |
| UT-S13-66 | 集合只增不减且 smoke 仍被排除 | Step 2→4 | 同上 | 对比放宽前后的 defined 集合 | 新集合是旧集合的真超集，无任何 ID 被移出；`logos/resources/test/smoke/` 下的 ID 仍不进入 defined（由 Gate 3.8 独立统计） |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S13-18 | 分母变大后覆盖度判据不放宽 | Step 4→6 | 真实 CLI；夹具项目的测试规格含 JSON 系表格首列 ID，其中一条**不**被任何 reporter 报告 | 跑 `verify` | 该未报告的 ID 被判未覆盖并阻断，覆盖度低于 100%。证明分母变大不是把标准降低，而是把此前在暗处的用例纳入统计——缺失时会被正确发现 |

### 追溯与覆盖

- AC-MERGEGATE-08 语法与数据一致（verify 一侧）：UT-S13-65。
- AC-MERGEGATE-09 集合只增不减、判据不放宽：UT-S13-66、ST-S13-18。
- 场景：S13 权威测试 ID 语法放宽后的 defined 集合与覆盖度口径；功能规格：§2.51.7；架构：§四十一.6.1。

## S13 verify 判定层收敛测试

> 覆盖 Gate 判据收敛为三项、ID 覆盖检查强度不变、报告与 envelope 去字段。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S13-67 | 设计时清单与 AC 追溯不再影响 Gate | 同一账本下参数化三例：① 覆盖度校验清单存在未勾选项；② AC 追溯存在无链接用例的条目；③ 两者皆有 | 求 verify 的 Gate 结论 | 三例的 Gate 结论与「清单全勾且 AC 全链」的对照组**逐字段相同**；失败原因码集合中不出现 `checklist_incomplete` / `ac_trace_incomplete` |
| UT-S13-68 | ID 覆盖检查强度逐字不变 | 规格声明 10 个 ID、结果账本只含其中 3 个（且均 pass） | 求 verify 结论 | 判 FAIL；**逐个点名**其余 7 个未覆盖 ID；点名文本与收敛前逐字相同 |

### 场景测试

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S13-19 | 真实 CLI 下报告与 envelope 去字段 | 真实 CLI；一个测试全绿且 ID 全覆盖的项目 | ① 跑 `verify`；② 跑 `verify --format json`；③ 读 `acceptance-report.md` | ① Gate PASS；② envelope 的 `data` 不含 `checklist` 与 `ac_trace`，但含 `summary` / `gate` / 未覆盖清单；③ 报告不含 Layer1 / Layer3 段，覆盖度与通过率段照常 |

### 追溯与覆盖

- AC-VERIFY-LAYER-01 判据收敛：UT-S13-67。
- AC-VERIFY-LAYER-02 覆盖检查强度不变：UT-S13-68。
- AC-VERIFY-LAYER-03 去字段：ST-S13-19。
- 功能规格：§2.75。

## S13 人工用例判据声明位与一致性判据输入测试

> 覆盖 manual 判据只认首格、判定单一事实源、一致性判据只消费精确计数、既有判定强度零放宽。
> 夹具用一次性隔离项目构造测试规格与结果账本，**不依赖本仓自身的规格内容**（否则夹具会随本仓规格漂移）。
> 测试实现必须写入 OpenLogos reporter。S13 既有最大 ID 为 UT-S13-68 / ST-S13-19，本组从
> **UT-S13-69 / ST-S13-20** 连续编号。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S13-69 | 首格干净、描述列含裸标记字面量 → 正常计入 | 隔离项目内规格含一行：首格为纯自动化 ID，描述列出现裸 manual 标记字面量；该 ID 的 `pass` 结果已入账 | 求 verify 的统计摘要 | 该 ID 计入 `defined` 与 `executed_count`；`passed + failed + skipped == executed_count`；不产出任何计数矛盾诊断。以整行匹配的旧判据喂同一夹具**必红**（`executed_count` 少 1） |
| UT-S13-70 | 真人工用例判定逐字不变 | 两臂：首格分别带 manual 标记与 manual/平台 标记（本行刻意不写裸标记字面量——判据只看首格，表格行内出现字面量会被整行匹配的旧口径误判，这正是本提案要修的形态） | 逐臂求 `defined` / `executed` / manual 集合 | 两臂均被排除在 `defined` 与 `executed` 之外；排除集合与收敛前**逐字相同** |
| UT-S13-71 | 只收不放：收敛后的人工集合是收敛前的子集 | 同一份规格，分别以收敛前判据与收敛后判据求人工集合 | 求两个集合的差 | 收敛后 ⊆ 收敛前；差集中的每个 ID 都满足「首格无标记」；不存在收敛后新增的人工 ID |
| UT-S13-72 | 判定单一事实源 | 以 spy 包裹 manual 判定函数 | 跑一次完整统计与报告渲染 | `defined` / `executed` / `passed` / `uncovered` 与报告渲染**全部**经该函数求值；不存在第二处自带读法（断言 spy 被调用且无旁路） |
| UT-S13-73 | 一致性判据不得消费舍入值 | `defined = 6427`、`covered = 6426`（真实覆盖率 99.984%，舍入为 100） | 求 `buildVerifyCountMismatches` | **不**产出 `coverage_full_with_uncovered`；`uncovered_count == 1` 并逐个点名。以消费 `coverage_pct` 的旧判据喂同一输入**必红** |
| UT-S13-74 | 展示精度与判定解耦 | 同一账本，`coverage_pct` / `pass_rate_pct` 分别按 0 / 2 / 4 位小数格式化 | 逐档求判定结论 | 三档的 `mismatches` 集合与 Gate 结论**逐字段相同**——展示精度不得影响任何判定 |
| UT-S13-75 | 真实矛盾仍被判出（强度不放宽） | 三臂：① 结果含未定义 ID；② 结果含人工 ID；③ `passed + failed + skipped != executed` 的真实不等 | 逐臂求结论 | 三臂分别判 `unknown_test_result_id` / `manual_test_result_id` / `passed_failed_skipped_ne_executed`；收敛不得吞掉任何一条 |

### 场景测试

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S13-20 | 真实 CLI 端到端复现下游阻塞形态 | 真实 CLI；一次性隔离项目复刻下游现场：规格含「描述列写了裸 manual 标记」的元用例、结果账本零 fail、覆盖差 1 条 | ① 跑 `verify`；② 跑 `verify --format json`；③ 读 `acceptance-report.md` | ① Gate 按真实通过率判定，不再出现 `coverage_full_with_uncovered` / `passed_failed_skipped_ne_executed`；② envelope 的 `summary` 内 `passed + failed + skipped == executed_count`，且 `executed_count` 与报告 `Executed cases` 一致；③ 报告与控制台的 `Executed` 取值相同（此前分别为 6427 与 6426） |
| ST-S13-21 | 矛盾诊断可自证来源 | 人为构造一处真实计数矛盾 | 跑 `verify` 读诊断 | 诊断点名两个相互矛盾的计数器**取值与来源**，而非只给 `result ledger is inconsistent`；据该诊断可直接定位到哪一侧算错 |

### 追溯与覆盖

- AC-VERIFY-MANUAL-01 描述列字面量不影响计入：UT-S13-69、ST-S13-20。
- AC-VERIFY-MANUAL-02 真人工判定逐字不变：UT-S13-70、UT-S13-71。
- AC-VERIFY-MANUAL-03 判定单一事实源：UT-S13-72。
- AC-VERIFY-COUNT-01 舍入不得触发覆盖矛盾：UT-S13-73。
- AC-VERIFY-COUNT-02 判定输入为精确计数：UT-S13-74。
- AC-VERIFY-COUNT-03 真实矛盾仍被判出：UT-S13-75。
- 诊断可自证：ST-S13-21。
- 场景：S13 >「人工用例判据的声明位与一致性判据的输入」（EX-7.6～EX-7.9）。

## S13 沙箱默认根三入口与清理跨平台测试

> 覆盖架构文档「五十二、Windows 平台兼容约束」52.3（递归删除使用 Node 内置重试）与 52.6（沙箱默认根三入口）；场景 S13「运行测试验收并生成报告」的沙箱执行。缺陷：`/private/tmp` 同时存在于 `verify-config.ts` 常量（经 `backfillSandboxDefaults` 补入配置）、`init.ts` 持久化处与 `sandbox.ts` 读取 fallback，且读取时优先使用配置值，在非 darwin 平台不是有效临时目录；`sandbox.ts` 收尾 `rmSync` 无重试且未捕获异常。测试实现必须写入 OpenLogos reporter，测试名包含对应 ID，`scenario_id="S13"`。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S13-76 | 真实 init 生成的配置不含绝对 `sandbox_root` | 一次性隔离目录 | 真实 `openlogos init`，读取生成的 `logos/logos.config.json` 中 verify / smoke 配置 | 不含 `sandbox_root` 键；`sandbox_mode` 与 `sandbox_deny_workspace_write` 照常存在且为既有默认值 |
| UT-S13-77 | 读取入口按平台解析默认根 | 配置无 `sandbox_root` | 以 `platform='darwin'`、`'linux'`、`'win32'` 注入分别调用 `normalizeSandboxConfig` | darwin 为 `/private/tmp`；linux 与 win32 为 `os.tmpdir()` 的返回值 |
| UT-S13-78 | 历史默认值与显式配置区分 | ① `sandbox_root: "/private/tmp"`（历史生成值）；② `sandbox_root: "/data/sbx"`（用户显式值） | 在 `linux` / `win32` 与 `darwin` 下分别读取；并对 ① 的旧配置执行一次真实 `openlogos sync` 后再读取 | ① 在非 darwin 解析为 `os.tmpdir()`、在 darwin 为 `/private/tmp`；② 在所有平台原样为 `/data/sbx`；sync 不向配置补入 `sandbox_root`，也不改写用户已有的 `sandbox_root` 值 |
| UT-S13-79 | 递归清理传入内置重试参数 | 记录 `rmSync` 调用参数 | 执行一次 `sandbox_mode=auto` 的沙箱运行 | 所有 `recursive: true` 的 `rmSync` 调用均带 `maxRetries > 0` 与 `retryDelay`；不存在自建的删除重试循环（静态扫描 `cli/src` 中递归删除调用点经同一薄封装） |
| UT-S13-80 | 收尾清理失败降级告警、不覆盖测试结果 | 用户测试命令成功；收尾 `rmSync` 注入持续 `EBUSY` | 执行沙箱运行 | 返回的命令结果仍为 `pass`、exit_code 0；沙箱诊断含清理失败告警（点名沙箱目录）；函数不抛异常 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-22 | Windows 真实 verify 沙箱运行 | S13 沙箱执行主路径 | **Windows CI job**（windows-latest，真实 NTFS）；一次性隔离项目：配置为 `sandbox_mode=auto`，其中一份含历史 `sandbox_root: "/private/tmp"`、一份无该键；测试命令为 `node -e "process.exit(0)"` 并写 OpenLogos reporter 结果 | ① 对两份配置各执行真实 `openlogos verify` 的沙箱运行；② 检查沙箱目录位置与清理结果 | ① 两者均未在 `<盘>:\private\tmp` 下创建目录，沙箱位于 `os.tmpdir()` 下；测试结果被正常采集；② 运行结束后沙箱目录已清理，或清理失败时仅有告警而验收结论不变 |

### 追溯与覆盖

- 默认根三入口（52.6）：UT-S13-76（init 生成）、UT-S13-78（sync 补默认值与历史值）、UT-S13-77（读取）、ST-S13-22。
- 递归删除内置重试与清理降级（52.3、52.6）：UT-S13-79、UT-S13-80。
- ST-S13-22 属 Windows 回归集，必须在 CI `windows-latest` 阻断 job 中运行；夹具在一次性隔离项目内构造，运行前后本仓项目根字节快照相等。

## S13 预跑命令失败纳入门禁与输出尾部测试

> 覆盖功能规格 §2.7「预跑命令失败进入门禁」「预跑命令输出尾部」、§2.75.1 四项判据与 `gate.reason` 优先级；场景 S13 步骤 9 与 EX-9.1～EX-9.6；根规范 `spec/cli-json-output.md` §4.4 `pre_run_failed`、§4.5 `stdout_tail` / `stderr_tail`；来源变更 verify-smoke-guard-fixes-0-15-20（决策 C01、C02）。
>
> **夹具口径**：一律在 `mktemp -d` 下构造一次性项目（`logos/logos.config.json` + `logos/resources/test/` 中声明若干 UT 用例），不依赖本仓结果账本。「回滚型运行器」指一个真实可执行脚本：先写入一份**完整且全部 pass** 的旧账本备份，运行时向结果路径写入半份结果后以非零码退出，退出前把结果文件回滚为备份（复刻 RunLogos `scripts/run-vitest.js` 的失败处理）。CLI 用例以真实 `openlogos verify` 子进程执行，`--format json` 时解析 stdout envelope。测试实现必须写入 OpenLogos reporter，测试名包含对应 ID，`scenario_id="S13"`。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S13-81 | 单阶段预跑失败且账本被回滚为旧的完整结果 | `verify.pre_run_command` 为回滚型运行器；规格用例全部在旧账本中且旧账本存在一处计数不自洽 | `openlogos verify --format json` | `gate.result=="FAIL"`、`gate.reason=="pre_run_failed"`；`pre_run.commands[0].status=="fail"` 且 `exit_code` 为运行器退出码；`consistency` 诊断照常输出。**修改前实现报 `result_ledger_inconsistent`，本用例必红** |
| UT-S13-82 | 预跑失败但账本完整且全部通过 | 回滚型运行器的旧账本完整、自洽、全部 pass，覆盖全部规格用例 | 同上 | `gate.result=="FAIL"`、`gate.reason=="pre_run_failed"`；不写 `VERIFY_PASS`。**修改前实现直接 PASS，本用例必红** |
| UT-S13-83 | 预跑失败时失败用例优先于 pre_run_failed | 两臂：① 运行器写入含 1 条 `status:"fail"` 的完整自洽账本后以非零码退出；② 同 ① 但账本另含 1 条未定义 ID（账本不自洽） | 每臂 `openlogos verify --format json` | 两臂均 `gate.reason=="failed_cases"`，`failed_cases` 列出该用例，`pre_run.commands[0].status=="fail"`；臂 ② 的 `consistency` 照常输出不自洽诊断 |
| UT-S13-84 | 两阶段任一段失败即 FAIL | 两臂：① `regression_command` 非零退出、`incremental_command` 成功；② 反之；两阶段结果路径各自独立且合并后账本完整全部 pass | 每臂 `openlogos verify --format json` | 两臂均 `gate.result=="FAIL"`、`gate.reason=="pre_run_failed"`；失败段 `status=="fail"`、成功段 `status=="pass"`；合并后的 `result_path` 照常生成 |
| UT-S13-85 | 预跑成功或未配置时判定与输出逐字不变 | 四臂（预跑命令均以 0 退出）：账本全部 pass；含失败用例；存在未覆盖；**含失败用例且账本不自洽（含未定义 ID）**。另以「未配置任何预跑命令」的旧项目重复第四臂 | 新旧实现对同一夹具各执行 `openlogos verify --format json`，剔除 `timestamp`、`duration_ms` 与新增的 `stdout_tail` / `stderr_tail` 后比对 | 各臂 `gate` 与其余字段逐字一致（PASS / `failed_cases` / `incomplete_coverage` / `result_ledger_inconsistent`）；第四臂及其无预跑版本的 `gate.reason` 均为 `result_ledger_inconsistent`，**全局采用新优先级的实现在第四臂上取 `failed_cases`，本用例必红** |
| UT-S13-86 | 输出尾部有界且去除 ANSI | 预跑命令输出 300 行（每行含 ANSI 颜色序列与中文字符），stderr 另输出 20 行 | `openlogos verify --format json` | `stdout_tail` 为末尾不超过 80 行且 UTF-8 字节数不超过 8192，截断落在完整字符边界，不含任何 `\x1b[` 序列；`stderr_tail` 为 20 行原文去 ANSI；文本模式执行同一夹具时输出实时打到终端，JSON 之外不出现这两个字段 |
| UT-S13-87 | 大输出不中断子进程、退出码如实 | 预跑命令向 stdout 写出 50 MiB 后在最后一行写入标记文件，再以退出码 3 结束 | `openlogos verify --format json` | 标记文件存在（子进程完整运行至结束）；`pre_run.commands[0].exit_code==3`；`stdout_tail` 末行为最后输出行；沙箱 `auto` 与 `off` 两种模式同一口径 |
| UT-S13-88 | 验收报告不落命令输出 | UT-S13-81 夹具，运行器在 stdout / stderr 输出包含唯一哨兵字符串的若干行 | `openlogos verify --format json` 后读取 `acceptance-report.md` | 报告含失败阶段 `pre_run` 与退出码，不含哨兵字符串与任何 `stdout_tail` / `stderr_tail` 内容；JSON 的 `stdout_tail` 含哨兵 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-23 | 回滚型运行器的事故复刻端到端 | S13 Step 1～9、EX-9.1、EX-9.5 | 一次性项目：`pre_run_command` 为回滚型运行器，旧账本完整全部 pass；沙箱 `auto` | ① `openlogos verify --format json`；② 读取 `acceptance-report.md`；③ 把运行器改为正常运行（退出码 0、写入新的完整全 pass 账本）后再次 `openlogos verify --format json` | ① `gate.reason=="pre_run_failed"`，`pre_run.commands[0]` 带非空 `stderr_tail`，可从中读到运行器的失败输出；② 报告只记阶段与退出码，不含输出内容；③ `gate.result=="PASS"`，`gate.reason==null`。**修改前 ① 为 `result_ledger_inconsistent` 或 PASS，本用例必红** |
| ST-S13-24 | 两阶段与诊断不被隐藏 | S13 Step 3a～9、EX-9.2、EX-9.3 | 两阶段配置，`incremental_command` 非零退出且其结果含 1 条未覆盖规格用例；`regression_command` 成功 | ① `openlogos verify --format json`；② 把增量结果补齐为含 1 条 fail 后重跑 | ① `gate.reason=="pre_run_failed"`，`uncovered_cases` 照常列出该用例，`pre_run.commands` 两条状态分别为 `pass` / `fail`；② `gate.reason=="failed_cases"` |

### 追溯与覆盖

- 预跑失败进入门禁（§2.75.1、EX-9.1）：UT-S13-81、UT-S13-82、ST-S13-23（修改前实现必红）。
- 原因优先级与诊断不隐藏（EX-9.2）：UT-S13-83、ST-S13-24。
- 新优先级只在预跑失败时生效（EX-9.6）：UT-S13-85 第四臂及其无预跑版本、UT-S13-83 臂 ②。
- 两阶段任一段失败（EX-9.3）：UT-S13-84、ST-S13-24。
- 预跑成功或未配置零回归：UT-S13-85。
- 输出尾部有界、去 ANSI、不中断子进程（EX-9.4）：UT-S13-86、UT-S13-87。
- 报告不落输出（EX-9.5）：UT-S13-88、ST-S13-23。

### 自动化与证据要求

- 回滚型运行器以真实脚本实现并由真实 `openlogos verify` 子进程调用，不以桩替代命令执行器；断言基于 `--format json` 的结构化字段，不解析人类可读文案。
- 测试结果写入 `logos/resources/verify/test-results.jsonl`（OpenLogos reporter），测试名包含用例 ID。

## S13 沙箱复用与增量同步测试

> 覆盖功能规格 §2.91「verify / smoke 沙箱复用与增量同步」；场景 S13「S13 沙箱复用与增量同步时序」Step R1～R13 与 EX-3.5～EX-3.12；根规范 `spec/cli-json-output.md`「verify / smoke `sandbox.reuse` 沙箱复用字段」、`spec/test-results.md`「沙箱复用配置」；来源变更 verify-sandbox-reuse-0-16-1（决策 C01～C05）。
>
> **夹具口径**：一律在 `mktemp -d` 下构造一次性项目（`logos/logos.config.json` + `logos/resources/test/` 声明若干 UT 用例）与一次性 `sandbox_root`，不使用本仓配置的沙箱根，不依赖本仓结果账本。CLI 用例以真实 `openlogos verify` 子进程执行，`--format json` 时解析 stdout envelope；执行器级用例直接调用 `runSandboxedCommand`。**racy 窗口**：同步中刚复制的副本在下一次同步时处于 racy 窗口（ctime 距上次清单写入不足 2 秒）而必然进入内容比较，凡断言「未变文件不比较内容」的用例须先做一次预热运行，并让相邻两次运行间隔超过 2 秒。锁交错用例经执行器暴露的测试钩子（如 `beforeLockLink`）在 `link()` 前设置屏障，不以修改锁文件字节代替真实竞争。测试实现必须写入 OpenLogos reporter，测试名包含对应 ID，`scenario_id="S13"`。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S13-89 | 持久目录身份与 created / reused | 一次性项目，`sandbox_mode=auto`，未配置 `sandbox_reuse`；预跑命令写入全部 pass 结果 | 连续两次 `openlogos verify --format json` | `reuse.dir` 两次相同，且等于 `<sandbox_root>/openlogos-cli-sandbox-reuse-<项目根 realpath 的 SHA-256 前 16 位>`；`reuse.state` 依次为 `created` / `reused`，`reuse.generation` 两次相同，`sandbox.root` 为该世代目录；运行后世代目录仍在；`lock/` 下 `gen-000000000001`、`gen-000000000001.released`、`gen-000000000002`、`gen-000000000002.released` 均存在。**修改前实现无 `reuse` 且每次 `sandbox.root` 不同，本用例必红** |
| UT-S13-90 | 增量同步只动变化项、mtime 保真（执行器级计数） | **执行器级**：直接调用 `runSandboxedCommand`，`allowedWritePaths` 为空，命令为只读命令（如 `true`），不创建或改写任何文件，参与同步的文件集合固定为 `src/` 下 10 个文件；完成一次预热运行并等待超过 2 秒，再运行一次并等待超过 2 秒 | 改写 1 个已有文件（内容与长度均变）、新增 1 个文件、删除 1 个文件，再运行 | `reuse.copied==2`、`reuse.removed==1`、`reuse.content_compared==1`（仅被改写的文件）；未改动文件在沙箱中的 inode 与 mtime 均与前一次运行后相同；新复制文件在沙箱中的 mtime（毫秒）与 mode 与工作区一致。真实 CLI 路径下的结果文件清空与回收由 UT-S13-94 以逐路径文件事实验证，本用例不对 CLI 总计数做精确断言 |
| UT-S13-91 | 镜像还原上轮的沙箱改动（含元数据整定） | 同上（执行器级夹具，可写命令）；首轮命令在 `workspace/` 中新建 `src/leak.txt`、改写 `src/a.ts`（长度变化）、`chmod +x src/b.sh`（字节不变）、`touch -t` 把 `src/c.txt` 的 mtime 改为一年前（字节不变）、把目录 `src/dir` 替换为指向 `../src` 的 symlink；工作区另有相对 symlink `link -> src/a.ts`；记录 `src/b.sh`、`src/c.txt` 副本的 inode | 第二轮命令打印 `src/` 清单、`src/a.ts` 内容、`src/b.sh` 的 mode、`src/c.txt` 的 mtime、`src/b.sh` 与 `src/c.txt` 的 inode 与 `src/dir` 的类型 | 第二轮输出全部等于工作区状态：`src/leak.txt` 不存在，`src/a.ts` 为工作区内容，`src/b.sh` mode 与工作区一致，`src/c.txt` mtime（毫秒）与工作区一致，`src/dir` 为目录；`src/b.sh`、`src/c.txt` 的 inode 与首轮记录相同（原位整定、未重写字节），二者不计入 `reuse.copied`；第三轮（无改动）二者仍可能因 racy 判定进入内容判定——第二轮整定把副本 ctime 更新到第二轮运行时刻，距第二轮清单写入时刻不足 2 秒——此轮只断言字节未重写、inode 不变、mode / mtime 与工作区一致且二者不计入 `reuse.copied`；第三轮须在第二轮清单写入时刻 2 秒之后开始，第四轮（无改动）时第三轮清单写入时刻已晚于二者 ctime 超过 2 秒，断言二者不再计入 `reuse.content_compared`；`link` 的目标字面量仍为 `src/a.ts`（未被改写为绝对路径）；工作区字节全程不变。**「内容相同只刷新清单」的实现 `src/b.sh` 仍为可执行、`src/c.txt` 仍为一年前，本用例必红** |
| UT-S13-92 | 等长改写且 mtime 被保留（EX-3.5） | 同上；源文件 `src/flag.js` 内容为 `exports.flag = 0;` 并已完成预热与一次间隔超过 2 秒的运行；预跑命令打印 `src/flag.js` 内容 | 臂 ①：工作区把该文件等长改为 `exports.flag = 1;` 后以 `utimes` 恢复原 mtime、mode 不变，运行；臂 ②：本轮预跑命令先在 `workspace/` 中把副本等长改为 `exports.flag = 9;` 并恢复其 mtime，下一轮再运行 | 臂 ① 本轮输出为 `exports.flag = 1;`；臂 ② 下一轮输出为工作区内容；两臂该文件均计入 `reuse.content_compared` 与 `reuse.copied`。**仅凭大小 + mtime 判定的实现两臂均输出旧内容，本用例必红** |
| UT-S13-93 | 缓存路径留存与非法项 | `sandbox_cache_paths` 为 `["build-cache", "/abs", "../out", "", ".", "logos/resources/verify", "logos/resources/verify/test-results.jsonl"]`；工作区 `build-cache/` 下有 `ws-only.o`；首轮预跑命令写 `build-cache/x.o` | 连续两次 `openlogos verify --format json`，第二轮预跑命令列出 `build-cache/` | 第二轮列出 `x.o`、不含 `ws-only.o`；`sandbox.diagnostics` 逐项点名 6 个非法项及原因（绝对路径 / 含 `..` / 空 / 项目根 / 白名单祖先 / 白名单本身），`sandbox.status` 至少为 `warn`；`logos/resources/verify` 按普通镜像路径同步；对 `build-cache/x.o` 的写入在非白名单写入诊断中出现（审计不豁免）；`sandbox_mode=always` 臂对同一写入判命令失败 |
| UT-S13-94 | 上轮结果文件不跨运行回收（EX-3.8） | 首轮预跑命令写入完整全 pass 账本；第二轮预跑命令不写结果并以 0 退出 | 第二次 `openlogos verify --format json` | 回收后工作区 `result_path` 为空，`gate.result=="FAIL"`（`incomplete_coverage`），不出现 PASS；`reuse.state=="reused"` |
| UT-S13-95 | 隔离不变量在复用下同口径 | 一次性项目；三臂：① 预跑命令写非白名单路径 `src/out.txt`；② 首轮预跑命令在缓存路径 `build-cache/` 中新建指向项目根之外的 symlink；③ 预跑命令写结果文件 | 臂 ①、② 各在 `auto` 与 `always` 下运行两轮，臂 ③ 在 `auto` 下运行 | ① `auto` 告警、`always` 判命令失败，工作区不出现 `src/out.txt`；② 第二轮按「无法隔离」处理：`auto` 降级为非隔离执行并 `status=warn`、`always` 失败，诊断点名该链接；该世代目录仍存在且 `gen-<本号>.released` 已写；③ 结果文件被定点回收且内容为本轮写入；三臂的 `sandbox.status`、诊断文本与一次性沙箱（`sandbox_reuse:false`）同一夹具一致 |
| UT-S13-96 | 世代锁竞争与延迟申请者（EX-3.6） | 执行器级；`lock/` 下预置：臂 ① 未释放的 `gen-N`，记录 pid 为已退出进程；臂 ② 已释放的 `gen-N` | 臂 ①：两个子进程经测试钩子在 `link()` 前汇合后同时放行；臂 ②：A 读到 `gen-N` 后在钩子处暂停，B 完整运行并释放 `gen-<N+1>`，C 取得 `gen-<N+2>` 并在命令中阻塞，然后放行 A | 臂 ① 恰一方 `state=="recovered"`，另一方 `busy-fallback` 且其一次性临时目录已清理；臂 ② A 的 `link(gen-<N+1>)` 失败，A 为 `busy-fallback`，A 的命令在一次性临时目录中执行，C 的世代 `workspace/` 中无 A 的写入；两臂运行过程中以文件探针记录持有者，任意时刻同一世代至多一个持有者；结束后 `lock/` 下所有已用编号记录仍在；C 释放后其 `gen-<N+2>.released` 存在，A 的任何操作未删除或改写 `gen-<N+2>` |
| UT-S13-97 | 旧写入者跨轮残留（EX-3.7） | 一次性项目；三臂：① 预跑命令启动一个与 CLI 脱离 stdio 的子进程，每 50 ms 向 `workspace/` 内 `orphan.log` 追加一行，然后阻塞；② 首轮预跑命令写入完整全 pass 账本后启动后台写入者并以 0 退出，后台写入者在测试屏障文件出现后才把首轮全 pass 账本写回结果路径（按绝对路径，cwd 留在旧 workspace）；第二轮预跑命令不写结果，先创建屏障文件、等待后台写入者写完的回执文件后以 0 退出。臂 ② 分两支：②a 后台写入者关闭继承 stdio、仍在命令进程组内；②b 后台写入者以 Node `spawn(..., {detached:true, stdio:"ignore"})` 启动并 `unref`，脱离命令进程组（用例先断言首轮结束时 `kill(-pgid, 0)` 报 ESRCH，确认组已空）；②b 另跑一支 fresh 变体：第二轮改为 `openlogos verify --fresh-sandbox --format json`；③ 经测试钩子在锁记录发布之后、目标世代同步完成之前令 CLI 进程退出 | 臂 ①：真实 `openlogos verify` 启动后以 SIGKILL 只杀 CLI 进程，子进程仍在写时立即执行普通 `openlogos verify --format json` 与 `openlogos verify --fresh-sandbox --format json`；臂 ②：两轮真实 `openlogos verify --format json`；臂 ③：钩子退出后执行一次普通 `openlogos verify --format json` | 臂 ①：普通运行 `reuse.state=="recovered"`、`generation` 为新世代、`abandoned` 含旧世代；fresh 运行 `state=="fresh"` 且 `abandoned` 仍含旧世代；两次运行前后旧世代目录均存在、`orphan.log` 持续增长（未被同步、改写或删除）。臂 ②（②a、②b 同一断言）：首轮释放标记为 `gen-<首轮号>.tainted`（无 `.released`），②b 的 `tainted.reason` 指明运行标记扫描命中；第二轮 `state=="recovered"`、`generation` 不等于首轮世代，`gate.result=="FAIL"`（结果为空），后台写入者写回的旧账本只出现在首轮世代内、不出现在工作区结果路径；②b fresh 变体 `state=="fresh"`，首轮世代目录仍存在并列入 `abandoned`，未被删除。臂 ③：下一轮 `state=="recovered"`，最新锁记录 `ws` 等于 `reuse.generation`，半成品世代（若存在）列入 `abandoned`。三臂回收的结果均来自本轮命令；执行器未终止任何残留进程（测试结束时由用例自行终止并清理）。**修改前「正常释放即复用」的实现臂 ②a、②b 第二轮 PASS，仅以进程组判定的实现臂 ②b 第二轮 PASS 且 fresh 变体删除了仍被使用的首轮世代，本用例必红** |
| UT-S13-98 | 锁被占用、无法确认与无法复用时退回 | 执行器级；四臂：① 最大世代未释放、记录 pid 为当前测试进程；② 最大世代记录不可解析；③ 经测试钩子令 `link()` 抛出 `EPERM`（模拟不支持硬链接的文件系统）；④ 经测试钩子令平台进程组探测与运行标记扫描能力报告不可用（模拟 Windows） | 各运行一次带结果写入的命令 | 臂 ①② `reuse.state=="busy-fallback"`，臂 ③④ `reuse.state=="unsupported"`；四臂命令均在一次性临时目录中执行并回收结果，临时目录运行后被删除；持久世代与 `lock/` 记录字节不变；臂 ③④ `sandbox.infos` 含无法复用的信息级说明，四臂 `sandbox.status` 均不因此改变 |
| UT-S13-99 | `--fresh-sandbox` 重建与锁记录绑定（EX-3.9 锁已释放分支） | 一次性项目，`sandbox_cache_paths=["build-cache"]`；已运行两轮（缓存中有产物，最新释放为 `released`） | ① `openlogos verify --fresh-sandbox --format json`；② 再次普通运行；③ `sandbox_reuse:false` 下带 `--fresh-sandbox` 运行 | ① `state=="fresh"`，`generation` 为新世代，最新锁记录（最大世代号）的 `ws` 等于该 `generation`，其 `.released` 的 `ws` 亦相同；`build-cache/` 为空；被替换的旧世代目录已删除，`abandoned` 为空；② `state=="reused"`，`generation` 等于 ① 的世代，被删除的旧世代目录未被重新创建；③ 退出码与无参数时相同，`state=="disabled"`，不报错 |
| UT-S13-100 | 关闭复用、关闭沙箱与无法复用环境的零回归（EX-3.10、EX-3.12） | 一次性项目；四臂：① `sandbox_reuse:false`；② `sandbox_mode:off`；③ `sandbox_root` 指向项目根内子目录；④ 工作区含一个 FIFO | 修改前、后实现各对同一夹具执行 `openlogos verify --format json`，剔除 `timestamp`、`duration_ms`、`sandbox.root` 中的随机目录名与新增的 `sandbox.reuse` 后比对 | ① 新实现 `reuse=={enabled:false,state:"disabled",dir:null,generation:null,copied:0,removed:0,content_compared:0,sync_ms:0,abandoned:[]}`，其余字段与修改前逐字一致，一次性临时目录运行后已删除；② 不出现 `sandbox.reuse`，其余逐字一致；③、④ `auto` 下按「无法创建沙箱」降级为非隔离执行并告警、`always` 下失败，`gate` 与诊断类别与修改前一致 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-25 | 模拟增量编译器端到端 | S13 Step 1～9、R1～R13 | 一次性项目：`src/` 下 N=20 个源文件；`sandbox_cache_paths=["build-cache"]`；`pre_run_command` 为真实「增量编译器」脚本：对每个源文件，若 `build-cache/<名>.o` 存在且记录的源内容哈希与当前一致则跳过，否则「编译」（写 `.o` 并更新哈希）并计数，最后在 stdout 输出 `compiled=<数量>` 并写入全部 pass 的结果 | ① `openlogos verify --format json`；② 改 1 个源文件后再执行；③ 不改动再执行；④ `openlogos verify --fresh-sandbox --format json` | 四次 `gate.result=="PASS"`；`pre_run.commands[0].stdout_tail` 依次含 `compiled=20`、`compiled=1`、`compiled=0`、`compiled=20`；`reuse.state` 依次为 `created`、`reused`、`reused`、`fresh`。**修改前实现每次都输出 `compiled=20`，本用例必红** |

### 追溯与覆盖

- 持久目录身份与世代（§2.91.3、Step R2）：UT-S13-89。
- 镜像同步、mtime 保真与元数据整定（§2.91.4、Step R6～R7）：UT-S13-90（执行器级精确计数）、UT-S13-91（chmod / touch 臂原位还原）。
- 等长改写不漏同步（EX-3.5）：UT-S13-92（仅凭大小 + mtime 必红）。
- 缓存路径与非法项（§2.91.5、EX-3.11）：UT-S13-93。
- 旧结果不回收（EX-3.8）：UT-S13-94。
- 隔离不变量同口径（§2.9、EX-3.4、Step R8～R11）：UT-S13-95。
- 世代锁互斥与已用编号永久占位（§2.91.6、EX-3.6）：UT-S13-96。
- 旧写入者跨轮残留（§2.91.6「旧写入者存活检查」、EX-3.7：强杀、正常退出后组内 / 脱组后台写入、发布后中断）：UT-S13-97（臂 ②a、②b 修改前实现必红，②b 仅进程组判定的实现必红）。
- 退回一次性沙箱（Step R4c / R4d、EX-3.10 ②）：UT-S13-98。
- `--fresh-sandbox` 与锁记录目标世代绑定（§2.91.6「先定目标、再发布」、§2.91.7、EX-3.9）：UT-S13-97 臂 ①、UT-S13-99。
- 零回归（§2.91.9、EX-3.10 ①③、EX-3.12）：UT-S13-100。
- 端到端增量收益：ST-S13-25（修改前实现必红）。

### 自动化与证据要求

- 断言基于 `--format json` 的结构化字段、命令实际输出与文件系统事实（inode、mtime、目录存在性、锁记录），不解析 `sandbox.infos` 的人类可读文案。
- 涉及子进程与孤儿进程的用例必须在 `finally` 中终止其启动的全部进程并删除一次性目录；不得在本仓 `sandbox_root`（`/Volumes/BuildWork/openlogos-sandbox`）下创建项目目录。
- 测试结果写入 `logos/resources/verify/test-results.jsonl`（OpenLogos reporter），测试名包含用例 ID。

## S13 Linux 运行标记扫描中环境不可读进程的判定测试

> 覆盖功能规格 §2.92「Linux 运行标记扫描中环境不可读进程的判定」；场景 S13「S13 Linux 运行标记扫描与环境不可读进程」EX-3.13；来源变更 fix-sandbox-reuse-linux-liveness（决策 C01、C02）。
>
> **夹具口径**：UT 以注入的 `/proc` 访问依赖（进程清单、environ、属主、stat 启动时刻、当前用户）驱动 `scanProcEnvironment` / 存活检查，任何平台均可运行；ST 仅在 Linux 运行（其他平台显式 skip），以「exec 一份去掉读权限、仅保留执行权限的 `sleep` 副本」构造真实的不可转储同用户进程（同用户读取其 environ 得 EACCES），一次性项目与一次性 `sandbox_root` 在 `mktemp -d` 下构造，构造的进程在 finally 中终止。测试实现必须写入 OpenLogos reporter，测试名包含对应 ID，`scenario_id="S13"`。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S13-101 | 环境不可读的同用户进程按启动时刻判定 | 注入 `/proc`：当前用户 501，命令启动时刻 1000.00 秒；进程 a：同用户、environ EACCES、启动 500.00 秒；b：同用户、environ EACCES、启动 1000.50 秒；c：同用户、environ EACCES、启动 999.50 秒（容差内）；d：同用户、environ EACCES、stat 报 ENOENT；e：同用户、environ EACCES、stat 报 EACCES；f：同用户、environ EACCES、stat 第 22 字段无法解析；g：他用户、environ EACCES；h：environ 可读且含 `OPENLOGOS_SANDBOX_RUN=tag` | 以不同组合调用扫描：① 仅 a、d、g；② 加入 b；③ 加入 c；④ 加入 e；⑤ 加入 f；⑥ 仅 a 但不提供命令启动时刻；⑦ 加入 h | ① 返回无命中、不抛出；② ③ ④ ⑤ ⑥ 均判无法完成扫描（抛出且原因点名对应 pid）；⑦ 命中 h。**修改前实现在 ① 上抛出（a 被判无法完成），本用例必红** |
| UT-S13-102 | 命令启动时刻随释放记录传递与旧记录保守口径 | 执行器级，Linux 上运行；其他平台以注入的 `/proc` 依赖与平台判定接缝运行 | ① 运行一次复用命令后读取释放记录；② 在注入的 `/proc` 中放一个启动时刻早于「① 记录值 − 1 秒」（如早 5 秒）、environ 不可读的同用户进程后再运行一次；③ 把释放记录中的 `command_started_uptime` 删除（模拟旧版记录）后再运行一次；④ 再运行一次 | ① `released` 记录含数字型 `command_started_uptime`；② `reuse.state=="reused"`；③ `reuse.state=="recovered"`，新释放记录重新带 `command_started_uptime`；④ `reuse.state=="reused"` |
| UT-S13-103 | 已被回收的进程（stat `num_threads` 为 0）视为已退出 | 注入 `/proc`：当前用户 501，命令启动时刻 1000.00 秒；进程 r：同用户、environ EACCES、stat 启动 1000.50 秒（晚于命令启动）且 `num_threads` 为 0；s：同用户、environ EACCES、`num_threads` 为 0 但第 22 字段无法解析；t：同用户、environ EACCES、leader 已退出（Z + PF_EXITING）且 `num_threads` 为 2，线程清单中 leader 为 Z、工作线程的 stat `num_threads` 为 0；h：environ 可读且含 `OPENLOGOS_SANDBOX_RUN=tag` | ① 仅 r 调用扫描；② r 与 h；③ 仅 s；④ 仅 t；⑤ 以 `parseProcStat` 直接解析 `num_threads` 为 0 的原始 stat | ① 返回无命中、不抛出；② 命中 h（r 不中断扫描）；③ 判无法完成扫描（抛出且原因点名 s 的 pid——启动时刻字段仍须可解析）；④ 返回无命中、不抛出（线程组按已退出认定）；⑤ 不抛出，结果标识为已回收。**修改前实现在 ① ② ④ ⑤ 上抛出「stat 启动时刻字段无法解析」，本用例必红** |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-26 | Linux 真实不可转储进程下的复用 | S13 R9～R12、EX-3.13 ①② | 仅 Linux；一次性项目（verify 预跑写全部 pass 账本）与一次性 `sandbox_root`；`sleep` 的副本权限为 0111 | ① 先在测试中启动一个不可转储进程（exec 0111 的 `sleep` 副本，长时间运行），确认同用户读取其 environ 得 EACCES、`/proc/<pid>/stat` 可读；随后等待并以实际读数校验「`/proc/uptime` − 该进程 starttime 秒数」大于 2 秒（即首轮命令启动时该进程必然早于「命令启动时刻 − 1 秒」）；② 连续两次 `openlogos verify --format json`；③ 把预跑命令改为在命令内以 `setsid` / Node `spawn(..., {detached:true, stdio:"ignore"})` 启动一个不可转储后台进程（同样 exec 0111 副本，脱离命令进程组并关闭继承 stdio）后退出，执行一次 verify；④ 再执行一次 verify | ② 两次 `gate.result=="PASS"`，`reuse.state` 依次为 `created` / `reused`；③ 先断言该后台进程仍存活、原命令进程组已空（以释放记录中的 `pgid` 做 `kill(-pgid, 0)` 得 ESRCH）、同用户读取其 environ 得 EACCES、stat 可读且启动时刻不早于「命令启动时刻 − 1 秒」；最新释放标记为 `tainted`，原因来自运行标记扫描并点名该后台进程的 pid（而非进程组仍有成员）；④ `reuse.state=="recovered"`，旧世代列入 `abandoned`。**修改前实现 ② 第二次为 `recovered`，本用例必红** |

### 追溯与覆盖

- 启动时刻判据与各异常分支（§2.92.2）：UT-S13-101。
- 已被回收进程（stat `num_threads` 为 0，读取与回收竞态）视为已退出，含线程级 stat（§2.92.2，来源变更 release-0-16-2 决策 C08）：UT-S13-103。
- 命令启动时刻记录、随释放记录传递与旧记录保守口径（§2.92.3、§2.92.4、EX-3.13 ③）：UT-S13-102。
- Linux 真实不可转储进程（EX-3.13 ①③）：ST-S13-26（仅 Linux）；容差内与启动时刻不可读（EX-3.13 ②）：UT-S13-101 的进程 c、e、f。
- 既有 UT-S13-89～UT-S13-100、ST-S13-25、UT-S19-57 作为零回归守护，须在 Linux（非 root、具备 sqlite3）与 macOS 全量回归中保持绿。

## S13 按模块限定 verify 范围测试

> 覆盖功能规格 §2.96「按模块限定 verify 范围」；需求 `core-01-requirements.md`「S13 按模块限定 verify 范围验收补充」；场景 `core-S13-verify-results.md`「S13 按模块限定范围的 verify」；根规范 `spec/logos-project.md` §modules（`paths`）、`spec/logos.config.schema.json`（`verify.modules`）、`spec/test-results.md` §运行约定、`spec/test-slice-manifest.md` §7、`spec/cli-json-output.md` §4 与 `spec/schema/verify.schema.json`（`scope`）、`spec/change-management.md`（guard `baseRef`）；来源变更 module-scoped-verify（决策 C01、C02，review F1、F2）。
>
> **夹具口径**：一律在 `mktemp -d` 下构造一次性 git 项目，不依赖本仓结果账本与本仓配置。缺省多模块夹具：`logos/logos-project.yaml` 登记 `core`（`paths: ["src/**"]`）与 `portal-web`（`paths: ["portal-web/**"]`）；测试规格 `logos/resources/test/core-S01-test-cases.md`（UT-S01-01、UT-S01-02）、`portal-web-S50-test-cases.md`（UT-S50-01、UT-S50-02）与不带已登记模块前缀的全局文件 `shared-S90-test-cases.md`（UT-S90-01）；`logos.config.json` 中 `verify.modules.core.pre_run_command` 与 `verify.modules.portal-web.pre_run_command` 分别为同一个「记录型运行器」带不同参数，项目级 `pre_run_command` 为同一运行器带参数 `project`，`verify.sandbox_mode` 为 `off`（除非用例另行说明）。「记录型运行器」是真实可执行脚本：把自身参数、`OPENLOGOS_VERIFY_MODULES` 与 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 的取值逐行追加到项目外一次性调用日志，并按参数写入对应模块用例的本轮结果行（全部 pass，除非用例另行说明）。运行器支持两个夹具开关（review F5，所有失败与范围外结果都由本轮运行器输出，不依赖执行前残留的账本）：`MSV_EMIT_FOREIGN=1` 时，被调用为 portal-web 的那次额外输出一条 core 用例 UT-S01-01 的 `status:"fail"` 行（范围外结果反例）；`MSV_CORE_FAIL=1` 时，被调用为 core 的那次把 UT-S01-01 写为 `status:"fail"`。需要验证结果新鲜度的用例在 verify 前向结果文件预置一条「上一轮遗留」的 core 失败行，断言它被清空、不被采信。夹具在初始提交后执行真实 `openlogos change <slug>` 创建提案（guard 由此获得 `baseRef`），提案归属按用例设定。CLI 用例以真实 `openlogos verify` 子进程执行，`--format json` 时解析 stdout envelope；纯函数用例直接调用范围计算模块与两套用例提取器。测试实现必须写入 OpenLogos reporter，测试名包含对应 ID，`scenario_id="S13"`。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S13-104 | 启用条件：单模块或无任何 `paths` 时未启用（review F1 负向兼容） | 三臂：① 单模块项目（只登记 `core`，声明 `paths`）；② 多模块项目，两个模块都不写 `paths`；③ 多模块项目，两个模块的 `paths` 均为 `[]`。三臂都配置项目级 `pre_run_command`，并配置 `verify.modules` 两个模块的命令；提案归属 `portal-web`，guard 带合法新 `baseRef`，提案只改 `portal-web-` 前缀的 delta（代码改动集合为空）；记录型运行器为 core 用例写 1 条 `status:"fail"` | 新、旧实现对同一夹具各执行 `openlogos verify --format json`，剔除 `timestamp`、`duration_ms` 后比对；读取 `acceptance-report.md` 与调用日志 | 三臂新实现均不输出 `data.scope`、`pre_run.commands[]` 不含 `modules`；`summary.defined_count` 含全部三个文件的 5 条用例；调用日志只有项目级命令一次且无 `OPENLOGOS_VERIFY_MODULES`；`gate.reason=="failed_cases"` 且 `failed_cases` 含 core 的失败用例；报告 Summary 无「范围 / Scope」行；其余字段与旧实现逐字一致。**以「代码改动归不到模块才回落」实现启用的版本在本夹具上只核对 portal-web，本用例必红** |
| UT-S13-105 | `--all` 优先于一切 | 四臂：单模块项目；无任何 `paths` 的多模块项目；缺省多模块夹具（提案只改 `portal-web/`）；缺省多模块夹具但 guard 无 `baseRef` | 每臂 `openlogos verify --all --format json` | 四臂 `scope.mode=="all"`、`scope.modules` 为全部已登记模块（按 logos-project.yaml 顺序）、`scope.reasons==[]`、`scope.fallback_reason==null`、`scope.out_of_scope_result_count==0`；defined 为全部用例；命令选择同 UT-S13-116（多模块臂两个模块命令各执行一次，单模块与无 `paths` 臂按模块配置取命令） |
| UT-S13-106 | 范围 M 的三类来源与 reasons | 缺省多模块夹具另登记第三个模块 `portal-server`（不声明 `paths`）；提案归属 `portal-server`；提案目录含 `deltas/test/portal-web-S50-test-cases.md`；工作区改动 `src/protocol.ts`（命中 core 的 `paths`） | 范围计算（纯函数）与 `openlogos verify --format json` | `scope.mode=="module"`；`scope.modules==["core","portal-web","portal-server"]`（按 logos-project.yaml 顺序）；`scope.reasons` 含 `{module:"portal-server",source:"proposal",ref:<slug>}`、`{module:"portal-web",source:"delta",ref:"deltas/test/portal-web-S50-test-cases.md"}`、`{module:"core",source:"path",ref:"src/protocol.ts"}`；只给部分模块声明 `paths` 的项目判为已启用；未声明 `paths` 的 `portal-server` 只经提案归属进入范围 |
| UT-S13-107 | 改动文件集合 | 缺省多模块夹具，guard `baseRef` 为初始提交；之后：提交一次修改 `src/a.ts`；未提交修改 `src/b.ts`；新建未跟踪 `portal-web/new.ts`；删除已跟踪 `src/c.ts`；把 `src/d.ts` 重命名为 `portal-web/d.ts`；新建被 `.gitignore` 忽略的 `portal-web/dist/out.js` | 范围计算（纯函数，返回改动文件清单） | 改动文件清单恰为 `src/a.ts`、`src/b.ts`、`portal-web/new.ts`、`src/c.ts`、`src/d.ts`、`portal-web/d.ts`（重命名取旧、新两端，删除取原路径），不含 `portal-web/dist/out.js`；`scope.modules==["core","portal-web"]` |
| UT-S13-108 | 改动文件分类：流程产物豁免、规格按前缀、`logos/` 下非规格按 `paths`（review F2 负向 ②） | 缺省多模块夹具，`core.paths` 改为 `["src/**","logos/tools/**"]`；提案归属 `portal-web`；四臂各自只改一组文件：① `logos/.openlogos-guard`、`logos/changes/<slug>/proposal.md`、`logos/resources/verify/acceptance-report.md`、`logos/.runtime/x.json`；② `logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`；③ `logos/tools/protocol-check.ts`；④ 另登记模块 `portal`（无 `paths`），改 `logos/resources/test/portal-web-S50-test-cases.md` | 每臂范围计算 | ① 四个文件均不参与判定，`scope.modules==["portal-web"]`、`mode=="module"`（未触发回落）；② core 以 `source:"spec"` 进入范围；③ core 以 `source:"path"`、`ref:"logos/tools/protocol-check.ts"` 进入范围；④ 前缀最长匹配归 `portal-web`，`portal` 不进入范围。**整体排除 `logos/` 的实现在臂 ③ 上只得 `["portal-web"]`，本用例必红** |
| UT-S13-109 | 共享验收配置的相关字段被改即回落全量（review F2 负向 ③；verify-scope-fields-and-slice-module 起按字段判断） | 缺省多模块夹具，提案归属 `portal-web`；两臂分别只改 `logos/logos.config.json` 的 `verify`（项目级测试命令的一个参数）、`logos/logos-project.yaml` 的 `modules`（某模块的 `name`，不改 `paths` 本身） | 每臂 `openlogos verify --format json` | 两臂 `scope.mode=="fallback-full"`、`scope.modules` 为全部模块、`scope.reasons==[]`、`scope.fallback_reason.code=="shared_config_changed"`、`detail` 依次为 `logos/logos.config.json（verify）`、`logos/logos-project.yaml（modules）`；defined 为全部用例；两个模块命令都执行。只改无关字段不回落见 UT-S13-275、UT-S13-276 |
| UT-S13-110 | 改动文件归不到模块即回落全量 | 缺省多模块夹具，提案归属 `portal-web`；改 `portal-web/app.ts`、`scripts/build.sh`、`docs/readme.md`、`tools/x.js` | `openlogos verify --format json` | `scope.mode=="fallback-full"`、`fallback_reason.code=="unmapped_file"`、`detail` 含首个归不到模块的文件（按路径字典序为 `docs/readme.md`）与总数 3；两个模块命令都执行 |
| UT-S13-111 | 提案起点不可用即回落全量 | 缺省多模块夹具，提案只改 `portal-web/app.ts`；四臂：① guard 删去 `baseRef`（模拟旧 guard）；② 项目不是 git 仓库（一次性目录不 `git init`，guard 手工写入无 `baseRef`）；③ guard 的 `baseRef` 为不存在的 40 位提交号；④ 经测试接缝令差异计算命令失败 | 每臂 `openlogos verify --format json` | 各臂 `scope.mode=="fallback-full"`，`fallback_reason.code` 依次为 `base_ref_missing`、`not_git_repository`、`base_ref_unreachable`、`diff_failed`，`detail` 非空；defined 为全部用例；退出码与 `gate` 按全量结果判定，不因回落本身失败 |
| UT-S13-112 | `paths` 非法即回落全量 | 缺省多模块夹具，提案只改 `portal-web/app.ts`；四臂分别把 `core.paths` 改为 `["/abs/**"]`、`["../out/**"]`、`[""]`、`[3]` | 每臂 `openlogos verify --format json` | 各臂 `scope.mode=="fallback-full"`、`fallback_reason.code=="module_paths_invalid"`、`detail` 点名模块 `core` 与非法项；不报错退出（门禁按全量结果判定） |
| UT-S13-113 | 无活跃提案即回落全量 | 缺省多模块夹具，删除 `logos/.openlogos-guard`（无活跃提案） | `openlogos verify --format json` | `scope.mode=="fallback-full"`、`fallback_reason.code=="no_active_change"`；defined 为全部用例 |
| UT-S13-114 | 用例归属与两套提取器同口径 | 测试目录含 `core-S01-test-cases.md`、`portal-web-S50-test-cases.md`、`portal-S60-test-cases.md`、`shared-S90-test-cases.md`；登记模块 `core`、`portal`、`portal-web` | 以范围 `["portal-web"]` 分别调用 `extractDefinedIndex`（verify.ts）与 `extractDefinedVerificationIds`（test-slice-manifest.ts） | 两者返回的 ID 集合完全相同，恰为 `portal-web-S50` 与 `shared-S90` 文件中的用例；`portal-S60` 不计入（`portal-web-` 最长匹配不误归 `portal`）；范围为全部模块时两者都返回全部用例 |
| UT-S13-115 | 范围外结果忽略 | 缺省多模块夹具，提案只改 `portal-web/app.ts`；本轮 portal-web 运行器输出 portal-web 与全局用例全部 pass，并在同一次运行中另输出 core 用例 1 条 pass（UT-S01-02）、1 条 fail（UT-S01-01）与 1 条任何规格都未定义的 ID（review F5：不依赖执行前残留的账本） | `openlogos verify --format json` | `gate.result=="FAIL"`（未定义 ID 照旧按账本一致性判定）；core 的两条结果不出现在 `failed_cases`、`unknown` / `outside_eligible` 类诊断与任何计数中；`scope.out_of_scope_result_count==2`；把未定义 ID 那行删掉后重跑 → `gate.result=="PASS"` |
| UT-S13-116 | 命令选择、去重、顺序与注入 | 三模块 `core`、`portal-web`、`portal-server`（均声明 `paths`）；`verify.modules.core` 与 `verify.modules.portal-web` 配置完全相同的命令组 A，`portal-server` 未配置模块命令（取项目级命令组 P）；改动同时命中三个模块 | `openlogos verify --format json`；读取调用日志 | 命令组 A 只执行一次，`OPENLOGOS_VERIFY_MODULES=="core,portal-web"`；随后 P 执行一次，`OPENLOGOS_VERIFY_MODULES=="portal-server"`（按 logos-project.yaml 中首次出现的顺序）；`pre_run.commands[]` 每条带 `modules`（分别为 `["core","portal-web"]`、`["portal-server"]`）；两阶段命令组（`regression_command` + `incremental_command`）臂内顺序与现有规则一致；各命令组结果按同 ID 去重全序规则合并。另加两阶段优先臂（review F4）：(a) `verify.modules.core` 同时配置 `pre_run_command`、`regression_command`、`incremental_command`；(b) `portal-server` 回落的项目级命令组同样三字段齐备 → 两组都按 regression → incremental 执行，调用日志中两组的 `pre_run_command` 均未被调用；`pre_run.commands[]` 中两组各有一条 `stage:"pre_run"`、`status:"skipped"` 的兼容跳过记录（带该组 `modules`），并出现兼容跳过诊断 |
| UT-S13-117 | 模块命令失败 | 缺省多模块夹具，改动同时命中两个模块；core 的模块命令写完结果后以退出码 3 结束，portal-web 的命令成功 | `openlogos verify --format json`；读取调用日志 | portal-web 的命令照常执行（调用日志两条）；`gate.result=="FAIL"`、`gate.reason=="pre_run_failed"`；`pre_run.commands` 中 core 那条 `status=="fail"`、`exit_code==3`、`modules==["core"]`，portal-web 那条 `status=="pass"`；诊断点名模块 `core` |
| UT-S13-118 | 切片集合与范围求交（变更测试保留，review F3） | 缺省多模块夹具 + 切片 manifest；baseline 含未修改的 core 用例 UT-S01-02 与全局 UT-S90-01。臂 ①（范围裁剪）：提案归属 `portal-web`，只改 `portal-web/app.ts`，提案 delta 只有 `deltas/test/portal-web-S50-test-cases.md`（修改 UT-S50-01）；单切片 slice-1 owned UT-S50-01。臂 ②（跨模块变更测试）：在臂 ① 基础上提案另含 `deltas/test/core-S01-test-cases.md`（修改 UT-S01-01），因此 core 经 delta 前缀进入 M；两个切片：slice-1 owned UT-S50-01（当前 attempted），slice-2 owned UT-S01-01（未来切片） | 每臂先以切片 checkpoint 模式 `openlogos verify --format json`；臂 ② 在 slice-1 确认、slice-2 完成后再做 final 验收；读取调用日志 | 臂 ①：`scope.modules==["portal-web"]`；baseline、confirmed、attempted、eligible 都与范围求交——`eligible_test_ids` 含 UT-S50-01、UT-S90-01，不含未修改的 core 用例 UT-S01-01、UT-S01-02；运行器读到的 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 与 JSON 中 eligible 一致。臂 ②：`scope.modules==["core","portal-web"]`，`reasons` 含 core 的 `source:"delta"`；checkpoint 时 UT-S50-01 进入 eligible，本提案变更测试 UT-S01-01 保留在 `pending_test_ids`（不被范围裁掉，`S = D_M ∪ C`）；final 时 eligible 含 UT-S01-01、UT-S01-02、UT-S50-01 等全部范围内用例 |
| UT-S13-119 | JSON `scope` 结构与报告「范围」行 | 取 UT-S13-106（module）、UT-S13-105 第三臂（all）、UT-S13-110（fallback-full）、UT-S13-104 第二臂（未启用）四个夹具 | 先确认根 `spec/schema/verify.schema.json` 可按 JSON 严格解析、顶层 `properties` 含 `scope`；再对每个夹具 `openlogos verify --format json` 后以该 schema 校验 envelope，并读取 `acceptance-report.md` | 前三个 envelope 通过 schema 校验，`scope` 恰含 `mode`、`modules`、`reasons`、`fallback_reason`、`out_of_scope_result_count` 五个键，取值符合各自模式；报告 Summary 依次含「范围」行 `module（core, portal-web, portal-server）`、`all`、`fallback-full（unmapped_file：…）`；第四个 envelope 无 `scope` 键、报告无「范围」行 |
| UT-S13-120 | `verify.modules` 含未登记模块 id | 缺省多模块夹具，`verify.modules` 另含 `mobile`（未登记） | `openlogos verify --format json` | 诊断含警告 `verify_module_unknown`（点名 `mobile`）；该项被忽略、不执行；`gate` 与无该项时一致；另断言根 `spec/logos.config.schema.json` 可按 JSON 严格解析，`verify` 节含可选 `modules`（每个模块的值只允许 `pre_run_command` / `regression_command` / `incremental_command` 三个字符串字段），且夹具配置能通过该 schema 校验 |
| UT-S13-121 | `openlogos change` 记录 `baseRef` 与写入者保留 | 三臂：① git 仓库且已有提交；② git 仓库但无提交；③ 非 git 目录 | 每臂 `openlogos change demo`；臂 ① 另以同一 slug 再执行一次 `openlogos change demo`（提案已存在而被拒绝创建）后再读 guard | ① guard 含 `baseRef` 且等于当时 `git rev-parse HEAD`（40 位）；被拒后 guard 字节与 `baseRef` 均不变；② ③ guard 不含 `baseRef`，其余字段与引入前一致 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-27 | 只改一个模块的端到端 | 「按模块限定范围的 verify」主路径 | 缺省多模块夹具；提案归属 `portal-web`，只改 `portal-web/app.ts`；`MSV_EMIT_FOREIGN=1`（本轮 portal-web 运行器另输出一条 core 用例 UT-S01-01 的 fail 行）；verify 前向结果文件预置一条上一轮遗留的 core 失败行 | ① `openlogos verify --format json`；② 读取调用日志与 `acceptance-report.md` | ① `gate.result=="PASS"`；`scope.mode=="module"`、`modules==["portal-web"]`；`summary.defined_count==3`（UT-S50-01、UT-S50-02、UT-S90-01）；本轮输出的 core fail 行被忽略，`scope.out_of_scope_result_count==1`；预置的遗留行已被执行前清空、不被采信（不出现在 `failed_cases` 与任何计数中）；② 调用日志只有 portal-web 命令一次；报告含「范围」行 |
| ST-S13-28 | 跨模块提案 | 主路径、异常「跨模块提案」 | 同 ST-S13-27，另改 `src/protocol.ts` | `openlogos verify --format json` | `scope.modules==["core","portal-web"]`，`reasons` 含 core 的 `source:"path"`；调用日志 core、portal-web 命令各一次；defined 为 5 条 |
| ST-S13-29 | 改动归不到模块时回落全量 | 异常「改动文件归不到模块」 | 同 ST-S13-27，另新建 `scripts/release.sh` | `openlogos verify --format json` | `scope.mode=="fallback-full"`、`fallback_reason.code=="unmapped_file"`；两个模块命令都执行；defined 为 5 条 |
| ST-S13-30 | 无 `paths` 的多模块项目上纯规格提案走现有全量流程（review F1） | 异常「未启用模块范围」 | 多模块项目，两个模块都不写 `paths`，`verify.modules` 未配置；新版 `openlogos change` 创建归属 `portal-web` 的提案（guard 有合法 `baseRef`），只写 `portal-web-` 前缀的 delta 并 merge | 新、旧两个版本的 CLI 各执行 `openlogos verify --format json`（剔除 `timestamp`、`duration_ms`） | 两者输出逐字一致；无 `scope`；defined 为全部用例；只执行项目级命令 |
| ST-S13-31 | `--all` 端到端 | `--all` | 缺省多模块夹具，提案只改 `portal-web/app.ts`；verify 前向结果文件预置一条上一轮遗留的 core 失败行 | ① `openlogos verify --all --format json`；② 设 `MSV_CORE_FAIL=1` 后重跑 ① | ① `scope.mode=="all"`；两个模块命令都执行；defined 为 5 条；遗留行已被清空、不被采信，`gate.result=="PASS"`；② 本轮 core 命令输出的 UT-S01-01 fail 进入 `failed_cases`，`gate.reason=="failed_cases"`（review F5） |
| ST-S13-32 | `logos/` 下已归属文件与共享验收配置（review F2） | 异常「共享验收配置被修改」 | 缺省多模块夹具，`core.paths` 含 `logos/tools/**`；提案归属 `portal-web` | ① 只改 `portal-web/app.ts` 与 `logos/tools/protocol-check.ts` 后 `openlogos verify --format json`；② 在 ① 基础上再改 `logos/logos.config.json` 中项目级命令的一个参数后重跑 | ① `scope.modules==["core","portal-web"]`，两个模块命令都执行；② `scope.mode=="fallback-full"`、`fallback_reason.code=="shared_config_changed"` |

### 追溯与覆盖

- 启用条件与优先级（§2.96 启用条件，review F1）：UT-S13-104（旧启用口径必红）、UT-S13-105、ST-S13-30。
- 范围 M 的三类来源（C01）：UT-S13-106、ST-S13-27、ST-S13-28。
- 改动文件集合与 `baseRef`：UT-S13-107、UT-S13-121。
- 改动文件分类（review F2）：UT-S13-108（整体排除 `logos/` 的实现必红）、UT-S13-109、ST-S13-32。
- 回落全量的八种原因：`unmapped_file` UT-S13-110 / ST-S13-29；`base_ref_missing`、`not_git_repository`、`base_ref_unreachable`、`diff_failed` UT-S13-111；`module_paths_invalid` UT-S13-112；`no_active_change` UT-S13-113；`shared_config_changed` UT-S13-109。
- 用例归属与两套提取器同口径：UT-S13-114。
- 范围外结果忽略：UT-S13-115、ST-S13-27。
- 命令选择、去重、注入与失败：UT-S13-116、UT-S13-117。
- 切片集合与范围求交：UT-S13-118。
- JSON `scope` 与报告「范围」行：UT-S13-119。
- `verify.modules` 未登记 id：UT-S13-120。
- `--all`（C02）：UT-S13-105、ST-S13-31。
- 既有 S13 全部用例与 UT-S13-85、UT-S13-100 等零回归用例作为守护，须在单模块项目上保持绿。

### 自动化与证据要求

- 范围计算以真实 git 仓库驱动（不以桩替代 `git diff` / `git ls-files`），仅 UT-S13-111 臂 ④ 经测试接缝注入失败；命令执行以真实 `openlogos verify` 子进程与记录型运行器验证，调用日志写在项目外一次性目录。
- 断言基于 `--format json` 的结构化字段、退出码、调用日志与报告 Summary 表行，不解析其余人类可读文案。
- 新旧实现逐字比对（UT-S13-104、ST-S13-30）的旧实现取本提案实现前的构建产物，剔除字段仅限 `timestamp`、`duration_ms`。
- 测试结果写入 `logos/resources/verify/test-results.jsonl`（OpenLogos reporter），每个 ID 一条，测试名包含用例 ID。

## S13 多模块项目模块验收报告测试（module-scoped-phase-reports）

> 覆盖场景 `core-S13-verify.md`「S13 多模块项目写模块验收报告」（EX-MR.1～EX-MR.6），功能规格 §2.99.2、§2.99.3、§2.99.5，`spec/test-results.md`「多模块项目的模块验收报告与模块冒烟报告（module-scoped-phase-reports）」，决策 C01，proposal-r1 F3。既有 UT-S13-104～UT-S13-121、ST-S13-27～ST-S13-32 作为回归守护。测试实现必须写入 OpenLogos reporter（`logos/resources/verify/test-results.jsonl`），测试名包含对应 ID，`scenario_id="S13"`。
>
> **夹具 MV**：`mktemp -d` 一次性 git 项目。`logos-project.yaml` 登记 `core`（launched，`paths: ["src/**"]`）、`team`（initial，`paths: ["team/**"]`）、`portal`（initial，`paths: ["portal/**"]`）；测试规格 `core-S01-test-cases.md`（UT-S01-01、UT-S01-02）、`team-S60-test-cases.md`（UT-S60-01、UT-S60-02）、`portal-S70-test-cases.md`（UT-S70-01）与不带前缀的全局 `shared-test-cases.md`（UT-SH-01）。记录型运行器按测试设定写结果、按设定退出码退出，并记录调用。**夹具 S1**：只登记 `core` 的单模块项目。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-122 | 模块用例子集 U(m) 与 M={m} 同判据 | §2.99.5 | 夹具 MV；活跃提案（归属 core）修改了 `core-S01-test-cases.md` 的 UT-S01-02 与 `team-S60-test-cases.md` 的 UT-S60-02 | 计算 U(team)、U(portal)，并与范围 M={team}、M={portal} 时 `testFileInScope` 的文件判定对照 | U(team) = {UT-S60-01, UT-S60-02, UT-SH-01}；U(portal) = {UT-S70-01, UT-SH-01}；core 前缀规格中的变更用例 UT-S01-02 不进入任何 initial 模块子集；文件判定与 `testFileInScope` 一致 |
| UT-S13-123 | 子集为空不写 | §2.99.5、EX-MR.1 | 夹具 MV 去掉 `portal-S70-test-cases.md` 与 `shared-test-cases.md`；已有一份旧 `portal-acceptance-report.md` | `verify --all` | 不写 `portal-acceptance-report.md`，旧文件内容与修改时间不变；`team-acceptance-report.md` 照常写入 |
| UT-S13-124 | 覆盖的模块：未启用 / all / fallback-full 写全部 initial 模块，module 模式只写 M | §2.99.5、EX-MR.2 | 夹具 MV；变体 ①：去掉所有 `paths`（范围未启用）；②：`--all`；③：提案改动 `logos/logos.config.json`（`fallback-full`）；④：提案只改 `team/**`（`module`，M={core, team}）；④ 中已有旧 `portal-acceptance-report.md` | 执行 verify | ①②③：写 `team-`、`portal-acceptance-report.md`；④：只写 `team-acceptance-report.md`，`portal-` 旧报告不变；四种变体都不写 `core-acceptance-report.md` |
| UT-S13-125 | 只写 initial 模块，单模块项目不写 | §2.99.1、EX-MR.6 | 夹具 MV 把 team、portal 都改为 launched；夹具 S1 | 分别 `verify --all` / `verify` | 不写任何 `<m>-acceptance-report.md`；共用报告、verify JSON 与修改前逐字节相同（S1 与零回归基准一致） |
| UT-S13-126 | 报告格式：「模块」行与按子集统计 | §2.99.2 | 夹具 MV；运行器为全部用例写 pass，UT-S60-02 写 fail | `verify --all` | `team-acceptance-report.md`：标题与共用报告相同，Summary 含「模块 / Module」行 `team`，Defined 为 3、Failed 为 1、失败清单只含 UT-S60-02，`**Gate 3.5**` 为 `**FAIL**`；`portal-acceptance-report.md` Defined 为 2、Gate PASS；共用报告 Gate FAIL |
| UT-S13-127 | 共享预跑非零退出计入每个模块 | §2.99.5、EX-MR.3 | 夹具 MV 去掉 `paths`（范围未启用）；项目级 `pre_run_command` 写全部 pass 后退出码 1 | `verify` | 共用报告 Gate FAIL（既有 `pre_run_failed`）；`team-`、`portal-acceptance-report.md` Gate 均为 FAIL，报告写明预跑命令非零退出、无法归属到模块 |
| UT-S13-128 | 命令组归属：只计入其服务的模块 | §2.99.5、EX-MR.4 | 夹具 MV，`--all`；配置 `verify.modules.team` 的独立命令（退出 0、team 用例全 pass）；项目级命令组服务 core 与 portal，退出码 1 | `verify --all --format json` | `pre_run.commands[]` 中项目级组 `modules=["core","portal"]` 为 fail；`portal-acceptance-report.md` Gate FAIL；`team-acceptance-report.md` Gate PASS；共用报告 Gate FAIL |
| UT-S13-129 | 沙箱失败、账本不自洽、未定义 ID 计入每个模块；写入在改判之后 | §2.99.5、EX-MR.5 | 夹具 MV，`--all`，结果全部 pass；变体 ①：verify 沙箱判定失败（`sandbox.status=fail`）；②：结果文件含重复冲突行致账本不自洽；③：结果含未定义 ID `UT-S99-01` | 执行 verify | 三个变体中 `team-`、`portal-acceptance-report.md` Gate 均为 FAIL；变体 ① 的模块报告不存在「先写 PASS 后改判」的中间态（以写入次数断言：每份模块报告恰写一次且内容为 FAIL） |
| UT-S13-130 | Gate 判定前中止不写 | §2.99.5 | 夹具 MV；变体 ①：删除全部测试规格（`NO_TEST_CASES`）；②：结果文件不存在 | 执行 verify | 两个变体都以既有错误退出，不创建、不修改任何 `<m>-acceptance-report.md` |
| UT-S13-131 | 写入白名单含模块验收报告 | §2.99.9 | 夹具 MV 启用 verify 沙箱，allow 列表为默认 | `verify --all` | 沙箱允许写入 `logos/resources/verify/team-acceptance-report.md` 与 `portal-acceptance-report.md`，不产生越界诊断；其他未列入路径仍被拒绝 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-33 | fallback-full 为每个 initial 模块写报告，可归属的失败互不影响 | Step 1～10 | 真实 CLI；夹具 MV；`verify.modules.team` 为独立命令，portal 用项目级命令；提案改动 `logos/logos.config.json`（`fallback-full`） | ① 两组命令都退出 0，team 全 pass、portal 的 UT-S70-01 fail，执行 `verify --format json`；② 改为 portal 全 pass 后重跑；③ `status --format json` | ① `team-acceptance-report.md` Gate PASS、`portal-acceptance-report.md` Gate FAIL、共用 Gate FAIL；② 两份模块报告均 PASS；③ team、portal 的 phase.3-6 均为 done（前序阶段齐全时） |
| ST-S13-34 | 共享 runner 非零退出时所有模块 FAIL | Step 1～10 | 真实 CLI；夹具 MV 去掉 `paths`（范围未启用）；项目级 runner 写全部 pass 后退出码 1 | ① `verify --format json`；② `status --format json` | ① verify 退出非零，`gate.reason=pre_run_failed`；两份模块报告 Gate FAIL；② team、portal 都停在 phase.3-6 |

### 覆盖度校验

- U(m) 判据与空子集：UT-S13-122、UT-S13-123。
- 覆盖的模块与只写 initial 模块、单模块不写：UT-S13-124、UT-S13-125。
- 报告格式与统计：UT-S13-126。
- 运行级失败归属（共享预跑、命令组、沙箱、账本、未定义 ID）与写入时机：UT-S13-127～UT-S13-130、ST-S13-33、ST-S13-34。
- 写入白名单：UT-S13-131。

## S13 切片 checkpoint owned 验收范围测试

> 覆盖场景 `core-S13-verify-results.md`「S13 切片 checkpoint 的 owned 验收范围」（Step 1～13、EX-11.1～EX-11.5），功能规格 §2.37.2、§2.37.4、§2.37.8、§2.101，`spec/test-slice-manifest.md` §7，`spec/test-results.md`「切片 checkpoint 的结果集合与 pending 语义」，决策 C01、C03。既有 UT-S13-56～UT-S13-64、ST-S13-15～ST-S13-17（切片 checkpoint 与 final）与 UT-S13-104～UT-S13-131、ST-S13-27～ST-S13-34（模块范围与模块报告）作为回归守护。测试实现必须写入 OpenLogos reporter（`logos/resources/verify/test-results.jsonl`），测试名包含对应 ID，`scenario_id="S13"`。
>
> **夹具 SV**：`mktemp -d` 一次性 git 项目，单模块 `core`（launched）。已合并测试规格 `core-S01-test-cases.md` 定义基线用例 UT-S01-01、UT-S01-02、UT-S01-03、ST-S01-01，`core-S90-test-cases.md` 定义本提案变更用例 UT-S90-01、UT-S90-02、UT-S90-03（D 共 7 个非 manual 用例）。活跃提案已 spec-complete，`SPEC_MERGED.test_change_set` 的 C = {UT-S90-01, UT-S90-02, UT-S90-03}；manifest 两片：`slice-a` 拥有 UT-S90-01、UT-S90-02，`slice-b` 拥有 UT-S90-03。变体 **SV-owned**：manifest `verify_scope: "owned"`；**SV-baseline**：`verify_scope: "baseline"`；**SV-legacy**：manifest 无 `verify_scope` 字段。记录型运行器按测试设定写结果、按设定退出码退出，并把收到的 `OPENLOGOS_VERIFY_SLICE_SCOPE` 与 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 记入调用日志。**夹具 SV-MM**：在 SV-owned 基础上登记 `team`（initial，`paths: ["team/**"]`），新增 `team-S60-test-cases.md`（UT-S60-01）。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-132 | owned 范围的 eligible / pending 公式 | §2.37.2、§2.101.5 | 夹具 SV-owned；变体 ①：无 checkpoint；②：`slice-a` 已有身份匹配的 PASS checkpoint | 调用 `deriveSliceVerificationState()` | ① `verify_mode=slice-checkpoint`、`attempted_slice_id=slice-a`、eligible = [UT-S90-01, UT-S90-02]、pending = [UT-S90-03]；② attempted 为 `slice-b`、eligible = [UT-S90-01, UT-S90-02, UT-S90-03]、pending = []；两个变体的 eligible 均不含任何 UT-S01-* / ST-S01-* |
| UT-S13-133 | owned 范围下基线无结果不计 uncovered | §2.37.4、§2.101.5 | 夹具 SV-owned，无 checkpoint；运行器只为 UT-S90-01、UT-S90-02 写 pass | `verify --format json` | checkpoint PASS；`eligible_test_ids` 长度为 2、`uncovered_cases` 为空、覆盖率 100%；`SLICE_CHECKPOINTS.jsonl` 追加一行 `slice-a` PASS；不写 `VERIFY_PASS` |
| UT-S13-134 | baseline 与旧 manifest 的集合与引入前一致 | §2.37.8、EX-11.2 | 夹具 SV-baseline 与 SV-legacy，均无 checkpoint | 分别调用 `deriveSliceVerificationState()` 并执行 `verify --format json`（运行器写 eligible 全部 pass） | 两个变体 eligible 都等于 B ∪ owned(slice-a)（6 个 ID），pending = [UT-S90-03]；verify JSON 的集合、Gate 与 `acceptance-report.md` 中除「验收范围」行外的内容，与以引入本能力前的实现对 SV-legacy 运行所得逐字节相同 |
| UT-S13-135 | 注入 `OPENLOGOS_VERIFY_SLICE_SCOPE`，final 不注入 | §2.37.4、Step 4、Step 10 | 夹具 SV-owned / SV-legacy 的 checkpoint；SV-owned 全部切片已确认且 `[code]` 全勾的 final；final 时父进程环境预置 `OPENLOGOS_VERIFY_SLICE_SCOPE=owned` | 依次执行 verify，读取运行器调用日志 | SV-owned checkpoint 收到 `owned`，`OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 恰为 UT-S90-01、UT-S90-02；SV-legacy checkpoint 收到 `baseline`；final 的预跑命令环境中不存在 `OPENLOGOS_VERIFY_SLICE_SCOPE`（父进程预置值不泄漏） |
| UT-S13-136 | owned 范围下输出基线结果判越界 | EX-11.1、`spec/test-results.md` | 夹具 SV-owned，无 checkpoint；运行器为 UT-S90-01、UT-S90-02 与 UT-S01-01 都写 pass | `verify --format json` | checkpoint FAIL，诊断含 `result_outside_eligible_scope` 并点名 UT-S01-01；写 `VERIFY_FAIL` 与 `LOOP_ITERS{verify_mode:"slice-checkpoint",attempted_slice_id:"slice-a"}`；不追加 PASS checkpoint |
| UT-S13-137 | owned 范围的 checkpoint 不写、不改模块验收报告 | §2.37.4、EX-11.3 | 夹具 SV-MM；已有一份旧 `team-acceptance-report.md`，记录其字节与修改时间；变体 ①：SV-MM（owned）checkpoint；②：同夹具改为 `verify_scope: "baseline"` 的 checkpoint；③：owned 下全部切片确认后的 final | 执行 verify | ① `team-acceptance-report.md` 字节与修改时间不变、不新建任何 `<m>-acceptance-report.md`，共用报告照常写；② 与 ③ 照旧重写 `team-acceptance-report.md` |
| UT-S13-138 | 共用验收报告标明验收范围 | §2.101.5、`spec/test-results.md`「checkpoint/final 报告」 | 夹具 SV-owned 与 SV-legacy 的 checkpoint，运行器写 eligible 全部 pass | 执行 verify 后读 `acceptance-report.md` | SV-owned 的 checkpoint 摘要含「验收范围」行 `owned` 与「基线回归由 final 承担」字样；SV-legacy 含「验收范围」行 `baseline`；两者都仍标注「切片检查点通过，非最终验收」 |
| UT-S13-139 | owned 范围下 final 仍全量 | §2.37.5、§2.101.5、EX-11.5 | 夹具 SV-owned，两片均有 PASS checkpoint，`[code]` 全部勾选；变体 ①：运行器只写 3 个 UT-S90-* 的 pass；②：7 个用例全部 pass；③：7 个全部写出但 UT-S01-02 为 fail | `verify --format json` | 三个变体 `verify_mode=final`、eligible 为 D 的 7 个 ID；① FAIL（`incomplete_coverage`），4 个基线 ID 列入 uncovered、不改列 pending；② PASS 并写 `VERIFY_PASS`；③ FAIL（`failed_cases`），写 final `LOOP_ITERS` |
| UT-S13-140 | owned 范围与模块范围叠加 | §2.96、§2.101.5、`spec/test-slice-manifest.md` §7.1 | 夹具 SV-MM，模块范围启用且提案只改动 `src/**`（M={core}） | 调用 `deriveSliceVerificationState()` 并执行 `verify --format json` | eligible = [UT-S90-01, UT-S90-02]（不含 B_S，也不含 UT-S60-01）；`scope.mode="module"`；运行器写出的 UT-S60-01 结果按范围外忽略并计入 `scope.out_of_scope_result_count`，不判 `result_outside_eligible_scope` |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-35 | owned 范围从首片到 final 的端到端 | Step 1～13 | 真实 CLI；夹具 SV 去掉 manifest，配置 `verify.slice_scope_threshold: 3`；运行器只运行 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 中的用例并写 pass | ① `openlogos slice plan --file slices.json --format json`；② `status --format json`；③ `verify --format json`；④ 勾选 `slice-a` 后 `verify --format json`；⑤ 勾选 `slice-b` 后 `verify --format json` | ① `data.verify_scope="owned"`、`verify_scope_source="decided"`；② `slice_verification_state.verify_scope="owned"`；③ checkpoint PASS，运行器只收到 2 个 ID；④ checkpoint PASS，运行器只收到 3 个 UT-S90-* ID；⑤ `verify_mode=final`，运行器收到全部 7 个 ID 且未收到 `OPENLOGOS_VERIFY_SLICE_SCOPE`，写 `VERIFY_PASS` |
| ST-S13-36 | 未达阈值时 baseline 零回归 | Step 1～13 | 真实 CLI；夹具 SV 去掉 manifest，配置保持缺省（阈值 1000）；运行器同 ST-S13-35 | 同 ST-S13-35 的 ①～⑤ | ① `verify_scope="baseline"`；③④ 每次 checkpoint 运行器都收到 4 个基线 ID 加对应 owned ID，并收到 `OPENLOGOS_VERIFY_SLICE_SCOPE=baseline`；各步 verify JSON 的集合、Gate、`SLICE_CHECKPOINTS.jsonl` 行数与引入本能力前一致；⑤ final 写 `VERIFY_PASS` |
| ST-S13-37 | owned 范围下后续切片改坏前序切片被 checkpoint 拦下 | Step 3～8、EX-11.4 | 真实 CLI；夹具 SV-owned，`slice-a` 已有 PASS checkpoint 并已勾选 | ① 运行器令 UT-S90-01 fail、UT-S90-02 与 UT-S90-03 pass，执行 `verify --format json`；② 改为全部 pass 后重跑 | ① attempted 为 `slice-b`，eligible 含 UT-S90-01，checkpoint FAIL，`LOOP_ITERS.attempted_slice_id="slice-b"`，`slice-a` 的 PASS checkpoint 仍被采信；② checkpoint PASS 并追加 `slice-b` 行 |

### 覆盖度校验

- owned 范围的集合公式与基线不计 uncovered：UT-S13-132、UT-S13-133、ST-S13-35。
- baseline / 旧 manifest 零回归：UT-S13-134、ST-S13-36。
- 环境变量注入与 final 不注入：UT-S13-135、ST-S13-35 步骤⑤。
- runner 越界输出：UT-S13-136。
- 模块验收报告与共用报告：UT-S13-137、UT-S13-138。
- final 全量硬门不变：UT-S13-139、ST-S13-35 步骤⑤。
- 与模块范围叠加：UT-S13-140。
- 前序切片回归在提案内被发现：ST-S13-37。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S13"`；失败不得写 pass。
- 环境变量与 eligible 的断言必须读取记录型运行器的调用日志，不得以 verify 的 stdout 自述代替。
- 「零回归」「字节不变」类断言直接读回磁盘字节与修改时间比对；UT-S13-134 的引入前基准由同一夹具在引入前实现上生成并作为 golden 固化。

## S13 验收历史留存与查询测试（verification-history）

> 覆盖场景 `core-S13-verify-results.md`「验收历史留存与查询时序（verification-history）」（Step 1～10、EX-13H.1～EX-13H.10），功能规格 §2.104，`spec/test-results.md`「验收历史留存（verification-history）」，`spec/cli-json-output.md`「`openlogos history` 命令组与 verify / smoke 的 history 字段（verification-history）」。
>
> **夹具 VH**：`mktemp -d` 一次性 git 项目，单模块 `core`（launched），已合并测试规格定义 UT-S01-01、UT-S01-02、ST-S01-01；`verify.pre_run_command` 指向记录型 runner（按环境变量决定每条用例 pass / fail、可在 `error` 中写入敏感占位值 `SECRET-PLACEHOLDER-7f3a`、记录每次调用）；活跃提案 `vh-demo` 已 spec-complete。变体 VH0：同一项目无活跃提案。变体 VH-reuse：不配置预跑命令，结果文件预先写好。
>
> 结构化断言一律读回磁盘文件解析，不以命令 stdout 自述代替；「行为不变」类断言以同一夹具在引入前实现上生成的 golden 比对。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-141 | 连续两次 verify 后两轮都可追溯 | §2.104.2、§2.104.3 | 夹具 VH；第一次 runner 让 UT-S01-01、UT-S01-02 失败，第二次全部通过 | 依次执行两次 `verify --format json`（记下两次 `data.history.run_id`），再执行 `history list --slug vh-demo --format json` 与 `history show <第一次的 run_id> --format json` | `logos/resources/verify/history/` 下恰有两个文件，文件名等于各自 `run_id`；列表按 `started_at` 倒序，第一条为第二次运行（`gate.result=PASS`）、第二条为第一次运行（`gate.result=FAIL`）；按第一次的 run_id 查看得到 `failed_ids` 为 `["UT-S01-01","UT-S01-02"]`、`counts` 与第一次的报告一致，报告快照的 Gate 行为 FAIL；`acceptance-report.md` 与 `test-results.jsonl` 只反映第二次 |
| UT-S13-142 | smoke 覆盖预检改判时报告与历史一致 | §2.104.5、EX-13H.1 | 夹具 VH；提案新增 smoke 用例 SMOKE-core-901 但没有 runner；用例全部通过 | `verify --format json` | 命令 `gate.result=FAIL`；`acceptance-report.md` 的 Gate 行为 FAIL；历史 `gate.result=FAIL`、`gate.reason` 与命令一致；提案运行目录 `report.md` 与 `acceptance-report.md` 逐字节相同 |
| UT-S13-143 | 复用既有结果标 reused | §2.104.3、EX-13H.2 | 夹具 VH-reuse | 连续两次 `verify --format json` | 两条历史 `result_source` 都是 `reused`；runner 调用日志为空 |
| UT-S13-144 | 进入执行后的早退仍留历史，执行前拒绝不留 | §2.104.4、§2.104.10、EX-13H.3 | 夹具 VH；变体 ①：VH-reuse 配置（不配置预跑）且结果文件不存在；②：预跑执行后已合并测试规格中没有任何可验收用例；③：预跑命令以非零退出且不写任何结果行；④：传入未知参数；⑤：删除 `logos/logos.config.json` | 分别执行 `verify --format json`，解析 stdout 与 stderr 的 JSON 信封 | ①②：stderr 为既有错误信封，`error.code` 分别为 `NO_TEST_RESULTS`、`NO_TEST_CASES`，`message` 与退出码与修改前一致；`error.details.history.index_path` 指向新增的中央索引文件，该文件 `outcome=aborted`、`error_code` 等于 `error.code`、`gate.result=null`，提案运行目录无 `report.md`；③：不是早退，stdout 成功信封 `gate.result=FAIL`，历史 `outcome=completed`、`result_source=executed`；④⑤：不新增任何历史文件，信封中无 history 元数据 |
| UT-S13-145 | 自由文本的 Git 可见范围 | §2.104.2、§2.104.3 | 夹具 VH；runner 让 UT-S01-01 失败并在 `error` 写入 `SECRET-PLACEHOLDER-7f3a`；两臂：缺省配置 / `verify.history.raw_in_proposal: false` | 每臂执行一次 `verify` 后全文搜索占位值 | 两臂中央索引文件都不含占位值，且其键集合等于 §2.104.3 白名单；缺省臂：提案运行目录 `results.jsonl` 与 `report.md` 含占位值，`raw_location="proposal"`；关闭臂：提案运行目录 `results.jsonl` 每行只含 `id`、`status`、`scenario`、`timestamp`、`duration_ms`（及存在时的 `environment` / `target_environment`）且不含占位值、无 `report.md`，占位值只出现在 `logos/.openlogos-runtime/verify-runs/<run_id>/`，`raw_location="local"` |
| UT-S13-146 | 同一结果路径并发时后到者被拒 | §2.104.6、EX-13H.4 | 夹具 VH；runner 在收到信号前阻塞；先在后台启动一次 verify 直至其持锁 | 再执行一次 `verify --format json`，解析 stderr 信封 | 后到者退出码 2、stderr 错误信封 `error.code=RESULT_PATH_BUSY`，`error.details.paths` 含 `logos/resources/verify/test-results.jsonl`；`test-results.jsonl` 的字节与修改时间不变；不新增历史文件；放行前者后其历史正常写入 |
| UT-S13-147 | 只共享阶段结果路径或只读既有结果也参加冲突判定 | §2.104.6、EX-13H.4 | 夹具 VH 改为两阶段：`regression_result_path=logos/resources/verify/reg.jsonl`、`incremental_result_path=logos/resources/verify/inc.jsonl`；`smoke.result_path` 配为 `logos/resources/verify/reg.jsonl`；变体：后台持锁的是只读取既有结果的 verify（VH-reuse 配置） | verify 持锁期间执行 `smoke --format json`；变体中执行配置预跑的 verify | 两种情况后到者都以 `RESULT_PATH_BUSY` 拒绝，`reg.jsonl` 字节不变，不新增历史 |
| UT-S13-148 | checkpoint 与 final 各留一条 | §2.104.3、EX-13H.7 | 两切片提案（复用 S13 切片验收夹具 SV）；切片 1 checkpoint 连续两次 PASS，随后 final PASS | 依次执行三次 `verify` | 三条历史：前两条 `verify_mode=slice-checkpoint`、`attempted_slice_id` 为切片 1，第三条 `verify_mode=final`、`attempted_slice_id=null`；`SLICE_CHECKPOINTS.jsonl` 的去重行为与修改前一致 |
| UT-S13-149 | 归档后按 run_id 定位，同名新提案不串号 | §2.104.9、§2.104.10、EX-13H.9 | 夹具 VH 运行一次 verify 后执行 `archive vh-demo`，再新建同名提案 `vh-demo` 并运行一次 verify | `history show <旧 run_id> --format json`、`history show <新 run_id> --format json`；再删除归档目录下的旧运行目录后重查旧 run_id | 旧 run_id 的 `full_record.path` 指向 `logos/changes/archive/<日期>-vh-demo/verify-runs/<旧 run_id>/`；新 run_id 指向活动目录；两次结果的计数与失败用例互不相同；删除后仍返回中央字段，`full_record="unavailable"`；中央索引文件字节在归档前后不变 |
| UT-S13-150 | 没有活跃提案只写中央索引 | §2.104.2、EX-13H.8 | 夹具 VH0 | `verify --format json` 后 `history show <run_id>` | 新增一个中央索引文件，`proposal=null`、`raw_location="none"`；`logos/changes/` 下无新增文件；`history show` 标明无完整记录 |
| UT-S13-151 | 运行记录目录不影响 change-lint、merge 与计划指纹 | §2.104.9 | 夹具 VH 在 spec-complete 前运行一次 verify，使提案目录出现 `verify-runs/` | 执行 `change-lint --format json`、读取 `TEST_SLICE_MANIFEST.json` 指纹、执行 `merge`（no-delta 变体）与 `status --format json` | change-lint 结论与没有 `verify-runs/` 时相同；计划、任务与规格指纹不变；merge 不把 `verify-runs/` 当作 delta；`proposal_step` 与切片状态派生不变 |
| UT-S13-152 | 现有报告、结果文件与标记零回归 | §2.104.11 | 夹具 VH 的全绿、真实失败、两阶段三种运行（不触发 smoke 覆盖预检改判） | 各执行一次 `verify` | `acceptance-report.md`、`test-results.jsonl` 字节与引入前 golden 一致；`VERIFY_PASS` / `VERIFY_FAIL` / `LOOP_ITERS` 的写入与删除时机与修改前一致；JSON 输出除新增 `data.history` 外与修改前一致 |
| UT-S13-153 | 历史写入失败不改变门禁与退出码 | §2.104.7、EX-13H.5 | 夹具 VH；把 `logos/resources/verify/history` 预先创建为普通文件（无法作为目录写入） | `verify --format json`（全绿） | 退出码 0、`gate.result=PASS`、`VERIFY_PASS` 写入；`data.history.write_status="failed"`，`data.history.write_error` 为 `{ code: "verification_history_write_failed", layer: "index", path: "logos/resources/verify/history" }` 形态；文本模式给出一行警告 |
| UT-S13-154 | 损坏的历史文件被跳过并提示 | §2.104.10、EX-13H.6 | 夹具 VH 已有两条正常历史；另放入一个内容为 `not json` 的 `<run_id>.json` 与一个缺 `kind` 的文件 | `history list --format json` | 返回两条正常记录；`warnings` 含两条 `verification_history_corrupt`，各点名对应文件；退出码 0 |
| UT-S13-155 | 查询命令的筛选、查看与错误码 | §2.104.10 | 夹具 VH 已有 verify 的 FAIL、PASS、aborted 各一条与 smoke 的 PASS 一条 | `history list --kind verify --result fail`、`--result aborted`、`--kind smoke`、`--limit 1`；`history show <不存在的 run_id> --format json`；文本模式 `history list` | 筛选结果分别只含对应记录、按 `started_at` 倒序；`--limit 1` 只返回最新一条；未知 run_id 退出码 1、stderr 错误信封 `error.code=HISTORY_RUN_NOT_FOUND`；文本模式每条一行，含时间、类型、提案、结论与失败用例数 |
| UT-S13-156 | 历史路径被 git 忽略时照常写入并给出路径 | §2.104.8、EX-13H.10 | 夹具 VH 的 `.gitignore` 含 `/logos/resources/*` | `verify --format json` 与文本模式 `verify` | 中央索引文件写入成功；`data.history.index_path` 为该文件的项目根相对路径，文本输出包含该路径；`git status --porcelain` 不列出它（被忽略），`git add -f <路径>` 可暂存；CLI 未执行任何 git 写操作（git 仓库的 index 与 HEAD 不变） |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-38 | 端到端：失败轮与通过轮在归档后仍可追溯 | Step 1～10 | 真实 CLI；夹具 VH | ① runner 让 UT-S01-02 失败，执行 `verify`；② 修复后执行 `verify`；③ `archive vh-demo`；④ `history list --slug vh-demo`；⑤ 以第①轮 verify 输出的 `data.history.run_id` 执行 `history show` | ①写出 FAIL 历史与提案运行目录；②写出 PASS 历史，`VERIFY_PASS` 在场、`VERIFY_FAIL` 已删除；④按时间倒序两条，第②轮（PASS）在前、第①轮（FAIL）在后；⑤以第①轮输出的 run_id 查看，从归档目录读到第①轮的完整结果与报告快照，`failed_ids=["UT-S01-02"]`，报告快照的 Gate 行为 FAIL |
| ST-S13-39 | 新克隆与两分支各验收一次后合并无冲突 | Step 2、Step 8、Step 10 | 真实 CLI；夹具 VH0 推到本地裸仓库；中央索引目录未被忽略 | ① 克隆两份，分别在分支 a、b 上各执行一次 `verify` 并各自提交新历史文件；② 在 a 上 `git merge b`；③ 第三次新克隆后执行 `history list` 与 `history show <a 的 run_id>` | ②合并无冲突，两条历史都在；③新克隆列出两条记录；`history show` 返回中央字段（无活跃提案时本就无完整记录，`full_record="unavailable"` 的原因注明为无提案） |

### 覆盖度校验

- 两轮可追溯与查询：UT-S13-141、UT-S13-155、ST-S13-38。
- 与最终门禁一致、结果来源、早退：UT-S13-142、UT-S13-143、UT-S13-144。
- Git 可见范围与入库：UT-S13-145、UT-S13-156、ST-S13-39。
- 运行锁：UT-S13-146、UT-S13-147。
- checkpoint / final、无活跃提案、归档定位：UT-S13-148、UT-S13-150、UT-S13-149。
- 边界与零回归：UT-S13-151、UT-S13-152、UT-S13-153、UT-S13-154。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S13"`，测试名含用例 ID；失败不得写 pass。
- 并发用例以可控阻塞的记录型 runner 构造确定的持锁窗口，不依赖 sleep 竞速；断言读取锁文件与结果文件的字节和修改时间。
- 自由文本断言对中央索引、提案运行目录与本机原文目录逐文件全文搜索占位值，并校验中央索引键集合等于白名单。

## S13 verify 自足：环境预检与跳过分类测试（verify-self-sufficient-cases）

> 覆盖场景 `core-S13-verify-results.md`「S13 verify 自足：环境预检与跳过分类」（Step 1～11、EX-13.1～EX-13.15），功能规格 §2.106.2～§2.106.7A、§2.106.10、§2.104.3（修改），`spec/test-results.md`「`[manual]` 标记用例」「verify 环境要求声明、对账与预检」「verify 跳过分类」「平台跳过原因的 reporter 写法」；需求 AC-VERIFY-SELF-01～08、AC-VERIFY-SELF-11、AC-VERIFY-SELF-13。
>
> **夹具 VS**：`mktemp -d` 一次性 git 项目，单模块 `core`（launched），已合并测试规格定义 UT-S01-01、UT-S01-02、ST-S01-01；`verify.pre_run_command` 指向记录型 runner：被执行时在项目外临时目录写标记文件 `RAN`，并按环境变量决定每条用例写 pass / fail / skip（skip 可带 `reason_code` / `detail`）。变体：
> - **VS-prop**：从不含 UT-S01-90 的已合并基线出发，建立活跃提案 `vs-demo`，测试 delta 新增 UT-S01-90，经正常 `openlogos merge` 合并（或以生产代码同一构造器写出能通过 `readTestChangeSet` 校验的 `SPEC_MERGED`）；proposal 含「验收标准」段。**每条使用 VS-prop 的用例在启动 verify 前先断言**：经 `readTestChangeSet` 读到的 `changed_test_ids` 包含 UT-S01-90、不含存量对照 UT-S01-02（评审 delta-r1 F4）。
> - **VS-req**：`logos.config.json` 声明 `verify.requirements`：`env: ["VS_TOKEN"]`、`commands: ["vs-fake-tool"]`、`checks: [{name: "vs-ready", command: "node check.mjs"}]`；`vs-fake-tool` 是放在临时 bin 目录中的可执行脚本，`check.mjs` 按环境变量决定退出码或挂起。
> - **VS-mod**：多模块（`core`、`backend`，各自声明非空 `paths`），`verify.modules.backend` 有独立命令组与 `requirements`。
>
> 「未声明要求时与现状一致」类断言以同一夹具在引入前实现上生成的 golden 比对。环境变量的值一律使用占位值 `VS-SECRET-9c1e`，断言其不出现在 stdout、stderr、验收报告与历史文件中。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-157 | 环境要求结构非法 | §2.106.4 | 夹具 VS；`verify.requirements` 依次为：`env` 不是数组、`checks` 中 `name` 重复、`name` 含空格 | `verify --format json` | 三种情形均门禁 FAIL，`gate.reason="verify_requirements_invalid"`，诊断指出字段；`RAN` 不存在 |
| UT-S13-158 | 验收标准条目未写入配置 | §2.106.5 第 2 步、EX-13.1 | 夹具 VS-prop；验收标准「自动验收环境要求」为 `` `command:vs-fake-tool` `` 与 `` `check:vs-ready` ``；配置只声明了 `commands: ["vs-fake-tool"]` | `verify --format json` | 门禁 FAIL，`gate.reason="acceptance_requirement_undeclared"`，`data.requirements.missing_declarations` 恰为 `["check:vs-ready"]`；`RAN` 不存在；验收报告写明缺失条目 |
| UT-S13-159 | 不适用时不对账 | §2.106.5 第 2 步 | 夹具 VS（无活跃提案）；夹具 VS-prop 三个变体：验收标准字段为「无」、缺「验收标准」段、条目全部已声明 | 各执行 `verify --format json` | 均不产生 `acceptance_requirement_undeclared`；`RAN` 存在（进入预跑） |
| UT-S13-160 | 环境变量缺失或为空 | §2.106.5 第 3 步、EX-13.2 | 夹具 VS-req，`vs-fake-tool` 与 `vs-ready` 可用；`VS_TOKEN` 依次为未设置、空串、`VS-SECRET-9c1e` | `verify --format json` | 前两种门禁 FAIL，`gate.reason="verify_env_not_ready"`，`missing_environment` 含 `{kind:"env", name:"VS_TOKEN"}`，`RAN` 不存在；第三种进入预跑；任何输出与报告中都不出现 `VS-SECRET-9c1e` |
| UT-S13-161 | 命令不在 PATH | §2.106.5 第 3 步、EX-13.2 | 夹具 VS-req，`VS_TOKEN` 已设置，临时 bin 目录不在 `PATH` | `verify --format json` | 门禁 FAIL，`missing_environment` 含 `{kind:"command", name:"vs-fake-tool"}`；`RAN` 不存在；把 bin 目录加入 `PATH` 后进入预跑 |
| UT-S13-162 | 检查命令非零退出或超时 | §2.106.5 第 3 步、EX-13.3 | 夹具 VS-req，其余要求满足；`check.mjs` 依次为：输出一行占位值后以 3 退出；挂起不退出（以可注入的检查时限缩短为 1 秒） | `verify --format json` | 两种情形均 `verify_env_not_ready`；`detail` 分别为退出码 3 与「超时」，不含检查命令的输出；超时情形下检查进程组已被终止（进程不残留）；`RAN` 不存在 |
| UT-S13-163 | 按模块确定生效要求：模块级同名 check 只替换本模块 | §2.106.4 生效集合第 2 条 | 夹具 VS-mod：项目级 check `dup` 恒失败；`verify.modules.backend.requirements` 含同名 check `dup`（恒成功）与 `commands: ["vs-backend-only"]` | ① 本次范围只含 `core`；② 本次范围只含 `backend`，`vs-backend-only` 不可用；③ 同 ② 但 `vs-backend-only` 可用 | ① core 使用项目级 `dup`，报 `verify_env_not_ready`（缺 `check dup`，归属 `["core"]`），不检查 `vs-backend-only`，`RAN` 不存在；② backend 的 `dup` 按模块级判定为满足，报缺 `command vs-backend-only`，`RAN` 不存在；③ 预检通过，`RAN` 存在 |
| UT-S13-164 | 预检全部通过后照常执行 | §2.106.5 | 夹具 VS-req，全部要求满足，runner 全部写 pass | `verify --format json` | `RAN` 存在；门禁 PASS；`data.requirements.declared` 与配置一致，`missing_declarations`、`missing_environment` 为空 |
| UT-S13-165 | 严格集合内的非平台 skip 判用例分层错误 | §2.106.6 第 4 条、EX-13.4 | 夹具 VS-prop；runner 对 UT-S01-90 写无原因的 skip，其余 pass | `verify --format json` | 门禁 FAIL，`gate.reason="case_tier_mismatch"`，`tier_mismatch_cases` 恰含 UT-S01-90 与 fix_hint「准备好环境并声明到 verify.requirements，或改标 `[manual]`」；`reason_code` 为 `"env-missing"` 等其他值时同样判定 |
| UT-S13-166 | 平台跳过放行与 detail 为空不放行 | §2.106.6 第 2、4 条、EX-13.5 | 夹具 VS-prop；UT-S01-90 依次写：`reason_code:"platform-unavailable"` + `detail:"requires win32"`；同 `reason_code` + `detail:""`；同 `reason_code` 缺 `detail` | `verify --format json` | 第一种门禁 PASS，`platform_skipped_cases=[{id:"UT-S01-90", detail:"requires win32"}]`，验收报告单独列出；后两种按 UT-S13-165 判 `case_tier_mismatch` |
| UT-S13-167 | 存量与无活跃提案只警告 | §2.106.6 第 5 条、EX-13.8 | ① 夹具 VS-prop，存量 UT-S01-02 写无原因 skip，UT-S01-90 pass；② 夹具 VS（无活跃提案），UT-S01-02 写无原因 skip | `verify --format json` | 两种情形门禁 PASS、退出码 0、`gate.reason` 为空；`warnings` 含 `unclassified_skipped_cases` 并列出 UT-S01-02；`skipped_count`、通过率与引入前 golden 一致 |
| UT-S13-168 | 门禁原因优先级 | §2.106.7 | 夹具 VS-prop 组合：① 对账失败且环境也缺失；② 预跑非零退出 + UT-S01-90 无原因 skip、无失败用例；③ 预跑成功 + 一条失败用例 + UT-S01-90 无原因 skip；④ 预跑成功 + UT-S01-90 无原因 skip + 另有未覆盖用例 | `verify --format json` | ① `acceptance_requirement_undeclared`（不再预检，`missing_environment` 缺省）；② `case_tier_mismatch`；③ `failed_cases`，`tier_mismatch_cases` 照常输出；④ `case_tier_mismatch`，`uncovered_cases` 照常输出 |
| UT-S13-169 | 未声明任何要求的零变化 | §2.106.10、EX-13.9 | 夹具 VS（无 `verify.requirements`、无活跃提案、无 skip）与 VS-prop（验收标准为「无」、严格集合内无 skip） | `verify --format json` 与文本模式 | `gate`、计数、诊断与退出码与引入前 golden 逐项一致；`data.requirements` 缺省；没有新增诊断码 |
| UT-S13-170 | 验收报告与 JSON 展示 | §2.106.5、§2.106.6 | 依次复用 UT-S13-158、UT-S13-160、UT-S13-166 第一种、UT-S13-167 ① 的场景 | 读取 `acceptance-report.md` 与 JSON | 报告分别含「验收标准条目未写入配置」「环境未就绪」（逐项列出名称、不含变量值）、「平台跳过」（ID 与 detail）、「未分类跳过（警告）」小节；JSON 字段名与功能规格一致；验收历史记录的门禁结论与报告一致 |
| UT-S13-171 | ST-S13-26 适用条件单一判定 | §2.106.4、§2.106.10、EX-13.6 | 判定以可注入的平台、uid、复用能力与 `cc` 可用性调用；复用能力缺省取 `detectLivenessCapability()` | 枚举：非 Linux；Linux root；Linux 非 root 复用不可用（含设置 `OPENLOGOS_SANDBOX_TEST_NO_LIVENESS=1`）；Linux 非 root 复用可用。另以同样注入执行本仓 `linux-nondump-cc` 检查命令，`cc` 分别可用与不可用 | 只有「Linux、非 root、复用可用」判为适用；ST-S13-26 的跳过条件与检查命令调用同一判定（源码中只有一处实现）；检查命令在不适用时退出 0，在适用时退出码 = `cc` 是否可用；不适用时 ST-S13-26 写 `platform-unavailable` 与说明条件的 `detail` |
| UT-S13-172 | 分类判据进入规范与 Skill | §2.106.2 | 读取 `spec/test-results.md`、`skills/test-writer/SKILL.md` 及 sync 后的 `logos/skills/test-writer/SKILL.md` | 检查「`[manual]` 标记用例」与 3c | 均包含换版本判据（换一个待验版本、移除上一版本的结果与人工证据），以「每个版本都要人重新准备的证据」归入人工的例子，以及「本节只约束 UT/ST、SMOKE 由后续需求交付」的说明；不再以「CI 无头环境能否稳定运行」作为唯一判断标准 |
| UT-S13-173 | reporter 写平台跳过原因 | `spec/test-results.md`「平台跳过原因的 reporter 写法」 | 本仓 `cli/test/openlogos-reporter.ts`；夹具测试文件以登记入口声明一条平台跳过、一条普通跳过 | 运行夹具测试并读取写出的结果行；另在非 Windows 上运行本仓 ST-S08-45、ST-S09-219、ST-S19-35、ST-S19-36、ST-S19-37 | 平台跳过行带 `reason_code:"platform-unavailable"` 与非空 `detail`；普通跳过行不带 `reason_code`；本仓五条 Windows 用例在非 Windows 上写平台跳过行，`detail` 写明 `requires win32` |
| UT-S13-174 | 模块验收报告不残留旧 PASS | §2.106.7A、`spec/test-results.md`「模块验收报告」第 4、5 条、EX-13.10 | 双模块夹具：`core`（launched）与 `a`、`b` 两个 initial 模块各声明非空 `paths`；`a`、`b` 已有 PASS 模块验收报告与 PASS 结果账本；活跃提案按 VS-prop 方式建立真实变更集，在 `a` 的测试规格 `a-S02-test-cases.md` 中新增 UT-S02-90（前置断言变更集包含它） | ① 声明项目级 `env: ["VS_TOKEN"]` 且不设置，执行 `verify --all --format json`；② 设置 `VS_TOKEN`，runner 对 UT-S02-90 写无原因 skip、其余 pass，再执行；每次之后以 `launch` 使用的模块验收报告判定函数检查 `a`、`b` | ① 共用门禁 `verify_env_not_ready`；`a`、`b` 的模块报告都被整份改写为 FAIL（「模块」行正确，计数「未执行」，正文写明预检原因），判定函数对两者都判未完成；旧账本字节未变且未被读入统计；② 共用门禁 `case_tier_mismatch`；`a` 的报告 FAIL、`b` 的报告 PASS；判定函数对 `a` 判未完成 |
| UT-S13-175 | 检查命令经沙箱执行器在测试同一环境执行；无隔离时只读并如实标注 | §2.106.4 执行环境、EX-13.13 | 夹具 VS-req 设 `verify.sandbox_mode: "always"`（平台不支持隔离时按既有规则改用注入的隔离能力替身）；宿主工作区有 `deps/ready` 标记而沙箱工作副本中没有（按既有沙箱同步规则排除）；隔离臂的 `check.mjs` 检查 `deps/ready` 是否存在，并在当前目录写写入探针 `check-wrote.txt`；降级臂改用只读的 `check-ro.mjs`（只检查 `deps/ready`，不写任何文件）。以可注入的预检钩子在**检查命令执行前后**、verify 写任何报告与启动 runner **之前**各取一次源工作区快照（文件清单与内容） | ① 隔离可用时执行 `verify --format json`；② 让隔离能力不可用，`sandbox_mode` 为 `always`；③ 同 ② 但 `sandbox_mode` 为 `auto`，使用只读检查 | 三臂中检查前后两次快照一致，源工作区始终不存在 `check-wrote.txt`。① 检查在沙箱工作副本中执行并失败，`verify_env_not_ready` 缺 `check vs-ready`，`data.requirements.isolation="sandboxed"`；共用验收报告写明预检原因；`RAN` 不存在；② 以既有沙箱诊断判 FAIL，检查与预跑都未执行，`RAN` 不存在；③ 按既有降级规则在源工作区执行只读检查（宿主有 `deps/ready`，检查通过），`isolation="unisolated"`，验收报告含「本次检查未隔离」；`RAN` 存在，结果账本含本轮 runner 写出的结果。verify 结束后的报告、账本与历史文件属于预期输出，单独断言其内容，不纳入检查前后的快照比对 |
| UT-S13-176 | 多模块合并：同名同命令合并、同名异命令分别执行 | §2.106.4 生效集合第 3 条、EX-13.12 | 夹具 VS-mod 变体：模块 `a`、`b` 使用同一命令组（`verify.modules` 中三个命令字段相同）；① 两模块都声明 `db-ready` 且命令相同（计数器记录执行次数）；② 两模块的 `db-ready` 命令不同，分别检查 `a`、`b` 的数据库，`a` 的数据库不可用 | 本次范围同时含 `a`、`b`，执行 `verify --format json` | ① `db-ready` 只执行一次，注入的 `OPENLOGOS_VERIFY_MODULES` 为 `a,b`，预检通过；② 两条 `db-ready` 各执行一次（注入的归属模块分别为 `a`、`b`），报 `verify_env_not_ready`，缺失项恰为 `{kind:"check", name:"db-ready", modules:["a"]}`；`RAN` 不存在 |
| UT-S13-177 | 预检失败的验收历史 `result_source: "none"` 与快照落点 | §2.104.3（修改）、§2.106.5、`spec/test-results.md`「结果来源」、EX-13.11 | ① 夹具 VS-req（无活跃提案），先成功跑一次 verify 留下 PASS 账本，再取消 `VS_TOKEN`；② 夹具 VS-prop（`raw_in_proposal` 缺省为 `true`），从未生成过结果文件，验收标准条目 `command:vs-fake-tool` 未写入配置；③ 同 ②，但 `verify.history.raw_in_proposal: false` | 各执行 `verify --format json`，再执行 `history show <run_id> --format json` 与 `history list --format json` | 三种情形的中央索引均为 `outcome:"completed"`、`result_source:"none"`、`gate.result:"FAIL"`、`gate.reason` 为对应原因，`counts` 各项为 null、三个 ID 数组为空；① `raw_location:"none"`，不写任何提案或本机记录，`history show` 注明本次没有完整记录；结果账本与 verify 前逐字节相同；② 提案完整记录只有 `record.json` 与 `report.md`（快照指出预检原因），没有 `results.jsonl`；③ 提案完整记录只有结构化 `record.json`，`report.md` 在本机原文目录，两处都没有 `results.jsonl` / `results-raw.jsonl`；`history list` 正常列出三条记录 |
| UT-S13-178 | 实际执行的命令组只用于选择模块级要求；无预跑命令时项目级要求仍预检 | §2.106.4 生效集合第 2、4 条、EX-13.15 | ① 夹具 VS-mod 变体：模块 `a`、`b` 都声明非空 `paths`；项目级未配置任何预跑命令；`verify.modules.a` 有命令组（记录型 runner 写 `RAN`）；`verify.modules.b` 只有 `requirements.commands: ["b-tool"]`，本机没有 `b-tool`。② 单模块夹具 VS：未配置任何预跑命令，结果账本是一份原本足以通过的 PASS 账本；项目级 `verify.requirements` 显式声明 `env: ["DB_URL"]`、`commands: ["vs-fake-tool"]`（可用）、`checks: [{name: "db-ready", command: "node -e 0"}]`（结构合法、恒成功、不依赖数据库），只缺 `DB_URL` | 各执行 `verify --all --format json` / `verify --format json` | ① 既有命令组选择只返回服务 `a` 的命令组；不检查 `b-tool`，不报 `verify_env_not_ready`；`RAN` 存在。② 预检照常执行，门禁 FAIL，`gate.reason="verify_env_not_ready"`，缺失项恰为 `{kind:"env", name:"DB_URL"}`；旧账本未被读取（历史 `result_source:"none"`，计数为 null），不产生 PASS |
| UT-S13-179 | 已合并提案的测试变更集无效时不得放行 | §2.106.6 第 3 条、§2.106.7 第 1A 条、EX-13.14 | 夹具 VS-prop 经正常 merge 建立变更集（前置断言读取有效、含 UT-S01-90）；随后三个变体：① 改坏 `SPEC_MERGED.test_change_set.sha256`；② 删除 `test_change_set` 字段；③ 不改（对照）。runner 对 UT-S01-90 写无原因 skip、其余 pass；另设对照 ④：从尚未 merge 的基线启动（活跃提案没有 `SPEC_MERGED`，测试规格中还没有 UT-S01-90），runner 只对已定义的存量 UT-S01-02 写无原因 skip，其余基线用例 pass，不产生 UT-S01-90 的结果行 | 各执行普通最终 `verify --format json` | ①② 门禁 FAIL，`gate.reason="test_change_set_invalid"`，`detail` 分别带读取器原因码（摘要不符、change set 缺失），不产生 `VERIFY_PASS`；③ `case_tier_mismatch`；④ 严格集合为空；门禁 PASS；`warnings` 含 `unclassified_skipped_cases` 且恰好点名 UT-S01-02；不出现 `unknown_test_result_id` |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-40 | 此前未声明要求的项目新增依赖后从正常入口生效 | Step 1～6、EX-13.1、EX-13.2 | 真实 CLI（构建后的 `dist/index.js`）；夹具 VS-prop，配置此前没有 `verify.requirements`；验收标准写 `` `command:vs-fake-tool` `` | ① 不改配置执行 `verify --format json`；② 按提案把 `commands: ["vs-fake-tool"]` 写入配置，`PATH` 不含该命令，再执行；③ 把临时 bin 目录加入 `PATH` 再执行 | ① `acceptance_requirement_undeclared`，`RAN` 不存在；② `verify_env_not_ready` 缺 `command vs-fake-tool`，`RAN` 不存在；③ `RAN` 存在，门禁 PASS；三次退出码与 `gate.result` 一致 |
| ST-S13-41 | 人工用例不被测试入口启动 | Step 6、EX-13.7 | 真实 CLI；夹具 VS 的测试规格新增 `ST-S01-02 [manual]`；项目 runner 由真实测试框架执行，ST-S01-02 的测试文件被启动时写哨兵文件；默认入口按 `spec/test-results.md` 在调度前排除该文件 | 执行普通最终 `verify --format json` | verify 完成，UT-S01-01 等自动用例有结果；哨兵文件不存在；结果账本不含 ST-S01-02；`manual_count=1` |
| ST-S13-42 | 本次改动用例的跳过分类端到端 | Step 7～11、EX-13.4、EX-13.5 | 真实 CLI；夹具 VS-prop（经正常 merge 建立真实变更集；启动 verify 前断言 `readTestChangeSet` 读到的集合包含 UT-S01-90、不含 UT-S01-02） | ① runner 对 UT-S01-90 写无原因 skip 执行 verify；② 改写为平台跳过（`requires win32`）再执行 | ① 退出码 1，`gate.reason="case_tier_mismatch"`，验收报告列出 UT-S01-90 与修复提示；② 退出码 0，门禁 PASS，验收报告「平台跳过」小节列出 UT-S01-90 与 `requires win32` |
| ST-S13-43 | 本仓 `check:linux-nondump-cc` 的完整路径 | Step 2～5、EX-13.6 | 本仓 `logos/logos.config.json`（本提案 `[code]` 写入后）；当前机器 | 读取本仓配置中的 `verify.requirements.checks`；执行其中 `linux-nondump-cc` 的检查命令；在一次性夹具中复制该 check 与本提案验收标准的同一条目，执行 `verify --format json` | 配置含名为 `linux-nondump-cc` 的 check；检查命令在当前机器的退出码 = （适用判定为真 ? `cc` 是否可用 : 0）；夹具中对账通过，预检结论与该退出码一致 |

### 覆盖度校验

- 结构校验与对账：UT-S13-157、UT-S13-158、UT-S13-159、ST-S13-40。
- 环境预检（变量、命令、检查、超时、只写变量名）：UT-S13-160、UT-S13-161、UT-S13-162、UT-S13-164、ST-S13-40。
- 按模块确定生效要求与多模块合并（模块级要求只对实际执行的命令组服务的模块；无预跑命令时项目级要求仍预检）：UT-S13-163、UT-S13-176、UT-S13-178。
- 检查命令的执行环境（沙箱执行器、隔离时不改写源工作区、无隔离时只读并标注）：UT-S13-175。
- 模块验收报告不残留旧 PASS：UT-S13-174。
- 预检失败的验收历史与快照落点：UT-S13-177。
- 已合并提案的测试变更集无效：UT-S13-179。
- 跳过分类（用例分层错误、平台跳过、存量警告；严格集合取自经正式读取器校验的变更集）：UT-S13-165、UT-S13-166、UT-S13-167、ST-S13-42。
- 门禁原因优先级：UT-S13-168。
- 零变化：UT-S13-169。
- 报告与 JSON：UT-S13-170。
- 适用平台缺前置工具与平台不适用的区分：UT-S13-171、ST-S13-43。
- 分类判据进入规范与 Skill：UT-S13-172。
- reporter 平台跳过与本仓既有平台用例：UT-S13-173。
- 人工用例不被测试入口启动：ST-S13-41。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S13"`，测试名含用例 ID；失败不得写 pass。
- 「预跑未执行」一律以项目外标记文件 `RAN` 是否存在判定，不以命令输出自述代替。
- 占位值 `VS-SECRET-9c1e` 对 stdout、stderr、验收报告、验收历史中央索引与提案运行目录逐文件全文搜索。
- 超时用例以可注入的检查时限缩短等待，不依赖真实 60 秒；结束时断言检查进程组已不存在。
- 所有临时目录在用例结束时删除；用例不读写本仓活跃提案与本机全局安装。

## S13 失败用例复跑与偶发判定测试（verify-flaky-rerun）

> 覆盖场景 `core-S13-verify-results.md`「S13 失败用例复跑与偶发判定」（Step 1～14、EX-13.16～EX-13.27），功能规格 §2.108.2～§2.108.11、§2.104.3（修改），`spec/test-results.md`「失败用例复跑与偶发（verify-flaky-rerun）」，`spec/cli-json-output.md`「verify 失败用例复跑与偶发（verify-flaky-rerun）」；需求 AC-VERIFY-RERUN-01～11、13。
>
> **夹具 RR**：`mktemp -d` 一次性 git 项目，单模块 `core`（launched），已合并测试规格定义 UT-S01-01、UT-S01-02、UT-S01-03；`verify.pre_run_command` 指向记录型 runner `rr-runner.mjs`：
> - 每次被执行时，在项目外临时目录追加一行调用记录（第几次调用、收到的 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 与 `OPENLOGOS_VERIFY_RERUN`、当前工作目录）；
> - 启动时清空结果文件（与「清空策略」一致）；
> - 按夹具内的剧本文件决定每条用例在第 1 次、第 2 次调用时写 pass / fail / skip 或不写；有 fail 时以非零状态退出，剧本可覆盖某次调用的退出码；
> - 每条记录缺省写毫秒精度的 ISO `timestamp`；剧本可令某次调用不写 `timestamp`，或写固定的秒级值（两次调用写同一值即构成同刻）；剧本可令某次调用在末尾追加一行非法 JSON；
> - 收到 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 时只写集合内用例；变体 **RR-wide** 忽略该变量，每次都写全部用例。
>
> 其他变体：
> - **RR-rollback**：有失败时把结果文件回滚为上一份全部通过的结果，再以非零状态退出（EX-9.1 形态）。
> - **RR-two**：配置 `regression_command` 与 `incremental_command`，两段各写一部分用例。
> - **RR-two-shared**：同 RR-two，但不配置阶段结果路径，两段共用 `result_path`；剧本允许同一 ID 在两段各写一次。
> - **RR-mod**：多模块（`core`、`backend`，各自声明非空 `paths`），`verify.modules.backend` 有独立命令组。
> - **RR-slice**：有效切片 manifest 与活跃提案，处于 slice-checkpoint 验收。
>
> 「不复跑时与现状一致」类断言以同一夹具在引入前实现上生成的 golden 比对（新增的 `rerun` 字段除外）。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-180 | 首跑失败、复跑通过记为偶发 | §2.108.6、§2.108.8、AC-VERIFY-RERUN-01 | 夹具 RR；剧本：UT-S01-01 第 1 次 fail、第 2 次 pass，其余 pass | `verify --format json` | runner 被调用 2 次，第 2 次收到 `ELIGIBLE_TEST_IDS=["UT-S01-01"]` 与 `RERUN=1`；`gate.result="PASS"`；`flaky_cases` 仅含 UT-S01-01 且 `first_error` 为首跑的错误；`failed_cases` 为空；`warnings` 含 `flaky_cases_present`；退出码 0 |
| UT-S13-181 | 复跑仍失败照常 FAIL | §2.108.6、AC-VERIFY-RERUN-02 | 夹具 RR；UT-S01-01 两次都 fail | `verify --format json` | `gate.result="FAIL"`、`gate.reason="failed_cases"`；`failed_cases` 含 UT-S01-01；无 `flaky_cases`；无 `flaky_cases_present` |
| UT-S13-182 | 部分偶发、部分失败 | §2.108.6、AC-VERIFY-RERUN-03 | 夹具 RR；UT-S01-01 第 2 次 pass，UT-S01-02 两次都 fail | `verify --format json` | FAIL `failed_cases`；`flaky_cases` 仅含 UT-S01-01，`failed_cases` 仅含 UT-S01-02；`rerun.requested_ids` 为两者 |
| UT-S13-183 | 复跑没有新记录时维持失败 | §2.108.6、EX-13.17、AC-VERIFY-RERUN-04 | 夹具 RR；UT-S01-01 第 1 次 fail、第 2 次不写 | `verify --format json` | FAIL `failed_cases`；UT-S01-01 的 `error` 为首跑的；诊断说明复跑未产生通过结果 |
| UT-S13-184 | 复跑记录为 skip 时维持失败 | §2.108.6、EX-13.17 | 夹具 RR；UT-S01-01 第 2 次写 skip（带平台跳过原因） | `verify --format json` | FAIL `failed_cases`；UT-S01-01 不进入 `platform_skipped_cases`，不进入 `flaky_cases` |
| UT-S13-185 | 首跑通过的用例不因复跑丢失 | §2.108.6、EX-13.20、AC-VERIFY-RERUN-05 | 夹具 RR（runner 每次启动清空结果文件）；UT-S01-01 第 2 次 pass | `verify --format json`，随后读取 `result_path` | 三条用例都有结果；无未覆盖；`result_path` 含三条用例的最终记录，UT-S01-02、UT-S01-03 为首跑记录 |
| UT-S13-186 | 复跑写入集合之外的记录不采信（复跑非零退出） | §2.108.6、§2.108.7、EX-13.19、EX-13.21 | 夹具 RR-wide；UT-S01-01 第 2 次 pass，UT-S01-02 第 1 次 pass、第 2 次 fail（两次调用都因有 fail 而非零退出） | `verify --format json` | `flaky_cases` 仅含 UT-S01-01；UT-S01-02 计为通过、不在 `failed_cases`（`failed_cases` 为空）；`rerun.commands[0].rerun_exit_code` 非零、`status_after="fail"`；`gate.result="FAIL"`、`gate.reason="pre_run_failed"`；诊断提示测试入口未按集合收窄 |
| UT-S13-187 | 超过上限不复跑 | §2.108.3、EX-13.16、AC-VERIFY-RERUN-06 | 夹具 RR；`rerun_failed.max_cases: 1`；首跑两条 fail | `verify --format json` | runner 只被调用 1 次；FAIL `failed_cases`；`rerun.attempted=false`、`skipped_reason="too_many_failures"`，`requested_ids` 含两条 |
| UT-S13-188 | 上限边界 | §2.108.3 | 夹具 RR；`max_cases: 2`；首跑恰好两条 fail，复跑都 pass | `verify --format json` | 复跑执行；`gate.result="PASS"`；`flaky_cases` 含两条 |
| UT-S13-189 | 关闭后与引入前一致 | §2.108.2、EX-13.24、AC-VERIFY-RERUN-07 | 夹具 RR；`rerun_failed.enabled: false`；UT-S01-01 首跑 fail | `verify --format json` | runner 只被调用 1 次；`skipped_reason="disabled"`；除 `rerun` 外，输出与引入前 golden 一致，退出码一致 |
| UT-S13-190 | 配置缺省与非法取值 | §2.108.2、EX-13.24 | 夹具 RR；依次为：不写 `rerun_failed`、`max_cases: 0`、`enabled: "yes"`、`rerun_failed: []` | `verify --format json` | 不写时 `rerun.max_cases=10` 且复跑生效；三种非法情形都按缺省值处理，`warnings` 含 `rerun_config_invalid` 并指出字段，门禁结论不因警告改变 |
| UT-S13-191 | 首跑无失败时不复跑 | §2.108.3、AC-VERIFY-RERUN-11 | 夹具 RR；全部 pass | `verify --format json` | runner 只被调用 1 次；`rerun.attempted=false`、`skipped_reason="no_failed_cases"`、`requested_ids=[]`、`commands=[]`；除 `rerun` 外与 golden 一致 |
| UT-S13-192 | 测试入口回滚账本时不复跑 | §2.108.3、EX-13.18、AC-VERIFY-RERUN-08 | 夹具 RR-rollback；首跑有失败 | `verify --format json` | runner 只被调用 1 次；`gate.reason="pre_run_failed"`；`skipped_reason="no_failed_cases"` |
| UT-S13-193 | 环境预检失败时不复跑 | §2.108.3、EX-13.25、AC-VERIFY-RERUN-08 | 夹具 RR；声明 `verify.requirements.env: ["RR_TOKEN"]` 且未设置 | `verify --format json` | runner 未被调用；`gate.reason="verify_env_not_ready"`；响应含 `rerun`，`attempted=false`、`skipped_reason="precheck_failed"` |
| UT-S13-194 | 未执行预跑命令时不复跑 | §2.108.3、EX-13.25 | 夹具 RR 去掉 `pre_run_command`，结果文件预置一条 fail | `verify --format json` | FAIL `failed_cases`；`skipped_reason="no_command"` |
| UT-S13-195 | 测试变更集无效时不复跑 | §2.108.3、EX-13.25 | 夹具 RR 加活跃提案与无效的 `SPEC_MERGED.test_change_set`；首跑有失败 | `verify --format json` | runner 只被调用 1 次；`gate.reason="test_change_set_invalid"`；`skipped_reason="gate_blocked"` |
| UT-S13-196 | 命令组改判成立 | §2.108.7、§2.108.8 | 夹具 RR；UT-S01-01 第 2 次 pass，复跑命令零退出 | `verify --format json` | `pre_run.commands[0].status="fail"` 且 `exit_code` 为首跑退出码（不改写）；`rerun.commands[0]` 的 `first_exit_code` 非零、`rerun_exit_code=0`、`status_after="pass"`；`gate.result="PASS"` |
| UT-S13-197 | 复跑命令非零退出时不改判 | §2.108.7、EX-13.19 | 夹具 RR；剧本让第 2 次调用写 UT-S01-01 pass 后仍以非零状态退出 | `verify --format json` | `flaky_cases` 含 UT-S01-01；`rerun.commands[0].status_after="fail"`；`gate.result="FAIL"`、`gate.reason="pre_run_failed"` |
| UT-S13-198 | 改判不掩盖未覆盖 | §2.108.7 残余风险 | 夹具 RR；首跑 UT-S01-01 fail、UT-S01-03 没有记录；复跑 UT-S01-01 pass | `verify --format json` | `gate.result="FAIL"`，原因为未覆盖（`incomplete_coverage`）；`flaky_cases` 含 UT-S01-01 |
| UT-S13-199 | 同一沙箱内复跑 | §2.108.5 | 夹具 RR，`sandbox_mode: always` | `verify --format json` | 两次调用记录的工作目录相同；沙箱诊断显示只创建一次副本 |
| UT-S13-200 | 沙箱关闭时原地复跑 | §2.108.5 | 夹具 RR，`sandbox_mode: off`；UT-S01-01 第 2 次 pass | `verify --format json` | 两次调用的工作目录都是项目根；`gate.result="PASS"` |
| UT-S13-201 | 复跑结束后恢复环境变量 | §2.108.5 | 进程内调用 verify；调用前设置 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS=x`、未设置 `OPENLOGOS_VERIFY_RERUN` | 首跑有失败并复跑后返回 | 两个变量恢复为调用前的状态 |
| UT-S13-202 | 两阶段命令按阶段复跑 | §2.108.5、EX-13.23 | 夹具 RR-two；失败用例只来自 incremental 阶段，复跑通过 | `verify --format json` | 只有 incremental 命令被再执行一次；`rerun.commands` 仅一项、`stage="incremental"`；regression 阶段的用例结果不变 |
| UT-S13-203 | 模块范围下只复跑相关命令组 | §2.108.4、§2.108.5、EX-13.22、AC-VERIFY-RERUN-10 | 夹具 RR-mod；失败用例只属于 `backend`，复跑通过 | 启用模块范围执行 `verify --format json` | 只有 `backend` 命令组被再执行；复跑时 `OPENLOGOS_VERIFY_MODULES` 与首跑相同；`rerun.commands[0].modules=["backend"]`；`flaky_cases[0].module="backend"` |
| UT-S13-204 | 切片 checkpoint 下与 eligible 求交 | §2.108.4、EX-13.22、AC-VERIFY-RERUN-10 | 夹具 RR-slice；首跑 eligible 内一条 fail，复跑通过 | `verify --format json` | `requested_ids` 是 eligible 的子集；复跑时 `OPENLOGOS_VERIFY_SLICE_SCOPE` 与首跑相同；checkpoint 通过并记录该切片 |
| UT-S13-205 | 验收报告的偶发用例小节 | §2.108.9 | 夹具 RR；UT-S01-01 第 2 次 pass | `verify`，读取 `acceptance-report.md` | 报告含「偶发用例」小节，列出 UT-S01-01、模块与首跑错误摘要及提示语；不含命令输出；无偶发时不出现该小节 |
| UT-S13-206 | 验收历史记录偶发 | §2.104.3、§2.108.9、AC-VERIFY-RERUN-09 | 夹具 RR；UT-S01-01 第 2 次 pass | `verify`，随后 `history show <run_id> --format json` | 记录 `flaky_ids=["UT-S01-01"]`；`failed_ids` 为空；`counts.failed=0`、`counts.passed=3` |
| UT-S13-207 | 历史读取兼容 | §2.104.3 | 预置三份历史记录：缺 `flaky_ids`；`flaky_ids: []`；`flaky_ids: "x"` | `history list --format json` | 前两份正常读出，缺字段的按空数组；第三份按损坏记录跳过并给出警告 |
| UT-S13-208 | 文本模式输出偶发清单 | §2.108.9 | 夹具 RR；UT-S01-01 第 2 次 pass | `verify`（文本模式，zh 与 en 各一次） | 门禁结论之后输出偶发用例清单与提示语；两种语言都有对应文案 |
| UT-S13-209 | `VERIFY_PASS` 照常写入 | §2.108.8 | 夹具 RR 加活跃提案；UT-S01-01 第 2 次 pass，其余判据满足 | final `verify` | 写入 `VERIFY_PASS`；报告与 JSON 带偶发清单 |
| UT-S13-210 | 首跑账本的非法行不被复跑抹掉 | §2.108.5、§2.108.6、EX-13.26、AC-VERIFY-RERUN-13 | 夹具 RR 加活跃提案；UT-S01-01 第 1 次 fail、第 2 次 pass，其余首跑 pass；剧本令第 1 次调用末尾追加一行非法 JSON；第 2 次调用清空结果文件、只写 UT-S01-01 并以 0 退出 | final `verify --format json`，随后读取 `result_path` 与 `acceptance-report.md` | `flaky_cases` 含 UT-S01-01，`failed_cases` 为空、无未覆盖；`rerun.commands[0].status_after="pass"`；`gate.result="FAIL"`、`gate.reason="result_ledger_inconsistent"`；`consistency` 含首跑非法行的原因；报告保留该原因；不写 `VERIFY_PASS`；`result_path` 按原文保留该非法行 |
| UT-S13-211 | 复跑记录不写 timestamp 时照常采信 | §2.108.5、§2.108.6、AC-VERIFY-RERUN-01 | 夹具 RR；剧本令两次调用都不写 `timestamp`；UT-S01-01 第 1 次 fail、第 2 次 pass | `verify --format json` | `gate.result="PASS"`；`flaky_cases` 含 UT-S01-01；`failed_cases` 为空 |
| UT-S13-212 | 复跑记录与首跑同刻时照常采信 | §2.108.5、§2.108.6、AC-VERIFY-RERUN-01 | 夹具 RR；剧本令两次调用对 UT-S01-01 写同一个秒级 `timestamp`；第 1 次 fail、第 2 次 pass | `verify --format json` | `gate.result="PASS"`；`flaky_cases` 含 UT-S01-01。另以第 2 次不写 UT-S01-01（同刻配置不变）复测：UT-S01-01 维持失败，FAIL `failed_cases`（AC-VERIFY-RERUN-04） |
| UT-S13-213 | 集合外记录不采信且复跑零退出时放行 | §2.108.6、§2.108.7、EX-13.21 | 夹具 RR-wide；UT-S01-01 第 2 次 pass，UT-S01-02 第 1 次 pass、第 2 次 fail；剧本把第 2 次调用的退出码覆盖为 0 | `verify --format json` | `flaky_cases` 仅含 UT-S01-01；UT-S01-02 计为通过、不在 `failed_cases`；`rerun.commands[0].rerun_exit_code=0`、`status_after="pass"`；`gate.result="PASS"`；诊断提示测试入口未按集合收窄 |
| UT-S13-214 | 同一 ID 跨阶段时只在生效来源复跑一次 | §2.108.5、§2.108.6、EX-13.23、AC-VERIFY-RERUN-10 | 夹具 RR-two-shared；UT-S01-01 在 regression 首跑 pass、在 incremental 首跑 fail（生效记录为后者）；incremental 复跑写 UT-S01-01 pass | `verify --format json`；读取调用记录 | regression 命令只被调用 1 次，incremental 命令被调用 2 次，复跑时收到 `["UT-S01-01"]`；`rerun.commands` 仅一项、`stage="incremental"`；`flaky_cases` 含 UT-S01-01。另以 incremental 复跑不写 UT-S01-01 复测：regression 仍只被调用 1 次，UT-S01-01 维持失败，不进入 `flaky_cases`，FAIL `failed_cases` |
| UT-S13-215 | 一次性沙箱副本保留到复跑结束 | §2.108.5 | 夹具 RR，`sandbox_mode: always`、`sandbox_reuse: false`；UT-S01-01 第 2 次 pass | `verify --format json` | 两次调用记录的工作目录相同；`gate.result="PASS"`；verify 返回后该一次性副本目录已删除 |
| UT-S13-216 | 首跑执行环境不可用时不复跑 | §2.108.3、§2.108.5、EX-13.27、AC-VERIFY-RERUN-08 | 进程内调用 verify，夹具 RR，`sandbox_mode: always`；UT-S01-01 首跑 fail；以测试替身在首跑结束、复跑开始前删除首跑副本目录 | `verify --format json`；读取调用记录 | runner 只被调用 1 次（没有第二次调用，也没有在新副本或工作区中调用）；无 `flaky_cases`；`rerun.attempted=false`、`skipped_reason="sandbox_unavailable"`；`rerun.commands` 仍有一项，`rerun.commands[0].rerun_exit_code=null`、`skipped_reason="sandbox_unavailable"`、`status_after="fail"`（首跑非零退出）；FAIL `failed_cases`，UT-S01-01 的 `error` 为首跑的。另以首跑零退出的变体复测（剧本把第 1 次调用的退出码覆盖为 0，并在末尾追加一行非法 JSON，UT-S01-01 仍写 fail）：runner 只被调用 1 次；`rerun.commands[0].status_after="pass"`（取首跑状态，不强制为 fail）；UT-S01-01 维持失败、不进入 `flaky_cases`；`gate.result="FAIL"`、`gate.reason="result_ledger_inconsistent"` |

### 场景测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| ST-S13-44 | 偶发失败不再打断验收 | Step 1～14、AC-VERIFY-RERUN-01、05、09 | 真实 CLI（构建后的 `dist/index.js`）；夹具 RR，`sandbox_mode: always`；UT-S01-01 第 1 次 fail、第 2 次 pass | ① `verify --format json`；② 读取 `result_path` 与 `acceptance-report.md`；③ `history list --format json` | ① 退出码 0，`gate.result="PASS"`，`flaky_cases` 含 UT-S01-01，`warnings` 含 `flaky_cases_present`；② 三条用例都有最终记录，报告含「偶发用例」小节；③ 最新记录 `flaky_ids=["UT-S01-01"]` |
| ST-S13-45 | 真失败不被复跑放过 | Step 1～14、AC-VERIFY-RERUN-02、03 | 真实 CLI；夹具 RR；UT-S01-01 第 2 次 pass，UT-S01-02 两次都 fail | `verify --format json` | 退出码非 0；FAIL `failed_cases`；`failed_cases` 只含 UT-S01-02，`flaky_cases` 只含 UT-S01-01；报告同时列出失败与偶发 |
| ST-S13-46 | 关闭复跑后回到引入前行为 | EX-13.24、AC-VERIFY-RERUN-07、11 | 真实 CLI；夹具 RR；`rerun_failed.enabled: false` | ① 首跑有失败时 `verify --format json`；② 全部通过时 `verify --format json` | ① runner 只被调用 1 次，FAIL `failed_cases`；② PASS；两次输出除 `rerun` 外与引入前 golden 一致 |
| ST-S13-47 | 大面积失败不复跑 | EX-13.16、AC-VERIFY-RERUN-06 | 真实 CLI；夹具 RR 扩为 12 条用例，首跑 11 条 fail；`max_cases` 缺省 | `verify --format json` | runner 只被调用 1 次；FAIL `failed_cases`；`skipped_reason="too_many_failures"` |

### 覆盖度校验

- 偶发判定与合并：UT-S13-180～UT-S13-186、UT-S13-210～UT-S13-213、ST-S13-44、ST-S13-45。
- 触发条件与配置：UT-S13-187～UT-S13-195、ST-S13-46、ST-S13-47。
- 命令组状态与门禁：UT-S13-196～UT-S13-198、UT-S13-209。
- 执行环境与变量：UT-S13-199～UT-S13-201、UT-S13-215、UT-S13-216。
- 两阶段、模块范围、切片：UT-S13-202～UT-S13-204、UT-S13-214。
- 输出与历史：UT-S13-205～UT-S13-208。
- 异常 EX-13.16～EX-13.27 各至少一条：EX-13.16（187、ST-47）、EX-13.17（183、184）、EX-13.18（192）、EX-13.19（186、197）、EX-13.20（185）、EX-13.21（186、213）、EX-13.22（203、204）、EX-13.23（202、214）、EX-13.24（189、190、ST-46）、EX-13.25（193～195）、EX-13.26（210）、EX-13.27（216）。
- 需求 AC-VERIFY-RERUN-01～11、13 均有对应用例；AC-VERIFY-RERUN-12 由安装态 smoke 覆盖。

### 自动化与证据要求

- 全部用例由 `cli/test` 下的自动化测试实现，结果经 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。
- 不需要人参与；不需要额外的环境要求；无平台限定用例。
- 夹具 runner 的「第几次调用」以项目外临时目录中的调用记录计数，不依赖时间或随机。
- 断言「runner 被调用几次」「复跑收到的变量」一律读调用记录，不从 CLI 输出推断。

## S13 分层验收与发布级验收测试（layered-verification）

> 覆盖场景 `core-S13-verify-results.md`「S13 分层验收：提案级三层集合」（Step 1～18、EX-13.28～EX-13.41、EX-13.54、EX-13.55）与「S13 发布级全量验收」（Step 1～17、EX-13.42～EX-13.53、EX-13.56），功能规格 §2.109.1～§2.109.15、§2.104.3（修改），`spec/test-results.md`「分层验收（layered-verification）」，`spec/cli-json-output.md`「verify 分层验收与发布级验收（layered-verification）」；需求 AC-VERIFY-TIER-01～04、06～12、14～20。
>
> **夹具 LV**：`mktemp -d` 一次性 git 项目，单模块 `core`（launched）。已合并测试规格：
> - `core-S01-test-cases.md`：UT-S01-01、UT-S01-02、UT-S01-03；
> - `core-S02-test-cases.md`：UT-S02-01、UT-S02-02；
> - `core-S03-test-cases.md`：UT-S03-01、UT-S03-02，含主链路小节，列出 UT-S03-01；
> - `core-S04-test-cases.md`：UT-S04-01 `[manual]`、UT-S04-02。
>
> 初始提交之后建立活跃提案 `lv-demo`（guard 带 `baseRef`）：`deltas/test/core-S01-test-cases.md` 新增 UT-S01-04 并经正常 merge 写入 `SPEC_MERGED`（本提案用例 C = {UT-S01-04}，delta 触及场景 S01）；`proposal.md` 的「受影响场景」段按用例设置，缺省为 `assessment: assessed`、`shared_change: false`、`scenarios: [S02]`。`verify.layered.enabled: true`。
>
> `verify.pre_run_command` 指向记录型入口 `lv-runner.mjs`：
> - 每次被执行时在项目外临时目录追加一行调用记录（第几次调用、收到的 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS`、`OPENLOGOS_VERIFY_SLICE_SCOPE`、`OPENLOGOS_VERIFY_MODULES`、`OPENLOGOS_VERIFY_RERUN`、**实际执行的用例 ID**、当前工作目录）；
> - 启动时清空结果文件；收到清单时只执行、只上报清单内的用例，否则执行全部不带 `[manual]` 的用例；
> - 按剧本文件决定每条用例第 n 次调用时写 pass / fail / skip（可带平台原因）；有 fail 时非零退出，剧本可覆盖某次调用的退出码。
>
> 缺省情况下 P = {UT-S01-01、02、03、04、UT-S02-01、02、UT-S03-01}，UT-S03-02 与 UT-S04-02 在 P 之外。
>
> 变体：
> - **LV-wide**：入口忽略清单，执行并上报全部用例。
> - **LV-quiet**：入口执行全部用例，但只上报清单内的用例。
> - **LV-mod**：多模块（`core`、`backend`、`web`，各自声明非空 `paths`，`verify.modules` 各有命令组，各命令组的入口分别记录调用）；测试规格 `core-S01`、`core-S03`（含主链路小节）、`backend-S05`、`backend-S06`、`web-S07`。
> - **LV-rel**：夹具 LV 去掉活跃提案，全部内容已提交、工作区干净；用于发布级验收。入口剧本可在执行期间运行 git 命令（新建提交、留下未提交文件）。
>
> 「与引入前一致」类断言以同一夹具在引入前实现上生成的 golden 比对（新增的 `level` 字段除外）。断言「入口被调用几次」「收到的清单」「实际执行了哪些用例」一律读调用记录，不从 CLI 输出推断。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-217 | 分层配置的缺省与非法取值 | §2.109.2、EX-13.41 | 夹具 LV；依次为：不写 `layered`、`layered: []`、`enabled: "yes"`、`main_path_max: 0`、`shared_paths: "x"` | `verify --format json` | 不写时未开启且无警告；其余各情形非法项按缺省值处理，`warnings` 含 `layered_config_invalid` 并指出字段；`enabled` 非法时按未开启处理；门禁结论不因警告改变 |
| UT-S13-218 | 未开启时与引入前一致 | §2.109.15、EX-13.28、AC-VERIFY-TIER-11 | 夹具 LV 设 `enabled: false`（文档中仍有主链路小节，提案仍有受影响场景段） | `verify --format json`，读取报告 | 入口未收到分层清单、执行全部自动化用例；`data.level="proposal"`，没有 `layers`；除 `level` 外 JSON、验收报告字节与退出码和 golden 一致 |
| UT-S13-219 | 主链路小节读取 | §2.109.3、AC-VERIFY-TIER-01 | 夹具 LV；另备文档：二级标题与三级标题各一、英文标题 `Main Path Cases`、列表项带说明文字、`*` 列表、没有小节 | 调用主链路读取 | 各文档的主链路集合符合所列 ID；说明文字不参与判定；没有小节的文档贡献为空；用例表首格没有任何主链路标记 |
| UT-S13-220 | 主链路小节的结构错误 | §2.109.3 | 测试文档分别含：未定义 ID、`[manual]` 用例、SMOKE ID、同一小节重复 ID、两个主链路小节、不以 ID 开头的列表项 | 调用主链路读取 | 依次给出 `undefined_id`、`manual_case`、`not_ut_st`、`duplicate_id`、`duplicate_section`、`item_without_id`，各带文档路径与 ID |
| UT-S13-221 | 三层合集与去重 | §2.109.6、AC-VERIFY-TIER-06 | 夹具 LV；另把 UT-S01-01 也列入 `core-S01` 的主链路小节 | `verify --format json` | `layers.total` 的 ID 恰为 P 的 7 条，无重复、字典序；`layers.changed.ids=["UT-S01-04"]`；`layers.affected.scenarios` 含 S01（来源含 `delta`）与 S02（来源 `declared`）；`layers.main_path.ids` 含 UT-S01-01、UT-S03-01；`layers.expansion.level="none"` |
| UT-S13-222 | 清单交给测试入口，集合外用例不计未覆盖 | §2.109.8、AC-VERIFY-TIER-06 | 夹具 LV；全部 pass | `verify --format json` | 入口收到的 `ELIGIBLE_TEST_IDS` 等于 P；未收到 `SLICE_SCOPE`；实际执行的用例恰为 P；`summary.defined_count=7`；UT-S03-02、UT-S04-02 不在 `uncovered_cases`；`gate.result="PASS"`；调用结束后进程环境中两个变量恢复原状 |
| UT-S13-223 | delta 触及的场景自动并入 | §2.109.5、EX-13.34、AC-VERIFY-TIER-07 | 夹具 LV；声明改为 `scenarios: []` | `verify --format json` | `layers.affected.scenarios` 仅 S01，来源 `delta`；P 含 S01 的全部自动化用例；不含 S02 的用例 |
| UT-S13-224 | 人工用例不进入受影响用例 | §2.109.5 | 夹具 LV；声明 `scenarios: [S04]` | `verify --format json` | 受影响用例含 UT-S04-02，不含 UT-S04-01 |
| UT-S13-225 | 共享路径改动扩大到全量 | §2.109.7、§2.96.3.1、EX-13.32、AC-VERIFY-TIER-08 | 夹具 LV；依次为：修改根 `package.json`、修改子目录 `tools/package-lock.json`、修改 `logos/logos.config.json` 的 `verify`（把 `verify.layered.main_path_max` 由缺省改为 40，分层仍开启） | `verify --format json` | 三种情形 `layers.expansion.level="full"`，原因 `shared_path_changed` 并列出命中的文件，第三种的 `detail` 为 `logos/logos.config.json（verify）`；入口执行全部自动化用例；`summary.defined_count` 为全量。只改 `description` 时保持收窄见 UT-S13-288 |
| UT-S13-226 | 声明涉及共享改动扩大到全量 | §2.109.7、EX-13.32、AC-VERIFY-TIER-08 | 夹具 LV；声明 `shared_change: true` | `verify --format json` | `level="full"`，原因 `shared_change_declared` |
| UT-S13-227 | 自定义共享路径替换缺省清单 | §2.109.2、§2.96.3.1 | 夹具 LV，各臂的 `shared_paths` 配置在建立提案之前提交；① `shared_paths: ["shared/**"]` 并修改 `shared/util.ts`；② 同配置下修改根 `package.json`；③ `shared_paths: []` 并修改 `logos/logos-project.yaml` 的 `modules`（模块的 `name`）；④ `shared_paths: []` 并只在 `logos/logos-project.yaml` 末尾追加注释 | `verify --format json` | ① 扩大到全量；② 不因 `package.json` 扩大；③ 仍扩大到全量，`detail` 为 `logos/logos-project.yaml（modules）`（共享验收配置的字段判断不依赖 `shared_paths`）；④ 不扩大（解析后的取值没有变化） |
| UT-S13-228 | 声明缺失退回按模块 | §2.109.7、EX-13.30、AC-VERIFY-TIER-09 | 夹具 LV；删除「受影响场景」段 | `verify --format json` | 原因含 `declaration_missing` 与 `module_scope_unavailable`；`level="full"`（单模块）；不报错，门禁按全量判定 |
| UT-S13-229 | 声明非法或未填写 | §2.109.4、§2.109.7、EX-13.30 | 夹具 LV；依次为：`assessment: pending`、YAML 损坏、`scenarios` 项缺 `reason`、编号重复、`shared_change: "no"` | `verify --format json` | 各情形原因 `declaration_invalid`，`layers.declaration.status="invalid"` 并给出明细；范围扩大 |
| UT-S13-230 | 无法评估 | §2.109.7、EX-13.30 | 夹具 LV；`assessment: unknown` | `verify --format json` | 原因 `assessment_unknown`；范围扩大 |
| UT-S13-231 | 声明了不存在的场景 | §2.109.7、EX-13.31 | 夹具 LV；`scenarios: [S02, S99]` | `verify --format json` | 原因 `scenario_unknown` 并点名 S99；范围扩大，不以 S02 缩小范围 |
| UT-S13-232 | 提案起点不可用 | §2.109.7、EX-13.33 | 夹具 LV；依次为：guard 去掉 `baseRef`、`baseRef` 改为不存在的提交、删除 `.git` | `verify --format json` | 三种情形 `level="full"`，原因 `base_ref_unavailable` 并附具体情形 |
| UT-S13-233 | 没有活跃提案按全量 | §2.109.7、EX-13.29、AC-VERIFY-TIER-12 | 夹具 LV 删除 guard | `verify --format json` | `level="full"`，原因 `no_active_change`；主链路约束照常检查 |
| UT-S13-234 | 只扩大不缩小 | §2.109.7、AC-VERIFY-TIER-10 | 夹具 LV；全部 pass；依次取 UT-S13-225～233 的各扩大情形 | `verify --format json` | 每种情形的验收集合都是未扩大时 P 的超集；`gate.result` 与未扩大时相同（PASS）。多模块下真正按模块扩大的超集关系由 UT-S13-271 断言 |
| UT-S13-235 | 提案尚未合并时本提案用例为空 | §2.109.6、EX-13.40 | 夹具 LV；删除 `SPEC_MERGED` 与已合并的 UT-S01-04 行 | `verify --format json` | `layers.changed.ids=[]`；受影响与主链路两层照常；不报 `test_change_set_invalid` |
| UT-S13-236 | 按模块级扩大 | §2.109.7、EX-13.39 | 夹具 LV-mod；提案只改动 `backend/**`；删除「受影响场景」段 | `verify --format json` | `level="module"`，原因 `declaration_missing`；受影响用例为 `backend` 模块的全部自动化用例；P 另含本提案用例与主链路用例（主链路在 `core-S03`） |
| UT-S13-237 | 与模块范围并存时的命令组 | §2.109.8、EX-13.39 | 夹具 LV-mod；① 未扩大，P 只含 `backend` 的用例与 `core-S03` 的主链路用例；② 同 UT-S13-236 | `verify --format json` | ① 执行 `backend` 与 `core` 两个命令组，各自收到的清单为 P，`web` 未被执行；② 执行范围 M 的 `backend` 命令组与主链路所属的 `core` 命令组，`web` 未被执行；每条命令的 `OPENLOGOS_VERIFY_MODULES` 正确；`data.scope` 照旧输出 |
| UT-S13-238 | 主链路超过上限在执行前判 FAIL | §2.109.10、EX-13.35、AC-VERIFY-TIER-02 | 夹具 LV；`main_path_max: 1`；主链路列 2 条 | `verify --format json`，读取报告与历史 | 入口未被调用；`gate.reason="main_path_over_limit"`；`layers.main_path` 给出 `limit=1`、`count=2`；报告计数显示「未执行」并写明原因；历史 `result_source="none"` |
| UT-S13-239 | 主链路小节结构错误在执行前判 FAIL | §2.109.10、EX-13.36、AC-VERIFY-TIER-03 | 夹具 LV；主链路小节列未定义 ID；另一情形同时超过上限 | `verify --format json` | 入口未被调用；`gate.reason="main_path_invalid"`，`layers.main_path.problems` 逐条给出文档、ID 与代码；同时超限时仍取 `main_path_invalid` |
| UT-S13-240 | 执行前判 FAIL 时变更集无效优先 | §2.109.10 | 夹具 LV；主链路超限；把 `SPEC_MERGED.test_change_set` 改为无效 | `verify --format json` | 入口未被调用；`gate.reason="test_change_set_invalid"`；`layers.main_path` 仍列出超限 |
| UT-S13-241 | 主链路用例不得靠复跑通过 | §2.109.10、EX-13.37、AC-VERIFY-TIER-04 | 夹具 LV；剧本：UT-S03-01 第 1 次 fail、第 2 次 pass | `verify --format json` | 入口被调用 2 次；`gate.result="FAIL"`、`gate.reason="main_path_flaky"`；UT-S03-01 在 `flaky_cases` 与 `layers.main_path.flaky_ids` 中；不写 `VERIFY_PASS`；无 `flaky_cases_present` 警告 |
| UT-S13-242 | 非主链路偶发与未开启时的主链路偶发照常放行 | §2.109.10、§2.108 | ① 夹具 LV，UT-S02-01 第 1 次 fail、第 2 次 pass；② `enabled: false`，UT-S03-01 第 1 次 fail、第 2 次 pass | `verify --format json` | ① PASS，带 `flaky_cases_present`；② PASS，带 `flaky_cases_present`，无 `main_path_flaky` |
| UT-S13-243 | 分层下的原因优先级 | §2.109.10 | 夹具 LV；依次构造：主链路偶发且另有用例失败；主链路偶发且预跑命令非零退出；主链路偶发且账本有非法行 | `verify --format json` | 三种情形 `gate.reason` 都是 `main_path_flaky`；去掉主链路偶发后分别回到 `failed_cases`、`pre_run_failed`、`result_ledger_inconsistent` |
| UT-S13-244 | 测试入口未收窄且因集合外失败而非零退出 | §2.109.8、EX-13.38、AC-VERIFY-TIER-20 | 夹具 LV-wide；P 之外的 UT-S03-02 写 fail，入口因此非零退出；P 内全部 pass | `verify --format json` | 入口执行了全部用例；UT-S03-02 的结果不采信，`failed_cases` 为空；`layers.outside_result_count=2`；`warnings` 含 `layered_runner_not_narrowed`；`consistency.ok=true`，无 `result_outside_eligible_scope`；没有集合内失败可供复跑（`rerun.skipped_reason="no_failed_cases"`），命令组状态不改判；`gate.result="FAIL"`、`gate.reason="pre_run_failed"` |
| UT-S13-245 | 入口未收窄但未上报时不告警 | §2.109.8、EX-13.38 | 夹具 LV-quiet | `verify --format json` | 调用记录显示执行了全部用例；`outside_result_count=0`；没有 `layered_runner_not_narrowed`；门禁按 P 判定 |
| UT-S13-246 | 失败复跑的范围在 P 之内 | §2.109.8、§2.108.4 | 夹具 LV-wide；UT-S02-01 与 P 之外的 UT-S03-02 首跑都 fail，复跑都 pass | `verify --format json` | `rerun.requested_ids=["UT-S02-01"]`；`flaky_cases` 仅 UT-S02-01 |
| UT-S13-247 | 提案级报告的级别与验收范围小节 | §2.109.13、AC-VERIFY-TIER-19 | 夹具 LV；全部 pass | `verify`，读取 `acceptance-report.md` | Summary 有「级别 / Level」行，取值为提案级（分层）；「验收范围」小节列出三层各自的用例数、受影响场景与来源、合计、扩大级别与原因、集合外结果行数，并注明提案级通过不等于可以发布；不含命令输出 |
| UT-S13-248 | 文本模式标明级别 | §2.109.13 | 夹具 LV；zh 与 en 各一次；另一次用 LV-rel 执行 `--release` | 文本模式运行 | 提案级输出含级别与「提案级通过不等于可以发布」的提示（两种语言各有文案）；发布级输出含级别、提交号与平台 |
| UT-S13-249 | JSON 的 `level` 与 `layers` 结构 | §2.109.14 | 夹具 LV；未扩大与扩大到全量各一次 | `verify --format json`，以 `spec/schema/verify.schema.json` 校验 | 两次输出都通过 schema 校验；`layers` 含 `changed`、`affected`、`main_path`、`total`、`declaration`、`expansion`、`outside_result_count`；扩大到全量时 `expansion.reasons` 非空 |
| UT-S13-250 | 历史记录的 `level`、`platform` 与读取兼容 | §2.104.3 | 夹具 LV 运行一次；另预置四份记录：缺 `level` 与 `platform`、`level: "release"`、`level: "x"`、`platform: 1` | `history list --format json` | 新记录 `level="proposal"`、`platform` 为 `<platform>-<arch>`；缺字段的记录读出 `level="proposal"`、`platform=null`；后两份按损坏记录跳过并警告 |
| UT-S13-251 | `history list` 按级别与提交筛选 | §2.109.14 | 预置同一提交的提案级与发布级记录各一，另一提交的发布级记录一条 | `history list --level release --format json`；加 `--commit <前缀>` | 前者只含发布级两条；后者只含该提交的一条；`--level` 取值非法时报用法错误 |
| UT-S13-252 | 发布级：不是 git 仓库时拒绝 | §2.109.11、EX-13.43、AC-VERIFY-TIER-15 | 夹具 LV-rel 删除 `.git`；另一情形为刚 `git init`、尚无提交 | `verify --release --format json` | 两种情形 `RELEASE_VERIFY_NOT_GIT`，退出码 2；入口未被调用；结果文件未被截断；不写历史 |
| UT-S13-253 | 发布级：工作区不干净时拒绝 | §2.109.11、EX-13.42、AC-VERIFY-TIER-15 | 夹具 LV-rel；依次为：修改已跟踪文件、新增未跟踪文件、只改动 `logos/resources/verify/` 下的文件 | `verify --release --format json` | 前两种 `RELEASE_VERIFY_DIRTY`，`details.paths` 列出该文件，入口未被调用；第三种不算不干净，照常执行 |
| UT-S13-254 | 发布级：没有测试命令时拒绝，旧结果不能充当证据 | §2.109.11、EX-13.44、AC-VERIFY-TIER-15 | 夹具 LV-rel 去掉 `pre_run_command` 并提交；`result_path` 预置全部 pass 的完整结果 | ① `verify --release --format json`；② `verify --release --check --format json` | ① `RELEASE_VERIFY_NO_COMMAND`，退出码 2，结果文件未被读取或改动，不写历史；② `valid=false`、`reason="no_conclusive_run"`，退出码 1 |
| UT-S13-255 | 发布级恒为全量 | §2.109.11、EX-13.46、EX-13.47、AC-VERIFY-TIER-14 | 依次为：LV-rel 开启分层；LV-mod 全部提交且干净；LV 的活跃提案全部提交且干净（处于 slice-checkpoint） | `verify --release --format json` | 三种情形入口都未收到 `ELIGIBLE_TEST_IDS` 与 `SLICE_SCOPE`，执行全部自动化用例（多模块时全部命令组）；`data.level="release"`；没有 `layers`、`verify_mode`、`scope`；不检查主链路约束（主链路超限时仍照常执行） |
| UT-S13-256 | 发布级不触碰提案标记与提案级报告 | §2.109.11、EX-13.46 | 夹具 LV 全部提交且干净；提案目录已有 `VERIFY_PASS`、`SLICE_CHECKPOINTS.jsonl`、`LOOP_ITERS`，已有提案级 `acceptance-report.md`；发布级运行一次 PASS、一次 FAIL | `verify --release` | 两次运行前后，提案目录全部文件与提案级验收报告的字节不变；没有新增 `verify-runs/` 记录；不写 `VERIFY_FAIL` |
| UT-S13-257 | 发布级报告与 JSON | §2.109.13、§2.109.14、AC-VERIFY-TIER-19 | 夹具 LV-rel；一条用例 fail | `verify --release --format json`，读取 `logos/resources/verify/release/acceptance-report.md` | 报告 Summary 含级别为发布级（全量）、完整提交号、平台；列出失败用例；`data.release` 含 `commit`、`platform`、`commit_unchanged=true`；`report_path` 为发布级报告路径；退出码 1 |
| UT-S13-258 | 发布级的历史记录 | §2.104.3、§2.109.14 | 夹具 LV-rel；全部 pass | `verify --release --format json`，读取中央索引 | 记录 `level="release"`、`commit.head` 为运行前的 HEAD、`commit.dirty=false`、`platform` 正确、`proposal=null`、`raw_location="none"`、`verify_mode=null`、`result_source="executed"` |
| UT-S13-259 | 提交身份在执行前固定 | §2.109.11、EX-13.45、AC-VERIFY-TIER-16 | 夹具 LV-rel（沙箱关闭）；HEAD 为提交 A；入口剧本在执行期间新建提交 B；全部用例 pass | ① `verify --release --format json`；② `verify --release --check --commit B`；③ `--check --commit A` | ① `gate.result="FAIL"`、`gate.reason="release_commit_changed"`；历史 `commit.head=A`；报告写明收尾时 HEAD 为 B；② `valid=false`，不命中这次运行；③ `valid=false`、`reason="latest_failed"` |
| UT-S13-260 | 收尾时工作区不干净 | §2.109.11、EX-13.45 | 夹具 LV-rel（沙箱关闭）；入口剧本在执行期间留下一个未跟踪的源码文件 | `verify --release --format json` | `gate.reason="release_commit_changed"`；`data.release.commit_unchanged=true`、`worktree_clean=false` |
| UT-S13-261 | 查询以最近一次结论为准 | §2.109.12、EX-13.48、AC-VERIFY-TIER-17 | 夹具 LV-rel；同一提交依次运行：① PASS 后 FAIL；② 另一项目 FAIL 后 PASS | 每组之后 `verify --release --check --format json` | ① `valid=false`、`reason="latest_failed"`，退出码 1，`latest.run_id` 为后一次；② `valid=true`、`reason=null`，退出码 0 |
| UT-S13-262 | 环境预检未通过的运行不是结论 | §2.109.12、EX-13.49、AC-VERIFY-TIER-17 | 夹具 LV-rel 声明 `verify.requirements.env: ["LV_TOKEN"]`；① 设置变量运行 PASS，再不设置变量运行；② 新项目只在不设置变量时运行 | 每组之后 `--release --check` | ① 第二次运行 `verify_env_not_ready`、历史 `result_source="none"`；查询仍 `valid=true`；② `valid=false`、`reason="no_conclusive_run"` |
| UT-S13-263 | 提交变了即作废；其他平台的结论不算 | §2.109.12、EX-13.50、AC-VERIFY-TIER-18 | 夹具 LV-rel；① 提交 A 上 PASS 后新建提交 B；② 预置一条提交相同、`platform` 不同的 PASS 记录；③ 没有任何发布级记录 | `--release --check --format json` | ① `valid=false`、`reason="other_commit_only"`；② `reason="other_platform_only"`；③ `reason="no_conclusive_run"`；退出码都是 1；三种情形都不执行入口、不写任何文件 |
| UT-S13-264 | `--check` 指定提交 | §2.109.12、EX-13.51 | 承 UT-S13-263 ①；工作区另有未提交改动 | `--release --check --commit A`；`--commit <A 的缩写>`；`--commit 不存在的值` | 前两者 `valid=true`、`commit` 为 A 的完整提交号，退出码 0（不要求工作区干净）；第三者 `RELEASE_CHECK_COMMIT_INVALID`，退出码 2 |
| UT-S13-265 | 发布级报告与 `release` 模块的验收报告互不覆盖 | §2.109.13、EX-13.53 | 多模块项目含 initial 模块 `release`，其模块验收报告 `release-acceptance-report.md` 已为 PASS；全部提交且干净 | 依次 `verify --release`、`verify`、`verify --release` | 两个文件始终各自存在；模块验收报告的「模块」行与 Gate 行不被发布级运行改动；`isModuleReportComplete` 对 `release` 模块的判定不受发布级运行影响 |
| UT-S13-266 | 结果路径落在发布级报告路径上 | §2.109.13、EX-13.52 | `verify.result_path` 配置为 `logos/resources/verify/release/acceptance-report.md` | `verify --format json` | 按既有保留路径规则改写到默认结果路径，`pre_run.diagnostics` 给出提示；发布级报告路径不被写入结果内容 |
| UT-S13-267 | 发布级沿用失败复跑 | §2.109.11、§2.108 | 夹具 LV-rel；一条用例第 1 次 fail、第 2 次 pass（该用例在主链路中） | `verify --release --format json` | `gate.result="PASS"`，带 `flaky_cases_present`；历史 `flaky_ids` 含该用例；不出现 `main_path_flaky`；随后 `--check` 返回 `valid=true` |
| UT-S13-269 | 集合外失败行被忽略且入口零退出时放行 | §2.109.8、EX-13.38 | 夹具 LV-wide；P 之外的 UT-S03-02 写 fail；剧本把入口退出码覆盖为 0；P 内全部 pass | `verify --format json` | `failed_cases` 为空；`outside_result_count=2`，警告 `layered_runner_not_narrowed`；`pre_run.commands[0].status="pass"`；`gate.result="PASS"`。与 UT-S13-244 只差退出码，结论相反 |
| UT-S13-270 | 共享标志独立于评估状态被采信 | §2.109.4、§2.109.7、EX-13.32、AC-VERIFY-TIER-08 | 夹具 LV-mod；提案只改动 `backend/**`；声明依次为：`assessment: unknown` 加 `shared_change: true`；`assessment: pending` 加 `shared_change: true`；`scenarios` 含不存在的 S99 加 `shared_change: true` | `verify --format json` | 三种情形 `layers.expansion.level="full"`，原因含 `shared_change_declared`；`core`、`backend`、`web` 三个命令组都被执行；验收集合为全量（不停在 `backend` 模块） |
| UT-S13-271 | 按模块扩大时保留已识别场景与 delta 触及场景 | §2.109.7、EX-13.30、EX-13.31、AC-VERIFY-TIER-10 | 夹具 LV-mod；提案只改动 `backend/**`，delta 触及 `backend-S05`；主链路在 `core-S03`。① 基准：声明 `scenarios: [S07]`（`web` 模块）；② 声明 `scenarios: [S07, S99]`；③ 声明 `assessment: unknown`、`scenarios: [S07]` | 三种声明各执行 `verify --format json` | ① `level="none"`，集合含 `web-S07` 的用例；② `level="module"`、原因 `scenario_unknown`；③ `level="module"`、原因 `assessment_unknown`；②③ 的 `layers.total.ids` 都是 ① 的超集：含 `backend` 模块全部自动化用例、`web-S07` 的用例、主链路用例与本提案用例；②③ 都执行了 `web` 命令组；`layers.affected.scenarios` 仍列出 S07（`declared`）与 S05（`delta`） |
| UT-S13-272 | 环境预检针对本次实际执行的命令组 | §2.109.8、EX-13.55 | 夹具 LV-mod；范围 M 只有 `backend`（声明缺失，按模块扩大），主链路在 `core-S03`；`verify.modules.core.requirements.env: ["LV_CORE_TOKEN"]`，`verify.modules.web.requirements.env: ["LV_WEB_TOKEN"]`，两个变量都未设置 | ① `verify --format json`；② 只设置 `LV_CORE_TOKEN` 后再次执行 | ① `gate.reason="verify_env_not_ready"`，缺失项为 `LV_CORE_TOKEN` 且归属 `core`，不含 `LV_WEB_TOKEN`；`core`、`backend`、`web` 三个入口的调用数都是 0；② 预检通过，`backend` 与 `core` 两个命令组被执行，`web` 未被执行也未因 `LV_WEB_TOKEN` 被阻断 |
| UT-S13-273 | 发布级：无理由的跳过不能构成通过 | §2.109.11、EX-13.56、AC-VERIFY-TIER-14 | 夹具 LV-rel；入口零退出；依次为：全部自动化用例都写无原因的 skip；只有一条写无原因的 skip、其余 pass | ① `verify --release --format json`；② `verify --release --check --format json` | 两种情形 ① `gate.result="FAIL"`、`gate.reason="case_tier_mismatch"`，这些用例在 `tier_mismatch_cases` 中，没有 `unclassified_skipped_cases` 警告；② `valid=false`、`reason="latest_failed"`，退出码 1 |
| UT-S13-274 | 发布级：带平台原因的跳过被接受 | §2.109.11、EX-13.56 | 夹具 LV-rel；一条用例写 `reason_code: "platform-unavailable"` 加非空 `detail` 的 skip，其余 pass | ① `verify --release --format json`；② `--release --check` | ① `gate.result="PASS"`；该用例在 `platform_skipped_cases` 与发布级报告的平台跳过小节中；② `valid=true`，退出码 0 |
| UT-S13-268 | 发布级参数的用法检查 | §2.109.12 | 夹具 LV-rel | `verify --check`；`verify --commit <sha>`；`verify --release --commit <sha>`（无 `--check`） | 三者都是用法错误，退出码非 0，不执行入口、不写历史 |

### 场景测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| ST-S13-48 | 分层开启的提案级验收只跑该跑的部分 | 提案级 Step 1～18、AC-VERIFY-TIER-06、07、19 | 真实 CLI（构建后的 `dist/index.js`）；夹具 LV；全部 pass | ① `verify --format json`；② 读取调用记录、`result_path` 与 `acceptance-report.md`；③ `history list --format json` | ① 退出码 0，`gate.result="PASS"`，`level="proposal"`，`layers.expansion.level="none"`；② 入口只执行 P 的 7 条，UT-S03-02、UT-S04-02 未被执行；报告标明提案级与三层用例数；`VERIFY_PASS` 已写入；③ 最新记录 `level="proposal"` |
| ST-S13-49 | 评估不可用时扩大而不是放过 | 提案级 EX-13.30、EX-13.32、AC-VERIFY-TIER-08～10 | 真实 CLI；夹具 LV；P 之外的 UT-S03-02 实际会失败 | ① 缺省声明下 `verify --format json`；② 声明改为 `shared_change: true` 后再次运行 | ① PASS（UT-S03-02 不在 P 内、未执行）；② 扩大到全量，UT-S03-02 被执行并失败，`gate.reason="failed_cases"`，报告写明扩大原因 |
| ST-S13-50 | 同一提交先提案级、后发布级，两份结论并存 | 发布级 Step 1～14、EX-13.46、AC-VERIFY-TIER-14、19 | 真实 CLI；夹具 LV，提案内容全部提交且工作区干净；全部 pass | ① `verify --format json`；② `verify --release --format json`；③ 读取两份报告与提案目录 | ① 提案级 PASS，入口只执行 P；② 发布级 PASS，入口执行全部自动化用例；③ 两份报告并存、级别分别为提案级与发布级；`VERIFY_PASS` 仍在且未被改写；历史中两条记录 `level` 不同、提交号相同 |
| ST-S13-51 | 发布前查询：失败、修复、再通过 | 发布级 Step 15～17、EX-13.48、EX-13.50、AC-VERIFY-TIER-17、18 | 真实 CLI；夹具 LV-rel；提交 A 上一条用例会失败 | ① `verify --release`；② `--release --check`；③ 提交修复得到提交 B；④ `--release --check`；⑤ `verify --release`；⑥ `--release --check`；⑦ `--release --check --commit A` | ① 退出码 1；② 退出码 1，`latest_failed`；④ 退出码 1，`other_commit_only`；⑤ 退出码 0；⑥ 退出码 0，`valid=true`；⑦ 退出码 1，`latest_failed` |

### 覆盖度校验

- 配置与未开启：UT-S13-217、UT-S13-218。
- 主链路读取与约束：UT-S13-219、UT-S13-220、UT-S13-238～UT-S13-243。
- 三层集合与受影响场景：UT-S13-221～UT-S13-224、UT-S13-235、ST-S13-48。
- 扩大规则：UT-S13-225～UT-S13-234、UT-S13-236、UT-S13-270、UT-S13-271、ST-S13-49。
- 执行与核对：UT-S13-222、UT-S13-237、UT-S13-244～UT-S13-246、UT-S13-269、UT-S13-272。
- 报告、JSON、历史：UT-S13-247～UT-S13-251。
- 发布级验收：UT-S13-252～UT-S13-260、UT-S13-265～UT-S13-268、UT-S13-273、UT-S13-274、ST-S13-50。
- 发布级查询：UT-S13-261～UT-S13-264、ST-S13-51。
- 提案级异常 EX-13.28～EX-13.41 各至少一条：28（218）、29（233）、30（228～230、271）、31（231、271）、32（225、226、270）、33（232）、34（223）、35（238）、36（239）、37（241）、38（244、245、269）、39（236、237）、40（235）、41（217）、54（`core-S32-test-cases.md` 的 UT-S32-118、UT-S32-119、UT-S32-124、UT-S32-125）、55（272）。
- 发布级异常 EX-13.42～EX-13.53 各至少一条：42（253）、43（252）、44（254）、45（259、260）、46（255、256）、47（255）、48（261）、49（262）、50（263）、51（264）、52（266）、53（265）、56（273、274）。
- 需求 AC-VERIFY-TIER-01～04、06～12、14～20 均有对应用例；05、21 由 S09 / S35 的用例覆盖，13 由 S32 的用例覆盖，22 由安装态 smoke 覆盖。

### 自动化与证据要求

- 全部用例由 `cli/test` 下的自动化测试实现，结果经 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。
- 不需要人参与；不需要额外的环境要求（夹具自建一次性 git 仓库，本仓测试已依赖 git）；无平台限定用例——平台取值一律用 `process.platform` 与 `process.arch` 的关系式断言，「其他平台」用预置的历史记录构造。
- 「第几次调用」「收到的清单」「实际执行的用例」以项目外临时目录中的调用记录为准，不依赖时间或随机。
- 发布级用例中「运行期间提交变化」由夹具入口在被执行时运行 git 命令实现，不依赖并发时序。

## S13 共享验收配置按字段判断测试（verify-scope-fields-and-slice-module）

> 覆盖场景 `core-S13-verify-results.md`「S13 共享验收配置按字段判断」（Step 1～10、EX-13.57～EX-13.63）及其修改的 EX-10.3、EX-13.32，功能规格 §2.96.3、§2.96.3.1、§2.109.2、§2.109.7，`spec/cli-json-output.md` 中 `shared_config_changed` 与 `shared_path_changed` 的说明；需求 AC-VERIFY-FIELD-01～07。既有 UT-S13-109、UT-S13-225、UT-S13-227 随本变更修改。
>
> **夹具 MS**：「S13 按模块限定 verify 范围测试」的缺省多模块夹具——`mktemp -d` 一次性 git 项目，模块 `core`、`portal-web` 各自声明非空 `paths`，`verify.modules` 各有命令组，各命令组的入口在项目外临时目录记录调用；`logos/logos.config.json` 含 `verify`、`smoke`、`description`，`logos/logos-project.yaml` 含 `modules`、`resource_index`、`scenarios`、`scenario_counter`；分层验收关闭。初始提交之后建立活跃提案（guard 带 `baseRef`）。
>
> **夹具 LV、LV-mod**：同「S13 分层验收与发布级验收测试」。
>
> 「只改某字段」指相对提案起点，该文件解析后只有这一个顶层键的取值不同。每臂除说明的改动外，另有一处范围内的源码改动，保证改动文件集合非空且范围可计算。`detail` 的断言一律为精确字符串比较。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-275 | 模块范围：只改项目 YAML 的无关字段不回落 | §2.96.3.1、EX-13.57、AC-VERIFY-FIELD-01 | 夹具 MS，提案归属 `portal-web`；提案期间修改 `portal-web/app.ts`，并在 `logos/logos-project.yaml` 中新增两条 `resource_index`、一条 `scenarios`、把 `scenario_counter.next_id` 加一 | `verify --format json` | `scope.mode=="module"`、`scope.modules==["portal-web"]`、`fallback_reason` 为 null；`reasons` 中没有以 `logos/logos-project.yaml` 为依据的条目；不出现 `unmapped_file`；只执行 `portal-web` 的命令组 |
| UT-S13-276 | 模块范围：只改项目配置的无关字段不回落 | §2.96.3.1、EX-13.57、AC-VERIFY-FIELD-01 | 夹具 MS；提案期间修改 `portal-web/app.ts`，并在 `logos/logos.config.json` 中写入 `driver.review`、修改 `description`、新增 `branch_sync` | `verify --format json` | `scope.mode=="module"`、范围与不改配置时相同；不出现 `shared_config_changed` 与 `unmapped_file` |
| UT-S13-277 | 模块范围：相关字段逐个触发回落并点名 | §2.96.3.1、EX-10.3、AC-VERIFY-FIELD-02 | 夹具 MS；五臂分别只改：`logos.config.json` 的 `verify`、`smoke`、`sourceRoots`、`guard`；`logos-project.yaml` 的 `modules`（某模块的 `paths` 增加一项） | 每臂 `verify --format json` | 每臂 `scope.mode=="fallback-full"`、`fallback_reason.code=="shared_config_changed"`；`detail` 依次为 `logos/logos.config.json（verify）`、`（smoke）`、`（sourceRoots）`、`（guard）`（均带同一路径前缀）、`logos/logos-project.yaml（modules）` |
| UT-S13-278 | 多个字段与两个文件同时变化时的 `detail` | §2.96.3.1、EX-13.63 | 夹具 MS；同时修改 `logos.config.json` 的 `verify`、`smoke`、`description`，以及 `logos-project.yaml` 的 `modules`、`resource_index` | `verify --format json` | 一个回落原因；`detail` 精确为 `logos/logos.config.json（smoke、verify）、logos/logos-project.yaml（modules）`：字段按字典序、配置文件在前、同时变化的无关字段不列出 |
| UT-S13-279 | 未列出的字段按相关处理 | §2.96.3.1、EX-13.58、AC-VERIFY-FIELD-03 | 夹具 MS；四臂分别只改：`logos.config.json` 的 `documents`、`flow`、新增顶层键 `x_custom`；`logos-project.yaml` 新增顶层键 `custom_block` | 每臂 `verify --format json` | 每臂回落全量，`detail` 括号内为对应的键名 |
| UT-S13-280 | 只调整写法不算变化，数组顺序算变化 | §2.96.3.1、EX-13.59、AC-VERIFY-FIELD-04 | 夹具 MS；① 重排 `logos.config.json` 顶层键与 `verify` 内部键的顺序并改变缩进；② 在 `logos-project.yaml` 的 `modules` 段加注释、把字符串改为带引号写法、重排模块内的键；③ 对调 `modules` 两个模块的先后；④ 对调某模块 `paths` 两个元素的先后 | 每臂 `verify --format json`（每臂另改 `portal-web/app.ts` 以保证改动集合非空） | ① ② 不回落，`scope.mode=="module"`；③ ④ 回落，`detail` 为 `logos/logos-project.yaml（modules）` |
| UT-S13-281 | 字段在一侧不存在按变化处理 | §2.96.3.1 | 夹具 MS（起点的配置含 `smoke`、`description`）；① 删除 `logos.config.json` 的 `smoke`；② 删除 `description`；③ 新增此前没有的 `guard`；④ 新增此前没有的 `branch_sync` | 每臂 `verify --format json` | ① 回落，`detail` 含 `（smoke）`；② 不回落；③ 回落，`detail` 含 `（guard）`；④ 不回落 |
| UT-S13-282 | 提案起点一侧无法判断时回落 | §2.96.3.1、EX-13.60、AC-VERIFY-FIELD-05 | 夹具 MS 的变体，工作区两个文件均有效；各臂的提案起点提交中：① `logos.config.json` 是损坏的 JSON；② `logos-project.yaml` 有重复顶层键；③ `logos.config.json` 顶层是数组；④ 没有 `logos.config.json`（提案期间新增）。各臂工作区中该文件相对起点有差异 | 每臂 `verify --format json` | 每臂 `scope.mode=="fallback-full"`、`code=="shared_config_changed"`；`detail` 依次为 `logos/logos.config.json（提案起点中的内容无法解析）`、`logos/logos-project.yaml（提案起点中的内容无法解析）`、`logos/logos.config.json（提案起点中的内容顶层不是对象）`、`logos/logos.config.json（提案起点中的内容不存在）` |
| UT-S13-283 | 提案起点中的内容读取失败时回落 | §2.96.3.1、EX-13.60 | 夹具 MS；只改 `logos.config.json` 的 `description`；经 git 调用接缝使「读取 `baseRef` 中该文件内容」的命令失败，其余 git 命令正常 | 调用范围计算 | 回落全量，`detail` 为 `logos/logos.config.json（提案起点中的内容读取失败）`；不抛出未捕获异常 |
| UT-S13-284 | 工作区项目 YAML 有语法错误但恢复出模块时回落（proposal-r2 F1） | §2.96.3.1、EX-13.60、AC-VERIFY-FIELD-05 | 夹具 MS，提案起点有效、分层验收关闭；工作区 `logos-project.yaml` 中重复一个顶层 `resource_index` 键，`modules` 仍是两个声明了 `paths` 的模块 | ① 调用 `readProjectYaml`；② `verify --format json` | ① `parse_status=="recovered"` 且读出两个模块（模块范围照常启用）；② `scope.mode=="fallback-full"`、`code=="shared_config_changed"`、`detail` 为 `logos/logos-project.yaml（工作区中的内容无法解析）`；输出没有 `layers` |
| UT-S13-285 | 模块范围已启用而工作区项目配置损坏时回落 | §2.96.3.1、EX-13.60、EX-13.61、AC-VERIFY-FIELD-05、06 | 夹具 MS；先在缺省结果路径 `logos/resources/verify/test-results.jsonl` 预置与全部已定义用例匹配的合法结果（配置损坏后读不到命令组，verify 只能读取既有结果）；再把工作区 `logos.config.json` 改成损坏的 JSON（文件仍在） | 真实 CLI `verify --format json`；读各命令组的调用记录 | 没有以 `NO_TEST_RESULTS` 退出；没有任何命令组被调用；输出含 `scope`，`scope.mode=="fallback-full"`、`code=="shared_config_changed"`、`detail` 为 `logos/logos.config.json（工作区中的内容无法解析）`；输出没有 `layers` |
| UT-S13-286 | 两个范围机制都未进入比较时没有任何原因（proposal-r1 F1、delta-r1 F1） | §2.96.3.1、EX-13.61、AC-VERIFY-FIELD-06 | ① 夹具 MS，删除工作区 `logos/logos.config.json`；② 夹具 LV（单模块、分层开启）：先在缺省结果路径预置与全部已定义用例匹配的合法结果，再把工作区 `logos.config.json` 改成损坏的 JSON——单模块使模块范围未启用，配置不可读使分层按未开启；③ 夹具 MS（分层关闭）：先在缺省结果路径预置与全部已定义用例匹配的合法结果（模块范围未启用时只执行项目级命令，夹具 MS 没有项目级命令），再删除工作区 `logos/logos-project.yaml`——读不出模块使模块范围未启用 | 每臂真实 CLI `verify --format json` | ① 退出码 1，错误码 `PROJECT_NOT_INITIALIZED`，没有执行任何命令；② 输出没有 `layers`、没有 `scope`；③ 输出没有 `scope`、没有 `layers`。三臂的输出中都不出现 `shared_config_changed` 与 `shared_path_changed`（本断言只适用于这三个夹具：两个机制都未对配置文件做比较，且改动集合中没有其他会产生这两个原因的文件），与同一夹具在引入前实现上生成的 golden 一致。一个机制未启用而另一个已启用的情形见 UT-S13-285、UT-S13-290 |
| UT-S13-287 | 项目根在 git 仓库子目录时读取正确的起点内容 | §2.96.3.1 | git 仓库根下有干扰用的 `logos/logos.config.json`（含不同的 `verify`），项目位于子目录 `apps/main/`（夹具 MS 的内容）；① 只改项目的 `logos.config.json` 的 `description`；② 只改项目的 `logos.config.json` 的 `verify` | 在 `apps/main/` 下每臂 `verify --format json` | ① 不回落（没有把仓库根下的同名文件当作起点内容）；② 回落，`detail` 为 `logos/logos.config.json（verify）`（路径相对项目根） |
| UT-S13-288 | 分层：只改无关字段时保持收窄 | §2.109.7、§2.96.3.1、EX-13.57、AC-VERIFY-FIELD-07 | 夹具 LV；两臂分别只改 `logos.config.json` 的 `description`；只在 `logos-project.yaml` 新增一条 `resource_index` | 每臂 `verify --format json`，读调用记录 | `layers.expansion.level=="none"`，原因中没有 `shared_path_changed`；入口收到的清单为 P，实际只执行 P |
| UT-S13-289 | 分层：相关字段与未列出的字段扩大到全量 | §2.109.7、§2.96.3.1、EX-13.32、AC-VERIFY-FIELD-07 | 夹具 LV；三臂分别只改：`logos.config.json` 的 `smoke`；`logos.config.json` 新增顶层键 `x_custom`；`logos-project.yaml` 的 `modules`（模块 `name`） | 每臂 `verify --format json` | 每臂 `layers.expansion.level=="full"`，原因 `shared_path_changed`，`detail` 依次为 `logos/logos.config.json（smoke）`、`logos/logos.config.json（x_custom）`、`logos/logos-project.yaml（modules）`；入口执行全部自动化用例 |
| UT-S13-290 | 分层：进入比较后无法判断时扩大；配置文件未被比较时不掩盖其他原因（delta-r3 F1） | §2.109.7、§2.96.3.1、EX-13.60、EX-13.61、AC-VERIFY-FIELD-05、06 | 夹具 LV（单模块，模块范围未启用；工作区 `logos.config.json` 有效、分层开启）；① 提案起点中的 `logos.config.json` 是损坏的 JSON；② 工作区 `logos-project.yaml` 有重复顶层键；③ 删除工作区 `logos-project.yaml`；④ 夹具 LV 的变体：提案起点与工作区都没有 `logos/logos-project.yaml`，`logos.config.json` 两侧相同，提案只修改根 `package-lock.json` | 每臂 `verify --format json`，④ 另读调用记录 | 每臂输出没有 `scope`；`layers.expansion.level=="full"`，原因 `shared_path_changed`；① ② ③ 的 `detail` 依次为 `logos/logos.config.json（提案起点中的内容无法解析）`、`logos/logos-project.yaml（工作区中的内容无法解析）`、`logos/logos-project.yaml（工作区中的内容不存在）`；④ 的 `detail` 含 `package-lock.json`，不含 `logos/logos-project.yaml` 与 `logos/logos.config.json`，入口执行全部自动化用例 |
| UT-S13-291 | `shared_paths` 显式列出共享验收配置文件时按路径命中 | §2.109.2、§2.96.3.1、EX-13.62、AC-VERIFY-FIELD-07 | ① 夹具 LV，建立提案之前提交 `shared_paths: ["logos/logos.config.json"]`，提案期间只改该文件的 `description`；② 夹具 LV-mod，同样的配置与改动 | 每臂 `verify --format json` | ① ② 的 `layers.expansion.level=="full"`，`shared_path_changed` 的 `detail` 只写路径 `logos/logos.config.json`，不带括号；② 的 `scope` 不因该文件回落（按模块限定范围不读取 `shared_paths`，`description` 是无关字段） |
| UT-S13-292 | 两个范围机制对同一改动结论一致 | §2.96.3.1 | 夹具 LV-mod；① 只改 `logos.config.json` 的 `verify.modules.backend` 命令的一个参数；② 只改 `logos.config.json` 的 `driver` | 每臂 `verify --format json` | ① `scope.fallback_reason.code=="shared_config_changed"` 且 `layers.expansion` 含 `shared_path_changed`，两处 `detail` 都是 `logos/logos.config.json（verify）`；② 两处都不因该文件回落或扩大 |
| UT-S13-293 | 更早的回落条件成立时不做字段比较（delta-r2 F1） | §2.96.3、§2.96.3.1「判定顺序」、EX-13.61、AC-VERIFY-FIELD-06 | 夹具 MS；① guard 没有 `baseRef`，工作区 `logos.config.json` 相对最近提交改了 `verify`；② 没有活跃提案，同样改了 `verify`；③ guard 没有 `baseRef`，先在缺省结果路径预置与全部已定义用例匹配的合法结果，再把工作区 `logos.config.json` 改成损坏的 JSON；④ 夹具 LV（分层开启），guard 没有 `baseRef`，工作区 `logos-project.yaml` 有重复顶层键。① ② 记录 git 调用 | ① ② 调用范围计算；③ ④ 真实 CLI `verify --format json` | ① `base_ref_missing`；② `no_active_change`；两臂都没有发出「读取起点文件内容」的 git 命令；③ 输出含 `scope`，`scope.mode=="fallback-full"`、`fallback_reason.code=="base_ref_missing"`（不是 `shared_config_changed`），输出没有 `layers`；④ `layers.expansion` 的原因含 `base_ref_unavailable`，不含 `shared_path_changed`。四臂的原因中都没有 `shared_config_changed` |

### 场景测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| ST-S13-52 | 现场回放：合并规格后多模块提案的验收不再回落全量 | 「S13 共享验收配置按字段判断」Step 1～10、AC-VERIFY-FIELD-01 | 真实 CLI（构建后的 `dist/index.js`）；夹具 MS，提案归属 `portal-web`，含一个 `portal-web` 测试规格 delta；经正常 `merge` 写入 `SPEC_MERGED`，随后在 `logos-project.yaml` 的 `resource_index` 新增两条索引并提交 | ① `verify --format json`；② 读各模块命令组的调用记录 | ① 退出码 0，`scope.mode=="module"`、`scope.modules==["portal-web"]`；② 只有 `portal-web` 的命令组被执行，`core` 的没有 |
| ST-S13-53 | 现场回放：宿主写回运行偏好不回落，随后改测试命令才回落 | 同上 Step 1～10、EX-13.57、AC-VERIFY-FIELD-01、02 | 真实 CLI；夹具 MS，提案归属 `portal-web`，已改 `portal-web/app.ts` | ① 向 `logos.config.json` 写入 `driver.review` 后 `verify --format json`；② 再修改 `verify.modules.core` 命令的一个参数后重跑 | ① `scope.mode=="module"`，只执行 `portal-web` 的命令组；② `scope.mode=="fallback-full"`、`detail` 为 `logos/logos.config.json（verify）`，两个模块的命令组都执行 |
| ST-S13-54 | 分层项目：索引变化不再让提案级验收扩大到全量 | 同上、AC-VERIFY-FIELD-07 | 真实 CLI；夹具 LV；P 之外的 UT-S03-02 实际会失败；提案期间在 `logos-project.yaml` 新增 `resource_index` 与 `scenarios` 条目 | ① `verify --format json`；② 再把 `logos.config.json` 的 `smoke.command` 改掉后重跑 | ① PASS，入口只执行 P（UT-S03-02 未执行）；② 扩大到全量，UT-S03-02 被执行并失败，`gate.reason=="failed_cases"`，`layers.expansion` 的 `detail` 为 `logos/logos.config.json（smoke）` |

### 覆盖度校验

- 无关字段不回落：UT-S13-275、UT-S13-276、UT-S13-288、ST-S13-52～ST-S13-54。
- 相关字段与未列出的字段回落并点名：UT-S13-109（修改）、UT-S13-277～UT-S13-279、UT-S13-281、UT-S13-289、UT-S13-225（修改）、UT-S13-227（修改）。
- 比较口径：UT-S13-280、UT-S13-281、UT-S13-287。
- 无法判断时回落：UT-S13-282～UT-S13-285、UT-S13-290。
- 机制未启用与更早的回落条件：UT-S13-286（两个机制都未进入）、UT-S13-285（分层未开启、模块范围照常回落）、UT-S13-290（模块范围未启用、分层照常扩大）、UT-S13-293（起点不可用等既有原因先于字段比较，含工作区配置损坏的交叉情形）、UT-S13-290 ④（配置文件不在改动集合内时不掩盖依赖锁文件的扩大原因）。
- 两个机制共用同一判断与 `shared_paths`：UT-S13-291、UT-S13-292。
- 异常 EX-13.57～EX-13.63 各至少一条：57（275、276、288）、58（279、289）、59（280）、60（282～285、290）、61（285、286、290、293）、62（291）、63（278）；EX-10.3（109、277）、EX-13.32（225、289）。
- 需求 AC-VERIFY-FIELD-01～07 均有对应用例；08～10 由 `core-S32-test-cases.md` 的用例覆盖。

### 自动化与证据要求

- 全部用例由 `cli/test` 下的自动化测试实现，结果经 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。
- 不需要人参与；不需要额外的环境要求（夹具自建一次性 git 仓库，本仓测试已依赖 git）；无平台限定用例。
- 「哪些命令组被执行」「入口收到的清单」「实际执行的用例」以项目外临时目录中的调用记录为准；「是否读取了起点文件内容」以 git 调用接缝的记录为准。
- 「与引入前一致」类断言以同一夹具在引入前实现上生成的 golden 比对。
- 工作区 `logos.config.json` 损坏的用例（UT-S13-285、UT-S13-286 ②）读不到任何测试命令，UT-S13-286 ③ 在模块范围未启用后没有可执行的项目级命令，UT-S13-293 ③ 同样损坏了配置，四者都必须先在缺省结果路径预置合法结果，否则 verify 以 `NO_TEST_RESULTS` 退出、拿不到待断言的输出（delta-r1 F3）。

## S13 测试用例文档按用例变化判断 delta 触及测试（fix-delta-touched-by-case-change）

> 覆盖场景 `core-S13-verify-results.md`「S13 测试用例文档按用例变化判断 delta 触及」（Step 1～16、EX-13.64～EX-13.69）及其修改的 EX-13.34，功能规格 §2.109.5、§2.109.15，`spec/test-results.md`「三层集合与扩大」；需求 AC-VERIFY-TIER-07（修改）、AC-VERIFY-TIER-23～25。
>
> **既有用例核对结果**：UT-S13-223（delta 触及的场景自动并入）使用夹具 LV，其 `deltas/test/core-S01-test-cases.md` 新增了 UT-S01-04 并经正常 merge，属于「用例有变化」，前置与预期都不需要修改。「S13 分层验收与发布级验收测试（layered-verification）」的其余用例同样不改。
>
> **夹具 LD**：在「S13 分层验收与发布级验收测试」的夹具 LV 基础上调整，记录型入口 `lv-runner.mjs`、`verify.layered.enabled: true` 与调用记录的读法都相同。
> - 已合并测试规格（初始提交）：
>   - `core-S01-test-cases.md`：UT-S01-01、UT-S01-02、UT-S01-03，没有主链路小节；
>   - `core-S02-test-cases.md`：UT-S02-01、UT-S02-02、UT-JSON-90（编号不含场景号），没有主链路小节，另有一段「覆盖度校验」文字；
>   - `core-S03-test-cases.md`：UT-S03-01、UT-S03-02，含主链路小节，列出 UT-S03-01；
>   - `core-S04-test-cases.md`：UT-S04-01 `[manual]`、UT-S04-02。
> - 初始提交之后建立活跃提案 `ld-demo`（guard 带 `baseRef`）。各用例在提案 `deltas/` 下写入所述 delta，**经正常 merge** 写入 `SPEC_MERGED`（含测试变更集与合并基线）；写明「未合并」的用例除外。
> - `proposal.md` 的「受影响场景」段缺省为 `assessment: assessed`、`shared_change: false`、`scenarios: []`，各用例另有说明时按说明设置。
> - **声明的写法**：本节用例中的 `scenarios: [S01]` 是传给夹具函数的场景编号简写，不是写进 `proposal.md` 的字面值。夹具函数把每个编号写成含 `id` 与非空 `reason` 的对象（如 `scenarios: [{id: S01, reason: 夹具声明 S01 受波及}]`），并在写入后用 `parseAffectedDeclaration` 读回，确认状态为 `usable` 且已识别场景与传入的编号一致；读回不符时夹具直接失败，不进入待测步骤。直接写 `scenarios: [S01]` 会被判为结构非法（`scenarios[0] 必须是含 id 与 reason 的对象`），从而走扩大路径、偏离用例要验证的条件。
> - **多切片变体 LD-slices**：提案的 delta 另给 `core-S01-test-cases.md` 新增 UT-S01-04、UT-S01-05，合并后经真实 `slice plan` 把这两条分给两个切片，写出有效的 `TEST_SLICE_MANIFEST.json`（`tasks.md` 的 `[code]` 段有两个带测试 ID 的顶层切片）。
>
> **常用 delta**：
> - **D-main(SXX, ID)**：给 `core-SXX-test-cases.md` 新增「主链路用例」小节，列出该文档已定义的 ID；不改用例表。
> - **D-text(S02)**：只改写 `core-S02-test-cases.md` 的「覆盖度校验」文字；不改用例表。
>
> 断言「来源」指 `layers.affected.scenarios[].sources`。断言「场景不在受影响场景中」指 `layers.affected.scenarios` 中没有该场景的条目。「实际执行了哪些用例」读调用记录。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-294 | 只改主链路小节时该场景不并入，新列入的主链路用例在集合内 | §2.109.5、EX-13.64、AC-VERIFY-TIER-23 | 夹具 LD；delta 为 D-main(S02, UT-S02-01)；已合并；全部 pass | `verify --format json`，读取调用记录 | `SPEC_MERGED` 的 `changed_test_ids` 与 `removed_test_ids` 都为空；`layers.affected.scenarios=[]`；`layers.changed.ids=[]`；主链路层含 UT-S02-01 与 UT-S03-01；`layers.total` 的 ID 恰为 UT-S02-01、UT-S03-01；入口只执行这两条，UT-S02-02、UT-JSON-90 未被执行；`layers.expansion.level="none"`；`gate.result="PASS"`；输出通过 `spec/schema/verify.schema.json` 校验，`layers.affected` 中没有新增字段 |
| UT-S13-295 | 只改非用例文字时该场景不并入 | §2.109.5、EX-13.64、AC-VERIFY-TIER-23 | 夹具 LD；delta 为 D-text(S02)；已合并 | `verify --format json` | `layers.affected.scenarios=[]`；`layers.total` 的 ID 恰为 UT-S03-01 |
| UT-S13-296 | 新增用例时并入，新建的文档同样并入 | §2.109.5、EX-13.34、AC-VERIFY-TIER-07 | 夹具 LD；① delta 给 `core-S02-test-cases.md` 新增 UT-S02-03；② delta 新建 `core-S05-test-cases.md`，定义 UT-S05-01；各自已合并 | 各执行 `verify --format json` | ① S02 在受影响场景中，来源 `["delta"]`；`layers.total` 含 S02 的全部自动化用例（UT-S02-01、02、03、UT-JSON-90）；② S05 在受影响场景中，来源 `["delta"]` |
| UT-S13-297 | 修改用例时并入 | §2.109.5、EX-13.34、AC-VERIFY-TIER-07 | 夹具 LD；delta 修改 UT-S02-01 的预期输出文字；已合并 | `verify --format json` | S02 来源 `["delta"]`；`layers.changed.ids=["UT-S02-01"]`；`layers.total` 含 UT-S02-02 与 UT-JSON-90 |
| UT-S13-298 | 删除用例时原场景并入，编号不含场景号时同样成立 | §2.109.5、EX-13.65、AC-VERIFY-TIER-24 | 夹具 LD；① delta 从 `core-S02-test-cases.md` 删除 UT-S02-02；② delta 只从 `core-S02-test-cases.md` 删除 UT-JSON-90；各自已合并 | 各执行 `verify --format json` | ① `SPEC_MERGED` 的 `removed_test_ids=["UT-S02-02"]`；S02 来源 `["delta"]`；`layers.total` 含 UT-S02-01 与 UT-JSON-90；② `removed_test_ids=["UT-JSON-90"]`、`changed_test_ids=[]`；S02 来源 `["delta"]`；`layers.total` 含 UT-S02-01 与 UT-S02-02；两臂的受影响场景中都没有其他场景 |
| UT-S13-299 | 跨文档移动用例时移出与移入的场景都并入 | §2.109.5、EX-13.65、AC-VERIFY-TIER-24 | 夹具 LD；delta 把 UT-JSON-90 这一行从 `core-S02-test-cases.md` 原样移到 `core-S01-test-cases.md`（S02 的 delta 删除该行，S01 的 delta 新增内容相同的一行）；已合并 | `verify --format json` | `SPEC_MERGED` 的 `changed_test_ids=["UT-JSON-90"]`、`removed_test_ids=[]`；受影响场景恰为 S01 与 S02，来源都是 `["delta"]`；`layers.total` 含 UT-S02-01、UT-S02-02 与 S01 的全部自动化用例 |
| UT-S13-300 | 同一提案中各份文档互不影响 | §2.109.5、EX-13.69、AC-VERIFY-TIER-24 | 夹具 LD；delta 含两份：D-main(S02, UT-S02-01)；`core-S01-test-cases.md` 的 delta 既新增主链路小节（UT-S01-01）又修改 UT-S01-02 的预期输出文字；声明 `scenarios: [S01]`；已合并；全部 pass | `verify --format json`，读取调用记录 | `changed_test_ids=["UT-S01-02"]`；受影响场景恰为 S01，来源含 `declared` 与 `delta`；S02 不在受影响场景中；`layers.total` 的 ID 恰为 UT-S01-01、02、03、UT-S02-01、UT-S03-01；入口执行了 UT-S02-01，没有执行 UT-S02-02 与 UT-JSON-90 |
| UT-S13-301 | 场景文档的 delta 照常并入，与没改用例的测试用例文档并存时因场景文档并入 | §2.109.5、EX-13.34、EX-13.68 | 夹具 LD（另有已合并的场景文档 `core-S02-demo.md`）；① delta 只修改场景文档 `core-S02-demo.md`；② delta 同时含该场景文档的修改与 D-main(S02, UT-S02-01)；各自已合并 | 各执行 `verify --format json` | 两臂 S02 都在受影响场景中，来源 `["delta"]`；`layers.total` 含 S02 的全部自动化用例 |
| UT-S13-302 | 声明的场景不受影响 | §2.109.5、EX-13.64 | 夹具 LD；delta 为 D-main(S02, UT-S02-01)；声明 `scenarios: [S02]`；已合并 | `verify --format json` | S02 在受影响场景中，来源恰为 `["declared"]`；`layers.total` 含 S02 的全部自动化用例 |
| UT-S13-303 | 提案未合并时按文件名并入 | §2.109.5、EX-13.67、AC-VERIFY-TIER-25 | 夹具 LD；`deltas/test/` 下写入 D-main(S02, UT-S02-01)，**不合并**（没有 `SPEC_MERGED`） | `verify --format json` | S02 在受影响场景中，来源 `["delta"]`；`layers.changed.ids=[]`；不报 `test_change_set_invalid` |
| UT-S13-304 | 普通提案：测试变更集无效时按文件名并入且门禁 FAIL | §2.109.5、EX-13.67、AC-VERIFY-TIER-25 | 夹具 LD（不是多切片提案）；delta 为 D-main(S02, UT-S02-01)；已合并；① 把 `SPEC_MERGED.test_change_set` 的 `sha256` 改为不匹配的值；② 不动 `SPEC_MERGED`，合并后在 `core-S02-test-cases.md` 末尾追加一行文字 | 各执行 `verify --format json` | 两臂 S02 都在受影响场景中，来源 `["delta"]`；`gate.result="FAIL"`、`gate.reason="test_change_set_invalid"` |
| UT-S13-305 | 无法逐份文档判断时只对该文档按文件名并入 | §2.109.5、EX-13.66、AC-VERIFY-TIER-25 | 夹具 LD；delta 含两份只改主链路小节的文档：D-main(S01, UT-S01-01) 与 D-main(S02, UT-S02-01)；已合并，测试变更集保持有效；依次为：① 从 `SPEC_MERGED` 删除 `merge_baseline`；② 从 `merge_baseline.targets` 删除 `core-S02-test-cases.md` 的条目；③ 把该条目 `before.git_blob` 改为对象库中不存在的 id；④ 把该条目 `before.sha256` 改为不匹配的值；⑤ 把该条目 `after_sha256` 改为不匹配的值 | 各执行 `verify --format json`；③ 另比较执行前后 git 对象库的对象数 | ① S01 与 S02 都在受影响场景中，来源 `["delta"]`；②～⑤ 受影响场景恰为 S02，来源 `["delta"]`，S01 不在其中；各臂都不报错、没有新增原因代码，`layers.expansion.level="none"`，`gate.reason` 不是 `test_change_set_invalid`；③ 对象数不变 |
| UT-S13-306 | change-lint 的「场景是否存在」判断不变 | §2.109.4、§2.109.5 | 夹具 LD；delta 为 D-main(S02, UT-S02-01) 与新建的 `core-S06-test-cases.md`（只含导言与空的用例表，没有定义任何用例）；声明 `scenarios: [S06]`，理由非空；未合并与已合并各一次 | 各执行 `change-lint --format json` | 两次都不报 `affected_scenarios_invalid`，不把 S06 判为不存在的场景 |
| UT-S13-307 | 场景没有 delta 来源时扩大规则照常生效 | §2.109.5、§2.109.7、EX-13.64、EX-13.32、AC-VERIFY-TIER-23 | 夹具 LD；delta 为 D-main(S02, UT-S02-01)；已合并；全部 pass；① 声明 `shared_change: true`、`scenarios: []`；② 删除「受影响场景」段 | 各执行 `verify --format json`，读取调用记录 | ① `layers.affected.scenarios` 中没有 S02 的条目（S02 没有 `delta` 来源）；`layers.expansion.level="full"`，原因含 `shared_change_declared`；入口执行了全部自动化用例，含 UT-S02-02 与 UT-JSON-90；`gate.result="PASS"`；② 同样没有 S02 的条目；原因含 `declaration_missing` 与 `module_scope_unavailable`，`level="full"`；入口执行了 UT-S02-02 与 UT-JSON-90 |
| UT-S13-308 | 多切片提案：测试变更集无效时沿用切片清单暂停出口 | §2.109.5、EX-13.67、AC-VERIFY-TIER-25；既有 UT-S32-48、ST-S32-16 | 夹具 LD-slices，delta 另含 D-main(S02, UT-S02-01)；清单有效；记录提案目录下 `VERIFY_PASS` / `VERIFY_FAIL`、`SLICE_CHECKPOINTS.jsonl`、`LOOP_ITERS` 与 `tasks.md` 的存在性和哈希；① 把 `SPEC_MERGED.test_change_set` 的 `sha256` 改为不匹配的值；② 不动 `SPEC_MERGED`，合并后在 `core-S02-test-cases.md` 末尾追加一行文字 | 各执行 `verify --format json`，读取调用记录 | 两臂：退出码 2；`data.reason="test-slice-manifest-invalid"`；`data.slice_verification_state.human_action_required=true`，违规项含 `test-slice-change-set-` 前缀的代码；`data` 中没有 `gate` 与 `layers`；入口没有被调用；所记录的文件存在性与哈希不变，没有新增验收标记 |

### 场景测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| ST-S13-55 | 一次调整多份主链路小节的提案只验收该验收的部分 | Step 1～16、EX-13.64、EX-13.69、AC-VERIFY-TIER-23、24 | 真实 CLI（构建后的 `dist/index.js`）；夹具 LD；提案经真实 `change`、`merge` 建立，声明经夹具函数写为含 `id` 与 `reason` 的对象；delta 含三份：D-main(S02, UT-S02-01)、D-main(S04, UT-S04-02)，以及 `core-S01-test-cases.md` 的 delta（新增主链路小节 UT-S01-01 并修改 UT-S01-02 的预期输出文字）；声明 `scenarios: [S01]`；全部 pass | ① `verify --format json`；② 读取调用记录与 `acceptance-report.md` | ① 退出码 0，`gate.result="PASS"`，`layers.expansion.level="none"`；受影响场景恰为 S01，来源含 `declared` 与 `delta`；② 入口执行的用例恰为 UT-S01-01、02、03、UT-S02-01、UT-S03-01、UT-S04-02；UT-S02-02、UT-JSON-90、UT-S03-02 未被执行；报告「验收范围」小节列出的受影响场景只有 S01；`VERIFY_PASS` 已写入 |
| ST-S13-56 | 删除与移动用例时原场景仍被回归 | Step 1～16、EX-13.65、AC-VERIFY-TIER-24 | 真实 CLI；夹具 LD，P 之外本应不执行的 UT-S02-01 实际会失败；声明 `scenarios: []`；提案经真实 `merge`；① delta 只从 `core-S02-test-cases.md` 删除 UT-JSON-90；② 另一个项目中 delta 把 UT-JSON-90 从 `core-S02-test-cases.md` 原样移到 `core-S01-test-cases.md` | 各执行 `verify --format json`，读取调用记录 | ① S02 来源 `["delta"]`；UT-S02-01 被执行并失败，退出码 1，`gate.reason="failed_cases"`；② 受影响场景为 S01 与 S02；UT-S02-01 被执行并失败，退出码 1 |

### 覆盖度校验

- 没有改动用例时不并入：UT-S13-294、UT-S13-295、ST-S13-55。三者的夹具都经真实合并、不改动 `SPEC_MERGED` 与正式文档，即合并基线可信、可以逐份判断。
- 同一份只改清单的 delta，可以逐份判断与无法判断的分界：UT-S13-294（可信，S02 没有 `delta` 来源）对 UT-S13-305 ①（去掉合并基线，S02 来源 `delta`）；UT-S13-305 ②～⑤ 在同一提案内同时给出两种结果（S01 可信不并入，S02 无法判断按文件名并入）。
- 没有 delta 来源不等于其余用例不执行（扩大规则照常）：UT-S13-307。
- 新增、修改、删除用例时并入：UT-S13-296～UT-S13-298、ST-S13-56。
- 逐份文档判断（不含场景号的编号、跨文档移动、文档互不影响）：UT-S13-298 ②、UT-S13-299、UT-S13-300、ST-S13-55、ST-S13-56。
- 场景文档、声明、主链路层不受影响：UT-S13-301、UT-S13-302、UT-S13-294、UT-S13-300。
- 按文件名判断的情形：UT-S13-303（未合并）、UT-S13-304（普通提案的变更集无效，含合并后文件被改动）、UT-S13-305（无法逐份判断）。
- 变更集无效时两种出口互不混淆：UT-S13-304（普通提案，`gate.reason="test_change_set_invalid"`，输出含 `layers`）、UT-S13-308（多切片提案，切片清单暂停出口，不输出 `gate` 与 `layers`）。
- change-lint 的口径不变：UT-S13-306。
- 异常 EX-13.64～EX-13.69 各至少一条：64（294、295、302、307）、65（298、299）、66（305）、67（303、304、308）、68（301）、69（300）；EX-13.34（296、297、301，以及既有 UT-S13-223）。
- 需求 AC-VERIFY-TIER-23～25 均有对应用例；AC-VERIFY-TIER-26 由安装态 smoke 覆盖。
- 未单列的情形：「用例行比较报错」（EX-13.66 的最后一项）无法经正常 merge 构造——含重复 ID 或列数无法判定的文档在合并时就被拒绝；该分支由 UT-S13-305 的同一条兜底路径覆盖，实现时以比较函数抛错的接缝补一条断言，并入 UT-S13-305。

### 自动化与证据要求

- 全部用例由 `cli/test` 下的自动化测试实现，结果经 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。
- 不需要人参与；不需要额外的环境要求（夹具自建一次性 git 仓库，本仓测试已依赖 git）；无平台限定用例。
- 夹具的 `SPEC_MERGED` 必须由真实合并路径写出（含测试变更集与合并基线），不得手写；UT-S13-304、UT-S13-305、UT-S13-308 在合并之后再按用例说明改动标记或文件。
- 凡是前置中有非空声明的用例（UT-S13-300、UT-S13-302、ST-S13-55），都经夹具函数写出合法声明并读回确认 `usable`（见本节开头「声明的写法」）。
- 「实际执行了哪些用例」以项目外临时目录中的调用记录为准，不从 CLI 输出推断。
- 既有夹具随行为变化同步：实现时逐个核对 `cli/test` 中凡是靠「`deltas/test/` 下放一份没有用例变化的测试用例文档」来构造 delta 触及的夹具（含手写 `SPEC_MERGED` 的夹具）。手写标记没有合并基线时按文件名并入，行为不变；经真实合并且没有用例变化的，前置改为含用例变化，预期不变。

## S13 验收期间的 git 调用只读本地测试（verify-git-local-only）

> 覆盖场景 `core-S13-verify-results.md`「S13 验收期间的 git 调用只读本地」（Step 1～17、EX-13.70～EX-13.80）及其修改的 EX-10.5、EX-13.33，功能规格 §2.111、§2.96.6，`spec/cli-json-output.md` 中 `base_ref_unreachable` 与 `diff_failed` 的说明；需求 AC-VERIFY-LOCAL-01～08。既有用例不改：UT-S13-305（读取合并前内容时不取回）继续由原用例覆盖，改用共用执行入口后预期不变。
>
> **夹具 MS、LV**：同「S13 共享验收配置按字段判断测试」的夹具 MS（多模块、按模块限定范围）与「S13 分层验收与发布级验收测试」的夹具 LV（单模块、分层开启）、LV-rel（发布级）。
>
> **缺对象变体**（在 MS 或 LV 上叠加，记作 `+缺内容`、`+缺起点`）：
> - 远端：项目外的一个本机裸仓库，持有项目的全部对象，并允许按对象取回。项目把它登记为远端，只配置 URL 与取回过滤器（不设 `promisor` 与 `extensions.partialclone`），并显式配置 `protocol.file.allow=always`。
> - **远端接入记录**：远端一侧每收到一次请求，就在项目外的记录文件追加一行（经 `remote.<name>.uploadpack` 指向的记录型包装脚本，或等价方式）。夹具必须先证明记录有区分力：对照步骤不加任何保护、直接读取同一个缺失对象时，记录中出现条目且对象被取回；随后恢复缺失状态并清空记录，再执行待测步骤。
> - `+缺内容`：提案期间修改一个已跟踪文件，然后从本地对象库删除该文件在提案起点中的内容对象。
> - `+缺起点`：把 guard 的 `baseRef` 改为只存在于远端、本地没有的一个提交号。
> - **对象库快照**：松散对象与 pack 目录的文件清单；「对象库不变」指执行前后快照相同。
>
> **git 调用记录**：把一个记录型的 `git` 包装放在 `PATH` 最前，每次被调用时在项目外追加一行（参数、三个相关环境变量的取值、是否由 verify 进程直接启动），再转交真实的 git。用于断言「哪些调用带了约束」「某个调用有没有发生」，不从 CLI 输出推断。
>
> **超时接缝**（分支注入）：只读 git 执行入口提供测试用接缝，可让指定参数的调用直接返回超时结果，用来验证「超时之后走哪个分支」，不依赖真实等待。它不启动子进程，因此**不能**证明真实的子进程被终止。
>
> **短时限与等待型 git 替身**（真实终止）：仅供测试的时限覆盖把执行入口的时限缩短到约 1 秒（只在测试中生效，不是用户配置项）；`PATH` 最前的 git 替身对指定参数的调用先把自己的 PID 写到项目外的文件，然后长时间等待（远超时限）。调用返回后读取该 PID，断言进程已不存在。
>
> `detail` 中「本地缺少对象，验收不从远端取回」与超时说明的断言为子串匹配；原因代码为精确比较。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-309 | 按模块限定范围：缺文件内容时不连接远端并回落全量 | §2.111.2、§2.111.4、EX-13.70、EX-10.5、AC-VERIFY-LOCAL-01 | 夹具 MS `+缺内容`；全部 pass | `verify --format json`；读取远端接入记录、对象库快照与各命令组的调用记录 | 远端接入记录为空；对象库不变；`scope.mode="fallback-full"`，`fallback_reason.code="diff_failed"`，`detail` 含「本地缺少对象，验收不从远端取回」；两个模块的命令组都被执行；`gate.result="PASS"` |
| UT-S13-310 | 分层验收：缺文件内容时不连接远端并扩大到全量 | §2.111.4、EX-13.70、EX-13.33、AC-VERIFY-LOCAL-01 | 夹具 LV `+缺内容`；全部 pass | `verify --format json`；读取远端接入记录、对象库快照与调用记录 | 远端接入记录为空；对象库不变；`layers.expansion.level="full"`，原因含 `base_ref_unavailable` 且其 `detail` 含「本地缺少对象，验收不从远端取回」；入口执行了全部自动化用例；`gate.result="PASS"` |
| UT-S13-311 | 缺起点提交对象时不连接远端，判为起点不可达且不执行差异计算 | §2.111.4、EX-13.71、AC-VERIFY-LOCAL-02 | ① 夹具 MS `+缺起点`；② 夹具 LV `+缺起点` | 各执行 `verify --format json`；读取远端接入记录、对象库快照与 git 调用记录 | 两臂远端接入记录为空、对象库不变；① `fallback_reason.code="base_ref_unreachable"`；② 扩大到全量，原因含 `base_ref_unavailable`，其 `detail` 含 `base_ref_unreachable`、不含 `diff_failed`；两臂的 git 调用记录中都有检查起点提交的调用，没有差异计算（`diff`）的调用 |
| UT-S13-312 | 发布查询指定的提交本地不存在时不连接远端并照旧拒绝 | §2.111.4、EX-13.72、AC-VERIFY-LOCAL-03 | 夹具 LV-rel 叠加远端；取一个只存在于远端的提交号 | `verify --release --check --commit <该提交号> --format json`；读取远端接入记录与调用记录 | 远端接入记录为空；对象库不变；退出码 2，错误信封 `error.code="RELEASE_CHECK_COMMIT_INVALID"`；测试入口没有被调用；没有写入任何报告、历史或标记 |
| UT-S13-313 | 只有传输协议白名单生效时同样不连接远端（模拟不识别禁用取回开关的 Git） | §2.111.2、§2.111.3、EX-13.77、AC-VERIFY-LOCAL-07 | 夹具 MS `+缺内容` 与 LV `+缺起点`；经接缝让执行入口不设置 `GIT_NO_LAZY_FETCH`，只保留置空的传输协议白名单 | 各执行范围计算；读取远端接入记录、对象库快照与 git 跟踪 | 两臂远端接入记录为空、对象库不变；原因分别与 UT-S13-309、UT-S13-311 相同。git 跟踪中允许出现被启动又被拒绝的 fetch 子进程——这一点单独记录，不作为失败依据，也不作为通过依据 |
| UT-S13-314 | 超过时限按失败的那一次调用归类 | §2.111.2、§2.111.4、EX-13.73、EX-13.74、AC-VERIFY-LOCAL-04 | 夹具 MS（对象齐全，起点提交存在——检查起点提交或收集改动文件超时时按超时回落，不适用「与引入前一致」）；经超时接缝分别让：① 检查起点提交的调用超时；② 差异计算的调用超时；③ 列出未跟踪文件的调用超时。另以夹具 LV 重复 ①② | 各执行范围计算；读取 git 调用记录 | ① `base_ref_unreachable`，`detail` 写明超时与 60 秒，git 调用记录中没有差异计算；② `diff_failed`，`detail` 写明超时；③ `diff_failed`，`detail` 写明超时。LV 的两臂都扩大到全量，原因 `base_ref_unavailable` 且写明超时。各臂验收继续完成，不抛错 |
| UT-S13-321 | 超过时限的 git 子进程被真实终止，验收继续 | §2.111.2、EX-13.73、EX-13.74、AC-VERIFY-LOCAL-04 | 夹具 MS（对象齐全）；短时限（约 1 秒）与等待型 git 替身；① 替身让检查起点提交的调用等待；② 替身让差异计算的调用等待；全部 pass | 各执行真实 CLI 的 `verify --format json`，外层给 60 秒截止；调用返回后读取替身记录的 PID | 两臂：verify 在外层截止之前返回并给出结论；替身记录的 PID 对应的进程已退出（`kill(pid, 0)` 失败）；① `fallback_reason.code="base_ref_unreachable"`，没有执行差异计算；② `fallback_reason.code="diff_failed"`；`detail` 都写明超时；两个模块的命令组都被执行，`gate.result="PASS"` |
| UT-S13-315 | 回落之后门禁按实际结果判定 | §2.111.4、EX-13.76、AC-VERIFY-LOCAL-05 | 夹具 LV `+缺内容`；① 全部 pass；② 缺省提案集合之外的 UT-S03-02 实际会失败，其余全部 pass；③ 同 ②，另让主链路用例 UT-S03-01 第 1 次 fail、第 2 次 pass。①② 中没有优先级更高的门禁原因（测试变更集有效、主链路无偶发）；② 中测试入口因 UT-S03-02 失败而非零退出，并写出了该用例的失败记录 | 各执行 `verify --format json` | ① `gate.result="PASS"`；② UT-S03-02 被执行并失败，`gate.result="FAIL"`、`gate.reason="failed_cases"`（不是 `pre_run_failed`：结果中有可采信的失败记录），退出码 1；③ `gate.result="FAIL"`、`gate.reason="main_path_flaky"`（既有优先级不因扩大改变，同 UT-S13-243）；三臂的扩大原因相同 |
| UT-S13-316 | 读取提案起点中的配置内容经受约束的调用，读不到时按整文件变化 | §2.111.1、§2.111.4、EX-13.75 | 夹具 MS；只改 `logos.config.json` 的 `description`；① 正常；② 经超时接缝让「读取 `baseRef` 中该文件内容」的调用超时 | 各执行范围计算；读取 git 调用记录 | ① 不回落，该调用带三项约束；② 回落全量，`fallback_reason.code="shared_config_changed"`，`detail` 为 `logos/logos.config.json（提案起点中的内容读取失败）` |
| UT-S13-322 | 对象齐全时读取某份文档的合并前内容超时，只影响那一份文档 | §2.111.4、§2.111.6、EX-13.75、EX-13.66 | 夹具 LV 的变体（对象齐全）：提案 delta 含两份只新增「主链路用例」小节的测试用例文档（S01、S02），经正常 merge 写入 `SPEC_MERGED`，声明 `scenarios: []`；经超时接缝只让读取 S02 合并前内容的调用超时 | `verify --format json` | `layers.affected.scenarios` 恰为 S02，来源 `["delta"]`，没有 S01 的条目；`layers.expansion.level="none"`（不因这次超时扩大到全量）；`gate.reason` 不是 `test_change_set_invalid` |
| UT-S13-317 | verify 启动的每个 git 调用都带三项约束，既有时限保留 | §2.111.1、§2.111.2、AC-VERIFY-LOCAL-08 | ① 夹具 MS；② 夹具 LV（已合并，含测试用例文档 delta）；③ 夹具 LV-rel，执行 `--release` 与 `--release --check` | 各执行 `verify --format json`；读取 git 调用记录 | 由 verify 进程直接启动的每一条 git 调用，`GIT_ALLOW_PROTOCOL` 都已设置且为空串、`GIT_NO_LAZY_FETCH` 为 `1`、`GIT_TERMINAL_PROMPT` 为 `0`；测试入口内部启动的 git 调用不带这些取值（不继承）。执行入口的缺省时限为 60 秒；发布级 git 调用的时限为 60 秒、为验收历史读取提交号 10 秒、读取工作区状态 30 秒（以执行入口收到的时限参数断言） |
| UT-S13-318 | 对象齐全且调用及时完成时与引入前一致，仍能缩小范围 | §2.111.6、EX-13.78、AC-VERIFY-LOCAL-06 | ① 夹具 MS，提案只改动 `portal-web/**`；② 夹具 LV 缺省；两者都叠加远端但不删除任何对象 | 各执行 `verify --format json`；读取调用记录与远端接入记录 | ① `scope.mode="module"`、只执行 `portal-web` 的命令组；② `layers.expansion.level="none"`，入口只执行提案集合内的用例；两臂的 JSON（归一化后）、验收报告与调用记录和引入前实现上生成的 golden 相同；远端接入记录为空 |
| UT-S13-319 | 提案级 verify 的历史记录使用受约束读取的提交快照，smoke 的历史记录不变 | §2.111.5、EX-13.79、AC-VERIFY-LOCAL-08 | 夹具 LV 全部提交且工作区干净；配置 `smoke.command` 为一个写出合法结果的脚本 | ① `verify --format json`，读取中央索引与 git 调用记录；② `smoke --format json`，读取 git 调用记录与中央索引 | ① 历史记录 `commit.head` 等于当前 HEAD、`commit.dirty=false`；读取提交号与工作区状态的调用带三项约束，时限 10 秒、30 秒；② smoke 写历史时读取提交号与工作区状态的调用不带这三个取值，时限仍为 10 秒、30 秒；记录的 `commit` 与引入前相同 |
| UT-S13-320 | 发布级验收的历史仍记在运行开始时固定的提交上 | §2.111.5、EX-13.80、EX-13.45；既有 UT-S13-259 | 夹具 LV-rel；① 入口剧本在执行期间新建一个提交（提交 A → B），一条用例 fail；② 入口剧本在执行期间改写一个已跟踪的源码文件而不提交（HEAD 仍为 A），全部 pass | ① `verify --release --format json`；随后 `--release --check --commit A` 与 `--release --check --commit B`；读取中央索引与 git 调用记录；② `verify --release --format json`，读取中央索引 | ② `gate.result="FAIL"`、`gate.reason="release_commit_changed"`，历史记录 `commit.head` 为 A（收尾复核的是 HEAD 与工作区，不只是 HEAD）。① 历史记录 `level="release"`、`commit.head` 为 A；对 A 的查询为 `latest_failed`，对 B 的查询不把这次运行算作 B 的结论（与 UT-S13-259 的既有预期逐项相同）；git 调用记录中，写历史阶段没有新增读取提交号的调用，前置检查与收尾复核的调用都带三项约束 |

### 场景测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| ST-S13-57 | 部分克隆缺对象的多模块项目：验收不联网，回落全量后给出结论 | Step 1～17、EX-13.70、EX-13.71、AC-VERIFY-LOCAL-01、02、05 | 真实 CLI（构建后的 `dist/index.js`）；夹具 MS 叠加远端；全部 pass | ① `+缺内容` 后 `verify --format json`；② 另一个项目 `+缺起点` 后 `verify --format json`；③ 读取远端接入记录、对象库快照、调用记录与 `acceptance-report.md` | ① 退出码 0，`fallback_reason.code="diff_failed"`；② 退出码 0，`fallback_reason.code="base_ref_unreachable"`；③ 两个项目的远端接入记录都为空、对象库不变；两个模块的命令组都被执行；报告写明回落原因；`VERIFY_PASS` 已写入 |
| ST-S13-58 | 分层项目：对象齐全时照常收窄，缺对象后扩大并如实判定 | Step 1～17、EX-13.70、EX-13.76、EX-13.78、AC-VERIFY-LOCAL-05、06 | 真实 CLI；夹具 LV 叠加远端；缺省提案集合之外的 UT-S03-02 实际会失败，没有其他门禁原因 | ① 对象齐全时 `verify --format json`；② 制造 `+缺内容` 后再次执行；③ 读取远端接入记录与调用记录 | ① 退出码 0，`layers.expansion.level="none"`，UT-S03-02 未被执行；② 扩大到全量，UT-S03-02 被执行并失败，退出码 1，`gate.reason="failed_cases"`，报告写明扩大原因；③ 两次的远端接入记录都为空 |

### 覆盖度校验

- 不连接远端、对象库不变：UT-S13-309～UT-S13-313、ST-S13-57、ST-S13-58。
- 按缺失对象的位置落入既有结果：缺文件内容（309、310）、缺起点提交（311）、发布查询（312）、起点配置内容（316）；读取合并前内容由既有 UT-S13-305 覆盖。
- 超时按调用归类：UT-S13-314、UT-S13-316 ②、UT-S13-322（分支注入）。各调用的结果不同：检查起点提交、收集改动文件超时回落全量（314）；读取起点配置内容超时按整文件变化、同样回落全量但原因为 `shared_config_changed`（316 ②）；读取某份文档的合并前内容超时只影响那一份文档、不扩大到全量（322）；超时的子进程被真实终止：UT-S13-321。
- 不识别禁用取回开关的 Git：UT-S13-313。
- 门禁按实际结果：UT-S13-315、ST-S13-58。
- 三项约束的施加范围、既有时限、调用方边界：UT-S13-317、UT-S13-319。
- 发布级验收的提交归属不变：UT-S13-320（与既有 UT-S13-259 同一反例）。
- 对象齐全时不变：UT-S13-318、ST-S13-58 ①。
- 异常 EX-13.70～EX-13.80 各至少一条：70（309、310）、71（311）、72（312）、73（314 ①、321 ①）、74（314 ②③、321 ②）、75（316、322；合并前内容缺失见 UT-S13-305）、76（315）、77（313）、78（318）、79（319）、80（320）；EX-10.5（309、311、314）、EX-13.33（310、311、314）。
- 需求 AC-VERIFY-LOCAL-01～08 均有对应用例；AC-VERIFY-LOCAL-09 由安装态 smoke 覆盖。

### 自动化与证据要求

- 全部用例由 `cli/test` 下的自动化测试实现，结果经 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。
- 不需要人参与；不需要额外的环境要求（夹具自建一次性 git 仓库与本机文件远端，本仓测试已依赖 git）；无平台限定用例。
- **不依赖真实网络与长时间等待**：远端是本机裸仓库；分支注入的超时用例不启动子进程；UT-S13-321 用缩短到约 1 秒的时限驱动真实执行入口，不实际等待 60 秒。
- 「超时的子进程已终止」只由 UT-S13-321 证明：读取 git 替身记录的 PID 并确认进程不存在（做法同 `cli/test/s13-verify-precheck.test.ts` 中检查进程的超时用例）。只断言错误说明与后续分支的用例不能替代它。
- 「远端有没有收到请求」读远端接入记录，「对象库有没有新增」比较对象库快照，「某个 git 调用有没有发生、带了什么环境变量」读 git 调用记录；都不从 CLI 输出推断。
- 凡断言「远端接入记录为空」的用例，夹具都先执行对照步骤证明记录有区分力（见本节开头）；对照步骤失败时夹具直接失败。
- UT-S13-313 的「模拟」如实标注：测试机的 Git 识别禁用取回的开关，这里通过不设置该开关来走传输协议白名单这条路径，不等于在真实旧版 Git 上执行。
- 「与引入前一致」类断言以同一夹具在引入前实现上生成的 golden 比对。
- 实现时逐个核对 `cli/test` 中直接断言 git 调用参数或环境变量的既有用例；因改经共用执行入口而需要调整的，只调整观测方式，不改预期行为。
