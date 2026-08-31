## ADDED — authority_impact 提案生产合同（规范引用）

先读取 `spec/authority-closure.md`。本 Skill 只生产当前 change 的 impact 计划，不重建项目 Authority Registry 或复制根规范。

影响分析时先判断触发：共享业务事实/完成谓词、projection、owner/writer/mutation/recovery/cutover、消费者本地重算风险。每个新或仍 writing 的提案必须有唯一 `openlogos/authority-impact@1`。required 分支引用 Registry 或当前 CREATE authority target，列出 projections、retired shadow sources、forbidden fallbacks、cutover 和真实 UT/ST/SMOKE IDs；not_applicable 分支只含非空可核验证据。

任何 unresolved、未知 fact 引用、空 cutover、测试 ID 不真实或影子来源未退休都不得报告 plan 完成。Delta 仍遵守 P=T=D、一目标一文件、写后读回和逐文件勾选；`[code]` 在 merge 前保持空白。全部 Delta 完成后运行 change-lint，等待独立 merge 授权。
