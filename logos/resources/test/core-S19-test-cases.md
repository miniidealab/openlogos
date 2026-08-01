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
