## S07 Shadow Authority 代码审查测试用例


# S07：Shadow Authority 代码审查测试用例

## 一、主路径单元测试

| ID | 场景 | 代码夹具 | 精确期望 |
|---|---|---|---|
| UT-S07-01 | 唯一 mutation entry | 所有写调用统一 command handler | 无 Critical，证据指向 sole writer |
| UT-S07-02 | 共享 decision evaluator | status/next/flow 调同一 evaluator | 无复制谓词；同源证据完整 |

## 二、异常与边界单元测试

| ID | 异常/边界 | 代码夹具 | 精确期望 |
|---|---|---|---|
| UT-S07-03 | 旁路写 | consumer 直接修改 canonical file | Critical：AC-02，要求删除旁路 |
| UT-S07-04 | 本地完成谓词 | status 复制 phase/marker 判据 | Critical：AC-05，改为共享 evaluator |
| UT-S07-05 | heuristic recovery | catch 后扫描目录/mtime | Critical：AC-06，改查 authority/receipt |
| UT-S07-06 | 永久双 writer flag | 旧/新入口均可成功 | Critical：AC-07，要求有限 cutover 与旧入口拒绝 |

## 三、场景测试

| ID | 主路径/异常 | 操作 | 精确期望 |
|---|---|---|---|
| ST-S07-01 | 多类影子权威审查 | 对含四类缺陷的 fixture 运行 reviewer 检查 | 四条 Critical 均含 fact_id、代码位置、AC、修复动作与测试 ID |
| ST-S07-02 | 修复后闭环 | 删除旁路/本地 parser/scan/旧 writer并重审 | Critical 清零；负向测试仍能制造 stale/conflict/restart |

## 四、追溯与 reporter

覆盖 AC-02、AC-05～AC-08。所有自动化实现使用 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`；不得用注释或“最终一致”文本关闭 Critical。
