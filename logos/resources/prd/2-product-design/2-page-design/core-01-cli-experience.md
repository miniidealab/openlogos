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
- `proposal_step=ready-to-implement`：提示规格已合并，需由 slice-planner 对已合并规格 + 真实测试 ID 划分 `[code]` 切片；切片划定后由用户在 `slice-exit` 门确认（或 `next --auto` 放行）进入实现。
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

**可跳 gate（`ready-to-implement`，slice 出口 `skippable:true`）在 auto 下放行并留痕**：

```text
$ openlogos next --auto

✓ auto 模式：可跳人类确认点已放行（gate: slice-exit，skippable）
  审计已追加：logos/changes/<slug>/GATE_AUTO_PASSED

下一步（gate 已自动放行，宿主可直接进入切片循环逐片实现）：实现第一个 [code] 切片
```

**不可跳 gate（`ready-to-deploy`，deliver 入口 `skippable:false`）在 auto 下仍卡住**：

```text
$ openlogos next --auto

⚠ auto 模式：当前确认点不可自动跳过（gate: deliver-entry，不可跳）
  部署属高危动作，必须由人类明确授权。

下一步：验收已通过，部署必须由用户明确授权后执行
```

**默认 `next`（无 `--auto`）忽略 `GATE_AUTO_PASSED`、不因其越过 gate**：即便活跃提案目录已存在 `GATE_AUTO_PASSED`，默认 `next` 也绝不因该文件自动越过 gate；其 base data 仍按当前契约输出（S28 起可能含 `next_node`），不受 `--auto` 影响。

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

### 2.11 cmd: 节点（status/watch 显示 pending、next 执行求值）

**status / watch（不执行命令，显示 pending）**：
```
🧩 Overlay 节点
  ▶ quality-gate （pending：cmd 未求值，运行 next 触发） · subflow=implement · #6
```

**next（执行命令求值）**：
```
下一步：quality-gate（质量门）
  · 执行 cmd: npm test …
  · ✓ 通过（exit 0）→ 进入下一节点          # done_when:cmd exit 0
```
或未通过：
```
下一步：quality-gate（质量门）
  · 命令未通过（exit 1）→ 修复后重试           # done_when:cmd 非 0
```

**JSON（next）**：success envelope `data` 带 `cmd_node_id` / `cmd_predicate_field` / `cmd_exit_code` / `cmd_timed_out` / `cmd_satisfied`（仅本次执行 cmd 时）。child 命令输出被捕获、**不混入** `next --format json` 的 stdout。

**错误**：shell 起不来 → `makeErrorEnvelope("next", "FLOW_CMD_SPAWN_FAILED", …)` 到 stderr、非零退出；命令不存在按非 0（success envelope，`cmd_satisfied:false`）。

**budget=1**：单次 next 至多执行 1 个 cmd；续推后遇下一个 cmd 节点显示为 pending，需再次 next。

**不变量**：无 cmd 节点时以上区块/字段不出现，输出与未引入本切片时一致。

### 2.12 implement loop 真迭代（next 续迭代 / 升级人类确认、watch 环进度）

当项目 overlay 用 `set-loop` 把 implement 子流程的 `max_iters` 调到大于 1，implement（code/verify）进入真迭代环。`next` 按「第 N/M 轮未绿 → 修复后重跑 verify / 达上限 → 升级人类确认」给措辞，`status` / `watch` 只读展示环进度，**都不执行测试**（A 被动派生）。无激活项目（含所有 golden fixture）以下区块全部不出现，输出逐字节不变。

**next（未收敛 & 未达上限 → 继续迭代）**：
```text
$ openlogos next

下一步：继续迭代（implement loop 第 2/3 轮未绿）
  · 让 working_agent 修复后重跑 openlogos verify
  · 收敛裁判：测试绿（openlogos verify PASS）
```

**next（达上限 escalated → 升级人类确认点）**：
```text
$ openlogos next

⚠ implement loop 已达迭代上限（3/3）仍未绿 → 升级人类确认点
  请人类决定：继续迭代（调大 max_iters）/ 调整方案 / 放弃
  gate: implement:loop-exhausted（不可跳过）

下一步：修复到测试绿后重跑 openlogos verify，或在 overlay 调大 max_iters 继续迭代
```
- escalated 是 implement 子流程的退出 human gate，`skippable:false`，本切片不可 overlay 覆盖。
- `next --auto` 在 escalated 时**仍卡住**（与不可跳的 deploy gate 一致），不 auto-pass、不写 `GATE_AUTO_PASSED`；JSON 带 `gate_id=gate:implement:loop-exhausted` / `skippable:false`。

**next（收敛 → 出环续推）**：测试绿后 `converged:true`，implement 出环，`next` 续推到下一节点（deliver / archive），措辞与既有派生一致。

**“继续迭代”如何解除**：人类把 `max_iters` 调大（overlay `set-loop`）使 `iteration >= max_iters` 不再成立，escalated 自动解除、环重新接收新轮次；或直接修到测试绿出环。gate 本身不重置计数。

**watch（环进度只读展示）**：
```text
$ openlogos watch

[#0 2026-06-20T08:00:00Z] 派生状态（初始快照）
  生命周期：launched
  活跃提案：flow-loop-iterate · 步骤 verify-failed（验收未通过）
  implement loop：第 2/3 轮 · 未收敛（converged=false）
  下一步：继续迭代，修复后重跑 openlogos verify

（仅在派生状态变化时刷新；Ctrl-C 退出）

[#1 2026-06-20T08:05:30Z] 派生状态已更新
  implement loop：第 3/3 轮 · 已达上限 · 未收敛 → 升级人类确认点
```
- `watch` / `status` 只读展示 `loop_state`（`iteration` / `max_iters` / `converged` / `escalated`），不执行 verify、不推进状态。
- loop 激活且未收敛时，`status` / `watch` / `next` **一律不展示** deliver / deploy / smoke / archive 作为下一步——当前钉在 implement 内的 verify。

**JSON**：`status` / `next` / `watch` 的 success envelope 在 loop 激活时带 `loop_state`（`subflow_id` / `until` / `max_iters` / `iteration` / `converged` / `escalated`），挂载与 overlay 字段同构（有 `modules[]` → `modules[].loop_state`，legacy 回退顶层）；详见 `spec/cli-json-output.md`。未激活时省略该对象。

**不变量**：无激活项目时以上区块/字段全部不出现，`status` / `next` / `watch` 输出与未引入本切片时逐字节一致。

### 2.13 next 暴露 next_node 编排提示（仅 next）

`openlogos next` 在既有建议基础上额外吐出**最终建议处理节点**的**编排提示** `next_node`——把「该用哪个 skill / agent / 跑哪个脚本」变成机器可读字段，宿主据此真正编排。仅 `next` 暴露（`status` / `watch` 不动）；OpenLogos 只声明、不执行（A 被动派生）。无当前节点（命令级建议 / auto 放行 / loop 省略分支）时该字段省略，输出与未引入本切片时一致。

**口径**：本切片**以 JSON 的 `next_node` 为硬契约（验收以 JSON 为准）**；下面的文本模式一行展示**仅为示例、不作为验收项**（实现可选）。

**next（落在 builtin 当前节点，文本示例）**：文本模式就近内联追加一行「下一节点 + skill」（可选示例）。
```text
$ openlogos next

下一步：代码已完成，明确授权执行 openlogos verify
  下一节点：code · skill: code-implementor
```

**next（overlay `modify` 重绑 agent → next_node 如实反映）**：
```text
$ openlogos next

下一步：代码实现（implement 子流程）
  下一节点：code · skill: code-implementor · review_agent: my-code-reviewer
```

**next（落在 overlay-added 当前节点）**：取该节点自身的 hints（含 overlay 填的 working/review_agent、pre/post_script）。
```text
$ openlogos next

下一步：quality-gate（质量门）
  下一节点：quality-gate · skill: （无） · working_agent: my-qa-agent
```

`--format json` 下，`next` 的 success envelope 新增 `next_node` 对象，挂载与 `current_node` / `loop_state` 同构（有 `modules[]` → `modules[].next_node`，legacy 回退顶层 `next_node`）；`skill` / `working_agent` / `review_agent` / `pre_script` / `post_script` 固定存在、`string | null`：
```jsonc
// 有 modules[] 的项目
{"command":"next","version":"<cli-version>","data":{"modules":[
  {"id":"core","next_node":{
    "id":"code","name":"代码实现","subflow_id":"implement",
    "skill":"code-implementor","working_agent":null,"review_agent":"my-code-reviewer",
    "pre_script":null,"post_script":null
  }}
]}}
// legacy 无 modules 的项目 → 顶层 next_node
{"command":"next","version":"<cli-version>","data":{"next_node":{
  "id":"verify","name":"验收","subflow_id":"implement",
  "skill":null,"working_agent":null,"review_agent":null,"pre_script":null,"post_script":null
}}}
```

**省略 `next_node` 的情形**（命令级建议或例外，文本不显示「下一节点」行、JSON 不含该字段）：
- `all_done`（流程走完）、无 active proposal（建议 `openlogos change <slug>`）、补 baseline 文档（`openlogos change add-baseline-docs`）、`openlogos launch` 等命令级提示；
- `--auto` gate 已自动放行（`gate_auto_passed:true`）；
- loop 阻塞且 `code` 节点缺失 / 被 overlay `skip`，或 loop 达上限（`escalated`）。

**与 cmd / loop / --auto 正交**：`next_node` 不覆盖 cmd（S26）/ loop（S27）/ `--auto`（S24）既有字段，三者照常输出；loop 阻塞未达上限时 `next_node` 指向 loop 工作节点（`code`，对齐 action「修代码」而非 verify），与 `loop_state` 并存互补。

**不变量**：`status` / `watch` 输出不受影响（本切片不动它们）；`next` 仅对有当前节点的项目新增 `next_node`，golden 快照按预期仅此一处更新。

### 2.13.1 S31 切片子任务 checkbox 的 JSON 输出

当 launched `implement` 切片循环激活，且当前 `[code]` 顶层切片下存在缩进 checkbox 子任务时，`openlogos status --format json`、`openlogos next --format json` 与 `watch.data` 中的 `slice_state` 需要在既有字段之外暴露当前切片子任务：

```json
{
  "slice_state": {
    "total": 2,
    "done": 0,
    "remaining": 2,
    "current": "切片1：Agent idle 状态读取契约。",
    "current_children": [
      {"text": "扩展 open-agent bridge 状态 IPC。", "checked": true},
      {"text": "扩展 AgentAdapter 状态入口。", "checked": false},
      {"text": "补 AgentPanel idle/background/pending/streaming 读取。", "checked": false}
    ],
    "current_unchecked_children": [
      "扩展 AgentAdapter 状态入口。",
      "补 AgentPanel idle/background/pending/streaming 读取。"
    ]
  },
  "next_node": {
    "id": "code",
    "slice": "切片1：Agent idle 状态读取契约。",
    "slice_children": [
      {"text": "扩展 open-agent bridge 状态 IPC。", "checked": true},
      {"text": "扩展 AgentAdapter 状态入口。", "checked": false},
      {"text": "补 AgentPanel idle/background/pending/streaming 读取。", "checked": false}
    ]
  }
}
```

输出规则：

- `slice_state.total` 只统计 `[code]` 下顶层切片 checkbox，不统计缩进 checkbox。
- `slice_state.done` 只统计已完成父切片。父切片完成必须满足父切片 checkbox 已勾选，且该父切片下所有缩进子任务 checkbox 已勾选。
- `slice_state.current` 指向第一个未完成父切片；父切片已勾但仍有未勾子任务时，`current` 仍指向该父切片。
- `slice_state.current_children` 仅描述当前切片下的缩进 checkbox 子任务；若当前切片没有子任务 checkbox，可省略或输出空数组。
- `slice_state.current_unchecked_children` 只列出当前切片下未勾选子任务文本；若无未勾选子任务，可省略或输出空数组。
- `next_node.slice_children` 与 `slice_state.current_children` 同步，用于宿主构造“只做这一片 + 当前子任务”的派发提示。
- 无缩进子任务 checkbox 的既有输出保持兼容；普通缩进 bullet 不进入这些字段。

### 2.13.2 ready-to-implement 切片规划的 next_node 提示（split-slice-planner-stage）

当活跃提案处于 `ready-to-implement` 驻留态（merge 完成、`slice` 子流程的 `plan-slices` 节点为当前前沿）时，`openlogos next --format json` 的 `next_node` 指向 `plan-slices` 节点、`skill` 为 `slice-planner`，供宿主据此唤起切片规划环节：

```jsonc
{"command":"next","version":"<cli-version>","data":{"modules":[
  {"id":"core","next_node":{
    "id":"plan-slices","name":"划分切片","subflow_id":"slice",
    "skill":"slice-planner","working_agent":null,"review_agent":null,
    "pre_script":null,"post_script":null
  }}
]}}
```

输出规则：

- 默认前沿解析对 `ready-to-implement` 走 launched 路径 `STEP_TO_CURRENT_BUILTIN[ready-to-implement] = plan-slices`，再从 resolved flow 取该节点 hints（`skill: slice-planner`、agent/script 默认 `null`）。
- 文本模式（可选示例）就近内联追加一行：`下一节点：plan-slices · skill: slice-planner`。
- `next --auto` 在 `ready-to-implement` 放行 `slice-exit` 门（`gate_auto_passed:true`）时，按 R4 省略 `next_node`，输出 gate 字段（`gate_id:"slice-exit"` / `skippable:true` / `gate_auto_passed:true`）。
- 纯文档提案（无 `[code]`，`slice` 子流程 `when: code_required` 为假）不进入 `ready-to-implement`，不输出该 `next_node` 提示。

### 2.14 M2 预留收尾：loop 达上限可放行 / fan-out 覆盖阈值 / loop 内整组收敛（S29）

本节收掉 §13 三个轻量 M2 预留项的终端可见行为：A·loop 达上限可经 overlay 放行；B·fan-out 覆盖阈值；C·loop 内整组收敛措辞。全部由 overlay/字段 opt-in，A 被动派生（OpenLogos 只声明、不执行测试）。无对应 overlay/字段时以下区块/字段全部不出现，`status` / `next` / `watch` 输出与未引入本切片时逐字节一致。

#### A·loop 达上限可 overlay 放行（next --auto）

当 overlay 用 `set-loop` 写了 `set.exhausted_gate.skippable: true`，且 implement loop 达 `max_iters` 仍未测试绿（`escalated`）时，`openlogos next --auto` 把 loop 退出 gate 当作**可跳的高危确认点**放行：展示「达上限 → 自动放行（已写审计）→ 继续推进」，并放行**未通过测试的代码**进入后续 subflow。这是用户在 overlay 显式开启的高危行为。

**opt-in 放行（overlay 写了 `exhausted_gate.skippable:true`，文本）**：
```text
$ openlogos next --auto

⚠ implement loop 已达迭代上限（3/3）仍未绿
✓ auto 模式：达上限退出 gate 已放行（gate: implement:loop-exhausted，overlay 标记可跳）
  ⚠ 高危：本次放行的是未通过测试的代码（无人值守，由 overlay 显式开启）
  审计已追加：logos/changes/<slug>/GATE_AUTO_PASSED

下一步（gate 已自动放行，宿主可直接继续推进、无需人类授权）：进入后续 subflow
```

`--format json` 下，success envelope 在既有 next data 基础上带 gate 字段（与 S24 同构），`gate_id` 取 loop 退出 gate 的确定性 id，`loop_state.exhausted_skippable` 如实反映：
```jsonc
{"command":"next","version":"<cli-version>","data":{
  "gate_id":"gate:implement:loop-exhausted",
  "skippable":true,
  "gate_auto_passed":true,
  "loop_state":{"subflow_id":"implement","until":"tests_green","max_iters":3,
    "iteration":3,"converged":false,"escalated":true,"exhausted_skippable":true}
}}
```

**对照：默认（未写 `exhausted_gate`，与 S27 一致）** —— overlay 没写 `exhausted_gate` 时，`loop_state` **省略 `exhausted_skippable` 字段**（消费方按 `false` 处理，既有 S27 激活-loop JSON 不新增字段），`next --auto` 在达上限时**仍卡住**（与不可跳的 deliver gate 一致），不放行、不写 `GATE_AUTO_PASSED`：
```text
$ openlogos next --auto

⚠ implement loop 已达迭代上限（3/3）仍未绿 → 升级人类确认点
  gate: implement:loop-exhausted（不可跳过，未声明 exhausted_gate.skippable）
  请人类决定：继续迭代（调大 max_iters）/ 调整方案 / 放弃

下一步：修复到测试绿后重跑 openlogos verify，或在 overlay 调大 max_iters 继续迭代
```
对应 JSON 中 `skippable:false` / `gate_auto_passed:false`；`loop_state` 中**无 `exhausted_skippable` 字段**（省略，按 `false` 解读）。

- 默认 `next`（无 `--auto`）始终忽略 `GATE_AUTO_PASSED`、绝不因其越过 loop 退出 gate（与 S24/S28 口径一致）。
- 「继续迭代」的解除方式不变（overlay 调大 `max_iters` 使 `escalated` 解除，或修到测试绿出环；gate 不重置计数）。

#### B·fan-out 覆盖阈值（status / next 显示已完成）

fan-out 节点（`done_when: all_present`）可设可选字段 `coverage_threshold`（`0 < x <= 1`）。设了阈值（如 `0.9`）后，覆盖率达到 90% 即把该阶段判为 done——`status` / `next` 把该 fan-out 阶段显示为已完成，文本提示可体现「覆盖率 ≥ 阈值即视为完成」。覆盖度对象 `{ total, covered, missing }` 与 `scenario_coverage` 结构**不变**，仅 `done` 的判定改按阈值。

**status（设了 `coverage_threshold:0.9`，覆盖率 9/10 = 90% ≥ 阈值 → 已完成，文本）**：
```text
📊 OpenLogos Project Status
...（既有 phase / proposal_step 面板不变）...
  ✓ Phase 3.1 · 场景时序   场景覆盖 9/10（90%）≥ 阈值 90% → 已完成
    缺失：S12（覆盖率达阈值，视为完成）
```

`--format json` 下 `status`/`watch`/`next` **不新增字段**——`scenario_coverage` 结构完全不变，仅该阶段 `done` 改按阈值判定；
阈值本身只作为声明出现在 `flow show` 的节点字段 `coverage_threshold`（见 `spec/cli-json-output.md §9`）：
```jsonc
"phase.3-1": {
  "done": true, "skipped": false,
  "scenario_coverage": { "total": 10, "covered": 9, "missing": ["S12"] }
}
```
- 缺省（不写 `coverage_threshold`）等价 `all_present`（阈值 `1.0`、需 100% 覆盖），输出与现状一致；`total == 0` 维持现状（视为未 done）。
- 非法阈值（越界 / 非数）→ `FLOW_SCHEMA_INVALID`，不输出半成品状态。
- builtin 模板不写 `coverage_threshold` → 与 `all_present` 1:1 → golden 零漂移。

#### C·loop 内整组收敛（next 措辞不变）

当 loop（implement 子流程）内含 fan-out 节点时，收敛裁判仍是**测试绿**（S27 `until: tests_green`）——采用「整组收敛」，fan-out 节点各自按 `all_present` / `coverage_threshold` 完成。`next` 措辞照旧按「整组收敛 = 测试绿」驱动，**不逐实例报迭代轮次**：
```text
$ openlogos next

下一步：继续迭代（implement loop 第 2/3 轮未绿）
  · 让 working_agent 修复后重跑 openlogos verify
  · 收敛裁判：测试绿（openlogos verify PASS）
```
- 不引入 per-instance 迭代，不新增字段、不留悬空 schema；`loop_state` 仍只表达整组的 `iteration` / `max_iters` / `converged` / `escalated`。

#### 不变量

无 `exhausted_gate.skippable` / `coverage_threshold` 等 overlay 字段时，以上 A/B/C 区块与字段全部不出现，`status` / `next` / `watch` 输出与未引入本切片时逐字节一致；golden 快照零漂移。

### 2.15 gate 接外部命令：verify/deploy/smoke 的 done_when/fail_when 改 cmd:（S30）

本节收掉 §13 M2 最后一项 `modify-cmd-on-builtin` 的终端可见行为：overlay `modify` 可把 launched 的 **verify / deploy / smoke** 三个 gate 节点的 `done_when`（verify/smoke 另含 `fail_when`）改成 `cmd:<command>`，把门禁接到外部命令 / CI（如 `gh pr checks`、自定义部署校验脚本）。

语义沿用 S26 的 cmd 求值器（live 重评、瞬态、不写 marker）：`status` / `watch` **不执行 cmd**（停门前 + 输出 `cmd_gate` 字段），`next` 求值 cmd（budget=1）→ `done_when:cmd` exit 0 **本次瞬态推进过门**、`fail_when:cmd` exit 0 **本次瞬态 failed**，**均不写 marker** → **下一次 `status` 回到停门前**（有意的 next/status 不一致）。现有 `openlogos verify` / `deploy-done` / `smoke` 命令的 marker 写入行为完全不变。

无对应 overlay `modify` 时以下区块/字段全部不出现，`status` / `next` / `watch` 输出与未引入本切片时逐字节一致。

> 下例统一以 overlay 把 `verify.done_when` 改成 `cmd:gh pr checks` 为主线（节点级 `cmd_timeout_seconds` 缺省 → 回退项目 / 60s）。deploy / smoke 同理，差异在末尾「deploy / smoke gate 同理」简述。

#### A·status（不跑 cmd，停门前 + 输出 cmd_gate）

`status` 只读观测、**不执行 cmd**：verify 的 `done_when:cmd` 视为 unknown → 该 gate `pending` → `proposal_step` 停在门前 `ready-to-verify`；同时输出机器可读的 `cmd_gate` 字段表达「这是一个 cmd 门禁、需运行 next 触发求值」。

**文本（overlay 把 verify.done_when 改 cmd:gh pr checks）**：
```text
$ openlogos status

📊 OpenLogos Project Status
...（既有 phase / proposal_step 面板不变）...
  活跃提案：<slug> · 步骤 ready-to-verify（待验收）
  ⏸ verify 门禁已接外部命令（cmd）：gh pr checks
    status 不执行命令；运行 openlogos next 触发求值（exit 0 即过门）
  下一步：该 gate 由外部命令裁决，运行 openlogos next 求值后推进
```

`--format json` 下，success envelope 在 `modules[].cmd_gate` 暴露 builtin gate 的 cmd 门禁（与 `loop_state` / `active_change` 平级；legacy 无 `modules[]` → 回退顶层 `cmd_gate`；消费方先读 `modules[].*`、缺则读顶层）：
```jsonc
{"command":"status","version":"<cli-version>","data":{"modules":[
  {"id":"core","active_change":{"slug":"<slug>","proposal_step":"ready-to-verify"},
   "cmd_gate":{"node_id":"verify","field":"done_when","command":"gh pr checks","timeout_seconds":60}
  }
]}}
```
- `proposal_step` 停在 `ready-to-verify`（持久化前沿态，未跑 cmd），`cmd_gate` 与之共同表达「停在 verify 门前、门禁是 cmd」。
- builtin 节点**不输出** `current_node`（该字段仍只给 overlay-add 节点，契约不变）；builtin cmd gate 仅由 `cmd_gate` + `proposal_step` 表达。
- `watch` 与 `status` 同构：恒不执行 cmd，初始快照与变化事件的 `data` 里同样带 `modules[].cmd_gate`，行为与 `status` 一致。

#### B·next（跑 cmd，exit 0 瞬态推进过门）

`next` 对前沿 verify gate 求值 `done_when:cmd`（budget=1，与 S26 overlay-add cmd 共享预算）：exit 0 → 本次 envelope 的 `proposal_step` **瞬态推进过门**；非 0 / 超时 → 停门前。两种情况都**不写 marker**。

**文本（cmd exit 0 → 本次推进）**：
```text
$ openlogos next

下一步：verify 门禁（外部命令）
  · 执行 cmd: gh pr checks …
  · ✓ 通过（exit 0）→ verify 本次判定过门
  ⚠ 本次为瞬态求值、未写 VERIFY_PASS：下次 openlogos status 仍显示 ready-to-verify
  下一步：验收已过（本次），无需部署则明确授权 openlogos archive <slug>
```

`--format json` 下，success envelope 的 `proposal_step` 显示推进过门（如 verify 过门后据提案部署决策落到 `verify-passed` / `ready-to-deploy`），cmd 执行结果复用既有 §3.8(c) 字段（`cmd_node_id` / `cmd_predicate_field` / `cmd_exit_code` / `cmd_timed_out` / `cmd_satisfied`，`cmd_node_id` 天然支持 builtin 节点 id）：
```jsonc
{"command":"next","version":"<cli-version>","data":{
  "proposal_step":"verify-passed",
  "cmd_node_id":"verify","cmd_predicate_field":"done_when",
  "cmd_exit_code":0,"cmd_timed_out":false,"cmd_satisfied":true,
  "modules":[
    {"id":"core","active_change":"<slug>",
     "next_node":{"id":"archive","name":"归档","subflow_id":"close",
       "skill":null,"working_agent":null,"review_agent":null,"pre_script":null,"post_script":null}}
  ]
}}
```
- **next 瞬态、不写 marker → 下一次 status 回到 `ready-to-verify`**：这是**有意的 next/status 不一致**——`next` envelope 的门后态是「本次响应据 cmd 求值合成」，`status` / `watch` 反映「持久化前沿（停门前）」。
- `next_node`（R3 扩到 builtin cmd gate）：cmd 命中续推 → 指向续推后节点（如 `archive`）；cmd 失败 / 超时 → 指向该 builtin gate 节点（`verify`）。
- child 命令（`gh pr checks`）的 stdout/stderr 被捕获、**不混入** `next --format json` 的 stdout；命令输出不进契约。

**文本（cmd 非 0 → 停门前）**：
```text
$ openlogos next

下一步：verify 门禁（外部命令）
  · 执行 cmd: gh pr checks …
  · 命令未通过（exit 1）→ 停在 verify 门前（ready-to-verify）
  下一步：修复后让外部命令通过，再重跑 openlogos next 求值
```
对应 JSON：`proposal_step` 仍为 `ready-to-verify`，`cmd_exit_code` 非 0、`cmd_satisfied:false`，`cmd_gate` 照常输出（前沿仍是 cmd 门禁），`next_node` 指向 `verify`。

- `next` 对 cmd 字段求值**不写** `VERIFY_PASS` / `DEPLOY_DONE` / `SMOKE_PASS` / `*_FAIL`（A 被动派生：`next` 不改项目状态）。
- 现有 `openlogos verify` 命令照常可跑、照常写 `VERIFY_PASS` / `VERIFY_FAIL`，行为不变；这些 marker 只在仍为 marker: 谓词的字段上参与判定，cmd-gate 下不是门禁依据。

#### C·fail_when:cmd exit 0 → verify-failed（瞬态失败）

verify/smoke 还可把 `fail_when` 改成 `cmd:`。`fail_when:cmd` 优先于 `done_when`（§9 现有规则不变）：`next` 求值 `fail_when:cmd` exit 0 → 该 gate 本次 **failed** → `proposal_step` = `verify-failed`（瞬态失败态、非推进、不写 `VERIFY_FAIL`）。

**文本（fail_when 改 cmd: → exit 0 命中失败检查）**：
```text
$ openlogos next

下一步：verify 门禁（外部命令失败检查）
  · 执行 cmd: <fail-check> …
  · ✗ 命中失败检查（exit 0）→ verify 本次判定失败（verify-failed）
  ⚠ 本次为瞬态求值、未写 VERIFY_FAIL：下次 openlogos status 仍显示 ready-to-verify
  下一步：修复后让失败检查不再命中，再重跑 openlogos next
```
对应 JSON：`proposal_step:"verify-failed"`，`cmd_predicate_field:"fail_when"`、`cmd_exit_code:0`、`cmd_satisfied:true`（fail 检查命中即「满足」失败谓词）。

- deploy **无 `fail_when`**：overlay 把 `deploy.fail_when` 改 cmd: → `FLOW_SCHEMA_INVALID`（本切片不为 deploy 引入 fail_when:cmd）。

#### D·deploy / smoke gate 同理

- **deploy**：overlay 把 `deploy.done_when` 改 `cmd:<部署校验脚本>` → `status` 停门前 `ready-to-deploy` + 输出 `cmd_gate{node_id:"deploy",field:"done_when",...}`；`next` 求值 exit 0 → 本次瞬态推进过门（`proposal_step` 推进到 `ready-to-smoke` / 据提案落到 archive 前），不写 `DEPLOY_DONE` → 下次 `status` 回到 `ready-to-deploy`。`deploy.done_when:cmd` 不改变「部署属高危、deliver 入口 gate 仍由人类授权」的口径——cmd 只裁决「部署是否完成」，不绕过 deliver 入口确认。
- **smoke**：overlay 把 `smoke.done_when` / `smoke.fail_when` 改 cmd: → 同 verify：`status` 停门前 `ready-to-smoke` + `cmd_gate{node_id:"smoke",...}`；`next` `done_when:cmd` exit 0 瞬态过门、`fail_when:cmd` exit 0 瞬态 `smoke-failed`，均不写 `SMOKE_PASS` / `SMOKE_FAIL` → 下次 `status` 回门前。

#### 边界与错误（fail loud）

- 仅 **verify / deploy / smoke** 三个 gate 的白名单字段可改 cmd:（`verify.done_when` / `verify.fail_when` / `smoke.done_when` / `smoke.fail_when` / `deploy.done_when`）。其它任意 `(节点, 字段)` 改 cmd:（含 initial 全部节点、launched 的 proposal/delta/merge/code/archive，以及 `deploy.fail_when`）→ `FLOW_SCHEMA_INVALID`，不输出半成品状态。
- 同节点 `done_when` 与 `fail_when` **不得均为 cmd:**（沿用 S26 决策 B）→ `FLOW_SCHEMA_INVALID`（仅 verify/smoke 适用）。混合（一 cmd 一 marker）按字段独立求值。
- **与 loop 互斥**：激活 loop（`implement` 的 `set-loop max_iters>1`）+ verify 的 `done_when` 或 `fail_when` **任一**为 cmd: → `FLOW_SCHEMA_INVALID`（resolved 校验时即报）。deploy/smoke 在 deliver 子流程、无 loop → 无此冲突。
- shell 起不来 → `makeErrorEnvelope("next", "FLOW_CMD_SPAWN_FAILED", …)` 到 stderr、非零退出（沿用 S26）；命令不存在按非 0 处理（success envelope，`cmd_satisfied:false`）。

#### 不变量

- builtin 三模板的 verify/deploy/smoke 仍是 `marker:` → 无 overlay 项目的 detection / status / next / watch **逐字节不变**；golden 快照零漂移。
- cmd-gate 仅经 overlay `modify` opt-in 激活；`cmd_gate` 字段**仅 cmd gate 时出现**（无 overlay → 整字段省略）；`current_node` 维持只给 overlay-add，契约不变。

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
