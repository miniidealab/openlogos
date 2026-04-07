# 变更提案：部署 spec/ 规范文档到用户项目

## 变更背景

`openlogos init` 生成的 CLAUDE.md/AGENTS.md 和多个 Skill 文件引用了 `spec/` 目录下的规范文档（如 `spec/test-results.md`、`spec/sql-comment-convention.md`），但这些文件从未被部署到用户项目中，npm 包也未包含 `spec/` 目录。

**已验证后果**：AI 看到 `see spec/test-results.md` 引用但找不到文件，退化为猜测格式，导致生成的 reporter 使用 `"passed"` 而非规范要求的 `"pass"`，最终 `openlogos verify` 无法匹配测试结果。

受影响的引用（共 7 处）：
- `CLAUDE.md` 规则 #6 → `spec/test-results.md`
- `test-writer` Skill → `spec/test-results.md`
- `test-orchestrator` Skill → `spec/test-results.md`
- `db-designer` Skill → `spec/sql-comment-convention.md`（×4 处）

## 变更目标

1. 将所有 `spec/*.md` 规范文档打包到 npm 包中
2. `openlogos init` 时将 spec 文件部署到 `logos/spec/`
3. `openlogos sync` 时同步更新 spec 文件（新版本覆盖旧版本）
4. 更新所有引用路径从 `spec/` 到 `logos/spec/`

## 影响范围

| 组件 | 变更内容 |
|------|---------|
| `cli/package.json` | `files` 数组增加 `"spec"` |
| `cli/src/commands/init.ts` | 新增 `deploySpecs()` 函数，`createAgentsMd()` 引用路径更新 |
| `cli/src/commands/sync.ts` | 调用 `deploySpecs()` 同步 spec 文件 |
| `skills/test-writer/` | 引用路径 `spec/` → `logos/spec/` |
| `skills/test-orchestrator/` | 引用路径 `spec/` → `logos/spec/` |
| `skills/db-designer/` | 引用路径 `spec/` → `logos/spec/` |
| `skills/project-init/` | 引用路径 `spec/` → `logos/spec/` |
| `plugin/skills/` | 通过 build 脚本同步更新 |
| `spec/directory-convention.md` | 新增 `logos/spec/` 目录说明（可选） |

## 部署位置

```
logos/
├── logos.config.json
├── logos-project.yaml
├── spec/                  ← 新增
│   ├── test-results.md
│   ├── sql-comment-convention.md
│   ├── workflow.md
│   ├── directory-convention.md
│   ├── logos-project.md
│   ├── change-management.md
│   └── agents-md.md
├── resources/
├── changes/
└── skills/ (claude-code/other)
```

## 部署策略

- **init**：首次创建时全量复制
- **sync**：比对并覆盖更新（spec 由 CLI 包提供，用户不应手动修改）
- **npm prepack**：`spec/` 目录随 `skills/` 一起复制到 cli/ 打包
