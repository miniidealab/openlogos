# 变更提案：verify-git-local-only

> module: core | created: 2026-11-28

## 变更原因
来源：Team 需求池 openlogos #8（Bug，2026-11-28 在处置提案 fix-delta-touched-by-case-change 的代码评审时发现）。

`openlogos verify` 计算验收范围时会执行若干只读的 git 命令。项目是部分克隆（本地缺少一部分对象，由远端按需提供）时，其中读取文件内容的命令会让 git 访问远端并把取回的对象写进本地对象库：

- 计算改动文件：`git diff --name-status -z -M --relative <baseRef>`（`cli/src/lib/verify-scope.ts` 的 `collectChangedFiles`）。
- 读取提案起点中的配置文件：`git show <baseRef>:./<文件>`（同文件，共享验收配置按字段判断）。

这两类调用没有超时，远端无响应时验收会一直挂住。验收是只读操作，不应该联网，也不应该改动对象库。

2026-11-28 在本机（Git 2.48.1）用一次性仓库实测：
- 只有一个已跟踪文件在工作区被修改、其提案起点中的内容本地缺失时，`git diff --name-status` 就会发起一次 `git fetch`。去掉重命名检测（`--no-renames`）结果相同，所以这不是 `-M` 单独造成的。
- 设置 `GIT_NO_LAZY_FETCH=1` 后不再发起 fetch，同一条 diff 以「无法读取对象」失败退出。
- `git ls-files --others` 不读取对象，不会触发取回。
- 判断某个提交是否存在的调用（`git cat-file -e <提交>^{commit}`、`git rev-parse --verify <提交>^{commit}`）在该提交对象本地不存在时**同样会发起取回**：实测对一个本地没有的提交号执行 `cat-file -e`，git 启动了 `git fetch` 并连接了远端。所以缺的是提交对象还是文件内容，都要管住（proposal r1 F2）。
- 把传输协议白名单置空（`GIT_ALLOW_PROTOCOL=`，不设 `GIT_NO_LAZY_FETCH`）后，git 仍会启动 `git fetch` 子进程，但在建立传输之前就以「transport 'file' not allowed」被拒绝：没有连接远端，对象库没有新增任何对象，原命令以读不到对象失败退出。即使仓库显式配置了 `protocol.file.allow=always` 也一样。这个白名单自 Git 2.39 之前就有，不依赖 2.45 才有的开关（proposal r1 F1）。
- 两个环境变量同时设置、对象齐全时，diff 输出与不设置时相同，没有发起 fetch。

上一个提案只修了「delta 触及判断」自己的那一次基线读取，其余调用维持原样。

## 最小实现论证

> S35/S09：本段**不进 canonical 必填章节**——缺段、未填、占位残留三者均不触发任何检查。
> 它是自律提示，作用在设计发生**之前**；事后的规模信号由 change-lint 的观测 warning 承担。

- 先检索既有机制：
  - 「取不到改动文件集合时怎么办」已有规则：按模块限定范围回落全量（`diff_failed`，功能规格 §2.96.3、场景 EX-10.5），分层验收扩大到全量（`base_ref_unavailable`，§2.109.7、EX-13.33）。禁用取回后 diff 因缺对象失败，直接落进这条既有路径，不需要新的原因代码。
  - 「提案起点中的配置内容读不出」已有规则：按整文件变化处理、回落或扩大到全量（§2.96.3.1、EX-13.60）。
  - 禁用取回的做法已有先例：`cli/src/lib/affected-scenarios.ts` 读取合并前内容时设置 `GIT_NO_LAZY_FETCH=1`（上一提案）。本次把它提成 verify 各处共用的一个执行入口。
  - `cli/src/commands/verify-release.ts` 与 `cli/src/lib/verification-history.ts` 的 git 调用已经带超时，只是没有禁用取回。
- 为什么不能更小：
  - 只给那一条 diff 加开关：`git show` 读取起点配置同样会取回，且今后新增的读取还会重犯。走同一个入口才能堵住。
  - 只去掉 `-M`：实测没有用，去掉后仍然取回。
- 本提案主动砍掉的：
  - **换一种不读文件内容的方式算改动文件**（例如比较树对象与工作区哈希）：能让部分克隆下也不回落，但要重写改动文件的计算并证明与现有结果逐项一致，风险与工作量都大；部分克隆缺对象时多跑一次全量可以接受。
  - **旧版 Git 上只做限时、不拦截传输**：初稿的做法。远端只要在时限内响应，对象照样被取回，问题原样保留（proposal r1 F1）。改为同时把传输协议白名单置空，旧版本上同样不连接远端、不写对象库。
  - **缺对象时一律回落全量**：初稿的说法不准确。缺的东西不同、调用方不同，既有的结果也不同（见「决策澄清」defaults 中的对照），本提案逐一保留，不新增统一的回落（proposal r1 F2）。
  - **把验收历史读取提交号的共用函数整体换成新的执行入口**：这个函数也被 smoke 的历史记录使用，整体替换会改变 smoke 的等待上限与结果（proposal r1 F5）。改为由 verify 把自己读到的提交快照传给历史记录，smoke 的调用不动。
  - **验收前自动把缺失对象取回来**：验收不联网是本次要守住的约束。
  - **改 merge、deploy、smoke、branch sync 等其他命令的 git 调用**：它们有的本来就要写对象库或联网，不在「验收只读」的范围内。
  - **新增原因代码或 JSON 字段**：沿用 `diff_failed` 与 `base_ref_unavailable`，只在说明文字里写明是本地缺少对象。

## 变更类型
需求级（新增一组验收条件：验收期间的 git 调用不访问远端、不写对象库、有时限；并贯穿功能规格、场景、测试用例、部署方案与 smoke。不涉及 API / DB，不改 JSON 结构）

## 变更范围
> 与 `tasks.md` 的 `[delta]` 目标一一对应。

- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md`
  - 新增「S13 验收期间的 git 调用只读本地验收补充（verify-git-local-only）」，AC-VERIFY-LOCAL-01 起。
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`
  - 新增 §2.111「验收期间的 git 调用只读本地」：适用的调用与调用方边界、拦截传输与禁用取回、时限、按缺失对象的位置落入的既有结果、可观测结果的口径（可能出现被拦截的 fetch 子进程，但没有远端连接与新增对象）；
  - §2.96.6「提案起点 `baseRef`」补一句：取不到差异时的原因说明包含本地缺少对象的情形。
- 影响的技术架构：无（不新增组件；只是把分散的 git 调用收拢到一个执行入口）。
- 影响的业务场景：`logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S13-verify-results.md`
  - 新增「S13 验收期间的 git 调用只读本地（verify-git-local-only）」，EX-13.70 起；
  - 修改 EX-10.5（提案起点不可用）与 EX-13.33（提案起点不可用）：起点提交对象本地缺失时判为不可达，文件内容本地缺失时判为差异计算失败，都不取回；超过时限按失败的那一次调用归类——检查起点提交时超时判为不可达，收集改动文件时超时判为差异计算失败。
- 影响的根规范：
  - `spec/test-results.md`「三层集合与扩大」补一条说明：验收不访问远端，部分克隆缺对象时按起点不可用处理；
  - `spec/cli-json-output.md`「verify `scope` 按模块限定范围字段 > 字段」：`base_ref_unreachable` 与 `diff_failed` 两个原因的含义补充本地缺少对象且不取回、调用超过时限（delta 阶段补入：原文把前者写成「提交不存在」，与本提案的行为不再相符；原因代码不变）。
- 影响的 Skill：无。
- 影响的测试用例：`logos/resources/test/core-S13-test-cases.md` 新增一节（UT-S13-309 起、ST-S13-57 起）。
- 影响的部署方案：`logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` 新增「OpenLogos 0.16.30 本机测试环境发布」。
- 影响的 smoke 用例：`logos/resources/test/smoke/core-smoke-test-cases.md` 新增 0.16.30 安装态 smoke（SMOKE-core-375 起）。
- 影响的 API：无
- 影响的 DB 表：无
- 影响的编排测试：无（CLI 项目，`skip_phases` 含 api / scenario）
- 影响的代码（merge 后由 slice-planner 划分，这里只列范围）：
  - 新增一个只读 git 执行入口（禁用取回、不弹凭据提示、带时限），供验收路径共用；
  - `cli/src/lib/verify-scope.ts`（缺省执行器与失败说明）、`cli/src/lib/affected-scenarios.ts`（改用共用入口）、`cli/src/commands/verify-release.ts`（保留既有 60 秒时限，加上拦截传输）；
  - `cli/src/commands/verify.ts` 等 verify 的历史写入调用处：把经共用入口读到的提交快照传给历史记录。`cli/src/lib/verification-history.ts` 的 `readCommit` 及其 10 秒、30 秒时限不改，smoke 的历史调用继续走它；
  - `cli/test/` 下对应测试；`scripts/` 下 0.16.30 的 smoke runner；升版 0.16.30 与 `CHANGELOG.md`。

## 部署影响
- 是否需要部署：是
- 部署原因：verify 是 CLI 产品代码，装进本机全局 CLI 后，用全局 CLI 推进的项目才能用上；登记表配置了 `proposal_default_env: test`。升版到 0.16.30 以区分新旧安装态
- 影响环境：`test`（登记表 `proposal_default_env`，本机 npm 全局安装态）；不 npm publish、不打 tag、不 push
- 是否涉及数据迁移：否
- 是否需要回滚预案：是（按已合并部署方案「本机测试环境脚本部署（scripts/deploy-local.mjs）」：脚本失败时自动回装回滚制品；成功落账后需要回滚时执行 `openlogos deploy --env test --rollback`，回滚目标以执行时 `openlogos env show test` 返回的 `previous_ref` 为准。写提案时观测到 test 的 `current_ref` 为 `a73e410`（0.16.29），仅为规划时的观测值）
- 是否需要 smoke：是（安装态 smoke 在一次性项目中证明：
  - 安装态版本、部署回执、源码候选版本一致，且等于 0.16.30；
  - 本地缺少提案起点中的文件内容时：验收没有连接远端、对象库没有新增对象，范围回落全量并写明原因；全量都通过时门禁 PASS，全量中有用例失败时门禁按实际结果 FAIL；
  - 本地缺少提案起点的提交对象时：同样没有连接远端、对象库不变，原因是起点不可达；
  - 发布查询指定了本地不存在的提交时：没有连接远端，仍以无法解析提交拒绝，不执行任何用例；
  - 对象齐全的普通仓库：验收范围与结果不变。）

## UI/UX 变更声明

```yaml
ui_impact: false            # 本次是否触及界面（GUI 项目才有意义）
design_system_mode: generated   # generated | fallback（fallback 时须填 design_system_fallback_reason）
design_system_fallback_reason: ""
pages: []                   # 每项 {id, prototype: core-NN-<slug>.html, description}
```

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: adaptive
status: complete
impacts:
  data:
    status: none
    reason: 不改任何文件格式；验收历史、报告与标记的结构不变
  compatibility:
    status: none
    reason: 对象齐全的仓库行为不变。部分克隆且本地缺对象的仓库，验收范围计算由「联网取回后按范围验收」变为「不联网、按既有规则回落全量」，只会多跑不会少跑——多跑出来的用例如果失败，门禁会如实判 FAIL；发布查询不在此列，提交解析不出时照旧拒绝、不执行用例；JSON 字段与原因代码不变，说明文字有补充
  security_privacy:
    status: none
    reason: 改动方向是减少验收期间的网络访问与凭据提示；不读取、不外传任何新数据
  public_release:
    status: none
    reason: 只部署到本机 test 环境，不 npm publish、不打 tag、不 push
  external_commitment:
    status: none
    reason: 不新增、不删除、不改名任何命令、参数、JSON 字段或原因代码
decisions:
  - id: C01
    category: product
    source: policy
    question: 部分克隆中本地缺少验收要读的对象时，验收怎么办
    choice: 不取回；缺的对象不同、调用方不同时，各自落入既有的结果（起点提交缺失判不可达、文件内容缺失判差异计算失败，二者都回落或扩大到全量；发布查询无法解析提交时照旧拒绝），并在说明里写明是本地缺少对象
    reason: 验收是只读操作，联网和写对象库都不该发生；这些都是既有的处理路径，不新增统一的回落。本条是起草时按「只读」原则给出的结论，需用户在批准方案时确认
    scope: verify 自己启动的全部只读 git 调用
    rejected: 换一种不读文件内容的方式算改动文件——能避免回落，但要重写计算并证明与现有结果一致，风险大；验收前自动取回缺失对象——违背不联网的约束
  - id: C02
    category: compatibility
    source: policy
    question: 不支持禁用取回开关的旧版 Git（早于 2.45）怎么处理
    choice: 同样不连接远端、不写对象库：verify 启动的 git 子进程一律把传输协议白名单置空（GIT_ALLOW_PROTOCOL 为空串），并同时设置禁用取回的开关；旧版本忽略后者，靠前者拦截
    reason: 协议白名单是更早就有的机制（评审引用 Git 2.39 文档）。本机 Git 2.48.1 上只设白名单的实测结果是 fetch 子进程启动后在建立传输前被拒绝、对象库无新增。没有在真实的旧版 Git 上执行过，这一点如实写入规格
    scope: 共用执行入口、功能规格 §2.111 与测试
    rejected: 只做限时——远端在时限内响应时对象照样被取回（proposal r1 F1）；旧版 Git 上直接拒绝验收——让没有缺对象问题的普通仓库不可用
  - id: C03
    category: deployment
    source: policy
    question: 本提案是否部署、部署到哪个环境、怎么部署、怎么回滚、以什么为 smoke 证据
    choice: 部署到 test（登记表 proposal_default_env）；部署方式为登记表 test.deploy（mode script，scripts/deploy-local.mjs），提案通道执行 openlogos deploy --env test；回滚按已合并部署方案「本机测试环境脚本部署（scripts/deploy-local.mjs）」——脚本失败时以本次回执记录的部署前安装态为准，成功落账后显式回滚以执行时 env show test 的 previous_ref 为准（规划时观测到 test 的 current_ref 为 a73e410，即 0.16.29，仅为观测值）；smoke 证据为 logos.config.json 的 smoke.command（node scripts/run-smoke.js）经 openlogos smoke --env test 的实际运行结果
    reason: env show test 的 current_ref 为 a73e410865f0，test 的 deploy_mode 为 script；已合并部署方案有通用章节；CLI 产品代码有改动，需要装进全局才能被下游使用
    scope: "[deploy] 段、部署方案与 smoke 用例 delta、升版 0.16.30；不含 npm publish / tag / push"
    rejected: 不部署——用全局 CLI 推进的项目用不上
unresolved: []
defaults:
  - "适用范围：openlogos verify（提案级与发布级，含 --release --check）在计算验收范围、读取提案起点内容、读取合并前内容、记录提交号与工作区状态时执行的 git 调用。测试命令自己执行的 git 不在范围内。"
  - "三项约束：不连接远端、不取回对象（为 git 子进程把 GIT_ALLOW_PROTOCOL 设为空串，并设置 GIT_NO_LAZY_FETCH=1）；不弹出凭据或终端提示（GIT_TERMINAL_PROMPT=0）；有时限，超过即终止并按失败处理。"
  - "可观测结果的口径：在不支持 GIT_NO_LAZY_FETCH 的 Git 上，缺对象时可能看到一个被启动又被拒绝的 fetch 子进程。验收标准是「没有与远端建立传输、对象库没有新增对象、原命令失败」，不是「没有出现 fetch 子进程」；两者分开断言。"
  - "时限：60 秒是没有既有时限的调用的缺省值，每次调用单独计时，本提案不提供配置项。已有时限的调用保留原值（发布级验收的 git 调用 60 秒；验收历史读取提交号 10 秒、读取工作区状态 30 秒）。"
  - "缺失对象的位置与调用方决定结果，全部沿用既有的原因与退出方式：① 提案起点的提交对象本地缺失——按模块限定范围回落全量（base_ref_unreachable），分层验收扩大到全量（base_ref_unavailable）；② 起点提交在、但差异计算要读的文件内容缺失——按模块限定范围回落全量（diff_failed），分层验收扩大到全量（base_ref_unavailable）；③ 提案起点中的配置文件内容读不出——按整文件变化处理；④ 发布查询（verify --release --check --commit）指定的提交本地不存在——照旧以 RELEASE_CHECK_COMMIT_INVALID 拒绝，这个入口只查询结果，不回落、不执行用例。"
  - "超过时限按失败的那一次调用归类，原因代码与该调用其他失败方式相同，detail 写明超时：检查起点提交是否存在的调用超时——base_ref_unreachable（此时不再执行差异计算）；收集改动文件的调用（差异计算或列出未跟踪文件）超时——diff_failed；分层验收中二者都对应 base_ref_unavailable。即使起点提交实际存在，只要检查它的调用先超时，原因就是 base_ref_unreachable，不是 diff_failed。"
  - "回落或扩大本身不判 FAIL，也不保证 PASS：扩大后的集合照常执行并判定门禁。全量都通过则 PASS；多跑出来的用例失败则按 failed_cases 判 FAIL。"
  - "调用方边界：只约束 verify 自己启动的 git 子进程。验收历史读取提交号的函数由 verify 与 smoke 共用——verify 把经共用入口读到的提交快照传给历史记录；smoke 的历史记录继续用原函数、原时限，行为不变。"
  - "说明文字补充：因本地缺少对象而失败时，detail 写明「本地缺少对象，验收不从远端取回」；超过时限时写明超时。原因代码不变。"
  - "对象齐全的仓库：范围、原因、结果与 0.16.29 逐项相同。"
  - "旧版 Git（早于 2.45）忽略 GIT_NO_LAZY_FETCH，由传输协议白名单拦截；这条路径只在本机 Git 2.48.1 上以「只设白名单」的方式实测过，没有在真实旧版本上执行，规格与部署记录如实写明。"
  - "上一提案在 affected-scenarios.ts 里为单次读取设置开关的写法改为调用共用入口，行为不变（含旧版 Git 上按本地对象清单判断）。"
  - "新增编号：AC-VERIFY-LOCAL-01、功能规格 §2.111、EX-13.70、UT-S13-309、ST-S13-57、SMOKE-core-375 起；具体条数在 delta 中定稿。"
  - "目标版本固定为 0.16.30，分两个时点检查：① 升版之前——cli/package.json 应为 0.16.29 且 registry 中不存在 0.16.30，任一不符即停下，不升版、不自行改取其他版本，交回用户决定；② 部署时——源码版本、候选包、部署回执与全局安装态都应为 0.16.30，任一不符即视为部署不符合方案。"
```

## 验收标准
- 自动验收环境要求：无（用例需要 git，夹具自建一次性仓库与本地文件远端；本仓 verify 已依赖 git，不新增声明）
- 平台限定用例：无
- 需要人参与的验收：无

## 受影响场景

```yaml
schema: openlogos/affected-scenarios@1
assessment: assessed         # pending（未评估）| assessed（已逐个评估）| unknown（无法评估）
shared_change: false         # 本次是否涉及共享代码、配置或依赖
scenarios:                   # 每项 { id: "S13", reason: "<为什么受波及>" }
  - id: S13
    reason: 修改 verify-scope.ts 的缺省 git 执行器，按模块限定范围、分层验收、共享验收配置按字段判断、发布级验收与验收历史都经过它或同类调用
```

## 变更概述
`openlogos verify` 自己启动的只读 git 调用统一走一个执行入口：不连接远端、不取回对象、不弹凭据提示、有时限（没有既有时限的调用缺省 60 秒）。项目是部分克隆且本地缺少验收要读的对象时，验收不再联网，也不再改动本地对象库，而是落入各自既有的结果：缺起点提交判不可达、缺文件内容判差异计算失败，二者都回落或扩大到全量并写明是本地缺少对象；发布查询指定的提交不存在时照旧拒绝。扩大后的集合照常判定门禁。对象齐全的仓库行为不变。

不新增原因代码与 JSON 字段。新旧版本的 Git 都靠传输协议白名单拦截远端访问，支持的版本另加禁用取回的开关。smoke 等其他命令的 git 调用不在范围内，验收历史与 smoke 共用的读取函数不改。

随本提案升版 0.16.30 并部署到本机 test 环境，安装态 smoke 证明：缺文件内容、缺起点提交、发布查询提交不存在三种情形下都没有连接远端且对象库不变，并各自落入既有结果；普通仓库的范围与结果不变。
