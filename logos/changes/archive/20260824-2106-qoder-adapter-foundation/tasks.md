# 实现任务

## [delta] 规格变更

- [x] [MODIFY] `deltas/decisions/core-D06-ai-tool-adapter-boundary.md`：记录 Qoder 薄 Adapter 对 D06 Registry、共享 runtime、协议隔离与宿主不变量的落地结论。
- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：更新 P02 及 S01、S08、S09、S14、S20 的 Qoder 宿主选择、资产、生命周期和 guard 验收条件。
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：补充 Qoder capability、原生插件布局、托管资产与 SessionStart/PreToolUse 功能规格。
- [x] [MODIFY] `deltas/prd/2-product-design/2-page-design/core-01-cli-experience.md`：补充 init/adopt 的 Qoder 选择、sync/launch 反馈和错误提示。
- [x] [MODIFY] `deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md`：定义 Qoder 薄 Adapter、插件 owner、Hook 协议映射、CLI/IDE 隔离与打包边界。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-cli-init.md`：补充 Registry 解析 Qoder 并原子部署插件、Skills、Commands、Agents、Hooks 与保护用户资产的时序。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S08-sync-ai-tools.md`：补充 Qoder 托管资产幂等刷新、用户 settings/插件保留、失败回滚与版本戳时序。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`：补充 Qoder SessionStart 上下文、PreToolUse hard guard、每次调用重读与 fail-closed 时序。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S14-launch-lifecycle.md`：补充 Registry 驱动的 Qoder launched 资产刷新、提交顺序和幂等时序。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S20-adopt-existing-project.md`：补充存量项目选择 Qoder、保护 settings/用户插件并直接进入 change 的时序。
- [x] [MODIFY] `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`：定义 staging 真实 tarball 安装、真实 Qoder CLI 前置条件、制品证据、失败回滚和公开发布边界。
- [x] [MODIFY] `deltas/spec/agents-md.md`：定义 Qoder 的 AGENTS 托管片段、宿主技能路径、语言策略与用户内容保留规则。
- [x] [MODIFY] `deltas/spec/pretooluse-guard.md`：定义 Qoder PreToolUse 字段归一化、permissionDecision/reason、exit 2 与 fail-closed 行为。
- [x] [CREATE] `deltas/spec/qoder-plugin.md`：建立 Qoder 原生插件清单、目录布局、Skills/Commands/Agents/Hooks、安装同步及 CLI 兼容契约。
- [x] [MODIFY] `deltas/test/core-S01-test-cases.md`：补充 Qoder 参数解析、all 展开、capability、模板、打包、用户资产保护与初始化 UT/ST。
- [x] [MODIFY] `deltas/test/core-S08-test-cases.md`：补充 Qoder 同步、旧配置兼容、用户资产保留、失败回滚、版本戳与幂等 UT/ST。
- [x] [MODIFY] `deltas/test/core-S09-test-cases.md`：补充 Qoder SessionStart、PreToolUse 映射、proposal_step、exit 2、状态重读与 fail-closed UT/ST。
- [x] [MODIFY] `deltas/test/core-S14-test-cases.md`：补充 Qoder launched 刷新、事务提交顺序、幂等与既有宿主回归 UT/ST。
- [x] [MODIFY] `deltas/test/core-S20-test-cases.md`：补充 Qoder 存量接入、settings/插件保护、配置持久化、回滚与 change 可达性 UT/ST。
- [x] [MODIFY] `deltas/test/smoke/core-smoke-test-cases.md`：补充真实 Qoder CLI 的插件发现、Skills/Commands/Agents、上下文、写入门禁、幂等、回滚与回归 smoke。

## [code] 代码实现

> 六维评分：影响范围 2、行为复杂度 2、契约变化 2、测试规模 2、风险等级 2、不确定性 1，合计 11 分，属于大任务。
>
> 删后续自检：切片 1 删除后续切片后，仍可独立交付 Qoder 从选择、初始化/存量接入到同步、launch、随包模板及真实 CLI 插件发现的端到端生命周期，并通过其 UT/ST/SMOKE 与全量基线回归；切片 2 在切片 1 的稳定插件入口上独立交付 SessionStart 上下文与 PreToolUse hard guard，完成后可观察 allow/deny/exit 2/fail-closed 全链路。原拟把 Registry、模板、同步、测试与 reporter 分成施工层，因不能端到端观察而合并进切片 1；两片均无前向依赖。

- [x] 切片 1：交付 Qoder 插件生命周期闭环——把 `qoder` 接入 Adapter Registry、参数解析与 `all` 展开，原子完成 init/adopt/sync/launch 的托管资产、用户资产保护、回滚、版本戳、双语反馈、模板校验与 npm tarball 打包；同步实现/更新定向 UT/ST、OpenLogos `test-results.jsonl` reporter、真实 Qoder CLI `scripts/smoke-*` runner 与 `smoke-results.jsonl` reporter，并接入现有 smoke command 后执行覆盖预检（覆盖 UT-S01-108、UT-S01-109、UT-S01-110、UT-S01-111、UT-S01-112、UT-S01-113、UT-S01-114、UT-S01-115、ST-S01-18、ST-S01-19、ST-S01-20、UT-S08-21、UT-S08-22、UT-S08-23、UT-S08-24、UT-S08-25、UT-S08-26、ST-S08-19、ST-S08-20、ST-S08-21、UT-S14-10、UT-S14-11、UT-S14-12、UT-S14-13、ST-S14-21、ST-S14-22、UT-S20-27、UT-S20-28、UT-S20-29、UT-S20-30、UT-S20-31、UT-S20-32、UT-S20-33、ST-S20-17、ST-S20-18、ST-S20-19、SMOKE-core-108、SMOKE-core-109、SMOKE-core-110、SMOKE-core-114、SMOKE-core-115）。
- [x] 切片 2：交付 Qoder SessionStart 与 PreToolUse hard guard 闭环——在 Qoder Hook 边界完成 snake_case 输入归一化、磁盘状态逐次重读、共享 proposal_step/active change 上下文、路径安全、allow/deny 映射、permissionDecisionReason、exit 2 与异常 fail-closed，并保持共享 runtime 和其它宿主协议不漂移；同步实现/更新定向 UT/ST、OpenLogos `test-results.jsonl` reporter、真实 Qoder CLI `scripts/smoke-*` runner 与 `smoke-results.jsonl` reporter并执行覆盖预检（覆盖 UT-S09-198、UT-S09-199、UT-S09-200、UT-S09-201、UT-S09-202、UT-S09-203、UT-S09-204、UT-S09-205、UT-S09-206、UT-S09-207、ST-S09-77、ST-S09-78、ST-S09-79、ST-S09-80、SMOKE-core-111、SMOKE-core-112、SMOKE-core-113）。

## [deploy] 部署任务

- [x] 使用本提案构建的真实 npm tarball 部署到隔离 staging，并安装、配置真实 Qoder CLI 集成资产；不执行 npm publish、Git tag、GitHub Release、官网/Cloudflare 部署或 git push。
- [x] 按合并后的部署方案确认制品哈希、CLI 路径/版本、Qoder 插件发现与 Hook 运行状态、用户资产哈希和失败回滚准备，并更新部署报告。
