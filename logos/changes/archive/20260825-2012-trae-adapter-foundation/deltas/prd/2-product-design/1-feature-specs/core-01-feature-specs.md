## ADDED — 2.41 TRAE capability BLOCKED 与 non-deployable 功能规格

### 2.41.1 目标

本功能只把 TRAE 国际版/CN 的真实能力结论固化为产品负向契约：没有双客户端 fail-closed hard guard 证据时，Registry、生命周期入口和资产事务均不得把 TRAE 当作可部署宿主。本节不定义 Adapter 实现。

### 2.41.2 能力 Profile

| 能力 | 当前状态 | 产品处理 |
|---|---|---|
| Rules | 支持静态上下文 | 软控制；不构成授权或注册依据 |
| Skills | 支持项目 Skills | 不创建 OpenLogos 托管 Skills |
| 自定义 Agent | 支持宿主 Agent | 宿主/用户所有；不创建 OpenLogos Agent |
| MCP | 支持客户端扩展 | 不能约束已绕过 Hook 的内置写工具 |
| Commands/插件 | 未证明等价稳定合同 | 不发明 manifest、identity 或安装协议 |
| 原生记忆 | 存在不透明宿主状态 | 禁止读取、写入、迁移或用于授权 |
| 写入前 Hook | 有功能迹象但真实 deny 失败 | **BLOCKED**；不建立 normalizer 或 wrapper |

### 2.41.3 Registry 与生命周期行为

- Registry 不登记 `trae`，不提供 alias/capability 占位；`all`、帮助与交互列表只包含现有七个 deployable 宿主。
- `init`、`adopt`、`sync`、`launch` 不出现 TRAE 名称分支，不规划 `.trae/**`、Agent、Rules、Skills、Hooks、MCP 或记忆资产。
- 显式 `trae` 输入返回 Registry 派生的未知/不支持错误，在任何目标写入之前结束；不得借错误处理生成部分资产。
- 未选择 TRAE 的历史配置和既有七宿主执行结果保持字节及顺序兼容。

### 2.41.4 所有权和安全体验

1. `.trae/` 下已有文件、用户/工作区 settings、账号、Rules、Skills、Agents、Commands、MCP、记忆和未知文件均视为外部资产。
2. OpenLogos 不探测记忆正文，不自动切换 `enabled_folders` 等用户信任状态，不通过提示词或人工确认模拟 hard guard。
3. 客户端日志、Hook stdin、退出语义与目标哈希共同构成 capability 证据；仅有文档、UI、文件存在或二进制字符串不算 PASS。

### 2.41.5 重新评估矩阵

未来独立提案须同时覆盖受支持的国际版和 CN：真实内置写/编辑/命令工具、allow/deny、工作区内外、`..`、绝对路径、symlink、未知潜在写工具、非法/超限事件、解析失败、runtime 缺失、状态矛盾与超时。每个拒绝都必须在目标变化前返回非空理由，并由目标 SHA-256 不变证明 fail-closed；任一客户端失败即保持 non-deployable。

### 2.41.6 验收摘要

- S01：Registry、帮助和交互列表不含 TRAE，七宿主顺序不变。
- S08：`all` 不展开 TRAE，显式输入不产生 `.trae/**` 托管资产。
- S09：共享 guard 不存在 TRAE normalizer，软控制不得被标记为 hard guard。
- 部署：目标版本 `0.13.29` 的条件 staging 路径因 BLOCKED 取消，不执行 smoke 或公开发布。
