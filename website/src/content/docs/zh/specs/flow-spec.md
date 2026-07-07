---
title: Flow 规范
description: 可编排研发流程的数据模型——子流程、节点、门禁、循环、fan-out、when 谓词、overlay，以及内置 initial/launched 模板。
---

Flow 规范定义了 OpenLogos「可编排研发流程」的**数据模型**：一份 flow 文件如何描述研发流程的节点、子流程、门禁、循环与完成判定。

**与 [Workflow](/zh/specs/workflow) 规范的分工：**

- **Workflow** = *概念 / 方法论* 层：Why → What → How、场景即追溯链。回答「为什么这么编排」。
- **Flow**（本规范）= *数据模型* 层：字段契约与枚举。回答「怎么写一份 flow 文件」。

flow 文件是 Workflow 方法论的机器可读表达；二者从不冲突。

## 定位：被动派生（A 架构）

flow 引擎是**被动**的。OpenLogos 读 flow 文件 + 扫文件系统，**派生**出「当前在哪、下一步该跑什么」。它**不**主动 spawn agent、不跑脚本、不守进程——真正的执行交给宿主（Claude Code / 人 / CI）。OpenLogos 是「乐谱与指挥」，不是「乐手的手」。

底层是**统一的 loop 模型**：线性节点只是收敛条件为「产出存在」的退化环（`max_iters: 1`）。

## 文件位置

| 角色 | 路径 | 说明 |
|------|------|------|
| 内置模板源头 | `spec/flow/initial.yaml`、`spec/flow/launched.yaml` | 产品唯一源头；随 CLI 分发 |
| 项目实例 | `logos/flow/*.yaml` | 项目内经 overlay 物化的实例；文件名即 flow 身份 |

一个 flow 一个文件。文件名（去扩展名）即 flow id（`initial` / `launched` / 自定义）。项目实例可用 `extends:` 引用内置模板、只写差异（见[模板继承](#模板继承overlay--extends)）。

## 顶层结构

```yaml
version: 1                      # flow 文件 schema 版本（整数）
flow: initial                   # flow id（与文件名一致）
extends: builtin:initial@v1     # 可选；overlay 基线 + 版本
subflows:                       # 有序子流程列表（流程主体）
  - id: why
    name: WHY 需求
    nodes: [ ... ]              # 有序节点列表
    loop: { ... }              # 可选
    gate: { ... }              # 可选
```

流程主体是**有序的 subflow 列表**；每个 subflow 含**有序的 node 列表**。node id 在整份 flow 内**全局唯一**（overlay 按 id 寻址）。

## node 字段

```yaml
- id: scenario-modeling         # 必填，flow 内唯一
  name: 场景时序                # 必填，展示名
  skill: scenario-architect     # 可选，绑定的 Skill
  working_agent: null           # 可选，干活 agent 的不透明标签
  review_agent: null            # 可选，评审 agent 的不透明标签
  when: null                    # 可选，谓词；为假则跳过该节点
  for_each: scenarios           # 可选，fan-out 维度
  produces: <path or pattern>   # 产出位置；fan-out 时含变量
  coverage_threshold: null      # 可选；fan-out 聚合阈值 0 < x <= 1
  done_when: dir_nonempty        # 完成判定谓词
  fail_when: null               # 可选，失败/阻塞谓词 → failed
  pre_script: null              # 可选，前置脚本插件
  post_script: null             # 可选，后置脚本插件
```

- `working_agent` / `review_agent` 是**不透明标签**：OpenLogos 从不校验或调度它们；如何映射到真实 agent 由宿主引擎适配。
- `skill` 是该节点推荐的 Skill；`next` 会把它作为给宿主指令的一部分输出。
- `coverage_threshold` **仅 `done_when: all_present` 的 fan-out 节点合法**；不写等价全覆盖，未设置时必须省略整键（绝不物化为 `null`）。

## 子流程与门禁（gate）

```yaml
- id: deliver
  name: 交付
  nodes: [ {id: deploy, ...}, {id: smoke, ...} ]
  gate:
    type: human                 # none | human | cmd（预留）
    position: entry             # entry | exit（默认 exit）
    skippable: false            # auto 模式下是否允许跳过该人类门
```

subflow 也可带 `when`：为假则**整个 subflow 跳过**（所有节点视为 skipped）。例如 launched 的 `merge` 子流程用 `when: delta_required`，纯代码提案（无 `[delta]`）时整段跳过，而非死等 `SPEC_MERGED`。

**`gate.position`** 决定门禁触发时机：

- `exit`（默认）——subflow 内所有节点完成后、进入下一 subflow 前触发。
- `entry`——进入该 subflow 第一个节点之前触发。用于高危前置确认（如部署**前**确认，而非等 deploy+smoke 都跑完）。

**`gate.type`：**

- `none`——无门禁，直接流转。
- `human`——人类确认点；`next` 输出「需人类确认」，不自动推进。
- `cmd`——*预留*；以命令退出码为门禁。

### 可跳门与 auto 模式

`gate.skippable: true|false` 声明该 human gate **是否允许被自动跳过**。是否进入 **auto 模式**（如 `openlogos next --auto`）由宿主决定：

- auto 模式下，`skippable: true` 的 gate 视为已通过、直接放行。
- `skippable: false` 的 gate **即使 auto 也照样卡住**——守住高危动作（如生产部署）。
- 每次自动跳过都**留痕**：向活跃提案目录追加一行 append-only 的 `GATE_AUTO_PASSED` 审计记录（含 gate id + 时间）。

**`--auto` = standing、run-scoped 授权**：选择它即一次性授权整个提案链自动跑到底。除放行 `skippable: true` 的 flow 门外，`--auto` 还以 standing 授权自动执行「代码已绿之后」的 CLI 盖章/发布步骤——`verify` / `smoke` / `archive` / `git push`。

**硬红线（任何模式含 `--auto` 都绝不放行）**：未收敛代码退出门 `gate:<subflow>:loop-exhausted`——达迭代上限仍未过测试的代码。auto 模式在此与手动模式一样阻塞：**绝不发布未验证的代码**。

## loop（子流程循环）

```yaml
loop:
  until: code_slices_green      # tests_green | code_slices_green
  max_iters: 30                 # builtin launched 默认 30；其它仍 1
```

- **线性节点 = 退化环**：无 `loop` 或 `max_iters: 1`；收敛条件为「产出存在」。
- **`until` 枚举：**
  - `tests_green`——末轮测试绿即收敛（账本末行 `result == "pass"`）。
  - `code_slices_green`——`section_complete:code ∧ tests_green`：`tasks.md` 的 `[code]` 切片全部勾选 **且** 末轮测试绿。空 `[code]`（纯 docs/delta 提案）退化为 `tests_green`。
- **`max_iters > 1` = 真迭代**——actor-critic 循环：working_agent 改 → 测试当奖励信号 → 未达成再来一轮，至 `max_iters` 后升级到 gate。
- 收敛押**客观数字信号**（测试绿 / 切片全勾 ∧ 测试绿），绝不以 review_agent 的主观判定作裁判。
- 计数来源 = `openlogos verify` 追加的 `LOOP_ITERS` 账本；机器字段 `loop_state` / `slice_state` 见 [CLI JSON 输出](/zh/specs/cli-json-output)。

**达上限 = loop-exhausted 人类门。** `iteration >= max_iters && !converged` 时派生为该 subflow 的退出门 `gate:<subflow>:loop-exhausted`。其 `skippable` 默认 `false`；仅可经 overlay `set-loop` 的 `exhausted_gate.skippable` 单点 opt-in 为 `true`（高危、默认关闭）。

## fan-out（`for_each` + `produces` 插值）

```yaml
- id: test-cases
  skill: test-writer
  for_each: scenarios           # scenarios | modules | <命名列表>
  produces: "logos/resources/test/{module}-{scenario}-test-cases.md"
  done_when: all_present        # 每个实例都有产出才算 done
```

- `for_each` 集合在**求值时动态解析**（如 `scenarios` 随 `scenario_counter` 增长），不快照。作用域 = **当前模块**。
- `{module}` / `{scenario}` 变量按实例插值；匹配用**精确 glob**（不用脆弱的子串包含）。
- `done_when: all_present` 为 status/watch 派生覆盖度对象 `{ total, covered, missing }`。
- 可选 `coverage_threshold`（float，`0 < x <= 1`）把「done」放宽为 `covered / total >= 阈值`。不写 = `all_present`（100%）。**仅**完整 fan-out 节点（`all_present` + `for_each` + 非空 `produces`）合法，否则 `FLOW_SCHEMA_INVALID`。

## `when`（条件节点）

`when` 对已知上下文标志求值，为假则该节点不参与流程（今天 `skip_phases` 的声明式后继）。

| 标志 | 含义 | 推导 |
|------|------|------|
| `bootstrap` | 模块 bootstrap 模式 | `module.bootstrap`；`adopted` 跳过 prd/product-design/architecture |
| `api_enabled` | 是否有 API | `not skip_phases.includes('api')` |
| `db_enabled` | 是否有数据库 | `not skip_phases.includes('database')` |
| `scenario_enabled` | 是否做编排测试 | `not skip_phases.includes('scenario')` |
| `deployment_required` | 是否需要部署 | 来源随 flow 不同（见下） |
| `smoke_required` | 是否需要 smoke | 来源随 flow 不同（见下） |
| `delta_required` | 提案是否含规格变更 | `tasks.md` 存在 `[delta]` section |
| `code_required` | 提案是否将产出代码 | `tasks.md` 存在非空 `[code]` section |

**`deployment_required` / `smoke_required` 来源随 flow 不同：**

- **initial**——取**模块级**默认（`module.deployment_required` 除非被 skip；`module.smoke_required` 未声明视为 true，仅显式 false 才关闭）。
- **launched**——必须取**提案级**决策（`resolveProposalDeploymentDecision()`，依据 proposal.md 部署影响 + `[deploy]` section）。**不得**回退模块默认，否则声明「无需部署」的提案会错误进入 deploy。

表达式：`flag` / `not flag` / `flag != value`。

## `done_when` 谓词词表

| 谓词 | 含义 |
|------|------|
| `dir_nonempty` | 目标目录非空（多模块时按 `{module}-` 前缀过滤） |
| `file:<path>` | 指定文件存在 |
| `marker:<NAME>` | 提案目录下存在 marker 文件（如 `VERIFY_PASS`） |
| `any_present:[A,B,...]` | 列出的任一 marker/文件存在即满足（兼容旧 marker） |
| `all_present` | fan-out：每个实例的 `produces` 都就绪；可配 `coverage_threshold` 放宽 |
| `proposal_package_filled` | proposal.md 与 tasks.md 均脱模板填写完整 |
| `section_complete:<tag>` | tasks.md 指定 section（如 `delta`/`code`）全部勾选或不存在 |
| `tasks_delta_filled` | `tasks.md` `[delta]`/`[deploy]` 脱模板（`write-tasks` 用） |
| `tasks_code_filled` | `tasks.md` `[code]` 脱模板——切片已写出、此时全部未勾（`plan-slices` 用） |
| `archived` | 提案已归档 |
| `cmd:<command>` | 命令退出码为 0（overlay-add 节点 + launched 的 verify/deploy/smoke gate） |

**`fail_when`** 与 `done_when` 同词表，但命中表示节点 **failed**（非完成）。`fail_when` 优先于 `done_when`——两者同时命中判 failed。failed 节点不向后流转，`next` 输出「修复后重试」。

## 模板继承（overlay / extends）

项目实例用 `extends` 引用内置模板、只写差异——走 **overlay** 而非整份拷贝，让方法论可中心化演进。

```yaml
version: 1
flow: initial
extends: builtin:initial@v1      # 基线 + 内容版本（@vN 用于升级冲突检测）
overlay:
  - op: skip                     # 跳过节点（等价 when:false）
    target: orchestration-test
  - op: modify                   # 深合并给出的字段（禁止覆盖 id）
    target: code
    set: { review_agent: my-code-reviewer }
  - op: add                      # 新增节点
    after: code                  # after | before，相对某 node id
    node: { id: lint, name: 静态检查, skill: linter, done_when: "file:logos/resources/verify/LINT_PASS" }
  - op: reorder                  # 调整顺序
    target: smoke
    after: deploy
  - op: set-loop                 # 覆盖某 subflow 的 loop
    subflow: implement
    set: { max_iters: 3 }        # set 仅允许 max_iters / until / exhausted_gate
```

- 操作集收窄为五种：`skip` / `add` / `modify` / `reorder`（节点级）+ `set-loop`（subflow 级 loop）。
- 按 **node id** 寻址（strategic-merge）。`op:modify` 禁止覆盖 `id`。
- 内置模板带内容版本（`builtin:initial@v1`）；overlay 的 `@vN` 与 loader 内部版本映射不匹配时报 `FLOW_VERSION_MISMATCH`。
- `openlogos flow show --resolved` 输出「基线 + overlay 合并后」的生效流程，便于调试。
- `op:add` 节点须带**可求值**的完成判定；因 initial 无提案目录，initial 的 overlay-add 节点必须用 `file:` / `dir_nonempty`，不得用 `marker:` / `section_complete:*`。

## 两套内置模板

### `initial`——首轮开发瀑布

忠实 1:1 复刻 13 段 phase 瀑布（WHY → WHAT → HOW → 实现 → 交付），行为不变：

- **why** → `prd`（Gate 1，可跳）
- **what** → `product-design`（Gate 2，可跳）
- **how-design** → `architecture`、`scenario-modeling`（fan-out）、`api-design`、`db-design`、`deployment-design`、`test-cases`（fan-out）、`orchestration-test`
- **implement** → `code`、`verify`（loop 预留，`max_iters: 1`）
- **deliver** → `deploy`、`smoke`（entry 人类门，`skippable: false`）

### `launched`——变更生命周期流程（7 子流程）

变更流程经重构：旧的单段 `propose` 拆成 **plan → spec → merge → slice → implement → deliver → close**。

| 子流程 | 节点 | 门禁 | 说明 |
|--------|------|------|------|
| **plan** | `write-proposal`、`write-tasks` | human，可跳（`plan-exit`） | 批准方案；`write-tasks` 仅产 `[delta]`/`[deploy]` |
| **spec** | `write-delta` | human，可跳（`spec-exit`） | `when: delta_required`；审 delta + 授权合并 |
| **merge** | `generate-merge-prompt`、`apply-merge` | none | 有 delta 提案生成/执行 merge prompt；纯代码提案通过 no-delta `openlogos merge` 写入 `SPEC_MERGED` |
| **slice** | `plan-slices`（skill: slice-planner） | human，可跳（`slice-exit`） | `when: code_required`；merge 后划分 `[code]` 切片 |
| **implement** | `code`、`verify` | none | 默认激活切片循环（`until: code_slices_green, max_iters: 30`） |
| **deliver** | `deploy`、`smoke` | human，entry，**可跳**（`deliver-entry`） | 提案级部署决策 |
| **close** | `archive` | none | — |

重构要点：

- `[code]` 切片划分从 plan 段**剥离**到独立的 `slice` 子流程，在 merge **之后**运行——对**已合并规格 + 真实测试 ID**切，而非对草案猜。
- 纯代码提案虽然没有文档 delta，仍必须有可追踪的 spec-complete 状态。进入 `plan-slices` 前必须存在 `SPEC_MERGED`（或 `MERGED`）；缺失时 `status`/`next` 返回 `spec-complete-required`，不得派 `plan-slices`。
- spec-complete 后，代码提案若缺真实 `UT-*` / `ST-*` / `SMOKE-*` ID，返回 `test-id-required`。`plan-slices` 禁止基于占位或缺失测试 ID 切片。
- `implement` 子流程**默认激活切片循环**（故 launched 下 `loop_state` / `slice_state` 常驻）。
- `deliver` 入口门 `skippable: true`：无人值守 `--auto` 可放行（部署目标可能是测试环境）；手动模式仍停下等确认。

## 派生语义（被动 A）

| 命令 | 语义 |
|------|------|
| `openlogos status` | 基于 **resolved** flow 派生每个 node 的 `done`/`active`/`skipped`/`failed`/`pending`；fan-out 输出覆盖度。`cmd:` 节点**不执行** → `pending` |
| `openlogos next` | 输出当前 active 节点 + skill + 现成提示词；human gate 输出「需人类确认」。每次至多求值 **1** 个 `cmd:`（budget=1） |
| `openlogos next --auto` | **以 resolved 当前 node/gate 位置为准**自动放行 gate；仅当流程真正到达该 gate 边界才放行 `skippable:true` 门并写 `GATE_AUTO_PASSED` |
| `openlogos watch` | 流式输出派生状态（status 实时版）；`cmd:` 节点不执行 → `pending` |
| `openlogos flow show [--resolved]` | 展示 flow；`--resolved` 输出 overlay 合并后的生效流程 |

核心算法：按 subflow → node 顺序遍历；`when` 为假 → skipped；节点按 `done_when` 判 `done`（fan-out 走 `all_present` + 覆盖度）；当前节点 = 第一个未 done 且未 skipped 的节点（`fail_when` 命中则 failed）；gate 按 `position` 触发。loop 的 `converged` 覆盖其内节点各自的 `done_when`——未收敛的 loop **不得推进**到后续 subflow，即便 `verify` 的 `done_when`（如 initial 的 acceptance-report 文件，PASS/FAIL 都写）已满足。

上述派生的机器契约——`loop_state`、`slice_state`、`plan_state`、`next_node`、`overlay_nodes`、`current_node`、`cmd_gate`、`GATE_AUTO_PASSED`——见 [CLI JSON 输出](/zh/specs/cli-json-output)。
