## ADDED — Completed receipt 驱动的精确规格提交

### 成功谓词

规格 merge 成功必须同时满足 transaction=completed、receipt identity 合法、payload final hashes 合法、外层 artifact hashes 合法、两层 path 并集精确等于 commit_paths，并且 `SPEC_MERGED` 绑定同一 transaction/receipt identity。

### Git 提交

自动规格提交只能执行固定 argv 的 `git add -- <commit_paths...>`，随后核对 staged path 精确相等。不得扫描目录、读取内部 receipt、把 unrelated dirty 加入提交或根据 Delta/tasks 重算提交集合。

### Abort 与恢复

failed/aborted 不产生规格提交；普通 fatal failed 无自动动作；recovery_required 只允许 recover。response-lost 必须先 status/recover，同一 completed receipt 只能形成一次规格提交。

### Stacked change

不同 worktree/slug 分别拥有 guard、marker、verify、deploy、smoke 与 archive 证据。旧 SMOKE-core-150 和 follow-up SMOKE-core-151+ 不得互相顶替。
