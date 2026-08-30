# 部署报告：complete-merge-transaction-consumer-contract / OpenLogos 0.14.0（2026-08-29，本机全局 candidate 部署成功）

## 一、部署结论

- **模块 / 提案**：core / `complete-merge-transaction-consumer-contract`。
- **授权与门禁**：最终 `openlogos verify` 已通过并生成 `VERIFY_PASS`；用户明确授权执行本机全局部署与后续 smoke。
- **目标环境**：本机 npm 全局 prefix `/opt/homebrew`；隔离预检 prefix 位于 `/private/tmp/openlogos-complete-merge-deploy.K9DWrh/isolated-prefix`。
- **执行时间**：截至 `2026-08-29T05:41:03Z`。
- **结论**：修正后的 `0.14.0` candidate 已完成全量测试、build、npm pack、隔离安装合同自检和本机全局安装，部署阶段全部 **PASS**。
- **公开副作用**：未执行 npm publish、Git tag、GitHub Release、官网/Cloudflare 部署或 `git push`。

## 二、部署前快照与回滚点

| 检查项 | 结果 |
|---|---|
| 部署前全局入口 | `/opt/homebrew/bin/openlogos` |
| 部署前 realpath | `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js` |
| 部署前版本 | `0.14.0`（旧 candidate） |
| npm global prefix / root | `/opt/homebrew` / `/opt/homebrew/lib/node_modules` |
| 回滚 tarball | `/private/tmp/openlogos-complete-merge-deploy.K9DWrh/rollback-openlogos-0.14.0-678717240cd7.tgz`；1,932,307 字节 |
| 回滚 SHA-256 | `678717240cd70dc75ba25b41699d11c704caf0a2effed1ba0c1a42ade2ccee17` |
| 可复制回滚命令 | `npm install -g /private/tmp/openlogos-complete-merge-deploy.K9DWrh/rollback-openlogos-0.14.0-678717240cd7.tgz --ignore-scripts` |

回滚包由部署前正在工作的全局安装字节使用 `npm pack --ignore-scripts` 只读封装，已验证版本为 `0.14.0`，并包含 `dist/index.js`、merge transaction schema 与中英文 merge-executor Skill。

## 三、新 candidate 制品与构建结果

| 检查项 | 结果 |
|---|---|
| candidate tarball | `/private/tmp/openlogos-complete-merge-deploy.K9DWrh/miniidealab-openlogos-0.14.0.tgz`；1,955,834 字节 |
| candidate SHA-256 | `6c82b8a806866c356cdad05ca15f4969cb4d9d61ba4318f97ae114b6d4245546` |
| package identity | `@miniidealab/openlogos@0.14.0` |
| CLI 全量测试 | 83 个测试文件，2052/2052 PASS |
| TypeScript build / npm pack | PASS / PASS；674 个打包文件 |
| merge transaction schema SHA-256 | `bfeb05a1577729db52dabff340804c63a99a018815d85789800f0198f1107421` |
| CLI contract SHA-256 | `ad215013d8226a08ccafbb8a888eb9bba22814ba38abb58363c5055f82933d35` |
| completed golden SHA-256 | `57368754cdcc798e27287cdb0c97e354e319e69fc4800acc54047bfdba7c46c6` |

tarball 已确认包含三份 next/status/merge-transaction schema、中文和英文 merge-executor Skill、semantic validator、candidate validator、completed golden 与 CLI 入口。旧 candidate hash 已由新 tarball/hash 事实取代，但回滚制品继续保留。

## 四、隔离安装与消费者合同自检

1. candidate 以显式 tarball 安装到一次性 prefix；绝对入口为 `/private/tmp/openlogos-complete-merge-deploy.K9DWrh/isolated-prefix/bin/openlogos`，realpath 位于该 prefix 的 npm 包内，版本精确为 `0.14.0`。
2. `merge transaction` help 暴露 status、submit-content、seal、apply、recover、abort，已知 action 与命令面一致。
3. 使用隔离安装的绝对 CLI 实跑 fixture：SMOKE-core-151、SMOKE-core-152、SMOKE-core-153、SMOKE-core-154 均 PASS；覆盖 abort/action parity、声明 staging path、completed 无环 receipt 和 abort 三阶段清理/幂等。
4. fixture 均位于一次性目录，不读取源码 CLI、不预造 completed receipt，不修改本仓正式规格或 marker。

## 五、本机全局安装与身份冻结

1. 使用新 candidate 的显式绝对 tarball执行 `npm install -g --ignore-scripts`，未使用 registry、目录 link 或 workspace 入口。
2. 安装后 `command -v openlogos` 为 `/opt/homebrew/bin/openlogos`，realpath 为 `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js`，版本精确返回 `0.14.0`。
3. 全局包内 schema、contract、golden hash 与隔离安装结果完全一致；双语 Skill、semantic validator、candidate validator 均在场。
4. 无数据库或业务数据迁移；未修改 RunLogos 代码、旧提案 guard 或旧 slug marker。

## 六、风险、回滚与后续 smoke

- 当前未解决的产品风险：无部署阶段失败；正式 smoke 尚需验证 SMOKE-core-151～156 的完整跨仓证据。
- 任何后续安装态失败均先执行固定回滚命令，再清除 shell 命令缓存并复核入口、realpath 和 `0.14.0` 版本。
- SMOKE-core-155 需要 RunLogos 真实消费者命令；SMOKE-core-156 需要两个 stacked slug 的 guard/marker/candidate hash 归属证据。不得用源码、mock、手工 receipt 或复制 marker 代替。
- 本报告仅证明部署成功；`SMOKE_PASS` 只能由已获授权的独立 `openlogos smoke` 真实生成。

---

# 部署报告：fix-test-slice-changed-id-semantic-diff / OpenLogos 0.13.30（2026-08-26，本机全局部署成功）

## 一、部署结论

- **模块 / 提案**：core / `fix-test-slice-changed-id-semantic-diff`。
- **授权与门禁**：最终 `openlogos verify` 已通过并生成 `VERIFY_PASS`；用户明确授权执行本机全局部署和后续 smoke。
- **目标环境**：本机 npm 全局 prefix `/opt/homebrew`；验证项目使用一次性 fixture `/private/tmp/openlogos-test-change-set-deploy-fixture.QQ6e29`。
- **执行时间**：截至 `2026-08-26T09:07:15Z`。
- **结论**：真实 `0.13.30` tarball 构建、安装态入口证明、一次性 fixture 只读启动以及 `0.13.30 → 0.13.29 → 0.13.30` 回滚恢复演练全部 **PASS**；最终全局版本为 `0.13.30`。
- **最终门禁**：独立 `openlogos smoke --env local-global` 已完成；SMOKE-core-130～SMOKE-core-134 与全量回归均通过，Gate 3.8 PASS。

## 二、部署前快照与制品

| 检查项 | 结果 |
|---|---|
| 部署前全局入口 | `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js` |
| 部署前版本 | `0.13.27` |
| npm global prefix / root | `/opt/homebrew` / `/opt/homebrew/lib/node_modules` |
| 部署前离线快照 | `logos/resources/verify/test-change-set-deployment-evidence/artifacts/miniidealab-openlogos-0.13.27.tgz`；1,655,234 字节 |
| 部署前快照 SHA-256 | `4ac012469a28e669156233d8a567ea95eb392f719d816cb23d4fabfc4cee7434` |
| 候选 tarball | `logos/resources/verify/test-change-set-deployment-evidence/artifacts/miniidealab-openlogos-0.13.30.tgz`；1,874,701 字节；643 个条目 |
| 候选 SHA-256 | `3f34c3b8aa6781a27d2c08ec75294001ffe9916195f5d534ae2a59d57db4b386` |
| 回滚 tarball | `/private/tmp/openlogos-trae-local-negative.nPfuJt/artifacts/miniidealab-openlogos-0.13.29.tgz`；1,863,090 字节 |
| 回滚 SHA-256 | `cccb01674f75dc1219f03d78c8c3c0a6672f2c436bfc00fd98a9e1a096db804c` |

候选包 identity 为 `@miniidealab/openlogos@0.13.30`，`bin.openlogos` 指向 `dist/index.js`。`cli/package.json`、lockfile 根包和 Claude/Codex/ZCode/Qoder/WorkBuddy 五类有版本字段的插件 manifest 均为 `0.13.30`。tarball 已确认包含 `dist/index.js`、`dist/lib/test-change-set.js`、`dist/lib/test-slice-manifest.js`、`spec/test-slice-manifest.md`、`spec/baseline-closure.md` 与五类插件资产。

## 三、构建、安装与入口证明

1. 最终 verify 已确认 1661/1661 用例执行、失败 0、覆盖率和通过率均为 100%；部署阶段再次执行 `npm run build`、`npm run lint` 和真实 `npm pack`，均退出 0。
2. 候选使用显式本地 tarball 执行 `npm install -g --ignore-scripts`；未使用目录、workspace link、源码入口或 registry 包。
3. 安装后 `command -v openlogos` 为 `/opt/homebrew/bin/openlogos`，realpath 为 `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js`，`openlogos --version` 精确返回 `0.13.30`。
4. 安装态关键文件 SHA-256 与 tarball 一致：`dist/index.js` 为 `a12f1e852da188d355402d5ca43c86a7e349562d73da102d869e64989bb73158`，`dist/lib/test-change-set.js` 为 `97d74e9d4cf60e753985df436e9087749c7a761c86da69b0bef0990335836c87`，`dist/lib/test-slice-manifest.js` 为 `4a1dcece03a92ec142eb60c9f7da7b82c2b43b734776b1370ed7fa452b5d53f5`。
5. 一次性 fixture 中由真实全局入口执行 `status --format json` 成功，lifecycle 为 `launched`、`active_change=null`、fixture guard 不在场；协议资产读取通过，未对本仓库活跃提案执行 merge 事故夹具。

## 四、回滚与恢复演练

1. 从固定本地 `0.13.29` tarball 替换全局安装后，入口仍位于同一 `/opt/homebrew` prefix，CLI 与五类插件版本均精确为 `0.13.29`；一次性 fixture 的只读 status 检查通过。
2. 再从原始候选 tarball 恢复 `0.13.30`，入口、CLI/插件版本、关键文件 SHA-256 和 fixture 只读启动全部再次通过。
3. 最终全局状态为 `@miniidealab/openlogos@0.13.30`。若后续 smoke 暴露安装态问题，可使用已固定的 `0.13.29` tarball 回滚；若需恢复部署前状态，可使用本节固定的 `0.13.27` 快照。

## 五、风险与副作用审计

- 未解决风险：无；正式 smoke 已验证事故六 ID、removed/篡改、跨进程稳定和真实回滚。
- 用户数据边界：未修改真实用户项目、AI 工具配置、账号、记忆、凭据或未知全局包；只替换明确识别的全局 OpenLogos 包。
- 公开副作用：未执行 npm publish、npm dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署或 `git push`，未读取 npm token 或 registry 凭据。

## 六、正式 Smoke 失败修复与最终结果

1. 首轮 `openlogos smoke --env local-global` 已真实执行：定义 104、执行 74、通过 73、失败 1、未覆盖 30。SMOKE-core-130～SMOKE-core-134 当轮已 5/5 PASS；唯一失败是 SMOKE-core-66 缺少固定 `0.13.25` 回滚 tarball，未覆盖项为未显式激活的 ZCode/Qoder/WorkBuddy/TRAE 历史真实宿主回归。
2. 修复未改源码或降低断言：补入已验证的 `0.13.25` tarball（SHA-256 `7a6d7053dc3b11df69f86d01e25367ebc06fba9c447cf85a8daec705a2f2cade`），并逐包复核后显式路由 ZCode `0.13.27/0.13.24`、Qoder `0.13.27/0.13.24`、WorkBuddy `0.13.28/0.13.27`、TRAE `0.13.29/0.13.28` 的本地制品、真实宿主入口和当前 driver。
3. 按用户授权重新安装同一 SHA-256 的 `0.13.30` 候选，入口与 `test-change-set.js` 哈希再次匹配；随后受控执行 `openlogos deploy-done --env local-global`，清理首轮 `SMOKE_FAIL` 后从空正式账本重新运行全量 smoke。
4. 第二轮正式结果：定义 104、执行 104、通过 104、失败 0、跳过 0、未覆盖 0，覆盖率与通过率均为 100%，Gate 3.8 **PASS**。SMOKE-core-130～SMOKE-core-134 均绑定候选 SHA-256 `3f34c3b8aa6781a27d2c08ec75294001ffe9916195f5d534ae2a59d57db4b386`、回滚 SHA-256 `cccb01674f75dc1219f03d78c8c3c0a6672f2c436bfc00fd98a9e1a096db804c` 与全局入口 `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js`。
5. 最终 `VERIFY_PASS`、`DEPLOY_DONE`、`SMOKE_PASS` 在场，`SMOKE_FAIL` 不在场；全局 `openlogos --version` 为 `0.13.30`。网站 smoke 只在一次性 sandbox 构建，未部署网站，也未产生任何公开发布或 push 副作用。

---

# 部署报告：trae-local-negative-smoke / OpenLogos 0.13.29（2026-08-25，本地隔离部署成功）

## 一、部署结论

- **模块 / 提案**：core / `trae-local-negative-smoke`。
- **授权与门禁**：`openlogos verify` 已通过并生成 `VERIFY_PASS`；用户明确授权执行部署及后续 smoke。
- **目标环境**：`local-isolated`；一次性根为 `/private/tmp/openlogos-trae-local-negative.nPfuJt`，所有 HOME、npm prefix/cache、workspace 与 evidence 写入均位于该根内。
- **执行时间**：2026-08-26T03:56:12Z 至 2026-08-26T03:56:18Z。
- **结论**：真实 `0.13.29` 候选 tarball 安装、TRAE 负向边界、七宿主回归与 `0.13.29 → 0.13.28 → 0.13.29` 回滚恢复全部 **PASS**；第四轮正式 smoke 为 99/99 PASS，Gate 3.8 **PASS**。
- **能力结论**：TRAE capability 继续为 **BLOCKED**、non-deployable；本地部署对象是 OpenLogos CLI，不是 TRAE Adapter 或插件。

## 二、制品与隔离证据

| 检查项 | 结果 |
|---|---|
| 候选 tarball | `/private/tmp/openlogos-trae-local-negative.nPfuJt/artifacts/miniidealab-openlogos-0.13.29.tgz` |
| 候选 identity | `@miniidealab/openlogos@0.13.29`；1,863,090 字节 |
| 候选 SHA-256 | `cccb01674f75dc1219f03d78c8c3c0a6672f2c436bfc00fd98a9e1a096db804c` |
| 回滚 tarball | `/private/tmp/openlogos-workbuddy-staging-20260825/artifacts/miniidealab-openlogos-0.13.28.tgz` |
| 回滚 identity | `@miniidealab/openlogos@0.13.28`；1,861,272 字节 |
| 回滚 SHA-256 | `b2bef7b29dfa8d5c8a7ea8a1bff9523f9787d0864aa7e59285c1403fdb4daf47` |
| 最终 CLI 入口 | `<LOCAL_ROOT>/prefix/node_modules/@miniidealab/openlogos/dist/index.js` |
| 最终 CLI 版本 | `0.13.29` |
| 可写根 | `home`、`prefix`、`cache`、`workspace`、`evidence`，realpath 均位于一次性根 |
| 真实用户边界 | 未读取真实 HOME；未写全局 npm；未启动 TRAE；未读取原生记忆正文 |

候选制品由当前仓库 `cli/` 执行 build 与 `npm pack` 产生；回滚制品复用此前本地部署中已生成的真实 `0.13.28` tarball，并重新核验包名、版本、大小和 SHA-256。没有从公共 registry 动态解析回滚版本，也没有使用目录、link、workspace CLI 或全局 CLI 替代 tarball。

## 三、部署检查与回滚恢复

1. 候选 tarball 安装到一次性 npm prefix，实际入口 realpath 位于隔离根，`--version` 精确返回 `0.13.29`。
2. 安装态执行 `init --ai-tool trae` 返回 exit 1，首次写入未发生；合成 `.trae/**`、settings、账号占位、`enabled_folders`、未知文件及不透明记忆的清单、大小和 SHA-256 全部不变。
3. `init --ai-tool all` 与 `sync` 只使用稳定七宿主：Claude Code、OpenCode、Codex、Cursor、ZCode、Qoder、WorkBuddy；配置含 `trae` 时在事务前 exit 1 且无部分提交。
4. 同一隔离 prefix 已实际安装并核验 `0.13.28`，随后从原候选 tarball 恢复 `0.13.29`；恢复后再次执行显式 TRAE 负向检查，exit 1，用户边界不变。
5. 部署演练结果覆盖 SMOKE-core-124～SMOKE-core-129 六项断言且全部 PASS；这些临时结果只作为部署证据，不替代 `DEPLOY_DONE` 后由 `openlogos smoke --env local-isolated` 产生的正式结果。

## 四、证据、清理与风险

- 临时部署证据：`/private/tmp/openlogos-trae-local-negative.nPfuJt/evidence/`；仅含制品 identity、脱敏隔离路径、退出码、稳定宿主集合与合成 fixture 哈希。
- 回滚点：固定 `0.13.28` tarball；部署已在同一 prefix 完成回滚并恢复候选。失败时可直接丢弃具体一次性根，不影响真实用户安装。
- 清理策略：正式 smoke 完成前保留一次性根和两个 tarball；smoke 通过后可删除本次显式创建的 `/private/tmp/openlogos-trae-local-negative.nPfuJt`，不得使用宽泛递归目标。
- 未解决风险：无；正式 smoke 已执行，SMOKE-core-124～129 与全量回归均通过并生成 `SMOKE_PASS`。
- 公开副作用：未执行 npm publish/dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署或 `git push`；未修改真实 TRAE 国际版/CN、真实用户 `.trae/**` 或全局 npm 安装。

## 五、首轮 Smoke 失败与 retry2 重部署

1. 首轮 `openlogos smoke --env local-isolated` 没有把通用 runner 的 `OPENLOGOS_BIN` 指向隔离候选，因此 SMOKE-core-51、59、62 正确发现全局 `openlogos@0.13.27` 与仓库 `0.13.29` 不一致；SMOKE-core-66 还缺少固定 `0.13.25` 回滚 tarball。ZCode/Qoder/WorkBuddy runner 未启用，导致 SMOKE-core-100～123 未覆盖。Gate 3.8 为 FAIL，没有伪造或复用历史 PASS。
2. 失败根因是正式 smoke 输入未完整路由，不是 TRAE runner 或候选 tarball 失败。修复策略是不降低断言：通用 runner 显式使用隔离安装的 `0.13.29` CLI；SMOKE-core-66 注入 SHA-256 为 `7a6d7053dc3b11df69f86d01e25367ebc06fba9c447cf85a8daec705a2f2cade` 的真实 `0.13.25` tarball；历史宿主 runner 使用各自已验证的专属制品、驱动和外置证据目录。
3. retry2 在 `/private/tmp/openlogos-trae-local-negative.nPfuJt/retry2-root` 重新完成候选安装、显式 TRAE 拒绝、七宿主排除与 `0.13.29 → 0.13.28 → 0.13.29` 回滚恢复，SMOKE-core-124～129 的部署演练再次 6/6 PASS。
4. retry2 预检确认真实 ZCode CLI `0.16.3`、Qoder CLI `1.1.29`、WorkBuddy engine `2.115.0` 及三个 staging driver 的自描述合同可用；正式 smoke 仍不得启动 TRAE 或改变 D06 BLOCKED 结论。

## 六、第二轮 Smoke 失败与 retry3 重部署

1. 第二轮正式 smoke 已执行 99/99、覆盖率 100%；94 项通过，唯一失败组为 SMOKE-core-117～121。失败输出证明 dispatcher 引用了旧 WorkBuddy driver：它仍错误比较 engine `2.115.0` 与 app 最低版本 `5.3.5`，仍调用不存在的 `agents --json`，并导致后续会话空输出。
2. 修复没有改写 smoke 断言，而是把 WorkBuddy runner 的 driver 输入切换为当前仓库已经 verify 的修复版：app `5.3.14` 与 engine `2.115.0` 分源取证，组件由受限 `Read,Glob` 真实会话发现，并保留 Agent、SessionStart、allow/hard deny、sync/launch、回滚和真实 Home 哈希断言。
3. 修复版 WorkBuddy runner 已先行定向真实执行 SMOKE-core-116～123，8/8 PASS；证据位于 `/private/tmp/openlogos-trae-local-negative.nPfuJt/workbuddy-focused-evidence/`，真实用户 Home 边界前后不变。
4. retry3 在 `/private/tmp/openlogos-trae-local-negative.nPfuJt/retry3-root` 再次完成 TRAE 候选安装、负向检查与双 tarball 回滚恢复，部署演练 SMOKE-core-124～129 为 6/6 PASS。随后重新登记同环境 `DEPLOY_DONE`，再执行第三轮正式 smoke。

## 七、第三轮 Smoke 瞬态失败与 retry4 重部署

1. 第三轮正式 smoke 已执行 99/99、98 项通过；唯一失败为 Qoder SMOKE-core-112，真实允许写入会话一次性返回 `Repeated tool call was denied`。TRAE、WorkBuddy、ZCode 与全部通用 runner 均通过。
2. 历史与当前 Qoder driver 字节一致，且同一 runner 在第二轮已通过；当前提案不改写 Qoder driver，也不降低真实 Write 断言。按原合同定向重跑 Qoder SMOKE-core-108～115，8/8 PASS，其中 SMOKE-core-112 实际写入成功，SMOKE-core-113 hard deny 仍真实通过。
3. Qoder retry4 证据位于 `/private/tmp/openlogos-trae-local-negative.nPfuJt/qoder-focused-retry4-evidence/`；该结果仅用于确认瞬态恢复，不复制进正式 smoke 账本。
4. retry4 在 `/private/tmp/openlogos-trae-local-negative.nPfuJt/retry4-root` 再次完成 TRAE 候选安装、负向检查和 `0.13.29 → 0.13.28 → 0.13.29` 恢复，部署演练 6/6 PASS；随后重新登记 `DEPLOY_DONE` 并从空正式账本重跑全部 smoke。

## 八、第四轮正式 Smoke 最终结果

1. 第四轮 `openlogos smoke --env local-isolated` 从空正式账本重新执行全部 runner：定义 99、执行 99、通过 99、失败 0、跳过 0、未覆盖 0，覆盖率与通过率均为 100%，Gate 3.8 **PASS**。
2. TRAE SMOKE-core-124～129 使用候选 SHA-256 `cccb01674f75dc1219f03d78c8c3c0a6672f2c436bfc00fd98a9e1a096db804c` 与回滚 SHA-256 `b2bef7b29dfa8d5c8a7ea8a1bff9523f9787d0864aa7e59285c1403fdb4daf47`，环境为 `local-isolated`，六项均含真实脱敏 evidence。
3. 通用 runner 显式解析隔离 `openlogos@0.13.29`；ZCode/Qoder/WorkBuddy 使用各自已验证的历史专属制品和真实宿主 driver。第四轮没有复用定向结果，Qoder SMOKE-core-112/113 与 WorkBuddy SMOKE-core-116～123 均在正式账本重新通过。
4. `DEPLOY_DONE`、`SMOKE_PASS` 在场，`SMOKE_FAIL` 不在场。TRAE capability 仍为 **BLOCKED**，没有注册 TRAE、启动 TRAE、读取真实记忆正文或执行 npm publish、Git tag、GitHub Release、官网/Cloudflare 部署、`git push`。

---

# 部署报告：workbuddy-adapter-foundation / OpenLogos 0.13.28（2026-08-25，成功）

## 一、最终结论

- **模块 / 提案**：core / `workbuddy-adapter-foundation`。
- **授权与门禁**：用户明确授权修复后重新 verify 并再次部署；最终 `openlogos verify` 为 Gate 3.6 PASS，1608/1608 覆盖、1598 通过、0 失败、10 跳过。
- **执行时间**：2026-08-25T15:52:15Z 至 2026-08-25T16:08:33Z；正式 smoke 前修复后重部署为 retry6。
- **结论**：隔离 staging 部署 **PASS**；`SMOKE-core-116`～`SMOKE-core-123` 在 retry6 真实执行 8/8 PASS。
- **边界**：正式 `openlogos smoke --env staging` 已完成；未执行 npm publish、Git tag、GitHub Release、官网/Cloudflare 部署或 `git push`。

## 二、制品、宿主与隔离证据

| 检查项 | 最终结果 |
|---|---|
| 候选 tarball | `/private/tmp/openlogos-workbuddy-staging-20260825/artifacts/miniidealab-openlogos-0.13.28.tgz` |
| 候选 SHA-256 | `b2bef7b29dfa8d5c8a7ea8a1bff9523f9787d0864aa7e59285c1403fdb4daf47` |
| 回滚 tarball / SHA-256 | `0.13.27` / `4ac012469a28e669156233d8a567ea95eb392f719d816cb23d4fabfc4cee7434` |
| WorkBuddy app | `5.3.14`，从 `/Applications/WorkBuddy.app/Contents/Info.plist` 独立探测 |
| 内置 CodeBuddy engine | `2.115.0`，只作协议诊断，不参与 WorkBuddy app 最低版本判断 |
| 插件 identity | `openlogos@0.13.28`，真实 `plugin validate` 与新 session 探测通过 |
| 组件发现 | 真实宿主以受限 `Glob,Read` 发现 18 Skills、10 Commands、1 Agent；`--agent change-reviewer` 返回 `OPENLOGOS_AGENT_READY` |
| 隔离 profile | OpenLogos 子进程显式使用一次性 HOME/USERPROFILE/XDG/CODEX_HOME/个人 marketplace 根；WorkBuddy 使用一次性 `CODEBUDDY_CONFIG_DIR` 且禁用原生记忆读写 |
| 真实 Home 边界 | Codex marketplace/cache/config、`.codebuddy`、WorkBuddy memory/settings/plugins/user-state 的不透明 SHA-256 前后逐项一致 |

## 三、真实宿主闭环

1. `SMOKE-core-116`：真实 tarball 隔离安装、CLI 精确版本 `0.13.28` 与随包 WorkBuddy 资产清单通过。
2. `SMOKE-core-117`：WorkBuddy app `5.3.14` 与 engine `2.115.0` 分源取证；插件、SessionStart、PreToolUse capability 通过。
3. `SMOKE-core-118`：组件发现为 18/10/1，发现与 Agent 调用均首试通过；合成 settings、用户插件与原生记忆字节保持不变。
4. `SMOKE-core-119`～`121`：新 session 观察到磁盘派生上下文；允许写入实际落盘；源码、项目外与 symlink 逃逸均得到真实宿主阻断及 runtime exit 2、`continue=false`、非空 reason。
5. `SMOKE-core-122`：连续两次 `sync` 和两次 `launch` 的托管插件哈希不变，原生记忆零写入。
6. `SMOKE-core-123`：`init --ai-tool all` 的七宿主资产在隔离 profile 中生成；真实用户 Codex/WorkBuddy 边界不变；独立安装回滚包恢复 `0.13.27`。

## 四、失败修复闭环与证据

- retry2 / retry3 证明 app/engine 版本拆分与 OpenLogos Home 隔离已生效，但隔离 WorkBuddy session 缺少登录态。
- retry4 使用只读登录 Home、一次性 CodeBuddy 配置和禁用记忆环境后达到 7/8 PASS；组件会话出现一次 exit 0 空输出，未伪造成功。
- retry5 对只读组件发现和无副作用 Agent probe 各允许一次可追溯重试，实际均在第 1 次成功；写入和 Hook 阶段不重试，最终 8/8 PASS。
- 正式 smoke 首轮暴露多宿主 runner 共用 tarball 环境与显式候选版本探测缺陷；修复 dispatcher 的宿主专属制品路由和 baseline 候选版本判断后，`openlogos verify` 再次以 1608/1608 覆盖、0 失败通过。
- retry6 使用修复后工作区重新执行真实 WorkBuddy staging：8/8 PASS，真实用户 Home 边界前后哈希一致，回滚恢复 `0.13.27`。
- 最终证据目录：`logos/resources/verify/evidence/workbuddy-adapter-foundation-staging-20260825-retry6/`；聚焦 reporter 为其中 `focused-smoke-results.jsonl`。

## 五、正式 smoke 修复闭环

1. 首轮正式 `openlogos smoke --env staging` 定义 93 项，执行 69 项、通过 57 项、失败 12 项、未覆盖 24 项。失败摘要显示通用 runner 误用全局 `0.13.27`、三个宿主共用一组候选/回滚 tarball、`SMOKE-core-67` 固定期望旧版本、`SMOKE-core-66` 缺少历史回滚输入，以及 WorkBuddy staging 未被正式 dispatcher 激活。
2. 修复 `scripts/run-smoke.js`，为 ZCode、Qoder、WorkBuddy 分别路由宿主专属候选与回滚制品；修复 `scripts/smoke-baseline-on-touch.js`，显式 `OPENLOGOS_BIN` 时按当前候选包版本验收，未显式覆盖时继续保持全局 `0.13.27` 合同。对应 runner 合同测试与最终 `openlogos verify` 均通过。
3. 使用隔离安装的 `0.13.28` CLI 作为通用正式候选；ZCode/Qoder 继续验证 `0.13.27` 候选与 `0.13.24` 回滚，WorkBuddy 验证 `0.13.28` 候选与 `0.13.27` 回滚，`SMOKE-core-66` 使用已校验的 `0.13.25` 历史制品。未改变全局 `openlogos@0.13.27`。
4. 修复后重新执行 retry6 staging 部署并登记 `DEPLOY_DONE`，随后正式 smoke 为 93/93 执行、93 通过、0 失败、0 跳过、0 未覆盖，覆盖率与通过率均为 100%，Gate 3.8 **PASS**；`SMOKE_PASS` 在场，`SMOKE_FAIL` 不在场。
5. WorkBuddy 正式证据镜像：`logos/resources/verify/evidence/workbuddy-adapter-foundation-staging-20260825-retry6/formal-pass/`；Qoder/ZCode 回归证据分别镜像到既有 evidence 目录的 `formal-workbuddy-regression-pass/`。smoke sandbox 对工作区非白名单构建输出保持写入拒绝，依赖与网站构建只发生在一次性沙箱中，不回收到工作区。

---

# 部署报告：workbuddy-adapter-foundation / OpenLogos 0.13.28（2026-08-25，失败）

## 一、部署摘要

- **模块 / 提案**：core / `workbuddy-adapter-foundation`。
- **授权依据**：最终 `openlogos verify` 已通过，用户明确授权继续隔离 staging 部署，并确认 WorkBuddy 5.3.14 已安装和登录。
- **目标环境**：`/private/tmp/openlogos-workbuddy-staging-20260825/` 下的一次性 npm prefix、workspace 与 CodeBuddy 配置目录；真实应用 `/Applications/WorkBuddy.app`。
- **执行时间**：2026-08-25T15:20:00Z 至 2026-08-25T15:27:06Z。
- **结论**：**FAILED / 已安全回滚**。WorkBuddy-only tarball、插件、真实新 session、allow/deny Hook 与 sync/launch 均通过，但 `init --ai-tool all` 刷新了真实用户级 Codex OpenLogos 缓存，违反隔离 staging 和用户资产边界；未写入 `DEPLOY_DONE`，未执行正式 `openlogos smoke`。
- **外部副作用边界**：未执行 npm publish、Git tag、GitHub Release、官网/Cloudflare 部署或 `git push`。

## 二、门禁、制品与环境

| 检查项 | 结果 |
|---|---|
| `VERIFY_PASS` | **PASS**：`logos/changes/workbuddy-adapter-foundation/VERIFY_PASS` 在场 |
| CLI 隔离构建 | **PASS**：`npm ci`、`npm run build` 退出码 0 |
| CLI 隔离全量测试 | **PASS**：75 个测试文件、1937/1937 项通过 |
| 候选 tarball | `/private/tmp/openlogos-workbuddy-staging-20260825/artifacts/miniidealab-openlogos-0.13.28.tgz` |
| 候选 SHA-256 | `b2bef7b29dfa8d5c8a7ea8a1bff9523f9787d0864aa7e59285c1403fdb4daf47` |
| 回滚 tarball | `/private/tmp/openlogos-workbuddy-staging-20260825/artifacts/miniidealab-openlogos-0.13.27.tgz` |
| 回滚 SHA-256 | `4ac012469a28e669156233d8a567ea95eb392f719d816cb23d4fabfc4cee7434` |
| 隔离安装版本 | 候选 `0.13.28`、回滚 `0.13.27` 均由独立 npm prefix 实际执行 `openlogos --version` 验证 |
| WorkBuddy 应用 | `/Applications/WorkBuddy.app`，Info.plist 版本 `5.3.14` |
| WorkBuddy 内置引擎 | `/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy`，版本 `2.115.0` |

候选 tarball 清单已证明包含 `dist/index.js`、`.workbuddy-plugin/plugin.json`、Skills、Commands、Agents、`hooks/hooks.json`、`hooks/runtime.mjs` 与 `spec/workbuddy-plugin.md`。上一版本未发布到 npm registry；回滚包从部署前正在工作的全局 `@miniidealab/openlogos@0.13.27` 安装态只读封装，并经独立安装验证。

## 三、WorkBuddy-only 真实宿主证据

1. `init --ai-tool workbuddy`、`adopt --ai-tool workbuddy` 均从候选 tarball 的隔离 CLI 执行成功，插件 identity 为 `openlogos`、版本为 `0.13.28`。
2. WorkBuddy 内置真实引擎执行 `plugin validate` 通过；真实 `--plugin-dir` 新 session 返回 `OPENLOGOS_PLUGIN_READY`，并实际加载 tarball 插件的 WorkBuddy 指令与 Skills。
3. 真实 WorkBuddy Write 将当前提案允许的 `proposal.md` 写入成功；对 `src-blocked.txt` 的真实 Write 返回“plan 阶段仅允许当前提案 proposal.md 与 tasks.md”，宿主回复 `DENIED`。
4. 被拒目标保持 SHA-256 `2b92ea252be0fbc26f70317cdaa7b6411ea634b50d55338cd8c495e4dbf25d1d`；同一 tarball runtime 补充返回 exit 2、`continue=false`、`permissionDecision=deny` 与非空 reason。
5. 合成 `.workbuddy/settings.json`、用户插件和原生记忆字节均保持不变；原生记忆 SHA-256 为 `46a68661744fa30b11deb5b225c5b2264b27af3588a67540663ab60c36e8a0c7`。`AGENTS.md` 仅追加 OpenLogos managed block，原用户首行仍在场。
6. 连续两次 `sync` 与两次 `launch` 后插件目录 SHA-256 始终为 `3d6e19b2180f3354cd6b9d80d0daac8de65dec375476f9c89419b5dd63c026ce`，原生记忆继续保持不变。

## 四、失败点与回滚

1. `init --ai-tool all` 虽在一次性 workspace 执行，却刷新了真实 `~/.codex/plugins/cache/personal/openlogos`，将 OpenLogos 缓存切换到 `0.13.28`。这是隔离 profile 未贯穿 CLI 子进程的真实缺陷，不能把该回归判为 PASS。
2. 立即停止后续部署，用已校验的 `0.13.27` tarball 在独立 rollback workspace 重建既有宿主资产；最终 `~/.codex/plugins/cache/personal/openlogos/0.13.27` 在场，`0.13.28` 缓存不在场，全局 `/opt/homebrew/bin/openlogos --version` 精确返回 `0.13.27`。
3. WorkBuddy staging driver 另有两处真实协议口径错误：它把内置引擎版本 `2.115.0` 与 WorkBuddy 应用最低版本 `5.3.5` 直接比较；并调用当前引擎不存在的 `agents --json`。真实应用版本应从 app metadata 单独取证，组件发现应改用当前宿主支持的协议或真实 session 证据。
4. 由于上述缺陷属于当前提案代码，且项目规则要求发现 bug 后先报告、等待用户决定，本轮未直接修改 runner/driver，也未执行 `openlogos deploy-done --env staging`。

## 五、修复建议与后续门禁

1. 让 staging runner 对所有候选 CLI 调用显式传递隔离用户目录，并增加“真实 Home 最近写入为零”的失败断言；`all` 回归不得刷新真实 Codex marketplace、cache 或 config。
2. 将 WorkBuddy app 版本与内置 CodeBuddy engine 版本拆为两个字段，最低版本门只约束 app 版本；保留内置引擎版本用于协议兼容诊断。
3. 用 WorkBuddy 5.3.14 实际支持的插件/组件发现方式替换 `agents --json`，并增加真实 `--plugin-dir` 参数解析回归。
4. 修复后重新运行 `openlogos verify`，再重新获得部署授权并执行隔离 staging；只有部署成功后才能受控运行 `openlogos deploy-done --env staging`，随后另行授权正式 smoke。

---

# 部署报告：qoder-adapter-foundation / OpenLogos 0.13.27（2026-08-24）

## 一、部署摘要

- **模块 / 提案**：core / `qoder-adapter-foundation`。
- **授权依据**：最终 `openlogos verify` 已通过，用户明确授权部署到隔离 staging，并在配置 DeepSeek BYOK、最小请求成功后要求继续。
- **目标环境**：本机一次性 init / adopted staging workspace；真实 Qoder CLI `1.1.29`；真实 npm tarball `0.13.27`。
- **最终执行时间**：2026-08-24T20:45:53-0700 至 2026-08-24T20:47:49-0700。
- **结论**：真实 tarball 安装、Qoder 插件发现、资源 inventory、SessionStart、PreToolUse allow / hard deny、sync / launch 幂等、既有宿主回归与回滚演练全部 **PASS**；聚焦 `SMOKE-core-108`～`SMOKE-core-115` 为 8/8 PASS，隔离 staging 部署完成。
- **状态边界**：本节记录的是部署阶段的聚焦 staging 验证，不替代后续正式 `openlogos smoke` 人类确认点；未执行 npm publish、Git tag、GitHub Release、官网/Cloudflare 部署或 `git push`。

## 二、部署前门禁与制品

| 检查项 | 结果 |
|---|---|
| 最终 verify | **PASS**：1557/1557 执行，1547 通过、0 失败、10 跳过、0 未覆盖，覆盖率与通过率均 100% |
| CLI 全量测试 | **PASS**：71 个测试文件、1883/1883 项通过 |
| smoke 覆盖预检 | **PASS**：本提案 8 个 Qoder smoke ID 均被 runner 发现 |
| 候选 tarball | `/private/tmp/openlogos-qoder-deploy-f517993/retry2/miniidealab-openlogos-0.13.27.tgz` |
| 候选大小 | `1,655,234` 字节 |
| 候选 SHA-256 | `4ac012469a28e669156233d8a567ea95eb392f719d816cb23d4fabfc4cee7434` |
| 回滚 tarball | `/private/tmp/openlogos-qoder-deploy-f517993/previous/miniidealab-openlogos-0.13.24.tgz` |
| 回滚 SHA-256 | `80c0ea7945632105634e285186acfaef875a89ff7748406c1a9c9cb5512fdf79` |
| Qoder CLI | `/Users/huangxianglong/.qoder/entry/qoder`，版本 `1.1.29` |
| 模型通道 | DeepSeek BYOK：`deepseek/deepseek-v4-flash-pg`；真实会话 `total_credits=0` |

候选包包含 `dist/index.js`、`.qoder-plugin/plugin.json`、`hooks/hooks.json`、`runtime.mjs`、`runtime.cjs`、Skills、Commands 与 Agent。Qoder 模板保留宿主专用 Agent，init 命令使用 `--ai-tool qoder`，next 命令直接调用 `openlogos next`；Hook 使用 Qoder 1.1.29 支持的 command 协议。

## 三、真实 Qoder staging 结果

| Smoke ID | 结果 | 证据 / 结论 |
|---|---|---|
| SMOKE-core-108 | **PASS** | 候选 tarball 隔离安装，CLI 版本、大小、SHA-256 与随包 Qoder 资产一致 |
| SMOKE-core-109 | **PASS** | 真实 `qoder plugins validate/install/enable/list` 发现唯一 `openlogos` identity，版本 `0.13.27` |
| SMOKE-core-110 | **PASS** | 发现 18 个 Skills、10 个 Commands、1 个 Agent、2 个 command Hooks |
| SMOKE-core-111 | **PASS** | 无 guard / 有 guard 的真实新 session 均与磁盘 lifecycle、active change、proposal_step 和下一确认点一致 |
| SMOKE-core-112 | **PASS** | 真实 Qoder Write 写入当前提案允许路径，内容落盘且 decision 为 allow |
| SMOKE-core-113 | **PASS** | 源码、项目外绝对路径、`..` / symlink 逃逸与 runtime 异常均 fail-closed；runtime 返回 deny、reason 与 exit 2，目标保持不变 |
| SMOKE-core-114 | **PASS** | 连续 sync 与两次 adopted launch 均为 `unchanged`，最终资产哈希为 `5ab94b515a46f42df7ad7b5e61ea5b02a0a55fedcbf9e2142c4630b1cbf9bd99` |
| SMOKE-core-115 | **PASS** | 五个既有宿主最小回归在场；回滚包恢复为 `0.13.24`，用户资产保持 |

DeepSeek BYOK 解除原 Qoder credit limit 阻塞。真实会话响应明确记录模型 `deepseek/deepseek-v4-flash-pg`、`total_cost_usd=0` 与 `total_credits=0`；凭据未写入报告、reporter 或证据文件。

## 四、失败修复闭环与回滚

1. 首轮真实模型请求因 Qoder credit limit 失败；保留原失败 reporter 与证据，未将失败改写为 pass。用户配置 DeepSeek BYOK 并完成最小请求后继续。
2. BYOK 后发现 SessionStart 取证提示会触发宿主保密拒绝；改为直接核对 runtime 原始 `additionalContext`，同时让真实 Qoder 仅报告用户可见项目状态。
3. 初始 init fixture 按设计不启用 hard guard，且不能绕过 verify / deploy / smoke 门禁直接 launch；因此拆分为 init fixture（真实插件安装）与 adopted launched fixture（SessionStart、Write、hard deny、sync / launch）。
4. 首次拆分后 `sync-launch` driver 又对已 adopted 目录重复执行 adopt，被 CLI 正确拒绝；修复为复用现有 adopted fixture 后，retry5 8/8 PASS。
5. 每次失败均继续执行安全回滚。最终演练卸载 staging 的 local Qoder plugin，在隔离 npm prefix 安装上一 tarball并确认 CLI 精确恢复为 `0.13.24`；未覆盖真实用户工作区、全局 Qoder settings 或未知 owner 插件。

## 五、证据索引与后续门禁

- 最终聚焦 reporter：`logos/resources/verify/smoke-results.jsonl` 中 2026-08-25T03:45:55Z～03:47:49Z 的 SMOKE-core-108～115，8/8 PASS。
- 最终证据目录：`logos/resources/verify/evidence/qoder-adapter-foundation-staging-20260824-retry5/`。
- `tarball.json`：候选包、CLI 与 Qoder 路径/版本；`install.json`：真实插件安装与资源发现；`inventory.json`：资源清单。
- `session-start.json`、`write.json`、`hard-deny.json`：真实模型会话、允许写入与 runtime exit 2 硬阻断证据；`sync-launch.json`：重复刷新幂等哈希；`rollback.json`：`0.13.24` 回滚与用户资产保持。
- 之前的额度、SessionStart 取证、initial hard-guard 与重复 adopt 失败证据分别保留在本提案 staging evidence 的初始、retry、retry2 / retry3 与 retry4 目录中。
- 部署完成已登记；正式 smoke 结果与修复闭环见下一节。

## 六、正式 smoke 修复闭环

1. 用户明确授权后执行首轮 `openlogos smoke --env staging --format json`：定义 85 项，执行 69 项，67 项通过、2 项失败、16 项未覆盖。`SMOKE-core-66` 缺少 0.13.25 回滚包，`SMOKE-core-69` 缺少 0.13.26 / 0.13.27 回滚恢复输入；Qoder 108～115 与 ZCode 100～107 未进入正式账本。
2. 0.13.25 回滚包继续使用只读历史制品，SHA-256 为 `7a6d7053dc3b11df69f86d01e25367ebc06fba9c447cf85a8daec705a2f2cade`。从对应历史提交 `33d61f0` 的只读快照重建 0.13.26 回滚包，版本精确为 `0.13.26`，SHA-256 为 `c3b1b454a5e10c4719ac7db3f5550ea8430d93ba1550290f4fcf799a0891f48b`；恢复包继续使用当前 0.13.27 候选制品，SHA-256 为 `4ac012469a28e669156233d8a567ea95eb392f719d816cb23d4fabfc4cee7434`。
3. 两个真实宿主 runner 原来只按提案 guard 激活，而正式 smoke 在隔离 sandbox 中还需要显式 staging 激活。修复为“匹配宿主提案或对应 `OPENLOGOS_*_STAGING=1`”后，Qoder / ZCode runner 定向回归 5/5 PASS；修复提交为 `df22fcc`。
4. 修复后重新执行 `openlogos verify`：1557/1557 执行，1547 通过、0 失败、10 跳过、0 未覆盖，覆盖率与通过率均 100%；随后受控执行 `openlogos deploy-done --env staging` 清理旧 `SMOKE_FAIL`。
5. 第二轮正式 smoke 的历史 1～69 已 69/69 PASS，但证据目录被错误设置为原工作区绝对路径，OS sandbox 写保护在 runner 首条 reporter 前正确阻断写入，因此 100～115 仍未覆盖。未降低沙箱强度；第三轮把证据写入隔离 `/private/tmp`，完成后机械镜像到项目 evidence 目录。
6. 第三轮正式 smoke：85/85 执行、85 通过、0 失败、0 跳过、0 未覆盖，覆盖率与通过率均为 100%，Gate 3.8 **PASS**。全局 `openlogos` 已恢复并核对为 `0.13.27`；`VERIFY_PASS`、`DEPLOY_DONE`、`SMOKE_PASS` 在场，`SMOKE_FAIL` 不在场。
7. Qoder 正式证据镜像：`logos/resources/verify/evidence/qoder-adapter-foundation-staging-20260824-retry5/formal-pass/`；ZCode 回归证据镜像：`logos/resources/verify/evidence/zcode-adapter-foundation-staging-20260824/formal-qoder-regression-pass/`。本轮未执行 archive、npm publish、Git tag、GitHub Release、官网/Cloudflare 部署或 `git push`。

---

# 部署报告：zcode-adapter-foundation / OpenLogos 0.13.27（2026-08-24）

## 一、部署摘要

- **模块 / 提案**：core / `zcode-adapter-foundation`。
- **授权依据**：提案 `VERIFY_PASS` 已落盘，用户明确授权推进 staging 部署与 smoke。
- **目标环境**：本机隔离 staging；真实 ZCode Desktop `3.8.1`、真实 ZCode CLI `0.16.3`、真实 npm tarball `0.13.27`。
- **staging 工作区**：`/private/tmp/openlogos-zcode-staging-workspace`。
- **结论**：真实 tarball 构建与隔离安装、ZCode marketplace 安装、插件发现、Hook 协议、既有宿主回归和回滚演练均 **PASS**；`SMOKE-core-100..107` 聚焦执行 8/8 PASS，正式 `openlogos smoke` 77/77 PASS。
- **明确边界**：未执行 `npm publish`、Git tag、GitHub Release、官网或 Cloudflare 部署、`git push`。

## 二、制品与运行环境

| 检查项 | 结果 |
|---|---|
| CLI 全量测试 | **PASS**：67 个测试文件、1830/1830 项通过 |
| 候选 tarball | `/private/tmp/openlogos-zcode-deploy.aBvd1j/miniidealab-openlogos-0.13.27.tgz` |
| 候选大小 | `1,445,112` 字节 |
| 候选 SHA-256 | `29641b5a1ad3a41b6f290eb96c8609723c2104ebae05f0effb9518f253ec1222` |
| 隔离 CLI | `0.13.27`；入口位于 tarball 隔离安装目录，未命中全局旧版本 |
| ZCode Desktop | `3.8.1`，已由用户截图确认真实客户端运行 |
| ZCode CLI | `0.16.3`；入口 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs` |
| 插件 identity | `openlogos@openlogos-staging`，启用状态为 `true`，版本 `0.13.27` |
| tarball 来源一致性 | **PASS**：fixture 生成的 manifest/runtime 与 ZCode 缓存安装件 SHA-256 一致 |

候选包已证明包含 `dist/index.js`、ZCode `.zcode-plugin/plugin.json`、`hooks/hooks.json`、`runtime/hook-runtime.js`、Skills、Commands、Agents 和所需规格。插件 marketplace 由候选 tarball 的隔离安装目录生成，不引用仓库 `plugin-zcode` 源目录。

## 三、真实 ZCode 发现与 Hook 验证

1. ZCode CLI 发现已启用插件 `openlogos@openlogos-staging`，并报告 18 个 Skills、10 个 Commands、1 个 Subagent 和 2 个 runnable Hooks。
2. `SessionStart` 在无 guard 与存在 guard 两种磁盘状态下均动态重读上下文，输出包含 `proposal_step` 与“下一确认点”。
3. `PreToolUse` 允许当前提案 delta 路径写入；目标文件实际写入并核对内容成功。
4. `PreToolUse` 对阶段外源码、项目根外路径和 symlink 逃逸三类目标均返回 `permissionDecision=deny` 与 exit `2`，目标哈希保持不变。
5. 连续两次 `sync` 与 `launch` 的第二次资产结果均为 `unchanged`；Claude Code、OpenCode、Codex、Cursor 的最小资产回归均在场。

聚焦 smoke 首轮为 7/8 PASS：`SMOKE-core-102` 因临时 driver 假定 command 对象含 `pluginName` 字段而误筛为空；真实 ZCode `commands list` 使用 `source=plugin` 与插件根路径标识。修正取证筛选后第二轮 8/8 PASS，未修改产品业务代码，也未掩盖首轮失败。

## 四、回滚演练

- 回滚包：`/Users/huangxianglong/Downloads/miniidealab-openlogos-0.13.24.tgz`。
- 回滚包 SHA-256：`dc5f41c682c3fa1463638b79ad3f14fcaec85f906f3c8ab9a780ce650c7e34cd`。
- 在独立 npm prefix 中真实安装回滚包，CLI 精确恢复为 `0.13.24`。
- 既有项目 `AGENTS.md` / `CLAUDE.md` 哈希保持不变；当前 staging ZCode 插件仍保持 `0.13.27`，证明回滚演练未破坏用户资产或正在验证的安装件。

## 五、证据索引

证据目录：`logos/resources/verify/evidence/zcode-adapter-foundation-staging-20260824/`。

- `tarball.json`：候选路径、大小、SHA-256、CLI 与 ZCode 版本。
- `install.json`：真实 ZCode 插件 identity、版本、启用状态与 tarball 来源哈希。
- `inventory.json`：Skills、Commands、Agent 与 Hooks 清单。
- `session-start.json`、`write.json`、`hard-deny.json`：上下文、允许写入与 exit 2 硬阻断原始结果。
- `sync-launch.json`：重复刷新幂等证据。
- `rollback.json`：`0.13.24` 回滚安装与用户资产保持证据。
- `focused-smoke-results.jsonl`：`SMOKE-core-100..107` 第二轮 8/8 PASS reporter。
- `zcode-staging-driver.mjs`：本次真实 ZCode CLI 取证桥接脚本快照。
- `formal/`：正式 `openlogos smoke` 中再次执行 ZCode staging runner 生成的原始证据。

## 六、部署门禁结论

staging 部署与正式 smoke 均已完成。`DEPLOY_DONE`、`SMOKE_PASS` 在场，`VERIFY_FAIL`、`SMOKE_FAIL` 不在场；OpenLogos 当前已满足归档前置门禁。本轮没有执行 archive 或任何公开发布动作。

## 七、正式 smoke 修复闭环

1. 首轮正式 `openlogos smoke --format json` 执行 77 项，60 项通过、17 项失败、0 项未覆盖。`SMOKE-core-100..107` 首轮均已通过。
2. 其中 16 项失败同源于 `build-zcode-template.mjs` 把诊断文字写入 stdout，污染历史 runner 对 `npm pack --json` 的解析；修复为写入 stderr 后，`npm pack --json` 可直接解析。
3. 修复后候选 tarball 大小和 SHA-256 均保持不变，仍为 `1,445,112` 字节与 `29641b5a1ad3a41b6f290eb96c8609723c2104ebae05f0effb9518f253ec1222`；CLI 全量测试再次 1830/1830 PASS。
4. 剩余 `SMOKE-core-66` 失败是缺少历史 `0.13.25` 回滚包。从提交 `7fc35a6074188cb1232fe857d0b7cfe6a87f3331` 的只读快照重建真实 tarball，路径 `/private/tmp/openlogos-rollback-0.13.25.8HD5s9/artifacts/miniidealab-openlogos-0.13.25.tgz`，SHA-256 为 `7a6d7053dc3b11df69f86d01e25367ebc06fba9c447cf85a8daec705a2f2cade`。
5. 修复后重新执行 `openlogos verify`：1507/1507 执行、1497 通过、10 跳过、0 失败、覆盖率与通过率均 100%。随后重新执行 `openlogos deploy-done --env staging`，受控清除首轮 `SMOKE_FAIL` 并恢复 `ready-to-smoke`。
6. 第二轮正式 smoke：77/77 执行、77 通过、0 失败、0 跳过、0 未覆盖，覆盖率与通过率均为 100%，Gate 3.8 **PASS**。

---

# 部署报告：fix-scenario-create-completeness-contract / OpenLogos 0.13.27（2026-08-16）

## 一、部署摘要

- **模块 / 提案**：core / `fix-scenario-create-completeness-contract`。
- **授权依据**：本提案 `VERIFY_PASS` 已落盘，用户明确要求打开任务列表并执行本提案的部署任务。
- **目标环境**：当前开发机 npm 全局环境；命令入口 `/opt/homebrew/bin/openlogos`，全局 prefix `/opt/homebrew`。
- **部署时间**：2026-08-16T21:13:54-0700 至 2026-08-16T21:16:06-0700。
- **版本变化**：全局 `@miniidealab/openlogos` 从 `0.13.26` 升级到 `0.13.27`。
- **结论**：本地全局部署、安装态 SMOKE-core-67～69 与正式 `openlogos smoke` 均 **PASS**；未执行 npm publish、Git tag、GitHub Release、官网部署、远端部署、archive 或 git push。

## 二、部署前检查

| 检查项 | 结果 |
|---|---|
| `VERIFY_PASS` | **PASS**：`fix-scenario-create-completeness-contract/VERIFY_PASS` 在场 |
| `[code]` 切片 | **PASS**：1/1 已完成 |
| 安装前命令 / 版本 | `/opt/homebrew/bin/openlogos` / `0.13.26` |
| 环境 | Node `v23.10.0`；npm `10.9.2`；全局根 `/opt/homebrew/lib/node_modules` |
| CLI 全量测试 | **PASS**：63 个测试文件，1778/1778 项通过 |
| TypeScript 构建 | **PASS**：`npm run build` 退出码 0 |
| `npm pack --dry-run` | **PASS**：版本 `0.13.27`，408 个文件，未发现提案状态、guard、测试结果或凭据 |

## 三、候选包与回滚包

候选包：

- 路径：`/private/tmp/openlogos-local-deploy-0.13.27.NxvfrV/candidate/miniidealab-openlogos-0.13.27.tgz`
- SHA-256：`ce28568a551cc72008f99d7322525add6639a4ecff2575557dfd7e8e02883efd`
- 包内版本：CLI、Claude 插件元数据、Codex 插件元数据均为 `0.13.27`
- 包内关键资产：`spec/baseline-closure.md`、`spec/change-management.md`、`skills/change-writer/SKILL.md`、`skills/scenario-architect/SKILL.md` 均在场

回滚包：

- 路径：`/private/tmp/openlogos-local-deploy-0.13.26.fCmSmo/candidate/miniidealab-openlogos-0.13.26.tgz`
- SHA-256：`544d5fc31bdafe135a8980c9ee2cb283b4c1911d8ec52ee64586e4b4c85c5f5a`
- 回滚命令：`npm install -g /private/tmp/openlogos-local-deploy-0.13.26.fCmSmo/candidate/miniidealab-openlogos-0.13.26.tgz`
- 回滚后核对：新 shell 中 `command -v openlogos` 应为 `/opt/homebrew/bin/openlogos`，`openlogos --version` 应精确返回 `0.13.26`

## 四、全局安装与安装后核对

| 动作 / 检查 | 结果 |
|---|---|
| `npm install -g <0.13.27 candidate tarball>` | **PASS**：14 个包完成更新 |
| 重新解析命令 | **PASS**：`/opt/homebrew/bin/openlogos` |
| `openlogos --version` | **PASS**：精确返回 `0.13.27` |
| 全局 package / Claude / Codex 版本 | **PASS**：均为 `0.13.27` |
| baseline closure / change management 规格与两个 Skill | **PASS**：均来自本次安装包 |
| 数据迁移 / 服务重启 | 不适用：无业务数据迁移、无常驻服务 |

## 五、安装态 smoke 与回滚演练

1. `SMOKE-core-67` **PASS**：全局命令路径位于 npm prefix，CLI/package/plugin 版本和四项合同资产一致。
2. `SMOKE-core-68` **PASS**：六种合法步骤标题全部通过；散文/围栏伪命中、不足三步、伪 Mermaid、空异常与空追溯全部 fail-closed，且 change-lint 保持只读。
3. `SMOKE-core-69` **PASS**：缺步骤的 change-lint exit 2、merge 非零且项目字节不变；真实安装 0.13.26 回滚包后版本与路径精确恢复，再安装同一 0.13.27 候选包恢复成功。
4. reporter 已将三项结果写入 `logos/resources/verify/smoke-results.jsonl`，最终全局版本为 `0.13.27`。

## 六、边界与后续门禁

1. 本轮仅执行当前开发机的 npm 全局部署；无公开发布、远端部署或数据迁移。
2. 部署完成状态必须由 `openlogos deploy-done` 受控写入，不手写 `DEPLOY_DONE`。
3. 正式 `openlogos smoke` 已在独立授权后执行并 PASS；archive 仍是下一独立人类确认点。
4. 未解决风险：无已知部署或 smoke 阻塞；sandbox 继续按兼容模式报告构建产物写入告警，不影响本次 Gate 结果。

## 七、正式 smoke 修复闭环

1. 首轮 `openlogos smoke --format json` 执行 69 项，67 项通过；`SMOKE-core-59` 与 `SMOKE-core-62` 因历史 runner 把安装版本分别固定为 0.13.26 和 0.13.26，而当前安装版本为 0.13.27，Gate 返回 FAIL。本提案新增的 `SMOKE-core-67`～`SMOKE-core-69` 首轮已全部通过。
2. 预检同时识别到历史 `SMOKE-core-66` 与新 `SMOKE-core-69` 共用 `OPENLOGOS_ROLLBACK_*` 但要求不同回滚版本；S39 runner 已改用 `OPENLOGOS_S39_*` 专用输入并保留旧变量回退兼容，修复提交为 `888ecaf`。
3. 历史安装版本断言已改为读取当前 `cli/package.json`，只放宽跨 patch 的运行版本来源；`SMOKE-core-66` 对 0.13.25 回滚包及 `SMOKE-core-69` 对 0.13.26 回滚包的精确版本和哈希断言保持不变。前向兼容修复提交为 `1548f04`。
4. 修复后定向回归通过，`openlogos verify` 再次 PASS（1458 通过、0 失败、10 跳过，覆盖率与通过率 100%），smoke 覆盖预检 PASS。
5. 重新安装同一确定性 0.13.27 制品，SHA-256 仍为 `ce28568a551cc72008f99d7322525add6639a4ecff2575557dfd7e8e02883efd`；`openlogos deploy-done` 清理首轮 `SMOKE_FAIL` 并恢复 `ready-to-smoke`。
6. 第二轮正式 smoke：69/69 执行、69 通过、0 失败、0 跳过、0 未覆盖，覆盖率与通过率均为 100%，Gate 3.8 **PASS**。

---

# 部署报告：make-verify-slice-aware / OpenLogos 0.13.26（2026-08-16）

## 一、部署摘要

- **模块 / 提案**：core / `make-verify-slice-aware`。
- **授权依据**：用户在 `VERIFY_PASS` 落盘后明确要求执行本提案部署任务，并授权部署完成后持续执行 smoke、失败修复、重新部署与重试。
- **目标环境**：当前开发机 npm 全局环境；命令入口 `/opt/homebrew/bin/openlogos`，全局 prefix `/opt/homebrew`。
- **部署时间**：2026-08-16T07:17:55Z 至 2026-08-16T07:18:59Z。
- **版本变化**：全局 `@miniidealab/openlogos` 从 `0.13.25` 升级到 `0.13.26`。
- **结论**：本地全局部署与部署后 smoke 均 **PASS**；未执行 npm publish、Git tag、GitHub Release、官网部署、远端部署或 git push。

## 二、部署前检查

| 检查项 | 结果 |
|---|---|
| `VERIFY_PASS` | **PASS**：`make-verify-slice-aware/VERIFY_PASS` 在场 |
| `[code]` 切片 | **PASS**：5/5 已完成 |
| 安装前命令 / 版本 | `/opt/homebrew/bin/openlogos` / `0.13.25` |
| 环境 | Node `v23.10.0`；npm `10.9.2`；全局根 `/opt/homebrew/lib/node_modules` |
| CLI 全量测试 | **PASS**：63 个测试文件，1770/1770 项通过 |
| TypeScript 构建 | **PASS**：`npm run build` 退出码 0 |
| `npm pack --dry-run` | **PASS**：版本 `0.13.26`，408 个文件，未发现提案状态、guard、测试结果或凭据 |

## 三、候选包与回滚包

候选包：

- 路径：`/private/tmp/openlogos-local-deploy-0.13.26.fCmSmo/candidate/miniidealab-openlogos-0.13.26.tgz`
- SHA-256：`544d5fc31bdafe135a8980c9ee2cb283b4c1911d8ec52ee64586e4b4c85c5f5a`
- 包内版本：CLI `0.13.26`，Claude 插件元数据 `0.13.26`
- 包内关键资产：`dist/index.js`、`skills/slice-planner/SKILL.md`、`spec/test-slice-manifest.md`、`spec/schema/status.schema.json`、`spec/schema/next.schema.json`、`spec/schema/verify.schema.json` 均在场

回滚包：

- 路径：`/private/tmp/openlogos-local-deploy-0.13.26.fCmSmo/rollback/miniidealab-openlogos-0.13.25.tgz`
- SHA-256：`137f0dfdfa0f6785ecd7fb5d97125b1e7d7f6da70a9c9fee7139b002aeaf8d82`
- 回滚命令：`npm install -g /private/tmp/openlogos-local-deploy-0.13.26.fCmSmo/rollback/miniidealab-openlogos-0.13.25.tgz`
- 回滚后核对：新 shell 中 `command -v openlogos` 应为 `/opt/homebrew/bin/openlogos`，`openlogos --version` 应精确返回 `0.13.25`

## 四、全局安装与安装后核对

| 动作 / 检查 | 结果 |
|---|---|
| `npm install -g <0.13.26 candidate tarball>` | **PASS**：14 个包完成更新 |
| 重新解析命令 | **PASS**：`/opt/homebrew/bin/openlogos` |
| `openlogos --version` | **PASS**：精确返回 `0.13.26` |
| 全局包 / 插件版本 | **PASS**：均为 `0.13.26` |
| 切片 Skill / 规范 / 三份 JSON Schema | **PASS**：均来自本次安装包 |
| 数据迁移 / 服务重启 | 不适用：无业务数据迁移、无常驻服务 |

## 五、边界与后续门禁

1. 本轮只执行本机 npm 全局安装；公开发布与远端动作均未授权、未执行。
2. 部署完成状态由 `openlogos deploy-done` 受控写入，不手写 `DEPLOY_DONE`。
3. 部署后已按用户本轮明确授权执行 `openlogos smoke`，最终 Gate 3.8 PASS；本提案已到达可归档前沿，但本轮未执行 archive。

## 六、部署后 smoke 与修复闭环

1. 首轮 `openlogos smoke --format json` 执行 66 项：65 项通过，`SMOKE-core-66` 失败。失败摘要为 smoke runner 未收到已保存的 `0.13.25` 回滚包路径，因而按默认值在沙箱工作区根目录查找 `miniidealab-openlogos-0.13.25.tgz`。
2. 根因是部署输入未传递，不是 `0.13.26` 候选包运行时失败。runner 已声明支持 `OPENLOGOS_ROLLBACK_TARBALL` 与 `OPENLOGOS_ROLLBACK_SHA256`；修复时显式传入本报告第三节记录的回滚包绝对路径与 SHA-256。
3. 按用户授权重新安装同一候选 tarball；安装后命令路径仍为 `/opt/homebrew/bin/openlogos`，版本仍精确为 `0.13.26`，候选 SHA-256 仍为 `544d5fc31bdafe135a8980c9ee2cb283b4c1911d8ec52ee64586e4b4c85c5f5a`。
4. 第二轮 `openlogos smoke --format json`：66/66 执行、66 通过、0 失败、0 跳过、0 未覆盖，覆盖率与通过率均为 100%，Gate 3.8 **PASS**。
5. `SMOKE-core-62`～`SMOKE-core-66` 全部通过；其中 `SMOKE-core-66` 已在隔离 npm prefix 中真实安装回滚包并确认版本精确恢复为 `0.13.25`，未改写当前全局 `0.13.26`。

---

# 部署报告：plan-decision-clarification / OpenLogos 0.13.25（2026-08-15）

## 一、部署摘要

- **模块 / 提案**：core / `plan-decision-clarification`。
- **授权依据**：`openlogos next --auto` 已对 `deliver-entry` 放行；`GATE_AUTO_PASSED` 中存在 `gate_id=deliver-entry`，时间为 `2026-08-15T04:43:46.916Z`。
- **目标环境**：当前开发机 npm 全局环境；命令入口 `/opt/homebrew/bin/openlogos`。
- **部署时间**：2026-08-15T04:44:58Z 至 2026-08-15T04:46:19Z。
- **版本变化**：全局 `@miniidealab/openlogos` 从 `0.13.24` 升级到 `0.13.25`。
- **结论**：本地全局部署 **PASS**；未执行 smoke、archive、launch、npm publish、tag、GitHub Release、官网部署或 git push。

## 二、部署前检查

| 检查项 | 结果 |
|---|---|
| `VERIFY_PASS` | **PASS**：提案 marker 在场 |
| 版本一致性 | **PASS**：`cli/package.json`、插件元数据与 `CHANGELOG.md` 均为 `0.13.25` |
| TypeScript 构建 | **PASS**：`npm run build` 退出码 0 |
| CLI 全量测试 | **PASS**：61 个测试文件，1752/1752 项通过 |
| Website reporter 测试 | **PASS**：3/3 项通过 |
| `npm pack --dry-run` | **PASS**：版本 `0.13.25`，402 个文件 |
| 安装前命令 | `/opt/homebrew/bin/openlogos`，版本 `0.13.24` |
| 环境 | Node `v23.10.0`；npm `10.9.2`；全局根 `/opt/homebrew/lib/node_modules` |

## 三、候选包与回滚包

候选包：

- 路径：`/private/tmp/openlogos-local-deploy-0.13.25.43Z3sO/candidate/miniidealab-openlogos-0.13.25.tgz`
- SHA-256：`137f0dfdfa0f6785ecd7fb5d97125b1e7d7f6da70a9c9fee7139b002aeaf8d82`
- 包内版本：CLI `0.13.25`，Claude 插件元数据 `0.13.25`
- 包内关键资产：`dist/index.js`、`spec/schema/status.schema.json`、`spec/schema/next.schema.json`、`skills/change-writer/SKILL.md` 均在场

回滚包：

- 来源：npm registry 的 `@miniidealab/openlogos@0.13.24` 官方 tarball
- 路径：`/private/tmp/openlogos-local-deploy-0.13.25.43Z3sO/rollback/miniidealab-openlogos-0.13.24.tgz`
- SHA-256：`80c0ea7945632105634e285186acfaef875a89ff7748406c1a9c9cb5512fdf79`
- 包内版本：`0.13.24`
- 回滚命令：`npm install -g /private/tmp/openlogos-local-deploy-0.13.25.43Z3sO/rollback/miniidealab-openlogos-0.13.24.tgz`
- 回滚后核对：重新解析命令并确认 `openlogos --version` 返回 `0.13.24`

## 四、全局安装与安装后核对

| 动作 / 检查 | 结果 |
|---|---|
| `npm install -g <0.13.25 candidate tarball>` | **PASS**：14 个包完成更新 |
| 重新解析命令 | **PASS**：`/opt/homebrew/bin/openlogos` |
| `openlogos --version` | **PASS**：精确返回 `0.13.25` |
| 全局包 / 插件版本 | **PASS**：均为 `0.13.25` |
| 两份 JSON Schema | **PASS**：status / next 均来自本次安装包 |
| change-writer Skill | **PASS**：随包在场 |
| 本轮修复 | **PASS**：全局运行时代码含 pending 模板、占位理由保护与重复 YAML 围栏保护 |

本次仅替换本机 npm 全局 CLI，无数据库或配置迁移，无常驻服务需要重启。

## 五、边界与后续门禁

1. 本工作单元未运行 `openlogos smoke`；`SMOKE-core-59`～`SMOKE-core-61` 留给独立 smoke 门禁。
2. 未运行 `openlogos archive` 或 `openlogos launch`。
3. 未创建或推送 tag，未执行 npm publish、GitHub Release、官网部署或 git push。
4. 本地全局部署成功后由 `openlogos deploy-done` 受控勾选 `[deploy]` 任务并写 `DEPLOY_DONE`；不得手写 marker。

---

# 部署报告：baseline-on-touch / OpenLogos 0.13.24（2026-08-10）

## 一、部署摘要

- **部署范围**：仅本机全局 npm；未部署服务器端。
- **候选来源**：仓库提交 `3e7af96`，`cli/package.json`、`cli/package-lock.json` 与插件清单均已是 `0.13.24`，因此无需修改源码或版本文件。
- **部署时间**：2026-08-10T21:18:54-07:00。
- **升级结果**：本机全局 `@miniidealab/openlogos` 已由 `0.13.23` 升级到 `0.13.24`。
- **命令入口**：`/opt/homebrew/bin/openlogos`。
- **结论**：本机全局部署 **PASS**；服务器端与公开发布链路均未执行。

## 二、发布前校验

| 检查项 | 结果 |
|---|---|
| 已归档提案的 `VERIFY_PASS` | **PASS** |
| CLI 全量测试 | **PASS**：60 个测试文件，1701/1701 用例通过 |
| TypeScript 构建 | **PASS**：`npm run build` 退出码 0 |
| 本地候选打包 | **PASS**：`miniidealab-openlogos-0.13.24.tgz`，398 个文件 |
| 包版本与内容 | **PASS**：包版本为 `0.13.24`；闭包判定器、Markdown 扫描器、`change-lint`、`merge-apply`、闭包规格、Skills 与三类插件模板均在包内 |

候选包：

- 路径：`/private/tmp/openlogos-local-deploy-0.13.24.N74XW7/candidate/miniidealab-openlogos-0.13.24.tgz`
- SHA-256：`dc5f41c682c3fa1463638b79ad3f14fcaec85f906f3c8ab9a780ce650c7e34cd`

## 三、本机部署与安装后检查

| 动作 | 结果 |
|---|---|
| `npm install -g <本地 0.13.24 tarball>` | **PASS** |
| `command -v openlogos` | `/opt/homebrew/bin/openlogos` |
| `openlogos --version` | `0.13.24` |
| 全局 npm 包版本 | `@miniidealab/openlogos@0.13.24` |
| 关键文件存在性 | **PASS**：`baseline-closure.js`、`markdown-scan.js`、`change-lint.js`、`merge-apply.js`、闭包规格、Skills 与插件模板均存在 |
| 命令可发现性 | **PASS**：`adopt`、`baseline-seed`、`change-lint`、`merge-apply` 均出现在全局 CLI 帮助中 |

本版本无数据库迁移、无常驻服务，也未改动任何项目源码。

## 四、回滚点

- 部署前版本：`0.13.23`。
- 回滚包：`/private/tmp/openlogos-local-deploy-0.13.24.N74XW7/rollback/miniidealab-openlogos-0.13.23.tgz`。
- 回滚包 SHA-256：`4bed5c40b3f998021f7f359ac6e858df15f37457a7ad9777937ffaef1784df66`。
- 回滚命令：`npm install -g /private/tmp/openlogos-local-deploy-0.13.24.N74XW7/rollback/miniidealab-openlogos-0.13.23.tgz`。
- 回滚后校验：`openlogos --version` 应恢复为 `0.13.23`。

## 五、明确未执行的动作

1. 未部署任何服务器端、Cloudflare Pages 或官网资源。
2. 未执行 `npm publish`、创建或推送 tag、GitHub Actions、GitHub Release、`git push`。
3. 未执行 `openlogos smoke`；本轮授权范围是本机全局部署，smoke 仍保留为独立确认点。
4. 未执行 `openlogos deploy-done`；`baseline-on-touch` 已归档，归档提案及其 `[deploy]` 任务保持只读。
5. 工作区既有的 `website/` 字体与发布数据未被本次部署修改或纳入操作。

---

# 部署报告：release-0-13-21（2026-08-02）

## 一、部署摘要

- **模块 / 提案**：core / `release-0-13-21`
- **授权依据**：用户明确授权只在本机全局安装并生成供 Windows 验收的 npm `.tgz`，同时明确禁止 npm/GitHub 发布与 `git push`
- **部署时间**：2026-08-02T01:43:06Z
- **目标环境**：本机全局 npm（`/opt/homebrew/bin/openlogos`）；Windows 验收机由用户后续手工安装
- **前置门**：`VERIFY_PASS` 在场；1113/1113 用例通过，覆盖率与通过率均为 100%；`tasks.md` 的 `[code]` 已全部完成
- **结论**：本机部署成功，`openlogos --version` 为 `0.13.21`

## 二、执行命令摘要

| 步骤 | 命令 / 动作 | 结果 |
|---|---|---|
| 回滚包留存 | 从官方 registry 获取 `@miniidealab/openlogos@0.13.20` tarball 到 `cli/rollback/` | **PASS**；SHA-1 `787c4dd57dff8f9c6ad3844141f00c4fa8195bf5` 与 registry 一致 |
| 构建与打包 | `cd cli && npm run build && npm pack` | **PASS**；生成 `miniidealab-openlogos-0.13.21.tgz`，372 个文件 |
| 包内容核验 | 校验包版本、路径安全、CLI 入口、Windows watcher、规格、Skills 与三类插件模板 | **PASS**；缺失 0、危险路径 0 |
| 本机全局安装 | `npm install -g <0.13.21 tarball>` | **PASS**；全局包更新为 `@miniidealab/openlogos@0.13.21` |
| 安装后检查 | `openlogos --version`、`openlogos --help`、全局包必需文件检查 | **PASS** |

## 三、Windows 验收包

- **文件**：`cli/miniidealab-openlogos-0.13.21.tgz`
- **SHA-256**：`58302f83423640c14002749bead6175bfd98c103543ca6cebfe4d778b0b5877a`
- **包版本**：`0.13.21`
- **文件数**：372
- **关键内容**：`dist/index.js`、`dist/lib/archive-watch.js`、`spec/schema/*.schema.json`、`skills/`、`claude-plugin-template/`、`opencode-plugin-template/`、`codex-plugin-template/`
- **Windows 安装命令**：`npm install -g .\miniidealab-openlogos-0.13.21.tgz`

## 四、迁移与服务状态

- 无数据库或配置迁移。
- CLI 无常驻服务；安装后的命令入口与帮助输出均正常。
- 本次未创建 tag、未执行 `npm publish`、未创建 GitHub Release、未部署官网、未执行 `git push`。

## 五、回滚点

- **官方回滚包**：`cli/rollback/miniidealab-openlogos-0.13.20.tgz`
- **回滚命令**：`npm install -g /Users/huangxianglong/gitlab/openlogos/cli/rollback/miniidealab-openlogos-0.13.20.tgz`
- 回滚后应运行 `openlogos --version`，预期恢复为 `0.13.20`。
- 本次无数据迁移，回滚无需清理项目状态文件。

## 六、验收结论与环境备注

1. Windows 原生 watcher 句柄与目录 rename 端到端验证已由用户在目标环境完成，并于 2026-08-02 明确确认验收通过。
2. `openlogos smoke` 已完成：53/53 用例通过，覆盖率与通过率均为 100%，Gate 3.8 为 PASS，`SMOKE_PASS` 已落盘。
3. 本机 npm 默认镜像缓存查询 0.13.20 时出现缺失缓存文件的 `ENOENT`；本次通过独立临时缓存和官方 registry 完成校验与安装，未修改用户默认缓存。若后续默认 npm 查询仍失败，可单独执行缓存诊断。
4. `cli/` 根目录既有的另一个 `miniidealab-openlogos-0.13.20.tgz` 与官方发布包 SHA-1 不同，未覆盖；本次回滚只认 `cli/rollback/` 中已校验的官方包。

---

# 部署报告 — proposal-ui-ux-first

## 部署时间
- 2026-07-11T03:28:34-0700

## 基本信息
- **模块 / 提案**：core / proposal-ui-ux-first
- **授权依据**：`openlogos next --auto` 对 `deliver-entry` 门 `gate_auto_passed=true`（standing run-scoped 授权）
- **目标环境**：测试 / staging（本地构建 + 打包验证产物）。生产 npm 发布与 Cloudflare Pages 部署为人类确认点，本单元**未执行**（见「未解决风险 / 待人类确认」）。
- **前置条件**：`VERIFY_PASS` 存在 ✓；`tasks.md` 含 `[deploy]` section ✓；proposal 声明 `是否需要部署：是` ✓。

## 一、执行命令摘要（部署方案 §四 构建与打包链）

| 命令 | 目的 | 影响环境 | 结果 |
|---|---|---|---|
| `cd cli && npm run build`（tsc） | 编译 CLI 运行时（含新增 check-ui-prototype / check-ui-hash-match / ui-provenance / ui-first） | 本地构建 | **PASS**（exit 0） |
| `cd cli && npm test`（verify 预跑覆盖） | 全量回归（38 文件 / 1213 用例） | 本地测试 | **PASS**（VERIFY_PASS 已落） |
| `cd cli && npm pack --dry-run` | 校验随包分发内容完整（prepack 打包 skills/ spec/ 三套插件模板） | 本地打包验证 | **PASS**（312 文件 / 838.8 kB / 解包 3.3 MB） |

## 二、随包交付内容核验（本提案关键产物均已进入 npm tarball）

- `spec/proposal-ui-ux-first.md`（新增核心契约，55.9 kB）✓
- `spec/flow/overlays/gui-ui-first.yaml`（GUI overlay 真实资产，两个 op:add）✓
- `spec/logos-project.md`（`modules[].product_type` 字段）✓
- `dist/commands/check-ui-prototype.js`、`dist/commands/check-ui-hash-match.js`（新增 CLI 子命令）✓
- `dist/lib/ui-provenance.js`、`dist/lib/ui-first.js`（provenance/hash 完整性 + 能力门 + overlay 装配）✓
- `claude-plugin-template/bin/guard-check`（plan 阶段写入 allowlist）、`.../openlogos-phase`（capabilities + writing 例外 + mktemp 修复）✓
- `codex-plugin-template/session-start.sh`（capabilities + writing 例外）✓
- 变更 skills：`change-writer` / `merge-executor` / `product-designer` SKILL ✓

## 三、迁移结果
无业务数据库迁移（部署方案 §五）。`product_type` 为模块级配置字段，存量项目经 `openlogos module set-product-type` 幂等回填，无自动数据迁移。

## 四、服务启动结果
本提案交付物为 npm 包 + 随包分发的 spec/skills/插件模板；无常驻服务。CLI 构建产物 `cli/dist/` 就绪，`openlogos check-ui-prototype` / `check-ui-hash-match` 子命令已注册并可执行（smoke runner 已独立验证 SMOKE-core-38..43 全 pass）。

## 五、回滚点（部署方案 §六）
- npm：通过发布补丁版本回滚；本单元未发布，无需回滚。
- 官网：Cloudflare Pages 回滚到上一部署（本单元未部署官网）。
- 插件模板：随 npm 包版本回滚。
- 事务落盘 / journal 崩溃恢复为提案局部行为，回滚 CLI 不删除用户提案文件。

## 六、未解决风险 / 待人类确认（未执行的生产动作）
1. **生产 npm 发布（tag 驱动）未执行**：按部署方案 §四/§十，正式发布需更新 `cli/package.json`（当前 0.13.6）、`plugin/.claude-plugin/plugin.json`、`CHANGELOG.md` 并推送 `vX.Y.Z` tag 触发 GitHub Actions npm publish + GitHub Release。此属「发布 / 生产」动作，按 deployment-executor skill 禁止行为**不自动执行**，保留为人类确认点。
2. **Cloudflare Pages 官网部署未执行**：本提案无 `website/src` 内容变更（仅 CLI/spec/skills），官网无需随本提案变更；且官网自动部署凭据当前失效（长期挂），如需发布须人工处理密钥。
3. 本次为测试 / staging 目标的构建 + 打包验证，产物完整、可交付；生产发布由人类在确认版本号与变更日志后触发 tag。

## 七、结论
测试 / staging 目标部署（构建 + 打包验证）**成功**：所有本提案变更均已正确编译并进入随包分发产物，可交付给 runlogos 等消费方（经生产发布后）。生产 npm 发布与官网部署为人类确认点，未在本自动单元执行。

---

# 部署报告：contract-self-description（2026-07-17）

## 一、部署摘要
- 目标：本地全局（测试/staging 目标）；生产 npm 发布保留人类确认点。
- 动作：`cd cli && npm test`（1391/1391 绿）→ `npm run build` → `npm pack` → 包内容验证 → `npm install -g <tarball>`。
- 全局 CLI 版本：0.13.7（含本提案全部构建产物；上一全局版本 0.13.7 旧构建，回滚 = 重装旧 tarball 或发布版）。

## 二、随包交付内容核验
- `spec/schema/status.schema.json` / `next.schema.json`（x-contract-version 1.0.0、$id 版本段一致）✓
- `spec/flow/initial.yaml` / `launched.yaml`（逐节点 dispatch 声明 + 顶层 defaults）✓
- `dist/lib/step-registry.js`（唯一铸造点 + mintStep）、`dist/lib/timestamp.js`（严格 RFC 3339 全精度）✓
- status/next/verify/flow 派生链新契约行为（contract/step_meta/facts/dispatch/loop_state 收紧/去重全序）✓

## 三、部署后即时验证（全局 CLI 实机）
临时 launched fixture 实测 `openlogos status --format json`：
`data.contract == {"version":"1.0.0"}`；`active_change.step_meta == {phase:"pre-implement",...}`；`facts` 六布尔在场；**pre-implement 驻留态 `loop_state` 缺席（C2 生效）**。

## 四、迁移与服务
无数据迁移；无常驻服务。结构化 `SLICES_APPROVED` 对旧版仅存在性判断，无需迁移。

## 五、回滚预案（部署方案 §二十）
回装上一版本 tarball / 发布版即可；契约新增字段对旧消费方向后兼容；`loop_state` 缺席语义现役 driver 本就处理（runlogos S48 EX-48.9）。

## 六、未执行的生产动作（人类确认点）
1. 生产 npm 发布（版本号 bump + CHANGELOG + tag 触发 publish/Release）未执行——契约大版本发布需人类确认版本策略（含 contract 1.0.0 首发的 major bump 决策）。
2. 官网部署未涉及（本提案无 website 变更；Cloudflare 凭据长期失效，另行处理）。

## 七、结论
本地全局部署**成功**，发布前检查全绿、包内容与契约版本验证通过、部署后即时验证符合 C1-C7 预期。后续 `openlogos smoke` 按流程另行授权执行。

---

# 部署报告：change-lint-shift-left（2026-07-22）

## 一、部署摘要
- **模块 / 提案**：core / change-lint-shift-left
- **授权依据**：`--auto` 对 deliver 门的 standing 授权（`GATE_AUTO_PASSED` 含 `deliver-entry`，`gate_auto_passed=true`）
- **目标环境**：本机全局（测试目标）；公开 npm 发布沿 tag 链路，保留人类确认点，本单元未执行。
- **前置条件**：`VERIFY_PASS` 存在 ✓；`tasks.md` 含 `[deploy]` section（3 项）✓；proposal 声明需要部署 ✓。
- **执行链路**：部署方案 §二十一（change-lint 发布检查）本地链路。

## 二、执行命令摘要（§二十一）

| 步骤 | 命令 / 动作 | 结果 |
|---|---|---|
| 版本递增 | `cli/package.json` version `0.13.14` → `0.13.15`（patch +1，major.minor 不动） | **PASS** |
| 构建打包 | `cd cli && npm run build && npm pack` | **PASS**（tarball `miniidealab-openlogos-0.13.15.tgz`，368 文件） |
| 产物核验 | `dist/index.js` 可 grep 到 `change-lint` 命令注册 | **PASS**（4 处命中） |
| 回滚来源留存 | 上一版 tarball `cli/miniidealab-openlogos-0.13.14.tgz` 在本地留存 | **PASS** |
| 全局安装 | `npm install -g ./miniidealab-openlogos-0.13.15.tgz` | **PASS** |
| 版本一致性校验 | `openlogos --version` == `0.13.15` == `cli/package.json` | **PASS** |
| 可发现性即时验证 | 已部署全局 `openlogos --help` 收录 `change-lint` | **PASS** |

## 三、随包交付内容核验
- `dist/commands/change-lint.js`、`dist/lib/change-lint.js`、`dist/lib/delta-classify.js`、`dist/lib/markdown-scan.js`（S35 新增命令与共享判据层）✓
- 变更 skills：`change-writer` / `slice-planner` SKILL 随 prepack 打入 ✓
- `spec/cli-json-output.md` / `spec/change-management.md`（§3.15 envelope 契约与流程规格）随包 ✓

## 四、迁移与服务
无数据迁移（change-lint 为纯增量只读命令）；无常驻服务。

## 五、回滚预案（§二十一 失败处理与回滚）
`npm install -g cli/miniidealab-openlogos-0.13.14.tgz` 回装上一版；lint 为只读命令，回滚零数据副作用、零迁移；回滚后复核 `openlogos --version` 恢复 `0.13.14`。

## 六、未执行的动作
1. 公开 npm 发布（tag → GitHub Actions publish + Release）：人类确认点，未执行。
2. `openlogos smoke`（SMOKE-core-51…53 部署后冒烟）：本工作单元仅部署，smoke 按流程另行授权执行。
3. 官网部署：本提案无 website 变更，不涉及。

## 七、结论
本机全局部署**成功**：0.13.15 已构建、打包、安装，版本一致性与命令可发现性即时验证通过，回滚 tarball 已留存。

---

# 部署报告：drop-baseline-confirmation（2026-07-24）

## 一、部署摘要
- **模块 / 提案**：core / drop-baseline-confirmation（删除逆向基线人工确认机制）
- **授权依据**：`openlogos next --auto` 对 `deliver-entry` 门 `gate_auto_passed=true`（standing run-scoped 授权）
- **目标环境**：本机全局（测试 / staging 目标）。**公开 npm 发布（tag → GitHub Actions publish + Release）沿本项目一贯惯例保留为人类确认点，本自动单元未执行。**
- **前置条件**：`VERIFY_PASS` 存在 ✓（07:39，acceptance-report Gate PASS）；`tasks.md` 含 `[deploy]` section ✓；proposal 声明需要部署 ✓。
- **执行链路**：部署方案 §十（tag 驱动发布链路）的本地 staging 段（bump + build + pack + install + 核验）。

## 二、执行命令摘要
| 步骤 | 命令 / 动作 | 结果 |
|---|---|---|
| 版本递增 | `cli/package.json` version `0.13.15` → `0.13.16`（patch +1，无 contract 版本变化） | **PASS** |
| 构建 | `cd cli && npm run build`（tsc） | **PASS**（exit 0） |
| 全量回归 | 本会话 `npx vitest run`：54 文件 / 1479 用例全绿（VERIFY_PASS 已落） | **PASS** |
| 打包 | `cd cli && npm pack` → `miniidealab-openlogos-0.13.16.tgz`（≈978 kB） | **PASS** |
| 产物核验 | 解包 tarball：`dist` 内 `collectBaselineSoftWarnings`/`detectBaselineJitAdvisory`/`baseline_warnings`/`JIT 确认流` **0 命中**；`dist/commands/feature-backfill.js` 含新红线「不存在确认升级入口」；随包 `skills/brownfield-adopter/SKILL.md` 含冻结说明 | **PASS** |
| 回滚来源留存 | 上一版 `cli/miniidealab-openlogos-0.13.15.tgz` 本地留存 | **PASS** |
| 全局安装 | `npm install -g ./miniidealab-openlogos-0.13.16.tgz` | **PASS** |
| 版本一致性 | `openlogos --version` == `0.13.16` == `cli/package.json` | **PASS** |
| 部署后即时功能核验 | 安装后 CLI：`openlogos --help` exit 0；临时 seeded adopted 项目 `openlogos next` **不含** JIT 确认提示（change-writer 建议 / 一并确认现状 / 不设硬门）——移除已在部署产物真实生效 | **PASS** |

## 三、随包交付内容核验
- `dist/lib/baseline-jit.js`（仅保留 `effectiveBaselineSeedState`，advisory 死代码已删）、`dist/commands/verify.js`（无 `baseline_warnings`/软告警）、`dist/commands/next.js`（seeded 正常迭代文案）、`dist/commands/feature-backfill.js`（新红线）✓
- 随包 skills / docs：`skills/brownfield-adopter/SKILL.md`、`skills/change-writer/SKILL.md`（Step6补充三已删、UI 窄例外已补）、`docs/brownfield-adopter-guide.md` ✓
- `baseline_coverage` 契约 / scanner / provenance 字段**未改**（冻结保留）✓

## 四、迁移与服务
无数据迁移（JSON 契约与 provenance 数据均不变，`verified`/`confirmed_*` 冻结保留）；无常驻服务。

## 五、回滚预案（部署方案 §十）
`npm install -g cli/miniidealab-openlogos-0.13.15.tgz` 回装上一版；本变更无数据副作用、无迁移；回滚后复核 `openlogos --version` 恢复 `0.13.15`。若后续公开发布后需回滚：`npm dist-tag` 回退 + 删除对应 tag。

## 六、未执行的动作（人类确认点）
1. **公开 npm 发布（tag → GitHub Actions publish + GitHub Release）：人类确认点，未执行。** 正式发布需：提交本变更 31 个文件（当前工作区未提交）、更新 `plugin/.claude-plugin/plugin.json` / `CHANGELOG.md` 与 `cli/package.json` 一致、创建并推送 `v0.13.16` tag 触发 CI。
2. `openlogos smoke`（SMOKE-core-44…48）：本工作单元仅部署，smoke 按流程另行授权执行。
3. 官网部署：本提案无 website 变更；Cloudflare 凭据长期失效，另行处理。

## 七、结论
本机全局 staging 部署**成功**：0.13.16 已构建、打包、安装，版本一致性、包内容（已删符号清零 + 新产物在场）与部署后即时功能核验（移除生效）全部通过，回滚 tarball 已留存。公开 npm 发布保留为人类确认点。
