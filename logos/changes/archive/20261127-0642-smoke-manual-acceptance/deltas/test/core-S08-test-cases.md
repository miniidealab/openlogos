## ADDED — 生成指令「等待人工验收」硬红线测试用例（smoke-manual-acceptance）

> 覆盖 `spec/agents-md.md`「两档授权语义的『等待人工验收』硬红线条目（smoke-manual-acceptance）」与功能规格 §2.107.9。全部用例在 `mktemp -d` 一次性项目中执行 `openlogos init` / `sync`，测试代码写入 OpenLogos reporter，`scenario_id="S08"`。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|----|--------|---------|------|---------|
| UT-S08-93 | zh 生成指令含新硬红线 | launched 项目，`locale: "zh"` | `openlogos init` 后读取 AGENTS.md 与 CLAUDE.md | 托管段硬红线列表逐字含 `spec/agents-md.md` 规定的 zh 条目，位于部署审批条目之后；既有两条硬红线原样保留 |
| UT-S08-94 | en 生成指令含新硬红线 | 同上，`locale: "en"` | 同上 | 逐字含 en 条目，位于部署审批条目之后 |
| UT-S08-95 | `initial` 生命周期不生成 | `lifecycle: initial` 项目；另一臂为 `mixed` 视图 | `openlogos sync` | `initial` 不出现该条目（两档授权段整段不生成）；`mixed` 视图与其他硬红线一起生成 |
| UT-S08-96 | 重复 sync 零变化 | UT-S08-93 生成后的项目 | 再执行两次 `openlogos sync` | AGENTS.md / CLAUDE.md 字节不变；托管段以外的用户内容字节保真 |

### 自动化与证据要求

- 逐字比对以 `spec/agents-md.md` 中的文案为基准；全部用例写 OpenLogos reporter，测试名含对应 ID。
