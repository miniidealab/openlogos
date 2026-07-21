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
