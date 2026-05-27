# 实现任务

## [delta] 规格变更
- [x] 产出 delta 文件到 `deltas/prd/1-product-requirements/core-01-requirements.md` — 更新 S01 / S08 / S13 / S16 / S20 中 verify 预跑、覆盖诊断和接入补齐的验收要求
- [x] 产出 delta 文件到 `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md` — 定义 verify 预执行配置、两阶段测试、覆盖不足诊断和 init / sync / adopt 补齐策略
- [x] 产出 delta 文件到 `deltas/prd/2-product-design/2-page-design/core-01-cli-experience.md` — 更新 verify / init / sync / adopt 的文本体验和缺失预跑配置提示
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md` — 更新 S13 与初始化 / 同步 / 接入命令的实现映射和配置流
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-cli-init.md` — 补充 init 对常见测试栈的 verify 预跑配置推断与写入流程
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S08-sync-ai-tools.md` — 补充 sync 对缺失 verify 预跑配置的补齐或诊断流程
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S13-verify-results.md` — 定义 regression / incremental 两阶段执行、结果合并、兼容 pre_run_command 和覆盖不足诊断流程
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md` — 定义 verify JSON 输出中的预跑命令执行状态、诊断和建议字段
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S20-adopt-existing-project.md` — 补充 adopt 对已有项目测试命令的推断、写入或 TODO 诊断流程
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — 更新 CLI/npm 发布、官网文档同步、回滚和 smoke 检查策略
- [x] 产出 delta 文件到 `deltas/spec/test-results.md` — 扩展测试结果格式规范中的 verify 预执行模型、阶段化结果路径和合并语义
- [x] 产出 delta 文件到 `deltas/spec/logos.config.schema.json` — 扩展 verify 配置 schema，新增 regression / incremental / result path / merge 策略字段并保留 pre_run_command 兼容
- [x] 产出 delta 文件到 `deltas/spec/workflow.md` — 更新 Step 5 / Step 6 中“完整测试结果生成”和两阶段验收的正式流程
- [x] 产出 delta 文件到 `deltas/spec/cli-json-output.md` — 扩展 `openlogos verify --format json` 的预跑状态、诊断和修复建议结构
- [x] 产出 delta 文件到 `deltas/skills/code-implementor/SKILL.md` — 将 verify 预跑配置从建议升级为 Step 5 完成前强制检查项
- [x] 产出 delta 文件到 `deltas/skills/project-init/SKILL.md` — 约束新项目 / 已有项目初始化时补齐或诊断 verify 预跑配置
- [x] 产出 delta 文件到 `deltas/test/core-S01-test-cases.md` — 覆盖 init 写入或提示 verify 预跑配置
- [x] 产出 delta 文件到 `deltas/test/core-S08-test-cases.md` — 覆盖 sync 补齐或诊断 verify 预跑配置
- [x] 产出 delta 文件到 `deltas/test/core-S13-test-cases.md` — 覆盖 pre_run_command 兼容、regression + incremental 顺序执行、结果合并和覆盖不足诊断
- [x] 产出 delta 文件到 `deltas/test/core-S16-test-cases.md` — 覆盖 verify JSON 输出中的预跑状态与修复建议
- [x] 产出 delta 文件到 `deltas/test/core-S20-test-cases.md` — 覆盖 adopt 对已有项目 verify 预跑配置的推断与无法推断提示
- [x] 产出 delta 文件到 `deltas/test/smoke/core-smoke-test-cases.md` — 补充发布后 smoke 检查 verify 预跑配置与两阶段验收能力

## [code] 代码实现
- [x] 修改 `cli/src/commands/verify.ts` — 支持 `pre_run_command` 兼容路径、`regression_command` + `incremental_command` 两阶段执行、阶段结果合并、覆盖不足诊断和报告输出
- [x] 修改 `cli/src/commands/init.ts` — 为可识别测试栈写入或提示 `verify.pre_run_command` / `verify.regression_command`
- [x] 修改 `cli/src/commands/adopt.ts` — 接入已有项目时推断测试命令并写入 verify 预跑配置，无法推断时输出明确 TODO / 诊断
- [x] 修改 `cli/src/commands/sync.ts` — 对旧项目补齐缺失的 verify 预跑配置或输出可执行诊断，不静默跳过
- [x] 修改 `cli/src/i18n.ts` — 增加中英文 verify 预跑、覆盖不足诊断、配置补齐提示文案
- [x] 修改 `cli/src/index.ts` / 相关类型定义 — 确保新增 verify 配置和 JSON 输出字段可被 CLI 与客户端稳定消费
- [x] 更新 `cli/test/s01-init.test.ts`、`cli/test/s08-sync.test.ts`、`cli/test/s13-verify.test.ts`、`cli/test/s16-json-output.test.ts`、`cli/test/s20-adopt.test.ts` — 覆盖新增验收用例并写入 OpenLogos reporter

## [deploy] 部署任务
- [x] 按部署方案发布 CLI/npm 包或本提案指定的 staging 包产物
- [x] 重新构建并部署官网 / 文档站，使 verify 预执行模型、配置 schema 和 Skill 文档对外可见
- [x] 确认回滚点可用：CLI 可回退到上一 npm 版本，官网可回退到上一 Cloudflare Pages 成功部署
