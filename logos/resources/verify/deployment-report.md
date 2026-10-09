# 部署报告：verify-smoke-guard-fixes-0-15-20 / OpenLogos 0.15.20（2026-10-09，本机全局部署）

## 一、部署结论

- **模块 / 提案**：core / `verify-smoke-guard-fixes-0-15-20`。本次发布五项 CLI 行为：
  1. verify 预跑失败进入门禁（`pre_run_failed`），JSON 带有界输出尾部，输出全文不落盘（§2.7、§2.75.1）。
  2. smoke 门的平台不可执行例外（`reason_code:"platform-unavailable"`，§2.48.5）。
  3. guard 非 git 回落按段判定复合命令（根规范 `spec/pretooluse-guard.md`）。
  4. merge 增量修正失败的三档文案（§2.84.3）。
  5. merge 增量修正与 status `spec_amend` 投影（来源提案 `merge-amend-merged-change`，已归档；§2.69.4）。
- **部署方案依据**：`core-01-deployment-plan.md`「OpenLogos 0.15.20 发布方案（verify / smoke / guard 修复与 merge 增量修正，本地全局）」。
- **授权与门禁**：
  - 本次 RunLogos `--auto` 响应中，deliver 门 `gate_auto_passed=true`；`GATE_AUTO_PASSED` 审计行为 `deliver-entry`，时间 2026-10-09T17:34:03.513Z。
  - 用户决策 C06：打包新版本部署本地全局，不推送。
  - `VERIFY_PASS` 在场，见第八节风险 1。
- **目标环境**：本机 npm 全局 prefix `/opt/homebrew`。入口 `/opt/homebrew/bin/openlogos` 指向 `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js`，全局包目录是普通目录，不是链接。
- **公开副作用**：无。未执行 npm publish、dist-tag、git tag、GitHub Release、官网部署或 git push；未改写其他仓库，包括 runlogos。
- **数据迁移 / 服务启动**：无 / 不适用。

## 二、部署前代码状态

- 基线提交：`9b7746a`（merge-amend-merged-change 归档）。
- 本提案的 merge 产物、四个 `[code]` 切片、code review r1/r2 修复以及本次升版，**均在工作树中，尚未提交**。候选制品由该工作树真实 `npm pack` 生成，制品身份以第四节的 SHA-256 为准。

## 三、冻结事实与回滚点

| 项 | 值 |
|---|---|
| 部署前全局入口 | `/opt/homebrew/bin/openlogos` → `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js` |
| 部署前 `npm prefix -g` | `/opt/homebrew` |
| 部署前 `openlogos --version` | `0.15.19` |
| 部署前 `cli/package.json` | `0.15.19`（候选为下一 patch `0.15.20`，与计划值一致） |
| 回滚制品 | `cli/rollback/miniidealab-openlogos-0.15.19.tgz`，2,623,843 字节 |
| 回滚制品 SHA-256 | `9ad8d40b29e02ea94c4b61e301dda65018869446c21afa3ca26df0c20eb02de7` |
| 回滚制品来源 | 在全局安装目录 `/opt/homebrew/lib/node_modules/@miniidealab/openlogos` 执行 `npm pack --ignore-scripts`，未从工作树打包。其 SHA-256 与 0.15.19 部署记录中的唯一候选制品相同 |
| 内容身份 | 解包后 873 个文件，与全局安装逐文件比对 SHA-256，0 差异；全局 `dist/` 的 404 个文件在包内齐全。包内**不含** `dist/lib/merge-amend.js`，`dist/commands/verify.js` **不含** `pre_run_failed` |
| 旧行为验证 | 隔离 prefix 试装：`--version` 为 `0.15.19`；verify 预跑失败夹具 `gate={"result":"PASS","reason":null}`，不为 `pre_run_failed`；smoke 平台例外、guard 逐段判定、merge 增量修正与身份检查均不具备新行为 |

冻结的本仓托管态（回滚比对基准）：

| 文件 | SHA-256 |
|---|---|
| `.claude/openlogos/bin/guard-check`（部署前工作树） | `83705ad9af7417dec0cbb14e0183a45120d6777511bea9b43c6e1189c419f76e` |
| `.claude/openlogos/bin/guard-check`（`HEAD`，即本提案前） | `d5235589e3cde6edcaba1b52fccf98ce3d6f857c810c7972229b03ce182f5102` |
| `.claude/openlogos/bin/guard-post-check.cjs` | `bdeab4341c935fa9678c34bc36961a0dc579b7b2198da9b92d73b4ee2c88e18c` |
| `.claude/openlogos/bin/openlogos-phase` | `bbdf9a13b475d857a60f52fbfde23242e470de7c2a3a01d63f04e6ea22df5fb9` |
| `.claude/openlogos/bin/openlogos-phase-launcher.cjs` | `679f3a6f2b5b0f96400d0692c8f9c5f2ed330cf7dd380733011042e52915db9a` |
| `.claude/settings.json` | `b5e093dab768a81c212a6eb992a3670ffbc9f2011480e2f9e9663a4ef3ad3358` |

说明：切片 3 与 code review r1/r2 实现时，托管 guard 已按源模板逐字节复制到工作树（当时禁止调用 `openlogos`），所以部署前工作树值已是新 guard。回滚时以 `HEAD` 值为本提案前基准。

## 四、版本与制品身份

- 升版命令 `node cli/scripts/bump-version.mjs 0.15.20` 一次更新了：
  - `cli/package.json`、`cli/package-lock.json`；
  - `cli/asset-manifest.json`（生成器重算 `payloadHash`，未手改）；
  - 5 个 plugin manifest；
  - `local-release-candidate.ts`：CANDIDATE → `0.15.20`，ROLLBACK → `0.15.19`。
- `CHANGELOG.md` 新增 `[0.15.20] - 2026-10-09` 条目，既有条目未改。
- 唯一候选制品：`cli/miniidealab-openlogos-0.15.20.tgz`。由真实 `npm pack` 生成（含 prepack），2,665,195 字节，SHA-256 `2511632038e8e324f761533b55e7f8b314e9badf26b45f6de1d956db14055093`。隔离验证、全局安装与回滚演练都只使用这一个文件。
- 解包核对：
  - `package.json` 与 asset-manifest 版本均为 `0.15.20`；`validateAssetManifest` 重算 `payloadHash`，结果为 `d9dbf2e01ed429894204ee3b9e30c30fc3c26cf1ce4f616cff715e005466b5f5`，自洽。
  - 存在 `dist/lib/merge-amend.js` 与 `dist/lib/merge-baseline.js`。
  - `dist/commands/verify.js` 含 `pre_run_failed`；`dist/commands/smoke.js` 含 `platform-unavailable`；`dist/lib/merge-failure-report.js` 含「未进入修正写入」；`dist/lib/sandbox.js` 含流式截获助手。
  - 随包 guard 模板 SHA-256 `83705ad9…f76e` 与 manifest 条目一致。

## 五、源码回归证据

- 升版后 `cd cli && npm run build` 通过。
- `npm test`（即 `vitest run`）：176 个测试文件、2640 个用例全部通过。覆盖 UT-S13-81～88、ST-S13-23～24、UT-S19-51～56、ST-S19-23～24、UT-S09-448～458、ST-S09-202～204、merge 增量修正 UT-S09-429～447 / ST-S09-196～201 / UT-S11-91～95 / ST-S11-50～51，以及 `UT-S19-46`、`UT-S19-49`。reporter 账本 0 条 fail。

## 六、安装态证据

**隔离 prefix 行为矩阵**：在一次性 prefix 中安装固定候选 tarball（绝对路径），入口 realpath 位于该 prefix 包目录内，非 workspace link。用 `scripts/smoke-verify-smoke-guard-0-15-20.js` 的自测模式，把入口指向隔离 prefix、结果写临时账本，跑 SMOKE-core-226～230 的同一组判据。全部通过：

| 类别 | 结果 |
|---|---|
| candidate identity（226） | `--version` = `0.15.20` = `LOCAL_RELEASE_CANDIDATE_VERSION`；包内 asset-manifest 经 `validateAssetManifest` 自洽；四项行为制品在场；随包 guard 与 manifest 条目一致 |
| verify 预跑失败（227） | 回滚型运行器：exit 1，`gate=FAIL/pre_run_failed`，`stderr_tail` 含哨兵，`acceptance-report.md` 不含命令输出；运行器正常时 PASS（exit 0） |
| smoke 平台不可执行（228） | `platform-unavailable` + 非空 detail 的 skip：PASS（exit 0），列入 `platform_skipped_cases`；去掉 `reason_code`：FAIL `required_cases_skipped`（exit 1） |
| guard 逐段判定（229） | 非 git 临时项目经候选 init、置 launched、sync 部署 guard。以下均 exit 2：`ls && rm -rf src`、`true; rm src/x`、`cd src && rm ../src/a.ts`、`cd "$D" && rm a.ts`、`cd /dev/null && true; rm src/a.ts`、`ls && echo 内容 > src/a.ts`、`cd "$D" && echo 内容 > src/a.ts`、`cd src > src/a.ts && pwd`、`cd "$D" > src/a.ts && pwd`。以下均 exit 0：`ls && cat src/x`、`cd src && cat a.ts`、`echo '$(rm src/a.ts)'`、`ls 2>/dev/null && cat src/x`、`cd src >/dev/null && cat a.ts`。托管副本与随包模板一致 |
| merge 增量修正（230 + 补测） | 依次 `merged` → `already-merged` → `amended`。`status --format json` 的 `spec_amend.pending` 依次为 false（merge 后）→ true（改 delta 后）→ false（amended 后）。再改 delta 并手改已应用目标 → exit 1 `MERGE_AMEND_DRIFT`；stderr 含「未进入修正写入」，stderr 与 JSON message 均不含 `git checkout logos/resources/` |
| 全局零触碰 | 矩阵前后均为 `/opt/homebrew/bin/openlogos` 与 `0.15.19`，逐字一致 |
| 回滚演练 | 在同一隔离 prefix 用 `cli/rollback/miniidealab-openlogos-0.15.19.tgz`（SHA-256 与冻结值一致）覆盖回装：`--version` 为 `0.15.19`；verify 预跑失败夹具 `gate={"result":"PASS","reason":null}`，不为 `pre_run_failed`，作为对照，证明差异由候选引入。演练后两个隔离 prefix 已删除 |

**本机全局安装**：执行 `npm install -g <同一 tarball 的绝对路径>`。新 shell 复核：

| 项 | 值 |
|---|---|
| `command -v openlogos` | `/opt/homebrew/bin/openlogos` |
| 入口 realpath | `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js`（普通目录，非链接） |
| `openlogos --version` | `0.15.20` |
| 包 `package.json` / asset-manifest | `0.15.20` / `0.15.20`，`payloadHash` `d9dbf2e0…b5f5` |
| 与候选 tarball 同源 | tarball 881 个文件与全局安装逐文件比对 SHA-256，0 差异 |
| 随包 guard 模板 | `83705ad9af7417dec0cbb14e0183a45120d6777511bea9b43c6e1189c419f76e` |

## 七、本仓 sync 读回

在本仓项目根用新全局 CLI 执行 `openlogos sync`，退出码 0（`openlogos v0.15.20`，输出「Sync complete.」）。读回结果：

| 项 | 结果 |
|---|---|
| `.claude/openlogos/bin/guard-check` | `83705ad9…f76e`，与全局包 `claude-plugin-template/bin/guard-check` 逐字节一致。相对 `HEAD`（`d5235589…5102`）的变化来自本提案切片 3 与 code review r1/r2 |
| `.claude/openlogos/bin/` 其余三个脚本 | SHA-256 与冻结值相同 |
| `.claude/settings.json` | SHA-256 与冻结值相同（`b5e093da…3358`） |
| 其它 sync 写入 | `AGENTS.md` / `CLAUDE.md` 重渲染后字节不变；17 个 Skills 同步到 `logos/skills/`，无差异；`logos/spec/` 中只有 `cli-json-output.md` 产生差异，即本提案对根规范 `spec/cli-json-output.md` 的修改同步到项目副本。Claude Code 插件已存在，sync 跳过 |

## 八、未解决风险与提醒

1. **VERIFY_PASS 早于 code review 修复**：`VERIFY_PASS` 与 `acceptance-report.md` 生成于 2026-10-09 10:01（本地时间）。之后 code review r1/r2 修改了 `plugin/bin/guard-check`（逐段重定向判定、引号感知替换识别）与 `cli/src/lib/sandbox.ts`（流式有界截获）。修复后及升版后各跑过一次全量 `npm test`，均为 2640/2640 通过，安装态矩阵也覆盖了修复后的行为；但 `openlogos verify` 没有在修复后重跑（本工作单元只授权部署）。如需验收报告与代码同步，可由用户授权重跑 `openlogos verify`。
2. **代码尚未提交**：本提案全部实现与升版仍在工作树中，见第二节。按流程应由后续环节提交。
3. **runlogos 未处理**：按部署方案「不改写其他仓库」，**runlogos 需由用户授权后在其项目根执行 `openlogos sync`，才会获得新 guard**。RunLogos 的 `adapt-upstream-merge-amend` 依赖本次第 5 项，现已随全局 CLI 生效。
4. **smoke 尚未执行**：SMOKE-core-226～230 按流程在 `openlogos deploy-done` 之后另行运行。
5. **回滚入口**：
   - 只需回滚全局：`npm install -g <绝对路径>/cli/rollback/miniidealab-openlogos-0.15.19.tgz`，新 shell 复核 `--version` 为 `0.15.19`。
   - 本仓托管 guard 也需回滚：用旧版 CLI 执行 `openlogos sync`，再按第三节冻结值读回核对。
