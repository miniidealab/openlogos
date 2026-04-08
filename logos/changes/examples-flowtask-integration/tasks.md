# 实现任务：examples-flowtask-integration

## 配置

- [x] 根 `.gitignore`：追加 `**/src-tauri/target/`、`**/.claude/settings.local.json`；`/logos/` 改为 `/logos/*` + `!/logos/changes/**`，保证 `logos/changes/` 下新提案可提交
- [x] `examples/flowtask/.gitignore`：合并重复的 `src-tauri/target/` 行

## 文档与示例

- [x] `examples/flowtask/README.md`：OpenLogos 链接改为 `https://github.com/miniidealab/openlogos`
- [x] `examples/flowtask/AGENTS.md`、`CLAUDE.md`：项目根目录说明改为 `openlogos/examples/flowtask`（无本机路径）
- [x] 根 `README.md`：「方式三」与 `examples/` 结构说明改为 FlowTask（pnpm + tauri）
- [x] `examples/README.md`：FlowTask 章节替换 TaskFlow API
- [x] `examples/demo-saas-project/README.md`：指向 `../flowtask/`

## 验收

- [x] `git check-ignore -v` 验证 `target` 与 `settings.local.json` 被忽略
- [x] 仓库内 `taskflow-api` 字符串检索为 0（文档与脚本中无残留路径引用）
