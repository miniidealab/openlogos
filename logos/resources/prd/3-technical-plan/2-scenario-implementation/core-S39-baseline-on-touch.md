# S39：提案规划时按触达目标形成规格闭包

> Feature：F04 变更提案与切片生命周期  
> 来源：需求文档 S39、功能规格 §2.35、`spec/baseline-closure.md`、提案 `fix-scenario-create-completeness-contract`

## 场景目标

当 launched change 触达某个场景时，change-writer 形成一目标一 Delta 的规格闭包；对缺失的场景目标生成结构完整、可被 change-lint 与 merge 同源验收的文档。语义完整的历史步骤标题能够兼容读取，依赖散文关键词的残缺文档不能误通过。

## 用户价值

用户可以在 plan-exit 批准后一次完成合法 Delta，不会因为 `主流程` 等兼容标题遭到假阴性阻断，也不会让没有真实步骤、时序、异常或追溯内容的骨架进入合并阶段。

## 参与者

- **开发者**：提出变更、确认方案，并在独立人类确认点授权 merge。
- **change-writer**：按已批准闭包计划生成唯一 Delta，并消费 lint 诊断修复。
- **MarkdownAuthorityScanner**：提取围栏与注释之外的权威 Markdown 结构。
- **ClosureEvaluator**：依据共享合同判断 CREATE 最低完整性。
- **change-lint**：在 producer 完成点只读运行结构门。
- **merge**：在生成 apply 指令前纵深重跑相同判据。

## 前置条件

- launched 项目存在活跃 change、有效 guard、已完成澄清的 proposal/tasks 和已消费的 `PLAN_APPROVED`。
- proposal 的 `baseline_closure` 将 S39 scenario 目标声明为 `CREATE`，目标文件在主资源视图中确实不存在。
- API、数据库和 API 编排已依据纯本地 CLI 边界证据标为 SKIP；部署/smoke 已由 C01 用户决定纳入。

## 成功后置条件

- 唯一场景 Delta 通过 change-lint，且其 canonical target 与 proposal/tasks 完全一致。
- 后续获得 merge 授权时，merge 对同一字节得出相同完整性结论；成功 apply 后目标文档不包含 Delta marker。
- 任何无效结构均在写资源前失败，不改变 guard、counter、resource index 或 lifecycle marker。

## 时序图

```mermaid
sequenceDiagram
    participant D as 开发者
    participant W as change-writer
    participant L as change-lint
    participant S as MarkdownAuthorityScanner
    participant E as ClosureEvaluator
    participant M as merge

    D->>W: Step 1: 批准 proposal/tasks 后请求产出 Delta
    W->>W: Step 2: 按 canonical 标题生成完整场景文档
    W->>L: Step 3: 运行当前提案 change-lint
    L->>S: Step 4: 扫描权威标题、列表与 Mermaid 围栏
    S-->>E: Step 5: 返回结构化 Markdown 节点
    E-->>L: Step 6: 返回空问题集或精确完整性缺口
    alt 完整性失败
        L-->>W: Step 7: exit 2 与 violations
        W->>W: Step 8: 只修当前 Delta 并重跑 lint
    else 完整性通过
        L-->>W: Step 7: exit 0 与 pass=true
        W-->>D: Step 8: 报告 Delta 就绪并等待 merge 授权
    end
    D->>M: Step 9: 明确授权后执行 merge
    M->>E: Step 10: 纵深重跑同一完整性判据
    E-->>M: Step 11: 返回一致结论
```

## 步骤说明

1. **开发者**明确批准完整 proposal/tasks，plan-exit 写入 `PLAN_APPROVED`，流程进入 `write-delta`。
2. **change-writer**依据 effective view 生成场景 CREATE Delta；新写入只使用 `## 步骤说明`，并补齐目标、参与者、前后置、时序、异常/边界和追溯。
3. **change-writer**在项目根运行 `openlogos change-lint --slug fix-scenario-create-completeness-contract --format json`，不得以文件存在或自然语言 done 代替机器门。
4. **change-lint**把目标字节交给 **MarkdownAuthorityScanner**；scanner 排除 fenced code 与 HTML 注释后提取标题、章节范围、有序列表和 Mermaid fence。
5. **MarkdownAuthorityScanner**把结构化节点交给 **ClosureEvaluator**，不自行推断业务适用性。
6. **ClosureEvaluator**验证唯一步骤章节、至少 3 个非空有序列表项、有效 sequenceDiagram、至少 2 个参与者和 1 条消息，以及非空异常/边界与追溯。
7. 若存在缺口，**change-lint** 返回 exit 2 和精确 violation；若完整则返回 exit 0 与 `pass=true`。失败路径见 EX-7.1～EX-7.4。
8. **change-writer**对失败只修当前提案内被指向的 Delta 并重跑；全部通过后向开发者报告 Delta 就绪，等待独立 merge 授权。
9. **开发者**在审阅 Delta 后另行明确授权 `openlogos merge`；当前 plan 批准不自动授予 merge。
10. **merge**在生成 `MERGE_PROMPT.md` 或写资源前调用同一个 **ClosureEvaluator**，不复制正则。
11. **ClosureEvaluator**返回与 change-lint 一致的结论；失败时 merge 原子停止，成功时才允许进入 merge-executor apply。

## 异常与边界

### EX-7.1：兼容标题合法但旧正则无法命中

- **触发条件**：步骤章节标题是 `主流程`、`主路径步骤`、`主路径` 或 `正常流程`，且正文含至少 3 个非空有序列表项。
- **期望响应**：按受控别名解析为唯一步骤章节并通过该维度，不要求改写历史标题。
- **副作用**：无；兼容读取不改变目标字节。

### EX-7.2：散文或样例伪造步骤证据

- **触发条件**：没有步骤章节，只在普通散文、fenced code、HTML 注释或样例中出现“步骤”或兼容标题。
- **期望响应**：返回 `create_target_incomplete`，指出步骤章节缺失。
- **副作用**：lint 只读；merge 不生成 `MERGE_PROMPT.md`、不写资源或 marker。

### EX-7.3：章节存在但内容不完整

- **触发条件**：步骤章节重复、少于 3 个有效有序项、存在空列表项，或异常/边界、追溯章节只有标题。
- **期望响应**：一次返回稳定排序的精确缺口与修复提示。
- **副作用**：保留当前 Delta 供同一 producer 幂等修复。

### EX-7.4：伪 Mermaid 或残缺时序

- **触发条件**：`sequenceDiagram` 仅在普通 fence/散文中，或 Mermaid fence 少于 2 个参与者、没有消息箭头。
- **期望响应**：完整性失败，不退回关键词正则，也不把 Mermaid 样例当权威时序。
- **副作用**：无项目状态写入。

### EX-10.1：lint 后结构漂移

- **触发条件**：lint 通过后 Delta 被外部修改，导致 merge 纵深检查失败。
- **期望响应**：merge fail-closed，输出同源 violation；要求修复并重新 lint/审阅。
- **副作用**：guard、counter、resource index、资源文件和 `SPEC_MERGED` 全部保持原值。

## API 与数据库派生结论

- 本场景所有交互均为本地进程内函数调用和文件读取，不出现 HTTP、RPC 或消息边界，因此 API 与 API 编排为 SKIP。
- 本场景不读写数据库或业务持久化实体，因此 DB 为 SKIP；文件系统 lifecycle 写入沿用既有 change/merge 事务规格。

## 非目标与安全边界

- 不在本场景实现 RunLogos 的普通 write-delta lint barrier 或 UI 诊断。
- 不放宽 merge fail-closed，不吞掉非零退出，不允许手工伪造 `MERGE_PROMPT.md`/`SPEC_MERGED`。
- 不授权 npm 公开发布、Git tag、GitHub Release、官网发布或 git push。

## 追溯

- 需求：S39 验收条件 8～12。
- 功能规格：F04 / §2.35.9 场景 CREATE 结构化完整性合同。
- 架构：场景 CREATE 的结构化 Markdown 完整性架构（S39）。
- 方法论规格：`spec/baseline-closure.md`、`spec/change-management.md`。
- 测试：UT-S39-28～UT-S39-32、ST-S39-14～ST-S39-16、SMOKE-core-67～SMOKE-core-69。
- 来源问题：`logos/resources/reference/bug-report-scenario-create-completeness-contract-mismatch.md`。

## 测试变更集原子 Apply 扩展

### 场景目标

当 baseline closure 批次触及正式测试规格时，`merge-apply` 在自身掌握 before/final 字节的唯一安全时点计算语义 changed/removed ID，并与 resources、metadata、`SPEC_MERGED` 全有或全无提交。

### 参与者

- 用户授权的 merge-executor Agent
- `openlogos merge-apply`
- BaselineClosurePlan / strict apply manifest
- TestDefinitionDiff / TestChangeSetReader
- `applyBaselineClosureBatch()`
- 正式测试 resources、metadata 与提案 marker

### 前置条件

- plan/spec L1～L9 全过，P=T=D。
- `MERGE_APPLY_MANIFEST.json` 严格符合 `openlogos/baseline-merge-apply@1`，每个 prepared target 的 source/before/final hash 已校验。
- `SPEC_MERGED` 不存在，guard 与 slug/module 匹配。

### 成功后置条件

- 所有正式目标和 metadata 等于 prepared final bytes。
- `SPEC_MERGED.test_change_set` 符合 `openlogos/test-change-set@1`，C/R 与 before/final 结构化差异一致。
- marker 中 `manifest_sha256` 继续绑定严格 apply manifest；change-set target identity 与 category=test 的 canonical targets 一致。
- 重启后无需 Git 即可读得相同 C/R。

```mermaid
sequenceDiagram
    participant Agent as merge-executor Agent
    participant Apply as openlogos merge-apply
    participant Diff as TestDefinitionDiff
    participant Batch as applyBaselineClosureBatch
    participant Disk as resources + metadata + marker

    Agent->>Apply: strict manifest(final bytes)
    Apply->>Apply: L1-L9 + guard + P=T=D + hashes
    Apply->>Diff: test targets before/current + after/prepared
    Diff->>Diff: authority parse + normalize + global unique map
    alt 解析或 identity 失败
        Diff-->>Apply: fail before write
        Apply-->>Agent: 非零，零正式字节
    else 差异有效
        Diff-->>Apply: canonical C/R/targets/hash
        Apply->>Batch: resources + metadata + SPEC_MERGED(marker last)
        Batch->>Disk: 原子批写
        Batch->>Disk: 返回成功前重读后置条件
        alt 任一写入/fault/复核失败
            Batch->>Disk: 恢复 MODIFY/metadata，删除本批 CREATE/marker
            Batch-->>Agent: rolled_back=true
        else 全部成功
            Batch-->>Agent: spec-complete
        end
    end
```

### 步骤说明

1. 根据 BaselineClosurePlan 确定 category=`test` 的 canonical targets；严格 manifest 本身不增加字段。
2. MODIFY 从当前正式目标读取 before；CREATE 使用空前态；after 使用已校验 `content_base64` 最终字节。
3. 在所有 targets 的 before/after 上建立全局唯一测试记录映射，计算新增、修改、未变与删除。
4. 生成严格字段、ASCII 排序、无时间戳、带 canonical payload hash 的 change set。
5. 构造包含 change set 的完整 `SPEC_MERGED` 字节，并作为批事务最后一个 prepared input。
6. 写入后重读 test targets 与 marker，复核 after hashes、payload hash、change/module、target identity 和 apply-manifest 绑定。
7. 只有后置条件全部成立才报告成功；否则使用事务备份回滚。

### 异常与边界

- 前/后任一侧重复 ID：首写前失败，不采用“最后一行获胜”。
- 非法 UTF-8、表格结构歧义、escaped pipe 解析失败：首写前失败。
- before_sha256 在 Agent 准备 manifest 后漂移：拒绝，不用新磁盘内容静默重算。
- 只触及非 test targets：仍写合法空 C/R 与空 targets，使“无测试变化”和“事实缺失”可区分。
- no-delta merge 不走本批 apply；reader 仅在 marker 类型正确且磁盘确无 mergeable delta 时可信派生空 C/R。
- 事后人为修改正式测试 target 导致 after hash 漂移：后续 reader fail-closed，不从 Delta 重建。
- 不依赖 Git repository、commit、parent、branch、squash 或 rebase 状态。

### 追溯

- 需求：S32/S39 测试变更 ID 语义差异与持久化要求。
- 功能规格：§2.37.1～§2.37.3。
- 架构：§27.3～§27.6。
- 规范：`spec/baseline-closure.md` §18、`spec/test-slice-manifest.md`。
- 测试：UT-S39-33～UT-S39-38、ST-S39-17～ST-S39-19。

## S39 canonical closure 进入单一 merge transaction

### 场景目标

把 baseline-on-touch 的全部物质目标和确定性 metadata 绑定到同一 transaction，避免 Agent manifest、decision/counter/index 专用事务、UI 专用事务和 no-delta marker 各自形成成功身份。

### 参与者

- BaselineClosureEvaluator：输出 P=T=D 的 canonical target 计划；
- MergePlanBuilder：将 closure 变为 transaction targets/producer/validator；
- Agent：只生产需要人类语义合并的 content slots；
- OpenLogos producers：生成 metadata、decision/counter/index、dogfood、test change set 与 marker；
- BaselineClosureBatchApplier：同批提交并恢复。

### 前置条件

- 当前 change 的 `baseline_closure` 合法、无 AMBIGUOUS，P=T=D；
- seed journal 已恢复，正式 resources/index/counter 是全旧或全新一致视图；
- target 的 MODIFY/CREATE 磁盘事实、source hash 与 before hash 已冻结。

### 成功后置条件

- receipt 的 target/metadata summaries 与 proposal closure 一一对应；
- 正式 resources、decision、counter、resource index、dogfood、test change set 与 `SPEC_MERGED` 全有或全无；
- no-delta、UI prototype 和普通 closure 使用相同 transaction/receipt 成功语义。

### 主时序

```mermaid
sequenceDiagram
    participant C as BaselineClosureEvaluator
    participant P as MergePlanBuilder
    participant A as Agent Slots
    participant O as OpenLogos Producers
    participant B as BatchApplier
    C->>P: Step 1: canonical P=T=D targets
    P->>P: Step 2: 计算 plan_hash/transaction/target refs
    P-->>A: Step 3: required semantic content slots
    A-->>P: Step 4: 原子最终字节
    P->>O: Step 5: 生成 metadata/dogfood/test change set/marker
    O-->>P: Step 6: deterministic final bytes
    P->>B: Step 7: sealed resources + metadata batch
    B->>B: Step 8: journal/stage/backup/commit/post-read
    B-->>P: Step 9: completed receipt 或全批回滚
```

### 步骤说明

1. evaluator 先按 canonical merge target path 对账，不以数量或 tasks/delta 反推 proposal。
2. plan builder稳定排序所有 targets，记录 mode、source/before identity、producer 与 validator。
3. 只有需要 Agent 判断合并正文的目标分配 slot；opaque target ref 不赋予正式路径写权限。
4. Agent 使用原始最终字节与原子 rename，不能提交 Base64 或 metadata。
5. OpenLogos 在 seal/apply 安全时点分配 decision DXX、推进 counter/index、同步根 spec/skill dogfood，并从 test before/final 计算 test change set。
6. 确定性 producer 输出纳入 sealed hash 和 receipt，不另建成功 marker。
7. apply inputs 同时包含所有 resources、metadata、prototype/dogfood 与最终 marker。
8. 任一 validator/rename/post-read 失败按 journal 恢复全部目标。
9. completed receipt 精确证明 target 集合、最终 hash 和 marker identity。

### 特殊分支

- `CREATE`：目标不存在事实在 plan 与 apply 前均检查；提交失败删除本批新建文件。
- `MODIFY`：before hash 漂移即 fatal plan drift，不用新字节静默重算。
- `no-delta`：P/T/D 物质集合为空，仍创建零 slot transaction；metadata/marker 由 OpenLogos 生成。
- `UI prototype`：使用同批 target 或绑定 plan hash 的不可变 UI receipt，不能在 transaction 外写正式原型。
- `decision D07`：最终取号、文件名/标题、counter 与 resource index 在同批生产，不能由 Agent猜号后散写。

### 异常与边界

#### EX-MT-39-1：额外或重复 target
- **触发条件**：slot、producer 或 apply batch 含 proposal closure 之外 target，或同 canonical path 重复。
- **期望响应**：seal 前 fatal 拒绝；无正式写入。
- **副作用**：transaction 保留诊断，不自动扩 scope。

#### EX-MT-39-2：metadata producer 失败
- **触发条件**：decision 分配、counter/index、dogfood 或 test change set 无法确定性生成。
- **期望响应**：seal/apply 失败；不得要求 Agent补 metadata bytes。
- **副作用**：全批保持 before。

#### EX-MT-39-3：marker 后置复核失败
- **触发条件**：写入后任一 final hash、counter/index 或 marker/receipt identity 不一致。
- **期望响应**：按 journal 回滚，包括删除本批 CREATE 和 marker；不得报告 completed。
- **副作用**：可重试时沿用同一 transaction journal。

### 追溯

- 规范：`spec/baseline-closure.md`、`spec/change-management.md`。
- 测试：UT-S39-39～UT-S39-50、ST-S39-20～ST-S39-25。

## S39 无环提交闭包补充


### 闭包集合

- `payload_paths = changed_paths ∪ created_paths`。
- `paths(final_hashes) = payload_paths`。
- `protocol_artifact_paths = {change/MERGE_RECEIPT.json, change/SPEC_MERGED}`。
- `paths(artifact_hashes) = protocol_artifact_paths`。
- `commit_paths = payload_paths ∪ protocol_artifact_paths`。
- final_hashes 与 artifact_hashes 路径不重叠，所有集合去重并按项目根相对路径稳定排序。

### Hash 计算顺序

先完成并验证全部 payload，再构造不含自身字段的 canonical receipt payload 与 receipt_sha256；随后写 receipt 和 SPEC_MERGED；最后由 completed projector 计算二者文件 hash。任何阶段不得把某文件 SHA-256 嵌入该文件自身。

### 私有制品

content、Agent staging、同目录临时文件、backup、apply journal 与 MERGE_TRANSACTION 私有状态不进入 commit_paths。completed/aborted 后按各自终态清理；recovery_required 时保留恢复所需制品但不得宣称可提交。

### 失败策略

集合不相等、路径逃逸、重复路径、hash 不匹配或 artifact 缺失均阻断 completed；不能通过扫描 Git 或正式目标补齐缺项。

## S39 Test-change-set Seal Preflight 与目标归因


### 场景目标

将after测试表严格扫描、`test-change-set`和metadata/counter/index等确定性派生物纳入seal-bound preflight，使内容错误在任何apply状态/journal/正式写入前暴露并可按canonical target归因。

### Preflight 数据流

```mermaid
sequenceDiagram
    participant M as MergeTransaction
    participant P as PreflightBuilder
    participant T as TestChangeSetBuilder
    participant D as Metadata/Derived Producers

    M->>P: planned targets + before + candidate finals
    P->>T: category=test before/final pairs
    T->>T: strict UTF-8/table columns/global ID uniqueness
    T-->>P: canonical change set or structured target error
    P->>D: derive metadata/counter/index/dogfood/prototype
    D-->>P: derived paths + before/final hashes or structured error
    P-->>M: canonical view + sha256
```

### Test-change-set 规则

- before继续允许历史重复/歧义候选的单向兼容；after必须严格唯一、列数一致、UTF-8合法。
- `test-change-set-ambiguous-table`、duplicate-id、invalid-utf8等内部错误必须携带canonical `target_paths[]`，不只提供message。
- 单个after test target错误唯一映射到Agent slot时可reopen；多个Agent test targets同时失败可共同reopen。
- duplicate ID跨多个targets且无法安全确定应修哪个slot时不得任意选择；只有结构化错误明确列出全部责任targets且全部可修复时才共同退回，否则fatal。

### 派生目标冻结

metadata/counter/index、test change set hash和最终target paths进入preflight identity。seal/apply间`logos-project.yaml`或任何before漂移必须首写前拒绝，禁止以新metadata重算后继续。receipt/marker字节可含apply时刻`completed_at`，但其确定性payload必须来自sealed view。

### 零写与归因边界

- PreflightBuilder纯只读；不得调用会清理apply staging或恢复journal的写函数。
- legacy sealed apply先检查无journal/receipt/marker/apply artifacts，再运行临时view。
- OpenLogos producer错误、target path无/多映射、mixed fatal时不清任何Agent slot。
- 可归因失败由MergeReopenWriter先原子落盘collecting，再清理rejected私有字节。

### 追溯

UT-S39-56～58与ST-S39-27使用歧义after表、多target duplicate、metadata drift和RunLogos S44 fixture，断言preflight hash、结构化归因、零正式写及同transaction完成。

## S39 SQL delta 的分层校验与适配器路由

### 场景目标

让 non-Markdown SQL delta 的校验按「结构层 + 方言层」分开：结构层始终执行且与方言无关；方言层按本机可用适配器路由，不可用时降级为跳过并留痕，绝不阻断交付。

### 参与者与前置条件

| 别名 | 组件 | 说明 |
|---|---|---|
| C | 消费方 | change-lint L9 / merge / baseline-apply 三处 |
| V | `validateSql` | SQL delta 校验的唯一判定 |
| R | 方言解析 | 从 `tech_stack.database` 解析方言，缺失/冲突/未知 fail-closed |
| A | 适配器 | SQLite：`sqlite3` 二进制；PostgreSQL：libpg_query WASM |

前置：delta 首行 marker 合法、payload 已剥离、canonical target 落在 `logos/resources/database/**` 且扩展名为 `.sql`。

### 主时序

```mermaid
sequenceDiagram
    participant C as 消费方
    participant V as validateSql
    participant R as 方言解析
    participant A as 适配器

    C->>R: Step 1: 从 tech_stack.database 解析方言
    alt 缺失 / 冲突 / 未知方言
        R-->>C: Step 2a: fail-closed（判定不变，非本次范围）
    else 方言明确
        R-->>V: Step 2b: dialect
        V->>V: Step 3: 结构完整度五项（与方言无关，始终执行）
        alt 任一项不满足
            V-->>C: Step 4a: 拒绝并点名缺哪一项
        else 结构全过
            V->>A: Step 5: 按方言查找适配器
            alt 适配器可用
                A-->>V: Step 6a: 执行该层校验（SQLite 隔离执行 / PostgreSQL 语法解析）
                V-->>C: Step 7a: 结论 + 实际执行层级
            else 适配器未实现或未安装
                V-->>C: Step 7b: **通过** + 降级留痕（原因 / 缺失项 / 已执行层级）
            end
        end
    end
```

### 步骤说明

- **Step 3 始终执行**：五项结构检查源码中不引用 `dialect`，本就与方言无关。此前实现亦如此——错误逐级前进正是证据。
- **Step 5 是查找，不是假定**：SQLite 分支此前已经先 `spawnSync` 再判断可用性；非 SQLite 分支此前直接假定不可用并 early return。本次把「先查找」统一到全部方言。
- **Step 7b 是通过而非失败**：适配器未实现（PostgreSQL 之外的方言）与未安装（`sqlite3` 缺失）都走这里。交付照常推进（架构 §四十二.1）。
- **Step 7a/7b 都携带层级**：结论必须自述实际执行到哪一层，消费方据此如实呈现（架构 §四十二.2）。

### 方言路由与强度

| 方言 | 适配器 | 执行层级 |
|---|---|---|
| SQLite | `sqlite3` 二进制 | 隔离执行：`BEGIN` → payload → 表/索引计数 → `ROLLBACK` |
| PostgreSQL | libpg_query WASM | 语法解析（AST），不执行、不连库 |
| MySQL | 无 | 仅结构 + 留痕 |
| 上述任一但适配器不可用 | — | 仅结构 + 留痕 |

**PostgreSQL 得到的是语法级而非执行级**——它不会发现「引用了不存在的表」这类只有执行才能发现的问题。此不对称由 Step 7a 的层级自述如实反映。

### 跨方言冒充禁止

- PostgreSQL / MySQL payload **绝不**进入 sqlite 执行路径；
- 降级是**不执行方言层**，而非改用别的方言执行；
- 不存在「用 SQLite 兜底」这一路径。

既有 `UT-S39-27`（用例名「不冒充通过」）锁的正是此意图，但实现方式是「必须硬失败」。本场景将其改写为正向断言：断言 PG/MySQL payload 未被送入 sqlite 校验器，而非断言它必然失败。

### 不变量

1. **结构层无条件**：五项检查在全部方言、全部适配器可用性下一致生效。
2. **能力缺失只降级**：适配器不可用只能降低层级，不得改变通过与否（架构 §四十二.1）。
3. **层级如实自述**：结论必须携带实际执行层级；不得以结构检查冒充方言校验（架构 §四十二.2）。
4. **不跨方言冒充**：任何 payload 不得送入其它方言的校验器。
5. **三消费方同源**：change-lint、merge、baseline-apply 对同一 payload 与方言得到同一层级结论与同一留痕。

### 异常与边界

- 方言缺失、冲突或未知：维持既有 fail-closed，本次不改——那是提案缺陷而非能力缺失。
- 适配器可用但校验失败（如 PG 语法错误）：正当拒绝，点名错误位置。
- 适配器加载本身抛错：按「未安装」处理，降级并把错误信息计入留痕的缺失项。

### 追溯

- 需求：AC-SQLGATE-01～07。
- 功能规格：§2.52.2～§2.52.6；架构：§四十二.1、§四十二.2。
- 测试：UT-S39-59～UT-S39-64、ST-S39-28；安装态 SMOKE-core-174。
