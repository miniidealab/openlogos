# Delta: core-S09-test-cases.md

> change: lite-cut3a-degate-clarification-ui-seed
> 目标：`logos/resources/test/core-S09-test-cases.md`

## REMOVED — 十四、Plan 阶段决策澄清协议测试用例（clarification@1）

本节 51 个用例验证 `openlogos/clarification@1` 契约本身：`impacts` 五类判定、`decisions[]` 八字段闭合、`unresolved[]` 稳定拓扑序、必选类别与 unresolved 的配对、以及非法形态如何阻断 plan 完成。契约随 O5 删除后整节失去验证对象——决策澄清小节保留为文档，不再被解析（§2.74.1）。

## MODIFIED — 九、UI/UX 前置确认（proposal-ui-ux-first）单元测试用例


> 覆盖 GUI 项目提案阶段前置 UI/UX 原型确认特性（F1–F4）。原型作为 plan 节点产物、plan 阶段写入 allowlist、`ui_impact` when-flag、overlay-add 节点富对账、provenance hash 防漂移、merge 命令级强制、事务性落盘与跨会话 fail-closed。用例实现必须写入 OpenLogos reporter（`logos/resources/verify/test-results.jsonl`），测试名包含对应 `UT-S09-*` ID 供 verify 抽取。

### 9.1 plan 节点产物声明与写入 allowlist（F1）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-65 | GUI 原型被声明为 plan 节点正式产物 | flow-spec.md plan 节点产物列表 | GUI 项目、`ui_impact:true` | 解析 plan 节点 `produces` | plan 节点产物含 `deltas/prd/2-product-design/2-page-design/`，与 `proposal.md`/`tasks.md` 并列 |
| UT-S09-66 | guard: plan 阶段仅放行原型路径 `.html` | guard-check（plan allowlist） | launched、active guard、plan 阶段（writing/ready-to-delta） | Write `deltas/prd/2-product-design/2-page-design/core-01-home.html` | exit 0（放行） |
| UT-S09-67 | guard: plan 阶段拒绝非原型 delta | guard-check（plan allowlist） | 同上 | Write `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md` | exit 2（plan 阶段仅放行 `2-page-design/*.html`，其余 `deltas/**` 拒绝） |
| UT-S09-68 | guard: plan 阶段拒绝原型目录下非 `.html` 越界 | guard-check（plan allowlist） | 同上 | Write `deltas/prd/2-product-design/2-page-design/core-01.md` | exit 2（仅 `*.html` 放行） |
| UT-S09-69 | guard: spec 阶段（plan-exit 后）恢复常规 allowlist | guard-check | launched、active guard、delta-writing 阶段 | Write `deltas/prd/2-product-design/1-feature-specs/*.md` | exit 0（plan-exit 后其余 delta 放行，plan allowlist 收窄仅 plan 阶段生效） |

### 9.2 flow-derive 判据与 `ui_impact` when-flag（F1、F2）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-70 | 仅存在原型 delta 时 flow-derive 不误判进入 spec | flow-derive.ts（原型例外） | plan 阶段、仅 `2-page-design/*.html` 已产出、无非原型规格 delta、无 plan-exit | derive | 仍判 plan 阶段（原型可见于门前）；不返回 spec/delta-writing |
| UT-S09-71 | 出现非原型规格 delta 才视为进入 spec | flow-derive.ts | 除原型外存在 `1-feature-specs/*.md` delta | derive | 进入 spec/delta-writing（原型例外仅限 `2-page-design/*.html` 叶子） |
| UT-S09-72 | `ui_impact` 派生：GUI + 声明 true → 真 | flow-derive.ts（新增 when-flag） | `proposal.md` UI/UX 声明段 `ui_impact:true` 且 `product_type∈GUI` | 派生 `ui_impact` | `ui_impact==true`（仿 `delta_required` 从声明段推导） |
| UT-S09-73 | `ui_impact` 派生：非 GUI 项目 → 假 | flow-derive.ts | `product_type` 非 GUI（CLI/API/Skills）、即使声明 `ui_impact:true` | 派生 | `ui_impact==false`（非 GUI 项目特性不启用） |
| UT-S09-74 | `ui_impact` 派生：GUI + 声明 false → 假（节点 skip） | flow-derive.ts | GUI 项目、声明 `ui_impact:false` | 派生 | `ui_impact==false`；`write-ui-prototype` 的 `when` 不满足而 skip |
| UT-S09-75 | 判定依据=已规划 `[delta]` 目标而非 delta 内容 | change-writer 判定（F2） | plan 阶段无 delta 文件、`tasks.md` `[delta]` 目标命中 `2-page-design/` | 判定「是否动界面」 | 判「动了界面」；判据为 `product_type`+意图+已规划 `[delta]` 目标，不扫描不存在的 delta 内容（无循环依赖） |

### 9.3 overlay-add 节点合法性与富对账 done_when（F1 新循环）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-76 | `write-ui-prototype` 作为 overlay-add 节点用 `cmd:` 合法 | launched.yaml overlay + §9.2 | GUI overlay `op:add` 节点 `write-ui-prototype`、`after: write-tasks`、`done_when: cmd:<check-ui-prototype>` | flow 校验 | 校验通过（overlay-add 合法使用 `cmd:` 谓词） |
| UT-S09-77 | builtin 硬编码 `cmd:` 则 FLOW_SCHEMA_INVALID | launched.yaml builtin 约束 | 把 `write-ui-prototype` 写成 builtin `launched.yaml` 节点并用 `done_when: cmd:` | flow schema 校验 | 报 `FLOW_SCHEMA_INVALID`（builtin 不得硬编码 `cmd:`，须走 overlay-add） |
| UT-S09-78 | builtin `launched.yaml` 不硬编码 UI 原型节点 | launched.yaml + `spec/flow/overlays/gui-ui-first.yaml` | 解析 builtin plan subflow | 检查节点集 | builtin plan subflow **不含** `write-ui-prototype`（builtin 侧无此两节点；它们仅存在于方法论 GUI overlay 真实源 `spec/flow/overlays/gui-ui-first.yaml`，由 init/sync 在 GUI 项目时注入） |
| UT-S09-79 | `check-ui-prototype` 富对账通过（`generated` 模式）→ 节点 done | check-ui-prototype 命令 | 声明段 `design_system_mode: generated`、每页均有非空原型文件、提案目录有合法非空 `design-system.json`、声明清单==产出文件、hash 已记录 | 运行 checker | `exit 0` → 节点 done → plan 子流程可完成 → plan-exit 门可放行 |
| UT-S09-80 | `check-ui-prototype` 逐页对账不全 → 未 done | check-ui-prototype 命令 | 声明 3 页仅产出 2 页（或某页空文件） | 运行 checker | 非零退出 → 节点未 done（advisory 提示清单!=产出）→ plan-exit 前阻断收敛 |
| UT-S09-81 | `generated` 模式缺 `design-system.json` → fail closed（对照组） | check-ui-prototype 命令 | 声明段 `design_system_mode: generated`、逐页原型齐全但无 `design-system.json`/无 ui-ux-pro-max 令牌 | 运行 checker | 非零退出（`generated` 承诺令牌却缺失=fail closed，无法追溯 ui-ux-pro-max）；与 `fallback` 分支（UT-S09-81a）形成对照 |
| UT-S09-81a | `fallback` 模式：无 design-system.json + 有降级原因 → exit0 不阻塞 | check-ui-prototype 命令（F2 核心） | 声明段 `design_system_mode: fallback`（无 Python3）、无 `design-system.json`、有非空 `design_system_fallback_reason`、逐页原型非空、声明清单==产出文件 | 运行 checker | `exit 0`（fallback 不要求 design-system.json、不阻塞）→ `write-ui-prototype` 节点 done → plan-exit 门可到达（验证降级不卡死=F2 核心价值） |
| UT-S09-81b | `fallback` 模式禁伪造令牌 | check-ui-prototype 命令 | 声明 `design_system_mode: fallback` 但提案目录塞入伪造 `design-system.json` 令牌 | 运行 checker | 非零退出（fallback 不得伪造 ui-ux-pro-max 令牌冒充 generated；诚实降级） |
| UT-S09-81c | 缺 `design_system_mode` 字段 → fail closed（对照组） | check-ui-prototype 命令 | 声明段完全缺 `design_system_mode` 字段、逐页原型齐全 | 运行 checker | 非零退出（模式未声明无法判定对账口径=fail closed，安全默认不放行） |

### 9.4 provenance 载体向后兼容（F3、F4）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-82 | `writePlanApproved()` 空写仍合法 | next.ts writePlanApproved | 无 provenance body | 空写 `PLAN_APPROVED` | 写入成功；存在性语义不变（门已过）；不破坏现有空写路径 |
| UT-S09-83 | 可选 JSON body 不破坏仅存在性读取 | PLAN_APPROVED 读取者 | `PLAN_APPROVED` 带 `{ui_prototype_rendered,pages,hashes}` body | 仅存在性读取者读取 | 判「门已过」不受影响；provenance 为可选叠加字段，缺失/空 body ⇒ 安全默认「不宣称 UI 已确认」 |
| UT-S09-84 | legacy 空 marker（无曾渲染证据）经 `openlogos check-ui-hash-match` 判 exit0 | `verify-ui-provenance` 的 `openlogos check-ui-hash-match`（F3/F6 legacy-advisory 分支） | GUI 项目、`ui_impact:true`、`PLAN_APPROVED` 为**空 marker**、无 `ui_prototype_rendered`、无「曾渲染确认」证据 | 到 `verify-ui-provenance` 节点运行 `done_when: cmd:<check-ui-hash-match>` | 不宣称 UI 已确认、**记 advisory 后 `exit 0`**→节点 **done**（非绕过节点，而是经该节点求值达成）→ merge 可达（无 provenance ≠ 漂移，保留向后兼容）；对照 UT-S09-87（match→0）与 UT-S09-88（partial/失配→fail），构成 F6 三分支 |
| UT-S09-85 | provenance 绑定 hash 记录批准时刻内容 | PLAN_APPROVED body | 渲染面板批准时写 body | 读取 body | 含 `ui_prototype_rendered:true` + `pages:[...]` + `hashes:{<file>:<sha256>}`（逐文件内容 hash） |

### 9.4a 声明页清单结构化与 basename 集合对账（F3）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-85a | 声明页清单为结构化条目 | 声明段 pages 结构（F3） | 声明段 pages 每项含 `id`+`prototype`+`description` | 解析声明段 | 每页解析为结构化条目 `{id, prototype: core-NN-<slug>.html（basename）, description}`；非裸字符串列表 |
| UT-S09-85b | 多页 basename 集合对账通过 | check-ui-prototype basename 集合比较（F3） | 声明 3 页、`2-page-design/` 恰产出同 3 个 basename 文件 | 运行 checker | 声明 `prototype` basename 集合 == 产出文件 basename 集合 → 对账通过 |
| UT-S09-85c | 重复 basename → 失败 | check-ui-prototype basename 比较 | 声明两条目 `prototype` basename 相同（重复） | 运行 checker | 非零退出（basename 集合出现重复，清单非法） |
| UT-S09-85d | 额外文件（产出多于声明）→ 失败 | check-ui-prototype basename 比较 | `2-page-design/` 存在声明清单外的额外 `.html` | 运行 checker | 非零退出（产出 basename 集合 ⊋ 声明集合，额外文件不对账） |
| UT-S09-85e | 缺失文件（声明多于产出）→ 失败 | check-ui-prototype basename 比较 | 声明 3 页仅产出 2 个 basename | 运行 checker | 非零退出（声明 basename 集合 ⊋ 产出集合，缺失） |
| UT-S09-85f | slug 含特殊字符 → 失败 | check-ui-prototype basename 校验 | 声明 `prototype` basename slug 含非法特殊字符 | 运行 checker | 非零退出（basename 不符 `core-NN-<slug>.html` 命名，拒绝） |
| UT-S09-85g | 声明 `prototype` 含 `..` 路径穿越 → 失败 | check-ui-prototype 路径安全（F3） | 声明 `prototype: ../../etc/x.html` 或含 `..` 段 | 运行 checker | 非零退出（`prototype` 须为纯 basename，含 `..`/目录分隔=路径穿越，拒绝） |
| UT-S09-85h | `PLAN_APPROVED.pages`/`hashes` 键与声明 basename 一致 | PLAN_APPROVED basename 键复用（F3） | 批准时写 body | 读取 `pages`/`hashes` | `pages` 与 `hashes` 键均为声明 `prototype` basename（`core-NN-<slug>.html`）；与声明清单 basename 集合逐一对齐、无第二套键空间 |

### 9.5 verify-ui-provenance 成功路径与阻断（F4 R4）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-87 | F6 match 分支：完整 provenance 且 hash 匹配 → 经 `openlogos check-ui-hash-match` 判 exit0 | `verify-ui-provenance` 的 check-ui-hash-match 命令 | GUI 项目、`ui_impact:true`、`PLAN_APPROVED` 含完整 provenance（`ui_prototype_rendered:true`+`hashes`）、`2-page-design/` 现值 hash == `PLAN_APPROVED.hashes` | 运行 `done_when: cmd:<check-ui-hash-match>` | `exit 0` → 节点 done → merge 放行前进（成功路径经该节点求值达成、非单 fail_when 卡死）；F6 三分支之 match→0 |
| UT-S09-88 | hash 失配未 done 阻断 | check-ui-hash-match 命令 | 原型批准后被改、现值 hash != `PLAN_APPROVED.hashes` | 运行 checker | 非零 → 节点未 done（active/pending）→ 前向阻断（不前进） |
| UT-S09-88a | F6 partial 分支：部分 provenance（`ui_prototype_rendered:true` 但缺 hashes）→ 经 `openlogos check-ui-hash-match` 判非零并点名失配 | `verify-ui-provenance` 的 check-ui-hash-match 命令（F6 partial 分支） | GUI 项目、`ui_impact:true`、`PLAN_APPROVED` 含 `ui_prototype_rendered:true` **但缺 `hashes`**（部分 provenance，非空 marker、非完整） | 运行 `done_when: cmd:<check-ui-hash-match>` | **非零退出 → 节点未 done → 阻断（fail closed）**：曾宣称渲染却缺 hashes 无法追溯，不得放行；与 UT-S09-84（空 marker→advisory→0）区分——部分 provenance 非 legacy，不享 advisory；F6 三分支之 partial→fail |
| UT-S09-90 | 失配后显式重入 plan 刷新 hashes → 再匹配放行 | 状态转换（诚实边界） | 失配告警后，显式重入 plan、重跑 producer 产原型、plan-exit 重批刷新 `PLAN_APPROVED.hashes` | 再跑 `check-ui-hash-match` 到 `verify-ui-provenance` | hash 匹配 `exit 0` → done → 放行（非引擎自动 rewind，为显式重入刷新） |

### 9.6 merge 命令级强制与跨会话 fail-closed（F4 R5、R7）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-91 | 直接 `openlogos merge` 命令级强制不可绕过 | merge.ts pre-merge hash gate | `ui_impact:true`、`PLAN_APPROVED` 含 provenance、原型漂移 | 直接执行 `openlogos merge <slug>`（不经 driver flow） | 拒绝 merge：非零退出 + 明确错误；**不生成 MERGE_PROMPT**（命令级 = 真强制点，driver 流与直调均不可绕过） |
| UT-S09-92 | F4 R7：批准记录含 UI provenance → 永久 fail closed | merge.ts / 强制语义键 | `PLAN_APPROVED` 含 `ui_prototype_rendered:true`+`hashes`、`ui_impact:true` | merge 时 `hashes` 缺失/损坏/失配 | 一律拒绝（非零退出、不生成 `MERGE_PROMPT`、不写 resources、不写 `SPEC_MERGED`）；判据键=持久化 `PLAN_APPROVED` 内容，非消费时会话 capability |
| UT-S09-93 | 模式选择读会话 capability，强制语义不读 | 模式/强制分离（F4 R7） | plan-exit 前读 `.session-capabilities.json` 选模式；plan-exit 后 merge/落盘/复核 | 分别在两阶段 | plan-exit 前：capability 就绪→渲染确认模式、缺失→降级模式；plan-exit 后：一律以 `PLAN_APPROVED` provenance 为准，**不读** session capability |
| UT-S09-94 | 对照组：GUI+ui_impact 空 marker（无曾渲染证据）经 `openlogos check-ui-hash-match` 判 advisory exit0 | F3/F6 legacy-advisory 分支 | GUI 项目、`ui_impact:true`、`PLAN_APPROVED` 空 marker、无任何「曾渲染确认」证据 | 经 `verify-ui-provenance` 节点运行 `check-ui-hash-match` 后 merge | 记 advisory 后 **`exit 0` → 节点 done → merge 可达**（不要求 `hashes`、不阻断）；**经该节点求值达成、非绕过节点**；与 UT-S09-88a（部分 provenance→fail closed）对照，共同界定 F6 legacy-advisory 与 fail-closed 边界 |
| UT-S09-95 | `commitVerifiedPrototypes()` 落盘入口亦 fail closed | commitVerifiedPrototypes（事务门） | `PLAN_APPROVED` 含 UI provenance、staged 原型 hash 失配 | 事务落盘门 | 在写入任何文件前 abort、拒绝落盘、resources 零残留、不写 `SPEC_MERGED`（不止提示前检查，落盘入口同样 fail closed） |

### 9.7 事务性落盘：单一入口 / staged 校验 / 崩溃恢复（F1 R2、R3）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-96 | `commitVerifiedPrototypes()` 为原型落盘唯一入口 | merge.ts commitVerifiedPrototypes | 原型资产落盘 | 调用 merge | 原型落盘仅经此命名函数（复用现有路径映射，但为新代码路径）；merge-executor 绝不触碰原型资产（只应用 markdown 规格 delta）；无第二条落盘路径 |
| UT-S09-96a | advisory 分支也经 `commitVerifiedPrototypes()` 同一入口 | commitVerifiedPrototypes（advisory） | capability 缺失/降级会话、原型资产需落盘 | 调用 merge（advisory 放行） | 原型仍仅经 `commitVerifiedPrototypes()` 落盘（advisory 分支只是不做严格 hash 校验）；无第二条绕过路径；merge-executor 仍不触碰原型资产 |
| UT-S09-97 | 三段事务：全量校验先于任何写入 | verify-all→stage→commit | 多原型、其一 hash 失配 | 执行落盘 | 全量校验阶段任一不符即在写入任何文件前 abort；无部分落盘 |
| UT-S09-98 | 校验 staged 字节而非源，消除 TOCTOU | staged 字节校验 | 源原型在校验后再被改动 | 落盘 | 对 staged 副本算 hash 比对 `PLAN_APPROVED.hashes`，原子 rename 提交的正是已校验 staged 字节；「已校验字节==已提交字节」，源后续变更不影响 |
| UT-S09-99 | commit journal 崩溃恢复：前滚 | intent journal + 启动恢复 | 提交中途崩溃、journal 残留（部分 rename 已完成） | 下次 merge/启动检测残留 journal | 依 journal 前滚补完未完成的 rename → 一致的全有态；恢复后清 journal |
| UT-S09-100 | commit journal 崩溃恢复：回滚 | intent journal + 启动恢复 | 提交中途崩溃、需回滚 | 下次 merge/启动检测残留 journal | 用 backup 还原已改动、删 staging → 一致的全无态；恢复后清 journal |
| UT-S09-101 | 失败回滚零残留 | 失败语义 | 任一阶段失败 | 落盘失败 | resources 回到 merge 前状态（无部分落盘、无未获批内容）、`SPEC_MERGED` 不写、流程标记失败并阻断 |
| UT-S09-102 | apply-merge 后复核 hash（双保险） | apply-merge 后复核 | 落盘完成 | 复核 resources 中原型 hash | == `PLAN_APPROVED.hashes`；不符则阻断流程前进（不进 slice/code） |

### 9.8 前置能力门与 capability 输入闭环（F2 R6、R3）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-103 | 前置能力门两源模板 surface capability | plugin/bin/openlogos-phase + plugin-codex/session-start.sh | `.session-capabilities.json` 含 `ui_prototype_render:true` | 执行两 SessionStart 入口 | 两源均在上下文追加 `capabilities` 段、一致 surface；改源模板非部署副本（`.claude/openlogos/bin/openlogos-phase` 为 sync 副本不直接改） |
| UT-S09-104 | `status`/`next` JSON 承载 `capabilities` 字段 | cli-json-output.md | 同上 capability 文件存在 | `openlogos status --format json` / `next --format json` | 含 `capabilities` 字段，与上下文 `capabilities` 段一致 |
| UT-S09-105 | 能力文件缺失 = 降级模式 | capability 输入闭环 | 无 `logos/.session-capabilities.json` | 读取 capability | 判缺失→降级模式（不 claim UI 确认、advisory 不阻断） |
| UT-S09-106 | runlogos 写文件 → openlogos 读并 surface 闭环 | 输入通道 | runlogos 会话建立时写 `{"ui_prototype_render":true}` | openlogos-phase 钩子与 status/next 读该文件 | 据以生成上下文 `capabilities` 段与 JSON `capabilities` 字段（runlogos 写→openlogos 读并 surface→plan-exit 前定模式） |

### 9.9 writing 阶段冲突消解与三层指令资产（F2 R6、R3）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-107 | writing 阶段 GUI+ui_impact 放行 page-design 原型 delta | openlogos-phase writing 分支 | GUI 项目、`ui_impact:true`、writing 阶段 | 执行 SessionStart hook | 注入文本含「例外：GUI + 触及 UI 时允许在 plan 阶段产 page-design 原型 delta」；不与「不得写 delta」注入冲突（F2 R6） |
| UT-S09-108 | ready-to-delta 阶段同例外放行原型 delta | plugin-codex/session-start.sh ready-to-delta 分支 | 同上、ready-to-delta 阶段 | 执行 SessionStart hook | 同样注入 GUI+ui_impact 例外；其余 delta 仍禁于 plan 阶段 |
| UT-S09-109 | 非 GUI 或 ui_impact:false 时不放行原型例外 | 两源 writing/ready-to-delta 分支 | 非 GUI 项目或 `ui_impact:false` | 执行 hook | 不注入例外文案，保持「不得写 delta」原语义（例外仅 GUI+ui_impact） |
| UT-S09-110 | 三层指令资产齐备 | L1/L2/L3 交付物 | 已 sync 的 GUI 项目 | 检查交付物 | (L1) `change-writer`/`product-designer`/`merge-executor` SKILL + checker 说明；(L2) `sync` 重生成的 `AGENTS.md`/`CLAUDE.md` 承载 UI-first 工作流；(L3) **读取真实文件 `spec/flow/overlays/gui-ui-first.yaml`**、经现有 overlay parser/schema 校验为合法 overlay 片段且含两个 `op:add`（`write-ui-prototype`）——而非检索 Markdown 示例文本；三层缺一即指令链断 |
| UT-S09-110a | GUI overlay 唯一源真实存在、含一个合法 `op:add`，且 `done_when` 命令实际可求值 | `spec/flow/overlays/gui-ui-first.yaml`（唯一源）+ 真实子命令 `openlogos check-ui-prototype`/`openlogos check-ui-hash-match` | 已 sync 的 GUI 项目；准备①合法 `generated` 提案（逐页原型齐全 + 合法 `design-system.json`/令牌 + hash 已记录）与②合法 `fallback` 提案（逐页原型齐全 + `design_system_fallback_reason`、无令牌） | 读取真实文件经 overlay parser/schema 校验；再**实际执行**两个 `done_when` 后端子命令 | 文件存在、解析为合法 overlay 片段；恰含两个 `op:add`——① `write-ui-prototype`（`after: write-tasks`、`when: ui_impact`、`produces: 2-page-design/`、`done_when: cmd:<check-ui-prototype>`）；② `verify-ui-provenance`（`before: generate-merge-prompt`、`when: ui_impact`、`done_when: cmd:<check-ui-hash-match>`）；两节点均合法（overlay-add 允许 `cmd:`）。**不止校验 schema 接受 `cmd:`**：`done_when` 后端为真实子命令 `openlogos check-ui-prototype`/`openlogos check-ui-hash-match`，对上述合法 generated 与 fallback 提案实际求值 → 两命令均 `exit 0` |
| UT-S09-110a-neg | `done_when` 命令不存在或仍含字面占位符 → 必须失败（负向） | overlay `done_when` 后端可执行性 | 已 sync 的 GUI 项目 | ①将 `done_when: cmd:` 后端指向**不存在的子命令**求值；②或 overlay 仍保留字面 `<check-ui-prototype>`/`<...>` 占位符未被真实子命令名替换；运行/求值 `done_when` | **必须失败**（非零退出/校验失败）：命令不存在无法求值即节点不可 done；overlay 仍含字面 `<...>` 占位=未落地为真实可执行命令，判非法（保证 `cmd:` 后端确为真实子命令而非示意文本） |
| UT-S09-110b | init/sync 对 GUI 项目注入 overlay 到项目实例 `launched.yaml` | project-init/sync overlay 注入 | 从真实 `logos-project.yaml` 读取 `modules[].product_type`，该模块值 ∈ GUI={`web`,`desktop`,`mobile`}（即项目含 ≥1 GUI 模块） | 运行 init/sync | `spec/flow/overlays/gui-ui-first.yaml` 两个 `op:add` 被并入项目实例 `logos/flow/launched.yaml` 顶层 `overlay:`（该实例 `extends` 等于 `builtin:launched@${BUILTIN_VERSIONS.launched}`——由 loader 映射派生，断言不得固化具体版本号）；注入后 plan subflow 含 `write-ui-prototype`、merge subflow 前含 `verify-ui-provenance`（product_type 唯一源 = `logos-project.yaml modules[].product_type`，非凭空给定） |
| UT-S09-110c | 非 GUI 项目不注入 GUI overlay | project-init/sync overlay 注入 | 从真实 `logos-project.yaml` 读取 `modules[].product_type`，全部模块值 ∈ 非 GUI={`cli`,`api`,`library`,`skills`}（项目无任何 GUI 模块） | 运行 init/sync | **不注入** gui-ui-first overlay；项目实例 `launched.yaml` 不含 `write-ui-prototype`；特性零启用、流程零改动 |
| UT-S09-110d | `product_type` 字段缺失 → 按非 GUI、overlay 不注入 | project-init/sync overlay 注入（缺字段默认） | 真实 `logos-project.yaml` 的 `modules[]` 条目**完全缺 `product_type` 字段** | 运行 init/sync | 缺失=非 GUI（安全默认）；**overlay 不注入**；项目实例 `launched.yaml` 不含 `write-ui-prototype`；对应 GUI 模块存在时该缺字段模块节点 skip（`ui_impact` 不因缺字段模块置真） |
| UT-S09-110e | 多模块（一 GUI 一非 GUI）：节点参与由活跃提案 module 的 `product_type` 决定 | module-aware `ui_impact` 派生 | 真实 `logos-project.yaml` 含两模块——`moduleA.product_type=web`（GUI）、`moduleB.product_type=cli`（非 GUI） | 活跃提案分别归属两模块时派生 `ui_impact` | 活跃提案属**非 GUI 模块 B** → `ui_impact==false`、`write-ui-prototype` 节点 skip；活跃提案属 **GUI 模块 A** → `ui_impact==true`、两节点参与（overlay 项目级注入因项目含 ≥1 GUI 模块成立，但**节点参与由 module-aware `ui_impact`＝活跃提案所属 module 的 product_type 决定**，非项目级一刀切） |
| UT-S09-111 | Python3 缺失时通用风格兜底并写 `fallback` 声明 | change-writer 降级 | GUI 项目、`ui_impact:true`、无 Python3 | 产出原型 | 以通用风格兜底；声明段写 `design_system_mode: fallback` + 非空 `design_system_fallback_reason`（如「无 Python3，未走设计系统」）；不产 `design-system.json`、不伪造令牌；`check-ui-prototype` exit0（不阻塞、不报错），与 UT-S09-81a 端到端一致 |

### 9.9a 存量项目 `product_type` 回填与 overlay 迁移（F1）

> 覆盖已 `launched` 存量 GUI 项目的可达性迁移：`module set-product-type` 幂等回填、`PRODUCT_TYPE_CONFIRMATION_REQUIRED` 诊断、`--auto` 安全默认、`sync` 正反向幂等注入/移除且保留用户自定义 overlay ops。

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-115 | `module set-product-type` 幂等回填 `modules[].product_type` | module set-product-type 命令（F1 回填） | 已 `launched` 项目、`logos-project.yaml` 某 module 缺 `product_type` | `openlogos module set-product-type core web` | 写 `modules[].product_type=web`、`exit 0`；再次执行同值=no-op（幂等，不重复写、`exit 0`） |
| UT-S09-116 | `set-product-type` 非法枚举 → 报错 | module set-product-type 校验（F1） | 已 launched 项目 | `openlogos module set-product-type core gui`（非 `web|desktop|mobile|cli|api|library|skills|service`） | 非零退出 + 明确错误；**不写** `logos-project.yaml` |
| UT-S09-117 | `set-product-type` 未知 module → 报错 | module set-product-type 校验（F1） | `logos-project.yaml` 无 `nope` 模块 | `openlogos module set-product-type nope web` | 非零退出 + 明确错误（未知 module-id）；不写文件 |
| UT-S09-117a | `set-product-type` 缺参 → 报错 | module set-product-type 校验（F1） | 已 launched 项目 | `openlogos module set-product-type core`（缺 enum）/ `openlogos module set-product-type`（缺 module+enum） | 非零退出 + 用法错误；不写文件 |
| UT-S09-118 | 存量缺字段 → `sync`/`status`/`next` 发 `PRODUCT_TYPE_CONFIRMATION_REQUIRED` | sync/status/next 缺字段检测（F1 诊断） | 已 `launched`、`modules[]` 缺 `product_type` | 运行 `openlogos sync` / `status` / `next` | 三者均输出机器可读 `PRODUCT_TYPE_CONFIRMATION_REQUIRED`（列缺字段 module、指向 `module set-product-type`）；安全默认「缺字段=非 GUI」维持、overlay 不注入 |
| UT-S09-118a | 回填后诊断消失 | sync/status/next（F1 幂等） | UT-S09-118 之后 `set-product-type core web` | 再运行 `sync`/`status`/`next` | 不再输出 `PRODUCT_TYPE_CONFIRMATION_REQUIRED`（该 module 已有字段） |
| UT-S09-119 | 回填 GUI 后 `sync` 幂等注入 overlay | sync overlay 注入（F1 正向幂等） | `set-product-type core web` 后（项目含 ≥1 GUI 模块） | 运行 `openlogos sync`；再运行一次 | 首次把 `gui-ui-first` 两 op:add 并入项目实例 `launched.yaml`（plan subflow 含 `write-ui-prototype`、merge 前含 `verify-ui-provenance`）；**重复 sync 不重复注入**（按 node id 去重、no-op） |
| UT-S09-120 | 拒绝确认 / 设为 `cli` → 保持非 GUI、不注入 | set-product-type + sync（F1 安全默认） | 存量缺字段项目 | 用户不回填（保持缺字段）或 `set-product-type core cli` 后 `sync` | 保持非 GUI；`sync` **不注入** `gui-ui-first`；`launched.yaml` 不含 `write-ui-prototype`；`ui_impact` 恒假 |
| UT-S09-121 | 多模块（一 web 一 cli）回填后仅 web 提案 `ui_impact` 真 | module-aware `ui_impact` + 回填（F1） | 回填 `moduleA=web`、`moduleB=cli`；项目含 ≥1 GUI 模块故 overlay 已注入 | 活跃提案分属两模块时派生 `ui_impact` | 提案属 **web 模块 A** → `ui_impact==true`、可推进 UI-first；提案属 **cli 模块 B** → `ui_impact==false`、两节点 skip（overlay 项目级注入但节点参与由活跃提案 module 的 `product_type` 决定） |
| UT-S09-122 | 反向移除：唯一 GUI 模块改 `cli` → `sync` 移除 overlay ops | sync 反向移除（F1 反向幂等） | 项目仅一个 GUI 模块 `core=web`（overlay 已注入）、`launched.yaml` 另含**用户自定义 overlay op** `custom-user-node` | `set-product-type core cli` 后 `openlogos sync`；再运行一次 | 按 node id 移除 `write-ui-prototype`；**用户自定义 `custom-user-node` 保持不变**（不被 sync 删除）；重复 sync 幂等（已移除即 no-op） |
| UT-S09-122a | 反向移除：删最后一个 GUI 模块 → `sync` 移除 overlay ops 且保留用户 ops | sync 反向移除（F1 反向幂等） | 项目仅一个 GUI 模块（overlay 已注入）、`launched.yaml` 另含用户自定义 overlay op | 删除该 GUI 模块后 `openlogos sync` | 项目不再含任何 GUI 模块 → 按 node id 移除 `gui-ui-first` 两节点；**同一 `launched.yaml` 内用户自定义 overlay op 保持不变** |
| UT-S09-123 | `--auto` 缺字段模块不被自动判 GUI、输出诊断、不注入 | `--auto` 安全默认（F1） | 已 `launched`、`modules[]` 缺 `product_type` 的 GUI 意图项目、无人值守 | `openlogos next --auto`（含 sync/推进链） | **绝不**自动判为 GUI；保持安全默认（非 GUI、不注入 overlay）；照常暴露 `PRODUCT_TYPE_CONFIRMATION_REQUIRED` 作为 next action；仅显式 `set-product-type` 后才注入 |
| UT-S09-124 | `service` 为合法枚举且判非 GUI | `PRODUCT_TYPE_ENUM` 尾部扩展 `service`（add-product-type-service） | 已 launched 项目 | `openlogos module set-product-type core service`；重复设同值；`openlogos sync`；读 `status --format json` | 写入成功且幂等（`modules[core].product_type=="service"`，重设同值 no-op）；`isValidProductType('service')===true` 且 `isGuiProductType('service')===false`、`ui_impact` 恒假；`sync` **不注入** `gui-ui-first` overlay；缺字段诊断 `next_action.enum` 为固定顺序 8 值、尾部为 `"service"`（既有 7 值前缀逐字不变） |

### 9.9b overlay extends 版本单一权威与存量有条件迁移（fix-sync-yaml-and-overlay-version）

> 覆盖 overlay 写入端从字面量版本号改为读取 loader 版本映射，以及存量落后 overlay 的有条件迁移。
>
> **断言纪律**：期望值一律引用 `BUILTIN_VERSIONS[lifecycle]`，**禁止在 fixture 或期望值中固化任何具体版本号**——既有 `cli/test/s09-ui-sync.test.ts` 的三处 `builtin:launched@v1` fixture 正是把错误形态固化成了断言，使写入端与 loader 映射失同步长期不可见。测试实现必须写入 OpenLogos reporter，测试名包含对应 ID 供 verify 抽取。

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-275 | 注入器写出的 `extends` 取自 loader 映射 | overlay 注入 Step 3→4a | GUI 项目，`logos/flow/launched.yaml` 不存在或缺 `extends` | 运行注入 | 写出的 `extends` 严格等于 `builtin:launched@${BUILTIN_VERSIONS.launched}`；产物中不存在任何字面量版本号（对产物做「不含硬编码版本」的负向检查） |
| UT-S09-276 | 写出的 overlay 自解析无版本告警 | overlay 注入 Step 7 自检 | 同上，注入已完成 | 对写出文件执行 `applyOverlay()` | `warnings[]` **不含** `FLOW_VERSION_MISMATCH`；该自检即「写者产出不得立即触发本进程告警」这一不变量的机器判据 |
| UT-S09-277 | 存量落后且引用全部可解析 → 自动提升并保留用户 ops | overlay 迁移 Step 4b-1 | 既有 `launched.yaml` 的 `extends` 版本落后于映射值，其引用的全部 node id 在新版本内置模板中均可解析，且文件含用户自定义 op `custom-user-node` | 运行 `openlogos sync`；再运行一次 | 首次把 `extends` 提升为映射值并输出已迁移提示；`custom-user-node` 与其它 overlay 操作**逐字节保留**、顺序不变；仅 `extends` 一个字段变化；第二次为 no-op（幂等） |
| UT-S09-278 | 存量落后但存在失效 node id → 保持原值并继续告警（负向） | overlay 迁移 Step 4b-2 | 既有 `launched.yaml` 版本落后，且其 overlay 引用了一个在新版本内置模板中**已不存在**的 node id | 运行 `openlogos sync`，随后解析该 overlay | `extends` **保持原值不变**；`warnings[]` 仍含 `FLOW_VERSION_MISMATCH`；命令不因此中断。此为迁移判据的关键负向：不得为消音告警而无条件 bump |

#### 9.9b 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S09-108 | GUI 项目 sync 后端到端无假告警 | Step 1→8 | 含 ≥1 GUI 模块（`product_type` ∈ web/desktop/mobile）的 launched 项目 | `openlogos sync` → `openlogos flow show --resolved --lifecycle launched` | sync 报告 overlay 已注入；紧接着的 `flow show` 输出 **不含** `FLOW_VERSION_MISMATCH`。此为上游 Bug 报告「前后两条命令」复现路径的等价用例，两条命令必须使用同一 CLI 版本 |

#### 9.9b 追溯与覆盖

- AC-YAMLW-06 写入端单一权威：UT-S09-275、UT-S09-276、ST-S09-108。
- AC-YAMLW-07 存量有条件迁移：UT-S09-277（正向）、UT-S09-278（负向）。
- 场景：S09 GUI overlay extends 版本取值与存量有条件迁移；功能规格：§2.47.4～§2.47.5；架构：§三十八.2、§三十八.4；方法论规格：`spec/flow-spec.md` §10.1；安装态：SMOKE-core-169。

### 9.10 双阶段发布状态与跨仓依赖（F2 R7）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-112 | 跨仓两仓缺一核心价值不成立 | 交付闭环（F2 R2） | 仅 openlogos 契约发布、无 runlogos 实现 | 判定发布状态 | 核心视觉确认价值不成立；保持 contract-ready（capability-disabled），不得 claim「UI/UX 确认已前移」已启用 |
| UT-S09-113 | `ui-ux-first-panel` 具名依赖登记 | 具名依赖（F2 R3） | 契约 merge 后 | 检查依赖登记 | runlogos 关联件登记为具名 change `ui-ux-first-panel`；本提案 §5/契约表以此 slug 引用；非「默认其存在」 |
| UT-S09-114 | 双阶段发布状态由验收机器判定 | 发布状态（F2 R7） | contract-ready 已达 / 跨仓 smoke 结果 | 判定 feature-enabled | contract-ready=OpenLogos npm+文档站发布即达；feature-enabled 当且仅当 `ui-ux-first-panel` 已部署且跨仓端到端 smoke 全绿；由验收结果机器判定，非人工声称 |


## REMOVED-ITEMS — 九、UI/UX 前置确认（proposal-ui-ux-first）单元测试用例

- UT-S09-86 — 验证对象是 `verify-ui-provenance` overlay 节点及其门语义，该节点随 §2.74.2 移除
- UT-S09-89 — 验证对象是 `verify-ui-provenance` overlay 节点及其门语义，该节点随 §2.74.2 移除

## MODIFIED — 十、UI/UX 前置确认场景测试用例（proposal-ui-ux-first）


> 场景级端到端验收，尤其 F4 R7 跨会话 fail-closed。测试实现写入 OpenLogos reporter，测试名含 `ST-S09-*` ID。

| ID | 描述 | 覆盖 Steps / 场景 | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S09-33 | GUI 项目提案阶段产出原型并在 plan 门前可见 | S09 Step 3→6（plan 门前） | GUI 项目、`ui_impact:true`、driver 派发 change-writer | plan 节点判 ui_impact→dispatch change-writer（ui-ux-pro-max）产逐页原型+`design-system.json`（写 `2-page-design/`，guard 放行）→ `check-ui-prototype` 富对账 | 原型在 plan-exit 门前产出且可见；富对账通过节点 done；flow-derive 不因原型 delta 误判进入 spec |
| ST-S09-33a | 场景级降级贯通：Python3 缺失 → fallback 原型 → checker exit0 → plan-exit 可达 | S09 A3→plan-exit（F2 降级贯通） | GUI 项目、`ui_impact:true`、**无 Python3**（ui-ux-pro-max 令牌不可得）、driver 从 A3 派发 change-writer | ①A3 派发 change-writer→检测无 Python3 走 `fallback`（通用原型、**无令牌**、逐页原型非空、声明段写 `design_system_mode: fallback` + 非空 `design_system_fallback_reason`、不产 `design-system.json`）→写 `2-page-design/`（guard 放行）；②运行 `openlogos check-ui-prototype`；③`write-ui-prototype` 节点收敛；④继续推进至 plan-exit | `check-ui-prototype` **`exit 0`**（fallback 不要求 design-system.json/令牌、不阻塞）→ `write-ui-prototype` 节点 **done** → **一路推进至 plan-exit 可达**（非仅单测 checker，而是 A3→plan-exit 端到端降级不卡死＝F2 核心价值）；对照：`generated` 模式承诺令牌却缺失时端到端 **fail closed**（checker 非零、`write-ui-prototype` 未 done、plan-exit 前阻断），与本 fallback 通路形成对照 |
| ST-S09-34 | 批准即 UI 确认：面板渲染写 provenance | S09 Step 6→7（批准门） | 渲染面板、原型已产出 | 面板渲染原型→用户批准→写 `PLAN_APPROVED` body（`ui_prototype_rendered:true`+`pages`+`hashes`） | 「批准==UI 已确认」仅当面板实际渲染成立；provenance 记录批准时刻原型清单与逐文件 hash |
| ST-S09-36 | **跨会话验收**：删 capability 文件+重启+改原型+直调 merge 必须拒绝 | F4 R7 跨会话 fail-closed | ①渲染批准写带 `hashes` 的 `PLAN_APPROVED`；②删 `logos/.session-capabilities.json`；③重启进程；④改动原型 | 直接 `openlogos merge <slug>` | **必须拒绝**：不生成 `MERGE_PROMPT`、不写 resources、不写 `SPEC_MERGED`；当前会话 capability 缺失不得降级（「曾渲染确认」证据固化于批准记录）；**同时覆盖 `commitVerifiedPrototypes()` 落盘入口**——事务门亦 fail closed、resources 零残留 |
| ST-S09-37 | 对照组：旧空 marker 纯 CLI 项目 advisory 放行 | F3 向后兼容对照 | 纯 CLI 项目、`PLAN_APPROVED` 空 marker、无「曾渲染确认」证据 | 直接 `openlogos merge <slug>` | advisory 放行（不要求 hashes、不阻断），与 ST-S09-36 严格分支形成对照 |
| ST-S09-38 | 崩溃注入：事务落盘崩溃后恢复到全有或全无 | 崩溃恢复（F1 R3） | 多原型落盘、提交中途注入崩溃 | 崩溃→下次 `openlogos merge`/启动检测残留 journal→前滚或回滚 | 恢复到一致的全有或全无态；无部分落盘/未获批残留；恢复后清 journal；随后 apply-merge 后复核 hash 一致 |
| ST-S09-39 | 跨仓端到端发布状态两态可区分 | 双阶段发布（F2 R7，契约侧） | 契约已发布 | 缺 `ui-ux-first-panel` 时判态；`ui-ux-first-panel` 部署且跨仓 smoke 全绿时判态 | 前者=contract-ready（如实声明功能未启用/降级）；后者=feature-enabled；两态可由验收结果区分（跨仓端到端 smoke 由 `ui-ux-first-panel` 承载，边界见 smoke 用例） |
| ST-S09-40 | 非 GUI 项目特性不启用、流程零改动 | 非 GUI 回归 | 纯 CLI/API/Skills 项目 | 走完整 S09 变更流程 | `ui_impact` 恒假、`write-ui-prototype` skip、plan allowlist 不收窄、merge 无 hash gate；流程与现状逐字节一致（无回归） |
| ST-S09-41 | **存量 GUI 项目迁移端到端**：缺字段→诊断→回填→sync 注入→UI-first 可达 | S09 F1 存量迁移贯通 | 旧 `launched` GUI fixture：`logos-project.yaml` 的 `modules[]`（含 `core`）**缺 `product_type`**；overlay 未注入（原不可达） | ①`openlogos sync`（或升级路径）→ 收到 `PRODUCT_TYPE_CONFIRMATION_REQUIRED` 诊断（列 `core`、指向 set-product-type）；②`openlogos module set-product-type core web`（幂等回填）；③`openlogos sync`（幂等注入 overlay）；④针对 `core` 模块的提案声明 `ui_impact:true` 并派生 | ①诊断如实列缺字段 module、安全默认非 GUI 维持、overlay 仍未注入；②回填成功、`modules[].product_type=web`；③`gui-ui-first` 两 op:add 注入项目实例 `launched.yaml`、重复 sync 不重复注入（幂等）；④**仅 `core`（web）模块的提案 `ui_impact` 可真、可推进到 UI-first**（`write-ui-prototype` 参与）；同一 fixture 若另有 cli 模块，其提案 `ui_impact` 仍假 |
| ST-S09-42 | 存量迁移反向：GUI→非 GUI / 删最后 GUI 模块 → sync 移除 overlay、保留用户 ops | S09 F1 反向移除贯通 | 已回填 GUI 且 overlay 已注入的 `launched.yaml`，另**含用户自定义 overlay op** `custom-user-node` | ①`set-product-type core cli`（或删最后一个 GUI 模块）→ `openlogos sync`；②再 `sync` | 项目不再含 GUI 模块 → `sync` 按 node id 移除 `write-ui-prototype`；**同一 `launched.yaml` 内用户自定义 `custom-user-node` 保持不变、绝不被删除**；重复 sync 幂等（no-op）；随后 GUI 相关节点全 skip、流程回落至非 GUI 零改动 |
| ST-S09-43 | `--auto` 无人值守缺字段不猜测升级 GUI | S09 F1 `--auto` 安全默认 | 旧 `launched` GUI 意图 fixture、`modules[]` 缺 `product_type`、无人值守 | `openlogos next --auto`（含 sync/推进链，无人工干预） | 缺字段模块**绝不被自动判 GUI**；保持安全默认（非 GUI、overlay 不注入、`ui_impact` 假）；照常输出 `PRODUCT_TYPE_CONFIRMATION_REQUIRED` 作为 next action；未显式 `set-product-type` 前不注入 overlay、不推进 UI-first |


## REMOVED-ITEMS — 十、UI/UX 前置确认场景测试用例（proposal-ui-ux-first）

- ST-S09-35 — 验证对象是 `verify-ui-provenance` overlay 节点及其门语义，该节点随 §2.74.2 移除

## ADDED — S09 三处形态订正测试

> 覆盖决策澄清由判定改为文档、UI provenance 由阻断门改为警告、seed 恢复门由硬阻塞改为隔离并继续。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S09-344 | 决策澄清不再参与任何判定 | 构造四类提案：① 无「## 决策澄清」小节；② 小节存在但 YAML 语法非法；③ `decisions[].id` 不匹配 `C\d+`；④ 完整合法 | 求 `evaluatePlanPackage` 与 `runChangeLint` | 四者均无 `proposal_clarification_invalid` / `clarification_contract_invalid`；`plan_state` 不含 `clarification` 字段；提案模板仍生成该小节 |
| UT-S09-345 | UI provenance 失配降为告警 | `PLAN_APPROVED` 含 `ui_prototype_rendered:true` 与 hashes，原型文件在批准后被改动（hash 漂移） | 发起 `merge` | **零退出**并写 `SPEC_MERGED`；输出含 provenance 告警；`check-ui-hash-match` 单独运行时**仍如实报失配并非零退出**（诊断能力不减） |
| UT-S09-346 | 损坏 seed journal 被隔离而非阻塞 | adopted 项目，`<run>/commit-journal.json` 内容损坏（非法 JSON / schema 非法 / 必填字段缺失 三种参数化） | 依次运行 `status` / `next` / `change-lint` | 三者均**零退出**并给出告警；损坏 journal 被重命名为 `<run>.commit-journal.corrupt-<时间戳>.json` 且**内容逐字节保留**；原路径不再存在；可恢复路径与读锁竞争语义逐字不变 |

### 场景测试

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S09-142 | 真实 CLI 下无决策澄清小节的提案全链通过 | 真实 CLI；`proposal.md` **完全不含**「## 决策澄清」小节 | ① `change-lint`；② `merge` | ① PASS 且输出无 clarification 相关诊断；② merge 成功写 `SPEC_MERGED` |
| ST-S09-143 | GUI overlay 仅剩原型节点 | 真实 CLI；GUI 项目 `ui_impact:true` 的 launched 提案 | 读 `spec/flow/overlays/gui-ui-first.yaml` 与注入后的项目实例 flow | overlay 恰一个 `op:add`（`write-ui-prototype`）；**不含** `verify-ui-provenance`；`check-ui-prototype` 与 `check-ui-hash-match` 两命令照常可用 |

### 追溯与覆盖

- AC-DEGATE-01 决策澄清不参与判定：UT-S09-344、ST-S09-142。
- AC-DEGATE-02 UI provenance 降警告且诊断不减：UT-S09-345、ST-S09-143。
- AC-DEGATE-03 seed 门隔离并继续：UT-S09-346。
- 功能规格：§2.74。
