## ADDED — 0.14.0 消费者合同 follow-up 执行规则

> 本节覆盖本 Skill 中要求 Agent 自建临时路径、读取内部 receipt 或根据 phase 推导动作的旧说明。

1. 先调用公共 `merge transaction status`，校验 CLI 版本、schema SHA-256、contract SHA-256、slug 与 transaction identity。
2. Agent 只接收 `content_slots.items[]` 中当前 slot 的 opaque target_ref、staging_path、编码、上限和写协议；禁止 OpenLogos/Git 命令及 canonical target 写权。
3. Agent 必须在 staging_path 同目录写临时文件并原子 rename。WorkUnit quiescent 后，Driver 只能使用完全相同的声明路径调用 `submit-content --slot --file`。
4. 只执行 `allowed_actions` 中的 `next_action`；已知动作与子命令一一映射：submit_content→submit-content、seal→seal、apply→apply、recover→recover、abort→abort。
5. completed 时校验 receipt final_hash paths 与外层 artifact_hash paths 互斥，二者并集精确等于 commit_paths。禁止读取内部文件补齐集合。
6. abort 只在 collecting/ready/sealed 执行；期望 failed/aborted、动作清空、receipt=null。普通 fatal failed 交给人工诊断。
7. Git 只能逐项提交公共 receipt 的 commit_paths；任何额外 staged path、unrelated dirty、未知字段枚举或 hash 漂移均 fail closed。
