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

---

# 部署报告：website-docs-0-16-0 / 官网文档补齐 0.16.0（2026-10-12，**已部署：Cloudflare Pages 生产**）

## 一、授权与目标

- 授权：runlogos `--auto` standing 授权对 deliver 门放行（`gate_auto_passed=true`），依据提案决策 C01（本机部署生产）与 C02（不发 npm / tag / Release，`git push` 单独确认）。
- 目标：Cloudflare Pages 项目 `openlogos`，生产域名 `https://openlogos.ai`。不涉及 npm、tag 与 GitHub Release，本次未执行 `git push`。

## 二、部署记录（正式 smoke runner 读取）

- website_docs_deploy_url: https://30b99722.openlogos.pages.dev
- website_docs_deploy_id: 30b99722-e575-4f9f-9ddb-db5d62fd789d
- 部署提交：`ebb7e0e`（master，工作树干净；规格合并提交 `df2e469`）
- 回滚目标：`cc30952f-dc6f-4c51-8f96-2852c82c670c`（来源 `45e9648` = `v0.16.0`，即 v0.16.0 那次 publish 的官网部署，`https://cc30952f.openlogos.pages.dev`）

## 三、发布前检查（部署方案「OpenLogos 0.16.0 官网文档补齐发布检查」）

1. 页面齐备：14 个新页面中英文均已落盘，并在 `website/astro.config.mjs` 侧边栏登记。
2. 旧指引残留检索：命中只出现在 `cli/merge`、`cli/sync` 的「从旧版迁移」小节、升级指南，以及 `deep-dive/engineering-foundation` 的 Layer 1 / 3，均属允许情况。
3. 事实核对点 K1～K4 已逐条核实；写作中新发现的冲突见实现交付说明（另行报告，未改根文件）。
4. `npm ci && npm run build` 通过：178 页，releases 84 个版本，字体子集完成；`npm test` 3/3 通过。
5. 构建后 `releases.json` 的 `latestVersion=0.16.0`。
6. smoke runner 自测（本地预览 `http://127.0.0.1:4329`）：SMOKE-core-235～238 与复用 07 / 08 / 21 / 23 全部 pass，夹具 A 通过、B / C 失败（符合预期），共 189 次请求、站外请求 0；结果写入独立账本，未进入正式账本。
7. 回滚目标已用只读命令 `wrangler pages deployment list` 记录（见第二节）。

## 四、部署执行

- 命令：`cd website && npm run build && npx wrangler pages deploy dist --project-name openlogos --branch master`
- 结果：`Deployment complete`。`wrangler pages deployment list --environment production` 显示最新生产部署为 `30b99722-e575-4f9f-9ddb-db5d62fd789d`（Production / master / `ebb7e0e`）。
- 线上抽查：`https://openlogos.ai/cli/slice/` 与 `https://openlogos.ai/zh/getting-started/upgrade-from-0-13/` 均返回 200。

## 五、回滚

在 Cloudflare Pages 控制台把生产回滚到 `cc30952f-dc6f-4c51-8f96-2852c82c670c`，或执行 `npx wrangler pages deployment rollback`（指定该部署）。只影响官网静态内容，不涉及 npm / tag / Release。

## 六、待办

- 由 driver 或用户授权运行 `openlogos smoke`：正式模式对 `https://openlogos.ai` 执行 SMOKE-core-235～238 与复用 07 / 08 / 21 / 23。
- `git push` 为独立人类确认点，在 archive 之后询问。

# 部署报告：verify-sandbox-reuse-0-16-1 / OpenLogos 0.16.1 本机全局发布（2026-10-13，**已部署：本机全局**）

## 一、授权与目标

- 依据：部署方案「OpenLogos 0.16.1 发布方案（verify / smoke 沙箱复用，本地全局）」；提案决策 C06（用户 2026-10-13：「然后生成新版本0.16.1，先发布本地全局吧」）；本次 `openlogos next --auto` 的 deliver-entry 门 `gate_auto_passed=true`（`GATE_AUTO_PASSED` 2026-10-13T10:36:20.980Z）。
- 范围：只做本机全局安装。未执行 `npm publish`、dist-tag、`git tag`、`gh release`、`git push`；未在本仓执行 `openlogos sync`；未改写其他仓库（含 runlogos）；未修改 `logos/logos.config.json`。

## 二、冻结事实（部署前）

| 项 | 值 |
|---|---|
| `command -v openlogos` | `/opt/homebrew/bin/openlogos` |
| 入口 realpath | `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js` |
| `npm prefix -g` | `/opt/homebrew` |
| 全局 `--version` | `0.16.0` |
| 仓内 `cli/package.json` | `0.16.0`（升版前） |

## 三、回滚制品（先于升版冻结）

- 来源：在全局安装目录 `/opt/homebrew/lib/node_modules/@miniidealab/openlogos` 执行 `npm pack --ignore-scripts`。
- 产物：`cli/rollback/miniidealab-openlogos-0.16.0.tgz`，2,545,365 字节，SHA-256 `2aa52d6e7327d52df2a9765e52f1b59fd6193741249450d2f65b88b0b443480b`。
- 内容身份：解包后 `dist/` 下 364 个文件与全局安装目录同名文件逐个比对 SHA-256，**0 个不一致**；包内无 `dist/lib/sandbox-reuse.js`，`dist/lib/sandbox.js` 不含 `openlogos-cli-sandbox-reuse-`。
- 旧行为：一次性隔离 prefix 试装后 `--version` 为 `0.16.0`；复用增量夹具（20 个源文件、`sandbox_cache_paths=["build-cache"]`）连续两次 verify 均为 `compiled=20`，`sandbox.reuse` 不出现。

## 四、版本与制品身份

- 升版：`node cli/scripts/bump-version.mjs 0.16.1` 一次写全 8 个版本载体（`cli/package.json`、lockfile 根包、`cli/asset-manifest.json`、5 份 plugin manifest），`local-release-candidate.ts` 候选 `0.16.0 → 0.16.1`、回滚 `0.15.20 → 0.16.0`，asset-manifest 由生成器重算。
- `CHANGELOG.md` 新增 `## [0.16.1] - 2026-10-13`（Added / Changed），既有条目未改。

## 五、源码回归证据

- 升版后 `cd cli && npm test`：**180 个文件、2675 个用例全部通过**；`npm run build` 通过。
- 覆盖本提案 UT-S13-89～UT-S13-100、ST-S13-25、UT-S19-57，以及 `UT-S19-46` / `UT-S19-49`（版本身份与 manifest 自洽）。

## 六、构建与 Tarball 冻结（唯一候选制品）

- `cli/miniidealab-openlogos-0.16.1.tgz`，2,569,849 字节，SHA-256 `1408433624eff96a210d917dcc46459988dd596c63392b1399f6250c6b364faa`（真实 `npm pack`，837 个文件）。
- 解包核对：`package.json` 版本 `0.16.1`；asset-manifest 自洽（version `0.16.1`，payloadHash `5b08c6e1a36666f4494959f8d16d1607199451431d5a6434a4521811afac3e9e`）；`dist/lib/sandbox.js` 引入 `./sandbox-reuse.js`，后者含 `openlogos-cli-sandbox-reuse-` 与 `sync-manifest.json`；`dist/index.js` 注册 `--fresh-sandbox`。
- 之后的隔离验证、全局安装均只使用此文件（安装前复核 SHA-256 一致）。

## 七、隔离 Prefix 行为矩阵（安装态证据）

| 类别 | 结果 |
|---|---|
| candidate identity | 一次性 prefix 安装成功；`--version` 为 `0.16.1`；入口位于该 prefix 内，包目录为真实目录（无 workspace link） |
| 复用增量 / 等长改写 | runner 自测模式（注入该 prefix 入口）SMOKE-core-240 **pass**：`compiled` 依次 20 → 1 → 0，等长改写并恢复 mtime 的源文件第 ④ 次为 `compiled=1` 且读到新内容，四次 `reuse.dir` 相同 |
| 版本与制品身份 | SMOKE-core-239 **pass**：版本 `0.16.1` 与 `local-release-candidate.ts` 候选一致，manifest 自洽 |
| 回退与兜底 / smoke 共用 | SMOKE-core-241 **pass**：`--fresh-sandbox` 为 `fresh` 且 `compiled=20`；smoke 与 verify 共用同一持久沙箱（`reused`）；`sandbox_reuse:false` 为 `disabled`、`compiled=20` 且一次性目录运行后不存在；`sandbox_mode:off` 不出现 `reuse` |
| 增量探针 | 两次 verify：`created`/`compiled=20` → `reused`/`compiled=0` |
| 全局零触碰 | 矩阵前后 `command -v openlogos` 与 `--version` 均为 `/opt/homebrew/bin/openlogos` / `0.16.0` |
| 回滚演练 | 回滚制品 SHA-256 与冻结记录一致；隔离 prefix 回装后 `--version` 为 `0.16.0`，同一夹具两次均 `compiled=20` 且无 `sandbox.reuse`（对照：差异确由候选引入） |

> 首次矩阵执行时以相对路径 `cli/miniidealab-openlogos-0.16.1.tgz` 调用 `npm install -g`，被 npm 解析为 GitHub 简写 `cli/<repo>` 而失败（exit 128，未安装任何内容，全局未受影响）；改用绝对路径后重跑，结果如上。

## 八、本机全局部署

- 执行：`npm install -g <绝对路径>/cli/miniidealab-openlogos-0.16.1.tgz`（同一候选文件）。
- 新 shell 复核：`command -v openlogos` = `/opt/homebrew/bin/openlogos`；入口 realpath = `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js`（真实目录，非链接）；`--version` = `0.16.1`；全局包 `package.json` 与 asset-manifest 版本均为 `0.16.1`，payloadHash `5b08c6e1…3e9e` 与候选一致；包内含 `dist/lib/sandbox-reuse.js`。
- 补充安装态证据（非 `openlogos smoke`，沙箱外以 runner 正式模式对全局安装运行，结果写独立账本、未写正式 smoke 账本）：SMOKE-core-239 / 240 / 241 均 **pass**（environment `local-global-temp-project`）。

## 九、回滚入口

- 回滚制品：`cli/rollback/miniidealab-openlogos-0.16.0.tgz`，SHA-256 `2aa52d6e7327d52df2a9765e52f1b59fd6193741249450d2f65b88b0b443480b`。
- 回滚命令：`npm install -g <绝对路径>/cli/rollback/miniidealab-openlogos-0.16.0.tgz`，新 shell 复核 `--version` 为 `0.16.0`。注意必须使用绝对路径（见第七节说明）。
- 回装后 `sandbox_root` 下遗留的 `openlogos-cli-sandbox-reuse-*` 持久项目目录不被旧版读取，可确认无进程使用后手动删除。

## 十、提示与后续

- 已有项目无需修改配置即默认启用复用；编译型项目可按需声明 `sandbox_cache_paths`（如 `src-tauri/target`）。
- 被弃用世代（`sandbox.reuse.abandoned`）需确认无进程使用后手动清理。
- 在 Seatbelt 等嵌套沙箱内（如 `openlogos smoke` 以 sandbox-exec 包裹 runner、Claude Code 沙箱模式、Codex）无法执行 setuid 的 `/bin/ps`，复用按规格判 `unsupported` 并退回一次性沙箱。因此正式 `openlogos smoke` 中 SMOKE-core-240 / 241 预计记为 `skip` + `reason_code:"platform-unavailable"`；真实复用证据见第七、八节。
- runlogos 的 `sandbox_root` 仍为 `/private/tmp`（内置盘）；持久沙箱会常驻一份工作区副本（约 8 GB），是否改到外置盘由用户决定。

# 部署报告：release-0-16-1 / OpenLogos 0.16.1 公开发布（2026-10-13，**门② 未通过：未推送、未发布**）

## 一、结论

- 推 tag 前门 ② 的 Linux 干净克隆预演暴露 0.16.1 的**运行时行为缺陷**（见第三节），按部署方案档 A 与本提案 defaults「属运行时行为缺陷的，停止发布并另立修复提案」处置：**未推送 master、未推送 tag、未执行 npm publish / GitHub Release / 官网部署，未写 DEPLOY_DONE**。
- npm `dist-tags` 保持 `latest=0.16.0`、`old=0.9.8`；GitHub Release 与官网不变；本机全局保持本地构建的 0.16.1。无需回滚任何公网制品。
- 本地新增两个未推送提交：`1704446`（docs: merge spec deltas）、`329c511`（feat: 发布说明、英文摘要与公网 smoke runner）。`origin/master` 仍为 `e2b7ac0`，本地领先 4 个提交。

## 二、已通过的门

- **门 ①（本地，macOS，Node v23.10.0）**：`npm run lint` 0 error；`tsc --noEmit` 通过；`npm test` 2675 passed；`npm run build` 通过；`cd website && npm ci && npm run build` 通过（Python 字体工具取自独立 venv：fonttools + brotli），构建后工作区无变化。
- **门 ② 阶段二（docker `node:22.12.0`，`node@sha256:0e910f435308c36ea60b4cfd7b80208044d77a074d16b768a81901ce938a62dc`）**：提交 `329c5119a7e893e80e324750e339f0e98f3abcdf`，官网 `npm ci` 0、`npm run build` 0。
- **门 ② 阶段一的非测试项（docker `node:20`，`node@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5`，Node v20.20.2）**：版本与 CHANGELOG 一致性校验通过（Release 正文 1464 字符，不含「未发布到 npm」）；`npm pack` 837 个文件，SHA-256 `6d2b92ea6cb9ecf648bc6825504dda152aca612ed7e98ee84ca1edce56fae9ce`；无孤儿 dist 产物；包内含 `dist/lib/sandbox-reuse.js`；asset-manifest 自洽（0.16.1）；lint 0、tsc 0。
- **门 ④**：当前 gh 账号 `bergkampzhang` 读取仓库 secrets 返回 HTTP 403，无法直接确认存在性。间接证据：v0.16.0 publish run（38027722547）的 `Publish` 步骤 success（`NPM_TOKEN` 可用）；Cloudflare 两项凭据当时因「Verify website latest version matches tag」失败而未被校验。重试前需以有权限的账号（如 `gh auth switch --user miniidealab`）复核。

## 三、门 ② 阶段一失败：Linux 上沙箱复用的旧写入者存活检查误判

- 第一次以 root 运行：13 个失败，均为权限注入与缺 sqlite3 的预演环境差异（与 0.16.0 预演第一次运行同型），按 0.16.0 口径改为非 root 用户 `node` + sqlite3 3.40.1 重跑。
- 非 root 重跑：**9 个失败，全部是沙箱复用用例**——UT-S13-89 / 92 / 93 / 95 / 96 / 97 / 99、ST-S13-25、UT-S19-57（另一次运行为 11 个，含 UT-S13-91 / 94）。单独运行这些用例、或在容器内直接用执行器 / 真实 CLI 连续 verify 均正常（`created` → `reused`），只在全量并发时失败。
- 在容器临时克隆中给释放逻辑加日志后跑全量，51 次 tainted 中 **44 次原因为「同用户存活进程 N 的环境不可读（EACCES）」**（另 6 次为测试进程内 `/bin/ps` 不可用，1 次为进程组仍有成员）。
- **根因**：code-r1 F2 的修复把「同用户、仍存活但 `/proc/<pid>/environ` 不可读」一律判为无法完成扫描。Linux 上不可转储（non-dumpable）进程的 environ 对同用户也不可读（如 Chromium / Electron 的沙箱渲染进程、exec 过不可读二进制的进程），机器上只要存在一个这样的同用户进程，每次释放都会写 `tainted`、下一轮新建世代全量同步并累积被弃用世代——**Linux 上复用基本失效**，且对运行 Electron 应用（如 RunLogos）的桌面几乎必然触发。macOS 经 setuid 的 `/bin/ps` 读取，不受影响。
- **修复方向（建议另立提案，例如 `fix-sandbox-reuse-linux-liveness`）**：对 environ 不可读的同用户进程，读取 `/proc/<pid>/stat` 的启动时刻（不受 dumpable 限制），与命令启动时刻比较——早于命令启动的进程不可能是其后代，跳过；晚于（或无法读取启动时刻）的仍判无法完成扫描。命令启动时刻随 `released` / `tainted` 记录，供下一轮复查使用。这样既保留 code-r1 F2「不得把无法确认当作不存在」的语义，又不误伤与本轮无关的长寿进程。

## 四、重试条件

修复提案归档后回到本提案：如修复改动了 CLI 行为，CHANGELOG `## [0.16.1]` 需补该修复（版本号不变，0.16.1 尚未进入 registry），重新执行四道门；门 ② 阶段一必须以非 root 用户、具备 sqlite3 的环境全绿。

# 部署报告：release-0-16-2 / OpenLogos 0.16.2 公开发布（2026-10-14 UTC，**已发布**；原 publish run 官网校验因 registry 处理延迟失败，按档 C 受控补做）

public_release_version: 0.16.2
public_release_commit: 236f5a2c116f5c31c272fd2d49cbf75d21d90369

## 一、结论

- 0.16.2 已公开发布：npm `dist-tags.latest=0.16.2`（`old=0.9.8` 不变），GitHub Release `v0.16.2` 为 latest，官网 `/releases` 与 `/zh/releases` latest 为 v0.16.2；三处同源于 tag 提交 `236f5a2c116f5c31c272fd2d49cbf75d21d90369`。0.16.1 未进入 registry、无 Release、官网无条目。
- 成功判据取方案第二种：publish run 38493425289 的 `Publish` 与 `Create GitHub Release` 步骤 success，「Verify website latest version matches tag」失败（registry 处理延迟），官网按档 C 受控补做。**原 run 不是全绿**，未重跑原 run 或其 job。
- 过程中第一次尝试（候选 `1bd7588`）在门 ③ 暴露沙箱复用运行时缺陷，按用户决定（决策 C08）在本提案内修复（增量修正 merge → 切片 2 → verify），在新候选 `236f5a2` 上重走四道门后发布。
- 本机全局已从 registry 切换到 0.16.2。

## 二、冻结事实

- npm：`latest=0.16.0`、`old=0.9.8`；`@0.16.1`、`@0.16.2` 均 E404。
- git：发布候选 `1bd758805af0d540c992be3507f863346e8b2f52`；冻结时 `origin/master=e2b7ac0`，本地领先 8 个提交；远端 tag 只有 `v0.16.0`。
- 本机全局：`/opt/homebrew/bin/openlogos` → `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js`，`npm prefix -g=/opt/homebrew`，`--version=0.16.1`（本地构建，修复前）。
- 回滚制品 `cli/rollback/miniidealab-openlogos-0.16.0.tgz`：2545365 字节，SHA-256 `2aa52d6e7327d52df2a9765e52f1b59fd6193741249450d2f65b88b0b443480b`，与已冻结值一致。
- `git log v0.16.0..HEAD -- .github/workflows/publish.yml` 为空：0.16.0 之后 publish.yml 无改动，档 C 恢复演练无需重做。
- 第二次尝试前复核：npm 仍 `latest=0.16.0`、`@0.16.1` / `@0.16.2` E404；远端 tag 仍只有 `v0.16.0`；回滚制品 SHA-256 不变。

## 三、第一次尝试（候选 `1bd7588`）：门 ①②④ 通过、门 ③ 未通过

- **门 ①（本地，macOS，Node v23.10.0）**：`npm run lint` 0；`tsc --noEmit` 0；`npm test` 2677 passed / 1 skipped；`npm run build` 0；`cd website && npm ci && npm run build` 0（宿主 python3 缺 fontTools，第一次官网构建在字体子集化步骤失败；按 0.16.0 口径改用独立 venv：Python 3.14.7、fonttools 4.66.1 + brotli 重跑通过，未改动系统 Python），构建后工作区无变化。
- **门 ② 阶段一（docker `node:20`，基础镜像 `node@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5`，其上仅加装 sqlite3 的本地镜像 `sha256:4ef106618500c5819bee0a49eea485ee5caaf482e4dec7689d09efac31b770e0`）**：用户 `node`（uid 1000）、Node v20.20.2、sqlite3 3.40.1、cc（Debian 12.2.0）；容器内 `git clone` 提交 `1bd7588`（5566 个跟踪文件）。`npm ci` 0、`npm test` 0（2659 passed / 19 skipped）、`npm run build` 0；版本 / plugin / CHANGELOG 一致性通过（Release 正文 3912 字节，不含「未发布到 npm」）；`npm pack` 837 个文件，SHA-256 `a8a3df22764f621af138b0b42c1fcca1bff646aeaf48cbebc67aa9a79d9eca80`，无孤儿 dist 产物、asset-manifest 自洽（0.16.2）、`dist/lib/sandbox-reuse.js` 含 `command_started_uptime`；lint 0、tsc 0。**沙箱复用用例 UT-S13-89～UT-S13-102、ST-S13-25、ST-S13-26、UT-S19-57 在 reporter 账本中全部为 `pass`**；账本中 skip 的 10 个为既有能力探测用例（UT-S13-47～50 / 52～54、ST-S13-14、UT-S19-08 / 09），与沙箱复用无关。
- **门 ② 阶段二（docker `node:22.12.0`，基础镜像 `node@sha256:0e910f435308c36ea60b4cfd7b80208044d77a074d16b768a81901ce938a62dc`，加装 python3-fonttools 4.38.0 与 python3-brotli）**：uid 1000，提交 `1bd7588`，官网 `npm ci` 0、`npm run build` 0。
- **门 ④**：以 `miniidealab` 账号执行 `gh secret list`，`NPM_TOKEN`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 均已配置（只查存在性）。

### 门 ③ 失败：CI run 38486602622

- 推送：`bergkampzhang` 账号推送被拒（HTTP 403），切换到 `miniidealab` 后推送成功（`e2b7ac0..1bd7588`）。
- `Windows regression`：success。`Lint & Test`：failure，2 failed / 2657 passed / 19 skipped：
  1. **ST-S36-06**：`Test timed out in 10000ms`，属已知的全量负载下 10 秒用例偶发超时，与本次改动无关。
  2. **UT-S13-97（旧写入者跨轮残留，EX-3.7）**：断言首轮释放原因含「运行标记扫描命中」，实际为「运行标记扫描失败（同用户存活进程 13261 的环境不可读（EACCES），且启动时刻无法确认（stat 启动时刻字段无法解析））」。门 ② 的 docker 全量运行中该用例通过，GitHub ubuntu runner 上失败。
- **当时的初步分析（已被实测推翻，见第五节）**：`parseProcStat`（`cli/src/lib/sandbox-reuse.ts`）在 `num_threads < 1`、启动时刻或 flags 字段无法解析时抛出「stat 启动时刻字段无法解析」，按 §2.92.2 第 4 条判无法完成扫描。这与 §2.92.2 的字面判据一致，但存在一个缺口：一个 environ 不可读的同用户进程如果在 environ 读取与 stat 读取之间退出、成为尚未回收的僵尸，其 stat 的 `num_threads` 可能为 0，于是被判「无法解析」而不是「已退出」，导致释放误写 `tainted`。并发负载下（CI 并行执行多个测试文件、不断有短命子进程退出）这个竞态可以被触发。该失败属于沙箱复用的运行时判定，不是测试超时。
- **修复方向（建议另立提案）**：在 §2.92.2 中把「stat 可读、状态为 Z / X 或 `num_threads` 为 0」明确为已退出并跳过（与 §2.92.2 现有的线程组退出判定口径对齐），并补一条在并发进程退出竞态下仍得 `released` 的用例；同时确认 UT-S13-97 的断言在 Linux 并发环境下的稳健性。

处置：未推 tag、未发布、未写 DEPLOY_DONE（记录提交 `5bdfba4`）。`origin/master` 已前进到 `1bd7588`，无公网制品需要回滚。

## 四、根因确认

- 僵尸假设被实测推翻：docker `node:20` 非 root 下，不可转储进程退出后未回收时 environ 仍 EACCES，stat `state=Z`、`num_threads=1`、启动时刻可解析。
- 真实根因：内核生成 `/proc/<pid>/stat` 时，`num_threads` 只有锁住进程 sighand 后才填入实际值，否则为 0；进程被回收（release_task）时 sighand 被置空。读取与回收竞态时得到启动时刻正常、`num_threads` 为 0 的 stat，旧实现 `parseProcStat` 以 `threads < 1` 抛出「stat 启动时刻字段无法解析」→ 无法完成扫描 → 释放误写 `tainted`。
- 实证一（C 紧循环，docker `node:20` 非 root，40 秒）：约 71.7 万次成功读取中 991 次 `num_threads=0`（子进程 `_exit` 后立即被回收，僵尸态为 1，故 0 只出现在回收瞬间）。
- 实证二（新旧实现对比，docker `node:20` 非 root，各 30 秒，持续 exec 0111 的 `true` 副本制造不可转储短命进程，命令启动时刻设在远未来以排除启动时刻分支）：旧实现（第一次门 ② 打出的 0.16.2 包）42.05 万次扫描失败 4992 次，原因全部为「…启动时刻无法确认（stat 启动时刻字段无法解析）」，与 CI 报错一致；新实现 43.79 万次扫描 0 失败。

## 五、本提案内修复（决策 C08）

- 规格增量修正（`1017fe4`）：§2.92.2 第 4 条补「stat 可读但 `num_threads` 为 0 → 已被回收，视为已退出跳过」（线程级 stat 同口径；启动时刻字段仍须可解析）；§2.92.6 追溯与 `core-S13-test-cases.md` 新增 UT-S13-103。merge 结果：增量修正 重修 2 / 新增 2，`test_change_set` = SMOKE-core-246～250 + UT-S13-103，VERIFY_PASS 随之清除。
- 代码（`b706f5a`）：`parseProcStat` 接受 `num_threads` 为 0 并标识 `reaped`；`scanProcEnvironment` 对已回收进程按已退出跳过；线程组退出确认把已回收线程视为已退出；新增 UT-S13-103（修改前实现上必红，报错与 CI 逐字一致）；CHANGELOG `## [0.16.2]` Fixed 补该修复。
- 验收：`openlogos verify` 依次确认切片 1、切片 2 的 checkpoint，最终全量 PASS（executed 2269 / failed 0 / uncovered 0 / skipped 25），验收报告 `236f5a2`。

## 六、第二次尝试（候选 `236f5a2`）：四道门

- **门 ①**：本地 `npm run lint` 0、`tsc --noEmit` 0、`npm test` 2678 passed / 1 skipped、`npm run build` 0；官网（venv：Python 3.14.7、fonttools 4.66.1 + brotli）`npm run build` 0，构建后工作区无变化。
- **门 ② 阶段一**（同一预演镜像，基础 `node@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5` + sqlite3）：uid 1000、Node v20.20.2、sqlite3 3.40.1、cc 12.2.0；提交 `236f5a2`；`npm ci` / `npm test`（2660 passed / 19 skipped）/ build / 版本一致性（Release 正文 4256 字节，不含「未发布到 npm」）/ `npm pack`（837 个文件，SHA-256 `c27269920a994264e815ca46642a6e7a59e81d8ba2316bfff0eb1d11043eafe0`，无孤儿产物、manifest 自洽、含 `command_started_uptime`）/ lint / tsc 全为 0；UT-S13-89～UT-S13-103、ST-S13-25、ST-S13-26、UT-S19-57 在 reporter 账本中全部 `pass`，skip 仍为同样 10 个既有能力探测用例。
- **门 ② 阶段二**（`node@sha256:0e910f435308c36ea60b4cfd7b80208044d77a074d16b768a81901ce938a62dc` + python3-fonttools 4.38.0 / python3-brotli）：官网 `npm ci` 0、`npm run build` 0。
- **门 ③**：以 `miniidealab` 推送 `1bd7588..236f5a2`；CI run 38492640788 的 `Lint & Test` 与 `Windows regression` 均 success。
- **门 ④**：`NPM_TOKEN`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 均在（只查存在性）；0.16.0 之后 publish.yml 无改动，档 C 演练不重做。

## 七、tag 驱动发布与档 C 受控补做

- 在 `236f5a2` 上创建 annotated tag `v0.16.2` 并推送；publish run 38493425289：checkout → `npm ci` → 测试 → build → 版本校验 → Release 正文 → pack → **Publish success**（`+ @miniidealab/openlogos@0.16.2`，provenance 已写入 sigstore 透明日志 logIndex 3247631734；npm 提示「Your package is being processed and may take a few minutes to become available」）→ **Create GitHub Release success** → 官网环境 / strict 生成 / build success → **Verify website latest version matches tag failure**（`latestVersion=0.16.0 与 tag=0.16.2 不一致`：生成时 registry 仍在处理新版本，packument 为 84 个版本）→ Cloudflare 两步 skipped。
- 档 C 第 1 步（registry 身份）：registry 于 01:09:40Z 可见；`dist-tags.latest=0.16.2`、`version=0.16.2`、`dist.integrity=sha512-q3I1DaqFV0hewRL2x8Wi5lrdYGAydbWDSaNfoze24grgWn/OX7tHZlykRB9oNvN4cjJnjvoGxf/ZNVEXOpr+4g==`；无 `gitHead`（tarball 发布）；SLSA provenance `resolvedDependencies[0]` 指向 `refs/tags/v0.16.2`、`gitCommit` 等于 tag 提交（`provenanceSourceProblems` 无问题项）；`npm pack @miniidealab/openlogos@0.16.2` SHA-256 `c27269920a994264e815ca46642a6e7a59e81d8ba2316bfff0eb1d11043eafe0`，**与门 ② Linux 干净克隆打出的包逐字节相同**。
- 档 C 第 2 步（Release）：`gh release view v0.16.2` 已存在，非 draft / prerelease，releases/latest 为 `v0.16.2`，正文与 `v0.16.2:CHANGELOG.md` 的 `## [0.16.2]` 一致，唯一附件 `miniidealab-openlogos-0.16.2.tgz` SHA-256 与 registry tarball 相同——跳过 create，未 upload。
- 档 C 第 3 步（官网）：在 `v0.16.2` 的干净克隆中（Node v23.10.0 + 字体 venv）`npm ci` 0 → `generate:releases -- --strict` 0 → `npm run build` 0，`latestVersion=0.16.2`、0.16.2 摘要为 bilingual、无 0.16.1 条目；以本机 Cloudflare 凭据（OAuth，账号 b9168242…）执行 `wrangler pages deploy dist --project-name openlogos --branch master` 成功（预览 `https://1bfaa52e.openlogos.pages.dev`）。线上 `https://openlogos.ai/releases/` 与 `/zh/releases/` 200，latest 均为 v0.16.2，有 v0.16.2 卡片、无 v0.16.1 卡片。

## 八、发布后同步与本机全局切换

- 本地 `cd website && npm run generate:releases -- --strict`：`releases.json` 更新为 85 个版本、`latestVersion=0.16.2`，作为「同步官网发布资源」提交入库。
- 本机全局：`npm install -g @miniidealab/openlogos@0.16.2`（registry）。新 shell 复核：`/opt/homebrew/bin/openlogos` → `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js`，包目录非链接；`openlogos --version=0.16.2`；包内 asset-manifest 版本 0.16.2 且经 `validateAssetManifest` 自洽；全局包与 registry tarball 解包后逐文件比对 0 差异（837 个文件）。
- 随包 guard 模板与本仓 `.claude/openlogos/bin/guard-check` SHA-256 一致（`bd4ebdd9…`），未执行 `openlogos sync`。
- 回滚入口不变：`cli/rollback/miniidealab-openlogos-0.16.0.tgz`（SHA-256 `2aa52d6e…480b`）；公网回退按方案档 D（`dist-tag latest` 回指 0.16.0 + `npm deprecate 0.16.2` + 前滚 0.16.3）。
- runlogos 调用本机全局 `openlogos`，随本机切换即获得 Linux 修复；其仓库内的托管 guard 等资产如需刷新，需用户授权后在该仓库自行 `openlogos sync`。
- 之后经 `openlogos deploy-done` 受控落标，再进入 smoke（SMOKE-core-246～250 与复用的 SMOKE-core-01 / 02 / 04 / 07 / 08 / 15）。

## 九、smoke

- 第一次 `openlogos smoke`：门 FAIL。本提案 SMOKE-core-246 / 248 / 249 / 250 pass，SMOKE-core-247 ①～④ 通过、⑤ 在 Seatbelt 嵌套沙箱内为 `unsupported`（skip + `platform-unavailable`，规格允许）；失败项为复用的 SMOKE-core-07：`website/scripts/smoke-releases.mjs` 以未转义原文比对页面 HTML，0.16.2 英文摘要中的撇号渲染为 `&#39;` 导致误报，runner 随即中止，SMOKE-core-03 / 15 / 21～24 / 34～37 因此未覆盖。线上页面渲染正确。
- 按用户决定（决策 C09）并入切片 1 修正 runner（`df0cb39`）：发布数据文本与页面比对时原文或 HTML 转义形式任一在场即可；在 0.16.2 发布数据的干净克隆中，修改前 runner 07 fail 并中止，修改后 12 个官网用例全部 pass。补跑 verify 最终全量 PASS（executed 2269 / failed 0 / uncovered 0）。未改英文摘要，未重新部署官网。
- 第二次 `openlogos smoke`：门 PASS（executed 212 / failed 0 / uncovered 0；platform-unavailable 仅 SMOKE-core-247），SMOKE-core-01 / 02 / 03 / 04 / 07 / 08 / 15、246 / 248 / 249 / 250 均 pass，写入 SMOKE_PASS。

# 部署报告：fix-environment-registry-review-gaps / OpenLogos 0.16.3 本机全局发布（2026-10-15，**已部署：本机全局**）

## 一、授权与目标

- 依据：
  - 部署方案「OpenLogos 0.16.3 发布方案（环境登记表与评审缺口修复，本地全局）」；
  - 提案决策 C04（用户 2026-10-14：「本版本需要部署本机全局」）；
  - 本次 `openlogos next --auto` 的 deliver-entry 门 `gate_auto_passed=true`（`GATE_AUTO_PASSED` 2026-10-15T06:39:58.848Z）。
- 内容：环境登记表与部署账本（已归档的 environment-registry）连同本提案的复核修复，一并装进本机全局安装。
- 范围：只做本机全局安装与本仓 `openlogos sync`。
  - 未执行 `npm publish`、dist-tag、`git tag`、`gh release`、`git push`。
  - 未改写其他仓库（含 runlogos）；未修改 `logos/logos.config.json`。

## 二、冻结事实（部署前）

| 项 | 值 |
|---|---|
| `command -v openlogos` | `/opt/homebrew/bin/openlogos` |
| 入口 realpath | `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js` |
| `npm prefix -g` | `/opt/homebrew` |
| 全局 `--version` | `0.16.2` |
| 仓内 `cli/package.json` | `0.16.2`（升版前） |
| registry 版本复核 | `npm view @miniidealab/openlogos@0.16.3 version` 返回 E404；registry 已有版本最高为 `0.16.2`。候选版本 `0.16.3`、回滚版本 `0.16.2`，均与计划值一致 |

## 三、回滚制品（先于升版冻结）

- 来源：在全局安装目录 `/opt/homebrew/lib/node_modules/@miniidealab/openlogos` 执行 `npm pack --ignore-scripts`，未从工作树打包。
- 产物：`cli/rollback/miniidealab-openlogos-0.16.2.tgz`，2,574,234 字节，SHA-256 `ceb8c0403cbdfbbe4764ad79f405a1d7bb884a930665478957ec1ef77008f3b5`。
- 内容身份：
  - 解包后 837 个文件（其中 `dist/` 下 368 个）与全局安装目录同名文件逐个比对 SHA-256，**0 个不一致、0 个缺失**；
  - 包内不含 `dist/commands/env.js` 与 `dist/lib/deployment-ledger.js`。
- 旧行为：一次性隔离 prefix 试装后，`--version` 为 `0.16.2`，`openlogos env list` 报 `Unknown command: env`（exit 1）。

## 四、版本与制品身份

- 升版：`node cli/scripts/bump-version.mjs 0.16.3` 一次写全 8 个版本载体：
  - `cli/package.json`、lockfile 根包、`cli/asset-manifest.json`、5 份 plugin manifest；
  - `local-release-candidate.ts`：候选 `0.16.2 → 0.16.3`，回滚 `0.16.0 → 0.16.2`；
  - asset-manifest 由生成器重算，未手改。
- `CHANGELOG.md` 新增 `## [0.16.3] - 2026-10-15`（Added / Fixed / 升级提示），注明「本机全局发布（未发布到 npm）」，既有条目未改。

## 五、源码回归证据

- 升版后依次执行，全部通过：
  - `cd cli && npm run lint`：0 error；
  - `npx tsc --noEmit`：通过；
  - `npm test`：**186 个文件、2738 个用例通过、1 个 skipped**；
  - `npm run build`：通过。
- 覆盖范围：
  - environment-registry 的 S41 / S11 / S21 / S19 用例；
  - 本提案的 UT-S19-68～UT-S19-71、ST-S19-28、UT-S40-29；
  - `UT-S19-46` / `UT-S19-49`（版本身份与 manifest 自洽，账本中均为 pass）。

## 六、构建与 Tarball 冻结（唯一候选制品）

- 产物：`cli/miniidealab-openlogos-0.16.3.tgz`，2,630,203 字节，SHA-256 `ab1abe367bd385c2a94ae9561a9854fa890ebeecf0d415a558a11cf492002ff6`（真实 `npm pack`，850 个文件）。
- 解包核对：
  - `package.json` 与 asset-manifest 版本均为 `0.16.3`；manifest 自洽，payloadHash `95d0caf50fd99e4f22c4a20d046b13212f1af3136b7ee44400d310e4cb029110`；
  - 包内存在 `dist/commands/env.js`、`dist/lib/deployment-ledger.js`；`dist/index.js` 注册 `env` 命令与 `--ref`；
  - `claude-plugin-template/bin/guard-check` 的内置默认豁免含 `logos/environments.yaml`；
  - 包内 `spec/logos.config.schema.json` 可按 JSON 解析，`guard.exempt.default` 为 3 条；
  - `dist/lib/deployment-ledger.js` 采用临时文件原子替换追加；`dist/commands/smoke.js` 含 `SMOKE_LEDGER_WRITE_FAILED`。
- 之后的隔离验证与全局安装只使用这一个文件。

## 七、隔离 Prefix 行为矩阵（安装态证据）

| 类别 | 结果 |
|---|---|
| candidate identity | 一次性 prefix 安装成功；`--version` 为 `0.16.3`；入口位于该 prefix 的包目录内（真实目录，无 workspace link）；安装后 850 个文件与 tarball 解包内容逐字节一致 |
| 环境登记全链路 | runner 自测模式（注入该 prefix 入口）SMOKE-core-252 **pass**：<br>① `env check` 通过；<br>② `deploy-done --env 生产 --ref HEAD` 写出单行 JSON `DEPLOY_DONE`（`environment=prod`、`ref` 为当时 HEAD），账本新增 1 行 deploy；<br>③ `smoke --env prod` 门禁 PASS，`env_evidence=declared`、`verified=true`、`ledger_written=true`，runner 读到 `OPENLOGOS_SMOKE_ENV=prod`；<br>④ `env show prod` 的 `last_smoke.verified=true`，`current_ref` 等于部署 ref；<br>⑤ `status` 中 prod 视图与 ④ 一致 |
| 本次修复 | SMOKE-core-253 **pass**：<br>① 截断 `DEPLOY_DONE` 后报 `SMOKE_DEPLOY_MARKER_INVALID`，`error.details.problems=["not valid JSON"]`，smoke 命令未运行；<br>② 预置新鲜账本锁后报 `SMOKE_LEDGER_WRITE_FAILED`（`stage=ledger`），stderr 只有一份 JSON，两种标记与账本逐字节不变；<br>③ 旧 `SMOKE_FAIL` 加只读提案目录时报 `SMOKE_LEDGER_WRITE_FAILED`（`stage=marker`、`rollback=complete`），旧 `SMOKE_FAIL` 原样保留、无 `SMOKE_PASS`、账本无本次 smoke 行 |
| 版本与制品身份 | SMOKE-core-251 **pass**：版本 `0.16.3` 与 `local-release-candidate.ts` 候选一致；manifest 自洽；包内行为载体齐全；本仓 `.claude/openlogos/bin/guard-check` 与包内模板 SHA-256 一致（`a3e7c288…f902`） |
| 无登记表零回归 | 同一无登记表夹具分别以候选与 0.16.2 回滚制品执行 `deploy-done` / `smoke` / `status --format json`：退出码、`deploy-done` 关键字段（slug / environment=null / 勾选数 / next_step、无 `deployment`）、smoke 门禁与 summary（无 `environment_evidence`）、标记与账本存在性（均不写账本）、`status` 无 `environments` / `environment_ledger`，**两侧完全一致** |
| 全局零触碰 | 矩阵前后 `command -v openlogos` 与 `--version` 均为 `/opt/homebrew/bin/openlogos` / `0.16.2` |
| 回滚演练 | 回滚制品 SHA-256 与冻结记录一致；在隔离 prefix 回装后 `--version` 为 `0.16.2`，`env list` 报未知命令（对照：差异确由候选引入） |

## 八、本机全局部署与本仓 sync

- 安装：`npm install -g <绝对路径>/cli/miniidealab-openlogos-0.16.3.tgz`（同一候选文件），exit 0。
- 新 shell 复核：
  - `command -v openlogos` = `/opt/homebrew/bin/openlogos`；
  - 入口 realpath = `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js`（真实目录，非链接）；
  - `--version` = `0.16.3`；全局包 `package.json` 与 asset-manifest 版本均为 `0.16.3`，manifest 自洽，payloadHash 与候选一致；
  - 全局包 850 个文件与 tarball 逐字节一致。
- 本仓 sync：在项目根执行 `openlogos sync`（v0.16.3），exit 0。之后逐字节比对：
  - `.claude/openlogos/bin/guard-check`、`.claude/openlogos/bin/guard-post-check.cjs` 与全局包 `claude-plugin-template/bin/` 同名文件**一致**；
  - `logos/skills/deployment-designer/SKILL.md`、`logos/skills/deployment-executor/SKILL.md` 与全局包内同名 Skill **一致**。
- sync 产生的托管文件变化：
  - `logos/spec/cli-json-output.md` 刷新为当前根规范（保留）；
  - `.claude/settings.json` 被重复加入一条 SessionStart `openlogos-phase` hook，并去掉了文件末尾换行。这与提交 `bf61f6f`（「`.claude/settings.json` 去除重复的 SessionStart hook」）记载的现象相同，按该先例还原为 HEAD 内容，不保留重复 hook。
- 补充安装态证据：沙箱外以 runner 正式模式对全局安装运行 SMOKE-core-251～253，结果写入独立文件，未写正式 smoke 账本。结果见第十一节。

## 九、回滚入口

- 回滚制品：`cli/rollback/miniidealab-openlogos-0.16.2.tgz`，SHA-256 `ceb8c0403cbdfbbe4764ad79f405a1d7bb884a930665478957ec1ef77008f3b5`。
- 回滚命令：`npm install -g <绝对路径>/cli/rollback/miniidealab-openlogos-0.16.2.tgz`，新 shell 复核 `--version` 为 `0.16.2`；必须使用绝对路径（相对路径会被 npm 解析为 GitHub 简写）。
- 若已在本仓执行 sync：用回装后的 0.16.2 再执行一次 `openlogos sync`，或以 git 恢复 sync 前的托管文件。
- 无数据迁移。回装后项目中的 `logos/environments.yaml` 与运行态账本不被旧版读取，保留不影响旧版行为。

## 十、提示与后续

- 已显式配置 `guard.exempt` 的项目不会自动获得新的内置默认豁免。如需免立案编辑 `logos/environments.yaml`，由用户执行 `openlogos exempt add logos/environments.yaml`。
- 本仓未登记环境（无 `logos/environments.yaml`），本次 `openlogos deploy-done` 不带 `--env`，不写部署账本。
- 下一步按流程运行 `openlogos smoke`（SMOKE-core-251～253 由 `scripts/smoke-environment-registry-0-16-3.js` 执行）。runner 需要通过 `OPENLOGOS_ENVREG_TARBALL` 取得候选 tarball 路径，缺失时三条用例写显式 skip。

## 十一、全局安装后的补充安装态证据

runner `scripts/smoke-environment-registry-0-16-3.js` 以正式模式运行：
- 前置条件全部满足：候选 tarball 由 `OPENLOGOS_ENVREG_TARBALL` 给出；本记录已写明候选版本与 tarball SHA-256；本仓托管副本在场。
- 入口为 PATH 中、位于 `npm prefix -g` 包目录内的 `openlogos`。
- 结果写入独立文件，未写正式 smoke 账本，不代替 `openlogos smoke`。

| 用例 | 结果 | environment |
|---|---|---|
| SMOKE-core-251 | **pass**：安装态身份同源（0.16.3），manifest 自洽，包内行为载体齐全，本仓托管 guard 与全局包一致 | `local-global-temp-project` |
| SMOKE-core-252 | **pass**：登记 → 部署（alias `生产` 解析为 `prod`、ref 为当时 HEAD）→ smoke 已验证 → `env show` / `status` 一致 | `local-global-temp-project` |
| SMOKE-core-253 | **pass**：截断 `DEPLOY_DONE` 带 `details.problems`；账本锁占用与标记阶段失败均以 `SMOKE_LEDGER_WRITE_FAILED` 结束，现场一致 | `local-global-temp-project` |

# 部署报告：environment-deploy / OpenLogos 0.16.4 本机全局发布（2026-10-15，**已部署：本机全局**）

## 一、授权与目标

- 依据：
  - 部署方案「OpenLogos 0.16.4 发布方案（环境部署执行，本地全局）」；
  - 提案待定决策 C14 的推荐方案（升版 0.16.4，安装到本机全局，并在本仓执行 `openlogos sync`）；
  - 本次 `openlogos next --auto` 的 deliver-entry 门 `gate_auto_passed=true`（`GATE_AUTO_PASSED` 2026-10-15T13:49:13.552Z）。
- 内容：`openlogos deploy` 执行器（script / ci / agent）、版本通道、提案通道与回滚，以及改动后的 deployment-designer / deployment-executor 两个 Skill，装进本机全局安装态。
- 范围：只做本机全局安装与本仓 `openlogos sync`。
  - 未执行 `npm publish`、dist-tag、`git tag`、`gh release`、`git push`。
  - 未改写其他仓库（含 runlogos）；未在本仓配置 `logos/environments.yaml`；未修改 `logos/logos.config.json`。

## 二、冻结事实（部署前）

| 项 | 值 |
|---|---|
| `command -v openlogos` | `/opt/homebrew/bin/openlogos` |
| 入口 realpath | `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js` |
| `npm prefix -g` | `/opt/homebrew` |
| 全局 `--version` | `0.16.3` |
| 仓内 `cli/package.json` | `0.16.3`（升版前） |
| registry 版本复核 | `npm view @miniidealab/openlogos@0.16.4 version` 返回 E404；registry 已有版本最高为 `0.16.2`。候选版本 `0.16.4`、回滚版本 `0.16.3`，均与计划值一致 |

## 三、回滚制品（先于升版冻结）

- 来源：在全局安装目录 `/opt/homebrew/lib/node_modules/@miniidealab/openlogos` 执行 `npm pack --ignore-scripts`，未从工作树打包。
- 产物：`cli/rollback/miniidealab-openlogos-0.16.3.tgz`，2,630,203 字节，SHA-256 `ab1abe367bd385c2a94ae9561a9854fa890ebeecf0d415a558a11cf492002ff6`（与 0.16.3 部署记录中的唯一候选制品字节一致，全局正是由它安装）。
- 内容身份：
  - 解包后 850 个文件（其中 `dist/` 下 380 个）与全局安装目录同名文件逐个比对 SHA-256，**0 个不一致、0 个缺失**；
  - 包内不含 `dist/commands/deploy.js`。
- 旧行为：一次性隔离 prefix 试装后，`--version` 为 `0.16.3`，`openlogos deploy --env x` 报 `Unknown command: deploy`（exit 1）。

## 四、版本与制品身份

- 升版：`node cli/scripts/bump-version.mjs 0.16.4` 一次写全 8 个版本载体：
  - `cli/package.json`、lockfile 根包、`cli/asset-manifest.json`、5 份 plugin manifest；
  - `local-release-candidate.ts`：候选 `0.16.3 → 0.16.4`，回滚 `0.16.2 → 0.16.3`；
  - asset-manifest 由生成器重算，未手改。
- `CHANGELOG.md` 新增 `## [0.16.4] - 2026-10-15`（Added / Changed / Fixed），注明「本机全局发布（未发布到 npm）」，既有条目未改。

## 五、源码回归证据

- 升版后依次执行，全部通过：
  - `cd cli && npm run lint`：0 error；
  - `npx tsc --noEmit`：通过；
  - `npm test`：**191 个文件、2777 个用例通过、1 个 skipped**；
  - `npm run build`：通过。
- 覆盖范围（验收账本中均为 pass）：
  - 本提案 `core-S42-test-cases.md` 全部用例 UT-S42-01～UT-S42-17、ST-S42-01～ST-S42-04；
  - `core-S41-test-cases.md` 中 UT-S41-12～UT-S41-15、ST-S41-04，`core-S19-test-cases.md` 中 UT-S19-72、UT-S19-73、ST-S19-29；
  - `UT-S19-46` / `UT-S19-49`（版本身份与 manifest 自洽）。

## 六、构建与 Tarball 冻结（唯一候选制品）

- 产物：`cli/miniidealab-openlogos-0.16.4.tgz`，2,723,028 字节，SHA-256 `64b1c26d568a2375f2ac5bf1b4ac4573f695f9628f7f3e9801f72c5eb41760ff`（真实 `npm pack`，863 个文件）。
- 解包核对：
  - `package.json` 与 asset-manifest 版本均为 `0.16.4`；manifest 自洽，payloadHash `e3a870cfd8e2e1f5ff946a83bf1ab1fe9bed49fbb6c68e8f082348fbd58a4d9e`；
  - 包内存在 `dist/commands/deploy.js`、`dist/lib/deploy-runner.js`、`dist/lib/deploy-ci.js`；`dist/index.js` 注册 `deploy` 命令；
  - 包内 `skills/deployment-designer|deployment-executor/SKILL.md` 与仓库源文件、`claude-plugin-template/skills/` 下同名副本与 `plugin/skills/` 逐字节一致；asset-manifest 登记 `skills/deployment-executor/SKILL.md` 与 `claude-plugin-template/skills/deployment-executor/SKILL.md`。
- 之后的隔离验证与全局安装只使用这一个文件。

## 七、隔离 Prefix 行为矩阵（安装态证据）

| 类别 | 结果 |
|---|---|
| candidate identity | 一次性 prefix 安装成功；`--version` 为 `0.16.4`；入口位于该 prefix 的包目录内（真实目录，无 workspace link）；安装后 863 个文件与 tarball 解包内容逐字节一致 |
| script 版本通道与回滚 | runner `scripts/smoke-environment-deploy-0-16-4.js` 自测模式（注入该 prefix 入口）SMOKE-core-255 **pass**：两个 tag 各在请求 commit 的隔离工作树中执行（发布目录记录的 ref / HEAD 等于对应 commit，未包含未提交改动），`channel=version`、`mode=script`；`env show` 的 `current_ref` / `previous_ref` 正确；`--rollback` 重新部署 v1（`rollback=true`、`rollback_from` 为 v2） |
| 提案通道 | SMOKE-core-256 **pass**：无旧部署报告的 ready-to-deploy 提案 `deploy --env staging` 成功、追加部署报告、`[deploy]` 全勾、`DEPLOY_DONE` 与账本同一 `deploy_id`；`smoke --env staging` 门禁 PASS、`verified=true`；版本通道再部署后 smoke 报 `SMOKE_DEPLOY_SUPERSEDED` 且零副作用 |
| dry-run、失败、密钥与并发锁 | SMOKE-core-257 **pass**：缺密钥只列变量名；`--dry-run` 前后项目文件快照一致；失败脚本 `DEPLOY_FAILED`（`exit-code`）、账本 `result=failed`、`current_ref` 不变，日志与 `output_tail` 无密钥值而有 `***`；运行中再次部署报 `DEPLOY_IN_PROGRESS` 且零执行，后台部署照常完成 |
| 版本与制品身份 | SMOKE-core-254 ①～③ 成立（版本 `0.16.4` 与 `local-release-candidate.ts` 候选一致、manifest 自洽、包内三个执行器载体与两个部署 Skill 的登记齐全）；④ 本仓托管 Skill 当时仍是 0.16.3 sync 的版本、与候选不一致，属计划内（本仓 sync 在全局安装后执行），sync 后复核一致，见第八节与第十一节 |
| ci 方式（替身 `gh`） | 同一隔离入口：dispatch 均带 `return_run_details=true`、未调用运行列表；运行回报 `deployed_ref` 等于请求 commit 时 `ref_source=ci-reported`；观察超时报 `DEPLOY_RESULT_UNKNOWN`（`ci-observe-timeout`），再次部署报 `DEPLOY_IN_PROGRESS`（`holder.unresolved=true`、`run_id` 为记录值）；远程完成后 `--reconcile` 为 `reconciled`，`env show` 的 `current_ref` 为 v1、`deploy_in_progress=null`；共 2 次 dispatch |
| 无登记表零回归 | 同一无登记表夹具分别以候选与 0.16.3 回滚制品执行 `deploy-done` / `smoke` / `status --format json`：退出码、`deploy-done` 关键字段（slug / environment=null / 勾选数 / next_step、无 `deployment`）、smoke 门禁与 summary（无 `environment_evidence`）、标记与账本存在性（均不写账本）、`status` 无 `environments` / `environment_ledger`，**两侧完全一致** |
| 全局零触碰 | 矩阵前后 `command -v openlogos` 与 `--version` 均为 `/opt/homebrew/bin/openlogos` / `0.16.3` |
| 回滚演练 | 回滚制品 SHA-256 与冻结记录一致；在隔离 prefix 回装后 `--version` 为 `0.16.3`，`openlogos deploy` 报 `Unknown command: deploy`（对照：差异确由候选引入） |

## 八、本机全局部署与本仓 sync

- 安装：`npm install -g <绝对路径>/cli/miniidealab-openlogos-0.16.4.tgz`（同一候选文件），exit 0。
- 新 shell 复核：
  - `command -v openlogos` = `/opt/homebrew/bin/openlogos`；
  - 入口 realpath = `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js`（真实目录，非链接）；
  - `--version` = `0.16.4`；全局包 `package.json` 与 asset-manifest 版本均为 `0.16.4`，manifest 自洽，payloadHash 与候选一致；
  - 全局包 863 个文件与 tarball 逐字节一致。
- 本仓 sync：在项目根执行 `openlogos sync`（v0.16.4），exit 0。之后逐字节比对：
  - `.claude/openlogos/bin/guard-check`、`.claude/openlogos/bin/guard-post-check.cjs` 与全局包 `claude-plugin-template/bin/` 同名文件**一致**；
  - `logos/skills/deployment-designer/SKILL.md`、`logos/skills/deployment-executor/SKILL.md` 与全局包内同名 Skill **一致**（SHA-256 前缀 `93e55db484d2` / `d74c317ac2ff`）。
- sync 产生的托管文件变化：
  - `logos/spec/cli-json-output.md` 刷新为当前根规范（保留）；
  - `.claude/settings.json` 再次被重复加入一条 SessionStart `openlogos-phase` hook 并去掉末尾换行，与提交 `bf61f6f` 记载的现象相同，按该先例还原为 HEAD 内容。

## 九、回滚入口

- 回滚制品：`cli/rollback/miniidealab-openlogos-0.16.3.tgz`，SHA-256 `ab1abe367bd385c2a94ae9561a9854fa890ebeecf0d415a558a11cf492002ff6`。
- 回滚命令：`npm install -g <绝对路径>/cli/rollback/miniidealab-openlogos-0.16.3.tgz`，新 shell 复核 `--version` 为 `0.16.3`；必须使用绝对路径（相对路径会被 npm 解析为 GitHub 简写）。
- 若已在本仓执行 sync：用回装后的 0.16.3 再执行一次 `openlogos sync`，或以 git 恢复 sync 前的托管文件。
- 无数据迁移。回装 0.16.3 后，账本中 0.16.4 写出的新形态记录会被旧版计为坏行并跳过；运行态目录中的部署日志、锁与未决记录不被旧版读取。

## 十、提示与后续

- 本仓未登记环境（无 `logos/environments.yaml`），本次 `openlogos deploy-done` 不带 `--env`，不写部署账本。
- 下一步按流程运行 `openlogos smoke`（SMOKE-core-254～257 由 `scripts/smoke-environment-deploy-0-16-4.js` 执行；候选 tarball 未经环境变量给出时，runner 按候选版本取本仓 `cli/miniidealab-openlogos-0.16.4.tgz`，并要求本记录已写明其 SHA-256）。

## 十一、全局安装后的补充安装态证据

runner `scripts/smoke-environment-deploy-0-16-4.js` 以正式模式运行：
- 未设置 `OPENLOGOS_ENVDEPLOY_TARBALL` / `OPENLOGOS_TARBALL`，runner 按候选版本回落取本仓 `cli/miniidealab-openlogos-0.16.4.tgz`，并核对本记录已写明候选版本与该 tarball 的 SHA-256；本仓托管 Skill 副本在场。
- 入口为 PATH 中、位于 `npm prefix -g` 包目录内的 `openlogos`。
- 结果写入独立文件，未写正式 smoke 账本，不代替 `openlogos smoke`。

| 用例 | 结果 | environment |
|---|---|---|
| SMOKE-core-254 | **pass**：安装态身份同源（0.16.4），manifest 自洽，包内含部署执行器与两个部署 Skill，本仓托管副本与全局包一致 | `local-global-temp-project` |
| SMOKE-core-255 | **pass**：版本通道在请求 commit 的隔离工作树中执行（不含未提交改动），`env show` 的 current / previous 正确，回滚到 v1 | `local-global-temp-project` |
| SMOKE-core-256 | **pass**：提案通道首次部署写出报告并落标、smoke 已验证；之后版本通道部署使 smoke 报 `SMOKE_DEPLOY_SUPERSEDED` 且零副作用 | `local-global-temp-project` |
| SMOKE-core-257 | **pass**：缺密钥只报变量名；dry-run 零写入；失败记 `exit-code`、`current_ref` 不变且日志遮盖密钥；并发部署被锁拒绝而后台部署完成 | `local-global-temp-project` |

# 部署报告：environment-promotion-approval / OpenLogos 0.16.5 本机全局发布（2026-10-15，**已部署：本机全局**）

## 一、授权与目标

- 依据：
  - 部署方案「OpenLogos 0.16.5 发布方案（环境晋级与审批，本地全局）」；
  - 提案待定决策 C10 的推荐方案（升版 0.16.5，安装到本机全局，并在本仓执行 `openlogos sync`）；
  - 本次 `openlogos next --auto` 的 deliver-entry 门 `gate_auto_passed=true`（`GATE_AUTO_PASSED` 2026-10-15T18:56:29.238Z）。
- 内容：晋级顺序（`promote_from`）、审批门禁（`require_approval` 与 `openlogos approve`）、`--force-promote` 留痕越过、`deploy-done` 对受门环境的拒绝、guard 受限命令与已配置门禁的登记表保护，以及改动后的 deployment-designer / deployment-executor 两个 Skill，装进本机全局安装态。
- 范围：只做本机全局安装与本仓 `openlogos sync`。
  - 未执行 `npm publish`、dist-tag、`git tag`、`gh release`、`git push`。
  - 未改写其他仓库（含 runlogos）；未在本仓配置 `logos/environments.yaml` 或门禁；未修改 `logos/logos.config.json`。

## 二、冻结事实（部署前）

| 项 | 值 |
|---|---|
| `command -v openlogos` | `/opt/homebrew/bin/openlogos` |
| 入口 realpath | `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js` |
| `npm prefix -g` | `/opt/homebrew` |
| 全局 `--version` | `0.16.4` |
| 仓内 `cli/package.json` | `0.16.4`（升版前） |
| registry 版本复核 | `npm view @miniidealab/openlogos@0.16.5 version` 返回 E404；registry 已有版本最高为 `0.16.2`。候选版本 `0.16.5`、回滚版本 `0.16.4`，均与计划值一致 |

## 三、回滚制品（先于升版冻结）

- 来源：在全局安装目录 `/opt/homebrew/lib/node_modules/@miniidealab/openlogos` 执行 `npm pack --ignore-scripts`（`--pack-destination cli/rollback`），未从工作树打包。
- 产物：`cli/rollback/miniidealab-openlogos-0.16.4.tgz`，2,723,028 字节，SHA-256 `64b1c26d568a2375f2ac5bf1b4ac4573f695f9628f7f3e9801f72c5eb41760ff`（与 0.16.4 部署记录中的唯一候选制品字节一致，全局正是由它安装）。
- 内容身份：解包后 863 个文件（其中 `dist/` 下 392 个）与全局安装目录同名文件逐个比对 SHA-256，**0 个不一致、0 个缺失**；包内不含 `dist/commands/approve.js`。
- 旧行为：一次性隔离 prefix 试装后，`--version` 为 `0.16.4`，`approve` 子命令报 `Unknown command: approve`（exit 1）。

## 四、版本与制品身份

- 升版：`node cli/scripts/bump-version.mjs 0.16.5` 一次写全版本载体：
  - `cli/package.json`、lockfile 根包、`cli/asset-manifest.json`、5 份 plugin manifest；
  - `local-release-candidate.ts`：候选 `0.16.4 → 0.16.5`，回滚 `0.16.3 → 0.16.4`；
  - asset-manifest 由生成器重算，未手改。
- `CHANGELOG.md` 新增 `## [0.16.5] - 2026-10-15`（Added / Changed / 升级提示），注明「本机全局发布（未发布到 npm）」，既有条目未改。

## 五、源码回归证据

- 升版后依次执行，全部通过：
  - `cd cli && npm run lint`：0 error；
  - `npx tsc --noEmit`：通过；
  - `npm run build`：通过；
  - `npm test`：**195 个文件、2807 个用例通过、1 个 skipped**。
- 覆盖范围（验收账本中均为 pass）：
  - 本提案 `core-S43-test-cases.md` 全部用例 UT-S43-01～UT-S43-14、ST-S43-01～ST-S43-04；
  - `core-S41-test-cases.md` 中 UT-S41-04、UT-S41-16～UT-S41-19、ST-S41-05；
  - `core-S09-test-cases.md` 中 UT-S09-461～UT-S09-466、ST-S09-205（含 code-r1 F1 的绝对路径命令回归）；
  - `UT-S19-46` / `UT-S19-49`（版本身份与 manifest 自洽）。

## 六、构建与 Tarball 冻结（唯一候选制品）

- 产物：`cli/miniidealab-openlogos-0.16.5.tgz`，2,755,206 字节，SHA-256 `1bab99415bfc993928c4bd42f4ae4662a9696fb3cf7f1140fc8a4e6983026847`（真实 `npm pack`，867 个文件）。
- 解包核对：
  - `package.json` 与 asset-manifest 版本均为 `0.16.5`；manifest 自洽，payloadHash `5d7ec398a2051775bbc525de242e267d8e2a0e78a7f407c389bdcf9231087993`，与仓内 `cli/asset-manifest.json` 逐字节一致；
  - 包内存在 `dist/commands/approve.js`；`dist/index.js` 注册 `approve` 命令并解析 `--force-promote`；
  - 包内 `claude-plugin-template/bin/guard-check` 与仓库 `plugin/bin/guard-check` 逐字节一致，含部署审批类受限命令与已配置门禁的登记表判定；
  - 包内 `skills/deployment-designer|deployment-executor/SKILL.md` 与仓库源文件一致，`claude-plugin-template/skills/` 下同名副本与 `plugin/skills/` 一致。
- 之后的隔离验证与全局安装只使用这一个文件。

## 七、隔离 Prefix 行为矩阵（安装态证据）

隔离矩阵中对 `approve` 子命令的调用全部发生在一次性 prefix 与一次性 git 项目内，由 node 子进程调用 CLI（runner 自测模式与一次性验证脚本，与源码测试相同的调用方式），不触及任何真实项目的审批或账本。本仓托管 guard 在部署过程中按设计拦截了 AI 在 shell 中直接组合调用该子命令的命令（含正文提及该命令的 heredoc 写入，只会多拦）。

| 类别 | 结果 |
|---|---|
| candidate identity | 一次性 prefix 安装成功；`--version` 为 `0.16.5`；入口位于该 prefix 的包目录内（真实目录，无 workspace link）；安装后 867 个文件与 tarball 解包内容逐字节一致 |
| 登记表校验 | prod 配置 `promote_from: staging`、`require_approval: true` 时 `env check` exit 0、无 error；指向未登记环境、指向自身、以 YAML 转义键书写时 `ENV_FIELD_INVALID`（`prod.promote_from` / `prod.require_approval`）；staging ↔ prod 成环时两个环境各报一条 |
| 晋级拦截与留痕越过 | runner `scripts/smoke-environment-promotion-approval-0-16-5.js` 自测模式（注入该 prefix 入口）SMOKE-core-259 **pass**：上游未验证时 `DEPLOY_PROMOTION_UNVERIFIED` 零执行；staging smoke `verified=true` 后晋级成功、记录 `promoted_from=staging` 与 ① 的 `approval_id`；`--force-promote "smoke 越过"` 记录 `promotion_override_reason`、`promoted_from=null` |
| 审批拦截、写入与使用 | SMOKE-core-260 **pass**：未审批 `DEPLOY_APPROVAL_REQUIRED`、`details.approve_command` 为命令原文、零执行；两次审批同一 `approval_id`、第二次 `created=false`、账本只多一条；部署成功并使用；再次部署重新要求审批。另行验证部署失败（脚本 exit 3）报 `DEPLOY_FAILED` 后审批仍在 `open_approvals`，再次部署成功才使用 |
| dry-run、回滚与受门 `deploy-done` | SMOKE-core-261 **pass**：dry-run 给出将用的审批、项目文件快照前后一致、审批未被使用；`--rollback` 仍要求审批；`deploy-done --env prod` 报 `DEPLOY_DONE_GATED_ENV`，tasks.md、`DEPLOY_DONE` 与账本字节不变 |
| 未配置门禁零回归 | SMOKE-core-262 **pass**（记录与视图不含新字段）；另以 ST-S41-05 / UT-S43-14 的同一夹具定义（无登记表、有登记表但无门、已启用部署执行但无门，执行 `deploy` / `deploy-done` / `smoke` / `status` / `env list` / `env show`）分别在候选与 0.16.4 回滚制品的隔离入口上运行，规范化后输出、退出码与账本字节 **6 组全部逐字一致** |
| 版本与制品身份 | SMOKE-core-258 ①～③ 成立（版本 `0.16.5` 与 `local-release-candidate.ts` 候选一致、manifest 自洽、包内 approve 命令与 guard-check 新规则齐全）；④ 本仓托管 guard-check 已一致，两份托管 Skill 当时仍是上次 sync 的版本、与候选不一致，属计划内（本仓 sync 在全局安装后执行），sync 后复核一致，见第八节与第十一节 |
| 全局零触碰 | 矩阵前后 `command -v openlogos` 与 `--version` 均为 `/opt/homebrew/bin/openlogos` / `0.16.4` |
| 回滚演练 | 回滚制品 SHA-256 与冻结记录一致；在隔离 prefix 回装后 `--version` 为 `0.16.4`，`approve` 子命令报 `Unknown command: approve`（对照：候选入口识别该命令） |

## 八、本机全局部署与本仓 sync

- 安装：`npm install -g <绝对路径>/cli/miniidealab-openlogos-0.16.5.tgz`（同一候选文件），exit 0。
- 新 shell 复核：
  - `command -v openlogos` = `/opt/homebrew/bin/openlogos`；
  - 入口 realpath = `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js`（真实目录，非链接）；
  - `--version` = `0.16.5`；全局包 `package.json` 与 asset-manifest 版本均为 `0.16.5`，manifest 自洽，payloadHash 与候选一致；
  - 全局包 867 个文件与 tarball 逐字节一致。
- 本仓 sync：在项目根执行 `openlogos sync`（v0.16.5），exit 0。之后逐字节比对：
  - `.claude/openlogos/bin/guard-check`、`.claude/openlogos/bin/guard-post-check.cjs` 与全局包 `claude-plugin-template/bin/` 同名文件**一致**（guard-check SHA-256 前缀 `1861d44c158e`）；
  - `logos/skills/deployment-designer/SKILL.md`、`logos/skills/deployment-executor/SKILL.md` 与全局包内同名 Skill **一致**（SHA-256 前缀 `cd6fd7b981c8` / `adb96c7b89fe`）；
  - 生成的 `CLAUDE.md` / `AGENTS.md` 含新增硬红线条目（审批与晋级）。
- sync 产生的托管文件变化：
  - `CLAUDE.md`、`AGENTS.md` 新增硬红线条目；`logos/spec/cli-json-output.md` 刷新为当前根规范（保留）；
  - `.claude/settings.json` 再次被重复加入一条 SessionStart `openlogos-phase` hook 并去掉末尾换行，与提交 `bf61f6f` 记载的现象相同，按该先例还原为 HEAD 内容。

## 九、回滚入口

- 回滚制品：`cli/rollback/miniidealab-openlogos-0.16.4.tgz`，SHA-256 `64b1c26d568a2375f2ac5bf1b4ac4573f695f9628f7f3e9801f72c5eb41760ff`。
- 回滚命令：`npm install -g <绝对路径>/cli/rollback/miniidealab-openlogos-0.16.4.tgz`，新 shell 复核 `--version` 为 `0.16.4`；必须使用绝对路径（相对路径会被 npm 解析为 GitHub 简写）。
- 若已在本仓执行 sync：用回装后的 0.16.4 再执行一次 `openlogos sync`，或以 git 恢复 sync 前的托管文件。
- 无数据迁移。回装 0.16.4 后，账本中的 `approval` 记录会被旧版计为坏行并跳过，deploy 记录的三个新字段被忽略；登记表中的两个门禁字段恢复为 `ENV_UNKNOWN_FIELD` 警告，门禁不再生效。

## 十、提示与后续

- 本仓未登记环境（无 `logos/environments.yaml`），本次 `openlogos deploy-done` 不带 `--env`，不写部署账本。
- 下一步按流程运行 `openlogos smoke`（SMOKE-core-258～262 由 `scripts/smoke-environment-promotion-approval-0-16-5.js` 执行；候选 tarball 未经环境变量给出时，runner 按候选版本取本仓 `cli/miniidealab-openlogos-0.16.5.tgz`，并要求本记录已写明其 SHA-256）。

## 十一、全局安装后的补充安装态证据

runner `scripts/smoke-environment-promotion-approval-0-16-5.js` 以正式模式运行：
- 未设置 `OPENLOGOS_PROMOTION_TARBALL` / `OPENLOGOS_TARBALL`，runner 按候选版本回落取本仓 `cli/miniidealab-openlogos-0.16.5.tgz`，并核对本记录已写明候选版本与该 tarball 的 SHA-256；本仓托管副本（guard-check 与两个部署 Skill）在场。
- 入口为 PATH 中、位于 `npm prefix -g` 包目录内的 `openlogos`。
- 结果写入独立文件，未写正式 smoke 账本，不代替 `openlogos smoke`。

| 用例 | 结果 | environment |
|---|---|---|
| SMOKE-core-258 | **pass**：安装态身份同源（0.16.5），manifest 自洽，包内含审批命令与 guard-check 新规则，本仓托管副本与全局包一致 | `local-global-temp-project` |
| SMOKE-core-259 | **pass**：上游未验证时晋级零执行；staging smoke 验证后晋级成功并使用审批；`--force-promote` 留痕越过 | `local-global-temp-project` |
| SMOKE-core-260 | **pass**：未审批零执行并给出审批命令；审批幂等；审批后部署成功并使用，再次部署重新要求审批 | `local-global-temp-project` |
| SMOKE-core-261 | **pass**：dry-run 给出将用的审批且零写入、不使用审批；回滚仍要求审批；`deploy-done` 对受门环境零写入拒绝 | `local-global-temp-project` |
| SMOKE-core-262 | **pass**：未配置门禁的环境部署记录与视图不含晋级与审批字段 | `local-global-temp-project` |

# 部署报告：proposal-default-environment / OpenLogos 0.16.6 本机全局发布（2026-10-16，**已部署：本机全局**）

## 一、授权与目标

- 依据：
  - 部署方案「OpenLogos 0.16.6 发布方案（提案默认部署环境，本地全局）」；
  - 提案决策 C04（`category: deployment`, `source: user`）：用户 2026-10-15 原话「要，按推荐方案发布 0.16.6 到本机全局」；
  - 本次 `openlogos next --auto` 的 deliver-entry 门 `gate_auto_passed=true`（`GATE_AUTO_PASSED` 2026-10-16T03:12:06.467Z）。
- 内容：登记表顶层 `proposal_default_env` 的校验、`env list` 输出与文本标注、`env show` 输出 `environment.deploy`，以及改动后的 change-writer / deployment-designer 两个 Skill，装进本机全局安装态。
- 范围：只做本机全局安装与本仓 `openlogos sync`。
  - 未执行 `npm publish`、dist-tag、`git tag`、`gh release`、`git push`。
  - 未改写其他仓库（含 runlogos）；未在本仓配置 `logos/environments.yaml` 或 `proposal_default_env`；未修改 `logos/logos.config.json`。

## 二、冻结事实（部署前）

| 项 | 值 |
|---|---|
| `command -v openlogos` | `/opt/homebrew/bin/openlogos` |
| 入口 realpath | `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js` |
| `npm prefix -g` | `/opt/homebrew` |
| 全局 `--version` | `0.16.5` |
| 仓内 `cli/package.json` | `0.16.5`（升版前） |
| registry 版本复核 | `npm view @miniidealab/openlogos@0.16.6 version` 返回 E404；registry 已有版本最高为 `0.16.2`。候选版本 `0.16.6`、回滚版本 `0.16.5`，均与计划值一致 |

## 三、回滚制品（先于升版冻结）

- 来源：在全局安装目录 `/opt/homebrew/lib/node_modules/@miniidealab/openlogos` 执行 `npm pack --ignore-scripts`（`--pack-destination cli/rollback`），未从工作树打包。
- 产物：`cli/rollback/miniidealab-openlogos-0.16.5.tgz`，2,755,206 字节，SHA-256 `1bab99415bfc993928c4bd42f4ae4662a9696fb3cf7f1140fc8a4e6983026847`（与 0.16.5 部署记录中的唯一候选制品字节一致，全局正是由它安装）。
- 内容身份：解包后 867 个文件（其中 `dist/` 下 396 个）与全局安装目录同名文件逐个比对 SHA-256，**0 个不一致、0 个缺失**；包内 `skills/change-writer/SKILL.md` 不含 `proposal_default_env`。
- 旧行为：一次性隔离 prefix 试装后，`--version` 为 `0.16.5`；对写有 `proposal_default_env: test` 的登记表执行 `env check --format json`，`ok=true`，`warnings` 为一条 `ENV_UNKNOWN_FIELD`（`field=proposal_default_env`）。

## 四、版本与制品身份

- 升版：`node cli/scripts/bump-version.mjs 0.16.6` 一次写全版本载体：
  - `cli/package.json`、lockfile 根包、`cli/asset-manifest.json`、5 份 plugin manifest；
  - `local-release-candidate.ts`：候选 `0.16.5 → 0.16.6`，回滚 `0.16.4 → 0.16.5`；
  - asset-manifest 由生成器重算，未手改。
- `CHANGELOG.md` 新增 `## [0.16.6] - 2026-10-16`（Added / Changed / 升级提示），注明「本机全局发布（未发布到 npm）」，既有条目未改。

## 五、源码回归证据

- 升版后依次执行，全部通过：
  - `cd cli && npm run lint`：0 error；
  - `npx tsc --noEmit`：通过；
  - `npm run build`：通过；
  - `npm test`：**197 个文件、2815 个用例通过、1 个 skipped**。
- 覆盖范围（验收账本中均为 pass）：
  - 本提案 `core-S41-test-cases.md` 中 UT-S41-20～UT-S41-23、ST-S41-06；
  - 受本提案影响而适配的零回归用例 ST-S41-05、UT-S43-14（`env show` 对配置了 `deploy` 的环境新增 `environment.deploy`，断言其正确后剥离，其余逐字比对基线）；
  - `UT-S19-46` / `UT-S19-49`（版本身份与 manifest 自洽）；
  - smoke 基线离线组装的隔离断言（`cli/test/smoke-offline-baseline.test.ts`，code-r1 F1）。
- 来源说明：候选制品构建自当前工作区。本提案的规格合并与代码改动在部署时尚未提交，制品内容即该工作区状态，以第六节的 SHA-256 为准。

## 六、构建与 Tarball 冻结（唯一候选制品）

- 产物：`cli/miniidealab-openlogos-0.16.6.tgz`，2,771,166 字节，SHA-256 `eca16ea223ff0843b0b5e5757cfbbccc4c2e4b46d74d81a8f9a528085f6652a0`（真实 `npm pack`，867 个文件）。
- 解包核对：
  - `package.json` 与 asset-manifest 版本均为 `0.16.6`；manifest 自洽，payloadHash `5f4bd8c395f2cef3c6474afe8b04844e167f63dccbfdcde7a5f7045adfd8d01e`，与仓内 `cli/asset-manifest.json` 一致；
  - 包内 `skills/change-writer/SKILL.md`、`skills/deployment-designer/SKILL.md` 与仓库源文件逐字节一致，change-writer 含「部署决定与提案默认部署环境」章节；
  - 包内 `claude-plugin-template/skills/deployment-designer/SKILL.md` 与 `plugin/skills/deployment-designer/SKILL.md` 一致；
  - `dist/lib/environments.js` 含 `proposal_default_env` 校验，`dist/i18n.js` 含「提案默认」标注文案。
- 之后的隔离验证与全局安装只使用这一个文件。

## 七、隔离 Prefix 行为矩阵（安装态证据）

| 类别 | 结果 |
|---|---|
| candidate identity | 一次性 prefix 安装成功；`--version` 为 `0.16.6`；包目录为真实目录（无 workspace link）；安装后 867 个文件与 tarball 解包内容逐字节一致 |
| 默认环境校验 | runner `scripts/smoke-proposal-default-environment-0-16-6.js` 自测模式（注入该 prefix 入口）SMOKE-core-264、SMOKE-core-266 **pass**：合法值与指向配置了 `promote_from` / `require_approval` 的环境均通过；另在该入口上手工核对 `Test`（大小写不一致）、`3`（非字符串）均报 `ENV_FIELD_INVALID`（`field=proposal_default_env`）、exit 1，`test` 通过 |
| 非法默认环境 fail-closed | SMOKE-core-265 **pass**：`stage`（未登记）与 `测试`（alias）使 `env check` 报 `ENV_FIELD_INVALID`；`deploy-done` 与 `smoke` 以 `ENV_REGISTRY_INVALID` 拒绝，项目文件快照前后一致，未运行 `smoke.command`，未写账本 |
| `env list` / `env show` 输出 | SMOKE-core-264 / 266 **pass**：`env list` 输出 `proposal_default_env` 与「（提案默认）」标注；`env show` 对配置了 `deploy` 的环境输出 `environment.deploy`（`script=deploy/run.sh`）；`env show` / `status` 不含 `proposal_default_env` |
| 受门环境仍受门 | SMOKE-core-266 **pass**：默认环境 prod 上游未验证时 `deploy` 报 `DEPLOY_PROMOTION_UNVERIFIED`，发布目录无痕迹、账本无 deploy 记录 |
| 未配置零回归 | SMOKE-core-267 **pass**：无登记表、有登记表但未写该字段两种夹具，`env list` / `env check` / `status` 与 0.16.5 回滚制品的隔离安装逐项一致 |
| 版本与制品身份 | SMOKE-core-263 ①～③ **pass**；④（本仓托管副本同源）在全局安装与 sync 后复核，见第八节、第十一节 |
| 全局零触碰 | 矩阵前后 `command -v openlogos` 与 `--version` 均为 `/opt/homebrew/bin/openlogos` / `0.16.5` |
| 回滚演练 | 回滚制品 SHA-256 与冻结记录一致；隔离 prefix 回装后 `--version` 为 `0.16.5`，含该字段的登记表回到 `ENV_UNKNOWN_FIELD` 警告 |

## 八、本机全局部署与本仓 sync

- 安装：`npm install -g <绝对路径>/cli/miniidealab-openlogos-0.16.6.tgz`（同一候选文件），exit 0。
- 新 shell 复核：
  - `command -v openlogos` = `/opt/homebrew/bin/openlogos`；
  - 入口 realpath = `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js`（真实目录，非链接）；
  - `--version` = `0.16.6`；全局包 `package.json` 与 asset-manifest 版本均为 `0.16.6`，manifest 自洽，payloadHash 与候选一致；
  - 全局包 867 个文件与 tarball 逐字节一致。
- 本仓 sync：在项目根执行 `openlogos sync`（v0.16.6），exit 0。之后逐字节比对：
  - `logos/skills/change-writer/SKILL.md`、`logos/skills/deployment-designer/SKILL.md` 与全局包内同名 Skill **一致**（SHA-256 前缀 `6041eae6dfd8` / `111156d4728c`）；
  - `logos/spec/cli-json-output.md`、`logos/spec/environments.md` 与根规范一致；`CLAUDE.md` / `AGENTS.md` 本次无变化。
- sync 产生的托管文件变化：`.claude/settings.json` 再次被重复加入一条 SessionStart `openlogos-phase` hook 并去掉末尾换行，与提交 `bf61f6f` 记载的现象相同，按该先例还原为 HEAD 内容。

## 九、回滚入口

- 回滚制品：`cli/rollback/miniidealab-openlogos-0.16.5.tgz`，SHA-256 `1bab99415bfc993928c4bd42f4ae4662a9696fb3cf7f1140fc8a4e6983026847`。
- 回滚命令：`npm install -g <绝对路径>/cli/rollback/miniidealab-openlogos-0.16.5.tgz`，新 shell 复核 `--version` 为 `0.16.5`；必须使用绝对路径（相对路径会被 npm 解析为 GitHub 简写）。
- 若已在本仓执行 sync：用回装后的 0.16.5 再执行一次 `openlogos sync`，或以 git 恢复 sync 前的托管文件。
- 无数据迁移，账本格式不变。回装 0.16.5 后，登记表中的 `proposal_default_env` 恢复为 `ENV_UNKNOWN_FIELD` 警告，change-writer 回到每案询问目标环境。

## 十、提示与后续

- 本仓未登记环境（无 `logos/environments.yaml`），本次 `openlogos deploy-done` 不带 `--env`，不写部署账本。
- 下一步按流程运行 `openlogos smoke`（SMOKE-core-263～267 由 `scripts/smoke-proposal-default-environment-0-16-6.js` 执行；候选 tarball 未经环境变量给出时，runner 按候选版本取本仓 `cli/miniidealab-openlogos-0.16.6.tgz`，并要求本记录已写明其 SHA-256）。
- 已知约束：SMOKE-core-267 的回滚基线以离线方式组装（不调用 npm），依赖从候选安装包目录内的 `node_modules` 复制。全局安装（`npm install -g`）的包目录带嵌套 `node_modules`，满足该前提（已以本机全局安装与回滚制品实测组装成功，基线 `--version` 为 `0.16.5`，子进程只有 `tar`）；runner 正式模式只接受全局安装入口，非全局的扁平安装布局不在适用范围内。

## 十一、全局安装后的补充安装态证据

runner `scripts/smoke-proposal-default-environment-0-16-6.js` 以正式模式运行：
- 未设置 `OPENLOGOS_DEFAULT_ENV_TARBALL` / `OPENLOGOS_TARBALL`，runner 按候选版本回落取本仓 `cli/miniidealab-openlogos-0.16.6.tgz`，并核对本记录已写明候选版本与该 tarball 的 SHA-256；回滚制品 `cli/rollback/miniidealab-openlogos-0.16.5.tgz` 与本仓托管副本（两个 Skill）在场。
- 入口为 PATH 中、位于 `npm prefix -g` 包目录内的 `openlogos`。
- 结果写入独立文件，未写正式 smoke 账本，不代替 `openlogos smoke`。

| 用例 | 结果 | environment |
|---|---|---|
| SMOKE-core-263 | **pass**：安装态身份同源（0.16.6），manifest 自洽，包内 Skill 含默认环境规则与四种必须提问的负例，本仓托管副本与全局包一致 | `local-global-temp-project` |
| SMOKE-core-264 | **pass**：合法默认环境通过校验；`env list` 输出并标注「（提案默认）」；`env show` / `status` 不输出该字段 | `local-global-temp-project` |
| SMOKE-core-265 | **pass**：未登记与 alias 两种非法值使登记表判为非法，`deploy-done` 与 `smoke` 零副作用拒绝 | `local-global-temp-project` |
| SMOKE-core-266 | **pass**：默认环境指向受门环境合法，部署仍被晋级检查拦截；`env show` 输出 `environment.deploy` | `local-global-temp-project` |
| SMOKE-core-267 | **pass**：未配置该字段的项目与 0.16.5 回滚基线一致；基线离线组装（`baseline_mode=offline-assembled`、`npm_invocations=0`） | `local-global-temp-project` |

## 部署记录 2026-10-16T14:30:37.505Z → test

- 目标环境: test
- 通道 / 执行方式: proposal / script
- deploy_id: 7652a96b-b340-4e6e-9f08-b5a7dec65d73
- ref_requested: 02355709cf742bfe095124ca2e285437f6153694（HEAD）
- ref: 02355709cf742bfe095124ca2e285437f6153694
- 执行脚本: scripts/deploy-local.mjs（workdir: worktree）
- 耗时: 39007 ms
- 结果: done
- log_path: logos/.openlogos-runtime/deploy-logs/7652a96b-b340-4e6e-9f08-b5a7dec65d73.log
- previous_ref: 无

# 部署报告：release-0-16-7 / OpenLogos 0.16.7 公开发布（2026-10-18 UTC，**已发布**；首次门② 未通过、按决策 C11 本提案内修复后重走四道门；原 publish run 官网校验因 registry 处理延迟失败，按档 C 受控补做）

public_release_version: 0.16.7
public_release_commit: 3d851a71a17c86d081ce9d69adf2ea88331a94fe

按部署方案「OpenLogos 0.16.7 公开发布方案（npm / GitHub Release / 官网，含官网文档补齐）」执行。第一次尝试（候选 `4ff1099`）停在推 tag 前的门 ② 阶段一，按档 A 停止，公网无变化（第一～五节）。用户决定在本提案内修复（决策 C11，第六节）后，第二次尝试（候选 `3d851a7`）四道门全过，推送 `v0.16.7`，npm、GitHub Release、官网三处已同源发布（第七～九节）。

## 一、冻结事实（2026-10-18T02:24:24Z）

- npm：`dist-tags` = `{"old":"0.9.8","latest":"0.16.2"}`；`@0.16.3`～`@0.16.7` 均返回 E404。
- git：待发布提交 `4ff109919e67699117b170a16db9d9c5aab289f4`（`95942c2` 规格合并、`fa43d77` 代码、`4ff1099` 验收报告）；`origin/master` = `d3858955`，本地超前 13 个提交；远端 `v0.16.*` tag 只有 `v0.16.0`、`v0.16.2`。
- 本机全局：`/opt/homebrew/bin/openlogos` → `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js`，`npm prefix -g` = `/opt/homebrew`，`--version` = 0.16.6（本地构建，未切换）。
- 回滚制品：`cli/rollback/miniidealab-openlogos-0.16.2.tgz`，2,574,234 字节，SHA-256 `ceb8c0403cbdfbbe4764ad79f405a1d7bb884a930665478957ec1ef77008f3b5`，与冻结值一致。
- 环境：`proposal_default_env` = test；`test.current_ref` = `02355709cf742bfe095124ca2e285437f6153694`，`prod.current_ref` = null。
- `git log v0.16.0..HEAD -- .github/workflows/publish.yml` 为空，档 C 演练不需重做。

## 二、门 ①（通过）

本地 macOS、Node v23.10.0，提交 `4ff1099`：`npm run lint` 0、`tsc --noEmit` 0、`npm test` 2828 passed / 1 skipped、`npm run build` 0；官网 `npm ci` 0、`npm run build` 0（字体工具取自独立 venv：Python 3.14.7、fonttools 4.67.0 + brotli），构建产物含中英文 `cli/env`、`cli/deploy`、`cli/approve`、`specs/environments`，构建后工作区无变化。

## 三、门 ② 阶段一（未通过）

- 环境：本地预演镜像 `openlogos-gate2:node20-sqlite3`（`sha256:4ef106618500c5819bee0a49eea485ee5caaf482e4dec7689d09efac31b770e0`，0.16.2 发布时基于 `node:20` 加装 sqlite3 构建），用户 `node`（uid 1000）、Node v20.20.2、sqlite3 3.40.1、cc（Debian 12.2.0）；容器内 `git clone` 后检出 `4ff1099`。
- 结果：`npm ci` 0；**`npm test` 1**（4 failed / 2806 passed / 19 skipped）；`npm run build` 0；版本一致性 0（package / plugin 均 0.16.7，Release 正文 5442 字节，不含「未发布到 npm」）；lint 0；tsc 0。
- 环境能力用例：core-S41 / S42 / S43 共 80 个 UT / ST ID 中，4 个为 `fail`，其余均 `pass`，无 `skip`。全量 `skip` 仍为既有的 10 个能力探测用例（ST-S13-14、UT-S13-47～50、UT-S13-52～54、UT-S19-08、UT-S19-09）。
- 失败用例：ST-S41-05、ST-S41-06、UT-S42-16、UT-S43-14。
- 打包核对未得出结论：预演脚本取 tarball 时误选了仓库中已跟踪的旧包 `cli/miniidealab-openlogos-0.10.10.tgz`。这是预演脚本自身的缺陷，与发布物无关，重走门 ② 时改为 `--pack-destination` 指定输出目录后再核对。
- 阶段二（官网 `node:22.12.0`）、门 ③、门 ④ 均未执行。

## 四、根因

四个失败用例都是「未配置时零回归」类测试，用法相同：在一次性夹具项目里运行当前 CLI，再与落盘基线 `cli/test/golden/s42-zero-regression-baseline.json` 逐字比较。基线是在 macOS 上生成的，记录的 smoke / verify JSON 中 `sandbox.root` 为 `"/private/tmp"`，也就是 macOS 上 `os.tmpdir()` 的 realpath。Linux 上同一字段为 `"/tmp"`。夹具归一化函数（`cli/test/golden/s42-zero-regression-fixture.mjs` 的 `normalizer`）只替换了夹具项目根路径、时间、UUID、哈希与耗时，没有替换系统临时目录，因此基线把宿主环境事实固化进了期望值，违反部署方案「发布前检查通则：环境事实不入 verify 期断言」。差异只在这一字段，CLI 行为本身在 Linux 上与基线一致。

这些用例来自 0.16.4～0.16.6 的三个本机发布提案，此前只在 macOS 上运行过；相关提交从未推送，GitHub CI 的 ubuntu runner 也从未执行过它们。门 ③ 在 CI 上同样会失败。

## 五、处置与修复建议

- 处置：按档 A，不推送、不打 tag；本提案停在部署前。
- 修复方向（只改测试代码，不改 CLI 运行时）：在 `s42-zero-regression-fixture.mjs` 的 `normalizer` 中把 `realpathSync(tmpdir())` 与 `tmpdir()` 统一替换为占位符（如 `<TMPDIR>`），并按 `cli/test/golden/README.md` 的生成方式重新生成基线；用 docker `node:20` 非 root 与 macOS 各跑一遍 ST-S41-05、ST-S41-06、UT-S42-16、UT-S43-14 确认通过。
- 修复后须重新 verify，并从门 ① 起重走四道门。按部署方案档 A，「需要改 CLI 代码的修复另立提案」。这次改的是测试代码，是在本提案内修复（与 0.16.2 决策 C08 同口径），还是另立提案，由用户决定。

## 六、本提案内修复（决策 C11）

- 用户 2026-10-17：「在本提案内修复，然后继续发布」。
- 三份零回归夹具（`s42-zero-regression`、`s41-gate-zero-regression`、`s43-gate-zero-regression`）的规范化函数，把 JSON 中属于平台默认沙箱根的 `"root"` 值（`/private/tmp`、`os.tmpdir()` 及其 realpath）替换为 `<SANDBOX_ROOT>`。三份基线中录得的 `"root": "/private/tmp"` 按同一规则补做替换（分别为 4、6、6 处，不以新版 CLI 重录），`cli/test/golden/README.md` 补记。修复后四个用例在 macOS 与 docker `node:20` 非 root 下均通过。
- 修复后第一次重新验收 FAIL：UT-S42-11 超过 10 秒默认超时，UT-S42-05 开头那次本应成功的部署被登记表 `timeout_sec: 2` 耗尽。这次 verify 在沙箱内的 `npm test` 用了 289 秒，平时约 150 秒，两者都是负载误报。处置：UT-S42-11 所在文件的用例超时设为 60 秒（与 `s42-script-deploy.test.ts` 同口径）；UT-S42-05 的 `timeout_sec` 改为 8 秒（sleep 夹具休眠 60 秒，超时分支仍必然触发）。断言均未改。
- 第二次重新验收 PASS：executed 2393 / failed 0 / uncovered 0 / skipped 25。修复提交 `3d851a7`。

## 七、第二次尝试（候选 `3d851a7`）：四道门

- **门 ①**：本地 `npm run lint` 0、`tsc --noEmit` 0、`npm test` 2828 passed / 1 skipped、`npm run build` 0；官网 `npm ci` 0、`npm run build` 0（venv：fonttools 4.67.0 + brotli），构建后工作区无变化。
- **门 ② 阶段一**（`openlogos-gate2:node20-sqlite3`，`sha256:4ef106618500c5819bee0a49eea485ee5caaf482e4dec7689d09efac31b770e0`）：uid 1000、Node v20.20.2、sqlite3 3.40.1、cc 12.2.0；容器内 `git clone` 并检出 `3d851a7`。
  - `npm ci` 0；`npm test` 0（2810 passed / 19 skipped）；build 0；版本一致性 0（Release 正文 5442 字节，不含「未发布到 npm」）。
  - `npm pack` 867 个文件，SHA-256 `d8cb1ddb1b9ee90ce00e481ae821319cbfbd03af57a3aac3ec2637b31f2b9997`；无孤儿 dist 产物，manifest 自洽，含 env / deploy / approve / deploy-done 命令与部署账本实现。
  - lint 0；tsc 0。
  - core-S41 / S42 / S43 的 80 个 UT / ST ID 在 reporter 账本中全部为 `pass`。全量 `skip` 仍为既有的 10 个能力探测用例（ST-S13-14、UT-S13-47～50、UT-S13-52～54、UT-S19-08、UT-S19-09）。
  - 预演脚本的打包核对已改为 `--pack-destination` 指定输出目录。
- **门 ② 阶段二**（`openlogos-gate2:node22-fonts`，`sha256:0afa15c7a62eb5f219f8814407e85a76fff65f978c107974fc0a354df961212e`）：uid 1000、Node v22.12.0、fonttools 4.38.0；检出 `3d851a7` 后官网 `npm ci` 0、`npm run build` 0，产物含中英文四个新页。
- **门 ③**：以 `miniidealab` 推送 `d385895..3d851a7`；CI run 39092414450 的 `Lint & Test` 与 `Windows regression` 均 success。
- **门 ④**：`NPM_TOKEN`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 均已配置（只查存在性）；0.16.0 之后 publish.yml 无改动，档 C 演练不重做。

## 八、tag 驱动发布与档 C 受控补做

- 在 `3d851a7` 上创建 annotated tag `v0.16.7` 并推送。publish run 39093177249 依次完成 checkout → `npm ci` → 测试 → build → 版本校验 → Release 正文 → pack，**Publish success**：`+ @miniidealab/openlogos@0.16.7`，provenance 写入 sigstore 透明日志 logIndex 3305483762，npm 提示「Your package is being processed」。**Create GitHub Release success**。官网 `generate:releases --strict` 与 build 均 success，但「Verify website latest version matches tag」失败（registry 处理延迟，生成时 latest 仍为 0.16.2），Cloudflare 部署被跳过。原 run 不是全绿，以下为档 C 受控补做，未重跑原 run 或其 job。
- 档 C 第 1 步（registry 身份）：registry 于 03:30:31Z 可见，`dist-tags` = `{"old":"0.9.8","latest":"0.16.7"}`，`version=0.16.7`，`dist.integrity=sha512-fOf2h1yaFDM/e5JZysxlvk7k0VIsgrwmnGfBfiaQ+PNjYQKFn9bVqTWcznoQOeN8AwS92JkXqKzXhXvKdVkHPg==`；无 `gitHead`（tarball 发布）。SLSA provenance 的 `resolvedDependencies[0]` 指向 `refs/tags/v0.16.7`，`gitCommit` 等于 tag 提交（`provenanceSourceProblems` 无问题项）。`npm pack @miniidealab/openlogos@0.16.7` 的 SHA-256 为 `d8cb1ddb1b9ee90ce00e481ae821319cbfbd03af57a3aac3ec2637b31f2b9997`，**与门 ② Linux 干净克隆打出的包逐字节相同**。
- 档 C 第 2 步（Release）：`gh release view v0.16.7` 已存在，非 draft / prerelease，`releases/latest` 为 `v0.16.7`，正文与 `v0.16.7:CHANGELOG.md` 的 `## [0.16.7]` 一致，唯一附件 `miniidealab-openlogos-0.16.7.tgz` 的 SHA-256 与 registry tarball 相同。因此跳过 create，未 upload。
- 档 C 第 3 步（官网）：在 `v0.16.7` 的干净检出中执行 `npm ci` → `generate:releases -- --strict`（latestVersion=0.16.7，共 86 个版本）→ `npm run build` → 以 publish.yml 同一脚本校验 latest（「Website latest version matches tag: 0.16.7」）→ 本机 wrangler（OAuth 登录）执行 `wrangler pages deploy dist --project-name openlogos --branch master`，部署 `71d38164`（https://71d38164.openlogos.pages.dev）。回滚目标为部署前的 Production `1bfaa52e`（源 `236f5a2`，0.16.2）。部署后 `https://openlogos.ai/releases` 与 `/zh/releases` 的 latest 均为 v0.16.7；`/cli/env/`、`/zh/cli/deploy/`、`/specs/environments/`、`/zh/cli/approve/` 均为 200。

## 九、发布后同步与本机切换

- 本地 `cd website && npm run generate:releases -- --strict` 更新 `website/src/data/releases.json`（latestVersion=0.16.7，共 86 个版本），作为「同步官网发布资源」提交入库。
- 本机全局：`npm install -g @miniidealab/openlogos@0.16.7`（从 registry 安装）。新 shell 复核：`/opt/homebrew/bin/openlogos` → `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js`，包目录不是链接；`--version` 为 0.16.7；包内 asset-manifest 版本 0.16.7，`validateAssetManifest` 通过；全局包与 registry tarball 解包结果逐文件一致（`diff -rq` 无差异）。
- 随包 guard 模板与本仓托管副本 `.claude/openlogos/bin/guard-check` 的 SHA-256 一致（`1861d44c…`），不在本仓执行 `openlogos sync`。
- `test` 环境账本未追加记录（决策 C08）：本次切换装的是 registry 包，没有经过 `openlogos deploy --env test`（`scripts/deploy-local.mjs` 从提交构建本地 tarball，与 registry 字节不同源），所以 `test.current_ref` 仍为 `02355709cf742bfe095124ca2e285437f6153694`。下一次执行 `openlogos deploy --env test` 时，会以本地构建覆盖这次的 registry 安装。
- 回滚制品仍为 `cli/rollback/miniidealab-openlogos-0.16.2.tgz`（SHA-256 `ceb8c0403cbdfbbe4764ad79f405a1d7bb884a930665478957ec1ef77008f3b5`）。
- runlogos 需要用户授权后自行升级全局 CLI，才会获得环境能力的公网版本。
- 之后以 `openlogos deploy-done --env prod --ref v0.16.7` 受控落标，再进入 smoke。
