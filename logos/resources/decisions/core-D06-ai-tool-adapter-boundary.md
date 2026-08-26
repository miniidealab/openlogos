# D06：能力驱动 Adapter Registry、共享 Runtime 与宿主薄适配边界

### 状态

accepted

### 日期

2026-08-23

### 背景

OpenLogos 已支持多个 AI 工具，但宿主选择、资产部署、指令生成和生命周期刷新散落在 init、adopt、sync、launch 的条件分支中。继续以同样方式接入 ZCode 会复制状态机、用户资产保护和 guard 判断；各宿主容易在 `all`、回滚、`proposal_step` 或打包边界上漂移。ZCode 同时提供 Plugin、Skills、Commands、Agents、SessionStart 与 PreToolUse 协议，若把 OpenLogos 阶段语义写入 ZCode 专用脚本，还会形成第二套 guard 事实。

### 决策

建立公共、能力驱动的 AI Tool Adapter Registry，作为宿主身份、配置解析、能力枚举和资产计划的唯一入口；把 OpenLogos lifecycle/active change/`proposal_step` 上下文解析与 guard 决策放入宿主无关的 Node.js runtime；每个宿主 Adapter 只负责协议字段、目录布局、模板选择、输出/退出码映射和 owner 目标转换。

具体边界如下：

1. **Registry 拥有选择事实**：稳定 id、alias/历史配置、`all` 展开、顺序、去重、未知宿主错误和 capability manifest。
2. **核心编排拥有事务事实**：init/adopt/sync/launch 调用 Adapter 的 `planAssets`，统一完成全量预检、原子写入、回滚、版本戳/lifecycle 提交和结果汇总。
3. **共享 runtime 拥有方法论事实**：项目根定位、lifecycle、guard、active slug、`proposal_step`、阶段 allowlist、路径规范化和最终 allow/deny。
4. **宿主薄 Adapter 拥有协议事实**：ZCode camelCase/snake_case alias、`hookSpecificOutput`、exit 2、plugin root、manifest 与 `hooks/hooks.json`；不得复制 guard 状态机。
5. **模板包拥有静态资产**：Skills、Commands、Agents、AGENTS managed block 和 Hook 入口随 npm tarball 分发，版本与 CLI 同源。
6. **用户拥有未知资产**：托管 marker 外内容、用户配置、不同 identity plugin 与未知文件默认 preserved；冲突 fail loud。

### 理由

- 新宿主只增加 capability、模板和协议映射，不再修改每个生命周期命令的宿主条件树。
- 同一磁盘状态在 Claude Code、OpenCode、Codex、Cursor、ZCode 上得到同一阶段范围和 guard 结论。
- 资产事务与宿主协议分离后，用户内容保护、幂等、失败回滚和提交顺序可以一次实现、多宿主复用。
- 共享 Node.js runtime 可随 npm 包跨平台分发，也能由各宿主薄入口调用；相比 shell 复制更易进行结构化协议测试。
- Registry capability manifest 让 `all`、交互菜单、打包完整性和回归测试从同一事实派生。

### 备选方案

- **继续在各命令追加 `if (tool === "zcode")`**：否决。宿主矩阵会与 lifecycle 入口相乘，`all`、adopted launch、版本戳和回滚语义难以保持一致。
- **为 ZCode 复制一套完整 OpenLogos runtime**：否决。`proposal_step` 和 guard 会形成双实现，安全修复需要多处同步，最危险的结果是某宿主 fail-open。
- **把所有协议差异塞入共享核心**：否决。核心会依赖 ZCode 字段、目录和退出码，随后每个新宿主继续污染公共逻辑。
- **只生成 AGENTS，不提供 Plugin/Hooks**：否决。只能提示模型，不能满足 Skills/Commands 发现、SessionStart 上下文与 PreToolUse hard guard 的完整宿主目标。
- **直接复用 Claude plugin 布局作为 ZCode 唯一产物**：否决。兼容回退不能替代 ZCode 原生 manifest、标准 Hooks 位置和真实客户端验收。

### 影响面

- CLI：配置 schema/类型、交互选择、`all`、init/adopt/sync/launch 改由 Registry 驱动。
- 资产：新增 ZCode plugin 模板；既有四宿主通过 Adapter 包装或兼容桥接保持行为。
- 指令：根 AGENTS 生成加入 ZCode 自包含规则和命名空间分组。
- 安全：共享 Hook runtime 成为 guard 单一决策服务；ZCode 错误必须显式 deny + exit 2。
- 测试：S01/S08/S09/S14/S20 新增 UT/ST；真实 tarball + 真实 ZCode staging smoke；既有宿主 golden 回归。
- 部署：仅经后续独立授权执行 staging；本决策不授权公开发布。
- 演进：后续 Qoder、TraeCode CLI、WorkBuddy 分别以独立提案新增薄 Adapter，不纳入本案实现。

### 不变量

1. Adapter 不得自行决定 OpenLogos 方法论阶段或写入权限。
2. 核心编排不得解析宿主专有 Hook 字段。
3. lifecycle/版本戳只能在所有已选 Adapter 事务成功后提交。
4. 任何未知 owner 或无法可靠归类的潜在写操作默认阻断/保留，不覆盖/删除。
5. tarball 缺少声明资产时构建或部署预检失败，不能回退源码树补齐。
6. 新宿主加入不得改变不选择它的历史配置语义；`all` 的扩展必须显式测试。

### 来源

- 提案：`zcode-adapter-foundation`
- 用户决策：采用 staging 真实 tarball + 真实 ZCode CLI 验证，不执行公开发布。
- ZCode Plugin：`https://zcode.z.ai/en/docs/plugin`
- ZCode Hooks：`https://zcode.z.ai/en/docs/hooks`
- ZCode Agents/AGENTS：`https://zcode.z.ai/en/docs/agents`
- 关联规范：`spec/zcode-plugin.md`、`spec/agents-md.md`、`spec/pretooluse-guard.md`

## D06 Qoder Adapter 落地补充

### Qoder 落地结论

Qoder 作为 D06 决策下的第二个后续薄 Adapter 接入。稳定 id 为 `qoder`；`AiToolAdapterRegistry` 继续独占规范值、别名、capability、`all` 展开与稳定顺序，init/adopt/sync/launch 继续只消费 Adapter 合同，不新增 Qoder 名称分支。

Qoder Adapter 的所有权严格限于宿主协议和资产布局：

1. 使用 `.qoder-plugin/plugin.json` 与 Qoder 约定目录 `skills/`、`commands/`、`agents/`、`hooks/hooks.json` 描述插件资产。
2. Hook 子进程通过 `QODER_PLUGIN_ROOT` 定位随包共享 Node.js runtime；不得依赖仓库源码绝对路径或当前 shell 目录。
3. `SessionStart` 只负责把共享 `SessionContextService` 的结果映射为 `hookSpecificOutput.hookEventName="SessionStart"` 与 `additionalContext`。
4. `PreToolUse` 只负责把官方 snake_case 输入归一化后交给共享 `GuardDecisionService`，再映射为 `permissionDecision`、`permissionDecisionReason` 与阻断 exit 2。
5. Qoder CLI 与 IDE 的产品特有输出结构不得进入共享 runtime；本案以 Qoder CLI 官方协议与真实 CLI smoke 为验收事实，IDE 差异必须留在宿主边界。

### D06 不变量在 Qoder 上的证明义务

- 未选择 `qoder` 的历史单值/数组配置保持原行为；`all` 新展开显式包含 Qoder 并由回归测试锁定。
- OpenLogos 只更新可证明由自身拥有的插件与 managed block；Qoder settings、不同 identity 插件、未知文件和 AGENTS marker 外内容默认 preserved。
- 每次 PreToolUse 调用重新读取 lifecycle、active change 与 `proposal_step`；SessionStart 上下文不得充当授权缓存。
- lifecycle 与同步版本戳只在全部已选 Adapter 资产事务成功后提交；模板缺失、owner 冲突、协议损坏或读回失败均不得产生全局成功。
- 未知潜在写工具、路径逃逸、状态矛盾或共享决策异常必须显式 deny；其它非零退出不能冒充 hard guard 成功。

### Qoder 落地来源

- 提案：`qoder-adapter-foundation`
- 用户决策：采用 staging 真实 tarball + 真实 Qoder CLI 验证，不执行公开发布。
- Qoder Plugin Reference：`https://docs.qoder.com/cli/plugins-reference`
- Qoder Hooks：`https://docs.qoder.com/cli/hooks`
- 关联规范：`spec/qoder-plugin.md`、`spec/agents-md.md`、`spec/pretooluse-guard.md`

## D06 WorkBuddy Adapter 落地补充

### WorkBuddy 落地结论

WorkBuddy 作为 D06 下的第三个后续薄 Adapter 接入。稳定 id 为 `workbuddy`；Registry 继续独占规范值、capability、`all` 展开和稳定顺序，init/adopt/sync/launch 只消费 Adapter 合同，不新增 WorkBuddy 名称分支。

WorkBuddy Adapter 的所有权仅限宿主协议和资产布局：

1. 使用 `.workbuddy-plugin/plugin.json` 与 `skills/`、`commands/`、`agents/`、`hooks/hooks.json` 交付插件组件。
2. Hook 子进程通过官方 `${CODEBUDDY_PLUGIN_ROOT}` 定位共享 Node.js runtime，不发明变量，不依赖仓库源码或当前 shell。
3. SessionStart 只映射共享 `SessionContextService` 的磁盘事实，不读取 WorkBuddy 原生记忆，也不构成授权。
4. PreToolUse 只归一化 WorkBuddy/CodeBuddy 的事件字段、CLI/桌面工具名和输出/退出语义；最终 allow/deny 委托共享 `GuardDecisionService`。
5. WorkBuddy 原生记忆属于宿主和用户，明确排除在 OpenLogos 资产、状态、同步、备份和回滚集合之外。

### D06 不变量在 WorkBuddy 上的证明义务

- 未选择 `workbuddy` 的历史配置保持原行为；`all` 新展开显式包含 WorkBuddy，并由既有六宿主回归锁定。
- OpenLogos 只更新可证明由自身拥有的 plugin identity 与 managed block；settings、其它插件、项目资产、未知文件和原生记忆默认 preserved。
- 每次 PreToolUse 重读 lifecycle、active change 和 `proposal_step`；静态指令、SessionStart 或原生记忆不得成为授权缓存。
- allow 必须 exit 0；deny 必须有非空 reason 并 exit 2。非法输入、未知潜在写工具、路径逃逸、状态矛盾和共享决策异常 fail-closed。
- lifecycle 与同步版本戳只在全部 Adapter 事务成功后提交；模板缺失、owner 冲突、协议损坏或读回失败不得产生总成功。
- `0.13.28` tarball 缺声明资产必须预检失败；真实 WorkBuddy 5.3.5+ 的插件/Hook capability 和 smoke 不得由 mock 替代。

### 版本与部署决策

- 本能力目标版本为 `0.13.28`，部署对象是本提案构建的真实 npm tarball。
- 仅在 verify PASS 且用户另行授权后部署到隔离 staging；使用真实 WorkBuddy 5.3.5+ 新 session 验证。
- 不执行 npm publish、Git tag、GitHub Release、官网部署或 `git push`。

### WorkBuddy 落地来源

- 提案：`workbuddy-adapter-foundation`
- 用户决策：隔离 staging 的真实 `0.13.28` npm tarball + WorkBuddy 5.3.5+ 验证，不公开发布。
- WorkBuddy Plugins：`https://www.codebuddy.cn/docs/workbuddy/Plugins`
- CodeBuddy Plugin Reference：`https://www.codebuddy.cn/docs/cli/plugins-reference`
- WorkBuddy Memory：`https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Memory`
- CodeBuddy Hooks：`https://www.codebuddy.cn/docs/cli/hooks`
- WorkBuddy Changelog：`https://www.codebuddy.cn/docs/workbuddy/Changelog`
- 关联规范：`spec/workbuddy-plugin.md`、`spec/agents-md.md`、`spec/pretooluse-guard.md`

## D06 TRAE 国际版/CN non-deployable 决策补充

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

## D06 TRAE 本地负向制品验证边界

### 决策结论

TRAE 国际版 `3.5.91` 与 CN `3.3.93` 的 hard guard 结论继续为 **BLOCKED**，规范 id `trae` 继续不注册且不得部署 TRAE Adapter。允许执行的部署仅指：将 OpenLogos CLI `0.13.29` 真实 npm tarball 安装到一次性 `local-isolated` 环境，并以负向 smoke 证明安装产物仍遵守 TRAE 排除合同。该活动不构成 TRAE capability PASS，也不重新开启 D06 Adapter 设计。

### 允许与禁止的部署语义

1. 允许对象仅为 `@miniidealab/openlogos@0.13.29` 候选 tarball；禁止对象包括 TRAE Adapter、插件、Hook normalizer、wrapper、模板和任何 `.trae/**` 托管资产。
2. 候选制品必须安装到一次性 npm prefix、HOME、缓存和项目目录；实际 CLI 解析路径必须位于该 prefix，禁止 workspace link、源码直跑、全局安装或真实用户 HOME。
3. `all`、帮助、交互选择与结构化支持列表继续只含既有七宿主；显式 `trae` 必须在首个目标写入前 fail loud。
4. TRAE Rules、Skills、Agents、Hooks、MCP、settings、账号、`enabled_folders`、原生记忆和未知文件保持宿主/用户所有；runner 不读取正文、不启动真实 TRAE 写工具，也不改变其状态。
5. 允许在同一隔离 prefix 演练 `0.13.29 → 0.13.28 → 0.13.29`，但两个 tarball 均须版本精确、SHA-256 可追溯且仅作用于一次性目录。
6. 不执行 npm publish、dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署或 `git push`。

### 判定与重新开启条件

- 负向 smoke 只能报告“OpenLogos 安装产物保持 TRAE non-deployable”，不得报告“TRAE 已支持”或“TRAE hard guard 通过”。
- 任一制品身份、隔离边界、写前拒绝、七宿主回归、TRAE 用户资产哈希或回滚恢复检查失败，部署/smoke 即失败，不得写成功 marker。
- 文件存在、wrapper 直调、Rules/MCP 软拒绝、人工确认或客户端 UI 仍不得作为 hard guard PASS。
- D06 的重新开启条件保持不变：未来独立提案必须让国际版与 CN 的受支持版本共同通过真实内置写工具的完整 fail-closed 矩阵。

### 追溯

- 提案：`trae-local-negative-smoke`
- 场景：S01、S08、S19
- Smoke：SMOKE-core-124～SMOKE-core-129
