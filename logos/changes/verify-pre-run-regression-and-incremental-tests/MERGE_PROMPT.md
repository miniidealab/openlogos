# 合并指令

## 变更提案
- 提案名称：verify-pre-run-regression-and-incremental-tests
- 提案目录：logos/changes/verify-pre-run-regression-and-incremental-tests/

## 提案内容

# 变更提案：verify-pre-run-regression-and-incremental-tests

> module: core | created: 2026-05-27

## 变更原因
`logos/resources/reference/todo2.md` 中描述的问题真实存在：当前 `openlogos verify` 已支持 `verify.pre_run_command`，但该能力仍偏“建议配置”，没有形成稳定的项目初始化、同步、接入和验收诊断闭环。

现有实现中，`cli/src/commands/verify.ts` 只读取单一 `verify.result_path`，可选执行单一 `verify.pre_run_command`，随后直接根据 `test-results.jsonl` 计算覆盖率；当 JSONL 只包含最近一次局部测试结果时，verify 会把缺失用例判为未覆盖，但不会明确提示“可能只运行了局部测试”或引导用户配置全量预跑命令。`spec/test-results.md` 已说明 reporter 每次完整测试前会清空结果文件，`logos.config.schema.json` 也只定义了 `result_path`、`pre_run_command` 和旧字段 `test_command`，尚未定义回归测试 + 增量测试的两阶段预执行模型。

另外，`openlogos init` / `adopt` 默认只写入 `verify.result_path`，`sync` 也没有对缺失的 verify 预跑配置做稳定补齐或诊断。因此多个项目在只运行局部测试后执行 `openlogos verify` 时，容易出现业务代码与测试实际通过、但验收因 JSONL 覆盖不完整而失败的误判。

## 变更类型
需求级变更

## 变更范围
- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md`（S01、S08、S13、S16、S20 相关验收要求）
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`（verify、init、sync、adopt、JSON 输出行为）
- 影响的业务场景：
  - `logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-cli-init.md`
  - `logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S08-sync-ai-tools.md`
  - `logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S13-verify-results.md`
  - `logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md`
  - `logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S20-adopt-existing-project.md`
- 影响的架构 / 规范：
  - `logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md`
  - `spec/test-results.md`
  - `spec/logos.config.schema.json`
  - `spec/workflow.md`
  - `spec/cli-json-output.md`
- 影响的 Skill：
  - `logos/skills/code-implementor/SKILL.md`
  - `logos/skills/project-init/SKILL.md`
- 影响的测试用例：
  - `logos/resources/test/core-S01-test-cases.md`
  - `logos/resources/test/core-S08-test-cases.md`
  - `logos/resources/test/core-S13-test-cases.md`
  - `logos/resources/test/core-S16-test-cases.md`
  - `logos/resources/test/core-S20-test-cases.md`
  - `logos/resources/test/smoke/core-smoke-test-cases.md`
- 影响的 API：无，OpenLogos 本体非业务 HTTP API 项目
- 影响的 DB 表：无
- 影响的编排测试：无，当前模块跳过 API 编排测试

## 部署影响
- 是否需要部署：是
- 部署原因：本变更会修改 CLI `openlogos verify`、`init`、`adopt`、`sync` 的运行时行为，并更新公开规范 / Skill 文档；需要发布 CLI/npm 包，并同步官网或文档站中对应说明。
- 影响环境：本地 / 测试 / 预发 / 生产
- 是否涉及数据迁移：否
- 是否需要回滚预案：是
- 是否需要 smoke：是

## 变更概述
本变更将把“verify 前生成完整测试结果”从依赖 AI 或人工配置的建议，升级为 OpenLogos 的正式验收机制。`openlogos verify` 应继续兼容旧的 `verify.pre_run_command`，同时新增可配置的两阶段预执行模型：先运行 `verify.regression_command`，再运行 `verify.incremental_command`，并通过阶段化结果文件或合并策略保证第二阶段不会覆盖第一阶段结果。最终验收仍按同一套用例 ID 计算，重复 ID 以最后一次结果为准。

配置层需要扩展 `logos.config.json` 的 `verify` schema，明确 `result_path`、`pre_run_command`、`regression_command`、`incremental_command`、`regression_result_path`、`incremental_result_path`、`merge_results` 等字段的语义和兼容关系。`openlogos init` / `adopt` / `sync` 需要对常见 Node/Vitest、Jest、pytest、Go、Cargo 项目补齐或建议合适的全量测试命令；无法推断时必须输出清晰诊断，不静默跳过。

验收输出需要补充可读诊断和机器可读状态：当没有任何预跑命令且覆盖率不足时，CLI 文本输出与 `--format json` 都应指出可能原因是只运行了局部测试，并给出配置 `verify.pre_run_command` 或 `verify.regression_command` 的修复建议。RunLogos 等客户端仍只调用 `openlogos verify --format json`，不在 UI 侧复刻测试编排逻辑。


## 需要合并的 Delta 文件

### 1. deltas/prd/1-product-requirements/core-01-requirements.md

- Delta 文件：`logos/changes/verify-pre-run-regression-and-incremental-tests/deltas/prd/1-product-requirements/core-01-requirements.md`
- 目标目录：`logos/resources/prd/1-product-requirements/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 2. deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md

- Delta 文件：`logos/changes/verify-pre-run-regression-and-incremental-tests/deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`
- 目标目录：`logos/resources/prd/2-product-design/1-feature-specs/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 3. deltas/prd/2-product-design/2-page-design/core-01-cli-experience.md

- Delta 文件：`logos/changes/verify-pre-run-regression-and-incremental-tests/deltas/prd/2-product-design/2-page-design/core-01-cli-experience.md`
- 目标目录：`logos/resources/prd/2-product-design/2-page-design/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 4. deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md

- Delta 文件：`logos/changes/verify-pre-run-regression-and-incremental-tests/deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md`
- 目标目录：`logos/resources/prd/3-technical-plan/1-architecture/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 5. deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-cli-init.md

- Delta 文件：`logos/changes/verify-pre-run-regression-and-incremental-tests/deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-cli-init.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 6. deltas/prd/3-technical-plan/2-scenario-implementation/core-S08-sync-ai-tools.md

- Delta 文件：`logos/changes/verify-pre-run-regression-and-incremental-tests/deltas/prd/3-technical-plan/2-scenario-implementation/core-S08-sync-ai-tools.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 7. deltas/prd/3-technical-plan/2-scenario-implementation/core-S13-verify-results.md

- Delta 文件：`logos/changes/verify-pre-run-regression-and-incremental-tests/deltas/prd/3-technical-plan/2-scenario-implementation/core-S13-verify-results.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 8. deltas/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md

- Delta 文件：`logos/changes/verify-pre-run-regression-and-incremental-tests/deltas/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 9. deltas/prd/3-technical-plan/2-scenario-implementation/core-S20-adopt-existing-project.md

- Delta 文件：`logos/changes/verify-pre-run-regression-and-incremental-tests/deltas/prd/3-technical-plan/2-scenario-implementation/core-S20-adopt-existing-project.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 10. deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md

- Delta 文件：`logos/changes/verify-pre-run-regression-and-incremental-tests/deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`
- 目标目录：`logos/resources/prd/3-technical-plan/3-deployment/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 11. deltas/skills/code-implementor/SKILL.md

- Delta 文件：`logos/changes/verify-pre-run-regression-and-incremental-tests/deltas/skills/code-implementor/SKILL.md`
- 目标目录：`skills/code-implementor/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 12. deltas/skills/project-init/SKILL.md

- Delta 文件：`logos/changes/verify-pre-run-regression-and-incremental-tests/deltas/skills/project-init/SKILL.md`
- 目标目录：`skills/project-init/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 13. deltas/spec/cli-json-output.md

- Delta 文件：`logos/changes/verify-pre-run-regression-and-incremental-tests/deltas/spec/cli-json-output.md`
- 目标目录：`spec/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 14. deltas/spec/logos.config.schema.json

- Delta 文件：`logos/changes/verify-pre-run-regression-and-incremental-tests/deltas/spec/logos.config.schema.json`
- 目标目录：`spec/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 15. deltas/spec/test-results.md

- Delta 文件：`logos/changes/verify-pre-run-regression-and-incremental-tests/deltas/spec/test-results.md`
- 目标目录：`spec/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 16. deltas/spec/workflow.md

- Delta 文件：`logos/changes/verify-pre-run-regression-and-incremental-tests/deltas/spec/workflow.md`
- 目标目录：`spec/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 17. deltas/test/core-S01-test-cases.md

- Delta 文件：`logos/changes/verify-pre-run-regression-and-incremental-tests/deltas/test/core-S01-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 18. deltas/test/core-S08-test-cases.md

- Delta 文件：`logos/changes/verify-pre-run-regression-and-incremental-tests/deltas/test/core-S08-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 19. deltas/test/core-S13-test-cases.md

- Delta 文件：`logos/changes/verify-pre-run-regression-and-incremental-tests/deltas/test/core-S13-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 20. deltas/test/core-S16-test-cases.md

- Delta 文件：`logos/changes/verify-pre-run-regression-and-incremental-tests/deltas/test/core-S16-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 21. deltas/test/core-S20-test-cases.md

- Delta 文件：`logos/changes/verify-pre-run-regression-and-incremental-tests/deltas/test/core-S20-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 22. deltas/test/smoke/core-smoke-test-cases.md

- Delta 文件：`logos/changes/verify-pre-run-regression-and-incremental-tests/deltas/test/smoke/core-smoke-test-cases.md`
- 目标目录：`logos/resources/test/smoke/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

## 执行要求

1. 逐个 Delta 文件处理，每处理完一个报告修改摘要
2. 对于 ADDED 标记：在主文档的指定位置插入新内容
3. 对于 MODIFIED 标记：替换主文档中同名章节的内容
4. 对于 REMOVED 标记：从主文档中删除对应章节
5. 保持主文档的原有格式和风格
6. 如果主文档有"最后更新"时间戳，同步更新
7. 所有变更完成后，列出修改清单
8. 所有变更合并完成后，自动执行 git commit（告知用户，无需确认）：
   git add -A && git commit -m "docs(verify-pre-run-regression-and-incremental-tests): merge spec deltas"
   然后提示用户：按更新后的规格实现代码，代码完成后运行 `openlogos verify` 验收，验收通过后明确授权执行 `openlogos archive verify-pre-run-regression-and-incremental-tests`。
