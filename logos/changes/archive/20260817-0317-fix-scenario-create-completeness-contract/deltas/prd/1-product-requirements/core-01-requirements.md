## MODIFIED — S39: 提案规划时按触达目标形成规格闭包

- **触发条件**：launched 项目创建 change，change-writer 正在依据提案意图规划 `[delta]` tasks。
- **用户价值**：存量项目无需先建立全局基线；只有真正触达的功能/场景承担补文档成本，并且每个目标只生成一份可合并的最终态 delta。对于新建场景，语义完整的步骤结构不会因同义标题被误拒绝，只有散文关键词的残缺文档也不会误通过。
- **优先级**：P0。
- **主路径**：识别受影响 feature/scenario → 按 Why → What → How 枚举需求、功能、时序、架构、API、DB、UT/ST、API 编排、部署/smoke 等适用目标 → 读取“已合并资源 + 当前 change 已产 delta”的有效视图 → 以规范化合并目标路径去重 → 目标存在规划 `MODIFY`、缺失规划 `CREATE`、不适用记录 `SKIP` → 在现有 plan-exit 批准后产出每个目标唯一 delta → 对 CREATE 场景按 Markdown 权威结构校验完整度。

### S39 验收条件

1. 同一规范化目标路径在 `[delta]` 中恰有一个 task、在 `deltas/` 中至多一个文件；多个场景命中同一路径时聚合，不得拆成“基线 delta + 增量 delta”。
2. `MODIFY` 目标必须存在；既有章节存在时用 `MODIFIED`，章节缺失时可在同一 delta 用 `ADDED`，并遵守 S37 条目守恒。
3. `CREATE` 目标必须缺失；delta 继续使用既有 `ADDED` 标记，但内容必须是可独立成立的完整文档，不新增 merge 操作。
4. 触达场景必须有完整时序图与 UT/ST；存在接口边界时必须从时序图派生 API 并补 API 编排测试；存在持久化时必须补 DB 规格；不适用项记录证据化 `SKIP`。
5. 代码、测试、配置只能证明存量事实；本次 change 提供新增 Why 与验收意图。证据不足时以 `AMBIGUOUS` 停在现有 plan-exit 前，不猜测、不产半成品。
6. adopted 项目的历史自动 `skip_phases` 只豁免 Initial 完整性，不能永久压掉后续 change 中实际适用的 API/DB/场景目标。
7. 不新增 `[baseline]` section、baseline task、gate、marker、JIT advisory、`verified:true` 写回或 `baseline_warnings`；唯一人类方案门仍是既有 `plan-exit`。
8. 新生成的场景统一使用 `## 步骤说明`；读取端兼容 `步骤说明`、`主路径步骤`、`主路径`、`主流程`、`正常流程` 以及既有英文 `main path`，且别名只在围栏与 HTML 注释之外的唯一章节标题处生效。
9. 步骤章节必须包含至少 3 个非空有序列表项；仅在散文、代码围栏、HTML 注释或样例中出现“步骤”不构成通过证据。
10. 时序证据必须来自合法 Mermaid 围栏中的 `sequenceDiagram`，至少包含 2 个参与者和 1 条消息；普通围栏或散文示例中的字符串不构成通过证据。
11. 异常/边界与追溯章节必须存在且包含非空权威正文；空标题、注释或围栏内样例不能满足完整度。
12. change-lint 与 merge 必须复用同一结构化完整性判据；真正缺少步骤结构的 CREATE 场景必须 fail-closed，且失败不生成 `MERGE_PROMPT.md`、不写资源、不改变 guard/counter/index/marker。
