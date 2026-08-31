## ADDED — S09/S37 Merge Transaction 嵌套章节锚同源解析与 0.14.4 本机恢复要求

### 用户问题与价值

OpenLogos 已允许 Delta 使用 `父标题 > 叶标题` 唯一定位重复叶标题，但 merge transaction 的 Agent slot 语义校验和 OpenLogos Markdown composer 仍可能把整条路径当作一个扁平标题或固定 H2 处理。合法内容因此会在 seal preflight 被误判并局部 reopen，跨仓消费者只能反复重提同一个 slot。用户需要保持原 transaction identity 与已正确提交的 slot，在不伪造字面量路径标题、不 abort、不重建事务的前提下完成合并。

### 核心需求

1. `submit-content` 只校验声明 staging path、普通文件、containment、symlink、UTF-8、大小、Delta 控制 marker 与 slot hash，不负责裁决章节锚语义。
2. fence-aware Delta 控制块解析、Markdown 标题树、标题路径拆分、唯一锚解析和章节边界计算必须由一个共享模块提供；change-lint、seal/apply 的 Agent semantic verifier 与 OpenLogos Markdown composer 不得保留私有正则或第二套状态机。
3. `MODIFIED — 父标题 > 叶标题` 只有在标题层级路径唯一命中时才合法。解析结果必须携带目标文档真实 `hit.level`、`hit.text`、完整路径身份和 `[start,end)` 章节边界。
4. Agent producer 的最终内容必须用同一 resolver 在 before/final 中证明物质操作成立；OpenLogos producer 必须用 before 的真实命中合成最终章节。两条 producer 路径都不得把路径锚字符串写成正式标题。
5. `ADDED / MODIFIED / REMOVED` 既有操作语义与 `REMOVED-ITEMS` 非物质声明语义保持不变；代码围栏内的伪控制 marker 不得成为 Delta block。
6. 锚零命中、多命中、层级不匹配、同锚多写者和最终结构漂移继续 fail-closed。失败发生在正式首写前时，不得生成 receipt、marker、apply journal、backup 或部分正式目标。
7. seal preflight 只能按结构化 target path 将可修复错误归因到唯一 Agent slot；reopen 只清空 rejected slot，保留 transaction ID、plan hash、target set 与其它 submitted content hash。
8. apply 必须对 sealed 输入重跑同一 verifier/composer 并校验 preflight identity；任何 parser/resolver 结果漂移都按 sealed identity 失败，不静默 rebase。
9. 修复以新的本地 patch candidate `0.14.4` 交付，当前本机全局 `0.14.3` 是冻结回滚基线；禁止用相同 `0.14.3` 版本号承载不同字节。
10. 安装态最终验收必须复用 RunLogos 原 transaction `mtx_e7f7b924499d49f96aaf8a2f`，只重提缺失 slot并完成 seal/apply；不得 abort 或创建新 transaction 掩盖失败。

### 验收条件

| ID | 验收条件 |
|---|---|
| AC-MT-ANCHOR-01 | RunLogos 同形 `MODIFIED — 父标题 > 叶标题` 的合法 Agent final bytes 可成功 submit，并在 seal preflight 唯一解析 before/final，不产生字面量路径标题 |
| AC-MT-ANCHOR-02 | 同一夹具经 change-lint、Agent verifier 与 OpenLogos composer 得到相同的唯一命中；真实 `level/text/path/range` 一致 |
| AC-MT-ANCHOR-03 | fence 内伪 marker、锚零命中、多命中、错误父子层级和同锚多写者稳定拒绝，正式树及事务 apply 制品零变化 |
| AC-MT-ANCHOR-04 | seal preflight 拒绝可归因 Agent 内容时只退回目标 slot；修正后同 transaction 完成，其它 slot identity/hash 不变 |
| AC-MT-ANCHOR-05 | apply 重验与 sealed preflight 不一致时首写前失败；不存在 transaction 私有 marker/parser、扁平路径正则或精确 H2 fallback |
| AC-MT-ANCHOR-06 | 固定 `0.14.4` tarball 完成隔离安装、`0.14.3→0.14.4→0.14.3→0.14.4` 往返和本机全局安装态 smoke，所有 package/plugin/asset identity 与 tarball SHA-256 一致 |
| AC-MT-ANCHOR-07 | RunLogos 原 transaction 最终为 7/7、sealed/apply/completed，receipt 与正式目标可复算，未发生 abort、新 transaction 或其它 6 个 slot hash 漂移 |

### 授权与非目标

- 本节只定义交付合同，不授权 `openlogos merge`、verify、本机全局部署、smoke、RunLogos merge、archive、公开发布或 git push；每个动作继续使用独立人类确认点。
- 不新增或修改 merge transaction 公共 schema、phase、classification、action、receipt shape 或 HTTP/API/DB 合同。
- 不引入内容相似度猜测、首命中回退、双 writer、长期兼容非法字面量路径标题或远程 registry 发布。

### 追溯

- 场景：S09 Merge Transaction 生命周期、S37 Delta 守恒门。
- 测试：UT-S09-271～UT-S09-274、ST-S09-106～ST-S09-107、UT-S37-37～UT-S37-40、ST-S37-09～ST-S37-10。
- 部署后 smoke：SMOKE-core-168。
