## ADDED — OpenLogos 0.14.0 merge transaction 全局安装态 Smoke

### 冒烟测试用例

| 用例 ID | 场景 | 必须通过的真实断言 |
|---|---|---|
| SMOKE-core-141 | 全局命令与版本 | 新 shell 的 `command -v openlogos` 指向部署记录路径，`--version` 精确为 0.14.0 |
| SMOKE-core-142 | 随包合同自检 | tarball SHA、merge transaction schema、双语 Skill 与 contract hash 全部匹配冻结值 |
| SMOKE-core-143 | 纯 CREATE transaction | 全局 CLI 完成 slot→seal→apply，目标/receipt/marker 同批出现 |
| SMOKE-core-144 | 纯 MODIFY transaction | before/final hash、正式字节、receipt 与重复读取一致 |
| SMOKE-core-145 | 多根 mixed transaction | resources/spec/skills/test/decision/metadata 20+ targets 全批提交 |
| SMOKE-core-146 | validator retry | 首次 seal retryable，原子替换 slot 后同 transaction 完成 |
| SMOKE-core-147 | no-delta 与 UI | 零 slot 和 UI 绑定分支都生成同形 receipt，无旁路 marker |
| SMOKE-core-148 | status 只读与动作权威 | status/next 同源，调用前后目标树不变，只执行 allowed action |
| SMOKE-core-149 | 崩溃恢复与 response lost | journal 故障注入后只得全旧/全新，重复 apply 返回同 receipt |
| SMOKE-core-150 | RunLogos candidate 接缝 | 下游仅通过冻结全局路径完成真实 E2E；源码/mock/手工 target 对照组被拒绝 |

### Runner 约束

1. runner 必须在隔离临时项目中调用部署后的绝对全局 `openlogos`，不得调用仓库 `cli/dist`、ts runner、npm link 或 mock。
2. SMOKE-core-143～149 使用真实命令子进程与文件系统；除 transaction 声明的 Agent slot 外，不得手工写正式 target、metadata、receipt 或 `SPEC_MERGED`。
3. SMOKE-core-150 由 RunLogos 真实 AgentAdapter/WorkUnit/DriverCommandExecutor 接缝驱动，至少覆盖 CREATE、MODIFY、mixed 和 response-lost；预造 completed transaction 无效。
4. runner 调用图不得包含 npm publish、Git tag、GitHub Release、官网部署或 git push。
5. 任一用例缺失、skip、fail、重复矛盾、candidate 路径/版本/hash 不符或 reporter 缺失，smoke Gate 必须 FAIL。

### Reporter 约束

每个用例向 `logos/resources/verify/smoke-results.jsonl` 追加一条 OpenLogos reporter 记录，至少包含：

- `id`、`status`、`timestamp`、`duration_ms`、`environment="local-global"`；
- candidate command basename/允许披露的路径摘要、版本、tarball SHA-256；
- schema hash、contract hash、transaction/receipt hash；
- 脱敏 evidence 与失败阶段。

只有 SMOKE-core-141～150 全部真实 pass 且无 uncovered，才能写 `SMOKE_PASS`。RunLogos 跨仓 E2E 结果必须与 OpenLogos smoke report 中冻结的 candidate facts 对账。
