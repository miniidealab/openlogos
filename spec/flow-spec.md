# flow 可编排研发流程规范（flow-spec）

> 版本：0.1.0（M1 草案）
>
> 本规范定义 OpenLogos「可编排研发流程」的**数据模型**：一份 flow 文件如何描述研发流程的
> 节点（node）、子流程（subflow）、门禁（gate）、循环（loop）与完成判定（done_when）。
>
> **与 `spec/workflow.md` 的分工**：
> - `spec/workflow.md` = **概念/方法论层**：Why→What→How、场景贯穿即追溯链。回答"为什么这么编排"。
> - `spec/flow-spec.md`（本规范）= **数据模型层**：字段契约与枚举。回答"怎么写一份 flow 文件"。
> 本规范是 `workflow.md` 方法论的**可编排落地**；二者不冲突，flow 文件是方法论的机器可读表达。

---

## 1. 定位与边界

- **引擎是被动派生（A 架构）**：OpenLogos 读 flow 文件 + 扫文件系统，**派生**出"当前在哪、
  下一步该跑什么"，并不主动 spawn agent、不跑脚本、不守进程。真正的执行交给宿主
  （Claude Code / 人 / CI）。OpenLogos 是"乐谱与指挥"，不是"乐手的手"。
- **统一 loop 模型，分两步实现**：线性节点 = `max_iters: 1`、收敛条件为"产出存在"的退化环。
  本规范一次性定义完整语法（含 subflow / loop / cmd 谓词），但 **M1 只实现线性 + 退化环**；
  标注 `【M2 预留】` 的字段 M1 解析但不驱动迭代。
- **本规范不描述执行引擎实现**，只描述 flow 文件契约与派生语义。

## 2. 文件位置

| 角色 | 路径 | 说明 |
|---|---|---|
| 内置模板源头 | `spec/flow/initial.yaml`、`spec/flow/launched.yaml` | 产品唯一源头；随 CLI 分发 |
| 项目实例 | `logos/flow/*.yaml` | 用户项目内经 overlay 物化的实例；文件名即 flow 身份 |

- 一个 flow 一个文件，文件名（去扩展名）即 flow id（`initial` / `launched` / 自定义）。
- 项目实例可用 `extends:` 引用内置模板，只写差异（见 §9 模板继承）。

## 3. 顶层结构

```yaml
version: 1                      # flow 文件 schema 版本（整数，独立于本规范文档版本号 0.1.0）
flow: initial                   # flow id（与文件名一致）
extends: builtin:initial@v1     # 可选；overlay 基线 + 基线版本（见 §9）。无 extends = 自包含完整定义
defaults:                       # 可选【contract-self-description】，flow 级派发默认值
  dispatch:
    timeout_seconds: 900        # 节点 dispatch.timeout_seconds 的唯一默认值源（fallback）（见「派发元数据 dispatch 与 requires_reviewed（contract-self-description）」章节）
subflows:                       # 有序子流程列表（流程主体）
  - id: why
    name: WHY 需求
    nodes: [ ... ]              # 见 §4
    loop: { ... }               # 可选，见 §6
    gate: { ... }               # 可选，见 §5
```

> 版本号有两个、互不相关：文件里的 `version`（flow 文件 schema 的版本，整数）；本规范文档头部的
> `0.1.0`（flow-spec 规范自身的版本）。`extends: builtin:initial@v1` 中的 `@v1` 是**内置模板内容版本**，
> 用于 overlay 升级冲突检测（见 §9），与前两者均无关。

- 流程主体由**有序的 subflow 列表**构成；每个 subflow 含**有序的 node 列表**。
- "连续几个节点圈成一个 subflow" = 把它们放进同一个 subflow 的 `nodes`。
- node id 在整份 flow 内**全局唯一**（overlay 按 id 寻址，见 §9）。
- `defaults.dispatch.timeout_seconds`【contract-self-description】：节点 `dispatch.timeout_seconds` 的**唯一默认值源（fallback）**——
  节点未显式声明 `timeout_seconds` 时一律取此值；**节点显式声明的特例值优先于 defaults**（内置模板只在特例节点
  显式声明——code/implement 类 3600、deploy 类 1800，其余节点一律省略、由 defaults(900) 物化）；项目 overlay
  覆盖 defaults 只影响未显式声明的节点（优先级与 overlay 合并规则见 §10.5）；
  **resolved 时物化进每个节点，输出层不再有第二处默认**。本字段为可选的**向后兼容扩展**：
  flow 文件 schema **`version: 1` 保持不变**，旧 flow 文件（无 `defaults`）解析行为不变。

## 4. node 字段

```yaml
- id: scenario-modeling         # 必填，flow 内唯一
  name: 场景时序                # 必填，展示名
  skill: scenario-architect     # 可选，绑定的 skill（驱动该节点的 Skill 文件）
  working_agent: null           # 可选，干活 agent 的不透明标签；OpenLogos 不解释、引擎适配
  review_agent: null            # 可选，评审 agent 的不透明标签；同上
  when: null                    # 可选，条件（见 §8）；不满足则该节点跳过
  for_each: scenarios           # 可选，fan-out 维度（见 §7）
  produces: <path or pattern>   # 产出位置；fan-out 时含变量（见 §7）
  coverage_threshold: null      # 可选【S29】，仅 fan-out(`done_when: all_present`) 节点；聚合阈值 0<x<=1（见 §7）。缺省=全覆盖；未设置/写 null → 派生时省略整键（不输出 null，见 §7）
  done_when: dir_nonempty       # 完成判定谓词（见 §9）
  fail_when: null               # 可选，失败/阻塞判定谓词；命中则该节点状态为 failed（见 §9）
  pre_script: null              # 可选，前置脚本插件（见 §11）
  post_script: null             # 可选，后置脚本插件（见 §11）
  dispatch:                     # 可选【contract-self-description】，派发元数据（详见「派发元数据 dispatch 与 requires_reviewed（contract-self-description）」章节）
    idempotent: true            #   该节点重派发是否安全（人工声明，不从其它字段推导）
    timeout_seconds: 900        #   派发看门狗超时建议（秒）；未声明取 defaults.dispatch.timeout_seconds（§3）
    artifacts_hint: []          #   产物提示（string[]）；[] = 「产物未知」契约语义（非缺省缺失）
  requires_reviewed: null       # 可选【contract-self-description】，执行前置评审对象列表（如 ["proposal","delta"]）
```

- `working_agent` / `review_agent` 是**不透明标签**：OpenLogos 不校验、不调度其行为；
  如何映射到真实 agent 由执行引擎自行适配。内置模板中默认留空。
- `skill` 为该节点推荐使用的 Skill；`next` 会把它作为给宿主的指令的一部分输出。
- `coverage_threshold`【S29】：**仅 `done_when: all_present` 的 fan-out 节点合法**，缺省（不写/写 `null`）= 等价全覆盖。**未显式设置有效 number 时派生/输出必须省略整键、绝不物化为 `coverage_threshold: null`**（写 `null` 也 normalize 为 absent），以保 `flow show` golden 零漂移。语义与校验（含「设在非 `all_present` 或非 fan-out 节点 → `FLOW_SCHEMA_INVALID`」）见 §7。内置模板均不写。
- `dispatch`【contract-self-description】：节点派发元数据，**权威数据源 = flow 节点定义**（内置模板
  `spec/flow/initial.yaml` / `spec/flow/launched.yaml` 逐节点**人工声明**，**不从 `produces`/`done_when` 推导**）；
  resolved flow 派生把它物化为**完整对象**并经 `next_node.dispatch` 透传给宿主（JSON 契约见
  `spec/cli-json-output.md`）。overlay-add 节点未声明时的完整保守默认、`defaults.dispatch.timeout_seconds`
  唯一默认值源（fallback）与 `artifacts_hint: []` 语义，见「派发元数据 dispatch 与 requires_reviewed（contract-self-description）」章节。
- `requires_reviewed`【contract-self-description】：声明该节点执行前必须已完成评审的对象列表
  （不透明字符串标签，如 `"proposal"` / `"delta"`；内置 launched 的 `apply-merge` 声明 `["proposal","delta"]`）。
  OpenLogos 不执行评审调度，仅经 `next_node` 透传；未声明的节点不输出该字段。
- `dispatch` / `requires_reviewed` 均为可选的**向后兼容扩展**：flow 文件 schema **`version: 1` 不变**，
  旧 flow 文件解析行为不变。

## 5. subflow 与 gate

```yaml
- id: deliver
  name: 交付
  nodes: [ {id: deploy, ...}, {id: smoke, ...} ]
  gate:
    type: human                 # none | human |【M2 预留】cmd
    position: entry             # entry | exit（默认 exit）
    skippable: false            # 该人类确认点是否允许在 auto 模式下被自动跳过
```

- **subflow 也可带 `when`**（可选）：条件不满足则**整个 subflow 跳过**（其所有节点视为 skipped）。
  语义与 node 的 `when`（§8）一致。例：launched 的 merge subflow 用 `when: delta_required`，
  纯代码提案（无 `[delta]`）时整段跳过，避免死等 `SPEC_MERGED`。
- `gate.position`（决定门禁触发时机，默认 `exit`）：
  - `exit`（默认）：subflow 内所有节点完成后、进入下一 subflow 前触发。
    例：Gate 1/2 在 prd / 产品设计**之后**确认。
  - `entry`：进入该 subflow 第一个节点**之前**触发。
    例：部署前人类确认——deploy 在 `deliver` 入口被卡住，而非等 deploy+smoke 都跑完才确认。
  - 说明：单一"出口 gate"无法表达"在某节点前确认"，故引入 `position`；高危前置确认用 `entry`。
- `gate.type`：
  - `none`：无门禁，直接流转。
  - `human`：人类确认点。`next` 在此输出"需人类确认"，不自动推进。
  - `cmd`【M2 预留】：以命令退出码为门禁（如 `gh pr checks`）。M1 不实现。

### 5.1 skip-human-gate（全自动化）

- `gate.skippable: true|false` 声明该 human gate **是否允许被自动跳过**。
- 运行时由宿主决定是否进入 **auto 模式**（如 `openlogos next --auto`）：
  - auto 模式下，`skippable: true` 的 gate 被 `next` 视为已通过、直接放行。
  - `skippable: false` 的 gate **即使 auto 也照样卡住**（守住高危动作，如生产部署）。
- 被自动跳过**必须留痕**：写 `GATE_AUTO_PASSED`（含 gate id、时间）审计记录。
- 仍符合 A 架构：OpenLogos 只派生"此 gate 可跳 + 当前 auto → 视为通过"；是否 auto 由宿主决定。
- **全自动 = standing run-scoped 授权（auto-full-unattended 起）**：`openlogos next --auto` 即**全自动 / 无人值守**模式，含义重定义为「standing run-scoped 授权」——用户选 `--auto` 即**一次性授权该提案全链路自动跑到底**。无 `--auto`（半自动 / 手动）时所有人类确认点行为**完全不变**。`--auto` 除按上文自动放行 `skippable:true` 的 flow 门外，还以 **standing 授权自动执行「代码已绿之后」由 CLI 驱动的盖章/发布步骤**——`verify` / `smoke` / `archive` / `git push` 这 4 样红线。
- **放行对象是 CLI 步骤而非 flow 门**：上述 standing 授权放行的是 CLI 驱动的盖章/发布动作，不改任何 flow 门的 `skippable` 值。其中 `git push` **无需任何 marker 或 guard 改动**——PreToolUse guard 的安全白名单本就放行 `git push`、从不拦截（见 `spec/pretooluse-guard.md`），全自动下由生成的指令文本授权 AI 自动 push、半自动维持人工确认。每次自动放行仍向活跃提案目录的 `GATE_AUTO_PASSED` 追加审计行（append-only，是审计、非状态源）。R2 安全闸（仍卡在未完成 overlay 节点则不放行）保持不变。
- **全自动 4 样红线放行不含 `loop-exhausted`**：达迭代上限仍未过测试的未收敛代码退出门（`gate:<subflow>:loop-exhausted`，默认 `skippable:false`）保留为**硬红线**，是「全自动发布的是已验证成果」这一前提的守门人——**任何模式（含 `--auto`）都绝不自动放行**。它的现有逻辑（默认 `skippable:false`、即使 `--auto` 也阻塞、仅 overlay `set-loop` 的 `set.exhausted_gate.skippable:true` 可单点 opt-in 放行）**一字不改、完整保留**，详见 §6 第 133 行、§10.4、§12.2。

## 6. loop（subflow 循环）【整体含 M2 预留】

```yaml
loop:
  until: code_slices_green      # 收敛谓词：tests_green | code_slices_green（见下）
  max_iters: 30                 # builtin launched 默认 30（切片循环）；其它 builtin/initial 仍 1
```

- **线性节点 = 退化环**：未声明 `loop` 或 `max_iters: 1` 即线性，收敛条件为"产出存在"。
- **`until` 枚举（change-flow-redesign 起）**：
  - `tests_green`：收敛 = 末轮测试绿（账本末行 `result == "pass"`）。
  - `code_slices_green`：收敛 = `section_complete:code ∧ tests_green`——即 `tasks.md` 的 `[code]` 切片**全部勾选** 且 末轮测试绿。它**重新主张被 loop 覆盖掉的 `code` 节点 `done_when`**（见 §12.2 R2），用于"逐片实现、全部切片完成且测试绿才出环"的代码切片循环。**空 `[code]`**（无切片、纯 docs/delta 提案）下 `code_slices_green` 退化为 `tests_green`，避免常驻激活把小提案卡死。派生细节见 §12.4。
- **`max_iters > 1` 真迭代**：把 subflow 变成"迭代到测试绿/全部切片绿"的收敛循环（actor-critic：working_agent 改 → 测试当奖励信号 → 未达成再来一轮，至 `max_iters` 后升级到 gate）。
  - **激活来源**：① overlay `set-loop`（见 §10.4）把目标 subflow `max_iters` 设 >1；② **change-flow-redesign 起，builtin `launched.yaml` 的 `implement` 默认 `max_iters:30` + `until:code_slices_green`，即默认带切片循环定义**。**contract-self-description 起，loop「定义在场」≠ `loop_state` 挂出**：`loop_state` **仅当 implement 子流程已真实进入**——确定性事实合取 `code_required ∧ spec_complete ∧ slices_planned ∧ slices_approved` 成立——时输出，四条缺一即省略字段（判据与主动破例声明见 §12.2）；**`slice_state` 常驻口径不变**（两者激活判据分别写明，`slice_state` 是切片规划进度的展示面、不触发 driver loop 分支）。**其它 builtin（`initial.yaml` 的 implement、以及 launched 其它 subflow）仍 `max_iters:1`**。**例外**：initial 多模块即便 `max_iters>1` 也**不激活**（见 §12.2）。
  - 派生量：`iteration` = 该 loop 已完成的 verify 轮次；`converged` = 按 `until` 判定收敛；`escalated` = `iteration >= max_iters && !converged`。
- **收敛信号押客观数字信号（测试绿 / 切片全勾 ∧ 测试绿）**，不以 review_agent 主观判定作收敛裁判。
- 计数来源 = `openlogos verify` 追加的 `LOOP_ITERS` 账本（见 `spec/cli-json-output.md`）；机器字段 `loop_state` / `slice_state` 见同文档。
- **【S29·loop 内 fan-out = 整组收敛（语义定死）】**：loop（implement 子流程）内若含 fan-out 节点，**采用整组收敛**——loop 的收敛裁判仍是测试绿（含 `code_slices_green` 的 `tests_green` 部分），fan-out 节点按各自 `all_present` / `coverage_threshold`（见 §7）独立完成；**不引入 per-instance 迭代**（不为单实例各自计 `iteration`、不新增字段、不留悬空 schema）。
- **【S29·达上限退出 gate 的 `skippable` 可 overlay 覆盖】**：loop 达上限的退出 human gate（`gate:<subflow>:loop-exhausted`）的 `skippable` 默认 `false`，但可经 overlay `set-loop` 的 `set.exhausted_gate.skippable` 覆盖为 `true`（详见 §10.4 与 §12.2）；`true` 时 `next --auto` 可放行未收敛代码并写 `GATE_AUTO_PASSED`（高危 opt-in，默认关闭）。

## 7. fan-out（`for_each` + `produces` 插值）

```yaml
- id: test-cases
  skill: test-writer
  for_each: scenarios           # 集合：scenarios | modules | <命名列表>
  produces: "logos/resources/test/{module}-{scenario}-test-cases.md"
  done_when: all_present        # 每个实例都有对应产出才算 done
```

- `for_each` 的集合在**求值时动态解析**（如 `scenarios` 随 `scenario_counter` 增长，覆盖目标是移动靶），
  不快照。
- **作用域 = 当前模块**：`scenarios` 指**当前模块**的场景（等价 `module.scenarios`），
  多模块项目下**不要求**某模块覆盖其他模块的场景文件（与现状 `status.ts` 按 `${mod.id}-` 前缀计算一致）。
- `produces` 中 `{module}` / `{scenario}` 等变量按当前 fan-out 实例插值。
- 匹配用 **glob 精确匹配**（不用脆弱的子串包含）。
- `done_when: all_present`：聚合判定为"全部实例就绪"。派生时同时输出覆盖度
  `{ total, covered, missing }` 供 status/watch 使用。
- **【S29·聚合阈值 `coverage_threshold`】**：fan-out 节点可选字段 `coverage_threshold`（float，`0 < x <= 1`；非法值或类型 → `FLOW_SCHEMA_INVALID`）。
  语义：`covered / total >= coverage_threshold` 即判该 fan-out 节点 **done**。
  **缺省（不写）= 等价 `all_present`**，即阈值 `1.0`、要求 100% 覆盖；`total == 0` 维持 `all_present` 现状（视为未 done）。
  覆盖度对象 `{ total, covered, missing }` 不变；机器输出在**设置了 `coverage_threshold` 时**额外带该字段（仅 `flow show` 节点字段；`status`/`watch`/`next` 不新增字段，仅其 `done` 按阈值判定，见 `spec/cli-json-output.md`）。
- **`coverage_threshold` 仅对**完整 fan-out 节点（**`done_when: all_present` + `for_each` + 非空 `produces`**）**合法**：缺任一项（非 `all_present` / 无 `for_each` / `produces` 空或缺）→ **`FLOW_SCHEMA_INVALID`**（fail loud，不静默忽略、不告警）。**`produces` 必须非空**——否则派生会扫描空路径、误判覆盖率。
  **未显式设置有效 number 时派生输出必须省略整键、绝不物化为 `coverage_threshold: null`**（YAML 写 `null` 也 normalize 为 absent），以保 `flow show` golden 零漂移。
- fan-out 在 loop 内的收敛语义见 §6（**整组收敛**，已定死）。
- builtin 模板不写 `coverage_threshold` → 行为与 `all_present` 1:1 → golden 零漂移。

## 8. when（条件节点）

`when` 是一个对**已知上下文标志**求值的简单谓词，不满足则该节点不参与流程（等价今天的 `skip_phases`）。

支持的上下文标志（M1）及**布尔推导规则**（实现必须按此映射，不得臆测）：

| 标志 | 含义 | 推导规则（来自 module 定义 / skip_phases） |
|---|---|---|
| `bootstrap` | 模块 bootstrap 模式 | 取 `module.bootstrap` 值；`adopted` 时跳过 prd/product-design/architecture |
| `api_enabled` | 是否有 API | `= not skip_phases.includes('api')` |
| `db_enabled` | 是否有数据库 | `= not skip_phases.includes('database')` |
| `scenario_enabled` | 是否做编排测试 | `= not skip_phases.includes('scenario')`（控制 orchestration-test，与 api 无关） |
| `deployment_required` | 是否需要部署 | **来源随 flow 不同**，见下方说明 |
| `smoke_required` | 是否需要 smoke | **来源随 flow 不同**，见下方说明 |
| `delta_required` | 提案是否含规格变更 | `= tasks.md 存在 [delta] section`。无 `[delta]` 的纯代码提案为 false，表示不进入 `write-delta`，但不表示 spec-complete 已完成 |
| `code_required` | 提案是否将产出代码 | 由 `tasks.md` 的 `[code]` section、proposal / delta / 测试资源信号综合推导。`code_required==true` 时，slice 子流程只有在 spec-complete 与真实测试 ID 门禁通过后才能进入 |
| `spec_complete` | 活跃提案是否完成规格阶段 | 含 delta 提案以 `SPEC_MERGED` / `MERGED` 为真；无 delta 代码提案以 no-delta `SPEC_MERGED` 为真 |
| `test_ids_ready` | 代码提案是否具备真实测试 ID | 相关测试资源或显式复用声明中能解析到真实 `UT-*` / `ST-*` / `SMOKE-*` ID |
| `ui_impact` | 本次提案是否触及界面（GUI 模块的 UI/UX 变更） | **新增可派生 when-flag**（仿 `delta_required`），**module-aware**：`= (活跃提案所属 module 的 product_type ∈ GUI) && proposal.md「UI/UX 变更声明」段声明 ui_impact:true`。`product_type` **唯一源 = `logos-project.yaml` 的 `modules[].product_type`**（枚举 `web|desktop|mobile|cli|api|library|skills|service`，GUI 集合 = `{web,desktop,mobile}`，字段缺失 = 非 GUI）。**两者缺一即为 false**——活跃提案 module 非 GUI（`product_type ∈ {cli,api,library,skills,service}` 或缺失）恒 false，声明 `ui_impact:false` 亦为 false。派生源见下方「`ui_impact` 的派生规则」 |

`delta_required==false` 只跳过 `write-delta`，不得直接跳过 spec-complete。纯代码提案必须通过 no-delta merge 写入 `SPEC_MERGED`。

**`deployment_required` / `smoke_required` 的来源随 flow 不同（关键）**：
- **initial flow**：取**模块级**默认——
  `deployment_required = module.deployment_required !== false && not skip_phases.includes('deployment')`；
  `smoke_required = deployment_required && module.smoke_required !== false`
  （注意：`module.smoke_required` **未声明视为 true**，仅显式 `false` 才关闭，不得把未声明当 false）。
- **launched flow**：必须取**提案级**决策——由 `resolveProposalDeploymentDecision()` 依据 `proposal.md`
  的部署影响与 `tasks.md` 的 `[deploy]` section 解析；**不得**回退到模块默认。否则模块默认
  `deployment_required: true` 时，一个声明"无需部署"的提案仍会错误进入 deploy。

**`ui_impact` 的派生规则（新增，launched flow 专用，module-aware）**：
- **`product_type` 唯一源**：`logos-project.yaml` 的 `modules[].product_type`（枚举 `web|desktop|mobile|cli|api|library|skills|service`；
  GUI 集合 = `{web,desktop,mobile}`；字段缺失 = 非 GUI）。求值取**活跃提案所属 module** 的 `product_type`（module-aware，非项目全局单值）。
- **派生方式仿 `delta_required`**：从**活跃提案** `proposal.md` 的「UI/UX 变更声明」段推导，与该 module 的 `product_type` 联合判定。
  - 活跃提案 module `product_type ∈ GUI`（`web` / `desktop` / `mobile`）**且**声明段 `ui_impact: true` → `ui_impact = true`；
  - 活跃提案 module `product_type` 非 GUI（`cli` / `api` / `library` / `skills` / `service` 或缺失）→ 恒 `false`（整个 UI-first 特性不启用，overlay 节点被 `when` 跳过）；
  - 声明段缺失或 `ui_impact: false` → `false`。
- **单一事实源**：`proposal.md`「UI/UX 变更声明」段的 `ui_impact` 是「本次动没动界面」的**权威意图源**；
  `flow-derive` / guard / 面板**只读这一组事实源**，不引入第二处判定。「原型是否已产出」由
  `write-ui-prototype` overlay 节点的 `done_when` 富对账（见「## ADDED」章节）绑定，二者不各说各话。
- **只对 launched flow 有效**：initial flow 无提案目录、无 UI/UX 变更声明段，`ui_impact` 在 initial 恒 false。
- **[code] 触点**：`flow-derive.ts` 新增该派生逻辑（从提案声明段 + 活跃提案 module 的 `logos-project.yaml modules[].product_type` 推导，module-aware），与既有 `delta_required` 派生并列。

表达式（M1 支持的最小集）：`flag` / `not flag` / `flag != value`。例：
`when: deployment_required`、`when: bootstrap != adopted`、`when: not api_enabled`、`when: delta_required`、`when: code_required`、`when: ui_impact`。

## 9. done_when 谓词词表

| 谓词 | 含义 | 阶段 |
|---|---|---|
| `dir_nonempty` | 目标目录非空（多模块时按 `{module}-` 前缀过滤） | M1 |
| `file:<path>` | 指定文件存在 | M1 |
| `marker:<NAME>` | 提案目录下存在 marker 文件（如 `VERIFY_PASS`） | M1 |
| `any_present:[A,B,...]` | 列出的任一 marker/文件存在即满足（保留旧 marker 兼容） | M1 |
| `all_present` | fan-out：每个实例的 `produces` 都就绪；可配 `coverage_threshold`（§7）放宽为「覆盖率 ≥ 阈值」 | M1（阈值 M2/S29） |
| `proposal_package_filled` | **proposal.md 与 tasks.md 均**脱离模板填写完整（对齐 `status.ts:633`，launched 用） | M1 |
| `section_complete:<tag>` | tasks.md 指定 section（如 `delta`/`code`）全部勾选或不存在 | M1 |
| `archived` | 提案已归档 | M1 |
| `cmd:<command>` | 命令退出码为 0（**仅 overlay-add 节点**，及 §10.3 白名单的 overlay-modify launched gate；执行语义见 §9.2） | M2 切片 1b |

**失败/阻塞谓词（`fail_when`）**：与 `done_when` 同词表，但命中表示节点处于 **failed** 状态（非完成）。
用于忠实表达现有失败态——例如 launched 的 verify 节点 `fail_when: marker:VERIFY_FAIL`
（对应 `verify-failed`）、smoke 节点 `fail_when: marker:SMOKE_FAIL`（对应 `smoke-failed`）。
failed 节点不向后流转，`next` 输出"修复后重试"。
**`fail_when` 优先于 `done_when`**：两者同时命中时判 failed（对齐现状 `VERIFY_FAIL > VERIFY_PASS`、
`SMOKE_FAIL > SMOKE_PASS`——派生时先查 `fail_when` 再查 `done_when`）。

> launched 流程的 done_when 多用 `proposal_package_filled` / `section_complete:*` / `marker:*` / `archived`，
> 忠实表达现有 `ProposalStep` 状态机；详见内置 `spec/flow/launched.yaml`。

> **方法论 GUI overlay 的 `cmd:` 用法**：`write-ui-prototype` / `verify-ui-provenance` 是 overlay-**add** 节点，
> 故其 `done_when: cmd:<...>` 合法（§9.2）。这两个节点**不在** builtin `launched.yaml` 中，
> 只由方法论 GUI overlay `op:add` 注入（见「## ADDED」章节与 §10.3）。

### 9.1 谓词上下文（overlay-add 节点适用）

各 done_when / fail_when 谓词的求值根 / 适用 lifecycle 不同；overlay-add 节点须据此选择**可求值**的谓词：

| 谓词 | 求值根 | 适用 lifecycle |
|---|---|---|
| `dir_nonempty` | 项目资源目录（需配 `produces` 指明目标目录） | initial / launched |
| `file:<path>` | 路径自含（相对项目根），不需 `produces` | initial / launched |
| `marker:<NAME>` / `any_present:[...]` | **活跃提案目录**（`logos/changes/<slug>/`） | **仅 launched**（initial 无提案目录） |
| `section_complete:<tag>` / `proposal_package_filled` / `archived` | 活跃提案 `tasks.md` / 提案状态 | **仅 launched** |
| `all_present` | fan-out 每实例 `produces`（需配 `for_each`） | initial / launched |

> initial 流程**无提案目录**，故 initial 的 overlay-add 节点**不得**使用 `marker:` / `any_present:` / `section_complete:*` 等谓词，
> 须改用 `file:` / `dir_nonempty`。不满足者由派生入口判 `FLOW_SCHEMA_INVALID`（见 §10.3 / §12.1）。

### 9.2 cmd: 执行语义（M2 切片 1b）

`cmd:<command>` 谓词让节点完成判定由命令退出码决定。**适用范围（S30 放开）**：overlay-**add** 节点的 `done_when`/`fail_when`，**以及** overlay-**modify**
的 **launched `verify` / `deploy` / `smoke` 三个 gate**（精确 `(节点,字段)` 白名单见 §10.3）。其它 builtin 节点（initial 全部 + launched 的
proposal/delta/merge/code/archive）经 modify 改 `done_when`/`fail_when` 到 cmd: 仍 → `FLOW_SCHEMA_INVALID`——它们承载 OpenLogos 内部状态（marker/section/package），cmd: 不适用。

- **语法**：谓词串写作 `cmd:<command>`（**无内层引号**）；payload = `cmd:` 之后到串尾的全部内容、首尾 trim，原样交 shell。
  示例：YAML `done_when: "cmd:npm test"` → 谓词串 `cmd:npm test` → payload `npm test`。**空命令（trim 后空）非法 → `FLOW_SCHEMA_INVALID`**。
- **执行机制**：`spawn(cmd, { shell: true, cwd: 项目根 })`——shell metacharacter（`&&`/`|`/`$()`）被允许（信任委托宿主，不沙箱/不转义）；跨平台用默认 shell（`sh -c` / `cmd /c`）。
- **求值时机**：**仅 `next` 执行**；`status` / `watch` 不执行，该节点态 = **`pending`（未求值）**（见 §12）。
- **判定（按字段，per-field）**：cmd 谓词所在字段决定其含义——**`done_when: cmd:` `exit 0` = 该字段 done**；**`fail_when: cmd:` `exit 0` = 该字段 failed**；
  两者**非 0 / 超时 = 该字段未命中（不崩溃）**。命令不存在（shell exit 127/9009）按非 0 处理。节点最终态按 `fail_when` 优先于 `done_when`（§9）与前沿规则（§12）合成。
- **超时**：节点级 `cmd_timeout_seconds` > 项目级 `flow.cmd_timeout_seconds`（`logos.config.json`）> 内置 60s；
  **均须整数 ≥ 1**（0/负数/非整数 → `FLOW_SCHEMA_INVALID`）。超时尽力终止 shell 及其子进程树（POSIX 进程组 / Windows `taskkill /T`，跨平台不保证 100%）。
- **输出容量边界**：stdout/stderr 必须持续 drain（防阻塞），每路最多保留尾部 ≤64KiB（截断）；**命令输出不进契约**（结果只看 exit code）。
- **信任边界**：同 §11 pre/post_script——是否真执行由宿主权限模式决定。

## 10. 模板继承（overlay / extends）

项目实例用 `extends` 引用内置模板，只写差异。**走 overlay 而非整份拷贝**——让方法论可中心化演进。

```yaml
version: 1
flow: initial
extends: builtin:initial@v1      # 基线 + 内容版本；@vN 用于 overlay 升级冲突检测
overlay:                         # 按 node id 寻址的操作列表（strategic-merge）
  - op: skip                     # 跳过节点（等价 when:false）
    target: orchestration-test
  - op: modify                   # 深合并：仅覆盖给出的字段（禁止覆盖 id，见下）
    target: code
    set: { review_agent: my-code-reviewer }
  - op: add                      # 新增节点
    after: code                  # after | before：相对某 node id 定位
    node: { id: lint, name: 静态检查, skill: linter, done_when: "file:logos/resources/verify/LINT_PASS" }
  - op: reorder                  # 调整顺序
    target: smoke
    after: deploy
  - op: set-loop                 # 覆盖某 subflow 的 loop（M2 切片 2，见 §10.4）
    subflow: implement
    set: { max_iters: 3 }        # set 仅允许 max_iters / until
```

- **操作集收窄为五种**：`skip` / `add` / `modify` / `reorder`（节点级）+ `set-loop`（subflow 级 loop），不做任意改写。
- **按 node id 的 strategic-merge**：`modify` 深合并字段；其余按 id 定位。是今天 `skip_phases`
  （"删掉这几段"）的自然延伸。
- **`op:modify` 禁止覆盖 `id`**：改写内置节点身份会破坏 node→phase 映射，`applyOverlay` 拦截 `set.id` 并报 `FLOW_SCHEMA_INVALID`。
- **内置模板带版本号**（`builtin/initial@v1`）：内置改名/删节点而 overlay 仍引用旧 id 时可检测并报错。
- **可调试性**：必须提供 `openlogos flow show --resolved`，输出"基线 + overlay 合并后"的生效流程。
- **`op:add` 节点的完成判定须可求值**：上例 initial overlay 用 `file:` 而非 `marker:`——因 initial 无提案目录（见 §9.1 / §10.3）。

### 10.1 内置模板内容版本来源（builtin_version）

`extends: builtin:<flow>@vN` 中的 `@vN` 指**内置模板内容版本**，与文件 `version`
（flow 文件 schema 版本，整数）**互不相关**。内置模板内容版本由 **loader 维护一份内部映射**
作为唯一来源（不依赖 YAML 内字段，避免隐式复用 schema version）：

- 当前映射：`initial → v1`、`launched → v1`。
- 该映射是 `openlogos flow show` 输出 `builtin_version` 字段、以及 overlay `@vN` 不匹配告警
  （`FLOW_VERSION_MISMATCH`）比对的**唯一依据**。
- 当内置模板（`spec/flow/*.yaml`）内容发生破坏性变更（增删/改名 node、调整结构等）时，
  **必须同步 bump** loader 中该 flow 的内容版本。
- **禁止**用文件 `version`（schema 版本）隐式充当内容版本。

### 10.2 overlay skip 在 resolved 输出的表达

overlay `op: skip` **等价 `when:false`**：resolved flow 中该节点**保留不删除**，仅被标记 skipped。
机器输出（`flow show --resolved --format json`）通过 node 字段表达，详见 `spec/cli-json-output.md`：
- `skipped: true` — 节点被 overlay skip 或 `when=false` 置为跳过；
- `overlay_op: "skip" | "add" | "modify" | "reorder" | null` — 触及该节点的 overlay 操作来源。
raw 输出（未应用 overlay）中 `skipped` 为 false、`overlay_op` 为 null。

### 10.3 overlay 节点的谓词合法组合矩阵

overlay `op:add` 节点**必须**带可求值的完成判定，否则该节点永远 active、阻死流程。合法组合：

- `dir_nonempty` **必须**配 `produces`（指明判定目录）；
- `file:<path>` 自含路径，**不需** `produces`；
- `marker:` / `any_present:` / `section_complete:*` / `proposal_package_filled` / `archived` **仅 launched** 可用（initial 禁用，须改 `file:`）；
- `all_present` **必须**配 `for_each` + `produces`（fan-out）；
- `cmd:<command>` 适用于 **overlay-add 节点** 与 **overlay-modify 的 launched gate**，按精确 `(节点, 字段)` 白名单（命中外一律 `FLOW_SCHEMA_INVALID`）：
  - overlay-**add** 节点：`done_when` / `fail_when` 均可 cmd:（lifecycle 见上表）。
    - **方法论 GUI overlay 的两个 add 节点属此列**：`write-ui-prototype`（`done_when: cmd:openlogos check-ui-prototype`）与
      `verify-ui-provenance`（`done_when: cmd:openlogos check-ui-hash-match`，命令内部三分支），均落在 launched `plan` subflow 内（提案目录求值根可用），
      合法。二者均为**单 `done_when: cmd:`**（无 `fail_when`），不触发「同节点双 cmd:」（决策 B）。
  - overlay-**modify** builtin（**仅 launched 这 3 个 gate**）：`verify.done_when` ✅ / `verify.fail_when` ✅ / `smoke.done_when` ✅ / `smoke.fail_when` ✅ / `deploy.done_when` ✅；
    **`deploy.fail_when:cmd` → `FLOW_SCHEMA_INVALID`**（deploy builtin **无 `fail_when`**）；其它任意 `(builtin 节点, 字段)` 改 cmd: → `FLOW_SCHEMA_INVALID`。
  - **决策 B**：**同节点 `done_when` 与 `fail_when` 不得均为 `cmd:`**（→ `FLOW_SCHEMA_INVALID`；仅 verify/smoke 适用）。混合（一 cmd 一 marker）按 §12 per-field/frontier 求值。
  - **空命令（trim 后空）→ `FLOW_SCHEMA_INVALID`**。
- **F·与 loop 正交**：`implement` 经 `set-loop` 激活 loop（`max_iters>1`）时，**`verify` 的 `done_when` 或 `fail_when` 任一为 cmd: → `FLOW_SCHEMA_INVALID`**
  （loop 收敛靠 `LOOP_ITERS` 账本、cmd gate 不写账本 → 冲突；resolved 校验静态拦截）。`deploy`/`smoke` 在 `deliver` 无 loop、无此冲突。
  **UI-first overlay 的两个 add 节点在 `plan` subflow（无 loop）内，与此正交冲突无关。**

不满足上述组合的 **overlay-add 节点**（lifecycle 相关谓词矩阵，如 initial 用 `marker:`），由**派生入口**判 `FLOW_SCHEMA_INVALID`（`applyOverlay` 对其保持结构性宽松、不做此语义校验，故 `flow show --resolved` 仍可展示）。

**但 S30 的 overlay-modify cmd: 校验是结构性的**（仅依赖 resolved flow、不依赖运行时 lifecycle 语境），因此在 **`applyOverlay` / resolved schema 校验阶段就地拦截**——精确 `(节点,字段)` 白名单、空命令、同节点双 cmd:（决策 B）、F·loop 冲突，**均在 `flow show --resolved` / 任何 resolved 加载入口即 `FLOW_SCHEMA_INVALID`（fail loud，不展示半成品）**。

### 10.4 set-loop（subflow 级 loop 覆盖，M2 切片 2）

节点级四操作（skip/add/modify/reorder）只触及 node；**覆盖 subflow 的 `loop` 用专门的 `op: set-loop`**：

```yaml
- op: set-loop
  subflow: implement            # 目标 subflow id（非 node id）
  set:
    max_iters: 3                 # until 缺省沿用该 subflow 现有 until
    exhausted_gate:             # 可选；达上限退出 gate 的覆盖（S29）
      skippable: true            # 默认 false；true = 允许 next --auto 放行未收敛代码
```

- 按 **subflow id** 定位，把 `set` 合并进该 subflow 的 `loop`。
- **`set` 字段白名单**：**仅允许 `max_iters` / `until` / `exhausted_gate`**；出现任何**其它未知 key** → `FLOW_SCHEMA_INVALID`（不静默保留、不出现在 resolved flow）。
- **`exhausted_gate` 子结构（S29）**：**严格 = `{ skippable: boolean }`**——`skippable` **必填且须为 boolean**；缺 `skippable`（如 `{}`）/ `exhausted_gate: null` / 非对象 / 出现其它 key → `FLOW_SCHEMA_INVALID`（fail loud，不物化默认值）。
  **缺省（完全不写 `exhausted_gate`）**→ 退出 gate `skippable` 维持 `false`、`loop_state` 省略 `exhausted_skippable`（S27 行为不变）。
- 校验：`max_iters` 须整数 ≥ 1；**`until` 枚举 `tests_green` | `code_slices_green`**（change-flow-redesign 放开 `code_slices_green`；其它取值 → `FLOW_SCHEMA_INVALID`）；目标 subflow 不存在 / 缺 `set` → `FLOW_SCHEMA_INVALID`。
- 只有 `max_iters > 1` 才真正激活 loop 真迭代派生（见 §12.2 / §12.4）；`set-loop` 到 `max_iters:1` 等价退化环（无激活效果）；`exhausted_gate.skippable` 仅在 loop 激活并达上限时才有派生意义。

### 10.5 overlay 顶层 defaults（contract-self-description）

**`defaults` 是 overlay 文档的合法顶层字段**（与 `version`/`flow`/`extends`/`overlay` 并列），用于项目级覆盖内置模板的派发默认值：

```yaml
version: 1
flow: launched
extends: builtin:launched@v1
defaults:                        # 可选；文件级 strategic-merge，先于 overlay 操作列表应用
  dispatch:
    timeout_seconds: 600         # 覆盖 builtin defaults(900)，作用于所有未显式声明 timeout 的节点
overlay:
  - op: modify
    target: code
    set: { dispatch: { timeout_seconds: 7200 } }   # 节点级 override，优先级最高
```

- **应用顺序**：overlay 顶层 `defaults` 在**操作列表（skip/add/modify/reorder/set-loop）之前**按文件级 strategic-merge 覆盖 builtin `defaults`；随后 resolved 物化按最终 defaults 进行。
- **优先级（低 → 高）**：builtin `defaults` < overlay 顶层 `defaults` < 节点显式 `dispatch.timeout_seconds`（builtin 特例声明或 overlay-add 节点声明）< overlay `modify` 的节点级 `set.dispatch.timeout_seconds`。
- **校验**：`defaults` 若出现，必须是对象且 `defaults.dispatch.timeout_seconds` 为正整数；非法类型 / 部分非法对象（如 `defaults.dispatch: "fast"`）→ `FLOW_SCHEMA_INVALID`（与 §3 的 schema 校验同源，加载层与派生层不得各自解释）。
- **向后兼容**：不写 `defaults` 的既有 overlay 文件行为不变（沿用 builtin defaults）；flow 文件 schema `version: 1` 不变。
- S22（加载/解析）与 S25（overlay 派生）引用本节同一规则，UT-S25-24（overlay 覆盖 defaults 物化进未声明节点）为验收锚。

## 11. 脚本插件（pre/post_script）

- `pre_script` / `post_script` 是节点级插件钩子（如建分支 / 开 PR / 发通知）。
- **OpenLogos 不自管脚本执行信任**：是否执行、以何权限执行，取决于宿主 AI agent 的权限模式
  （如 yolo 模式则直接执行）。OpenLogos 只声明"此处有 pre/post_script"，不持有执行与授权责任。

## 12. 引擎派生语义（被动 A）

| 命令 | 语义 |
|---|---|
| `openlogos status` | 基于 **resolved flow（含 overlay）** 按顺序派生每个 node 的 done/active/skipped/failed/**pending**；fan-out 输出覆盖度；overlay-added 节点经 node 级视图承载。**遇 `cmd:` 节点不执行命令、态 = `pending`** |
| `openlogos next` | 基于 **resolved flow** 输出当前 active 节点 + 其 skill + 现成提示词；遇 human gate 输出"需人类确认"。**对当前 `cmd:` 节点执行一次命令求值（每次 next 至多 1 个 cmd，budget=1）** |
| `openlogos next --auto` | auto 模式：gate 放行**以 resolved 当前 node/gate 位置为准**——当前 active/failed 节点（含 overlay-added）未完成时不得 auto-pass；到 gate 边界且 `skippable:true` 才视为通过并写 `GATE_AUTO_PASSED`，`false` 仍卡住 |
| `openlogos watch` | 轮询并流式输出派生状态（status 的实时版）；**遇 `cmd:` 节点不执行、态 = `pending`** |
| `openlogos flow show [--resolved]` | 展示 flow；`--resolved` 输出 overlay 合并后的生效流程 |

派生算法（M1）：
1. 按 subflow→node 顺序遍历；`when` 不满足 → 标 skipped。
2. node 按 `done_when` 判定 done（fan-out 走 `all_present` + 覆盖度）。
3. 当前节点 = 第一个未 done 且未 skipped 的 node（`fail_when` 命中则为 failed，见 §9）。
   gate 按 `position` 触发：
   - `exit`（默认）：该 subflow 内所有节点完成后、进入下一 subflow 前触发。
   - `entry`：进入该 subflow **第一个 active 节点之前**触发（即当前节点正是本 subflow 首个未完成节点时）。
   - 若某 subflow 内所有节点都因 `when`（或 subflow 级 `when`）跳过，则其 gate 一并跳过，不触发确认。
   - **`next --auto`**：gate 自动放行**以 resolved 当前 node/gate 位置为准**——当前 active/failed 节点（含 overlay-added）未完成时**不得**触发任何 gate auto-pass；仅当流程真正推进到 gate 边界（该 subflow 内所有节点 done）才按 `skippable` 放行。
4. loop 字段 M1 按退化环处理（不驱动多轮）。
5. **overlay-added 节点的派生表示**：overlay `op:add` 引入的节点**既无 phase key 也无 proposal_step**，经独立的 **node 级派生视图**承载（机器字段 `overlay_nodes` / `current_node`，见 `cli-json-output.md`）；overlay 对 builtin 节点的 `skip`/`modify`/`reorder` **不进** node 视图，仍由既有 phase（initial）/ `proposal_step`（launched）维度表达。**`overlay_nodes` 仅承载已到达节点**（态 ∈ `done`/`active`/`skipped`/`failed`，`active` 恒为唯一当前节点）；**尚未到达（未轮到）的 overlay-added 节点不输出**——其计划见 `flow show --resolved`。
6. **launched `proposal_step` 与 overlay-added 当前节点**：当 launched 当前节点落在 overlay-added 节点上时，`proposal_step` = resolved 序列中该节点**之前最近一个 builtin 节点**对应的 step（合法枚举、后向兼容，不置 null）；**若无前序 builtin（`add ... before` 插到首个 builtin 之前），`proposal_step` = `writing`**（状态机首态）。精确位置由 `current_node` 承载。
7. **`cmd:` 谓词的双模式派生**（overlay-add 节点 + overlay-modify 的 launched `verify`/`deploy`/`smoke` gate，S30）：
   - **per-field / frontier 模型**：一个节点的 `done_when`/`fail_when` **各按谓词类型独立求值**，`fail_when` 优先于 `done_when`（§9 不变）；**cmd 字段只在「前沿节点」求值**——已被非 cmd 字段解析为 done/failed 的节点**非前沿**，不再对其求值 cmd。
   - **观察派生（`status` / `watch`，不执行 cmd）**节点态（按序短路）：① 非 cmd `fail_when` 命中 → `failed`；② 否则 非 cmd `done_when` 命中 → `done`；
     ③ 否则该节点尚有**未求值 cmd 字段** → `pending`（cmd 字段视为 unknown，**不**把已被非 cmd 字段解析的节点判 pending）；④ 否则 `active`。
   - **求值派生（`next`，budget=1）**：仅对**前沿（pending）节点**求值其 cmd 字段，按 fail>done **逐字段**评（**同节点 done_when 与 fail_when 不得均为 cmd:，故至多一个字段是 cmd:**）：先评 `fail_when`（cmd: → exit 0 → failed；marker: 等 → 按原谓词），未命中再评 `done_when`（cmd: → exit 0 → done；marker:/file: → 按原谓词）：
     - `done_when:cmd` `exit 0` → 该节点**本次响应内** done 并续推 → `proposal_step` **推进过门**；
     - `fail_when:cmd` `exit 0` → 该节点**本次响应内** failed → `proposal_step` = `verify-failed` / `smoke-failed`（瞬态失败、**非推进**）；
     - 非 0 / 超时 → 停门前（`ready-to-verify` / `ready-to-deploy` / `ready-to-smoke`）。
     - **全程瞬态、不写 marker、不落盘**——随后 `status`/`watch` 仍按观察派生（停门前），下一次 `next` 重新求值。**这是有意的 next/status 不一致**（见 `cli-json-output.md`）。
     - **cmd budget = 1**：与 overlay-add cmd 共享、按 flow 顺序先到先求值；续推后若新 current 又是 cmd 节点/gate，停在该节点（`pending`），不执行第二个。
   - **builtin gate（verify/deploy/smoke）的机器承载**：不输出 `current_node`（仍仅 overlay-add）；改由新增字段 `cmd_gate` + `proposal_step`（停门前）表达，见 `cli-json-output.md`。
   - **launched 状态机 cmd-aware**：`detectProposalStepViaFlow` / `extractLaunchedMarkers` 对 cmd 字段不抽 marker 名、按本条求值；**marker: 字段路径逐字节不变**（golden 零漂移）。
   - 节点态枚举：`done | active | pending | failed | skipped`（`pending` 由 cmd 节点/gate 引入）。

8. **`openlogos deploy-done` 承认 cmd-gate verify（S30·决策 G）**：`deploy-done` 放行部署前判定「verify 是否通过」时，**按 resolved `verify` 节点的 per-field 谓词求值**，取代硬编码的 `VERIFY_PASS`/`VERIFY_FAIL` marker 检查：
   - `verify` 为 **marker**（默认/无 overlay）：`VERIFY_FAIL` 存在 → 不通过；否则 `VERIFY_PASS` 存在 → 通过。**与现状逐字节等价**（golden/回归安全）。
   - `verify` 为 **cmd-gate**（overlay modify）：按 per-field（fail>done）就地求值——`fail_when:cmd` exit 0 → 不通过；否则 `done_when:cmd` exit 0 → 通过；非 0/超时 → `VERIFY_NOT_PASSED`（带 cmd 上下文）。
   使「需部署 + verify cmd-gate」端到端落地（`next` 显 `ready-to-deploy` 后 `deploy-done` 求值 verify cmd 通过即放行）。`deploy-done` 是人类显式触发的一次性命令，就地求值符合「确认 CI 绿后再部署」语义。

### 12.1 实现注意事项（M1 派生必须保证行为不变）

- **launched 谓词隐藏的复杂度**：`proposal_package_filled` / `section_complete:*` / `archived` 实质是
  对现有 `detectProposalStep()` 11 态状态机的声明式复刻。M1 实现必须**逐态对齐 `detectProposalStep`**，
  否则 launched 行为漂移。这块是 launched 落地的主要工作量。
- **fallback-skip 兼容**：现状 `status.ts` 有"已完成 phase 之前的空 phase 自动标 skipped"的向后兼容
  逻辑（`NON_FALLBACK_SKIP_PHASES` 除外）。flow 模型以显式 `when` 取而代之；实现时**必须核对**：
  对未声明 `skip_phases` 的老项目，新派生结果与旧 fallback 行为一致，不得让其 current phase 漂移。
- **失败/阻塞态要忠实复刻**：除 `fail_when` 表达的 `verify-failed` / `smoke-failed` 外，现有
  `detectProposalStep` 还有一个**部署决策冲突阻塞态**（`proposal.md` 与 `[deploy]` section 矛盾时
  输出 warning、不推进 deploy/smoke/archive）。M1 实现需保留该阻塞判定（可作为 deliver 节点的
  `fail_when`/校验前置），不得在 flow 化后丢失。
- **两种"多产出"判定并存是有意的**：initial 的 fan-out 用 `all_present`（按场景的文件覆盖），
  launched 的 `write-delta` 用 `section_complete:delta`（按 tasks.md 勾选）。二者机制不同但都忠实于
  各自现状，不强行统一。
- **`NODE_TO_PHASE_KEY` 仅覆盖 13 个内置节点**：overlay-added 节点不进 phase / proposal_step 维度，走 node 级承载（§12 第 5 条）。
  派生入口对 overlay-add 节点做「可求值 done_when/produces 组合」语义校验（§10.3），不可求值则 `FLOW_SCHEMA_INVALID`。
- **launched 派生为 marker 驱动、非 order 驱动**：launched 的 `proposal_step` 由各节点 marker/section 判定（固定优先级），
  **不消费 flow 顺序**。因此 overlay 对 **launched builtin 节点**的 `skip` / `reorder` **本切片不生效**（honor 顺序需重写状态机，留后续切片）；
  为避免「`flow show --resolved` 显示已应用、派生静默忽略」的误导，**派生入口检测到 launched 上对 builtin 节点的 `skip`/`reorder` 即报 `FLOW_SCHEMA_INVALID`（fail loud）**。
  launched 的 `add` / `modify` 正常生效；其中 `modify` 对**经 flow 读取的 marker 名**生效，`section_complete:*` 的 tag（`delta`/`code`）由代码侧固定读取、本切片不承诺经 modify 覆盖。**initial 不受此限**（由 flow 顺序构建 phase plan，四操作全生效）。

### 12.2 loop 真迭代派生（M2 切片 2，被动 A）

把 implement（code/verify）子流程的退化环点亮为"迭代到测试绿"的收敛循环。**仍是 A 被动派生**——
OpenLogos 不自驱动跑测试，只派生"第几轮 / 是否收敛 / 是否升级 gate"。

**激活条件（contract-self-description 收紧，主动破例）**：分两层判定，缺一不挂 `loop_state`：

1. **结构性前置（loop 定义激活，不变）**：resolved 的目标 subflow（implement）`loop.max_iters > 1`，
   **且不属于"initial 多模块 unsupported no-op"**。
2. **implement 进入判据（contract-self-description 新增）**：`loop_state` 挂出 **iff** implement 子流程
   **已真实进入**，判据为确定性事实合取——`code_required ∧ spec_complete ∧ slices_planned ∧ slices_approved`：
   - `spec_complete` = `SPEC_MERGED` / `MERGED` 在场（含纯代码提案的 no-delta `SPEC_MERGED`，§12.6）；
   - `slices_planned` = `tasks.md` `[code]` section 含**真实脱占位条目**（`tasks_code_filled`）；
   - `slices_approved` = **slice-exit 门已消费**，权威事实 = `SLICES_APPROVED` marker 在场（§12.5）。
   - 该合取与 `active_change.facts` 是**同一份计算**（单一事实源在 CLI，不允许两处实现；`facts` 契约见
     `spec/cli-json-output.md`），driver 可直接从 facts 读出「implement 是否已进入」。
   - **`ready-to-implement`（切片已规划、待 slice-exit 批准）的合法驻留态不挂**；
   - **docs-only / no-code 提案（`code_required == false`）永不激活 implement loop**，不因 launched flow
     含 loop 定义而挂出；
   - 四条缺一即**省略 `loop_state` 字段**（不输出空对象、不输出 null）。

**主动破例声明（破「launched 下 `loop_state` 常驻输出」不变量）**：本节主动取消 change-flow-redesign
确立的「launched 默认激活切片循环 → `loop_state`/`slice_state` 常驻输出」中 `loop_state` 的常驻口径
（原 §6 激活来源②、`spec/cli-json-output.md` §3.9、S27「常驻输出」措辞同步收紧）。收紧后 spec 阶段 /
切片未规划 / 切片未批准时**不再输出** `loop_state`——这是消灭 runlogos loop 劫持假死的上游根治，
现役 driver 对「`loop_state` 缺席」本就走普通推进，兼容。影响面：golden 快照 launched 活跃提案系列
重拍（差异须仅为 `loop_state` 缺席与本提案新增字段）。**`slice_state` 常驻口径不变、不收紧**。
**反面锚**：`pre-implement` 步骤下 `loop_state` 不输出——`pre-implement + loop_state` 是**非法组合**，
由生产者一致性漂移注入测试断言其不存在（见「步骤注册表与 step_meta（contract-self-description）」章节），而非固化为合法夹具。

**`loop_state.activated_at`（contract-self-description 新增，审计用）**：`loop_state` 挂出时携带可选字段
`activated_at`（ISO 8601），表示 implement 进入时刻。时间来源必须**持久且确定**：读自结构化
`SLICES_APPROVED` marker 的 `approved_at`（§12.5）；旧格式空 marker → **省略该字段**（兼容）。
同一磁盘状态永远派生同一 JSON，不破坏 A 被动派生确定性。

未满足激活条件时一切退化为旧行为、不产出 `loop_state`、verify 不写账本（golden 零漂移口径相应改为：
按上述判据挂出/缺席即为基线）。

**计数与收敛**（读 `LOOP_ITERS` 账本，按当前 module 过滤）：
- `iteration` = 账本（过滤后）行数；`escalated` = `iteration >= max_iters && !converged`。
- `converged` **按 resolved `until` 求值**（枚举与语义见 §6，契约收敛为闭合双分支、无无条件公式）：
  - `until == tests_green` → `converged` = 末行 `result == "pass"`（末轮测试绿）；
  - `until == code_slices_green` → `converged` = `section_complete:code ∧ tests_green`（`[code]` 父切片及缩进子任务**全部勾选** 且 末轮测试绿；**空 `[code]`** 退化为纯 `tests_green`，派生细节见 §12.4）。builtin launched 默认即此分支——仍有未勾切片时**即便末轮 verify 绿也不得出环**（S31 FAIL-safe 收敛条件）。

**出环规则（核心）**：loop 激活时，**implement subflow 的完成以 `loop_state.converged` 为准，覆盖其内节点（含 verify）各自的
`done_when`**。尤其 initial 的 verify `done_when: file:.../acceptance-report.md`——`openlogos verify` 无论 PASS/FAIL 都写该
报告，故必须由 `converged` 把关，否则首次 FAIL 会被误判 done 而推进到 deploy/launch。**未收敛时一律不得推进到后续 subflow
（deliver/close）**，且该规则必须落到**每一条**判定 verify/implement 完成的派生入口（node 级走查、initial per-module phase
派生、顶层 phases 文件扫描、launched proposal_step 派生）。launched 的 `marker:VERIFY_PASS` 本就 FAIL-safe，与本规则一致。

**双模式**：
- 观察（`status` / `watch`）：读账本只**展示** `loop_state`、**不执行测试、不写账本**。
- 求值（`next`）：不执行测试，只据 `loop_state` 派生措辞——未收敛且 `iteration < max_iters` → "继续迭代（第 N/M 轮，修复后重跑
  `openlogos verify`）"；`converged` → 出环续推；`escalated` → 升级 human gate。

**达上限 = loop 退出 human gate**：`escalated` 时派生为 implement 的退出 gate，`gate_id = gate:<subflow>:loop-exhausted`
（如 `gate:implement:loop-exhausted`）。该 gate 的 **`skippable` 取 resolved loop 的 `exhausted_gate.skippable`，默认 `false`**
（不写 `set-loop` 的 `exhausted_gate` 即维持 S27 的固定 `false` 阻塞）。机器字段 `loop_state` **仅当 overlay 显式写了 `exhausted_gate` 时**
才输出 **`exhausted_skippable`**（= 该 `skippable`）；**未写则省略该字段，消费方按 `false` 处理**（这样既有 S27 激活-loop 的 JSON 断言不新增字段
→ 真零漂移，见 `spec/cli-json-output.md`）。

- **`exhausted_skippable !== true`（默认）**：`next --auto` 照常阻塞、**不 auto-pass、不写 `GATE_AUTO_PASSED`**（S27 不变）。
- **`exhausted_skippable === true`（高危 opt-in）**：`next --auto` 在 `escalated` 时**自动放行**该退出 gate——输出 `gate_id =
  gate:<subflow>:loop-exhausted`、`skippable: true`、`gate_auto_passed: true`，向 `GATE_AUTO_PASSED` 账本**追加审计行**，action 转 proceed
  （放行未收敛代码进入后续 subflow，**无人值守**）。这是用户显式声明的「达上限即放行」语义，OpenLogos 据 overlay 被动派生、不自行决策。
  **R2 安全优先**：放行的**前提是当前未卡在未完成的 overlay-added 节点**（active/failed）——若仍有未完成 overlay 节点（gate 尚未到达），即便 `escalated` +
  `exhausted_skippable:true` 也**不得** auto-pass、不写 `GATE_AUTO_PASSED`，`gate_id`/`skippable` 置 `null`（与 §12.1 第 4/5 条「未到 gate 边界不放行」一致）。

继续迭代 = 人类用 overlay `set-loop` 调大 `max_iters`（`escalated` 自动解除），或直接修到测试绿出环；**gate 本身不重置计数**。
**`loop-exhausted` 不是新的 `proposal_step` 枚举值**——`proposal_step` 保持现有集合不变，达上限只由 `loop_state.escalated` /
`exhausted_skippable` + `--auto` 的 `gate_id`/`skippable`/`gate_auto_passed` 表达。

**账本写入**（`openlogos verify`）：仅激活时、在**算出 gate 结果之后的不依赖 guard 的共享路径**追加一行
`{iter, node:"verify", result:"pass"|"fail", module, timestamp}`，`result` 取沙箱降级后的最终 gate 结果；`iter = 同 module
已有行数 + 1`；配置类早退（`NO_TEST_RESULTS` / `NO_TEST_CASES`）不计迭代、不写。路径：launched = 提案目录、initial =
`logos/resources/verify/`（无提案目录）；账本行带 `module`，读取按 module 过滤。**initial 多模块**：verify 是项目级单次运行、
无法把一次 run 归属到某模块 → **不写账本、loop 视为未激活**（本切片已知不支持）；launch 后 initial 账本仅历史产物，launched
派生只读提案目录账本。

**收敛后再失败的状态回退**：verify 再次 FAIL 沿用现有行为清除 `VERIFY_PASS` 及下游 `DEPLOY_DONE`/`SMOKE_*` marker → verify
回到未 done → `converged` 转 false → implement loop 重新打开；账本续写、`converged` 反映最后一次。

### 12.3 next 透出节点编排提示（next_node，S28）

`openlogos next` 除「下一步是什么」外，再透出**当前该处理节点的编排提示**——`next_node`：`skill` / `working_agent` /
`review_agent` / `pre_script` / `post_script`（取自 **resolved flow**，含 overlay 重绑）。供宿主据此编排（派哪个 skill/agent、
要不要跑脚本）。**仍 A 被动**：OpenLogos 不解释/不映射 agent/不执行 script，是否执行由宿主权限模式决定（同 §11 信任边界）。
JSON 契约（字段类型、`string|null` 空值、挂载、缺省）见 `spec/cli-json-output.md`。

**这是「最终建议处理节点」的派生语义（不只是 JSON 字段说明）**——`next_node` 指向**本次 `next` 响应最终建议处理的真实
flow node**，**默认 = 当前前沿节点**，下列为例外：

- **【R3·cmd 续推】**：`next` 先对当前 pending 的 cmd 节点/gate（**overlay-add 节点 或 builtin verify/deploy/smoke cmd gate**，S30）求值再续推（见 §12 第 7 条）。
  故 `next_node` 取**求值（cmdEval 回灌）后**的最终节点：`done_when:cmd` `exit 0` → 续推后的节点（**不**是已 done 的 cmd 节点/gate）；
  `fail_when:cmd` `exit 0` → 该节点/gate（求值后 `failed`）；cmd 非 0/超时 → 该节点/gate（`active`/停门前）；budget=1 遇第二个 cmd → 第二个 pending cmd 节点/gate。builtin gate id 取 `cmd_gate.node_id`。
- **【R4·auto 放行】**：`next --auto` 自动放行 gate（`gate_auto_passed`）时，默认**不指向节点**（省略 `next_node`）——放行后宿主走
  gate 的 command，下一节点待重新 `next` 派生。**窄例外：`plan-exit` 被 auto 消费时，CLI 同步写入 `PLAN_APPROVED` 并重新派生到
  `write-delta` 前沿；本次响应必须输出 `next_node.id == "write-delta"`，供无人值守 driver 立即派发 `change-writer` 写 delta。**
- **【R7·loop 阻塞】**：loop 未收敛、未达上限时，前沿虽钉在 `verify`，但本响应实际建议「修代码后重跑 verify」，故 `next_node`
  指向 loop subflow 的**工作节点**（overlay `current_node` 优先；否则 resolved flow 中 `id == "code"` 且未 `skipped` 的节点，
  **非 `verify`**——verify 是 CLI 驱动的度量节点）；`code` 缺失/被 overlay `skip` → 省略（仅 initial 等**合法 resolved flow**：
  launched 对 builtin `code` 的 `skip`/`reorder` 在派生入口已 `FLOW_SCHEMA_INVALID`，不进入此省略）；达上限（`escalated`，
  loop-exhausted human gate）→ 省略（宿主读 `loop_state.escalated`）。`next_node` 与 `loop_state` 互补。
- **【R5·命令级建议】**：当前建议不指向某 flow node（`all_done` / 无 active proposal → `openlogos change <slug>` / 补 baseline /
  `openlogos launch` 等命令级提示）→ 省略 `next_node`。`plan-exit` auto 消费后已变成真实 `write-delta` 节点，不属于本省略分支。

**范围**：本能力仅 `next` 暴露；`status`/`watch`/`flow show` 不变。

### 12.4 切片循环派生与 plan 门派生（change-flow-redesign）

本节在 §12.2「loop 真迭代派生」基础上扩展，承载 change-flow-redesign 的两块新派生；仍严格 **A 被动派生**（只派生、不自驱动跑测试、不代勾切片）。

**(1) `code_slices_green` 收敛（切片循环）**

- **激活**：resolved 目标 subflow `loop.until == code_slices_green` 且 `max_iters > 1`（builtin launched `implement` 默认满足）。initial 多模块仍不支持（同 §12.2，verify 项目级单次、无法归属切片）。
- **收敛判定**：`converged = section_complete:code ∧ tests_green`，其中 `tests_green` = `LOOP_ITERS`（按当前 module 过滤）末行 `result == "pass"`，`section_complete:code` = `tasks.md` `[code]` section 全部勾选。**这覆盖了 §12.2 R2 中"仅末轮测试绿即出环"的判定**——`code_slices_green` 下即便末轮绿，只要 `[code]` 未全勾，`converged=false`、不得推进到后续 subflow（FAIL-safe 落每个判定入口，同 §12.2 R8）。
- **空 `[code]` 退化**：`[code]` section 缺失或切片数为 0 时，`code_slices_green` 退化为 `tests_green`（仅末轮绿即收敛），避免 launched 默认激活把纯 docs/delta 小提案卡死。
- **切片选取（next）**：loop 未收敛且未达上限时，`next` 选**第一个未勾 `[code]` 行**为当前工作项，`next_node` 钉在 `code` 节点（同 §12.2 R7），并带 `slice` 子提示（切片标题）。`slice` 提示语义 = "下一个**未建**切片"，**非"该修哪片"**——回归飘红时修哪里由全量 verify 失败输出决定、归宿主判。
- **机器字段**：派生 `slice_state {total, done, current, remaining}`（仅切片循环激活时输出，否则省略）；`LOOP_ITERS` 账本可选 `slice` 维度。契约见 `spec/cli-json-output.md`。

**(2) `ready-to-delta` 驻留态与 `plan` 门派生（launched 前段重构）**

- launched 前段子流程由 `propose{...}` 重构为 `plan{write-proposal, write-tasks}` + `spec{write-delta}` + `merge{...}`（`spec`/`merge` 带 `when: delta_required`）。
- **新增 `proposal_step` 值 `ready-to-delta`**：`proposal.md` 与 `tasks.md` 均已脱模板、但尚未产出任何 delta（`[delta]` 未开始）且不存在 `PLAN_APPROVED` marker 时的驻留态，对应 `plan` 出口 human 门「批准方案」。
  - 检测依据 = "proposal/tasks 已填 且 delta 未启动 且 `PLAN_APPROVED` 不存在"。
  - 说明：§12.2 中"`loop-exhausted` 不新增 `proposal_step` 枚举值"仅约束 loop 达上限的表达方式，**不妨碍**本提案前段为 plan 门显式新增 `ready-to-delta`（开发态主动扩展闭合枚举，影响面见提案「主动破例」）。
- **gate 映射（`STEP_TO_GATE_SUBFLOW` 等价语义）**：`ready-to-delta` → `plan` 出口门（`gate_id = plan-exit`、`skippable:true`）；`ready-to-merge` → **`spec`** 出口门（由原 `propose` 出口改映射）；`ready-to-deploy` → `deliver` 入口门（**`skippable` 由 `false` 改为 `true`**，无人值守 `--auto` 可自动放行，见 §5.1 与 `spec/change-management.md` 部署确认策略）。
- **plan 门 `--auto` 放行 = 消费 gate**：`next --auto` 在 `ready-to-delta` 自动放行 `plan-exit` 时，必须同时执行两个持久化动作：
  1. 向 `GATE_AUTO_PASSED` 追加 `{gate_id:"plan-exit", proposal_step:"ready-to-delta", timestamp}` 审计行；
  2. 写入活跃提案目录的 `PLAN_APPROVED` marker（内容可为空，存在性为准）。
- **`PLAN_APPROVED` 的派生语义**：**仅当 `tasks.md` 存在 `## [delta]` section 时适用**——存在 `PLAN_APPROVED` 且 `[delta]` section 尚未全部完成时，`proposal_step` 派生为 `delta-writing`，即使还没有任何 delta 文件或 `[delta]` 勾选；此时 `next` / `next --auto` 的前沿是 `spec.write-delta`，`next_node.id == "write-delta"`。**无 `[delta]` section 的纯代码提案（`delta_required==false`）不适用本条、绝不派生 `delta-writing`**：但它仍需按 §12.6 完成 no-delta spec-complete；缺少 `SPEC_MERGED` / `MERGED` 时停在 `spec-complete-required`，不得直连 `plan-slices`。
- **审计与授权边界**：`GATE_AUTO_PASSED` 仍是审计日志，默认 `next` 与 `status` 不因历史审计行越过 gate；状态推进只认 `PLAN_APPROVED` 或实际 delta 产出。重复 `next --auto` 不应在同一个 `plan-exit` 固定点追加多条审计，因为第一次放行后前沿已经离开 `ready-to-delta`。

### 12.5 切片规划子流程派生（split-slice-planner-stage）

本节在 §12.4「切片循环派生与 plan 门派生」基础上扩展，承载 split-slice-planner-stage 把 `[code]` 切片划分从 plan 段（merge 前）剥离、做成独立 `slice` 子流程（merge 后、implement 前）的派生；仍严格 **A 被动派生**（只派生、不自驱动跑测试、不代勾切片、不代切片）。

**(1) `slice` 子流程定义（launched，merge 与 implement 之间）**

- launched 在 `merge` 与 `implement` 之间新增 `slice` 子流程：单节点 `plan-slices`（`skill: slice-planner`，`produces: tasks.md` 的 `[code]` section，`done_when: tasks_code_filled`），出口 `gate:{type:human, position:exit, skippable:true}`，派生 `gate_id = slice-exit`（按 §11「`<subflow.id>-<gate.position>`」规则 = `slice-exit`）。
- 整个 `slice` 子流程带 `when: code_required`（§8）：纯文档提案（`[code]` 为空）时**整段跳过**（其所有节点视为 skipped），merge 后直接进入退化的 implement，切片循环按 §12.4(1) 空 `[code]` 退化为 `tests_green`，避免常驻激活把纯 docs/delta 小提案卡死。
- `plan` 段 `write-tasks` **不再产 `[code]`**：其完成判定由 `tasks_filled`（含 `[code]` 切片清单）收窄为 **`tasks_delta_filled`**——`[delta]`/`[deploy]` 脱模板即算完成，`[code]` 切片留待 merge 后由 `plan-slices`（slice-planner）对**已合并的规格 + 真实 UT/ST 测试 ID**撰写。切片的「唯一事实源」由 change-writer 平移到 slice-planner（仍是"一次定死、下游忠实消费"）。
- **新增两个 `done_when` 谓词（与既有 `tasks_filled` 同族）**：
  - `tasks_delta_filled` = `tasks.md` 的 `[delta]`/`[deploy]` section 脱模板（不要求 `[code]`），用于 `write-tasks`。
  - `tasks_code_filled` = `tasks.md` 的 `[code]` section 脱模板（已写出真实切片清单，**此时全部未勾**），用于 `plan-slices`。**与 `implement.code` 的 `section_complete:code`（全勾=实现完成）是两个不同判定**：前者判"切片已划定"（规划完成），后者判"切片已实现"。

**(2) 新增 `proposal_step` 值 `ready-to-implement`（merge 后切片待批准）**

- **新增 `proposal_step` 值 `ready-to-implement`**：spec-complete 完成（含纯代码提案的 no-delta `SPEC_MERGED`，见 §12.6）、真实测试 ID 已稳定后、切片循环尚未完成前、`slice` 出口 human 门「切片待批准」尚未放行时的驻留态。
  - 检测依据 = "`SPEC_MERGED` / `MERGED` 在场，且 `code_required`，且 `test_ids_ready`，且 `SLICES_APPROVED` 不存在，且 `[code]` 未全部勾选（切片循环未完成）"。
  - **该驻留态内的前沿随 `plan-slices` 完成判定 `tasks_code_filled` 二分**：`[code]` 仍为模板（未 `tasks_code_filled`）→ 前沿是 `plan-slices` 节点（`next_node.id == "plan-slices"`，**不带** `next_node.gate_id`，提示宿主唤起 slice-planner 规划切片）；`[code]` 已脱模板（`tasks_code_filled` 满足）→ `plan-slices` 完成，前沿移到 `slice` 出口门，此时 `next_node` **仍带节点标识 `id == "plan-slices"` 并附加 `gate_id == "slice-exit"`**（`id` 与 `gate_id` 共存，非二选一：`id` 标识刚完成的节点、`gate_id` 标识其后待批准的门；宿主见 `gate_id` 即知**不得重派该节点的 skill**，改按人类门处理）待批准。两种情况 `proposal_step` 均为 `ready-to-implement`。**（`next_node.gate_id` 的字段契约与 R8 派生规则见 `spec/cli-json-output.md` §11「next_node 编排提示字段」；本条为对该前沿子字段的规格来源，fix-next-node-slice-exit-frontier 前实现仅落地了顶层 `--auto` `gate_id`、`next_node.gate_id` 从未产出，致半自动 `ready-to-implement` 恒 `next_node.id == "plan-slices"` 无门信号、下游以 `next_node` 派活时重派 slice-planner 死循环——本次追平实现。）**
  - **`--auto` 放行前置（fix-post-merge-slice-planner-auto-skip）**：`ready-to-implement` 只是 slice 子流程的驻留态，不等价于 `slice-exit` 已到达。`next --auto` 消费 `slice-exit` 前，必须先判定 `plan-slices` 已完成，即 `tasks_code_filled == true` 且 `SLICES_APPROVED` 不存在。若 `[code]` 仍为模板、空 section 或仅含占位项（未 `tasks_code_filled`），则前沿仍是 `plan-slices` 节点：`next --auto` **不得**追加 `GATE_AUTO_PASSED{gate_id:"slice-exit"}`、**不得**写入 `SLICES_APPROVED`、**不得**把 `proposal_step` 前移到 `coding`，也**不得**进入 implement loop / code / verify。该响应应与默认 `next` 在前沿节点上一致，保留 `next_node.id=="plan-slices"`，供宿主派发 slice-planner。
  - **位置**：闭合枚举中置于 `merge-generated` 与 `coding` 之间。
- **gate 映射（`STEP_TO_GATE_SUBFLOW` 等价语义）**：`ready-to-implement` → `slice` 出口门（`gate_id = slice-exit`、`skippable:true`）。
- **当前节点映射（`STEP_TO_CURRENT_BUILTIN`）**：`ready-to-implement` → `plan-slices` 节点。

**(3) slice 门 `--auto` 放行 = 消费 gate（对齐 §12.4(2) plan 门写法）**

- **消费条件**：以下两个条件同时成立时，`next --auto` 才允许消费 `slice-exit`：
  1. 当前派生步骤为 `ready-to-implement`；
  2. `tasks.md` 的 `[code]` section 已满足 `tasks_code_filled`（至少有一个真实切片项，且不是 `[切片清单占位]` / `实现代码变更` / `Implement code changes` 等模板占位）。
- `next --auto` 在 `ready-to-implement` 自动放行 `slice-exit` 时，必须同时执行两个持久化动作：
  1. 向活跃提案目录 `GATE_AUTO_PASSED` 追加 `{gate_id:"slice-exit", proposal_step:"ready-to-implement", timestamp}` 审计行；
  2. 写入活跃提案目录的 `SLICES_APPROVED` **结构化 marker**（contract-self-description 起由「空文件」升级；类比 `plan-exit` 写 `PLAN_APPROVED`）——**JSON 单行**：`{"schema":"openlogos/slices-approved@1","approved_at":"<ISO 8601>"}`，消费 slice-exit 时**原子写入一次**；**已存在则不重写**（重复 `next --auto` 不刷新 `approved_at`）。存在性仍是「切片门已消费」的权威事实；`approved_at` 是 `loop_state.activated_at` 的持久时间源（§12.2）。
- **`SLICES_APPROVED` 结构化 marker 的统一写入/读取规则（contract-self-description）**：任何写入 `SLICES_APPROVED` 的 CLI 路径（含 `--auto` 消费与人工确认后的消费动作）一律按上述 JSON 单行格式**原子一次写入**、幂等（已存在不重写）；读取侧**兼容旧格式空文件**——视为已批准、无时间戳（`loop_state.activated_at` 省略），不报错、不要求迁移。
- 原有两个持久化动作保持不变，但只在上述消费条件满足后执行。若消费条件不满足，`slice-exit` 还未到达；此时即使 `slice` 子流程的出口 gate 定义为 `skippable:true`，也不能空过该门，因为跳过 `plan-slices` 会破坏“merge 后由 slice-planner 对真实规格 + 真实测试 ID 切片”的唯一事实源。
- **`SLICES_APPROVED` 的派生语义**：存在 `SLICES_APPROVED` 且 `[code]` section 尚未全部勾选时，`proposal_step` 派生为 `coding`。此时 `next` / `next --auto` 的前沿是 `implement.code`，`next_node.id == "code"`（**放行后同次响应即重新派生为 `coding`/`code` 前沿**，供无人值守 driver 立即派发 code-implementor 逐片实现）。放行后 `next_node` **不带** `gate_id`（门已消费，非"待批准"）。
- **幂等边界**：同一提案已存在 `SLICES_APPROVED` 时，`proposal_step` 不再是 `ready-to-implement`，重复 `next --auto` **不得**在同一个 `slice-exit` 固定点再次追加审计行，也**不得**重写 marker 内容（`approved_at` 一次写定、永不刷新）。
- **审计与授权边界**：`GATE_AUTO_PASSED` 仍是审计日志，默认 `next` 与 `status` 不因历史审计行越过 gate；切片门状态推进只认 `SLICES_APPROVED` 或实际 `[code]` 全部勾选完成。

**(4) 主动扩展 `proposal_step` 闭合枚举（破 INV）声明与影响面**

- **本次主动扩展 `proposal_step` 闭合枚举（破"枚举不新增"不变量）**，新增取值 `ready-to-implement`，理由 = **开发态方法论重画标准照**（与 change-flow-redesign 新增 `ready-to-delta` 同性质，见 §12.4(2)；§12.2「`loop-exhausted` 不新增 `proposal_step` 枚举值」仅约束 loop 达上限的表达方式，不妨碍本提案为 slice 门显式扩展闭合枚举）。
- **影响面逐条**：
  1. `spec/cli-json-output.md` §3.3 枚举集合 + §3.10 增量节（新增 `ready-to-implement`、label zh「切片待批准」）；
  2. `flow-derive`：`STEP_TO_GATE_SUBFLOW` 增 `ready-to-implement → slice`、`STEP_TO_CURRENT_BUILTIN` 增 `ready-to-implement → plan-slices`；
  3. `spec/cli-json-output.md` §11 `next_node.gate_id` 映射增 `ready-to-implement → slice-exit`、`skippable` 表增 `ready-to-implement → true`；
  4. `status` / `next` 标签输出 + `GATE_AUTO_PASSED` 审计支持 `gate_id:"slice-exit"`、新增 `SLICES_APPROVED` marker；
  5. golden baseline（`next --format json` / `status` 快照）重拍，差异须仅为新步骤/新门字段；
  6. **下游消费方** runlogos driver 对 `proposal_step` 做 switch 的分支需容纳新值——列为下游 follow-up，不在本提案 `[code]` 范围（openlogos CLI 侧先落地，runlogos 升级方法论后单独适配）。

### 12.6 纯代码提案（无 `[delta]`）派生：no-delta spec-complete（support-nodelta-spec-complete）

本节统一纯代码级修复提案的状态语义：`delta_required==false` 只表示不进入 `write-delta`，不表示规格阶段已完成。所有需要代码实现的提案在进入 `plan-slices` 前都必须有可追踪的 spec-complete marker。

**(1) 核心规则**

- `delta_required == false`（`tasks.md` 无 `## [delta]` section）时，`proposal_step` **永不为 `delta-writing`**、`next_node.id` **永不为 `write-delta`**。
- 若 `code_required==true` 且缺少 `SPEC_MERGED` / `MERGED`，派生必须停在 `spec-complete-required`，诊断 `reason:"no_delta_spec_marker_missing"` 或等价结构化原因；`next_node` 不得指向 `plan-slices`。
- 用户或 driver 执行 `openlogos merge <slug>` 时，若没有可合并 delta，CLI 执行 no-op merge 并写入 `SPEC_MERGED`。marker 内容建议包含 `type:"no_delta_spec_complete"`、`reason`、`completed_at`。
- spec-complete 已完成但真实 `UT-*` / `ST-*` / `SMOKE-*` ID 不可解析时，派生必须停在 `test-id-required`，诊断 `reason:"code_change_requires_real_test_ids"`；不得派发 `slice-planner`。
- 只有 `SPEC_MERGED` / `MERGED` 在场且 `test_ids_ready==true` 时，代码提案才可进入 §12.5 的 `ready-to-implement` / `plan-slices`。

**(2) 纯代码提案派生矩阵**

| 前置状态 | `proposal_step` | `next_node` |
|---|---|---|
| 无 `[delta]`、`code_required==true`、缺少 `SPEC_MERGED` / `MERGED` | `spec-complete-required` | 不指向 `plan-slices`；提示执行 `openlogos merge <slug>` |
| `SPEC_MERGED` / `MERGED` 在场、缺真实测试 ID | `test-id-required` | 不指向 `plan-slices`；提示补充或声明复用真实测试 ID |
| `SPEC_MERGED` / `MERGED` 在场、测试 ID 已稳定、`[code]` 未 `tasks_code_filled` | `ready-to-implement` | `id: plan-slices`（无 `gate_id`） |
| `SPEC_MERGED` / `MERGED` 在场、测试 ID 已稳定、`[code]` 已 `tasks_code_filled`、未全勾、无 `SLICES_APPROVED` | `ready-to-implement` | `id: plan-slices` + `gate_id: slice-exit` |
| `SLICES_APPROVED` 在场且 `[code]` 未全勾 | `coding` | `id: code`（无 `gate_id`） |
| 无代码需求，或 `[code]` 全勾 | `ready-to-verify` | `id: verify`（无 `gate_id`） |

**(3) 前置协同（change-writer 模板）**

- `write-tasks`（change-writer）的纯代码修复模板必须保留空 `## [code]` 标题行；该标题表达 `code_required==true` 与后续切片承载区。
- 保留空 `## [code]` 不等于切片已规划。切片只能由 `slice-planner` 在 spec-complete 与真实测试 ID 门禁通过后写入。
- 旧格式兜底不变：`tasks.md` 完全无 `## [tag]` 标题（`parseTaskSections==null`）仍走既有旧格式兜底；历史遗留提案应重跑 `write-tasks` 或手工补齐结构化标题。

**(4) 主动破例声明与影响面**

- 本节收窄此前“无 `[delta]` 即 spec/merge 空过”的派生规则。新的唯一事实源是 `SPEC_MERGED` / `MERGED` marker。
- 影响面：`status` / `next` / driver 对无 `[delta]` 代码提案必须先处理 `spec-complete-required` 或 `test-id-required`，不得在缺 marker 或缺测试 ID 时派发 `plan-slices`。

### 12.7 提前填充的 [code] auto-reset（enforce-slice-stage-ordering）

**问题**：`isTasksCodeFilled`（判 `tasks_code_filled`）是纯内容判据，不带时序前置，无法区分「slice-planner 在正确时机（merge 后）划的切片」与「`write-tasks`（plan 段、merge 前）AI 提前填的切片」——两者磁盘状态相同。提前填充使 §12.5 / §12.6 派生把前沿直接判到 `slice-exit` 门（有 delta 提案 merge 后）或 `ready-to-implement` 已 `tasks_code_filled`（纯代码提案），**跳过 slice-planner 独立环节**。

**（1）提前填充的定义**

`[code]` 已 `tasks_code_filled`，但「slice 阶段尚未合法进入」：
- 有 delta 提案（`delta_required==true`）：`SPEC_MERGED` 尚不在场；
- 任一需要代码的提案：`SPEC_MERGED` / `MERGED` 尚不在场，或 `[code]` 填充发生在合法 slice 阶段之前。

**（2）auto-reset 触发点（确定性 CLI 动作，不依赖 AI）**

在「进入 slice 段 / 放行 slice-exit」的确定性 CLI 动作上，若检测到 `[code]` 已 `tasks_code_filled` 但非 slice-planner 正常产出，则先清理再继续：
- **所有代码提案 → `openlogos merge`**（有 delta 时生成/执行真实 merge；无 delta 时执行 no-op merge）。在写入 `SPEC_MERGED` 前，若检测到 `[code]` 已脱模板且不是合法 slice-planner 产物，先执行 auto-reset，再进入 slice 段。此后 `[code]` 恒为空或占位，slice-planner 正常填。

**（3）清理动作**

- 把 `tasks.md` 的 `## [code]` section 重置为模板占位（等价 change-writer 纯代码模板：保留空 `## [code]` 标题、令 `isTasksCodeFilled==false`）；
- 被清理的旧 `[code]` 原文备份到提案目录 `CODE_AUTORESET`（append-only jsonl，每行含 `ts` / 触发点 `trigger:"merge"` / 旧 `[code]` 原文），可追溯、非无痕删除。

**（4）幂等**

`[code]` 已是占位（未 `tasks_code_filled`）时，触发点不清理、不追加 `CODE_AUTORESET`。重复 `merge` / 重复触发 slice-exit 守卫不产生重复备份。

**（5）被动派生边界（A 被动派生不变）**

auto-reset 是**命令副作用**，只发生在 `openlogos merge` 这个本就有副作用的动作上。`status` / 默认 `next` / `flow-derive` 的**派生路径保持只读**，绝不触发清理。清理后 `[code]` 恒为空进入 slice 阶段，§12.5 / §12.6 派生自然落「前沿 `plan-slices` → 唤起 slice-planner」，派生规则本身一行不改。

**（6）扩展的副作用（显式登记，未破枚举 / 判据 INV）**

- EXT-1：`openlogos merge` 副作用扩展——除生成 `MERGE_PROMPT` / 应用 delta 外，新增「进入 slice 前 auto-reset 提前填充的 `[code]`」，保持 merge 幂等。
- EXT-2：no-delta merge 副作用扩展——无 delta 代码提案同样经过 `openlogos merge`，因此提前填充兜底统一收敛在 merge 落点，不再需要额外 slice 进入 marker。
- 不破 `isTasksCodeFilled` 判据、不破 `proposal_step` 闭合枚举（**不新增阻断态**）、不破 A 被动派生。

**（7）残留边界**

半自动与无人值守模式均通过 `openlogos merge` 进入 spec-complete，因此提前填充兜底不依赖 `--auto`。若用户绕过 CLI 手写 marker，仍可能跳过该兜底；此类越权写入由 guard / review 层处理。

### 12.8 no-delta spec-complete 与测试 ID 门禁

无 `[delta]` 的纯代码提案不进入 `write-delta`，但必须执行 no-delta spec-complete：

```text
openlogos merge <slug>
```

当 `deltas/` 为空或没有可识别 delta 文件时，`merge` 执行 no-op merge 并写入 `SPEC_MERGED`。新写入内容应为：

```json
{
  "type": "no_delta_spec_complete",
  "reason": "pure-code proposal has no spec delta",
  "completed_at": "..."
}
```

已有空 `SPEC_MERGED` 作为兼容 marker 仍可读取；新实现不得继续写空文件。

新增前沿状态：

- `spec-complete-required`：代码提案缺少 `SPEC_MERGED` / `MERGED`。该状态不是 human gate，`--auto` 不得跳过；`next_node` 不得指向 `plan-slices`。
- `test-id-required`：spec-complete 已完成，但真实 `UT-*` / `ST-*` / `SMOKE-*` ID 不可解析。该状态不是 human gate，`--auto` 不得跳过；`next_node` 不得指向 `plan-slices`。

派生顺序：

1. `VERIFY_FAIL` 等既有全局失败优先级不变。
2. proposal/tasks 未脱模板仍为 `writing`。
3. plan gate 逻辑不变。
4. 有 `[delta]` 的提案按 `delta-writing → ready-to-merge → merge-generated` 推进。
5. 无 `[delta]` 的代码提案跳过 `write-delta`，但若缺 `SPEC_MERGED`，停 `spec-complete-required`。
6. spec-complete 完成后，若代码提案缺测试 ID，停 `test-id-required`。
7. 两个门禁均通过后，才可进入 `ready-to-implement` / `plan-slices`。

### 12.9 缺失 [code] section 的代码必需态兜底（fix-missing-code-section-slice-gate）

本节修复一个 post-merge 假阴性：有 `[delta]` 的 launched 提案在 merge 后实际需要代码实现，但 `tasks.md` 完全缺失 `## [code]` section 时，派生不得把“缺失 section”解释成“无需代码，可直接 verify”。`code_required` 必须由提案意图、任务结构、已合并 delta 与测试规格变化共同推导，而不是只由非空 `[code]` section 决定。

**(1) `code_required` 的多信号判定**

`code_required` 为真至少包含以下任一条件：

- `tasks.md` 存在 `## [code]` section（即使 section 为空或仅为模板占位，也表示需要进入 slice 规划）；
- `proposal.md` 声明变更类型为代码级修复，或变更概述/范围明确包含业务代码、CLI 派生、DriverLoop、AgentAdapter、reporter、runner、测试覆盖实现等实现对象；
- `tasks.md` 的 `[delta]` section 指向 `deltas/test/**`，且 delta 新增或修改 `UT-*` / `ST-*` / `SMOKE-*` 测试用例，这些测试用例要求后续业务代码、测试代码或 OpenLogos reporter 落地；
- 已合并规格中新增或修改测试 ID，且 proposal 未明确声明“纯文档/无需代码实现”；
- delta 文档明确要求后续实现源代码、测试代码、runner、reporter、golden 或面板展示变更。

显式纯文档提案仍允许 `code_required=false`：proposal 明确声明无需代码，`tasks.md` 无 `[code]`，delta 不新增实现相关测试 ID，也不要求 runner/reporter/source 变更时，slice 子流程按既有规则整段跳过。

**(2) post-merge 派生规则**

`SPEC_MERGED` / `MERGED` 在场、`test_ids_ready==true` 且 `code_required==true` 时：

- `tasks.md` 缺失 `## [code]` section、`[code]` 为空、或仅含模板/占位项，均表示切片尚未规划；
- 派生必须停在 `ready-to-implement`，前沿为 `next_node.id=="plan-slices"`，且 `next_node.gate_id` 省略；
- `plan-slices` / `slice-planner` 被允许创建缺失的 `## [code]` section，并写入真实切片；
- `next --auto` 不得写 `SLICES_APPROVED`，不得追加 `GATE_AUTO_PASSED{gate_id:"slice-exit"}`，不得派生 `coding` / `code`，也不得派生 `ready-to-verify` / `verify`。

这条规则优先于 §12.4 的“空 `[code]` 退化为 `tests_green`”。空 `[code]` 退化只适用于 `code_required==false` 的纯文档/退化 implement 场景；不适用于“需要代码但切片缺失”的非法态。

**(3) 诊断输出**

当 `code_required==true` 且 `tasks.md` 缺失 `## [code]` section 时，CLI 应尽量返回可行动诊断，供 driver 和用户区分“未规划切片”与“无需代码”：

```text
reason=tasks-code-section-missing
tasksPath=logos/changes/<slug>/tasks.md
remediation=补空 ## [code] section 后重新进入 plan-slices，或由 slice-planner 创建 section
```

当 `## [code]` 存在但未脱模板时，可使用 `reason=slices-not-planned`。上述诊断不改变 proposal_step 枚举，仍复用 `ready-to-implement`；它只约束 next_node 与可执行动作。

**(4) 不变量**

- 缺失 `[code]` 不再自动等价于 `code_required=false`。
- `code_required=true` 且切片未规划时，`loop_state` / `slice_state` 不得驱动宿主进入 `_loopRepair()` 或 canonical verify。
- `SLICES_APPROVED` 只能在真实 `[code]` 切片满足 `tasks_code_filled` 后产生。
- 纯文档提案不被误伤：明确无需代码且没有实现相关测试 delta 的提案，仍可跳过 slice 子流程。

## 步骤注册表与 step_meta（contract-self-description）

本章确立 `proposal_step` 的**唯一铸造点**与自描述元数据 `step_meta`，根治「driver 用本地缓存的步骤枚举反推语义、随 CLI 演进反复漂移」这一假死误杀源头（提案 C1）。

### 唯一铸造点：`cli/src/lib/step-registry.ts`

- CLI 内建**步骤注册表**，路径固定为 `cli/src/lib/step-registry.ts`；**任何代码路径产生 `proposal_step` 必须经注册表**。
- 收敛既有分散铸造点：`detectProposalStep`（`proposal-lifecycle.ts`）与 `detectProposalStepViaFlow`（`flow-derive.ts`）两套镜像实现收敛为一，`status` / `next` 中直接产字面量或覆盖 `proposal_step` 的点一并改经注册表。
- **CI lint（挂测试）**：全仓扫描「字面量赋给 `proposal_step` 却不在注册表 / 不经注册表」→ 测试失败。

### `step_meta` 自描述

- `status` / `next` 的 `modules[].active_change` 随步骤携带 `step_meta: {phase, kind}`（JSON 契约与挂载位置见 `spec/cli-json-output.md`）：
  - `phase ∈ pre-implement | implement | post-implement`；
  - `kind ∈ produce | gate | command-required | residency`。
- **`step_meta` 不构成第二枚举**——`phase` / `kind` 是小闭合枚举，且契约明文规定：**消费方遇未知值必须走保守分支**（规范性引用，消费方行为验收归 runlogos R5）。

### 全量注册表（phase / kind 表）

**本提案不新增 `proposal_step` 枚举值**，注册表覆盖既有全集：

| proposal_step | phase | kind |
|---|---|---|
| writing | pre-implement | produce |
| ready-to-delta | pre-implement | gate |
| delta-writing | pre-implement | produce |
| ready-to-merge | pre-implement | gate |
| merge-generated | pre-implement | command-required |
| spec-complete-required | pre-implement | command-required |
| test-id-required | pre-implement | residency |
| ready-to-implement | pre-implement | residency |
| coding | implement | produce |
| ready-to-verify | implement | command-required |
| verify-failed | implement | residency |
| verify-passed | post-implement | residency |
| ready-to-deploy | post-implement | gate |
| deploy-done | post-implement | residency |
| ready-to-smoke | post-implement | command-required |
| smoke-passed | post-implement | residency |
| smoke-failed | post-implement | residency |
| implementing（旧兼容） | implement | produce |
| in-progress（旧兼容） | implement | produce |

### 与 loop_state 激活判据的一致性（生产者反面锚）

- 注册表的 `phase` 与 §12.2 的 implement 进入判据必须一致：**`phase == pre-implement` 的任何步骤下 `loop_state` 不得输出**（`pre-implement + loop_state` 是非法组合）。
- **生产者一致性漂移注入测试**：在 CLI 注册全新步骤（如 `x-future-step`, `phase=pre-implement`）→ 断言 (a) 注册表 / `step_meta` / schema 三方同步、schema 校验通过；(b) 该 pre-implement 步骤下 `loop_state` 不输出（断言非法组合不存在，而非固化为合法夹具）。

## 派发元数据 dispatch 与 requires_reviewed（contract-self-description）

本章定义 flow 节点的派发元数据契约（提案 C4），消灭「driver 用本地 allowlist 猜哪类派活重投安全」这一误杀根源（transient-ambiguous 秒杀非幂等派发的结构根因）。拍板原则：**宁慢勿错杀**。

### 数据源与继承规则（事实源闭合）

- **权威数据源 = flow 节点定义**：内置模板 `spec/flow/initial.yaml`、`spec/flow/launched.yaml` **逐节点人工声明** `dispatch`；显式声明则以声明为准。
- **不从 `produces` / `done_when` 推导**——推导算法本身会成为新的隐式世界模型，违背契约自描述宗旨。
- resolved flow 派生把节点元数据**物化并透传**进 `next_node`：**`next_node.dispatch` 恒为完整对象 `{idempotent, timeout_seconds, artifacts_hint}`，无二义分支**（JSON 契约见 `spec/cli-json-output.md` §11）。
- 节点可另声明 `requires_reviewed: string[]`（执行前置评审对象；内置 launched 的 `apply-merge` 声明 `["proposal","delta"]`）；driver 的 `priorReviewNode` 本地映射表退化为消费该声明。未声明的节点不输出该字段。

### overlay-add 未声明 `dispatch` 时的完整保守默认

```yaml
dispatch:
  idempotent: false            # 未声明即视为重投不安全（宁慢勿错杀）
  timeout_seconds: <flow 文件 defaults.dispatch.timeout_seconds>
  artifacts_hint: []           # 空数组 = 「产物未知」，语义写入契约：
                               # 消费方不得以 artifacts_hint 为空/不达作为判死依据，只能升级观察
```

- 保守默认是**完整对象**，节点 schema 校验按完整对象通过（消灭实现自行猜测）。
- S25（overlay 派生）测试补「overlay-add 未声明 dispatch → 输出完整保守默认对象且过 schema」用例。

### `defaults.dispatch.timeout_seconds`（唯一默认值源 fallback）

- `timeout_seconds` 的**唯一默认值源（fallback）** = flow 文件顶层 `defaults.dispatch.timeout_seconds`（§3）：内置模板给出具体数值（900）；**resolved 时物化进每个未显式声明的节点，输出层不再有第二处默认**。
- **优先级链（全链统一，见 §10.5）**：builtin `defaults` < overlay 顶层 `defaults` < 节点显式 `dispatch.timeout_seconds`（builtin 特例或 overlay-add 声明）< overlay `modify` 的节点级 `set.dispatch.timeout_seconds`。
- **作用域澄清**：顶层 `defaults` 是「唯一**默认值**源」而非唯一取值来源——节点显式 override 优先；项目 overlay 覆盖 `defaults` 只影响未显式声明 `timeout_seconds` 的节点，不改写 code(3600)/deploy(1800) 等显式特例。内置模板**仅特例节点显式声明** `timeout_seconds`，其余节点一律省略、由 defaults 物化。

### `artifacts_hint: []` 的契约语义

- `artifacts_hint: []` ＝**「产物未知」**，是契约语义而非缺省缺失；消费方**不得**以 `artifacts_hint` 为空或产物未出现作为判死依据，**只能升级观察**（消费方行为验收归 runlogos R5）。

### 内置节点声明基准

- **内容产出 / 评审类节点**（write-proposal、write-tasks、write-delta、plan-slices、review 类、code）：`idempotent: true`；
- **一次性落盘 / 执行类节点**（apply-merge、deploy、archive 类）：`idempotent: false`；
- **verify / smoke 命令节点**：`idempotent: true`；
- `timeout_seconds`：默认 900，code / implement 类 3600，deploy 类 1800；
- `artifacts_hint` 写该节点的**具体产物提示**（如 `["proposal.md"]`、`["logos/resources/**","SPEC_MERGED"]`）；
- `apply-merge` 另声明 `requires_reviewed: ["proposal","delta"]`。

### 向后兼容

- `dispatch` / `requires_reviewed` / 顶层 `defaults` 均为**向后兼容扩展**：flow 文件 schema **`version: 1` 保持不变**；旧 flow 文件（无这些字段）解析行为不变，未声明节点按上述保守默认物化。

## 13. M1 / M2 边界总表

> **图例**：下表「M1」列 = **当前已实现/可用**（含 M2 各切片 S26–S29 已点亮的能力）；「M2」列 = **后续待实现**。
> 标签括注 `（M2 切片 …/S…）` 表示该能力虽属 M2 范围、但已在对应切片交付。

| 能力 | M1 | M2 |
|---|---|---|
| 声明式 flow 模型（node/subflow/gate/when/for_each/overlay） | ✅ | — |
| 派生 status/next/watch、flow show --resolved | ✅ | — |
| 内置 initial/launched 模板（1:1 搬家、行为不变） | ✅ | — |
| skip-human-gate（skippable × auto） | ✅ | — |
| fan-out 单实例谓词 = 文件/marker | ✅ | — |
| overlay 驱动派生 + node 级承载（M2 切片 1a） | ✅ | — |
| `cmd:` 谓词（仅 overlay-add、next 求值、status/watch pending）（M2 切片 1b） | ✅ | — |
| `loop.max_iters > 1` 真迭代、测试绿收敛（仅 overlay `set-loop` 激活）（M2 切片 2） | ✅ | — |
| next 暴露 next_node 编排提示（S28） | ✅ | — |
| `exhausted_gate.skippable` overlay 覆盖 / auto 放行非收敛代码（S29） | ✅ | — |
| fan-out 聚合阈值 `coverage_threshold`、loop 内「整组收敛」定死（S29） | ✅ | — |
| `cmd:` 谓词放开到 overlay-modify 的 verify/deploy/smoke gate（modify-cmd-on-builtin，S30） | ✅ | — |

## 14. 版本

- 0.1.0：M1 草案。确立数据模型与内置模板结构；M2 字段已预留但不实现。

## 自动流程可恢复失败与 dispatch 完成状态分层

### 13. 自动流程韧性

#### 13.1 完成状态

agent dispatch 的完成校验不得只输出 pass/fail。OpenLogos / driver 至少应支持：

| 状态 | 定义 | 后续 |
|---|---|---|
| `slice_done` | 当前切片合同满足，focused tests / reporter pass | 继续下一切片或 verify |
| `slice_done_global_verify_failed` | 当前切片合同满足，但全量 verify 失败 | 派 repair / code |
| `slice_incomplete` | 当前切片合同缺 artifact、测试或 reporter | 重派当前切片 |
| `invalid_done_claim` | agent 声明与磁盘事实矛盾 | 要求更正或重派 |
| `no_progress` | 无产物、无测试、无状态推进 | 消耗 retry 预算 |

#### 13.2 失败原因

`claimed-done-but-unverified` 只能作为兼容显示，不得作为唯一机器原因。结构化原因包括：

- `artifact-missing`
- `artifact-out-of-scope`
- `focused-tests-missing`
- `reporter-missing`
- `global-verify-failed`
- `driver-cannot-validate-artifacts`
- `no-progress`

#### 13.3 retry / block 升级

`retry-exhausted` 只表示多轮无进展或不可恢复失败。以下情况不得直接升级为 `retry-exhausted`：

- 已验证 artifacts 存在；
- 本片 reporter 证据存在；
- focused tests 已通过；
- 全量 verify 有明确失败测试；
- 下一步可由 repair / code 继续推进。

#### 13.4 建议下一节点

当 `global-verify-failed` 且存在 validated artifacts 时，`suggested_next_node` 应为 `code` 或等价 repair 节点，`human_action_required=false`。当缺少 artifacts 或 reporter 时，建议节点应指向当前切片重派或补证据流程。当失败涉及产品取舍、越权 artifact 或硬红线时，`human_action_required=true`。

#### 13.5 自动流程诊断的前沿隔离

`automation_diagnostic` 的消费必须服从当前 flow 前沿。`global-verify-failed` 是实现/验证闭环中的 repair 信号，不是跨阶段全局抢占信号。

##### 合法消费前沿

只有当前前沿已经进入 implement loop，或明确处于 verify 失败后的修复闭环时，`next` 才能把 `global-verify-failed` 提升为 repair/code 建议：

- `coding`
- `ready-to-verify` 且已有本轮代码实现 / reporter 证据
- `verify-failed`
- implement loop 未收敛、未达上限的 repair 轮次

##### 禁止抢占前沿

以下前沿必须优先保留自身 flow 语义，不得被历史 verify 诊断覆盖：

- plan：`writing`、`ready-to-delta`
- spec：`delta-writing`、`ready-to-merge`
- merge：`merge-generated`
- slice：`ready-to-implement` 下的 `plan-slices` 节点或 `slice-exit` 门
- deliver / close：`ready-to-deploy`、`deploy-done`、`ready-to-smoke`、`smoke-passed`

在禁止抢占前沿，`next_node` 由当前前沿派生规则决定。例如 `delta-writing` 仍是 `write-delta`，`ready-to-merge --auto` 仍返回 merge command，`ready-to-implement` 未规划切片时仍是 `plan-slices`。

##### 与 `next_node` / gate 的优先级

优先级从高到低：

1. 当前 flow 前沿的 gate / node 派生；
2. `next --auto` 对可跳 gate 的本次放行结果；
3. 当前实现/验证闭环内的 `automation_diagnostic` repair 建议；
4. 历史诊断或只读诊断。

因此，`ready-to-merge` 的 `spec-exit` command、`ready-to-delta` 的 `plan-exit`、`ready-to-implement` 的 `plan-slices` / `slice-exit` 均高于 stale `global-verify-failed`。

## GUI UI-first overlay 节点与 ui_impact when-flag

本章定义方法论为 **GUI 产品项目**（网站 / 桌面应用 / 移动 App）提供的 **UI-first flow overlay**，把
「UI/UX 确认前移到批准提案门」落成两个 **overlay-add 节点**。**这两个节点不硬编码进 builtin
`launched.yaml`**——只由方法论 GUI overlay 以 `op:add` 注入项目实例
`logos/flow/launched.yaml`。只有作为 overlay-add 节点，它们才**合法**使用 `done_when: cmd:`（§9.2 / §10.3）。
非 GUI 项目不注入该 overlay，特性零启用、流程零改动。

> **占位符 vs 可执行命令（关键）**：本章正文与代码示意里出现的 `cmd:<check-ui-prototype>` / `cmd:<check-ui-hash-match>` 中
> 的尖括号 `<...>` **仅为文档示意占位**——`<...>` 是 shell 重定向语法，若真写进 overlay 会必然非零、节点永久 pending。
> **运行时 overlay 资产（`gui-ui-first.yaml`）必须写确定可执行命令**：`done_when: "cmd:openlogos check-ui-prototype"` 与
> `done_when: "cmd:openlogos check-ui-hash-match"`。这两个是本提案 [code] 交付的**真实 CLI 子命令**：在**项目根 cwd** 运行、
> **自行解析活跃提案**（无需 slug 参数）、exit 0 = 通过 / 非 0 = 未通过。

### overlay 唯一源文件与注入机制

- **唯一源文件**：`spec/flow/overlays/gui-ui-first.yaml`（随 CLI 分发的方法论资产，纯 overlay 片段，含本章两个完整 `op:add`）。
  这是这两个 UI-first 节点定义的**唯一事实源**——各项目**不手写**这两个节点。
- **注入命令**：`openlogos init` / `openlogos sync`。
- **`product_type` 唯一源**：`logos-project.yaml` 的 `modules[].product_type`（枚举 `web|desktop|mobile|cli|api|library|skills|service`；
  GUI 集合 = `{web,desktop,mobile}`；字段缺失 = 非 GUI）。**不引入第二处 product_type 判定源**。
- **注入条件（项目实例级）**：仅当**项目含 ≥1 GUI 模块**（存在某 `modules[].product_type ∈ {web,desktop,mobile}`）时，把 overlay 注入项目实例；
  项目**无任何 GUI 模块**（全部为 `cli`/`api`/`library`/`skills`/`service` 或缺失）→ **不注入**。
- **节点参与（module-aware）**：注入 ≠ 恒参与。节点是否参与由 `when: ui_impact` 决定，`ui_impact` 针对**活跃提案所属 module** 的
  `product_type` 求值——活跃提案落在非 GUI 模块 → 节点 `when` 不满足 → **skip**（即使 overlay 已在项目实例注入）。
- **注入去向**：把 `gui-ui-first.yaml` 的两个 `op:add` 合并进**项目实例** `logos/flow/launched.yaml`；该实例
  `extends: builtin:launched@v1`，即在 builtin launched 基线之上叠加这两个 overlay-add 节点。
- **builtin 不承载**：`spec/flow/launched.yaml`（builtin 源）**始终不含**这两个节点，只在文件头注释标注该 overlay 扩展点。
  故 builtin 侧无 `cmd:` 谓词、无 `FLOW_SCHEMA_INVALID` 风险；`cmd:` 合法性完全由「overlay-add 节点身份」保证。

### 触发条件（`when: ui_impact`）

两个节点均带 `when: ui_impact`（§8 新增 when-flag，**module-aware**，`product_type` 唯一取 `logos-project.yaml modules[].product_type`）：
- `ui_impact == false`（活跃提案 module 非 GUI，即 `product_type ∈ {cli,api,library,skills}` 或缺失、或声明段 `ui_impact:false`）→ 两节点 `when` 不满足、**skip**，流程与今天完全一致；
- `ui_impact == true`（活跃提案 module `product_type ∈ {web,desktop,mobile}` + 声明段 `ui_impact:true`）→ 两节点参与流程。

### 节点一：`write-ui-prototype`（plan-exit 门前产原型）

方法论 GUI overlay 以 `op:add` / `after: write-tasks` 注入，落在 launched `plan` subflow 内、**`plan-exit` 门之前**：

```yaml
- op: add
  after: write-tasks              # 落在 plan subflow 内、plan-exit（gate）门前
  node:
    id: write-ui-prototype
    name: 产出 UI 原型
    skill: change-writer          # change-writer 调用 ui-ux-pro-max（product-designer Step 5a 子流程）
    when: ui_impact
    produces: deltas/prd/2-product-design/2-page-design/
    done_when: "cmd:openlogos check-ui-prototype"   # 运行时资产必为可执行命令；正文 <...> 仅示意
```

- **产物**：逐页原型 `deltas/prd/2-product-design/2-page-design/core-NN-<slug>.html`（裸 HTML，关键几屏 + 各状态）
  + 提案目录 `design-system.json`（ui-ux-pro-max 令牌，审计追溯；仅 `design_system_mode: generated` 时产出，`fallback` 时以降级原因替代，见下）。
  走现有 delta 路径，**不新增 `ui/` 目录**。
- **授权链**：原型产出是 **plan 节点门前的普通内容生成**，授权同「写 `proposal.md` / `tasks.md`」——**不新增授权、不新增门**。
  其写入由 guard 的 **plan 阶段 allowlist（仅放行 `2-page-design/*.html`）** 授权，越界路径被 guard 拒。
- **`done_when: cmd:openlogos check-ui-prototype` 的富对账（机器收敛，随 `design_system_mode` 变化）**（正文示意常写作 `cmd:<check-ui-prototype>`，运行时资产为可执行命令 `openlogos check-ui-prototype`）：作为 overlay-add 节点，`cmd:` 合法（§9.2）。
  命令做**富对账**，`exit 0` 才判该节点 done、`plan` 子流程才完成、`plan-exit` 门才可放行。对账口径**随 UI/UX 变更声明段的
  声明字段 `design_system_mode` 分流**（F2）：
  - **公共项（两种模式都必须满足）**：
    1. **逐页非空**：UI/UX 变更声明段**声明的每一个页面**，在 `2-page-design/` 下都有**对应的非空原型文件**（非「至少一个」）；
    2. **声明清单 == 产出文件**：声明页清单与实际产出原型文件集合按 **basename 集合**比较一致（结构化对账，见下）；
    3. **内容 hash 记录**：命令记录逐文件内容 hash（供批准时写入 `PLAN_APPROVED.hashes`、下游防漂移比对）。
  - **`design_system_mode: generated`（走了设计系统）**：额外要求提案目录存在**合法非空**的 `design-system.json`
    （ui-ux-pro-max 令牌，**禁伪造令牌**）。
  - **`design_system_mode: fallback`（降级 / 未走设计系统）**：**不要求** `design-system.json`，改为要求声明段有**非空**的
    `design_system_fallback_reason`（降级原因，如 Python3 缺失）；此模式下缺 `design-system.json` **不判失败**。
  任一适用项不满足 → `cmd` 非 0 → 节点未 done → plan-exit 门前无「已对账原型」可放行。由此富对账成为 plan-exit 前的**机器收敛条件**
  （替代过弱的 `dir_nonempty`「至少一个文件」）。
- **声明清单为结构化记录 + basename 集合比较（F3）**：UI/UX 变更声明段的页面清单是**结构化条目**，每条含
  `id` + **精确 basename** `prototype: core-NN-<slug>.html` + `description`。checker 把**声明的 basename 集合**与
  `2-page-design/` 下**实际产出文件的 basename 集合**做**集合相等**比较（不是子串包含、不是「至少一个」）——多一个、少一个、命名不符均判不一致。
- **残差（如实标注）**：`design_system_mode: generated` 下，「HTML 是否*真出自* ui-ux-pro-max」除 `design-system.json` 令牌可追溯外
  **无法纯机器证明**——既有 acceptance 口径下的荣誉制 + 令牌追溯限制，如实记录、非遗漏。
- **[code] 触点**：CLI 子命令 `openlogos check-ui-prototype`（项目根 cwd、自行解析活跃提案、exit 0/非 0）由 implement 阶段实现（本 delta 只定契约）。

### 节点二：`verify-ui-provenance`（merge 前拦漂移）

方法论 GUI overlay 以 `op:add` / `before: generate-merge-prompt` 注入，落在 **merge 之前**（原型落盘 resources 之前拦截漂移）：

```yaml
- op: add
  before: generate-merge-prompt   # merge subflow 入口、原型落盘 resources 之前
  node:
    id: verify-ui-provenance
    name: 校验 UI provenance
    when: ui_impact
    produces: null
    done_when: "cmd:openlogos check-ui-hash-match"   # 运行时资产必为可执行命令；命令内部三分支
```

- **单 `done_when: cmd:openlogos check-ui-hash-match`，命令内部【三分支】**（正文示意常写作 `cmd:<check-ui-hash-match>`，运行时资产为可执行命令）：
  仍是**单 `done_when: cmd:`**（无 `fail_when`），不触发 §9.2 决策 B「同节点 done_when/fail_when 均为 cmd:」；作为 overlay-add 单 cmd:，合法。
  该节点**仅以 `when: ui_impact` 控参与**，故 GUI `ui_impact:true` 但**旧空 `PLAN_APPROVED`（无曾渲染证据）**的 legacy/degraded 提案**仍会进入本节点**；
  若命令只有「匹配→0 / 缺失失配→非0」两果，空 marker 无 hashes 将**永远无法匹配**、节点永久未 done → advisory 放行不可达（旧面板卡死）。故命令内部按
  **持久化批准记录（`PLAN_APPROVED`）**分三支（与 merge / 落盘同一批准记录分支、以持久化记录为键，与 F4 R7 一致）：
  1. **`PLAN_APPROVED` 含 UI provenance**（`ui_prototype_rendered:true` + `pages` + `hashes`）→ 重算 `2-page-design/` 现值 hash 与固化 `hashes` 比对：
     **完好且全匹配 → exit 0**（节点 done → 放行前进）；**缺失 / 损坏 / 失配 → 非 0（fail closed 阻断）**。
  2. **legacy/degraded，或旧空 marker 且无任何「曾渲染」证据**（无 `ui_prototype_rendered`、无 `hashes`）→ **记 advisory 后 exit 0**
     （节点 done → merge 可达）。**← 新增的第三成功分支**，专解「旧空 marker 永久未 done、advisory 放行不可达」的卡死。
  3. **部分 / 损坏 provenance**（`ui_prototype_rendered:true` 但缺 / 空 `hashes`）→ **不得**误判为 legacy → **fail closed（非 0）**。
  即：匹配成功 **或** 合法 legacy（分支 2）都 `exit 0`；失配 / 损坏 / 部分 provenance（分支 1 尾、分支 3）非 0。
  失配非 0 时节点未 done（active/pending）→ **前向阻断**，remediation 见下方状态转换。
- **状态转换（诚实边界）**：flow 引擎**前向线性、无跨 subflow 自动回退边**。「退回 plan-exit」**非引擎自动 rewind**——
  `verify-ui-provenance` 未 done ⇒ 阻断；remediation = **driver / 人工显式重入 plan**（重跑 producer 产原型 + plan-exit 重批，
  刷新 `PLAN_APPROVED.hashes`）→ 再到该节点时 hash 匹配 `exit 0` → done → 放行。即「失配即卡在未 done + 显式重入刷新」，
  不假装引擎自动倒转。
- **与 merge 命令级校验的关系**：本节点只拦 **driver 流**；`openlogos merge <slug>` 直接调用另有命令级 hash gate（见提案 F4 R5，
  merge.ts 落地），二者互为纵深防御。[code] 触点：CLI 子命令 `openlogos check-ui-hash-match`（项目根 cwd、自行解析活跃提案、内部三分支、exit 0/非 0）由 implement 阶段实现。

### builtin 不硬编码这两个节点（关键约束）

- **builtin `launched.yaml` 绝不硬编码 `write-ui-prototype` / `verify-ui-provenance`**：若把它们写进 builtin，则它们是
  builtin 节点，其 `done_when: cmd:` 会被判 `FLOW_SCHEMA_INVALID`（§9.2：cmd: 在 builtin 非法，仅 overlay-add 及白名单
  overlay-modify gate 合法）。
- **只有经方法论 GUI overlay `op:add` 注入才能合法用 `cmd:`**：overlay-add 节点身份是它们合法使用富对账 `cmd:` 谓词的**前提**。
  builtin `launched.yaml` 仅在文件头注释区标注该 overlay 扩展点（见本提案对 `spec/flow/launched.yaml` 的 delta）。
- **落地方式**：方法论提供 GUI 项目 overlay 唯一源 `spec/flow/overlays/gui-ui-first.yaml`（`init` / `sync` 在
  `product_type ∈ GUI` 时注入项目实例 `logos/flow/launched.yaml`，非各项目手写）；[delta] 在新 spec +
  本 `flow-spec.md` 定义该 overlay-add 节点与 `check-ui-prototype` / `check-ui-hash-match` 契约，[code] 实现 checker 命令。

### ordering 例外与 flow-derive 判据（保留不变）

- **ordering 例外**：`flow-derive` 仅当出现**非原型的规格 delta**、或 `plan-exit` 已放行时才视为进入 spec 阶段；
  例外**仅限** `2-page-design/*.html` 叶子原型——`write-ui-prototype` 在 plan-exit 门前产出 `2-page-design/*.html`，
  **不得**被 `flow-derive` 误判为「已进入 spec」。其余 `deltas/**`（规格 / skill delta）仍严格在 `plan-exit` 之后（`spec` subflow）产出。
- **例外仅限 `2-page-design/*.html`**：不涉及 `[code]` 切片与 spec-merge 依赖；其它任何 `deltas/**` 出现即照常判进入 spec。
- **[code] 触点**：`flow-derive.ts` 识别 plan subflow 新增的 `write-ui-prototype` 节点、不因原型 delta 误判进入 spec
  （与 §8 `ui_impact` 派生逻辑同批落地）。

## baseline-seed 节点（brownfield-adopter S33，command-driven，非 builtin gate）

存量项目「逆向建立现状基线」的 `baseline-seed` **不是 launched flow 的 builtin gate、也不由 flow 引擎驱动**，
故 builtin `spec/flow/launched.yaml` / `initial.yaml` **不含**该节点、`status`/`next`/`watch`/`flow show` 的 golden **零漂移**。
其语义作为方法论资产记录于 `spec/flow/overlays/brownfield-baseline.yaml`（该 overlay 的 `overlay:` **有意为空**，不改写 builtin node 序列）。

- **触发与派生**：`bootstrap: adopted` 且无活跃提案时，`next`/`status` 按模块级 `baseline_seed_state` 枚举（`required｜partial｜seeded`）派生引导（取代旧 `add-baseline-docs`）：
  - `required`/`partial` → 引导「逆向建立现状基线 / 完成现状基线」，`command`/`next_node` 指向 `openlogos baseline-seed`（命令级建议 → 省略 `next_node`）。
  - `seeded` → 展示覆盖率并引导 `openlogos change`。
- **唯一 producer 边界**：`openlogos adopt` 只写初值 `required`、不启动 AI、不产逆向内容；逆向扫描由 AI 会话/driver（`brownfield-adopter` skill）产出，经 `openlogos baseline-seed`（begin/commit/status）由 CLI 落盘（命令契约见 `spec/logos-project.md`、JSON 见 `spec/cli-json-output.md §3.12`）。
- **状态写入唯一入口**：`baseline_seed_state` 与逆向目标文件的唯一写入者是 CLI；producer 只写 run 私有 staging。
- **崩溃一致性**：多文件提交经 commit journal 事务（`prepared→committing→committed`，状态最后写）+ 模块级事务锁 + 恢复门；机器读取入口读目标/算覆盖率前先经门恢复，否则返回 `baseline_commit_in_progress`、不把半新集合当权威。
- **与 partial 恢复态**：`partial` 是持久化恢复态；无活跃提案时主 `action`/`next_node` 指向 `baseline-seed` 恢复入口；有活跃提案时 `proposal_step`/`next_node` 保持提案真实前沿、partial 恢复以 `baseline_coverage.recovery` advisory 呈现、不阻断 change。
