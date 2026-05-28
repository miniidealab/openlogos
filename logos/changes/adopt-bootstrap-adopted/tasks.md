# 实现任务

## [delta] 规格变更
- [x] 产出 delta 文件到 `deltas/prd/1-product-requirements/core-01-requirements.md` — 更新 S20：adopt 是“完整 init 基础设施 + 跳过 Initial 文档门禁”，并将 `bootstrap: skipped` 改为 `bootstrap: adopted`
- [x] 产出 delta 文件到 `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md` — 更新 adopt 功能规格、bootstrap 状态语义和兼容要求
- [x] 产出 delta 文件到 `deltas/prd/2-product-design/2-page-design/core-01-cli-experience.md` — 更新 adopt 终端体验、语言/AI tool 选择、创建阶段和下一步文案
- [x] 产出 delta 文件到 `deltas/spec/logos-project.md` — 修改 `modules[].bootstrap` 枚举：新增 `adopted`，声明 `skipped` 为历史兼容值
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S20-adopt-existing-project.md` — 更新 S20 时序图和步骤说明
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md` — 将无活跃提案补文档分支从 `bootstrap=skipped` 改为 `bootstrap=adopted`，并说明旧值兼容
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md` — 更新 adopted 接入模式下 Phase 1~3 状态显示规则
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S14-launch-lifecycle.md` — 更新 adopted 接入模式的 Initial 门禁豁免规则
- [x] 产出 delta 文件到 `deltas/test/core-S20-test-cases.md` — 更新 S20 UT/ST：新写入 `bootstrap=adopted`，并验证 adopt 完整初始化基础资产
- [x] 产出 delta 文件到 `deltas/test/core-S05-test-cases.md` — 更新 next 对 `bootstrap=adopted` 和历史 `skipped` 的补文档引导覆盖
- [x] 产出 delta 文件到 `deltas/test/core-S11-test-cases.md` — 更新 status 对 `bootstrap=adopted` 和历史 `skipped` 的 Phase 1~3 已跳过显示覆盖
- [x] 产出 delta 文件到 `deltas/test/core-S14-test-cases.md` — 更新 launch 对 `bootstrap=adopted` 和历史 `skipped` 的门禁豁免覆盖
- [x] 产出 delta 文件到 `deltas/test/smoke/core-smoke-test-cases.md` — 更新 adopt 发布后 smoke：验证完整资产初始化与 `bootstrap=adopted`

## [code] 代码实现
- [x] 修改 `cli/src/commands/adopt.ts` — adopt 主流程复用/对齐 init 的完整基础设施初始化能力，新写入 `bootstrap: adopted`
- [x] 修改 `cli/src/commands/init.ts` — 更新 `createAdoptLogosProject()`、AI 指令模板、文案和必要的共享 helper
- [x] 修改 `cli/src/lib/project-yaml.ts` 与状态类型 — 规范化读取 `bootstrap`，新值为 `adopted`，历史 `skipped` 兼容为 adopted 接入模式
- [x] 修改 `cli/src/commands/next.ts` — `bootstrap=adopted` 无活跃提案时建议 `openlogos change add-baseline-docs`，并兼容旧 `skipped`
- [x] 修改 `cli/src/commands/status.ts` — `bootstrap=adopted` 时 Phase 1~3 显示为接入模式已跳过，JSON 输出暴露 `bootstrap: adopted`
- [x] 修改 `cli/src/commands/launch.ts` — `bootstrap=adopted` 时豁免 Initial 文档门禁，并兼容旧 `skipped`
- [x] 修改 `cli/src/commands/detect.ts` — 确保 JSON 输出保留新 bootstrap 语义，历史 `skipped` 不破坏生命周期派生
- [x] 更新 `cli/test/s20-adopt.test.ts` — 覆盖 adopt 完整初始化资产、`bootstrap=adopted` 写入、旧值兼容和 verify 预跑配置
- [x] 更新 `cli/test/s05-next.test.ts`、`cli/test/s11-status.test.ts`、`cli/test/s14-launch.test.ts`、`cli/test/s16-json-output.test.ts` — 覆盖 adopted/旧 skipped 双路径
- [x] 更新 OpenLogos reporter 覆盖的测试用例 ID，确保新增/修改 UT/ST 与 `logos/resources/test/*.md` 对齐

## [deploy] 部署任务
- [x] 发布包含本变更的新版本 `@miniidealab/openlogos` npm 包
- [x] 在干净存量项目目录执行 `openlogos adopt --locale zh --ai-tool all`，确认生成完整 `logos/`、AI tools 资产、`AGENTS.md` / `CLAUDE.md`，且 `logos-project.yaml` 写入 `bootstrap: adopted`
- [x] 在包含历史 `bootstrap: skipped` 的测试项目执行 `openlogos status --format json` 与 `openlogos next`，确认兼容补文档引导不回退
