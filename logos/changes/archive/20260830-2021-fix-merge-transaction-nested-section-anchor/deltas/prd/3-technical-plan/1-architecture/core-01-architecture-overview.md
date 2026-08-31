## ADDED — 三十七、Merge Transaction Section Anchor Authority 架构

### 37.1 Authority Registry 实例

```yaml
- fact_id: delta.section-anchor-resolution
  semantic_scope: 给定冻结 Markdown Delta 与 before/final 字节，哪个物质 block 命中哪个真实章节，以及该操作是否可被 seal/apply
  authority_owner: MarkdownSectionAuthority
  canonical_state: fence-aware Delta blocks、before/final heading tree 与唯一 ResolvedSectionAnchor(level,text,path,start,end)
  sole_writer: MergeTransactionService 的受控 seal/apply writer
  mutation_entry: submit-content 原始 slot 入库；seal preflight 与 apply 首写前重验
  decision_api: parseDeltaBlocks、resolveSectionAnchor、verifyAgentMaterialOutcome、composeOpenLogosMarkdown
  projections:
    - id: change-lint-conservation-result
      consumer: ChangeLintCommand 与 MergeCommand precheck
      freshness_proof: Delta source SHA-256 + before SHA-256 + resolver result identity
      rebuild_rule: 从冻结 Delta 与 before 字节重跑共享 parser/resolver/evaluator
      writable: false
    - id: merge-preflight-target-final
      consumer: MergeSealWriter 与 MergeApplyWriter
      freshness_proof: transaction/plan/target-set identity + source/before/content/final SHA-256 + preflight SHA-256
      rebuild_rule: OpenLogos target 由 Delta/before 确定性合成；Agent target 从冻结 slot/hash恢复后重验 before/final
      writable: false
    - id: completed-target-section
      consumer: 正式 resources/spec/skills 读取者
      freshness_proof: completed receipt + final_hashes + artifact_hashes + seal/preflight identity
      rebuild_rule: 从 completed transaction receipt 与正式 target hash 校验；不从 marker/mtime 反向重算
      writable: false
  recovery_source: MERGE_TRANSACTION.json、冻结 Delta/before/slot hash、preflight/seal identity、apply journal 与 completed receipt
  forbidden_shadow_sources:
    - merge-transaction.ts 非 fence-aware parseDeltaSections 正则
    - validateAgentSemantics 整条路径扁平 heading 正则
    - applyMarkdownDelta 精确 H2 匹配器
    - 按叶标题首命中、mtime、文件存在性或 marker 反向裁决
  cutover_exit: UT-S09-271～274、ST-S09-106～107、UT-S37-37～40、ST-S37-09～10 与 SMOKE-core-168 全部通过，且 RunLogos 原 transaction completed
```

同一 `fact_id` 只有本行；S37 ConservationEvaluator 是该 authority 的守恒消费者，不再私有拥有标题解析器。Registry 的 owner 表达语义组件，sole writer 表达正式状态写入组件，二者不得复制为多个 owner/writer 字段或共同裁决者。

### 37.2 组件边界

```text
MarkdownSectionAuthority
  ├─ FenceAwareDeltaBlockParser       解析控制块与 REMOVED-ITEMS 声明
  ├─ FenceAwareHeadingTreeParser      解析真实 ATX heading tree
  ├─ SectionAnchorResolver            返回唯一 level/text/path/range
  ├─ AgentMaterialOutcomeVerifier     验证 before/final 的物质操作后置条件
  └─ OpenLogosMarkdownComposer        从 Delta + before 合成 candidate

ChangeLint ConservationEvaluator ──read──> MarkdownSectionAuthority
MergeTransaction PreflightBuilder ──read──> MarkdownSectionAuthority
MergeTransaction Apply Recheck    ──read──> MarkdownSectionAuthority
MergeSealWriter / ApplyWriter      ──write─> Transaction / canonical targets
```

- 共享模块预期落在独立 `cli/src/lib/markdown-section-authority.ts`（最终文件名可在实现阶段按现有模块约定调整），不得继续由 `change-lint.ts` 私有导出实现细节。
- `change-lint.ts` 保留 ID 注册表、existing/retained 对账与 violation 组装，只消费共享 block/hit。
- `merge-transaction.ts` 保留 transaction 状态机、hash、preflight、归因、reopen、journal 与 batch writer，只消费 verifier/composer 结果。
- `submitMergeContent()` 不调用 resolver；它只在 transaction writer 边界持久化安全原始字节与 `content_sha256`。

### 37.3 共享解析与身份算法

1. 单次扫描 Markdown，跟踪反引号/波浪线代码围栏，只在围栏外识别 Delta 控制行与 ATX heading。
2. block parser 按源序返回物质块和声明块；物质块 anchor 为空、同 anchor 多 writer 或无物质块时结构化失败。
3. heading parser 按 level 维护祖先栈，记录规范化 text、原始行、byte/character range 与父路径。
4. 单段 anchor 在所有 heading 中精确匹配 text；路径 anchor 逐段匹配完整祖先链。候选数不等于 1 时返回 not-found/ambiguous，不允许内容相似度或首命中 fallback。
5. 唯一 hit 的章节终点是下一 `level <= hit.level` 的围栏外 heading 起点或 EOF；命中 identity 至少绑定 `level/text/path/start/end`。
6. change-lint、Agent verifier 与 composer 必须直接消费同一个不可变解析结果；消费者不得重新用 regex 解释 anchor。

### 37.4 两类 producer 的物化合同

#### Agent producer

Agent slot 是最终 target bytes，不由 OpenLogos 替 Agent 重写。seal/apply verifier 以冻结 Delta 与 before/final 的共享解析结果证明：ADDED 形成唯一新节，MODIFIED 的真实叶标题与父路径身份守恒且完整正文落在该节，REMOVED 的原路径消失。失败产生带唯一 `target_paths[]` 的内部 error fact，只有可归因 Agent target 才允许局部 reopen。

#### OpenLogos producer

OpenLogos composer 对 MODIFIED/REMOVED 使用 before hit 的 `[start,end)`；MODIFIED 根标题从真实原始 heading 保留并拼接 block body，REMOVED 删除完整范围。ADDED 沿用既有追加语义。candidate 完成后必须重跑共享 resolver/verifier；未触及范围不得因全局 trim、错误 H2 边界或路径字面化被改写。

`REMOVED-ITEMS` 不进入 composer。它只供 ConservationEvaluator 解释显式条目删除，确保物质写入与审计声明仍是单一职责。

### 37.5 Seal、Reopen 与 Apply 时序

```mermaid
sequenceDiagram
    participant C as Consumer
    participant T as MergeTransactionService
    participant A as MarkdownSectionAuthority
    participant S as TransactionStore
    participant W as AtomicApplyWriter

    C->>T: submit-content(raw final bytes)
    T->>S: write slot bytes + content_sha256
    C->>T: seal(transaction)
    T->>A: parse/resolve/verify(delta,before,final)
    alt 唯一嵌套锚且物质结果合法
        A-->>T: immutable result identity
        T->>S: atomic sealed + preflight_sha256
        C->>T: apply(transaction)
        T->>A: re-evaluate frozen inputs
        A-->>T: same identity
        T->>W: commit prepared bytes
        W-->>T: receipt + hashes
    else 可唯一归因 Agent 内容错误
        A-->>T: target-scoped retryable error
        T->>S: atomic collecting; rejected content hash null
        T-->>C: submit_content same transaction
    else OpenLogos/mixed/identity 漂移
        A-->>T: fatal error
        T-->>C: fail closed; no slot cleared/no official write
    end
```

apply 必须比较重算 result/preflight 与 sealed identity；不一致时在 `phase=applying` 和 journal 之前失败。reopen 继续遵守“先 transaction 原子状态、后私有字节清理”，且只允许首写前执行。

### 37.6 Cutover、回滚与证伪

1. 冻结当前 parser/resolver golden、RunLogos transaction identity、其它 6 个 slot hash 与本机全局 `0.14.3` 制品。
2. 停止 transaction 私有 `parseDeltaSections`、扁平路径正则和精确 H2 matcher；旧函数不得由 feature flag、catch fallback 或 legacy 分支继续可达。
3. 启用共享 authority，并从同一输入重建 change-lint、preflight 与 composer 投影。
4. 运行 fence 伪 marker、重复叶标题、错误父链、0/多命中、slot response-lost、apply 重启和旧 parser 冲突负向探针。
5. 在 candidate 首次产生不可逆正式写入之前可以回滚 `0.14.3`；RunLogos 原 transaction 成功 apply 后不重新启用旧 parser，只允许前滚。
6. exit evidence 是全部 UT/ST、`0.14.4↔0.14.3` 往返、SMOKE-core-168 与原 transaction completed receipt，单独的安装成功不等于 cutover 完成。

### 37.7 实现与测试映射

| 职责 | 预期实现落点 | 证据 |
|---|---|---|
| 共享 block/heading/path/range | `cli/src/lib/markdown-section-authority.ts` | UT-S37-37、UT-S37-38 |
| Agent material verifier | `cli/src/lib/merge-transaction.ts` 消费共享模块 | UT-S37-39、UT-S09-272 |
| OpenLogos composer | `cli/src/lib/merge-transaction.ts` 消费共享模块 | UT-S37-40、ST-S37-10 |
| submit/seal/reopen/apply 生命周期 | merge transaction lib/command 与真实 CLI | UT-S09-271～274、ST-S09-106～107 |
| 安装态与跨仓恢复 | 固定 `0.14.4` tarball、smoke runner/reporter | SMOKE-core-168 |

所有测试代码必须使用 OpenLogos reporter。API、数据库与 API orchestration 不适用；公共 transaction schema 与 JSON envelope 保持不变。
