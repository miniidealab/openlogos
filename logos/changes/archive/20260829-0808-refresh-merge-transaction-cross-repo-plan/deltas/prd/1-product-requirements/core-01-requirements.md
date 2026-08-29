## ADDED — S05/S09/S11/S16/S19/S39 合并事务单一权威与 0.14.0 验收要求

### 用户问题与价值

当前规格合并把目标集合、最终内容、hash、正式写入和完成判定分散给 OpenLogos、Agent 与 RunLogos，容易出现同一提案被不同组件判成不同状态。用户需要一个可恢复、可审计且跨进程一致的合并事务：OpenLogos 独占正式事实，Agent 只提供受限内容，RunLogos 只按公共合同调度。

### 核心需求

1. OpenLogos 必须成为 canonical target、mode、source/before/final hash、phase、error、receipt、正式目标写入及 `SPEC_MERGED` 的唯一权威；RunLogos 和 Agent 不得维护第二份成功事实。
2. 公共合同必须使用版本化 `openlogos/merge-transaction@1`，并提供 `status`、`seal`、`apply` 三个动作及稳定的 `allowed_actions/next_action`。
3. Agent 只能读取 OpenLogos 生成的提示与 transaction envelope，并只能原子写入声明的原始字节 content slots；不得生成外部 `MERGE_APPLY_MANIFEST.json`、Base64 payload、metadata target 或正式 marker。
4. resources、OpenLogos 生成的 metadata、decision/counter/resource index、根 spec/skill dogfood、UI prototype 绑定和 `SPEC_MERGED` 必须属于同一 `plan_hash/transaction_id`，全有或全无。
5. no-delta 提案必须走零 Agent slot 的同类 transaction，不能旁路手工写 marker；completed receipt 是规格完成、状态推进、切片规划与提交路径的唯一输入。
6. `status` 必须只读；`next` 与 flow 只能投影 transaction 的 phase、classification 和动作权威，不得猜测重试动作，也不得复用 Plan Package 的 `next_node.dispatch.completion`。
7. 内容缺失属于 waiting；Agent 内容 validator 失败属于 retryable，可原子替换 slot 后重试 seal；schema、identity、路径、plan 漂移或不可恢复 journal 才属于 fatal，且 failed 为终态。
8. 本提案必须交付 OpenLogos `0.14.0`：verify 通过并取得部署授权后，以真实 npm tarball 安装到本机全局，执行安装态 smoke，再由 RunLogos 调用该全局 candidate 完成真实跨仓 E2E。

### 验收条件

- CREATE、MODIFY、混合根、20 个以上目标、metadata、no-delta、UI prototype、重复调用、崩溃恢复和 response-lost 均由同一 transaction 收敛到稳定 receipt。
- 任一正式写入失败时，resources、metadata、counter/index、dogfood 与 marker 恢复为全旧；重试不会生成第二个完成身份。
- `status` 调用前后项目树和 marker 集合字节不变；`next` 只返回 transaction 明确允许的动作。
- completed 后重复 status/apply 返回同一 receipt；receipt 精确列出 changed paths、final hashes 和 Git `commit_paths`，私有 slot/journal 不进入提交白名单。
- 全局 `command -v openlogos` 指向本次安装，`openlogos --version` 精确为 `0.14.0`，随包 schema/Skill 与冻结的 contract hash 一致。
- RunLogos 不得使用源码相对路径、mock 输出、手工正式写 target 或预造 receipt；OpenLogos 与 RunLogos 两仓验收均通过才算完成。

### 非目标

- 本案不授权 npm publish、Git tag、GitHub Release、官网发布或 git push。
- 本案不引入 HTTP/RPC/消息 API、数据库或业务数据迁移。
- 旧 `merge-apply --manifest` 最多保留固定非零升级提示，不得继续形成成功 fallback。
