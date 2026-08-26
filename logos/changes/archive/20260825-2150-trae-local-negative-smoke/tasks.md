# 实现任务

> 本提案部署的是 OpenLogos `0.13.29` 本地候选 tarball，不是 TRAE Adapter。TRAE 必须继续保持 non-deployable，`.trae/**` 与真实用户状态零触达。

## [delta] 规格变更

- [x] [MODIFY] `deltas/decisions/core-D06-ai-tool-adapter-boundary.md`：区分“禁止 TRAE deployable 部署”与“允许 OpenLogos 本地候选 tarball 负向验证”，保持 hard guard BLOCKED 与重新开启条件不变。
- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：补充 S01/S08/S19 的 `0.13.29` 真实制品、隔离安装、写前拒绝、七宿主 all、TRAE 用户资产零触达和回滚验收条件。
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：定义本地候选制品部署、non-deployable 状态、失败语义、证据与所有权边界。
- [x] [MODIFY] `deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md`：增加 local-isolated tarball、runner/reporter、双 tarball 回滚拓扑和外部 TRAE 用户边界。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-cli-init.md`：补充候选 tarball 下显式 `trae` 首写前失败、`all` 七宿主与零 TRAE 资产的安装态验证入口。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S08-sync-ai-tools.md`：补充候选 tarball 的 `all`/sync 排除、严格配置失败和 `.trae/**` 哈希不变安装态时序。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md`：补充 `openlogos smoke --env local-isolated` 的部署后负向 runner 时序、前置门禁和失败路径。
- [x] [MODIFY] `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`：定义 `0.13.29` build/test/pack、一次性 prefix/HOME、安装证据、`0.13.28` 回滚演练、恢复、清理和无公开副作用判据。
- [x] [MODIFY] `deltas/test/core-S01-test-cases.md`：新增 UT-S01-128、ST-S01-26，验证初始化排除 runner 合同与真实候选 tarball 入口。
- [x] [MODIFY] `deltas/test/core-S08-test-cases.md`：新增 UT-S08-37、ST-S08-27，验证同步排除、用户边界和候选安装态闭环。
- [x] [MODIFY] `deltas/test/core-S19-test-cases.md`：新增 UT-S19-10～UT-S19-11、ST-S19-09，验证双 tarball 输入、dispatcher/reporter 与 local-isolated 门禁。
- [x] [MODIFY] `deltas/test/smoke/core-smoke-test-cases.md`：新增 SMOKE-core-124～SMOKE-core-129，覆盖真实 tarball 身份、隔离边界、显式 TRAE 拒绝、all/sync 排除、软控制非 PASS 与回滚恢复。

## [code] 代码实现

> 六维评分：影响范围 2、行为复杂度 2、契约变化 1、测试规模 2、风险等级 2、不确定性 1，合计 10/12，属于大任务。
>
> 删后续自检：候选 tarball 身份/隔离、S01/S08 排除行为、S19 dispatcher/reporter 与双 tarball 回滚共享同一安装态上下文。拆成多片会让前片留下已合并测试 ID 未覆盖，或只产出供后片使用的 runner 管道，无法独立通过全量 verify；因此合并为一个端到端可观察单切片。

- [x] 单切片：统一版本元数据为 `0.13.29`；实现 `local-isolated` TRAE 负向 smoke runner 及 dispatcher 独立制品路由，严格校验 `0.13.29` 候选与 `0.13.28` 回滚 tarball、一次性 HOME/prefix/cache/workspace/evidence realpath、安装态显式 `trae` 首写前拒绝、`all`/sync 七宿主排除、合成 TRAE 用户边界零触达、软控制非 PASS 与 `0.13.29 → 0.13.28 → 0.13.29` 实际回滚恢复；同步 Vitest 合同/场景测试、OpenLogos test reporter、SMOKE-core-124～SMOKE-core-129 的 `smoke-results.jsonl` reporter、`scripts/run-smoke.js` 接入与 smoke 覆盖预检（覆盖 UT-S01-128、ST-S01-26、UT-S08-37、ST-S08-27、UT-S19-10、UT-S19-11、ST-S19-09、SMOKE-core-124、SMOKE-core-125、SMOKE-core-126、SMOKE-core-127、SMOKE-core-128、SMOKE-core-129）。

## [deploy] 本地隔离部署任务

- [x] 在用户另行明确授权部署后，使用本次真实 `0.13.29` tarball 安装到一次性 npm prefix/HOME，验证实际 CLI 路径、版本、包清单与 SHA-256，并确保未命中 workspace、全局 CLI 或真实用户目录。
- [x] 在同一隔离目标实际演练已校验 `0.13.28` tarball 回滚，再恢复候选 `0.13.29`；核对两个版本的入口、制品哈希、TRAE 用户边界与既有七宿主最小状态。
- [x] 生成 `logos/resources/verify/deployment-report.md`，记录隔离路径、制品、安装、回滚、恢复、清理策略及公开发布副作用为零；确认后由 deployment-executor 执行受控 `openlogos deploy-done --env local-isolated`。

> smoke 不在 `[deploy]` 中勾选；部署完成并获得独立授权后，由 `openlogos smoke --env local-isolated` 执行 SMOKE-core-124～SMOKE-core-129。
