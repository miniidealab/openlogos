# core-S09-test-cases delta — fix-deploy-done-leak-failclosed-selfheal

## ADDED — S09 archive 链条 fail-closed 校验测试

> 覆盖 `openlogos archive` 的完成链条校验：`VERIFY_PASS` 必备；需部署提案还须 `DEPLOY_DONE`；需 smoke 提案还须 `SMOKE_PASS`。拒绝时零副作用（不移动目录、不删 guard、不建握手），无需部署提案零回归。
>
> 背景：20260907 事故中 `cli/src/commands/archive.ts` 不检查上述任何一个 marker，带 `DEPLOY_DONE` 缺口的提案被成功归档并固化进 audit-only 归档记录。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-319 | 缺 `VERIFY_PASS` 时拒绝归档且零副作用 | EX-9.13 | 活跃提案 `VERIFY_PASS` 缺失（或 `VERIFY_FAIL` 在场） | 执行 `openlogos archive <slug>` | 非零退出；stderr 含稳定错误码 `ARCHIVE_VERIFY_NOT_PASSED` 与补救命令 `openlogos verify`；提案目录**未移动**至 `logos/changes/archive/`、`logos/.openlogos-guard` **未删除**、未建立 Windows 握手请求目录 |
| UT-S09-320 | 需部署提案缺 `DEPLOY_DONE` 时拒绝归档 | EX-9.14 | `VERIFY_PASS` 在场、`deployment_required=true`、`DEPLOY_DONE` 缺失；**且 `SMOKE_PASS` 在场**（20260907 孤儿状态） | 执行 `openlogos archive <slug>` | 非零退出；`ARCHIVE_DEPLOY_NOT_DONE`；message 含 `openlogos deploy-done`；**smoke 结论不得反推部署完成**——`SMOKE_PASS` 在场也照常拒绝；零副作用同 UT-S09-319 |
| UT-S09-321 | 需 smoke 提案缺 `SMOKE_PASS` 时拒绝归档 | EX-9.15 | `VERIFY_PASS` + `DEPLOY_DONE` 在场、`smoke_required=true`、`SMOKE_PASS` 缺失（或 `SMOKE_FAIL` 在场） | 执行 `openlogos archive <slug>` | 非零退出；`ARCHIVE_SMOKE_NOT_PASSED`；message 含 `openlogos smoke`；零副作用同 UT-S09-319 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S09-123 | 链条逐级补齐后归档放行 | Step 13→15 | 真实 CLI；提案需部署需 smoke，起点为「仅 `VERIFY_PASS` 缺失」 | ① `archive` → ② 置 `VERIFY_PASS` 后 `archive` → ③ `openlogos deploy-done` 后 `archive` → ④ smoke 通过写 `SMOKE_PASS` 后 `archive` | ①`ARCHIVE_VERIFY_NOT_PASSED`；②`ARCHIVE_DEPLOY_NOT_DONE`；③`ARCHIVE_SMOKE_NOT_PASSED`；④归档成功——目录移入 `logos/changes/archive/`、guard 释放、输出与修复前一致；①②③每步均零副作用 |
| ST-S09-124 | 无需部署提案零回归 | Step 13→15 | 提案 `deployment_required=false`（文档-only），`VERIFY_PASS` 在场、无 `DEPLOY_DONE`/`SMOKE_PASS` | 执行 `openlogos archive <slug>` | 归档**成功**——链条只到 ①；`deployment_decision_conflict=true` 的提案照旧不得作为主动作（既有语义不变）；Windows 握手协议在校验通过后才进入，顺序为「链条校验 → 握手 → rename」 |

### 追溯与覆盖

- AC-ARCHIVE-FC-01 `VERIFY_PASS` 必备：UT-S09-319、ST-S09-123 步骤①。
- AC-ARCHIVE-FC-02 需部署提案 `DEPLOY_DONE` 必备（smoke 结论不得反推）：UT-S09-320、ST-S09-123 步骤②。
- AC-ARCHIVE-FC-03 需 smoke 提案 `SMOKE_PASS` 必备：UT-S09-321、ST-S09-123 步骤③。
- AC-ARCHIVE-FC-04 拒绝零副作用（不移动、不删 guard、不建握手）：UT-S09-319～321 与 ST-S09-123。
- AC-ARCHIVE-FC-05 无需部署提案零回归：ST-S09-124。
- 场景：S09「archive 链条 fail-closed 校验」；功能规格：§2.67.2；根规格：`spec/change-management.md` archive 前置链条语义。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S09"`；失败不得写 pass。
- 零副作用断言必须以**磁盘事实**取证（提案目录仍在 `logos/changes/<slug>/`、`logos/.openlogos-guard` 仍在盘、握手协议目录无新增），不得只断言退出码。
- 全部断言在一次性临时项目中构造，不得触碰本仓或用户其它项目的活跃提案与 guard。
