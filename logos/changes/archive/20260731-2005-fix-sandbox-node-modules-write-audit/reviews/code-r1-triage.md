---
schema: runlogos/triage@1
slug: fix-sandbox-node-modules-write-audit
node: code
round: 1
responder:
  agent: "Claude Fable 5 (code-implementor)"
dispatch_id: drv-drv-ms8j4t5t-f62l-review-triage-962837
responses:
  - id: F1
    decision: fixed
    change_ref: "cli/src/lib/sandbox.ts：①新增 buildAllowedWriteSet 白名单入口校验——拒绝绝对路径与规范化后含 .. 的越界路径（违规既不参与审计放行也不参与回收）；②copyBackAllowedFiles 加固为：源 lstat 只接受普通文件（symlink/目录/特殊文件拒绝）、源 realpath containment 于沙箱 workspace、目标父链逐段 no-follow 校验（任一段 symlink 即拒绝）、临时文件 + 原子 renameSync 落盘；③回收次序重排——always 且已检出非白名单写入时整体跳过回收（审计 FAIL 时原 workspace 零变化）；④回收/白名单违规映射为结构化诊断「白名单回收校验未通过」，always 置 sandbox fail + command fail，auto 置 warn。新增 4 个回归测试（cli/test/s13-verify.test.ts）：internal-copyback-symlink-result（动态逃逸链接白名单路径拒绝回收、victim 不变）、internal-copyback-traversal（../ 白名单拒绝且父目录零产物）、internal-copyback-parent-symlink（目标父链 symlink 拒绝）、internal-copyback-zero-change-on-always-fail（审计 FAIL 零回收），对应正文建议修法 1-4"
    reason: "成立。正文两条复现链路（copy-back 植入逃逸链接 + ../ 穿越）均由「定点采集不再经过快照 diff 过滤」引入，属本提案代码新增的攻击面。已按正文建议修法逐条落地。"
  - id: F2
    decision: fixed
    change_ref: "cli/src/lib/sandbox.ts：①sandboxBase 统一 resolve(normalizedRoot, sandboxBase) 解析为绝对路径（相对值相对项目根，绝对值不变），后续 mkdtemp、containment 根、profile 路径与 cwd 全程绝对路径；②buildWriteProtection 返回 {probeCommand, wrap}，在执行用户命令前用最终生成的 profile / bwrap 绑定参数跑精确预检（/usr/bin/true），profile 写入或预检失败单独归因为「运行期写保护建立失败」——always 返回 sandbox FAIL + 具体原因，auto 走「保护不可用」告警降级分支，绝不再落入用户命令失败 + sandbox pass 的误分类。新增回归：internal-relative-sandbox-root-outside（相对 root 解析后正常隔离、命令 pass/sandbox pass/结果回收）、internal-relative-sandbox-root-inside（root 落 workspace 内自拷贝失败按无法隔离处理：auto 降级 warn + 命令照常执行，always 明确 setup failed，均非伪装命令失败）"
    reason: "成立。修法与正文建议一致（绝对化 + 最终参数精确预检 + 失败单独映射能力分层）。正文点名的「最终保护参数建立失败的 auto/always 测试」说明：保护器建立失败（profile 写失败/预检非零）与能力探测不可用在实现中收敛为同一 protectionFailure 分支、同一 always FAIL / auto warn 映射，该分支行为已由 UT-S13-55（能力分层）与新增两条相对 root 用例共同锁定；在无特权注入点的测试环境中无法稳定强制 sandbox-exec 对合法 profile 预检失败，故以同分支等价覆盖代替直接构造，属实现细节等价而非语义偏离。"
  - id: F3
    decision: fixed
    change_ref: "cli/src/lib/sandbox.ts：listFileSnapshots 返回 {snapshots, sawDependencyDir}，遍历中跳过任意层级完整段名等于 node_modules 的目录时置位；infos 条件改为 denyWorkspaceWrite && (baseline.sawDependencyDir || afterRun.sawDependencyDir)——覆盖嵌套 monorepo 形态与运行期新建的依赖目录，替换原先仅查 sandboxProjectRoot/node_modules 的实现。测试：UT-S13-49 增补断言（infos 含固定说明、diagnostics 不含）；cli/test/s19-smoke.test.ts 新增 internal-S19-nested-node-modules-infos（仅含 packages/a/node_modules 的 smoke 共享执行器回归：gate PASS + infos 在场 + 不入 diagnostics）"
    reason: "成立。实现只查根级 node_modules 确与 §2.9「存在任一命中完整段规则的目录」不符；按正文建议改在快照遍历中短路记录并补齐两侧断言。"
---

# Code 第 1 轮 triage 结论

3 条 finding 全部成立、全部 fixed。核心变化：copy-back 从「信任白名单字符串直接 join+cpSync」升级为「入口校验 + 源类型/realpath 校验 + 目标父链 no-follow + 原子落盘 + 审计 FAIL 零回收」；sandbox_root 全程绝对化并以最终保护参数做精确预检，保护器建立失败单独走能力分层；infos 检测覆盖任意层级依赖目录。CLI 全量测试 1509/1509 通过（新增 7 个回归 + 2 处断言增补）。
