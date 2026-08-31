## ADDED — S19 Authority Closure candidate/回滚测试

### 单元测试

| ID | 场景 | 输入 | 精确期望 |
|---|---|---|---|
| UT-S19-26 | asset manifest 同源 | 根 spec/六 Skill/package/plugin/cache hash | 全一致通过；任一字节漂移返回具体资产失败 |
| UT-S19-27 | cutover 顺序 | old stop/new start/rebuild/probe/exit 事件流 | 仅规范顺序通过；旧 writer 仍成功或无 exit 失败 |
| UT-S19-28 | rollback identity | 冻结旧 tarball、candidate、入口/realpath/hash | candidate 失败后恢复字节等价旧安装；再次安装 candidate 幂等 |

### 场景测试

| ID | 场景 | 操作序列 | 精确期望 |
|---|---|---|---|
| ST-S19-17 | 隔离安装与 writer 切换 | pack 固定 candidate→隔离安装→负向矩阵→旧 writer 拒绝→投影重建→旧版回滚→candidate 重装 | 入口/版本/资产/行为全闭合；结果进入 reporter；无混合安装与伪 marker |

### 追溯与 reporter

覆盖 AC-03～AC-08 及部署回滚。实现必须使用 OpenLogos reporter 写 `logos/resources/verify/test-results.jsonl`，smoke 结果另写 `smoke-results.jsonl`。
