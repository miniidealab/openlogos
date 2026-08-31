## ADDED — 三、Merge Transaction 共享 Section Anchor Authority 测试

### 单元测试

| ID | 检查项 | Fixture | 精确期望 |
|---|---|---|---|
| UT-S37-37 | fence-aware 共享 Delta block parser | 物质块前后含反引号/波浪线围栏，围栏中嵌入 `## MODIFIED — 伪锚`、heading和 `REMOVED-ITEMS`；围栏外含合法 MODIFIED + 同锚 REMOVED-ITEMS | parser只返回围栏外控制块并保留源序；REMOVED-ITEMS只进入守恒声明、不进入 composer；change-lint 与 transaction 得到逐字段相同 block identity |
| UT-S37-38 | 标题树、路径锚与真实范围 | before 含两个父章节及同名 H3 叶标题，使用完整 `父A > 叶`；参数化单段歧义、错误父链、0命中、多层路径、下一同级/更高级 heading与EOF | 合法锚唯一返回真实 `level/text/path/start/end`；range精确止于下一同级/更高级 heading；反例返回稳定 not-found/ambiguous，不首命中、不合并候选 |
| UT-S37-39 | Agent material outcome verifier | ADDED/MODIFIED/REMOVED before/final 配对；MODIFIED含合法父子链、字面量路径伪标题、叶标题迁父、正文缺失与围栏伪 heading | 合法操作通过；伪标题/迁父/缺正文稳定失败；verifier只消费共享 block/hit，不构造整条路径正则，不改变输入字节 |
| UT-S37-40 | OpenLogos Markdown composer 与同源证伪 | H2父/H3叶/H4子标题及前后未触及字节；路径锚 MODIFIED/REMOVED，ADDED与重复标题对照；注入旧精确H2/非fence parser会冲突的夹具 | composer以真实 hit range替换/删除，保留H2/H3和相对H4、未触及范围及合法结尾；不写路径字面量；候选重验与lint/Agent resolver identity一致，旧 parser/matcher 不可达 |

### 场景测试

| ID | 检查项 | 真实 CLI 序列 | 精确期望 |
|---|---|---|---|
| ST-S37-09 | lint→Agent transaction 同源闭环 | 临时项目使用 RunLogos 真实路径锚和重复叶标题结构；先运行 `change-lint --format json`，再创建 transaction、写 Agent final、submit、seal、apply；另跑单段歧义和错误父链反例 | 合法夹具 lint pass、seal/apply completed且真实标题层级不变；反例 lint 与seal均按同一候选/原因拒绝，seal仅局部reopen可归因slot；无私有正则分歧 |
| ST-S37-10 | OpenLogos producer composer 与零回归 | 用根 `spec/` 或 `skills/` Markdown target 构造路径锚 MODIFIED，真实 CLI 走 OpenLogos producer seal/apply；并运行单段唯一、ADDED、REMOVED、REMOVED-ITEMS/fence与0/多命中矩阵 | 合法路径锚确定性完成，正式目标未触及范围/heading identity正确；声明块不物质写；0/多命中零正式副作用；既有合法操作输出合同不回归 |

### AC-08 证伪矩阵

- **冲突旧副本**：保留只供测试的旧扁平路径/H2判据作为 oracle 反例，断言生产调用图不导入或调用它。
- **滞后投影**：改变 Delta source、before 或 final hash 后复用旧 hit/preflight，必须拒绝并重建，不用 mtime/marker 证明新鲜。
- **并发/旧 writer**：同锚多物质 block或旧 composer 与新 composer同时尝试写入时 fail-closed，只允许 MergeTransaction apply writer提交。
- **响应丢失与重启**：seal/reopen/apply响应丢失后从 transaction/preflight/receipt恢复，不扫描残留 staging选择解析结果。
- **回滚**：candidate 首次正式写入前可回到冻结 `0.14.3`；成功 apply 后旧 parser不可重新启用。
- **反向推断**：字面量路径标题、首个叶标题、文件存在性、marker或最终正文相似度均不能反向成为 authority。

### Runner、Reporter 与追溯

- UT 使用共享模块的纯函数 API 与 Vitest；ST 使用真实 build CLI 子进程和隔离临时项目。禁止 mock lint/transaction JSON、手工伪造 seal/receipt 或跳过 OpenLogos producer。
- 每个 ID 独立写入 `logos/resources/verify/test-results.jsonl`，evidence 包含 block源序、hit identity、candidate hash、phase/classification和正式树hash，绝对临时路径须脱敏。
- 既有 UT-S37-18～21、27～31、32～36 与 ST-S37-04、07～08 必须全量重跑，证明 L1～L8、标题根ID与路径锚行为零回归。
- 追溯：AC-MT-ANCHOR-01～05；功能规格 §2.46.2～§2.46.4；架构 fact `delta.section-anchor-resolution`；S37 同源消费时序。
