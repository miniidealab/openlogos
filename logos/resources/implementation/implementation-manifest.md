# website-release-feed 实现清单

## support-nodelta-spec-complete：smoke dispatcher 结果路径修复

### 范围
- 将统一 smoke dispatcher 的 `OPENLOGOS_SMOKE_RESULT_PATH` 规范化为项目根目录下的绝对路径。
- 保证以 `website/` 等嵌套目录为工作目录的 runner 与根目录 runner 写入同一份 JSONL 结果账本。
- 防止嵌套 runner 将结果误写到 `website/logos/resources/verify/`，造成官网 smoke 用例 uncovered。

### 覆盖用例
- [x] UT-S19-SMOKE-03
- [x] ST-S19-SMOKE-02
- [x] SMOKE-core-03 / 07 / 08 / 15 / 21 / 22 / 23 / 24 / 34 / 35 / 36 / 37

### 产物
- `scripts/run-smoke.js`
- `cli/test/s19-smoke.test.ts`
- `logos/resources/verify/test-results.jsonl`
- `logos/resources/verify/smoke-results.jsonl`
- `logos/resources/verify/smoke-report.md`

### 验证
- `cd cli && npm test -- test/s19-smoke.test.ts --cache false`：20/20 通过。
- `cd cli && npm test -- --cache false`：1078/1078 通过。
- `cd website && npm test`：3/3 通过。
- `openlogos smoke`：37/37 通过，Gate 3.8 PASS。

## fix-post-merge-slice-planner-auto-skip

### 范围
- 修复 CLI `next --auto` 在 `ready-to-implement` 驻留态下误消费 `slice-exit` 的前置条件。
- 当 `tasks.md` 的 `[code]` 仍为空、模板或占位项时，保持前沿为 `plan-slices`，不写 `SLICES_APPROVED`，不追加 `GATE_AUTO_PASSED{slice-exit}`，不派生 `coding` / `code`。
- 当 `[code]` 已满足 `tasks_code_filled` 时，保持既有 `slice-exit --auto` 放行语义。

### 覆盖用例
- [x] UT-S24-23
- [x] UT-S24-24
- [x] ST-S24-10
- [x] ST-S24-EX-4e.2
- [x] UT-S32-13
- [x] UT-S32-14
- [x] ST-S32-05
- [x] ST-S32-EX-4

### 产物
- `cli/src/commands/next.ts`
- `cli/test/s24-auto-gate.test.ts`
- `cli/test/s32-slice-planning.test.ts`
- `logos/resources/verify/test-results.jsonl`

### 验证
- `cd cli && npm run build`
- `cd cli && npm test -- s24-auto-gate.test.ts s32-slice-planning.test.ts`
- `cd cli && npm test -- --cache false`

## 范围
- 官网发布动态页面 `/releases`
- 首页发布日志入口
- npm 发布数据生成脚本
- 官网发布动态 smoke 检查脚本

## 覆盖任务
- [x] 增加官网构建期 npm 发布数据生成脚本和静态数据文件
- [x] 新增 `/releases` 全量发布日志页面并在首页加入发布日志入口
- [x] 更新官网导航、构建脚本和 smoke 测试覆盖

## 产物
- `website/scripts/generate-releases.mjs`
- `website/src/data/releases.json`
- `website/src/pages/releases.astro`
- `website/src/pages/index.astro`
- `website/src/layouts/BaseLayout.astro`
- `website/src/pages/zh/index.astro`
- `website/scripts/smoke-releases.mjs`

## 验证
- `npm run generate:releases`
- `npm run build`
- `npm run smoke:releases`

## fix-cli-panel-lifecycle-detection

### 范围
- 为 `detect --format json` 和 `status --format json` 增加 `logos-project.yaml` 容错读取
- 在 YAML 局部损坏时恢复 `modules[]` 并派生 `lifecycle`
- 为 JSON 输出补充 `yaml_diagnostics`

### 覆盖任务
- [x] 新增 `cli/src/lib/project-yaml.ts`，统一处理正常解析、可恢复解析和不可恢复解析
- [x] 修改 `cli/src/commands/detect.ts`，输出 `project.modules`、`project.lifecycle` 和 `yaml_diagnostics`
- [x] 修改 `cli/src/commands/status.ts`，在 `collectStatusData()` 和 `--module` 校验中使用容错读取
- [x] 更新 `cli/test/s16-json-output.test.ts`，覆盖可恢复与不可恢复 YAML 两类 JSON 输出
- [x] 更新 `cli/test/openlogos-reporter.ts` 与 `cli/src/commands/verify.ts`，兼容 `UT-JSON-*` / `ST-JSON-*` 用例 ID

### 验证
- `cd cli && npm test -- --run test/s16-json-output.test.ts test/s11-status.test.ts test/s17-module.test.ts`
- `node /Users/huangxianglong/gitlab/openlogos/cli/dist/index.js detect --format json`
- `node /Users/huangxianglong/gitlab/openlogos/cli/dist/index.js status --format json`

## releases-version-value-clarity

### 范围
- 官网 `/releases` 页面版本价值摘要与问题修复摘要
- `CHANGELOG.md` 结构化摘要提取
- release 页面摘要缺失时的固定回退提示与外链
- 官网发布动态 smoke 检查脚本

### 覆盖任务
- [x] 更新 `website/scripts/generate-releases.mjs`，构建期读取 `CHANGELOG.md` 并写入 `valueSummary`、`fixSummary`、`summarySource`、`summaryFallbackReason`
- [x] 更新 `website/src/data/releases.json`，为每个版本提供可展示摘要字段
- [x] 更新 `website/src/pages/releases.astro`，展示 `What value changed`、`What got fixed` 与回退说明
- [x] 更新 `website/scripts/smoke-releases.mjs`，覆盖 `SMOKE-core-03`、`SMOKE-core-07`、`SMOKE-core-08`
- [x] 新增 `website/test/releases-summary.test.mjs`，覆盖摘要解析与缺失分类回退

### 产物
- `website/src/lib/releases-summary.mjs`
- `website/scripts/generate-releases.mjs`
- `website/src/data/releases.json`
- `website/src/pages/releases.astro`
- `website/scripts/smoke-releases.mjs`
- `website/test/releases-summary.test.mjs`
- `website/package.json`

### 验证
- `cd website && npm test`
- `cd website && npm run generate:releases`
- `cd website && npm run build`
- `cd website && npm run smoke:releases`

## releases-bilingual-release-notes

### 范围
- 官网 `/releases` 页面英文优先、中文原文次级展示
- 维护型英文 release summary 静态数据
- `CHANGELOG.md` 中文原文摘要提取与英文摘要合并
- release 页面双语 smoke 检查

### 覆盖任务
- [x] 新增 `website/src/data/release-summaries-en.mjs`，维护确定性的英文价值摘要与修复摘要
- [x] 更新 `website/src/lib/releases-summary.mjs`，生成 `valueSummaryEn`、`fixSummaryEn`、中文原文摘要、`summarySource` 和缺失原因
- [x] 更新 `website/src/pages/releases.astro`，英文摘要主展示，中文原文通过 `details` 次级展示，缺失英文摘要时显示固定英文回退
- [x] 更新 `website/scripts/smoke-releases.mjs`，覆盖英文价值摘要、英文修复摘要、中文原文与固定回退提示
- [x] 更新 `website/test/releases-summary.test.mjs` 与 `website/test/helpers/openlogos-reporter.mjs`，写入 OpenLogos reporter 结果 `UT-S13-24`
- [x] 更新 `logos/logos.config.json`，让 `openlogos verify` 预跑 CLI 测试后追加官网测试结果

### 产物
- `website/src/data/release-summaries-en.mjs`
- `website/src/lib/releases-summary.mjs`
- `website/src/data/releases.json`
- `website/src/pages/releases.astro`
- `website/scripts/smoke-releases.mjs`
- `website/test/releases-summary.test.mjs`
- `website/test/helpers/openlogos-reporter.mjs`
- `logos/resources/test/core-S13-test-cases.md`
- `logos/logos.config.json`

### 验证
- `cd website && npm test`
- `cd website && npm run generate:releases`
- `cd website && npm run build`
- `cd website && npm run smoke:releases`
- `cd cli && npm test && cd ../website && npm test`

## add-deploy-done-command

### 范围
- 新增 `openlogos deploy-done` 命令
- 部署完成 marker 受控写入
- `[deploy]` section 自动勾选
- 旧 `SMOKE_PASS` / `SMOKE_FAIL` 清理
- `deploy-done --format json` 输出契约

### 覆盖用例
- [x] UT-S21-01
- [x] UT-S21-02
- [x] UT-S21-03
- [x] UT-S21-04
- [x] UT-S21-05
- [x] UT-S21-06
- [x] UT-S21-07
- [x] UT-S21-08
- [x] UT-S21-09
- [x] ST-S21-01
- [x] ST-S21-02
- [x] ST-S21-03
- [x] ST-S21-EX-2.1
- [x] ST-S21-EX-3.1
- [x] ST-S21-EX-4.1
- [x] ST-S21-EX-5.1
- [x] ST-S21-EX-5.2
- [x] ST-S21-EX-6.1

### 产物
- `cli/src/commands/deploy-done.ts`
- `cli/src/index.ts`
- `cli/src/i18n.ts`
- `cli/test/s21-deploy-done.test.ts`
- `logos/resources/verify/test-results.jsonl`

### 验证
- `cd cli && npm run build`
- `cd cli && npx vitest run test/s21-deploy-done.test.ts`
- `cd cli && npx vitest run test/s05-next.test.ts test/s11-status.test.ts`
- `cd cli && npx vitest run test/s13-verify.test.ts test/s19-smoke.test.ts test/s16-json-output.test.ts`
- `cd cli && npm test`

## flow-engine-foundation（切片 A：flow 加载器 + flow show + golden 基线）

### 范围
- 新增 flow 加载器：读包内 `spec/flow/<lifecycle>.yaml` 内置模板（dev/test/prepack 三路径解析）
- overlay 解析：`extends`（含 baseline/lifecycle 校验、`@vN` 版本告警）+ skip/add/modify/reorder 四操作 node-id strategic-merge + 基础与合并后 schema 校验、node id 唯一性
- 新增 `openlogos flow show [--resolved] [--lifecycle] [--format json]` 只读命令
- golden 基线快照锁定现有 status/next 输出（切片 B 等价锚点）
- **零行为变更**：未接入 status/next 派生

### 覆盖用例
- [x] UT-S22-01 ~ UT-S22-16
- [x] ST-S22-01 ~ ST-S22-08
- [x] ST-S22-EX-2.1 / ST-S22-EX-4.1 / ST-S22-EX-5.1 / ST-S22-EX-5.2
- [x] golden-baseline characterization（表征 S05/S11/S16，不计编号）

### 产物
- `cli/src/lib/flow.ts`
- `cli/src/commands/flow.ts`
- `cli/src/index.ts`
- `cli/src/i18n.ts`
- `cli/test/s22-flow.test.ts`
- `cli/test/golden-baseline.test.ts`
- `cli/test/__snapshots__/golden-baseline.test.ts.snap`
- `spec/cli-json-output.md`、`spec/flow-spec.md`（§9 / §10.1 / §10.2，已 merge）
- `logos/resources/verify/test-results.jsonl`

### 验证
- `cd cli && npm run build`
- `cd cli && npx vitest run test/s22-flow.test.ts test/golden-baseline.test.ts`
- `cd cli && npm test`（全量回归，零行为变更核验）
- `node cli/dist/index.js flow show --lifecycle initial --format json`
