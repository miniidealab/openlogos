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
