## MODIFIED — deltas/ 目录

增量修改文件，使用标记格式：

```markdown
## ADDED — [新增内容标题]
[新增的完整内容]

## MODIFIED — [修改内容标题]
[修改后的完整内容，替换主文档中同名章节]

## REMOVED — [删除内容标题]
[说明删除原因；删除锚定章节全节，建议同时列出该节 ID 供审计]

## REMOVED-ITEMS — [被删条目所在章节锚]
[纯声明性标记：逐行点名被删 ID（- <ID> — <删除原因>）；merge 不据其执行编辑]
```

**条目守恒契约（S37，merge-conservation-archive-audit）**：

- `MODIFIED` 是**整章节替换**——块内容必须携带该章节**全量**应保留正文；目标章节根标题由章节锚唯一解析后原位保留，正文不得为满足守恒而重复根标题；**不得隐式删除既有条目**。
- **最终章节结构是 retained 的计算对象**：目标侧 existing 从命中的根标题开始抽取；MODIFIED 侧 retained 必须用目标命中的真实 heading level/text 重建同一根标题，再拼接块正文抽取。对于 `## S10 ...`、`## D12：...`、`## 2.3 ...`，控制锚已保留根标题身份，不得误报根 ID 被删除。
- **安全重建边界**：只有锚唯一命中后才可使用目标 `hit.level` / `hit.text`；禁止从 anchor 字符串扫描 ID，因为标题路径父级或散文 token 可能形成保留伪证。锚 0 命中或多命中继续 fail-closed，不构造 retained 根标题。
- **最小豁免**：根标题重建只证明该根标题自身仍在最终文档中。原章节内嵌标题、测试表 ID、场景表行及其表身份仍须逐结构位置保留；真正缺失时照常报 `delta_implicit_id_removal`。
- **带稳定 ID 的条目**（测试 ID `UT-*` / `ST-*` / `SMOKE-*`、场景 ID `SXX`、决策 ID `DXX`、多级节号含字母后缀，由 ID 模式注册表统一定义）的显式删除有两种形态，`REMOVED` 基本语义零改动：
  1. **删整节**：`REMOVED — <唯一章节锚>`，删除锚定章节全节；该节全部既有结构化 ID 视为随章节显式删除。
  2. **删部分条目**：`MODIFIED — <章节锚>`（携带删除后剩余的全量正文）**成对搭配** `REMOVED-ITEMS — <同一章节锚>`（逐行点名被删 ID）。REMOVED-ITEMS 是**纯声明性标记**——物质变更由 MODIFIED 的整节替换完成，merge / merge-executor 不据 REMOVED-ITEMS 执行任何编辑，它只作为守恒判据的点名采信来源与审计记录。
- **章节锚唯一定位（fail-closed）**：段标记标题即章节锚，目标标题在主文档中重复时必须用**标题路径锚**（父级到目标级以 ` > ` 连接）；锚解析到 0 个或 ≥2 个章节一律 fail-closed（`delta_section_anchor_unresolvable`），禁止取第一个命中、合并同名章节或按内容反猜。
- **结构化归属**：守恒计数只认结构位置（标题中的 SXX/DXX/节号、测试表 ID 首列、场景表行首列及表身份）；散文提及、非 ID 列单元格、代码围栏引用不构成「保留」也不构成「点名」；保留与点名必须归属 ID 原所在章节，跨章节引用不背书。
- 机器门：`openlogos change-lint` L8 与 `openlogos merge` 打包调用**同一守恒判据**——逐触及章节对账，既有结构化 ID 凡未在同锚真实最终章节中保留、未被同锚 REMOVED-ITEMS 点名、也未随整节 REMOVED 删除者判 `delta_implicit_id_removal`；点名 ID 不属于锚定章节判 `delta_removed_unknown_id`。lint exit 2 报红、merge 拒绝生成 MERGE_PROMPT（与模板骨架拒绝同级）。目标主文档不存在（全新文档）时跳过守恒。L4 段标记检查承认 `REMOVED-ITEMS` 为合法标记（仅含 REMOVED-ITEMS 而无物质变更块的 delta 仍非法）。
- merge-executor 合并落盘后须做**事后点数**自检：合并后主文档实际结构化 ID 集合 == 合并前 − REMOVED 整节 ID − REMOVED-ITEMS 点名 + 新增；不符即报告并暂停、**不写 `SPEC_MERGED`**（见 `skills/merge-executor/SKILL.md`）。
- 残差：无稳定 ID 的散文内容不在机器门内，其「不得隐式删除」为写作契约；散文所在章节的整体消失仍被章节级 ID 守恒抓住。

Delta 文件的目录结构映射主文档目录：
- `deltas/prd/` → 对应 `logos/resources/prd/` 的变更
- `deltas/api/` → 对应 `logos/resources/api/` 的变更
- `deltas/database/` → 对应 `logos/resources/database/` 的变更
- `deltas/scenario/` → 对应 `logos/resources/scenario/` 的变更
- `deltas/test/` → 对应 `logos/resources/test/` 的变更
- `deltas/spec/` → 对应项目根目录 `spec/` 的方法论规范变更
- `deltas/skills/` → 对应**项目根目录 `skills/`** 的 Skill 文档变更（权威目标）；`logos/skills/` 是 merge 后由既有同步机制从根 `skills/` 再生成的 dogfood 副本，**不得作为该类 delta 的直接合并目标**

部署方案 delta 使用 `deltas/prd/3-technical-plan/3-deployment/`，合并目标为 `logos/resources/prd/3-technical-plan/3-deployment/`。

`openlogos merge` 会递归扫描上述目录，保留子目录映射。例如 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` 会合并到 `logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`。

## MODIFIED — merge 消费点守恒拒绝（S37，merge-conservation-archive-audit）

- `openlogos merge` 在生成 `MERGE_PROMPT.md` **之前**打包调用与 change-lint L8 **同一守恒判据函数**（单一事实源，严禁第二份判据）：任一 delta 存在 `delta_implicit_id_removal` / `delta_removed_unknown_id` / `delta_section_anchor_unresolvable` 违规 → **非零退出、不生成 `MERGE_PROMPT.md`、不写任何 marker**，与模板骨架拒绝同级。
- 对唯一命中的 MODIFIED 锚，判据必须先用目标命中的 heading level/text 重建最终根标题再对账。根标题 ID 已由控制锚保留，不要求在正文中重复，不要求用 REMOVED-ITEMS 虚构删除；路径锚父级中的 ID 不参与 retained。
- 修复真实缺失项时，把 ID 补回同锚 MODIFIED 块的原结构位置，或补充锚定该章节的 `REMOVED-ITEMS` 点名行；锚歧义改用标题路径锚（` > ` 连接父级）。不得通过重复 `### S10`、直接扫描 anchor token、错误点名根 ID 或关闭 L8 绕过。
- merge-executor 侧的事后点数要求：合并落盘后按结构化口径清点，主文档实际 ID 集合 == 合并前 − REMOVED 整节 ID − REMOVED-ITEMS 点名 + 新增，不符即报告并暂停、不写 `SPEC_MERGED`（AI 行为规范，详见 `skills/merge-executor/SKILL.md`）。
- 零回归：合法根标题 ID Delta、纯 ADDED、全量 MODIFIED、整节 REMOVED、MODIFIED+REMOVED-ITEMS 成对形态均按既有操作语义消费；内嵌 ID 真删除、锚不可解析与表身份漂移仍 fail-closed。违规码、JSON envelope、稳定排序与 `ADDED / MODIFIED / REMOVED / REMOVED-ITEMS` 基本语义不变。
