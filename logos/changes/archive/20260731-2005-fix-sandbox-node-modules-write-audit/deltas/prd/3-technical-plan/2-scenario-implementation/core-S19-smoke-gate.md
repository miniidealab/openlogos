## MODIFIED — EX-4.3: smoke 命令写入仓库非白名单路径

### EX-4.3: smoke 命令写入仓库非白名单路径
- **触发条件**：`smoke.sandbox_deny_workspace_write=true`，`smoke.command` 写入仓库根目录中的非白名单路径（规范化后存在完整路径段严格等于 `node_modules` 的写入不参与本判定，见 EX-4.4；近似名称目录如 `src/node_modules-cache/**` 仍参与本判定）。
- **期望响应**：`always` 模式下 smoke FAIL；`auto` 模式下若无法阻断写入必须输出 `sandbox.status=warn`，并给出改用 `always` 的建议。

## ADDED — EX-4.4: 沙箱内依赖准备写入（依赖目录豁免）

### EX-4.4: 沙箱内依赖准备写入（依赖目录豁免）
- **触发条件**：`smoke.sandbox_deny_workspace_write=true`，`smoke.command` 仅写入沙箱副本内命中豁免规则的路径——规范化并统一分隔符后存在完整路径段严格等于 `node_modules`（含 monorepo 嵌套形态如 `packages/a/node_modules/**`）。典型来源：pnpm 11 `verifyDepsBeforeRun=install` 在沙箱副本内自动 install/repair，重写 `node_modules/.bin/*`。
- **期望响应**：任一沙箱模式下均不判为非白名单写入——`always` 不因此 FAIL，`auto` 不因此 warn；`sandbox.infos` 输出一条固定信息级豁免说明，`sandbox.diagnostics` 不含该说明，文本输出以 `ℹ️` 渲染一次；`sandbox.status` 不因此改变；白名单之外的豁免路径不回收到原 workspace，快照遍历直接跳过；`smoke.result_path` 即使位于 `node_modules` 下仍被定点采集回收。沙箱执行器为 verify / smoke 共享，豁免语义、symlink 隔离与运行期写保护不变量（启动前逃逸按无法隔离处理，运行期新建/改写链接由 OS 级写保护在写入发生前阻断，写保护不可用时按能力分层 `always` 失败 / `auto` 告警，见 S13 EX-3.4）与白名单定点采集回收均与 S13 一致（见功能规格 §2.9）。豁免规则之外的非白名单写入判定不变（仍按 EX-4.3 处理）。
