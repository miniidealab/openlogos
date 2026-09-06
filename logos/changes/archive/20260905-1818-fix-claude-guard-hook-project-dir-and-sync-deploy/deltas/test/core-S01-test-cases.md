## ADDED — Claude hook 项目根形态注册测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S01-137 | 注册形态 | init 写入的 PreToolUse command 为 `"$CLAUDE_PROJECT_DIR"/.claude/openlogos/bin/guard-check`，SessionStart command 含 `$CLAUDE_PROJECT_DIR`；matcher 与既有结构不变 |
| UT-S01-138 | 幂等与新旧迁移 | 已有新形态 → 重复执行零变化；只有旧相对路径条目 → 升级为新形态且不并存；新旧同时在场（历史异常态）→ 收敛为唯一新形态；用户自有 hooks 条目字节不变 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S01-30 | init 端到端注册 | 真实 `openlogos init --ai-tool claude-code` 后 settings.json 两 hook 均为 `$CLAUDE_PROJECT_DIR` 形态、guard-check bin 在盘；重复 init 后 settings.json 字节级零重复条目 |

### 自动化与证据要求

- 每个用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S01"`；失败不得写 pass。
