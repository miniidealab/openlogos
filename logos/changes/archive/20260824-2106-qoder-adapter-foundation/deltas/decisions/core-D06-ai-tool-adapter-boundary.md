## ADDED — D06 Qoder Adapter 落地补充

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
