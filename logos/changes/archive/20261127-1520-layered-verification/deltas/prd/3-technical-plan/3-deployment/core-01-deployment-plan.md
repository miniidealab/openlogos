## ADDED — OpenLogos 0.16.27 本机测试环境发布（layered-verification）

> 本节引用「本机测试环境脚本部署（scripts/deploy-local.mjs）」通用方案，只写本次的差异：版本号、CHANGELOG、源码回归范围、本仓 `openlogos sync` 与安装态 smoke。冻结、回滚制品、构建候选、试装、全局安装、复核与回执，一律按通用方案第三～七节执行，不在本节复写。
>
> **版本与回滚身份的取值规则**：下文的 `0.16.27`、`0.16.26`、提交 `c3c7a9e` 都是**规划值**。候选版本 = 「部署前置与版本」第 3 条复核后实际选定的版本，升版命令、CHANGELOG 标题与 `--version` 断言都取它。三个回滚动作各有自己的事实来源，互不替代：
>
> | 回滚身份 | 事实来源 | 规划值 | 用途 |
> |---|---|---|---|
> | 源码回滚常量 `LOCAL_RELEASE_ROLLBACK_VERSION` | 既有升版脚本 `cli/scripts/bump-version.mjs` 产生，等于升版前的源码版本 | `0.16.26` | 源码内的候选 / 回滚常量对；不手改 |
> | 部署脚本失败后的回装 | 本次部署回执的 `previous_version` 与 `previous_entry_sha256`，即脚本打包的部署前全局安装态 | 以回执为准 | 脚本自动回装后复核恢复结果 |
> | 成功落账后的显式回退 | 执行回退前读取 `openlogos env show test --format json` 的 `data.previous_ref`（`spec/environments.md` §7.1、§11.6） | 本次部署成功、期间无其他部署时，为提交 `c3c7a9e`（0.16.26） | `openlogos deploy --env test --rollback` 的目标 |
>
> 部署记录分列这三项的实际值，并写明各自与规划值是否一致。部署前读到的 `test.current_ref`（计划时为 `c3c7a9e3772f`，0.16.26）单独记作审计信息，不作为回退目标的依据。

### 部署目标与授权边界

把本提案的分层验收（功能规格 §2.109）装进本机全局安装态。行为差异如下：

- 测试用例文档可以用「主链路用例」小节标出主链路；`openlogos change` 的提案脚手架新增「受影响场景」段；`openlogos change-lint` 检查两者。
- `verify.layered.enabled: true` 的项目，`openlogos verify` 的提案级验收以「本提案用例 ∪ 受影响用例 ∪ 主链路用例」为验收集合；评估不可用或涉及共享改动时扩大范围；主链路小节写错、超过上限或主链路用例偶发时判 FAIL。
- 新增 `openlogos verify --release`（干净工作区上实际执行全量，结论与执行前固定的提交号绑定，写独立的发布级报告）与 `openlogos verify --release --check`（查询某个提交在当前平台上是否有有效的发布级结论）。
- JSON 输出恒带 `level`；验收历史记录 `level`、`platform`。
- 分层缺省关闭：未开启且不使用 `--release` 的项目，验收范围、门禁、报告与退出码不变。

部署参数：

- **目标环境**：`test`（登记表 `proposal_default_env: test`，决策 C06）。登记表中 `test.deploy` 为 `mode: script`、`script: scripts/deploy-local.mjs`。本提案不改登记表。
- **入口**：提案通道执行 `openlogos deploy --env test`，部署请求 HEAD。由 CLI 追加部署报告、写 `DEPLOY_DONE` 并勾选 `[deploy]`；部署成功后**不再**另行执行 `openlogos deploy-done`。
- **授权**：部署执行、smoke、archive 与 `git push` 各自是人类确认点，须用户逐次明确授权（`openlogos next --auto` 的 standing 授权按 CLAUDE.md 两档授权语义处理）。`test` 未配置 `promote_from` / `require_approval`，未开启人工验收。
- **版本号边界**：0.16.27 只作本机全局版本，不进入 npm registry。本方案**不含** `npm publish`、dist-tag、`git tag`、GitHub Release、官网部署或 `git push`，不改写其他仓库（包括 runlogos 与 markdown6）。

### 部署前置与版本

1. 本提案 delta 已 merge，`[code]` 切片已实现并提交，`openlogos verify` PASS。`openlogos env check` 无 error，`openlogos deploy --env test --dry-run` 通过（通用方案第三节）。
2. **请求提交已提交**：部署前确认 merge 后的规格、切片代码与验收报告都已提交、工作区干净。未提交时按「规格合并 → 代码 → 验收报告」的顺序补提交后再部署。
   - `.claude/` 与 `logos/resources/verify/` 下的已跟踪文件，以 `git add -u -- <path>` 暂存；
   - 本提案期间产生的验收历史，以 `git add -f -- logos/resources/verify/history/` 暂存（不改 `.gitignore`）。
3. **版本事实复核**：读取 `cli/package.json` 当前版本（计划时为 `0.16.26`，本机全局版本，未发布到 npm）。候选为下一 patch `0.16.27`，执行 `npm view @miniidealab/openlogos@0.16.27 version` 应返回 E404。若实施前已有其他提案升版，或 registry 已存在候选版本号，候选改为「当时版本与 registry 最高版本中较大者的下一 patch」，并在部署记录中写明。
4. **升版**：在实现中执行 `node cli/scripts/bump-version.mjs <候选版本>`（规划值 `0.16.27`），由脚本一次更新全部版本载体与候选 / 回滚常量，并重算 `cli/asset-manifest.json`；**禁止手改**常量与 manifest。
5. **CHANGELOG**：在 `## [Unreleased]` 之后新增 `## [<候选版本>]` 条目（规划值 `## [0.16.27]`），注明「本机全局发布（未发布到 npm）」，不改既有条目：
   - **Added**：
     - 测试用例文档的「主链路用例」小节；提案脚手架的「受影响场景」段及 change-lint 检查；
     - 配置 `verify.layered`（`enabled`、`main_path_max`、`shared_paths`）；分层开启时提案级验收跑三层合集，JSON 新增 `level`、`layers`，门禁原因 `main_path_invalid`、`main_path_over_limit`、`main_path_flaky`，警告 `layered_runner_not_narrowed`；
     - `openlogos verify --release` 与 `openlogos verify --release --check`；发布级报告 `logos/resources/verify/release/acceptance-report.md`；
     - 验收历史 `level`、`platform`，`history list --level / --commit`。
   - **Changed**：
     - 开启 `verify.layered.enabled` 的项目，提案级验收不再执行全量（缺省关闭）。

### 源码回归范围

部署前的 verify 负责源码回归，脚本不跑测试（通用方案第八节）。升版后复跑以下检查，必须全绿：

- `cd cli && npm run lint`（0 error）、`npx tsc --noEmit`、`npm test`、`npm run build`。
- 范围包括：
  - 本提案的 UT-S13-217 起、ST-S13-48 起、UT-S09-504 起、UT-S35-231 起、UT-S32-118 起；
  - S13 既有用例，尤其是：门禁原因优先级、按模块限定范围（含未启用时的零回归基线）、切片 checkpoint 与 final、失败复跑与偶发判定、verify 自足（环境预检、跳过分类）、验收历史的写入与读取、结果路径运行锁、报告保留路径；
  - S09 的提案脚手架基线（只允许新增「受影响场景」段）、S35 的 change-lint 既有检查、S32 的切片验收范围；
  - verify golden，asset-manifest 自洽用例；提案脚手架、两个技能及其插件副本的同步用例。
- **本仓不开启分层**：本仓 `logos/logos.config.json` 不写 `verify.layered`，本仓的提案验收保持全量。在部署记录中写明这一点；本仓是否开启由用户另行决定。
- 版本相关的既有用例若断言具体版本号，随升版更新期望值。

### 部署、sync 与部署后检查

1. 执行 `openlogos deploy --env test`（提案通道），按通用方案第七节第 1、2 条读回回执与账本：
   - 全局 `--version` 等于候选版本（规划值 `0.16.27`）；
   - 入口 realpath 等于回执 `entry_realpath`，全局 `dist/index.js` 的 SHA-256 等于 `candidate_entry_sha256`；
   - 记录候选 tarball 与回滚制品的路径与 SHA-256，从回执读取并记录 `previous_version` 与 `previous_entry_sha256`；
   - 部署前读取 `openlogos env show test --format json` 的 `data.current_ref`，记作审计信息；部署成功后再读一次，记录 `data.current_ref`（应为本次部署的提交）与 `data.previous_ref`（显式回退目标）。
2. **本仓 sync**：在主工作树执行一次 `openlogos sync`。
   - 读回 `logos/spec/` 下受托管的规范文件，与根 `spec/` 同名文件逐字节一致；
   - `logos/skills/` 下 change-writer、test-writer 的托管副本随根 `skills/` 更新；AGENTS.md / CLAUDE.md 的变化只来自托管内容与版本戳，本提案不改生成指令文案；
   - 受版本控制的托管文件变化随部署记录一起提交，不 push；
   - 若 sync 改动了 `.claude/settings.json`，按前几版部署记录同样还原并记录。
3. **补部署报告**：部署后追加人写的「部署报告」小节（版本、deploy_id、ref、制品哈希、sync 读回结果）并提交，然后再执行 smoke。
4. 经授权执行 `openlogos smoke --env test`，覆盖两组用例：
   - 本次行为用例：「OpenLogos 0.16.27 分层验收安装态 smoke（SMOKE-core-352 起）」；
   - 通用安装态用例：「本机测试环境脚本部署安装态 smoke（SMOKE-core-268～SMOKE-core-271）」。

   本仓产生的 smoke 历史随部署记录提交时以 `git add -f` 纳入。

### 失败处置与回滚

处置按通用方案第五节，各动作使用上文「版本与回滚身份的取值规则」中各自的事实来源。本次差异如下：

- **部署前置或 dry-run 失败**：不执行部署，修正后重试，或回流实现。
- **脚本失败（部署未成功）**：脚本自动回装回滚制品，按本次回执复核：全局 `--version` 等于回执 `previous_version`，入口 SHA-256 等于回执 `previous_entry_sha256`。账本记 `result=failed`，流程不推进。
- **成功部署后要回退**：
  - 先读取 `openlogos env show test --format json` 的 `data.previous_ref`，核对它就是要回到的版本（计划时为提交 `c3c7a9e` 的 0.16.26，不含本能力），再执行 `openlogos deploy --env test --rollback`。
  - 视图值为 null 时，命令以 `DEPLOY_ROLLBACK_TARGET_MISSING` 拒绝，不得改用手工回装。
  - 回退后，由 0.16.27 写入的验收历史记录中的 `level`、`platform` 字段被 0.16.26 忽略，记录照常可读；0.16.26 不认识 `--release`，也不读取主链路小节、「受影响场景」段与 `verify.layered`，开启了分层的项目回退后提案验收恢复全量。
- **成功落账后 smoke 失败**：停止后续完成流程，保留失败证据，回流修复后以 `openlogos deploy --env test` 部署修复提交并重跑 smoke。不得手工回装旧包。
- 本次无数据迁移：验收历史只新增可选字段，不改写任何既有持久文件。

### 明确不做

- 不执行 `npm publish`、dist-tag、`git tag`、`gh release`、`git push`，不部署官网。
- 不改 `.gitignore`、不改本仓 `logos/environments.yaml`、不在本仓开启分层；不改写其他仓库。RunLogos 的测试入口适配与 driver 按三层跑提案验收、Team 的执行机调度与发布门，不属于本方案。

### 追溯

- 需求：AC-VERIFY-TIER-01～AC-VERIFY-TIER-22；功能规格：§2.109；决策：C06。
- 安装态 smoke：`core-smoke-test-cases.md`「OpenLogos 0.16.27 分层验收安装态 smoke（SMOKE-core-352 起）」。
