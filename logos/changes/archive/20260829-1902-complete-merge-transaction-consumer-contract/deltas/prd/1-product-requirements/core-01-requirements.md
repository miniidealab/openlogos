## ADDED — S05/S09/S11/S16/S19/S39 消费者合同完成要求

### 用户问题与目标

RunLogos 不能依赖 OpenLogos 内部磁盘结构，也不能自行发明 staging、动作或 Git 提交规则。OpenLogos 必须让公共 0.14.0 CLI 合同足以独立完成内容生产、取消、合并、恢复和精确提交。

### 范围

- S05：next 只给出真实可执行的事务动作。
- S09：Agent 只写 OpenLogos 签发的 staging path；CLI 独占正式写入与提交闭包。
- S11：status 只读公开完整 slot descriptor、终态和 receipt。
- S16：schema/hash/golden JSON 冻结全部消费者字段。
- S19：修正 candidate 必须真实 pack/install/self-check/回滚。
- S39：payload、receipt、marker 与 commit 白名单形成无环闭包。

### 验收条件

1. 每个必需 Agent slot 公开稳定 `slot_id`、opaque `target_ref`、项目根相对 `staging_path`、`content_encoding=utf8-raw`、`max_bytes` 与 `write_protocol=atomic-rename`。
2. `submit-content --slot --file` 仅接受该 slot 的声明 staging path；逃逸、symlink、额外路径、空文件、超限、非法 UTF-8 与 hash 漂移在正式写入前拒绝。
3. completed receipt 公开 change/module/plan/transaction identity、changed/created paths、逐 payload final hash、metadata/test-change-set/SPEC_MERGED 摘要和精确 `commit_paths`。
4. completed projection 的 `artifact_hashes` 覆盖 receipt/marker；它与 receipt 内 `final_hashes` 互斥且并集精确覆盖 `commit_paths`。
5. `abort` 命令与 action 枚举一一对应；成功后 `phase=failed`、`classification=aborted`、动作清空、receipt=null，重复 abort 返回同一 `aborted_at`。
6. 普通 fatal failed 不暴露 abort；仅 recovery_required 可暴露 recover；未知 action/schema/hash 一律 fail closed。
7. 修正后 candidate 保持未公开的 0.14.0 identity，但旧 tarball/schema/contract hash 失效并重新冻结。
8. RunLogos 只凭公共 envelope 完成真实 E2E，不读取内部 receipt/journal，不手工写 target/marker，不预造 completed transaction。

### 非目标

不新增 HTTP API、数据库、页面，不授权 npm publish、tag、GitHub Release、官网发布或 git push。
