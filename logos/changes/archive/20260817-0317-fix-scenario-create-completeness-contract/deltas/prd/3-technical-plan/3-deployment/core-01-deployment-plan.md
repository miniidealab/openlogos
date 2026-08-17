## ADDED — 场景 CREATE 完整性修复 v0.13.27 本地全局部署检查

### 部署目标与边界

- 目标版本：当前 `0.13.26` 的下一 patch `0.13.27`。
- 目标环境：当前开发机的 npm 全局 OpenLogos 环境。
- 交付物：本地构建的 npm tarball、SHA-256、安装前后命令路径/版本证据、SMOKE-core-67～69 结果。
- 部署方式：在 verify PASS 且用户另行授权部署执行后，从 `cli/` 构建并 `npm pack`，以生成的 tarball 执行 `npm install -g`。
- 数据迁移：无；不批量改写项目规格、活跃提案或用户业务数据。
- 明确排除：不执行 npm publish、Git tag、GitHub Release、官网发布、远端部署或 git push；C01 的本机安装决定不构成这些动作的授权。

### 部署前条件

1. 本提案 Delta 已获独立 merge 授权并完成合并，代码切片、UT-S39-28～32、ST-S39-14～16 和相关回归全部实现且由 reporter 记录。
2. `openlogos verify` 已在相应人类确认点执行并 PASS；缺失、失败或 loop-exhausted 时不得部署。
3. `cli/package.json`、插件 manifest 与需要随包分发的元数据均声明精确 `0.13.27`，构建产物无旧版本漂移。
4. 记录当前全局 `openlogos` 的解析路径、npm prefix、精确版本 `0.13.26` 与 Node/npm 环境。
5. 保留可重新安装的 `miniidealab-openlogos-0.13.26.tgz` 或等价可信 tarball，记录其绝对路径和 SHA-256，并准备可复制回滚命令。
6. `npm pack --dry-run` 或等价检查证明新包包含更新后的 CLI build、`spec/baseline-closure.md`、`spec/change-management.md`、change-writer/scenario-architect Skills，不包含 guard、活跃 change、测试结果或凭据。

### 构建、制品校验与本机安装

在仓库根进入 `cli/` 后执行项目现行脚本；具体包管理命令以合并后 `package.json` 为准，最低步骤为：

```bash
cd cli
npm test
npm run build
npm pack --dry-run
npm pack
shasum -a 256 miniidealab-openlogos-0.13.27.tgz
npm install -g ./miniidealab-openlogos-0.13.27.tgz
```

安装操作必须在独立部署授权后执行。安装完成后开启新 shell 或刷新命令哈希，重新解析 `openlogos`，避免旧 prefix/缓存命令造成假成功。部署报告记录 tarball 绝对路径、哈希、安装时间、npm prefix、命令路径、安装前后版本和回滚制品。

### 部署后成功证据

1. 新 shell 的 `openlogos --version` 精确返回 `0.13.27`，命令路径位于部署前确认的 npm 全局 prefix。
2. 全局包的 CLI/package/plugin 版本一致，且包含更新后的 baseline closure/change management 规格与两个 Skill。
3. 隔离临时项目中，完整 `步骤说明`、`主流程`、`主路径步骤`、`主路径`、`正常流程`、`main path` 场景 CREATE 均通过 change-lint。
4. 同一安装包拒绝仅在散文/围栏/注释中出现“步骤”的夹具，拒绝不足 3 步、伪 Mermaid、空异常/追溯夹具。
5. 真正缺少步骤章节时，change-lint exit 2、merge 非零，项目根快照证明无写入副作用。
6. SMOKE-core-67～69 全部由统一 smoke dispatcher 执行并写 `logos/resources/verify/smoke-results.jsonl`；只有独立 `openlogos smoke` 门 PASS 后才能归档。

### 环境隔离与安全

- 所有正反例在 `mktemp -d` 或等价安全临时目录创建，不复用真实活跃提案，不修改本仓 guard/resources。
- 测试输出不得包含凭据、用户文档全文或不必要的绝对路径；失败 fixture 可保留其临时路径供诊断。
- change-lint 的只读快照覆盖文件集合和逐文件 SHA-256；merge 负例额外覆盖 guard、counter、resource index 与 lifecycle markers。

### 失败处理与回滚

构建、包内容、安装、路径/版本、结构化 lint、merge 原子性、runner/reporter 或 smoke 任一失败时立即停止后续归档，保留新 tarball、哈希、日志与隔离 fixture，并执行：

```bash
npm install -g /absolute/path/to/miniidealab-openlogos-0.13.26.tgz
hash -r
openlogos --version
```

回滚成功标准：新 shell 中版本精确为 `0.13.26`，命令解析路径恢复到原 npm prefix，回滚 tarball 哈希与部署前记录一致。回滚只恢复本机全局 CLI，不删除已经合法合并的规格，不触发公开发布。修复部署问题后必须重新从 verify/部署授权点开始。

### 门禁结论

本节只设计部署与 smoke，不执行命令。人工模式下 merge、verify、部署执行、smoke、archive、git push 仍分别需要明确授权；本轮只已获得 plan approval 和 C01 方案选择，尚未获得这些后续动作授权。
