## ADDED — TRAE 本地负向部署与 Smoke 需求

### 用户价值与范围

OpenLogos 必须用真实安装制品证明 TRAE non-deployable 合同没有只停留在源码测试。部署对象是 OpenLogos CLI `0.13.29` 候选 npm tarball，而不是 TRAE Adapter；验证环境只能是一次性 `local-isolated`，不得触达真实用户 HOME、全局 npm、真实项目或 TRAE 客户端状态。

### S01 候选安装态初始化要求

1. runner 必须从 `OPENLOGOS_TRAE_LOCAL_TARBALL` 安装版本精确为 `0.13.29` 的真实 tarball，记录包名、版本、清单、大小、SHA-256 和实际 `openlogos` 入口；入口必须解析到一次性 npm prefix。
2. 安装态执行显式 `init --ai-tool trae` 时，必须在配置、logos 目录或任何资产首次写入前以未知/不支持宿主失败；错误支持列表只含既有七宿主。
3. 安装态执行 `init --ai-tool all` 时，只初始化 Claude Code、OpenCode、Codex、Cursor、ZCode、Qoder、WorkBuddy，顺序稳定且不创建 TRAE Adapter、Rules、Skills、Agent、Hook、MCP、记忆或其它 `.trae/**` 资产。
4. 每条负向路径须保存退出码、脱敏 stderr、写入计划摘要和 fixture 前后文件清单/SHA-256；失败不得被 `skip` 或“客户端已安装”替代。

### S08 候选安装态同步要求

1. `sync` 的 `all` 展开、资产计划和结果必须继续只含既有七宿主；不得因发现 TRAE 国际版/CN、登录状态或工作区已有 `.trae/**` 而改变 Registry。
2. 手工配置含 `trae` 时，必须在总事务及版本戳写入前 fail loud，不提交其它宿主的部分同步。
3. 预置的 `.trae/**`、settings、账号占位、`enabled_folders`、Rules、Skills、Agents、Hooks、MCP、原生记忆和未知文件不得进入扫描、计划、暂存、备份、删除或回滚集合；只比较不透明文件清单与 SHA-256，不读取记忆正文。
4. `init` 与 `sync` 的严格配置失败、七宿主成功和用户边界证据须来自 tarball 内 CLI，禁止 workspace link 或源码入口。

### S19 本地部署后负向 Smoke 要求

1. `openlogos smoke --env local-isolated` 只能在该提案 `[deploy]` 全部完成并存在同环境 `DEPLOY_DONE` 后执行；缺失、环境不一致或部署决策冲突均不得产生 `SMOKE_PASS`。
2. dispatcher 必须发现并实际执行 SMOKE-core-124～SMOKE-core-129；每个结果写入合法 JSONL，至少包含 `id`、`status`、`timestamp`、`duration_ms`、`environment="local-isolated"`、候选 tarball SHA-256 和脱敏证据路径。
3. 任一用例缺失、skip、fail、reporter 缺失、审计链不完整或用户边界哈希变化，整个 smoke Gate 为 FAIL。
4. runner 不启动 TRAE 内置写/编辑/命令工具，不重新运行失败的 capability 矩阵；wrapper 直调、文件存在、UI 或软控制均不得被标记为 PASS。

### 制品、回滚与公开副作用要求

- `cli/package.json`、`cli/package-lock.json` 与随包插件 manifest 的候选版本必须一致为 `0.13.29`。
- `OPENLOGOS_TRAE_ROLLBACK_TARBALL` 必须是版本精确为 `0.13.28`、可离线安装且 SHA-256 可追溯的真实 tarball。
- 同一隔离 prefix 必须实际完成 `0.13.29 → 0.13.28 → 0.13.29`；每一步核对版本与入口，最终重新执行最小 TRAE 排除检查。
- 任一 build/test/pack、安装、版本、隔离、回滚或恢复步骤失败，部署失败且不得写 `DEPLOY_DONE`。
- 全流程不得执行 npm publish/dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署或 `git push`。

### 验收追溯

- S01：UT-S01-128、ST-S01-26、SMOKE-core-124～SMOKE-core-126。
- S08：UT-S08-37、ST-S08-27、SMOKE-core-127～SMOKE-core-128。
- S19：UT-S19-10～UT-S19-11、ST-S19-09、SMOKE-core-124～SMOKE-core-129。
