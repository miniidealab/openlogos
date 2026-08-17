# core-S39 场景 CREATE 完整性合同实现清单

## 实现范围

- 在共享 Markdown authority scanner 中输出围栏/注释之外的 ATX 标题、独立 fenced block 与不确定结构诊断。
- 将 scenario CREATE 完整性从全文关键词匹配改为结构化合同：canonical/兼容步骤标题、连续三项非空有序列表、合法 Mermaid `sequenceDiagram`、至少两个参与者和一条消息，以及唯一且非空的异常/边界与追溯章节。
- change-lint、merge 与 merge-apply 继续复用同一个 baseline closure evaluator；失败路径保持资源、guard、counter、index 与 marker 无副作用。
- 扩展 baseline-on-touch 安装态 smoke runner，覆盖 SMOKE-core-67～69，并沿用统一 `scripts/run-smoke.js` dispatcher 和 `smoke-results.jsonl` reporter。

## 自闭环切片与真实用例

- [x] 单切片：UT-S39-28、UT-S39-29、UT-S39-30、UT-S39-31、UT-S39-32、ST-S39-14、ST-S39-15、ST-S39-16、SMOKE-core-67、SMOKE-core-68、SMOKE-core-69。

## 主要产物

- `cli/src/lib/markdown-scan.ts`
- `cli/src/lib/baseline-closure.ts`
- `cli/test/s39-baseline-on-touch.test.ts`
- `scripts/smoke-baseline-on-touch.js`
- `logos/resources/verify/test-results.jsonl`（全局 Vitest OpenLogos reporter）
- `logos/resources/verify/smoke-results.jsonl`（仅在正式部署后 smoke 门写入；本轮本地预检写入 `/tmp`）

## 当前验证

- `cd cli && npm run build`：通过。
- `cd cli && npx vitest run test/s39-baseline-on-touch.test.ts`：56/56 通过；UT-S39-28～32 与 ST-S39-14～16 均有最新 PASS reporter 记录。
- `cd cli && npm test`：63 个测试文件、1778/1778 通过。
- 使用本地 `cli/dist/index.js` 在隔离临时项目执行 SMOKE-core-68/69 非部署预检：2/2 通过，结果写入 `/tmp/openlogos-s39-smoke-preflight.jsonl`。
- SMOKE-core-67 的精确 `0.13.27` 全局包/命令路径/随包资产校验，以及 SMOKE-core-69 的 `0.13.26 → 0.13.27` 回滚演练，保留至 verify PASS 后的人类部署与 smoke 授权节点；本轮未执行全局安装。

## 非适用边界

- 无 HTTP/RPC/消息 API 变更。
- 无数据库、DDL 或迁移。
- 不修改 RunLogos；普通 `write-delta` lint barrier 由 companion change 处理。
