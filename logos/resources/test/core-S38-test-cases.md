# core-S38: 决策记录沉淀能力测试用例

> 场景：S38 决策记录沉淀能力（决策理由入 resources）| 来源变更：decision-record-capability（社区 RFC issue #12 补充观察）
> 全部测试代码必须写入 OpenLogos reporter（`logos/resources/verify/test-results.jsonl`，见 `logos/spec/test-results.md`）。

## 一、单元测试（UT）

### 1.1 change-lint 决策 warning + JSON 契约（`cli/src/lib/change-lint.ts`、`cli/src/commands/change-lint.ts`）

| ID | 检查项 | 用例 | 期望 |
|----|--------|------|------|
| UT-S38-01 | 决策章节在场 + deltas/decisions 在场 → 无 warning | proposal 含「已确定的设计决策」章节，tasks `[delta]` 含 `deltas/decisions/core-Dxx-x.md` 任务 | 无 `decision_record_section_without_delta` warning；`pass:true` |
| UT-S38-02 | 决策章节在场 + 缺 deltas/decisions → warning | proposal 含决策章节，tasks `[delta]` 无任何 `deltas/decisions/` 任务 | 恰 1 条 warning（code `decision_record_section_without_delta`，含 fix_hint）；`pass` 仍 `true`、exit code 不变 |
| UT-S38-03 | 无决策章节 → 零 warning + JSON 逐字节不变（零回归，F4） | proposal 无「已确定的设计决策」章节 | 不产该 warning；`--format json` **不含 `warnings` 字段**（仅非空时出现，否则省略）；输出与本能力上线前逐字节一致 |
| UT-S38-04 | warning 走独立通道、不进 violations 枚举（F4） | 同 UT-S38-02 的 JSON | `data.warnings[]` 含该 item（闭合字段 code/message/fix_hint）；`violations` 数组不含该 code；`ChangeLintViolationCode` 闭合枚举不变；`pass:true` |
| UT-S38-05 | warning + violation 并存 envelope（F4） | 提案既有 L8 violation 又缺 `deltas/decisions/` | `violations[]` 含 L8 码（`pass:false`、exit 2）与 `warnings[]` 决策项**并存**；两数组各自稳定排序、互不混入（按 §3.15 契约） |
| UT-S38-06 | 多条 warning 稳定排序（F4） | 构造多条 warning（如未来多 code） | `warnings[]` 按 §3.15 定义的稳定键排序，重复运行逐字节一致 |
| UT-S38-02a | **[code] 段路径提及不抑制 warning（code-r1 F3）** | 决策章节在场；`[delta]` 段只规划测试文件，`deltas/decisions/` 仅出现在 `[code]` 段说明文字 | 恰 1 条 warning（扫描收敛到 `[delta]` 段正文，`[code]`/说明文字不冒充权威任务） |
| UT-S38-02b | **[delta] 段内非任务项提及不抑制 warning（code-r2 F3）** | 决策章节在场；`deltas/decisions/` 分别以①普通说明②HTML 注释③围栏示例（形如 `- [ ] …deltas/decisions/…`）出现在 `[delta]` 段内，均非结构化任务项 | 三组各恰 1 条 warning（仅采信 `extractTaskSectionItems` 抽出的 `- [ ]`/`- [x]` 项且先 fence/注释掩码；说明/注释/围栏示例不冒充权威任务） |
| UT-S38-03a | **围栏内决策示例不误触发 warning（code-r1 F3）** | `## 已确定的设计决策` 只出现在 Markdown 围栏示例内（对照：围栏外真实标题仍触发） | 围栏内示例 → 零 warning（fence-aware 标题判定）；围栏外真实章节 → 照常 1 条 warning |

### 1.2 DXX 守恒（复用 S37 判据，`ID_PATTERN_REGISTRY`）

| ID | 检查项 | 用例 | 期望 |
|----|--------|------|------|
| UT-S38-07 | DXX 入注册表被识别 | 决策记录主文档含 `D07` 结构位置条目，delta MODIFIED 缺 `D07` 且无点名 | `delta_implicit_id_removal`（DXX 经 `ID_PATTERN_REGISTRY` 结构位置识别，复用 S37 判据） |
| UT-S38-08 | DXX 全量携带通过 | MODIFIED 携决策记录既有全部 `DXX` + 新增 | 守恒通过、零 violation |
| UT-S38-09 | superseded 流转不触发守恒 | MODIFIED 携整条决策剩余全量、仅把「状态」由 `accepted` 改为 `superseded by D12`，`D07` 在场 | 守恒通过（DXX 保留）；无 `delta_implicit_id_removal` / `delta_removed_unknown_id` |
| UT-S38-10 | 决策记录显式删除（REMOVED-ITEMS） | 删整条 `D07`：`MODIFIED` 携剩余全量 + `REMOVED-ITEMS` 点名 `- D07 — 被 D12 取代` | 守恒通过（显式删除合法） |
| UT-S38-07a | **决策表首列结构位置入守恒（code-r1 F1）** | 首列表头「编号」的决策索引表含 `D07`/`D12`，`MODIFIED` 表缺 `D07` 且无点名（对照：携全部行 / `REMOVED-ITEMS` 点名 `D07`） | `delta_implicit_id_removal`（表首列 DXX 经 `decisionTableHeader`+`decisionRow` 进 flat，非旁路）；携全部行与显式点名两对照均守恒通过 |

### 1.3 DXX 分配公式与计数器（delta-r1 F5 反例，`cli/src/lib/project-yaml.ts` 读取 + merge-executor apply 语义）

| ID | 检查项 | 用例（反例） | 期望 |
|----|--------|------|------|
| UT-S38-11 | 基准先扫已落盘最大 DXX | `decision_counter` **缺失**但 `resources/decisions/` 已有 `core-D03` | `base=max(1, 3+1)=4`，`expected_0=D04`，**不**从 D01 起（证伪 stale/missing counter 重复分配） |
| UT-S38-12 | stale counter（落后于实际） | `next_id=2` 但已落盘 `core-D05` | `base=max(2, 5+1)=6`，`expected_0=D06`，不产 D02（证伪错号） |
| UT-S38-13 | 拟定 DXX 与既有资源重复 → 拒绝 | 待落盘 `core-D03`，而 `resources/decisions/core-D03-*` 已存在 | 阻断（重复），要求改号；不覆盖既有 |
| UT-S38-14 | 一案内多条决策连续分配 | 本提案 `deltas/decisions/` 含 2 条待落盘、`next_id=7`、无更大已落盘 | `base=7`；候选按稳定序 `expected_0=D07`、`expected_1=D08`；持久化 `next_id=base+2=9`；两条不同号（**基准不含本批**，否则会从 D09/D10 起算，与本期望矛盾） |
| UT-S38-15 | 文件名 DXX ≠ 标题 DXX ≠ `expected_i` → 拒绝 | 文件名 `core-D07`，标题写 `D09`，`base=7` 算得 `expected_0=D07` | 阻断（三者须一致），要求改正 |
| UT-S38-16 | 正例：拟定号 == expected | `next_id=7`、无更大已落盘、拟定 `D07` | `base=7`、`expected_0=D07`，通过，落盘 `D07`，持久化 `next_id=base+1=8` |
| UT-S38-16a | **首条合法记录不被自拒（delta-r2 F5 精确反例）** | 资源目录空、`next_id=1`（或缺失）、本提案单条拟号 `core-D01` | `base=max(1, 0+1)=1`、`expected_0=D01`，**文件名 D01 == expected D01 → 通过落盘**，`next_id=2`。**证伪『基准含本批 → max(1,1+1)=D02 → D01≠D02 自拒』的旧公式**（该反例专为 delta-r2 F5 设） |
| UT-S38-17 | project-yaml 只读取侧解析 decision_counter | `logos-project.yaml` 含 / 缺 `decision_counter` | 解析出 `next_id`（或视未配置）；`project-yaml.ts` **不含**取号 / 写 helper（比照 `scenario_counter`/`feature_counter`，回归锚定不新增第二套计数逻辑） |

### 1.4 resource_index 扫描器扩展（delta-r1 F3，`cli/src/lib/sync-resource-index.ts`）

| ID | 检查项 | 用例 | 期望 |
|----|--------|------|------|
| UT-S38-18 | scanCandidateFiles 纳入 decisions/ | `logos/resources/decisions/core-D01-x.md` 存在 | `scanCandidateFiles()` 返回集合含该文件（扩展前不含，回归证伪） |
| UT-S38-19 | inferResourceDesc 对 DXX 生成内容化 desc | `core-D01-decision-record-capability.md` | `inferResourceDesc()` 命中 `D\d+` 规则、产出决策记录内容化描述（非空、非通用兜底） |

## 二、场景测试（ST，真实 CLI + 完整 apply 端到端）

| ID | 检查项 | 用例 | 期望 |
|----|--------|------|------|
| ST-S38-01 | 决策章节缺 deltas → change-lint warning、exit 不变 | 真实提案：proposal 含决策章节、tasks `[delta]` 无 `deltas/decisions/`，跑 `openlogos change-lint` | stdout 含 `⚠ 决策记录`、结论 `PASS`、exit 0；`--format json` 的 `data.warnings[]` 含 code、`violations` 为空、`pass:true` |
| ST-S38-02 | 补齐后 warning 消失 + 无决策提案 JSON 逐字节旧输出（F4） | ① 补 `deltas/decisions/` 任务后重跑 → 无决策 warning；② 对照跑一个无决策章节的提案 | ①无 warning、PASS、exit 0；②`--format json` **无 `warnings` 字段**、与本能力上线前逐字节一致 |
| ST-S38-03 | 决策记录经**完整 apply** 落盘 + 计数器持久化（delta-r1 F2 / code-r2 F2） | 含 `decisions` delta 的提案：`openlogos merge`（校验+生成 MERGE_PROMPT）**再经生产 apply 入口 `applyDecisionRecords(root, proposalDir)` 执行完整 apply 事务**——该入口自行解析 delta 文件名/标题 DXX、扫描已落盘 DXX、读取并保留现有 YAML、应用 delta 正文、更新 counter/index、最后写 SPEC_MERGED；测试只准备输入并调用、**不自行写出被验证产物** | merge 后 `MERGE_PROMPT` 在场、资源**尚未落盘**、无 `SPEC_MERGED`；**apply 后**：`logos/resources/decisions/core-Dxx-x.md` 落盘（正文来自 delta ADDED 块解析、含状态/背景/决策/理由/备选/影响面/来源）、`decision_counter.next_id` 持久化为 `max(已落盘 DXX)+1`、`resource_index` 走权威 sync 补入内容化 desc、既有 YAML 内容保留、`SPEC_MERGED` 在场；**失败注入**（拟号 D07≠应分配 D01）→ apply 拒绝、不落盘、不动 counter/marker（零半状态）；**重复执行幂等**（无操作、counter 不前移、索引不重复）。**断言不得只跑 `openlogos merge` 或由测试体手工制造落盘结果** |
| ST-S38-04 | 决策记录隐式删除被 merge 拒绝 | delta 对既有决策记录 MODIFIED 隐式删 `D07` | `openlogos merge` 拒绝生成 MERGE_PROMPT（复用 S37 消费点），非零退出 |
| ST-S38-04a | **决策表首列隐式删除被 merge 拒绝（code-r1 F1）** | 既有决策记录含首列表头「编号」的决策表（`D07`/`D12`），delta `MODIFIED` 表缺 `D07` 且无点名 | `openlogos merge` 非零退出、不生成 MERGE_PROMPT（表首列 DXX 已进守恒门，真实 CLI 端到端） |
| ST-S38-08 | **围栏内决策示例 + [code] 提及无 warning 误报（code-r1 F3）** | proposal 决策章节只在围栏示例内、`deltas/decisions/` 仅在 `[code]` 段，跑 `openlogos change-lint` | `--format json` **无 `warnings` 字段**（fence-aware + `[delta]` 段收敛，双重防误报） |
| ST-S38-09 | **真实决策章节 + 仅 [code] 提及 → warning 仍在（code-r1 F3）** | proposal 含围栏外真实决策章节、`[delta]` 段无 `deltas/decisions/`、仅 `[code]` 段提及，跑 `openlogos change-lint` | `warnings[]` 含 `decision_record_section_without_delta`、`pass:true`、exit 0（`[code]` 提及不抑制权威任务缺失） |
| ST-S38-10 | **superseded MODIFIED 保号就地更新 + 同批 ADDED 一并落盘（code-r3 F2 / 场景 §三 B6）** | 既有 `core-D07-old.md`=accepted；一批含 MODIFIED（D07 携整条剩余全量、改状态 `superseded by D08`）+ ADDED（新增 D08），调 `applyDecisionRecords` | D07 就地更新为 superseded（**保号 D07、不静默跳过**、旧状态不残留）、D08 取号落盘；`decision_counter.next_id` 推进为 `base+ADDED 数`；`SPEC_MERGED` 在场 |
| ST-S38-11 | **apply 事务中途失败回滚零半状态 + 复权重试完整成功（code-r3 F2 失败回滚 + 重试幂等）** | ADDED 提案；把 `logos-project.yaml` 置只读，使写主文档后 `syncResourceIndex` 抛 `EACCES`；复权后重试 | 首次：`ok:false`、**主文档未残留、counter/marker 均不存在**（回滚，非「文档已落盘而 counter/marker 缺失」的半状态）；复权重试：完整落盘 + counter 持久化 + `SPEC_MERGED`（不按文件名跳过） |
| ST-S38-12 | **显式 ADDED 同名既有决策（内容不同）→ 冲突拒绝、不覆盖、零改动（code-r4 F2 / 对齐 UT-S38-13）** | 既有 `core-D03-old.md`（内容 A）+ stale `next_id=3`；显式 ADDED 同名 `core-D03-old.md`（内容 B ≠ A） | `ok:false`（同名既有决策冲突，**内容摘要判身份不误当半成品**）；既有正文 / YAML / counter / `resource_index` / marker **全部不变**（`base` 应含已落盘 D03 → 重复即拒） |
| ST-S38-13 | **空 `decision_counter:` 块 + 合法 ADDED → 成功后补齐 `next_id`（code-r4 F2 持久化后置条件）** | `decision_counter:` 块存在但无 `next_id` 字段；合法 ADDED `core-D01` | 成功后磁盘 YAML **必须含 `decision_counter.next_id=2`**（空块补字段、非静默原样写回）；写 `SPEC_MERGED` 前后置条件校验 counter 已持久化，否则回滚不写 marker |
| ST-S38-14 | **同名【同内容】既有决策 + 无 journal → ADDED 冲突拒绝、零改动（code-r5 F2：内容相等不证事务身份）** | 既有 `core-D03-same.md`（正文恰与 delta 正文相同）+ stale `next_id=3`、无本次事务 journal；显式 ADDED 同名 | `ok:false`（无 journal 佐证其为崩溃残留 → 按既有资源冲突拒绝，**内容相等不足以证明其由本次失败事务创建**）；既有正文 / YAML / counter / 索引 / marker 全部不变、不落 journal |
| ST-S38-15 | **marker 前崩溃可重试幂等收敛（code-r5 F2 持久 journal 前滚）** | 构造「`counter` 已前移=2、正文/索引在场、`SPEC_MERGED` 缺失、`DECISION_APPLY_JOURNAL.json` 在场」的中断磁盘态，重试 | 据 journal **前滚补 marker**、以**原 `D01` / `next_id=2`** 完成（**不据已前移 counter 重算成 `D02` 自拒**）；提交后清 journal；`next_id` 保持 2 |
| ST-S38-05 | 无决策章节提案零回归 | 不含决策章节的既有提案全流程（change-lint / merge / apply / archive） | 各命令输出与本能力上线前逐字节一致（无决策 warning、无 `warnings` 字段、无 decisions/ 落盘） |
| ST-S38-06 | resource_index 真实扫描发现决策 + archive 删除后自足（delta-r1 F3） | 从 `resource_index` **无该项**的真实 YAML 起，apply 落盘 `core-D01`，跑**权威 `openlogos index` / sync 路径**；随后删除 `logos/changes/archive/` 整目录 | index/sync 后 `resource_index` 新增该路径 + 内容化 desc、**重复运行幂等**；删 archive 后 `resources/decisions/core-D01-x.md` 与其 `resource_index` 项仍完整可检索（不得靠夹具手工预置索引假绿） |
| ST-S38-07 | 类别注册（delta-r1 F1）| 注册 `decisions` 类别后，含 `deltas/decisions/core-D01-x.md` 的提案跑 `openlogos change-lint` | 该 delta 判为 mergeable、exit 0；`openlogos merge` 生成含 `deltas/decisions/ → resources/decisions/` 目标映射的 prompt（证明类别注册解自举死锁） |
