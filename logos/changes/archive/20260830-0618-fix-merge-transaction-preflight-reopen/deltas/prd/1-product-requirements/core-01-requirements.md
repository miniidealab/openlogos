## ADDED — S05/S09/S11/S16/S19/S39 Preflight 与可修复 reopen 验收要求

### 用户问题与价值

当合并事务的所有 content slot 已提交后，可由候选字节确定的跨 target 错误不应等到 apply 才暴露，更不应迫使用户 abort 并重建全部正确 slot。OpenLogos 必须在 seal 前发现新事务问题，并允许尚未发生正式写入的旧 sealed 事务只退回真正有问题的 Agent slot。

### 核心需求

1. seal 前必须预演全部确定性合并结果及派生物；失败时不得形成 sealed 快照。
2. seal 必须绑定 preflight 的 canonical identity；apply 必须在首写前证明重算结果与 sealed view 完全一致。
3. 当前 0.14.1 已 sealed、无 journal/receipt/marker/正式写入的事务必须可由 0.14.2 首写前兼容检查；不得要求新建 transaction。
4. 内容错误必须通过结构化 target path 唯一归因，不得解析自然语言消息；OpenLogos producer、contract/schema、plan/hash/path drift 不得伪装成 Agent retry。
5. reopen 必须保留 transaction ID、plan hash、target set 和无关 slot submitted hash，只把 rejected slot 放回 missing。
6. reopen 必须先原子落盘 collecting 权威状态，再清理非权威私有字节；任意崩溃点不得产生 sealed-but-missing 或部分正式写入。
7. status、next 与错误 envelope 必须投影同一个持久化状态：`phase=collecting`、`classification=slot_identity_mismatch`、`retryable=true`、`allowed_actions=[submit_content,abort]`、`next_action=submit_content` 和精确 `missing_slot_ids`。
8. 一旦进入 applying 或存在 apply journal/backup/staging、receipt、marker、正式 target 新字节，禁止 reopen，只能 recover/rollback。

### 验收条件

| ID | 验收条件 |
|---|---|
| AC-MT-PF-01 | 新事务 after 测试表歧义在 seal 前失败，事务为 collecting，正式树及 apply 私有制品零变化 |
| AC-MT-PF-02 | 合法新事务 seal 绑定 preflight；seal/apply 间任一 before、metadata 或派生 hash 漂移均在首写前拒绝 |
| AC-MT-PF-03 | 0.14.1 legacy sealed 事务可临时 preflight；通过时保留 legacy seal，失败时局部 reopen |
| AC-MT-PF-04 | 多个可归因 Agent target 可共同退回；混入任一不可归因或 OpenLogos producer 错误时一个 slot 也不清 |
| AC-MT-PF-05 | reopen 状态落盘前后故障注入分别收敛为完整 sealed 或权威 collecting，残留私有字节不影响 status/next |
| AC-MT-PF-06 | RunLogos `mtx_7e0341e3719feccd22ef7615` 只退回 `core-S44-test-cases.md` slot，其余 14 个 slot 保留；修复后同 transaction completed |
| AC-MT-PF-07 | 0.14.2 tarball、隔离安装、0.14.1 回滚和全局安装态 smoke 均绑定固定 SHA-256；失败不保留混装 |

### 授权边界

提案批准只允许产出 Delta。规格 merge、verify、本机部署、smoke、RunLogos 恢复/继续 merge、archive、公开发布和 git push 均按各自人类确认点执行；任何规格文字或 tasks checkbox 都不能替代授权。

### 非目标

- 不新增公共 phase/action/classification/JSON 字段或人工 reopen 命令。
- 不修改 abort 终态语义，不放宽测试 ID、表列数、UTF-8、hash、containment 或 symlink 校验。
- 不迁移 completed、已写 journal 或已发生正式写入的历史事务。
- 不授权 npm publish、dist-tag、Git tag、GitHub Release、官网部署或 git push。
