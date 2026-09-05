# D09：宿主能力声明必须与实测一致（capability honesty）与 Cursor 部分强度边界

- **状态**：accepted
- **日期**：2026-09-05
- **来源**：提案 `cursor-adapter-parity`；RunLogos cursor CLI 适配工作中发现 cursor 降级档（assets 仅 `['agents']`）与 cursor-agent CLI hook 事件子集事实

## 背景

Cursor 自 2026 年起原生支持 Agent Skills（SKILL.md 标准）、subagents 与 `.cursor/hooks.json` hooks 协议，OpenLogos 得以把 cursor 从降级档补齐为三件套宿主。但 cursor-agent CLI 的 hook 事件是子集——不含 `preToolUse`，写入门禁在 CLI 侧达不到 claude-code 的完整预阻断强度。补齐时存在诱惑：为对齐其他宿主而声明完整三件套能力、把事后检测包装成硬拦。一旦虚标，下游（生命周期入口、RunLogos driver、smoke 验收、用户心智）都会基于错误能力假设决策，且这种分歧只在越界写入真正发生时才暴露。

## 决策

1. **capability honesty 不变量**：Registry 中任何宿主 adapter 的 capabilities 声明必须与宿主实测能力一致。能力以真实宿主实测为准（staging 部署必须实测并记录 hook 事件覆盖面）；文档口径只是输入假设。禁止为凑资产三件套或对齐其他宿主而虚标任何能力位。
2. **Cursor 部分强度边界**：cursor 声明 `assets: ['agents', 'plugin', 'hooks']` 且 `preToolUse: false`；写入门禁为「`beforeShellExecution` 硬拦 shell 写入 + `afterFileEdit` 事后检测报告」的部分强度组合；Cursor IDE 经同一 `hooks.json` 自然获得完整 `preToolUse` 硬拦，OpenLogos 不维护第二份配置。
3. **如实呈现义务**：所有面向用户的输出（CLI 反馈、AGENTS.md 托管段、根规范）必须声明 CLI 侧为部分强度，禁止表述为与 claude-code 等价；`afterFileEdit` 报告必须声明「未被阻断」。
4. 宿主能力升级（如 cursor CLI 未来支持 `preToolUse`）必须走独立提案更新 capability，不得随实现顺手翻转。

## 理由

能力声明是 Registry 单一权威（D06）对外的合同；它的可信度决定所有消费方能否安全地「只消费能力、不按宿主名推断」。如实声明 `preToolUse: false` 让部分强度成为显式设计事实——可测试（UT/ST/smoke 断言事后检测语义）、可呈现（用户知道 CLI 侧边界）、可演进（能力翻转有独立提案审计）；虚标则把边界埋进实现细节，等价于在 Registry 里制造影子权威。

## 备选方案

1. **等 cursor CLI 支持 preToolUse 再做 hooks 维度**：拒绝。sessionStart 上下文注入与 shell 硬拦已有真实价值，整体推迟让 cursor 用户继续零机器强制；且官方对 preToolUse「无 ETA」。
2. **声明三件套齐平、guard 仅软约束或把事后检测报告包装成阻断**：拒绝。虚标能力让下游基于错误假设决策，违反 capability honesty；伪装阻断在越界写入真正发生时暴露并摧毁信任。
3. **为 IDE 单独维护完整强度配置、CLI 单独降级配置**：拒绝。同一 `hooks.json` 是 Cursor 宿主事实；双份配置制造第二事实源与漂移面。

## 影响面

- `cli/src/lib/ai-tool-adapter.ts` Registry 的 cursor capability 行与所有消费方。
- `spec/cursor-plugin.md`（能力子集契约）、`spec/pretooluse-guard.md`（Cursor 部分强度合同）、`spec/agents-md.md`（guard 强度说明行）。
- S09 场景门禁链路、S01/S08/S14/S20 资产验收、SMOKE-core-186/187（实测覆盖面与门禁红线）。
- 后续所有新宿主 adapter 提案：capabilities 声明一律以实测为准。

## 来源

- 提案：`cursor-adapter-parity`（C02 用户决策：接受部分强度并如实声明）。
- 关联决策：D06（能力驱动 Adapter Registry 与宿主薄适配层边界）。
