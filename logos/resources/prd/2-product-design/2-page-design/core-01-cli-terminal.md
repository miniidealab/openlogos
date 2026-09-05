# CLI 终端交互模拟

> Phase 2 产品设计 · CLI 原型
>
> 涵盖场景：S01、S08、S09、S11
>
> 最后更新：2026-04-05

---

## S01: openlogos init

### 正常：默认英文（Cursor）

```
$ openlogos init my-saas-project

Choose language / 选择语言:
  1. English (default)
  2. 中文

Your choice [1/2] (default: 1):

Choose AI coding tool / 选择 AI 编码工具:
  1. Cursor (default)
  2. Claude Code
  3. Other

Your choice [1/2/3] (default: 1):

Creating OpenLogos project structure for "my-saas-project"...

  ✓ logos/resources/prd/1-product-requirements/
  ✓ logos/resources/prd/2-product-design/1-feature-specs/
  ✓ logos/resources/prd/2-product-design/2-page-design/
  ✓ logos/resources/prd/3-technical-plan/1-architecture/
  ✓ logos/resources/prd/3-technical-plan/2-scenario-implementation/
  ✓ logos/resources/api/
  ✓ logos/resources/database/
  ✓ logos/resources/test/
  ✓ logos/resources/scenario/
  ✓ logos/changes/
  ✓ logos/changes/archive/
  ✓ logos/logos.config.json
  ✓ logos/logos-project.yaml
  ✓ AGENTS.md
  ✓ CLAUDE.md
  ✓ 12 skills deployed to .cursor/rules/

Project initialized. Next steps:
  1. Review logos/logos.config.json to verify project settings
  2. Start with Phase 1: tell AI "Help me write requirements"
  3. Run `openlogos status` to check progress at any time
```

### 正常：选择 Claude Code

```
$ openlogos init my-saas-project

Choose language / 选择语言:
  1. English (default)
  2. 中文

Your choice [1/2] (default: 1):

Choose AI coding tool / 选择 AI 编码工具:
  1. Cursor (default)
  2. Claude Code
  3. Other

Your choice [1/2/3] (default: 1): 2

Creating OpenLogos project structure for "my-saas-project"...

  ✓ logos/resources/prd/1-product-requirements/
  ...（同上）
  ✓ AGENTS.md
  ✓ CLAUDE.md
  ✓ 12 skills deployed to logos/skills/

Project initialized. Next steps:
  1. Review logos/logos.config.json to verify project settings
  2. Start with Phase 1: tell AI "Help me write requirements"
  3. Run `openlogos status` to check progress at any time
```

### 正常：选择中文（Cursor）

```
$ openlogos init my-saas-project

Choose language / 选择语言:
  1. English (default)
  2. 中文

Your choice [1/2] (default: 1): 2

选择 AI 编码工具:
  1. Cursor（默认）
  2. Claude Code
  3. 其他

请选择 [1/2/3]（默认: 1）:

Creating OpenLogos project structure for "my-saas-project"...

  ✓ logos/resources/prd/1-product-requirements/
  ...（同上）
  ✓ CLAUDE.md
  ✓ 12 个 Skills 已部署到 .cursor/rules/

项目初始化完成。下一步：
  1. 检查 logos/logos.config.json 确认项目配置
  2. 开始 Phase 1：对 AI 说「帮我写需求文档」
  3. 随时运行 `openlogos status` 查看进度
```

### 正常：显式项目名与 package.json 不一致（用户选择传入名）

```
$ cat package.json | grep name
  "name": "@myorg/old-name",

$ openlogos init my-new-name

Choose language / 选择语言:
  1. English (default)
  2. 中文

Your choice [1/2] (default: 1):

⚠ Project name conflict detected:
  1. "my-new-name"  ← your input
  2. "old-name"     ← from package.json

Which name would you like to use? [1/2] (default: 1): 1

Creating OpenLogos project structure for "my-new-name"...

  ✓ logos/resources/prd/1-product-requirements/
  ...（同上）
  ✓ CLAUDE.md

Project initialized. Next steps:
  1. Review logos/logos.config.json to verify project settings
  2. Start with Phase 1: tell AI "Help me write requirements"
  3. Run `openlogos status` to check progress at any time
```

### 正常：显式项目名与 package.json 不一致（用户选择配置名）

```
$ openlogos init my-new-name

Choose language / 选择语言:
  1. English (default)
  2. 中文

Your choice [1/2] (default: 1):

⚠ Project name conflict detected:
  1. "my-new-name"  ← your input
  2. "old-name"     ← from package.json

Which name would you like to use? [1/2] (default: 1): 2

Creating OpenLogos project structure for "old-name" ← from package.json...

  ✓ logos/resources/prd/1-product-requirements/
  ...（同上）
  ✓ CLAUDE.md

Project initialized. Next steps:
  1. Review logos/logos.config.json to verify project settings
  2. Start with Phase 1: tell AI "Help me write requirements"
  3. Run `openlogos status` to check progress at any time
```

### 正常：自动探测（有 package.json）

```
$ ls package.json
package.json

$ cat package.json | grep name
  "name": "@myorg/my-saas-app",

$ openlogos init

Choose language / 选择语言:
  1. English (default)
  2. 中文

Your choice [1/2] (default: 1):

Creating OpenLogos project structure for "my-saas-app" ← from package.json...

  ✓ logos/resources/prd/1-product-requirements/
  ...（同上）
  ✓ CLAUDE.md

Project initialized. Next steps:
  1. Review logos/logos.config.json to verify project settings

  Tip: Project name "my-saas-app" was auto-detected ← from package.json.
       To change it, edit logos/logos.config.json and run `openlogos sync`.

  2. Start with Phase 1: tell AI "Help me write requirements"
  3. Run `openlogos status` to check progress at any time
```

### 正常：自动探测（无包管理文件，使用目录名）

```
$ basename $(pwd)
cool-project

$ openlogos init

Choose language / 选择语言:
  1. English (default)
  2. 中文

Your choice [1/2] (default: 1):

Creating OpenLogos project structure for "cool-project" ← from directory name...

  ✓ logos/resources/prd/1-product-requirements/
  ...（同上）
  ✓ CLAUDE.md

Project initialized. Next steps:
  1. Review logos/logos.config.json to verify project settings

  Tip: Project name "cool-project" was auto-detected ← from directory name.
       To change it, edit logos/logos.config.json and run `openlogos sync`.

  2. Start with Phase 1: tell AI "Help me write requirements"
  3. Run `openlogos status` to check progress at any time
```

### 异常：项目已初始化

```
$ openlogos init
Error: logos/logos.config.json already exists in current directory.
This directory has already been initialized as an OpenLogos project.
```

退出码：1

---

## S08: openlogos sync

### 正常：同步成功（含 name 同步）

```
$ openlogos sync

Syncing project files...

  ✓ logos-project.yaml name synced to "my-saas-app"
  ✓ AGENTS.md updated
  ✓ CLAUDE.md updated
  ✓ 12 skills synced to .cursor/rules/

Sync complete.
```

### 正常：同步成功（name 未变）

```
$ openlogos sync

Syncing project files...

  ✓ AGENTS.md updated
  ✓ CLAUDE.md updated
  ✓ 12 skills synced to .cursor/rules/

Sync complete.
```

### 异常：未初始化

```
$ openlogos sync
Error: logos/logos.config.json not found.
Run `openlogos init` first to initialize the project.
```

退出码：1

---

## S09: 变更管理

### S09-1: openlogos change

#### 正常：创建变更提案（locale=en）

```
$ openlogos change add-remember-me

Creating change proposal: add-remember-me

  ✓ logos/changes/add-remember-me/proposal.md
  ✓ logos/changes/add-remember-me/tasks.md
  ✓ logos/changes/add-remember-me/deltas/

Change proposal created. Next steps:
  1. Tell AI: "Help me fill in change proposal add-remember-me"
  2. AI will analyze impact and fill in proposal.md + tasks.md
  3. Then work through tasks.md, putting deltas in deltas/
  4. When done, run `openlogos merge add-remember-me` to generate merge instructions
```

#### 正常：创建变更提案（locale=zh）

```
$ openlogos change add-remember-me

创建变更提案：add-remember-me

  ✓ logos/changes/add-remember-me/proposal.md
  ✓ logos/changes/add-remember-me/tasks.md
  ✓ logos/changes/add-remember-me/deltas/

变更提案已创建。下一步：
  1. 对 AI 说：「帮我填写变更提案 add-remember-me」
  2. AI 将分析影响范围并填写 proposal.md + tasks.md
  3. 然后按 tasks.md 逐项产出 delta 文件到 deltas/
  4. 完成后运行 `openlogos merge add-remember-me` 生成合并指令
```

#### 异常：缺少 slug

```
$ openlogos change
Error: Missing change proposal name.
Usage: openlogos change <slug>
Example: openlogos change add-remember-me
```

退出码：1

#### 异常：同名提案已存在

```
$ openlogos change add-remember-me
Error: Change proposal 'add-remember-me' already exists.
```

退出码：1

#### 异常：未初始化

```
$ openlogos change add-remember-me
Error: logos/logos.config.json not found.
Run `openlogos init` first to initialize the project.
```

退出码：1

### S09-2: openlogos merge

#### 正常：生成合并指令（locale=en）

```
$ openlogos merge add-remember-me

📋 Merge Summary:
  - Change proposal: add-remember-me
  - Delta files: 3
    deltas/prd/requirements-delta.md → logos/resources/prd/
    deltas/api/auth-delta.yaml → logos/resources/api/
    deltas/database/auth-delta.sql → logos/resources/database/

  ✓ logos/changes/add-remember-me/MERGE_PROMPT.md

💡 Tell AI: "Read logos/changes/add-remember-me/MERGE_PROMPT.md and execute merge"

After merge, run `openlogos archive add-remember-me` to archive the proposal.
```

#### 正常：生成合并指令（locale=zh）

```
$ openlogos merge add-remember-me

📋 合并摘要：
  - 变更提案：add-remember-me
  - Delta 文件：3 个
    deltas/prd/requirements-delta.md → logos/resources/prd/
    deltas/api/auth-delta.yaml → logos/resources/api/
    deltas/database/auth-delta.sql → logos/resources/database/

  ✓ logos/changes/add-remember-me/MERGE_PROMPT.md

💡 对 AI 说：「读取 logos/changes/add-remember-me/MERGE_PROMPT.md 并执行合并」

合并完成后，运行 `openlogos archive add-remember-me` 归档提案。
```

#### 异常：无 delta 文件

```
$ openlogos merge add-remember-me
Error: No delta files found in logos/changes/add-remember-me/deltas/.
Add delta files before running merge.
```

退出码：1

#### 异常：提案不存在

```
$ openlogos merge add-remember-me
Error: Change proposal 'add-remember-me' not found.
```

退出码：1

#### 异常：缺少 slug

```
$ openlogos merge
Error: Missing change proposal name.
Usage: openlogos merge <slug>
Example: openlogos merge add-remember-me
```

退出码：1

### S09-3: openlogos archive

#### 正常：归档成功（locale=en）

```
$ openlogos archive add-remember-me

✓ Change proposal 'add-remember-me' archived.
  logos/changes/add-remember-me/ → logos/changes/archive/add-remember-me/
```

#### 正常：归档成功（locale=zh）

```
$ openlogos archive add-remember-me

✓ 变更提案 'add-remember-me' 已归档。
  logos/changes/add-remember-me/ → logos/changes/archive/add-remember-me/
```

#### 异常：提案不存在

```
$ openlogos archive add-remember-me
Error: Change proposal 'add-remember-me' not found.
```

退出码：1

#### 异常：归档目标已存在

```
$ openlogos archive add-remember-me
Error: Archive 'add-remember-me' already exists in logos/changes/archive/.
```

退出码：1

#### 异常：缺少 slug

```
$ openlogos archive
Error: Missing change proposal name.
Usage: openlogos archive <slug>
Example: openlogos archive add-remember-me
```

退出码：1

---

## S11: openlogos status

### 正常：有部分进度（locale=en）

```
$ openlogos status

📊 OpenLogos Project Status

──────────────────────────────────────────────────
✅  Phase 1 · Requirements (WHY)
     └─ 01-requirements.md
🔲  Phase 2 · Product Design (WHAT)
🔲  Phase 3-0 · Architecture
🔲  Phase 3-1 · Scenario Modeling
🔲  Phase 3-2 · API Design
🔲  Phase 3-2 · Database Design
🔲  Phase 3-3a · Test Case Design (Unit + Scenario)
🔲  Phase 3-3b · API Orchestration Tests
──────────────────────────────────────────────────

💡 Suggested next step: Phase 2 · Product Design (WHAT)
   → Tell AI: "Do product design based on requirements"
```

### 正常：有部分进度（locale=zh）

```
$ openlogos status

📊 OpenLogos Project Status

──────────────────────────────────────────────────
✅  Phase 1 · 需求文档 (WHY)
     └─ 01-requirements.md
🔲  Phase 2 · 产品设计 (WHAT)
🔲  Phase 3-0 · 技术架构
🔲  Phase 3-1 · 场景建模
🔲  Phase 3-2 · API 设计
🔲  Phase 3-2 · 数据库设计
🔲  Phase 3-3a · 测试用例设计（单元 + 场景）
🔲  Phase 3-3b · API 编排测试
──────────────────────────────────────────────────

💡 建议下一步：Phase 2 · 产品设计 (WHAT)
   → 对 AI 说：「基于需求文档做产品设计」
```

### 正常：有活跃变更提案

```
$ openlogos status

📊 OpenLogos Project Status

──────────────────────────────────────────────────
✅  Phase 1 · Requirements (WHY)
     └─ 01-requirements.md
✅  Phase 2 · Product Design (WHAT)
     └─ 00-information-architecture.md
     └─ 01-cli-interaction-design.md
🔲  Phase 3-0 · Architecture
🔲  Phase 3-1 · Scenario Modeling
🔲  Phase 3-2 · API Design
🔲  Phase 3-2 · Database Design
🔲  Phase 3-3a · Test Case Design (Unit + Scenario)
🔲  Phase 3-3b · API Orchestration Tests
──────────────────────────────────────────────────

📝 Active Change Proposals
     └─ add-remember-me (proposal.md ✓ | tasks.md ✓ | deltas: 3 files)
     └─ fix-login-bug (proposal.md ✓ | tasks.md ✗ | deltas: 0 files)
──────────────────────────────────────────────────

💡 Suggested next step: Phase 3-0 · Architecture
   → Tell AI: "Help me design the technical architecture"
```

### 正常：空项目

```
$ openlogos status

📊 OpenLogos Project Status

──────────────────────────────────────────────────
🔲  Phase 1 · Requirements (WHY)
🔲  Phase 2 · Product Design (WHAT)
🔲  Phase 3-0 · Architecture
🔲  Phase 3-1 · Scenario Modeling
🔲  Phase 3-2 · API Design
🔲  Phase 3-2 · Database Design
🔲  Phase 3-3a · Test Case Design (Unit + Scenario)
🔲  Phase 3-3b · API Orchestration Tests
──────────────────────────────────────────────────

💡 Suggested next step: Phase 1 · Requirements (WHY)
   → Tell AI: "Help me write requirements"
```

### 正常：全部完成（locale=en）

```
$ openlogos status

📊 OpenLogos Project Status

──────────────────────────────────────────────────
✅  Phase 1 · Requirements (WHY)
     └─ 01-requirements.md
✅  Phase 2 · Product Design (WHAT)
     └─ 00-information-architecture.md
     └─ 01-cli-interaction-design.md
     └─ 02-skills-interaction-design.md
✅  Phase 3-0 · Architecture
     └─ 01-architecture-overview.md
✅  Phase 3-1 · Scenario Modeling
     └─ S01-cli-init.md
     └─ S02-prd-writer.md
✅  Phase 3-2 · API Design
     └─ cli.yaml
✅  Phase 3-2 · Database Design
     └─ schema.sql
✅  Phase 3-3a · Test Case Design (Unit + Scenario)
     └─ S01-test-cases.md
✅  Phase 3-3b · API Orchestration Tests
     └─ cli-init.json
──────────────────────────────────────────────────

🎉 All phases complete! Ready for AI code generation.
   → Tell AI: "Implement S01 according to specs"
```

### 正常：全部完成（locale=zh）

```
$ openlogos status

📊 OpenLogos Project Status

──────────────────────────────────────────────────
✅  Phase 1 · 需求文档 (WHY)
     └─ 01-requirements.md
✅  Phase 2 · 产品设计 (WHAT)
     └─ 00-information-architecture.md
     └─ 01-cli-interaction-design.md
     └─ 02-skills-interaction-design.md
✅  Phase 3-0 · 技术架构
     └─ 01-architecture-overview.md
✅  Phase 3-1 · 场景建模
     └─ S01-cli-init.md
     └─ S02-prd-writer.md
✅  Phase 3-2 · API 设计
     └─ cli.yaml
✅  Phase 3-2 · 数据库设计
     └─ schema.sql
✅  Phase 3-3a · 测试用例设计（单元 + 场景）
     └─ S01-test-cases.md
✅  Phase 3-3b · API 编排测试
     └─ cli-init.json
──────────────────────────────────────────────────

🎉 所有阶段已完成！可以开始让 AI 生成代码。
   → 对 AI 说：「按 S01 的规格帮我实现」
```

### 异常：未初始化

```
$ openlogos status
Error: logos/logos.config.json not found.
Run `openlogos init` first to initialize the project.
```

退出码：1

---

## S13: openlogos verify

### 正常：全部通过（英文）

```
$ openlogos verify

🔍 OpenLogos Test Verification

Reading test results: logos/resources/verify/test-results.jsonl
Reading test cases: logos/resources/test/

─────────────────────────────────────────────────
📊 Results Summary
─────────────────────────────────────────────────
  Total defined:  10 cases (7 UT + 3 ST)
  Total executed: 10 cases
  ✅ Passed:      10
  ❌ Failed:       0
  ⏭️  Skipped:     0
─────────────────────────────────────────────────
  Coverage:  100%  (10/10)
  Pass rate: 100%  (10/10)
─────────────────────────────────────────────────

✅ Gate 3.5: PASS

📄 Report: logos/resources/verify/acceptance-report.md
```

退出码：0

### 正常：全部通过（中文）

```
$ openlogos verify

🔍 OpenLogos 测试验收

读取测试结果：logos/resources/verify/test-results.jsonl
读取测试用例：logos/resources/test/

─────────────────────────────────────────────────
📊 结果摘要
─────────────────────────────────────────────────
  定义用例：  10 个（7 UT + 3 ST）
  执行用例：  10 个
  ✅ 通过：    10
  ❌ 失败：     0
  ⏭️  跳过：     0
─────────────────────────────────────────────────
  覆盖度：100%（10/10）
  通过率：100%（10/10）
─────────────────────────────────────────────────

✅ Gate 3.5：PASS

📄 报告：logos/resources/verify/acceptance-report.md
```

退出码：0

### 正常：部分失败

```
$ openlogos verify

🔍 OpenLogos Test Verification

Reading test results: logos/resources/verify/test-results.jsonl
Reading test cases: logos/resources/test/

─────────────────────────────────────────────────
📊 Results Summary
─────────────────────────────────────────────────
  Total defined:  10 cases (7 UT + 3 ST)
  Total executed: 10 cases
  ✅ Passed:       8
  ❌ Failed:        2
  ⏭️  Skipped:      0
─────────────────────────────────────────────────
  Coverage:  100%  (10/10)
  Pass rate:  80%  (8/10)
─────────────────────────────────────────────────

❌ Failed cases:
  UT-S01-03  Expected exit code 0, got 1
  ST-S01-02  Timeout after 5000ms

❌ Gate 3.5: FAIL

📄 Report: logos/resources/verify/acceptance-report.md
```

退出码：1

### 正常：有未覆盖用例

```
$ openlogos verify

🔍 OpenLogos Test Verification

Reading test results: logos/resources/verify/test-results.jsonl
Reading test cases: logos/resources/test/

─────────────────────────────────────────────────
📊 Results Summary
─────────────────────────────────────────────────
  Total defined:  10 cases (7 UT + 3 ST)
  Total executed:  7 cases
  ✅ Passed:        7
  ❌ Failed:         0
  ⏭️  Skipped:       0
─────────────────────────────────────────────────
  Coverage:   70%  (7/10)
  Pass rate: 100%  (7/7)
─────────────────────────────────────────────────

⚠️  Uncovered cases (3):
  UT-S01-05  (defined in S01-test-cases.md)
  UT-S01-06  (defined in S01-test-cases.md)
  ST-S01-03  (defined in S01-test-cases.md)

❌ Gate 3.5: FAIL (incomplete coverage)

📄 Report: logos/resources/verify/acceptance-report.md
```

退出码：1

### 异常：结果文件不存在

```
$ openlogos verify

Error: No test results found at logos/resources/verify/test-results.jsonl
Run your tests first, then try again.
```

退出码：1

### 异常：项目未初始化

```
$ openlogos verify

Error: logos/logos.config.json not found.
Run `openlogos init` first to initialize the project.
```

退出码：1

---

## 全局：帮助与版本

### openlogos --help

```
$ openlogos --help

openlogos - CLI tool for the OpenLogos methodology

Usage:
  openlogos <command> [options]

Commands:
  init [name]        Initialize a new OpenLogos project structure
  sync               Regenerate AI instruction files (AGENTS.md, CLAUDE.md)
  status             Show current project phase and suggest next steps
  verify             Verify test results against test case specs
  change <slug>      Create a change proposal for iterative updates
  merge <slug>       Generate MERGE_PROMPT.md for AI to execute delta merging
  archive <slug>     Archive a completed change proposal

Options:
  --help, -h         Show this help message
  --version, -v      Show version number

Examples:
  openlogos init my-saas-project
  openlogos sync
  openlogos status
  openlogos change add-remember-me
  openlogos merge add-remember-me
  openlogos archive add-remember-me

Learn more: https://openlogos.ai
```

### openlogos --version

```
$ openlogos --version
0.1.0
```

### 未知命令

```
$ openlogos deploy
Unknown command: deploy

openlogos - CLI tool for the OpenLogos methodology
...（完整帮助信息）
```

退出码：1
