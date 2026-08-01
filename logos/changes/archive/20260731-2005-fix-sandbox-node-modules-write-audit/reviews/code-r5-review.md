---
schema: runlogos/review@1
slug: fix-sandbox-node-modules-write-audit
node: code
round: 5
reviewer:
  agent: "Codex"
dispatch_id: drv-drv-ms8j4t5t-f62l-review-review-7e26b2
review_mode: full-fallback
verdict: BLOCK
summary: "F2 与 F3 已修复；F1 的回收临时文件仍可跟随预置 symlink 改写非白名单文件，故继续阻断。"
findings:
  - id: F1
    severity: critical
    category: risk
    title: "可预测回收临时文件仍可经预置 symlink 改写非白名单文件"
    location: "cli/src/lib/sandbox.ts:232-258（尤其 250-255）；cli/test/s13-verify.test.ts:1766-1832 未覆盖临时叶节点 symlink"
    status: insisted
  - id: F2
    severity: high
    category: correctness
    title: "相对 sandbox_root 与保护器失败分类已修复"
    location: "cli/src/lib/sandbox.ts:477-589；cli/test/s13-verify.test.ts:1834-1881"
    status: resolved
  - id: F3
    severity: high
    category: spec-gap
    title: "嵌套 node_modules 的 infos 检测已修复"
    location: "cli/src/lib/sandbox.ts:120-155, 617-621；cli/test/s13-verify.test.ts:1630-1643；cli/test/s19-smoke.test.ts:346-374"
    status: resolved
---

# 复审结论

本轮逐条处置 R1 的 F1、F2、F3。F2 与 F3 的修复符合 triage 声明，可以关闭；F1 已修复原先报告的白名单 `..`、回收源 symlink、目标父链 symlink 和审计失败仍回收等路径，但新引入的“临时文件 + 原子替换”实现仍保留同一 copy-back 边界漏洞，因此以原 ID **F1 insisted**，裁决为 **BLOCK**。

## F1：insisted

### 具体残留

`copyBackAllowedFiles()` 已检查回收目标的父目录链，却把临时文件名固定为：

```text
<dest>.<process.pid>.olcbtmp
```

随后直接执行 `copyFileSync(src, tmp)`。父链检查不检查这个临时叶节点，`copyFileSync` 又会跟随已存在的目标 symlink。因此，只要真实 workspace 在运行前已有一个内部链接：

```text
result.txt.<当前 PID>.olcbtmp -> victim.txt
```

该链接会被启动前 containment 判为安全的“workspace 内部 symlink”；copy-back 随后却通过它截断并改写非白名单 `victim.txt`，再把该 symlink `rename` 成白名单结果路径。

最小复现的脱敏结果为：

```json
{"command":"pass","sandbox":"pass","diagnostics":[],"victim":"recovered-result","resultIsSymlink":true,"resultTarget":"victim.txt"}
```

也就是说，命令和沙箱都报告 PASS，但可信回收阶段已经改变非白名单文件，同时把结果路径变成 symlink。这正是 F1 原始问题“copy-back 越过白名单/symlink 边界”的具体残留，并满足 D3 的 `file:line` 举证要求。

### 建议修法

在已验证的目标父目录中用不可预测名称并以原子、排他、no-follow 方式创建临时普通文件，例如使用 `openSync` 的 `O_CREAT | O_EXCL | O_NOFOLLOW`（平台不支持时 fail closed），通过返回的文件描述符写入并关闭后再 `renameSync`；不得先按可预测名字调用会跟随 symlink 的 `copyFileSync`。创建冲突时应重新生成随机名或返回结构化回收失败。

补充回归用例：预置 `<dest>.<pid>.olcbtmp` 内部 symlink 指向非白名单哨兵，断言哨兵字节不变、最终结果是普通文件，且命令不得在发生越界写入后仍报告 sandbox PASS；另覆盖同名普通文件碰撞，确保不会覆盖用户文件。

## F2：resolved

修复已将相对 `sandbox_root` 统一按项目根解析成绝对路径，临时目录、containment 根和保护器 profile 因而使用一致的绝对路径；实际 profile / `bwrap` 参数也在用户命令前单独预检，建立失败进入 `protectionFailure`，按 `always` FAIL / `auto` warn 分类，不再伪装成用户命令失败加 sandbox PASS。

新增的项目根外相对 root 正常隔离用例与项目根内自拷贝失败分层用例均通过。未发现 R1 所述缺陷残留，F2 关闭。

## F3：resolved

快照结果现携带 `sawDependencyDir`，任意层级遇到完整目录名 `node_modules` 即置位；最终 infos 条件合并基线与命令后快照，覆盖既有及运行期新建的嵌套依赖目录。UT-S13-49 已补固定 info/diagnostics 断言，smoke 侧也新增仅含 `packages/a/node_modules` 的共享执行器回归。

静态实现与测试结果均符合 §2.9 的任意层级契约，F3 关闭。

# 验证记录

- `npm run build`：通过。
- `s13-verify.test.ts`、`s19-smoke.test.ts`、`s16-json-output.test.ts`：3 个文件、159 项全部通过。
- `git diff --check`：通过。
- 另在系统临时目录执行了 F1 残留最小复现；未修改项目源码或用户工作区文件。
