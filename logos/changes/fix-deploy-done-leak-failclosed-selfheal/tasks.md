# 实现任务

## [delta] 规格变更
- [x] [CREATE] `deltas/decisions/core-D12-lifecycle-failclosed-reconciliation.md`：决策记录：生命周期命令 fail-closed 与显式对账不变量（含 auto-heal 被否理由）
- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：补充 S19 smoke fail-closed、S09 archive 链条校验、S05/S11 对账投影、S21 场景文档化的验收条件与 0.14.25 发布要求
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：§2.11 增补消费侧收口 + 新增生命周期 fail-closed 与状态对账功能小节 + 0.14.25 候选清单
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md`：next 矛盾事实对账建议（输出补救命令 openlogos deploy-done）
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`：archive 链条校验（VERIFY_PASS 必备；需部署提案还须 DEPLOY_DONE + SMOKE_PASS）
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md`：status 可选 state_inconsistency 只读投影（kind/evidence/remediation）
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md`：smoke 前置校验升格为可验收契约（fail-closed 错误码、JSON 信封、补救提示）
- [x] [CREATE] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S21-deploy-done-marker.md`：S21 deploy-done 受控落标场景文档（时序图、步骤说明、异常边界、消费侧收口、追溯）
- [x] [MODIFY] `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`：新增 0.14.25 本机全局部署章节（候选身份全链同步、隔离矩阵、覆盖安装、回滚 0.14.24 tarball）
- [x] [MODIFY] `deltas/spec/change-management.md`：archive 前置链条语义补充
- [x] [MODIFY] `deltas/spec/cli-json-output.md`：smoke/archive fail-closed 错误码信封 + state_inconsistency 字段契约
- [x] [MODIFY] `deltas/test/core-S05-test-cases.md`：新增 next 对账建议 UT/ST（孤儿 SMOKE_PASS 输出补救命令；一致状态零投影）
- [x] [MODIFY] `deltas/test/core-S09-test-cases.md`：新增 archive 链条校验 UT/ST（缺 VERIFY_PASS / 缺 DEPLOY_DONE / 缺 SMOKE_PASS 各自拒绝；无部署提案零回归）
- [x] [MODIFY] `deltas/test/core-S11-test-cases.md`：新增 status state_inconsistency 投影 UT/ST（矛盾事实输出；一致状态不输出）
- [x] [MODIFY] `deltas/test/core-S19-test-cases.md`：新增 smoke fail-closed 前置校验 UT/ST（缺标拒绝、未全勾拒绝、满足放行零回归）+ 0.14.25 候选身份 tripwire
- [x] [MODIFY] `deltas/test/core-S21-test-cases.md`：新增唯一 writer 与消费侧收口回归 UT/ST（无命令代写 DEPLOY_DONE；漏标缺口不扩散、补标后全链恢复）
- [x] [MODIFY] `deltas/test/smoke/core-smoke-test-cases.md`：新增 0.14.25 安装态验收用例（缺标 smoke 拒绝、缺链 archive 拒绝、对账投影、补标后放行、版本 roundtrip）

## [code] 代码实现

> 六维打分：影响范围 2（`smoke.ts` / `archive.ts` / 状态派生与 `next` 文案 / 版本身份族 / 新 smoke runner / 五个测试文件，跨多命令）、行为复杂度 2（smoke 四项前置顺序判定 + archive 三级链条 + 三类矛盾证据投影，多分支且各有零副作用要求）、契约变化 2（CLI JSON 新增 `state_inconsistency` 投影 + 七个稳定错误码 + 候选身份推进）、测试规模 2（21 个新 ID）、风险 2（fail-closed 收紧触及既有流程 + 本机全局发布）、不确定性 0（事故机理已复盘定性，三处修复点在规格中逐条给定，发布链有 0.14.22～0.14.24 同构先例）→ 10 分，大任务，进入垂直拆分。
> 垂直/横向判别：四片各自是一条端到端能力线（smoke 拒绝 / archive 拒绝 / 状态对账可见 / 候选可安装并在安装态自证），不是「先建底座→再写逻辑→最后补测试」的施工顺序；每片自带业务代码 + 该片 UT/ST + reporter。
> 删后续证伪门（逐片结论）：
> · 切片1（smoke 前置）删 2/3/4 后独立过全量 verify——只动 `smoke.ts` 与既有 smoke 测试，UT-S19-42/43/44、ST-S19-20/21 自洽；(b) 端到端可观察：缺标即拒绝且零副作用。✓
> · 切片2（archive 链条）删 3/4 后独立过全量 verify——只动 `archive.ts`，UT-S09-319～321、ST-S09-123/124 自洽，无需切片3的投影；(b) 归档被拒且零副作用。✓
> · 切片3（对账投影）删 4 后独立过全量 verify——UT-S21-10/11、ST-S21-04 断言 smoke/archive 已 fail-closed，依赖的是**在前**的切片1/2（非前向依赖），UT-S19-45 尚不存在故不飘红；(b) 僵死状态被点名并给出补救命令。✓
> · 切片4（0.14.25 发布）为末片无后续可删；(b) 端到端可观察：固定 tarball 可安装、SMOKE-core-196 在安装态自证三处修复并以 0.14.24 对照防空转。✓
> 曾拟把 S21 的 UT-S21-10/11、ST-S21-04 单独成片：该片只含测试、无业务代码，命中「写测试」横向红旗，且其断言全部是切片1/2/3 行为的跨命令回归锚——已向前合并进切片3。
- [x] 切片1：smoke 前置 fail-closed 校验——在 `cli/src/commands/smoke.ts` 执行 `smoke.command` **之前**加四项前置门（①`smoke_required=true` 否则 `SMOKE_NOT_REQUIRED`；②部署决策无冲突否则 `SMOKE_DEPLOY_DECISION_CONFLICT`；③`DEPLOY_DONE` 在场否则 `SMOKE_DEPLOY_NOT_DONE`；④`tasks.md` `[deploy]` 全勾否则 `SMOKE_DEPLOY_TASKS_INCOMPLETE`），顺序 ①→②→③→④ 命中即停只报首个错误码；复用 `readActiveProposalGuard` / `resolveProposalDeploymentDecision` / `[deploy]` section 只读判据，新增只读前置求值不改写任何文件；拒绝时零副作用（不执行 `smoke.command`、不写 `SMOKE_PASS`/`SMOKE_FAIL`、不生成 `smoke-report.md`、不追加 `smoke-results.jsonl`），错误走 stderr 稳定错误码信封、`--format json` 走 `spec/cli-json-output.md` §6 通用 envelope，message 携补救命令（③④ 指向 `openlogos deploy-done`）；禁止 auto-heal 补写 `DEPLOY_DONE`；前置全满足时既有 sandbox 执行、runner/reporter 覆盖预检、gate 判定与 `gate.reason`、skip 统计口径、`--auto` 下 `auto_execute` 信号逐项零回归；同步实现含 OpenLogos reporter 的 UT-S19-42、UT-S19-43、UT-S19-44、ST-S19-20、ST-S19-21
- [x] 切片2：archive 链条 fail-closed 校验——在 `cli/src/commands/archive.ts` 移动提案目录**之前**加三级链条门（①`VERIFY_PASS` 在场且无 `VERIFY_FAIL` 否则 `ARCHIVE_VERIFY_NOT_PASSED`；②仅 `deployment_required=true` 提案要求 `DEPLOY_DONE` 否则 `ARCHIVE_DEPLOY_NOT_DONE`；③仅需部署且需 smoke 提案要求 `SMOKE_PASS` 在场且无 `SMOKE_FAIL` 否则 `ARCHIVE_SMOKE_NOT_PASSED`），顺序 ①→②→③ 命中即停；`SMOKE_PASS` 在场不得反推部署完成；archive 保持纯文本命令（不新增 stdout JSON envelope），错误码文本写 stderr 并非零退出、携补救命令（`openlogos verify` / `openlogos deploy-done` / `openlogos smoke`）；拒绝时零副作用（不移动目录、不删 `logos/.openlogos-guard`、不建 Windows 握手请求目录）；无需部署提案链条只到 ①、`deployment_decision_conflict` 语义不变、Windows 握手顺序仍为「链条校验 → 握手 → rename」；同步实现含 OpenLogos reporter 的 UT-S09-319、UT-S09-320、UT-S09-321、ST-S09-123、ST-S09-124
- [x] 切片3：`state_inconsistency` 只读对账投影 + next 对账引导 + S21 唯一 writer 回归——在状态派生侧（`collectStatusData` 及 `next` 消费路径）新增只读投影：活跃提案存在 ∧ `proposal_step` 停在 `ready-to-deploy` ∧ 至少一项矛盾下游证据（`SMOKE_PASS` 在场 / `SMOKE_FAIL` 在场 / `[deploy]` 全勾）时，挂 `modules[].active_change.state_inconsistency`（legacy 单模块可回退顶层同名字段），三字段齐备 `kind="deploy_done_missing_with_downstream_evidence"`、`evidence` 按固定顺序去重（`smoke_pass_marker_present` → `smoke_fail_marker_present` → `deploy_tasks_all_checked`）、`remediation="openlogos deploy-done"`；`next` 命中时在既有部署授权引导后追加一行对账建议（点明矛盾事实与补救命令）；只读不变量：不落盘、不缓存、不改 `proposal_step` 派生、不写任何 marker（尤其不写 `DEPLOY_DONE`）、一致状态下字段不出现（不是 `null`）使既有 status/next golden 逐字不变、`watch` 因复用 `collectStatusData` 自动继承；同步实现含 OpenLogos reporter 的 UT-S05-56、UT-S05-57、ST-S05-26、UT-S11-80、UT-S11-81、ST-S11-46，以及跨命令回归锚 UT-S21-10（四条命令前后 `DEPLOY_DONE` 始终不存在、marker 集合零变化）、UT-S21-11（成功路径 marker 最后写、错误分支三者皆无变化）、ST-S21-04（漏标缺口不扩散 → 补标后全链恢复）
- [x] 切片4：0.14.25 候选身份与 SMOKE-core-196 runner——候选身份全链同步（`cli/package.json`/lockfile/五 plugin manifest/`asset-manifest.json` 再生/`LOCAL_RELEASE_CANDIDATE_VERSION=0.14.25`、`LOCAL_RELEASE_ROLLBACK_VERSION=0.14.24`，并演替既有版本 pin：UT-S19-41 转历史锚、UT-S19-24 candidate facts 与 s34 golden 同步）；新增 `scripts/smoke-guard-lifecycle-0-14-25.js` 承载 SMOKE-core-196（candidate identity 含随包新字节 → 安装态 fail-closed 拒绝矩阵：缺 `DEPLOY_DONE` smoke 拒绝、`[deploy]` 未全勾 smoke 拒绝、缺 `VERIFY_PASS`/`DEPLOY_DONE`/`SMOKE_PASS` 的 archive 拒绝且零副作用 → `state_inconsistency` 投影在场 → 补标后全链放行 → 固定 0.14.24 对照复现「smoke 照常写 `SMOKE_PASS`、archive 照常成功、无投影字段」防断言空转 → `0.14.24↔0.14.25` roundtrip 无混装），接入 `scripts/run-smoke.js` 注册表、写 `logos/resources/verify/smoke-results.jsonl`、完成后跑 smoke 覆盖预检；同步实现含 OpenLogos reporter 的 UT-S19-45 与 SMOKE-core-196

## [deploy] 部署任务
- [ ] 按部署方案 0.14.25 章节执行隔离验证矩阵（fail-closed 拒绝矩阵、对账投影、补标后全链放行、0.14.24 缺陷复现对照、roundtrip 回滚演练），PASS 后覆盖安装 0.14.25 tarball 到本机全局 prefix（`/opt/homebrew`），新 shell 复核 identity 全同源 0.14.25
- [ ] 确认回滚预案就位（0.14.24 tarball 及 sha256 留痕），完成后运行 `openlogos deploy-done` 受控落标（部署失败不得写 DEPLOY_DONE，输出失败点与回滚建议）
