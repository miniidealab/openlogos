# 零回归基线（golden）

`prechange-baseline.json` 是 **add-markdown-create-whole-file-protocol 实现落地之前**的实测输出，
用于 UT-S39-80 / UT-S39-81 / UT-S39-82 / UT-S35-184 / UT-S35-187 的零回归举证。

## 为什么必须是落盘基线

改动前基线**不能在运行时由待测的新版实现生成**。把当前 merge 输出与同一版本的 composer 相比，
两侧同步改变输出时断言仍然通过——那证明的是「实现与自己一致」，不是「与改动前逐字相同」。
同理，只检查「当前检查项 id 互不重复」「当前违规码集合含某个旧码」也不构成集合零改动的证明：
新增一个名称不同的检查项或违规码仍满足全部断言。

## 生成方式（可追溯，一次性）

基线取自 `git HEAD`（提交 `06f7656`，本次实现的**父提交**状态）的编译产物：

1. `git archive HEAD cli spec` 导出变更前源码到一次性目录（新增的
   `whole-file-marker.ts` / `added-anchor-outcome.ts` 在该状态下不存在，5 个被改文件均为改动前版本）；
2. 在该目录用同一套 `tsconfig.json` 执行 `npx tsc` 得到**变更前** `dist`；
3. 以 `regression-fixtures.json` 为输入，调用变更前的 `composeOpenLogosMarkdown`、
   `validateAndStripNonMarkdownDelta` 与 `runChangeLint`，把输出原样写入本文件。

`regression-fixtures.json` 是夹具的**唯一定义点**：生成脚本与测试读同一份，保证基线与断言
比较的是同一输入。改夹具必须同批重生成基线，否则比较的就不是同一件事。

## 反证（确认断言会失败）

- 令 composer 的 ADDED 段尾多一个空行 → UT-S39-80、UT-S39-82、UT-S35-184 变红。
- 向 `CHANGE_LINT_VIOLATION_CODES` 加一个成员 → UT-S35-187 变红。

## 何时可以更新

只有当**有意**变更这些输出或集合时才重新生成，且必须连同变更理由一起评审。
日常实现改动不得为了让测试变绿而刷新基线。

---

# `prechange-lint-render.json`（fix-lint-violation-check-attribution）

**change-lint 呈现层修复落地之前**的实测输出，用于 UT-S35-190～UT-S35-195、ST-S35-35 的
零回归与「事故形态」举证。

## 内容

三份夹具形态（`l4-only` / `l4-and-l8` / `clean`，定义见 `../lint-render-fixture.ts`）各录：

| 键 | 内容 |
|---|---|
| `text` | 默认人类可读格式的真实进程 `status` / `stdout` / `stderr` |
| `json` | `--format json` 的 `status` 与 envelope 的 `data`（`timestamp` / `version` 与本刀无关，不入基线） |
| `checks` | 改动前 `runChangeLint` 返回的检查项集合（id / label / violations） |
| `_violation_codes` | 改动前 `CHANGE_LINT_VIOLATION_CODES` 成员序列（顶层键，非夹具） |

## 生成方式（可追溯，一次性）

本刀只改 `cli/src/lib/change-lint.ts` 与 `cli/src/commands/change-lint.ts`。基线在**动这两个文件之前**、
以工作树当时的 `dist`（等于 `git HEAD` 状态）录制：一次性 vitest 生成器用
`lint-render-fixture.ts` 构造三份夹具项目，spawn `dist/index.js` 跑两种格式并 `await import('../dist/lib/change-lint.js')`
取检查项与码集合，原样写入本文件；录完即删除生成器。

夹具构造代码由 `lint-render-fixture.ts` **单点提供**，基线与断言读同一份——否则「逐字节相同」
比较的不是同一件事。

## 基线所固定的事故形态（不是期望行为）

- `l4-only.text.stdout`：**L4 整行消失**，底部只剩 `FAIL（8/9，1 项违规）`，全文不含 code / path / fix_hint；
  同次 `✓ L8` 是**正确**行为（该输入在 L8 确实零违规）。
- `l4-and-l8.text.stdout`：两条同码违规**都被打在 L8 下**、L4 整行消失——`checkOfCode`（以 code 为
  唯一入参反推层号）的结构性反证：`checks` 明明记着 L4=1、L8=1。

## 反证（确认断言会失败）

- 把渲染归层改回「以 code 反推层号」（并放松 fail-loud）→ UT-S35-190、UT-S35-191、UT-S35-192、
  ST-S35-35 四条变红；三条零回归锚（193/194/195）保持绿，因为它们锁的是本刀不改的契约。

## 何时可以更新

同 `prechange-baseline.json`：只有**有意**变更这些输出或集合时才重新生成，且须连同理由一起评审。
日常实现改动不得为了让测试变绿而刷新基线。
