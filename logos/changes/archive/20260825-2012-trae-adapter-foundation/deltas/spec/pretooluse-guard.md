## ADDED — TRAE PreToolUse 非适配与 hard guard 排除合同

### 当前合同状态

OpenLogos 当前没有 TRAE 国际版或 TRAE CN 的可依赖 PreToolUse 映射。国际版 `3.5.91` 与 CN `3.3.93` 的真实内置写入都在项目 `.trae/hooks.json` 拒绝脚本未运行时改变目标文件，因此不得为 TRAE 声明 SessionStart/PreToolUse 支持、协议 normalizer、wrapper 或共享 guard 绑定。

### 不得替代 hard guard 的能力

以下能力只能提供上下文、扩展或人工安全提示，不能成为 OpenLogos 写入授权边界：

- Rules、Skills、自定义 Agent 或 prompt 中的“禁止写入”指令；
- MCP 工具自身的拒绝，因为它不能证明 TRAE 内置 `Write`、编辑或命令工具受控；
- Hooks UI、配置文件存在、客户端二进制字符串或 wrapper 直接调用成功；
- 用户人工确认、工作区 trust/`enabled_folders` 状态或原生记忆中的约定。

OpenLogos 不得静默修改工作区信任状态以激活项目命令，也不得读取 TRAE 原生记忆、账号、settings 或用户资产来推断权限。

### Registry 与运行时约束

1. `AiToolAdapterRegistry` 不登记 `trae`，共享 `GuardDecisionService` 不接受 TRAE 专有事件或工具名映射。
2. 不生成 `.trae/hooks.json`、runtime、manifest、托管 Rules/Skills/Agents/MCP 或其它 guard 资产。
3. `init`、`adopt`、`sync`、`launch` 和 `all` 不得因探测到 TRAE 安装而自动写入资产。
4. 显式选择 `trae` 必须在目标写入前按未知/不支持宿主失败，并保持现有 `.trae/**` 字节不变。

### 未来 PASS 的最低证据

重新评估须由国际版与 CN 的受支持版本分别通过真实宿主矩阵，而不是仅调用 Hook 脚本：

| 类别 | 必须证明的行为 |
|---|---|
| allow | 合法范围内真实工具执行，结果和协议可审计 |
| deny | 真实工具不执行、非空理由、目标 SHA-256 不变 |
| 路径 | 工作区外、`..`、绝对路径、symlink 逃逸均在执行前拒绝 |
| 工具 | 内置写/编辑/命令及未知潜在写工具均覆盖 |
| 异常 | 非法/超限输入、解析失败、runtime 缺失、状态矛盾、超时全部 fail-closed |
| 启用 | 项目资产可可靠启用，且不由 Adapter 静默篡改用户信任状态 |

任一客户端或任一异常路径 fail-open，结论均保持 BLOCKED。只有未来独立提案通过完整矩阵后，才能定义 TRAE 工具名、输入字段、stdout/stderr、退出码与共享决策映射。
