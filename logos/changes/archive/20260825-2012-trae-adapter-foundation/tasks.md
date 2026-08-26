# 实现任务

> 当前前沿：TRAE 国际版 `3.5.91` 与 TRAE CN `3.3.93` 的真实内置 `Write` 均绕过项目 `.trae/hooks.json`，双客户端 capability gate 已判定为 **BLOCKED**。
>
> 本提案已收敛为 D06 non-deployable 纯规格记录。不得创建 TRAE Adapter、不得注册 `trae`、不得修改 `all`、不得实现代码、不得部署或 smoke。

## [delta] 规格变更

- [x] [MODIFY] `deltas/decisions/core-D06-ai-tool-adapter-boundary.md`：登记 TRAE 国际版/CN 真实版本、项目 `PreToolUse` 未拦截内置 `Write` 的双端证据、BLOCKED 结论及未来重新开启条件。
- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：明确 `trae` 当前 non-deployable、不属于 `all`，并将双客户端完整 fail-closed 矩阵定义为未来接入前置条件。
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：记录 TRAE Rules/Skills/Agent/MCP/记忆的 owner 边界、软控制限制与 capability BLOCKED profile。
- [x] [MODIFY] `deltas/prd/2-product-design/2-page-design/core-01-cli-experience.md`：明确帮助、交互列表和显式参数不得声称支持 TRAE，`all` 保持既有七宿主。
- [x] [MODIFY] `deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md`：记录不创建 TRAE Adapter/normalizer/资产模板的架构结论，并保持 Registry 与共享 guard 边界不变。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-cli-init.md`：补充 Registry 在资产规划前拒绝 `trae`、`all` 保持七宿主且不创建 TRAE 资产的负向时序。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S08-sync-ai-tools.md`：补充同步不选择 TRAE、非法配置在事务前失败且用户 TRAE 资产零触达的负向时序。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`：补充生命周期不建立 TRAE normalizer、不读取信任/记忆且软控制不构成 hard guard 的负向时序。
- [x] [MODIFY] `deltas/spec/pretooluse-guard.md`：记录 TRAE 当前没有可由 OpenLogos 依赖的 fail-closed 内置工具写前映射，不得以 Rules、prompt、MCP 或人工确认替代。
- [x] [MODIFY] `deltas/test/core-S01-test-cases.md`：锁定 Registry 不含 `trae`、帮助/交互列表不展示 TRAE、既有七宿主顺序不变的负向契约。
- [x] [MODIFY] `deltas/test/core-S08-test-cases.md`：锁定 `all` 不展开 TRAE、显式 `trae` 不产生托管资产且既有七宿主同步行为不变。
- [x] [MODIFY] `deltas/test/core-S09-test-cases.md`：锁定不得建立 TRAE guard normalizer 或把软控制视为 hard guard，并保留现有宿主 fail-closed 回归。

## [code] 代码实现

> 六维评分：影响范围 1、行为复杂度 2、契约变化 1、测试规模 2、安全风险 2、不确定性 0，合计 8/12，属于大任务。
>
> 垂直/横向判别：按 S01 初始化、S08 同步、S09 hard-guard 排除三条端到端能力线拆分；每片同时包含行为、UT/ST、OpenLogos reporter 与必要回归，不按 helper、实现、测试或 reporter 横切。
>
> 删后续证伪：切片 1 删除后续仍能由真实 Registry/init 产生“拒绝 trae、七宿主 all、零 TRAE 资产”的可观察闭环；切片 2 删除切片 3 仍能由 sync 产生“非法配置写前失败、版本戳与用户资产不变”的闭环；切片 3 独立锁定无 TRAE normalizer/授权输入并回归现有宿主 fail-closed。三片均无前向依赖，可在 slice-aware 全量回归中分别闭环，无需合并。

- [x] 切片 1：交付 TRAE non-deployable 初始化闭环——以真实 `AiToolAdapterRegistry`、帮助/交互支持列表和 `init` 资产计划证明不注册 `trae`/TraeCode、`all` 仅稳定展开既有七宿主、显式 `trae` 在首个写入前 fail loud 且 `.trae/**` 零触达；同步实现 Vitest 与全局 OpenLogos reporter（覆盖 UT-S01-124、UT-S01-125、UT-S01-126、UT-S01-127、ST-S01-24、ST-S01-25）。
- [x] 切片 2：交付 TRAE non-deployable 同步闭环——让 `sync` 对配置中的未知 `trae` 在迁移、索引、资产事务和版本戳写入前 fail loud，保持既有七宿主计划/顺序/哈希语义，并证明 Rules、Skills、Agents、Hooks、MCP、settings 与不透明记忆不进入扫描、暂存、备份或回滚；同步实现 Vitest 与全局 OpenLogos reporter（覆盖 UT-S08-33、UT-S08-34、UT-S08-35、UT-S08-36、ST-S08-25、ST-S08-26）。
- [x] 切片 3：交付 TRAE hard guard 非适配闭环——以真实 Registry、现有 Hook normalizer/runtime 注册与生命周期状态输入证明不存在 TRAE SessionStart/PreToolUse 映射，不读取或修改 `enabled_folders`、settings、账号、Rules、Skills、Agents、MCP 与记忆，不把 wrapper 直调或软控制当作 capability PASS，同时回归已支持宿主每次重读、deny reason、退出语义与目标哈希不变；同步实现 Vitest 与全局 OpenLogos reporter（覆盖 UT-S09-219、UT-S09-220、UT-S09-221、UT-S09-222、UT-S09-223、ST-S09-85、ST-S09-86、ST-S09-87）。

本案没有 `[deploy]` section：能力门失败后不允许部署。
