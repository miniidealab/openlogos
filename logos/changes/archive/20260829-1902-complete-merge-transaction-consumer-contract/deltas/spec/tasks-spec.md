## ADDED — 公共 content staging 与 receipt-only 任务边界

### Delta producer

Agent 任务只能要求写入 OpenLogos 投影中对应 slot 的 `staging_path`，并遵守同目录临时文件加 atomic rename。任务不得要求 Agent：

- 自建 staging 根或选择任意 submit file；
- 读取/写入 canonical target、metadata、receipt、marker、journal；
- 运行 OpenLogos 或 Git；
- 生成外部 manifest、commit_paths 或错误分类。

### Driver 完成证据

WorkUnit 完成只证明声明 staging 文件已经生产，不代表 slot 已提交或 merge 完成。Driver 必须等待 quiescent，再调用 submit-content；节点完成只以 OpenLogos 返回结果为准。

### Merge 与代码切片

只有 completed receipt 的双层 hash 和 commit_paths 校验通过，Delta tasks 才能视为已合并；slice-planner 只读取正式已合并测试 ID。failed/aborted、普通 fatal 或 recovery_required 均不能勾选规格完成或规划代码切片。
