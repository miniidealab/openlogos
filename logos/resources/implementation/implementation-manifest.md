# website-release-feed 实现清单

## fix-test-slice-changed-id-semantic-diff（三个自闭环切片）

### 实现范围

- merge-apply 以 Markdown authority table parser 对测试规格 before/final 字节做语义差异，生成严格 `openlogos/test-change-set@1`，并与 resources、metadata、`SPEC_MERGED` 同事务提交。
- `applyBaselineClosureBatch()` 在备份清理前执行后置重读复核；resource、metadata、marker rename 或 post-read 任一故障均整批回滚。
- TestChangeSetReader 校验 schema、固定键序、canonical hash、change/module、target identity 与 after hash；status、next、change-lint、slice validator、verify 共享 C/R 与 provenance。
- slice manifest 只允许 `changed_test_ids` 唯一归属；baseline/removed owned、changed 漏配、多片重复、来源缺失/篡改均在 runner 前 fail-closed，来源错误不得误派 `plan-slices`。
- CLI 与 Claude/Codex/ZCode/Qoder/WorkBuddy 插件版本统一为 `0.13.30`；新增固定本地 tarball 的全局 candidate/`0.13.29` rollback smoke runner，不含公开发布命令。

### 覆盖切片与真实用例

- [x] 切片 1：UT-S39-33～UT-S39-38、ST-S39-17～ST-S39-19。
- [x] 切片 2：UT-S32-43～UT-S32-49、ST-S32-14～ST-S32-16。
- [x] 切片 3：SMOKE-core-130～SMOKE-core-134（runner/reporter/dispatcher 已实现；真实本机全局执行等待 verify 与部署、smoke 授权）。

### 主要产物

- `cli/src/lib/test-change-set.ts`、`cli/src/lib/test-slice-manifest.ts`、`cli/src/lib/baseline-apply.ts`
- `cli/src/commands/merge-apply.ts`、`cli/src/commands/status.ts`、`cli/src/commands/next.ts`、`cli/src/commands/verify.ts`
- `cli/src/lib/change-lint.ts`、`cli/src/lib/proposal-lifecycle.ts`、`cli/src/lib/flow-loop-derive.ts`
- `cli/test/test-change-set.test.ts`、`cli/test/slice-aware-verify.test.ts`
- `spec/schema/status.schema.json`、`spec/schema/next.schema.json`、`spec/schema/verify.schema.json`
- `scripts/smoke-test-change-set-local-global.js`、`scripts/smoke-slice-aware-verify.js`、`scripts/run-smoke.js`

### 验证

- `cd cli && npm run build`：通过。
- `cd cli && npm run lint`：通过。
- `cd cli && npm test`：80 个测试文件、1992/1992 通过；新增 S39/S32 真实 UT/ST ID 由 OpenLogos reporter 逐条记录。
- `node scripts/smoke-test-change-set-local-global.js --self-test`：五个 smoke ID、`local-global` 环境、candidate/rollback 输入和公开发布零调用合同通过。
- 未执行 `openlogos verify`、本机全局安装、真实 rollback 或 smoke；这些操作保留至对应人类授权节点。

## make-verify-slice-aware（五个自闭环切片）

### 实现范围

- 新增 `TEST_SLICE_MANIFEST.json` v1 严格校验、task/spec fingerprint、测试 ID 唯一归属、原子写入和 `SLICE_CHECKPOINTS.jsonl` 幂等账本。
- `verify` 按 manifest/checkpoint 派生 `slice-checkpoint` 与 `final`：pending 不进入覆盖分母，未来结果越界失败，只有 final PASS 写 `VERIFY_PASS`。
- status/next/verify 暴露同源切片状态；missing/invalid/stale 派发 `plan-slices` 恢复，unsupported/ambiguous 保守阻塞，恢复态不启动 runner、不写 Gate/loop 状态。
- implement loop 使用 manifest 中稳定的 attempted slice；checkbox 提前勾选不串片，真实 checkpoint FAIL 才消耗 repair iteration，loop-exhausted 红线保持不可自动放行。
- CLI、Claude 插件与 Codex 插件版本统一为 `0.13.26`；随包发布 status/next/verify Schema、slice-planner 与 manifest 规范，并新增 `SMOKE-core-62..66` 真实安装 runner。

### 覆盖切片与真实用例

- [x] 切片 1：UT-S13-56、UT-S13-57、UT-S13-58、UT-S13-60、UT-S13-63、UT-S16-10、UT-S16-12、UT-S32-32、UT-S32-33、UT-S32-34、UT-S32-35、UT-S32-36、UT-S32-37、UT-S32-38、UT-S32-39、UT-S32-42、ST-S32-10。
- [x] 切片 2：UT-S13-64、ST-S13-17、UT-S16-13、UT-S16-14、UT-S16-15、UT-S16-17、ST-S16-04、UT-S27-34、UT-S27-35、ST-S27-13、UT-S28-37、UT-S28-38、UT-S28-39、UT-S28-40、UT-S28-41、UT-S28-42、UT-S28-43、UT-S28-44、ST-S28-12、ST-S28-13、ST-S28-14、UT-S32-40、UT-S32-41、ST-S32-11、ST-S32-12、ST-S32-13。
- [x] 切片 3：UT-S13-59、ST-S13-16、UT-S27-33、UT-S27-36、UT-S27-37、UT-S27-38、UT-S27-40、ST-S27-12、UT-S31-28、UT-S31-29、UT-S31-30、UT-S31-31、UT-S31-32、UT-S31-36、ST-S31-13、ST-S31-14。
- [x] 切片 4：UT-S13-61、UT-S13-62、ST-S13-15、UT-S16-11、ST-S16-03、UT-S27-39、ST-S27-11、UT-S31-33、UT-S31-34、UT-S31-35、ST-S31-12、ST-S31-15。
- [x] 切片 5：UT-S16-16、SMOKE-core-62、SMOKE-core-63、SMOKE-core-64、SMOKE-core-65、SMOKE-core-66。

### 主要产物

- `cli/src/lib/test-slice-manifest.ts`
- `cli/src/commands/verify.ts`、`cli/src/commands/status.ts`、`cli/src/commands/next.ts`
- `cli/src/lib/proposal-lifecycle.ts`、`cli/src/lib/flow-loop-derive.ts`、`cli/src/lib/step-registry.ts`
- `cli/test/slice-aware-verify.test.ts`、`cli/vitest.config.ts`
- `spec/schema/status.schema.json`、`spec/schema/next.schema.json`、`spec/schema/verify.schema.json`
- `scripts/smoke-slice-aware-verify.js`、`scripts/run-smoke.js`
- `logos/resources/verify/test-results.jsonl`（全局 OpenLogos reporter）

### 验证

- `cd cli && npm run build`：通过。
- `cd cli && npx vitest run test/slice-aware-verify.test.ts`：17/17 通过。
- `cd cli && npm test`：62 个测试文件、1769/1769 通过；manifest 中 72 个 UT/ST ID 均有最新 pass reporter 记录。
- `cd cli && npm pack --dry-run --json`：通过；候选包版本为 0.13.26，包含三份 JSON Schema、slice-planner、`spec/test-slice-manifest.md` 与编译后的 manifest 实现。
- `scripts/smoke-slice-aware-verify.js` 已通过语法检查并由统一 dispatcher 可达；部署后的 `openlogos smoke` 与 0.13.25 tarball 隔离回滚演练尚未执行，保留至人类授权节点。

## win32-archive-watcher-handshake（单一自闭环切片）

### 范围
- 新增 `openlogos.archive-watch/v1` CLI 消费端：确定性项目标识与协议路径、租约快照、不可协调实例识别、原子 prepare/result、ACK 屏障、过期清理、single-flight、去递归 token 与磁盘三态调和。
- `openlogos archive` 仅在注入/真实平台为 `win32` 时执行握手；非 Windows 路径不访问协议目录、不校验 token、不等待，保持原 rename 行为。
- Windows 握手失败、超时、实例失败与三态矛盾均 fail-closed；旧版 watcher 导致的 `EPERM`/`EACCES`/`EBUSY` 输出明确诊断且不自动重试。
- 本仓只实现 CLI 端；真实 Windows watcher + rename 端到端验证明确留待打包后在 Windows 机器执行。

### 覆盖用例
- [x] UT-S09-125 ~ UT-S09-134
- [x] ST-S09-44 ~ ST-S09-47
- [x] ST-S09-EX-10.1 ~ ST-S09-EX-10.4
- [x] ST-S09-01、ST-S11-08、UT-S24-AE-01、ST-S24-AE-01

### 产物
- `cli/src/lib/archive-watch.ts`
- `cli/src/lib/index.ts`
- `cli/src/commands/archive.ts`
- `cli/src/i18n.ts`
- `cli/test/s09-change.test.ts`
- `spec/cli-json-output.md`、`logos/spec/cli-json-output.md`
- `spec/workflow.md`、`logos/spec/workflow.md`
- `logos/resources/verify/test-results.jsonl`（OpenLogos reporter）

### 验证
- `cd cli && npm run build`：通过。
- `cd cli && npm test -- test/s09-change.test.ts --cache false`：47/47 通过。
- `cd cli && npm test -- test/s09-change.test.ts test/s11-status.test.ts test/s24-auto-gate.test.ts --cache false`：193/193 通过；上述 22 个新增/复用 ID 均由 reporter 记录为 `pass`。
- `cd cli && npm test -- --cache false`：54 个测试文件、1529/1529 通过。
- `cd website && npm test`：3/3 通过。
- `cd cli && npx eslint src/commands/archive.ts src/lib/archive-watch.ts src/lib/index.ts src/i18n.ts`：通过。
- 未在 macOS 伪报 Windows 真机结果；Windows 端到端验证状态为“待打包后在 Windows 机器执行”。

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
