## ADDED — Authority / Projection 时序建模（规范引用）

先读取 `spec/authority-closure.md` 与项目 Authority Registry。场景只引用稳定 `fact_id`，不从代码、文件名或参与者名称推断 owner。

sequence diagram 必须区分 command、mutation entry、authority write/read、projection refresh、consumer decision 与 recovery；projection 消息标注 freshness identity。若两个参与者都能直接 write canonical state 或给出最终 decision，停止场景交付并回退 architecture-designer。

异常路径至少包含 stale projection、conflicting old copy、response lost/restart 和 legacy writer。恢复从 authority/receipt 开始；禁止把目录扫描、mtime、marker 存在性或 stale cache 画成权威 fallback。追溯必须连接 fact_id、AC 条款和真实 UT/ST。
