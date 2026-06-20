# 待建提案草稿：flow-cmd-predicate（M2 切片 1b · cmd: 谓词）

> 状态：**草稿，暂存**。本切片**依赖前置切片 `flow-overlay-derive`（M2 切片 1a）先合并归档**后再创建。
> 创建方式：`flow-overlay-derive` 归档后 `openlogos change flow-cmd-predicate`，把以下内容填入 proposal.md / tasks.md。
> 已纳入两轮 Codex review 结论：F2/F3/F4/F5/F6（上一轮）+ G1/G2/G3/G4（本轮）。
> 场景编号：本切片用 **S26**（S25 归 flow-overlay-derive）；counter 26→27。

---

## proposal.md

```markdown
# 变更提案：flow-cmd-predicate

> module: core

## 变更原因

「可编排研发流程」M2 第 1b 薄切片：点亮 `done_when` / `fail_when` 词表中标【M2 预留】的
`cmd:"<command>"` 谓词——让节点完成判定可由命令退出码决定（如 `npm test`、`gh pr checks`），
是「嵌入既有 CI/PR 流程」与后续「loop 测试绿收敛」（M2 切片 2）的共同底层依赖。

**前置依赖（已先行）**：本切片依赖 `flow-overlay-derive`（M2 切片 1a）——派生引擎已改读 resolved flow
（含 overlay），overlay 节点（含 `cmd:`）才会进入 status/next/watch 派生。本提案**不再含**任何
overlay-in-derivation 改造，专注 `cmd:` 谓词本身。

**已锁定设计**：
1. 执行时机 = 仅 `next` 求值；`status`/`watch` 不执行命令、该节点派生态 = **pending（未求值）**，保持观测面只读。
2. 信任边界 = 委托宿主（同 §11 pre/post_script）；执行约束锁死：cwd=项目根、两级可配超时
   （节点级 `cmd_timeout_seconds` > 项目级 `flow.cmd_timeout_seconds` > 内置 60s）、exit 0=done、非 0/超时=未 done（不崩溃）。

**范围边界**：只做 `done_when`/`fail_when` 的 `cmd:` 谓词；loop 真迭代、测试绿收敛、gate `cmd` 类型、
fan-out 阈值均不在本切片。内置模板零 `cmd:`、无 overlay 项目 resolved==builtin → golden 零漂移。

## 变更类型
接口级 + 代码级（点亮 cmd: 谓词 + next 求值路径 + 机器契约；不改默认 status/next/watch 行为）。

## 变更范围
- 需求/设计文档：`core-01-requirements`（场景表新增 S26）、`core-01-feature-specs`、`core-01-cli-experience`
  （cmd: 节点在 status/watch 显示 pending、在 next「执行命令→done/重试」）
- flow 规格 `spec/flow-spec.md`：§9 cmd: 点亮（附执行约束；注明未求值→pending，pending 不进谓词词表）；
  §12 双模式派生（观察派生 status/watch=pending 阻断推进 / 求值派生 next 执行一次仅本响应内续推；
  节点派生态枚举 done|active|pending|failed|skipped）；**§9 fail_when 求值顺序对 cmd 的细化（见 G4）**；§13 边界表拆出 cmd:
- 机器契约 `spec/cli-json-output.md`（见 G1/G2/G4）
- 项目配置 `logos.config.json` + **`spec/logos.config.schema.json`**（见 G3）+ `spec/directory-convention.md`
- 业务场景：新增 S26（cmd: 谓词在 next 求值），配套 scenario-overview / architecture-overview / traceability-matrix
- API/DB：无

## 部署影响
- 是否需要部署：否（M2 切片渐进交付，verify 通过即归档，release 留到 M2 阶段性完整批量做）
- 其余：无迁移、无回滚预案、无 smoke

## 变更概述
点亮 `cmd:` 谓词：节点完成判定可由命令退出码决定。仅 `next` 执行命令；status/watch 显示 pending 不执行。
依赖 `flow-overlay-derive` 已就位的 resolved 派生。内置零 cmd: → golden 零漂移。
```

---

## tasks.md

```markdown
# 实现任务

## [delta] 规格变更
- [ ] `deltas/spec/flow-spec.md` — MODIFIED：
      (1) §9 cmd: 由【M2 预留】→点亮，附执行约束（cwd=根、两级超时、exit 0=done、非 0/超时=未 done）；注明未求值→pending（pending 非谓词不进词表）；
      (2) §12 双模式派生（观察=pending 阻断 / 求值=next 执行一次仅本响应续推；枚举 done|active|pending|failed|skipped）；
      (3) **§9/§12 细化 fail_when:cmd 求值顺序（G4）**：next 先评 fail_when:cmd（exit 0→failed；非 0/超时→未命中）再评 done_when:cmd；
          同一节点 done_when 与 fail_when 均为 cmd 时的执行/复用语义明确写死（建议：分别执行，不复用，或显式禁止同节点双 cmd —— 二选一拍板）；
      (4) §13 边界表拆出 cmd: 标本切片，loop/测试绿收敛仍 M2
- [ ] `deltas/spec/cli-json-output.md` — MODIFIED：
      (a) done_when/fail_when 允许 cmd: 字符串；
      (b) §9 node 字段表新增 `flow.subflows[].nodes[].cmd_timeout_seconds`（int|null）；
      (c) **node 级派生态承载结构由前置切片 `flow-overlay-derive` 已建（status node 视图 + next `current_node`）**，cmd: 切片仅在枚举追加 **`pending`** 态值及其 JSON 表达；
      (d) **G1：next 执行 cmd 时 child 的 stdout/stderr 必须被捕获、不得写入 stdout**，保证 `next --format json` 仍是单条合法 envelope；
      (e) **G2：cmd 非 0/超时 = 业务谓词结果、走 success envelope**（携带 `cmd_exit_code`/`cmd_timed_out`/`cmd_done:false`）；
          **仅项目未初始化 / flow schema 非法 / 命令启动失败（spawn 失败）才走 error envelope**
- [ ] `deltas/spec/logos.config.schema.json` — MODIFIED（**G3**）：新增 `flow.cmd_timeout_seconds`（type integer、minimum 1、default 60、描述与 verify/smoke 块对仗）
- [ ] `deltas/spec/directory-convention.md` — MODIFIED：config 块说明补 `flow.cmd_timeout_seconds`（项目级默认、优先级 节点级>项目级>60s）
- [ ] `deltas/prd/1-product-requirements/core-01-requirements.md` — MODIFIED：场景表新增 S26
- [ ] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md` — MODIFIED：next 对 cmd 求值边界、status/watch pending、cmd 与 --auto 正交
- [ ] `deltas/prd/2-product-design/2-page-design/core-01-cli-experience.md` — MODIFIED：cmd 节点输出设计（pending / 执行→done|重试）
- [ ] `deltas/prd/3-technical-plan/2-scenario-implementation/core-00-scenario-overview.md` — MODIFIED：新增 S26；同时登记 logos-project.yaml + counter 26→27 回读验证
- [ ] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S26-cmd-predicate.md` — ADDED：S26 时序（next 遇 cmd 节点→先 fail_when 再 done_when→执行→success envelope 带结果字段；status/watch→pending 不执行）
- [ ] `deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md` — MODIFIED：新增 flow-cmd.ts 求值器；说明 stdout/stderr 捕获、仅 next 求值、信任委托
- [ ] `deltas/prd/3-technical-plan/2-scenario-implementation/core-99-traceability-matrix.md` — MODIFIED：新增 S26 行
- [ ] `deltas/test/core-S26-test-cases.md` — ADDED：cmd UT/ST（exit 0→done；非 0→保持 active+success envelope 带 cmd_exit_code；超时→未 done 不崩溃；
      **命令向 stdout 打印内容时 next --format json 仍仅单条合法 envelope（G1）**；非 0/超时走 success 非 error envelope（G2）；spawn 失败→error envelope；
      fail_when:cmd 求值顺序（G4）；两级超时优先级；status/watch→pending 不执行（断言无副作用）；默认 golden 零漂移；复用 S22 临时 overlay 模式）

## [code] 代码实现
- [ ] 新增 `cli/src/lib/flow-cmd.ts`：cmd 求值器——cwd=项目根、两级超时；**捕获 child stdout/stderr（不继承父进程 stdout）**；
      返回 `{ done: exit===0, exitCode, timedOut }`；spawn 失败抛可识别错误（上层转 error envelope）；超时/非 0 不抛；仅 next 调用
- [ ] 改 `cli/src/lib/flow.ts`：done_when/fail_when 接受 cmd: 字符串 + 可选节点级 cmd_timeout_seconds；内置模板不受影响
- [ ] 改项目配置读取（`cli/src/lib/config.ts` 或等价）：识别 `flow.cmd_timeout_seconds`，实现 节点级>项目级>60s 优先级
- [ ] 改 `cli/src/commands/next.ts`：active 节点先评 fail_when:cmd（exit 0→failed）再评 done_when:cmd（exit 0→done 续推）；
      非 0/超时→保持 active、**success envelope** 带 cmd_exit_code/cmd_timed_out/cmd_done:false + 「修复后重试」提示
- [ ] 改 `cli/src/commands/status.ts`、`watch.ts`：遇 cmd 节点不执行、派生态 pending；文本与 --format json 如实表达；只读零副作用
- [ ] 改 `cli/src/index.ts` / `cli/src/i18n.ts`：cmd 相关文案（pending / 执行 / 超时 / 重试）
- [ ] 编写 `cli/test/s26-cmd-predicate.test.ts`（含 OpenLogos reporter，复用 S22 临时 overlay 模式，不污染 golden）；golden-baseline 全绿
```
