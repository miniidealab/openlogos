## ADDED — TRAE non-deployable 同步负向测试

### 单元测试

| ID | 测试点 | 前置/输入 | 关键断言 |
|---|---|---|---|
| UT-S08-33 | `all` 同步排除 TRAE | 配置选择 `all` | 资产计划只含现有七宿主，不含 `.trae/**` 或 TRAE capability；顺序稳定 |
| UT-S08-34 | 历史配置零漂移 | 单值、数组与 `all` 的既有七宿主 fixtures | 规范值、目标路径、内容哈希、结果分类和版本戳语义与基线一致 |
| UT-S08-35 | 显式 TRAE 不产生计划 | 非法/手工配置含 `trae` | 在资产事务前返回不支持错误，不将其忽略、映射成 `other` 或提交部分同步 |
| UT-S08-36 | 用户 TRAE 资产排除 | 工作区预置 Rules、Skills、Agents、Hooks、MCP、settings 和不透明记忆 fixture | 所有路径均不进入扫描、写入、暂存、备份、删除或回滚集合 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S08-25 | `sync` + `all` 保持七宿主 | 现有七宿主按稳定顺序完成，同步版本戳最后提交；工作区不新增任何 TRAE 托管资产 |
| ST-S08-26 | 含 `trae` 的配置 fail loud | 总同步在首个目标写入前停止，不输出 Sync complete，不刷新版本戳；已有 `.trae/**` 和现有宿主资产字节不变 |

### 自动化与证据要求

- 测试从真实 Registry 和真实同步资产计划取证，不能用“没有模板文件”作为唯一排除证明。
- 隔离 fixture 须包含 `.trae/rules/`、`.trae/skills/`、`.trae/hooks.json`、settings、MCP 与不透明记忆样本；断言前后文件清单及 SHA-256 完全相同。
- 每个用例通过 OpenLogos reporter 写入 `test_id`、`scenario_id="S08"`、`status`、`duration_ms`、`evidence`；失败不得写 pass。
