## ADDED — 八、smoke 沙箱依赖目录豁免测试（fix-sandbox-node-modules-write-audit）

## 八、smoke 沙箱依赖目录豁免测试（fix-sandbox-node-modules-write-audit）

> 覆盖 smoke 侧的沙箱写入审计依赖目录豁免（S19 EX-4.4 / 功能规格 §2.9）与白名单定点采集回收。沙箱执行器为 verify / smoke 共享，豁免匹配规则（完整路径段严格等于 `node_modules`）、symlink 隔离不变量与 infos 通道的核心逻辑由 S13 第十三节用例覆盖，本节锁定 smoke 调用面。本节用例编号顺延既有最大编号（UT-S19-07 / ST-S19-08）。用例实现必须写入 OpenLogos reporter，测试名包含对应 ID 供 verify 抽取。

### 8.1 单元测试用例补充

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S19-08 | smoke 沙箱 always 模式下 node_modules 写入同样豁免，说明走 infos 通道 | EX-4.4 / §2.9 依赖目录豁免 | 已部署且提案需要 smoke；`smoke.sandbox_mode=always`、`sandbox_deny_workspace_write=true`；项目含 `node_modules`；`smoke.command` 仅写入 `node_modules/.bin/*` 并正常写 `smoke-results.jsonl` | `openlogos smoke --format json` | smoke Gate 不因该写入 FAIL；`sandbox.status="pass"`；`sandbox.infos` 含信息级豁免说明，`sandbox.diagnostics` 不含该说明且无「检测到非白名单写入」告警，文本输出以 `ℹ️` 渲染一次；`node_modules` 之外的非白名单写入仍按 EX-4.3 FAIL（沿用既有阻断用例回归保障） |
| UT-S19-09 | smoke 结果文件位于 node_modules 下仍被定点采集回收 | §2.9 白名单回收优先 | `smoke.result_path="node_modules/.cache/openlogos/smoke-results.jsonl"`（合法配置）；`smoke.sandbox_mode=always`；`smoke.command` 在沙箱内写出该结果文件 | `openlogos smoke --format json` | 结果文件被定点采集回收到原 workspace 对应路径，smoke 正常读取结果计算门禁（不报无结果）；回收不依赖快照 diff；该路径回收不触发非白名单判定 |

### 8.2 覆盖度校验补充

- [ ] smoke 沙箱 node_modules 写入豁免 + infos 通道：UT-S19-08
- [ ] smoke 结果文件位于 node_modules 下定点采集回收：UT-S19-09
