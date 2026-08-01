---
schema: runlogos/review@1
slug: fix-sandbox-node-modules-write-audit
node: code
round: 1
reviewer:
  agent: "Codex"
dispatch_id: drv-drv-ms8j4t5t-f62l-review-review-851780
review_mode: full
verdict: BLOCK
summary: "定点回收仍可越过 symlink/路径边界，运行期保护器存在错误分类回归，且嵌套依赖目录缺失约定的 infos，当前实现不可放行。"
findings:
  - id: F1
    severity: critical
    category: risk
    title: "定点回收可把动态 symlink 或路径穿越带回真实工作区"
    location: "cli/src/lib/sandbox.ts:154-165, 472-504；cli/src/commands/verify.ts:267-270, 893-895"
    status: open
  - id: F2
    severity: high
    category: correctness
    title: "保护器启动失败被误报为用户命令失败并保留 sandbox pass"
    location: "cli/src/lib/sandbox.ts:257-269, 371-392, 472-515"
    status: open
  - id: F3
    severity: high
    category: spec-gap
    title: "仅含嵌套 node_modules 的 monorepo 不会产生约定的 infos"
    location: "cli/src/lib/sandbox.ts:493-496；cli/test/s13-verify.test.ts:1630-1641"
    status: open
---

# 评审结论

本轮裁决为 **BLOCK**。F1 使本提案新增的 symlink 运行期保护在可信 copy-back 阶段失效，并且在 `always` 已判失败时仍可改变真实工作区；F2 与 F3 分别违反能力分层和依赖目录信息级诊断契约。

## F1：定点回收可把动态 symlink 或路径穿越带回真实工作区

规格要求 symlink 隔离先于依赖目录豁免生效，运行期新建或改写链接不得导致原 workspace 字节变化；白名单只表示允许回收配置声明的结果文件，并不授权经该路径写入其他工作区文件或 workspace 之外。

当前 `copyBackAllowedFiles()` 对白名单字符串直接执行 `join()` 与 `cpSync()`，既不拒绝绝对路径/`..`，也不对源文件类型、源 realpath、目标父链或目标 realpath 做 containment 校验。更严重的是，copy-back 在非白名单写入被转成 `always` 失败之前执行。因此，命令可以在沙箱内把白名单结果路径改成指向原 workspace 非白名单文件的绝对 symlink；OS 保护会阻止命令经链接直接写入，但可信 CLI 随后的 copy-back 会把链接植入真实 workspace。

本地最小复现得到：

```json
{"command":"fail","sandbox":"fail","copiedDespiteFail":true,"copiedTarget":"<origin>/victim.txt"}
```

也就是说，即使命令与沙箱最终均报告失败，真实工作区中的白名单结果路径已经变成逃逸链接。另一个复现先让沙箱命令创建白名单 `result.txt -> <origin>/victim.txt`，`runSandboxedCommand()` 返回 `command=pass`、`sandbox=pass`；随后对 `result.txt` 的普通可信写入把 `victim.txt` 从 `sentinel` 改成了 `trusted-cli-write`。这不是假设链路：verify 把 `logos/resources/verify/acceptance-report.md` 加入命令白名单，沙箱返回后又在 `collectVerifyData()` 中直接 `writeFileSync()` 该路径，因而同类链接可立即把报告写入重定向到任意原 workspace 文件。

定点回收还新增了直接路径穿越：以 `allowedWritePaths=["../outside/result.txt"]` 运行 `always`，命令只在沙箱 workspace 的父目录生成该文件，实测返回：

```json
{"command":"pass","sandbox":"pass","diagnostics":[],"outsideContent":"escaped-always"}
```

旧的“变更 diff ∩ 白名单”不会从 workspace 快照中得到 `../outside/result.txt`；新的定点遍历却会将其复制到真实 workspace 的父目录。

建议修法：

1. 在进入回收前把每个白名单值规范化为严格的 workspace 相对路径，拒绝绝对路径、空路径和任何解析后越过根目录的 `..`；分别验证源、目标均 containment 于各自根目录。
2. 结果路径均为文件，回收源应使用 `lstat` 并只接受普通文件；拒绝 symlink、目录及其他特殊文件。目标父链也必须做 no-follow containment，避免原 workspace 既有 symlink 重定向。
3. 用安全临时文件加原子替换完成落盘，且将回收失败转成结构化 sandbox 失败；不得在 `always` 非白名单审计失败后仍植入未经验证的对象。
4. 新增回归：动态绝对/相对逃逸 symlink、目标父链 symlink、`../` 白名单，以及“审计已 FAIL 时原 workspace 零变化”。

## F2：保护器启动失败被误报为用户命令失败并保留 sandbox pass

`sandbox_root` 的配置契约没有声明“必须为绝对路径”，本提案也声明 API 无变化。实现却原样保留相对 `sandbox.root`，从而让 `sandboxDir` 和 macOS profile 路径保持相对；随后 `executeCommand()` 以更深一层的 `sandboxProjectRoot` 为 cwd 执行包装命令，`sandbox-exec -f` 因而从错误目录寻找 profile。相同的相对/绝对混用还会使 `findEscapingSymlinks()` 把内部相对链接误判为逃逸。

在运行期保护能力可用的 macOS 上，以 `sandbox.root="sandboxes"` 和用户命令 `/usr/bin/true` 复现，结果为：

```json
{"command":"fail","sandbox":"pass","error":"sandbox-exec: sandboxes/.../write-protect.sb: No such file or directory","diagnostics":["命令在沙箱内执行失败，请检查 pre-run / smoke 命令输出。"]}
```

这既破坏了原本可用的相对 `sandbox_root`，也违反能力分层：失败的是保护器建立，不是用户命令；`always` 应返回 sandbox FAIL 和具体隔离原因，`auto` 应按“保护不可用”分支告警降级，而不是把 sandbox 标成 pass 后伪装成测试失败。更一般地，当前实现只探测一个宽松的 `/usr/bin/true`，实际 profile 或 `bwrap --ro-bind` 启动失败仍会与用户命令退出混为一谈。

建议先将 `sandboxBase` 按明确契约解析成绝对路径（若允许相对值，建议相对项目根解析），后续临时目录、containment 根、profile 路径与 cwd 全程只使用绝对路径；在执行用户命令前，用最终生成的 profile/绑定参数做精确保护器预检，并将保护器建立失败单独映射到 `always` FAIL / `auto` warn。补充相对 root、含内部 symlink 的相对 root，以及最终保护参数建立失败的 auto/always 测试。

## F3：仅含嵌套 node_modules 的 monorepo 不会产生约定的 infos

功能规格 §2.9 明确规定：启用隔离、写保护为 true，且沙箱副本内存在任一命中完整路径段规则的目录时，必须附加固定 `sandbox.infos`。实现只检查 `sandboxProjectRoot/node_modules`，没有检查 `packages/a/node_modules` 等本提案明确纳入范围的 monorepo 形态。

以仅含 `packages/a/node_modules` 的 workspace 执行 `always`，实测为：

```json
{"command":"pass","sandbox":"pass","infos":null}
```

现有 UT-S13-49 只断言命令不失败和没有非白名单诊断，没有断言 `infos`，因此未捕获该契约缺口。

建议在已有目录遍历/containment 扫描中记录是否见过任意名称严格等于 `node_modules` 的目录，或使用同一段匹配器做一次可短路的目录检测，并据此生成 `infos`；同时让 UT-S13-49 断言固定 info 存在、未进入 diagnostics，另补 smoke 共享执行器的嵌套形态回归。

# 验证记录

- `npm run build`：通过。
- 定向执行 `s13-verify.test.ts`、`s19-smoke.test.ts`、`s16-json-output.test.ts`：3 个文件、152 项全部通过。
- `npm test`：54 个文件、1502 项全部通过。
- `git diff --check`：通过。
- `npm run lint`：未通过；6 个错误均为仓库既有未使用符号（`baseline-seed.ts`、`baseline-seed-txn.ts` 及 `verify.ts` 的既有 `pushUniqueMany`），不列为本提案 finding。
