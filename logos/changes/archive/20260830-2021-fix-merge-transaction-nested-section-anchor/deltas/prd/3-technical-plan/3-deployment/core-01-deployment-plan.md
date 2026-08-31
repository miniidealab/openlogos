## ADDED — OpenLogos 0.14.4 嵌套章节锚修复本机全局部署方案

### 部署目标与授权边界

把嵌套章节锚同源解析修复冻结为唯一 `@miniidealab/openlogos@0.14.4` npm tarball，先在隔离 prefix 完成正反例与回滚演练，再在 verify PASS 且用户明确授权后覆盖本机全局 `openlogos@0.14.3`。部署完成后仍需独立 smoke 授权；RunLogos 原 transaction 的 submit/seal/apply 还需该仓库独立 merge 授权。

本方案不包含 npm publish、dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署或 git push。规格 merge、verify、部署、smoke、RunLogos merge 与 archive 互不替代授权。

### 部署前置与冻结事实

1. 本提案全部 Delta 已 merge，代码切片和 UT-S09-271～274、ST-S09-106～107、UT-S37-37～40、ST-S37-09～10 已真实实现并由 OpenLogos reporter 报告，`openlogos verify` 为 PASS。
2. 冻结当前本机全局 `0.14.3`：`command -v openlogos`、realpath、npm prefix、package root、package/plugin/asset manifest version/hash 与最小 transaction 行为。
3. 冻结可离线恢复的 `0.14.3` tarball、SHA-256 与可复制安装命令；若没有固定回滚制品或回滚自检失败，不得覆盖全局。
4. 冻结 RunLogos transaction `mtx_e7f7b924499d49f96aaf8a2f` 的 plan/target-set identity、7 个 slot descriptor、当前 6 个 submitted hash、唯一 missing slot、phase/classification 与正式目标 before hash。该读取只做证据，不写 RunLogos。
5. 部署输入必须绑定可追溯 source commit 或完整 source hash 集合；不得把无关脏工作区字节打入 candidate。

### 0.14.4 版本与制品身份

实现阶段必须同步以下 identity 后再 build/pack：

- CLI `package.json` 与 lockfile 根包版本；
- Claude/Codex/ZCode/Qoder/WorkBuddy 等随包 plugin manifest 版本；
- package asset manifest、managed asset hash 与需要携带版本的 schema/golden/runner 元数据；
- `openlogos --version` 编译输出与 tarball 包名版本。

禁止继续以 `0.14.3` 构建新字节。任一 package/plugin/asset 仍为旧版或出现同版异字节，candidate identity 失败，必须重新生成资产、build 与 pack。

### 构建与 Tarball 冻结

1. 在仓库真实 CLI package 执行项目规定的完整 test/build/package-assets 流程。
2. 执行真实 `npm pack --json`，记录 tarball 绝对路径、文件名、字节数、文件清单和 SHA-256；后续隔离、全局与恢复安装只能使用该固定 tarball。
3. 从解包后的 tarball 而非 workspace/source 入口核对 CLI entry、`0.14.4` version、transaction schema/contract、根规范、Skill、plugin/cache、smoke runner 与 reporter 资产。
4. 对 tarball 运行 manifest/hash 自检；任何重新 pack 都产生新 candidate identity，旧 SHA-256 立即作废。

### 隔离 Prefix 行为矩阵

使用 `mktemp -d` 创建一次性 npm prefix，安装固定 `0.14.4` tarball，并从新 shell/绝对入口执行：

| 类别 | 必须证明 |
|---|---|
| candidate identity | version、entry realpath、package/plugin/asset/schema/Skill hash 全部来自固定 tarball，无 workspace link |
| raw submit | 合法 Agent final bytes 通过声明 staging path submit；submit 不因标题路径语义拒绝 |
| nested MODIFIED | `父标题 > 叶标题` 在 before/final 唯一解析，seal/apply 完成且正式标题保持真实 level/text，不出现字面量路径标题 |
| fence/ambiguity | 围栏内伪 marker/heading被忽略；0 命中、多命中、错误父链、同锚多 writer 稳定 fail-closed |
| producer parity | change-lint、Agent verifier、OpenLogos composer 对同一 hit identity 一致；旧私有 parser/regex 不可达 |
| local reopen | 错误 Agent slot 在 seal preflight 只退回自身；修正后同 transaction completed，其它 slot hash不变 |
| apply identity | seal 后 source/before/content/parser identity 漂移均在首写前拒绝，零 journal/正式副作用 |
| rollback roundtrip | `0.14.3→0.14.4→0.14.3→0.14.4` 每阶段 entry/version/assets/行为对应固定制品，无混装 |

隔离矩阵任一失败不得覆盖本机全局；保留脱敏 fixture 与稳定错误摘要，修复后重新 verify/build/pack/install 全链路。

### 本机全局部署

只有隔离矩阵与 `0.14.3` 回滚演练全部 PASS，且用户明确授权本机部署后，才把同一 SHA-256 的 `0.14.4` tarball 安装到已冻结 npm global prefix。必须在新 shell 中清除命令 hash 并复核：

- `command -v openlogos`、realpath、package root 与安装来源；
- `openlogos --version` 精确为 `0.14.4`；
- package/plugin/asset/schema/Skill/runner identity 与 tarball 逐项一致；
- 最小嵌套锚 submit/seal/apply 正反例和 reporter 写入临时 fixture；
- 全局旧文件、缓存入口与任一 `0.14.3` 混合资产均不存在。

部署成功只表示固定 candidate 已安装；不生成 `SMOKE_PASS`，不自动执行 RunLogos transaction，不视为公开发布。

### Smoke 与 RunLogos 原事务交接

获得独立 smoke 授权后，使用本机全局绝对入口执行 SMOKE-core-168，并将逐步证据写入 `logos/resources/verify/smoke-results.jsonl`。获得 RunLogos merge 独立授权后：

1. 在 RunLogos 项目根只读核对 guard、slug、transaction ID、plan/target-set、6 个 submitted hash与唯一 missing slot仍等于冻结事实。
2. 生成产品设计目标的完整 final bytes，写入 transaction 声明 staging path并 submit；不得写正式 resources、transaction JSON、receipt 或 marker。
3. 调用 seal，证明共享 resolver 命中 `七、项目文件夹动态 watcher 交互规则 > 7.1 已打开文件外部变化感知`，phase 进入 sealed而非再次局部 reopen。
4. 调用 apply至 completed，核对 receipt、final/artifact hashes、`SPEC_MERGED` 与正式目标，确认其它 6 个 slot hash及 transaction identity 未变。
5. 失败时按 stable classification/target归因修复并重试；不 abort、不创建新 transaction、不伪造 completed/receipt/marker。

### 失败、自愈与回滚

- build/pack/隔离/回滚演练失败：不触碰全局，修复后重新 verify 和制品链。
- 全局安装或身份自检失败：立即使用冻结 `0.14.3` tarball恢复，并核验 entry/version/assets/最小行为；无法证明恢复完整时报告全局环境不一致并停止。
- smoke 失败：不得写 `SMOKE_PASS` 或 archive；修复代码后重新 verify、提升/保持合法 candidate identity、pack、部署与 smoke，或恢复固定 `0.14.3`。
- RunLogos 原事务失败：保留 transaction 权威状态；只在可归因 missing slot 上自愈。source/before/plan drift、apply journal 或 recovery_required 必须停止并按对应仓库授权处理。
- 原 transaction 成功 apply 后 rollback boundary 关闭：不得重新启用旧 parser 或用 `0.14.3` 重写该 transaction，只能前滚修复。

### 完成判据

以下证据必须分别成立：

1. 固定 `0.14.4` tarball identity 与隔离矩阵 PASS；
2. 本机全局 entry/version/package/plugin/asset 全部指向同一 candidate；
3. `0.14.3↔0.14.4` 回滚/恢复可复制且无混装；
4. SMOKE-core-168 由真实安装态 runner 唯一 PASS；
5. RunLogos 原 transaction `mtx_e7f7b924499d49f96aaf8a2f` 在独立授权后 completed，7/7 与 receipt/hash可复算；
6. npm registry、tag、release、官网和 Git 远端均零副作用。
