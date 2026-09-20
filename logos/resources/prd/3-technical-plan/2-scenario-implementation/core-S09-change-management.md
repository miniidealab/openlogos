# S09: 变更管理（change / merge / archive）— 场景实现

> Phase 3 Step 1 · 场景建模

S09 由三个 CLI 子命令组成，覆盖变更提案的完整生命周期：创建 → 合并 → 归档。

## 参与方

| 别名 | 组件 | 说明 |
|------|------|------|
| U | 用户终端 | 执行 CLI 命令的终端 |
| CLI | openlogos CLI | `cli/src/commands/{change,merge,archive}.ts` |
| FS | 本地文件系统 | 变更提案目录 |
| AI | AI 编程工具 | Cursor / Claude Code（执行 merge-executor Skill） |

---

## S09-A: openlogos change

### 时序图

```mermaid
sequenceDiagram
    participant U as 用户终端
    participant CLI as openlogos CLI
    participant FS as 本地文件系统

    U->>CLI: Step 1: openlogos change <slug>
    CLI->>FS: Step 2: 检查 logos/logos.config.json
    FS-->>CLI: 存在/不存在

    alt 不存在
        CLI-->>U: EX-2.1: Error + exit(1)
    end

    alt 未传入 slug
        CLI-->>U: EX-3.1: 缺少参数提示 + exit(1)
    end

    CLI->>FS: Step 3: 检查 logos/.openlogos-guard 是否存在
    FS-->>CLI: 存在/不存在

    alt 存在且指向未归档活动提案
        CLI-->>U: EX-3.2: 活动 guard 冲突 + exit(1)
    end

    CLI->>FS: Step 4: 检查 logos/changes/{slug}/ 是否存在
    FS-->>CLI: 存在/不存在

    alt 已存在
        CLI-->>U: EX-4.1: 同名提案已存在 + exit(1)
    else 不存在
        CLI->>FS: Step 5: 读取 locale
        CLI->>FS: Step 6: 创建 logos/changes/{slug}/ 目录
        CLI->>FS: Step 7: 创建 deltas/ 子目录（prd、api、database、scenario）
        CLI->>FS: Step 8: 写入 proposal.md（i18n 模板）
        CLI->>FS: Step 9: 写入 tasks.md（i18n 模板）
        CLI->>FS: Step 10: 写入 logos/.openlogos-guard
        CLI-->>U: Step 11: 输出文件清单 + Next steps
    end
```

### 步骤说明

1. **开发者**在终端输入 `openlogos change <slug>`，其中 `slug` 是变更提案的名称标识（如 `add-remember-me`）。
2. **CLI** 检查 `logos/logos.config.json` 是否存在。如果不存在 → 见 EX-2.1。如果用户未传入 `slug` 参数 → 见 EX-3.1。
3. **CLI** 检查 `logos/.openlogos-guard` 是否存在。如果存在，则读取其中的 `activeChange`，并检查该提案是否仍位于 `logos/changes/` 下且未归档。如果是，则说明当前已有活动提案 → 见 EX-3.2。
4. **CLI** 检查 `logos/changes/{slug}/` 目录是否已存在。如果已存在 → 见 EX-4.1。
5. **CLI** 从 `logos/logos.config.json` 中读取 `locale`。
6. **CLI** 创建 `logos/changes/{slug}/` 根目录。
7. **CLI** 在提案目录下创建 4 个 `deltas/` 子目录：`deltas/prd`、`deltas/api`、`deltas/database`、`deltas/scenario`。

> 这 4 个分类与 `merge` 命令的 `DELTA_TO_RESOURCE` 映射一致。用户和 AI 将 delta 文件放入对应分类后，`merge` 命令根据分类自动映射到目标资源目录。

8. **CLI** 生成并写入 `proposal.md`，内容由 `proposalTemplate(locale, slug)` 根据 locale 生成中/英文模板。
9. **CLI** 生成并写入 `tasks.md`，内容由 `tasksTemplate(locale)` 根据 locale 生成中/英文模板。
10. **CLI** 写入 `logos/.openlogos-guard`，将当前 `slug` 记录为唯一活动提案。
11. **CLI** 在终端输出已创建的文件清单和下一步操作指引（对 AI 说「帮我填写变更提案」→ 编辑 delta 文件 → 运行 `openlogos merge`）。

### 异常用例

#### EX-2.1: 项目未初始化

- **触发条件**：Step 2 检测到 `logos/logos.config.json` 不存在
- **期望响应**：stderr 输出错误信息，exit(1)
- **副作用**：不创建任何文件

#### EX-3.1: 缺少 slug 参数

- **触发条件**：用户未传入 `slug` 参数
- **期望响应**：stderr 输出 Usage 示例（`Usage: openlogos change <slug>`），exit(1)
- **副作用**：不创建任何文件

#### EX-3.2: 活动 guard 冲突

- **触发条件**：Step 3 检测到 `logos/.openlogos-guard` 存在，且其 `activeChange` 仍对应 `logos/changes/` 下一个未归档提案
- **期望响应**：stderr 输出当前活动提案冲突信息，提示先完成并归档该提案，exit(1)
- **副作用**：不创建新提案目录，不覆盖已有 guard

#### EX-4.1: 同名提案已存在

- **触发条件**：Step 4 检测到 `logos/changes/{slug}/` 已存在
- **期望响应**：stderr 输出 `Error: Change proposal '{slug}' already exists.`，exit(1)
- **副作用**：不覆盖已有提案

---

## S09-B: openlogos merge

### 时序图

```mermaid
sequenceDiagram
    participant U as 用户终端
    participant CLI as openlogos CLI
    participant FS as 本地文件系统
    participant AI as AI 编程工具

    U->>CLI: Step 1: openlogos merge <slug>
    CLI->>FS: Step 2: 检查 logos/logos.config.json
    CLI->>FS: Step 3: 检查 logos/changes/{slug}/ 是否存在

    alt 不存在
        CLI-->>U: EX-3.1: 提案不存在 + exit(1)
    end

    CLI->>FS: Step 4: 扫描 logos/changes/{slug}/deltas/ 下所有分类目录
    FS-->>CLI: delta 文件列表

    alt 无 delta 文件
        CLI-->>U: EX-4.1: 无 delta 文件 + exit(1)
    end

    CLI->>FS: Step 5: 读取 locale + proposal.md 内容
    CLI->>CLI: Step 6: 生成 MERGE_PROMPT.md 内容
    CLI->>FS: Step 7: 写入 logos/changes/{slug}/MERGE_PROMPT.md

    CLI-->>U: Step 8: 输出合并摘要（delta 数量 + 文件映射）
    CLI-->>U: Step 9: 输出 AI 提示词 + 归档提醒

    Note over U,AI: 用户将提示词告诉 AI
    U->>AI: "读取 MERGE_PROMPT.md 并执行合并"
    AI->>FS: AI 读取 MERGE_PROMPT.md + delta 文件 + 主文档
    AI->>FS: AI 按指令执行合并（ADDED/MODIFIED/REMOVED）
```

### 步骤说明

1. **开发者**在终端输入 `openlogos merge <slug>`。
2. **CLI** 检查 `logos/logos.config.json` 是否存在。如果不存在则报错 exit(1)。
3. **CLI** 检查 `logos/changes/{slug}/` 目录是否存在。如果不存在 → 见 EX-3.1。
4. **CLI** 遍历 `logos/changes/{slug}/deltas/` 下的每个子目录（`prd`、`api`、`database`、`scenario`），收集所有非隐藏文件作为 delta 文件列表，同时通过 `DELTA_TO_RESOURCE` 映射表将分类名转换为目标资源路径。如果所有分类目录均为空 → 见 EX-4.1。

> 例如 `deltas/prd/requirements-update.md` 映射到 `logos/resources/prd`，`deltas/api/auth-v2.yaml` 映射到 `logos/resources/api`。未在映射表中的子目录被忽略。

5. **CLI** 从 `logos/logos.config.json` 读取 `locale`，并读取 `proposal.md` 的完整内容。
6. **CLI** 调用 `mergePromptTemplate()` 生成 `MERGE_PROMPT.md` 的文本内容，包含提案元信息、`proposal.md` 原文（让 AI 理解变更意图）、以及每个 delta 文件的路径和目标目录的操作指令。

> 这是 CLI 与 AI 的桥梁——CLI 不执行实际合并，只生成指令文件，由 AI 读取后按 `merge-executor` Skill 的规范执行。

7. **CLI** 将生成的内容写入 `logos/changes/{slug}/MERGE_PROMPT.md`。
8. **CLI** 在终端输出合并摘要：提案名称、delta 文件数量、每个 delta 文件到目标目录的映射关系。
9. **CLI** 输出可直接使用的 AI 提示词（如 `对 AI 说：「读取 MERGE_PROMPT.md 并执行合并」`）和后续步骤提醒：执行合并后提交规格文档、按更新后的规格实现代码、运行 `openlogos verify` 验收，PASS 后再明确授权 `openlogos archive {slug}`。

### 异常用例

#### EX-3.1: 提案不存在

- **触发条件**：Step 3 检测到 `logos/changes/{slug}/` 不存在
- **期望响应**：stderr 输出 `Error: Change proposal '{slug}' not found.`，exit(1)
- **副作用**：不生成任何文件

#### EX-4.1: 无 delta 文件

- **触发条件**：Step 4 扫描后 `deltas/` 下所有分类目录均为空
- **期望响应**：stderr 输出 `Error: No delta files found in logos/changes/{slug}/deltas/.`，exit(1)
- **副作用**：不生成 MERGE_PROMPT.md

---

## S09-D: openlogos verify（变更验收）

### 时序图

```mermaid
sequenceDiagram
    participant U as 用户终端
    participant CLI as openlogos CLI
    participant FS as 本地文件系统
    participant AI as AI 编程工具

    Note over U,AI: 前置：AI 已完成 S09-B merge 合并 + 代码实现

    AI-->>U: Step 1: 提示用户运行 openlogos verify
    U->>CLI: Step 2: openlogos verify
    CLI->>FS: Step 3: 读取 logos/resources/verify/test-results.jsonl
    CLI->>FS: Step 4: 读取 logos/resources/test/*.md 中的用例 ID
    CLI->>CLI: Step 5: 计算覆盖度 + 通过率

    alt 验收通过（PASS）
        CLI->>FS: Step 6: 写入 logos/resources/verify/acceptance-report.md
        CLI-->>U: Step 7: 输出 PASS + 提示用户授权归档
    else 验收失败（FAIL）
        CLI->>FS: Step 6: 写入 logos/resources/verify/acceptance-report.md（含失败项）
        CLI-->>U: Step 7: 输出 FAIL + 列出问题项，提示修复代码后重新验收
    end
```

### 步骤说明

1. **AI** 完成代码实现并提交后，在终端输出提示：`请运行 openlogos verify 完成验收，通过后再归档`。AI 不得自动执行此命令。
2. **用户**在终端输入 `openlogos verify`。
3. **CLI** 读取 `logos/resources/verify/test-results.jsonl`（由测试代码中的 OpenLogos reporter 写入）。
4. **CLI** 读取 `logos/resources/test/*.md`，提取所有用例 ID。
5. **CLI** 计算两项指标：
   - **覆盖度**：JSONL 中出现的用例 ID / test-cases.md 中定义的全部用例 ID
   - **通过率**：status=pass 的用例数 / JSONL 中的总用例数
6. **CLI** 将验收结果写入 `logos/resources/verify/acceptance-report.md`。
7. **CLI** 在终端输出判定结果：
   - PASS：提示用户可以授权归档（`openlogos archive {slug}`）
   - FAIL：列出失败用例和未覆盖用例，提示用户修复代码后重新验收（无需重走 merge 流程）

### 行为约束

- **AI 不得自动执行 `openlogos verify`**：verify 是人类确认点，AI 只负责提示
- **verify 在代码实现之后**：verify 验收的是代码，必须在 merge 规格落地 + 代码实现完成后才能运行
- **验收失败只修代码**：FAIL 时只需修复代码并重新运行 verify，不需要重走 merge 流程
- **验收失败不得跳过**：FAIL 状态下不得提示用户归档，必须先修复

---

## S09-E: git commit / push（版本提交）

### 时序图

```mermaid
sequenceDiagram
    participant U as 用户终端
    participant AI as AI 编程工具
    participant GIT as Git

    Note over AI,GIT: 节点 1：merge 完成后（S09-B 结束）
    AI->>GIT: Step 1: git add -A
    AI->>GIT: Step 2: git commit -m "docs({slug}): merge spec deltas"
    AI-->>U: Step 3: 告知 commit 已完成（无需确认）

    Note over AI,GIT: 节点 2：代码实现完成后（Step 7 结束）
    AI->>GIT: Step 4: git add <业务代码 + 测试代码>
    AI->>GIT: Step 5: git commit -m "feat/fix({slug}): implement changes"
    AI-->>U: Step 6: 告知 commit 已完成（无需确认）

    Note over AI,GIT: 节点 3：archive 完成后（S09-C 结束）
    AI->>GIT: Step 7: git add logos/changes/archive/{slug}/
    AI->>GIT: Step 8: git commit -m "chore({slug}): archive change proposal"
    AI-->>U: Step 9: 告知 commit 已完成，询问是否 push

    U->>AI: Step 10: 明确授权 push【人类确认点】
    AI->>GIT: Step 11: git push
    GIT-->>U: Step 12: push 结果
```

### 步骤说明

三个自动 commit 节点（AI 执行，告知用户，无需确认）：

| 节点 | 触发时机 | commit message |
|------|---------|---------------|
| 规格 commit | merge-executor 完成合并后 | `docs({slug}): merge spec deltas` |
| 代码 commit | code-implementor 完成实现后 | `feat/fix({slug}): implement changes` |
| 归档 commit | archive 完成后 | `chore({slug}): archive change proposal` |

push 是独立的人类确认点：三个 commit 完成后，AI 提示用户确认是否推送，用户明确授权后才执行 `git push`。

### 行为约束

- **commit 无需用户确认**：三个节点的 commit 由 AI 自动执行，但必须在终端告知用户
- **push 必须用户确认**：AI 不得在未获明确授权的情况下执行 `git push`
- **commit 粒度规则**：
  - 需求级 / 设计级变更：3 个独立 commit（规格 + 代码 + 归档）
  - 接口级变更：规格和代码可合并为 1 个 commit，归档单独 1 个
  - 代码级修复：代码 1 个 commit + 归档 1 个 commit

---

## S09-C: openlogos archive

### 时序图

```mermaid
sequenceDiagram
    participant U as 用户终端
    participant CLI as openlogos CLI
    participant FS as 本地文件系统

    U->>CLI: Step 1: openlogos archive <slug>
    CLI->>FS: Step 2: 检查 logos/logos.config.json
    CLI->>FS: Step 3: 读取 locale
    CLI->>FS: Step 4: 检查 logos/changes/{slug}/ 是否存在

    alt 不存在
        CLI-->>U: EX-4.1: 提案不存在 + exit(1)
    end

    CLI->>FS: Step 5: 检查 logos/changes/archive/{slug}/ 是否存在

    alt 已存在
        CLI-->>U: EX-5.1: 归档已存在 + exit(1)
    end

    CLI->>FS: Step 6: mkdirSync(logos/changes/archive/)
    CLI->>FS: Step 7: renameSync({slug}/ → archive/{slug}/)

    CLI-->>U: Step 8: 输出归档确认
```

### 步骤说明

1. **开发者**在终端输入 `openlogos archive <slug>`。
2. **CLI** 检查 `logos/logos.config.json` 是否存在。如果不存在则报错 exit(1)。
3. **CLI** 从 `logos/logos.config.json` 中读取 `locale`。
4. **CLI** 检查 `logos/changes/{slug}/` 目录是否存在。如果不存在 → 见 EX-4.1。
5. **CLI** 检查 `logos/changes/archive/{slug}/` 是否已存在。如果已存在 → 见 EX-5.1。
6. **CLI** 调用 `mkdirSync` 确保 `logos/changes/archive/` 目录存在（幂等操作）。
7. **CLI** 调用 `renameSync` 将 `logos/changes/{slug}/` 整体移动到 `logos/changes/archive/{slug}/`。

> 选择 `renameSync` 而非复制+删除：(1) 原子操作，不会出现"复制了一半失败"的中间状态；(2) 同文件系统内 rename 是 O(1) 操作；(3) 归档后原位置不留残留。

8. **CLI** 在终端输出归档确认信息和归档路径。

### 异常用例

#### EX-4.1: 提案不存在

- **触发条件**：Step 4 检测到 `logos/changes/{slug}/` 不存在
- **期望响应**：stderr 输出 `Error: Change proposal '{slug}' not found.`，exit(1)
- **副作用**：不移动任何文件

#### EX-5.1: 归档已存在

- **触发条件**：Step 5 检测到 `logos/changes/archive/{slug}/` 已存在
- **期望响应**：stderr 输出 `Error: Archive '{slug}' already exists in logos/changes/archive/.`，exit(1)
- **副作用**：不覆盖已有归档，不移动原提案

## S09-B 合并事务责任、提交与授权边界

### 目标

把“内容准备”“正式规格提交”“Git commit”和“后续发布”拆成可审计的不同责任，消除旧流程中 Agent 同时生成 manifest、写正式目标、touch marker 和提交 Git 的越权链。

### 责任矩阵

| 责任 | 唯一所有者 | Agent / RunLogos 边界 |
|---|---|---|
| canonical target、mode、hash、producer/validator | OpenLogos | 只读，不得补全或重排 |
| transaction control、phase、journal、receipt | OpenLogos | 只通过 CLI 公共动作消费 |
| 声明的最终内容 slot | merge-executor Agent | 只写 `agent_io.write_paths`，原子替换 |
| metadata、counter/index、dogfood、marker | OpenLogos | Agent 与 RunLogos 零写入 |
| WorkUnit 完成与 quiescent | RunLogos | 只控制何时尝试 seal，不定义 merge 成功 |
| 规格 Git commit 路径 | completed receipt | RunLogos/AI 只能提交 receipt 的 `commit_paths` |

### 提交时序

```mermaid
sequenceDiagram
    participant O as OpenLogos Transaction
    participant R as RunLogos Driver
    participant G as Git Executor
    O-->>R: Step 1: completed receipt(commit_paths, final_hashes)
    R->>R: Step 2: 校验 receipt/marker/transaction identity
    R->>G: Step 3: commit 精确 commit_paths
    G-->>R: Step 4: commit result
    R-->>O: Step 5: 后续 status 仍返回同一 receipt
```

### 步骤说明

1. 只有 OpenLogos completed receipt 能触发规格 commit；Agent done、WorkUnit done、`MERGE_PROMPT_GENERATED` 或 slot 齐全都不是成功证据。
2. RunLogos 校验 receipt schema/contract hash、transaction/plan identity、`SPEC_MERGED` hash 与每个 final hash。
3. Git 执行器只提交 receipt 精确列出的正式资源、metadata、dogfood 和 marker；transaction 私有 slot、临时文件、journal、staging、backup 不得进入 commit。
4. commit 失败不改变 transaction completed 状态；重试 Git 仍消费同一 receipt，不得重新 apply。
5. push、npm publish、tag、GitHub Release、官网发布仍是独立授权域；本机全局 candidate 安装不隐含这些授权。

### 异常与边界

#### EX-MT-09B-1：receipt 缺失或路径超集
- **触发条件**：transaction 非 completed，或 receipt `commit_paths` 包含 slot/journal/仓库外路径。
- **期望响应**：拒绝 commit，报告合同错误；不得扫描工作区猜路径。
- **副作用**：无 Git 写入。

#### EX-MT-09B-2：正式文件在 completed 后漂移
- **触发条件**：commit 前重算 final hash 与 receipt 不一致。
- **期望响应**：拒绝 commit并保留诊断；不得修改 receipt 或重跑 apply 覆盖用户字节。
- **副作用**：无 Git 写入。

#### EX-MT-09B-3：RunLogos deadline 到期
- **触发条件**：宿主 watchdog 到期但 OpenLogos 仍为 collecting/waiting 或 applying/recovering。
- **期望响应**：宿主继续按 allowed actions/status 处理或报告超时，不得自行标记 completed/failed。
- **副作用**：transaction 权威不变。

### 追溯

- 场景：S09 合并事务单一权威生命周期。
- 测试：UT-S09-245～UT-S09-250、ST-S09-96～ST-S09-98。

## S09 精确 Git 提交与 stacked change 交接


### 精确提交主路径

```mermaid
sequenceDiagram
    participant O as OpenLogos
    participant R as RunLogos
    participant G as Git
    O-->>R: completed(receipt, artifact_hashes)
    R->>R: 校验双 hash 与 paths union=commit_paths
    R->>G: git add -- <逐项 commit_paths>
    G-->>R: staged paths
    R->>R: 拒绝额外 staged/unrelated dirty
    R->>G: commit
```

RunLogos 不读取内部 receipt、slot、journal 或目录扫描来扩充提交集合。任何 commit path 缺 hash、额外 hash、重复路径、绝对路径或逃逸都 fail closed。

### Stacked change/guard 交接

1. 旧 `refresh-merge-transaction-cross-repo-plan` 只占用主 worktree 与 SMOKE-core-150。
2. 新 follow-up 只占用独立 branch/worktree 与 SMOKE-core-151+。
3. 新 candidate 部署后完成 RunLogos E2E；先让旧 smoke PASS 并归档旧 slug。
4. 再让 follow-up smoke PASS 并归档新 slug。
5. 两个 archive commit 完成且主 worktree 干净后合入 follow-up branch，冲突按 completed receipts 和有效规格解决并复验。
6. 禁止复制、删除、手改 guard，禁止跨 slug 共享 verify/smoke/archive marker。

## S09 Missing-slot 修复、授权与提交边界


### 责任矩阵

| 责任方 | 允许 | 禁止 |
|---|---|---|
| OpenLogos core | preflight、结构化归因、原子 reopen、seal/apply/recover | 猜测错误消息、首写后 reopen |
| Merge consumer/Agent | 读取 status/next、重建 rejected target final bytes、写声明 staging、submit | 写正式 resources、transaction 私有状态、receipt/marker |
| 用户 | 在独立门批准 merge/verify/deploy/smoke/archive/push | 以 proposal/tasks 文案代替确认点 |

### Missing-slot 修复时序

```mermaid
sequenceDiagram
    participant O as OpenLogos Core
    participant C as Consumer
    participant G as Declared Staging
    participant T as Transaction

    O-->>C: retryable + phase=collecting
    C->>T: status
    T-->>C: one/more missing_slot_ids; others submitted
    C->>C: regenerate final bytes from approved Delta/effective baseline
    C->>G: temp write + fsync + atomic rename
    C->>O: submit-content --slot --file declared-path
    O->>T: verify bytes/hash; update submitted
    O-->>C: ready when all required slots present
    C->>O: seal
```

消费者不得把 retryable 解释成“修改现有 sealed slot”：只有 core 已持久化 collecting 且该 slot 出现在 missing 集合时才可重提。无关 slot 不重新生成、不重新 submit。

### Git 与制品边界

- reopen、slot 私有清理和 staging 都不是可提交规格产物。
- 只有 completed receipt 的 `commit_paths` 可以进入精确规格提交。
- legacy transaction 完成后仍按 receipt 校验 final/artifact hashes；不能因 transaction ID 沿用而跳过。
- RunLogos 的 `UT-S44-24` 修复发生在其当前提案声明 staging 中；不得直接修改正式 `logos/resources/test/core-S44-test-cases.md`。

### 授权边界

本次 plan approval 只允许 Delta。Delta 完成后的 `openlogos merge`、代码完成后的 verify、0.14.2 部署、smoke、RunLogos transaction继续、archive与push分别遵守确认点。只有明确的当前用户消息或 `--auto` standing授权可以消费对应门；proposal/decision/tasks自身不是执行授权。

### 异常

- status显示fatal/unattributable：停止，不清 slot、不abort掩盖原因。
- plan/source/before drift：停止并按稳定分类处理，不生成新 transaction规避。
- journal/recovery错误：只执行 recover/rollback路径。
- 修正后仍有内容错误：core可再次按同规则只退回新 rejected slots。

## S09-B 合并事务终态出路（abort 重建 / fatal 修复 / completed 受控重开）

> 来源变更：fix-merge-transaction-abort-recover-reopen。承接「S09-B: openlogos merge」与「S09-B 合并事务责任、提交与授权边界」：终态不再是死局，出路受控、留痕、单一权威（功能规格 §2.58；架构 §四十五）。

### 场景目标

提案的合并事务进入任一终态（aborted / fatal failed / completed）后，用户修正 delta 或发现已合并规格有误时，能经公开命令在提案内受控重来，不再依赖人工删除事务文件。

### 主时序（completed 受控重开）

```mermaid
sequenceDiagram
    participant U as 用户
    participant M as openlogos merge / merge transaction
    participant T as 合并事务状态机
    participant W as 提案目录产物

    U->>M: Step 1: merge transaction reopen --reason "<原因>" --confirm-spec-merged
    M->>T: Step 2: 准入判定（phase=completed；SPEC_MERGED 在场须确认；reason 非空）
    T->>W: Step 3: MERGE_REOPENS.jsonl 追加留痕（append-only）
    T->>W: Step 4: 旧事务归档 merge-transactions/<id>.json（receipt 可审计）
    T->>W: Step 5: 作废 SPEC_MERGED（确认路径）
    U->>M: Step 6: 修正 delta 后重跑 openlogos merge
    M->>T: Step 7: 无活跃事务 → 按当前 delta 重新规划新事务（新 id / plan / target set）
    U->>T: Step 8: submit-content → seal → apply
    T->>W: Step 9: apply 成功重写 SPEC_MERGED 与 receipt（新事实）
```

### 步骤说明

1. **用户**对 completed 事务执行 `reopen`，附非空 `--reason`；`SPEC_MERGED` 在场时另附 `--confirm-spec-merged`。
2. **合并事务状态机**按准入矩阵判定（功能规格 §2.58.3）；任一前置不满足即拒绝且零副作用。
3. **状态机**在单一动作内按序完成留痕、归档、作废——任一步失败整体不生效。
4. **用户**修正 delta 后重跑 `openlogos merge`；创建入口发现无活跃事务，按当前 delta 重新规划（aborted / fatal failed 终态走同一让位路径：归档后直接重建，无需 reopen）。
5. **用户**重走 submit-content → seal → apply；成功后 `SPEC_MERGED` 与 receipt 重写为新事实，下游按指纹自然传导收敛（C01）。

### 异常与边界

- **abort 后重跑 merge**：aborted 事务被归档让位、按当前 delta 重建新事务——即使 plan/target set 已变化也正确重规划（旧缺陷：无条件幂等返回 aborted 投影）。
- **fatal failed（非 recovery_required）**：`allowed_actions` 含 `abort`；abort 后走上一条重建。既有 `recovery_required → recover` 逐字不变。
- **completed + SPEC_MERGED 在场未附确认**：拒绝并给出可执行指引；零副作用（无留痕/归档/作废）。
- **`--reason` 缺失或空白**：拒绝——留痕必须有非空原因。
- **非 completed phase 执行 reopen**：`action_not_allowed`，既有出路不变。
- **事务文件不可读 / marker 不可判定**：fail-closed 拒绝，无任何写副作用。
- **completed + SPEC_MERGED 完好时直接重跑 merge**：拒绝静默重建，文案指向 reopen 入口——已合并事实不得被无痕覆盖。
- **重开后未重新 apply 前**：`SPEC_MERGED` 已作废，flow 派生自然退回 merge 前沿；下游既有产物保持旧值（无半新半旧），其失效由重合并后的指纹失配自然传导。

### 追溯

- 需求：AC-MTXOUT-01～07。
- 功能规格：§2.58；架构：§三十四、§四十五；根规范：`spec/change-management.md`、`spec/cli-json-output.md` 终态出路修订。
- 测试：UT-S09-289～292、ST-S09-111；安装态 SMOKE-core-181。

## S09-A 提案脚手架章节清单与「最小实现论证」段

### 场景目标

让 `openlogos change <slug>` 产出的提案模板在「变更类型」之前带一段 `## 最小实现论证`，在提案**落笔时**就要求论证「为什么不能更小」——作用在设计发生**之前**，与 change-lint 的事后观测（S35「变更类型 ↔ delta 层面观测 warning」）分管两端。

### 用户价值

「proposal 必须论证为什么不能更小」这条规矩此前只存在于少数几份 proposal 的正文里——模板没有这一段，没有任何机制提示下一个提案写它，换一个会话、换一个 agent 即丢失。进入模板后，它在每个新建提案开头出现，覆盖面高于任何 Skill 文本。

### 章节清单与插入位置

`proposalTemplate(locale, slug, module?)` 产出的章节顺序中，`## 最小实现论证` 固定插入在 `## 变更类型` **之前**、`## 变更原因` 之后。段内含三个占位提示：

1. 先检索既有机制——列出查了什么、为什么不够用；
2. 为什么不能更小；
3. 本提案主动砍掉了什么。

**zh / en 两套模板须同批改动**：两套是同一契约的两种语言载体，任何一套漏改都会使该语言的项目拿不到该段。该成对约定由 UT 断言（zh / en 各一条产物检查）。

### 该段不受任何既有检查约束

**缺段不告警、未填不告警、占位残留不告警**——三者均不影响 change-lint 结果与 exit code。两重独立原因，任一条单独成立即足够：

1. 既有占位符检查**不是泛化的 `[...]` 匹配**，而是**枚举特定占位文本**的正则。新段写什么占位文本都不在这张枚举表里——本能力**不**把它加进枚举。
2. 即便加进枚举也无用：该检查只在 canonical 章节白名单（`SECTION_ORDER`）的循环体内被调用，新段不进白名单，根本走不到那行。

实测确认：新段保留全部占位文本时，提案结构评估返回零 issue。

**因此该段是自律提示，不是受检约束。** 不得在规格、Skill 或实现中声称它「有检查兜底」。

### 不变量

1. `## 最小实现论证` **不进** canonical 必填章节集合——缺段不使 L0 完成合同失败。
2. 既有占位符检查的枚举表零改动；既有 canonical 章节的检查行为逐字节零回归。
3. 新增段不得使既有脚手架产物结构判定失败：填妥既有 canonical 章节后，该段占位全留的产物仍通过 L0。
4. 模板改动只影响此后**新建**的提案，不回溯改写任何既有提案。
5. zh / en 两套模板的章节集合与顺序保持一致。

### 异常与边界

- **产出方删除该段**：与从未写过等价，全流程零影响。此为有意的边界——本段的强制力为零，硬信号由 S35 的 warning 单独承担。
- **产出方空填该段**：同上，不告警。若观测期显示该段被普遍空填或删除，再议是否升格为 canonical 必填；升格是新增硬阻断点，须另行征得用户同意，不在本次范围。
- **既有 canonical 章节未填**：与本段无关——未填写的原始模板本就报既有的占位残留与部署字段违规，那是既有行为，**不得**为让新段的用例通过而放宽任何既有检查。

### 追溯

- 来源变更：anti-overdesign-scale-signals（刀二；刀一见 S35「变更类型 ↔ delta 层面观测 warning」）。
- 需求：`core-01-requirements.md`「S35/S09: 防过度设计的规模信号」验收条件 7–8。
- 测试：UT-S09-360、UT-S09-361。
