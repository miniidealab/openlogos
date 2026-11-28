## ADDED — S09 人工验收记录命令受限与开关字段保护测试（smoke-manual-acceptance）

> 覆盖场景 `core-S09-change-management.md`「S09 人工验收记录命令受限与开关字段保护」Step 1～8、EX-9M.1～EX-9M.4，功能规格 §2.107.10，需求 AC-SMOKE-MANUAL-13。用例以 hook 输入 JSON 调用 `plugin/bin/guard-check` 与 `plugin-cursor/hooks/runtime.cjs`（与既有 approve 受限命令用例同一夹具形态），测试代码写入 OpenLogos reporter，`scenario_id="S09"`。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|----|--------|---------|------|---------|
| UT-S09-493 | 独立形态交宿主审批 | launched 项目，有活跃提案；`permission_mode` 为 `default`，另一臂为 `acceptEdits` | Bash `openlogos accept --env prod --deploy d1 --case ST-S01-05 --result pass`；另一臂带 `cd /repo && ` 前缀 | stdout `permissionDecision: "ask"`，reason 含「该命令会记录人工验收结果」与命令原文，exit 0 |
| UT-S09-494 | 其他权限模式阻断 | `permission_mode` 分别为 `bypassPermissions`、`dontAsk`、`auto`、`plan`、缺失、未知值 | 同一命令 | 全部 exit 2；reason 提示用户在终端以 `! <命令原文>` 执行或经 RunLogos 界面记录，不要由 AI 代记 |
| UT-S09-495 | `--help` 与任何参数形态都受限 | `default` 模式 | `openlogos accept --help`；`openlogos accept`（无参数） | 与 UT-S09-493 相同，按受限命令交审批 |
| UT-S09-496 | 复合与内嵌形态阻断 | `default` 模式 | `openlogos smoke --env prod && openlogos accept …`；`bash -c "openlogos accept …"`；`eval 'openlogos accept …'` | 全部 exit 2，提示受限命令必须单独执行 |
| UT-S09-497 | 写了 `manual_acceptance` 的登记表受保护 | 登记表只有 `manual_acceptance`（无 `promote_from` / `require_approval`），`guard.exempt` 含 `logos/environments.yaml`；有活跃提案 | Edit 该文件（`default` 模式）；同一编辑在 `bypassPermissions`；Bash `sed -i … logos/environments.yaml` | 分别为 `ask`（reason「该修改会改变部署门禁配置」）、exit 2、exit 2；不适用豁免、不以活跃提案放行 |
| UT-S09-498 | 未写门禁字段的登记表保持豁免 | 登记表既无三个字段名也无反斜杠字符 | Edit 该文件 | 按 `guard.exempt` 放行，与引入前一致 |
| UT-S09-499 | Cursor 适配层同口径 | Cursor `beforeShellExecution` 输入 | `openlogos accept …`；`rm logos/environments.yaml`（登记表含 `manual_acceptance`） | 前者返回 `permission: "ask"`（实测不能保证弹窗时为 `deny`，与 approve 同口径）；后者 `deny` |
| UT-S09-500 | 非受限的相邻命令不受影响 | `default` 模式 | `openlogos smoke --env prod`、`openlogos env show prod`、`openlogos next` | 不触发受限判定，判定与引入前一致 |
| UT-S09-501 | qoder 适配层在 initial 生命周期拒绝 accept | `lifecycle: initial` 项目，已有开启人工验收的环境、成功部署与待验清单；另一臂为 launched 项目 | 以 qoder hook 输入调用 `plugin-qoder/hooks/runtime.cjs` 的判定：`openlogos accept --env prod --deploy d1 --case ST-S01-05 --result pass`；另测复合与 `bash -c` 内嵌形态 | 全部返回拒绝，原因提示在终端执行或经 RunLogos 界面记录；不返回「initial 生命周期不启用变更硬门禁」或「只读命令」放行；随后检查账本无新增 manual 记录 |
| UT-S09-502 | workbuddy 适配层在 initial 生命周期拒绝 accept | 同 UT-S09-501，宿主为 workbuddy，另测 `execute_command` 工具名 | 调用 `plugin-workbuddy/hooks/runtime.cjs` 的判定 | 同 UT-S09-501 |
| UT-S09-503 | zcode 适配层在 initial 生命周期拒绝 accept | 同 UT-S09-501，宿主为 zcode | 调用 `plugin-zcode/runtime/hook-runtime.js` 的判定 | 同 UT-S09-501 |

### 覆盖度校验

| 来源 | 覆盖用例 |
|------|---------|
| Step 1～5（accept 受限） | UT-S09-493、UT-S09-494、UT-S09-495、UT-S09-499 |
| Step 6～8（登记表保护） | UT-S09-497、UT-S09-498、UT-S09-499 |
| EX-9M.1 | UT-S09-495 |
| EX-9M.2 | UT-S09-496 |
| EX-9M.3 | UT-S09-498 |
| EX-9M.4 | UT-S09-500（guard 不介入非 AI 调用的前提：只有 AI 工具调用经过 hook） |
| EX-9M.5（非 Claude / Cursor 宿主） | UT-S09-501、UT-S09-502、UT-S09-503 |

### 自动化与证据要求

- 用例只调用 guard 入口与适配层，不执行真实 `openlogos accept`；全部用例写 OpenLogos reporter，测试名含对应 ID。
