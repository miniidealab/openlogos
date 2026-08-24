## ADDED — S08 ZCode 同步、保留与版本戳测试

### 单元测试

| ID | 验证点 | 输入/前置 | 预期结果 |
|---|---|---|---|
| UT-S08-15 | 旧配置兼容 | 历史单值/数组不含 zcode | 只同步原宿主，不擅自加入 ZCode |
| UT-S08-16 | `all` 新展开 | 历史或当前配置为 all | Registry 展开结果包含 ZCode，既有宿主顺序兼容 |
| UT-S08-17 | managed/user 分区 | ZCode 目录混合托管与用户文件 | 只计划托管文件，用户文件标记 preserved |
| UT-S08-18 | 幂等差异 | 模板、locale、lifecycle 均未变化 | 第二次计划全部 unchanged，无时间戳外漂移 |
| UT-S08-19 | 失败不写版本戳 | 任一 Adapter 暂存或读回失败 | `.openlogos-sync.json` 保持旧值或不存在 |
| UT-S08-20 | 资产语法校验 | 非法 hooks JSON、manifest 或 Markdown frontmatter | 预检阻断且目标未被替换 |

### 场景测试

| ID | 场景 | 操作序列 | 预期结果 |
|---|---|---|---|
| ST-S08-16 | 两次同步幂等 | 对含 ZCode 的项目连续执行两次 sync | 首次按需 updated，第二次 ZCode 全部 unchanged；版本戳只在完整成功后刷新 |
| ST-S08-17 | 保留用户配置与插件 | 预置 `.zcode/config.json`、用户插件和托管目录内未知文件后 sync | 用户资产哈希不变，结果逐项 preserved；OpenLogos 托管资产正常刷新 |
| ST-S08-18 | 中途失败回滚 | 注入 ZCode rename/权限/读回失败后 sync | 整体非零退出；ZCode 事务回滚，最终版本戳不变，不输出完成文案 |

### 自动化与证据要求

- 旧配置 fixture 必须覆盖标量、数组、`all` 与未知值的明确错误路径。
- 幂等断言比较受管文件内容和用户文件哈希，不把合法 `syncedAt` 更新当资产漂移。
- 实现测试时必须内嵌 OpenLogos reporter，向 `logos/resources/verify/test-results.jsonl` 写入本节全部 ID；记录包含 `status`、`timestamp`、`duration_ms`、`scenario: "S08"`，失败含 `error`。
- ST-S08-18 必须保存版本戳和目标树前后快照作为回滚证据。
