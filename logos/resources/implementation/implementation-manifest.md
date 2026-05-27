# website-release-feed 实现清单

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
