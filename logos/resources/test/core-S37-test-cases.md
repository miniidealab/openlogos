# core-S37: delta 条目守恒门测试用例

> 场景：S37 delta 条目守恒门（条目级隐式删除拦截）| 来源变更：merge-conservation-archive-audit
> 全部测试代码必须写入 OpenLogos reporter（`logos/resources/verify/test-results.jsonl`，见 `logos/spec/test-results.md`）。

## 一、单元测试（UT，守恒判据纯函数 / 锚解析器 / ID 模式注册表，`cli/src/lib/change-lint.ts`）

| ID | 检查项 | 用例 | 期望 |
|----|--------|------|------|
| UT-S37-01 | 纯 ADDED 通过 | delta 仅含 ADDED 块（新增测试 ID 条目），目标主文档含既有 ID | 违规集合空；不产生任何 L8 violation |
| UT-S37-02 | MODIFIED 全量携带通过 | MODIFIED 块在结构位置（表 ID 首列）含目标章节全部既有 ID + 新增 ID | 通过（结构位置携带全量即守恒） |
| UT-S37-03 | MODIFIED 隐式删单个测试 ID | MODIFIED 块缺主文档既有 `SMOKE-core-03` 表行，无点名 | 恰 1 条 `delta_implicit_id_removal`，violation 含缺失 ID、章节锚、双路径 fix_hint |
| UT-S37-04 | MODIFIED 隐式删多个测试 ID | MODIFIED 块缺 `UT-S12-01`、`ST-S12-02`、`SMOKE-core-07` 三个既有表行 | 逐 ID 各 1 条 violation（3 条），稳定排序 |
| UT-S37-05 | MODIFIED 隐式删场景总览行 | MODIFIED 场景表块缺既有 `S05` 行（场景 ID 类别） | `delta_implicit_id_removal`（SXX 经注册表结构位置识别） |
| UT-S37-06 | MODIFIED 隐式吞节号 | MODIFIED 块吞掉主文档既有 `### 2.7` 节标题（节号类别） | `delta_implicit_id_removal`（节号经标题行识别） |
| UT-S37-07 | 部分删除成对写法通过 | `MODIFIED — <锚>` 携带剩余全量 + `REMOVED-ITEMS — <同锚>` 逐行点名被删 ID | 违规集合空；通过 |
| UT-S37-08 | REMOVED 整节删除通过 | `REMOVED — <唯一锚>` 删除整节（该节含多个既有 ID，未逐个点名） | 通过（整节 REMOVED 的全节 ID 视为随章节显式删除，守恒不再要求点名） |
| UT-S37-09 | 点名拼写不存在 | REMOVED-ITEMS 点名 `UT-S12-99`（锚定章节不存在该 ID） | `delta_removed_unknown_id` |
| UT-S37-10 | 新文件跳过 | 目标主文档不存在（全新文档 delta） | 跳过守恒，零 violation |
| UT-S37-11 | 纯散文 delta 不进 L8 | delta 触及章节无任何注册表结构化 ID | 零 violation（无 ID 条目无守恒义务） |
| UT-S37-12 | fence 内 ID 不算保留 | 主文档章节的既有 ID 仅出现于 delta 的代码围栏内 | 围栏引用不计入保留，仍判 `delta_implicit_id_removal` |
| UT-S37-13 | 散文提及不算保留（F2 反例） | MODIFIED 块删除 `SMOKE-core-03` 表行，但正文写「说明：SMOKE-core-03 已删除，本节不再保留其表格行」 | 散文 token 不构成保留，仍判 `delta_implicit_id_removal` |
| UT-S37-14 | 非 ID 列单元格不算保留（F2 反例） | 被删 ID 字符串仅出现在其他行的「用例」/「期望」描述列单元格中 | 不构成保留，仍判 `delta_implicit_id_removal` |
| UT-S37-15 | 跨章节出现不背书（F2 反例） | A 章节 MODIFIED 块正文含 B 章节被删 ID；B 章节 MODIFIED 块缺该 ID 且无点名 | B 章节仍判 `delta_implicit_id_removal`（逐章节归属对账） |
| UT-S37-16 | 错误章节点名不背书（F2 反例） | REMOVED-ITEMS 锚定 A 章节、点名的 ID 实属 B 章节 | 该点名判 `delta_removed_unknown_id`；B 章节缺失照判 `delta_implicit_id_removal` |
| UT-S37-17 | 点名无物质载体 | 仅有 REMOVED-ITEMS 点名、无同锚 MODIFIED 块 | 按 `delta_implicit_id_removal` 对偶缺陷报出（fix_hint 提示补 MODIFIED 块） |
| UT-S37-18 | 单段锚唯一命中 | 锚标题在目标文档唯一 | 正常对账，零锚违规 |
| UT-S37-19 | 重复标题歧义 fail-closed（F3，真实 smoke 结构夹具） | 按 `core-smoke-test-cases.md` 真实结构造夹具（`### 二、冒烟测试用例补充` 重复 7 次、分属不同父章节），delta 用单段锚 `二、冒烟测试用例补充` | `delta_section_anchor_unresolvable`（ambiguous，诊断列 7 处候选）；不取第一个、不合并 |
| UT-S37-20 | 标题路径锚精确定位（F3） | 同夹具，分别用 `四、… > 二、冒烟测试用例补充` 与 `七、… > 二、冒烟测试用例补充` 路径锚 | 各自唯一定位到对应父章节下的目标节；对第一处与后续各处均可准确定位与对账 |
| UT-S37-21 | 锚不存在 fail-closed | 锚（单段或路径）在目标文档解析到 0 个章节 | `delta_section_anchor_unresolvable`（not-found 诊断） |
| UT-S37-22 | 注册表：测试 ID 识别正反例 | `UT-S37-01` / `ST-S37-02a` / `SMOKE-core-53` 在表 ID 首列识别；`UT-Sxx-*` 通配、`TBD` 占位不识别 | 结构识别 + `parseTestCaseIds` 判形，与兼容基线一致（无第二份正则） |
| UT-S37-23 | 注册表：场景 ID 识别正反例 | `## S37:` 标题、场景表行首列 `S05` 识别；散文中 `S3` / `S999x` 不识别 | 识别正反例全部符合注册表声明 |
| UT-S37-24 | 注册表：节号完整 token 文法（F4） | 标题行 `### 2.2b` / `### 2.2c` / `### 2.5a` / `### 2.7A` / `### 2.29.1` / `### 2.29.2` / `### 2.13.1` / `### 2.19.A` / `### 2.19.B` / `### 2.19.C` / `### 2.20.A` / `### 2.20.B` / `### 2.20.C` / `### 2.20.D` 全部识别且互不坍缩（`2.29.1` ≠ `2.29.2` ≠ `2.29`，`2.2b` ≠ `2.2c`，`2.19.A` ≠ `2.19.B` ≠ `2.19`，`2.20.D` ≠ `2.20`）；版本号 `0.13.21`、散文 `1.5`、标题行外 `§2.7` 引用不入集合 | 识别正反例全部符合注册表声明（文法等价 `N(?:\.N)*(?:[A-Za-z]|\.[A-Za-z])?`） |
| UT-S37-25 | 节号 corpus 回归（F4） | 从当前全部受管规格（feature-specs / cli-experience / requirements / test / smoke）标题生成兼容语料（显式含 `2.19.A`–`2.19.C`、`2.20.A`–`2.20.D` 点分字母段标题） | 语料中全部既有编号标题被识别；逐个删除任一标题（含 `2.19.A`、`2.20.D`）产生守恒违规 |
| UT-S37-26 | violation 结构与排序 | 构造多文件多违规夹具 | 每条 violation 的 `code`/`path`/`fix_hint` 必填；L8 位于 L7 之后，同 path 按源位置出现序 |
| UT-S37-27 | 同源锚：lint 与 merge 一致 | 同一夹具分别经 change-lint L8 与 merge 消费点调用 | 两侧 pass/fail 与结构化细节逐字段一致（同一判据函数、同一锚解析器） |
| UT-S37-28 | 判据纯函数韧性 | 段标记畸形 delta（由 L4 拦截的形态）送入守恒函数 | 不抛未捕获异常；L8 不重复报 L4 已覆盖缺陷 |
| UT-S37-29 | L4 承认 REMOVED-ITEMS | 含合法 `REMOVED-ITEMS` 块（配对 MODIFIED）的 delta 过 L4；仅含 REMOVED-ITEMS 无物质变更块的 delta 判非法 | 与 §2.33.4 约定一致 |
| UT-S37-30 | 映射一致性回归（F5） | 读取 `DELTA_TO_RESOURCE` 常量与 `spec/change-management.md`、change-writer 目录映射表声明 | 三方一致：`spec → 根 spec/`、`skills → 根 skills/`（非 `logos/skills/`）、其余类目 → `logos/resources/**` |
| UT-S37-31 | 零回归：L1–L7 零漂移 | 既有 L1–L7 golden 夹具全量重跑 | 输出逐字节不变（L8 仅新增，不改既有判据） |

## 二、场景测试（ST，走真实 CLI 入口在临时项目运行）

| ID | 检查项 | 用例 | 期望 |
|----|--------|------|------|
| ST-S37-01 | lint 端到端拦截 | 临时项目构造含隐式删除 delta 的活跃提案，运行 `openlogos change-lint` | exit 2；stdout 含 L8 违规（`delta_implicit_id_removal` + fix_hint）；`--format json` 违规入 `data.violations` 且 code 属 26 码闭合枚举 |
| ST-S37-02 | merge 端到端拒绝 | 同提案运行 `openlogos merge <slug>` | 非零退出；不生成 `MERGE_PROMPT.md`；不写任何 marker；stderr 含守恒拒绝文案 |
| ST-S37-03 | 部分删除端到端落地（F1） | 构造「MODIFIED 剩余全量 + REMOVED-ITEMS 同锚点名」成对 delta，跑通 merge 生成 MERGE_PROMPT 后**实际应用合并**（按 merge-executor 协议执行到主文档落盘） | merge 放行；合并后主文档**仅**点名 ID 的条目消失，目标章节仍存在、其余全部条目逐字节保留；事后点数公式对账相符 |
| ST-S37-04 | 歧义锚端到端拒绝（F3） | delta 用单段锚指向重复 7 次的真实 smoke 标题 | lint exit 2 报 `delta_section_anchor_unresolvable`；merge 拒绝；改标题路径锚后放行 |
| ST-S37-05 | 合法提案零漂移 | 对不含守恒违规的既有形态提案（纯 ADDED / 全量 MODIFIED / 整节 REMOVED）跑 lint + merge | 与引入 L8 前行为一致；merge 输出零漂移 |
| ST-S37-06 | 只读性 | `change-lint` 运行前后临时项目全量文件集合与内容哈希不变 | 完全不变（延续 S35 只读红线，L8 不引入写入） |
