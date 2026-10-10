# 部署报告：release-0-16-0 / OpenLogos 0.16.0 公开发布（2026-10-10，**部署失败：推 tag 前门 ② 未通过**）

## 一、结论

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
