## ADDED — guard-check 工作目录收敛与 fail-closed 测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S09-313 | fail-closed 边界 | CLAUDE_PROJECT_DIR 指向不可进入目录 → exit 2 + 可读 reason；变量缺失且 cwd 为项目子目录 → exit 2 + 诊断（不再静默 exit 0）；变量缺失且 cwd 为项目根 → 按 cwd 判定（0.14.20 兼容不回归）；变量指向的根确无 logos.config.json → exit 0 放行（真非 OpenLogos 项目分支保持） |
| UT-S09-314 | 子目录 cwd 判定一致性 | 子目录 cwd + 变量在场：launched 无提案的 Edit/Write/Bash 阻断（exit 2 + 既有 reason 结构）、有提案范围内放行、`git push` 等 BASH_SAFE_PATTERNS 白名单放行、Edit 绝对 file_path realpath 归一化——逐项与项目根 cwd 结果一致 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S09-120 | 子目录 cwd 端到端拦截与放行 | 以 stdin JSON + env 模拟 Claude Code hook 调用（cwd=项目子目录）：无提案 Edit 源码 → exit 2 且 stdout reason 含变更管理指引；创建提案（guard 文件在场）后同一调用 → exit 0 放行 |

### 自动化与证据要求

- guard-check 为 bash 脚本：用例以 spawnSync 直接驱动脚本（stdin JSON、cwd、env 三输入矩阵），不 mock 文件系统。
- 每个用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S09"`；失败不得写 pass。
