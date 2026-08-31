## ADDED — Authority Closure 安装态 smoke（SMOKE-core-163～167）

| ID | 主路径/异常/边界 | 安装态操作 | 精确期望 |
|---|---|---|---|
| SMOKE-core-163 | candidate 资产同源主路径 | 从固定 tarball 隔离安装，核对根 spec、六 Skill、plugin/cache、manifest/hash | 全部身份一致；CLI 入口/版本/realpath 指向 candidate |
| SMOKE-core-164 | required/not_applicable 与五类 violation | 在隔离 fixture 运行合法两分支及缺失/畸形/引用/闭包/cutover 反例 | 正例 exit 0；反例 exit 2 且 code/summary 精确、无写副作用 |
| SMOKE-core-165 | stale/conflict/restart | 写入与 authority 冲突的旧 projection，丢失响应并用新进程查询 | 决定只来自 authority/receipt；旧 projection 被拒绝或重建 |
| SMOKE-core-166 | legacy writer 与 cutover | 关闭旧入口、启用新 mutation、重建投影，再调用旧入口 | 旧 writer 明确失败；新入口唯一；freshness/exit evidence 完整 |
| SMOKE-core-167 | 回滚与再安装 | candidate→冻结旧版→candidate 的实际往返安装 | 每阶段入口/版本/资产/行为对应自身版本；无混合资产，重装幂等 |

### 覆盖与 reporter

覆盖 Authority Closure required/not_applicable、AC-01～AC-08、五类机器 violation、共享 evaluator、asset freshness、writer cutover 与 rollback。执行器必须把逐 ID 结果、candidate SHA、入口、realpath 和资产 hash 写入 `logos/resources/verify/smoke-results.jsonl`；不得手工伪造 `SMOKE_PASS`。
