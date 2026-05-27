# 变更提案：adopt-bootstrap-adopted

> module: core | created: 2026-05-27

## 变更原因
RunLogos 打开一个没有任何 `logos/` 元数据的存量项目时，用户需要的是“把当前目录接入 OpenLogos”，而不是一个不完整的轻量补丁流程。当前 `adopt` 虽然已经创建大部分基础资产，但产品语义仍被描述为“快速接入 / Phase 1~3 跳过”，容易让用户和客户端误解为它可以少做 `init` 的基础工作。

本次优化要把 `adopt` 的产品定义收敛为：**对存量项目执行完整 OpenLogos 初始化，只跳过 Initial 文档门禁**。也就是说，`adopt` 必须像 `init` 一样完成语言、AI 工具、目录、配置、AI 指令和工具资产初始化；差异只在 `logos-project.yaml` 的入场状态上。

同时，当前 `bootstrap: skipped` 使用“实现效果”命名，表达的是跳过了文档基线，但没有说明为什么跳过。对 RunLogos 和用户来说，真正的业务事实是“该项目通过存量项目接入进入 OpenLogos”。因此应将 `bootstrap: skipped` 改为 `bootstrap: adopted`，让状态语义更清晰。

## 变更类型
需求级 + 状态契约级 + 代码级 + 部署级

## 变更范围
- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md` — 更新 S20 的主路径、验收条件和状态命名。
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md` — 将 `adopt` 规格明确为“完整初始化，仅跳过 Initial 文档门禁”，并把 `bootstrap: skipped` 改为 `bootstrap: adopted`。
- 影响的 CLI 体验原型：`logos/resources/prd/2-product-design/2-page-design/core-01-cli-experience.md` — 更新 `adopt` 终端文案、创建阶段和下一步引导。
- 影响的状态规范：`logos/spec/logos-project.md` — 修改 `modules[].bootstrap` 枚举语义，保留旧值兼容策略。
- 影响的业务场景：S20（adopt 主场景）、S05（next 引导）、S11（status 显示）、S14（launch 门禁豁免）。
- 影响的场景文档：
  - `logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S20-adopt-existing-project.md`
  - `logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md`
  - `logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md`
  - `logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S14-launch-lifecycle.md`
- 影响的测试用例：
  - `logos/resources/test/core-S20-test-cases.md`
  - `logos/resources/test/core-S05-test-cases.md`
  - `logos/resources/test/core-S11-test-cases.md`
  - `logos/resources/test/core-S14-test-cases.md`
  - `logos/resources/test/smoke/core-smoke-test-cases.md`
- 影响的代码：`cli/src/commands/adopt.ts`、`cli/src/commands/init.ts`、`cli/src/commands/next.ts`、`cli/src/commands/status.ts`、`cli/src/commands/launch.ts`、`cli/src/commands/detect.ts`、`cli/src/lib/project-yaml.ts` 及对应测试。
- 影响的 API：无 HTTP API；影响 CLI 文本输出与 `--format json` 状态契约。
- 影响的 DB 表：无。
- 影响的编排测试：无 HTTP API 编排测试。

## 部署影响
- 是否需要部署：是
- 部署原因：修改 `openlogos adopt` 的 CLI 行为、`logos-project.yaml` 状态契约、`next/status/launch/detect` 的兼容判断，以及发布包中的 AI 工具资产初始化体验；需要发布新版本 npm 包后用户和 RunLogos 才能获得一致行为。
- 影响环境：npm 分发包、本地 CLI 安装环境、RunLogos 调用 OpenLogos CLI 的客户端环境。
- 是否涉及数据迁移：否
- 是否需要回滚预案：是（可回退到上一 npm 版本；同时代码需兼容历史 `bootstrap: skipped` 项目）
- 是否需要 smoke：是

## 变更概述
第一，将 `adopt` 明确定义为“只跳过 Initial 的 init”。执行 `openlogos adopt` 时，CLI 必须像 `init` 一样完成项目名识别、语言选择、AI 工具选择、`logos/` 标准目录创建、`logos.config.json` 写入、`logos-project.yaml` 写入、`AGENTS.md` / `CLAUDE.md` 写入、AI tools 资产部署、`logos/spec/` 部署和 verify 预跑配置推断。它不能因为是存量项目接入而少建 OpenLogos 基础设施。

第二，将 `bootstrap: skipped` 改为 `bootstrap: adopted`。`lifecycle: launched` 继续表示模块已进入迭代工作流；`bootstrap: adopted` 表示这个 launched 状态来自存量项目接入，基线文档可能尚未补齐。`next/status/launch` 应使用 `bootstrap: adopted` 判断补文档引导和 Initial 门禁豁免。为兼容既有项目，CLI 在读取时应继续接受历史 `bootstrap: skipped`，但新写入统一使用 `adopted`。

第三，RunLogos 侧的用户体验应基于这个状态契约：无 `logos/` 的项目主动作是 `adopt`；adopt 过程中必须让用户选择文档语言和 AI tool；完成后进入可迭代状态，但无活跃提案时优先建议 `openlogos change add-baseline-docs` 补齐基线文档。
