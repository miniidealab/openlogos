## ADDED — S06 Authority Closure 测试设计用例

# S06：Authority Closure 测试设计用例

## 一、主路径单元测试

| ID | 场景 | 输入 | 精确期望 |
|---|---|---|---|
| UT-S06-01 | 每 fact 矩阵生成 | 一个 required fact 与完整场景 | 生成 happy/stale/conflict/writer/restart/rebuild/rollback/reverse 八维覆盖 |
| UT-S06-02 | 真实 ID 与追溯 | 已分配 UT/ST/SMOKE ID | 每个用例反向关联 fact_id 与 AC，ID 不重复 |

## 二、异常与边界单元测试

| ID | 异常/边界 | 输入 | 精确期望 |
|---|---|---|---|
| UT-S06-03 | stale 夹具不冲突 | projection 与 authority 值相同 | 拒绝为无效反例，要求显式不同值/identity |
| UT-S06-04 | restart 复用内存 | 同进程重新调用函数 | 拒绝，要求新进程和旧残留 |
| UT-S06-05 | 漏 legacy writer | required fact 无并发/旧入口用例 | coverage 未闭合，返回 fact_id 与缺失维度 |
| UT-S06-06 | 证据化 SKIP | 某故障由架构不变量证明不可发生 | 仅非空 authority_ref + rationale 时允许 SKIP；静默遗漏失败 |

## 三、场景测试

| ID | 主路径/异常 | 操作 | 精确期望 |
|---|---|---|---|
| ST-S06-01 | 完整矩阵产出 | 从 Registry + 时序生成测试规格 | 八维均有真实 ID、精确断言、fixture 与 OpenLogos reporter |
| ST-S06-02 | 漏测阻断 | 删除 restart/cutover 两维后运行覆盖检查 | 返回两条稳定问题，不首错短路，不报告测试设计完成 |

## 四、追溯与 reporter

UT-S06-01～06、ST-S06-01～02 覆盖 AC-04、AC-06～AC-08。自动化实现必须通过 OpenLogos reporter 写 `logos/resources/verify/test-results.jsonl`，并在失败时保留 fact_id/维度诊断。
