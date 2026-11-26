# S19: 执行部署后 smoke 门禁 — 测试用例

## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S19-01 | 解析 smoke ID | smoke extractor | smoke 文件 | SMOKE 用例 | 返回 ID 列表 |
| UT-S19-04 | 提案级 smoke_required 控制 smoke 门禁 | proposal smoke decision | 活跃提案有部署决策 | proposal + markers | 只有 smoke_required=true 且 DEPLOY_DONE 存在时进入 ready-to-smoke |
| UT-S19-05 | smoke 前必须存在 DEPLOY_DONE | S19/S21 | 提案需要 smoke，`[deploy]` 已全勾但缺少 `DEPLOY_DONE` | smoke/status step | 不进入 `ready-to-smoke`，提示先执行 `openlogos deploy-done` |
| UT-S19-06 | 重新 deploy-done 清理旧 smoke marker | S19/S21 | 提案存在旧 `SMOKE_PASS` 或 `SMOKE_FAIL` | deploy-done | 删除旧 smoke marker |

## 二、场景测试用例
### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S19-01 | smoke 全部通过 | Step 1→7 | 已部署且提案需要 smoke | smoke --env staging | 写入 smoke-report.md |
| ST-S19-04 | 部署完成但提案无需 smoke 时允许归档 | Step 1→2 | DEPLOY_DONE 存在且 smoke_required=false | status / next | 不进入 ready-to-smoke，建议 archive |
| ST-S19-05 | 部署决策冲突时不进入 smoke | Step 1→2 | proposal 与 tasks 冲突 | status / next | 不进入 ready-to-smoke，提示先修正提案资料 |
| ST-S19-06 | 缺少 DEPLOY_DONE 时拒绝 smoke 门禁推进 | S19 Step 2→4 | 提案需要 smoke 但缺少 `DEPLOY_DONE` | `openlogos smoke --env staging` 或 status/next | 不写入 `SMOKE_PASS`，提示先完成部署标记 |
| ST-S19-07 | 重新标记部署完成后旧 smoke 结论失效 | S19 Step 2→4 / S21 | 提案已有旧 `SMOKE_PASS`，随后重新执行 deploy-done | `openlogos deploy-done --env staging` 后 status | 旧 `SMOKE_PASS` 被清理，状态回到 `ready-to-smoke` |

## 三、异常测试用例
| ID | 描述 | 覆盖异常 | 前置条件 | 操作序列 | 预期结果 |
|----|------|----------|---------|---------|---------|
| ST-S19-EX-2.1 | 提案无需 smoke 时拒绝误触发 smoke 门禁 | EX-2.1 | smoke_required=false | smoke / status | 输出无需 smoke 或允许 archive 的说明 |
| ST-S19-EX-2.2 | 部署决策冲突时拒绝 smoke | EX-2.2 | proposal 与 tasks 冲突 | smoke / status | 输出冲突警告并拒绝进入 smoke |

## 四、smoke runner / reporter 覆盖测试用例

### 4.1 单元测试用例补充
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S19-SMOKE-01 | 缺少 smoke runner 时输出诊断 | smoke runner coverage | 新增 smoke ID，`smoke.command` 未配置且无 `scripts/smoke-*` | smoke coverage check | 返回 `smoke_runner_missing` |
| UT-S19-SMOKE-02 | runner 未写入 result path 时输出诊断 | smoke reporter coverage | 存在 runner，但 `smoke-results.jsonl` 不存在或为空 | smoke coverage check | 返回 `smoke_reporter_missing` |
| UT-S19-SMOKE-03 | dispatcher 可发现 smoke runner | smoke dispatcher | 存在 `scripts/smoke-driver-smoke-repair-loop.sh` 或等效 runner | dispatcher discovery | 返回 runner 列表并纳入 `smoke.command` 执行链 |

### 4.2 场景测试用例补充
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S19-SMOKE-01 | 新增 smoke case 未执行时 Gate FAIL 且诊断明确 | S19 Step 4→9 | 已部署提案新增 `SMOKE-DRV-SMOKE-01`，结果文件缺少该 ID | `openlogos smoke --format json` | `gate.result=FAIL`，`uncovered_cases` 包含该 ID，诊断为 `smoke_cases_uncovered` |
| ST-S19-SMOKE-02 | 统一 dispatcher 执行新增 runner 后无 uncovered | S19 Step 4→9 | `smoke.command` 指向统一 dispatcher，runner 写入新增 smoke ID 的 pass 结果 | `openlogos smoke --format json` | 新增 ID 不在 `uncovered_cases`，无 runner/reporter 缺失诊断 |

### 4.3 异常测试用例补充
| ID | 描述 | 覆盖异常 | 前置条件 | 操作序列 | 预期结果 |
|----|------|----------|---------|---------|---------|
| ST-S19-EX-SMOKE-01 | 禁止伪造 smoke PASS | smoke reporter validation | runner 仅追加新增 ID 的 pass 结果但未执行实际检查或缺少 runner 审计 | smoke coverage check | 输出 runner 审计缺失或伪造风险诊断，不写入 `SMOKE_PASS` |

### 4.4 覆盖度校验补充
- [ ] runner 缺失诊断：UT-S19-SMOKE-01
- [ ] reporter 缺失诊断：UT-S19-SMOKE-02
- [ ] dispatcher 发现 runner：UT-S19-SMOKE-03、ST-S19-SMOKE-02
- [ ] 新增 smoke ID uncovered：ST-S19-SMOKE-01
- [ ] 禁止伪造 PASS：ST-S19-EX-SMOKE-01

## 五、`--auto` 全自动下的 smoke（driver 行为，下游验证）

> **实现阶段订正（auto-full-unattended）**：smoke 在全自动下「自动运行」= 宿主 AI driver 读指令文本（两档授权）后亲自运行 `openlogos smoke` 的行为，**`smoke` 命令本身无 `--auto` 改动**、CLI smoke 门禁逻辑一字未变。该 driver 端到端行为属下游 **runlogos** 验证范围，不在 openlogos CLI 单测层。
>
> 本提案在 openlogos CLI 层的可测面：
> - **两档授权指令文本**（全自动 `--auto` 授权 driver 自动运行 smoke / 半自动 smoke 仍人类确认点）由 `createAgentsMd` 生成 → 覆盖于 **UT-S01-46**（见 `core-S01-test-cases.md`）。
> - **smoke 门禁前置判定、smoke FAIL 硬阻塞、smoke_required / DEPLOY_DONE 依赖** → 由本文档既有 S19 用例覆盖，本提案未触碰。
>
> 故本节不新增 openlogos CLI 用例。

## 六、`auto_execute`：`--auto` 下 ready-to-smoke 自动执行信号（auto-execute-redline-steps）

> `next --auto` 在 `ready-to-smoke` 步骤输出 `auto_execute:true` + `command="openlogos smoke"`，供无人值守 driver 自动运行 smoke；半自动不置（仍人类确认点）。smoke 命令本身逻辑、门禁前置判定、FAIL 硬阻塞均不变。

**覆盖归属**：`ready-to-smoke + --auto → auto_execute:true + command="openlogos smoke"`（及默认 next 不置）这一行为由 `next` 引擎统一实现，已在 **`core-S24-test-cases.md` 的 UT-S24-11**（ready-to-smoke 非门动作步骤）执行覆盖；S19 不重复定义 CLI 用例。smoke 命令本体逻辑由本文档既有 S19 用例覆盖。

## 七、smoke skip 有效通过回归

### 7.1 单元测试用例补充

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S19-07 | smoke skip 计入有效通过率 | smoke summary | 定义 2 个 smoke 用例；结果中 1 个 `pass`、1 个 `skip`；无 fail / uncovered / diagnostics | `collectSmokeData` | `gate.result="PASS"`，`summary.pass_rate_pct=100`，`summary.skipped_count=1`，`skipped_cases` 包含 skip ID |

### 7.2 场景测试用例补充

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S19-08 | smoke 含环境性 skip 时报告 PASS 且保留跳过列表 | Step 8→10 | 已部署且提案需要 smoke；全部 smoke 用例均有结果，其中部分为 `skip`；无 runner / reporter 覆盖诊断 | `openlogos smoke --format json` 或等价 collector | smoke Gate PASS，`pass_rate_pct=100`，`smoke-report.md` 包含 Skipped Cases，不写 `SMOKE_FAIL` |

### 7.3 覆盖度校验补充

- [ ] smoke skip 计入有效通过率：UT-S19-07、ST-S19-08
- [ ] smoke skip 审计列表保留：ST-S19-08

## 八、smoke 沙箱依赖目录豁免测试（fix-sandbox-node-modules-write-audit）

> 覆盖 smoke 侧的沙箱写入审计依赖目录豁免（S19 EX-4.4 / 功能规格 §2.9）与白名单定点采集回收。沙箱执行器为 verify / smoke 共享，豁免匹配规则（完整路径段严格等于 `node_modules`）、symlink 隔离不变量与 infos 通道的核心逻辑由 S13 第十三节用例覆盖，本节锁定 smoke 调用面。本节用例编号顺延既有最大编号（UT-S19-07 / ST-S19-08）。用例实现必须写入 OpenLogos reporter，测试名包含对应 ID 供 verify 抽取。

### 8.1 单元测试用例补充

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S19-08 | smoke 沙箱 always 模式下 node_modules 写入同样豁免，说明走 infos 通道 | EX-4.4 / §2.9 依赖目录豁免 | 已部署且提案需要 smoke；`smoke.sandbox_mode=always`、`sandbox_deny_workspace_write=true`；项目含 `node_modules`；`smoke.command` 仅写入 `node_modules/.bin/*` 并正常写 `smoke-results.jsonl` | `openlogos smoke --format json` | smoke Gate 不因该写入 FAIL；`sandbox.status="pass"`；`sandbox.infos` 含信息级豁免说明，`sandbox.diagnostics` 不含该说明且无「检测到非白名单写入」告警，文本输出以 `ℹ️` 渲染一次；`node_modules` 之外的非白名单写入仍按 EX-4.3 FAIL（沿用既有阻断用例回归保障） |
| UT-S19-09 | smoke 结果文件位于 node_modules 下仍被定点采集回收 | §2.9 白名单回收优先 | `smoke.result_path="node_modules/.cache/openlogos/smoke-results.jsonl"`（合法配置）；`smoke.sandbox_mode=always`；`smoke.command` 在沙箱内写出该结果文件 | `openlogos smoke --format json` | 结果文件被定点采集回收到原 workspace 对应路径，smoke 正常读取结果计算门禁（不报无结果）；回收不依赖快照 diff；该路径回收不触发非白名单判定 |

### 8.2 覆盖度校验补充

- [ ] smoke 沙箱 node_modules 写入豁免 + infos 通道：UT-S19-08
- [ ] smoke 结果文件位于 node_modules 下定点采集回收：UT-S19-09

## `local-isolated` TRAE 负向 Smoke 门禁测试

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|---|---|---|---|---|---|
| UT-S19-10 | 双 tarball 输入与 `local-isolated` 部署前置校验 | S19 前置门禁 / 部署方案 | 活跃提案需要部署与 smoke | 候选/回滚 tarball 的存在性、包名、版本、SHA；`DEPLOY_DONE` 的存在性和环境 | 仅候选 0.13.29、回滚 0.13.28 均有效，且 `[deploy]` 完成、`DEPLOY_DONE.environment="local-isolated"` 时 ready；任一缺失、版本漂移、环境不符均阻断且不调度 runner |
| UT-S19-11 | 负向 dispatcher/reporter 覆盖与证据校验 | S19 主时序 / reporter 合同 | dispatcher 声明 SMOKE-core-124～129 | runner 发现列表及 JSONL：覆盖缺失、skip、fail、重复矛盾、环境/SHA 不符、完整 pass 等组合 | 仅六个 ID 各有唯一真实 pass、环境为 local-isolated、制品 SHA 匹配且 evidence 完整时 Gate PASS；其余均给出精确诊断且不得写 `SMOKE_PASS` |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S19-09 | 部署完成后执行真实本地负向 smoke 闭环 | 前置读取 → dispatcher → runner → reporter → Gate | verify 已通过；部署报告及同环境 DEPLOY_DONE 存在；两个固定 tarball 有可追溯 SHA；用户明确授权 smoke | 执行 `openlogos smoke --env local-isolated`；dispatcher 发现 runner；runner 实际执行 SMOKE-core-124～129；collector 校验结果和审计链 | 六个用例全部 pass 时生成环境为 local-isolated 的 `smoke-report.md` 与 `SMOKE_PASS`；任一失败/skip/缺失或证据不符时写 FAIL、保留诊断且不生成成功 marker；全程无真实 TRAE/用户/公开发布副作用 |

### 异常覆盖

- 缺少 `DEPLOY_DONE`、环境不是 `local-isolated`、`[deploy]` 未完成或 proposal/tasks 冲突：命令在 runner 前失败。
- 候选不是 `0.13.29`、回滚不是 `0.13.28`、tarball SHA 漂移或 CLI 入口逃逸：门禁/runner 失败。
- wrapper 直调、项目 Hook 文件存在、UI/Rules/MCP 软拒绝被报告为 capability PASS：reporter 审计失败。
- runner 访问真实 HOME、全局 npm、真实 `.trae/**`、账号/记忆，或触发 publish/tag/release/官网部署：立即失败并记录副作用诊断。

### 自动化、证据与覆盖

- UT/ST 名称必须包含对应 ID，并通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`；至少包含 `test_id`、`scenario_id="S19"`、`status`、`duration_ms` 和脱敏 evidence。
- [x] 双 tarball 与部署环境前置：UT-S19-10、ST-S19-09。
- [x] dispatcher 发现、六 ID 覆盖及 reporter 审计：UT-S19-11、ST-S19-09。
- [x] 缺失/skip/fail/证据不符不得产生 PASS：UT-S19-11、ST-S19-09。

## S19 OpenLogos 0.14.1 本地全局 patch 候选测试用例

### 测试边界

本组用例只验证当前 0.14.1 candidate/package identity、本地真实打包与隔离安装回滚链。0.14.0 breaking cutover 的历史断言、协议兼容 fixture 和既有 SMOKE-core-141～156 保持不变；实现不得用全仓字符串替换让历史语义改写为 0.14.1。

UT 使用仓库文件和临时目录，不修改用户真实全局环境。ST-S19-15 使用隔离 npm prefix 完成真实 tarball 安装与回滚恢复；本机全局 `/opt/homebrew` 的实际覆盖只在 verify PASS 后由独立部署授权执行。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|---|---|---|---|---|---|
| UT-S19-22 | 当前 0.14.1 candidate identity 全源一致且历史 0.14.0 语义保留 | S19-AC-01、功能规格 2.44.9 | 仓库版本同步已完成，prepack 可生成 asset manifest | 读取 CLI package/lock 根版本、Claude/Codex/ZCode/Qoder/WorkBuddy manifest、candidate 常量、相关 golden 与打包后 asset manifest；同时扫描标注为 breaking/history/legacy fixture 的 0.14.0 语料 | 所有当前 identity 精确为 0.14.1，tarball metadata 与 manifest 同源；历史 0.14.0 注释、错误合同和兼容 fixture 保持预期值，未被机械替换 |
| UT-S19-23 | 旧证据、混合版本与公开发布动作 fail-closed，回滚命令只使用冻结的 0.14.0 制品 | S19-AC-02、S19-AC-04、EX-6.1 | 构造合法 0.14.1 candidate facts、0.14.0 旧 facts、缺字段/混合版本 facts 与固定回滚 tarball facts | 对每组证据运行 candidate validator 和部署命令构造器；注入 publish、dist-tag、tag、release、官网部署、push 命令 | 仅完整同源 0.14.1 facts 通过；旧/混合/缺失 facts 返回稳定错误且不安装；调用图含公开发布动作时拒绝；回滚命令引用固定 0.14.0 tarball 绝对路径并包含恢复后入口/版本校验 |

### 场景测试

| ID | 描述 | 覆盖 Steps / EX | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S19-15 | 隔离 prefix 完成真实 0.14.1 pack、install、self-check、0.14.0 rollback 与 0.14.1 restore | Step 2→7、Step 11；EX-3.2、EX-5.1、EX-6.1 | CLI 全量测试/构建已通过；临时 npm prefix；固定 0.14.0 回滚 tarball；不使用真实全局 prefix | 执行真实 `npm pack --json` 并记录 SHA；从 tarball 安装到隔离 prefix；新 shell 校验入口/版本/package/plugin/asset/candidate facts；安装 0.14.0 并复核；重新安装同一 0.14.1 tarball 并复核；分别注入版本、路径、hash 和安装失败 | 正常链最终为同一 0.14.1 tarball，两个版本切换均有入口/版本/SHA 证据；每个失败注入均在错误阶段 fail-closed、恢复到明确版本且无混合资产；命令图无公开发布动作，临时目录清理范围受 realpath containment 保护 |

### OpenLogos Reporter 合同

- 测试实现名称必须原样包含 UT-S19-22、UT-S19-23、ST-S19-15。
- 每个 ID 向 `logos/resources/verify/test-results.jsonl` 写一条结果，至少包含 `test_id`、`scenario_id="S19"`、`status`、`timestamp`、`duration_ms` 与脱敏 evidence。
- UT-S19-22 evidence 记录版本源清单、asset manifest hash 与历史语料保留摘要；UT-S19-23 记录拒绝分类和回滚 tarball SHA；ST-S19-15 记录隔离 prefix 摘要、candidate/rollback SHA、每次入口/版本与失败阶段。
- status 只能来自真实断言；不得为满足 verify 覆盖率预写或补写伪造 pass。

### 验收条件追溯

| AC ID | 验收条件摘要 | 覆盖用例 |
|---|---|---|
| S19-AC-01 | 真实 0.14.1 tarball 与全部版本/资产身份同源 | UT-S19-22、ST-S19-15 |
| S19-AC-02 | 固定 tarball 本地安装且新 shell 入口精确 | UT-S19-23、ST-S19-15 |
| S19-AC-03 | 安装态最小 smoke 使用同一 candidate 和真实 reporter | ST-S19-15、SMOKE-core-157、SMOKE-core-158 |
| S19-AC-04 | 失败回滚与 0.14.1→0.14.0→0.14.1 恢复，无公开发布副作用 | UT-S19-23、ST-S19-15、SMOKE-core-159 |

### 覆盖度与后续实现约束

- [x] package/candidate identity 正常与混合版本异常：UT-S19-22、UT-S19-23。
- [x] 真实 tarball、隔离安装、新 shell 入口与资产自检：ST-S19-15。
- [x] 固定 0.14.0 回滚、0.14.1 恢复与失败注入：UT-S19-23、ST-S19-15。
- [x] 公开发布副作用为零：UT-S19-23、ST-S19-15。
- [x] S19-AC-01～04 均有 UT/ST 或 smoke 追溯。

后续 `[code]` 切片必须同时实现或更新覆盖 SMOKE-core-157～159 的 `scripts/smoke-*` runner、OpenLogos smoke reporter 与 `scripts/run-smoke.js` dispatcher 接入；code 完成前必须运行 smoke 覆盖预检，确保三个新增 ID 均不在 uncovered cases 中。

## S19 候选 runner 留痕契约元测试

### 单元测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S19-33 | 每个已注册候选 runner 都实现留痕契约 | Step 1→5 | 已加载 `scripts/run-smoke.js` 的 `globalCandidateRunners` 注册项 | 逐个读取注册 runner 源码，断言其调用 `requireEnvOrSkip` | 全部注册项通过；任一未实现即失败并列出文件名。判据落在**注册表**而非目录通配——注册表是候选 runner 的权威清单 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S19-19 | 缺制品时写 skip 而非 fail，且自检不被挡 | Step 2→4 | 真实 runner；清空其候选与回滚 tarball 环境变量 | ① 直接运行每个已注册候选 runner；② 以 `--self-test` 运行同一批 | ① 全部以成功状态退出，并为各自 owned ID 写**唯一一条** `skip` 记录，携带缺失项；无 `fail` 记录、无静默零记录退出；② 自检契约正常输出声明，不被守卫挡住 |

### 追溯与覆盖

- AC-MERGEGATE-10 候选 runner 留痕普遍要求与防遗漏：UT-S19-33、ST-S19-19。
- 场景：S19 候选 runner 留痕契约的普遍化与元测试；功能规格：§2.51.8；架构：§四十一.6.2。

## S19 切片事务 smoke runner 契约测试

### 单元测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S19-34 | 新 runner 已注册且实现留痕契约 | 留痕契约 | 已加载 `scripts/run-smoke.js` 的三处注册表 | 断言切片事务 runner 在 `hostArtifacts` / `globalMutatingRunners` / `globalCandidateRunners` 均已登记，并调用 `requireEnvOrSkip`、具备 `--self-test` 只读入口 | 三处均登记；缺制品时以成功状态退出并写唯一一条带缺失项的 `skip`；不得依靠通配发现后无条件 PASS。该断言由既有 runner 契约元测试的同一判据覆盖 |

### 追溯与覆盖

- AC-SLICETX-12 安装态验证的 runner 前置：UT-S19-34。
- 场景：S19 切片事务的安装态覆盖要求；功能规格：§2.53.9；架构：§四十三.4。

## S19 切片事务修复版 runner 注册测试


### 单元测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S19-35 | 修复版 runner 三处注册且实现留痕契约 | 留痕契约 | 已加载 `scripts/run-smoke.js` 的三处注册表 | 断言新 runner 在 `hostArtifacts` / `globalMutatingRunners` / `globalCandidateRunners` **逐表**登记，并调用 `requireEnvOrSkip`、具备 `--self-test` 只读入口 | 三处均登记且失败信息能指出是哪一张表缺失；缺制品时以成功状态退出并写唯一一条带缺失项的 `skip`；不得依靠通配发现后无条件 PASS。**证伪门**：摘掉任意一处注册后本用例必须变红 |

### 追溯与覆盖

- AC-SLICEFIX-11 新 smoke 的 runner 前置：UT-S19-35。
- AC-SLICEFIX-12 安装态验证的注册前置：UT-S19-35。
- 场景：S19 切片事务的安装态覆盖要求；功能规格：§2.53.5.1；架构：§四十三.2.1；安装态：SMOKE-core-176。

## S19 单切片终态判定修复版 runner 注册测试

### 单元测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S19-36 | 修复版 runner 三处注册且实现留痕契约 | 留痕契约 | 已加载 `scripts/run-smoke.js` 的三处注册表 | 断言 `SMOKE-core-178` runner 在 `hostArtifacts` / `globalMutatingRunners` / `globalCandidateRunners` **逐表**登记，并调用 `requireEnvOrSkip`、具备 `--self-test` 只读入口（自述 ids=[SMOKE-core-178]、candidate=0.14.14、rollback=0.14.13、所需 env） | 三处均登记且失败信息能指出是哪一张表缺失；缺制品时以成功状态退出并写唯一一条带缺失项的 `skip`；不得依靠通配发现后无条件 PASS。**证伪门**：摘掉任意一处注册后本用例必须变红 |

### 追溯与覆盖

- AC-VERDICT-06 安装态 smoke 的 runner 前置：UT-S19-36。
- 场景：S19 单切片事务终态判定的安装态覆盖；安装态：SMOKE-core-178。

## S19 重划修复版 runner 注册测试

### 单元测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S19-37 | 重划 runner 三处注册且实现留痕契约 | 留痕契约 | 已加载 `scripts/run-smoke.js` 的三处注册表 | 断言 `SMOKE-core-179` runner 在 `hostArtifacts` / `globalMutatingRunners` / `globalCandidateRunners` **逐表**登记，并调用 `requireEnvOrSkip`、具备 `--self-test` 只读入口（自述 ids=[SMOKE-core-179]、candidate=0.14.15、rollback=0.14.14、所需 env） | 三处均登记且失败信息能指出是哪一张表缺失；缺制品时以成功状态退出并写唯一一条带缺失项的 `skip`；不得依靠通配发现后无条件 PASS。**证伪门**：摘掉任意一处注册后本用例必须变红 |

### 追溯与覆盖

- AC-REPLAN-09 安装态 smoke 的 runner 前置：UT-S19-37。
- 场景：S19 切片重划的安装态覆盖；安装态：SMOKE-core-179。

## 0.14.21 候选身份测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S19-38 | 0.14.21 候选身份全源一致 | `LOCAL_RELEASE_CANDIDATE_VERSION === '0.14.21'`、`LOCAL_RELEASE_ROLLBACK_VERSION === '0.14.20'`；package.json/lockfile/五 plugin manifest/asset-manifest version 全部精确 `0.14.21`；asset-manifest 含 `claude-plugin-template/bin/guard-check` 版本化哈希条目且与随包字节一致 |

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S19"`；失败不得写 pass。

## 0.14.22 候选身份测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S19-39 | 0.14.22 候选身份全源一致 | `LOCAL_RELEASE_CANDIDATE_VERSION === '0.14.22'`、`LOCAL_RELEASE_ROLLBACK_VERSION === '0.14.21'`；package.json/lockfile/五 plugin manifest/asset-manifest version 全部精确 `0.14.22`；asset-manifest 含 `claude-plugin-template/bin/guard-check` 版本化哈希条目且与随包字节一致（含管辖边界判定与 block() stderr 输出的新字节） |

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S19"`；失败不得写 pass。

## 0.14.23 候选身份测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S19-40 | 0.14.23 候选身份全源一致 | `LOCAL_RELEASE_CANDIDATE_VERSION === '0.14.23'`、`LOCAL_RELEASE_ROLLBACK_VERSION === '0.14.22'`；package.json/lockfile/五 plugin manifest/asset-manifest version 全部精确 `0.14.23`；SMOKE-core-194 runner 已接入 `scripts/run-smoke.js` 且 `--self-test` 合同含 `ids:['SMOKE-core-194']`、`public_release_commands:[]` |

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S19"`；失败不得写 pass。

## 0.14.24 候选身份测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S19-41 | 0.14.24 候选身份全源一致 | `LOCAL_RELEASE_CANDIDATE_VERSION === '0.14.24'`、`LOCAL_RELEASE_ROLLBACK_VERSION === '0.14.23'`；package.json/lockfile/五 plugin manifest/asset-manifest version 全部精确 `0.14.24`；回滚制品身份 tripwire：固定 0.14.23 tarball SHA-256 `de042d28db4e143a0da0e1e4dc63a9169557ac9cc4dde4ead8e8164ccf507a5b` 在场且可校验；SMOKE-core-195 runner 已接入 `scripts/run-smoke.js` 且 `--self-test` 合同含 `ids:['SMOKE-core-195']`、`public_release_commands:[]` |

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S19"`；失败不得写 pass。

## S19 smoke 前置 fail-closed 校验测试

> 覆盖 S19「smoke 前置依赖 deploy-done」既有规格的**实现对齐**：四项前置的判定顺序与错误码、拒绝时的零副作用、补救命令提示，以及前置满足时的零回归。
>
> 这些规则**并非新语义**：已合并的「smoke 前置依赖 deploy-done」章节早已规定四项前置与「缺 `DEPLOY_DONE` 应提示先执行 `openlogos deploy-done`」。本节把该规格变成可执行的强制判据——此前它只是文字，`cli/src/commands/smoke.ts` 完全没有该校验（20260907 事故：缺标状态下 smoke 照常执行并写入 `SMOKE_PASS`）。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S19-42 | 缺 `DEPLOY_DONE` 时 fail-closed 拒绝且零副作用 | EX-19.5 | 活跃提案：`VERIFY_PASS` 在场、`deployment_required=true`、`smoke_required=true`、`[deploy]` 全勾、`DEPLOY_DONE` **缺失** | 执行 `openlogos smoke`（含 `--format json`） | 非零退出；错误码 `SMOKE_DEPLOY_NOT_DONE`；message 含 `openlogos deploy-done`；`--format json` 走 stderr 通用错误 envelope；**`smoke.command` 未被执行**、`SMOKE_PASS`/`SMOKE_FAIL` 未产生、`smoke-report.md` 未生成、`smoke-results.jsonl` 无新增行 |
| UT-S19-43 | `[deploy]` 未全勾时 fail-closed 拒绝 | EX-19.6 | `DEPLOY_DONE` 在场（旁路写入），但 `tasks.md` 的 `[deploy]` section 仍有未勾条目 | 执行 `openlogos smoke` | 非零退出；错误码 `SMOKE_DEPLOY_TASKS_INCOMPLETE`；message 提示补齐 `[deploy]` 任务后执行 `openlogos deploy-done`；零副作用同 UT-S19-42 |
| UT-S19-44 | 判定顺序固定且只报第一个错误码 | §2.67.1 判定顺序 | 同时构造多项不满足（`smoke_required=false` + 部署决策冲突 + 缺 `DEPLOY_DONE` + `[deploy]` 未全勾） | 执行 `openlogos smoke` | 只输出 ① 对应的 `SMOKE_NOT_REQUIRED`；逐项去掉更靠前的不满足项后，依次得到 `SMOKE_DEPLOY_DECISION_CONFLICT` → `SMOKE_DEPLOY_NOT_DONE` → `SMOKE_DEPLOY_TASKS_INCOMPLETE`（顺序 ①→②→③→④ 命中即停） |
| UT-S19-45 | 0.14.25 候选发布的版本无关接线锚 | 0.14.25 候选发布需求 | 候选身份链已让位给 0.15.0 | 读取 runner 注册与回滚制品接线 | `scripts/run-smoke.js` 仍注册 0.14.25 的 SMOKE-core-196 runner；回滚制品 tripwire 在场。**版本身份断言（`LOCAL_RELEASE_CANDIDATE_VERSION` / `LOCAL_RELEASE_ROLLBACK_VERSION`）自 0.15.0 起由 UT-S19-46 承载**——按本文件既有惯例，旧候选锚退为版本无关的接线锚，避免每次发布都改写历史用例 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S19-20 | 缺标拒绝 → 补标后放行的全链闭环 | Step 1→10 | 真实 CLI；提案需部署需 smoke、`VERIFY_PASS` 在场、`deployment-report.md` 已生成、`[deploy]` 未勾且无 `DEPLOY_DONE` | ① `openlogos smoke` → ② `openlogos deploy-done` → ③ 再次 `openlogos smoke` | ① `SMOKE_DEPLOY_NOT_DONE` 拒绝、零副作用；② 落标成功（`[deploy]` 全勾、`DEPLOY_DONE` 在场）；③ 进入既有正常执行路径——sandbox 执行、runner/reporter 覆盖预检、gate 判定与 `gate.reason` 取值、skip 统计口径逐项与修复前一致 |
| ST-S19-21 | `--auto` 下前置门同样 fail-closed | Step 1、§2.67.1 两档模式 | 同 UT-S19-42 的缺标提案；以 `--auto` standing 授权驱动 smoke | 由 driver 在 `--auto` 下自动运行 `openlogos smoke` | 同样非零退出、`SMOKE_DEPLOY_NOT_DONE`、零副作用；`--auto` 放行的是「运行 smoke 这个动作」，不跳过前置门；`GATE_AUTO_PASSED` 审计行不构成对缺标状态的放行依据 |

### 追溯与覆盖

- AC-SMOKE-FC-01 缺 `DEPLOY_DONE` 拒绝且零副作用：UT-S19-42、ST-S19-20。
- AC-SMOKE-FC-02 `[deploy]` 未全勾拒绝：UT-S19-43。
- AC-SMOKE-FC-03 判定顺序与错误码确定性：UT-S19-44。
- AC-SMOKE-FC-04 前置满足放行零回归：ST-S19-20 步骤③。
- AC-SMOKE-FC-05 `--auto` 不跳过前置门：ST-S19-21。
- AC-RELEASE-0.14.25 候选身份：UT-S19-45；安装态行为由 SMOKE-core-196 取证。
- 场景：S19「smoke 前置依赖 deploy-done」§前置校验的可验收契约、S19 OpenLogos 0.14.25 生命周期 fail-closed 候选发布时序；功能规格：§2.67.1、§2.67.5。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S19"`；失败不得写 pass。
- 零副作用断言必须以**磁盘事实**取证（marker 文件不存在、报告文件不存在、JSONL 行数未变），不得只断言退出码。

## S19 环境不具备的显式 skip 测试

> 覆盖 runner 在环境不具备时的留痕义务、账本三态不混用、门禁判据不放宽。
>
> 这些规则**并非新语义**：已合并的「runner 接入要求」与「smoke skip 统计口径」早已规定 runner 对每个用例写 `pass|fail|skip`、skip 表示环境缺少外部依赖。本节的用例是把该规格**变成可执行的强制判据**——此前它只是文字，实现可以静默违反而不被发现。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S19-29 | 环境不具备时为全部 owned ID 写 skip，不静默零记录 | Step 3b→5b | 取一个依赖第三方宿主的 runner，清空其必需 env | 执行该 runner 并读账本 | 退出码 0；账本中该 runner 的**每个** owned ID 都有一条 `status:"skip"` 记录；记录数等于 owned ID 数，不多不少；**不得出现零记录退出** |
| UT-S19-30 | skip 记录携带机器可读的不适用原因 | §2.48.4 第 2 点 | 同上 | 读 skip 记录 | 每条记录含可读的缺失项标识（具体 env 名或制品名），能据其归因到「缺什么」；不得只有 `skip` 而无原因字段 |
| UT-S19-31 | 三态不混用：真实失败仍 fail，不得降级为 skip | EX-S19-NA-2 | env 齐备但注入一处真实断言失败 | 执行 runner 并判 Gate | 该用例记为 `fail`；Gate FAIL；**不得**因「环境相关」而被写成 skip；伪造 `pass` 填补覆盖同样被拒 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S19-18 | 账本从「同形沉默」变为「可审计不适用」，门禁判据未放宽 | Step 1→8 | 真实 CLI；同时存在环境具备与不具备的 runner | 清空账本 → 执行 smoke.command → 读 JSON 与 `smoke-report.md` | 不具备环境的用例全部以 skip 出现在 `skipped_cases` 并带原因，且**不再计入 uncovered**；具备环境的用例照常 pass/fail；`isPass` 公式未被修改——存在 fail 仍 FAIL、存在 uncovered 仍 FAIL；账本中不存在任何零记录退出的 runner |

### 追溯与覆盖

- AC-SMOKE-NA-01 全部 owned ID 留痕：UT-S19-29、ST-S19-18。
- AC-SMOKE-NA-02 不适用可审计且不计 uncovered：UT-S19-30、ST-S19-18。
- AC-SMOKE-NA-03 三态不混用、判据不放宽：UT-S19-31、ST-S19-18。
- 场景：S19 环境不具备的显式 skip；功能规格：§2.48.4～§2.48.5；架构：§三十九.2。

## S19 OpenLogos 本地发布候选打包测试用例

> 覆盖本地发布候选的版本身份同源与隔离 prefix 行为矩阵。候选身份**随 `LOCAL_RELEASE_CANDIDATE_VERSION` 移动**——用例不得写死任何版本字面量，版本变更只改 `cli/src/lib/local-release-candidate.ts` 一处（fix-slice-assets-drift-after-transaction-removal：钉死字面量会让本组用例在每次发布后必红，那是把环境现值误当被测性质）。本组不做本机全局安装，故无「全局切换/回滚」用例。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S19-46 | 本地发布候选版本身份全源一致 | 仓库处于候选实现完成态 | 读取 CLI `package.json`、lockfile 根包、asset manifest、随包 plugin/模板 manifest 与携带版本的 schema/runner 元数据 | 全部等于 `LOCAL_RELEASE_CANDIDATE_VERSION`，无一处残留 `LOCAL_RELEASE_ROLLBACK_VERSION`；候选与回滚两常量必须不同；asset manifest 的逐文件 hash 与磁盘字节一致 |

### 场景测试

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S19-22 | 隔离 prefix 真实 pack、安装与破坏性契约验收 | CLI 全量测试与构建已通过；`mktemp -d` 一次性 npm prefix；**不得触碰本机全局 prefix 与本仓活跃提案** | ① 真实 `npm pack --json` 并记录 tarball SHA-256；② 从 tarball 安装到隔离 prefix；③ 新 shell 绝对入口执行验收矩阵 | ① candidate identity 全部来自固定 tarball、无 workspace link；② 已删除命令面（`merge transaction status`、`merge-apply`、切片事务）一律非零退出；③ 临时项目内 `merge <slug>` 一次调用完成多目标合并并写 `SPEC_MERGED`；④ `change-lint` 输出恰 9 项检查、`slice plan --file` 与 `lint-specs` 可用；⑤ **执行前后 `command -v openlogos` 与其 version 逐字一致**——全局未被本用例触碰；**不得断言它等于某个具体版本**（本机全局现值随历次发布变化，钉死即在下次发布后必红） |

### 追溯与覆盖

- AC-RELEASE-0150-01 candidate identity：UT-S19-46、ST-S19-22 步骤①。
- AC-RELEASE-0150-02 破坏性命令面：ST-S19-22 步骤②③。
- AC-RELEASE-0150-03 新命令可用：ST-S19-22 步骤④。
- AC-RELEASE-0150-04 全局未触碰：ST-S19-22 步骤⑤。
- 部署后 smoke：SMOKE-core-197～199。

## S19 环境事实不入 verify 期断言的守卫元测试

> 覆盖架构 §四十九与部署方案「发布前检查通则」：把「verify 期断言不得钉死环境事实」从口头约定变成会红的门。同形态缺陷已发生两次（`a16bf6a` 修 S19、0.15.3 发布后 `UT-S34-09` 复发），故守卫本身必须是**元测试**——遍历测试资产而非逐个用例自觉遵守。测试实现必须写入 OpenLogos reporter。
>
> **判据按「字段语义」分类，不按「是否等于当前版本」匹配**（delta-r1 F1）：升版发生在 verify 之后，故障快照里钉着的恰恰是**上一个**版本——用「等于当前包版本」当判据，会在真实故障输入上放行（实测：`cli/package.json` 为 `0.15.3` 时，故障快照 `s34-feature.test.ts.snap` 钉的是 `0.15.2`，命中数为 0）。因此守卫必须问「这个位置该不该出现包版本」，而不是「这个字符串是不是当前版本」。

### 判据：三类位置，三种处置

| 位置类别 | 识别方式 | 处置 |
|---|---|---|
| **包版本承载位**：envelope 顶层 `"version"` 字段、`--version` 输出、tarball / 安装包版本 | 结构识别（JSON 快照按键路径定位；文本快照按 `--version` 行形态定位） | 出现**任意** `x.y.z` 形态字面量即**失败**——不论它等于当前版本、上一个版本还是任何版本；该位置的合法形态只有规范化占位符（如 `UT-S34-09` 既有的 `<PKG_VERSION>`） |
| **契约版本位**：`data.contract.version`、`spec/schema/*.json` 的内嵌契约版本 | 同上按键路径定位 | **必须**是固定字面量断言，守卫不得报错；反过来，该位置被规范化成占位符也判失败（把被测性质当噪声抹掉） |
| **叙述文本**：注释、`describe`/`it` 标题、文档字符串中的历史版本 | 不是断言期望值 | 不参与判定——守卫只看断言期望值与快照内容，不扫散文 |

### 单元测试

| ID | 描述 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S19-47 | 包版本承载位不得出现任何版本字面量（按字段语义判定） | 仓库任意状态；用例**运行时**读取 `cli/package.json` 仅用于诊断文案，**判据不依赖该值** | ① 遍历 `cli/test/__snapshots__/**/*.snap`：JSON 快照按键路径取 envelope 顶层 `version`、文本快照按 `--version` 行形态定位；② 遍历 `cli/test/**/*.test.ts` 中针对上述位置的断言期望值 | 任一包版本承载位出现 `x.y.z` 形态字面量即**失败**，诊断逐条点名文件、行号、命中片段与所属键路径，并给出修法「改为规范化占位符或运行时读取 + 关系断言（架构 §49.2）」；契约版本位保持固定字面量不报错 |
| UT-S19-48 | 判据不随版本漂移：旧版本字面量同样被拦（F1 回归锚） | 构造夹具快照：envelope `"version"` 为 `vA`，同时把「当前包版本」注入为 `vB`（`vA ≠ vB`） | 对该夹具运行守卫 | **失败**并点名该行——这正是 0.15.3 上的真实形态（快照钉 `0.15.2`）。**按「等于当前版本」实现的守卫在本例通过**，故本用例是 F1 的直接回归锚 |

### 边界与反例（同一组用例内覆盖，防止守卫过度）

| 情形 | 期望 |
|---|---|
| 快照含 `data.contract.version: "1.0.0"`（契约版本位） | **不得**报错——契约版本由被测代码决定，是被测性质而非环境事实（架构 §49.2 边界） |
| 契约版本位被写成占位符（如 `<CONTRACT_VERSION>`） | **失败**——该位置必须逐字节守死，规范化它等于放弃对外承诺的验收 |
| 测试源含 `LOCAL_RELEASE_CANDIDATE_VERSION` 标识符（不含字面量） | 不得报错——它正是「运行时读取」的正例 |
| 注释 / `it()` 标题 / 文档字符串中出现历史版本号（如「0.15.2 发布后复发」） | 不得报错——叙述不是断言期望值，守卫不扫散文 |

### 追溯与覆盖

- AC-ENVFACT-01 包版本承载位出现任意版本字面量即拦截（不以「等于当前版本」为判据）：UT-S19-47、UT-S19-48。
- AC-ENVFACT-02 守卫不误伤契约字段、运行时读取形态与叙述文本，且契约位被规范化时反向报错：UT-S19-47 边界表。
- 架构：§四十九；部署方案：「发布前检查通则：环境事实不入 verify 期断言」；相关用例：UT-S34-09、UT-S34-29。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S19"`；失败不得写 pass。
- 守卫的遍历源必须是**磁盘上的测试资产**，不得改为一份人工维护的文件白名单——白名单会随新增快照静默失效，那正是本守卫要消除的形态。
- **判据不得退化为「等于当前包版本」的字符串比较**：那样的守卫在升版后必然漏掉故障快照（旧值），UT-S19-48 即为此设的回归锚。

## S19 升版确定性与 manifest 自洽守卫

> 覆盖发布前检查通则第 4～5 条（功能规格 §2.81）：升版收敛为一条确定性动作，派生值由生成器重算；manifest 自洽性有独立失败信号。与 `UT-S19-47` / `UT-S19-48`（环境事实守卫）同族——三者共同守住「发布期事实不得靠人记得」。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S19-49 | `asset-manifest.json` 自洽（payloadHash == payload 现算值） | 仓库任意状态；用例**运行时**读取 manifest，不含任何版本或哈希字面量 | ① 读 `cli/asset-manifest.json`；② 剥去 `payloadHash` 后按既有 canonical 序列化算 SHA-256；③ 与在盘 `payloadHash` 比对 | 相等则通过；不等则**失败**并点名 `payloadHash`、给出 expected/actual 与修法「跑生成器重算，禁止手改」。**修复前的中间态（手改 version 未重算）在本用例上必红**——0.15.4 实证：该状态曾以 12 个文件 72 条 `asset manifest payload hash 不匹配` 的形式暴露，本用例把它收敛为一条点名诊断 |
| UT-S19-50 | 升版脚本：全载体一次改全、派生值重算、幂等 | 一次性临时仓库副本（**不得改动本仓字节**），预置当前版本 `vA` | ① 以目标版本 `vB` 执行升版脚本；② 检查 8 处身份载体与候选/回滚常量；③ 检查 `asset-manifest.json`；④ 对已是 `vB` 的副本重复执行 | ② 8 处全部为 `vB`，`LOCAL_RELEASE_CANDIDATE_VERSION=vB`、`LOCAL_RELEASE_ROLLBACK_VERSION=vA`，**无一处残留 `vA`**；③ manifest 的 `version` 为 `vB` 且 `payloadHash` 自洽（即由生成器重算而非手写）；④ 重复执行后**字节不变**（幂等）；脚本输出逐项变更清单（文件 → 旧值 → 新值）供复核 |

### 边界与反例

| 情形 | 期望 |
|---|---|
| 仅手改 `asset-manifest.json` 的 `version`、不重算 hash | `UT-S19-49` **失败**——这正是要拦的中间态 |
| 升版脚本对非法目标版本（非 `x.y.z`）执行 | 拒绝且**零改写**：不得留下改了一半的仓库 |
| `asset-manifest.json` 的 schema 或生成算法 | **不变**——本组只约束「谁来写」，不改产物形态 |

### 追溯与覆盖

- AC-BUMP-01 manifest 自洽有独立失败信号：UT-S19-49。
- AC-BUMP-02 升版一次写全载体且派生值由生成器重算：UT-S19-50 ②③。
- AC-BUMP-03 升版幂等且非法输入零改写：UT-S19-50 ④、边界表。
- 功能规格：§2.81；部署方案：「发布前检查通则」第 4～5 条；相关用例：UT-S19-46（发布身份全源一致）、UT-S19-47/48（环境事实守卫）。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S19"`；失败不得写 pass。
- `UT-S19-50` 必须在**一次性临时副本**内执行升版脚本——在本仓真实升版会污染工作区，且升版是 `[deploy]` 阶段的动作，不得由 verify 期用例代劳。
- `UT-S19-49` 的 canonical 序列化必须**复用生产实现**（`asset-manifest.ts` 的同一函数），不得在测试内复述一份序列化规则——那会让守卫与被守对象各算各的。

## S19 必要用例 skip 与平台不可执行例外测试

> 覆盖功能规格 §2.48.5「本提案变更用例的 skip 是必要证据缺失」「平台不可执行例外」；场景 S19「smoke skip 统计口径」与 EX-19.7～EX-19.10；根规范 `spec/cli-json-output.md` §5.3 `required_skipped_cases` / `platform_skipped_cases`、§5.4 结果记录 `reason_code`；来源变更 verify-smoke-guard-fixes-0-15-20（决策 C03）。
>
> **夹具口径**：一次性 launched 项目，活跃提案的 `deltas/test/smoke/` 新增两条用例 `SMOKE-core-901`、`SMOKE-core-902`（即 `changed_cases`），已合并的 smoke 规格另有一条非本提案用例 `SMOKE-core-900`；前置标记（`VERIFY_PASS`、`DEPLOY_DONE`、`[deploy]` 全勾、`smoke_required=true`）齐备；`smoke.command` 指向一个真实 runner 脚本，按用例参数写入指定的结果记录。CLI 用例以真实 `openlogos smoke --format json` 子进程执行。测试实现必须写入 OpenLogos reporter，测试名包含对应 ID，`scenario_id="S19"`。

### 单元测试

| ID | 描述 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S19-51 | 平台不可执行的必要用例 skip 放行 | runner 写入 `SMOKE-core-900`、`SMOKE-core-901` 为 pass，`SMOKE-core-902` 为 `{status:"skip", reason_code:"platform-unavailable", detail:"requires win32"}` | `openlogos smoke --format json` | `gate.result=="PASS"`；`platform_skipped_cases==[{id:"SMOKE-core-902", detail:"requires win32"}]`；不出现 `required_skipped_cases`；`skipped_cases` 含 `SMOKE-core-902` |
| UT-S19-52 | 必要用例 skip 缺原因码判 FAIL | 同上，但 `SMOKE-core-902` 为 `{status:"skip", detail:"缺 OPENLOGOS_ROLLBACK_TGZ"}`，无 `reason_code` | 同上 | `gate.result=="FAIL"`、`gate.reason=="required_cases_skipped"`；`required_skipped_cases` 恰含 `SMOKE-core-902` 与其 detail；不出现 `platform_skipped_cases` |
| UT-S19-53 | 平台不可执行但 detail 为空判 FAIL | 两臂：`SMOKE-core-902` 为 `{status:"skip", reason_code:"platform-unavailable", detail:""}`；或缺 `detail` 字段 | 同上 | 两臂均 `gate.reason=="required_cases_skipped"`，该用例在 `required_skipped_cases` 中 |
| UT-S19-54 | 其他原因码不视为平台不可执行 | `SMOKE-core-902` 为 `{status:"skip", reason_code:"missing-artifact", detail:"缺回滚制品"}` | 同上 | `gate.reason=="required_cases_skipped"`；不出现 `platform_skipped_cases` |
| UT-S19-55 | 非本提案用例 skip 口径不变 | `SMOKE-core-900` 为 `{status:"skip", detail:"缺宿主客户端"}`（无原因码），`SMOKE-core-901`、`SMOKE-core-902` 均 pass | 同上；并与修改前实现对同一夹具比对 | `gate.result=="PASS"`；`required_skipped_cases` 与 `platform_skipped_cases` 均不出现；`summary` 与 `gate` 与修改前逐字一致 |
| UT-S19-56 | 原因优先级与报告独立小节 | 三臂：① `SMOKE-core-901` fail 且 `SMOKE-core-902` 缺原因码 skip；② 新增用例无结果（覆盖预检报 `smoke_cases_uncovered`）且另一条缺原因码 skip；③ UT-S19-51 夹具 | 每臂执行后读取 JSON 与 `smoke-report.md` | ① `gate.reason=="failed_cases"`；② `gate.reason=="smoke_cases_uncovered"`；两臂 `required_skipped_cases` 仍列出 skip 用例；③ 报告含「平台不可执行」独立小节，列出 `SMOKE-core-902` 与 detail，且不出现在必要证据缺失小节 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S19-23 | 真实 runner 的平台不可执行放行与缺口拦截 | S19 Step 4a～9、EX-19.7、EX-19.8 | 夹具 runner 按 `process.platform` 判断：非 win32 时为 `SMOKE-core-902` 写 `platform-unavailable` skip | ① `openlogos smoke --format json`；② 把 runner 改为不写 `reason_code`；③ 再次执行 | ① PASS，`platform_skipped_cases` 含 `SMOKE-core-902`（在 win32 上执行时该用例为真实 pass，断言改为 `platform_skipped_cases` 不出现）；③ FAIL，`gate.reason=="required_cases_skipped"`。**修改前实现 ① 为 FAIL，本用例必红** |
| ST-S19-24 | 平台不可执行与环境缺口并存 | EX-19.10 | runner 为 `SMOKE-core-901` 写缺制品 skip、为 `SMOKE-core-902` 写 `platform-unavailable` skip | ① `openlogos smoke --format json`；② 读取 `smoke-report.md` | ① FAIL，`gate.reason=="required_cases_skipped"`；`required_skipped_cases` 只含 `SMOKE-core-901`，`platform_skipped_cases` 只含 `SMOKE-core-902`；② 两个小节分别列出，互不混入 |

### 追溯与覆盖

- 平台不可执行例外（EX-19.7）：UT-S19-51、ST-S19-23（修改前实现必红）。
- 必要用例 skip 仍拦截（EX-19.8、EX-19.9）：UT-S19-52、UT-S19-53、UT-S19-54、ST-S19-23。
- 非本提案用例零回归：UT-S19-55。
- 原因优先级与报告：UT-S19-56。
- 并存场景（EX-19.10）：ST-S19-24。

### 自动化与证据要求

- runner 为真实脚本，由真实 `openlogos smoke` 子进程经 `smoke.command` 调用；断言基于 `--format json` 的结构化字段与报告的小节标题。
- 测试结果写入 `logos/resources/verify/test-results.jsonl`（OpenLogos reporter），测试名包含用例 ID。

## S19 smoke 沙箱复用测试

> 覆盖功能规格 §2.91；场景 S19「smoke 沙箱复用」规则 1～6；根规范 `spec/cli-json-output.md`「verify / smoke `sandbox.reuse` 沙箱复用字段」；来源变更 verify-sandbox-reuse-0-16-1（决策 C01、C05）。
>
> **夹具口径**：一次性 launched 项目与一次性 `sandbox_root`；smoke 前置标记（`VERIFY_PASS`、`DEPLOY_DONE`、`[deploy]` 全勾、`smoke_required=true`）齐备；`smoke.command` 指向真实 runner 脚本，为全部用例写 pass 结果并在 stdout 输出 `workspace/` 内一个哨兵文件的存在性。CLI 用例以真实 `openlogos smoke --format json` 与 `openlogos verify --format json` 子进程执行。测试实现必须写入 OpenLogos reporter，测试名包含对应 ID，`scenario_id="S19"`。

### 单元测试

| ID | 描述 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S19-57 | smoke 与 verify 共用持久沙箱并支持 `--fresh-sandbox` | `verify` 与 `smoke` 均为 `sandbox_mode=auto`、`sandbox_cache_paths=["build-cache"]`；verify 预跑命令向 `build-cache/sentinel` 写入哨兵并写 pass 结果 | ① `openlogos verify --format json`；② `openlogos smoke --format json`；③ `openlogos smoke --fresh-sandbox --format json`；④ 再次 `openlogos smoke --format json`；⑤ `smoke.sandbox_mode=off` 时 `openlogos smoke --format json` | ② smoke 的 `sandbox.reuse.dir` 与 ① 相同，`state=="reused"`，runner 输出哨兵存在；③ `state=="fresh"`，runner 输出哨兵不存在，① 的世代目录已删除，最新锁记录的 `ws` 等于 ③ 的 `reuse.generation`；④ `state=="reused"`，`generation` 等于 ③ 的世代，① 的旧世代目录未被重新创建；①～④ `gate.result=="PASS"`，`SMOKE_PASS` 写入规则与修改前一致；⑤ 不出现 `sandbox.reuse`。**修改前实现 smoke JSON 无 `reuse`、② 中哨兵不存在，本用例必红** |

### 追溯与覆盖

- smoke 与 verify 共用持久沙箱（S19「smoke 沙箱复用」规则 1、2）：UT-S19-57 ①②。
- smoke `--fresh-sandbox`（规则 4）：UT-S19-57 ③④。
- smoke `reuse` 字段与门禁不变（规则 5）：UT-S19-57 ①～⑤。
- 锁交错、非正常退出、零回归等执行器级行为与 verify 共用实现，由 UT-S13-89～UT-S13-100 覆盖。

### 自动化与证据要求

- 断言基于 `--format json` 的结构化字段与 runner 的实际输出，不解析 `sandbox.infos` 文案。
- 测试结果写入 `logos/resources/verify/test-results.jsonl`（OpenLogos reporter），测试名包含用例 ID。

## S19 smoke 环境一致性、环境证据与部署账本测试（environment-registry）

> 覆盖场景 `core-S19-smoke-gate.md`「smoke 环境一致性、环境证据与部署账本（environment-registry）」、功能规格 §2.93.4 / §2.93.5、`spec/environments.md` §4.2、§5、§6 与 `spec/test-results.md`「Smoke 结果与覆盖预检」。既有 S19 用例不变，作为零回归守护。测试实现必须写入 OpenLogos reporter，测试名包含对应 ID，`scenario_id="S19"`；全部在一次性临时 git 仓库与一次性 `sandbox_root` 中构造，smoke runner 为测试夹具。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S19-58 | `DEPLOY_DONE` 三类分类 | §4.2 | 构造 marker：0 字节；只含空白与换行；合法五字段 JSON；`environment=null` 的合法 JSON；`{"environment":"test"`（截断）；`[]`；`"x"`；缺 `deploy_id`；`ref` 为 39 位；`ref_source` 为 `guess`；`recorded_at` 为数字 | 调用分类函数 | 前两者为旧空格式；两份合法 JSON 为合法新格式；其余全部为非空损坏，且诊断点名问题字段 |
| UT-S19-59 | 环境不一致拒绝 | EX-19.11 | 登记表含 test、prod；`DEPLOY_DONE.environment="test"`；既有前置满足 | `smoke --env prod` | `SMOKE_ENV_MISMATCH`、退出码 1；`smoke.command` 未运行（夹具未留下运行痕迹）；无 `SMOKE_PASS` / `SMOKE_FAIL`；账本无新增 |
| UT-S19-60 | 非空损坏 marker 拒绝（有 / 无登记表） | EX-19.12 | ① 有登记表；② 无登记表；`DEPLOY_DONE` 为截断 JSON | `smoke --env prod` / `smoke` | 两种情形均 `SMOKE_DEPLOY_MARKER_INVALID`、退出码 1、点名问题；命令未运行、无 smoke marker、账本无新增 |
| UT-S19-61 | 旧空 marker 与未记录环境放行但未确认 | EX-19.13 | 有登记表；① marker 0 字节；② 合法 JSON 且 `environment=null`；runner 全部声明 prod 并通过 | `smoke --env prod` | 两种情形都运行命令并写 `SMOKE_PASS`；账本 smoke 记录 `deploy_env_confirmed=false`、`verified=false` |
| UT-S19-62 | 环境证据判定 | §6 | 有登记表；marker 为 prod、`ref` 已知；runner 结果行分别为：① 全部 `target_environment: prod`；② 一行缺该字段；③ 一行为 `test`；④ 无结果行 | `smoke --env prod` | ① `env_evidence=declared`；② `missing`，门禁按既有判据；③ `mismatch`，门禁 FAIL、原因 `SMOKE_ENV_EVIDENCE_MISMATCH`、写 `SMOKE_FAIL`；④ `missing`；结果行既有 `environment` 字段取任意值都不影响判定 |
| UT-S19-63 | smoke 记录继承部署 ref | EX-19.16 | marker `ref=R1`；smoke 时 HEAD 为 R2；② 另一用例 marker `ref=null` | `smoke --env prod`（runner 全部声明 prod 并通过） | 账本 smoke 记录 `ref=R1`、`deploy_id` 等于 marker、`observed_head=R2`、`verified=true`；② `ref=null`、`verified=false` |
| UT-S19-64 | `OPENLOGOS_SMOKE_ENV` 注入 | §6 注入 | runner 把读到的 `OPENLOGOS_SMOKE_ENV` 写入结果行；分别以 `smoke.sandbox_mode=off` 与沙箱模式执行；另一用例无登记表 | `smoke --env 生产`（prod 的 alias） | 两种执行方式下 runner 均读到 `prod`；无登记表时 runner 读不到该变量 |
| UT-S19-65 | 有登记表时 smoke 环境缺失或未登记 | §3 | 有登记表；既有前置满足 | ① `smoke`；② `smoke --env staging` | ① `ENV_REQUIRED`；② `ENV_UNKNOWN`；均退出码 1、命令未运行、无 smoke marker、账本无新增 |
| UT-S19-66 | 无登记表时 smoke 行为逐字不变 | EX-19.17、EX-19.19 | 无登记表；① 有活跃提案，marker 为空文件；② 有活跃提案，marker 为合法 JSON 且 `environment="test"`；③ 无 `logos/.openlogos-guard`（既有 ST-S19-03 夹具形态）；runner 结果行声明 `target_environment: other` | ① ② 执行 `smoke`、`smoke --env prod`、`smoke --format json`；③ 执行 `smoke --env production --format json`；均与引入前基线比对 | 文本与 JSON 输出、退出码与基线一致（JSON 无 `environment_evidence`）；② 中 `--env prod` 与 marker 的 test 不一致**不拒绝**，账本该行 `deploy_env_confirmed=false`、`env_evidence=mismatch`；`target_environment` 不改变门禁；③ 门禁 PASS，账本无新增，无伪造的 `slug` / `deploy_id` / `ref` |
| UT-S19-67 | 未运行 smoke 命令时旧结果不得提升为新部署的已验证事实 | EX-19.18 | 有登记表；未配置 `smoke.command` 且无默认 dispatcher；结果文件留有 R1 部署时全部 `target_environment: prod` 的通过结果；随后 `deploy-done --env prod --ref R2` | `smoke --env prod --format json`，再执行 `env show prod --format json` | 门禁按既有判据汇总（PASS）；`environment_evidence.fresh_results=false`、`env_evidence=declared`、`verified=false`；账本 smoke 行 `ref=R2`、`fresh_results=false`、`verified=false`；`env show` 的 `last_smoke.verified=false` |
| UT-S19-68 | `SMOKE_DEPLOY_MARKER_INVALID` 的 `error.details` | EX-19.12；`spec/cli-json-output.md`「`openlogos smoke`」 | 存在活跃提案、既有前置满足；① marker 截断为非法 JSON；② marker 为合法 JSON 但 `ref` 为 39 位；③ `DEPLOY_DONE` 被同名目录替代；④ 非 root 环境下合法 marker 权限置 000；另取一条既有错误路径（未初始化目录执行 `status --format json`） | `smoke --env prod --format json`；同样输入的文本模式；既有错误路径 | ①② `error.details.problems` 为非空数组（② 含 `ref`），`code` 与 `message` 与修复前一致；③④ `problems` 为 `["unreadable"]`，`error.details.reason` 含 errno（`EISDIR` / `EACCES`）；均不运行命令、无 smoke marker、账本无新增；文本模式输出与修复前逐字一致；既有错误 envelope 的 `error` 只含 `code`、`message`，无 `details` 键 |
| UT-S19-69 | 账本追加失败不改 smoke 标记 | EX-19.20 | 有登记表、合法 prod marker、runner 全部声明 prod 并通过；分别准备「无旧标记」「旧 `SMOKE_FAIL`（非空内容）」「旧 `SMOKE_PASS`」三种现场；① 运行态目录预置新鲜账本锁文件（等锁上限由测试注入缩短）；② 账本路径被同名目录占据；③ 预置锁文件但不传 `--env`；④ 预置锁文件且无活跃提案 | `smoke --env prod --format json`（③ 为 `smoke --format json`，④ 去掉 `logos/.openlogos-guard`） | ①② 退出码 1、`SMOKE_LEDGER_WRITE_FAILED`、`details.stage=="ledger"`、`details.gate_result` 为本次门禁结论、`details.reason` 非空；两种 smoke 标记的存在性与字节、账本字节均与执行前一致；stderr 只有一份 JSON envelope（无未捕获异常）。③④ 不需要写账本，输出、退出码与标记行为与修复前一致，锁文件与账本均未被触碰 |
| UT-S19-70 | 账本已写、标记阶段失败按快照恢复 | EX-19.21 | 有登记表、合法 prod marker；账本预置一条他人 smoke 记录；① 旧 `SMOKE_FAIL`（非空内容）、本次 PASS，注入「写 `SMOKE_PASS` 成功、删除 `SMOKE_FAIL` 抛 `EACCES`」；② 旧 `SMOKE_PASS`（非空内容）、本次 FAIL，注入「写 `SMOKE_FAIL` 成功、删除 `SMOKE_PASS` 抛错」；③ 写目标标记本身失败（提案目录置为只读，非 root） | `smoke --env prod --format json` | 三种情形均退出码 1、`SMOKE_LEDGER_WRITE_FAILED`、`details.stage=="marker"`、`details.rollback=="complete"`、`details.rollback_problems` 为 `[]`；两种标记的存在性与字节与执行前逐字一致（不存在两种标记并存）；账本字节与执行前一致——本次行已撤销，预置的他人记录逐字节保留 |
| UT-S19-71 | 恢复失败如实报告、不让二次异常逃逸 | EX-19.21 | 在 UT-S19-70 ① 的现场上再注入恢复动作失败：Ⓐ 写回旧 `SMOKE_FAIL` 失败；Ⓑ 撤销本次账本行时账本锁等待超时 | `smoke --env prod --format json` | 仍只输出一份结构化错误 `SMOKE_LEDGER_WRITE_FAILED`、退出码 1；`details.rollback=="incomplete"`，`details.rollback_problems` 点名未恢复的位置（Ⓐ 为 `SMOKE_FAIL` 路径，Ⓑ 为 `deployments.jsonl`）及原因；能恢复的其余项已恢复；进程不以未捕获异常退出 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S19-25 | 部署后 HEAD 改变仍记录实际部署版本并得到已验证事实 | S19 环境节 Step S1～S11；EX-19.16 | 真实 CLI；登记表含 prod；活跃提案需部署需 smoke；runner 读 `OPENLOGOS_SMOKE_ENV` 并按读到的值写 `target_environment` | ① HEAD=R1 时 `deploy-done --env prod --ref R1`；② 提交 R2；③ `smoke --env prod --format json` | ③ 写 `SMOKE_PASS`；JSON `environment_evidence` 为 `env_evidence=declared`、`deploy_env_confirmed=true`、`ref`=R1、`verified=true`；账本末行 smoke 记录 `ref=R1`、`observed_head=R2` |
| ST-S19-26 | 参数与 marker 都为 prod、runner 实际验证 test | EX-19.14 | 同上，但 runner 固定写 `target_environment: test` | ① `deploy-done --env prod --ref HEAD`；② `smoke --env prod` | 门禁 FAIL、原因 `SMOKE_ENV_EVIDENCE_MISMATCH`、写 `SMOKE_FAIL`、退出码 1；账本 `env_evidence=mismatch`、`verified=false`；`env show prod` 的 `last_smoke.verified=false` |
| ST-S19-27 | 截断 marker 拒绝与重新落标恢复 | EX-19.12 | 同 ST-S19-25 的环境 | ① `deploy-done --env prod --ref HEAD`；② 把 `DEPLOY_DONE` 截断为前 10 字节；③ `smoke --env prod`；④ 再次 `deploy-done --env prod --ref HEAD`；⑤ `smoke --env prod` | ③ `SMOKE_DEPLOY_MARKER_INVALID`、命令未运行、无 smoke marker、账本无 smoke 行；⑤ 正常运行并写 `SMOKE_PASS`、`verified=true` |
| ST-S19-28 | 真实 CLI 下账本锁占用导致的写入失败与恢复后重跑 | S19 环境节 Step S9～S11；EX-19.20 | 同 ST-S19-25 的环境 | ① `deploy-done --env prod --ref HEAD`；② 在运行态目录预置新鲜账本锁文件后 `smoke --env prod --format json`；③ 删除锁文件后再次 `smoke --env prod --format json`；④ `env show prod --format json` | ② 退出码 1、`SMOKE_LEDGER_WRITE_FAILED`、`stage=="ledger"`，提案目录无 `SMOKE_PASS` / `SMOKE_FAIL`，账本只有 ① 的 deploy 行；③ 门禁 PASS、写 `SMOKE_PASS`，账本新增一行 smoke 记录且 `verified=true`；④ `last_smoke` 为 ③ 的记录 |

### 追溯与覆盖

- `DEPLOY_DONE` 分类与拒绝：UT-S19-58、UT-S19-59、UT-S19-60、UT-S19-61、ST-S19-27。
- 环境证据与注入：UT-S19-62、UT-S19-64、ST-S19-26。
- 版本继承与已验证：UT-S19-63、ST-S19-25。
- 环境解析失败：UT-S19-65；无登记表与无活跃提案零回归：UT-S19-66。
- 结果新鲜度（旧结果不得嫁接到新部署）：UT-S19-67。
- 增量修正（来源变更 fix-environment-registry-review-gaps，决策 C01、C02）：错误 `details`：UT-S19-68；账本先写、标记后写与失败补偿：UT-S19-69、UT-S19-70、UT-S19-71、ST-S19-28。

### 自动化与证据要求

- 「标记阶段失败」与「恢复失败」通过对 smoke 标记写入、删除与账本撤销的依赖注入构造，不依赖宿主权限；只读目录、权限 000 两类夹具在 root 下按既有口径 skip 并写明原因。
- 「命令未运行」以 runner 夹具的运行痕迹文件不存在取证；「零副作用」以提案目录 marker 集合与账本字节前后比对取证。
- 沙箱模式用例沿用既有沙箱测试的一次性 `sandbox_root` 口径，在嵌套沙箱等不具备能力的环境中按既有 skip 口径处理并写明原因。

## S19 smoke 部署身份核对测试（environment-deploy）

> 覆盖场景 `core-S19-smoke-gate.md`「smoke 部署身份核对（environment-deploy）」与 EX-19.19（修订）、EX-19.22～EX-19.24，功能规格 §2.93.4，`spec/environments.md` §4.2「部署身份核对」、§5.1、§5.2。既有 S19 用例（含 UT-S19-66 的无登记表零回归）不变。测试实现必须写入 OpenLogos reporter（`logos/resources/verify/test-results.jsonl`），测试名包含对应 ID，`scenario_id="S19"`；账本记录以直接写入合法 deploy 行的方式构造（不依赖 `openlogos deploy` 的实现），全部在一次性临时项目中执行。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S19-72 | 提案部署身份被后续部署取代时拒绝 | EX-19.22、EX-19.23 | 有登记表含 prod 且 prod 配置了 `deploy`（部署执行已启用）；活跃提案既有前置满足，`DEPLOY_DONE` 为合法 JSON（`deploy_id=d1`、`environment=prod`、`ref=R1`）；账本中 prod 依次有：① `d1` 之后一条 `deploy_id=d2`、`channel=version`、`result=done`、`ref=R2` 的记录；② `d1` 之后一条 `result=failed` 的记录；③ `d1` 之后一条 `result=unknown` 的记录；④ 对照：账本最新记录就是 `d1`；⑤ 对照：`DEPLOY_DONE` 为旧空格式、账本有 `d2`；⑥ 对照：账本中 prod 没有任何 deploy 记录；⑦ 对照（部署执行未启用）：登记表中没有任何 `deploy`，账本只有 `deploy-done` 写出的记录，且 `d1` 之后另有一条 `deploy-done` 写出的 prod 记录 | `smoke --env prod --format json`，runner 全部声明 prod 并通过 | ①②③ `SMOKE_DEPLOY_SUPERSEDED`、退出码 1，`error.details.marker.deploy_id=d1`、`error.details.latest.deploy_id` 为该后续记录；`smoke.command` 未运行，`SMOKE_PASS` / `SMOKE_FAIL`、`DEPLOY_DONE` 与账本字节前后一致；④ 门禁 PASS、`verified=true`；⑤⑥ 不做核对，沿用既有口径（⑤ `deploy_env_confirmed=false`、⑥ 按 marker 判定）；⑦ 不做核对、不报 `SMOKE_DEPLOY_SUPERSEDED`，输出、退出码与账本写入与修复前逐字一致 |
| UT-S19-73 | 无活跃提案时以账本记录为部署身份 | EX-19.19（修订）、EX-19.24 | 有登记表含 prod 且 prod 配置了 `deploy`（部署执行已启用）；无 `logos/.openlogos-guard`；账本中 prod 最近一条 deploy 记录分别为：① `result=done`、`ref=R2`、`slug=null`；② `result=done`、`ref=null`、`ref_source=unknown`；③ `result=failed`；④ 无任何 deploy 记录；runner 全部声明 prod 并通过 | `smoke --env prod --format json` | ① `environment_evidence.deploy_id`、`ref` 取自该记录，`deploy_env_confirmed=true`、`verified=true`、`ledger_written=true`；账本新增 smoke 记录 `slug=null`、`ref=R2`；② `deploy_env_confirmed=true`、`ref=null`、`verified=false`；③ `deploy_env_confirmed=false`、`verified=false`；④ `deploy_id`、`ref` 为 null，`deploy_env_confirmed=false`；四种情形都不写任何提案标记；对照（部署执行未启用）：⑤ 无登记表；⑥ 登记表中没有任何 `deploy`、账本只有 `deploy-done` 写出的 prod 记录——同样操作的 JSON 输出（含 `environment_evidence` 字段集与取值）、退出码与账本字节都与修复前逐字一致，不写账本；⑦ 删除 prod 的 `deploy` 配置但账本保留 `openlogos deploy` 写出的记录时仍按启用口径处理 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S19-29 | 提案落标后被版本发布取代、提案通道重新部署后恢复 | S19 部署身份核对 Step 4a；EX-19.22 | 真实 CLI；登记表含 prod；活跃提案需部署需 smoke；runner 读 `OPENLOGOS_SMOKE_ENV` 并写 `target_environment` | ① `deploy-done --env prod --ref HEAD`；② 向账本追加一条同环境、`channel=version`、`result=done`、另一 commit 的合法 deploy 记录（模拟版本通道发布）；③ `smoke --env prod --format json`；④ 再次 `deploy-done --env prod --ref HEAD`；⑤ `smoke --env prod --format json` | ③ `SMOKE_DEPLOY_SUPERSEDED`、退出码 1、零副作用；⑤ 门禁 PASS、`verified=true`，账本新增的 smoke 记录 `deploy_id` 等于 ④ 写入的 `DEPLOY_DONE.deploy_id` |

### 追溯与覆盖

- 提案部署身份被取代（版本通道发布、后续失败或结果未知）：UT-S19-72、ST-S19-29。
- 无活跃提案的部署身份与已验证口径：UT-S19-73。
- 与 `openlogos deploy` 的端到端衔接（真实版本通道部署后 smoke 被拒绝）由 `core-S42-test-cases.md` 与安装态 SMOKE-core-256 覆盖。

## S19 按模块限定 smoke 与 next 带 --env 测试（module-scoped-env-smoke）

> 覆盖场景 `core-S19-smoke-gate.md`「按模块限定 smoke（module-scoped-env-smoke）」，功能规格 §2.98.4、§2.98.6、§2.98.7，`spec/environments.md` §14.3、§14.5～§14.7，`spec/test-results.md`「按模块限定 smoke 范围的运行约定」，`spec/cli-json-output.md`「smoke / env / next 按模块区分增量」，proposal-r1 F2。既有 S19 用例（含无登记表零回归）不变。测试实现必须写入 OpenLogos reporter，测试名包含对应 ID，`scenario_id="S19"`；「标记不变」以调用前后提案目录字节快照取证。
>
> **夹具 MM**：`mktemp -d` 一次性 git 项目，`logos-project.yaml` 登记 `core`（launched，不声明 `deployment_gates`）与 `team`（initial，`deployment_gates.team.environments: [team-prod]`）；登记表 `logos/environments.yaml` 含 `test`、`prod`、`team-prod`（别名 `Team-Production`），`team-prod` 配置 `deploy`（script，夹具内记录型脚本）；smoke 规格为 `core-smoke-test-cases.md`、`team-smoke-test-cases.md` 与全局 `shared-smoke-test-cases.md`；`smoke.command` 与 `smoke.modules.team.command` 为两个记录型 runner（把被调用的模块、`OPENLOGOS_SMOKE_MODULE`、`OPENLOGOS_SMOKE_ENV` 写入项目外一次性调用日志，并为各自模块用例写结果）。**夹具 S1**：单模块项目带同一登记表；**夹具 M0**：同 MM 但不写任何 `deployment_gates` 与 `smoke.modules`。「零回归基准」为修改前（0.16.9）CLI 对同一输入的实测输出，入库为夹具，不在测试内复述。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S19-74 | 最终应覆盖集合 S 的构成（delta-r1 F2；smoke-scope-isolated-modules） | §14.5 | MM（`smoke.modules.team.command` 已配置，team 为独立 smoke 模块；core 不是）；变体 P：team 活跃提案（提案上下文），本提案修改了 `core-smoke-test-cases.md` 中的用例 X；变体 V：core 活跃提案修改了 core 用例 Y，且无 team 活跃提案，执行 `smoke --env team-prod`（版本上下文）；变体 N：无活跃提案、不传 `--env` | 计算三种变体的应覆盖集合 | P：S = team 前缀规格的全部 `SMOKE-*` ∪ {X}，不含其他 core 用例，也不含不带前缀的 `shared-smoke-test-cases.md` 用例（team 为独立模块）；V：S = team 前缀规格的全部 `SMOKE-*`，不含 Y——不读取 core 提案的变更用例，也不回退读取全局 guard；N：全部用例 |
| UT-S19-75 | 未触达的其他模块结果忽略并计数 | §14.5 | 变体 P；runner 另输出两条**未被本提案修改**的 core 用例结果与一条未定义 ID | `smoke --env team-prod --format json` | `scope.out_of_scope_result_count=2`，两条 core 结果不计入覆盖与门禁；未定义 ID 按既有规则判定 |
| UT-S19-76 | 命令选择与注入 | §14.5 | MM；变体 A：`smoke.modules.team` 只写 `command`；变体 B：另写 `result_path`；变体 C：不配置 `smoke.modules.team` | team 提案执行 `smoke --env team-prod`；无提案不传 `--env` | A：执行 team 命令，结果路径与报告路径回落项目级，调用日志 `OPENLOGOS_SMOKE_MODULE=team`；B：读写 B 的结果路径；C：执行项目级命令，`scope.command_source="project"`，team 不是独立 smoke 模块（smoke-scope-isolated-modules），应覆盖用例为全部规格（无其他独立模块可扣除）；不限定模块时不注入 `OPENLOGOS_SMOKE_MODULE` |
| UT-S19-77 | 未登记模块 id 警告 | §14.5 | `smoke.modules.portal`（未登记） | `smoke --format json` | `diagnostics` 含 `smoke_module_unknown`，该项被忽略，门禁不受影响 |
| UT-S19-78 | 未声明环境的模块按无登记表；他模块环境按归属路由（delta-r1 F1） | §14.3、§14.4 | MM；core 活跃提案已落标（`DEPLOY_DONE.environment=null`）；账本中 team-prod 最近一条为 `result=done` 的版本通道 deploy 记录 | ① `smoke`（不传 `--env`）；② `smoke --env team-prod --format json` | ① 照常执行项目级命令，不做环境证据门禁与部署身份核对，不写部署账本；② 不报 `ENV_MODULE_MISMATCH`：执行 team 命令，`scope.module="team"`、`scope.context="version"`，部署身份取自该账本记录，core 提案目录字节不变（core 已落标这一事实不改变路由）；core 提案 `deploy-done --env team-prod` 的拒绝见 UT-S21-20 |
| UT-S19-79 | 版本上下文不读写提案标记（proposal-r1 F2） | §14.3 | MM；core 活跃提案处于 ready-to-deploy（无 `DEPLOY_DONE`）；账本中 team-prod 最近一条为 `channel=version`、`result=done` 的 deploy 记录 | `smoke --env team-prod --format json` | 不报 `SMOKE_DEPLOY_NOT_DONE`；执行 team 命令；`scope.module="team"`、`scope.context="version"`；`environment_evidence` 的 `deploy_id`、`ref` 取自该账本记录，`ledger_written=true`、账本 smoke 行 `slug=null`；core 提案目录字节不变（无 `SMOKE_PASS` / `SMOKE_FAIL`） |
| UT-S19-80 | JSON `scope` 与报告「范围」行；未启用不输出 | §14.6 | MM 与 M0、S1 | `smoke --env team-prod --format json` 与报告；M0、S1 执行 `smoke --env test` | MM：`scope` 七个字段齐全、报告 Summary 含「范围」行；M0、S1：JSON 与报告与零回归基准逐字节相同（无 `scope`、无「范围」行） |
| UT-S19-81 | next --auto 带 --env | §14.7 | 活跃提案处于 ready-to-smoke；`DEPLOY_DONE` 依次为：合法且 `environment="test"`、合法且 `environment=null`、0 字节旧格式、不可读 | `next --auto --format json` | 第一种 `auto_execute.command="openlogos smoke --env test"`；其余三种为 `"openlogos smoke"`；字段集合与类型不变；不传 `--auto` 时不输出 `auto_execute` |
| UT-S19-82 | 跨模块变更用例的结果保留并参与判定（delta-r1 F2） | §14.5 | 变体 P（team 提案修改了 core 用例 X）；runner 另输出若干未触达 core 用例结果 | 三次运行，X 的结果分别为 pass、fail、不输出 | pass：X 计入覆盖，`gate.result=PASS`（其余条件满足时）；fail：X 进入 `failed_cases`，`gate.result=FAIL`；不输出：X 进入 `uncovered_cases`，门禁不通过；三次中 X 都不计入 `scope.out_of_scope_result_count`，未触达 core 结果始终被忽略并计数 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S19-30 | core 有活跃提案时 team 版本部署与 team smoke 完整链（proposal-r1 F2） | Step 1～11 | 真实 CLI；MM；core 有活跃提案且尚未部署（`proposal_step` 为 ready-to-deploy） | ① `deploy --env team-prod --ref <commit>`；② `smoke --env team-prod --format json`；③ `status --format json` | ① 版本通道成功；② 通过，执行 team 命令且只覆盖 team 前缀用例（team 为独立 smoke 模块，不带前缀的全局规格不计入，smoke-scope-isolated-modules），`scope.context="version"`，部署身份取自 ① 的账本记录；③ core 提案 `proposal_step` 仍为 ready-to-deploy；core 提案目录在 ①② 前后字节不变（无 `DEPLOY_DONE` / `SMOKE_PASS` / `SMOKE_FAIL`） |
| ST-S19-31 | 未启用零回归与 next 修复 | §14.1、§14.7 | 真实 CLI；S1、M0 | ① 依次 `deploy-done --env test`、`smoke --env test --format json`；② ready-to-smoke 时 `next --auto --format json` | ① 与零回归基准逐字节相同；② `auto_execute.command="openlogos smoke --env test"`，照此命令执行成功 |

### 覆盖度校验

- 应覆盖集合 S（含版本上下文不读无关提案变更用例）、范围外结果、跨模块变更用例结果保留：UT-S19-74、UT-S19-75、UT-S19-82。
- 命令选择与注入、未登记警告：UT-S19-76、UT-S19-77。
- 未声明模块、他模块环境按归属路由（F1）：UT-S19-78。
- 版本上下文隔离（F2）：UT-S19-79、ST-S19-30。
- JSON 与报告、未启用零回归：UT-S19-80、ST-S19-31。
- next 带 --env：UT-S19-81、ST-S19-31。

## S19 独立 smoke 模块的应覆盖集合测试（smoke-scope-isolated-modules）

> 覆盖场景 `core-S19-smoke-gate.md`「按模块限定 smoke（module-scoped-env-smoke）」异常「独立模块与不带前缀的规格」「只配置路径覆盖的模块」，功能规格 §2.98.6，`spec/environments.md` §14.5，`spec/test-results.md`「应覆盖用例」，决策 C01，proposal-r1 F1。既有 UT-S19-74～UT-S19-82、ST-S19-30～ST-S19-31 作为回归守护（UT-S19-74、UT-S19-76、ST-S19-30 已按独立模块规则修订预期）。测试实现必须写入 OpenLogos reporter（`logos/resources/verify/test-results.jsonl`），测试名包含对应 ID，`scenario_id="S19"`。
>
> **夹具 RL**（runlogos 形态）：`mktemp -d` 一次性 git 项目，`logos-project.yaml` 登记 `core`（launched）与 `team`（initial，`deployment_gates.team.environments: [team-prod]`）；登记表含 `test`、`team-prod`（script 方式 `deploy`）；`logos.config.json` 的 `smoke.command` 为项目级记录型 runner，`smoke.modules.team.command` 为 team 记录型 runner；smoke 规格为 `core-smoke-test-cases.md`、`team-smoke-test-cases.md`，以及两份不带任何模块前缀、ID 段不统一的 core 发布规格（如 `official-release-package-1-0-4.md` 含 `SMOKE-official104-01`、`release-1-0-3-rebuild-5.md` 含 `SMOKE-rebuild5-01`）。项目级 runner 为全部用例写结果，team runner 只为 team 前缀用例写结果。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S19-83 | 独立模块判定 | §14.5 | 夹具 RL 的 `smoke.modules` 依次为：`team: {command}`；`team: {command: ""}`（空串）；`team: {result_path}`；`team: {report_path}`；`team: {}`；`portal: {command}`（portal 未登记） | 调用独立模块判定函数 | 只有第一种 team 为独立 smoke 模块；空串、只写路径、空对象均不是；未登记的 portal 不是独立模块（另报 `smoke_module_unknown`）；core 在所有变体下都不是 |
| UT-S19-84 | 独立模块不计入不带前缀的规格 | §14.5 | 夹具 RL；core 有活跃提案且尚未部署，账本中 team-prod 最近一条为版本通道 `result=done` 的 deploy 记录 | `smoke --env team-prod --format json`（版本上下文） | 应覆盖集合 = `team-` 前缀用例；`summary.defined_count` 等于 team 前缀用例数；两份不带前缀的发布规格与 core 规格不计入，`uncovered_cases` 为空，`gate.result=PASS`；`scope.reasons` 含 `isolated_module`、`scope.command_source="module"` |
| UT-S19-85 | 非独立模块计入不带前缀的规格 | §14.5 | 夹具 RL；core 活跃提案已落标（`DEPLOY_DONE.environment=null`）；变体 ①：项目级 runner 写全部结果；变体 ②：项目级 runner 不写 `SMOKE-official104-01`；变体 ③：项目级 runner 把 `SMOKE-official104-01` 写为 `fail` | `smoke --format json`（目标模块 core） | 应覆盖集合 = core 前缀用例 ∪ 两份不带前缀的发布用例，不含 team 前缀用例；①：PASS；②：`SMOKE-official104-01` 进入 `uncovered_cases`，门禁不通过；③：进入 `failed_cases`，`gate.result=FAIL`；三者中 team 前缀结果都计入 `scope.out_of_scope_result_count`，不带前缀的结果都不计入 |
| UT-S19-86 | 只配置路径覆盖的模块不是独立模块（proposal-r1 F1） | §14.5 | 夹具 RL，另加 `smoke.modules.core` 分别为：只写 `report_path`；只写 `result_path`；空对象 `{}`；core 活跃提案已落标；项目级 runner 把 `SMOKE-official104-01` 写为 `fail` | `smoke --format json` | 三种变体下 core 都不是独立模块：执行项目级 runner（`scope.command_source="project"`，`scope.reasons` 不含 `isolated_module`）；应覆盖集合仍含两份不带前缀的发布用例；`SMOKE-official104-01` 进入 `failed_cases`，`gate.result=FAIL`，不计入 `scope.out_of_scope_result_count`；只写 `report_path` / `result_path` 时报告、结果读写各自配置的路径 |
| UT-S19-87 | 无独立模块时每个模块为全部规格 | §14.5 | 夹具 RL 去掉 `smoke.modules`（team 仍声明 `team-prod`，按模块区分仍启用）；或 `smoke.modules.team` 只写 `report_path` | team 版本上下文 `smoke --env team-prod`；core 提案 `smoke` | 两个模块的应覆盖集合都等于全部 smoke 规格（core、team 前缀与不带前缀的发布用例）；与引入独立模块规则前相比，没有任何模块的应覆盖集合缩小 |
| UT-S19-88 | 变更用例 C 跨独立模块照旧计入 | §14.5 | 夹具 RL；team 活跃提案（提案上下文）已落标 team-prod，本提案修改了不带前缀的 `official-release-package-1-0-4.md` 中的 `SMOKE-official104-01` 与 core 用例 X；三次运行中这两条结果分别为 pass、fail、不输出 | `smoke --env team-prod --format json` | 应覆盖集合 = team 前缀用例 ∪ {`SMOKE-official104-01`, X}；pass：计入覆盖，`gate.result=PASS`；fail：进入 `failed_cases`，`FAIL`；不输出：进入 `uncovered_cases`；三次中这两条都不计入 `scope.out_of_scope_result_count`，未触达的其他不带前缀用例与 core 用例始终被忽略并计数 |
| UT-S19-89 | 多个独立模块互相扣除 | §14.5 | 夹具 RL 另登记模块 `portal`，配置 `smoke.modules.portal.command` 与 `portal-smoke-test-cases.md` | 分别以 core、team、portal 为目标模块计算应覆盖集合 | team：只含 `team-` 前缀；portal：只含 `portal-` 前缀；core：全部规格扣除 `team-` 与 `portal-` 前缀规格（含不带前缀的发布用例）；最长匹配下 `team-x-` 之类前缀按已登记模块 id 归属 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S19-32 | runlogos 形态端到端：独立 team 与非独立 core 各自 smoke | Step 1～11 | 真实 CLI；夹具 RL；core 有活跃提案且尚未部署 | ① `deploy --env team-prod --ref <commit>`；② `smoke --env team-prod --format json`；③ 补齐 core 部署前置后 `deploy-done` 与 `smoke --format json`，项目级 runner 先输出全部结果、再改为把一条不带前缀的发布用例写为 `fail` 重跑 | ② 通过，只执行 team 命令、只覆盖 team 前缀用例，不带前缀的发布规格不计入；core 提案目录字节不变；③ 第一次通过且应覆盖集合含全部不带前缀的发布用例，第二次 `gate.result=FAIL`、该用例进入 `failed_cases`；team 前缀结果两次都计入 `scope.out_of_scope_result_count` |

### 覆盖度校验

- 独立模块判定（有效非空 `command`；空串、只写路径、空对象、未登记 id 均不是）：UT-S19-83、UT-S19-86。
- 独立模块只覆盖自身前缀，不被不带前缀的规格拖住：UT-S19-84、ST-S19-32。
- 非独立模块计入不带前缀的规格，缺结果 uncovered、fail 阻断：UT-S19-85、UT-S19-86、ST-S19-32。
- 无独立模块时全量、范围不缩小：UT-S19-87。
- 变更用例 C 跨独立模块计入：UT-S19-88。
- 多个独立模块互相扣除、最长匹配：UT-S19-89。

## S19 多模块项目模块冒烟报告测试（module-scoped-phase-reports）

> 覆盖场景 `core-S19-smoke-gate.md`「多模块项目写模块冒烟报告（module-scoped-phase-reports）」（EX-MR.1～EX-MR.4），功能规格 §2.99.2、§2.99.3、§2.99.6，`spec/environments.md` §14.9，`spec/test-results.md`「多模块项目的模块验收报告与模块冒烟报告（module-scoped-phase-reports）」，决策 C01。既有 UT-S19-74～UT-S19-89、ST-S19-30～ST-S19-32 作为回归守护。测试实现必须写入 OpenLogos reporter（`logos/resources/verify/test-results.jsonl`），测试名包含对应 ID，`scenario_id="S19"`。
>
> **夹具 MS**（runlogos 形态）：`mktemp -d` 一次性 git 项目，`logos-project.yaml` 登记 `core`（launched）与 `team`（initial，`deployment_gates.team.environments: [team-prod]`）；登记表含 `test`、`team-prod`（script 方式 `deploy`）；`logos.config.json` 的 `smoke.command` 为项目级记录型 runner，`smoke.modules.team.command` 为 team 记录型 runner；smoke 规格为 `core-smoke-test-cases.md`、`team-smoke-test-cases.md`。**夹具 M0**：同样两个模块，但不声明 `deployment_gates` 与 `smoke.modules`（按模块区分未启用），另登记第三个 initial 模块 `portal`。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S19-90 | 目标模块确定为 initial 模块时写模块冒烟报告 | §2.99.6 | 夹具 MS；无活跃提案；账本中 team-prod 最近一条为版本通道 `result=done` 的 deploy 记录；team runner 写 team 用例全 pass | `smoke --env team-prod --format json` | 写出 `logos/resources/verify/team-smoke-report.md`：Summary 含「模块 / Module」行 `team`，Defined 等于 S(team) 的用例数，`**Gate 3.8**` 为 `**PASS**`；共用 `smoke-report.md` 按既有规则写入；JSON 字段集合与修改前相同 |
| UT-S19-91 | 未启用按模块区分时为每个 initial 模块写 | §2.99.6 | 夹具 M0；core 活跃提案已落标；项目级 runner 写全部结果 | `smoke --format json` | 写出 `team-smoke-report.md` 与 `portal-smoke-report.md`，统计与 Gate 均等于项目级结果，「模块」行分别为 `team`、`portal`；不写 `core-smoke-report.md` |
| UT-S19-92 | 已启用但回落项目级时不写 | §2.99.6、EX-MR.1 | 夹具 MS；无活跃提案，不传 `--env`（`fallback_reason=no_env_no_proposal`）；已有一份旧 `team-smoke-report.md` | `smoke --format json` | `scope.mode=project`；只写共用报告；旧 `team-smoke-report.md` 内容与修改时间不变 |
| UT-S19-93 | launched 目标模块不写 | §2.99.6、EX-MR.2 | 夹具 MS；core 活跃提案已落标 | `smoke --format json`（目标模块 core） | 不写任何 `<m>-smoke-report.md`；`SMOKE_PASS` / `SMOKE_FAIL` 按既有规则写入 |
| UT-S19-94 | Gate FAIL 同样写，且只读 Gate 行判定 | §2.99.3、EX-MR.3 | 夹具 MS 版本上下文；team runner 把一条 team 用例写为 `fail`，错误信息含 `PASS` | `smoke --env team-prod` 后对 team 派生 `phase_progress` | `team-smoke-report.md` 的 Gate 行为 FAIL；team 的 phase.3-8 未完成 |
| UT-S19-95 | Gate 判定前被拒绝不写 | §2.99.6、EX-MR.4 | 夹具 MS；变体 ①：`--env prod`（不属于 team 的已登记环境，team 有活跃提案）→ `ENV_MODULE_MISMATCH`；②：team 声明含失效引用 → `ENV_GATE_REFERENCE_UNKNOWN`；③：账本无 team-prod 的 deploy 记录导致部署身份核对失败 | 执行 smoke | 三个变体都以既有错误码退出，不创建、不修改 `team-smoke-report.md` |
| UT-S19-97 | 共用报告路径指向其他模块凭据时不越权（delta-r1 F1） | §2.99.2、§2.99.6、EX-MR.5 | 夹具 MS；`smoke.report_path` 配置为 `logos/resources/verify/team-smoke-report.md`；team 已有 Gate PASS 的模块验收报告与模块部署报告、尚无模块冒烟报告；core 活跃提案已落标；项目级 runner 写 core 用例全 pass（team 用例未执行） | ① `smoke --format json`（目标模块 core）；② 对 team 派生 `phase_progress`；③ `launch team`；④ 变体：该路径上预先放一份旧版 CLI 写入的共用格式 PASS 报告（无「模块」行）后重复 ②③ | ① `gate.result=PASS`，`report_path="logos/resources/verify/smoke-report.md"`，`diagnostics` 含 `smoke_report_path_reserved`（点名 `smoke.report_path`）；`team-smoke-report.md` 不存在；② team 的 phase.3-8 未完成；③ 拒绝；④ 预置文件内容不变，② 仍未完成、③ 仍拒绝 |
| UT-S19-98 | 模块级 report_path 与本模块凭据同名时的写入次序 | §2.99.6、EX-MR.6 | 夹具 MS；`smoke.modules.team.report_path` 为 `logos/resources/verify/team-smoke-report.md`；登记表存在，环境证据收尾会重写共用报告；版本上下文 | `smoke --env team-prod --format json` | 共用报告写到默认路径（含环境证据收尾的重写），`diagnostics` 含 `smoke_report_path_reserved`；`team-smoke-report.md` 恰被模块报告 writer 写入一次，「模块」行为 team、Gate 等于最终 Gate 3.8 |
| UT-S19-99 | 单模块项目不设保留路径 | §2.99.2 | 只登记 `core` 的单模块项目；`smoke.report_path` 为 `logos/resources/verify/core-smoke-report.md` | `smoke --format json` | 共用报告照旧写到 `core-smoke-report.md`，无 `smoke_report_path_reserved`；输出与修改前逐字节相同 |
| UT-S19-96 | 写入白名单含模块冒烟报告 | §2.99.9 | 夹具 MS 启用 smoke 沙箱，allow 列表为默认 | `smoke --env team-prod` | 沙箱允许写入 `logos/resources/verify/team-smoke-report.md`，无越界诊断 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S19-33 | 端到端：team 模块冒烟报告 PASS 后离开 3-8 | Step 1～5 | 真实 CLI；夹具 MS；core 有尚未部署的活跃提案；team 前序阶段齐全，已有 Gate PASS 的 `team-acceptance-report.md` | ① `deploy --env team-prod --ref <commit>`；② `smoke --env team-prod --format json`；③ `status --format json` | ① 版本通道成功并写出 `team-deployment-report.md`；② 通过，写出 Gate PASS 的 `team-smoke-report.md`；③ team 的 phase.3-7、3-8 均为 done；core 提案目录字节不变、`proposal_step` 不变 |

### 覆盖度校验

- 目标模块确定 / 未启用 / 回落项目级三种情形：UT-S19-90、UT-S19-91、UT-S19-92。
- launched 目标模块与判定前拒绝不写：UT-S19-93、UT-S19-95。
- FAIL 照写与 Gate 行判定：UT-S19-94。
- 写入白名单：UT-S19-96。
- 保留路径与写入次序（delta-r1 F1）：UT-S19-97、UT-S19-98、UT-S19-99。
- 端到端推进：ST-S19-33。

## S19 smoke 验收历史留存测试（verification-history）

> 覆盖场景 `core-S19-smoke-gate.md`「smoke 验收历史留存（verification-history）」（Step 1～8、EX-19H.1～EX-19H.4），功能规格 §2.104，`spec/test-results.md`「验收历史留存（verification-history）」。
>
> **夹具 SH**：`mktemp -d` 一次性 git 项目，单模块 `core`（launched），已合并 smoke 规格定义 SMOKE-core-901、SMOKE-core-902；`smoke.command` 指向记录型 runner（按环境变量决定每条结果 pass / fail、可在 `detail` 中写入敏感占位值 `SECRET-PLACEHOLDER-7f3a`）；登记表含 `test` 环境（script 方式 `deploy`），活跃提案 `sh-demo` 已部署到 test 并落账。变体 SH-noreg：无环境登记表。变体 SH-reuse：不配置 `smoke.command`，结果文件预先写好。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S19-100 | 连续两次 smoke 后两条历史含环境与 deploy_id | §2.104.3 | 夹具 SH；第一次 SMOKE-core-902 失败，第二次全部通过 | 两次 `smoke --env test --format json`（记下两次 `data.history.run_id`），再 `history list --kind smoke --format json` 与 `history show <第一次的 run_id>` | 两条 `kind=smoke` 记录，`environment="test"`、`deploy_id` 等于账本中本提案最近一次 deploy；列表按 `started_at` 倒序，第二次（PASS）在前、第一次（FAIL）在后；按第一次的 run_id 查看得到 `failed_ids=["SMOKE-core-902"]`；提案运行目录各有完整记录 |
| UT-S19-101 | runner detail 的 Git 可见范围 | §2.104.2、EX-19H.4 | 夹具 SH；runner 在 SMOKE-core-901 的 `detail` 写入占位值；两臂：缺省 / `verify.history.raw_in_proposal: false` | 每臂执行一次 `smoke --env test` 后全文搜索占位值 | 两臂中央索引都不含占位值；缺省臂提案运行目录 `results.jsonl` 与 `report.md` 含占位值；关闭臂提案运行目录不含占位值、无 `report.md`，占位值只在 `logos/.openlogos-runtime/verify-runs/<run_id>/` |
| UT-S19-102 | 既有早退仍留历史，空结果不算早退 | §2.104.4、EX-19H.2 | 夹具 SH 的活跃提案不变更任何 smoke 用例；变体 ①：SH-reuse 配置（不配置 `smoke.command`）且结果文件不存在；②：删除全部 smoke 用例规格后运行；③：`smoke.command` 运行后不写任何结果行（CLI 预先创建的空文件保留）；④：`smoke.command` 的 runner 删除 CLI 预先创建的结果文件后以替换方式更新失败（采集时结果文件不存在）并退出 | 分别执行 `smoke --env test --format json`，解析 stdout 与 stderr 信封 | ①②④：stderr 既有错误信封，`error.code` 依次为 `NO_SMOKE_RESULTS`、`NO_SMOKE_CASES`、`NO_SMOKE_RESULTS`，退出码与修改前一致；`error.details.history.index_path` 指向新增记录，`kind=smoke`、`outcome=aborted`、`error_code` 等于 `error.code`、`gate.result=null`；①的 `result_source=reused`、④的 `result_source=executed`；③：不是早退，stdout 成功信封 `gate.result=FAIL`，历史 `outcome=completed`、`uncovered_ids` 含 SMOKE-core-901 与 SMOKE-core-902 |
| UT-S19-103 | 未配置命令时标 reused | §2.104.3、EX-19H.3 | 夹具 SH-reuse | `smoke --env test --format json` | 历史 `result_source="reused"`；结论与既有结果文件一致 |
| UT-S19-104 | 无登记表时沙箱失败改判，报告与历史均为 FAIL | §2.104.5、EX-19H.1 | 夹具 SH-noreg，启用 smoke 沙箱；runner 写全部 pass，并额外产出一项白名单产物，使回收校验失败（沙箱状态 `fail`），结果仍可统计 | `smoke --format json` | 命令 `gate.result=FAIL`；`smoke-report.md` 的 Gate 行为 FAIL；历史 `gate.result=FAIL`；提案运行目录 `report.md` 与 `smoke-report.md` 逐字节相同 |
| UT-S19-105 | smoke 报告与结果文件零回归 | §2.104.11 | 夹具 SH 的全绿、真实失败两种运行；另一变体配置 `smoke.modules.core.report_path` | 各执行一次 `smoke --env test` | `smoke-report.md`（或模块级配置的报告路径）与 `smoke-results.jsonl` 的路径、格式、字节与引入前 golden 一致（有登记表时环境证据改判后只写出一次）；`SMOKE_PASS` / `SMOKE_FAIL` 与部署账本 smoke 摘要的写入不变；JSON 输出除新增 `data.history` 外不变 |
| UT-S19-107 | 不同结果路径、相同报告路径的并发 | §2.104.5、EX-19H.5 | 两模块夹具：`smoke.modules.alpha.result_path` 与 `smoke.modules.beta.result_path` 不同，二者都不配置 `report_path`（回落到同一项目级 `smoke-report.md`）；alpha 的 runner 全部通过，beta 的 runner 让一条用例失败；以测试专用的可注入暂停点（只在测试环境变量开启时生效，例如写完共用报告后等待指定文件出现）让 alpha 停在「已写完共用报告、尚未写报告快照与历史」的位置 | 启动 alpha 的 smoke 直至停在该暂停点（此时共用 `smoke-report.md` 为 alpha 的 PASS）；运行 beta 的 smoke 至结束（覆盖共用报告为 beta 的 FAIL）；再放行 alpha | 两次运行都不被运行锁拒绝；放行后共用 `smoke-report.md` 仍为 beta 的 FAIL（alpha 不再重写共用报告）；alpha 历史 `gate.result=PASS` 且其报告快照 Gate 行为 PASS（若实现从共用路径回读，快照会是 FAIL，用例即失败）；beta 历史与快照均为 FAIL；每个快照与各自命令的 JSON 结论一致 |
| UT-S19-106 | 按 smoke 类型筛选 | §2.104.10 | 夹具 SH 已有 verify 两条、smoke 两条历史 | `history list --kind smoke --format json` | 只返回两条 smoke 记录，按 `started_at` 倒序 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S19-34 | 端到端：smoke 失败轮与通过轮可追溯 | Step 1～8 | 真实 CLI；夹具 SH | ① runner 让 SMOKE-core-902 失败，`smoke --env test`；② 修复后再次 `smoke --env test`；③ `history list --kind smoke`；④ 以第①轮 smoke 输出的 `data.history.run_id` 执行 `history show` | ①写 FAIL 历史、`SMOKE_FAIL`；②写 PASS 历史、`SMOKE_PASS`；③两条按时间倒序，第②轮（PASS）在前；④以第①轮输出的 run_id 查看，给出第①轮的环境、deploy_id、失败用例与完整结果、报告快照 |

### 覆盖度校验

- 两轮留存与查询：UT-S19-100、UT-S19-106、ST-S19-34（UT-S19-107 见下）。
- 自由文本可见范围：UT-S19-101。
- 早退与结果来源：UT-S19-102、UT-S19-103。
- 相同报告路径的并发快照归属：UT-S19-107。
- 报告与最终门禁一致：UT-S19-104。
- 零回归：UT-S19-105。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S19"`，测试名含用例 ID；失败不得写 pass。
- 「零回归」断言读回磁盘字节与引入前 golden 比对；沙箱改判用例断言 JSON 中沙箱状态为 `fail` 且结果仍被统计。

## S19 Windows 公开版升级验收

| ID | 场景 | 前置与操作 | 期望 |
|---|---|---|---|
| UT-S19-108 | 官方源与版本 | 用可控 npm 响应检查升级脚本的调用参数，输入合法或无效的目标版本 | 合法版本以精确包名、版本及官方 registry 全局安装，无效版本在启动 npm 前失败 |
| UT-S19-109 | 用户目录重排 | 一次性 Path 夹具含等价路径引用、多个普通目录与目标目录 | 目标 npm 目录仅出现一次且优先，其他目录与变量引用按原相对顺序保留 |
| ST-S19-35 | Windows 旧版原地升级 | Windows 一次性 prefix 装旧版后安装候选 tarball并启动 CMD | npm 安装前后复用 prefix，直接运行 `openlogos --version` 输出候选版本 |
| ST-S19-36 | Windows 旧入口遮蔽 | 在 Windows 创建旧入口和可修复、不可修复的 Path 夹具，执行同一脚本 | 用户级遮蔽经持久化调整后由新 CMD 调用目标版本。持续遮蔽时提示实际命中的路径和已验证的目标入口，保留原 Path |

用例通过 OpenLogos reporter 记录。真实 Windows 行为由 Windows 回归任务取证。非 Windows 环境可对同一实现的输入校验和路径排序运行局部测试。

## S19 每次发版的 Windows 公网升级就绪验收

> 追溯部署方案「公开 tag 发布的 Windows 公网升级就绪门」及提案 `windows-latest-release-gate` 的 C01、C02。保留 UT-S19-108～UT-S19-109、ST-S19-35～ST-S19-36 作为候选制品回归。

| ID | 场景 | 前置与操作 | 期望 |
|---|---|---|---|
| UT-S19-110 | 双源就绪判定和等待截止 | 用可控时间、registry 和 npm 响应运行就绪检查。变体包含镜像先返回旧版后追平、镜像全程返回旧版、公网探测超时、声明的版本等于目标但实际 npm 安装失败 | 镜像追平后须实际执行 `@latest` 安装并核验新版 CMD 才通过。截止时任一来源未通过即非零退出，保留来源、目标版本、最后观测结果和失败阶段。单次命令超时受总预算限制 |
| UT-S19-111 | 以实际安装与入口裁决 | 用可控安装产物和 CMD 输出检查错误的包名、包版本与 tag 不同、裸命令版本与 tag 不同、裸命令版本正确但命中另一前缀的同名入口 | 各反例均失败。包名及版本、实际入口和裸命令版本全部匹配时才通过，输出对应观察值 |
| UT-S19-112 | 发版任务的依赖与恢复 | 解析 tag 工作流，沿依赖链检查 npm 发布、两个来源的 Windows 验证、Release 公开和官网发布。核对需跨任务保留的制品与发版记录中引用的 tag 和提交 | Release 和官网任务都需要 npm 发布及双源 Windows 验证成功。任一验证失败、取消或跳过时，依赖条件阻止分发。产物与原 tag 绑定，成功的发布任务与后续重试任务分开，复用先前的包、发布说明及校验值 |
| ST-S19-37 | 真实 Windows 从两个公开源原地升级 | 在真实 Windows 为官方 npm、npmmirror 各建独立临时前缀和缓存。每臂从官方源装 `0.16.7`，验证该入口的初始版本，再用本臂源执行 `npm install -g @miniidealab/openlogos@latest` 升级同一前缀。在新 CMD 记录命中的入口并运行裸 `openlogos --version` | 两臂安装前均为 `0.16.7`。升级和 CMD 检查均退出 0，实际包名与目标包一致，包版本和 CMD 输出均等于被验 tag 版本。实际命中的入口解析到对应临时前缀的 `openlogos.cmd`。保存每臂的来源、目标、实际版本和入口，结束后清理临时前缀和缓存。发版运行的目标来自 tag。常规回归可使用当前已公开版本进行只读验证 |

UT 使用可控夹具验证镜像滞后、入口错误和工作流依赖，保持结果可重复。自动化测试通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`，测试名含用例 ID。ST-S19-37 的正式发版证据由该 tag 的 Windows 任务输出，两个来源分别留证。

## S19 smoke runner 发现遍历测试（fix-smoke-runner-discovery-overflow）

> 覆盖场景 `core-S19-smoke-gate.md`「smoke runner / reporter / dispatcher 覆盖检查」中的「runner 发现的遍历规则」第 1～6 条、「Gate 判定补充」中默认 dispatcher 下零 runner 一条，以及 EX-19.25。
>
> **夹具 RD**：`mktemp -d` 一次性项目 `P`（单模块 `core`，launched）。另建项目外的临时目录 `X`，内含 `X/scripts/smoke-linked.sh`（被执行时在 `X/EXECUTED` 写入标记）与若干普通文件。`P` 内放置：
> - 仓内 runner `scripts/smoke-a.js`：写 SMOKE-core-950 的 `pass` 结果，路径取 `OPENLOGOS_SMOKE_RESULT_PATH`；
> - 目录链接 `P/build → X`；
> - 指回祖先的目录链接 `P/loop → P`（旧实现跟随它会无限递归）；
> - 被忽略目录里的 runner `node_modules/pkg/scripts/smoke-ignored.sh`。
>
> 变体如下：
> - **RD-plain**：不含任何链接，另含 `apps/x/scripts/smoke-b.ts`。
> - **RD-filelink**：`scripts/smoke-c.js` 是指向 `X/runner.js`（普通文件）的符号链接；`scripts/smoke-d.js` 是悬空链接。
> - **RD-case**：活跃提案 `rd-demo` 在 `deltas/test/smoke/` 下新增 SMOKE-core-950；变体 RD-case-linked 把这份用例定义放在 `deltas/test/smoke/linked → Y`（`Y` 为项目外目录）里。
> - **RD-merged**：在 RD-case 基础上，把同一 SMOKE-core-950 定义也写入已合并 smoke 规格 `P/logos/resources/test/smoke/core-smoke-test-cases.md`。`smoke` 成功执行路径从已合并规格读取已定义用例，缺少时会以 `NO_SMOKE_CASES` 提前退出。
> - **RD-zero**：在 RD-case 基础上删除 `scripts/smoke-a.js`，唯一 runner 只在 `build → X` 内；`smoke.command` 为 `node scripts/run-smoke.js`；本轮无结果文件。
>
> SMOKE-core-950 为本节夹具专用编号，与 SMOKE-core-900～902 一样不计入正式 smoke 编号序列。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S19-113 | 目录链接不进入 | 遍历规则第 1、2 条 | 夹具 RD | `discoverSmokeRunners(P)` | 返回 `["scripts/smoke-a.js"]`：`build/scripts/smoke-linked.sh` 与 `node_modules/pkg/scripts/smoke-ignored.sh` 都不在其中；`loop → P` 不被进入，调用正常返回，不出现栈溢出或重复路径 |
| UT-S19-114 | 指向文件的 runner 链接照常发现 | 遍历规则第 1 条 | 夹具 RD 叠加 RD-filelink | `discoverSmokeRunners(P)` | 结果含 `scripts/smoke-c.js`（目标为普通文件）；悬空链接 `scripts/smoke-d.js` 不收入且不抛异常；目录链接内的 runner 仍不收入 |
| UT-S19-115 | 单个目录下文件数超过参数上限 | 遍历规则第 3 条、EX-19.25 | `P/scripts/` 为真实子目录。以可注入的目录读取让它的枚举返回合成目录项：249999 个不匹配 runner 命名的普通文件名，加一个 `smoke-wide.sh`。目录项名称不含路径分隔符，也不在磁盘真实创建这些文件；项目根其余部分为空 | 调用 `discoverSmokeRunners(P)` | 正常返回，不抛 `RangeError`，结果恰为 `["scripts/smoke-wide.sh"]`：接口先按路径与名称筛选，再排序去重，输入规模不反映在返回数量中。对照：用修复前的展开写法遍历同一组合成目录项，在把 `scripts/` 子树并入父目录结果时抛 `RangeError: Maximum call stack size exceeded`，证明用例能复现原缺陷 |
| UT-S19-116 | 读不了的子目录跳过 | 遍历规则第 4 条 | 夹具 RD-plain 增加子目录 `locked/`：非 root 用户下真实设为不可读（`chmod 000`）；另以可注入的目录读取让 `locked/` 的枚举抛出 `EACCES`，两种方式各跑一轮（root 用户下只跑注入方式） | `discoverSmokeRunners(P)`；随后 `checkSmokeCoverage(P, …)` | 两轮都不抛异常；其余 runner 照常返回；`checkSmokeCoverage` 正常给出结果，无新增诊断码。结束后恢复权限再清理 |
| UT-S19-117 | 不含链接的项目零回归 | 遍历规则第 2、5 条 | 夹具 RD-plain | 分别用修复后的实现与修复前的实现（测试内保留的 golden 函数或 golden 结果）调用 `discoverSmokeRunners(P)` | 两者结果逐项相同：含 `scripts/smoke-a.js` 与 `apps/x/scripts/smoke-b.ts`，不含被忽略目录里的 runner，顺序一致 |
| UT-S19-118 | 提案用例读取保持既有行为 | 遍历规则「不适用范围」 | 夹具 RD 叠加 RD-case-linked | `extractChangedSmokeIds(P, "rd-demo")`；同一项目调用 `discoverSmokeRunners(P)` | 前者含 SMOKE-core-950（链接子目录里的用例照常读入）；后者仍不含 `build/scripts/smoke-linked.sh`（项目根搜索跳过构建目录链接） |
| UT-S19-119 | 默认 dispatcher 下零 runner 报 `smoke_runner_missing` | Gate 判定补充 | 夹具 RD-zero | `checkSmokeCoverage(P, { command: "node scripts/run-smoke.js" })`；对照 ①：同一项目去掉活跃提案的新增用例；对照 ②：RD-case（仓内保留 `scripts/smoke-a.js`），无结果文件 | 主臂：`runners=[]`，`result="FAIL"`，诊断含 `code="smoke_runner_missing"`、`case_ids=["SMOKE-core-950"]`、`runner_paths=[]`。对照 ①：`result="PASS"`，`diagnostics=[]`。对照 ②：不含 `smoke_runner_missing`，按既有规则报 `smoke_reporter_missing` |
| UT-S19-120 | 一次 verify 只扫描一次项目根 | 遍历规则第 6 条 | 夹具 RD-case，已有结果文件写 SMOKE-core-950 pass；对项目根 runner 搜索计数（spy 或可注入计数器）。变体：切片 checkpoint 模式，SMOKE-core-950 属于 pending 切片，且无结果文件 | 执行一次 verify 数据汇总与 smoke 预检门禁（`collectVerifyData` 及其后的门禁判定） | 项目根 runner 搜索恰好执行 1 次；`data.smoke_precheck` 的 `runners`、`diagnostics`、`result` 与单独调用 `checkSmokeCoverage` 的结果相同。变体：`smoke_precheck` 为 FAIL，但 gate 不因 smoke 预检被阻断（pending 豁免保持）；把该用例改为非 pending 后，gate 为 FAIL，`gate.reason` 为首个阻断诊断码 |
| UT-S19-121 | dispatcher 遍历规则 | 遍历规则第 1～5 条 | 以模块方式导入 `scripts/run-smoke.js` 的遍历与发现函数（作为模块导入时不执行主流程）；夹具 RD 叠加 RD-plain 的 `apps/x/scripts/smoke-b.ts`；另设宽目录臂：与 UT-S19-115 同样让真实子目录 `P/scripts/` 的枚举返回 249999 个不匹配的普通文件名加一个 `smoke-wide.sh`，项目根其余部分为空 | 调用 dispatcher 的 runner 发现 | 主臂返回 `["scripts/smoke-a.js"]`：不进入 `build`、`loop`，不收 `.ts`（dispatcher 扩展名规则），不含 `scripts/run-smoke.js` 自身，按路径排序。宽目录臂正常返回，不抛 `RangeError`，结果恰为 `["scripts/smoke-wide.sh"]` |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S19-38 | 含目录链接的项目中 verify 正常输出 | EX-19.25；遍历规则第 1、6 条 | 真实 CLI（构建后的 `dist/index.js`）；夹具 RD 叠加 RD-case，已合并测试规格与结果账本可让 verify 走到 smoke 预检 | 在 `P` 执行 `openlogos verify --format json`，分别捕获 stdout、stderr 与退出码 | 进程正常结束，stdout 为可解析的 JSON 信封，退出码与信封中的 `gate.result` 一致；`data.smoke_precheck.runners` 含 `scripts/smoke-a.js`，不含任何 `build/` 或 `loop/` 下的路径；stderr 不含 `RangeError` |
| ST-S19-39 | 默认 dispatcher 下 smoke 端到端 | Step 4a～4c、Step 8a～9；EX-19.25 | 真实 CLI；夹具 RD 叠加 RD-merged（SMOKE-core-950 同时在已合并 smoke 规格与提案 delta 中）；`P/scripts/run-smoke.js` 为本仓 dispatcher 的副本；`smoke.command` 为 `node scripts/run-smoke.js`；按 S19 既有测试夹具满足 smoke 前置（`VERIFY_PASS`、`DEPLOY_DONE`、`[deploy]` 全勾） | 执行 `openlogos smoke --format json`，读取 stdout、退出码与结果文件 | 进程正常结束，退出码 0，stdout 为可解析的 JSON 信封，`data.gate.result="PASS"`；`data.runners` 含 `scripts/smoke-a.js`，不含任何 `build/` 或 `loop/` 下的路径；结果文件含仓内 runner 本轮写出的 SMOKE-core-950 `pass` 记录；`X/EXECUTED` 不存在（链接目录内的 runner 未被执行） |

### 覆盖度校验

- 目录链接与环形链接不进入：UT-S19-113、UT-S19-121、ST-S19-38。
- 文件链接 runner 与悬空链接：UT-S19-114。
- 参数上限（合成目录项）：UT-S19-115、UT-S19-121。
- 不可读子目录：UT-S19-116。
- 零回归：UT-S19-117。
- 提案用例读取不受影响：UT-S19-118。
- 默认 dispatcher 零 runner 判定：UT-S19-119。
- verify 单次扫描与切片豁免：UT-S19-120。
- 真实命令端到端：ST-S19-38（verify）、ST-S19-39（smoke，经默认 dispatcher）。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S19"`，测试名含用例 ID；失败不得写 pass。
- 合成目录项只在测试进程内存中构造，不在磁盘创建数十万个文件；真实目录链接用少量文件即可验证链接策略。
- 所有临时目录（`P`、`X`、`Y`）在用例结束时删除；改过权限的目录先恢复权限再删除。用例不触碰本仓活跃提案、本仓 `logos/resources/`（结果账本除外）与本机全局安装。

## S19 安装态 runner 证据判定测试（fix-smoke-runner-discovery-review-gaps）

> 覆盖 `logos/resources/test/smoke/core-smoke-test-cases.md` 中 SMOKE-core-336～SMOKE-core-337 的「四、自动化与证据要求」（部署前置、信封通道判定、自测仓外独立账本），以及 ST-S19-38～ST-S19-39「stdout 为可解析的 JSON 信封」。本节只为安装态 smoke runner `scripts/smoke-runner-discovery.js` 的判定加回归锁，不改上述 smoke 与场景测试规格。
>
> **导入方式**：与 UT-S19-121 导入 `scripts/run-smoke.js` 相同，以模块方式导入 `scripts/smoke-runner-discovery.js` 的判定函数（作为模块导入时不执行主流程，不读写全局安装态与本仓账本）：信封解析、回执入口核对、部署前置判定、自测结果账本的打开与写入、制品校验结论。
>
> **夹具 RG**：`mktemp -d` 一次性目录，含：
> - 仓库替身 `R`：放一份已有账本 `R/logos/resources/verify/smoke-results.jsonl`（写入若干固定字节），以及部署账本 `R/logos/.openlogos-runtime/deployments.jsonl` 与回执 `R/logos/.openlogos-runtime/local-install/last-deploy.json`（按需写入或省略）；
> - 仓外目录 `O`（与 `R` 互不包含）；
> - 入口替身：`O/entry/index.js`（普通文件），其 realpath 记为 `E`；另建绝对路径别名 `O/alias/index.js`（指向 `E` 的符号链接），其字符串不等于 `E`；
> - 包替身 `O/pkg`：`asset-manifest.json` 与清单列出的资源文件，按用例改成「资源齐全」或「前一项缺失、后一项存在但摘要不同」。
>
> **部署归属**：runner 复核的是上一提案 `fix-smoke-runner-discovery-overflow` 的安装（runner 内 `SLUG` 常量；本提案按 C02 不部署）。夹具中「原提案」一律指该 slug，部署账本记录与回执按它填写。
>
> 版本相关夹具中，源码候选版本、回执 `candidate_version`、安装态 `--version` 均以注入值给出，断言只写关系式，不写发布版本号；三方一致的通过样例使用合成的低版本号（如 `0.0.1`），用于证明实现中不残留任何固定版本下限。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S19-122 | stdout 整体解析为 JSON 信封 | SMOKE-core-337 ①②「stdout 为可解析的 JSON 信封」；「四」信封通道 / 形态不匹配判 fail | 预期命令为 `verify`；完整 verify 信封指按 `spec/cli-json-output.md`「1.2 通用信封结构」含 `command="verify"`、`version`、`timestamp`、`data` 的对象 | 以信封解析函数（传入预期命令）分别解析：(a) stdout 恰为一个完整 verify 信封（前后可有空白）；(b) 该信封前混入一行普通文本；(c) 该信封后混入一行普通文本；(d) 多行文本中只有中间一行是该信封；(e) 空 stdout；(f) 整段是合法 JSON 对象，但缺 `command`；(g) 整段是合法 JSON 对象，但 `command="smoke"`（与预期命令不符） | (a) 返回解析后的信封对象。(b)～(g) 均抛错，错误信息含「信封通道 / 形态不匹配」，调用方据此判该用例 fail；(b)～(d) 不得退回到挑选某一行解析，(f)(g) 不得因 `data` 字段可读而放行 |
| UT-S19-123 | 回执 `entry_realpath` 与实际入口 realpath 原值比较 | SMOKE-core-336 ①「入口 realpath 等于回执 `entry_realpath`」 | 夹具 RG；实际入口为 `O/entry/index.js`，其 realpath 为 `E` | 以回执入口核对函数分别核对回执：(a) 缺 `entry_realpath`；(b) 为空字符串；(c) 为相对路径；(d) 为绝对路径但指向另一个文件；(e) 为 `O/alias/index.js`（与 `E` 指向同一文件、字符串不同）；(f) 恰为 `E` | (a)～(e) 均返回问题描述，SMOKE-core-336 判 fail，证据含实际入口 realpath 与回执原值；核对过程中不对回执字段做 realpath。(f) 无问题 |
| UT-S19-124 | 部署前置先查账本，版本按三方关系式判定 | SMOKE-core-336 前置；「四」部署前置（无记录 skip、有记录回执不符 fail）；版本以部署记录与源码候选版本为准、不硬编码 | 夹具 RG；「有成功部署」指账本中原提案 `fix-smoke-runner-discovery-overflow` 在 test 的最后一条成功 deploy 与回执同一 `deploy_id`、`result=done`、`environment=test` | 以部署前置判定函数分别判定：(a) 账本只有其他提案（如 `fix-smoke-runner-discovery-review-gaps`）在 test 的成功部署与对应回执，没有原提案的成功部署，源码候选版本读不到；(b) 有原提案成功部署，源码候选版本读不到；(c) 有原提案成功部署，源码候选版本回退且与回执 `candidate_version` 不同；(d) 有原提案成功部署，源码版本、回执版本与安装态 `--version` 三者都取合成低版本 `0.0.1`；(e) 有原提案成功部署，源码与回执相等但安装态 `--version` 不同 | (a) 写显式 skip，缺失项为部署记录，不判 fail，也不采用其他提案的回执；(b)(c)(e) 判 fail，原因分别指出源码版本不可读、源码与回执不符、安装与回执不符；(d) 通过——即使三方版本低于历史发布版本也不 skip、不 fail，证明实现中没有残留固定版本下限 |
| UT-S19-125 | 自测结果只写入仓外独立账本 | 「四」自测模式只接受仓库之外的独立结果账本 | 夹具 RG；记录 `R` 下全部文件清单与 `R/logos/resources/verify/smoke-results.jsonl` 的字节 | 以自测账本的打开与写入函数分别尝试写一行结果：(a) `O/new.jsonl`（不存在）；(b) `O/existing.jsonl`（已存在、链接数为 1 的普通文件，预置一行前缀内容），在同一次打开期间写入 SMOKE-core-336、SMOKE-core-337 两条结果，并以可注入的文件操作记录打开与写入调用；(c) `R/..results.jsonl`；(d) `O/dangling.jsonl` 为指向 `R/new-target.jsonl` 的悬空符号链接；(e) `O/link.jsonl` 为指向 `O/existing.jsonl` 的符号链接；(f) `O/hard.jsonl` 为 `R/logos/resources/verify/smoke-results.jsonl` 的硬链接；(g) 父目录不存在的 `O/missing/x.jsonl` | (a)(b) 被接受，结果行经打开得到的同一文件描述符写入目标文件。(b) 的文件操作记录显示：整个过程只打开一次，两条结果的写入都使用该次打开并通过检查的描述符，没有按路径重新打开或追加；最终文件内容为原前缀加两条追加记录，顺序一致。(c)～(g) 均在任何写入前被拒绝：(c) 按路径分量判为仓内；(d)(e) 结果路径本身是符号链接；(f) 打开后的描述符链接数大于 1；(g) 无法确认真实父目录。每个拒绝分支结束后，`R` 下文件清单不变，`R/logos/resources/verify/smoke-results.jsonl` 的字节与开始时逐字节相同，`R/new-target.jsonl` 不存在 |
| UT-S19-126 | 制品校验异常一律判 fail | SMOKE-core-336 ②「`payloadHash` 自洽」 | 夹具 RG 的包替身 `O/pkg`，用仓内 `validateAssetManifest` 做校验 | 以制品校验结论函数在自测与正式两种模式下分别判定：(a) 资源齐全且 `payloadHash` 正确；(b) `payloadHash` 被篡改；(c) 清单中前一项资源缺失、后一项资源存在但内容与摘要不同；(d) 清单含非法路径；(e) 从 (a) 的通过夹具出发，只修改一个已存在资源的文件内容，清单与其余资源保持完整 | (a) 两种模式均通过，结论写「payloadHash 自洽」。(b)～(e) 两种模式均判 fail，(e) 的问题描述指向被修改的资源路径，问题描述含校验器抛出的原始信息，结论不写「payloadHash 自洽」；自测模式不再把异常当作开发布局缺文件而放行 |

### 覆盖度校验

- 信封整体解析与命令身份（runner 与 ST-S19-38～39 同一规则）：UT-S19-122。
- 回执入口身份（缺字段、非绝对路径、不符、同文件别名）：UT-S19-123。
- 部署前置顺序与版本三方关系式（只认原提案 `fix-smoke-runner-discovery-overflow` 的部署，无记录 skip，有记录不符 fail，合成低版本三方一致仍通过）：UT-S19-124。
- 自测账本仓外独立（双点前缀文件名、悬空与普通符号链接、硬链接共享、父目录缺失，以及仓外新建与已有独立文件的接受对照；两条结果经同一描述符写入）：UT-S19-125。
- 制品校验无缺项豁免（含「前项缺失、后项摘要不同」组合，以及只改一个已存在资源内容的单独摘要错误）：UT-S19-126。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S19"`，测试名含用例 ID；失败不得写 pass。
- 只用内存或 `mktemp -d` 临时目录；夹具中的仓库替身 `R` 是临时目录，不是本仓。用例不触碰本机全局安装、本仓 `logos/resources/`（结果账本除外）、本仓部署账本与回执、本仓 smoke 账本；所有临时目录在用例结束时删除。
- ST-S19-38、ST-S19-39 的测试代码对 `stdout.trim()` 整体 `JSON.parse`，与 UT-S19-122 规则一致；用例规格本身不变。
