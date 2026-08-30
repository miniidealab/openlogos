# Skill: Merge Executor

> 读取 CLI 生成的 MERGE_PROMPT.md 指令文件，将变更提案中的 delta 文件逐个合并到主文档，确保变更准确落地。

## 触发条件

- 用户运行完 `openlogos merge <slug>` 后要求 AI 执行合并
- 用户提到"执行合并"、"merge"、"把 delta 合进主文档"
- 用户提到"读取 MERGE_PROMPT.md 并执行"

## 前置依赖

1. `logos/changes/<slug>/MERGE_PROMPT.md` 存在（由 `openlogos merge` 命令生成）
2. MERGE_PROMPT.md 中引用的 delta 文件和目标主文档均存在

如果 MERGE_PROMPT.md 不存在，提示用户先运行 `openlogos merge <slug>`。

## 核心能力

1. 解析 MERGE_PROMPT.md 中的合并指令
2. 逐个读取 delta 文件，理解 ADDED / MODIFIED / REMOVED 标记
3. 精准定位主文档中的对应章节并执行合并
4. 保持主文档的格式和风格一致性
5. 输出变更摘要
6. **等待人类确认后停止** — 合并完成后 AI 的职责即结束，不得主动执行 verify、部署、smoke 或 archive

## 执行步骤

### Step 1: 读取合并指令

读取 `logos/changes/<slug>/MERGE_PROMPT.md`，解析出：
- 变更提案名称和概述
- 每个 delta 文件的路径、对应的目标主文档路径、操作类型

### Step 2: 预计算整个合并批次

先读取 proposal 的 `baseline_closure.policy`：

- **on-touch-v1 提案**：禁止逐文件直接写正式目标。必须一次读完 MERGE_PROMPT、proposal/tasks、全部 delta 与全部目标，在内存中计算每个 Markdown/普通规格目标的最终字节；API/DB non-Markdown 保留原 delta 字节，交给 CLI 剥离与校验。把最终字节、`delta_path`、canonical `target_path`、mode、delta/source/before/final SHA-256 写入提案目录内严格 JSON `MERGE_APPLY_MANIFEST.json`。若批次含 CREATE，还须把登记完 scenario/decision/counter/resource_index 的 `logos-project.yaml` 最终字节作为唯一 metadata target 写入 manifest。此步不得修改任何正式资源、counter、index 或 marker。
- **legacy 提案**：沿用下列逐 delta 合并方式。

legacy 路径按 MERGE_PROMPT.md 中列出的顺序处理：

1. **读取 delta 文件**：理解 ADDED / MODIFIED / REMOVED 标记及内容
2. **读取目标主文档**：定位需要修改的章节
3. **执行合并**：
   - `ADDED`：在主文档的指定位置插入新内容
   - `MODIFIED`：替换主文档中同名章节的内容
   - `REMOVED`：从主文档中删除对应章节
4. **输出摘要**：列出对该文件做了哪些修改

### Step 3: 受控 apply、总体报告与提交

on-touch-v1 的唯一正式落盘入口是：

```bash
openlogos merge-apply <slug> --manifest logos/changes/<slug>/MERGE_APPLY_MANIFEST.json
```

该命令会重跑 L1–L9 与 P==T==D，按 canonical target 反查语义类别，校验 manifest 哈希、Markdown CREATE 的 ADDED-only 契约、OpenAPI schema、项目 SQL 方言和 metadata 登记，然后**唯一一次**调用 `applyBaselineClosureBatch()`。全部目标、counter/index 与 `SPEC_MERGED` 同批提交；任何失败整批回滚并清除可执行 MERGE_PROMPT。失败时立即停止，不得手工补写任何目标或 marker，不得绕过命令重试局部文件。

legacy 提案完成逐文件合并后，继续执行既有事后点数与 marker 流程。

所有 delta 处理完毕后，输出：

```
合并完成：
- [文件路径 1]：新增 x 节，修改 y 节，删除 z 节
- [文件路径 2]：...
```

然后 AI **自动执行 git commit**（无需用户确认，但需告知）：

```bash
git add -A
git commit -m "docs({slug}): merge spec deltas"
```

> 使用 `git add -A` 而非 `git add logos/resources/`，确保本次合并涉及的所有规格文件（包括 spec/、skills/、CLAUDE.md、AGENTS.md 等）都被纳入提交，避免 commit 语义与实际落盘状态不一致。

legacy 提案在 commit 成功后写入规格合并完成标记：

```bash
touch logos/changes/{slug}/SPEC_MERGED
```

on-touch-v1 的 `SPEC_MERGED` 已由 `merge-apply` 作为事务最后一个目标写入，**禁止再 touch 或手工覆盖**。

`SPEC_MERGED` 表示 delta 已真实合入主规格。只有该标记存在后，`openlogos status` 才会进入 `coding` 阶段。`MERGE_PROMPT_GENERATED` / `MERGE_PROMPT.md` 只表示合并指令已生成，不能代表主规格已合并。

输出 commit 结果后，提示用户后续步骤：

```
✅ 规格文档已合并并提交。接下来请：

**Step 1：实现代码**
按更新后的 logos/resources/ 规格实现业务代码 + 测试代码。
代码实现完成后 AI 会自动提交代码变更。

**Step 2：运行验收（代码实现完成后）**
请在项目根目录运行：
openlogos verify
- 验收通过（PASS）→ 无部署任务时可进入归档；有部署任务时进入 Step 3
- 验收失败（FAIL）→ 修复代码后重新运行，无需重走 merge 流程

**Step 3：部署（仅当 tasks.md 存在 [deploy] section）**
验收通过后，由用户明确授权 AI 按部署方案执行部署任务。

AI 必须读取：
- logos/resources/prd/3-technical-plan/3-deployment/
- 当前提案 tasks.md 的 [deploy] section

**Step 4：冒烟测试（仅当已部署）**
部署完成后，由用户明确授权运行：
openlogos smoke

**Step 5：归档提案**
verify 通过且无部署任务，或部署完成且 smoke 通过后：
openlogos archive <slug>

openlogos verify、部署执行、openlogos smoke 和 openlogos archive 均为人类确认点，AI 未经用户明确授权不得自行执行。
```

## 合并原则

1. **保持格式一致**：合并后的内容必须与主文档的现有格式、缩进、标题层级保持一致
2. **不改动无关内容**：只修改 delta 指定的部分，不重新格式化整个文档
3. **冲突时询问**：如果主文档中找不到 delta 引用的章节（可能已被其他变更修改），暂停并询问用户如何处理
4. **逐文件确认**：处理完每个 delta 文件后展示修改摘要，等待用户确认后再处理下一个
5. **章节锚唯一定位（S37）**：段标记标题即章节锚，支持标题路径形态（`父级标题 > 目标标题`）。锚在主文档中解析到 **0 个或 ≥2 个**章节时一律**暂停并询问用户**——不得取第一个命中、不得合并同名章节、不得按 delta 内容反猜目标（与第 3 条同源，覆盖标题重复的真实语料，如 smoke 规格中 `二、冒烟测试用例补充` 出现 7 次）。
6. **显式删除契约（S37，REMOVED 语义零改动）**：整节删除走既有 `REMOVED`（删除锚定章节全节）；**部分条目删除由「MODIFIED 携带剩余全量 + `REMOVED-ITEMS` 同锚点名」成对表达**——`REMOVED-ITEMS` 是**纯声明性标记，不据其执行任何编辑**（物质变更完全由 MODIFIED 的整节替换完成），它只是删除授权与审计记录。应用 MODIFIED 块时若发现主文档该章节存在 delta 未在结构位置携带、且未被同锚 REMOVED-ITEMS 点名、也未随整节 REMOVED 删除的带稳定 ID 条目（测试 ID `UT-*`/`ST-*`/`SMOKE-*`、场景 `SXX`、多级节号），视为 delta 疑似隐式删除：**暂停并询问用户**，不得自行决定丢弃（正常情况下此类 delta 已被 `openlogos merge` 的事前守恒门拒绝，走到这里说明门外有异常，更须停）。

## 合并原则补充：条目守恒与事后点数（merge-conservation-archive-audit S37）

> 位于「合并原则」之后。条目守恒的**事前门**由 CLI 承担：`openlogos merge` 生成 MERGE_PROMPT 前已用与 change-lint L8 同一判据（结构化归属、逐章节对账、锚唯一定位 fail-closed）拦截缺陷 delta——merge-executor 拿到的 MERGE_PROMPT 对应的 delta 已通过事前点数。本节定义 merge-executor 的**事后点数**兜底职责：拦截「delta 合法、但合并执行出错」。

### REMOVED-ITEMS 处理规则（声明性，无编辑动作）

- 遇到 `## REMOVED-ITEMS — <章节锚>` 块：**不执行任何主文档编辑**——它声明"锚定章节中这些 ID 的消失是显式授权的"，物质删除已由同锚 MODIFIED 块的整节替换完成。
- 将点名清单记入该文件的合并摘要（删除了哪些 ID、原因），供用户确认与事后点数对账。
- 发现 REMOVED-ITEMS 无同锚 MODIFIED 块配对时暂停询问（点名无物质载体，事前门本应拦截）。

### 事后点数（合并落盘后、写 SPEC_MERGED 前，强制）

1. **清点时机**：legacy 为全部 delta 落盘后、`git commit` 与写 `SPEC_MERGED` 前；on-touch-v1 必须在预计算 manifest 时完成，并由 `merge-apply` 在正式写入前重验，禁止先散写再点数。
2. **清点口径（结构化）**：按 ID 模式注册表三类，对每个被本次合并触及的主文档清点**结构位置**上的实际 ID 集合——测试 ID 只数测试表 ID 首列、场景 ID 只数 `## SXX:` 标题与场景表行首列、节号只数标题行；散文提及不计。
3. **对账公式**：

   ```
   合并后主文档实际结构化 ID 集合
     == 合并前 ID 集合 − REMOVED 整节的 ID − REMOVED-ITEMS 点名 ID + delta 新增 ID
   ```

4. **相符** → 把点数结果写进合并摘要（例如「smoke 规格：合并前 53 ID − 整节删除 0 − 点名删除 2 + 新增 3 = 54，实测 54 ✓」），继续 commit 并写 `SPEC_MERGED`。
5. **不符** → **报告差异（多了哪些 / 少了哪些 ID）并暂停，不执行 commit、不写 `SPEC_MERGED`**，等待用户裁决；不得静默修补后继续。
6. 该自检不依赖 CLI，可用 Read/grep 完成；它是「delta 合法但 AI 合并执行出错」的最后防线，与事前门（CLI 确定性判据）共同构成两道点数。

### 与 archive audit-only 契约的关系

条目守恒（事前 + 事后）保证内容退出 `logos/resources/` 只能显式发生并留有 REMOVED / REMOVED-ITEMS 记录，因此归档（`logos/changes/archive/`）仅供审计、非事实源、过期可删除（契约见 `spec/change-management.md`「归档定位：audit-only」）。merge-executor 在任何情况下都**不得读取 archive 内容**来还原或补齐主文档——当前真相只在 `logos/resources/`、根 `spec/` 与根 `skills/`。


## 合并原则补充：段标记收窄 + 原型资产落盘归代码路径（proposal-ui-ux-first）

本节收窄 merge-executor 的「整份 create/replace」适用面，并把带 hash 绑定的原型资产落盘划出 merge-executor 职责范围。**merge-executor 只负责应用 markdown 规格 delta，绝不触碰原型资产。**

### 1. 段标记收窄（F3，防静默覆盖）

- **仅** `2-page-design/` 等**资产目录**下的**原型 / 资产文件类型**（`.html` / `.png` / `.svg` 等）在无段标记时，才按**整份 create/replace 落盘**（这类是整份文件资产、非章节合并；先例 `core-03-release-page-prototype.html`）。
  - **收窄边界**：此「资产整份落盘」仅适用于**非 `ui_impact` 绑定**的普通资产；本特性引入的 `ui_impact` 原型资产（含 legacy/degraded/advisory）**一律由 `commitVerifiedPrototypes()` 执行整份落盘，不是 merge-executor 的整份 create/replace 路径**（见第 2 条）。merge-executor 绝不触碰原型资产。
- **`.md` 等规格 / skill delta 缺 `ADDED / MODIFIED / REMOVED` 段标记时，一律判为非法 delta 并报错停下——绝不静默整份覆盖主文档。**
  - 遇到缺段标记的 `.md` delta：**停止合并**，输出明确错误（指出该 delta 文件路径与「缺少 `ADDED/MODIFIED/REMOVED` 段标记」的原因），等待用户修复 delta 后重跑，不得以整份覆盖兜底。
- 判据是**目标类型**：规格 / skill（`.md`）走段标记合并；`2-page-design/` 等资产目录下的原型 / 资产文件（`.html`/`.png`/`.svg` 等）走整份 create/replace——但见下方第 2 条：**带 hash 绑定的原型资产不由 merge-executor 落盘**。

### 2. 带 hash 绑定的原型资产落盘不由 merge-executor 自由编辑——改走代码级 `commitVerifiedPrototypes()`

对 `ui_impact:true` 提案的**所有**原型资产（含 legacy/degraded/advisory 情形），落盘**一律不经 merge-executor**：

- **唯一落盘入口 = `commitVerifiedPrototypes()`**（`cli/src/commands/merge.ts` 内的代码级命名函数），是所有 `ui_impact` 原型资产的**唯一落盘入口**，**无第二条绕过它的原型落盘路径**。它按持久化 `PLAN_APPROVED` provenance 内部选严 / 宽：
  - **严格模式**（批准记录含 UI provenance）：**落盘时校验 staged 字节 hash**（把源原型拷入私有 staging → 对 staged 副本算 hash 比对 `PLAN_APPROVED.hashes`，消除 verify→commit 的 TOCTOU 窗口）+ **事务原子提交**（verify-all → stage → 原子 rename 逐文件提交，任一不符即在写入任何文件前 abort、失败回滚，全有或全无、失败零残留）+ **崩溃恢复**（commit journal + 启动前滚/回滚到一致态）。
  - **advisory 模式**（legacy/degraded/旧空 marker 且无「曾渲染确认」证据）：仍经**同一入口**落盘，只是**不做严格 hash 校验**、不进严格事务门、不阻断。两模式**同一 owner**，merge-executor 均不经手。
- **apply-merge 后复核（双保险）**：`apply-merge` 完成后代码复核 resources 中已落盘原型的 hash == `PLAN_APPROVED.hashes`，不符则阻断流程前进（不进 slice/code）。
- **merge-executor 绝不触碰原型资产**：merge-executor 只应用 markdown 规格 delta；带 hash 绑定的原型资产由上述代码路径落盘并即时校验，其内容 AI（merge-executor）不经手、不自由编辑。

### 3. 严格性以持久化 `PLAN_APPROVED` provenance 为键，不因会话 capability 缺失降级（F4 R7）

- 进入严格事务门与 fail-closed 的判据，一律以**持久化 `PLAN_APPROVED` provenance**（`ui_prototype_rendered:true` + `pages` + `hashes`）为准：
  - 批准记录**含 UI provenance** ⇒ 所有 merge / 落盘 / 落盘后复核入口**永久 fail closed**：`hashes` 必须存在且完好、逐文件重算匹配；缺失 / 损坏 / 失配一律拒绝（非零退出、不生成 `MERGE_PROMPT`、不写 resources、不写 `SPEC_MERGED`）。
  - **当前会话 `logos/.session-capabilities.json` 缺失 / 过期 / 被清理一律不得降级**——「曾渲染确认」的证据已固化在批准记录里，易失会话态无权推翻它（否则构成跨会话降级绕过）。
  - 批准记录明确为 legacy/degraded、或旧空 marker 且无任何「曾渲染确认」证据 ⇒ 才走 F3 向后兼容 advisory：**仍由 `commitVerifiedPrototypes()` 同一入口落盘（advisory 模式、不做严格 hash 校验、不进严格事务门、不阻断），并非 merge-executor 落盘**。
- `.session-capabilities.json` 仅用于 `plan-exit` **之前**的交互模式选择，**绝不**作为批准后的完整性门降级开关。
- 该强制点由 `commitVerifiedPrototypes()` 等代码路径落实（[code] 阶段实现与验收）；本 SKILL 记录的是 merge-executor 的**职责边界**：不参与原型资产落盘、不因会话 capability 缺失放松对规格 delta 的段标记严格性。

## 合并原则补充：non-Markdown 整文件 delta 协议（contract-self-description）

`.md` 之外的规格类整文件 delta 按本节协议合并。支持集合固定为：

- `deltas/spec/flow/**/*.yaml` → `spec/flow/**/*.yaml`；
- `deltas/spec/schema/**/*.json` → `spec/schema/**/*.json`；
- `deltas/api/**/*.{yaml,yml,json}` → `logos/resources/api/**/*.{yaml,yml,json}`；
- `deltas/database/**/*.sql` → `logos/resources/database/**/*.sql`。

其它目录/后缀不得借本协议整文件覆盖；`.md` 仍走章节 marker，page-design 资产/UI 原型仍走各自既有 owner。

### 1. 首行控制 marker（强制）

UTF-8 delta 首行必须完整匹配以下二选一（路径中禁止换行、反引号、绝对路径、`..`）：

```text
## ADDED — <项目根相对 canonical target>（新文件，整文件）
## MODIFIED — <项目根相对 canonical target>（整文件替换）
```

- `ADDED` 对应 plan `CREATE`，要求目标不存在；`MODIFIED` 对应 plan `MODIFY`，要求目标存在。
- marker 声明路径必须与 delta 路径经权威 `DELTA_TO_RESOURCE`/closure resolver 映射出的 canonical target **逐字节相等**。例如 `deltas/api/pay.yaml` 只能声明 `logos/resources/api/pay.yaml`；`deltas/database/schema.sql` 只能声明 `logos/resources/database/schema.sql`。
- 首行缺失、格式非法、操作/mode 不一致、声明 target 漂移、后缀不在支持集、目标存在性漂移或重复 canonical target，均报 `non_markdown_delta_invalid`/既有 mode 违规并在任何写入前停止。
- 该首行是 delta 控制语法，即使它碰巧可被 YAML 当注释也绝不能进入目标；SQL 不要求也不允许把它当合法语句。

### 2. 确定性剥离与整文件预演

1. 以二进制读取 delta，只把首行按 UTF-8 解码匹配 marker；支持 LF/CRLF，并**剥离 marker 及其唯一行结束符**。若文件只有 marker、payload 为空或 payload 只含空白，失败。
2. 剩余 payload 字节原样作为目标候选；不格式化、不转义、不改换行、不删除任何其它行。目标任意位置不得残留匹配控制 marker 的行。
3. `MODIFIED` 是整文件替换，不执行 Markdown 章节合并；`ADDED` 是整文件创建，不覆盖已有文件。
4. 在内存/私有 staging 中先完成所有目标 payload 构造、hash、类别完整度与语法验证；任何一项失败前不得写任一正式目标。

### 3. 类别语法与最低校验（强制）

**spec/flow YAML**：duplicate-key fail-closed 的 YAML parse 通过，并继续通过 flow schema/normalize 校验。

**spec/schema JSON**：duplicate-key-aware JSON parse 通过，并继续通过对应 JSON Schema meta-schema/项目约束；普通 `JSON.parse` 的 last-wins 不能替代重复键检查。

**API YAML/YML/JSON**：

1. YAML 用 duplicate-key fail-closed parser；JSON 用 duplicate-key-aware parser；
2. 剥离后的根对象必须是 OpenAPI 3.0.x/3.1.x，包含合法 `openapi`、`info`、`paths`（或该版本允许的等价公开边界）与适用 components；
3. 通过项目选定的 OpenAPI validator，operationId/引用可解析；CREATE 还执行 baseline-closure 的非空 operation/schema/error/auth/兼容追踪完整度；
4. 任一 parse/schema/ref/完整度错误报 `non_markdown_delta_invalid` 或 `create_target_incomplete`，不得落盘。

**database SQL**：

1. 方言来自已合并架构/`logos-project.yaml tech_stack.database`；若缺失或无对应 validator，plan 应为 AMBIGUOUS，apply 侧 fail-closed `non_markdown_delta_invalid`，不得用通用字符串检查假装语法通过；
2. payload 必须能被该方言 parser 完整消费，拒绝尾随不可解析字节、空文件与 TODO/占位；
3. 有隔离适配器时，在临时空库/事务内执行完整 DDL 并回滚；至少 SQLite CREATE/MODIFY E2E 必须真实执行。无可执行适配器时仍必须有方言 parser，不能降级为只看分号；
4. CREATE 继续检查表/字段、主外键、约束、索引、迁移/回滚与场景/API 追踪完整度。

### 4. 事务提交、失败回滚与重试

- non-Markdown API/DB 与本批 Markdown MODIFY/CREATE、counter、resource_index、dogfood 同步和 `SPEC_MERGED` 属同一 apply 事务。
- preflight 全过后把候选写私有临时文件并 fsync；ADDED 再确认目标缺失、MODIFIED 再确认目标 hash/存在性未漂移，然后原子 rename。
- 任一 rename、后置 parse/执行、counter/index 或 marker 写入失败，恢复全部备份、删除本批新建目标与临时文件，不写 `SPEC_MERGED`；重试依据 journal 收敛，不按“目标已存在”误判成功。
- 后置校验再次读取正式目标：字节必须等于剥离后的 payload、不得含控制 marker、API 可验证、SQL 可解析/在支持适配器中可执行。合并摘要逐目标记录 mode、canonical target、payload sha256 与 validator 结果。

### 5. 验收锚

- `.yaml`/`.json` OpenAPI 与 `.sql` 各有 ADDED/CREATE、MODIFIED/replace 正例；目标不含控制 marker。
- marker 缺失/非法、声明 target 漂移、mode/存在性漂移、重复 key、坏 OpenAPI ref、坏 SQL、validator 不可用均在零正式写入时失败。
- 混合批中最后一个 API/DB 校验或提交失败时，先前 Markdown/API/DB 目标、counter/index 与 `SPEC_MERGED` 全部回滚。
- 对应规格测试：UT-S35-45、UT-S39-26/27、ST-S35-15、ST-S39-13、SMOKE-core-56。

## 决策记录 apply 事务所有权（S38，decision-record-capability）

> 来源变更：decision-record-capability（社区 RFC issue #12 补充观察）。delta-r1 F2/F5：`openlogos merge` 只校验 delta + 生成 `MERGE_PROMPT`；决策记录的**实际落盘、DXX 取号、计数器持久化、索引更新**均由 **merge-executor 在 apply 时**承担（与既有 `scenario_counter` / `feature_counter` 的「AI 维护、CLI 不取号」一致）。

当 `deltas/decisions/` 含决策记录 delta 时，merge-executor 在应用该批 delta 时于**同一提交**内按下列顺序执行，作为决策记录的**唯一事务所有者**。该事务的**取号 + 落盘 + 计数器 + 索引 + marker** 语义由受控生产原语 `cli/src/lib/decision-record.ts` 的 `applyDecisionRecords(root, proposalDir)` 承载（它是 `allocateDecisionRecordIds` 的真实生产消费者、由 ST-S38-03/10/11 端到端驱动断言）——merge-executor 按此顺序执行、以其为事务事实源，而非各自散写。该原语按段标记**分类 ADDED / MODIFIED**（MODIFIED = superseded 等就地更新既有记录、**保号不取新号**，非按同名跳过），并对全部主文档 / YAML / index / marker 做**持久事务（journal）保护**（比照 `UI_COMMIT_JOURNAL.json`）：首个资源写入前原子落一份 `DECISION_APPLY_JOURNAL.json`（记录提案身份 = 目标集合 + 正文、`base`、分配号、旧内容），任一步失败回滚已写、恢复旧内容、不留半状态。**事务身份以 journal 判定，不以正文相等判定**——无匹配 journal 时，任何同名既有目标的显式 ADDED（**即使正文相同**）一律**冲突拒绝、绝不覆盖**（`base` 计入全部已提交落盘 DXX、与既有资源重复即拒）；有匹配 journal（崩溃/中断恢复）时，沿用 journal 记录的 `base`/分配号**前滚补齐**、**绝不据已前移的 `next_id` 重算**（故 marker 前崩溃可重试收敛、不会算成 D(N+1) 自拒）。写 `SPEC_MERGED`（提交边界）前**重读校验全部后置条件**（文档集合、`decision_counter.next_id`、`resource_index` 收录），任一不满足即回滚；提交成功即清 journal。重试据 journal + `SPEC_MERGED` + 完整后置条件补齐（不按文件名跳过、不据前移 counter 重算）：

### ① DXX 取号（闭合分配公式，保证全局唯一；delta-r2 F5：基准只含已落盘、不含本批）

- **分配基准**：`base = max(configured_next_id ?? 1, max(logos/resources/decisions/ 中【已落盘】DXX，空集按 0) + 1)`。**基准只从【已落盘】记录取最大值——绝不把本批 `deltas/decisions/` 待落盘 DXX 纳入 max**（否则首条合法记录：资源空、`next_id=1`、拟号 D01 被算成 `max(1,1+1)=D02`、再因「文件名 D01 ≠ allocated D02」自拒）。「仅读 `decision_counter.next_id` 递增」不足以唯一——counter 缺失 / 落后（stale）而已落盘决策文件存在时会重复分配，故基准取 `next_id` 与「已落盘最大 +1」的较大者。
- **本批候选取号**：本提案候选按**不依赖待分配 DXX 的稳定顺序**（文件名 slug 声明序）排列；第 `i` 条（**0 基**）`expected_i = base + i`。
- **校验**：每条 **文件名 DXX == 标题 DXX == `expected_i`**；本提案内 / 与既有资源**重复即拒绝**（阻断报告、不落盘、不写 `SPEC_MERGED`），要求改号。
- **持久化**：全部 apply 成功后写 `decision_counter.next_id = base + 候选数`（等价「全部已落盘 DXX 之最大 + 1」）。
- 举例：资源空、`next_id=1` → `base=1`；单条候选 `expected_0=D01`（首条不再被拒）；两条候选 → `D01`/`D02`，`next_id=3`。`next_id=7`、无更大已落盘 → `base=7`，单条得 `D07`；`next_id` 缺失、已落盘含 `D03` → `base=max(1,3+1)=4`，得 `D04`。

### ② 落盘与元数据（同一提交）

- 应用 delta 写决策记录主文档到 `logos/resources/decisions/<module>-DXX-<slug>.md`。
- 持久化 `logos-project.yaml` 的 `decision_counter.next_id = max(全部已落盘 DXX) + 1`（与 `scenario_counter` / `feature_counter` 同为 AI 维护字段；`project-yaml.ts` 只读取侧解析、CLI 不取号）。
- 更新 `resource_index` 收录新决策记录（内容化 desc 由 `sync-resource-index.ts` 扩展扫描器规则生成；merge-executor 不手工编造 desc，走权威 index 路径）。

### ③ 守恒事后点数 + 失败语义

- 承 S37 事后点数：合并落盘后清点决策记录实际 `DXX` 集合 == 合并前 − REMOVED 整条 − REMOVED-ITEMS 点名 + 新增；superseded 是 `MODIFIED` 改状态、`DXX` 不减。不符即报告、暂停、**不写 `SPEC_MERGED`**。
- **失败回滚**：apply 冲突 / 校验失败 / 用户中止时回滚，**不提前消耗编号**（杜绝「计数器已前移、决策不存在」半状态）。
- **重试幂等**：同一 delta 集重复 apply 得同一 DXX 分配与同一 `decision_counter.next_id`。

### ④ 无决策记录时零改动

`deltas/decisions/` 为空的提案，merge-executor 行为与本能力上线前**逐字节一致**（不触发上述任何步骤）。

## 输出规范

- legacy 可直接修改 `logos/resources/` 中的主文档；on-touch-v1 只能由 `merge-apply` 原子落盘
- on-touch-v1 可在提案目录写 `MERGE_APPLY_MANIFEST.json` 与事务私有 journal/staging；`SPEC_MERGED` 只能由受控命令写入
- 合并过程中不创建新文件（除非 delta 指定新增一个全新的文档）
- 合并部署 delta 时，只合并部署方案文档，不执行部署命令

## 实践经验

- **先全部读完再动手**：先通读所有 delta 文件和目标文档，理解全貌后再逐个合并
- **MODIFIED 是最容易出错的**：章节标题可能有微小差异（大小写、空格），需要模糊匹配
- **保留变更痕迹**：如果主文档有"最后更新"时间戳，记得同步更新
- **delta 的顺序有意义**：需求文档的变更应在 API 文档之前处理，确保上下游一致
- **`openlogos archive` 是人类确认点**：AI 未经用户明确授权不得自行执行。用户明确要求归档（包括使用 `/openlogos:archive` slash command）时，AI 可以代为执行。

## 推荐提示词

以下提示词可以直接复制给 AI 使用：

- `读取 logos/changes/<slug>/MERGE_PROMPT.md 并执行合并`
- `帮我把 add-remember-me 的变更合并到主文档`
- `执行变更合并`

## S39：MODIFY/CREATE 的单目标最终态 apply

### 前置条件修订

目标主文档**不再要求一律已存在**。对 on-touch-v1 提案，merge-executor 必须读取 tasks 模式与共享 closure evaluator：

- `[MODIFY]`：目标在 plan/apply 时都必须存在；
- `[CREATE]`：目标在 plan/apply 时都必须缺失；
- 任一存在性漂移、重复 canonical target、未规划 delta 或 CREATE 不完整都必须停止，不得猜测/自动换模式。

现有路径 containment、Markdown marker、UI prototype 专用入口、S37 守恒、decision 编号与 MERGE_PROMPT 前置继续生效。

### 单目标唯一性

apply 前将所有 delta 映射为 canonical target，断言：

```text
non-skip tasks canonical targets
== mergeable delta canonical targets
== planned apply canonical targets
```

三集合相等且无重复。禁止按扫描顺序 last-wins，也禁止接受“baseline delta + incremental delta”指向同一目标。

### MODIFY apply

沿用既有 ADDED/MODIFIED/REMOVED/REMOVED-ITEMS 语义：

- MODIFIED 整节替换并通过 S37；
- ADDED 可给既有文件加缺失章节；
- 同一 target 所有块一次计算新字节、一次原子写入。

### CREATE apply

CREATE 不新增名为 `CREATE` 的 merge marker/操作。Markdown delta 以章节 `ADDED` 承载完整文档；API/DB 非 Markdown delta 使用下方“non-Markdown 整文件 delta 协议”的首行 `ADDED` 控制行：

1. 运行类别最低完整度与语法检查；
2. 确认最终 target 仍不存在且父目录位于允许根；
3. Markdown 从 ADDED 块构造目标完整字节；非 Markdown 剥离且仅剥离首行控制 marker，按声明 target 做整文件字节；
4. 写临时文件、fsync/rename（按项目现有原子写抽象）；
5. 不允许覆盖、append 半文档或留下空文件。

若目标在 plan 后被创建，返回 `delta_target_mode_mismatch`，整批回滚。

### 事务边界

一次 apply 的事务集合包括：

- 全部 MODIFY/CREATE 目标；
- 新 scenario/decision 的编号与登记；
- `scenario_counter`/`decision_counter`；
- `resource_index`；
- 根 spec/skills 合并后的 dogfood 同步产物；
- 最终 `SPEC_MERGED`。

先预计算/备份所有旧字节，再写目标，最后写元数据与 marker。任何失败恢复全部旧字节、删除本事务新建文件、还原 counters/index，不写 SPEC_MERGED。重试必须幂等。

本提案成功 apply 时：S39→F04、scenario next_id=40；D02 落盘、decision next_id=3；新增场景/测试/决策/根规格进入 index。

### 受控生产入口（唯一）

on-touch-v1 不允许“AI 先逐文件写，再把原子原语当测试工具”。AI 必须先产出严格 `MERGE_APPLY_MANIFEST.json`，随后调用 `openlogos merge-apply <slug> --manifest <path>`；该 CLI 是 `applyBaselineClosureBatch()` 的唯一真实 merge-executor 消费者。manifest 的 planned target 集必须与 proposal/tasks/deltas 完全相等，API/DB 目标禁止提供 prepared bytes 绕过专用 validator，额外 target 与重复 target 一律拒绝。

命令只接受当前 guard 提案内的 manifest，并要求受控 `MERGE_PROMPT_GENERATED` 在场。它核对每个 delta 的 source hash、MODIFY 旧目标 hash/CREATE 不存在事实、最终字节 hash；含 CREATE 时还核对 `scenarios[]`、`scenario_counter`、`decision_counter` 和 `resource_index`。成功时由事务最后写 `SPEC_MERGED`；故障注入、validator、hash、metadata 或任一 rename 失败时，正式目标保持全旧、清除可执行 prompt，绝不遗留半新资源。

### Effective view 与事后对账

merge-executor 不重新做业务适用性推断，只消费已批准 plan 和共享结构判据。apply 后逐 target 重算预期 hash/结构；CREATE 文档需再次满足类别结构。目标集合、ID 点数、counter 与 resource_index 全部一致才完成。

### 无 JIT/基线旁路

- 不读取或更新 candidate verified/confirmed 字段；
- 不因 baseline_seed_state/coverage 拒绝 apply；
- 不创建 baseline marker/gate/task；
- 不从 seed staging 合并任何内容；
- 不把 archive delta 当缺失主目标的 fallback 真相源。

### 交付提示

完成 apply 后按既有流程进入 slice/implement；不要在本 Skill 内提前实现代码、执行 verify/deploy/smoke/archive/push。默认模式下每个人类确认点语义保持，全自动 standing 授权仍由 driver 控制。

## 0.14.0 Merge transaction 执行合同（规范性覆盖）

> 本节适用于由 OpenLogos 0.14.0 创建或恢复的 merge transaction，并覆盖本 Skill 中与 `MERGE_APPLY_MANIFEST.json`、Base64 payload、Agent 直接写正式 target/metadata/marker 有关的旧步骤。历史协议仅可只读诊断。

### 角色边界

merge-executor 是 content slot 的语义合成者，不是正式目标 writer。执行者只能：

1. 读取事务提示、proposal/tasks、声明的 Delta、对应 canonical target 当前字节以及事务只读投影；
2. 为每个已声明 slot 计算最终文件字节；
3. 通过事务提供的受控 slot 提交入口写入该 slot；
4. 读回 slot 摘要，确认 `slot_id`、内容 SHA-256 与提交结果一致；
5. 停止并等待 Driver/核心执行 seal 与 apply。

执行者严禁创建、修改或补全 `MERGE_APPLY_MANIFEST.json`，严禁自行写 canonical target、metadata、dogfood、`SPEC_MERGED`、journal 或 receipt，严禁把工作单 done 宣称为 merge completed。

### 必须验证的身份

处理 slot 前必须逐字核对 transaction id、slug、slot id、delta path、target path、mode、source SHA-256 与 MODIFY 的 before SHA-256。任一事实漂移、slot 未声明、target 越界或 transaction phase 不允许 `submit_content` 时立即 fail-closed，并报告稳定 classification；不得改名、重排、增删目标或自动采用新基线。

### 内容合成

- Markdown Delta 按 ADDED/MODIFIED/REMOVED 指令与当前 target 语义合成最终态；不把控制 marker 写入正式内容。
- non-Markdown Delta 按首行整文件协议剥离 marker，剩余字节即 slot 最终态；不得局部拼接。
- CREATE 必须在 target 不存在的事实下生成完整文件；MODIFY 必须基于冻结的 before hash。
- metadata 由核心从 sealed resource closure 确定性生成，不为其开放人工 slot。
- no-delta 没有资源 slot；执行者不得为“完成任务”伪造空文件或 manifest。

### 交付与停止条件

全部必需 slot 提交并读回一致后，只报告：transaction id、已提交 slot id、每个 content SHA-256、缺失 slot 列表和当前只读 phase。此时 prepare/collecting 工作单完成，但 merge 节点尚未完成。只有核心完成 seal/apply 并持久化有效 completed receipt 后，Driver 才能宣告合并成功。

### 恢复

重试前先读取 transaction status，并仅执行 `allowed_actions` 许可的 slot 操作。sealed/applying/completed 状态禁止重写 slot；completed 时返回已有 receipt 摘要，不重复合成或写入。若看到旧 manifest 指令与本节冲突，返回 `legacy_manifest_rejected`，不得兼容降级。

### 跨仓与版本门

RunLogos 派发前必须冻结全局 `openlogos` 命令路径、精确版本 0.14.0、transaction schema hash 与 contract hash。任一不一致时停止；不得使用源码 checkout 或 0.13.x Skill 替代随包 0.14.0 合同。

## 0.14.0 消费者合同 follow-up 执行规则


> 本节覆盖本 Skill 中要求 Agent 自建临时路径、读取内部 receipt 或根据 phase 推导动作的旧说明。

1. 先调用公共 `merge transaction status`，校验 CLI 版本、schema SHA-256、contract SHA-256、slug 与 transaction identity。
2. Agent 只接收 `content_slots.items[]` 中当前 slot 的 opaque target_ref、staging_path、编码、上限和写协议；禁止 OpenLogos/Git 命令及 canonical target 写权。
3. Agent 必须在 staging_path 同目录写临时文件并原子 rename。WorkUnit quiescent 后，Driver 只能使用完全相同的声明路径调用 `submit-content --slot --file`。
4. 只执行 `allowed_actions` 中的 `next_action`；已知动作与子命令一一映射：submit_content→submit-content、seal→seal、apply→apply、recover→recover、abort→abort。
5. completed 时校验 receipt final_hash paths 与外层 artifact_hash paths 互斥，二者并集精确等于 commit_paths。禁止读取内部文件补齐集合。
6. abort 只在 collecting/ready/sealed 执行；期望 failed/aborted、动作清空、receipt=null。普通 fatal failed 交给人工诊断。
7. Git 只能逐项提交公共 receipt 的 commit_paths；任何额外 staged path、unrelated dirty、未知字段枚举或 hash 漂移均 fail closed。

## 0.14.2 Preflight/Reopen 执行合同


### 核心约束

- ready只表示slot齐备；seal必须先通过确定性preflight并绑定其canonical hash。
- legacy sealed apply可能在首写前原子退回collecting；这是core控制的状态转换，不是消费者编辑sealed的许可。
- status/next中的`missing_slot_ids`是唯一重提集合；残留merge-content/merge-staging字节没有权威性。
- 未受影响slot submitted hash保留，禁止整单重建。

### Retryable 修复流程

1. 读取错误的`classification/retryable/phase/allowed_actions/next_action`。
2. 通过status/next读取完整content slot projection；不得从错误message解析target或slot。
3. 对每个missing slot重新读取批准Delta与正式before，生成该target完整final bytes。
4. 只写声明staging path，使用temp+fsync+atomic rename后submit。
5. 全部missing slots重新submitted且phase=ready后seal；sealed后apply。
6. 重复真实内容修复直到completed，或在fatal/recovery边界停止。

### 禁止事项

- 不直接修改正式target、`MERGE_TRANSACTION.json`、merge-content、receipt、marker或apply journal。
- 不解析自然语言错误决定归因，不对OpenLogos producer/mixed/unknown错误清slot。
- 不在applying或journal存在时尝试退回collecting。
- 不以abort、新transaction或跳过after严格校验掩盖问题。

### 身份与完成判定

reopen后transaction ID、plan hash、target set不变；旧seal与全部target sealed hash清除。重新seal产生新seal。merge成功仅由可复算completed receipt和匹配`SPEC_MERGED`证明，Git提交只使用receipt `commit_paths`。

### 授权

提案、tasks、Delta或本Skill均不能自授merge/verify/部署/smoke/archive/push权限。执行每个确认点前核对用户明确授权；`--auto`仅在用户真实选择时构成standing授权。
