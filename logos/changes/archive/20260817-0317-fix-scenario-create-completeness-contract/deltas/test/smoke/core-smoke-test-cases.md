## ADDED — 场景 CREATE 完整性修复 v0.13.27 本地全局安装冒烟用例

> 适用部署：`fix-scenario-create-completeness-contract`。仅在 verify PASS、用户另行授权部署、`0.13.27` tarball 已安装到当前开发机 npm 全局环境且部署完成受控落标后，由独立 `openlogos smoke` 门执行。所有结果必须经统一 dispatcher/reporter 写入 `logos/resources/verify/smoke-results.jsonl`。

### 冒烟测试用例补充

| ID | 用例 | 来源 | 目标环境 | 前置条件 | 操作 | 通过标准 | 失败处理 |
|---|---|---|---|---|---|---|---|
| SMOKE-core-67 | 全局版本、命令路径与合同资产一致 | 部署方案“部署后成功证据”1～2 | local | 已从记录 SHA-256 的本地 tarball 全局安装；开启新 shell | 解析 `openlogos` 命令路径，执行 `openlogos --version`，读取全局 package/plugin 版本及包内规格/Skill | 路径位于预期 npm prefix；版本均精确 `0.13.27`；包内存在更新后的 `spec/baseline-closure.md`、`spec/change-management.md`、change-writer 与 scenario-architect Skills | 任一不一致即 FAIL，停止后续归档并恢复 0.13.26 |
| SMOKE-core-68 | 安装态兼容标题通过且关键词伪证据失败 | S39-AC-08～11、部署方案成功证据 3～4 | local | 隔离临时 launched 项目；准备完整 canonical/alias 参数化夹具及散文、fence、注释、少步骤、伪 Mermaid、空章节反例 | 对每个夹具用全局安装的 CLI 运行 `openlogos change-lint --format json`，保存 JSON/exit 和前后快照 | `步骤说明`、`主流程`、`主路径步骤`、`主路径`、`正常流程`、`main path` 全部 exit 0；所有反例 exit 2 且给出精确 `create_target_incomplete`；项目字节不变 | 任一假阴性/假阳性、非只读或诊断退化即 FAIL，保留 fixture 并回滚 |
| SMOKE-core-69 | 安装态 merge 缺步骤 fail-closed 与 0.13.26 回滚可用 | S39-AC-12、部署方案“失败处理与回滚” | local | 隔离临时项目有完整 P/T/D，仅 scenario CREATE 缺权威步骤；保存全项目哈希；保留 0.13.26 tarball/hash | 用全局 CLI 运行 change-lint 与 merge 负例，比较快照；随后在隔离验证窗口重新安装 0.13.26 并复核版本/路径，按部署决定恢复 0.13.27 或结束 | lint exit 2、merge 非零且无 `MERGE_PROMPT.md`/资源/guard/counter/index/marker 变化；回滚精确恢复 0.13.26、原路径与制品哈希 | merge 假通过、任何副作用或回滚失败均 FAIL，阻断 archive |

### Runner、reporter 与隔离要求

- code 阶段必须新增或更新等效 `scripts/smoke-*` runner，并接入 `logos.config.json.smoke.command` 指向的统一 dispatcher；runner 必须逐项覆盖 SMOKE-core-67～69。
- 每个用例必须写一条最终状态到 `logos/resources/verify/smoke-results.jsonl` 或配置的 `smoke.result_path`；不得手工创建 `SMOKE_PASS`。
- smoke 前运行覆盖预检，SMOKE-core-67～69 任一出现在 uncovered cases、无 reporter 行或非 PASS 时统一门失败。
- 所有夹具位于安全临时目录，不修改真实活跃提案、guard 或资源；失败时可保留诊断目录，成功后清理。
- 本组用例不执行 npm publish、Git tag、GitHub Release、官网部署、远端 push，也不把本机安装授权扩张为公开发布。

### 覆盖度结论

- [x] 健康/核心入口：由 SMOKE-core-67 的全局命令、版本和包资产覆盖。
- [x] 关键合法与异常链路：由 SMOKE-core-68 的安装态 change-lint 矩阵覆盖。
- [x] 合并纵深、无副作用与回滚：由 SMOKE-core-69 覆盖。
- [x] 数据库迁移、远端配置、密钥和静态站点不适用；本次无 DB/远端服务/GUI 部署。
