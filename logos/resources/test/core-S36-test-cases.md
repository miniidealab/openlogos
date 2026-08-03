# core-S36: impact 测试用例

> 场景：S36 生命周期变更影响分类 | 来源变更：ci-change-impact-contract
> 全部测试代码必须写入 OpenLogos reporter（`logos/resources/verify/test-results.jsonl`，见 `logos/spec/test-results.md`）。

## 一、单元测试（UT，分类器纯函数 `lib/impact-classify.ts`）

| ID | 检查项 | 用例 | 期望 |
|----|--------|------|------|
| UT-S36-01 | lifecycle 集合正例 | `logos/.openlogos-guard`、`logos/changes/x/proposal.md`、`logos/changes/archive/20260801-1819-x/tasks.md`、`logos/resources/verify/test-results.jsonl`、`logos/.runtime/archive-watch/v1/instances/a.json` 逐一分类（空前缀） | 全部 `class: "lifecycle"` |
| UT-S36-02 | project 集合 | `logos/resources/database/core-db.sql`、`logos/logos.config.json`、`logos/logos-project.yaml`、`logos/resources/prd/1-product-requirements/core-01-requirements.md` | 全部 `class: "project"`（`logos/**` 内非 lifecycle 一律 project、不背书） |
| UT-S36-03 | external 集合 | `cli/src/index.ts`、`README.md`、`.github/workflows/ci.yml` | 全部 `class: "external"` |
| UT-S36-04 | 前缀段边界 | `logos/changes-evil/x.md`、`logos/changesfoo`、`logos/.openlogos-guard.bak`、`logos/resources/verifyx/a.md` | 均不命中 lifecycle（`project` class）；`logos/.openlogos-guard` 为精确文件匹配、`logos/changes` 目录及子路径按段边界命中 |
| UT-S36-05 | A/M/D 全 lifecycle | 变更集仅含 lifecycle 路径的 A、M、D 记录 | `lifecycle_only: true`，`non_lifecycle_paths: []` |
| UT-S36-06 | R 双侧规则 | ① `R100` 双侧均 lifecycle（live → archive）；② `R100` 旧侧 lifecycle 新侧 external；③ 反向 | ① 该文件 lifecycle；②③ 该文件非 lifecycle → `lifecycle_only: false`，越界侧进 `non_lifecycle_paths`，`files[].class` 取更不安全一侧 |
| UT-S36-07 | C 状态同 R 规则 | `C75` 双侧 lifecycle / 单侧越界 | 与 UT-S36-06 同判定（copy 与 rename 同规则） |
| UT-S36-08 | 相似度后缀解析 | `R100` / `R087` / `C75` 状态串 | 规范化为单字母 `R` / `C`；相似度数字不影响分类 |
| UT-S36-09 | 未知状态字母 | 含 `T`（typechange）/ `U` / `X` 记录的变更集 | `lifecycle_only: false`，`reasons` 含未知状态说明（不猜语义、不跳过该记录） |
| UT-S36-10 | 空输入 / 空 diff | 空字节流；仅分隔符的流 | `lifecycle_only: false` + 原因（fail-closed，空区间不判安全） |
| UT-S36-11 | 解析失败 | 截断记录（R 缺第二路径）、字段数不符的畸形流 | `lifecycle_only: false` + 原因；纯函数不抛未捕获异常 |
| UT-S36-12 | 空 marker 乱配对不影响结论 | 构造 Git exact-content rename 乱配对形态：`R100 logos/changes/x/VERIFY_PASS -> logos/changes/archive/20260801-x/SMOKE_PASS`（marker 文件名不对应） | 只按路径前缀判定：双侧均 lifecycle → 该文件 lifecycle；配对语义、marker 文件名、时间戳目录名均不参与判定 |
| UT-S36-13 | 辅助字段推断 | 纯 archive 提交形态（guard `D` + `logos/changes/<slug>/**` → `archive/**` 的 R 组） | `operations` 含 `"archive"`、`changes` 含该 slug；混合/不可推断形态下两字段可为空数组，`lifecycle_only` 判定不依赖两者 |
| UT-S36-14 | 混合变更集 | lifecycle 路径 + 一个 external 路径 | `lifecycle_only: false`，`non_lifecycle_paths` 恰含该 external 路径（确定性排序） |
| UT-S36-15 | 双输入同源一致 | 同一（字节流, 前缀）分别经 `--base/--head` 内部取流路径与 `--stdin` 路径喂入同一纯函数 | 分类结论逐字段一致（同一套 `PATH_CLASSES_V1` 常量，无第二份判据） |
| UT-S36-16 | 项目前缀剥除（monorepo） | 前缀 `packages/app/` 下分类 `packages/app/logos/changes/x/proposal.md`、`packages/app/logos/.openlogos-guard`、`packages/app/cli/src/x.ts`、`packages/other/y.ts` | 前二者剥前缀后 lifecycle；`packages/app/cli/src/x.ts` 剥前缀后 external；前缀外 `packages/other/y.ts` 不静默丢弃、直接 external 并进 `non_lifecycle_paths`；输出 `files[].path` 保留原始未剥前缀路径 |
| UT-S36-17 | 前缀段边界（伪前缀） | 前缀 `packages/app/` 下分类 `packages/app-evil/logos/changes/x`、`packages/appx/logos/.openlogos-guard` | 均不命中项目前缀 → external（前缀剥除按路径段边界，不做裸字符串前缀匹配） |
| UT-S36-18 | 修订词法拒绝 | option-like 值 `--output=/tmp/x`、`-O/tmp/f`、`--help`、空串作为 base/head 候选送入修订校验函数 | 全部词法拒绝（映射 `IMPACT_INPUT_INVALID`）；合法十六进制 OID、分支名、`HEAD~1` 等不以 `-` 开头的值通过词法层进入 `rev-parse` 解析 |

## 二、场景测试（ST，真实 CLI 入口，临时项目 / 临时 git 仓库内运行）

| ID | 用例 | 期望 |
|----|------|------|
| ST-S36-01 | 命令注册与可发现 | `openlogos --help` 含 `impact`；`cli/src/index.ts` supported 列表含 `impact`；命令可执行 |
| ST-S36-02 | `--base/--head` 端到端（纯 archive 提交）+ 完整 envelope 契约 | 临时 git 仓库构造纯 archive 提交（删 guard + changes 移入带时间戳 archive 目录），`--format json`：stdout success envelope、断言**完整 data 契约**——`schema_version === "openlogos-change-impact.v1"`、`lifecycle_only: true`、`files[]`/`non_lifecycle_paths`/`operations`/`changes`/`reasons` 全部在场；**命名回归**：data 递归键集合恰为契约声明键、不得出现任何未声明键（含 camelCase 泄漏形态 `schemaVersion`/`lifecycleOnly`/`oldPath`/`nonLifecyclePaths`）；exit 0 |
| ST-S36-03 | `--stdin` 端到端（无 git 依赖） | 把 ST-S36-02 同格式字节流经管道喂 `impact --stdin --format json`，在**非 git 目录**运行：结论与 ST-S36-02 逐字段一致（双模式一致性）、全程未调用 git |
| ST-S36-04 | 混合提交端到端 | archive 变更 + `cli/src/x.ts` 修改同区间：`lifecycle_only: false`、`non_lifecycle_paths` 含该代码文件、exit 0（判定完成非错误） |
| ST-S36-05 | git diff 失败 | 非 git 目录跑 `--base/--head`；git 仓库内给不存在的修订（`rev-parse --verify --end-of-options` 失败）：stderr error envelope `IMPACT_GIT_DIFF_FAILED`、非零退出、stdout 无 success envelope |
| ST-S36-06 | 参数组合非法 + Git 选项注入哨兵 | ① `--stdin` 与 `--base` 并存；两组皆缺；只给 `--base` 缺 `--head`；`--prefix` 与 `--base/--head` 并存：均 `IMPACT_INPUT_INVALID`、非零退出。② **注入哨兵**：`--base "--output=<项目内哨兵路径>"` 与 `--head "--output=<项目外哨兵路径>"`（各自独立跑）：`IMPACT_INPUT_INVALID`、非零退出、stdout 无 success envelope、**两处哨兵文件字节均不变 / 不被创建**、探针断言该值未到达任何 git 子进程 |
| ST-S36-07 | 默认文本输出 | 无 `--format json` 跑判定完成与操作错误两路径：stdout 人读摘要（结论 + 分类清单）、无 JSON；操作错误 stderr `Error [<code>]: <message>` 形态 |
| ST-S36-08 | 退出码不编码结论 | `lifecycle_only: true` 与 `false` 两形态均 exit 0；仅操作错误非零（决策红线：CI 只读 `lifecycle_only`） |
| ST-S36-09 | 只读性（项目内 + 项目外哨兵） | 运行前后对临时项目根全量做文件清单 + 逐文件哈希快照对比，并在**项目根外**布置哨兵目录同步快照，覆盖 exit 0（真/假）与两类操作错误路径（含 ST-S36-06 注入形态）：项目根快照完全不变（不写 marker / guard / 任何文件），项目外哨兵亦零变化 |
| ST-S36-10 | monorepo 端到端（双模式 + `diff.relative` 对抗配置） | 临时 git 仓库把 OpenLogos 项目布在 `packages/app/`，在 `packages/app/` 下运行：① 纯 archive 提交 → `lifecycle_only: true`（自动前缀经 `rev-parse --show-prefix` 生效）；② 同区间混入 `packages/app/cli/src/x.ts` → `false`；③ 混入项目前缀外 `packages/other/y.ts` → `false` 且该路径进 `non_lifecycle_paths`（不静默丢弃）；④ 同字节流经 `--stdin --prefix packages/app/` 在非 git 目录复跑 ①③ → 逐字段一致；⑤ **对抗配置档**：同一夹具执行 `git config diff.relative true` 后复跑 ①②③ → 结论与默认配置逐字段一致，并加**对照断言**证明有效 relative 模式未生效——`files[].path` 保留 top-level 坐标（含 `packages/app/` 前缀）、前缀外 `packages/other/y.ts` 仍在 `files[]` 与 `non_lifecycle_paths`（未被裁剪）、与 ④ 的 `--stdin` 完整字节流结论逐字段一致（取流显式 `--no-relative` 中和配置） |

## 三、覆盖度要求

- 路径语义契约 v1 三类（lifecycle / project / external）各至少一对正反例；lifecycle 四个集合成员（guard / changes 含 archive / resources-verify / .runtime）逐一覆盖（UT-S36-01）；段边界伪命中反例在场（UT-S36-04 路径层、UT-S36-17 前缀层）。
- A/M/D/R/C 五状态全覆盖；R/C 双侧规则正反例齐备（UT-S36-05~08）。
- fail-closed 兜底四形态（未知状态、空输入/空 diff、解析失败、乱配对）全覆盖（UT-S36-09~12）。
- 修订参数安全三层防线全锚定：词法拒绝（UT-S36-18）、`rev-parse --verify --end-of-options` 解析失败（ST-S36-05）、注入哨兵零写入（ST-S36-06②/09）。
- 坐标系对齐全锚定：前缀剥除与前缀外不丢弃（UT-S36-16/17）、monorepo 端到端双模式一致（ST-S36-10）、`diff.relative=true` 对抗配置下 top-level 坐标与不裁剪不变量的对照断言（ST-S36-10⑤，证明有效 relative 模式未生效）。
- 双输入模式一致性同时有纯函数级（UT-S36-15）与 CLI 端到端级（ST-S36-02/03/10④⑤）锚定。
- snake_case 命名回归（含 camelCase 泄漏反例）由 ST-S36-02 完整 envelope 断言锚定。
- 两个稳定错误码（`IMPACT_GIT_DIFF_FAILED` / `IMPACT_INPUT_INVALID`）各有端到端产出用例（ST-S36-05/06）。
- 实现批次交付时，UT/ST 与本表 ID 一一对齐，reporter 逐条上报。
