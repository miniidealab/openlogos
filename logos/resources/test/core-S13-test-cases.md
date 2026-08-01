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
