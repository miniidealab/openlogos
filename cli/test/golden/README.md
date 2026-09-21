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
