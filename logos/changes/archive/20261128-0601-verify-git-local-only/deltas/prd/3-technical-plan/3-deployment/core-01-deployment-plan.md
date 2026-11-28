## ADDED — OpenLogos 0.16.30 本机测试环境发布（verify-git-local-only）

> 本节引用「本机测试环境脚本部署（scripts/deploy-local.mjs）」通用方案，只写本次的差异：版本号、CHANGELOG、源码回归范围、本仓 `openlogos sync` 与安装态 smoke。冻结、回滚制品、构建候选、试装、全局安装、复核与回执，一律按通用方案第三～七节执行，不在本节复写。
>
> **目标版本固定为 `0.16.30`**：这是本提案批准的交付版本（需求 AC-VERIFY-LOCAL-09）。升版命令、CHANGELOG 标题、`--version` 断言与安装态 smoke 都以它为准；过程中不得自行改用其他版本号。版本检查分两个时点，见「部署前置与版本」。
>
> **回滚身份的取值规则**：下文的 `0.16.29`、提交 `a73e410` 是**规划值**。三个回滚动作各有自己的事实来源，互不替代：
>
> | 回滚身份 | 事实来源 | 规划值 | 用途 |
> |---|---|---|---|
> | 源码回滚常量 `LOCAL_RELEASE_ROLLBACK_VERSION` | 既有升版脚本 `cli/scripts/bump-version.mjs` 产生，等于升版前的源码版本 | `0.16.29` | 源码内的候选 / 回滚常量对；不手改 |
> | 部署脚本失败后的回装 | 本次部署回执的 `previous_version` 与 `previous_entry_sha256`，即脚本打包的部署前全局安装态 | 以回执为准 | 脚本自动回装后复核恢复结果 |
> | 成功落账后的显式回退 | 执行回退前读取 `openlogos env show test --format json` 的 `data.previous_ref`（`spec/environments.md` §7.1、§11.6） | 本次部署成功、期间无其他部署时，为提交 `a73e410`（0.16.29） | `openlogos deploy --env test --rollback` 的目标 |
>
> 部署记录分列这三项的实际值，并写明各自与规划值是否一致。部署前读到的 `test.current_ref`（计划时为 `a73e410865f0`，0.16.29）是写提案时的观测值，单独记作审计信息，不作为回退目标的依据。

### 部署目标与授权边界

把本提案的修正装进本机全局安装态。行为差异如下：

- `openlogos verify`（提案级、发布级与发布查询）自己启动的 git 调用不连接远端、不向本地对象库写入、不弹出凭据提示，并且有时限（功能规格 §2.111）。
- 项目是部分克隆且本地缺少提案起点的提交或其中的文件内容时，verify 不再从远端取回，按既有规则回落或扩大到全量并写明原因；发布查询指定的提交本地不存在时照旧拒绝。
- 对象齐全的仓库，验收范围、原因、执行的用例与结论不变。JSON 字段与原因代码不变。
- `openlogos smoke` 及其他命令的 git 调用不变。

部署参数：

- **目标环境**：`test`（登记表 `proposal_default_env: test`，决策 C03）。登记表中 `test.deploy` 为 `mode: script`、`script: scripts/deploy-local.mjs`。本提案不改登记表。
- **入口**：提案通道执行 `openlogos deploy --env test`，部署请求 HEAD。由 CLI 追加部署报告、写 `DEPLOY_DONE` 并勾选 `[deploy]`；部署成功后**不再**另行执行 `openlogos deploy-done`。
- **授权**：部署执行、smoke、archive 与 `git push` 各自是人类确认点，须用户逐次明确授权（`openlogos next --auto` 的 standing 授权按 CLAUDE.md 两档授权语义处理）。`test` 未配置 `promote_from` / `require_approval`，未开启人工验收。
- **版本号边界**：0.16.30 只作本机全局版本，不进入 npm registry。本方案**不含** `npm publish`、dist-tag、`git tag`、GitHub Release、官网部署或 `git push`，不改写其他仓库（包括 runlogos）。

### 部署前置与版本

1. 本提案 delta 已 merge，`[code]` 切片已实现并提交，`openlogos verify` PASS。`openlogos env check` 无 error，`openlogos deploy --env test --dry-run` 通过（通用方案第三节）。
2. **请求提交已提交**：部署前确认 merge 后的规格、切片代码与验收报告都已提交、工作区干净。未提交时按「规格合并 → 代码 → 验收报告」的顺序补提交后再部署。
   - `.claude/` 与 `logos/resources/verify/` 下的已跟踪文件，以 `git add -u -- <path>` 暂存；
   - 本提案期间产生的验收历史，以 `git add -f -- logos/resources/verify/history/` 暂存（不改 `.gitignore`）。
3. **升版之前的检查**（在实现阶段、执行升版命令之前做）：
   - `cli/package.json` 的版本应为 `0.16.29`（本机全局版本，未发布到 npm）；
   - `npm view @miniidealab/openlogos@0.16.30 version` 应返回 E404。
   - 任一不符：**停止，不升版**，也不自行改取其他版本号。由用户决定新的目标版本，并同步修订需求 AC-VERIFY-LOCAL-09、本节与安装态 smoke 用例中的版本号（已合并的规格经增量修正合并），重新获得批准后再继续。
4. **升版**：检查通过后，在实现中执行 `node cli/scripts/bump-version.mjs 0.16.30`，由脚本一次更新全部版本载体与候选 / 回滚常量，并重算 `cli/asset-manifest.json`；**禁止手改**常量与 manifest。
5. **CHANGELOG**：在 `## [Unreleased]` 之后新增 `## [0.16.30]` 条目，注明「本机全局发布（未发布到 npm）」，不改既有条目：
   - **Changed**：
     - `openlogos verify` 自己启动的 git 调用不连接远端、不取回对象、不弹出凭据提示，并有时限（没有既有时限的调用缺省 60 秒）。
     - 部分克隆且本地缺少提案起点的提交或其中的文件内容时，verify 不再从远端取回：缺起点提交判为起点不可达，缺文件内容判为差异计算失败，都回落或扩大到全量并在说明中写明；调用超过时限时按失败的那一次调用归类。原因代码与 JSON 字段不变。
   - **Fixed**：
     - 部分克隆的项目执行 verify 时会访问远端并向本地对象库写入对象，远端无响应时验收一直挂住。
6. **部署时的检查**：部署前 `cli/package.json` 的版本应已是 `0.16.30`。部署后源码版本、候选包版本、部署回执 `candidate_version` 与全局 `--version` 都应为 `0.16.30`；任一不符即视为部署不符合本方案，按「失败处置与回滚」处理。

### 源码回归范围

部署前的 verify 负责源码回归，脚本不跑测试（通用方案第八节）。升版后复跑以下检查，必须全绿：

- `cd cli && npm run lint`（0 error）、`npx tsc --noEmit`、`npm test`、`npm run build`。
- 范围包括：
  - 本提案的 UT-S13-309～UT-S13-322、ST-S13-57、ST-S13-58；
  - S13 既有用例，尤其是：按模块限定范围（含各种回落原因）、共享验收配置按字段判断、分层验收的扩大规则、测试用例文档按用例变化判断 delta 触及（UT-S13-305 的不取回断言）、发布级验收与发布查询（含 UT-S13-259 的提交归属）、验收历史；主链路偶发等门禁优先级（UT-S13-243）；
  - S19 中 smoke 历史记录相关的既有用例（smoke 的 git 调用不变）；
  - verify golden，asset-manifest 自洽用例。
- **本仓不受范围变化影响**：本仓是完整克隆，且未启用按模块限定范围、未开启分层；本次只是让本仓 verify 的 git 调用带上约束，结果不变。在部署记录中写明这一点。
- 版本相关的既有用例若断言具体版本号，随升版更新期望值。

### 部署、sync 与部署后检查

1. 执行 `openlogos deploy --env test`（提案通道），按通用方案第七节第 1、2 条读回回执与账本：
   - 全局 `--version` 等于 `0.16.30`，且等于回执的 `candidate_version` 与源码候选版本（`cli/src/lib/local-release-candidate.ts`）；
   - 入口 realpath 等于回执 `entry_realpath`，全局 `dist/index.js` 的 SHA-256 等于 `candidate_entry_sha256`；
   - 记录候选 tarball 与回滚制品的路径与 SHA-256，从回执读取并记录 `previous_version` 与 `previous_entry_sha256`；
   - 部署前读取 `openlogos env show test --format json` 的 `data.current_ref`，记作审计信息；部署成功后再读一次，记录 `data.current_ref`（应为本次部署的提交）与 `data.previous_ref`（显式回退目标）。
2. **本仓 sync**：在主工作树执行一次 `openlogos sync`。
   - 读回 `logos/spec/` 下受托管的规范文件（本次为 `test-results.md`、`cli-json-output.md`），与根 `spec/` 同名文件逐字节一致；
   - 本提案不改技能与生成指令文案，AGENTS.md / CLAUDE.md 的变化只来自版本戳；
   - 受版本控制的托管文件变化随部署记录一起提交，不 push；
   - 若 sync 改动了 `.claude/settings.json`，按前几版部署记录同样还原并记录。
3. **补部署报告**：部署后追加人写的「部署报告」小节（版本、deploy_id、ref、制品哈希、sync 读回结果）并提交，然后再执行 smoke。
4. 经授权执行 `openlogos smoke --env test`，覆盖两组用例：
   - 本次行为用例：「OpenLogos 0.16.30 验收期间 git 调用只读本地安装态 smoke（SMOKE-core-375～379）」；
   - 通用安装态用例：「本机测试环境脚本部署安装态 smoke（SMOKE-core-268～SMOKE-core-271）」。

   本仓产生的 smoke 历史随部署记录提交时以 `git add -f` 纳入。

### 失败处置与回滚

处置按通用方案第五节，各动作使用上文「回滚身份的取值规则」中各自的事实来源。本次差异如下：

- **部署前置或 dry-run 失败**：不执行部署，修正后重试，或回流实现。
- **脚本失败（部署未成功）**：脚本自动回装回滚制品，按本次回执复核：全局 `--version` 等于回执 `previous_version`，入口 SHA-256 等于回执 `previous_entry_sha256`。账本记 `result=failed`，流程不推进。
- **装入的版本不是 `0.16.30`**（回执、源码候选版本或全局 `--version` 任一不符）：视为部署不符合本方案，不执行 smoke 的通过判定；按「成功部署后要回退」回到部署前的版本，查明原因后重新部署。
- **成功部署后要回退**：
  - 先读取 `openlogos env show test --format json` 的 `data.previous_ref`，核对它就是要回到的版本（本次部署成功、期间无其他部署时为提交 `a73e410` 的 0.16.29；期间另有成功部署时以读到的值为准），再执行 `openlogos deploy --env test --rollback`。
  - 视图值为 null 时，命令以 `DEPLOY_ROLLBACK_TARGET_MISSING` 拒绝，不得改用手工回装。
  - 回退后的影响：verify 的 git 调用恢复为不带约束——部分克隆缺对象时重新会联网取回并按范围验收，没有时限。不涉及任何持久文件格式，不需要迁移。
- **成功落账后 smoke 失败**：停止后续完成流程，保留失败证据，回流修复后以 `openlogos deploy --env test` 部署修复提交并重跑 smoke。不得手工回装旧包。
- 本次无数据迁移：不改任何持久文件的格式。

### 明确不做

- 不执行 `npm publish`、dist-tag、`git tag`、`gh release`、`git push`，不部署官网。
- 不改 `.gitignore`、不改本仓 `logos/environments.yaml`、不把本仓改成部分克隆；不改写其他仓库。

### 追溯

- 需求：AC-VERIFY-LOCAL-01～AC-VERIFY-LOCAL-09；功能规格：§2.111、§2.96.6；决策：C01～C03。
- 安装态 smoke：`core-smoke-test-cases.md`「OpenLogos 0.16.30 验收期间 git 调用只读本地安装态 smoke（SMOKE-core-375～379）」。
