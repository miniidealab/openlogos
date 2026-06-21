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
  done_when: dir_nonempty       # 完成判定谓词（见 §9）
  fail_when: null               # 可选，失败/阻塞判定谓词；命中则该节点状态为 failed（见 §9）
  pre_script: null              # 可选，前置脚本插件（见 §11）
  post_script: null             # 可选，后置脚本插件（见 §11）
```

- `working_agent` / `review_agent` 是**不透明标签**：OpenLogos 不校验、不调度其行为；
  如何映射到真实 agent 由执行引擎自行适配。内置模板中默认留空。
- `skill` 为该节点推荐使用的 Skill；`next` 会把它作为给宿主的指令的一部分输出。

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

## 6. loop（subflow 循环）【整体含 M2 预留】

```yaml
loop:
  until: tests_green            # 收敛谓词；M1 仅支持退化环，M2 切片 2 点亮 tests_green
  max_iters: 1                  # M1/builtin 固定按 1；【M2 切片 2】overlay set-loop 设 >1 才真迭代
```

- **线性节点 = 退化环**：未声明 `loop` 或 `max_iters: 1` 即线性，收敛条件为"产出存在"。
- **【M2 切片 2】`until: tests_green` + `max_iters > 1` 真迭代**：把 subflow 变成"迭代到测试绿"的收敛循环
  （actor-critic：working_agent 改 → 测试当奖励信号 → 未绿再来一轮，至 `max_iters` 后升级到 gate）。
  - **激活仅靠 overlay `set-loop`**（见 §10.4）把 implement 子流程 `max_iters` 设 >1；**builtin 模板保持 `max_iters:1` 不变**
    （无激活项目派生逐字节不变 → golden 零漂移）。**例外**：initial 多模块即便写了 `max_iters>1` 也**不激活**（见 §12.2）。
  - 派生量：`iteration` = 该 loop 已完成的 verify 轮次；`converged` = 末轮测试绿；`escalated` = `iteration >= max_iters && !converged`。
- **收敛信号押"测试绿"这一数字信号**，不以 review_agent 主观判定作收敛裁判。
- 计数来源 = `openlogos verify` 追加的 `LOOP_ITERS` 账本（见 `spec/cli-json-output.md`）；机器字段 `loop_state` 见同文档。
- M1 / builtin 退化环仍只解析 `loop` 字段、不驱动多轮。

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
- 【M2 预留】聚合阈值（如 ≥90%）、fan-out 在 loop 内"每实例各自迭代 vs 整组收敛"——M1 不实现。

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
| `delta_required` | 提案是否含规格变更 | `= tasks.md 存在 [delta] section`（launched 用；无 [delta] 的纯代码提案为 false） |

**`deployment_required` / `smoke_required` 的来源随 flow 不同（关键）**：
- **initial flow**：取**模块级**默认——
  `deployment_required = module.deployment_required !== false && not skip_phases.includes('deployment')`；
  `smoke_required = deployment_required && module.smoke_required !== false`
  （注意：`module.smoke_required` **未声明视为 true**，仅显式 `false` 才关闭，不得把未声明当 false）。
- **launched flow**：必须取**提案级**决策——由 `resolveProposalDeploymentDecision()` 依据 `proposal.md`
  的部署影响与 `tasks.md` 的 `[deploy]` section 解析；**不得**回退到模块默认。否则模块默认
  `deployment_required: true` 时，一个声明"无需部署"的提案仍会错误进入 deploy。

表达式（M1 支持的最小集）：`flag` / `not flag` / `flag != value`。例：
`when: deployment_required`、`when: bootstrap != adopted`、`when: not api_enabled`、`when: delta_required`。

## 9. done_when 谓词词表

| 谓词 | 含义 | 阶段 |
|---|---|---|
| `dir_nonempty` | 目标目录非空（多模块时按 `{module}-` 前缀过滤） | M1 |
| `file:<path>` | 指定文件存在 | M1 |
| `marker:<NAME>` | 提案目录下存在 marker 文件（如 `VERIFY_PASS`） | M1 |
| `any_present:[A,B,...]` | 列出的任一 marker/文件存在即满足（保留旧 marker 兼容） | M1 |
| `all_present` | fan-out：每个实例的 `produces` 都就绪 | M1 |
| `proposal_package_filled` | **proposal.md 与 tasks.md 均**脱离模板填写完整（对齐 `status.ts:633`，launched 用） | M1 |
| `section_complete:<tag>` | tasks.md 指定 section（如 `delta`/`code`）全部勾选或不存在 | M1 |
| `archived` | 提案已归档 | M1 |
| `cmd:<command>` | 命令退出码为 0（**仅 overlay-add 节点**；执行语义见 §9.2） | M2 切片 1b |

**失败/阻塞谓词（`fail_when`）**：与 `done_when` 同词表，但命中表示节点处于 **failed** 状态（非完成）。
用于忠实表达现有失败态——例如 launched 的 verify 节点 `fail_when: marker:VERIFY_FAIL`
（对应 `verify-failed`）、smoke 节点 `fail_when: marker:SMOKE_FAIL`（对应 `smoke-failed`）。
failed 节点不向后流转，`next` 输出"修复后重试"。
**`fail_when` 优先于 `done_when`**：两者同时命中时判 failed（对齐现状 `VERIFY_FAIL > VERIFY_PASS`、
`SMOKE_FAIL > SMOKE_PASS`——派生时先查 `fail_when` 再查 `done_when`）。

> launched 流程的 done_when 多用 `proposal_package_filled` / `section_complete:*` / `marker:*` / `archived`，
> 忠实表达现有 `ProposalStep` 状态机；详见内置 `spec/flow/launched.yaml`。

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

`cmd:<command>` 谓词让节点完成判定由命令退出码决定。**仅 overlay-add 节点可用**（builtin 经 modify 改成 cmd: → `FLOW_SCHEMA_INVALID`）。

- **语法**：谓词串写作 `cmd:<command>`（**无内层引号**）；payload = `cmd:` 之后到串尾的全部内容、首尾 trim，原样交 shell。
  示例：YAML `done_when: "cmd:npm test"` → 谓词串 `cmd:npm test` → payload `npm test`。**空命令（trim 后空）非法 → `FLOW_SCHEMA_INVALID`**。
- **执行机制**：`spawn(cmd, { shell: true, cwd: 项目根 })`——shell metacharacter（`&&`/`|`/`$()`）被允许（信任委托宿主，不沙箱/不转义）；跨平台用默认 shell（`sh -c` / `cmd /c`）。
- **求值时机**：**仅 `next` 执行**；`status` / `watch` 不执行，该节点态 = **`pending`（未求值）**（见 §12）。
- **判定**：`exit 0 = done`；**非 0 / 超时 = 未 done（不崩溃）**。命令不存在（shell exit 127/9009）按非 0 处理。
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

### 10.3 overlay-add 节点的谓词合法组合矩阵

overlay `op:add` 节点**必须**带可求值的完成判定，否则该节点永远 active、阻死流程。合法组合：

- `dir_nonempty` **必须**配 `produces`（指明判定目录）；
- `file:<path>` 自含路径，**不需** `produces`；
- `marker:` / `any_present:` / `section_complete:*` / `proposal_package_filled` / `archived` **仅 launched** 可用（initial 禁用，须改 `file:`）；
- `all_present` **必须**配 `for_each` + `produces`（fan-out）；
- `cmd:<command>` **仅 overlay-add 节点**可用（builtin 经 modify 改成 cmd: → `FLOW_SCHEMA_INVALID`）；**禁止同节点 `done_when` 与 `fail_when` 均为 `cmd:`**（→ `FLOW_SCHEMA_INVALID`）。

不满足上述组合的 overlay-add 节点，由**派生入口**判 `FLOW_SCHEMA_INVALID`（注意：`applyOverlay` 保持结构性宽松、不做此语义校验，故 `flow show --resolved` 仍可展示）。

### 10.4 set-loop（subflow 级 loop 覆盖，M2 切片 2）

节点级四操作（skip/add/modify/reorder）只触及 node；**覆盖 subflow 的 `loop` 用专门的 `op: set-loop`**：

```yaml
- op: set-loop
  subflow: implement            # 目标 subflow id（非 node id）
  set: { max_iters: 3 }         # until 缺省沿用 builtin 的 tests_green
```

- 按 **subflow id** 定位，把 `set` 合并进该 subflow 的 `loop`。
- **`set` 字段白名单**：**仅允许 `max_iters` / `until`**；出现任何**未知 key**（如 `exhausted_gate`）→ `FLOW_SCHEMA_INVALID`
  （不静默保留、不出现在 resolved flow）。
- 校验：`max_iters` 须整数 ≥ 1；`until` 仅枚举 `tests_green`；目标 subflow 不存在 / 缺 `set` → `FLOW_SCHEMA_INVALID`。
- 只有 `max_iters > 1` 才真正激活 loop 真迭代派生（见 §12.2）；`set-loop` 到 `max_iters:1` 等价退化环（无激活效果）。

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
7. **【M2-1b】`cmd:` 谓词的双模式派生**（仅 overlay-add 节点）：
   - **观察派生（`status` / `watch`）**：`cmd:` 节点**不执行命令**，态 = **`pending`**——它**阻断后续节点推进**（current 停在该 pending 节点）。`pending` 是派生态（非谓词，不进 §9 词表）。
   - **求值派生（`next`）**：对**当前** `cmd:` 节点执行一次（**先评 `fail_when:cmd`：exit 0 → failed；非 0/超时 → 未命中、再评 `done_when:cmd`**）。
     - `exit 0`（done_when）→ 该节点**本次响应内**视为 done 并续推；**瞬态、不写 marker、不落盘**——随后 `status`/`watch` 仍显示 `pending`、下一次 `next` 重新执行求值。
     - **cmd budget = 1**：续推后若新 current 又是 `cmd:` 节点，**停在该节点输出为 current（pending），不执行第二个 cmd**。
   - 节点态枚举：`done | active | pending | failed | skipped`（`pending` 由本切片引入，仅 overlay-added 的 cmd 节点会出现）。

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

**激活条件**：resolved 的目标 subflow（implement）`loop.max_iters > 1`，**且不属于"initial 多模块 unsupported no-op"**。
未激活时一切退化为旧行为、不产出 `loop_state`、verify 不写账本（golden 零漂移）。

**计数与收敛**（读 `LOOP_ITERS` 账本，按当前 module 过滤）：
- `iteration` = 账本（过滤后）行数；`converged` = 末行 `result == "pass"`；`escalated` = `iteration >= max_iters && !converged`。

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
（如 `gate:implement:loop-exhausted`），**`skippable` 固定 `false`**（本切片不可 overlay 覆盖）。`next --auto` 照常阻塞、
**不 auto-pass、不写 `GATE_AUTO_PASSED`**。继续迭代 = 人类用 overlay `set-loop` 调大 `max_iters`（`escalated` 自动解除），
或直接修到测试绿出环；**gate 本身不重置计数**。**`loop-exhausted` 不是新的 `proposal_step` 枚举值**——`proposal_step` 保持
现有集合不变，达上限只由 `loop_state.escalated` + `--auto` 的 `gate_id`/`skippable` 表达。

**账本写入**（`openlogos verify`）：仅激活时、在**算出 gate 结果之后的不依赖 guard 的共享路径**追加一行
`{iter, node:"verify", result:"pass"|"fail", module, timestamp}`，`result` 取沙箱降级后的最终 gate 结果；`iter = 同 module
已有行数 + 1`；配置类早退（`NO_TEST_RESULTS` / `NO_TEST_CASES`）不计迭代、不写。路径：launched = 提案目录、initial =
`logos/resources/verify/`（无提案目录）；账本行带 `module`，读取按 module 过滤。**initial 多模块**：verify 是项目级单次运行、
无法把一次 run 归属到某模块 → **不写账本、loop 视为未激活**（本切片已知不支持）；launch 后 initial 账本仅历史产物，launched
派生只读提案目录账本。

**收敛后再失败的状态回退**：verify 再次 FAIL 沿用现有行为清除 `VERIFY_PASS` 及下游 `DEPLOY_DONE`/`SMOKE_*` marker → verify
回到未 done → `converged` 转 false → implement loop 重新打开；账本续写、`converged` 反映最后一次。

## 13. M1 / M2 边界总表

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
| `exhausted_gate.skippable` overlay 覆盖 / auto 放行非收敛代码 | — | ✅ |
| modify-cmd-on-builtin | — | ✅ |
| fan-out 聚合阈值、loop 内"每实例迭代 vs 整组收敛" | — | ✅ |

## 14. 版本

- 0.1.0：M1 草案。确立数据模型与内置模板结构；M2 字段已预留但不实现。
