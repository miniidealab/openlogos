---
title: "openlogos ignore / exempt"
description: 管理 guard 的保护范围——哪些路径不进版本控制（.gitignore 托管区块），哪些已提交路径无需立案。
---

两个命令共同决定 [写入门禁](/zh/specs/pretooluse-guard) 在 launched 项目中保护什么：

- `openlogos ignore` 管理**不应进入版本控制**的路径——依赖目录、构建产物、缓存等。它维护 `logos/logos.config.json` 中的 `guard.unversioned`，并把这些条目渲染进 `.gitignore` 的 OpenLogos 托管区块。git 忽略它们之后，guard 也就不再保护它们。
- `openlogos exempt` 管理**已提交但无需立案**的路径。它维护 `logos/logos.config.json` 中的 `guard.exempt`。这些路径下的文件照常被跟踪、照常入库，只是写入时不需要先 `openlogos change`。

## 命令格式

```bash
openlogos ignore add <pattern...>
openlogos ignore remove <pattern...>
openlogos ignore list [--format json]

openlogos exempt add <path...>
openlogos exempt remove <path...>
openlogos exempt list [--format json]
```

请在项目根目录（`logos/logos.config.json` 所在目录）执行。

## ignore 与 exempt 的区别

| | `openlogos ignore` | `openlogos exempt` |
|---|---|---|
| 配置字段 | `guard.unversioned` | `guard.exempt` |
| 对 git 的影响 | 写入 `.gitignore` 托管区块——这些路径不再进入版本控制 | 无——这些路径仍被跟踪、正常入库 |
| 对 guard 的影响 | 被忽略且未跟踪的路径不受保护 | 这些路径下的写入无需立案 |
| 典型用途 | `node_modules/`、`dist/`、`.cache/`、生成的报告 | 参考资料、仍想入库的草稿文档 |
| 内置默认 | 固定包含 `logos/.openlogos-runtime/` | `logos/resources/reference/`、`logos/resources/verify/baseline-seed-runs/*/staging/` 与 `logos/environments.yaml` |

## 审批：add 与 remove 须经宿主原生审批

`add` 与 `remove` 会改变 guard 的保护范围。由 AI 执行时，guard 在任何生命周期、任何提案状态下都把它们当作受限命令：

- 必须以独立调用执行（允许 `cd <目录> &&` 前缀），与其他命令组合一律阻断。
- **Claude Code**，权限模式为 `default` 或 `acceptEdits`：宿主针对这一次调用弹出自己的审批，你批准后才执行。
- 其他权限模式（`bypassPermissions`、`dontAsk`、`auto`、`plan`）或非交互运行：宿主不会弹窗，调用被阻断。请自行执行——在 Claude Code 中输入 `! openlogos ignore add dist/`——或切换到默认权限模式后重试。
- **Cursor**：`beforeShellExecution` 请求审批；宿主不能保证弹出审批时按 deny 处理。
- ZCode、Qoder、WorkBuddy 未接入原生审批，请在你自己的终端中执行。

对话中的口头同意不算审批，`openlogos next --auto` 的授权也不覆盖这些命令。CLI 本身不弹确认：你在自己的终端里执行时会直接生效。

`list` 是只读的，不受限。

## 行为说明

### `ignore add` / `ignore remove`

1. 先校验全部参数，任一非法则整批不写。
2. 更新 `logos/logos.config.json` 中的 `guard.unversioned`。
3. 重新渲染 `.gitignore` 托管区块（文件不存在时新建）。区块外的内容不会被改动。写 `.gitignore` 失败时回滚配置。
4. `add` 之后，若有**已跟踪**的文件命中新模式，会列出这些文件。它们仍在版本控制中，继续受 guard 保护。`openlogos` 不会代你执行 `git rm`，只打印需要你自行执行的命令：

```
⚠ 有 2 个已跟踪文件命中 "dist/"，它们仍在版本控制中，继续受 guard 保护：
    dist/app.js
    dist/app.css
  如需移出版本控制，请自行执行（openlogos 不会代为执行）：
    git --literal-pathspecs rm --cached -- 'dist/app.js' 'dist/app.css'
```

命中文件超过 20 个时，完整清单写入 `logos/.openlogos-runtime/untrack-<时间戳>.lst`，打印的命令通过 `--pathspec-from-file` 读取它。

托管区块形如：

```text
# >>> openlogos managed >>>
# 由 openlogos 维护，请用 `openlogos ignore` 修改；区块外内容不会被改动
logos/.openlogos-runtime/
dist/
# <<< openlogos managed <<<
```

`logos/.openlogos-runtime/` 是固定条目：添加它不产生变化，移除它会报错。不在 git 仓库中时，`ignore add` 照常写入配置与区块，并提示 guard 的版本控制判据不生效。

**模式规则：** 标准 `.gitignore` 模式，每个参数一条；不能为空、不能换行、不能含 NUL，不能以 `#` 或 `!` 开头，不能含 `..` 段。

### `exempt add` / `exempt remove`

1. 先校验全部路径，任一非法则整批不写。
2. 若 `guard.exempt` 缺省，先把内置默认项写成显式数组，便于修改。
3. 更新 `guard.exempt`。删光全部条目时写入显式空数组 `[]`，内置默认项也随之失效。

**路径规则：**

- 项目根相对路径，用 `/` 分隔；
- 以 `/` 结尾表示该目录本身及其全部后代；不以 `/` 结尾只匹配该单个文件；
- `*` 必须独占一个路径段，恰好匹配一个路径段（例如 `logos/resources/verify/baseline-seed-runs/*/staging/`）；
- 拒绝：空串、`/`、单独的 `*`、绝对路径、含 `.` / `..` / 空段、含 `\`。

### 不可豁免的路径

`exempt add` 会拒绝、guard 也会忽略任何试图放开以下路径的条目：

- 任意层级的 `.gitignore`；
- `.git/` 及其下路径（含 `.git/info/exclude`）；
- `logos/logos.config.json`；
- `logos/.openlogos-runtime/`（guard 自有状态）。

这些路径即使位于豁免目录之下也照样受保护：豁免 `docs/` 并不会豁免 `docs/.gitignore`。

### 环境登记表 `logos/environments.yaml`

[环境登记表](/zh/specs/environments)是运维配置而非业务逻辑，因此 `logos/environments.yaml` 属于内置默认豁免：修改它不需立案。有两点例外：

- **显式 `guard.exempt` 不会自动获得新的默认项。** 已把 `guard.exempt` 写成显式数组的项目（例如曾执行过 `exempt add`）不会自动加入这一项；需要时执行 `openlogos exempt add logos/environments.yaml`。
- **配置了门禁的登记表不适用豁免。** 文件中一旦出现 `promote_from` 或 `require_approval` 字段名（或出现任何反斜杠字符，guard 按文本保守识别），它就成为部署门禁的策略来源：内置默认与 `guard.exempt` 都不再适用，活跃提案也不构成放行理由。AI 对该文件的直接修改、shell 写入、移动与删除都要经宿主原生审批——交互模式下由你批准，其他模式阻断。不含门禁字段的登记表照常豁免。

登记表 `deploy` 条目引用的部署脚本与工作流是普通的受跟踪文件，照常受保护，因此改变部署实际执行的内容仍须立案。

### `list`

打印当前条目。对 `exempt`，尚未写入配置的内置默认项标注为（内置默认）：

```
$ openlogos exempt list
免立案清单（guard.exempt）：
  logos/resources/reference/                                （内置默认）
  logos/resources/verify/baseline-seed-runs/*/staging/      （内置默认）
  logos/environments.yaml                                   （内置默认）
```

加 `--format json` 时输出 JSON 信封，每个条目含 `value` 与 `source`（`config` 或 `default`）：

```json
{
  "command": "exempt list",
  "version": "0.16.7",
  "timestamp": "2026-10-17T08:00:00.000Z",
  "data": {
    "entries": [
      { "value": "logos/resources/reference/", "source": "default" },
      { "value": "logos/resources/verify/baseline-seed-runs/*/staging/", "source": "default" },
      { "value": "logos/environments.yaml", "source": "default" }
    ]
  }
}
```

`ignore list --format json` 结构相同，其条目的 `source` 恒为 `"config"`。

## 示例

```bash
# 让构建产物不进入版本控制
openlogos ignore add dist/ coverage/

# 取消对某路径的忽略
openlogos ignore remove coverage/

# 允许 AI 不立案就修改草稿目录（仍会入库）
openlogos exempt add docs/notes/

# 查看当前保护范围
openlogos ignore list
openlogos exempt list --format json
```

## 错误

所有错误均以退出码 1 结束，且不写入任何文件。

| 错误 | 原因 | 处理 |
|---|---|---|
| `logos/logos.config.json not found.` | 不在项目根目录，或项目未初始化 | `cd` 到项目根目录，或先运行 `openlogos init` |
| `logos/logos.config.json 不是合法 JSON` | 配置文件损坏 | 手工修复 JSON |
| `guard.<字段> 中有非法条目` | 配置中已有非法条目 | 手工修正或删除该条目 |
| `忽略模式 "…" 非法` / `免立案路径 "…" 非法` | 参数违反上述规则 | 修正参数 |
| `缺少参数。` | `add` / `remove` 未带参数 | 至少传入一个值 |
| `.gitignore 中的 openlogos 托管区块已损坏` | 托管区块的标记被改动 | 手工修复区块标记 |
| `写入 <文件> 失败……已回滚。` | 磁盘写入失败 | 检查权限后重试 |

## 相关

- [PreToolUse Guard](/zh/specs/pretooluse-guard) —— 受保护内容如何判定
- [`openlogos sync`](/zh/cli/sync) —— 按配置重新渲染 `.gitignore` 托管区块
- [`openlogos init`](/zh/cli/init) / [`openlogos adopt`](/zh/cli/adopt) —— 按检测到的技术栈建议忽略目录
