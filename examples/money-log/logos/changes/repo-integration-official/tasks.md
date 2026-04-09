# 实现任务：repo-integration-official

## Phase 1：示例卫生与入口文档

- [x] 新增 `examples/money-log/.gitignore`（`node_modules/`、`dist/`、`release/`、`__pycache__/`、`.DS_Store` 等）
- [x] 删除 `.opencode/skills/**/__pycache__/` 等已生成的 Python 缓存目录
- [x] 删除 `logos/.openlogos-guard`（本提案实施完成，不将活跃 guard 提交到主仓）
- [x] 新增 `examples/money-log/README.md`：定位 **OpenCode 集成演示**、技术栈、安装运行、`openlogos verify` 与 monorepo 路径说明

## Phase 2：主仓文档与对位说明

- [x] 更新 `examples/README.md`：FlowTask = **Claude Code** 桌面演示；Money Log = **OpenCode** 桌面演示
- [x] 更新根目录 `README.md`：方式三并列两个示例；`examples/` 描述与两工具对位一致
- [x] 更新 `examples/flowtask/README.md` 开篇与「如何用 OpenLogos」：明确 **Claude Code** 官方演示定位
- [x] 更新 `docs/opencode.md`：增加指向 `examples/money-log/` 的「完整示例」小节

## Phase 3：示例内指令一致性

- [x] 修正 `examples/money-log/AGENTS.md` 中 openlogos CLI 规则（Electron 项目无 `src-tauri/`，改为 `src/` 等）

## 验收

- [x] `examples/money-log` 内无 `__pycache__`、无 `logos/.openlogos-guard`
- [x] 从 monorepo 根目录阅读 `examples/README.md` 可区分两个示例的工具定位
