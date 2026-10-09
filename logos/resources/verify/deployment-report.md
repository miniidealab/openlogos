# 部署报告：deploy-plan-gate-release-0-15-19 / OpenLogos 0.15.19（2026-10-09，本机全局部署）

## 一、部署结论

- **模块 / 提案**：core / `deploy-plan-gate-release-0-15-19`。发布内容为两项 CLI 行为：
  1. change-lint L5 部署方案覆盖判定（功能规格 §2.90），Plan Package 同步投影；smoke 门对本提案新增用例的 skip 判 FAIL。
  2. `init` / `adopt` / `sync` 按 `locale` 写入项目 `.claude/settings.json` 的 `language`（来源提案 `sync-claude-response-language`，已归档；功能规格 §2.89）。
- **部署方案依据**：`core-01-deployment-plan.md`「OpenLogos 0.15.19 发布方案（提案阶段部署方案检查与 Claude Code 回复语言设置，本地全局）」。
- **授权与门禁**：RunLogos `--auto` 对 deliver 门 `gate_auto_passed=true`（`GATE_AUTO_PASSED` 审计行 `deliver-entry` 2026-10-09T09:25:16.218Z）；`VERIFY_PASS` 在场。
- **目标环境**：本机 npm 全局 prefix `/opt/homebrew`；入口 `/opt/homebrew/bin/openlogos` → `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js`（全局包目录为普通目录，非链接）。
- **公开副作用**：无。未执行 npm publish、dist-tag、git tag、GitHub Release、官网部署或 git push。
- **数据迁移 / 服务启动**：无 / 不适用。

## 二、部署前提交

- `ce7848a` docs(deploy-plan-gate-release-0-15-19): merge spec deltas
- `ece1ef1` feat(deploy-plan-gate-release-0-15-19): change-lint L5 检查部署方案覆盖，smoke 门拒绝必要用例 skip
- 来源提案 `sync-claude-response-language` 的规格与代码：`f356c2a`、`5fafadc`。

## 三、冻结事实与回滚点

| 项 | 值 |
|---|---|
| 部署前全局入口 | `/opt/homebrew/bin/openlogos` → `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js` |
| 部署前 `npm prefix -g` | `/opt/homebrew` |
| 部署前 `openlogos --version` | `0.15.18` |
| 部署前 `cli/package.json` | `0.15.18` |
| 回滚制品 | `cli/rollback/miniidealab-openlogos-0.15.18.tgz`，2,614,325 字节 |
| 回滚制品 SHA-256 | `0434d57c265e2b5f933f29b57150b6f5f684c9915bf3e324ab72d7307ebdf309` |
| 回滚制品来源 | 在全局安装目录 `/opt/homebrew/lib/node_modules/@miniidealab/openlogos` 执行 `npm pack --ignore-scripts`（未从工作树打包） |
| 内容身份 | 解包后 `dist/` 404 个文件与全局安装逐文件 SHA-256 一致（0 差异）；包内不含 `mergeClaudeLanguageSetting`、`evaluateDeploymentPlanCoverage` |
| 旧行为验证 | 隔离 prefix 试装：`--version` = `0.15.18`；`init --locale zh` 生成的 `.claude/settings.json` 不含 `language`；缺部署方案夹具 `change-lint` exit 0 |

冻结的本仓托管态（回滚比对基准）：

| 文件 | SHA-256 |
|---|---|
| `.claude/settings.json`（顶层键仅 `hooks`） | `e5b3afb1654b9427eaee24bb490fafcaf6fb50c5c7011a69acdcb6d4b724c223` |
| `.claude/settings.local.json` | `5346bb9c964cde90a34ae4e183b45a39295b23117706f27328f6d30e28630db0` |
| `.claude/openlogos/bin/guard-check` | `87505766c566becc232d60acce4bc5ef8ab24820908eabf553ce874959610a06` |
| `.claude/openlogos/bin/guard-post-check.cjs` | `bdeab4341c935fa9678c34bc36961a0dc579b7b2198da9b92d73b4ee2c88e18c` |
| `.claude/openlogos/bin/openlogos-phase` | `bbdf9a13b475d857a60f52fbfde23242e470de7c2a3a01d63f04e6ea22df5fb9` |
| `.claude/openlogos/bin/openlogos-phase-launcher.cjs` | `679f3a6f2b5b0f96400d0692c8f9c5f2ed330cf7dd380733011042e52915db9a` |

## 四、版本与制品身份

- `node cli/scripts/bump-version.mjs 0.15.19`：`cli/package.json`、`cli/package-lock.json`、`cli/asset-manifest.json`、5 个 plugin manifest、`local-release-candidate.ts`（CANDIDATE → `0.15.19`，ROLLBACK → `0.15.18`），生成器重算 `payloadHash`；未手改 manifest。
- `CHANGELOG.md` 新增 `[0.15.19] - 2026-10-09` 条目。
- 唯一候选制品：`miniidealab-openlogos-0.15.19.tgz`（真实 `npm pack`，含 prepack；存于本会话 scratchpad），2,623,843 字节，SHA-256 `9ad8d40b29e02ea94c4b61e301dda65018869446c21afa3ca26df0c20eb02de7`。
- 解包核对：`package.json` 版本 `0.15.19`；asset-manifest 自洽；`dist/commands/init.js` 导出 `mergeClaudeLanguageSetting` 与 `CLAUDE_LANGUAGE_BY_LOCALE`；`dist/lib/proposal-lifecycle.js` 导出 `evaluateDeploymentPlanCoverage`；`dist/i18n.js` 含 `init.claudeLanguageCustom`；`dist/commands/smoke.js` 含 `required_cases_skipped`。

## 五、源码回归证据

- 升版后 `cd cli && npm run build` 通过；`npm test`：170 个测试文件、2576 个用例全部通过（含 UT-S35-216～224、ST-S35-38～39、UT-S08-79～83、ST-S08-42～43、`UT-S19-46`、`UT-S19-49`）。

## 六、安装态证据

**隔离 prefix 行为矩阵**（一次性 prefix 安装固定候选 tarball，14 项全部通过）：

| 类别 | 结果 |
|---|---|
| candidate identity | 隔离 prefix 入口 realpath 在该 prefix 包目录内，`--version` = `0.15.19` |
| L5 缺部署方案 | exit 2，`tasks_deployment_plan_missing` + `deployment_plan_missing` |
| L5 delta 覆盖 | `[delta]` 部署方案任务 → exit 0 |
| L5 引用覆盖 | 唯一章节引用 → exit 0；不存在的引用 → exit 2，`deployment_plan_reference_unresolved` |
| L5 不适用回归 | 无需部署夹具：候选与回滚版本的 L5 行（`✓ L5 部署决策一致`）、违规列表与退出码逐字一致 |
| `language` 新建 | `init --locale zh` → `chinese`；`--locale en` → `english` |
| `language` 存量 sync | 回滚版本 init 的项目（无 `language`，加用户 PreToolUse 条目与 `permissions`）经候选 sync → `chinese`，其它字段与用户条目顺序不变；第二次 sync 字节不变 |
| `language` 边界 | 自定义值 `japanese` 保留且恰一行提示；locale 改 en 后 `chinese` → `english`；非法 JSON 字节不变、sync exit 0；`settings.local.json` 字节不变 |
| 全局零触碰 | 矩阵前后 `/opt/homebrew/bin/openlogos@0.15.18` 不变 |
| 回滚演练 | 回滚制品试装 `--version` = `0.15.18`；缺部署方案夹具旧版 exit 0（对照）；候选 init 的项目经旧版 sync exit 0，`language` 保留 `chinese` |

**本机全局安装**：`npm install -g <同一 tarball>`。新 shell 复核：

| 项 | 值 |
|---|---|
| `command -v openlogos` | `/opt/homebrew/bin/openlogos` |
| 入口 realpath | `/opt/homebrew/lib/node_modules/@miniidealab/openlogos/dist/index.js`（全局包目录为普通目录） |
| `openlogos --version` | `0.15.19` |
| 包 `package.json` / asset-manifest | `0.15.19` / `0.15.19`，manifest 自洽 |
| 新导出 | `mergeClaudeLanguageSetting`、`evaluateDeploymentPlanCoverage` 均在场 |
| `dist/i18n.js` SHA-256 | `a0c1653db36716f8816c5df6bedfa3b815676268db69d21362f42d3ede1af551`（与 asset-manifest 条目一致） |

## 七、本仓 sync 读回

在本仓项目根用新全局 CLI 执行 `openlogos sync`，退出码 0（输出「Sync complete.」）。读回：

| 项 | 结果 |
|---|---|
| `.claude/settings.json` | 顶层键 `hooks`、`language`；`"language": "chinese"`；`git diff` 仅新增 `"language": "chinese"` 一行，`hooks` 原样未动；新 SHA-256 `b5e093dab768a81c212a6eb992a3670ffbc9f2011480e2f9e9663a4ef3ad3358` |
| `.claude/settings.local.json` | SHA-256 与冻结值相同（`5346bb9c…30db0`），未改动 |
| `.claude/openlogos/bin/guard-check` | 由 `87505766…a06` 变为 `d5235589…5102`。来源：0.15.18 全局安装之后的提交 `9350b96`（guard UTF-8 变量引用边界修复）改了 `plugin/bin/guard-check`；0.15.19 随包带上修复后的字节，sync 按随包字节刷新。新哈希与仓内 `plugin/bin/guard-check`、全局包 `claude-plugin-template/bin/guard-check` 一致 |
| `.claude/openlogos/bin/` 其余三个脚本 | SHA-256 与冻结值相同 |

新判定在真实项目上的自检：新全局 CLI 执行 `openlogos change-lint --slug deploy-plan-gate-release-0-15-19 --format json`，exit 0、`pass=true`、无违规（本提案 `[delta]` 含部署方案任务，覆盖成立）。

## 八、未解决风险与提醒

- **runlogos 未处理**：按部署方案「不改写其他仓库」，runlogos 项目的 `.claude/settings.json` 尚未写入 `language`。需要用户授权后，在 runlogos 项目根用新全局 CLI 执行 `openlogos sync`。
- **宿主是否实际采用项目级 `language`**（功能规格 §2.89.5）未在本次部署中人工确认；Claude Code 可能在下一次会话才读取项目设置。
- smoke（SMOKE-core-223～225）尚未执行，按流程在 `deploy-done` 之后另行运行。
