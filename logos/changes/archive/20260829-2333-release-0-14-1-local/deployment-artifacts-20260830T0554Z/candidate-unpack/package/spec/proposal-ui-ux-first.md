# proposal-ui-ux-first：GUI 项目提案阶段前置 UI/UX 原型确认契约

> 本规格是 UI-first 特性的单一契约事实源。`spec/flow-spec.md` / `spec/flow/launched.yaml` / `spec/flow/overlays/gui-ui-first.yaml` / `spec/pretooluse-guard.md` / `spec/change-management.md` / `spec/cli-json-output.md` / `spec/logos-project.md` 各承载其领域细节并引用本规格。

## 1. 概述与适用范围

### 1.1 背景与核心洞察

对已 `launched` 的 **GUI 产品项目**（网站 / 桌面应用 / 移动 App），当变更走 Delta 流程时，
UI/UX 原型此前由 product-designer 在实现期（提案批准之后、driver 自动实现期间）产出。用户在
「批准提案」门只看到纯文字方案，看不到界面；等自动化把 UI 做出来才发现不对，返工发生在全自动
链路里、纠偏成本最高。

**核心洞察**：把 UI/UX 确认**前移到「批准提案」门**——GUI 项目在提案阶段就产出界面原型，使用户
能在批准提案时（**面板已渲染原型的前提下**）连界面一起确认。该等价的前提约束见 §10（provenance
契约）与 §11（严格性以持久化批准记录为键）。

### 1.2 关键设计原则（不变量的来源）

1. **不新增门态、不新增确认标记**：看界面**不是一道新关卡**，它挂在「批准提案」这一现有动作上，
   复用现有 `plan-exit`（批准方案）门。唯一人类确认点仍是 `plan-exit`。
2. **必须跨仓协同、不宣称 driver 不变**：本特性核心价值（plan 门前产原型 + 面板渲染 + 写
   provenance）**必然需要 runlogos driver 改动**（producer dispatch / 原型渲染 / provenance 写入 /
   hash 比对）。openlogos 侧**只定契约**，driver 实现归 runlogos 具名协同 change（见 §12）。
3. **不新增 `ui/` 目录、无额外人工步骤**：原型复用现有 delta 路径映射（`deltas/prd/** →
   resources/prd/**`）落盘，无需新目录、无需人工拷贝步骤（见 §2）。**但落盘实现新增专用事务代码
   路径** `commitVerifiedPrototypes()`（唯一落盘入口，见 §12.3）——「无额外人工步骤」不等于「无新
   代码路径」。
4. **单一事实源**：`ui_impact` 声明段是「本次动没动界面」的权威意图源；「原型是否已产出」以
   `2-page-design/` 下原型文件存在性为准；二者由富对账绑定（见 §5、§6）。不引入第二处判定。
5. **增益功能、容错优先流程平滑**：判错代价可控（顶多多画一次或退回重设），不追求绝对严谨；但
   涉及「批准即确认」核心保证与批准后漂移的强制点必须 fail closed（见 §10、§11、§12）。

### 1.3 适用范围（启用条件）

- **`product_type` 数据源（F1a）**：本节及全规格的「`product_type ∈ GUI`」以
  `logos-project.yaml` 的 `modules[].product_type`（模块级枚举 `web|desktop|mobile|cli|api|library|skills|service`，
  GUI 集合={web,desktop,mobile}，缺失=非 GUI）为**唯一权威源**；判据 module-aware（读活跃提案所属
  module），详见 §6.3。
- **启用**：活跃提案所属 module 的 `product_type ∈ GUI`（网站 / 桌面应用 / 移动 App）**且**活跃提案
  `proposal.md`「UI/UX 变更声明」段声明 `ui_impact: true`。两者缺一即不启用。
- **不启用**：非 GUI 模块（纯 CLI / API / Library / Skills，含 `product_type` 缺失）整个特性不启用、
  流程零改动；GUI 模块声明 `ui_impact: false`（本次未触及界面）时原型相关节点被 `when` 跳过。
- **生命周期**：仅 `launched` flow 有效。initial flow 无提案目录、无 UI/UX 变更声明段，`ui_impact`
  在 initial 恒 false。

## 2. 原型作为 page-design delta

### 2.1 原型产物形态与落盘路径

若判定「本次动了界面」，change-writer 在提案阶段用 `ui-ux-pro-max` 设计系统产出界面原型，**原型
直接作为 page-design delta** 写入：

```
logos/changes/<slug>/deltas/prd/2-product-design/2-page-design/core-NN-<slug>.html
```

- 原型为**裸 HTML**（关键几屏 + 各状态），可被面板直接 `iframe` 渲染。
- `design-system.json`（ui-ux-pro-max 令牌）在 `design_system_mode: generated` 时作为**审计产物**留在
  提案目录供令牌追溯（见 §7）；`fallback` 模式不产此文件、禁伪造，以 `design_system_fallback_reason`
  如实标注降级（见 §15.2）。
- `proposal.md` 保持 markdown 结构不变，避免打断 CLI / runlogos 对 proposal 的解析。

### 2.2 复用现有 delta 路径映射（不新增 `ui/` 目录，但新增专用事务落盘代码路径）

原型**不新增 `ui/` 目录**，复用现有 delta 路径映射（`deltas/prd/** → resources/prd/**`）：

- runlogos 面板已用 `readDir(deltas/**/*)` 列出原型、可直接 `iframe` 渲染；
- delta 路径映射（`scanDeltas` 把 `deltas/prd/**` 映射到 `logos/resources/prd/**`）沿用现有约定，
  原型落入原型图文件夹（先例：`core-03-release-page-prototype.html`），**无需额外人工步骤、无需新目录**。

**但落盘实现不复用旧路径**：原型作为带 hash 绑定的资产，其**唯一落盘入口**是本特性新增的专用事务
函数 `commitVerifiedPrototypes()`（`cli/src/commands/merge.ts`，详见 §12.3）——它是所有 `ui_impact`
原型资产的**唯一落盘入口**，内部按模式选严 / 宽：

- **严格**：`PLAN_APPROVED` 含 UI provenance ⇒ 校验 staged 字节 hash + 原子提交（全有或全无）；
- **advisory（宽）**：legacy / degraded / 旧空 marker ⇒ **仍经同一入口**、只是**不做严格 hash 校验**，
  作普通资产整份落盘。

即：`commitVerifiedPrototypes()` 之外**不存在第二条绕过它的原型落盘路径**（advisory 路径也经此入口，
仅校验强度不同）；**merge-executor 绝不触碰原型资产**（只应用 markdown 规格 delta，见 §15.1）。
故「无新目录 / 无额外人工步骤 / 复用路径映射」**不等于**「无新代码路径」——本特性显式新增
`commitVerifiedPrototypes()` 这条代码级落盘路径。

原型作为 delta 具备**向后兼容性**：旧面板把 `.html` 按文本列出虽不崩、不阻断，但**不构成 UI 视觉
确认**（语义精确化见 §10）。

## 3. `ui_impact` when-flag 与 UI/UX 变更声明段契约

### 3.1 UI/UX 变更声明段（机器可读意图源）

`openlogos change` 生成的 `proposal.md` 模板对 GUI 项目注入一节「**UI/UX 变更声明**」，机器可读地
声明本次动没动界面 + 原型页清单：

- `ui_impact: true | false`——本次是否触及界面。
- `design_system_mode: generated | fallback`——设计系统模式（见 §15.2 降级）：`generated` =
  ui-ux-pro-max 正常产出设计系统令牌；`fallback` = 降级（如 Python3 缺失）以通用风格兜底。
- `design_system_fallback_reason: <一句话>`——**仅 `fallback` 模式必填**（如「Python3 缺失」）；
  `generated` 模式下省略或留空。
- **声明页清单**——`ui_impact: true` 时以**结构化记录**列出本次要产出原型的每一个页面，每条含唯一
  `id` + 精确 `prototype` basename：

```
- id: <unique-page-id>            # 全清单唯一的页面标识
  prototype: core-NN-<slug>.html  # 仅 basename；禁 .. / 子目录；扩展名必须 .html；全清单唯一
  description: <一句话>
```

  约束：`prototype` **只能是 basename**（禁 `..`、禁子目录分隔符）、扩展名**必须 `.html`**、在全清单内
  **唯一**；`id` 在全清单内**唯一**。checker 对账时按精确 basename 集合比较（见 §6.2）。

该声明段是「本次动没动界面」的**权威意图源**（ground truth 之一，见 §7）。`flow-derive` / guard /
面板**只读这一组事实源**，不引入第二处判定。

### 3.2 `ui_impact` 作为新增可派生 when-flag

`ui_impact` 是对 `spec/flow-spec.md` §8 when-flag 词表的**新增项**，派生方式仿 `delta_required`，且
**module-aware**——只对**活跃提案所属 module** 求值，读该 module 在 `logos-project.yaml` 的
`modules[].product_type`（唯一数据源，GUI 集合={web,desktop,mobile}，缺失=非 GUI，见 §6.3）：

- 活跃提案所属 module 的 `product_type ∈ GUI` **且** 声明段 `ui_impact: true` → `ui_impact = true`；
- 该 module 的 `product_type` 非 GUI（含缺失）→ 恒 `false`（整个特性不启用，overlay 节点被 `when` 跳过）；
- 声明段缺失或 `ui_impact: false` → `false`；
- 仅 launched flow 有效（initial 恒 false）。

**落地边界**：`flow-spec.md` §8 词表新增项 + `launched.yaml` 同步为 `[delta]`；`flow-derive.ts` 的新
派生逻辑为 `[code]`。二者不在本 proposal 节点产出（见 §4.3 时序）。

## 4. 判定主体、时机与去循环依赖 + 落地边界

### 4.1 「动没动界面」的判定主体与时机

判定在 **plan 阶段由 change-writer 执行**，依据是**提案意图 + 项目 `product_type` + `tasks.md` 已
规划的 `[delta]` 目标**，**而非扫描尚不存在的 delta 文件内容**（在 plan 阶段无 delta 可扫，扫内容
兜底构成「先 delta 还是先原型」循环依赖，已废除）。三层落为：

1. change-writer 依 `product_type` 与提案意图声明；
2. 自检 `tasks.md` `[delta]` 目标是否命中 `2-page-design/` 或含交互变更的 feature-specs，命中即
   强制判为「动了界面」；
3. 可选多 agent 复核（默认关，可由 driver 派发）。

据此判定后再产出原型，无循环依赖。

### 4.2 producer 交付责任（硬约束）

producer = change-writer（driver 派发），**必须调用 ui-ux-pro-max** 产出逐页非空原型 + 令牌
（`design-system.json`）。该交付责任由 **change-writer skill + UT/ST + 验收**执行与校验（在
spec/skill/测试阶段落实，非本 proposal 节点产出）。

### 4.3 落地边界（plan→spec→code 时序与 [delta]/[code] 目标锁定）

本特性契约分散落到多份规格与运行时代码。为避免越位实现，本规格**只把它们具名为 `[delta]` /
`[code]` 目标并锁定落地顺序**，不越位实现：

- `deltas/spec/**`（`launched.yaml` / `flow-spec.md` / 本规格等）属 `spec` subflow 的 `write-delta`
  节点（plan-exit 门**后**）产物，为 `[delta]`；
- 运行时代码（`flow-derive.ts` 派生、guard allowlist、`capabilities` 载体、merge 命令级 hash 门、
  `commitVerifiedPrototypes()`、checker 命令、面板渲染、provenance 写入）属 merge 后 `slice-planner`
  的 `[code]`；其中 producer dispatch / 面板渲染 / provenance 写入归 runlogos（见 §12）。
- 在 plan 节点产出上述任何一项都会同时违反 (i) plan→spec→code 时序、(ii) 「plan 阶段写入 allowlist
  仅放行原型路径」，故本 proposal 节点不产出它们。

## 5. 原型接入 plan 节点：产物声明 + 写入 allowlist + producer dispatch

原型真正接入 plan 节点需**三处硬接线**（仅写文字口径不接线则原型不会被产出）：

### 5.1 (a) plan 节点产物声明

`spec/flow-spec.md` 把 GUI page-design 原型显式列为 plan 节点的输出物之一（与 `proposal.md` /
`tasks.md` 并列），使流程知道 plan 节点应产出它。

### 5.2 (b) 写入 allowlist（plan 阶段仅放行原型路径）

plan-exit 门前，写入范围**显式放行且仅放行** `deltas/prd/2-product-design/2-page-design/*.html`
这一原型路径；其余 `deltas/**` 在 plan 阶段**仍禁止写入**。该规则落入 `spec/pretooluse-guard.md`
与 `spec/change-management.md`，并由 guard（`plugin/bin/guard-check` 与 `.claude/openlogos/bin/
guard-check`）在运行时落实。此规则与 §3 的 ordering 例外、§9.2 的 SessionStart writing 分支例外
**三者口径一致**（仅 `2-page-design/*.html` 例外，其余 delta 仍禁于 plan 阶段）。

### 5.3 (c) producer dispatch 契约

定义 driver 在 plan 节点、当判定「动了界面」时**派发 change-writer（用 ui-ux-pro-max）在
plan-exit 前产出原型**的 dispatch 契约：

- **契约由 openlogos spec 定义，driver 实现归 runlogos（另立 change，见 §12）**。
- producer 产出是 **plan 节点门前的普通内容生成**，授权状态与「写 `proposal.md` / `tasks.md`」
  **完全相同**（不新增授权、不新增门，见 §13 授权链）。

### 5.4 ordering 例外与 flow-derive 判据

`flow-derive` 仅当出现**非原型的规格 delta**、或 plan-exit 已放行时才视为进入 spec；例外**仅限**
`2-page-design/*.html` 叶子原型，不涉及 `[code]` 切片与 spec-merge 依赖；其余 delta 仍严格在
plan-exit 之后产出。

## 6. overlay-add 节点与 done_when 富对账

### 6.1 为何用 overlay-add 而非 builtin 硬编码

现有 flow 引擎的 `done_when` 词表中，`cmd:<command>` 谓词在 **builtin** 节点**非法**、只在
**overlay-add 节点合法**（见 `flow-spec.md` §9.2）。而弱谓词（如 `dir_nonempty`）不足以表达「逐页
非空 + 令牌 + 声明清单==产出文件 + 内容 hash」的富对账。故：

- `write-ui-prototype` **不做 builtin `launched.yaml` 节点**，改为**方法论给 GUI 项目提供的 overlay
  `op:add` 节点**（`after: write-tasks`，落在 plan subflow 内、plan-exit 门**前**）。
- 作为 overlay-add 节点，它**合法使用 `done_when: cmd:`**，其命令后端是**真实可执行 CLI 子命令**
  `openlogos check-ui-prototype`（F1b）——见 §6.2 契约。
- builtin `launched.yaml` **不再硬编码** write-ui-prototype 节点。

### 6.2 `write-ui-prototype` 节点与 `check-ui-prototype` 富对账契约

`write-ui-prototype` overlay-add 节点：

```yaml
- id: write-ui-prototype
  skill: change-writer          # product-designer 子流程可复用
  after: write-tasks            # plan subflow 内、plan-exit 门前
  when: ui_impact
  produces: deltas/prd/2-product-design/2-page-design/
  done_when: cmd:openlogos check-ui-prototype   # 真实可执行子命令（占位 <...> 仅文档示意）
```

**可执行命令契约（F1b）**：overlay 的 `done_when` 后端是**真实 CLI 子命令**
`openlogos check-ui-prototype`——在**项目根 cwd**运行、**自解析活跃提案**（无需路径参数）、`exit 0` =
对账通过、非 0 = 未通过（node 未 done）。本规格与 overlay 源文件中出现的 `<...>` 占位**仅为文档
示意**；**运行时 overlay 资产的 `done_when` 必须是可执行命令字符串**，不得残留 `<...>` 占位。

`check-ui-prototype` 命令做**富对账**（命令 `exit 0` 才判 done）。对账**按声明段
`design_system_mode` 分模式**——把「所有 UI 原型 plan-exit 前必须有 `design-system.json`」修订为
「`generated` 要令牌、`fallback` 要降级原因，二者都要逐页非空 + 清单一致」，从而消解「降级不产令牌
但 done_when 强制要 `design-system.json` → 永久卡死」的矛盾：

**两模式共同要求**：

1. **逐页非空**：声明页清单中的**每一个页面**（按其 `prototype` basename），在 `2-page-design/` 下都有
   **对应的非空原型文件**（不再是「至少一个文件」）；
2. **声明清单 == 产出文件（basename 集合一致）**：把声明清单的 `prototype` basename 集合与
   `2-page-design/` 下实际产出的 `.html` basename 集合做**规范化集合比较**——**排序无关**、**重复失败**、
   **额外文件失败**、**缺失文件失败**；`prototype` 出现 `..` / 子目录 / 非 `.html` 扩展名即判非法失败。
3. **内容 hash 记录**：以同一 basename 规范键记录逐文件内容 hash（为 §8 provenance / §12 hash 防漂移
   提供输入）；`PLAN_APPROVED.pages` 与 `PLAN_APPROVED.hashes` **复用同一 basename 规范键**。

**分模式要求**：

- `design_system_mode: generated` → **必须**存在合法非空 `design-system.json`（ui-ux-pro-max 令牌，
  供追溯）；缺令牌 → **fail closed**（非零退出）。
- `design_system_mode: fallback` → **必须**有非空 `design_system_fallback_reason`（如「Python3 缺失」）；
  **禁止伪造令牌、不要求 `design-system.json`**；只要逐页非空 + 清单一致即 `exit 0`（**不阻塞**降级路径）。
- **其它值 / 缺 `design_system_mode` 字段 / `generated` 但无令牌** → 一律 **fail closed**（非零退出）。

由此富对账成为 **plan-exit 前的机器收敛条件**：命令 `exit 0` → 节点 done → plan 子流程完成 →
plan-exit 门才可放行。`ui_impact: false` 时该节点 `when` 不满足而 skip。

### 6.3 落地方式（overlay 由方法论注入 · 真实源文件 · product_type 数据源）

`write-ui-prototype` / `verify-ui-provenance` 是**方法论提供的真实可注入资产**，唯一源文件 =
`spec/flow/overlays/gui-ui-first.yaml`（本特性 `[delta]` 新增）。该文件含两个完整 `op:add` 节点
（`write-ui-prototype`、`verify-ui-provenance`），是 overlay 的**唯一事实源**——本规格与 `flow-spec.md`
仅**引用并约束**其契约，不以「Markdown 示例片段」替代真实资产（本文档内的 YAML 片段仅为可读性
摘录，**非** L3 交付本体，交付本体是上述 `.yaml` 源文件）。

**`product_type` 唯一数据源（F1a）**：本特性凡提「`product_type ∈ GUI`」处，`product_type` 的**唯一
权威数据源** = `logos-project.yaml` 的 `modules[].product_type` 字段——**模块级**枚举，取值
`web | desktop | mobile | cli | api | library | skills | service`，其中 **GUI 集合 = {web, desktop, mobile}**；
字段**缺失即视为非 GUI**。`product_type` 不得悬空无源、不得从别处推断。据此派生两层：

- **项目实例级（overlay 注入判据）**：项目**含 ≥1 个 GUI 模块**（`modules[].product_type ∈ GUI`）时，
  在项目实例上注入 GUI overlay（overlay 是**项目实例级注入**，一次注入对全项目 launched.yaml 生效）；
  无任何 GUI 模块则整个特性不注入。
- **节点参与级（module-aware）**：具体某提案的 overlay 节点是否参与，由 **module-aware 的
  `ui_impact`** 决定——`ui_impact` 只对**活跃提案所属 module** 求值，读该 module 的 `product_type`
  （GUI 才可能为 true）与该提案声明段。即「项目注入 overlay」与「某提案节点触发」是两层：前者看项目
  有无 GUI 模块，后者看活跃提案所属 module 是否 GUI + 声明段。

- **注入机制**：`openlogos init` / `sync` 在项目**含 ≥1 GUI 模块**时把该 overlay 片段的 `op:add` 节点
  **合并进项目实例** `logos/flow/launched.yaml`（`extends: builtin:launched@v1` + overlay 列表引用
  `gui-ui-first`）；无 GUI 模块的项目**不注入**（机器条件读 `logos-project.yaml` 的
  `modules[].product_type`，缺失=非 GUI）。
- **builtin 基线不含这两节点**：builtin `spec/flow/launched.yaml`（及项目物化的 launched 基线）
  **仍不硬编码** `write-ui-prototype` / `verify-ui-provenance`；它们只经 `gui-ui-first.yaml` overlay 注入。
- **落地分工**：`[delta]` = 本规格 + `flow-spec.md` + `spec/flow/overlays/gui-ui-first.yaml`（overlay 源
  文件与两节点定义 + `check-ui-prototype` / `check-ui-hash-match` 契约）；`[code]` = 注入逻辑（init/sync
  按 `logos-project.yaml` 的 `modules[].product_type` 判是否含 GUI 模块并合并 overlay）与 checker 命令实现。

### 6.4 存量项目可达性与迁移（F1）

上面 §6.3 的注入机制只描述了「`init` / 新建项目采集 `product_type` → 注入 overlay」这条正向路径。但
**目标人群恰是已 `launched` 的既有 GUI 项目**：它们在本特性落地前建立，`logos-project.yaml` 的
`modules[]` 条目**缺 `product_type` 字段**（历史遗留）。按 §6.3 安全默认「缺字段=非 GUI」，这些存量
GUI 项目会被判非 GUI → overlay 不注入 → `ui_impact` 恒 false → **UI-first 对存量 GUI 项目不可达**。
故「注入机制」不能只覆盖 init/新建，**必须同时覆盖存量回填路径**——本节定义该迁移的机器可判定契约，
使「注入机制」对 init/新建与存量回填**两条路径都成立**。

**(a) 幂等回填命令 `module set-product-type`**——存量项目经**幂等回填命令**显式设置 `product_type`：

```
openlogos module set-product-type <module-id> <enum>
```

写 `logos-project.yaml` 的 `modules[].product_type`（`enum ∈ {web|desktop|mobile|cli|api|library|skills|service}`）。
**非法枚举 / 未知 module-id / 缺参**一律报错（非零退出、不写文件）；**幂等**（重复设同值为 no-op）。
`module add` 亦采集 `product_type`，使新增模块从建立起即有该字段。回填后该 module 满足 `product_type ∈ GUI`
的判据（§6.3），overlay 注入前提成立。

**(b) 缺字段的机器可读诊断 `PRODUCT_TYPE_CONFIRMATION_REQUIRED`**——`sync` / `status` / `next` 检测到
**已 `launched` 且 `modules[]` 缺 `product_type`** 的模块时，发出机器可读诊断
`PRODUCT_TYPE_CONFIRMATION_REQUIRED`：列出缺字段的 module，并指向 `module set-product-type` 作为
next action。诊断期间**安全默认「缺字段=非 GUI」维持不变**（不臆断升级），直到用户**显式** `set-product-type`
后 overlay 才注入。诊断使「存量 GUI 项目当前不可达」这一状态**可被发现、可被修复**，而非静默失效。

**(c) `--auto` 绝不猜测升级 GUI**——无人值守模式下，缺 `product_type` 的模块**绝不被自动判为 GUI**：
`--auto` 保持安全默认（非 GUI、不注入 overlay），并照常**暴露 `PRODUCT_TYPE_CONFIRMATION_REQUIRED`
作为 next action**；仅当用户**显式** `set-product-type` 配置后才注入。即 `--auto` 不因「顺手推进」而猜测
product_type，安全默认与诊断暴露二者兼得。

**(d) `sync` 幂等注入/移除（正反向、保留用户自定义 ops）**——`sync` 是 overlay 注入/移除的**幂等收敛点**，
按 node id `write-ui-prototype` / `verify-ui-provenance` 识别本特性 overlay ops：

- **正向注入（幂等）**：回填出 ≥1 GUI 模块后 `sync` 把 `gui-ui-first` 两 op:add 节点并入项目实例
  `launched.yaml`；**重复 `sync` 不重复注入**（按 node id 去重，已存在即 no-op）。
- **反向移除（GUI→非 GUI / 删最后一个 GUI 模块）**：当项目**不再含任何 GUI 模块**（唯一 GUI 模块
  `set-product-type` 改为 `cli` 等非 GUI，或删除最后一个 GUI 模块）时，`sync` **幂等移除**已注入的
  `gui-ui-first` ops（按 node id `write-ui-prototype` / `verify-ui-provenance` 识别移除）。
- **保留用户自定义 overlay ops（硬约束）**：`sync` 的注入/移除**只按上述两个 node id 识别本特性 ops**；
  同一 `launched.yaml` 里用户自定义的其它 overlay ops（非本特性 node id）**保持不变、绝不被 sync 删除**。
  即 sync 对 overlay 的写操作**限定在本特性 node id 命名空间内**，不越界触碰用户 ops。

**落地分工（补 F1）**：`[delta]` = 本节契约（回填命令语义 / 诊断码 / `--auto` 安全默认 / sync 正反向幂等 +
用户 ops 保留）；`[code]` = `module set-product-type` 命令实现、`module add` 采集、`sync`/`status`/`next`
的缺字段检测与 `PRODUCT_TYPE_CONFIRMATION_REQUIRED` 输出、`sync` 按 node id 幂等注入/移除逻辑。诊断码
的 JSON 载体细节见 `spec/cli-json-output.md`，回填命令与 `logos-project.yaml` 字段细节见
`logos/logos-project.md`（本节仅定义 UI-first 迁移契约的横切结论，不重复其字段定义）。

## 7. ground truth 与不可约残差

### 7.1 完整 ground truth（三方对账）

权威三元组必须一致——不一致 = 节点未收敛：

1. `proposal.md` 声明段的 `ui_impact` + **结构化声明页清单**（每条 `id` + `prototype` basename，权威
   意图源）；
2. `2-page-design/` 下实际产出的原型文件（按 basename）；
3. merge 落盘 / 面板渲染的对象。

**声明清单 basename 集合 == 产出文件 basename 集合** 为完整性判据（规范化集合比较，见 §6.2）；
`generated` 模式下 `design-system.json` 把文件系到 ui-ux-pro-max，`fallback` 模式下以
`design_system_fallback_reason` 如实标注降级。三处只读这一组事实源，不引入第二处判定，避免
`ui_impact` 与文件存在性各说各话。

### 7.2 不可约残差（如实标注，非遗漏）

「HTML 是否*真出自* ui-ux-pro-max」除 `design-system.json` 令牌可追溯外**无法纯机器证明**——这是
既有 acceptance 口径下的**荣誉制 + 令牌追溯**限制，**如实记录、非遗漏**。「存在性」不等于
「可交付」（文件可能为空、非 ui-ux-pro-max 产物、或声明多页只产出一页），故 §6.2 富对账用
「逐页非空 + 令牌 + 清单一致」收紧收敛，把弱残差压到最小可机器判定面。

## 8. provenance 契约：载体、字段、向后兼容、hash 防漂移

provenance 是 `plan-exit` 批准记录上的**属性**，**非独立文件、非新门**。

### 8.1 载体与向后兼容（F3）

provenance 落在 **`PLAN_APPROVED` marker 的可选 JSON body**。`PLAN_APPROVED` 是「**存在性 marker +
可选 provenance body**」的**向后兼容超集**，非破坏性重定义：

- **存在性语义完全不变**：`PLAN_APPROVED` 存在即门已过，**空 marker 仍合法**（现有
  `writePlanApproved()` 空写路径与「仅存在性」读取者不受影响）。
- provenance 是**可选叠加字段**：缺失 / 空 body ⇒ 安全默认「不宣称 UI 已确认」。
- 仅 runlogos 批准路径写 JSON body；仅 UI 确认消费者按存在与否解析、缺失容忍。
- driver 批准 progress 事件**可镜像但不权威**，判定一律以 `PLAN_APPROVED` 为准。
- `[code]` 触点：`writePlanApproved()`（可选写 JSON）与 provenance 读取者。

### 8.2 provenance body 字段

```json
{
  "ui_prototype_rendered": true,
  "pages": ["core-NN-<slug>.html", "..."],
  "hashes": { "core-NN-<slug>.html": "<sha256>" }
}
```

记录**批准时刻**确认的原型文件清单（`pages`，精确 basename）与逐文件内容 hash（`hashes`，以同一
basename 为键）。`pages` 与 `hashes` **复用 §6.2 的 basename 规范键**，与声明清单的 `prototype`
basename 对齐。**绑定 pages + 内容 hash** 是防批准后漂移的键。

### 8.3 hash 防漂移（批准后漂移即确认作废并阻断）

下游（merge / implement）**重算 hash 比对**：

- **hash 全匹配** + `ui_prototype_rendered:true` = UI 已确认、放行；
- **任一 hash 失配**（原型在批准后漂移）⇒ **该 UI 确认作废**，且对 `ui_impact:true` 变更**阻断**其
  交付前进（**不是仅 advisory 就放行**）。阻断方式**复用现有 `plan-exit` 门的「批准内容变更即
  批准失效」完整性语义**（原型 hash 变了 → 批准过期 → 必须**重新批准**才能继续），**不新增门**。
- **缺失 / false**（旧面板 / 未渲染，**非漂移**）= 不宣称 UI 已确认、记 advisory、不阻断（保留 §8.1
  向后兼容语义：无 provenance ≠ 漂移）；此 advisory 路径的原型**仍经 `commitVerifiedPrototypes()`
  落盘**（§12.3），只是不做严格 hash 校验，而非走另一条绕过入口。

**适用范围**：仅 `ui_impact:true` 提案要求这些字段有意义；`ui_impact:false` 不涉及。

## 9. 失效检测点：`verify-ui-provenance` 置于 merge 前

### 9.1 检测点前移到 merge 之前

漂移检测点**置于 merge 之前**（晚于 merge 则漂移原型已落入 resources，太迟）。以 overlay-add 节点
`verify-ui-provenance` 实现：

```yaml
- id: verify-ui-provenance
  before: generate-merge-prompt   # merge 之前
  when: ui_impact
  done_when: cmd:openlogos check-ui-hash-match   # 真实可执行子命令（占位 <...> 仅文档示意）
```

### 9.2 单 `done_when: cmd:` + `check-ui-hash-match` 三分支

`verify-ui-provenance` 用**单个** `done_when: cmd:openlogos check-ui-hash-match`（不用 `fail_when`——
只给 `fail_when` 则 hash 匹配的成功路径永不 done、流程卡死；且 §9.2 决策 B 禁同节点
done_when/fail_when 均为 cmd:）。节点**仅单 `done_when: cmd:`（无 `fail_when`）**——三分支逻辑全部
在命令**内部**实现。

**可执行命令契约（F1b）**：`check-ui-hash-match` 是**真实 CLI 子命令** `openlogos check-ui-hash-match`
——项目根 cwd、自解析活跃提案、`exit 0` = 放行（node done）、非 0 = 阻断（node 未 done）。规格与
overlay 源文件中的 `<...>` 占位仅文档示意；**运行时 `done_when` 必须是可执行命令字符串**。

**`check-ui-hash-match` 三分支（F6，与 §11.3 / merge 落盘同一「持久化批准记录」分支一致）**：命令读
`PLAN_APPROVED` 持久化 provenance（**非会话 capability**）分三支：

1. **含 UI provenance**（`ui_prototype_rendered:true` + `pages` + `hashes`）→ 重算 `2-page-design/`
   现值 hash 与 `PLAN_APPROVED.hashes` 逐文件比对：`hashes` **完好且全匹配** → `exit 0`（node done、
   放行）；**缺失 / 损坏 / 失配** → **非 0 fail closed**（node 未 done、前向阻断）。
2. **legacy/degraded 或旧空 marker 且无任何「曾渲染确认」证据** → **记 advisory 后 `exit 0`**（node
   done、merge 可达）。**这是新增的第三成功分支**——解决「GUI `ui_impact:true` 但批准记录为旧空
   `PLAN_APPROVED`（legacy/degraded、无曾渲染证据）的提案，此前因 §9.2 只有两果而永久卡在
   `verify-ui-provenance`、advisory 放行不可达」的死锁；此类提案的 advisory 放行现**经本节点 `exit 0`
   达成，而非绕过节点**。
3. **部分 / 损坏 provenance**（`ui_prototype_rendered:true` 但 `hashes` 缺失 / 为空）→ **不得误判为
   legacy** → **fail closed（非 0）**。即「曾声明渲染」证据存在但 hash 载体不全，一律按失效处理，不得
   走第 2 支被放行。

三分支只有第 1 支「完好全匹配」与第 2 支「legacy/advisory」两种成功路径 `exit 0`；第 1 支的
失配/损坏与第 3 支的部分 provenance 均 `exit` 非 0。单 cmd: 合法（overlay-add，非双 cmd:）。

### 9.3 状态转换（诚实边界）

flow 引擎**前向线性、无跨 subflow 自动回退边**。故「退回 plan-exit」**非引擎自动 rewind**，而是：
`verify-ui-provenance` 未 done ⇒ 阻断；remediation = **driver/人工显式重入 plan**（重跑 producer 产
原型 + plan-exit 重批，刷新 `PLAN_APPROVED.hashes`）→ 再到该节点时 hash 匹配 `exit 0` → done →
放行。即「失配即卡在未 done + 显式重入刷新」，不假装引擎自动倒转。

## 10. 「批准即确认」的前提精确化

### 10.1 精确化确认语义

「批准 == UI 已确认」这一等价**仅当面板实际渲染了原型时成立**。在不渲染的旧面板上，批准只是
普通方案批准、**不构成 UI 视觉确认**。「文本降级安全」≠「用户已确认 UI」——旧面板把 `.html` 按
文本列出虽不崩，但用户点批准时并没有**看到渲染后的界面**。

### 10.2 在既有批准事件上加 provenance（非阻断、非新门）

渲染面板在批准时记录「已展示原型」标记（§8 provenance）；缺该标记（旧面板）则方法论**不宣称 UI
已确认**、给出 advisory 提示，但**不阻断**（延续「文本降级不阻断」立场）。这是既有批准事件上的
溯源属性，不是新门 / 新确认标记文件。

### 10.3 过渡期指引

建议 runlogos 渲染升级**先于** GUI 团队依赖本前移价值发布；未升级前，用户可直接打开原型 `.html`
自行确认。openlogos 侧仍可独立发布并自洽（原型即普通 delta，merge 照常落盘），旧面板不崩不阻断，
接口仅为「delta 路径下的 `.html` 文件」、无需版本握手；发布顺序 openlogos 先行、runlogos 渲染为
增量升级。

## 11. F4 R7 严格性以持久化批准记录为键（堵跨会话降级绕过）

### 11.1 根因与定案

严格性**绝不**取决于「消费时的易失会话能力」，而取决于「批准时已发生的确认事实」。若以消费时的
`logos/.session-capabilities.json`（私有、gitignore、易失会话态）为严/宽键，会出现确定绕过：渲染
就绪会话写了带 `hashes` 的 `PLAN_APPROVED` → 原型被改 → 在新 CLI-only 会话执行 merge、capability
文件缺失 → 按「缺失=降级」advisory 放行漂移原型，重开「确认 vX、实现 vY」通道。定案——把**模式
选择**与**强制语义**分离：

### 11.2 模式选择（plan-exit 之前）才读会话 capability

capability 就绪 → 渲染确认模式（要求 provenance + hash）；缺失 → 降级模式（不 claim UI 确认）。
这是 `.session-capabilities.json` 的**唯一**合法用途——只用于 plan-exit **之前**选交互模式，**绝不**
作为批准后的完整性门降级开关。

### 11.3 强制语义（plan-exit 之后）以 `PLAN_APPROVED` 持久化 provenance 为准

merge / 落盘 / 落盘后复核**不再读 session capability**：

- **批准记录含 UI provenance**（`ui_prototype_rendered:true` + `pages` + `hashes`，即该批准曾走渲染
  确认路径）⇒ **所有 merge / 落盘 / 落盘后复核入口永久 fail closed**：`hashes` 必须存在且完好、
  逐文件重算匹配；缺失 / 损坏 / 失配一律拒绝（非零退出、不生成 `MERGE_PROMPT`、不写 resources、
  不写 `SPEC_MERGED`）。**当前会话 capability 文件缺失 / 过期 / 被清理一律不得降级**——「曾渲染
  确认」的证据已固化在批准记录里，易失会话态无权推翻它。
- **批准记录明确为 legacy/degraded，或旧空 marker 且无任何「曾渲染确认」证据** ⇒ 才允许 §8.1
  向后兼容 advisory 放行（不要求 `hashes`、不阻断）。
- 判据由 `ui_impact` **与 `PLAN_APPROVED` 内容**共同决定。`merge.ts` / `check-ui-hash-match` /
  freshness 三处（提示前 / 落盘时 / 落盘后）**一致按此**，杜绝三处复用同一「capability 缺失即降级」
  错误分支而一致放行、形不成纵深防御。

### 11.4 跨会话验收（UT/ST）

渲染批准（写带 `hashes` 的 `PLAN_APPROVED`）→ 删除 `logos/.session-capabilities.json` → 重启进程 →
改动原型 → 直接 `openlogos merge`：**必须拒绝**，不得生成 `MERGE_PROMPT` / 写 resources / 写
`SPEC_MERGED`；对照组「旧空 marker 的纯 CLI 项目」仍 advisory 放行。该用例**必须同时覆盖
`commitVerifiedPrototypes()` 落盘入口**（不止提示前检查）——断言漂移原型在事务落盘门也被 fail
closed、resources 零残留。用例登记入 `core-S09-test-cases.md`。

## 12. merge 命令级强制 + freshness 三处 + 事务性原子落盘

### 12.1 merge 命令级 hash 强制（堵直接调用绕过）

flow 的 `verify-ui-provenance` 节点只拦 **driver 流**；`cli/src/commands/merge.ts` 现完全不查 flow /
`PLAN_APPROVED` / hash，故直接执行 `openlogos merge <slug>` 会绕过漂移检查。修：把 hash 校验**下沉
进 merge 命令**——对 `ui_impact:true` 且批准记录含 UI provenance 的提案，`merge()` 在扫 delta /
生成 `MERGE_PROMPT` **之前**读 `PLAN_APPROVED.hashes` 并重算 `2-page-design/` 原型现值 hash，**失配
即拒绝 merge（非零退出 + 明确错误、不生成 MERGE_PROMPT）**。由此**无论经 driver 流还是直接 CLI
调用都不可绕过**：flow 节点 = driver 流表示，merge 命令级校验 = 真强制点（single source of
enforcement）。

### 12.2 freshness 权威校验点在落盘时刻（TOCTOU 闭合）

`openlogos merge` 是 AI 驱动——`merge.ts` 生成 `MERGE_PROMPT` 后停手，实际把 delta 写进
`logos/resources/` 的是后续 `apply-merge` / merge-executor。只在生成提示前做 hash 校验，则**提示
生成→实际落盘之间原型 delta 仍可漂移**，TOCTOU 未闭合。修，权威校验点下沉到**落盘时刻**：

- 原型是 page-design **整份文件资产**（非段合并），其落盘改由**代码级路径**执行、落盘前重算 hash
  比对 `PLAN_APPROVED.hashes`，失配则**拒绝落盘**；
- **落盘后复核（双保险）**：`apply-merge` 完成后代码复核 resources 中已落盘原型 hash ==
  `PLAN_APPROVED.hashes`，不符则**阻断流程前进**（不进 slice/code）；
- `merge.ts` 生成提示前的检查保留为**早失败优化**；**权威门 = 落盘时刻校验 + 落盘后复核**；
- 三处（提示前 / 落盘时 / 落盘后）**全部按 §11 的「持久化 provenance 为键」分支**，不以消费时会话
  capability 做严/宽开关。

### 12.3 事务性原子落盘 `commitVerifiedPrototypes()`（全有或全无、失败零残留）

原型资产落盘升级为**事务语义**：

- **具名执行入口（单一 owner）**：原型资产落盘由 `openlogos merge` 内的**唯一命名函数**
  `commitVerifiedPrototypes()`（`cli/src/commands/merge.ts`）执行；**merge-executor 绝不触碰原型资产**
  （只应用 markdown 规格 delta）。此函数是原型落盘的**唯一代码入口**，无第二条落盘路径可绕。
- **三段事务（verify-all → stage → atomic commit）**：
  1. **全量校验**——落盘任何文件前，先对**本次全部** ui_impact 原型资产重算 hash 比对
     `PLAN_APPROVED.hashes`，任一不符即**在写入任何文件前 abort**；
  2. **staging**——校验通过的资产先写临时区；
  3. **原子提交**——以原子 rename 逐文件提交（POSIX rename 原子），失败即**回滚**（删 staging +
     用备份还原已提交部分）。
- **失败语义（无残留）**：任一阶段失败 ⇒ **resources 回到 merge 前状态**（无部分落盘、无未获批
  内容）、`SPEC_MERGED` 不写、流程标记失败并阻断；remediation = 显式重入 plan 刷新 hashes 后重跑。
  即**全有或全无、失败零残留**。
- **进入事务门的判据**：门控一律以持久化 `PLAN_APPROVED` provenance 为准（§11）——含 UI provenance
  时**永久进入严格事务门并 fail closed**，当前会话 capability 缺失一律不得跳过；仅 legacy/degraded 或
  旧空 marker 无「曾渲染」证据时走 §8.1 advisory。**注意：advisory 与严格两条分支都在
  `commitVerifiedPrototypes()` 这一唯一入口内分流**——advisory 只是**跳过严格 hash 校验**、作普通资产
  整份落盘，**而非**走另一条绕过本函数的落盘路径。不存在第二条原型落盘路径。

### 12.4 消除 verify-to-stage 竞态 + 崩溃恢复（契约级机制 + 硬验收标准）

- **消除竞态：校验 staged 字节而非源**——`commitVerifiedPrototypes()` 先把源原型拷入私有 staging，
  **对 staged 副本算 hash 比对 `PLAN_APPROVED.hashes`**，随后**原子 rename 的正是这份已校验的 staged
  字节**。「已校验字节 == 已提交字节」，verify 与 commit 间无 TOCTOU 窗口（源在校验后再变也不影响
  ——提交的是 staged 快照）。
- **崩溃恢复：intent journal + 启动恢复**——提交前写 **commit journal**（`{target, staged, backup}`
  清单，落 `logos/changes/<slug>/` 下）；实际 rename 按 journal 逐条执行。进程若在提交中途崩溃，
  **下次 `openlogos merge` / 启动时检测到残留 journal** → 依 journal **前滚**（补完未完成 rename）
  **或回滚**（用 backup 还原、删 staging），最终到达**一致的全有或全无态**；恢复完成后清 journal。
- **边界声明（诚实）**：以上为**契约级机制与硬验收标准**（`[code]` 必须满足、`openlogos verify` /
  测试必须覆盖，含崩溃注入用例）；其**具体实现代码**（rename/备份/journal 读写调用、`fsync` 粒度、
  并发锁）按 plan→spec→code 时序在 implement / verify 阶段落地，不在本 proposal 节点手写。

## 13. 跨仓交付闭环、具名依赖、能力门、指令资产、授权链

### 13.1 跨仓必要交付闭环（两仓都必须落地）

本特性核心价值 = openlogos 契约（本 change：flow 节点 + `ui_impact` flag + 声明段 + provenance 契约 +
guard allowlist）**且** runlogos 实现（协同 change：producer dispatch + 原型渲染 + provenance 写入 +
hash 比对）。**二者缺一，核心视觉确认价值即不成立**。顺序：openlogos 契约先 merge/发布 → runlogos
依此实现。runlogos change 是**必须交付的关联件（非可选）**，显式登记为依赖，不得以「另立 change」
为由默认其存在性。

### 13.2 具名依赖 `ui-ux-first-panel`（runlogos 仓）

runlogos 关联件登记为具名 change **`ui-ux-first-panel`**（runlogos 仓，待创建）。openlogos 契约
merge 后创建并跟踪，二者以此 slug 对齐、非「默认其存在」。

### 13.3 前置能力门 `capabilities.ui_prototype_render`

- **前置能力声明**（非批准后事后探针）：`capabilities.ui_prototype_render` 经 **SessionStart 上下文**
  表面传递。具体载体 = **源模板 `plugin/bin/openlogos-phase`（Claude）+ `plugin-codex/session-start.sh`
  （Codex 入口）**（二者均生成注入 AI/driver 的 OpenLogos 上下文块，追加 `capabilities` 段；
  `.claude/openlogos/bin/openlogos-phase` 只是 sync 部署副本、**不直接改**）**+ `openlogos status` /
  `next` JSON 的 `capabilities` 字段**（契约见 `spec/cli-json-output.md`）。
- **输入通道（runlogos→openlogos）**：**runlogos 在会话建立时写 `logos/.session-capabilities.json`**
  （例：`{"ui_prototype_render": true}`）；**`openlogos-phase` 钩子与 `status`/`next` 读该文件**，据以
  生成上下文 `capabilities` 段与 JSON `capabilities` 字段。**文件缺失 = 能力缺失（降级模式）**。该
  文件为 runlogos 私有会话态、`logos/` 下（gitignore），非方法论产物。
- **用途约束**：该 capability **仅用于 plan-exit 之前的模式选择**（§11.2）；plan-exit 之后的强制语义
  一律以持久化 `PLAN_APPROVED` provenance 为准，绝不因会话 capability 缺失降级（§11.3）。
- openlogos 侧在 plan-exit **之前**从上下文读取决定模式——就绪 → 渲染确认模式；缺失 → 降级模式。
  轻量 capability 标志、非 semver 握手。
- **改源模板不改副本**：两个入口都要改，漏 Codex 入口则 Codex 会话不生效；sync 后自动更新
  `.claude/` 等部署副本（对齐 dogfooding 铁律）。

### 13.4 消解 SessionStart writing 分支冲突

`plugin/bin/openlogos-phase:398` 与 `plugin-codex/session-start.sh:78` 的 `writing` 分支现注入 "Do not
write deltas or source code yet"，与「plan 阶段产 page-design 原型 delta」正面冲突。修：两源文件的
`writing` / `ready-to-delta` 分支注入文本**加 GUI + `ui_impact` 例外**——「例外：GUI 项目 + 本次触及
UI 时，允许在 plan 阶段产出 page-design 原型 delta（`deltas/prd/2-product-design/2-page-design/
*.html`）；其余 delta 仍禁于 plan 阶段」。与 §3 ordering 例外、§5.2 guard allowlist 三者口径一致。

### 13.5 三层运行时指令资产

本特性运行时行为由三层指令资产驱动，均登记为交付物（缺一则运行时指令链断）：

- **(L1) skills**：`change-writer` / `product-designer` / `merge-executor` SKILL + checker 命令说明；
- **(L2) 生成的 AI 指令文件**：`openlogos sync` 重新生成 `AGENTS.md` / `CLAUDE.md`（承载 UI-first
  工作流指令，随发布分发）；
- **(L3) flow overlay 资产**：方法论 GUI overlay 的**真实源文件** `spec/flow/overlays/gui-ui-first.yaml`
  （含 `write-ui-prototype` / `verify-ui-provenance` 两个完整 `op:add` 节点），由 `openlogos init` / `sync`
  在项目**含 ≥1 GUI 模块**时把其 `op:add` 节点合并进项目实例 `logos/flow/launched.yaml`（`extends:
  builtin:launched@v1` + overlay 列表引用 `gui-ui-first`），无 GUI 模块不注入（机器条件读
  `logos-project.yaml` 的 `modules[].product_type`，GUI 集合={web,desktop,mobile}，缺失=非 GUI；overlay
  为**项目实例级注入**，节点参与由 module-aware `ui_impact` 决定，见 §6.3）。**L3 交付本体 = 该 `.yaml`
  源文件**；任何 Markdown 示例片段仅为摘录，不构成 L3 交付。builtin `launched.yaml` 仍不含这两节点。

### 13.6 完整运行时指令链（端到端有序）

① driver 在 plan 节点判 `ui_impact` 且前置能力就绪 → ② dispatch change-writer（ui-ux-pro-max）产
逐页原型 + `design-system.json`（写 `2-page-design/`，guard allowlist 放行）→ ③ overlay-add
`write-ui-prototype` 的 `done_when: cmd:openlogos check-ui-prototype`（真实可执行子命令，`<...>` 仅文档
示意）富对账通过 → ④ 面板渲染原型、用户批准 → ⑤ 面板/driver 写 `PLAN_APPROVED` body
（`ui_prototype_rendered` + `pages` + `hashes`）→ ⑥ merge 前 `verify-ui-provenance` 的
`done_when: cmd:openlogos check-ui-hash-match` 按三分支重算 hash → 含 provenance 完好匹配 / legacy
advisory 则 done 前进、失配或部分 provenance 则卡未 done。链上每一跳的 actor / 触发 / 产物均已具名。

### 13.7 完整授权链（逐个 actor + 授权依据）

1. **producer（change-writer）** 由 driver 在 plan 节点派发——授权同「写 proposal.md/tasks.md」的
   普通门前生成，**无新授权**；其写入由 guard 的 **plan 阶段 allowlist（仅放行 `2-page-design/
   *.html`）** 授权，越界路径被 guard 拒。
2. **provenance 写入方（runlogos 面板/driver）** 在批准时写 `PLAN_APPROVED` body——**由用户的批准
   动作本身授权**（同一次点击），无独立授权。
3. **`--auto`**：`plan-exit`（`skippable:true`）自动放行，producer 仍在门前产原型、provenance 仍
   记录；无新授权。
4. **hash 比对消费者（下游 merge/implement）**：只读 provenance，无写授权需求。

链上无悬空授权、无「谁批准 producer 写」的缺口。

## 14. 双阶段发布状态 + 跨仓端到端 smoke

### 14.1 contract-ready（capability-disabled）

OpenLogos npm 新版本 + 文档站发布即达此态。此态**只交付契约**（flow overlay / `ui_impact` flag /
声明段 / provenance 契约 / guard allowlist / 会话入口例外文案 / merge 严格校验代码），**默认降级、
不得对外 claim「UI/UX 确认已前移」已启用**；对外宣称边界 = contract-ready。

### 14.2 feature-enabled

**当且仅当** 具名关联 change `ui-ux-first-panel`（runlogos 仓）已部署，且**下述跨仓端到端 smoke
通过**后达此态，方可 claim UI-first 正式启用。发布状态由验收结果**机器判定**，非人工声称。

### 14.3 跨仓端到端 smoke 完成标准（逐条可判）

1. `ui-ux-first-panel` 已部署且在会话建立时写入 `logos/.session-capabilities.json`
   （`ui_prototype_render:true`）；
2. 两个 SessionStart 入口（`plugin/bin/openlogos-phase` + `plugin-codex/session-start.sh`）读取并
   **一致 surface** 该 capability（上下文 `capabilities` 段与 `status`/`next` JSON `capabilities`
   字段一致）；
3. 面板实际渲染原型并在批准时写入绑定 `pages`/`hashes` 的 `PLAN_APPROVED` provenance；
4. merge 严格 hash 校验（§11/§12 fail-closed 路径）对批准后漂移的原型**确实拒绝**；
5. smoke 能**区分** contract-ready 与 feature-enabled 两态。

### 14.4 owner / 输入 / 成功标记 / 失败降级

owner = runlogos（`ui-ux-first-panel` 交付方）联合 openlogos 发布；输入 = 已发布的 OpenLogos 契约
版本 + 已部署面板；成功标记 = 跨仓 smoke 全绿 → 置 **feature-enabled**；任一步失败 → 保持
**contract-ready** 并对外如实声明「契约就绪、功能未启用（降级）」，**不得 claim feature-enabled**。

### 14.5 承载与登记

契约侧 smoke 覆盖补入本项目 `logos/resources/test/smoke/core-smoke-test-cases.md`；**跨仓端到端
smoke 由 `ui-ux-first-panel` change 承载并登记为其交付**，与本提案的具名依赖对齐。由此「必要交付」
不再是文字宣称，而是可由跨仓 smoke 结果证明的发布状态。

## 15. merge-executor 整份落盘收窄（防静默覆盖）+ Python3 降级

### 15.1 整份落盘规则收窄（F3）

merge-executor 的「整份 create/replace」**仅**适用于 `2-page-design/` 等资产目录下的原型 / 资产文件
类型（`.html`/`.png`/`.svg` 等）；`.md` 规格 / skill delta 缺 `ADDED/MODIFIED/REMOVED` 段标记时
**一律判为非法 delta 并报错停下**，绝不静默整份覆盖主文档。（与 §12.3 分工：带 hash 绑定的原型
资产由 `commitVerifiedPrototypes()` 代码路径落盘，merge-executor 不触碰原型资产。）

### 15.2 Python3 降级（机器可读，`design_system_mode: fallback`）

`ui-ux-pro-max` 依赖 Python3。Python3 缺失时以**通用风格兜底**，并在声明段写
`design_system_mode: fallback` + 非空 `design_system_fallback_reason`（如「Python3 缺失」），
**不阻塞、不报错**。此时原型仍作为 page-design delta 产出，但**不产 `design-system.json` 令牌、
禁止伪造令牌**；`check-ui-prototype` 在 `fallback` 模式下**不要求 `design-system.json`**，只要求逐页
非空 + 清单一致 + 非空降级原因即 `exit 0`（见 §6.2）。由此消解「降级不产令牌但 done_when 强制要
`design-system.json` → 永久卡死」的矛盾——降级路径机器可判、不卡流程。`generated` 模式则必须有合法
令牌，缺令牌 fail closed。

## 16. 不变量清单

以下为本规格的机器可判定不变量，供 UT/ST 与验收对照：

1. **不新增门 / 不新增确认标记**：UI 确认复用 `plan-exit` 门与 `PLAN_APPROVED` marker；不新增门态、
   不新增确认标记文件、不新增 `ui/` 目录。
2. **`PLAN_APPROVED` 向后兼容超集**：空 marker 恒合法（门已过）；provenance 为可选 JSON body；缺失 /
   空 body ⇒ 安全默认「不宣称 UI 已确认」。
3. **单一事实源 + 结构化清单**：`ui_impact` 声明段（意图）+ **结构化声明页清单**（每条 `id` +
   `prototype` basename，唯一）+ `2-page-design/` 文件存在性构成唯一 ground truth；对账按精确
   basename 集合比较（排序无关、重复/额外/缺失均失败）；`PLAN_APPROVED.pages`/`hashes` 复用同一
   basename 规范键；`flow-derive` / guard / 面板不引入第二处判定。
4. **plan 阶段写入 allowlist 仅放行 `2-page-design/*.html`**：其余 `deltas/**` 在 plan 阶段禁写；与
   ordering 例外、SessionStart writing 例外三者口径一致。
5. **`cmd:` 谓词仅在 overlay-add 节点合法 + overlay 真实源文件**：`write-ui-prototype` /
   `verify-ui-provenance` 为方法论 GUI overlay `op:add` 节点，唯一源文件 =
   `spec/flow/overlays/gui-ui-first.yaml`，经 init/sync 在项目**含 ≥1 GUI 模块**时合并进项目实例
   `logos/flow/launched.yaml`（`extends: builtin:launched@v1` + overlay 列表；数据源 =
   `logos-project.yaml` 的 `modules[].product_type`，GUI 集合={web,desktop,mobile}，缺失=非 GUI；overlay
   项目实例级注入，节点参与由 module-aware `ui_impact` 决定），无 GUI 模块不注入；builtin
   `launched.yaml` 不硬编码这两个节点。L3 交付本体为该 `.yaml` 源文件，非 Markdown 示例。
6. **富对账为 plan-exit 前机器收敛条件（分模式）**：`check-ui-prototype` 逐页非空 + 声明清单
   basename 集合==产出文件 basename 集合（规范化集合比较）+ 内容 hash；`design_system_mode:
   generated` 额外要合法 `design-system.json`（缺则 fail closed），`fallback` 额外要非空
   `design_system_fallback_reason`（禁伪造令牌、不要求 `design-system.json`）；满足才 `exit 0`。
   消解「降级不产令牌但强制要 `design-system.json` → 永久卡死」矛盾。
7. **严格性以持久化批准记录为键**：模式选择读会话 capability（仅 plan-exit 之前）；强制语义读
   `PLAN_APPROVED` provenance（plan-exit 之后）。含 UI provenance ⇒ merge/落盘/复核三处永久 fail
   closed，会话 capability 缺失不得降级。
7b. **`check-ui-hash-match` 三分支（F6）**：`verify-ui-provenance` 单 `done_when: cmd:`（无 `fail_when`），
   命令内部按持久化 `PLAN_APPROVED` provenance 分三支——(1) 含 UI provenance：hashes 完好且全匹配
   `exit 0`，缺失/损坏/失配 fail closed；(2) legacy/degraded 或旧空 marker 且无「曾渲染确认」证据：
   记 advisory 后 `exit 0`（第三成功分支，令旧空 marker 的 GUI `ui_impact:true` 提案不永久卡死、
   advisory 经本节点 `exit 0` 达成而非绕过）；(3) 部分/损坏 provenance（`ui_prototype_rendered:true`
   但 hashes 缺/空）不得误判 legacy → fail closed。
8. **merge 命令级 hash 强制**：直接 `openlogos merge` 与 driver 流一致强制，无绕过路径；single source
   of enforcement。
9. **freshness 权威点在落盘时刻**：提示前=早失败优化，权威门=落盘时刻校验 staged 字节 + 落盘后
   复核；三处一致按 provenance 分支。
10. **事务性原子落盘、失败零残留、唯一落盘入口**：`commitVerifiedPrototypes()` 为**所有 `ui_impact`
    原型资产的唯一落盘入口**（不复用旧 merge 拷贝、无第二条绕过路径；advisory 与严格两分支都经此
    入口，仅校验强度不同；merge-executor 绝不触碰原型资产）；verify-all→stage（校验 staged 字节）→
    atomic rename；崩溃有 journal 前滚/回滚；全有或全无。
11. **跨仓必要交付闭环**：openlogos 契约 + runlogos `ui-ux-first-panel` 缺一核心价值不成立；发布状态
    双阶段（contract-ready → feature-enabled）由跨仓 smoke 机器判定。
12. **非 GUI / `ui_impact:false` 零改动**：非 GUI 项目整个特性不启用、流程零改动；GUI 项目声明未触及
    界面时 overlay 节点被 `when` 跳过。
13. **不可约残差如实标注**：「HTML 真出自 ui-ux-pro-max」除令牌追溯外无法纯机器证明，荣誉制 + 令牌
    追溯，如实记录非遗漏。
14. **存量可达 + 迁移幂等 + 用户 ops 不被 sync 删除（F1）**：已 `launched` 的存量 GUI 项目经
    `openlogos module set-product-type <module-id> <enum>`（幂等回填 `modules[].product_type`；非法枚举/
    未知 module/缺参报错）显式回填后，`sync` 幂等注入 `gui-ui-first` overlay 使 UI-first **对存量项目可达**；
    缺 `product_type` 时 `sync`/`status`/`next` 发 `PRODUCT_TYPE_CONFIRMATION_REQUIRED` 诊断使不可达状态
    **可发现**，且安全默认「缺字段=非 GUI」维持不变、`--auto` 绝不猜测升级 GUI（仅显式配置后注入）；
    反向（GUI→非 GUI / 删最后一个 GUI 模块）`sync` 幂等移除 `gui-ui-first` ops，且**按 node id
    (`write-ui-prototype`/`verify-ui-provenance`) 识别、同一 `launched.yaml` 内用户自定义 overlay ops
    绝不被 sync 删除**。「注入机制」对 init/新建与存量回填两条路径均成立。
