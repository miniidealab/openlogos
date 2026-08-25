## ADDED — S08 Qoder 同步、用户资产保护与回滚测试

### 单元测试

| ID | 验证点 | 输入/前置 | 预期结果 |
|---|---|---|---|
| UT-S08-21 | 历史配置兼容 | 标量/数组不含 qoder | 只同步原宿主，不擅自加入 Qoder |
| UT-S08-22 | all 包含 Qoder | aiTool=all | 稳定展开含 qoder，既有宿主相对顺序不变 |
| UT-S08-23 | managed/user 分区 | Qoder plugin 混合托管、settings、用户组件 | 只计划 OpenLogos owner；其它 preserved/blocked |
| UT-S08-24 | 幂等差异 | 模板、locale、lifecycle 未变 | 第二次所有 Qoder 托管资产 unchanged，无时间戳外漂移 |
| UT-S08-25 | 失败不写版本戳 | Qoder stage/rename/readback 注入失败 | 回滚且 `.openlogos-sync.json` 保持旧值或不存在 |
| UT-S08-26 | 资产语法与重复发现 | 非法 manifest/hooks/frontmatter 或重复组件声明 | 预检阻断，目标树与用户资产不变 |

### 场景测试

| ID | 场景 | 操作序列 | 预期结果 |
|---|---|---|---|
| ST-S08-19 | 两次 Qoder sync | 对 aiTool=qoder 项目连续 sync | 首次按差异更新；第二次托管资产 unchanged；版本戳只在完整成功后写入 |
| ST-S08-20 | settings/用户插件保留 | 预置 Qoder settings、不同 identity plugin、未知文件后 sync | 用户资产 SHA-256 不变并逐项 preserved；OpenLogos 资产正常刷新 |
| ST-S08-21 | 中途失败总回滚 | all 配置下对 Qoder 注入 rename/读回失败 | 命令非零；所有 Adapter 提交恢复，版本戳不变，不输出总成功 |

### 自动化与证据要求

- fixture 覆盖标量、数组、all、未知 id，验证未知值仍 fail loud。
- 幂等比较 manifest、组件、runtime、AGENTS managed block 与用户资产哈希，不把合法 syncedAt 当内容漂移。
- 内嵌 OpenLogos reporter，将全部 ID 写入 `logos/resources/verify/test-results.jsonl`，字段含 `status`、`timestamp`、`duration_ms`、`scenario: "S08"`，失败含 `error`。
- ST-S08-21 保存版本戳和所有 Adapter 目标树前后快照；reporter 写入失败使测试失败。
