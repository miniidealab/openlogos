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

## S19 Authority Closure candidate/回滚测试


### 单元测试

| ID | 场景 | 输入 | 精确期望 |
|---|---|---|---|
| UT-S19-26 | asset manifest 同源 | 根 spec/六 Skill/package/plugin/cache hash | 全一致通过；任一字节漂移返回具体资产失败 |
| UT-S19-27 | cutover 顺序 | old stop/new start/rebuild/probe/exit 事件流 | 仅规范顺序通过；旧 writer 仍成功或无 exit 失败 |
| UT-S19-28 | rollback identity | 冻结旧 tarball、candidate、入口/realpath/hash | candidate 失败后恢复字节等价旧安装；再次安装 candidate 幂等 |

### 场景测试

| ID | 场景 | 操作序列 | 精确期望 |
|---|---|---|---|
| ST-S19-17 | 隔离安装与 writer 切换 | pack 固定 candidate→隔离安装→负向矩阵→旧 writer 拒绝→投影重建→旧版回滚→candidate 重装 | 入口/版本/资产/行为全闭合；结果进入 reporter；无混合安装与伪 marker |

### 追溯与 reporter

覆盖 AC-03～AC-08 及部署回滚。实现必须使用 OpenLogos reporter 写 `logos/resources/verify/test-results.jsonl`，smoke 结果另写 `smoke-results.jsonl`。

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
| UT-S19-45 | 0.14.25 候选身份全源一致 | 0.14.25 候选发布需求 | 候选身份链已 bump | 读取全源身份与 runner 注册 | `LOCAL_RELEASE_CANDIDATE_VERSION === '0.14.25'`、`LOCAL_RELEASE_ROLLBACK_VERSION === '0.14.24'`；package.json/lockfile/五 plugin manifest/asset-manifest version 全部精确 `0.14.25`；回滚制品身份 tripwire：固定 0.14.24 tarball 在场且 SHA-256 可校验；SMOKE-core-196 runner 已接入 `scripts/run-smoke.js` 且 `--self-test` 合同含 `ids:['SMOKE-core-196']`、`public_release_commands:[]` |

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
