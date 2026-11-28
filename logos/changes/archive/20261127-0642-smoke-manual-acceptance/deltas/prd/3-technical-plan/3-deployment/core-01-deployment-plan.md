## ADDED — OpenLogos 0.16.25 本机测试环境发布（smoke-manual-acceptance）

> 本节引用「本机测试环境脚本部署（scripts/deploy-local.mjs）」通用方案，只写本次的差异：版本号、CHANGELOG、源码回归范围、本仓 `openlogos sync` 与安装态 smoke。冻结、回滚制品、构建候选、试装、全局安装、复核与回执，一律按通用方案第三～七节执行，不在本节复写。
>
> **版本与回滚身份的取值规则**：下文的 `0.16.25`、`0.16.24`、提交 `aa1d9fd` 都是**规划值**。候选版本 = 「部署前置与版本」第 3 条复核后实际选定的版本，升版命令、CHANGELOG 标题与 `--version` 断言都取它。三个回滚动作各有自己的事实来源，互不替代：
>
> | 回滚身份 | 事实来源 | 规划值 | 用途 |
> |---|---|---|---|
> | 源码回滚常量 `LOCAL_RELEASE_ROLLBACK_VERSION` | 既有升版脚本 `cli/scripts/bump-version.mjs` 产生，等于升版前的源码版本 | `0.16.24` | 源码内的候选 / 回滚常量对；不手改 |
> | 部署脚本失败后的回装 | 本次部署回执的 `previous_version` 与 `previous_entry_sha256`，即脚本打包的部署前全局安装态 | 以回执为准 | 脚本自动回装后复核恢复结果 |
> | 成功落账后的显式回退 | 执行回退前读取 `openlogos env show test --format json` 的 `data.previous_ref`（`spec/environments.md` §7.1、§11.6） | 本次部署成功、期间无其他部署时，为提交 `aa1d9fd`（0.16.24） | `openlogos deploy --env test --rollback` 的目标 |
>
> 部署记录分列这三项的实际值，并写明各自与规划值是否一致。部署前读到的 `test.current_ref`（计划时为 `aa1d9fdd8e`，0.16.24，deploy `aefa9a8f`）单独记作审计信息，不作为回退目标的依据。

### 部署目标与授权边界

把本提案的冒烟阶段人工验收能力（功能规格 §2.107）装进本机全局安装态。行为差异如下：

- SMOKE 规格首格可带 `[manual]` / `[manual/<平台>]`。人工 SMOKE 不进自动集合、不要求 runner，整份文件只有人工行时不再触发全文回退；结果文件出现人工 SMOKE 时报 `manual_smoke_result_id`。
- 登记表环境条目可写 `manual_acceptance: {enabled, regression}`。开启后，smoke 在自动阶段通过时计算待验收清单：
  - 还有未记录的用例：`gate.result=PENDING`，账本写 `result=pending` 的 smoke 行；
  - 全部通过：PASS，`manual_passed=true`；
  - 有失败、清单无法确定或回归用例失效：FAIL。
- 新命令 `openlogos accept`（guard 受限）把人工结果写进本机账本，并绑定当前部署。
- next / status 新增驻留态 `awaiting-manual-acceptance`；archive 在环境已开启人工验收（即使本部署没有任何人工记录），或本部署已有人工记录时，以账本核对本部署自己的最近有效结论（`smoke_pass_expired`）；晋级只认未过期的通过记录。
- 生成指令硬红线新增「等待人工验收」。
- 未配置 `manual_acceptance`、没有人工用例的项目：所有命令的判定、写入与退出码不变。

部署参数：

- **目标环境**：`test`（登记表 `proposal_default_env: test`，决策 C03）。登记表中 `test.deploy` 为 `mode: script`、`script: scripts/deploy-local.mjs`。本仓登记表**不**开启人工验收，也不改登记表。
- **入口**：提案通道执行 `openlogos deploy --env test`，部署请求 HEAD。由 CLI 追加部署报告、写 `DEPLOY_DONE` 并勾选 `[deploy]`；部署成功后**不再**另行执行 `openlogos deploy-done`。
- **授权**：部署执行、smoke、archive 与 `git push` 各自是人类确认点，须用户逐次明确授权（`openlogos next --auto` 的 standing 授权按 CLAUDE.md 两档授权语义处理）。`test` 未配置 `promote_from` / `require_approval`。
- **版本号边界**：0.16.25 只作本机全局版本，不进入 npm registry。本方案**不含** `npm publish`、dist-tag、`git tag`、GitHub Release、官网部署或 `git push`，不改写其他仓库（包括 runlogos 与 markdown6）。

### 部署前置与版本

1. 本提案 delta 已 merge，`[code]` 切片已实现并提交，`openlogos verify` PASS。`openlogos env check` 无 error，`openlogos deploy --env test --dry-run` 通过（通用方案第三节）。
2. **请求提交已提交**：部署前确认 merge 后的规格、切片代码与验收报告都已提交、工作区干净。未提交时按「规格合并 → 代码 → 验收报告」的顺序补提交后再部署。
   - `.claude/` 与 `logos/resources/verify/` 下的已跟踪文件，以 `git add -u -- <path>` 暂存；
   - 本提案期间产生的验收历史，以 `git add -f -- logos/resources/verify/history/` 暂存（不改 `.gitignore`）。
3. **版本事实复核**：读取 `cli/package.json` 当前版本（计划时为 `0.16.24`，本机全局版本，未发布到 npm）。候选为下一 patch `0.16.25`，执行 `npm view @miniidealab/openlogos@0.16.25 version` 应返回 E404。若实施前已有其他提案升版，或 registry 已存在候选版本号，候选改为「当时版本与 registry 最高版本中较大者的下一 patch」，并在部署记录中写明。
4. **升版**：在实现中执行 `node cli/scripts/bump-version.mjs <候选版本>`（规划值 `0.16.25`），由脚本一次更新全部版本载体与候选 / 回滚常量，并重算 `cli/asset-manifest.json`；**禁止手改**常量与 manifest。
5. **CHANGELOG**：在 `## [Unreleased]` 之后新增 `## [<候选版本>]` 条目（规划值 `## [0.16.25]`），注明「本机全局发布（未发布到 npm）」，不改既有条目：
   - **Added**：
     - SMOKE 人工标记；
     - 登记表 `manual_acceptance`；
     - 冒烟阶段人工验收（待验收清单、`PENDING`、`openlogos accept`）；
     - next / status 驻留态 `awaiting-manual-acceptance`；
     - 账本 `kind=manual` 记录。
   - **Changed**：
     - 只有人工用例的项目，smoke 自动阶段视为空通过；
     - 通过后再记录人工结果会使通过过期，archive 以账本核对；
     - 晋级只认未过期的通过记录；
     - 生成指令新增「等待人工验收」硬红线。

### 源码回归范围

部署前的 verify 负责源码回归，脚本不跑测试（通用方案第八节）。升版后复跑以下检查，必须全绿：

- `cd cli && npm run lint`（0 error）、`npx tsc --noEmit`、`npm test`、`npm run build`。
- 范围包括：
  - 本提案的 UT-S46-01 起、ST-S46-01 起，UT-S19-127 起、ST-S19-40 起，UT-S41-30 起、ST-S41-08，UT-S05-58 起，UT-S09-493 起，UT-S08-93 起；
  - S19 既有用例，尤其是：smoke 覆盖预检、平台跳过、环境证据、沙箱改判、写入顺序与失败恢复、全文回退读法；
  - S41 / S42 / S43 既有用例，尤其是：账本读取与坏行计数、审批与晋级（已验证集合与晋级候选改为只认未过期记录后的回归）；
  - S05 / S11 的 deploy-done 与 ready-to-smoke 派生，archive 链条校验，S09 guard 受限命令与登记表保护，S08 生成指令；
  - verify / smoke golden，asset-manifest 自洽用例。
- 版本相关的既有用例若断言具体版本号，随升版更新期望值。

### 部署、sync 与部署后检查

1. 执行 `openlogos deploy --env test`（提案通道），按通用方案第七节第 1、2 条读回回执与账本：
   - 全局 `--version` 等于候选版本（规划值 `0.16.25`）；
   - 入口 realpath 等于回执 `entry_realpath`，全局 `dist/index.js` 的 SHA-256 等于 `candidate_entry_sha256`；
   - 记录候选 tarball 与回滚制品的路径与 SHA-256，从回执读取并记录 `previous_version` 与 `previous_entry_sha256`；
   - 部署前读取 `openlogos env show test --format json` 的 `data.current_ref`，记作审计信息；部署成功后再读一次，记录 `data.current_ref`（应为本次部署的提交）与 `data.previous_ref`（显式回退目标）。
2. **本仓 sync**：在主工作树执行一次 `openlogos sync`。
   - 读回 `logos/spec/` 下受托管的规范文件，与根 `spec/` 同名文件逐字节一致；
   - AGENTS.md / CLAUDE.md 的变化只来自托管内容与版本戳，其中硬红线新增「等待人工验收」条目；
   - 受版本控制的托管文件变化随部署记录一起提交，不 push；
   - 若 sync 改动了 `.claude/settings.json`，按前几版部署记录同样还原并记录。
3. **补部署报告**：部署后追加人写的「部署报告」小节（版本、deploy_id、ref、制品哈希、sync 读回结果）并提交，然后再执行 smoke。
4. 经授权执行 `openlogos smoke --env test`，覆盖两组用例：
   - 本次行为用例：「OpenLogos 0.16.25 冒烟阶段人工验收安装态 smoke（SMOKE-core-342 起）」；
   - 通用安装态用例：「本机测试环境脚本部署安装态 smoke（SMOKE-core-268～SMOKE-core-271）」。

   本仓 `test` 未开启人工验收，因此本仓 smoke 不会停在 `PENDING`。本仓产生的 smoke 历史随部署记录提交时以 `git add -f` 纳入。

### 失败处置与回滚

处置按通用方案第五节，各动作使用上文「版本与回滚身份的取值规则」中各自的事实来源。本次差异如下：

- **部署前置或 dry-run 失败**：不执行部署，修正后重试，或回流实现。
- **脚本失败（部署未成功）**：脚本自动回装回滚制品，按本次回执复核：全局 `--version` 等于回执 `previous_version`，入口 SHA-256 等于回执 `previous_entry_sha256`。账本记 `result=failed`，流程不推进。
- **成功部署后要回退**：
  - 先读取 `openlogos env show test --format json` 的 `data.previous_ref`，核对它就是要回到的版本（计划时为提交 `aa1d9fd` 的 0.16.24，不含本能力），再执行 `openlogos deploy --env test --rollback`。
  - 视图值为 null 时，命令以 `DEPLOY_ROLLBACK_TARGET_MISSING` 拒绝，不得改用手工回装。
  - 回退后，本机账本中由 0.16.25 写入的 `kind=manual` 行与 pending 行，会被 0.16.24 计入 `corrupt_lines` 并跳过，不影响既有判定。
- **成功落账后 smoke 失败**：停止后续完成流程，保留失败证据，回流修复后以 `openlogos deploy --env test` 部署修复提交并重跑 smoke。不得手工回装旧包。
- 本次无数据迁移：账本只新增记录类型与可选字段，不改写任何既有持久文件。

### 明确不做

- 不执行 `npm publish`、dist-tag、`git tag`、`gh release`、`git push`，不部署官网。
- 不改 `.gitignore`、不改本仓 `logos/environments.yaml`；不改写其他仓库。RunLogos 侧的停机展示与逐条记录界面（RunLogos #34）不属于本方案。

### 追溯

- 需求：AC-SMOKE-MANUAL-01～AC-SMOKE-MANUAL-14；功能规格：§2.107；决策：C03。
- 安装态 smoke：`core-smoke-test-cases.md`「OpenLogos 0.16.25 冒烟阶段人工验收安装态 smoke（SMOKE-core-342 起）」。
