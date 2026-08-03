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

### Step 2: 逐个 Delta 文件执行合并

按 MERGE_PROMPT.md 中列出的顺序，逐个处理 delta 文件：

1. **读取 delta 文件**：理解 ADDED / MODIFIED / REMOVED 标记及内容
2. **读取目标主文档**：定位需要修改的章节
3. **执行合并**：
   - `ADDED`：在主文档的指定位置插入新内容
   - `MODIFIED`：替换主文档中同名章节的内容
   - `REMOVED`：从主文档中删除对应章节
4. **输出摘要**：列出对该文件做了哪些修改

### Step 3: 输出总体变更报告

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

commit 成功后，写入规格合并完成标记：

```bash
touch logos/changes/{slug}/SPEC_MERGED
```

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

1. **清点时机**：全部 delta 应用完毕、主文档落盘后，`git commit` 与写 `SPEC_MERGED` **之前**。
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

`.md` 之外的**规格类整文件 delta**（当前两类：`deltas/spec/flow/*.yaml`、`deltas/spec/schema/*.json`）按本节协议合并。该协议是**确定性文本操作**，不依赖模型对内容的理解：

### 1. 标记行格式（首行，强制）

- delta 文件**首行必须**是整文件标记行，格式：`## MODIFIED — <目标相对路径>（整文件替换…）` 或 `## ADDED — <目标相对路径>（新文件…）`。
- `MODIFIED` = 目标文件已存在，整文件替换；`ADDED` = 目标文件不存在，创建（含创建缺失的父目录，如 `spec/schema/`）。
- **首行缺失或格式非法 → 报错停下**（指出 delta 路径与原因），等待用户修复，不得静默整份覆盖、不得把标记行写进目标。

### 2. 确定性合并操作

1. 读取 delta 文件全文，**剥离首行标记行**（仅第一行，无论目标类型；YAML 的 `##` 注释行同样剥离——不依赖「注释恰好合法」的巧合）；
2. 将剩余字节**原样**写入标记行声明的目标路径（`ADDED` 先创建父目录；`MODIFIED` 整文件覆盖）；
3. 不做任何格式化、转义或内容改写。

### 3. 合并后机器校验（强制，纳入合并摘要）

- 目标 `spec/schema/*.json`：文件存在且**可直接 `JSON.parse`**；
- 目标 `spec/flow/*.yaml`：文件存在且可被 YAML 解析器读取；
- 两类目标的**首行均不得含 delta 标记行**（`## MODIFIED` / `## ADDED` 字样出现在 JSON 目标任意位置、或 YAML 目标首行 → 判合并失败，回报并停下）；
- 校验失败时不得继续后续 delta，按「冲突时询问」原则处理。

### 4. 适用边界

- 本协议**仅**适用于 `deltas/spec/flow/*.yaml` 与 `deltas/spec/schema/*.json` 两类规格整文件；`.md` 规格/Skill delta 仍走段标记合并（缺段标记报错，见「段标记收窄」）；`2-page-design/` 资产与 `ui_impact` 原型的既有规则不变（后者仍由 `commitVerifiedPrototypes()` 落盘，merge-executor 不触碰）。
- `MERGE_PROMPT.md` 生成文本（`cli/src/i18n.ts`）须同步声明本协议（剥首行、整文件写入、合并后 parse 校验）——该实现改动归本提案 `[code]` 切片，验收锚 = S16 测试「merge 后 schema 产物可解析且无标记行」。

## 输出规范

- 直接修改 `logos/resources/` 中的主文档（就地编辑）
- 除写入 `logos/changes/<slug>/SPEC_MERGED` 外，不修改 `logos/changes/` 中的任何文件
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
