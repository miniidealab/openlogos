# 可编排研发流程（Orchestratable Flow）设计决策记录

> 状态：讨论中（Living Decision Record）
> 关联变更提案：`logos/changes/orchestratable-flow/`
> 最近更新：2026-06-18
>
> 本文记录把 OpenLogos 研发流程改造成"可编排"的设计结论与待议问题。
> 已拍板项标注【已定】，待确认项标注【待议】。本文随讨论持续更新。

---

## 1. 出发点与一句话诊断

目标：让 OpenLogos 的研发流程**可编排**——节点可增删改、可排序、可绑定 skill 与
working/review agent、可挂 pre/post script 插件、可把连续节点圈成 subflow 并设 gate
或人类确认点；并能 watch 执行状态。最终目的是**更灵活适配研发场景、更强自动化、更易
嵌入现有开发流程**。

**诊断：OpenLogos 今天没有"一个流程"，而是四份各自硬编码、彼此重复的流程事实来源。**
"可编排"的第一步不是做编辑器，而是把这四份合并成**一份声明式模型**。

| 事实来源 | 位置 | 形态 | 可编辑性 |
|---|---|---|---|
| initial 阶段瀑布（13 节点） | `cli/src/i18n.ts: PHASE_KEYS` + `cli/src/commands/status.ts: PHASE_SUBPATHS` | 硬编码数组，节点完成 = 目录非空 | 仅能 `skip_phases` 跳过 |
| launched 变更生命周期 | `cli/src/commands/status.ts: ProposalStep`（11 态） | 硬编码状态机，靠 marker 文件流转 | 不可编辑 |
| "该干什么"的判定 | `CLAUDE.md` Phase 检测散文 | 自然语言，靠模型读 | 改散文≈改行为，脆弱、随模型漂移 |
| 发版流程 | `logos-project.yaml: release_workflows` | YAML 声明 | **已是声明式**，是"对的样子"的雏形 |

`release_workflows` 已经是声明式编排的雏形——本改造本质是把这套思路推广到
initial / launched 两条主干，并合并掉前三份硬编码。

---

## 2. 三层抽象（不可揉在一起）

把需求拆成三层，每层可独立交付：

- **L1 模型层（声明式，落文件、git 可追踪）**
  一个 `flow` = 有序节点 + subflow 分组，是唯一事实来源。`status`/`next`/引擎全部从它派生。
  节点字段草案：
  ```
  node:
    id / name
    skill:          prd-writer            # 绑定 skill
    working_agent / review_agent          # 谁干、谁审
    produces:       <path or marker>      # 产出位置
    done_when:      dir_nonempty | marker:VERIFY_PASS | cmd:"npm test" | gate
    pre_script / post_script              # 插件钩子（宿主执行）
  subflow:
    nodes: [code, verify]
    loop:  until tests_green              # 见 §5
    max_iters: N
    gate:  human | cmd | none
  ```
  **本层最难的不是"节点能排序"，而是每个节点的"完成谓词"（`done_when`）。**
  今天完成信号统一是"目录非空"，太弱；可编排的前提是每个节点能自声明"怎么算做完"。

- **L2 派生层（无状态，读文件算状态）**
  即今天 `status`/`next` 做的事，改为"读 flow 模型 + 扫文件 → 算每个节点
  done/active/blocked"。`openlogos watch` 是本层的轮询流式输出，几乎免费。

- **L3 驱动层（可选，谨慎）**
  真正驱动节点跑起来。**见 §3 的关键决策——本项目不走主动驱动。**

---

## 3. 关键决策

### 【已定】引擎走 A：被动派生，宿主执行

两种引擎形态：
- **(A) 被动派生器**：只回答"我在哪、下一步跑什么"，执行交给宿主（Claude Code / 人 / CI）。
  状态全在文件，无进程、无运行时。
- **(B) 主动编排器**：自己 spawn agent、跑脚本、守 marker、推进节点——本质是
  Temporal / n8n / Cloudflare Workflows 一类，需进程监督、agent 运行时、重试、并发。

**决策：走 A，并把 A 做到极致，不滑向 B。** 理由：
1. OpenLogos 的护城河是**方法论**（Why→What→How、场景贯穿即追溯链、spec 驱动），
   不是编排管线的水管。自造通用 DAG 引擎会与宿主 harness、与 Temporal 正面竞争，
   且丢掉"文件即状态、git 可审计、任何 AI 工具都能接"的独特价值。
2. B 的"驱动+watch+重试+并发"是无底洞，会吃掉做方法论的精力。
3. A 完全够用：`openlogos next --json` 已能吐出"下一节点 + 用哪个 skill + 现成提示词"，
   宿主照做即可。要补的只是让它**按 flow 模型派生**，并输出"派哪个 agent、带哪个 skill"。

**定位一句话：OpenLogos 当编排的"乐谱"和"指挥"，不当"乐手的手"。**

### 【已定】flow 模型独立于 logos-project.yaml，落在 `logos/flow/*.yaml`

`logos-project.yaml` 的职责**纯粹**——只是上下文索引（resource_index），不承载流程编排。
flow 模型放在**独立目录 `logos/flow/*.yaml`**：项目级、随项目走、git 可追踪，
且支持多套模板并存与切换（与 `logos/resources/` 平级，语义清晰）。默认文件名
`logos/flow/initial.yaml`、`logos/flow/launched.yaml`（一 flow 一文件，文件名即身份）。

**两个路径要区分清楚（避免 merge/sync 边界混乱）**：
- **内置模板源头 = `spec/flow/initial.yaml` / `spec/flow/launched.yaml`**（根 `spec/`，产品唯一源头，
  经 `deltas/spec/flow/` 合并；merge 的 `DELTA_TO_RESOURCE` 已支持 `spec → spec`）。
- **项目实例 = `logos/flow/*.yaml`**：用户项目里经 overlay（`extends: builtin:initial`）物化出的实例，
  由 CLI 生成，非手写源头。

**schema 规范文件 = `spec/flow-spec.md`**（产品规格源头在根 `spec/`，与 `tasks-spec.md`
对仗——都是 CLI 依赖的文件格式规范）。它与现有 `spec/workflow.md` 的分工：
- `spec/workflow.md` → **概念/方法论层**：Why→What→How、场景贯穿即追溯链。回答"为什么这么编排"。
- `spec/flow-spec.md` → **数据模型层**：node / subflow / loop / done_when / gate 的字段契约
  与枚举。回答"怎么写一份 flow 文件"。flow-spec 顶部声明"本规范是 workflow.md 方法论的可编排落地"。

> 备注：现状 `logos-project.yaml` 里的 `release_workflows` / `deployment_gates` / `scenarios`
> 等，严格说也违反"纯索引"原则，属于后续可清理项，本次不展开。

### 【已定】收敛信号押"测试绿"

loop 的退出/收敛条件用**测试是否全绿**这一数字信号，不靠 review_agent 的主观判定。
理由：质量是数字，没有模糊地带。review_agent 仍可参与（生成/修复），但**不作为收敛裁判**，
以规避幻觉风险。

### 【已定】M1 必须覆盖现有三种复杂度（不拆开）

把现有瀑布"搬家"成声明式 flow，M1 的 schema 必须一次表达完整：
1. **fan-out 节点**：一个节点对 N 个 active 场景各产出一份（如 `scenario-architect`、
   `test-writer`）。`done_when` 不是单点，而是"每个 active 场景都有对应文件"。
2. **条件跳过**：节点带条件（对应今天的 `skip_phases` / `deployment_required`），
   不满足则该节点不参与流程。
3. **模板继承**：内置模板（initial / launched）+ 用户覆盖层（增删改节点）。
这三者是 M1 范围内的硬约束，不允许"先线性兜底、后续再补"。

### 【已定】pre/post_script 的信任边界委托给宿主 agent

OpenLogos **不自管脚本执行信任**。脚本是否执行、以何权限执行，取决于宿主 AI agent
的权限模式（如 yolo 模式则直接执行）。这与 A 架构一致：OpenLogos 只声明"此处有
pre/post_script"，不持有执行与授权责任。

### 【已定】working/review agent 仅作配置声明，执行交给引擎适配

schema 里 working_agent / review_agent 是**不透明标签**，OpenLogos 不解释、不校验、
不驱动其行为；如何把标签映射到真实 agent、如何调度，由实际执行引擎（宿主）自行适配。
这同样是 A 架构的直接推论：OpenLogos 当"乐谱"，agent 的"演奏"交给乐手。

### 【已定】采纳"统一 loop 模型 + 分两步实现"

线性节点 = `max_iters:1`、收敛条件为"产出存在"的退化环。subflow+loop 语法在规范里
一次定义完整；实现分两步：M1 只做线性 + 退化环（搬家、行为不变、可独立发版），
M2 增量点亮 `code/verify` 的真迭代（`max_iters>1` + 测试绿收敛）。详见 §4、§5。

---

## 4. L1+L2 only vs. 带上 code/verify loop

> 前提：引擎是被动的（A）。"带 loop" **不等于** openlogos 自己跑测试循环；
> 差异只在**模型能否表达"环"**，以及**派生层要不要算"迭代状态"**。

**方案一：只做 L1+L2（纯线性模型）**
- 模型是一串有序节点，`done_when` 只有被动观测类型（目录非空 / marker / 文件存在）。
- `code` 与 `verify` 是相邻独立节点；verify 失败 → next 说"去修"。
- 事实上已有回环（回去修），但模型不"知道"它是环——无迭代次数 / 收敛条件 / 重复单元概念。
  回边由 status 逻辑隐式处理（如今天 `verify-failed → ready-to-verify`）。
- 风险极低：纯重构 + 数据建模，零运行时；现有瀑布与变更生命周期"搬家"成模板，行为不变。

**方案二：带上 code/verify loop（模型支持 subflow + 环）**
- 引入 subflow + loop 一等公民：把 `code`+`verify` 圈成子流程，声明收敛=测试绿、
  可选 `max_iters`、退出挂 gate。
- 模型从"线性 DAG"变为"带回边的图"；代价全在派生层（status 要算"环内第 N 轮未收敛"，
  next 要会措辞"继续迭代"，watch 要展示环进度）。引擎仍被动。

### 核心建议：线性节点 = `max_iters:1` 的退化 loop

> **不做"线性 only"的 schema，做"一切皆 loop"的统一模型——线性节点就是
> 迭代上限为 1、收敛条件为"产出存在"的退化环。**

这样"选一还是选二"的纠结消失，落地分两步：
- **M1 = L1+L2**：subflow+loop 语法在规范里一次定义完整；CLI 先只实现线性 + 退化环派生。
  现有瀑布全部表示为"1 轮环"，立刻能跑、行为不变。风险低、可独立发版。
- **M2 = 激活 loop**：仅给 `code/verify` 子流程打开 `max_iters>1` + 测试绿收敛派生。纯增量。

若先做"线性 only"schema，等于把"无环"焊死进数据模型，将来加环要返工；而环
（code→test→fix 收敛）恰是最贴近现代范式、生产价值最集中之处。
**结论倾向：语法一次设计到位，实现分两步走。**（待 §3 末尾【待议】最终拍板）

| 维度 | 方案一 纯线性 | 方案二 统一 loop 模型 |
|---|---|---|
| 模型复杂度 | 低 | 中 |
| 派生层复杂度 | 低 | M1 同方案一；M2 增量 |
| 现有瀑布搬家 | 直接 | 直接（表示为 1 轮环） |
| 将来加环 | 要返工 | 增量，不返工 |
| 匹配现代 loop 范式 | 否 | 是（M2 点亮） |

---

## 5. loop 研发范式分析

当前（2026）两条相关主线：
1. **Spec-driven development**（Kiro / spec-kit 一派）：规格先行、规格即契约。
   **OpenLogos 本就是这一派的重度玩家——是顺风局，别丢。**
2. **Agentic loop**：generate → run → observe → critique → fix，用验证器（测试）当
   奖励信号，迭代到收敛；actor-critic / 生成器-评审器是核心结构。

**关键洞察：用户设计的"每节点 working agent + review agent"本身就是 actor-critic loop 的原语。**
当前 OpenLogos 的 verify/smoke 是一次性**检查点（gate）**，不是**循环（loop）**——
失败即停、不自动"改→重测→再改"。

改造要害：让 **subflow 支持 `loop: until <predicate>`**，且：
- **规格 = loop 的不变量/验收契约**。"场景贯穿即追溯链"在此变成杀手锏——
  生成/修复对着场景的 GIVEN/WHEN/THEN 契约做；但**收敛裁判是测试绿**（见 §3）。
- **gate / 人类确认点 = loop 的退出闸**。loop 自跑迭代，收敛后停在 gate 等人。

两条主干因此呈两种节奏：
- **WHY/WHAT（写文档）**：线性节点 + gate，质量靠人把关，不需 loop。
- **HOW 的 code/verify/smoke**：loop 节奏，测试当奖励信号，迭代到绿，gate 收口。

模型不是"花式 DAG"，而是"**线性 gate 段 + 收敛 loop 段**"的组合——足够覆盖多数场景又不失控。

---

## 6. 生产价值与要抵制的诱惑

### 在生产里真正产生价值
1. **允许只采用一段**（flow 可裁剪）：降低采用门槛，ROI 最高。
2. **节点可指向团队已有工具**：`done_when: cmd:"gh pr checks"` 接 CI/PR；
   `pre/post_script` 让"建分支/开 PR/发 Slack"成为插件。编排在已有工具**之上**，不替代。
3. **判定逻辑从 CLAUDE.md 散文搬进声明式模型**：next 判定确定性、可测试、不随模型漂移。
4. **watch + 机器可读输出**：`status --json --watch` 让流程状态被外部 dashboard / CI 消费
   （已有 S16 JSON 输出基础）。

### 要抵制的三个诱惑
1. **别造通用工作流引擎**：约束成"线性段 + loop 段 + gate"，不做任意 DAG / 并发 fork-join。
2. **别让"全可编辑"成为默认**：现有瀑布 + 变更生命周期固化为**内置模板**，编辑 opt-in。
3. **pre/post_script 是安全面**：任意脚本=任意代码执行，需与 PreToolUse guard 协同，
   想清信任边界（谁能写、跑在哪、guard 怎么管）。

---

## 7. 待议问题（继续讨论）

- 【已定】flow 文件位置 = `logos/flow/*.yaml`；schema 规范源头在根 `spec/`（见下条待议命名）。
- 【已定】采纳"统一 loop 模型 + 分两步实现"（§3 / §4）。
- 【已定】M1 边界：声明式模型（含 fan-out / 条件 / 模板继承三复杂度）+ 派生
  status/next/watch + 瀑布搬家成模板、行为不变；loop 真迭代留 M2。
- 【已定】pre/post_script 信任委托宿主 agent；working/review agent 仅声明、引擎适配。
- 【已定】schema 规范文件 = 根 `spec/flow-spec.md`；`logos/flow/` 默认文件名
  `initial.yaml` / `launched.yaml`；与 `spec/workflow.md` 概念层分工已厘清（见 §3）。
- 【已定】fan-out：`for_each` + 带变量 `produces` + `done_when: all_present`；M1 单实例谓词
  只支持 文件/marker（glob 精确），cmd 留 M2。详见 §8.1。
- 【已定】模板继承：走 (i) overlay（`extends: builtin:initial`）；操作集 skip/add/modify/reorder、
  按 node id strategic-merge、内置带版本号、配套 `flow show --resolved`。详见 §8.2。

---

## 8. 待议细节展开（schema 起草前需跑通）

> 这两点不影响已定架构，但决定 `flow-spec.md` 的字段契约；设计糙了 M1 会返工。

### 8.1 fan-out 节点的 `done_when` 如何表达"每个 active 元素都有产出"

**现状锚点（`status.ts:725-741`）**：只有 `phase.3-1` / `phase.3-4a` 两个 phase 被
硬编码成场景级；用 `${mod.id}-${s.id}` + 固定后缀对目录做 `.includes()` 子串匹配；
`done = missing.length===0 && scenarios.length>0`；并产出 `{total, covered, missing}`
覆盖度。问题：这套逻辑写死在代码里，不可声明。

**要在 schema 里回答的子问题**：

1. **fan-out 的"集合"从哪来？**
   今天写死是"本模块的 scenarios"。声明式后要能指定 fan-out 维度，例如：
   - `for_each: scenarios`（最常用）
   - `for_each: modules`
   - `for_each: <某个声明在别处的列表>`
   集合必须**在求值时动态解析**（场景会随 `scenario_counter` 增长，覆盖目标是移动靶），
   不能快照。今天的实现已是动态读取，schema 要保留这一语义。

2. **每个实例的产出位置/命名如何模板化？**
   今天写死 `${mod.id}-${s.id}` + 后缀 + 固定目录。声明式后需要**变量插值**，例如：
   `produces: logos/resources/test/{module}-{scenario}-test-cases.md`。
   即 `done_when` 要能对 fan-out 变量做插值后再判定。

3. **单实例谓词 + 聚合谓词分别是什么？**
   - 单实例：文件存在 / marker / cmd？（今天是"文件名子串匹配"，偏脆，建议收紧成
     glob 精确匹配而非 `.includes()`）
   - 聚合：全部实例 done 才算节点 done？还是允许阈值（如 ≥90%）？
     （倾向：默认"全覆盖"，与今天一致；阈值留作可选字段，不在 M1 必做。）
   - 覆盖度报告 `{total, covered, missing}` 要保留——这是 status/watch 的关键信息。

4. **与 loop（M2）的关系（先不实现，但 schema 别堵死）**：
   fan-out 节点若处在 loop 子流程里，是"每个实例各自迭代到绿"，还是"整组一起收敛"？
   M1 不实现，但 schema 设计时心里要有数，别让字段结构将来无法表达。

**【已定】**：`flow-spec.md` 定义 `for_each: <set>` + `produces: <带变量的路径模板>`
+ `done_when: all_present`（默认全覆盖、glob 精确匹配、动态解析集合），覆盖度对象沿用今天的
`{total, covered, missing}`。
- **单实例谓词 M1 只支持 文件存在 / marker**（glob 精确匹配，弃用今天的 `.includes` 子串）。
- **`cmd:` 类型谓词留给 M2**（与测试绿收敛一起点亮），schema 预留字段、M1 不实现。
- 聚合阈值、loop 内"每实例迭代 vs 整组收敛" 同为预留字段，M1 不实现。

### 8.2 模板继承的覆盖语义（patch 增量 vs 整体覆盖）

**现状锚点（`status.ts:680-696`）**：`skip_phases` + `deployment_required`/`smoke_required`
布尔，本质是一个**极小的补丁语言**——用户在内置 13 段模板上声明"删掉这几段"。
模板继承就是把这个雏形扩展到能 add / modify / reorder。

**核心分叉（先定这个，其余子问题才有意义）**：

- **方案 (i) overlay / extends（补丁叠加）**：CLI 内置 initial/launched 模板；用户的
  `logos/flow/*.yaml` 只写**差异**，用 `extends: builtin:initial` 引用基线。
  - 优点：用户始终跟随内置模板演进，diff 小、意图清晰（"我只改了这两处"）。
  - 代价：需要定义 patch 合并语义 + 内置升级时的冲突检测；调试需 `flow show --resolved`
    才能看到生效后的完整流程。
- **方案 (ii) materialize / full-copy（整体落地）**：`openlogos init` 把内置模板**完整拷贝**
  成 `logos/flow/initial.yaml`，用户直接改这份，无继承。
  - 优点：极简、完全透明、git diff 一目了然，无隐藏合并逻辑。
  - 代价：用户拿不到内置模板的后续改进；模板无法中心化演进；项目间漂移。

**若选 (i)，还需回答的子问题**：

1. **patch 粒度与操作集**：至少要 add（插到哪个 id 前/后）、remove（按 id）、
   modify（改某节点的 skill/agent/script）、reorder。表达风格三选一：
   - JSON-merge-patch 风格（按 id 深合并，字段置 null = 删除）
   - 显式操作列表（`- op: insert-after, ref: code, node: {...}`）
   - strategic-merge（按 node id 作 key 的策略合并，类似 k8s）
2. **内置演进的冲突**：内置改名/删节点而用户 overlay 还引用旧 id → 如何检测并报错
   （需要给内置模板打版本号）。
3. **可调试性**：必须提供 `openlogos flow show --resolved` 输出"基线 + overlay 合并后"的
   生效流程，否则用户无法判断自己改对没有。

**【已定】走 (i) overlay 补丁叠加**。决策依据：版本升级时"方法论中心化演进"的优势
压过 full-copy 的透明性——方法论是 OpenLogos 的护城河，不能在每个项目里被拷贝后冻结。
配套定下：
- **操作集收窄**为 skip / add / modify / reorder 四种，不做任意改写。
- 用**按 node id 的 strategic-merge**表达（是今天 `skip_phases` 的自然延伸，迁移成本最低）。
- **内置模板带版本号**（如 `builtin/initial@v1`），内置改名/删节点而 overlay 仍引用旧 id 时可检测并报错。
- **必须配套 `openlogos flow show --resolved`**：输出"基线 + overlay 合并后"的生效流程，
  补偿 overlay 不如 full-copy 透明的短板。
- full-copy 的"完全透明 + M1 更小"为已知放弃项；其透明性损失由 `flow show --resolved` 补偿。

---

## 9. 内置 initial 模板结构（M1，忠实 1:1 翻译现有 13 段）

**原则【已定】**：M1 是"搬家不改行为"，内置 initial 模板是现有 `PHASE_KEYS` 13 段瀑布的
忠实 1:1 翻译，本轮只做"确认 + 标注元数据"，不合并/拆分/重命名节点。任何重构留到
launched 后用变更提案做。

### 9.1 节点清单

| # | node id | 名称 | skill | fan-out | when 条件 | 完成判定 |
|---|---|---|---|---|---|---|
| 1 | `prd` | 需求 | prd-writer | — | `bootstrap != adopted` | 目录非空 |
| 2 | `product-design` | 产品设计 | product-designer | — | `bootstrap != adopted` | 目录非空 |
| 3 | `architecture` | 架构 | architecture-designer | — | `bootstrap != adopted` | 目录非空 |
| 4 | `scenario-modeling` | 场景时序 | scenario-architect | ✅ per scenario | — | 每个场景都有 `{module}-{scenario}-*.md` |
| 5 | `api-design` | API 设计 | api-designer | — | `api_enabled` | 目录非空 |
| 6 | `db-design` | DB 设计 | db-designer | — | `db_enabled` | 目录非空 |
| 7 | `deployment-design` | 部署方案 | deployment-designer | — | （无，始终活跃） | 目录非空 |
| 8 | `test-cases` | 测试用例 | test-writer | ✅ per scenario | — | 每个场景都有 `{module}-{scenario}-test-cases.md` |
| 9 | `orchestration-test` | 编排测试 | test-orchestrator | — | `scenario_enabled` | 目录非空 |
| 10 | `code` | 代码实现 | code-implementor | — | — | 目录非空 |
| 11 | `verify` | 验收 | （openlogos verify） | — | — | `file:.../acceptance-report.md` |
| 12 | `deploy` | 部署执行 | deployment-executor | — | `deployment_required` | `file:.../deployment-report.md` |
| 13 | `smoke` | 冒烟 | （openlogos smoke） | — | `smoke_required` | `file:.../smoke-report.md` |

- fan-out 节点 = 4 `scenario-modeling` / 8 `test-cases`（对应今天 `SCENARIO_PHASES`）。
- `when` 条件对应今天的 `skip_phases` / `deployment_required` / `smoke_required` / bootstrap-adopted。
- **完成判定（修正）**：initial 首轮开发的 verify/deploy/smoke 用 `logos/resources/verify/*-report.md`
  **报告文件**（`PHASE_SUBPATHS[10-12]`）；marker（`VERIFY_PASS` 等）是 **launched** 提案流程的机制，
  见 `spec/flow/launched.yaml`。`deployment-design` 不带 `when`（现状从不显式 skip 3-3，保持始终活跃）。
- **working_agent / review_agent 在内置模板中留空**（仅声明字段存在，由宿主/用户填）。

### 9.2 subflow + gate 分组

```
subflow WHY    : [prd]                                   gate: human (skippable:true)
subflow WHAT   : [product-design]                        gate: human (skippable:true)
subflow HOW-设计: [architecture, scenario-modeling,
                  api-design, db-design, deployment-design,
                  test-cases, orchestration-test]        gate: none
subflow 实现   : [code, verify]                          gate: none  ← M2 变 loop（收敛=测试绿）
subflow 交付   : [deploy, smoke]                         gate: human (deploy skippable:false, smoke skippable:true)
```

### 9.3 【已定】skip-human-gate 能力

支持"全自动化"时跳过人类确认点：
- 每个 gate 带 **`skippable: true|false`** 能力位（声明在 flow）。
- 运行时 **auto/yolo 模式**（宿主传入，如 `openlogos next --auto`）：auto 下 `skippable:true`
  的 gate 被 `next` 视为已通过直接放行；`skippable:false` 的 gate 即使 auto 也照样卡住。
- **被自动跳过必须留痕**（写 `GATE_AUTO_PASSED` 审计记录）——gate 是决策点，静默跳过会丢失可追溯性。
- 仍符合 A 架构：OpenLogos 只派生"此 gate 可跳 + 当前 auto → 视为通过"，是否进入 auto 由宿主决定。
- 与"pre/post_script 信任委托宿主 yolo"是同一理念的延伸：高危动作的放行权交给宿主的自动化等级。

**【已定】**：`deploy` gate 默认 `skippable: false`（安全默认，全自动模式下仍需人类确认部署，
防止误触发生产部署；用户可在自己的 flow 覆盖为 `true` 以无人值守）。其余 gate 默认 `skippable: true`。

---

## 附：本项目 logos/ 的特殊性（dogfooding）

本仓库的 `logos/` 目录是 OpenLogos **对自身方法论的 dogfooding 产物，不是生产代码**。
生产代码/规格/Skill 的源头在仓库**根目录**（`cli/`、`spec/`、`skills/`）。
因此本设计若涉及规格/Skill 改动，**必须改根目录源码**，再经 sync 同步到 `logos/`。
此约束已在 `logos/logos-project.yaml` 顶部重点强调。
