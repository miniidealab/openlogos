## ADDED — OpenLogos 0.16.24 本机测试环境发布（verify-self-sufficient-cases）

> 本节引用「本机测试环境脚本部署（scripts/deploy-local.mjs）」通用方案，只写本次的差异：版本号、CHANGELOG、源码回归范围、本仓 `openlogos sync` 与安装态 smoke。冻结、回滚制品、构建候选、试装、全局安装、复核与回执一律按通用方案第三～七节执行，不在本节复写。
>
> **版本与回滚身份的取值规则**：下文的 `0.16.24`、`0.16.23`、提交 `3095ac7` 都是**规划值**。候选版本 = 「部署前置与版本」第 3 条复核后实际选定的版本，升版命令、CHANGELOG 标题与 `--version` 断言取它。三个回滚动作各有自己的事实来源，互不替代：
>
> | 回滚身份 | 事实来源 | 规划值 | 用途 |
> |---|---|---|---|
> | 源码回滚常量 `LOCAL_RELEASE_ROLLBACK_VERSION` | 既有升版脚本 `cli/scripts/bump-version.mjs` 产生，等于升版前的源码版本 | `0.16.23` | 源码内的候选 / 回滚常量对；不手改 |
> | 部署脚本失败后的回装 | 本次部署回执的 `previous_version` 与 `previous_entry_sha256`，即脚本打包的部署前全局安装态 | 以回执为准 | 脚本自动回装后复核恢复结果 |
> | 成功落账后的显式回退 | 执行回退前读取 `openlogos env show test --format json` 的 `data.previous_ref`（`spec/environments.md` §7.1、§11.6） | 本次部署成功、其间无其他部署时为提交 `3095ac7`（0.16.23） | `openlogos deploy --env test --rollback` 的目标 |
>
> 部署记录分列这三项的实际值，并写明各自与规划值是否一致。部署前读到的 `test.current_ref`（计划时为 `3095ac7bd8`，0.16.23，deploy `109579c5`）单独记作审计信息，不作为回退目标的依据。部署前全局安装态与账本 `test.current_ref` 的版本可以不同，两者都如实记录，不要求相等。

### 部署目标与授权边界

把本提案的 verify 自足能力（功能规格 §2.106）装进本机全局安装态。行为差异如下：

- `verify` 在执行任何预跑命令前，先校验 `verify.requirements` 结构（`verify_requirements_invalid`），再把活跃提案「验收标准」列出的环境要求与配置对账（`acceptance_requirement_undeclared`），最后预检环境（`verify_env_not_ready`）；任一失败都不启动测试。
- UT/ST 结果可带 `reason_code` / `detail`；活跃提案改动的 UT/ST 写非平台 skip 时报 `case_tier_mismatch`，平台跳过放行并单独列出；存量非平台 skip 只出警告 `unclassified_skipped_cases`。
- `openlogos change` 的 proposal 脚手架新增「验收标准」段；`change-lint` 缺段只警告、段非法报 `acceptance_criteria_invalid`。
- `openlogos init` / `sync` 生成的 AGENTS.md / CLAUDE.md「保护范围配置」条款改为与 guard 同口径。
- 未声明环境要求、验收标准未列条目、改动用例无 skip 的项目，verify 判定与退出码不变；smoke 全部判定不变。

部署参数：

- **目标环境**：`test`（登记表 `proposal_default_env: test`，决策 C03）。登记表中 `test.deploy` 为 `mode: script`、`script: scripts/deploy-local.mjs`。
- **入口**：提案通道 `openlogos deploy --env test`，部署请求 HEAD。由 CLI 追加部署报告、写 `DEPLOY_DONE` 并勾选 `[deploy]`。部署成功后**不再**另行执行 `openlogos deploy-done`。
- **授权**：部署执行、smoke、archive 与 `git push` 各自为人类确认点，须用户逐次明确授权（`openlogos next --auto` 的 standing 授权按 CLAUDE.md 两档授权语义处理）。`test` 未配置 `promote_from` / `require_approval`。
- **版本号边界**：0.16.24 只作本机全局版本，不进入 npm registry。本方案**不含** `npm publish`、dist-tag、`git tag`、GitHub Release、官网部署或 `git push`，不改写其他仓库（包括 runlogos 与 markdown6）。

### 部署前置与版本

1. 本提案 delta 已 merge，`[code]` 切片已实现并提交，`openlogos verify` PASS。`openlogos env check` 无 error，`openlogos deploy --env test --dry-run` 通过（通用方案第三节）。
2. **本仓配置已写入**：本仓 `logos/logos.config.json` 含 `verify.requirements.checks` 中的 `linux-nondump-cc`（本提案「验收标准」条目），verify 对账通过。
3. **请求提交已提交**：部署前确认 merge 后的规格、切片代码、本仓配置与验收报告都已提交、工作区干净。未提交时按「规格合并 → 代码 → 验收报告」的顺序补提交后再部署。
   - `.claude/` 与 `logos/resources/verify/` 下的已跟踪文件以 `git add -u -- <path>` 暂存；
   - 本提案期间产生的验收历史以 `git add -f -- logos/resources/verify/history/` 暂存（不改 `.gitignore`）。
4. **版本事实复核**：读取 `cli/package.json` 当前版本，计划时为 `0.16.23`（本机全局版本，未发布到 npm）。候选为下一 patch `0.16.24`，执行 `npm view @miniidealab/openlogos@0.16.24 version` 应返回 E404。若实施前已有其他提案升版，或 registry 已存在候选版本号，候选改为「当时版本与 registry 最高版本中较大者的下一 patch」，并在部署记录写明实际值。
5. **升版**：在实现中执行 `node cli/scripts/bump-version.mjs <候选版本>`（规划值 `0.16.24`），由脚本一次更新全部版本载体与候选 / 回滚常量，并重算 `cli/asset-manifest.json`；**禁止手改**常量与 manifest。
6. **CHANGELOG**：在 `## [Unreleased]` 之后新增 `## [<候选版本>]` 条目（规划值 `## [0.16.24]`），注明「本机全局发布（未发布到 npm）」，不改既有条目：
   - **Added**：`verify.requirements`（环境变量、命令、检查命令）与预检，诊断 `verify_env_not_ready`；proposal「验收标准」段与对账诊断 `acceptance_requirement_undeclared`；UT/ST 结果的 `reason_code` / `detail` 与平台跳过列表。
   - **Changed**：活跃提案改动的 UT/ST 写非平台 skip 时 verify 判 FAIL（`case_tier_mismatch`）；存量非平台 skip 出警告 `unclassified_skipped_cases`；`[manual]` 改为「需要人参与」并以换版本判据判断；生成指令的保护范围条款只禁止直接修改 `guard` 字段与忽略规则文件。

### 源码回归范围

部署前的 verify 负责源码回归，脚本不跑测试（通用方案第八节）。升版后复跑以下检查，必须全绿：

- `cd cli && npm run lint`（0 error）、`npx tsc --noEmit`、`npm test`、`npm run build`。
- 范围包括：
  - 本提案的 UT-S13-157～UT-S13-179、ST-S13-40～ST-S13-43、UT-S09-490～UT-S09-492、UT-S35-225～UT-S35-230、UT-S08-90～UT-S08-92；
  - S13 既有用例，尤其账本一致性、skip 有效通过（EX-7.4）、人工用例判定、预跑失败、模块范围、模块验收报告、沙箱执行与验收历史（含旧版历史记录的读取）；S14 `launch` 对模块验收报告的判定；未声明要求时的零变化由 UT-S13-169 锚定；
  - S35 既有 change-lint 用例、S09 脚手架与生成指令相关用例（含随文案更新的既有断言与基准）；
  - verify / smoke golden；asset-manifest 自洽用例。
- 版本相关的既有用例若断言具体版本号，随升版更新期望值。

### 部署、sync 与部署后检查

1. 执行 `openlogos deploy --env test`（提案通道）。按通用方案第七节第 1、2 条读回回执与账本：
   - 全局 `--version` 等于候选版本（规划值 `0.16.24`）；
   - 入口 realpath 等于回执 `entry_realpath`，全局 `dist/index.js` 的 SHA-256 等于 `candidate_entry_sha256`；
   - 记录候选 tarball 与回滚制品的路径与 SHA-256，从回执读取并记录 `previous_version` 与 `previous_entry_sha256`；
   - 部署前读取 `openlogos env show test --format json` 的 `data.current_ref` 记作审计信息；部署成功后再次读取，记录 `data.current_ref`（应为本次部署的提交）与 `data.previous_ref`（显式回退目标）。
2. **本仓 sync**：在主工作树执行一次 `openlogos sync`。
   - 读回 `logos/spec/` 下受托管的规范文件，与根 `spec/` 同名文件逐字节一致；
   - AGENTS.md / CLAUDE.md 的变化只来自托管内容与版本戳，其中「保护范围配置」条款为新口径；
   - 受版本控制的托管文件变化随部署记录一起提交，不 push；
   - 若 sync 改动 `.claude/settings.json`，按前几版部署记录同样还原并记录。
3. **补部署报告**：部署后追加人写的「部署报告」小节（版本、deploy_id、ref、制品哈希、sync 读回结果）并提交，然后才执行 smoke。
4. 经授权执行 `openlogos smoke --env test`：
   - 本次行为用例：「OpenLogos 0.16.24 verify 自足安装态 smoke（SMOKE-core-338 起）」；
   - 通用安装态用例：「本机测试环境脚本部署安装态 smoke（SMOKE-core-268～SMOKE-core-271）」。
   本仓产生的 smoke 历史随部署记录提交时以 `git add -f` 纳入。

### 失败处置与回滚

处置按通用方案第五节，各动作按上文「版本与回滚身份的取值规则」使用各自的事实来源。本次差异如下：

- **部署前置或 dry-run 失败**：不执行部署，修正后重试，或回流实现。
- **脚本失败（部署未成功）**：脚本自动回装回滚制品，按本次回执复核：全局 `--version` 等于回执 `previous_version`，入口 SHA-256 等于回执 `previous_entry_sha256`。账本记 `result=failed`，不推进。
- **成功部署后要回退**：先读取 `openlogos env show test --format json` 的 `data.previous_ref`，核对它就是要回到的版本（计划时为提交 `3095ac7` 的 0.16.23，不含本能力），再执行 `openlogos deploy --env test --rollback`。视图值为 null 时命令以 `DEPLOY_ROLLBACK_TARGET_MISSING` 拒绝，不得改用手工回装。回退后用回退到的版本在本仓执行一次 `openlogos sync`。
- **成功落账后 smoke 失败**：停止后续完成流程，保留失败证据，回流修复后以 `openlogos deploy --env test` 部署修复提交并重跑 smoke。不得手工回装旧包。
- 本次无数据迁移：结果账本与配置只新增可选字段，不改写任何既有持久文件。

### 明确不做

- 不执行 `npm publish`、dist-tag、`git tag`、`gh release`、`git push`，不部署官网。
- 不改 `.gitignore`；不改写其他仓库（包括 runlogos 与 markdown6）。markdown6 侧按新规则迁移用例、RunLogos 侧识别新诊断码（RunLogos #35），均不属于本方案。

### 追溯

- 需求：AC-VERIFY-SELF-12；功能规格：§2.106；决策：C03。
- 安装态 smoke：`core-smoke-test-cases.md`「OpenLogos 0.16.24 verify 自足安装态 smoke（SMOKE-core-338 起）」。
