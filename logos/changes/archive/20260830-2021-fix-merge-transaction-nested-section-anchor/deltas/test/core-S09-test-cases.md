## ADDED — S09 嵌套章节锚 Transaction 生命周期测试

### 单元测试

| ID | 验证目标 | Fixture/故障注入 | 精确断言 |
|---|---|---|---|
| UT-S09-271 | submit-content 原始字节职责 | Agent target 使用 `父标题 > 叶标题` Delta，final bytes 通过声明 staging path提交；对照路径逃逸、symlink、空/超限、非法 UTF-8、围栏外控制 marker | 合法内容写入 slot hash并使最后 slot 后 phase=ready；submit 不调用 section resolver；安全反例保持 collecting/原 hash且返回既有稳定 classification |
| UT-S09-272 | seal preflight 嵌套锚 Agent verifier | before/final 含唯一父子标题链，另造字面量路径标题、重复叶、错误父链、0 命中与围栏伪 heading | 合法 final 以真实 `level/text/path/range` 通过并生成 preflight-bound seal；各反例只按共享 resolver 失败，不采信字面量路径或首命中 |
| UT-S09-273 | 局部 reopen 身份守恒 | 7 个 Agent slots 中 6 个已提交，目标 slot 的嵌套锚物质结果首次错误、第二次正确；在 transaction rename 前后和私有 cleanup 注入故障 | 失败只清目标 content hash并回 collecting；transaction/plan/target-set及其它6个hash不变；修正后同 transaction reseal；任一故障点只有完整 ready/sealed或collecting |
| UT-S09-274 | apply 重验与 producer 边界 | sealed Agent target、OpenLogos Markdown target及 source/before/content/parser-result 漂移参数化 fixture | Agent 走共享 verifier、OpenLogos 走共享 composer；apply 重算 identity相同才首写；任一漂移在 journal/正式写前失败，公共 schema/phase/action不变 |

### 场景测试

| ID | 场景 | 操作序列 | 精确断言 |
|---|---|---|---|
| ST-S09-106 | 真实 CLI 嵌套锚 submit→seal→apply | 临时项目创建父 H2/叶 H3 且其它父下有同名叶的目标与路径锚 Delta；写完整 Agent final 到声明 staging，真实子进程依次 submit-content、status、seal、apply | submit 成功且 ready；seal唯一命中真实父/叶并 sealed；apply completed；正式目标保持 H2/H3、不含字面量路径标题，receipt/final hashes可复算 |
| ST-S09-107 | RunLogos 同形 6/7 slot局部恢复 | 构造与 `mtx_e7f7b924499d49f96aaf8a2f` 同形的 7-slot临时事务并冻结6个hash；首次 final 制造错误父链触发seal reopen，status后只重提目标slot，再seal/apply；模拟一次响应丢失 | 每轮只目标slot missing，其它6个hash与 transaction identity守恒；新进程status/recover得到唯一状态；最终completed且不abort、不创建新事务、不产生部分写入 |

### 负向与零回归矩阵

- UT-S09-271 必须证明 submit 与 seal 语义门分层，避免把本缺陷回归测试错误放在 submit action。
- UT-S09-272/ST-S09-106 必须复用 RunLogos 真实标题文本 `七、项目文件夹动态 watcher 交互规则 > 7.1 已打开文件外部变化感知` 至少一次，同时保留脱敏临时路径。
- UT-S09-274 必须覆盖 Agent/OpenLogos 两种 producer，证明 transaction 私有 `parseDeltaSections`、扁平路径正则和精确 H2 fallback 已不可达。
- 既有 UT-S09-239～265、ST-S09-94、ST-S09-99、ST-S09-102～103 全量重跑，公共 projection、局部 reopen、崩溃顺序和 receipt 行为零漂移。

### Runner、Reporter 与追溯

- UT 使用 Vitest 临时目录和确定性 fault injection；ST 必须运行真实编译后 CLI 子进程，不 mock transaction projection，不手工改 `MERGE_TRANSACTION.json`、receipt、marker 或正式 target。
- 每个 ID 独立通过 OpenLogos reporter 追加到 `logos/resources/verify/test-results.jsonl`，记录脱敏 transaction ID、phase、classification、slot hash集合、preflight/seal/final hash与正式树 before/after hash。
- 缺失、skip、重复矛盾或一个 happy-path 无条件代报多个 ID 均判失败。
- 追溯：AC-MT-ANCHOR-01、03～05、07；功能规格 §2.46.3～§2.46.5；架构 §37.4～§37.6；S09 嵌套章节锚恢复时序。
