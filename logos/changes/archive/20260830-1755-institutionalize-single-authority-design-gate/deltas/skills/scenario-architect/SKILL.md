## ADDED — Authority Closure 时序建模

### 输入与引用

读取 `spec/authority-closure.md` 和项目 Authority Registry。只使用稳定 `fact_id`；不从代码、路径或参与者名称自造 owner。

### 时序要求

显式画出 command、mutation entry、authority read/write、projection refresh、consumer decision 和 recovery。projection 消息必须携带 generation/version/hash/receipt 等 freshness identity。两个参与者均能直接写 canonical state 或给出最终决定时，停止产出并回退 architecture-designer。

### 异常要求

至少建模 stale projection、conflicting old copy、response lost + restart、legacy/concurrent writer。恢复只读 authority/receipt；目录扫描、mtime、marker 存在性和 stale cache 不得作为 fallback authority。

追溯连接 `fact_id`、AC-01～AC-08 与真实 UT/ST；场景只消费 Registry，不复制 owner 表。
