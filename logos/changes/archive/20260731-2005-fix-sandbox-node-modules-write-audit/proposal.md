# 变更提案：verify / smoke 沙箱写入审计豁免一次性依赖目录（node_modules）

> module: core | created: 2026-07-31

## 变更原因

来源于社区 Bug 报告 [GitHub issue #8](https://github.com/miniidealab/openlogos/issues/8)（openlogos 0.13.6 实测复现，0.13.20 行为一致）：

1. **误报根因**：pnpm 11 将 `verifyDepsBeforeRun` 默认值改为 `install`。verify 沙箱把 workspace（含 `node_modules`）整体复制到临时目录后，`pnpm <script>` 会检测到依赖状态不一致（`node_modules/.modules.yaml` 记录的项目路径指向原目录）并自动 install/repair，重写 `node_modules/.bin/*`。
2. **审计误判**：沙箱写入审计（`cli/src/lib/sandbox.ts` 基线快照 → 命令后快照 → diff → 白名单过滤）对 `node_modules` 一视同仁，而白名单仅含结果文件，于是这批依赖准备写入被判为「非白名单写入」——`auto` 模式每次 verify 固定告警，`always` 模式直接 FAIL。
3. **实际无害**：这些写入永远不会污染真实 workspace——回收阶段只拷回白名单路径，沙箱目录随后整体删除。固定误报会训练用户忽略告警，或诱导关闭沙箱 / 写保护，反而削弱这层防护。

设计边界判断（对照 `spec/workflow.md`「工作区写入保护」）：写入审计的保护目标是**原 workspace 的规格与源码资产**；`node_modules` 是沙箱内一次性依赖目录、从不回收，不属于审计应关注的对象。因此采用「执行器内置豁免依赖目录」方案，**不开放**项目级通用 allow-path 配置（会破坏「白名单仅含结果文件、报告文件和 CLI 显式生成的门禁标记」这一 spec 不变量，且诱导扩大边界掩盖真实越界写入）。

## 变更类型

设计级变更（沙箱执行器写入审计语义调整，传播到场景 + 测试 + 代码 + 文档；不涉及原型 / API / DB），附带接口级成分：verify / smoke JSON 输出的 `sandbox` 对象新增可选字段 `infos: string[]`（additive、向后兼容，`spec/cli-json-output.md` 随代码阶段同步）

## 变更范围

- 影响的需求文档：`prd/1-product-requirements/core-01-requirements.md` — S13「异常：sandbox always 无法隔离」验收条件（约 L318-321）、S19「异常：sandbox always 无法隔离」对应条目（约 L387-390），补充依赖目录豁免限定
- 影响的功能规格：`prd/2-product-design/1-feature-specs/core-01-feature-specs.md` — 沙箱执行器规格（约 L113-130）新增「依赖目录豁免」不变量与信息级诊断；§S13 / §S19 验收摘要（约 L1010 / L1033）同步措辞
- 影响的业务场景：S13（`core-S13-verify-results.md` EX-3.2 非白名单写入语义收窄）、S19（`core-S19-smoke-gate.md` EX-4.3 同步，沙箱执行器为 verify / smoke 共享）
- 影响的部署方案：无
- 影响的 API：无
- 影响的 DB 表：无
- 影响的编排测试：无（`logos/resources/scenario/` 为空）
- 影响的 smoke 测试：无（不改 smoke 用例规格，仅执行器行为）
- 影响的测试用例规格：`test/core-S13-test-cases.md`（新增 UT-S13-47 ~ UT-S13-55 / ST-S13-14，顺延既有最大编号 UT-S13-46 / ST-S13-13；含 symlink 启动前隔离与运行期写保护、精确段匹配负例、白名单定点回收、能力分层用例）、`test/core-S19-test-cases.md`（新增 UT-S19-08 / UT-S19-09，顺延既有最大编号 UT-S19-07）
- 代码阶段随源更新（不产 delta、直接改源）：`cli/src/lib/sandbox.ts`、`cli/test/s13-verify.test.ts`、`cli/test/s19-smoke.test.ts`、根目录 `spec/workflow.md`（工作区写入保护小节）与 `spec/cli-json-output.md`（sandbox 诊断语义补一行）及 `logos/spec/` dogfood 副本、官网文档 `website/src/content/docs/cli/verify.md`、`cli/smoke.md`、`zh/cli/verify.md`、`zh/cli/smoke.md`

## 部署影响

- 是否需要部署：否
- 部署原因：纯 CLI 本地行为修复。按用户决策，本提案**不升级版本、不发布、不部署**——修复合入 master 后与后续其他 bug 修复共同攒入下一个发布版本（发布走独立 release 提案）
- 影响环境：无
- 是否涉及数据迁移：否
- 是否需要回滚预案：否
- 是否需要 smoke：否

## UI/UX 变更声明

```yaml
ui_impact: false            # 纯 CLI 项目，非 GUI，整节不启用
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

## 变更概述

**① 写入审计内置豁免依赖目录（精确段匹配）**：沙箱执行器的变更检测把「规范化并统一分隔符后，存在至少一个**完整路径段严格等于** `node_modules`」的路径（含 monorepo 嵌套形态如 `packages/a/node_modules/**`）视为沙箱内一次性依赖目录，**不参与**非白名单写入判定；禁止子串/前缀/后缀匹配，`src/node_modules-cache/**`、`node_modules.txt` 等近似名称不豁免。这是执行器内置固定规则，**不是**用户可配置白名单——语义上区分「允许写入并回收到 workspace」（白名单，仅结果文件）与「不参与 workspace 写入审计」（豁免）。

**② 快照遍历跳过依赖目录 + 白名单定点采集回收**：基线 / 命令后两次全量文件快照直接跳过 `node_modules`，中大型 JS 项目（数万至数十万文件）的 verify 沙箱快照开销大幅下降。copy-back 改为对白名单路径**定点采集**（存在即拷回，不依赖快照 diff），**白名单回收优先于豁免**——结果文件即使被配置在 `node_modules` 下也照常回收，不因跳过而静默丢失。

**③ symlink 隔离与运行期写保护不变量（先于豁免生效）**：复制 workspace 进沙箱必须保持 symlink 原始目标字面量（等价 `verbatimSymlinks` 语义；Node `cpSync` 默认会把相对链接改写为指向原 workspace 的绝对路径，实测穿透写入直接落回原 workspace），复制后执行 realpath containment 校验，存在逃逸链接按「无法隔离」处理；在此之上，命令执行期间由 **OS 级运行期写保护**（macOS `sandbox-exec` 拒写原 workspace 子树 / Linux mount namespace 只读绑定 / 等价机制）保证**运行期新建或改写的 symlink** 也无法写入原 workspace——在写入发生前于文件系统层阻断，而非事后检测。写保护机制不可用时按能力分层：`always` FAIL 并说明原因，`auto` 继续沙箱执行但 `sandbox.status=warn` 并披露残留风险。

**④ 保留可观测性（infos 信息级通道）**：JSON 输出 `sandbox` 对象新增可选字段 `infos: string[]`（additive、向后兼容），豁免生效时追加一条固定信息级说明；该说明不写入 `sandbox.diagnostics`、不被复制进 `pre_run.diagnostics`，文本输出以 `ℹ️` 渲染且仅一次；`sandbox.status` 不因 infos 置 warn/fail。`spec/cli-json-output.md` 同步补充字段定义。

**⑤ 语义边界不变（回归保障）**：豁免规则之外的非白名单写入判定一字不改——`always` 仍 FAIL、`auto` 仍 warn；白名单构成不变；`sandbox_mode=off` 与未配置项目的历史行为不变。

**⑥ 附带记录的既有不一致**：`cli/test/s19-smoke.test.ts:288` 将沙箱阻断测试命名为 `ST-S19-06`，与测试规格中 `ST-S19-06`（缺少 DEPLOY_DONE 拒绝推进）冲突。本提案新增用例分配全新 ID（UT-S13-47/48/49、ST-S13-14、UT-S19-08）避开该冲突；冲突本身的更正（代码测试改指规格新 ID 或规格补录）在 code 阶段随测试代码一并处理，不扩大规格影响面。

**权衡说明**：豁免后，测试命令若恶意 / 异常地篡改沙箱内 `node_modules`，审计不再提示。「沙箱内 `node_modules` 写入不会离开沙箱」成立的前提是③的**运行期写保护在位**（含运行期新建/改写 symlink 的动态逃逸场景）；写保护不可用的 `auto` 降级档存在披露过的残留风险（`sandbox.status=warn` 明示），`always` 档则直接失败、不带残留风险运行。在此前提下该写入不影响 workspace 完整性，属审计目标之外；换来的是消除 pnpm 11 下的常态误报与显著的快照性能收益。
