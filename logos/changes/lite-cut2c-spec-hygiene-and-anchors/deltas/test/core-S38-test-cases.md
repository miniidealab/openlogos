# Delta: core-S38-test-cases.md

> change: lite-cut2c-spec-hygiene-and-anchors
> 目标：`logos/resources/test/core-S38-test-cases.md`

决策记录的隐式删除判据复用 S37 的守恒消费点，随 L8 降级由「merge 拒绝」改为「告警放行」；判据本身与点名精度不变。

## MODIFIED — 二、场景测试（ST，真实 CLI + 完整 apply 端到端）


| ID | 检查项 | 用例 | 期望 |
|----|--------|------|------|
| ST-S38-01 | 决策章节缺 deltas → change-lint warning、exit 不变 | 真实提案：proposal 含决策章节、tasks `[delta]` 无 `deltas/decisions/`，跑 `openlogos change-lint` | stdout 含 `⚠ 决策记录`、结论 `PASS`、exit 0；`--format json` 的 `data.warnings[]` 含 code、`violations` 为空、`pass:true` |
| ST-S38-02 | 补齐后 warning 消失 + 无决策提案 JSON 逐字节旧输出（F4） | ① 补 `deltas/decisions/` 任务后重跑 → 无决策 warning；② 对照跑一个无决策章节的提案 | ①无 warning、PASS、exit 0；②`--format json` **无 `warnings` 字段**、与本能力上线前逐字节一致 |
| ST-S38-03 | 决策记录经**完整 apply** 落盘 + 计数器持久化（delta-r1 F2 / code-r2 F2） | 含 `decisions` delta 的提案：`openlogos merge`（校验+生成 MERGE_PROMPT）**再经生产 apply 入口 `applyDecisionRecords(root, proposalDir)` 执行完整 apply 事务**——该入口自行解析 delta 文件名/标题 DXX、扫描已落盘 DXX、读取并保留现有 YAML、应用 delta 正文、更新 counter/index、最后写 SPEC_MERGED；测试只准备输入并调用、**不自行写出被验证产物** | merge 后 `MERGE_PROMPT` 在场、资源**尚未落盘**、无 `SPEC_MERGED`；**apply 后**：`logos/resources/decisions/core-Dxx-x.md` 落盘（正文来自 delta ADDED 块解析、含状态/背景/决策/理由/备选/影响面/来源）、`decision_counter.next_id` 持久化为 `max(已落盘 DXX)+1`、`resource_index` 走权威 sync 补入内容化 desc、既有 YAML 内容保留、`SPEC_MERGED` 在场；**失败注入**（拟号 D07≠应分配 D01）→ apply 拒绝、不落盘、不动 counter/marker（零半状态）；**重复执行幂等**（无操作、counter 不前移、索引不重复）。**断言不得只跑 `openlogos merge` 或由测试体手工制造落盘结果** |
| ST-S38-04 | 决策记录隐式删除产生告警而非拒绝 | delta 对既有决策记录 MODIFIED 隐式删 `D07` | `openlogos merge` **零退出**并写 `SPEC_MERGED`；输出含守恒告警并点名 `D07`（复用 S37 消费点，§2.73） |
| ST-S38-04a | **决策表首列隐式删除产生告警（code-r1 F1）** | 既有决策记录含首列表头「编号」的决策表（`D07`/`D12`），delta `MODIFIED` 表缺 `D07` 且无点名 | `openlogos merge` **零退出**并写 `SPEC_MERGED`；输出告警并点名 `D07`（表首列 DXX 仍在守恒判据内，真实 CLI 端到端，§2.73） |
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


