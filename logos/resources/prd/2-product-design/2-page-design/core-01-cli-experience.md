# core-01-cli-experience

## 一、交互原则
- 先给确定动作，再给解释。
- 错误信息必须明确到命令和原因。
- 退出码与文本输出必须一致。

## 二、核心终端体验
### 2.1 init
显示目录创建进度、配置写入结果、verify 预跑配置推断结果和下一步提示。

当识别出常见测试栈时，init 输出应包含类似：

```text
✓ 写入 verify.pre_run_command: npm test
```

当无法推断测试命令时，init 输出应包含明确 TODO：

```text
⚠ 未能推断测试命令。请在 logos/logos.config.json 中配置 verify.pre_run_command 或 verify.regression_command，避免 openlogos verify 因局部 test-results.jsonl 覆盖不足而失败。
```

### 2.2 sync
显示同步了哪些资产、补录了哪些索引、是否补齐 verify 预跑配置、是否有跳过项。

sync 不得覆盖用户已有的 verify 预跑命令。若旧项目缺少预跑配置且无法推断测试命令，必须输出可执行诊断。

### 2.3 status / next
显示阶段进度、活跃变更步骤、提案级部署决策和最优下一步建议。

活跃提案存在时：
- `proposal_step=delta-writing`：提示继续产出 delta，完成后明确授权 `openlogos merge <slug>`。
- `proposal_step=ready-to-verify`：提示代码已完成，明确授权执行 `openlogos verify`。
- `proposal_step=verify-passed` 且提案无需部署：提示明确授权执行 `openlogos archive <slug>`。
- `proposal_step=ready-to-deploy`：提示验收通过且存在部署任务，部署必须由用户明确授权。
- `proposal_step=ready-to-smoke`：提示部署已完成，明确授权执行 `openlogos smoke`。
- `proposal_step=smoke-passed`：提示明确授权执行 `openlogos archive <slug>`。

当 `proposal.md` 的部署影响与 `tasks.md` 的 `[deploy]` section 不一致时，文本模式必须展示警告；JSON 模式必须暴露可被客户端消费的部署决策来源与冲突状态。冲突态下主动作必须切换为“修正 proposal.md / tasks.md”，不得继续提示 deploy、smoke 或 archive。

### 2.4 verify / smoke
显示覆盖度、失败项、缺失项、预跑命令状态、沙箱状态和门禁结论。

verify 执行前置命令时：
- 配置 `pre_run_command`：显示单阶段预跑命令。
- 配置 `regression_command`：先显示并执行回归测试。
- 配置 `incremental_command`：后显示并执行增量测试。
- 同时配置 `pre_run_command` 与两阶段命令时，优先使用两阶段命令，并提示 `pre_run_command` 作为兼容配置未执行。

verify / smoke 启用沙箱时：
- `sandbox_mode=off`：不显示隔离成功文案，仅保留历史行为。
- `sandbox_mode=auto`：显示是否启用沙箱；若降级执行，必须显示告警。
- `sandbox_mode=always`：显示强制隔离要求；无法隔离或检测到非白名单写入时，必须显示失败原因和沙箱路径。

覆盖不足且未配置任何预跑命令时，必须显示诊断：

```text
⚠ 覆盖不足可能是因为只运行了局部测试，test-results.jsonl 未包含全部用例。
  建议配置 verify.pre_run_command，或配置 verify.regression_command + verify.incremental_command。
```

verify PASS 后的下一步由提案级部署决策决定：
- 无需部署：直接建议 archive。
- 需要部署：展示部署任务和人类确认提示。
- 需要部署且需要 smoke：部署完成后再建议 `openlogos smoke`。
- 部署决策冲突：提示修正提案资料，不进入部署、smoke 或 archive。

smoke 不替代 verify，不自动触发部署，也不应在无需部署的提案中作为下一步展示。

### 2.4a deploy-done

`openlogos deploy-done` 用于在部署动作已经成功完成后，标记当前提案部署完成。它不是部署执行命令，不应自动触发发布、远程命令、数据迁移或 smoke。

成功输出应包含：

```text
✓ 部署完成标记已写入：logos/changes/<slug>/DEPLOY_DONE
✓ [deploy] 任务已全部勾选
✓ 已清理过期 smoke 标记

下一步：明确授权执行 openlogos smoke --env staging
```

若提案无需 smoke，下一步改为：

```text
下一步：明确授权执行 openlogos archive <slug>
```

JSON 输出应包含：

```jsonc
{
  "slug": "<slug>",
  "environment": "staging",
  "marker_path": "logos/changes/<slug>/DEPLOY_DONE",
  "deployment_report_path": "logos/resources/verify/deployment-report.md",
  "deploy_tasks_checked": 3,
  "deploy_tasks_total": 3,
  "cleared_smoke_markers": ["SMOKE_PASS", "SMOKE_FAIL"],
  "next_step": "ready-to-smoke"
}
```

异常输出要求：
- 缺少 guard：提示当前没有活跃提案，不能标记部署完成。
- 缺少 `VERIFY_PASS` 或存在 `VERIFY_FAIL`：提示先运行并通过 `openlogos verify`。
- 提案无需部署：提示无需执行 `deploy-done`，verify PASS 后可 archive。
- 部署决策冲突：输出冲突原因，要求修正 `proposal.md` / `tasks.md`。
- 缺少 `[deploy]` section：提示提案结构不完整，不得写 marker。
- 缺少部署报告：提示先按部署方案写入 `logos/resources/verify/deployment-report.md`。

`status` / `next` 文案更新：
- `proposal_step=ready-to-deploy`：提示部署完成后执行 `openlogos deploy-done` 标记状态。
- `proposal_step=ready-to-smoke`：提示部署已完成，明确授权执行 `openlogos smoke`。
- `proposal_step=deploy-done`：提示部署完成且无需 smoke，可明确授权 archive。

### 2.5 adopt

`openlogos adopt` 为已有项目接入专用命令。它不是轻量补丁命令，而是“只跳过 Initial 文档门禁的 init”：必须完成与 `init` 同级别的 OpenLogos 基础设施初始化，然后用 `bootstrap: adopted` 标记存量项目接入来源。

**检测与确认阶段**
```text
$ openlogos adopt

? 检测到已有项目：my-app（来自 package.json）
? 文档语言 (locale)：zh
? AI 工具：claude-code

✓ 读取项目信息完成
```

非交互场景应使用显式参数：

```text
openlogos adopt --locale zh --ai-tool all
```

**创建阶段**
```text
✓ 创建 logos/ 标准目录结构
✓ 写入 logos.config.json
✓ 写入 logos-project.yaml（bootstrap: adopted, lifecycle: launched）
✓ 写入 AGENTS.md / CLAUDE.md
✓ 部署所选 AI tools 的 Skills / 插件 / 命令资产
✓ 部署 OpenLogos 规范文件到 logos/spec/
```

**verify 预跑配置阶段**
```text
✓ 检测到测试脚本：npm test
✓ 写入 verify.pre_run_command: npm test
```

无法推断时：

```text
⚠ 未能推断测试命令。请补充 verify.pre_run_command 或 verify.regression_command。
```

若要展示推荐沙箱配置，可附带：

```text
✓ 写入 verify.sandbox_mode: auto
✓ 写入 verify.sandbox_root: /private/tmp
✓ 写入 verify.sandbox_deny_workspace_write: true
```

**接入报告与下一步**
```text
🎉 已有项目接入完成！

项目已进入存量项目接入模式（bootstrap: adopted）：
  · OpenLogos 基础设施已完整初始化
  · Initial 文档基线已跳过，不强制要求
  · 模块生命周期直接设为 launched

建议的下一步：先补充项目基线文档
  → openlogos change add-baseline-docs
  在变更提案中逐步补写需求、架构、场景、测试用例，
  把 TDD 思想贯彻到每一次迭代中。
```

**异常：logos/ 已存在**
```text
✗ 该项目已初始化（logos/logos.config.json 已存在）
  若要重新配置，请先备份并删除 logos/ 目录。
```

### 2.6 next（存量项目接入无提案时）

`bootstrap: adopted` 且无活跃提案时，`openlogos next` 输出固定引导。历史 `bootstrap: skipped` 项目按相同逻辑兼容处理。

```text
$ openlogos next

📌 当前状态：已接入（存量项目接入模式），尚无活跃变更提案

建议的下一步：先补充项目基线文档
  → openlogos change add-baseline-docs
  在变更提案中逐步补写需求、架构、场景、测试用例，
  把 TDD 思想贯彻到每一次迭代中。

补文档提案归档后，openlogos next 将恢复正常阶段建议。
```

### 2.7 flow show

`openlogos flow show` 用于查看 OpenLogos 的研发流程编排。它是只读命令，不写文件、不推进任何状态，也不接入 status / next 的派生（本切片零行为变更）。

默认展示内置 raw flow（不应用项目 overlay）；**默认 lifecycle 按当前项目状态推断**——
initial 阶段项目默认查看 initial flow，含 launched 模块的项目默认查看 launched flow，
可用 `--lifecycle` 显式覆盖。下例为 initial 阶段项目：

```text
$ openlogos flow show

Flow: initial（内置模板 builtin:initial@v1）

▸ WHY 需求                                   gate: human (skippable)
    · prd                需求            skill: prd-writer       when: bootstrap != adopted
▸ WHAT 产品设计                              gate: human (skippable)
    · product-design     产品设计        skill: product-designer when: bootstrap != adopted
▸ HOW 技术设计                               gate: none
    · architecture       架构            skill: architecture-designer
    · scenario-modeling  场景时序        skill: scenario-architect  for_each: scenarios
    · api-design         API 设计        skill: api-designer        when: api_enabled
    ...
▸ 实现                                       gate: none
    · code               代码实现        skill: code-implementor
    · verify             验收            （openlogos verify）
▸ 交付                                       gate: human · entry (不可跳过)
    · deploy             部署执行        skill: deployment-executor when: deployment_required
    · smoke              冒烟            （openlogos smoke）         when: smoke_required

提示：使用 --resolved 查看应用项目 overlay 后的生效流程。
```

`--resolved` 展示 overlay 合并后的生效流程，并标注本项目 overlay 的影响：

```text
$ openlogos flow show --resolved

Flow: initial（resolved · 已应用 logos/flow/initial.yaml overlay）
基线：builtin:initial@v1   overlay 操作：skip×1  modify×1

▸ HOW 技术设计                               gate: none
    · architecture       架构
    · scenario-modeling  场景时序
    - orchestration-test  编排测试        [skip] 已被 overlay 跳过
▸ 实现                                       gate: none
    · code               代码实现        review_agent: my-code-reviewer  [modify]
    · verify             验收
```

`--lifecycle` 指定查看哪条 flow（缺省按当前项目状态推断）：

```text
openlogos flow show --lifecycle launched
openlogos flow show --lifecycle launched --resolved
```

`--format json` 输出机器可读结构（可叠加 `--resolved`）：

```jsonc
{
  "lifecycle": "initial",
  "resolved": false,
  "overlay_applied": false,
  "builtin_version": "v1",
  "warnings": [],
  "flow": {
    "flow": "initial",
    "version": 1,
    "subflows": [
      {
        "id": "why",
        "name": "WHY 需求",
        "gate": { "type": "human", "skippable": true },
        "nodes": [
          { "id": "prd", "name": "需求", "skill": "prd-writer", "when": "bootstrap != adopted", "done_when": "dir_nonempty" }
        ]
      }
      // ... 其余 subflows
    ]
  }
}
```

异常输出要求：
- 项目未初始化：提示当前目录不是 OpenLogos 项目（错误码 `PROJECT_NOT_INITIALIZED`）。
- 内置模板或指定 lifecycle 缺失：提示找不到对应 flow（错误码 `FLOW_NOT_FOUND`）。
- overlay schema 非法：输出具体非法位置（未知 op、缺字段、target node id 不存在），错误码 `FLOW_SCHEMA_INVALID`；不输出半成品 flow。
- `@vN` 版本不匹配：在 `--resolved` 输出顶部以告警形式提示（文本模式醒目标注、JSON 模式进入 `warnings[]`，含 `FLOW_VERSION_MISMATCH`），告警不阻断展示。

### 2.8 watch（实时观测派生状态）

`openlogos watch` 是 `status` 的实时版。它是只读命令，不写文件、不推进状态、不接入 status / next 的写副作用。

**启动先输出一次初始快照，之后仅在派生状态变化时重渲染**（变化判定 = 相邻两次 `collectStatusData` 的 `data` 深比较）。文本模式：

```text
$ openlogos watch

[#0 2026-06-20T08:00:00Z] 派生状态（初始快照）
  生命周期：launched
  活跃提案：flow-watch-auto · 步骤 delta-writing（撰写 Delta）
  下一步：继续产出 delta，完成后明确授权 openlogos merge flow-watch-auto

（仅在派生状态变化时刷新；Ctrl-C 退出）

[#1 2026-06-20T08:01:12Z] 派生状态已更新
  活跃提案：flow-watch-auto · 步骤 ready-to-merge（待合并）
  下一步：明确授权执行 openlogos merge flow-watch-auto
```

`--interval` 调整轮询间隔（默认 2 秒）：

```text
openlogos watch --interval 5
```

`--module` 继承过滤（多模块项目），派生与变化判定仅针对该模块：

```text
openlogos watch --module core
```

`--format json` 输出每条一行的 JSON 流——**先输出一次初始快照，之后仅在变化时输出**，每条含 `seq` / `timestamp`，`data` 与 `openlogos status` 的 `data` 同构：

```jsonc
// 初始快照（seq=0）
{"command":"watch","version":"<cli-version>","timestamp":"2026-06-20T08:00:00Z","data":{"module":null,"seq":0,"event":"snapshot","status":{ /* 与 status 的 data 同构 */ }}}
// 后续变化事件（seq 递增）
{"command":"watch","version":"<cli-version>","timestamp":"2026-06-20T08:01:12Z","data":{"module":null,"seq":1,"event":"change","status":{ /* 变化后的 status data */ }}}
```

退出与异常：
- Ctrl-C / SIGINT：优雅退出，全程无写副作用。
- 项目未初始化：输出 `PROJECT_NOT_INITIALIZED` 并以非零退出码退出，不进入轮询循环。

### 2.9 next --auto（skip-gate）

`openlogos next --auto` 在受控自动化下自动越过**可跳**的人类确认点，同时守住**不可跳**的高危确认点。最小 A 方案：仅作用于 launched 现有人类停顿点对应的 gate。

**可跳 gate（`ready-to-merge`，propose 出口 `skippable:true`）在 auto 下放行并留痕**：

```text
$ openlogos next --auto

✓ auto 模式：可跳人类确认点已放行（gate: propose-exit，skippable）
  审计已追加：logos/changes/<slug>/GATE_AUTO_PASSED

下一步（gate 已自动放行，宿主可直接执行、无需人类授权）：openlogos merge <slug>
```

**不可跳 gate（`ready-to-deploy`，deliver 入口 `skippable:false`）在 auto 下仍卡住**：

```text
$ openlogos next --auto

⚠ auto 模式：当前确认点不可自动跳过（gate: deliver-entry，不可跳）
  部署属高危动作，必须由人类明确授权。

下一步：验收已通过，部署必须由用户明确授权后执行
```

**默认 `next`（无 `--auto`）严格 1:1 不变，并忽略 `GATE_AUTO_PASSED`**：即便活跃提案目录已存在 `GATE_AUTO_PASSED`，默认 `next` 的输出与未引入 `--auto` 时完全一致，绝不因该文件自动越过 gate。

`--auto` 不改变 `ready-to-smoke`（`smoke` 无对应 gate）：处于 `ready-to-smoke` 时，`next --auto` 输出与默认 `next` 一致（提示明确授权运行 `openlogos smoke`），不写 `GATE_AUTO_PASSED`。

`--format json` 下，`next --auto` 在既有 next data 基础上附带 gate 字段（`gate_id` / `skippable` / `gate_auto_passed`），详见 `spec/cli-json-output.md`。

### 2.10 overlay 驱动派生（status / next 输出体验）

派生引擎接入 resolved flow 后，overlay-added 节点出现在 `status` / `next` 输出中（此前仅 `flow show` 可见）。

**status（含 overlay-added 节点，文本示例）**：
```
📊 OpenLogos Project Status
...（既有 phase / proposal_step 面板不变）...
🧩 Overlay 节点
  ▶ quality-gate （active） · subflow=implement · #6
```
- 仅当存在**已到达**的 overlay-added 节点时显示「Overlay 节点」区块；无 overlay 时**完全不出现**（输出与现状一致）。

**next（当前落在 overlay-added 节点）**：
```
下一步：quality-gate（静态质量门）
  · 位置：implement 子流程 · 节点 #6
  · 完成判定：file:logos/resources/verify/QUALITY_PASS
```

**launched builtin skip / reorder（fail loud）**：
```
✖ flow 配置错误（FLOW_SCHEMA_INVALID）
  launched 流程的内置节点不支持 overlay skip / reorder（本切片限制）；
  如需调整 launched 节点顺序请等待后续版本。仅 add / modify 生效。
```
- JSON 模式：`makeErrorEnvelope("status"|"next"|"watch", "FLOW_SCHEMA_INVALID", message)` 到 stderr、非零退出；`watch` 不进入轮询。

**overlay-add 谓词不可求值**（如 initial 用 `marker:`、`dir_nonempty` 缺 `produces`）：同样以 `FLOW_SCHEMA_INVALID` 报出，提示修正 `done_when`/`produces`。

**不变量**：无 overlay 文件时，以上区块/字段全部不出现，`status`/`next`/`watch` 输出与未引入本切片时逐字节一致。

## 三、异常状态
- 已初始化项目再次 init。
- 已初始化项目执行 adopt（提示已初始化）。
- guard 冲突时创建 change。
- verify 无结果文件。
- verify 覆盖不足且未配置预跑命令（提示可能只运行局部测试）。
- verify 预跑命令执行失败（保留测试输出，并在诊断中暴露命令状态）。
- smoke 无 smoke 用例或无结果。

## 四、输出要求
- 文本模式用于人读。
- JSON 模式用于机器读。
- 错误输出不得吞掉上下文。
