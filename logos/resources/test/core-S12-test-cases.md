## S12 Authority Registry 架构测试用例


# S12：Authority Registry 架构测试用例

## 一、主路径单元测试

| ID | 场景 | Registry 输入 | 精确期望 |
|---|---|---|---|
| UT-S12-01 | 完整 fact row | 所有最低字段和只读 projection | AC-01～AC-07 结构检查通过 |
| UT-S12-02 | 多物理副本合法 | 一个 authority、三个可重建 projection | 通过，不误判为多权威 |

## 二、异常与边界单元测试

| ID | 异常/边界 | Registry 输入 | 精确期望 |
|---|---|---|---|
| UT-S12-03 | 共同 owner | 两组件均可 write/decide | 未闭合，要求拆 fact 或选唯一 owner |
| UT-S12-04 | 无 freshness/rebuild | projection 只有路径 | 未闭合，不能作为 decision 输入 |
| UT-S12-05 | 路径型 fact_id | fact_id 等于文件路径/类名 | 拒绝，要求业务语义身份 |
| UT-S12-06 | cutover 无 exit | 新旧 writer 与永久 feature flag | 未闭合，禁止交接部署设计 |

## 三、场景测试

| ID | 主路径/异常 | 操作 | 精确期望 |
|---|---|---|---|
| ST-S12-01 | 架构设计完整交接 | 从需求提取两个 fact、生成 Registry、注入双 writer 反例再修复 | 首次反例阻断；修复后 Registry 唯一，场景/部署/测试仅引用 fact_id |

## 四、追溯与 reporter

UT-S12-01～06、ST-S12-01 覆盖 AC-01～AC-07。自动化实现必须通过 OpenLogos reporter 写 `logos/resources/verify/test-results.jsonl`。
