## S04 Authority Closure 场景建模测试用例


# S04：Authority Closure 场景建模测试用例

## 一、主路径单元测试

| ID | 场景 | 输入 | 精确期望 |
|---|---|---|---|
| UT-S04-01 | Registry fact 映射 | 单一 owner/writer、两个只读 projection | sequence diagram 生成唯一 authority/mutation/decision 与 freshness 消息 |
| UT-S04-02 | command/query 分离 | command 写 authority、query 读 projection | 写入只指向 mutation entry；query 含 freshness 验证 |

## 二、异常与边界单元测试

| ID | 异常/边界 | 输入 | 精确期望 |
|---|---|---|---|
| UT-S04-03 | 双 writer | 两个参与者均直接写同一 fact | 停止交付并返回架构阶段，不生成 last-write-wins |
| UT-S04-04 | projection 反向恢复 | response lost 分支扫描 marker/mtime | 判定违规，要求从 authority transaction/receipt 恢复 |

## 三、场景测试

| ID | 主路径/异常 | 操作 | 精确期望 |
|---|---|---|---|
| ST-S04-01 | 完整 Authority Closure 时序 | 输入 fact、projection、stale 与 restart 场景并运行 scenario-architect 产物检查 | 时序含 command/write/refresh/decision/recovery；双 writer 反例 fail closed；追溯 AC-01～AC-06 |

## 四、追溯与 reporter

| 规范 | 覆盖 |
|---|---|
| AC-01/AC-02 | UT-S04-01、UT-S04-03、ST-S04-01 |
| AC-03/AC-04 | UT-S04-02、ST-S04-01 |
| AC-05/AC-06 | UT-S04-04、ST-S04-01 |

所有自动化实现必须使用 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`；不得以手工 JSONL 或族名占位替代真实 ID。
