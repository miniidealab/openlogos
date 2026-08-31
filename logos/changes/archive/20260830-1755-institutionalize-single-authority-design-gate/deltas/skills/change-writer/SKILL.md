## ADDED — Authority Closure 影响分析与提案门

### 规范与职责

先完整读取 `spec/authority-closure.md`。change-writer 负责当前 change 的 `authority_impact`，不拥有项目 Registry，也不得复制 AC 规范。

### Step 2 扩展：判定适用性

检查共享 fact/完成谓词、cache/index/marker/receipt/view、owner/writer/mutation/recovery/cutover 变化，以及消费者是否可能扫描文件/mtime/存在性重算决定。满足任一触发即 required；纯文案/纯视觉/机械局部变更可 not_applicable，但须非空事实证据。

### proposal 结构

required 分支引用稳定 `fact_id` 和 Registry/当前 CREATE authority target，列出 change、projections、freshness、retired shadow sources、forbidden fallbacks、cutover 四项与真实测试 ID，`unresolved` 必须清零。not_applicable 不得带空 facts 或伪造 cutover。

### 交付门

- 缺声明、引用不存在、旧 writer 未停止、cutover 无 exit、测试 ID 不真实或 shadow source 未退休：不得报告 plan ready。
- authority impact 与 baseline closure 正交；前者回答谁裁决，后者回答改哪些目标。
- Delta 继续 P=T=D、一目标一文件、写后读回、逐文件勾选。
- merge 前 `[code]` 留空；全部 Delta 后运行 change-lint，只报告就绪并等待 merge 明确授权。
