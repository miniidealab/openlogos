## ADDED — D06 TRAE 国际版/CN non-deployable 决策补充

### 能力门结论

TRAE 国际版 `3.5.91` 与 TRAE CN `3.3.93` 当前均不得作为 D06 薄 Adapter 注册。两个真实客户端都执行了宿主内置 `Write` 并改写目标文件，但项目级 `.trae/hooks.json` 中匹配 `Write` 的 `PreToolUse` 拒绝脚本没有被调用；拒绝理由与 Hook stdin 证据均不存在。该结果未满足“拒绝发生在目标变化前、理由非空、目标字节不变”的 hard guard 不变量，能力门结论为 **BLOCKED**。

项目 Hook 还依赖用户按绝对工作区确认 `enabled_folders`；仅部署项目资产不能自动激活。公开材料描述 Hook 解析或执行异常时继续流程，亦不能形成 fail-closed 合同。Rules、Skills、自定义 Agent、MCP、原生记忆或人工确认均不得替代内置写工具的写前硬拦截。

### Registry 与所有权边界

1. 不注册规范 id `trae`，不增加别名或伪 capability，不把 TRAE 加入 `all`、帮助支持列表或交互选项。
2. 不创建 TRAE Adapter、Hook normalizer、共享 guard 映射、模板、插件 identity、Agent 或托管 Skills。
3. TRAE Rules、Skills、Agents、Commands、MCP、settings、账号、记忆与未知文件均归宿主或用户所有；OpenLogos 不读取、写入、迁移、覆盖或将其作为授权状态。
4. Claude Code、OpenCode、Codex、Cursor、ZCode、Qoder、WorkBuddy 的规范值、稳定顺序、资产路径与 `all` 展开保持不变。

### 重新开启条件

未来只能通过新提案重新评估，并须由国际版与 CN 的受支持版本在隔离工作区共同通过完整矩阵：真实内置写工具 allow/deny、工作区外路径、`..`、绝对路径、symlink、未知潜在写工具、非法输入、解析失败、runtime 缺失、状态矛盾与超时。所有拒绝均须在目标变化前发生，产生非空理由，且目标 SHA-256 保持不变；项目资产还须能够在不静默改写用户信任状态的前提下可靠启用。

### 版本与部署决策

- 本决策目标 OpenLogos 版本为 `0.13.29`，但不产生 TRAE Adapter 代码或 npm 产物变更。
- 原计划仅在双端 capability PASS 后使用隔离 staging 的真实 `0.13.29` tarball 验证，并以 `0.13.28` 回滚；由于能力门 BLOCKED，该条件路径取消。
- 不执行部署、smoke、npm publish、Git tag、GitHub Release、官网部署或 `git push`。

### 证据来源

- 提案：`trae-adapter-foundation`
- 国际版：`/Applications/Trae.app`，bundle id `com.trae.app`，版本 `3.5.91`
- CN：`/Applications/Trae CN.app`，bundle id `cn.trae.app`，版本 `3.3.93`
- 国际版目标 SHA-256：`8d2c3b21cd0d2a335b8a668b3b01161c0f29fa16c197a00bd454a56a14ec3fa8` → `cf3d065c1f376fa6c8a9c44e0b08118684560aab8348c7f4cfad6b3f01abb616`
- CN 目标 SHA-256：`381206c84be0ca90b4bd93549ff4540b160551aec17b1c7161f14d5702856a37` → `64d832f9c330cd4a5dca9fd1c178a5705c6405822d84aec511b8a1b813176349`
