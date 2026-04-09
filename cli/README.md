# OpenLogos CLI

[`@miniidealab/openlogos`](https://www.npmjs.com/package/@miniidealab/openlogos) 是 **OpenLogos** 方法论的官方命令行工具：在项目中初始化 `logos/` 目录、部署 AI Skills 与规范、执行阶段检测与测试验收（`verify`）等。

- **官网**：[openlogos.ai](https://openlogos.ai)  
- **源码与完整文档**：[github.com/miniidealab/openlogos](https://github.com/miniidealab/openlogos)（monorepo，本包位于 `cli/` 目录）  
- **更新日志（版本说明）**：[CHANGELOG.md](https://github.com/miniidealab/openlogos/blob/master/CHANGELOG.md)

---

## 安装

需要 **Node.js ≥ 18**。

```bash
npm install -g @miniidealab/openlogos
openlogos --version
```

---

## 常用命令

| 命令 | 说明 |
|------|------|
| `openlogos init [name]` | 初始化项目：`logos.config.json`、`logos-project.yaml`、`AGENTS.md` / `CLAUDE.md`、Skills 与方法论 `spec/` 等 |
| `openlogos sync` | 按当前配置重新生成 AI 指令文件并同步 Skills |
| `openlogos status` | 查看方法论阶段进度与下一步建议 |
| `openlogos next` | 输出下一阶段的引导提示 |
| `openlogos verify` | 读取测试结果 JSONL 与测试用例文档，生成验收报告 |
| `openlogos change <slug>` | 创建变更提案（Delta 工作流） |
| `openlogos merge` / `archive` | 合并与归档变更 |
| `openlogos launch` | 从首轮开发切换到「活跃迭代」并强化变更管理 |

**注意**：请在**项目根目录**（存在 `logos/logos.config.json`）下执行上述命令。

---

## OpenCode 用户

使用 OpenCode 时建议安装 **≥ 0.5.6**，以便获得 `.opencode/commands/` 斜杠命令模板与单包插件部署。说明见仓库内 **[OpenCode 使用指南](https://github.com/miniidealab/openlogos/blob/master/docs/opencode.md)**。

---

## 可运行示例（需克隆仓库）

- **FlowTask**（Tauri，Claude Code 演示）：`examples/flowtask/`  
- **Money Log**（Electron，OpenCode 演示）：`examples/money-log/`

详见仓库 [examples/README.md](https://github.com/miniidealab/openlogos/blob/master/examples/README.md)。

---

## 版本信息

npm 页展示的**当前包版本**以本页顶部包名为准；**历史版本与变更说明**请以仓库 **[CHANGELOG.md](https://github.com/miniidealab/openlogos/blob/master/CHANGELOG.md)** 为准。

---

## License

Apache-2.0
