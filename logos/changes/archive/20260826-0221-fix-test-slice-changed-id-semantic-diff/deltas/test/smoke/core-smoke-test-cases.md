## ADDED — 测试变更语义修复 `0.13.30` 本机全局 Smoke

### 范围与统一前置条件

- 环境：`local-global`；部署报告证明当前实际 `openlogos` 来自本次真实 `@miniidealab/openlogos@0.13.30` tarball，且已完成 `0.13.30 → 0.13.29 → 0.13.30` 部署演练。
- fixture：所有 merge/篡改/无 Git 测试只在一次性项目副本执行，禁止对本仓库活跃提案、真实用户项目或正式全局配置写入。
- 门禁：最终 verify PASS、全部 `[deploy]` 已完成、全局部署完成，且用户另行明确授权 smoke。
- runner：统一 smoke dispatcher 必须发现本节五个真实 ID，并通过随包 OpenLogos reporter 写入配置声明的 smoke JSONL；旧结果、mock 或手写 PASS 不得补齐。
- 边界：禁止 npm publish/dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署和 `git push`；无需 registry、发布或业务凭据。

### 冒烟测试用例

| ID | 验证点 | 操作 | 通过标准与证据 |
|---|---|---|---|
| SMOKE-core-130 | `0.13.30` 全局制品与入口身份 | 在新 shell 解析命令 realpath/npm prefix，读取 CLI、package 与有版本字段的 plugin metadata；校验部署报告中的 tarball 清单、大小与 SHA-256 | 实际入口位于记录的全局 prefix 并关联候选 tarball；CLI/package/Claude/Codex/ZCode/Qoder/WorkBuddy 版本均精确 `0.13.30`；不存在 workspace link、源码入口、旧缓存或 registry 替代 |
| SMOKE-core-131 | 安装态事故 fixture 得到精确六 ID | 在一次性项目构造事故 before/final，使用全局 CLI 的真实 merge-apply 写出正式 test target 与 `SPEC_MERGED`，再生成/验证 slice manifest | C 精确为 ST-S10-44、UT-S10-129、UT-S10-137、UT-S10-138、UT-S10-139、UT-S10-140；UT-S10-121～128 与 ST-S10-36～39 原样 ID 留在 baseline 且不 owned；无 18-ID 假阳性，marker/target hash 合法 |
| SMOKE-core-132 | 安装态 missing/unknown/duplicate 与 removed 语义 | 在独立 fixture 依次漏配一个 C、把 baseline/R 放入 owned、把同一 C 多片归属，并构造一个仅删除 ID | 漏配返回 missing，baseline/R owned 返回 unknown，多片返回 duplicate/ambiguous；removed 只在 R，不要求定义存在或 owned；每个负例在 runner 前失败且 checkpoint/Gate/loop/marker 无变化 |
| SMOKE-core-133 | 无 Git 重启一致与篡改 fail-closed | 成功 fixture 后移除 Git 元数据并启动新进程，比较 C/R/hash；再分别篡改 change-set schema/payload hash、target identity 与正式 target 字节 | 未篡改时跨进程输出逐字节一致且无 Git 调用；每个篡改均 `manifest_status=invalid`、human action required，不派 `plan-slices`、不启动 runner、不产生 verify/slice 副作用 |
| SMOKE-core-134 | 全局真实回滚恢复与公开副作用为零 | 复核部署证据并在同一全局 prefix 用固定本地 tarball实际执行 `0.13.30 → 0.13.29 → 0.13.30`；每步开新 shell检查 realpath/版本，最终重跑 SMOKE-core-131 最小断言 | 两个 tarball 包名/版本/SHA 固定；两次切换与最终恢复可证，最终六 ID 仍正确；本仓库/用户项目未触达；npm publish/dist-tag、Git tag、GitHub Release、官网/Cloudflare 与 push 调用均为零 |

### 判定与 Reporter 合同

- 每个 runner 必须写一行合法 JSONL，至少包含 `id`、`status`、`timestamp`、`duration_ms`、`environment: "local-global"`、候选与回滚 tarball SHA-256、全局入口 realpath 和脱敏 evidence 路径；失败还须包含 error。
- SMOKE-core-130～SMOKE-core-134 任一缺失、skip、fail、重复矛盾、环境/tarball identity 不匹配、runner/reporter 未发现或证据审计失败，均不得生成 `SMOKE_PASS`。
- SMOKE-core-131 必须保存 before/final/marker 的脱敏 hash 与逐 ID C/B 断言；不得保存真实用户数据，也不得把数组长度当作充分证据。
- SMOKE-core-132/133 必须保存命令、exit code、violation、写入哨兵和前后文件 SHA-256；看到错误文案但发生副作用不算通过。
- SMOKE-core-134 必须实际切换全局包；“部署报告曾演练”或“理论可回滚”不能替代本次 smoke 的真实证据。

### 清理与失败边界

- 成功后只可清理本次显式创建且 realpath 已核验的一次性 fixture；不得宽泛递归删除仓库、HOME、npm prefix 或未知路径。
- 失败保留脱敏 fixture/evidence 供诊断，并按部署方案恢复 `0.13.29` 或部署前版本；恢复失败必须显式报告，不得写 `SMOKE_PASS`。
- 全部 PASS 只证明本机全局 `0.13.30` 候选可工作并可回滚，不构成任何公开发布、远程部署或 push 授权。

### 覆盖度校验

- [ ] 全局 tarball、入口与版本 identity：SMOKE-core-130
- [ ] 跨仓事故精确六 ID 与 baseline 原样保留：SMOKE-core-131
- [ ] missing/unknown/duplicate/removed 分层语义：SMOKE-core-132
- [ ] 无 Git 重启稳定与篡改 fail-closed：SMOKE-core-133
- [ ] `0.13.30 → 0.13.29 → 0.13.30` 真实回滚恢复及公开副作用为零：SMOKE-core-134
