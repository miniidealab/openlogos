# Skill: Slice Planner（切片规划）

> 在变更 **merge 之后、implement 之前**，把已合并规格拆成"良构 `[code]` 切片"，写入 `tasks.md` 的 `[code]` section。
> 这是 launched 变更下 `[code]` 切片的**唯一事实源**——切几片、每片做什么，**只在此处用六维打分 + 删后续证伪门决定一次**；下游 `code-implementor` 只逐行消费，不再重复打分、不再自行分批。

## 触发条件

- `openlogos next` 落在 `ready-to-implement` 驻留态 / `plan-slices` 节点（宿主 driver 注入"规划切片"上下文）
- 用户在变更 merge 完成后说"划分切片"、"写 `[code]`"、"规划实现任务"

## 前置依赖（强制，缺一不可）

1. 活跃提案存在且已完成 spec-complete：提案目录有 `SPEC_MERGED`（或 `MERGED`）marker。
   - 含 `[delta]` 提案：该 marker 表示 delta 已真实合入主规格。
   - 无 `[delta]` 的纯代码提案：该 marker 必须由 no-delta `openlogos merge <slug>` 写入，表示本次没有规格 delta 但规格阶段已完成。
2. 规格 delta 已合并进主文档，或 no-delta `SPEC_MERGED` 明确记录本次无需文档 delta。
3. **测试用例已合并、ID 已定**：相关 `logos/resources/test/*-test-cases.md` 或显式复用声明含真实 `UT-Sxx-..` / `ST-Sxx-..` / `SMOKE-*` ID。

> 若以上任一不满足（尤其缺 `SPEC_MERGED` 或测试 ID 未定），说明尚未到切片时机。**禁止用占位 ID 切片**，提示先完成 no-delta merge / merge 或补齐真实测试 ID。这正是本环节挪到 spec-complete 后的根本原因：对**已定稿规格 + 真实测试 ID**切，而非对草案或隐含假设猜。

## 核心职责

唯一交付物：结构化 `slices.json`——一组**过了删后续证伪门**的良构切片，每片含 `slice_id`、`task_text`（写进 `tasks.md` `[code]` 段的条目文本，末尾标注该片覆盖的真实 `UT-Sxx-..` / `ST-Sxx-..`）、`owned_test_ids`、`runner_selectors`、`spec_targets`。

`tasks.md` 的 `## [code]` 段与 `TEST_SLICE_MANIFEST.json` 由 `openlogos slice plan --file <slices.json>` 写出——本 Skill 是切片内容的**生产者**，不是产物的**写入者**（根规范 `spec/test-slice-manifest.md` §2.1、架构 §四十三.1）。**不要手写这两个产物**：`owned_test_ids` 是 verify 计算 eligible 的输入，属流程判断数据，其生成权留在 CLI。

不产 `proposal.md`、不产 `[delta]`、不产 `[deploy]`（那是 `change-writer` 的职责），不写业务代码（那是 `code-implementor` 的职责）。

## 执行步骤

### Step 1: 读已合并规格 + 真实测试 ID

读 `logos/changes/<slug>/proposal.md` 的变更范围，再读已合并进 `logos/resources/` 的架构 / 场景 / 功能规格与 `test/*-test-cases.md`，列出本次要落地的代码能力清单与可用的 `UT/ST` ID 全集。

### Step 2: 六维打分（决定"是否大任务"）

| 维度 | 0 分 | 1 分 | 2 分 |
|---|---|---|---|
| 影响范围 | 1 个文件或局部函数 | 2-5 个相关文件 | 跨模块 / 跨服务 / 跨端 |
| 行为复杂度 | 单一路径 bugfix | 2-3 个分支 | 多场景 / 状态机 / 异步流程 |
| 契约变化 | 无 | CLI/API 输出小改 | API/DB/flow/兼容契约变更 |
| 测试规模 | 1-3 个用例 | 4-8 个用例 | 9+ 个用例或多类测试矩阵 |
| 风险等级 | 易回滚 | 有兼容性风险 | 涉数据、安全、部署、迁移 |
| 不确定性 | 原因明确 | 1 个待验证假设 | 多个未知点 / 需要探索 |

- **0-7 分 = 不是大任务 → 单切片**。即使含代码 + 测试 + reporter + golden，也只写 1 条 `[code]`。
- **8 分及以上 = 大任务 → 进入 Step 3 尝试垂直拆分**。

### Step 3: 垂直/横向判别器（选对切片轴）

只有按**子能力垂直拆分**才算合格；**禁止按工种 / 层 / 文件横切**。给每片起名后看名字落在哪类：

- 🚩 **横向红旗（禁止，命中即推倒重切）**：片名是层 / 文件 / 工种——
  "地基 / 底座 / 读写 / 管道 / 接线 / helper / 工具函数 / config 接入 / schema / 类型 / 数据层（单独）/ UI 展示（单独）/ 写测试 / 补 reporter / 重拍 golden"。
  一组切片若读起来像"**先建底座 → 再写逻辑 → 再补工具 → 最后接 UI**"，就是把**施工顺序当成了切片**，必须重切。
- ✅ **垂直合格**：片名是**一条端到端能力线 / 一个场景 / 一个独立子模块的完整闭环**——数据→逻辑→产出→该片测试 一并落在同一片内。

### Step 4: 删后续证伪门（强制，必须写出逐片结论）

拟好 N 片后，**逐片**自问两题：

- **(a) 删后续能否独立过全量 verify**：把切片 i+1..N 全部删掉、只做切片 i，`openlogos verify`（永远全量回归）能绿吗？
- **(b) 是否端到端可观察**：切片 i 做完是否产生了一条端到端、可观察的能力，而不只是给后续片**铺管道 / 接线**？

任一题答"否" → 切片 i **不自闭环** → **向前合并**进依赖它的那一片，重跑本门。

> ⚠️ 为什么是这道门：切片只 scope `code` 的上下文注入、**不 scope verify**。一个"地基片"（铺好没人用，(b) 否）或"前向依赖片"（逻辑依赖还没落地的后续片，(a) 否）做完跑全量 verify 必然飘红，循环无法出环，会死锁在 `verify-failed`。删后续门就是在切片阶段**提前证伪**这种横切。

**必须把这一轮逐片自问的结论写进 `tasks.md` 的 `[code]` 开头**（哪几片合并、为何合并），作为切片决策的留痕。

### Step 5: 逃生口（大任务但拆不开 → 显式单切）

评分 ≥8 但**任何垂直切法都过不了 Step 4 的删后续门**（典型：能力原子、各部分互相咬死，如"三信号互相依赖的完成判定"）→ **保留 1 条切片**，并在任务里写明"评分达大任务，但 <原因> 不可安全垂直拆分，故单片"。

这是**合规结果，不是偷懒**。不确定两片能否各自闭环时，一律合并（`SKILL.md` 硬规则：不确定时合并）。

### Step 6: 写 `[code]` section

1. **每条 = 一个自闭环切片**：业务代码 + 该片 UT/ST + OpenLogos reporter + 必要 golden baseline，**不依赖同批后续切片**。
2. **有序、无前向依赖**：从上到下串行实现（v1 不建模 DAG）；被依赖的片排前。
3. **标注真实用例 ID**：每条 `task_text` 末尾标注覆盖的 `UT-Sxx-..` / `ST-Sxx-..`，与已合并 `test/*-test-cases.md` 对齐（**此时 ID 已定，不再用占位**）。
4. **禁止按工种拆**：实现代码 / 写测试 / 写 reporter / 更新 golden / 补文档注释，必须合并进同一自闭环切片，不得各自成片。
5. **空 `[code]`**：纯 docs/delta 提案无代码产出时，`[code]` 可为空——切片循环退化为 `tests_green`，不影响。

**Smoke 用例变更的强制闭环**：当本提案新增/修改 `logos/resources/test/smoke/*.md`，切片的 `task_text` 必须列出新增 `SMOKE-*` ID、要求实现/更新 `scripts/smoke-*` runner、写 `smoke-results.jsonl` reporter、接入 `logos.config.json.smoke.command` 或 `scripts/run-smoke.js`，并要求完成后跑 smoke 覆盖预检。

**落盘方式**：把上述切片写成结构化 `slices.json`，执行 `openlogos slice plan --file <slices.json>`（详见「测试—切片 manifest 生产与恢复职责」）；**不要直接编辑 `tasks.md` 的 `[code]` 段**。命令成功后**从磁盘读回 `[code]` 段**向用户展示原文确认落盘。

## 输出规范

- 只产出 `slices.json` 并经 `openlogos slice plan --file <slices.json>` 落盘；该命令只写 `tasks.md` 的 `## [code]` 段与 `TEST_SLICE_MANIFEST.json`，`proposal.md`、`[delta]`、`[deploy]` 与其勾选状态字节恒等。
- 删后续证伪门的逐片结论写在切片的 `task_text` 里或随命令输出向用户展示；`[code]` 段由命令渲染，不手工加工。
- 完成后提醒用户：切片已就绪，可在 `slice-exit` 门确认后进入 implement 切片循环。

## 示例

**单切片（0-7 分，或 ≥8 但原子不可拆）**：

```markdown
## [code] 代码实现
> 删后续自检：评分 10 但三信号（心跳/完成令牌/产物核验）互相咬死，任何横切都过不了全量 verify，故单片。
- [ ] 单切片：实现三信号完成判定握手（terminal 心跳 + 进度令牌读写 + helper/env 注入 + 产物核验 + agent-dead），并同步 UT/ST + reporter（覆盖 UT-S46-01..09、ST-S46-01..03）
```

**多切片（≥8 且能垂直闭环）**：

```markdown
## [code] 代码实现
> 删后续自检：3 片各自删后续可过全量 verify、各有端到端可观察能力，无前向依赖。
- [ ] 切片1：订单数据层与迁移，同步 DAO UT + reporter（覆盖 UT-S01-01..05）
- [ ] 切片2：订单 API handler，同步 API ST + reporter（覆盖 ST-S01-01..03）
- [ ] 切片3：前端订单面板，同步组件 UT/ST + reporter（覆盖 UT-S02-10..18）
```

## 推荐提示词

- `请按 slice-planner 规划本提案的 [code] 切片：先读已合并规格与真实测试 ID，六维打分，再用垂直/横向判别器与删后续证伪门逐片自检（写出结论），拆不开就显式单切。把结果写成结构化 slices.json（slice_id / task_text / owned_test_ids / runner_selectors / spec_targets），执行 openlogos slice plan --file <slices.json> 落盘，并读回 [code] 段确认。`

## 纯代码提案处理规则

当提案无 `[delta]` section 时，slice-planner 不得自行认定 spec/merge 已空过。必须先检查 `SPEC_MERGED`：

- 缺 `SPEC_MERGED`：拒绝切片，提示执行 `openlogos merge <slug>` 生成 no-delta spec-complete marker。
- 有 `SPEC_MERGED` 但缺真实测试 ID：拒绝切片，提示补充或声明复用真实 UT/ST/SMOKE ID。
- 两者均满足：按既有六维打分、垂直/横向判别器与删后续证伪门写 `[code]`。

## 硬性交付门：openlogos change-lint（切片产出完成后强制）

**本节标题保留原名以锚定既有章节；实际交付门已由 `change-lint` 自查改为 `openlogos slice plan` 的写盘前校验。**

> 切片规划的交付门由 **`slice plan` 的前置校验**承担。此前由本 Skill 自行运行 `change-lint` 作为「机器硬门」——但那道门由被检查者自己运行，属自查而非门（架构 §四十三.2）。

**规则（强制）**：

1. `slices.json` 写好后执行 `openlogos slice plan --file <slices.json>`。该命令把**全部校验前置于任一写入之前**：结构合法性（非空数组、`slice_id` 唯一且 kebab-case、`task_text` 非空、三个数组字段非空）与 ID 真实性（`owned_test_ids` 全部存在于已合并测试规格）。
2. **命令成功才可继续**——失败时非零退出并报稳定错误码（`SLICE_PLAN_INPUT_INVALID` / `SLICE_PLAN_DUPLICATE_SLICE_ID` / `SLICE_PLAN_UNKNOWN_TEST_ID` / `SLICE_PLAN_NO_ACTIVE_CHANGE`），`tasks.md` 与 `TEST_SLICE_MANIFEST.json` 字节不变（零副作用）；按诊断逐条修 `slices.json` 后重跑即可，**没有需要清理的中间态**。
3. 常见拒绝原因：切片引用的测试 ID 含占位/通配写法（必须引用 merge 后规格中的**真实** UT/ST/SMOKE ID）；`slice_id` 格式非法；同一 ID 被多片 owned；变更 ID 未被任何切片 owned。
4. 命令成功即两个产物同时落盘并完成指纹自算；**这不等于**通过 slice-exit 门——删后续证伪门的结论仍需向用户交代，用户批准仍按既有流程执行。

不再要求 slice-planner 自行运行 `change-lint` 作为交付前提；该命令仍可作为只读自查随时使用，但它不是门。

## 测试—切片 manifest 生产与恢复职责

### 交付物扩展

slice-planner 是切片内容的**生产者**，不是产物的**写入者**。

spec-complete 后，slice-planner **不直接写** `tasks.md` 的 `[code]` section，也**不自行生成** `TEST_SLICE_MANIFEST.json`。两个产物由 `openlogos slice plan` 在单次调用内先后写出（根规范 `spec/test-slice-manifest.md` §2.1、§2.2，架构 §四十三.1）。

交付路径是**提交结构化输入**：写 `slices.json`，每项固定含——

| 字段 | 内容 |
|---|---|
| `slice_id` | 稳定切片身份，kebab-case，提案内唯一；推荐 `slice-<两位序号>-<规范化短名>` |
| `task_text` | 该片写进 `[code]` 段的条目文本（末尾标注覆盖的真实 UT/ST ID） |
| `owned_test_ids` | 该片独占归属的真实测试 ID；禁止占位、通配与不存在 ID |
| `runner_selectors` | 能让 runner 执行该片 owned tests 的非空 selector |
| `spec_targets` | 该片涉及的已合并规格文件，项目根相对路径 |

命令：

```bash
openlogos slice plan --file <slices.json>
```

**`[code]` 与 manifest 的一致性由命令构造保证，不由本 Skill 的纪律维持。** 校验全部前置于写入：任一字段非法即拒绝并点名 `slices[i].<字段>`，两产物字节不变；校验全过之后才顺序写出，不存在半写态。

`task_fingerprint` 由 OpenLogos 依其**刚写出的** `tasks.md` 计算——**不要在 `slices.json` 中提供任何指纹**，字段不存在，提供了也不会被采信。

**不存在切片事务**：没有 content slot、没有 `submit-content` / `seal` / `apply` / `recover` / `abort` / `reopen`、没有相位与 `allowed_actions`。若看到指向这些命令的旧指引，按本节执行并把该指引视为过期文档；**不要**改写、删除或重命名 `TEST_SLICE_MANIFEST.json` 等 OpenLogos 拥有的产物来「腾位」或「触发恢复」（根规范 §2.3.1）。

### 初次生成模式

1. 完成既有六维评分、垂直/横向判别与删后续证伪门。
2. 从已合并测试规格提取本提案新增或修改的真实 UT/ST/SMOKE ID；禁止占位、通配和不存在 ID。
3. 为每个顶层切片生成稳定 `slice_id`，推荐格式 `slice-<两位序号>-<规范化短名>`；输入不变时重复运行必须逐字节稳定。
4. 每个变更测试 ID 必须恰好出现在一个切片的 `owned_test_ids`；共享基线回归不重复归属。
5. 为每片填写非空 `runner_selectors`，selector 必须能让 runner 执行该片 owned tests，并允许 verify 叠加基线回归。
6. 为每片填写非空 `spec_targets`（项目根相对路径），`spec_fingerprint` 由命令依此计算。
7. 执行 `openlogos slice plan --file <slices.json>`；命令负责临时文件、读回校验与原子 rename。

`slices.json` 最小结构：

```json
{
  "slices": [
    {
      "slice_id": "slice-01-capability",
      "task_text": "端到端能力切片：实现 X 并同步 UT/ST + reporter（覆盖 UT-S01-01、ST-S01-01）",
      "owned_test_ids": ["UT-S01-01", "ST-S01-01"],
      "runner_selectors": ["UT-S01-01", "ST-S01-01"],
      "spec_targets": ["logos/resources/test/core-S01-test-cases.md"]
    }
  ]
}
```

示例中的测试 ID 与路径只说明结构，实际交付必须替换为当前提案真实值。`schema` / `change` / `module` / `task_fingerprint` / `spec_fingerprint` / `generated_at` 由命令写入 manifest，**不在输入中提供**。

### 恢复重建模式

当 OpenLogos 输出 `next_node.id=plan-slices` 且 reason 为 manifest 缺失、已知版本非法或 stale 时：

- **恢复动作就是以相同 `slices.json` 重跑 `openlogos slice plan --file <slices.json>`**——恢复与初次规划是同一个动作，没有恢复事务、恢复相位或 `--recover` 开关。
- **不要重新评分、重新切片或清空任务**：切片划分本身没有问题，问题只在 manifest 失效。沿用旧划分的 `slice_id` 与 `task_text`（旧 manifest 可读时从中读取；完全缺失时由既有 `[code]` 段的规范化顺序与文本确定性重建）。
- **不要手工恢复 checkbox**：`slice plan` 逐 `slice_id` 比对 `task_text`——逐字未变则沿用旧勾选状态，变了则重置为未勾选（根规范 §2.3）。这条保留由写入者构造性完成；以「记得把 `[x]` 补回来」作为兜底违反根规范 §2.2「禁止以纪律替代构造保证」。
- 读取 `SLICE_CHECKPOINTS.jsonl` 仅用于验证身份兼容，禁止改写、删除或伪造 checkpoint；`SLICES_APPROVED` 同样不被 `slice plan` 触碰。
- 重新从已合并规格核对 owned IDs 与 selectors；`spec_fingerprint` / `task_fingerprint` 由命令重算，不手工提供。
- 若一个 ID 无法唯一归属、既有切片文本漂移导致身份无法保持，必须输出歧义并停止，不得猜测。

### 完成屏障与读回

交付前必须从磁盘重新读取 `tasks.md` 与 `TEST_SLICE_MANIFEST.json`，并验证：schema 主版本受支持；change/module 匹配；slice ID/测试 ID 无重复；变更测试集合无遗漏、无未知 ID；每片 selector 非空；manifest 的切片顺序与 `[code]` 顶层顺序一致；恢复重跑时未被改写的切片其勾选状态如实保留。

RunLogos 或其他宿主的 Agent 自报 done 不是完成证据。宿主必须使用 OpenLogos 提供的 validator/状态派生重算上述谓词；失败时按 violation 幂等修复。manifest 可恢复重试预算与代码 repair budget 完全分离。
