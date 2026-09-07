# core-S05-test-cases delta — fix-deploy-done-leak-failclosed-selfheal

## ADDED — S05 next 矛盾事实对账建议测试

> 覆盖 `next` 在「派生停在 `ready-to-deploy` 但下游存在矛盾证据」时输出 `state_inconsistency` 投影与人读补救建议，以及一致状态下的零漂移。
>
> 背景：20260907 事故中 `DEPLOY_DONE` 缺失让派生永远停在 `ready-to-deploy`，`SMOKE_PASS` 等强证据永不被评估，`next` 只会重复「请执行部署任务」，宿主面板长期僵死。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S05-56 | 孤儿 `SMOKE_PASS` 触发对账投影与补救建议 | EX-5.4 | 活跃提案：`VERIFY_PASS` 在场、`deployment_required=true`、`DEPLOY_DONE` **缺失**、`SMOKE_PASS` **在场** | 执行 `openlogos next --format json` 与默认文本模式 | JSON：`active_change.state_inconsistency` 在场，`kind==="deploy_done_missing_with_downstream_evidence"`、`evidence` 含 `"smoke_pass_marker_present"`、`remediation==="openlogos deploy-done"`；文本：引导在既有部署授权文案后追加对账建议行，含 `openlogos deploy-done`；`proposal_step` 仍为 `ready-to-deploy`；**无写盘**（无 marker 新增/删除、无缓存文件） |
| UT-S05-57 | 一致状态零投影零漂移 | EX-5.5 | 场景 A：`DEPLOY_DONE` 缺失且无任何矛盾证据（`[deploy]` 未全勾、无 smoke marker）；场景 B：`DEPLOY_DONE` 已在场 | 分别执行 `openlogos next --format json` | 两种场景输出均**不含** `state_inconsistency` 键（不是 `null`）；人读引导与修复前逐字一致；既有 next golden 不受影响 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S05-26 | 僵死状态被点名 → 补标 → 投影消失 | S05 主时序 + EX-5.4/5.5 | 真实 CLI；构造 20260907 孤儿状态（`SMOKE_PASS` 在场、`DEPLOY_DONE` 缺失、`[deploy]` 已全勾） | ① `openlogos next` → ② 按建议执行 `openlogos deploy-done` → ③ 再次 `openlogos next` | ① 投影在场，`evidence` 按固定顺序输出 `["smoke_pass_marker_present","deploy_tasks_all_checked"]`（去重、稳定可 golden），人读含补救命令；② 落标成功；③ 投影字段消失，`proposal_step` 推进离开 `ready-to-deploy`（需 smoke 时为 `ready-to-smoke`）；全程 `next` 未写任何 marker |

### 追溯与覆盖

- AC-RECON-NEXT-01 矛盾事实输出对账投影与补救命令：UT-S05-56、ST-S05-26 步骤①。
- AC-RECON-NEXT-02 一致状态零投影零漂移：UT-S05-57。
- AC-RECON-NEXT-03 投影不改派生、不写盘：UT-S05-56、ST-S05-26。
- AC-RECON-NEXT-04 补标后投影自然消失：ST-S05-26 步骤③。
- 场景：S05「deploy-done 对 next 的影响」§矛盾事实的对账建议；功能规格：§2.67.3；JSON 契约：`spec/cli-json-output.md` `state_inconsistency`。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S05"`；失败不得写 pass。
- 「不写盘」断言以调用前后提案目录文件清单与 mtime 比对取证，不得只断言输出内容。
