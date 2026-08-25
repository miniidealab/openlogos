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
