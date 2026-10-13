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

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-26 | Linux 真实不可转储进程下的复用 | S13 R9～R12、EX-3.13 ①② | 仅 Linux；一次性项目（verify 预跑写全部 pass 账本）与一次性 `sandbox_root`；`sleep` 的副本权限为 0111 | ① 先在测试中启动一个不可转储进程（exec 0111 的 `sleep` 副本，长时间运行），确认同用户读取其 environ 得 EACCES、`/proc/<pid>/stat` 可读；随后等待并以实际读数校验「`/proc/uptime` − 该进程 starttime 秒数」大于 2 秒（即首轮命令启动时该进程必然早于「命令启动时刻 − 1 秒」）；② 连续两次 `openlogos verify --format json`；③ 把预跑命令改为在命令内以 `setsid` / Node `spawn(..., {detached:true, stdio:"ignore"})` 启动一个不可转储后台进程（同样 exec 0111 副本，脱离命令进程组并关闭继承 stdio）后退出，执行一次 verify；④ 再执行一次 verify | ② 两次 `gate.result=="PASS"`，`reuse.state` 依次为 `created` / `reused`；③ 先断言该后台进程仍存活、原命令进程组已空（以释放记录中的 `pgid` 做 `kill(-pgid, 0)` 得 ESRCH）、同用户读取其 environ 得 EACCES、stat 可读且启动时刻不早于「命令启动时刻 − 1 秒」；最新释放标记为 `tainted`，原因来自运行标记扫描并点名该后台进程的 pid（而非进程组仍有成员）；④ `reuse.state=="recovered"`，旧世代列入 `abandoned`。**修改前实现 ② 第二次为 `recovered`，本用例必红** |

### 追溯与覆盖

- 启动时刻判据与各异常分支（§2.92.2）：UT-S13-101。
- 命令启动时刻记录、随释放记录传递与旧记录保守口径（§2.92.3、§2.92.4、EX-3.13 ③）：UT-S13-102。
- Linux 真实不可转储进程（EX-3.13 ①③）：ST-S13-26（仅 Linux）；容差内与启动时刻不可读（EX-3.13 ②）：UT-S13-101 的进程 c、e、f。
- 既有 UT-S13-89～UT-S13-100、ST-S13-25、UT-S19-57 作为零回归守护，须在 Linux（非 root、具备 sqlite3）与 macOS 全量回归中保持绿。
