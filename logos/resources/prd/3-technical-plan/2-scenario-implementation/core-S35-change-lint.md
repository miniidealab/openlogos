# S35：提案计划产物左移硬检查（change-lint）

> Feature：F04 变更提案与切片生命周期  
> 来源：需求 S35、功能规格 §2.30 与 §2.43、跨仓 Plan Package 修复方案

## 场景目标

在 proposal/tasks producer 向用户报告完成之前，由 OpenLogos CLI 独立证明 Plan Package 满足统一合同；失败时返回可供同一 Agent 定点修复的结构化问题，并保证 change-lint、status、next 与 flow derive 对同一输入收敛。

## 用户价值

用户只会在方案真正可批准时看到 `ready-to-delta`，不会遭遇“lint PASS 但面板仍 writing”，也无需理解 canonical 标题、模板占位或插件缓存漂移。

## 参与者

- **用户/宿主**：触发检查并消费最终完成结论。
- **change-writer**：生产 proposal/tasks、读回并消费问题修复。
- **change-lint**：命令入口、退出码与 envelope 所有者。
- **PlanPackageEvaluator**：唯一完成判据与 issue 生产者。
- **status/next/flow**：只读消费同一 evaluation 的投影方。
- **AssetManifest**：证明 producer Skill/模板与 CLI 合同一致。

## 前置条件

- 项目已初始化，guard 指向当前 launched change。
- proposal/tasks 已由 change-writer 填充但尚无 Delta、无 `PLAN_APPROVED`。
- 项目 locale、模块、部署决定、clarification 与 baseline closure 可读取。

## 成功后置条件

- `change-lint --format json` exit 0 且 `data.pass=true`、`data.plan_package.ready=true`。
- status 的 `plan_ready=true`，next 的 `proposal_step=ready-to-delta`，flow predicate 同样完成。
- 检查前后项目全量文件集合与内容 hash 不变。
- change-writer 才能向用户报告方案待批准；本场景不写审批 marker。

## 时序图

```mermaid
sequenceDiagram
    participant H as 用户或宿主
    participant W as change-writer
    participant L as change-lint
    participant E as PlanPackageEvaluator
    participant C as 共享子 evaluator
    participant O as status next flow

    H->>W: Step 1: 请求完成 proposal/tasks
    W->>W: Step 2: 填充 scaffold 并从磁盘读回
    W->>L: Step 3: 运行 change-lint --format json
    L->>E: Step 4: 求值 Plan Package
    E->>C: Step 5: 求值章节、tasks、澄清、部署、闭包与 UI
    C-->>E: Step 6: 返回事实与问题
    E-->>L: Step 7: 返回 ready 与稳定 issues
    alt Plan Package 非法
        L-->>W: Step 8: exit 2 与 completion issues
        W->>W: Step 9: 定点修复并回到 Step 2
    else Plan Package 合法
        L-->>W: Step 8: exit 0 与 pass true
        W->>O: Step 9: 运行 next 双检查
        O-->>W: Step 10: 返回 ready-to-delta
        W-->>H: Step 11: 报告方案待批准
    end
```

## 步骤说明

1. **用户或宿主**要求 change-writer 完成当前提案，而不是直接授权 Delta 或 merge。
2. **change-writer**保留 CLI canonical scaffold，只替换占位正文；落盘后重新读取真实字节。
3. **change-writer**从项目根运行带明确 slug 的 change-lint JSON 命令。
4. **change-lint**完成操作错误前置检查后调用唯一 **PlanPackageEvaluator** 作为 L0。
5. **PlanPackageEvaluator**调用 authority scan、tasks parser、clarification、deployment、baseline closure 与 UI 声明共享 evaluator。
6. **共享子 evaluator**返回结构化事实；不得自行写文件或吞掉解析错误。
7. **PlanPackageEvaluator**规范化、去重并稳定排序 issues，计算 proposal/tasks 三态与 ready。
8. **change-lint**在 ready=false 时 exit 2、ready=true 时继续 L1～L9 并最终 exit 0；操作错误仍 exit 1。
9. 失败时 **change-writer**只修 issues 指向的当前提案文件并读回重试；成功时运行 next 双检查。
10. **status/next/flow**消费同一 evaluation；next 必须进入 `ready-to-delta`，不得仍为 writing。
11. **change-writer**向用户报告最终收敛结果并等待 plan gate 批准，不自动产 Delta 或 marker。

## 异常与边界

### EX-5.1：canonical summary 缺失
- **触发条件**：proposal 把 locale summary 改为自由标题，或章节缺失/重复/为空。
- **期望响应**：`proposal_required_section_missing|duplicate|empty`，包含 path、section_id、expected 与 fix_hint。
- **副作用**：lint/status/next/flow 均只读，plan 不 ready。

### EX-5.2：plan 阶段 code 占位或切片
- **触发条件**：tasks 保留 `实现代码变更` 或提前出现任意 `[code]` checkbox。
- **期望响应**：模板残留或 `tasks_code_entry_before_spec_complete`；空 `[code]` 锚点本身合法。
- **副作用**：不 auto-reset；auto-reset 仍只属于既有 merge/slice 边界。

### EX-7.1：子 evaluator 操作错误
- **触发条件**：proposal/tasks 不可读、YAML parser 失败或项目根事实不可安全解析。
- **期望响应**：exit 1 error envelope；不得降级成 pass=false success envelope。
- **副作用**：后续检查停止，文件与 marker 不变。

### EX-9.1：Agent 自然语言声称完成
- **触发条件**：文件非法但 Agent 输出“已完成”。
- **期望响应**：机器门仍失败；宿主 completion barrier 不得把 WorkUnit 标成 completed。
- **副作用**：用户不看到“可写 Delta”。

### EX-10.1：历史提案已越过 plan
- **触发条件**：存在 `PLAN_APPROVED|SPEC_MERGED|MERGED|VERIFY_PASS` 且旧 scaffold 不符合新规则。
- **期望响应**：保持现有前沿，仅允许非阻塞 warning。
- **副作用**：不回退、不改写历史。

### EX-10.2：Skill/模板资产过期
- **触发条件**：项目 sync hash 与 CLI asset manifest 不一致。
- **期望响应**：只读状态可见；producer dispatch 提示 sync + 重开 session，禁止静默使用旧 Skill。
- **副作用**：不覆盖用户/项目自有 Skill。

## API、数据库与安全边界

- 所有交互是本地进程/文件合同，API、数据库与 API 编排为 SKIP。
- completion 命令保持只读，不写 `PLAN_APPROVED`、Delta、MERGE_PROMPT 或宿主 WorkUnit 状态。
- RunLogos 自动回传、三次修复预算和 UI 展示属于独立 companion change。

## 追溯

- 需求：S05/S08/S09/S11/S35 Plan Package 完成合同收敛需求。
- 功能规格：§2.43 Plan Package 统一完成合同。
- 架构：第三十三章 Plan Package 完成合同收敛架构。
- 方法论：`spec/change-management.md`、`spec/tasks-spec.md`、`spec/flow-spec.md`、`spec/cli-json-output.md`。
- 测试：UT-S35-100～UT-S35-111、ST-S35-16～ST-S35-18、SMOKE-core-135～SMOKE-core-140。

## S35 Authority Closure L10 共享求值门

### 场景目标

在 Plan Package 完成判据中加入 Authority Closure，而不让 change-lint、status、next 和 flow 分别维护 parser。L10 只调用 AuthorityClosureEvaluator 并把同一 issues 纳入完成结果。

### 时序图

```mermaid
sequenceDiagram
    participant W as change-writer
    participant L as change-lint
    participant P as PlanPackageEvaluator
    participant A as AuthorityClosureEvaluator
    participant O as status next flow
    W->>L: Step 1: 检查 proposal/tasks
    L->>P: Step 2: 求值 Plan Package
    P->>A: Step 3: 严格解析 authority impact 与引用
    A-->>P: Step 4: summary + stable issues
    alt Authority Closure 失败
        P-->>L: Step 5: ready=false
        L-->>W: Step 6: exit 2 + 五类 violation
    else 通过
        P-->>L: Step 5: ready 按全量维度计算
        P-->>O: Step 6: 共享同一 evaluation
    end
```

### L10 检查项

1. 声明存在且唯一；schema/applicability 分支严格。
2. fact 引用指向 effective architecture/当前 CREATE authority target。
3. owner/writer/mutation/projection/freshness/recovery/shadow/test 字段闭合。
4. cutover old stop/new start/rollback/exit 全部非空，`unresolved=[]`。
5. test IDs 在 effective test view 中真实存在。
6. 多问题不首错短路，按 path、fact 源序、code、message 稳定排序。

### 历史与只读边界

新/仍 writing 提案严格检查；已越过 plan 的历史前沿不倒退。L10 全程只读，不写 proposal、marker 或 Registry。操作错误 exit 1；可修复合同红 exit 2；通过 exit 0。

### 追溯

- 规范：`spec/authority-closure.md` §7～§9。
- 测试：UT-S35-112～UT-S35-120、ST-S35-19～ST-S35-21。

## S35 L10 authority closure 的分阶段校验时序

### 场景目标

明确 L10（Authority Closure 权威闭包）在不同调用阶段的校验强度，以及存在性强校验的落点。plan 阶段与 spec 阶段消费同一个评估器，但对「产物此刻是否已存在」持不同判定——这一差别必须由**显式传入的阶段**决定，不由评估器猜测。

### 参与者与前置条件

| 别名 | 组件 | 说明 |
|------|------|------|
| L | change-lint | 全量门，spec 阶段调用方 |
| PP | plan-package 评估器 | plan 阶段调用方（喂给 next / status） |
| AC | authority closure 评估器 | 唯一判定实现，按传入阶段分级 |
| V | effective test view | 已合并测试规格 + 合法 test delta + 复用测试 ID 小节 |

### 主时序

```mermaid
sequenceDiagram
    participant PP as plan-package（plan 阶段）
    participant L as change-lint（spec 阶段）
    participant AC as authority closure 评估器
    participant V as effective test view

    PP->>AC: Step 1: evaluate(stage = plan)
    AC->>AC: Step 2: 结构完备 + tests 非空 + ID 格式合法
    AC-->>PP: Step 3: 不查 effective view，返回结论

    L->>AC: Step 4: evaluate(stage = spec)
    AC->>AC: Step 5: 同上全部 plan 阶段校验
    AC->>V: Step 6: 逐个 ID 查 effective test view
    alt 全部命中
        AC-->>L: Step 7a: closure 通过
    else 任一未命中
        AC-->>L: Step 7b: authority_closure_incomplete，点名 fact 与未命中 ID
    end
```

### effective test view 的三个来源

| # | 来源 | 说明 |
|---|---|---|
| 1 | `logos/resources/test/**` | 已合并测试规格 |
| 2 | 当前提案 `deltas/test/*.md` | 须 mergeable + lint valid |
| 3 | `proposal.md` 的「## 复用测试 ID」小节 | 按固定语法显式声明复用；所列 ID 仍须真实存在于来源 1 |

来源 3 此前只被 `change-lint` 与 `proposal-lifecycle` 消费，未接入 closure，导致规范列明的补救手段对该检查无效。本节将其纳入同一视图。

### 步骤说明

1. **阶段是显式输入**，不由评估器从上下文推断。同一评估器被两个调用方以不同阶段调用，判定差异只来自该参数。
2. plan 阶段校验：fact 结构完备、`tests` 非空、每个 ID 符合 `TEST_ID_RE`。**不查** effective view。
3. spec 阶段校验：plan 阶段全部条件，**加**逐个 ID 在 effective test view 中的存在性。
4. merge preflight 沿用 spec 阶段强度并 fail-closed，不因 plan 阶段的放宽而削弱。
5. `authority_ref` 的判定在两个阶段均为「已存在 **或** 闭包计划中声明 CREATE」——与 `tests` 逐阶段同宽同严。

### 不变量

- **强度不降**：spec 阶段与 merge preflight 的存在性校验一处都不放宽；虚假或笔误 ID 仍在合并前被拦。
- **拦截点后移而非消失**：plan 阶段放行的 ID，必然在 spec 阶段被复核。
- **阶段对称**：`tests` 与 `authority_ref` 在每个阶段适用同等宽严，可成对断言。
- **诊断可归因**：失败时点名具体 fact、具体字段、具体未命中 ID，不使用「尚未完成脱模板」这类与实际原因不符的措辞。
- **零回归**：不含 required fact 的提案，L10 结果逐字不变。

### 异常与边界

| 编号 | 触发条件 | 处理 |
|---|---|---|
| EX-S35-AC-1 | plan 阶段 `tests` 为空或 ID 非法 | 判 `authority_closure_incomplete`，点名 fact 与字段 |
| EX-S35-AC-2 | spec 阶段 `tests` 含不存在的 ID | 判 `authority_closure_incomplete`，点名未命中 ID |
| EX-S35-AC-3 | 「复用测试 ID」列出的 ID 在已合并规格中不存在 | 不纳入 effective view；spec 阶段照常拦下 |
| EX-S35-AC-4 | 同一提案下 `tests` 放行而 `authority_ref` 被拒（或反之） | 视为阶段判据不一致的缺陷信号，由对称性测试锚定 |

### 同批收编：change-lint 的 spec-complete 读法归位

**当前的分歧。** `change-lint` 在两处（post-merge 分支判定、L8 守恒是否重放）自行判断提案是否已完成规格阶段，且**只认 `SPEC_MERGED`**；而 `hasSpecCompleteMarker()` 这一权威判据同时接受 legacy `MERGED`。对持 `MERGED` 而无 `SPEC_MERGED` 的提案：

| 组件 | 结论 |
|---|---|
| `proposal-lifecycle`（权威） | 已 spec-complete |
| `plan-package` | 已 spec-complete |
| `test-slice-manifest` | 已 spec-complete |
| `change-lint` | **未 merge** |

后果不是「多报一条」，而是 `change-lint` 对一个 post-merge 提案重放 L8 条目守恒——拿 delta 再去对已经合并完的最终目标做守恒比对。`change-lint` 自身的注释已经写明这会制造假阳性，这正是它在识别出 post-merge 时跳过 L8 的原因；只是 legacy `MERGED` 一路没被它识别出来。

本仓归档中 0 例（历史提案都写了 `SPEC_MERGED`），因此这是**潜伏缺陷**：没有现存数据触发它，也就没有任何测试会红。

**修复。** `change-lint` 的两处判定改为调用 `hasSpecCompleteMarker()`。行为变化只有一个方向：持 legacy `MERGED` 的提案从「被重放 L8 并可能假阳性」变为「正确跳过 L8」。持 `SPEC_MERGED` 的提案（即本仓全部现存提案）判定逐字不变。

**marker 名单点化。** `HISTORICAL_MARKERS` 此前在 `plan-package` 与 `authority-closure` 各列一份，`SPEC_MERGED` 作为裸字面量散落 12 个文件。收敛为 `proposal-lifecycle` 单点导出的常量后，新增或改名 marker 只有一个改动点——这也正是分歧得以产生的土壤被移除。

**不变量 C 在本场景的落点**（架构 §四十一.4）：judgement 的实现只能有一处。`change-lint` 是「权威 helper 存在却被绕过，且绕过者读法不同」这一形态的实例。

### 追溯

- 需求：AC-PLANGATE-03～07、AC-PLANGATE-09、AC-PLANGATE-11。
- 功能规格：§2.50.2～§2.50.4。
- 架构：§四十一.1、§四十一.2。
- 测试：UT-S35-121～UT-S35-126、ST-S35-22～ST-S35-23；安装态 SMOKE-core-172。

## S35 围栏提取单点、可归因诊断与门禁可满足性断言

### 场景目标

消除 `change-lint` 判定链上的两处判据分裂（YAML 围栏提取、测试 ID 语法），让多命中不再静默降级，并为「门在其阶段可满足」建立可执行的失败信号。

### 参与者与前置条件

| 别名 | 组件 | 说明 |
|---|---|---|
| C | `change-lint` evaluator | L0～L10 的完整判定 |
| S | `markdown-scan.authorityScan` | 围栏 / 缩进代码 / HTML 注释掩码的唯一判据 |
| G | 测试 ID 语法权威 | 语法与三种具名读法的唯一铸造点 |
| T | 门禁可满足性断言 | 每道门 × 该阶段合法最小提案 |

### 围栏提取归位时序

```mermaid
sequenceDiagram
    participant C as authority-closure
    participant S as authorityScan
    participant D as 诊断输出

    C->>S: Step 1: 对 proposal 全文求掩码
    S-->>C: Step 2: 每行的 masked 位
    C->>C: Step 3: 只在掩码外识别 ```yaml 围栏起止
    C->>C: Step 4: 过滤出含 authority_impact / baseline_closure 的围栏
    alt 候选恰为 1
        C->>C: Step 5a: 正常解析
    else 候选为 0 或多于 1
        C->>D: Step 5b: 产出点名诊断——命中几处、分别在第几行
        Note over C,D: 禁止静默返回空集
    end
```

**Step 3 的判据变更**：此前 `authority-closure` 用裸正则直接扫全文，是四个 YAML 围栏提取器中唯一不走掩码的。对含嵌套围栏的文档（如四反引号 markdown 块内示意一段 yaml），裸正则比 fence-aware 多命中一个围栏。

**Step 5b 的行为变更**：`collectPlannedAuthorityCreateTargets` 此前在候选数不为 1 时直接返回空集，plan 阶段的 `authority_ref` 容错随之失效，而用户只看到 `authority_fact_reference_missing`——真实原因（围栏被多算了一个）完全不可见。

### 测试 ID 语法的单点与具名读法

| 读法 | 消费方 | 与权威语法的关系 |
|---|---|---|
| 结构化判定 | `test-change-set`、`test-slice-manifest`、`authority-closure` | 完整语法 |
| 表格首列提取 | `test-slice-manifest` | 完整语法 + 行首锚定 |
| 正文扫描 | `automation-diagnostic` | 完整语法减去 SMOKE |

读法差异正当，各自定义不正当。本次消除的是四份独立演化的定义。

**语法与数据的一致性锚**：断言已合并测试规格中每一个表格首列 ID 都被权威语法接纳。原始缺陷不是正则写错了，而是没人检查正则与真实数据是否还对得上——11 个 JSON 系 ID 因此静默失联。

### 门禁可满足性断言

对每一道门构造「该门所处阶段的合法最小提案」，断言其通过：

| 阶段 | 合法最小提案含有 | 不含 |
|---|---|---|
| plan | 完整 proposal（含 authority_impact 与 baseline_closure）+ tasks（`[delta]` 已规划、`[code]` 空标题） | 任何 delta |
| spec / merge | 上述 + 全部已规划 delta | `[code]` 切片 |

断言的价值不在验证当前 11 道门，而在新增门禁时立刻给出失败信号（架构 §四十一.6.2）。

### 诊断可归因要求

全部门禁诊断必须点名导致失败的实体本身——fact_id、测试 ID、文件路径、字段名。禁止「为空、非法或不在某集合中」这类无法定位的措辞。

### 不变量

1. **围栏判据唯一**：四个提取器对同一文档得到同一组围栏。
2. **多命中不静默**：候选数异常时必须产出诊断，不得降级为空集或空结论。
3. **语法唯一、读法具名**：语法恰一处定义；每种读法从其具名派生，不得独立定义。
4. **语法与数据不漂移**：已合并规格中每个表格首列 ID 都被权威语法接纳。
5. **门禁可满足性有断言**：每道门都有对应的「该阶段合法最小提案通过」断言。

### 异常与边界

- 文档不含任何 YAML 围栏：`extractDeclaration` 返回 `missing`，行为不变。
- 语法放宽只增不减：不存在此前被接纳、此后被拒绝的 ID。
- 元测试发现语法与数据漂移时，修复方向是调整语法或修正数据，**不得放宽断言本身**。

### 追溯

- 需求：AC-MERGEGATE-03、AC-MERGEGATE-04、AC-MERGEGATE-06～08。
- 功能规格：§2.51.3、§2.51.5～§2.51.7；架构：§四十一.6.1、§四十一.6.2。
- 测试：UT-S35-127～UT-S35-131、ST-S35-24；安装态 SMOKE-core-173。
