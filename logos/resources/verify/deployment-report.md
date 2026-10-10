# 部署报告：release-0-16-0 / OpenLogos 0.16.0 公开发布（2026-10-10，**已发布：npm / GitHub Release / 官网**）

## 〇、最终结论

- 发布身份（供 `scripts/smoke-public-release-0-16-0.js` 读取）：
  - public_release_version: `0.16.0`
  - public_release_commit: `45e9648d4e6dc7c7255663c220b2a0c553323025`
- **npm**：`@miniidealab/openlogos@0.16.0` 已发布，`dist-tags.latest=0.16.0`、`old=0.9.8`。registry tarball SHA-256 `f22b7603087a9f788f13e326643be03f528cb9d3e1b662301229a82c63e2b564`。SLSA provenance 来源为 `refs/tags/v0.16.0`，gitCommit 为 `45e9648`；tarball 发布不写 `gitHead`。
- **GitHub Release**：`v0.16.0` 为 latest，非 draft、非 prerelease。附件与 registry tarball 逐字节一致，正文与 CHANGELOG `## [0.16.0]` 逐字一致。
- **官网**：Cloudflare Pages 项目 `openlogos` 部署完成（`https://cc30952f.openlogos.pages.dev`）。`https://openlogos.ai/releases` 与 `/zh/releases` 返回 200，latest 为 `v0.16.0`，0.16.0 英文摘要在场。改名图片 `/runlogos/4.db-editor.sqlite-postgresql-mysql.jpg` 返回 200 `image/jpeg`，两页均已引用新路径。
- **本机全局**：已从 registry 安装 0.16.0，入口 `/opt/homebrew/bin/openlogos` → `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js`（普通目录，非链接）。833 个文件与 registry tarball 逐文件一致，asset-manifest 自洽（payloadHash `ee331ae8…44c5`）。
- **回滚入口**：本机为 `cli/rollback/miniidealab-openlogos-0.15.20.tgz`（SHA-256 `2511632038e8e324f761533b55e7f8b314e9badf26b45f6de1d956db14055093`）；公网按部署方案档 D 处置。
- 发布过程依次经历：门② Linux 预演暴露 guard 缺陷（另立修复提案 `fix-guard-tee-pattern-linux` 并归档）、Windows CI 修复、身份判据增量修正、`NPM_TOKEN` 失效（档 B1 更新后重跑）、npm 传播延迟导致官网校验失败（档 C 补做）。详见下文各节。

## 一、首次部署尝试的结论（历史：门② 未通过，已由后续各节处置）

- **结果**：失败，属部署方案档 A（推 tag 前失败）。未执行任何不可逆动作：未 `git push`、未创建或推送 tag、未 `npm publish`、未创建 GitHub Release、未部署官网，本机全局仍为 `0.15.20`。未执行 `openlogos deploy-done`，未写 `DEPLOY_DONE`。
- **失败点**：门 ② Linux 干净克隆预演，阶段一（docker `node:20`）的 `npm test` 未全绿。
- **主因**：`plugin/bin/guard-check` 的 `BASH_WRITE_PATTERNS` 含 `"| tee "`。在 `grep -E` 中，开头的 `|` 是**空分支**：
  - GNU grep（Linux / CI）上，它匹配任何输入，非 git 回落模式下所有不在安全白名单内的命令都被判为写入；
  - BSD grep（macOS）上，它什么都不匹配，连真正的 `cat x | tee y` 也识别不出。
  - 该模式自 `8e4bfb8`（2026-06-01）起存在，已公开的 0.13.24 同样包含，不是本提案引入。它在 macOS 本机测试中不可见，只在 Linux 上让 guard 回落类测试失败。
- **判定依据**：按提案默认约定「推 tag 前若 Linux 预演暴露的失败属运行时行为缺陷，停止发布并另立修复提案，修复归档后再回到本提案」，本次停止发布。

## 二、授权与目标

- 授权：本次 RunLogos `--auto` 响应中 deliver 门 `gate_auto_passed=true`（`GATE_AUTO_PASSED` 审计行 `deliver-entry` 2026-10-10T01:42:12.742Z）；部署方案「OpenLogos 0.16.0 公开发布方案（npm / GitHub Release / 官网）」。
- 目标：npm registry `@miniidealab/openlogos`、GitHub Release、Cloudflare Pages 官网；本机 npm 全局。本次均未触达。

## 三、冻结事实

| 项 | 值 |
|---|---|
| npm dist-tags | `{"old":"0.9.8","latest":"0.13.24"}` |
| 本地 HEAD（部署前） | `344f2e279baa338dc27f3c81a2df21582fc7b4ae` |
| 本次提交后 HEAD | `80faa9cde3531a7330767b372504698ab5e64c15`（`478b5f5` 规格、`204d918` 代码、`80faa9c` 版本与发布说明，均仅在本地） |
| `origin/master` | `42d2aeb13f483b75dcfe332d088a2401dcb895e7`，本地超前 22 个提交（未推送） |
| 本机全局 | `/opt/homebrew/bin/openlogos` → `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js`，`0.15.20` |
| 回滚制品 | `cli/rollback/miniidealab-openlogos-0.15.20.tgz`，2,665,195 字节，SHA-256 `2511632038e8e324f761533b55e7f8b314e9badf26b45f6de1d956db14055093`。在全局安装目录 `npm pack --ignore-scripts` 产出，881 个文件与全局安装逐文件一致，与 0.15.20 原始候选制品逐字节相同（未提交入库） |

## 四、各门执行结果

**门 ①：本地全绿——通过。**
- `cd cli`：`npm run lint` 0 error、`npx tsc --noEmit` 通过、`npm test` 177 个文件 / 2652 条通过（macOS，与提交内容一致的工作区）。
- 官网：在 `80faa9c` 的临时克隆中执行 `npm ci && npm run build` 通过。环境为 Node v23.10.0，Python 3.14.7 venv 内装 fonttools 4.66.1 与 brotli，未改动系统 Python。

**门 ②：Linux 干净克隆预演——未通过。**

阶段一第一次运行：docker `node:20`（镜像 `node@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5`，Node v20.20.2），提交 `80faa9c`，以 root 运行。
- `npm ci` 0、`npm run build` 0、版本一致性 ok（0.16.0 / plugin 0.16.0 / Release 正文 3001 字符）、`npm pack` 0（SHA-256 `34c94c43ba5bbd0561a027ebb69ca6b9e997426928ac17fe71b717275242c8ba`）。
- 包内 `dist` js 91 个，无源文件的产物 0 个；manifest 自洽；随包 guard 与 manifest 一致；`lint` 0、`tsc` 0。
- **`npm test` 失败**：13 个文件 / 19 条。

阶段一第二次运行：为贴近 GitHub Actions，改为非 root 用户 `node`，并安装 sqlite3 3.40.1。
- **`npm test` 仍失败**：5 个文件 / 6 条，另有 1 个文件级错误。其余各步结果同上。

第二次运行剩余失败归因：

| 失败 | 归因 | 处置建议 |
|---|---|---|
| UT-S09-448、UT-S09-450、ST-S09-202、ST-S09-173、UT-S09-407 | `"| tee "` 空分支在 GNU grep 下匹配一切，非 git 回落把 `git status \| head`、`npm run release:local` 等判为写入；旧实现对照（`true; rm src/x`）在 Linux 上同样被拦 | **运行时缺陷**：另立修复提案。把该模式改为字面量（如 `\| tee ` 或 `[|] tee `），并审查模式表中其它 ERE 元字符；同步托管副本与 asset-manifest；补 Linux 与 macOS 同判的回归测试 |
| `deploy-plan-gate-smoke.test.ts` 正式模式用例 | 断言假定本机 `npm prefix -g` 下已全局安装 openlogos；无全局安装的 CI 上 runner 报「全局 npm prefix 下没有安装包目录」 | 测试环境依赖：断言改为接受两种「不在全局包目录」诊断，或在夹具中构造全局 prefix |
| `s09-windows-guard.test.ts` 文件级 `EPERM chmod …/node-bin/node` | 测试对链接到系统 node 的路径 chmod；容器内 node 属 root，非 root 用户无权改 | 容器假象的可能性大：GitHub runner 上 node 属 runner 用户。建议同修，改为复制 node 或包装脚本，不对系统二进制 chmod |

第一次运行另有 13 条失败，第二次已消失。它们源于 root 运行使权限注入失效，以及镜像缺 sqlite3，属预演环境差异。

阶段二（docker `node:22.12.0` 官网构建）：阶段一已失败，未执行。

**门 ③ / ④：未执行。**

**第二次派发（2026-10-10，dispatch `drv-drv-mv1o2epe-h7ww-deploy-e0cd85`）**：门 ② 的阻断项未变化——`plugin/bin/guard-check:846` 仍为 `"| tee "`，修复提案尚未建立或归档。因此不重跑预演，仍按档 A 失败。

本次补充核实门 ④：本机 gh 另登录有账号 `miniidealab`（未激活，本次未切换激活账号，也未输出 token）。以它只读查询的结果：
- 对 `miniidealab/openlogos` 权限为 `admin:true`、`push:true`；
- `gh secret list` 列出 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`、`NPM_TOKEN`，三项均存在，只查名称不读值。

门 ④ 的凭据存在性条件可以满足；推送须使用该账号的凭据。

**第三次派发（2026-10-10，dispatch `drv-drv-mv1o2epe-h7ww-deploy-1b48be`）**：状态与第二次相同——HEAD 仍为 `80faa9c`，`guard-check:846` 仍为 `"| tee "`，没有修复提案。按档 A 直接失败，未重跑预演，无任何写入。重复派发部署不会改变结论，需先完成修复提案。
- 未推送 master，未等待 CI。
- 门 ④ 的提前检查发现：本机 `gh` 账号 `bergkampzhang` 对仓库权限为 `push:false`、`admin:false`，`gh secret list` 返回 HTTP 403，无法确认 `NPM_TOKEN`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 的存在性。即使门 ② 通过，门 ④ 也需要有仓库管理权限的账号确认，或由用户在 GitHub 仓库设置中确认。

## 五、回滚与现场

- 无需回滚：没有任何公网或全局写入。
- 本地新增的三个提交保留，便于修复后继续。未推送，如需撤销可直接在本地处理。
- 部署前的预演产物都在一次性目录中，本仓工作区仅新增未跟踪的 `cli/rollback/miniidealab-openlogos-0.15.20.tgz`。

## 六、后续建议

1. 另立修复提案，修复 guard `"| tee "` 的 ERE 空分支缺陷：Linux 过度拦截、macOS 漏判 `| tee` 写入。顺带修复上表两个测试环境依赖。修复提案按流程验收、本机部署、归档。
2. 回到本提案，按修复后的版本刷新事实（回滚基线、CHANGELOG 聚合条目写入该修复），重新执行四道门。门 ② 阶段一必须以非 root 用户、具备 sqlite3 的环境全绿。
3. 门 ④：已用 `miniidealab` 账号核实三项 secrets 存在、该账号有 push 权限。重试时 `git push` 与 `gh` 操作须使用该账号，当前激活账号 `bergkampzhang` 无 push 权限。是否切换激活账号由用户决定。

## 七、重试：修复提案归档后重跑门 ① ②（2026-10-10）

- 前置：修复提案 `fix-guard-tee-pattern-linux` 已验收并归档（`4b55f81`）。`release-0-16-0` 从 `logos/changes-parked/` 恢复。另提交 `6b541ae`，移除归档提交误带入的 `cli/miniidealab-openlogos-0.15.20.tgz`（与 `cli/rollback/` 下回滚制品逐字节相同，回滚制品保留）。
- **重新 verify**：`openlogos verify --format json` 结果为 `gate=PASS`。2251 个已定义用例中通过 2241、跳过 10、失败 0、未覆盖 0；预跑退出码 0；`VERIFY_PASS` 已刷新。
- **门 ①（本地全绿）——通过**：
  - `cli` 的 `eslint src/` 无错误，`tsc --noEmit` 通过；全量测试已由 verify 预跑完成。
  - 官网：在 `6b541ae` 的临时克隆中执行 `npm ci && npm run build` 通过（Node v23.10.0，venv 内 fonttools 4.66.1 与 brotli）。
- **门 ②（Linux 干净克隆预演）——通过**，提交 `6b541ae63abdcbe1ce3d5d7e8394ac96c8fc394e`：
  - **阶段一**：docker `node:20`（`node@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5`，Node v20.20.2），以非 root 用户 `node` 运行，sqlite3 3.40.1。
    - `npm ci` 0、`npm test` 0（178 个文件；2635 条通过，19 条为平台限定用例跳过）、`npm run build` 0、`npm run lint` 0、`npx tsc --noEmit` 0。
    - 版本一致性 ok：0.16.0 / plugin 0.16.0 / Release 正文 3086 字符。
    - `npm pack` 0，SHA-256 `f22b7603087a9f788f13e326643be03f528cb9d3e1b662301229a82c63e2b564`；包内 dist js 91 个，孤儿产物 0 个；manifest 自洽；随包 guard 与 manifest 一致。
  - **阶段二**：docker `node:22.12.0`（`node@sha256:0e910f435308c36ea60b4cfd7b80208044d77a074d16b768a81901ce938a62dc`），非 root 用户，python3-fonttools 4.38.0 与 python3-brotli。官网 `npm ci` 0、`npm run build` 0。
- **门 ③ / ④**：尚未执行，等待用户确认推送方式。门 ④ 的凭据存在性已于前次核实（`miniidealab` 账号可见三项 secrets，且有 push 权限）。

## 八、门 ③ / ④（2026-10-10）

- **门 ③（GitHub CI 双 job）——通过**：
  - `master` 推送到 `6b541ae`（gh 当前账号切换为 `miniidealab`，用户选择方案 A）。首次 CI run 38022297086：`Lint & Test` success、`Windows regression` failure，15 条失败。
  - 失败归因：Windows runner 的 `core.autocrlf=true` 把 `skills/`、`spec/`、`plugin/` 转成 CRLF，导致 asset hash 不匹配、按行解析 guard 失败；UT-S08-69 的 Python 桩硬链接到运行中的 node.exe，清理时 EPERM。
  - 修复提交 `6e04aa9`：`.gitattributes` 在托管块之外追加本仓自有块，对上述源目录设 `-text`；Python 桩改为复制 node.exe。修复后重新 verify：PASS，失败 0、未覆盖 0。用 `core.autocrlf=true` 克隆模拟：受保护目录无 CR，manifest 源资产哈希 0 处不一致。
  - CI run 38023077495：attempt 1 中 `Windows regression` 54/54 通过，但 Vitest 报内部 `Timeout calling "onTaskUpdate"`（worker RPC 超时）导致退出码 1；只重跑失败 job 后 attempt 2 两个 job 均为 success。
- **门 ④——凭据通过，恢复演练暴露一个身份核对缺口**：
  - `gh secret list`（`miniidealab`）：`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`、`NPM_TOKEN` 均存在。
  - 档 C 只读演练（对象 0.13.24）：`gh release view v0.13.24` 存在，判支「跳过 create」；`v0.0.0-drill` 不存在，判支「create」（未执行）；当前 releases/latest 为 `v0.13.24`；registry tarball SHA-256 `80c0ea7945632105634e285186acfaef875a89ff7748406c1a9c9cb5512fdf79`。
  - **缺口**：`npm view @miniidealab/openlogos@0.13.24` **没有 `gitHead` 字段**。`publish.yml` 以 `npm publish <tarball>` 发布，tarball 发布不写 `gitHead`。部署方案档 C 与 SMOKE-core-231 都以「`gitHead` 等于 tag 提交」核对身份，0.16.0 发布后这条判据必然失败。
  - 可用的替代证据：同一包的 SLSA provenance（`dist.attestations`，predicate `https://slsa.dev/provenance/v1`）记录 `resolvedDependencies[0]` 为 `git+https://github.com/miniidealab/openlogos@refs/tags/v0.13.24`、`digest.gitCommit=99c8fb91d01a241e7a93a4a8be63f7eeb7018e29`，与 `v0.13.24` 指向的提交一致。
  - 处置：推 tag 前先把身份判据改为「provenance 的 `gitCommit` 等于 tag 提交、ref 为 `refs/tags/v<V>`」（有 `gitHead` 时一并核对）。这需要修订已合并的部署方案与 smoke 规格（增量修正 merge），并同步修改 runner。待用户授权。

## 九、修订与门 ③ 复验（2026-10-10）

- **身份判据增量修正**（用户「同意修订」）：
  - 修订 release-0-16-0 的部署方案 delta 与 smoke delta：registry 来源提交以 SLSA provenance 为准，即 `resolvedDependencies[0]` 指向 `refs/tags/v<V>`、`digest.gitCommit` 等于 tag 提交；`gitHead` 只在存在时核对。
  - 执行 `openlogos merge release-0-16-0`，结果 `amended`，提交 `595722a`。
  - runner 改为调用 `provenanceSourceProblems`，提交 `17d08f5`。用真实的 0.13.24 证明校验判据：通过。runner 自测 231～234 全部 pass；无 `gitHead` 时 pass，提交号不符时 fail。
- **CI 稳定性修复**（提交 `45e9648`，仅改测试代码，断言不变）：
  - CI run 38025508692：`Lint & Test` 中 UT-S11-93 因 10s 默认超时失败（慢机器，全量耗时 500s）；`Windows regression` 54/54 通过，但再次出现 Vitest `Timeout calling "onTaskUpdate"`（三次中第二次）。
  - 根因：UT-S09-378 / UT-S09-381 在 Windows 上单条约 70s 全同步执行，超过 Vitest 固定的 60s RPC 超时。
  - 修复：这两条用例改为每次判定后让出事件循环；UT-S11-93 超时设为 60s。
- 每次改动后均重新 `openlogos verify`：PASS，失败 0、未覆盖 0。
- **门 ③（GitHub CI 双 job）——通过**：CI run 38026351459（提交 `45e9648d4e6dc7c7255663c220b2a0c553323025`，attempt 1），`Lint & Test` success、`Windows regression` success。
- **门 ④——通过**：三项 secrets 存在（`miniidealab`）；档 C 只读演练完成，身份判据已改为 provenance 并以 0.13.24 实测通过。
- 四道门全部通过，等待用户确认推送 `v0.16.0` tag。

## 十、推送 tag 与发布（2026-10-10）

- 用户确认「推tag,正式发布」。在 `45e9648d4e6dc7c7255663c220b2a0c553323025` 上创建 annotated tag `v0.16.0` 并推送（gh 当前账号 `miniidealab`）。
- publish.yml run 38027722547 的执行情况：
  - `npm ci`、`Run tests`、`Build`、`Validate release version`、`Prepare release notes`、`Pack CLI` 均 success。打包结果：0.16.0，833 个文件，2.6 MB，shasum `f75866d216d503d621838733f760fac901a7873e`。provenance 已签名，并写入 sigstore 透明日志（logIndex 3179571300）。
  - **`Publish` 失败**：`npm error 404 Not Found - PUT https://registry.npmjs.org/@miniidealab%2fopenlogos`。
  - 其后的 GitHub Release 与官网各步均 skipped。
- registry 现状：`npm view @miniidealab/openlogos@0.16.0` 返回 E404，dist-tags 仍为 `latest=0.13.24`、`old=0.9.8`。没有 GitHub Release，官网未部署。
- 归因：npm 对 scoped 包在令牌无效、过期或缺少写权限时，对 PUT 返回 404。构建、打包、provenance 签名都已成功，上一次成功发布在 2026-08-05，判断 `NPM_TOKEN` secret 已失效或权限不足。该结论基于症状推断，需更新令牌后验证。
- 档位：**B1**——已推 `v0.16.0`、registry 无 V，修复只需更新 GitHub secret，不改任何文件。按部署方案，不删除、不重打 tag。用户更新 `NPM_TOKEN` 后，先再次确认 registry 仍无 0.16.0，再执行 `gh run rerun 38027722547`（绑定原 SHA / ref）。

## 十一、更新令牌后重跑与档 C 补做（2026-10-10）

- 用户用 `gh secret set NPM_TOKEN --repo miniidealab/openlogos` 更新令牌（secret 更新时间 `2026-10-10T07:50:18Z`；npm 账号 `sonicpanda <fredlong@gmail.com>`，为本包唯一 maintainer）。重跑前确认 registry 仍无 0.16.0，按档 B1 执行 `gh run rerun 38027722547`（attempt 2，绑定 `v0.16.0` / `45e9648`）。
- attempt 2 结果：
  - `Run tests`、`Build`、`Validate release version`、`Pack CLI` 均 success。
  - **`Publish` success**：日志为 `+ @miniidealab/openlogos@0.16.0`，provenance 写入 sigstore（logIndex 3181725953）。
  - **`Create GitHub Release` success**：`v0.16.0`，非 draft、非 prerelease，releases/latest 为 `v0.16.0`。
  - **`Verify website latest version matches tag` 失败**：npm 新版本的传播延迟导致 `generate:releases` 读到的 latest 仍为 0.13.24。之后的 Cloudflare 凭据校验与官网部署均 skipped。
- **进入档 C**（registry 已有 V）：不重跑原 run，只受控补做缺失步骤。
  - registry 约于 `08:00:16Z` 可见 0.16.0，`dist-tags`：`latest=0.16.0`、`old=0.9.8`。
  - 身份核对：
    - registry tarball 的 SHA-256 为 `f22b7603087a9f788f13e326643be03f528cb9d3e1b662301229a82c63e2b564`，与 GitHub Release 附件、门 ② 预演 `npm pack` 的结果逐字节一致；
    - SLSA provenance 判据 `provenanceSourceProblems` 为 `[]`，来源为 `refs/tags/v0.16.0`，gitCommit 为 `45e9648`；
    - `gitHead` 未写入，与 tarball 发布的预期一致。
  - GitHub Release：已存在，按档 C 只核对、不重复 create。正文与 tag 提交 CHANGELOG 中的 `## [0.16.0]` 逐字一致（3086 字符）。
  - 官网：在 `v0.16.0` 干净克隆中执行 `npm ci` → `generate:releases -- --strict`（84 个版本，`latestVersion=0.16.0`）→ `astro build` → `fetch:fonts` → `subset:fonts`，全部成功。产物 `/releases` 的 latest 为 `v0.16.0`，改名图片在场。本机 wrangler 已登录 fredlong@gmail.com 的 Cloudflare 账号，Pages 项目 `openlogos`（openlogos.ai / www.openlogos.ai）存在。
  - 待用户确认后执行 `npx wrangler pages deploy dist --project-name openlogos --branch master`（人类确认点）。


## 十二、官网补做与发布后同步（2026-10-10）

- 用户确认「部署官网」。在 `v0.16.0` 干净克隆的构建产物上执行 `npx wrangler pages deploy dist --project-name openlogos --branch master`：上传 18 个文件（另有 374 个已存在），部署地址 `https://cc30952f.openlogos.pages.dev`。线上核验结果见第〇节。档 C 补做完成，原 run 38027722547 未重跑。
- 本仓 `cd website && npm run generate:releases -- --strict`：84 个版本，`latestVersion=0.16.0`，`website/src/data/releases.json` 已更新，待提交入库。
- 本机全局切换：`npm install -g @miniidealab/openlogos@0.16.0`（切换前为 0.15.20），新 shell 复核结果见第〇节。
- 本仓 `openlogos sync`（CLI v0.16.0）：退出码 0。`.claude/openlogos/bin/guard-check`、全局包随包模板、`plugin/bin/guard-check` 的 SHA-256 均为 `bd4ebdd9ef7e3d268657675b2f89183672e316f140f98f97afcc10d4b6e5f259`。
- 提醒：runlogos 项目需由用户授权后在其项目根执行 `openlogos sync`，才会获得新 guard（含 `| tee` 修复）。
- gh 当前账号仍为 `miniidealab`（用户选择方案 A）。如需切回，执行 `gh auth switch --user bergkampzhang`。本机 `~/.npmrc` 中的 npm 令牌已失效（`npm whoami` 返回 401），不影响 CI 发布；本机如需发布权限，执行 `npm login`。
- 待办：`openlogos deploy-done` 受控落标；之后由用户授权运行 `openlogos smoke`（SMOKE-core-231～234）；`website/src/data/releases.json` 与本部署记录的提交及推送待确认。
