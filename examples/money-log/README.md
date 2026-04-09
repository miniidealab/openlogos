# 轻记账（Money Log）

面向职场人群的轻量级**桌面记账**应用（Electron + React + TypeScript + Vite），数据本地存储（sql.js），支持统计、分类与密码锁。

> 本目录是 [OpenLogos](https://github.com/miniidealab/openlogos) monorepo 中的 **OpenCode 集成官方演示**：在 **OpenCode** 终端 AI 工具中配合 OpenLogos CLI、`.opencode/plugins/openlogos.js` 与 `.opencode/commands/openlogos-*.md` 斜杠命令完成方法论驱动研发。  
> 若你使用 **Claude Code** 并希望对照同类小桌面应用，请优先参考同目录下的 [flowtask](../flowtask/README.md)（Tauri）。

---

## 功能概览

- 快速记账、分类、月度统计
- 应用内密码锁
- 完整 `logos/resources/`（PRD → 设计 → 场景 → 本地 API 规格 → DDL → 测试 → verify）

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面壳 | Electron 28 |
| 前端 | React 18 + TypeScript + Vite |
| 样式 | Tailwind CSS 3 |
| 状态 | Zustand |
| 本地数据库 | sql.js（浏览器端 SQLite） |
| 包管理 | npm |

---

## 环境要求

- Node.js ≥ 18
- [OpenCode](https://opencode.ai)（演示 OpenCode 集成时）
- 全局 OpenLogos CLI：`npm install -g @miniidealab/openlogos`（建议 ≥ 0.5.6）

---

## 本地运行应用

在 **本示例根目录**（同时包含 `package.json` 与 `logos/logos.config.json`）执行：

```bash
cd openlogos/examples/money-log   # 克隆后的路径以本机为准
npm install
npm run dev
```

`npm run dev` 会并行启动 Vite 与 Electron 窗口。

---

## OpenCode + OpenLogos 工作方式

1. **工作目录**：在 `examples/money-log/` 根目录启动 OpenCode（须能读取 `logos/logos.config.json`）。
2. **插件与命令**：仓库内已包含 `.opencode/plugins/openlogos.js` 与 `.opencode/commands/openlogos-*.md`，与 [OpenCode 使用指南](../../docs/opencode.md) 描述一致。
3. **方法论资产**：设计文档在 `logos/resources/`；变更提案示例见 `logos/changes/`（含 `archive/` 历史，仅供学习追溯）。
4. **可选技能**：`.opencode/skills/ui-ux-pro-max/` 为 UI/UX 辅助技能（含数据与脚本），按需使用。

更完整的安装与排错说明见：[docs/opencode.md](../../docs/opencode.md)。

---

## 测试与验收

```bash
cd openlogos/examples/money-log
npm test
# 可选：在仓库根构建 CLI 后执行 verify
# cd ../../cli && npm install && npm run build && cd ../examples/money-log && openlogos verify
```

测试结果通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`，供 `openlogos verify` 读取。

---

## 项目结构（摘要）

```
money-log/
├── src/
│   ├── main/           # Electron 主进程
│   └── renderer/       # React 界面
├── logos/
│   ├── resources/      # PRD、API、测试、verify
│   ├── skills/         # OpenLogos Skills（与 init/sync 部署一致）
│   ├── spec/           # 方法论规范副本
│   └── changes/        # 变更提案（含本提案 repo-integration-official）
├── .opencode/
│   ├── plugins/        # OpenLogos OpenCode 插件
│   ├── commands/       # TUI 斜杠命令
│   └── skills/         # 可选扩展技能（如 ui-ux-pro-max）
├── AGENTS.md / CLAUDE.md
└── opencode.json
```

---

## License

与 OpenLogos monorepo 保持一致；若单独拆仓请自行补充 LICENSE。
