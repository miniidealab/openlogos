# OpenLogos 生命周期变更影响契约（change-impact）

> 权威声明：本文档是 `openlogos impact` 路径语义契约的**权威文字声明**；机器常量 `PATH_CLASSES_V1` 位于 `cli/src/lib/impact-classify.ts`，JSON 输出契约登记于 `spec/cli-json-output.md` §3.16。三处同源维护，任何一处变更必须同轮同步其余两处。来源变更：ci-change-impact-contract（社区 RFC issue #9，S36）。

## 1. 目的与范围

下游项目 CI 在 launched 生命周期下依据 Git changed paths 判断一次 push（任意 `base..head` 区间）是否影响可部署制品。本契约由 OpenLogos 官方声明**哪些路径是纯生命周期簿记**（确定不进入制品），使纯 `openlogos archive` 等簿记提交不再被下游 fail-closed 路径分类器误判为制品变更。

**范围红线**：本契约只声明「确定安全」的 lifecycle 集合；其余一切不背书。它不替项目判断业务源码 / Dockerfile / 部署配置是否影响制品，不改变 archive / merge / verify 任何现有行为与输出，不修改任何 marker 内容（「逐字节等价」契约不受影响）。

## 2. 路径语义契约 v1（`PATH_CLASSES_V1`）

匹配对象为**剥除项目前缀后的 OpenLogos 项目根相对路径**（坐标系见 §3）：

| class | 集合 | 语义 |
|-------|------|------|
| `lifecycle` | `logos/.openlogos-guard`（精确文件）；`logos/changes/**`（含 `archive/**`）；`logos/resources/verify/**`；`logos/.runtime/**` | OpenLogos 官方背书：纯生命周期簿记，确定不进入可部署制品 |
| `project` | `logos/**` 下上述之外的一切（含 `resources/database/**`、`logos.config.json`、`resources/prd/**` 等） | 项目自决：可能进入制品或影响 verify/smoke，OpenLogos 不越界背书 |
| `external` | 项目前缀外的一切，以及项目内 `logos/` 之外的一切 | 项目业务域，OpenLogos 完全不判断 |

- 匹配按**路径段边界**：`logos/changes/x` 命中，`logos/changes-evil/x`、`logos/changesfoo` 不命中；`logos/.openlogos-guard` 为精确文件匹配。
- 路径以 `/` 分隔（git 原生输出形态）；输入采 `git diff --no-relative --name-status -z` 字节流，`-z` 规避引号转义与特殊字符文件名，`--no-relative` 保证 top-level 坐标（见 §3）。

## 3. 路径坐标系（monorepo 兼容）

Git 输出始终相对 **git top-level**；OpenLogos 项目根可位于 monorepo 子目录。规则：

- **分类坐标 = 项目根相对路径**：分类前按**已验证的项目前缀**（按路径段边界）剥除输入路径前缀。`--base/--head` 模式经 `git rev-parse --show-prefix` 自动取得前缀；`--stdin` 模式由调用方经 `--prefix <dir/>` 显式提供，缺省 = 空前缀（输入已是项目根相对）。
- **前缀外路径不静默丢弃**：直接归 `external`（non-lifecycle），照常计入 `files[]` 与 `non_lifecycle_paths`；禁止用 `--relative` 等手段使其从判定中消失。
- **输出坐标 = 原始输入路径**：`files[].path` / `files[].old_path` / `non_lifecycle_paths` 保留未剥前缀的原始路径。
- **取流配置中和（不变量守卫）**：git 模式取流命令**必须显式携带 `--no-relative`**——仓库/用户配置 `diff.relative=true` 等价于启用相对模式，会把输出路径改写为当前目录相对并**静默裁掉当前目录外的变更**，同时破坏「输出始终为 git top-level 坐标」与「前缀外不丢弃」两条不变量、使 git 模式无法与 `--stdin` 完整字节流一致；文档禁令不足以覆盖配置来源，必须落在命令行开关上并由对抗配置测试锚定（实现须证明有效 relative 模式未生效）。`--stdin` 调用方须保证字节流为 top-level 坐标（示例统一带 `--no-relative`）。
- **双模式一致性不变量**：同一（字节流, 前缀）输入,两输入模式逐字段结论一致（同一套纯函数与常量，无第二份判据）。

## 4. Git 状态流解析与判定规则（全部 fail-closed）

- **状态覆盖（状态族闭合文法）**：`A` / `M` / `D`（裸单字母、单路径，**不携任何后缀**）；`R` / `C`（**必须**携 1–3 位、值域 0–100 的相似度分值如 `R100`，双路径，规范化为单字母）。交叉形态（`A100`、`M1`、裸 `R`、`R101` 等）不属于任何合法状态族，一律判解析失败（fail-closed）。R/C 必须**新旧路径双侧均为 `lifecycle`** 才算 lifecycle；`files[].class` 取双侧中更不安全一侧。
- **路径规范性**：每个路径（R/C 含双侧）必须是合法 git top-level 相对路径——非空、非绝对路径、无空段、无 `.` / `..` 段（git 树路径不会合法产生这些形态；点段可先命中 lifecycle 前缀、归一化后却指向 project 文件）。`--prefix` 采用同一段级不变量。非法路径记录毒化整批结论（fail-closed），禁止用会改写合法特殊文件名的文件系统归一化代替校验。
- **不依赖配对语义**：只按路径前缀分类，完全不依赖 rename 配对结果、时间戳归档目录名与 marker 文件名——空 marker 被 Git exact-content rename 检测任意配对（如 `VERIFY_PASS -> SMOKE_PASS`）不影响结论。
- **fail-closed 兜底**：未知状态字母（`T` / `U` / `X` 等）、字节流解析失败（截断记录、字段数不符）、空 diff、空输入 → 判定完成且 `lifecycle_only: false`，原因写入 `reasons`。空 diff 不判 true（CI 语境空区间多为传参错误，宁可多构建）。
- **结论**：`lifecycle_only === true` 当且仅当变更集非空、全部记录解析成功、且每个文件（R/C 含双侧）均为 `lifecycle`。
- **唯一决策字段**：`lifecycle_only`。`operations` / `changes` / `reasons` 仅辅助展示，CI 不得据其做部署决策；退出码不编码判定结论（判定完成一律 exit 0），CI 不得以退出码替代 `lifecycle_only`。

## 5. 修订参数安全（防 Git 选项注入）与只读红线

`--base` / `--head` 值即使经参数数组传递，Git 仍会把 `-` 开头的值解析为选项（如 `--output=<path>` 是真实写入口）。三层防线，任何实现不得绕过：

1. **词法拒绝**：值为空或以 `-` 开头 → `IMPACT_INPUT_INVALID`，不把该值传给任何 git 进程。
2. **修订解析隔离**：`git rev-parse --verify --end-of-options <rev>^{commit}` 分别解析 base / head 为完整十六进制 commit OID（兼容 SHA-1/SHA-256）；失败 → `IMPACT_GIT_DIFF_FAILED`。
3. **diff 只收规范化 OID 且显式 `--no-relative`**：`git diff --no-relative --name-status -z <base_oid> <head_oid>` 位置参数只允许上一步产出的 OID；`--no-relative` 中和 `diff.relative` 配置（见 §3 取流配置中和）。

**取流缓冲上限（资源红线）**：git 模式取流必须显式设置足够的输出缓冲上限（实现值 256 MiB；Node `execFileSync` 默认约 1 MiB，会把合法大变更集误杀为 `IMPACT_GIT_DIFF_FAILED`）；超出显式上限仍 fail-closed 报 `IMPACT_GIT_DIFF_FAILED`（稳定错误语义），绝不误判 `lifecycle_only: true`。

**只读红线（项目内外）**：命令全程只读——不写任何项目文件、marker、guard，也不得因参数值产生项目外任何文件系统写入。

## 6. 版本与兼容

- data 契约携 `schema_version: "openlogos-change-impact.v1"`；字段**只增不改**；破坏性变更（删字段 / 改义 / 改判定语义）须升 `openlogos-change-impact.v2` 并保留 v1 过渡期。
- `PATH_CLASSES_V1` 集合变更同理版本化（v1 常量冻结，扩集合走 v2）。
- 全部公开字段 snake_case（`spec/cli-json-output.md` §1.1）；字段清单与错误码以 §3.16 / §6.1 登记为准。
- 建议 CI pin 住 CLI 版本消费本契约，避免隐式升级引入判定行为变化。
