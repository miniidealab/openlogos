## ADDED — sync 托管 guard 资产测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S08-59 | 托管资产面纳入 guard | asset-manifest 含 guard-check 条目（版本化哈希）；sync 对缺失/哈希漂移的 guard-check 落盘刷新为随包字节；非 Claude 宿主项目不部署、不触碰 settings.json |
| UT-S08-60 | 存量项目补齐与迁移 | 无 guard-check、settings.json 仅 SessionStart（旧相对路径）的存量 fixture：sync 后 bin 在盘、PreToolUse 段补齐为 `$CLAUDE_PROJECT_DIR` 形态、SessionStart 条目同步升级；重复 sync 零变化 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S08-37 | 真实 CLI sync 端到端补齐 | 真实 `openlogos sync` 驱动存量项目 fixture：guard-check 落盘且哈希与随包一致、hook 注册齐备、用户自有 hooks 字节不变；再跑一次 sync settings.json 与 bin 均零变化 |

### 自动化与证据要求

- 每个用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S08"`；失败不得写 pass。
