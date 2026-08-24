# 实现任务

## [delta] 规格变更

- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：更新 P02 及 S01、S08、S09、S14、S20 的 ZCode 宿主选择、资产部署、同步刷新和 guard 验收条件。
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：定义公共 Adapter Registry、能力模型、ZCode 资产布局及 SessionStart/PreToolUse 行为。
- [x] [MODIFY] `deltas/prd/2-product-design/2-page-design/core-01-cli-experience.md`：更新 S01、S08、S14、S20 的 ZCode 选择、同步、launch 反馈和错误提示。
- [x] [MODIFY] `deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md`：设计能力驱动 Adapter Registry、宿主无关 Node.js hook runtime、ZCode 薄适配层和打包边界。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-cli-init.md`：补充 S01 解析 ZCode、部署插件与指令资产、安装 hooks 及保留用户资产的完整时序。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S08-sync-ai-tools.md`：补充 S08 通过 Adapter Registry 幂等刷新 ZCode 资产并保留用户配置的时序。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`：补充 S09 的 ZCode SessionStart 上下文注入及 PreToolUse guard 收敛链路。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S14-launch-lifecycle.md`：补充 S14 由注册表驱动刷新 ZCode launched 指令与插件资产的时序。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S20-adopt-existing-project.md`：补充 S20 选择 ZCode、保护存量资产并完成同等级基础设施接入的时序。
- [x] [MODIFY] `deltas/test/core-S01-test-cases.md`：补充 ZCode 参数解析、all 展开、注册表、资产布局、双语指令、打包与幂等初始化 UT/ST。
- [x] [MODIFY] `deltas/test/core-S08-test-cases.md`：补充 ZCode 同步刷新、用户配置保留、旧配置兼容、版本戳与重复执行 UT/ST。
- [x] [MODIFY] `deltas/test/core-S09-test-cases.md`：补充 ZCode SessionStart、PreToolUse 字段适配、proposal_step allowlist、exit 2 阻断与异常 fail-closed UT/ST。
- [x] [MODIFY] `deltas/test/core-S14-test-cases.md`：补充 launch 通过注册表刷新 ZCode launched 资产且保持现有宿主行为的 UT/ST。
- [x] [MODIFY] `deltas/test/core-S20-test-cases.md`：补充存量项目选择 ZCode、资产冲突保护、配置持久化和后续 change 可达性 UT/ST。
- [x] [MODIFY] `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`：定义 staging 真实 tarball 安装、真实 ZCode CLI 前置条件、制品证据、失败回滚和部署边界。
- [x] [MODIFY] `deltas/test/smoke/core-smoke-test-cases.md`：补充真实 ZCode CLI 的插件发现、Skills/Commands、上下文注入、写入阻断及既有宿主回归 smoke 用例。
- [x] [MODIFY] `deltas/spec/agents-md.md`：定义 ZCode 的 AGENTS.md 托管片段、语言策略、宿主技能路径和项目内容保留规则。
- [x] [MODIFY] `deltas/spec/pretooluse-guard.md`：定义 ZCode PreToolUse 字段归一化、阻断退出码、proposal_step allowlist 和 fail-closed 行为。
- [x] [CREATE] `deltas/spec/zcode-plugin.md`：建立 ZCode 插件清单、目录布局、Skills/Commands/Agents/hooks、安装同步与兼容契约的完整根规范。
- [x] [CREATE] `deltas/decisions/core-D06-ai-tool-adapter-boundary.md`：记录能力驱动 Adapter Registry、共享 Node.js runtime 与宿主薄适配层的长期边界决策。

## [code] 代码实现

- [x] 实现 ZCode 会话上下文与写入硬门禁闭环：交付 ZCode 原生插件 manifest、SessionStart/PreToolUse hooks、共享 SessionContextService/GuardDecisionService 与每次调用重读状态语义，并实现含 OpenLogos reporter 的 UT-S09-188..197、ST-S09-73..76。
- [x] 实现 ZCode 初始化与存量项目接入闭环：把 zcode 纳入 AiToolAdapterRegistry 的标量/数组/all 解析，以 ManagedAssetTransaction 原子部署且保留用户 `.zcode/config.json`，并实现含 OpenLogos reporter 的 UT-S01-100..107、ST-S01-15..17、UT-S20-20..26、ST-S20-14..16。
- [x] 实现 ZCode 同步与 launched 生命周期刷新闭环：让 sync/launch 仅经 registry 刷新 ZCode 插件资产，覆盖幂等、失败回滚、用户配置保留和 launched 策略刷新，并实现含 OpenLogos reporter 的 UT-S08-15..20、ST-S08-16..18、UT-S14-06..09、ST-S14-19..20。
- [x] 实现真实 tarball/ZCode staging 验收执行器闭环：把 plugin-zcode 模板纳入 npm pack，提供真实 ZCode CLI 的 manifest/SessionStart/PreToolUse/安装/重装/回滚 smoke runner、dispatcher 与 JSONL reporter，并覆盖 SMOKE-core-100..107；不得执行 npm publish、Git tag、GitHub Release、官网发布或 git push。

## [deploy] 部署任务

- [x] 使用本提案构建的真实 npm tarball 部署到 staging，并安装、配置真实 ZCode CLI 集成资产；不执行 npm publish、Git tag、GitHub Release、官网发布或 git push。
- [x] 按合并后的部署方案确认制品哈希、配置、ZCode 插件发现与运行状态、失败回滚准备，并更新部署报告。
