# 变更提案：TRAE 国际版/CN 能力不足与非 Deployable 决策

> module: core | created: 2026-08-26

## 变更原因

OpenLogos 已按 D06 完成 ZCode、Qoder 与 WorkBuddy 薄 Adapter，TRAE/TraeCode 则一直保留为待验证宿主。用户要求本案同时覆盖 TRAE 国际版与 TRAE CN IDE，目标 OpenLogos 版本为 `0.13.29`；只有两个真实客户端都能在宿主内置写工具执行前提供 fail-closed hard guard，才允许注册 `trae`、加入 `all` 或实现代码。

2026-08-25 对已安装并登录的 TRAE 国际版 `3.5.91` 与 TRAE CN `3.3.93` 完成了隔离工作区真实探测。两个客户端都识别了项目并执行了真实内置 `Write`，但项目级 `.trae/hooks.json` 中匹配 `Write` 的 `PreToolUse` 拒绝脚本均未被调用，两个目标文件都被实际改写。该结果直接违反 D06 的“拒绝必须发生在目标变化前、理由非空、目标字节不变”要求，因此能力门为 **BLOCKED**。

本提案据此停止 Adapter 路线，收敛为能力不足决策记录：`trae` 保持 non-deployable，不进入 Registry，不加入 `all`，不实现代码，不部署 `0.13.29` tarball，也不执行 smoke。Rules、Skills、自定义 Agent、MCP、记忆或 Hooks UI 的存在不能替代本次失败的内置写工具硬拦截证据。

## 变更类型

需求级变更

## 官方能力与真实客户端结论

| 能力 | 最终结论 | 证据与边界 | OpenLogos 处理 |
|---|---|---|---|
| Rules | 支持静态上下文 | 官方文档公开项目/用户 Rules；真实客户端运行日志显示项目 Rules 查询与加载。Rules 仍是软上下文 | 不作为授权状态，不据此注册宿主 |
| Skills | 支持项目 Skills | 官方文档公开 `.trae/skills/<name>/SKILL.md`；客户端资源包含 Skills 发现能力 | 不创建 TRAE 托管 Skills，因为 hard guard 已失败 |
| 自定义 Agent | 支持宿主 Agent | 官方文档公开自定义 Agent，并可组合 Rules、Skills、MCP | 宿主 Agent 归用户/宿主所有，不创建 OpenLogos Agent 资产 |
| MCP | 支持 | 官方文档确认 MCP 客户端能力 | MCP 只能约束经 MCP 暴露的工具，不能约束本次已绕过 Hook 的内置 `Write` |
| Commands/插件 | 部分能力，不足以定义 Adapter | 客户端资源能发现 `.trae/commands/`，但没有验证到可与既有 OpenLogos 插件合同等价的稳定项目插件 manifest | 不发明插件 identity、安装协议或环境变量 |
| 原生记忆 | 存在宿主内部记忆，不是稳定集成合同 | 客户端包含 `PROJECT_MEMENTO.md`、本地/云记忆策略与用户/工作区隔离存储迹象，但未公开稳定写入接口 | 全部视为宿主/用户不透明资产；禁止读取正文、迁移或用于授权 |
| 写入前 Hook | **存在功能迹象，但不满足 hard guard** | 官方 changelog 自国际版 `3.5.66` 起声明 Hooks；客户端二进制包含 `PreToolUse`、deny/block、超时与错误处理。但真实项目配置未拦住两个客户端的内置 `Write`；社区材料还明确描述解析/执行异常继续流程的 fail-open 行为 | 判定 BLOCKED；不得实现 normalizer、wrapper 或共享 guard 映射 |
| 真实客户端 | **已完成双端探测** | 国际版 `/Applications/Trae.app`，bundle id `com.trae.app`，版本 `3.5.91`；CN `/Applications/Trae CN.app`，bundle id `cn.trae.app`，版本 `3.3.93` | 两端均未通过，`trae` 保持 non-deployable |

开源 `bytedance/trae-agent` 是独立 Agent/CLI，不能证明 TRAE IDE 的项目资产发现或写前 Hook，本案未用它替代真实 IDE。

## 真实 capability probe 记录

### 隔离边界

- 国际版工作区：`/tmp/openlogos-trae-probe-int-3.5.91`
- CN 工作区：`/tmp/openlogos-trae-probe-cn-3.3.93`
- 两端各自使用独立项目目录、应用配置根和用户数据根；未触及 OpenLogos 仓库源代码、用户真实项目、账号凭据或记忆正文。
- 拒绝配置位于各工作区 `.trae/hooks.json`，`PreToolUse.matcher` 包含真实工具名 `Write`；Hook 脚本会记录 stdin、输出带非空理由的拒绝 JSON 并以退出码 `2` 结束。
- 客户端实现另有按绝对工作区保存的 `enabled_folders` 信任开关；配置文件存在并不会自动启用项目 Hook。探测没有绕过该安全确认去改写用户配置，因为“信任并执行项目命令”是宿主用户状态，不是 Adapter 可静默部署的项目资产。

### 国际版 3.5.91

1. 客户端真实日志记录 `toolCallName: "Write"`。
2. 随后执行 `icube.common.commands.tooling.applyChatSnapshotPatch` 并保存 `probe-target.txt`。
3. 初始 SHA-256 为 `8d2c3b21cd0d2a335b8a668b3b01161c0f29fa16c197a00bd454a56a14ec3fa8`，执行后为 `cf3d065c1f376fa6c8a9c44e0b08118684560aab8348c7f4cfad6b3f01abb616`。
4. Hook 的 stdin 证据文件不存在，日志中没有拒绝理由，证明拒绝脚本未在目标变化前执行。

### CN 3.3.93

1. 客户端真实日志记录写入流程并执行 `applyChatSnapshotPatch`。
2. 初始 SHA-256 为 `381206c84be0ca90b4bd93549ff4540b160551aec17b1c7161f14d5702856a37`，执行后为 `64d832f9c330cd4a5dca9fd1c178a5705c6405822d84aec511b8a1b813176349`。
3. Hook 的 stdin 证据文件不存在，日志中没有拒绝理由，证明拒绝脚本未在目标变化前执行。
4. 随包 CLI 的 `chat` 子命令还调用了不存在的 `workbench.action.chat.open`；探测改用客户端实际 URI command 打开真实聊天后完成，不把 CLI 调度缺陷误报为 Hook 结论。

### 门禁判定

基础 deny 用例已在两个客户端失败，故无需继续执行允许路径、工作区外、`..`、symlink、解析失败、runtime 缺失、状态矛盾和超时等更具破坏性的矩阵。客户端要求用户逐工作区确认 `enabled_folders`，说明仅部署项目资产无法激活 guard；OpenLogos 也不得静默替用户信任并执行项目命令。公开社区教程同时把 Hook 解析/运行异常描述为继续执行，无法提供 D06 所需的异常 fail-closed 合同。因此当前版本组合不能形成可自动部署、可验证且 fail-closed 的薄 Adapter。

最终结果：**BLOCKED / non-deployable / no code / no deployment**。

## 变更范围

- 修改 `logos/resources/decisions/core-D06-ai-tool-adapter-boundary.md`，登记双客户端证据、失败原因与重新开启条件。
- 修改需求、功能规格、CLI 体验与架构总览，明确 `trae` 不属于 deployable Registry、`all` 或帮助支持列表。
- 修改 S01/S08/S09 场景时序，明确 Registry 排除、同步零资产与无 TRAE guard 调用链。
- 修改 `spec/pretooluse-guard.md`，明确 TRAE 当前没有可由 OpenLogos 依赖的 fail-closed 内置工具映射。
- 修改 S01/S08/S09 测试规格，锁定 Registry 排除、`all` 不变和不得建立 TRAE guard normalizer 的负向契约。
- 不新增 `spec/trae-adapter.md`，因为不存在可实现的 Adapter 合同。
- 不修改 API、数据库或 API 编排测试。

## 兼容与所有权边界

1. `AiToolAdapterRegistry` 继续独占规范 id、稳定顺序、别名、capability 和 `all` 展开；不得注册 `trae` deployable 项或保留伪占位。
2. CLI 帮助、交互列表和错误信息不得声称 TRAE 已受支持；显式输入 `trae` 继续按未知/不支持宿主处理。
3. TRAE Rules、Skills、Agent、Commands、MCP、settings、账号、记忆和未知文件全部由用户/宿主所有，OpenLogos 不读写、不迁移、不覆盖。
4. Rules、Agent prompt、MCP 拒绝和人工确认均是软控制，不能替代 `GuardDecisionService` 的 hard enforcement。
5. Claude Code、OpenCode、Codex、Cursor、ZCode、Qoder、WorkBuddy 的规范值、资产路径、稳定顺序和 `all` 展开保持不变。
6. 未来只有在国际版与 CN 的受支持目标版本都能通过同一完整 fail-closed 矩阵后，才可创建新提案重新评估；不得在本案中预写代码或部署任务。

## 非目标

- 不生成 TRAE Adapter、模板、normalizer、Hook wrapper、测试 runtime 或模拟 hard guard。
- 不执行 merge、verify、部署、smoke、archive、公开发布或 `git push`。
- 不读取、导出或修改用户账号凭据、聊天记录、个性化记忆或未知用户状态。
- 不把开源 `trae-agent`、Rules、prompt、MCP、文件存在或二进制字符串当作 hard guard PASS。

## 部署影响

- 是否需要部署：否
- 是否需要 smoke：否
- 原因：双客户端 capability gate 已 BLOCKED，本案无代码、无 npm 产物变化、无 TRAE 托管资产。
- 原确认路径：用户曾确认仅在 PASS 时采用隔离 staging 的 `0.13.29` 真实 npm tarball + 双客户端验证，以 `0.13.28` 回滚且不公开发布。
- 最终处理：因能力门失败，该条件路径未触发；不构建或安装 `0.13.29` staging tarball，不执行回滚，不执行 smoke。
- 是否涉及数据迁移：否

## UI/UX 变更声明

```yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

本案只收敛 CLI 支持声明和规格边界，不修改 OpenLogos GUI。

## 基线闭包计划

```yaml
baseline_closure:
  policy: on-touch-v1
  schema_version: 1
  unit: canonical-merge-target-path
  delta_cardinality: exactly-one-per-non-skip-target
  effective_view: merged-resources-plus-current-change-deltas
  ambiguity: block-before-existing-plan-exit
  standalone_baseline_required: false
  jit_confirmation: disabled
  touched_scenario_ids: [S01, S08, S09]
  targets:
    - category: decision
      scenario_ids: [S01, S08, S09]
      mode: MODIFY
      delta_path: "deltas/decisions/core-D06-ai-tool-adapter-boundary.md"
      reason: "D06 已把 TRAE 留作独立评估目标；本案须登记双客户端真实 hard guard 失败、non-deployable 结论与重新开启条件。"
      evidence: ["target_exists: logos/resources/decisions/core-D06-ai-tool-adapter-boundary.md", "decision:D06#演进", "probe:trae-int-3.5.91-and-cn-3.3.93"]
      missing_evidence: []
    - category: requirement
      scenario_ids: [S01, S08, S09]
      mode: MODIFY
      delta_path: "deltas/prd/1-product-requirements/core-01-requirements.md"
      reason: "TRAE 不得进入 Registry、all 或托管资产计划，改变 S01/S08/S09 的负向验收边界。"
      evidence: ["target_exists: logos/resources/prd/1-product-requirements/core-01-requirements.md", "requirements:P02,S01,S08,S09", "probe:pretooluse-did-not-run"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S01, S08, S09]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md"
      reason: "功能规格须区分 TRAE Rules/Skills/Agent/MCP/记忆等软能力与缺失的 fail-closed hard guard。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md", "feature:AI-tool-adapter-registry", "decision:C01"]
      missing_evidence: []
    - category: feature
      scenario_ids: [S01, S08]
      mode: MODIFY
      delta_path: "deltas/prd/2-product-design/2-page-design/core-01-cli-experience.md"
      reason: "CLI 帮助、交互选项、显式参数错误和 all 展开不得声称支持 TRAE。"
      evidence: ["target_exists: logos/resources/prd/2-product-design/2-page-design/core-01-cli-experience.md", "artifact_type: CLI markdown without pages declaration", "registry:seven-deployable-hosts"]
      missing_evidence: []
    - category: architecture
      scenario_ids: [S01, S08, S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md"
      reason: "架构需明确不创建 TRAE Adapter、normalizer、模板或共享 guard 映射，并保持既有七宿主边界。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md", "architecture:AiToolAdapterRegistry", "probe:hard-guard-blocked"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S01]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-cli-init.md"
      reason: "S01 必须表达 Registry 在规划前拒绝 trae、保持现有七宿主顺序且不生成 TRAE 资产的负向时序。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-cli-init.md", "scenario:S01", "registry_disposition:no-trae"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S08]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S08-sync-ai-tools.md"
      reason: "S08 必须表达 all 不选择 TRAE、非法手工配置在事务前失败且现有 TRAE 用户资产零触达。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S08-sync-ai-tools.md", "scenario:S08", "registry_disposition:no-trae"]
      missing_evidence: []
    - category: scenario
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md"
      reason: "S09 必须表达生命周期不注册 TRAE normalizer、不读取用户信任或记忆且不把软控制当 hard guard。"
      evidence: ["target_exists: logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md", "scenario:S09", "probe:pretooluse-did-not-run"]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/spec/pretooluse-guard.md"
      reason: "共享 guard 规范须声明 TRAE 当前没有可依赖的 fail-closed 内置工具映射，软控制不得替代。"
      evidence: ["target_exists: spec/pretooluse-guard.md", "probe:target-hash-changed", "decision:C01"]
      missing_evidence: []
    - category: test
      scenario_ids: [S01]
      mode: MODIFY
      delta_path: "deltas/test/core-S01-test-cases.md"
      reason: "锁定 Registry、帮助和交互列表排除 TRAE，以及既有七宿主顺序不变。"
      evidence: ["target_exists: logos/resources/test/core-S01-test-cases.md", "scenario:S01", "test_ids:UT-S01-124..127,ST-S01-24..25"]
      missing_evidence: []
    - category: test
      scenario_ids: [S08]
      mode: MODIFY
      delta_path: "deltas/test/core-S08-test-cases.md"
      reason: "锁定 all 不展开 TRAE、显式 trae 不产生托管资产且既有同步行为不变。"
      evidence: ["target_exists: logos/resources/test/core-S08-test-cases.md", "scenario:S08", "test_ids:UT-S08-33..36,ST-S08-25..26"]
      missing_evidence: []
    - category: test
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: "deltas/test/core-S09-test-cases.md"
      reason: "锁定不得创建 TRAE guard normalizer、不得把软控制视为 hard guard，并回归既有 fail-closed 合同。"
      evidence: ["target_exists: logos/resources/test/core-S09-test-cases.md", "scenario:S09", "test_ids:UT-S09-219..223,ST-S09-85..87"]
      missing_evidence: []
    - category: api
      scenario_ids: [S01, S08, S09]
      mode: SKIP
      delta_path: null
      reason: "本案只记录本地 CLI Registry 与宿主能力边界，不新增 HTTP、RPC 或消息 API。"
      evidence: ["architecture: local-cli-and-filesystem", "proposal_scope: non-deployable"]
      missing_evidence: []
    - category: database
      scenario_ids: [S01, S08, S09]
      mode: SKIP
      delta_path: null
      reason: "不实现 Adapter、不持久化 TRAE 状态，且原生记忆明确属于宿主/用户，不需要数据库实体或迁移。"
      evidence: ["deployment:data_migration=false", "ownership:trae-memory-external"]
      missing_evidence: []
    - category: deployment
      scenario_ids: [S01, S08, S09]
      mode: SKIP
      delta_path: null
      reason: "双客户端 capability gate 已 BLOCKED，本案无代码、无 npm 产物变化与托管资产，不执行 0.13.29 staging 或 0.13.28 回滚。"
      evidence: ["deployment_required:false", "decision:C03", "probe:both-clients-blocked"]
      missing_evidence: []
    - category: orchestration
      scenario_ids: [S01, S08, S09]
      mode: SKIP
      delta_path: null
      reason: "API 维度为 SKIP，不需要 API 编排测试；Registry 排除与 guard 负向合同由 CLI UT/ST 覆盖。"
      evidence: ["api_disposition: SKIP", "test_strategy: CLI-UT-ST"]
      missing_evidence: []
    - category: smoke
      scenario_ids: [S01, S08, S09]
      mode: SKIP
      delta_path: null
      reason: "双客户端 capability gate 已 BLOCKED，未实现、未部署且禁止以 mock 或 wrapper 直调冒充真实 smoke。"
      evidence: ["deployment_required:false", "probe:both-clients-blocked", "decision:C03"]
      missing_evidence: []
```

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: adaptive
status: complete
impacts:
  data:
    status: none
    reason: "不迁移业务数据；TRAE 记忆与用户状态保持宿主所有、零读取和零写入。"
  compatibility:
    status: none
    reason: "trae 不注册、不加入 all，既有七宿主及其稳定顺序保持不变。"
  security_privacy:
    status: none
    reason: "双客户端真实 Write 均未被项目 PreToolUse 拦截；按用户硬门收敛为 non-deployable，不实现代码。"
  public_release:
    status: none
    reason: "不执行 npm publish、Git tag、GitHub Release、官网部署或生产开放。"
  external_commitment:
    status: none
    reason: "真实客户端已由用户安装并登录；探测只使用本机一次性工作区，不新增付费服务、SLA 或不可逆承诺。"
decisions:
  - id: C01
    category: security_privacy
    question: "TRAE 没有经真实客户端证明可阻断内置写工具时，是否仍注册为 deployable 或实现软约束 Adapter？"
    answer: "否。没有真实 hard guard 时不得将 trae 注册为 deployable，不实现代码。"
    rationale: "Rules、prompt 与 MCP 不能证明内置工具执行前受控；D06 hard enforcement 不因宿主而降级。"
    source: user
    affects:
      - "Registry deployable 状态与 all 展开"
      - "S09 hard guard 合同"
      - "是否允许进入代码实现"
    rejected_options:
      - "仅用 Rules 或 Agent prompt 约束写入"
      - "只拦截 OpenLogos MCP 工具而放任 TRAE 内置写工具"
  - id: C02
    category: compatibility
    question: "本提案目标覆盖哪些 TRAE 分发版，目标 OpenLogos 版本是什么？"
    answer: "同时面向 TRAE 国际版与 TRAE CN IDE；目标 OpenLogos 版本为 0.13.29。"
    rationale: "单一 trae 支持声明必须由两个目标的真实证据共同支撑。"
    source: user
    affects:
      - "双客户端 capability gate"
      - "版本与证据矩阵"
    rejected_options:
      - "只验证一个分发版却声明两者均支持"
  - id: C03
    category: deployment
    question: "若两端均支持真实 hard guard，是否采用隔离 staging 的 0.13.29 tarball 双客户端验证，以 0.13.28 回滚且不公开发布？"
    answer: "是；但该授权以 capability PASS 为前提。"
    rationale: "用户明确确认可逆、隔离且不公开发布的条件部署路线；实际 capability BLOCKED，因此条件未触发。"
    source: user
    affects:
      - "能力 PASS 后的部署路线"
      - "回滚与公开发布边界"
    rejected_options:
      - "公开发布后再验证"
      - "不准备回滚材料"
unresolved: []
defaults:
  - id: DFLT-01
    category: ownership
    choice: "TRAE 记忆、settings、账号、用户 Rules/Skills/Agents/MCP 与未知文件全部视为宿主/用户资产。"
    reason: "缺少稳定所有权合同，保守边界可避免误读、覆盖和凭据泄漏。"
  - id: DFLT-02
    category: compatibility
    choice: "不为 trae 预留 deployable 占位，不改变 all。"
    reason: "不可执行的占位会造成错误的安全与兼容承诺。"
```

## 变更概述

TRAE 国际版 `3.5.91` 与 CN `3.3.93` 均已完成真实客户端基础 deny probe，且均在项目 `PreToolUse` 未执行的情况下改写了目标文件。能力门因此为 **BLOCKED**。本提案只记录 TRAE 当前 non-deployable、既有七宿主不变及未来重新开启条件；不生成 Adapter 代码、不部署、不 smoke。
