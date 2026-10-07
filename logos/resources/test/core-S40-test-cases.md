# core-S40: ignore / exempt 子命令与 .gitignore 托管区块测试用例

> 场景：S40 ignore / exempt 子命令与 .gitignore 托管区块｜决策：C02、C03、C13、C14（宿主原生审批）｜来源变更：guard-versioned-content-scope
> 全部测试代码必须写入 OpenLogos reporter（`logos/resources/verify/test-results.jsonl`，见 `logos/spec/test-results.md`）。

## 一、单元测试（UT）

### 1.1 清单语法、增删查与配置读写（`openlogos ignore` / `openlogos exempt` 命令实现）

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S40-01 | exempt 合法路径语法 | Step 15 | 夹具配置无 `guard` 字段 | 参数化校验 `docs/handbook/`、`docs/a.md`、`runs/*/staging/`、`a/b-1.x_y/` | 全部判为合法；以 `/` 结尾的判为目录（完整段匹配），否则判为单个文件；`*` 只匹配一个路径段 |
| UT-S40-02 | exempt 非法路径拒绝矩阵 | Step 15、EX-40.1 | 同上；记录配置与 `.gitignore` 字节哈希 | 参数化执行 `exempt add`：`/abs/x`、`../x`、`a/../b`、`./a`、`a//b`、`a\b`、空串、`/`、`*`、`a/*x*/`、`a/.hidden*/`、`logos/.openlogos-runtime/x`、`.gitignore`、`src/.gitignore`、`.git/info/exclude`、`.git/`、`.git/hooks/pre-commit` | 每条 exit 1，输出点名该条目与原因；配置与 `.gitignore` 哈希不变 |
| UT-S40-03 | ignore 非法模式拒绝矩阵 | Step 3、EX-40.1 | 同上 | 参数化执行 `ignore add`：空串、含 `\n` 的模式、`#dist`、`!dist/`、`a/../b` | 每条 exit 1 并点名原因；配置与 `.gitignore` 零写入 |
| UT-S40-04 | 混合合法与非法条目整体拒绝 | Step 3、Step 15 | 同上 | 执行 `ignore add dist/ !keep` 与 `exempt add docs/ ../x` | 两条命令均 exit 1；合法条目 `dist/`、`docs/` 也未写入，不发生部分写入 |
| UT-S40-05 | add 去重、保持插入顺序、已存在不写盘 | Step 5–6、EX-40.2 | `guard.unversioned` 为 `["node_modules/"]` | 依次执行 `ignore add dist/ dist/ build/`、再执行 `ignore add dist/` | 第一次后清单为 `["node_modules/","dist/","build/"]`；第二次提示「已存在」、exit 0，配置与 `.gitignore` 字节与 mtime 不变 |
| UT-S40-06 | remove 不存在条目 | Step 20、EX-40.2 | `guard.unversioned` 为 `["dist/"]` | 执行 `ignore remove build/`、`exempt remove docs/` | 均提示「不存在」、exit 0，零写入 |
| UT-S40-07 | exempt 缺省时 add 物化内置默认 | Step 16 | 配置无 `guard.exempt` | 执行 `exempt add docs/handbook/` | `guard.exempt` 写为 `["logos/resources/reference/","logos/resources/verify/baseline-seed-runs/*/staging/","docs/handbook/"]`；再 `exempt add logos/resources/reference/` 提示「已存在」不写盘 |
| UT-S40-08 | 删除内置默认项与清空 | Step 20–21、EX-40.3 | 配置无 `guard.exempt` | 执行 `exempt remove logos/resources/reference/`，再执行 `exempt remove logos/resources/verify/baseline-seed-runs/*/staging/` | 第一次后为仅含 staging 的显式数组；第二次后为显式空数组 `[]`，读取时不回落到内置默认 |
| UT-S40-09 | list 文本与 JSON 输出 | Step 23–25 | 配置 A：无 `guard.exempt`、`guard.unversioned` 为 `["dist/"]`；配置 B：`guard.exempt` 为 `["docs/"]` | 分别执行 `exempt list --format json`、`ignore list --format json` 与文本模式 | A：exempt 输出两条 `source:"default"`；ignore 输出 envelope，`command` 为 `ignore list`，`data` 为 `{"entries":[{"value":"dist/","source":"config"}]}`；B：exempt 仅一条 `source:"config"`；JSON 可严格解析；不写盘、不调用 git |
| UT-S40-10 | 配置不可解析或字段类型错误 | Step 2、EX-40.9 | 参数化：配置非法 JSON；`guard.exempt` 为字符串；`guard.unversioned` 含数字 | 执行 `add` / `remove` / `list` | 全部 exit 1，指出配置位置与错误；零写入；`list` 不输出猜测清单 |
| UT-S40-11 | 固定运行时条目不可增删 | EX-40.4 | 已有托管区块 | 执行 `ignore add logos/.openlogos-runtime/`、`ignore remove logos/.openlogos-runtime/` | add 提示已由 openlogos 固定写入，exit 0，零写入；remove 提示固定条目不可移除，exit 1，零写入 |

### 1.2 托管区块渲染、幂等与原子性（`.gitignore` 托管区块渲染器）

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S40-12 | 无区块与无文件时的写入位置 | Step 7 | 夹具 A：`.gitignore` 含 `*.log` 且以换行结尾；夹具 B：无结尾换行；夹具 C：无 `.gitignore` | 各执行 `ignore add dist/` | A、B：原内容逐字节保留，其后补一个空行再追加区块；C：新建仅含区块的文件；区块为起始标记、说明行、`logos/.openlogos-runtime/`、`dist/`、结束标记 |
| UT-S40-13 | 只改写标记之间，区块外逐字节不变 | Step 7、EX-40.6 | `.gitignore` 区块前后含用户注释、空行、非 ASCII 条目，区块后无结尾换行 | 执行 `ignore add build/`、`ignore remove build/` | 每次执行后，区块之前与之后的字节序列与执行前逐字节相等；区块内条目按配置顺序 |
| UT-S40-14 | CRLF 行尾沿用 | Step 5、EX-40.6 | `.gitignore` 首个换行为 CRLF | 执行 `ignore add dist/` | 区块每行以 CRLF 结尾；区块外原有 CRLF / LF 字节不被改写 |
| UT-S40-15 | 重复执行幂等 | Step 6 | 已执行过一次 `ignore add dist/` | 再执行同一命令及 `ignore remove` 一个不存在条目 | 两次均不写盘：配置与 `.gitignore` 字节、mtime 不变；写入口哨兵调用次数为 0 |
| UT-S40-16 | 托管区块损坏 fail loud | Step 37–38、EX-40.7 | 参数化：两个起始标记；只有起始标记；结束标记先于起始标记 | 执行 `ignore add dist/`、`ignore remove dist/` | exit 1，输出损坏标记行号与手工修复提示；配置与 `.gitignore` 零写入（区块检查先于写配置） |
| UT-S40-17 | 区块写入失败回滚配置 | Step 7、EX-40.8 | 对 `.gitignore` 写入口注入失败（权限错误、目标为目录） | 执行 `ignore add dist/` | exit 1；`logos.config.json` 恢复为执行前字节；`.gitignore` 不变；不留临时文件 |

### 1.3 已跟踪文件提示与 git 环境（`ignore add` 后置统计）

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S40-18 | 已跟踪文件提示且不代为执行 | Step 10–12、EX-40.10 | git 夹具：`dist/` 下 7 个已跟踪文件；进程调用层设哨兵 | 执行 `ignore add dist/` | 输出数量 7、恰好 5 个示例，以及逐个列出这 7 个路径（POSIX 单引号转义）的 `git --literal-pathspecs rm --cached -- '…'` 命令；命令中不出现模式 `dist/` 作为 pathspec；调用记录含 `git ls-files -z -ci --exclude=dist/`，不含任何 `git rm`；exit 0 |
| UT-S40-19 | 无已跟踪文件时不提示 | Step 10–12 | git 夹具：`coverage/` 未被跟踪 | 执行 `ignore add coverage/` | 不输出已跟踪提示与 `git rm` 命令，不写清单文件；exit 0 |
| UT-S40-20 | 非 git 仓库与统计失败 | Step 8、EX-40.5、EX-40.10 | 夹具 A：非 git 目录；夹具 B：git 仓库但 `git ls-files` 打桩为非零退出 | 各执行 `ignore add dist/` | A：配置与区块照常写入，输出「当前目录不在 git 仓库中，guard 新判据不生效」，不调用 `git ls-files`，exit 0；B：写入完成，输出「无法统计已跟踪文件」警告，不生成命令，exit 0 |
| UT-S40-25 | gitignore 语义匹配与提示命令实际执行（≤20 个） | Step 10–12、EX-40.10、EX-40.17 | 临时 git 仓库，已跟踪：`build/a.js`、`pkg/build/b.js`、`x.pyc`、`lib/y.pyc`、`lib/z.py`、`build/my file.js`（含空格）、`build/a*.js`（含 `*`）、`build/a1.js`、`build/it's.js`（含单引号）；进程调用层设哨兵 | ① 执行 `ignore add /build/`，取输出中的提示命令，在仓库根用 `sh -c` 实际执行，再 `git ls-files`；② 重置仓库后对 `ignore add *.pyc` 重复 ① | ① 统计为 `build/` 下 5 个文件（不含 `pkg/build/b.js`），命令形如 `git --literal-pathspecs rm --cached -- 'build/a*.js' 'build/a.js' 'build/a1.js' 'build/it'\''s.js' 'build/my file.js'`；执行 exit 0，恰好这 5 个文件从索引移出（工作区文件仍在），`build/a*.js` 未扩展到其他文件，其余已跟踪文件不变；② 恰好移出 `x.pyc`、`lib/y.pyc`，`lib/z.py` 不变；两次的匹配集合与把条目写入 `.gitignore` 后 `git check-ignore --no-index` 对已跟踪路径的判定一致；CLI 自身调用记录中不含 `git rm` |
| UT-S40-26 | 超过 20 个匹配文件时生成 NUL 清单 | Step 12、EX-40.10、EX-40.17 | 临时 git 仓库：`out/` 下 23 个已跟踪文件（含 1 个含空格、1 个含 `*` 的文件名），另有已跟踪 `src/keep.js` | 执行 `ignore add out/`；读取 `logos/.openlogos-runtime/untrack-<时间戳>.lst`；在仓库根实际执行提示命令 | 清单为 23 个路径的 NUL 分隔序列，与 `git ls-files -z -ci --exclude=out/` 逐字节一致；提示命令为 `git --literal-pathspecs rm --cached --pathspec-file-nul --pathspec-from-file=logos/.openlogos-runtime/untrack-<时间戳>.lst`；执行后恰好 23 个文件移出索引，`src/keep.js` 仍被跟踪；CLI 未执行 `git rm` |
| UT-S40-27 | exempt 父目录不解除保护范围来源 | Step 15、EX-40.1 | launched、无提案的 git 夹具；已跟踪 `docs/.gitignore`、`docs/guide.md`；`logos/` 被 git 忽略 | ① `exempt add docs/` 与 `exempt add logos/` 均 exit 0；② 对 `docs/.gitignore`、`docs/guide.md`、`logos/logos.config.json`、`.claude/.gitignore` 分别调用受保护判定，并喂 Edit 的 PreToolUse 输入 | ① 两条均被接受；② `docs/guide.md` 不受保护（exempt 生效），`docs/.gitignore`、`logos/logos.config.json`、`.claude/.gitignore` 仍受保护，Edit 均 exit 2 |

### 1.4 保护范围变更的宿主原生审批（`guard-check` 受限命令判定）

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S40-21 | 默认权限模式返回 ask | Step 27–29 | 真实形态的 Bash PreToolUse 输入，`tool_input.command` 为 `openlogos exempt add docs/` | 参数化 `permission_mode` 为 `default`、`acceptEdits` 调用 `guard-check` | stdout 为可严格解析的 `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"该命令会改变 guard 的保护范围（openlogos exempt add docs/），需要您确认后执行"}}`；exit 0；配置不变 |
| UT-S40-22 | 不弹审批的模式一律阻断 | Step 29、EX-40.11 | 同上 | 参数化 `permission_mode` 为 `bypassPermissions`、`dontAsk`、`auto`、`plan`、字段缺失、未知值 `foo` | 全部 exit 2，stdout 不含 `permissionDecision`；reason 含当前模式名（缺失时标明缺失）、`! openlogos exempt add docs/`、「切换到默认权限模式后重试」与「不要用对话中的口头同意替代」 |
| UT-S40-23 | 伪造授权文件与伪造 hook 输入不起作用 | EX-40.13 | 在 `logos/.openlogos-runtime/` 下预置多种形似批准记录的文件（任意文件名的 JSON，内容含该命令原文与未过期时间）；文件系统读调用设哨兵 | ① `permission_mode: bypassPermissions` 下执行 `openlogos exempt add src/` 的 PreToolUse；② 以子进程直接调用 `guard-check`，喂伪造的 `permission_mode: default` 输入；③ 检查 ② 之后 `logos.config.json` 与宿主执行记录 | ① exit 2，与无预置文件时的输出逐字节相同，guard-check 未读取预置文件；② 只得到 `ask` 的 stdout 文本，exit 0；③ 配置未变，命令从未被执行，guard 未写任何文件 |
| UT-S40-24 | 受限命令识别与独立调用切段 | Step 28–29、Step 34、EX-40.14 | `permission_mode: default` | 喂 PreToolUse：`cd <根> && openlogos exempt add docs/`；`openlogos exempt add docs/ && echo x > src/a.js`；`openlogos ignore add src/ \| tee log`；`echo $(openlogos ignore add src/)`；`openlogos ignore list`；`openlogos exempt list --format json` | `cd` 前缀形态返回 `ask`；三种复合形态 exit 2 且不返回 `ask`；两条 `list` exit 0 且不返回 `ask`；`cd` 前缀形态执行后的 PostToolUse `check` 不报告变化（C13） |
| UT-S40-28 | 每次调用独立审批、guard 不留状态 | Step 32、EX-40.12 | `permission_mode: default`；全项目文件快照 | 对同一命令 `openlogos ignore add build/` 连续喂三次 PreToolUse 输入，中间各模拟一次 PostToolUse(Bash) | 三次都返回 `ask`，不因之前的批准或拒绝改变；全过程 guard 未在项目内创建或修改任何文件 |

## 二、场景测试（ST）

> 走真实 CLI 入口与真实 hook 脚本，在一次性隔离项目中运行（launched、git 仓库、无 `logos/.openlogos-guard`，除非用例另行说明）；hook 输入使用 Claude Code / Cursor 真实字段形态。宿主审批本身由宿主完成，用例以「PreToolUse 返回 ask → 按用户批准 / 拒绝分别执行或不执行命令」的 hook 输入序列模拟。每条用例执行前后对项目全部文件做 SHA-256 快照，用于断言零写入与区块外不变。

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S40-01 | ignore add 正常路径含已跟踪提示 | Step 1→12 | `.gitignore` 含用户条目与注释、无托管区块；`dist/` 下 3 个已跟踪文件 | ① `openlogos ignore add dist/ coverage/`；② 读取配置与 `.gitignore`；③ `git status --porcelain` | ① exit 0，输出 `dist/` 下 3 个已跟踪文件、3 个示例与逐个列出这 3 个路径的 `git --literal-pathspecs rm --cached -- '…'` 命令；② `guard.unversioned` 为 `["dist/","coverage/"]`，区块含 `logos/.openlogos-runtime/`、`dist/`、`coverage/`，区块外逐字节不变；③ 3 个文件仍被跟踪（CLI 未执行 `git rm`） |
| ST-S40-02 | ignore remove 与幂等 | Step 1→7、EX-40.2 | 承接 ST-S40-01 后态 | ① `openlogos ignore remove coverage/`；② 再执行一次 ①；③ 再执行 `openlogos ignore add dist/` | ① exit 0，配置与区块均去掉 `coverage/`，区块外不变；② 提示「不存在」，exit 0，全项目快照不变；③ 提示「已存在」，exit 0，全项目快照不变 |
| ST-S40-03 | exempt add / remove / list 端到端 | Step 13→25、EX-40.3 | 配置无 `guard.exempt` | ① `openlogos exempt list --format json`；② `openlogos exempt add docs/handbook/`；③ `openlogos exempt remove logos/resources/reference/`；④ `openlogos exempt list --format json`；⑤ `openlogos ignore list --format json` | ① 两条内置默认，`source:"default"`；② exit 0，显式数组为两条默认 + `docs/handbook/`；③ exit 0，仅移除 reference；④ 两条 `source:"config"`；⑤ 合法 JSON；全程 `.gitignore` 未变化 |
| ST-S40-04 | 非法路径拒绝零写入 | EX-40.1 | 全项目快照 | 依次执行 `openlogos exempt add ../outside/`、`openlogos exempt add /abs/`、`openlogos exempt add logos/.openlogos-runtime/x`、`openlogos exempt add .gitignore`、`openlogos exempt add .git/info/exclude`、`openlogos ignore add '!dist/'` | 每条 exit 1 并点名原因；全项目快照与执行前完全一致 |
| ST-S40-05 | 托管区块损坏 fail loud | Step 35→38、EX-40.7 | `.gitignore` 只有起始标记没有结束标记 | ① `openlogos ignore add .venv/`；② 手工补上结束标记后重试 ① | ① exit 1，输出起始标记行号与修复提示，全项目快照不变；② exit 0，区块被正确渲染 |
| ST-S40-06 | 非 git 仓库提示 | Step 8、EX-40.5 | 隔离项目不是 git 仓库 | ① `openlogos ignore add dist/`；② `openlogos exempt add docs/` | ① exit 0，配置与区块写入，输出「当前目录不在 git 仓库中，guard 新判据不生效」；② exit 0，配置写入 |
| ST-S40-07 | CRLF 与区块外逐字节不变 | EX-40.6 | `.gitignore` 为 CRLF、区块前后各有用户内容、文件无结尾换行 | ① `openlogos ignore add dist/`；② `openlogos ignore remove dist/` | 每步后区块外字节序列与执行前相等；区块行尾为 CRLF；② 后区块仅剩固定运行时条目 |
| ST-S40-08 | 默认模式下 AI 发起受限命令触发宿主审批 | Step 26→30 | 按 S08 部署 guard 与 `guard-post-check.cjs` | 以 `permission_mode: default` 的真实 PreToolUse 输入执行 Bash `openlogos exempt add src/`、`openlogos ignore add src/` | 均输出 `permissionDecision: ask`，理由含命令原文，exit 0；在批准前配置与 `.gitignore` 不变 |
| ST-S40-09 | 用户批准则执行、拒绝则不执行 | Step 26→34、EX-40.12 | 同 ST-S40-08 | ① PreToolUse `openlogos ignore add build/` 返回 ask；② 按批准分支真实执行命令并送 PostToolUse(Bash)；③ 再次 PreToolUse 同一命令；④ 按拒绝分支不执行 | ② CLI exit 0，配置与区块加入 `build/`，PostToolUse `check` 不报告变化；③ 仍返回 ask；④ 全项目快照与 ③ 之前一致 |
| ST-S40-10 | 不弹审批的模式阻断并提示 `!` 自行执行 | Step 29c→31c、EX-40.11 | 同 ST-S40-08 | ① 依次以 `bypassPermissions`、`dontAsk`、`auto`、`plan`、缺失 `permission_mode` 执行 `openlogos exempt add docs/`；② 不经 hook 直接运行 `openlogos exempt add docs/`（模拟用户 `!` 自行执行） | ① 均 exit 2，reason 含 `! openlogos exempt add docs/`，配置不变；② exit 0，配置加入 `docs/` |
| ST-S40-11 | 复合命令阻断与间接调用被事后发现 | EX-40.13、EX-40.14 | 同 ST-S40-08，`permission_mode: default` | ① 执行 `openlogos exempt add src/ && echo x > src/a.js`；② 执行 `cd <根> && openlogos exempt add docs/` 并按批准分支执行；③ 执行 `node -e "require('child_process').execSync('openlogos exempt add src/')"`，送 PreToolUse 与 PostToolUse(Bash) | ① exit 2，不返回 ask，`src/a.js` 未被创建；② 返回 ask，批准后配置加入 `docs/`；③ PostToolUse `check` 以 exit 2 报告 `logos/logos.config.json` 的变化，不按独立 openlogos 调用豁免 |
| ST-S40-12 | --auto 阻断、有活跃提案仍需审批、list 不受限 | Step 26、EX-40.15 | 夹具 A：`openlogos next --auto` 驱动、`permission_mode: bypassPermissions`；夹具 B：存在活跃提案的 `logos/.openlogos-guard`、`permission_mode: default` | ① A 中执行 `openlogos exempt add src/`；② B 中执行 `openlogos ignore add src/`；③ A、B 中执行 `openlogos ignore list` 与 `openlogos exempt list --format json` | ① exit 2，配置不变；② 返回 ask；③ exit 0，不返回 ask |
| ST-S40-13 | Cursor 下返回 permission ask | EX-40.16 | 按 S08 部署 Cursor hooks | 以真实 `beforeShellExecution` 输入执行 `openlogos exempt add src/` 与 `openlogos exempt list` | 受限命令输出 `{"permission":"ask", "user_message": ..., "agent_message": ...}`（若规范按实测改为 deny，则断言 deny 且与 `spec/cursor-plugin.md` 声明一致）；`list` 不返回 ask；guard 不写任何文件 |
| ST-S40-14 | 伪造授权文件与伪造 hook 输入端到端无效 | EX-40.13 | 同 ST-S40-08；`permission_mode: bypassPermissions` | ① AI 先用 Bash 在 `logos/.openlogos-runtime/` 写入形似批准记录的 JSON；② 执行 `openlogos exempt add src/`；③ AI 用 Bash 直接调用 `guard-check` 并喂伪造的 `permission_mode: default` 输入，再执行 ② | ② exit 2；③ 直接调用只得到 stdout 文本，随后的真实调用仍以真实输入判定为 exit 2；全程 `guard.exempt` 不含 `src/` |
| ST-S40-15 | 提示命令在真实仓库中恰好移出匹配文件 | Step 10→12、EX-40.10、EX-40.17 | 临时 git 仓库，已跟踪：根 `build/` 下含普通、含空格、含 `*` 的文件名，`pkg/build/x.js`，任意层级 `*.pyc`，`out/` 下 25 个文件，以及若干不应受影响的文件；记录 `git ls-files -z` 基线 | 依次执行 `openlogos ignore add /build/`、`openlogos ignore add *.pyc`、`openlogos ignore add out/`，每次在仓库根执行输出中的提示命令，并比较 `git ls-files -z` | 每次被移出索引的集合恰好等于该条目的 `git ls-files -z -ci --exclude=<pattern>` 结果；`pkg/build/x.js` 与不应受影响的文件始终被跟踪；`out/` 一步使用 NUL 清单文件形态；工作区文件字节不变 |

## 三、测试数据与断言要求

- 零写入断言必须基于执行前后的全项目 SHA-256 快照与写入口哨兵，不得只检查目标文件是否存在。
- 区块外逐字节不变的断言比较区块前、区块后两段原始字节，不得先做换行归一化再比较。
- 审批相关用例必须使用 Claude Code Bash PreToolUse / PostToolUse 与 Cursor `beforeShellExecution` 的真实 hook 输入形态，`permission_mode` 取值按真实字段名构造；断言 `ask` 输出时须严格解析 JSON，不得只做子串匹配。
- 已跟踪统计用例必须对进程调用层设哨兵，证明 CLI 从未执行 `git rm`；提示命令的执行由测试本身在临时仓库中完成，并以 `git ls-files -z` 前后差集断言「恰好移出」。
- reporter 必须逐条产生 UT-S40-01～UT-S40-28、ST-S40-01～ST-S40-15 的 PASS/FAIL 记录，`scenario_id="S40"`；失败不得写 pass。

## 四、覆盖度校验

- [x] 清单增删查与配置读写：UT-S40-05～UT-S40-11、ST-S40-02、ST-S40-03
- [x] 非法路径与模式拒绝（含忽略规则来源与 `.git/` 下路径）：UT-S40-01～UT-S40-04、ST-S40-04
- [x] exempt 父目录不解除保护范围来源：UT-S40-27
- [x] 托管区块渲染、幂等、区块外不动、CRLF：UT-S40-12～UT-S40-15、ST-S40-01、ST-S40-02、ST-S40-07
- [x] 托管区块损坏与写入原子性：UT-S40-16、UT-S40-17、ST-S40-05
- [x] 已跟踪文件提示、可执行命令与非 git 仓库：UT-S40-18～UT-S40-20、UT-S40-25、UT-S40-26、ST-S40-01、ST-S40-06、ST-S40-15
- [x] list --format json：UT-S40-09、ST-S40-03
- [x] C14 宿主原生审批（ask / 阻断 / 批准 / 拒绝 / 每次独立）：UT-S40-21、UT-S40-22、UT-S40-28、ST-S40-08～ST-S40-10
- [x] C14 复合命令、间接调用、伪造文件与 hook 输入：UT-S40-23、UT-S40-24、ST-S40-11、ST-S40-14
- [x] C14 `--auto`、有活跃提案、Cursor：ST-S40-12、ST-S40-13
