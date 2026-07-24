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

`openlogos adopt` 为已有项目接入专用命令。它不是轻量补丁命令，而是“只跳过 Initial 文档门禁的 init”：必须完成与 `init` 同级别的 OpenLogos 基础设施初始化，然后用 `bootstrap: adopted` 标记存量项目接入来源，并写入模块级枚举 `baseline_seed_state: required` 衔接逆向建基线（S33）。

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
✓ 标记待建现状基线（baseline_seed_state: required）
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
  · 现状基线待建立（baseline_seed_state: required）

建议的下一步：逆向建立现状基线（种子基线，非权威意图）
  由 AI 会话/driver 逆向扫描代码库，产出 system-map + 场景候选清单，
  每份产物带 provenance 标记（reverse-engineered / verified: false）。
  存量代码 grandfather 豁免，可信边界随后续 change 触碰而前移。
```

> **能力缺失时的降级输出**（CLI-only / 非交互 CI / AI 不可用）：adopt 不启动 AI、不声称基线已建立，保持 `baseline_seed_state: required` 并输出可复制的后续提示：
> ```text
> ⚠ 未检测到可用的 AI 会话来逆向建立现状基线。
>   现状基线仍待建立（baseline_seed_state: required）。
>   请在支持 brownfield-adopter 的 AI 会话中继续，或稍后重试。
> ```

**异常：logos/ 已存在**
```text
✗ 该项目已初始化（logos/logos.config.json 已存在）
  若要重新配置，请先备份并删除 logos/ 目录。
```

### 2.6 next（存量项目接入无提案时）

`bootstrap: adopted` 且无活跃提案时，`openlogos next` 按 `baseline_seed_state`（`required` / `partial` / `seeded`）输出建基线引导，并展示现状基线覆盖率。历史 `bootstrap: skipped` 项目按相同逻辑兼容处理。

**种子基线待建立（`baseline_seed_state: required`）**
```text
$ openlogos next

📌 当前状态：已接入（存量项目接入模式），现状基线待建立

建议的下一步：逆向建立现状基线
  由 AI 会话/driver 逆向扫描代码库，产出 system-map + 场景候选清单
  （种子基线：provenance=reverse-engineered / verified=false）。
```

**种子基线部分建立（`baseline_seed_state: partial`，扫描未完成 / 中断可恢复）**
```text
$ openlogos next

📌 当前状态：已接入（存量项目接入模式），现状基线部分建立（扫描未完成）

现状基线覆盖率：incomplete（已落盘候选 5，扫描未完成，暂不计算精确百分比）

建议的下一步：完成现状基线（恢复扫描）
  → openlogos baseline-seed commit --module core --run-id <run_id>   # 续提交已落盘产物
  或重新 openlogos baseline-seed begin 派发扫描补齐缺失产物。
  也可先发起 openlogos change 业务迭代（不强制先恢复）。
```

**种子基线已建立（`seeded`），展示覆盖率**
```text
$ openlogos next

📌 当前状态：已接入（存量项目接入模式），现状基线已建立

现状基线覆盖率：human-verified 0 / 候选 12（含 tombstone 0）
  覆盖率采 tombstone 分母法，不因删除候选虚增。

建议的下一步：正常发起 openlogos change 迭代
```

> `partial` 是**持久化恢复态**（非瞬时）：`status` 与 `next` 输出必须一致，且不把已落盘候选当最终分母算精确百分比（标 `incomplete`）。**本节为「无活跃提案」情形**，故 partial 主 `action`/`next_node` 指向恢复入口（`openlogos baseline-seed`）；**存在活跃提案时改为「proposal 前沿为主、partial 恢复作 `baseline_coverage.recovery` advisory」**（见 §2.22 优先级）。覆盖率无法可信重算时（派生索引缺失/过期/解析失败）显示 `unknown`/`stale`，不输出貌似精确的百分比。`next` 不得把未建立/部分建立的种子基线显示为已建立。

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

`openlogos next --auto` 提供**全自动 / 无人值守**体验——一次性 standing run-scoped 授权，让流程从方案审批一路自动跑到 `archive` + `git push`，既越过**可跳**的人类确认点，也无人值守地完成代码**已绿之后**的盖章 / 发布动作；同时守住**未收敛代码**这条硬红线。

**半 / 全自动两档**：

- **半自动（无 `--auto`）= 手动 / 默认**：4 道可跳门 + `verify` / `smoke` / `archive` / `git push` 红线步骤**逐一人工确认**，行为与未引入本能力时**完全一致**。
- **全自动（`--auto`）= 无人值守**：用户选 `--auto` 即**一次性授权该提案全链路自动到底**——自动放行 4 道可跳门，并自动执行 `verify` / `smoke` / `archive`、放行 `git push`。

**帮助文案（`openlogos next --help` 摘要）**：

```text
--auto   全自动 / 无人值守：standing run-scoped 授权。一次性授权当前提案
         全链路自动跑到底——自动放行可跳人类确认点（plan/spec/slice/deliver
         出入口门），并在代码已绿后自动执行 verify / smoke / archive 与放行
         git push。可跳门每次放行写 GATE_AUTO_PASSED 审计；git push 无需任何
         marker / guard 改动——guard 安全白名单本就放行 git push，全自动下纯由
         指令文本授权。未收敛代码（loop-exhausted，达迭代上限仍未绿）为硬红线，
         任何模式都不自动放行。不带 --auto 时所有人类确认点行为不变。
```

**可跳 gate（`ready-to-merge`，spec 出口 `skippable:true`）在 auto 下放行并留痕**：

```text
$ openlogos next --auto

✓ auto 模式：可跳人类确认点已放行（gate: spec-exit，skippable）
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

**可跳 gate（`ready-to-deploy`，deliver 入口 `skippable:true`）在 auto 下放行**（部署目标可能是测试环境；放行依据为本次响应 `gate_auto_passed=true`，历史审计行不构成授权）：

```text
$ openlogos next --auto

✓ auto 模式：可跳人类确认点已放行（gate: deliver-entry，skippable）
  审计已追加：logos/changes/<slug>/GATE_AUTO_PASSED

下一步（gate 已自动放行，宿主可在 standing 授权下执行部署）：按部署方案执行部署
```

**绿后盖章/发布红线（`verify` / `smoke` / `archive` / `git push`）在 auto 下自动执行**：这 4 样**无对应可跳 flow gate**，不经 skip-gate 机制，而由全自动 standing 授权放行。`verify` / `smoke` / `archive` 由 AI 宿主在 `--auto` 授权下自动调用；`git push` **无需任何 marker / guard 改动**——`plugin/bin/guard-check` 的安全白名单本就放行 `git push`，全自动下纯由指令文本授权（与其余 3 样同理）。半自动（无 `--auto`）下这 4 样仍逐一提示人类明确授权。

**硬红线：未收敛代码（`loop-exhausted`，达迭代上限仍未绿）在 auto 下仍卡住**：

```text
$ openlogos next --auto

⚠ implement loop 已达迭代上限（3/3）仍未绿 → 升级人类确认点
  达上限退出 gate（gate: implement:loop-exhausted）不可自动跳过：
  绝不无人值守发布未通过测试的代码。
  不写 GATE_AUTO_PASSED 审计。

下一步：修复未绿用例后重跑 openlogos verify（或由 overlay 显式开启 exhausted_gate.skippable）
```

**默认 `next`（无 `--auto`）忽略 `GATE_AUTO_PASSED`、不因其越过 gate 或红线**：即便活跃提案目录已存在 `GATE_AUTO_PASSED` 审计文件，默认 `next` 也绝不因它自动越过任何确认点；其 base data 仍按当前契约输出（S28 起可能含 `next_node`），不受 `--auto` 影响。

`--format json` 下，`next --auto` 在既有 next data 基础上附带 gate 字段（`gate_id` / `skippable` / `gate_auto_passed`），详见 `spec/cli-json-output.md`。`verify` / `smoke` / `archive` / `git push` 非 flow 门、不经 `gate_id`，由 standing 授权 + 指令文本驱动（`git push` 另凭 guard 安全白名单本就放行）。

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

`--format json` 下，`next` 的 success envelope 新增 `next_node` 对象，挂载与 `current_node` / `loop_state` 同构（有 `modules[]` → `modules[].next_node`，legacy 回退顶层 `next_node`）；`skill` / `working_agent` / `review_agent` / `pre_script` / `post_script` 固定存在、`string | null`；每个 `next_node` **恒带完整** `dispatch: {"idempotent": bool, "timeout_seconds": int, "artifacts_hint": string[]}`，节点可另声明 `requires_reviewed: string[]`（如 apply-merge 声明 `requires_reviewed: ["proposal","delta"]`，contract-self-description）：
```jsonc
// 有 modules[] 的项目
{"command":"next","version":"<cli-version>","data":{"contract":{"version":"1.0.0"},"modules":[
  {"id":"core","next_node":{
    "id":"code","name":"代码实现","subflow_id":"implement",
    "skill":"code-implementor","working_agent":null,"review_agent":"my-code-reviewer",
    "pre_script":null,"post_script":null,
    "dispatch":{"idempotent":true,"timeout_seconds":3600,"artifacts_hint":["logos/resources/verify/test-results.jsonl"]}
  }}
]}}
// legacy 无 modules 的项目 → 顶层 next_node
{"command":"next","version":"<cli-version>","data":{"contract":{"version":"1.0.0"},"next_node":{
  "id":"verify","name":"验收","subflow_id":"implement",
  "skill":null,"working_agent":null,"review_agent":null,"pre_script":null,"post_script":null,
  "dispatch":{"idempotent":true,"timeout_seconds":900,"artifacts_hint":["logos/resources/verify/acceptance-report.md"]}
}}}
```

**dispatch 数据源与保守默认**：权威数据源 = flow 节点定义（内置模板逐节点人工声明，**不从 produces/done_when 推导**）；overlay-add 未声明 → 保守默认 `{idempotent:false, timeout_seconds: defaults.dispatch.timeout_seconds, artifacts_hint: []}`；`artifacts_hint: []` ＝「产物未知」契约语义：消费方不得据此判死，只能升级观察。

**省略 `next_node` 的情形**（命令级建议或例外，文本不显示「下一节点」行、JSON 不含该字段）：
- `all_done`（流程走完）、无 active proposal（建议 `openlogos change <slug>`）、补 baseline 文档（`openlogos change add-baseline-docs`）、`openlogos launch` 等命令级提示；
- `--auto` gate 已自动放行（`gate_auto_passed:true`）；
- loop 阻塞且 `code` 节点缺失 / 被 overlay `skip`，或 loop 达上限（`escalated`）。

**与 cmd / loop / --auto 正交**：`next_node` 不覆盖 cmd（S26）/ loop（S27）/ `--auto`（S24）既有字段，三者照常输出；loop 阻塞未达上限时 `next_node` 指向 loop 工作节点（`code`，对齐 action「修代码」而非 verify），与 `loop_state` 并存互补。

**不变量**：`status` / `watch` 输出不受影响（本切片不动它们）；`next` 仅对有当前节点的项目新增 `next_node`。golden：contract-self-description **主动破例**打破「next_node 既有 8 字段逐字节不变」锚——新增 `dispatch` / `requires_reviewed` 子字段，next golden（用例 2/6）重拍。

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

## no-delta spec-complete 与测试 ID 缺失提示

### `proposal_step=spec-complete-required`

当活跃提案为代码提案、`tasks.md` 无 `[delta]` section 或无需产出 delta，但提案目录缺少 `SPEC_MERGED` / `MERGED` 时，`openlogos status` 与 `openlogos next` 必须提示先完成 no-delta spec-complete。

文本建议：

```text
活跃提案：<slug> · 步骤 spec-complete-required（需完成 no-delta spec-complete）
下一步：执行 openlogos merge <slug>。该提案没有规格 delta，merge 将执行 no-op merge 并写入 SPEC_MERGED。
```

JSON 约束：

```json
{
  "proposal_step": "spec-complete-required",
  "diagnostic": {
    "reason": "no_delta_spec_marker_missing",
    "remediation": "run openlogos merge <slug> to write SPEC_MERGED"
  }
}
```

此状态下不得返回 `next_node.id=="plan-slices"`、`next_node.id=="code"` 或 `next_node.id=="verify"`。

### `proposal_step=test-id-required`

当代码提案已完成 spec-complete，但 OpenLogos 无法从已合并测试资源或显式复用声明中解析到真实 `UT-*` / `ST-*` / `SMOKE-*` ID 时，`status/next` 必须提示补齐测试 ID。

文本建议：

```text
活跃提案：<slug> · 步骤 test-id-required（缺少真实测试 ID）
下一步：补充或声明复用真实 UT/ST/SMOKE ID；测试 ID 稳定后再进入 slice-planner。
```

JSON 约束：

```json
{
  "proposal_step": "test-id-required",
  "diagnostic": {
    "reason": "code_change_requires_real_test_ids",
    "remediation": "add or reference real UT/ST/SMOKE IDs before plan-slices"
  }
}
```

此状态下不得输出 `gate_auto_passed:true`，不得写入 `SLICES_APPROVED`。

### no-delta merge 输出

`openlogos merge <slug>` 在无 delta 时应输出：

```text
已完成 no-delta spec-complete：该提案没有规格 delta，已写入 SPEC_MERGED。
下一步：重新运行 openlogos next，根据测试 ID 门禁进入 plan-slices 或返回阻塞诊断。
```

### 2.16 change：GUI 项目 proposal.md「UI/UX 变更声明」段注入

对已 `launched` 的 **GUI 产品项目**（`product_type` ∈ 网站 / 桌面 / 移动 App），`openlogos change <slug>` 在生成 `proposal.md` 时，模板额外注入一节机器可读的「UI/UX 变更声明」段。CLI 本次范围**只动模板注入**，**不新增 `--ui` 等命令行为、不新增门态、不新增确认标记**；注入的声明段供 change-writer 在 plan 阶段填写「本次动没动界面 + 原型页清单」。

**非 GUI 项目（纯 CLI / API / Skills）不注入该段，`openlogos change` 输出与流程逐字节零改动。** 是否注入仅由 `product_type` 决定，判定「动没动界面」由 change-writer 在 plan 阶段依提案意图 + `product_type` + `tasks.md` 的 `[delta]` 目标完成，`openlogos change` 只负责放置声明段占位、不做界面判定。

**GUI 项目 `openlogos change` 成功输出（示意，含声明段注入提示）**：

```text
$ openlogos change refresh-dashboard-cards

✓ 已创建变更提案：logos/changes/refresh-dashboard-cards/
✓ 写入 proposal.md（含「UI/UX 变更声明」段）
✓ 写入 tasks.md
✓ 写入 guard 文件：logos/.openlogos-guard

检测到 GUI 项目（product_type: website）：
  · proposal.md 已注入「UI/UX 变更声明」段（ui_impact + 声明页清单占位）
  · 若本次触及界面，请在 plan 阶段用 ui-ux-pro-max 产出 page-design 原型，
    作为 deltas/prd/2-product-design/2-page-design/core-NN-<slug>.html 写入
    （原型将在批准提案时随面板渲染一并确认）

下一步：用 change-writer 填写 proposal.md / tasks.md，并声明 ui_impact
```

**注入的「UI/UX 变更声明」段占位（写入 `proposal.md`，保持 markdown 结构不变）**：`openlogos change` 只写入占位结构，具体值由 change-writer 填。占位以标准 markdown 小节承载，含 `ui_impact` 布尔声明、机器可读的 `design_system_mode`（默认 `generated`；降级时须置 `fallback` 并填 `design_system_fallback_reason`）与结构化声明页清单占位，**不打断 CLI / runlogos 对 `proposal.md` 的解析**：

```markdown
## UI/UX 变更声明

- ui_impact: <true | false>   # 本次是否触及界面（GUI 项目必填）
- design_system_mode: <generated | fallback>   # 机器可读：generated=走设计系统产令牌；fallback=降级（如 Python3 缺失）
- design_system_fallback_reason: <降级原因，仅 design_system_mode:fallback 时必填，如「Python3 缺失」>
- design-system.json: <ui-ux-pro-max 令牌产物路径；仅 design_system_mode:generated 时产出并要求，fallback 时不产/不要求>
- 声明页清单（ui_impact:true 时逐页列出，与 2-page-design/ 下原型文件一一对应）：
  - id: <unique-page-id>
    prototype: core-NN-<slug>.html   # 仅 basename；禁 .. / 子目录；扩展名必须 .html；全清单唯一
    description: <一句话说明该屏/状态>
```

**要点（CLI 体验层面）**：
- `proposal.md` 保持既有 markdown 结构（标题层级、既有各段顺序不变），声明段作为一节追加，避免打断下游对 proposal 的解析。
- 声明段是**机器可读**的：`ui_impact` 是「本次动没动界面」的单一权威意图源；`design_system_mode`（`generated | fallback`）是「是否走了设计系统」的单一权威事实源，供 checker `check-ui-prototype` 分流对账（`generated` 要求合法非空 `design-system.json` 令牌；`fallback` 禁伪造令牌、不要求 `design-system.json`、须填 `design_system_fallback_reason`）。
- 声明页清单占位为**结构化记录**（每页一个 `id` + 精确 `prototype` basename + `description`），供 change-writer 逐页填写。`prototype` 只取 basename（禁 `..` / 子目录，扩展名必须 `.html`，全清单唯一），是与 `2-page-design/` 下实际产出原型文件做完整性对账的键：checker 按精确 basename 集合比较（排序无关；重复 / 额外 / 缺失均失败），`PLAN_APPROVED.pages` / `hashes` 复用同一 basename 键（对账契约在 `spec/change-management.md` / `spec/proposal-ui-ux-first.md`，此处只描述 CLI 呈现）。
- `openlogos change` **不生成原型、不判定界面、不做对账**——仅放置声明段占位并给出引导提示；原型产出与对账发生在 plan 阶段的 change-writer 环节。
- Python3 缺失导致 ui-ux-pro-max 无法运行时，不阻塞 `openlogos change`；提案照常创建，change-writer 后续以通用风格兜底、置 `design_system_mode: fallback` 并填 `design_system_fallback_reason`（不产 / 不要求 `design-system.json`）。

**异常与边界**：
- 非 GUI 项目：不注入声明段，`openlogos change` 输出无「检测到 GUI 项目」提示，与现状一致。
- guard 冲突（已有活跃提案）：沿用现有 `openlogos change` guard 冲突提示，声明段注入不改变该异常行为。

### 2.17 status / next 的 `capabilities` 段呈现（CLI 输出层面）

`openlogos status` / `openlogos next` 在输出中新增 `capabilities` 段，用于在 CLI 层面呈现当前会话是否具备 UI 原型渲染能力（`ui_prototype_render`），供宿主 / driver 在 plan-exit **之前**据此选择渲染确认模式或降级模式。**详细契约见 `spec/cli-json-output.md`，此处只描述终端呈现体验。**

**文本模式（GUI 项目、能力就绪）**：能力就绪时，`status` 可就近提示 UI 原型将随面板渲染确认：

```text
$ openlogos status

📊 OpenLogos Project Status
...（既有 phase / proposal_step 面板不变）...
🧩 能力（capabilities）
  · ui_prototype_render：就绪 → 批准提案时面板渲染原型即构成 UI 确认
```

**文本模式（能力缺失 / 旧面板 / CLI-only）**：能力缺失时如实呈现降级，**不 claim UI 已确认**，且不阻断：

```text
🧩 能力（capabilities）
  · ui_prototype_render：缺失（降级）→ 批准仅为普通方案批准，不构成 UI 视觉确认
    提示：可直接打开原型 .html 自行确认
```

**JSON 模式**：`status` / `next` 的 success envelope 在 `data` 增 `capabilities` 段（如 `{"ui_prototype_render": true|false}`）；能力信号来源与解析规则见 `spec/cli-json-output.md`。

**不变量**：
- 非 GUI 项目 / 无能力输入通道时，`capabilities` 段可省略或全为默认降级值，`status` / `next` 输出与未引入本特性时保持兼容。
- 该段仅供 plan-exit **之前**的模式选择；plan-exit **之后**的 merge / 落盘强制语义一律以持久化的 `PLAN_APPROVED` provenance 为准，不因当前会话 capability 缺失而降级（详见 `spec/change-management.md`）。

## 存量项目 product_type 迁移与回填（CLI 体验）

> **背景（F1 critical）**：UI-first 的目标受众是**已 `launched` 的 GUI 项目**，但这些存量项目早已跑完 `init`/`adopt`，升级后不重跑采集，其 `logos-project.yaml` 的 `modules[]` 普遍**缺 `product_type` 字段**。按「缺失=非 GUI」安全默认，UI-first 对它们完全不可达。本段描述补齐迁移路径后的**终端体验**：回填命令、缺字段诊断、`module add` 采集、`--auto` 下暴露 next action。**数据源 / 枚举 / 迁移语义的权威定义在 `spec/logos-project.md`；机器可读 JSON 契约在 `spec/cli-json-output.md`，此处只描述人类可读的终端呈现。**
>
> 枚举：`web | desktop | mobile | cli | api | library | skills | service`；GUI 集合 = {`web`, `desktop`, `mobile`}。

### 2.18 `openlogos module set-product-type <module-id> <enum>` 终端体验

显式、幂等、带校验地写入 / 更新 `logos-project.yaml` 中 `modules[<module-id>].product_type`，是存量模块开启（或关闭）UI-first 的**唯一受支持回填入口**。

**成功（首次设置为 GUI 枚举，提示下一步 sync 注入 overlay）**：

```text
$ openlogos module set-product-type web web

✓ 已更新模块 web 的 product_type：web（GUI）
  · logos-project.yaml → modules[web].product_type: web

检测到项目现含 GUI 模块：
  · 下一步运行 openlogos sync 将幂等注入 gui-ui-first overlay
    （节点 write-ui-prototype / verify-ui-provenance）
  · 该模块的后续提案将启用 UI-first（ui_impact 可为 true）
```

**成功（设置为非 GUI 枚举）**：不引导 overlay 注入，保持零改动语义。

```text
$ openlogos module set-product-type api api

✓ 已更新模块 api 的 product_type：api（非 GUI）
  · logos-project.yaml → modules[api].product_type: api
  · 非 GUI：不注入 overlay，变更流程零改动
```

**幂等 no-op（值与当前相同）**：不报错、不产生多余写入，可安全重复执行。

```text
$ openlogos module set-product-type web web

✓ 模块 web 的 product_type 已是 web，无需变更（no-op）
```

**非法枚举（报错并列出全部合法枚举，非零退出）**：

```text
$ openlogos module set-product-type web frontend

✗ 非法的 product_type：frontend
  合法枚举：web | desktop | mobile | cli | api | library | skills | service
  （GUI 集合 = web / desktop / mobile）
```

**未知 module（报错指明 id 不存在，非零退出）**：

```text
$ openlogos module set-product-type payments web

✗ 未知模块：payments
  当前已注册模块：web、api、tooling
  提示：先用 openlogos module add 注册，或检查拼写
```

**缺参（用法错误，打印用法、非零退出）**：

```text
$ openlogos module set-product-type web

✗ 用法错误：缺少 <enum> 参数
  用法：openlogos module set-product-type <module-id> <enum>
  <enum>：web | desktop | mobile | cli | api | library | skills | service
```

### 2.19 `openlogos sync` 缺字段诊断 + overlay 注入 / 移除提示

**检测到 launched 模块缺 `product_type`（人类可读诊断，提示运行 set-product-type；warning 不阻断）**：`sync` 照常完成同步，额外列出缺字段模块并给出精确回填命令。

```text
$ openlogos sync

✓ 已重新生成 AGENTS.md / CLAUDE.md
✓ 已重新部署 skills

⚠ 检测到 launched 模块缺少 product_type（PRODUCT_TYPE_CONFIRMATION_REQUIRED）
  缺字段模块：web、admin
  · UI-first 暂不启用：缺字段一律按非 GUI 处理（安全默认）
  · 请为每个模块显式确认产品类型，例如：
      openlogos module set-product-type web web
      openlogos module set-product-type admin web
  · 若确为非 GUI，也请显式设置（如 set-product-type <id> cli）以消除本提示
```

**注入 overlay（项目含 ≥1 GUI 模块，幂等；重复 sync 不重复注入）**：

```text
$ openlogos sync

✓ 已重新生成 AGENTS.md / CLAUDE.md
✓ 项目含 GUI 模块（web）→ 已注入 gui-ui-first overlay
    · logos/flow/launched.yaml：write-ui-prototype、verify-ui-provenance
  （幂等：已注入时重复 sync 为 no-op，不重复写入）
```

**移除 overlay（最后一个 GUI 模块改为非 GUI / 被移除，项目不再含 GUI 模块）**：仅按 `gui-ui-first` 已知 node id + overlay 源标记识别注入产物，**绝不删除用户自定义 ops**。

```text
$ openlogos sync

✓ 已重新生成 AGENTS.md / CLAUDE.md
✓ 项目不再含 GUI 模块 → 已移除 gui-ui-first overlay ops
    · 移除 write-ui-prototype、verify-ui-provenance（仅 gui-ui-first 注入产物）
    · 用户自定义 overlay ops 保持不变
  launched.yaml 回到无 gui-ui-first ops 的态（非 GUI 零改动）
```

### 2.20 `openlogos module add` 采集 `product_type` 交互示意

新增 module 时同步采集 `product_type`：交互式 prompt，或 `--product-type <enum>` 非交互指定。

**交互式 prompt**：

```text
$ openlogos module add

模块 id: web
模块名称: Web 控制台
产品类型 (product_type)？
  1) web       (GUI)
  2) desktop   (GUI)
  3) mobile    (GUI)
  4) cli       (非 GUI)
  5) api       (非 GUI)
  6) library   (非 GUI)
  7) skills    (非 GUI)
  8) service   (非 GUI)
选择 [默认 4) cli]: 1

✓ 已新增模块 web（product_type: web，GUI）
  · 项目含 GUI 模块 → 下一步 openlogos sync 注入 gui-ui-first overlay
```

**非交互（`--product-type`）**：

```text
$ openlogos module add web --name "Web 控制台" --product-type web

✓ 已新增模块 web（product_type: web，GUI）
```

**省略 product_type（落安全非 GUI 默认 `cli`，标注需人工确认）**：与 `adopt` 推断口径一致，避免误把新模块当成 GUI。

```text
$ openlogos module add tooling --name "内部脚本"

✓ 已新增模块 tooling（product_type: cli，非 GUI · 需人工确认）
  提示：默认落非 GUI 安全值 cli；若为 GUI 请运行
    openlogos module set-product-type tooling <web|desktop|mobile>
```

### 2.21 `--auto`（无人值守）下不猜测、暴露 next action 的体验

`openlogos next --auto` **绝不**凭启发式把未设置 `product_type` 的模块升级为 GUI：保持安全非 GUI 默认，把 `PRODUCT_TYPE_CONFIRMATION_REQUIRED` 作为**机器可读 next action 暴露**给 driver，仅在显式配置 GUI 枚举后才注入 overlay。

```text
$ openlogos next --auto

（... 正常推进当前提案 ...）

⚠ PRODUCT_TYPE_CONFIRMATION_REQUIRED（不阻断，仅暴露待确认项）
  缺 product_type 的 launched 模块：web、admin
  · --auto 不猜测：这些模块仍按非 GUI 处理，UI-first 不启用
  · next_action：openlogos module set-product-type <module-id> <web|desktop|mobile|cli|...>
    显式设置后 UI-first 方可对该模块生效
```

**要点（CLI 体验层面）**：
- 缺字段诊断是 **warning 而非 error**：`sync` / `status` / `next`（含 `--auto`）照常完成，只暴露待确认项，绝不阻断，绝不隐式升级为 GUI。
- 缺字段的**安全默认（非 GUI）维持到显式设置**：`set-product-type` / `module add` 显式落值前，缺字段模块一律非 GUI，`ui_impact` 恒 `false`、不注入 overlay。
- `set-product-type` **幂等**：重复设为相同值为 no-op；`sync` 注入 / 移除也幂等（以「项目是否含 ≥1 GUI 模块」为唯一键收敛）。
- overlay 移除**仅**针对 `gui-ui-first` 已知 node id（`write-ui-prototype` / `verify-ui-provenance`）与 overlay 源标记，用户自定义 ops 不动。
- 机器可读契约（`PRODUCT_TYPE_CONFIRMATION_REQUIRED` warning/next_action 结构、`module list` 的 `product_type` 字段、`set-product-type --format json` 结果结构）见 `spec/cli-json-output.md`。

### 2.22 现状基线覆盖率的 status / JSON 呈现（brownfield-adopter）

`bootstrap: adopted` 模块下，`status` 与 `next` 展示现状基线覆盖率，语义单一来源、口径一致：

- **人读**：`现状基线覆盖率：human-verified <分子> / 候选 <存活> （含 tombstone <未确认废弃数>）`。覆盖率百分比仅由 `human-verified` 分子驱动。
- **JSON**（`status --format json` / `next --format json`）：新增 `baseline_coverage` 对象——
  ```json
  {
    "baseline_coverage": {
      "state": "seeded",
      "incomplete": false,
      "human_verified": 0,
      "denominator": 12,
      "tombstones": 0,
      "human_verified_delta": 0,
      "source": "derived-index",
      "freshness": "fresh"
    }
  }
  ```
  - `state`：`required` | `partial` | `seeded`（映射模块级 `baseline_seed_state`）。
  - `incomplete`：**恒存在的布尔**（稳定 shape，不省略）——`state==partial` 时 `true`（`denominator`/百分比非最终值、不算精确百分比、`next` 下一步指向恢复），`required`/`seeded` 时 `false`。
  - `denominator` = 存活候选 ∪ 未经人工确认的 tombstone；`human_verified_delta` 单列，禁止把分母波动解读为新增人工确认。
  - `freshness`：`fresh` | `stale` | `unknown`；`stale`/`unknown` 时不得输出貌似精确的百分比。
  - `recovery`（仅 `state==partial` 且**存在活跃提案**时出现）：结构化 advisory `{ available:true, entry:"openlogos baseline-seed commit --run-id <id>", run_id }`——不改写 `proposal_step`、不阻断 change。
- **partial 与活跃提案的优先级**：**无活跃提案**时 partial 主 `action`/`next_node` 指向 `baseline-seed` 恢复；**有活跃提案**时主 `action`/`next_node`/`proposal_step` 保持该提案真实前沿，partial 恢复仅作 `recovery` advisory 呈现。
- 覆盖率**只读已合并主文档**中各产物 `## 逆向基线来源` 章节；merge 前的未合并 delta 不计入覆盖率、不提前声称前移。

### 2.23 openlogos baseline-seed 终端体验（种子状态提交，brownfield-adopter）

`openlogos baseline-seed` 是 `baseline_seed_state` 的**唯一写入入口**（AI/driver/skill 不直接改 YAML、不直接写目标 `logos/resources/`）。采两阶段 staging。三子命令：

**begin（扫描开始，提交逻辑产物计划——无内容 hash——CLI 校验后签发 run_id + 建 staging）**
```text
# manifest 为逻辑计划：{ module, expected:[{ kind, target_path, candidate_keys:[...] }] }，无 planned_sha256
$ openlogos baseline-seed begin --module core --manifest .logos-seed-plan.json --format json
{ "ok": true, "run_id": "seed-core-0007", "module": "core",
  "baseline_seed_state": "required", "expected": 12,
  "staging": "logos/resources/verify/baseline-seed-runs/seed-core-0007/staging/" }
# 校验失败示例：缺必需 kind → 非零退出 { "ok": false, "error": "missing_required_kind" }
```

**commit（skill 已把产物写入 staging 后，CLI 对 staged 字节校验并原子提交）**
```text
$ openlogos baseline-seed commit --module core --run-id seed-core-0007 --format json
{ "ok": true, "run_id": "seed-core-0007", "module": "core",
  "baseline_seed_state": "seeded",   # 必需 kind 齐+全部合法→提交 staged 到目标+seeded；未全→partial；0→保持
  "committed": ["...12 条..."], "missing": [], "invalid": [] }
```

**status（只读当前 run、staging 进度与状态，供恢复/重试决策）**
```text
$ openlogos baseline-seed status --module core
run: seed-core-0007  state: partial  staged 5/12  missing 7
下一步：openlogos baseline-seed commit --module core --run-id seed-core-0007（补齐 staging 后自动转 seeded）
```

**错误与不变量**：
- `begin` 校验：必需 kind（`system-map`+`scenario-candidates`）齐全、`target_path` 项目根相对且位于允许基线目录、拒绝绝对路径/`..`/符号链接/重复路径——否则非零退出（`missing_required_kind`/`path_escape`）。
- `seeded` 仅在必需 kind 齐全且全部 expected 合法时成立——少报/单项 manifest、单文件 staged **均不得**被判完成。
- `commit` 对 staged 实际字节算 hash + 比对 `candidate_keys` 与 staged `candidates[]` 一致；不一致 → `candidate_key_mismatch` 非零退出。
- `commit` 幂等（同 run_id 依 staging 重算、结果一致）；`stale`（被新 begin superseded）/未知 `run_id`/并发 → `stale_run`/`unknown_run`/`run_locked` 非零退出、不写状态、不提交文件。
- 从 `partial` 重新 `begin` **不回退到 `required`**（保留 `partial` 至新 run 首次有效 commit）。
- run 记录 + staging + `commit-journal.json` 持久化于 `logos/resources/verify/baseline-seed-runs/<run_id>/`。跨多文件提交经 journal `prepared→committing→committed`（状态最后写）在模块级事务锁下进行；`status`/`next`/覆盖率等机器读取入口经**恢复门**（取锁 + 检测未终结 journal → 先恢复，否则 `baseline_commit_in_progress`）保证不把半新集合当权威（`verify` 已与基线候选解耦、不参与恢复门），`seeded` 当且仅当完整新集合在盘（见架构 §4.4；对直接按路径读取的人工/Skill 不宣称原子可见）。

### 2.24 status / next 契约自描述 JSON 输出（contract / step_meta / facts / dispatch 与 loop_state 缺席态，contract-self-description）

`status` / `next` 的 `--format json` 输出携带机器契约自描述字段：`data` 顶层 `contract`（契约版本握手）、`active_change.step_meta`（步骤语义元数据）、`active_change.facts`（CLI 权威事实块）、`next_node.dispatch`（派发契约，仅 next）。字段定义与注册表见功能规格 2.28 / 2.18；本节给出输出示例与体验口径。

**status（ready-to-implement 驻留态 → `loop_state` 缺席）**：

```jsonc
$ openlogos status --format json
{
  "command": "status",
  "version": "<cli-version>",
  "data": {
    "contract": { "version": "1.0.0" },
    "modules": [
      {
        "id": "core",
        "active_change": {
          "slug": "contract-self-description",
          "proposal_step": "ready-to-implement",
          "step_meta": { "phase": "pre-implement", "kind": "residency" },
          "facts": {
            "spec_complete": true,
            "slices_planned": true,
            "slices_approved": false,
            "code_required": true,
            "has_delta_tasks": true,
            "verify_pass": false
          }
          // ……既有字段（deployment_required / smoke_required 等）原样保留
        }
        // 注意：本例 slices_approved=false（slice-exit 门未消费）→ loop_state 缺席（省略字段，非 null）
      }
    ]
  }
}
```

**next（implement 已激活 → `loop_state` 在场 + `next_node.dispatch`）**：

```jsonc
$ openlogos next --format json
{
  "command": "next",
  "version": "<cli-version>",
  "data": {
    "contract": { "version": "1.0.0" },
    "modules": [
      {
        "id": "core",
        "next_node": {
          "id": "code",
          "name": "代码实现",
          "subflow_id": "implement",
          "skill": "code-implementor",
          "working_agent": null,
          "review_agent": null,
          "pre_script": null,
          "post_script": null,
          "dispatch": {
            "idempotent": true,
            "timeout_seconds": 3600,
            "artifacts_hint": ["logos/resources/verify/test-results.jsonl"]
          }
        },
        "loop_state": {
          "subflow_id": "implement",
          "until": "code_slices_green",
          "max_iters": 30,
          "iteration": 1,
          "converged": false,
          "escalated": false,
          "activated_at": "2026-07-17T08:00:00Z"
        }
      }
    ]
  }
}
```

体验口径：

- `contract` 恒在 `data` 顶层：`{"version": "1.0.0"}`（语义化契约版本，独立于 CLI 版本）。消费方约定（规范性引用，验收归 runlogos R5）：未知 major / 缺 `contract` 字段 → 保守模式（仅 next 驱动普通推进 + 看门狗，启发式判定降级为仅观察）；契约内任何枚举遇未知值 → 保守分支。
- `step_meta` 随 `active_change` 输出：`phase ∈ pre-implement|implement|post-implement`、`kind ∈ produce|gate|command-required|residency`；消费方遇未知值必须走保守分支，不得判死。
- `facts` 全布尔、仅活跃提案时输出；driver 直接读 facts 判断「implement 是否已进入」，不再自读 marker / 私有解析 tasks.md。
- **`loop_state` 缺席态**：挂出 **iff** `code_required ∧ spec_complete ∧ slices_planned ∧ slices_approved`（与 facts 同一份计算）；否则省略字段。`ready-to-implement`（切片已规划、待 slice-exit 批准）**不挂**；docs-only（code_required=false）**永不挂**。缺席 = implement 未进入 → 消费方走普通推进，不得进入 loop 分支。`slice_state` 常驻口径不变。
- `loop_state.activated_at`（ISO 8601）读自结构化 SLICES_APPROVED；旧空 marker → 省略该字段。
- `next_node.dispatch` 恒为完整对象；overlay-add 未声明 → 保守默认 `{idempotent:false, timeout_seconds: defaults.dispatch.timeout_seconds, artifacts_hint: []}`；`artifacts_hint: []` ＝「产物未知」契约语义：消费方不得据此判死，只能升级观察。示例中的 dispatch 取值以内置 flow 模板逐节点声明为准。
- 文本模式不新增展示要求（契约自描述面向机器消费）；既有文本输出不变。

### 2.25 change-lint（S35 计划产物左移硬检查）

命令发现：`openlogos --help` 的命令列表新增一行，`--format json` 支持列表收录 `change-lint`：

```
  change-lint [--slug <slug>]   检查活跃提案的计划产物（proposal/tasks/deltas）是否交付合格（只读）
```

全过（exit 0）：

```
$ openlogos change-lint
change-lint: change-lint-shift-left
  ✓ L1 tasks.md 结构可解析
  ✓ L2 [code] 标题在场（空段占位合法）
  ✓ L3 测试证据在场（已规划测试规格 delta）
  ✓ L4 delta 段标记与脱模板（3 个 .md delta）
  ✓ L5 部署决策一致（需要部署 × [deploy] 在场）
  ✓ L6 delta 路径合法（3 mergeable / 0 invalid）
  ✓ L7 UI 声明结构合法（ui_impact:false，不进入逐页对账）
PASS（7/7）
```

检查红（exit 2，每个 ✗ 给「缺什么 / 在哪补 / 补成什么样」）：

```
$ openlogos change-lint
change-lint: change-lint-shift-left
  ✓ L1 tasks.md 结构可解析
  ✗ L3 [code_change_requires_real_test_ids] 需代码的提案无测试证据
      缺什么：tasks/proposal/deltas/test 均无可采信的 UT/ST/SMOKE ID，也无测试规格 delta 规划
      在哪补：tasks.md 的 [delta] section，或 proposal.md 的「复用测试 ID」小节
      补成什么样：- [ ] 产出 delta 到 `deltas/test/` — 新增 XX 用例；或列出已存在 ID 如 `UT-S09-02`
  ✗ L5 [deployment_decision_conflict] proposal 声明需要部署，tasks.md 无 [deploy] section
      ……
FAIL（5/7，2 项违规）
```

操作错误（exit 1，stderr）：

```
$ openlogos change-lint --slug not-exists
Error [slug_not_found]: 提案 logos/changes/not-exists 不存在
$ openlogos change-lint --slug ../../etc
Error [slug_invalid]: slug 含非法路径字符（合法：[a-z0-9][a-z0-9-]*）
$ openlogos change-lint          # 无 guard 活跃提案时
Error [no_active_proposal]: 无活跃提案且未指定 --slug
$ openlogos change-lint --slug orphan-change   # proposal.md 无 module 头且 guard 不指向它
Error [module_unresolved]: 无法解析提案所属模块（proposal.md 缺 "> module:" 头且 guard 不指向该提案）
```

操作错误的终止红线：允许该错误**判定所必需的最小读取**（如 `module_unresolved` 需先读 guard 与 proposal.md 头）；**错误一旦确定即终止**——不再读取其它产物、不执行任何检查项、无第二份输出。产物读取失败（proposal/tasks/delta 任一不可读）统一报 `Error [artifact_unreadable]: <文件路径> …`。

`--format json` 走通用信封（详见 `spec/cli-json-output.md` §3.15）：检查完成（无论 pass true/false）stdout 输出 success envelope，`pass:false` 时 exit 2；操作错误 stderr 输出 error envelope，exit 1。三种退出码语义（0 交付合格 / 2 可原地修复的检查红 / 1 命令未完成检查）供 driver 与技能侧稳定分流。
