# core: 部署后冒烟测试用例


## 一、冒烟测试范围
| 环境 | 覆盖范围 | 说明 |
|------|----------|------|
| staging | CLI、插件模板、官网构建、官网发布动态、官网 release note 双语摘要、官网中文国际化、官网中文字体、Mermaid Skill 语法安全文档、提案级部署门禁、部署进度摘要面板、no-delta spec-complete、测试 ID 门禁、adopt 命令、根指令文件 managed block 合并、verify 预执行模型、verify / smoke 沙箱标准化 | 发布前最小检查；仅在提案级声明需要部署 / smoke 时执行 |


## 二、冒烟测试用例

| ID | 描述 | 来源 | 目标环境 | 前置条件 | 操作 | 预期结果 |
|----|------|------|----------|----------|------|----------|
| SMOKE-core-01 | CLI 包可安装并输出版本 | 部署方案 | staging | 包已发布或本地 pack 完成 | `openlogos --version` | 返回版本号 |
| SMOKE-core-02 | 初始化命令可生成 all 工具资产和 Reference 子目录 | 部署方案 | staging | CLI 可执行 | `openlogos init smoke --locale zh --ai-tool all` | 生成 `logos/` 与各工具资产；`logos/resources/reference/` 下存在 `requirement/`、`todolist/`、`code/`、`image/`、`temp/`、`note/` 子目录 |
| SMOKE-core-03 | 官网构建产物可生成 | 部署方案 | staging | website 依赖已安装 | `npm run build` | 构建成功 |
| SMOKE-core-04 | 插件模板随包存在 | 部署方案 | staging | npm pack 完成 | 检查 tarball | 包含插件模板 |
| SMOKE-core-05 | 提案级无需部署时面板不展示部署入口 | 提案级部署门禁 | staging | 安装含本变更的 CLI | 构造无需部署且 VERIFY_PASS 的提案后运行 `openlogos status --format json` | `active_change.deployment_required=false`，下一步允许 archive |
| SMOKE-core-06 | 部署进度摘要仅统计 `[deploy]` | 提案级部署门禁 | staging | 安装含本变更的 CLI | 构造活跃提案且 `[code]` / `[deploy]` 同时存在后运行 `openlogos status --format json` | `deployment_progress` 只反映 `[deploy]` section，`deployment_document.name=tasks.md` |
| SMOKE-core-07 | 官网发布动态页面展示双语版本摘要 | 官网发布动态 | staging | 官网已部署或本地预览已启动 | 访问 `/releases` | 页面展示至少一个版本的英文价值摘要 / 英文修复摘要，并保留中文原文次级内容；英文摘要缺失时显示固定回退提示 |
| SMOKE-core-08 | 首页可进入发布动态 | 官网发布动态 | staging | 官网已部署或本地预览已启动 | 访问首页并点击最近发布入口 | 可跳转 `/releases`，且页面非 404 |
| SMOKE-core-09 | 纯代码提案 no-delta spec-complete 冒烟 | no-delta merge / `SPEC_MERGED` | staging | 安装含本变更的 CLI；构造无 `[delta]`、含空 `[code]` 且含真实 UT/ST ID 的活跃提案 | 执行 `openlogos merge <slug>`，再执行 `openlogos next --format json` | `SPEC_MERGED` 存在且内容标记 `no_delta_spec_complete`；`proposal_step=="ready-to-implement"`；`next_node.id=="plan-slices"` |
| SMOKE-core-10 | 缺测试 ID 不派 slice-planner 冒烟 | `test-id-required` | staging | 安装含本变更的 CLI；构造代码提案，已有 `SPEC_MERGED`，但无真实 UT/ST/SMOKE ID | 执行 `openlogos next --format json` | 返回 `proposal_step=="test-id-required"` 与 `reason=="code_change_requires_real_test_ids"`；不返回 `next_node.id=="plan-slices"`；不写 `SLICES_APPROVED` |
| SMOKE-core-11 | adopt 后 required 状态仍直接引导 change | adopt 命令 / brownfield-adopter | staging | SMOKE-core-10 完成，无活跃提案，模块 `baseline_seed_state:required`，无未终结 journal | 执行 `openlogos next` | 主动作指向 `openlogos change <slug>`；required 仅表示可选全库 seed 未完成，可附显式 baseline-seed 说明，但不要求先 seed、不再建议 `add-baseline-docs` |
| SMOKE-core-12 | verify 在无预跑配置且覆盖不足时输出诊断 | verify 预执行模型 | staging | 安装含本变更的 CLI，构造仅局部测试结果且缺少 verify 预跑配置的项目 | 执行 `openlogos verify --format json` | `pre_run.mode=none`，输出覆盖不足诊断与配置建议 |
| SMOKE-core-13 | verify 两阶段预跑与合并结果可用 | verify 预执行模型 | staging | 安装含本变更的 CLI，构造包含 regression / incremental 配置的项目 | 执行 `openlogos verify --format json` | 返回 `pre_run.mode=two_phase`，阶段命令状态和最终合并结果可供客户端展示 |
| SMOKE-core-14 | 历史 skipped 项目在 next/status 中保持接入模式 | adopt 兼容性 | staging | 安装含本变更的 CLI，准备 bootstrap=skipped 的历史项目 | 执行 `openlogos status` 与 `openlogos next` | 输出与 bootstrap=adopted 一致的接入模式引导与阶段显示 |
| SMOKE-core-15 | tag 发版后官网 release 与 tag 版本一致 | 官网发布动态同步门禁 | staging | 已完成一次 `vX.Y.Z` tag 发版并触发发布工作流 | 发布完成后访问 `/releases` 并检查 latest 版本 | 页面 latest 版本等于本次 tag 去前缀后的版本号；若不一致则判定发布失败 |
| SMOKE-core-16 | verify 在 auto 沙箱模式下执行且不写入工作区 | verify / smoke 沙箱标准化 | staging | 安装含本变更的 CLI，构造 `verify.sandbox_mode=auto` 的项目 | 执行 `openlogos verify --format json` | `pre_run` 与 `sandbox` 字段同时存在，`sandbox.status` 为 `pass` 或 `warn`，并且仓库工作区未出现非白名单写入 |
| SMOKE-core-17 | verify 在 always 沙箱模式下禁止写入工作区 | verify / smoke 沙箱标准化 | staging | 安装含本变更的 CLI，构造 `verify.sandbox_mode=always` 且预跑脚本尝试写入仓库根目录的项目 | 执行 `openlogos verify --format json` | 命令失败，`sandbox.status=fail`，输出沙箱路径、失败原因和修复建议 |
| SMOKE-core-18 | smoke 在 auto 沙箱模式下执行且不写入工作区 | verify / smoke 沙箱标准化 | staging | 安装含本变更的 CLI，构造 `smoke.sandbox_mode=auto` 的已部署提案 | 执行 `openlogos smoke --env staging` | `sandbox` 字段存在，`sandbox.status` 为 `pass` 或 `warn`，并且仓库工作区未出现非白名单写入 |
| SMOKE-core-19 | smoke 在 always 沙箱模式下禁止写入工作区 | verify / smoke 沙箱标准化 | staging | 安装含本变更的 CLI，构造 `smoke.sandbox_mode=always` 且 smoke 命令尝试写入仓库根目录的已部署提案 | 执行 `openlogos smoke --env staging` | 命令失败，`sandbox.status=fail`，输出沙箱路径、失败原因和修复建议 |
| SMOKE-core-20 | 发布包支持 `openlogos deploy-done` 受控落标 | S21 部署完成标记 | staging | 安装含本变更的 CLI，构造已 `VERIFY_PASS`、需要部署且有 `[deploy]` section 的活跃提案，并写入 `deployment-report.md` | 执行 `openlogos deploy-done --env staging` 后运行 `openlogos status --format json` | `[deploy]` 任务全勾，`DEPLOY_DONE` 存在，旧 `SMOKE_PASS` / `SMOKE_FAIL` 被清理，状态进入 `ready-to-smoke` 或 `deploy-done` |
| SMOKE-core-21 | 官网中文站点路由与语言切换可用 | 官网中文国际化 | staging | 官网已构建或本地预览已启动 | 访问 `/zh`、`/zh/getting-started`、`/zh/cli` 等中文路由，并检查页面语言切换器 | 中文首页与中文文档页均可访问（非 404）；中文文档页 `<html lang="zh-CN">`；英文页与中文页页脚均渲染语言切换器（含「简体中文」入口）；中文营销页内部链接指向 `/zh/...` 对应路径 |
| SMOKE-core-22 | 国内 IP / 中文浏览器首访自动切中文且尊重手动选择 | 官网中文国际化 | staging | 官网已部署到 Cloudflare Pages（边缘中间件 `functions/_middleware.js` 已上传） | 用中国大陆出口 IP 无 `locale_pref` cookie 访问 `/`；用海外 IP + 中文浏览器（`Accept-Language: zh`）访问 `/`；再手动切换语言后重复访问 `/` | 无 cookie 时：中国大陆 IP **或** `Accept-Language` 以 `zh` 开头的请求访问 `/` 均 302 跳 `/zh`；非中国 IP 且非中文浏览器、或爬虫 UA 不跳转；带 `locale_pref` cookie 时一律放行不再自动跳；切换器点击后写入 `locale_pref` cookie（max-age≈1 年） |
| SMOKE-core-23 | 中文 web 字体子集产出且 @font-face 已注入 | 官网中文字体 | staging | 官网已构建（含字体子集化）或已部署 | 检查 `dist/fonts/` 子集字体与中文页 `@font-face` 引用 | 5 个字重（400/500/600/700/900）子集 woff2 均存在且体积在合理区间（远小于原始 ~10MB、非空）；中文营销页与中文文档页打包后的 CSS 均含 `Noto Sans SC` 与 `NotoSansSC-*.subset.woff2` 引用，且含 `unicode-range` 限定 |
| SMOKE-core-24 | 官网 Skill 页面展示 Mermaid 语法安全规则 | Mermaid Skill 语法安全 | staging | 官网已构建或已部署 | 访问 `/skills/architecture-designer`、`/skills/scenario-architect`、`/skills/deployment-designer`、`/zh/skills/architecture-designer`、`/zh/skills/scenario-architect`、`/zh/skills/deployment-designer` | 6 个页面均非 404；architecture / deployment 页面展示 `ID["label"]` 或 `ID["标签文本"]`、`subgraph "Name"` 或 `subgraph "名称"`、避免 `PROXY[/voice/api 代理]` 的说明；scenario 页面展示箭头消息单行约束和复杂内容下沉到步骤说明的规则 |
| SMOKE-core-25 | init 保留用户根指令文件 | 根指令文件合并 | staging | 安装含本变更的 CLI；临时目录预置含用户内容的 `AGENTS.md` / `CLAUDE.md` | 执行 `openlogos init smoke --locale zh --ai-tool all` | 用户内容仍存在；文件包含且仅包含一个 OpenLogos managed block；OpenLogos 指令内容已写入 |
| SMOKE-core-26 | sync 幂等刷新根指令托管片段 | 根指令文件合并 | staging | SMOKE-core-25 完成 | 执行 `openlogos sync` 两次 | 用户内容仍存在；OpenLogos managed block 被刷新且未重复追加 |
| SMOKE-core-27 | adopt 保护大小写变体指令文件 | 根指令文件合并 | staging | 安装含本变更的 CLI；存量项目 fixture 预置 `agents.md` / `claude.md` 小写文件 | 执行 `openlogos adopt --locale zh --ai-tool cursor` | CLI 复用既有真实路径合并内容；用户内容仍存在；不生成重复大小写入口 |

## 三、覆盖度校验
- [x] CLI 健康检查：已覆盖
- [x] 插件模板：已覆盖
- [x] 官网构建：已覆盖
- [x] 官网发布动态：已覆盖
- [x] 官网 release note 双语摘要：已覆盖
- [x] 官网中文国际化：已覆盖
- [x] 官网中文字体：已覆盖
- [x] Mermaid Skill 语法安全文档：已覆盖
- [x] 提案级部署门禁：已覆盖
- [x] 部署进度摘要：已覆盖
- [x] DEPLOY_DONE 受控落标：已覆盖
- [x] no-delta spec-complete 与测试 ID 门禁：已覆盖（SMOKE-core-09 / SMOKE-core-10）
- [x] 发布前最小链路：已覆盖
- [x] adopt 命令：已覆盖
- [x] 根指令文件 managed block 合并：已覆盖（SMOKE-core-25 / SMOKE-core-26 / SMOKE-core-27）
- [x] verify 预执行模型：已覆盖
- [x] verify / smoke 沙箱标准化：已覆盖

## 四、smoke runner 覆盖强制规则发布后冒烟用例

### 一、冒烟测试范围补充
| 环境 | 覆盖范围 | 说明 |
|------|----------|------|
| staging | smoke runner 覆盖预检、统一 smoke dispatcher、runner/reporter 缺失诊断、禁止新增 smoke case uncovered | 发布后验证新增 smoke 用例不会停留在规格层 |

### 二、冒烟测试用例补充
| ID | 描述 | 来源 | 目标环境 | 前置条件 | 操作 | 预期结果 |
|----|------|------|----------|----------|------|----------|
| SMOKE-core-28 | 新增 smoke case 缺少 runner 时给出明确诊断 | smoke runner 覆盖强制规则 | staging | 安装含本变更的 CLI；构造活跃提案，在 `deltas/test/smoke/` 中新增 `SMOKE-TEMP-01`，但不提供 `scripts/smoke-*` runner | 执行 smoke 覆盖预检或 `openlogos smoke --format json` | 输出 `smoke_runner_missing` 或 `smoke_cases_uncovered`，缺失列表包含 `SMOKE-TEMP-01`，不写入 `SMOKE_PASS` |
| SMOKE-core-29 | runner 存在但未写结果时给出 reporter 诊断 | smoke reporter 覆盖强制规则 | staging | 安装含本变更的 CLI；构造新增 `SMOKE-TEMP-02` 与可发现 runner，但 runner 不写 `smoke.result_path` | 执行 smoke 覆盖预检或 `openlogos smoke --format json` | 输出 `smoke_reporter_missing`，并提示写入 `logos/resources/verify/smoke-results.jsonl` 或配置声明的 `smoke.result_path` |
| SMOKE-core-30 | 统一 dispatcher 执行新增 smoke runner 后覆盖通过 | smoke dispatcher | staging | 安装含本变更的 CLI；`logos.config.json.smoke.command` 指向统一 dispatcher；新增 `SMOKE-TEMP-03` 且 runner 写入 pass 结果 | 执行 `openlogos smoke --format json` | `SMOKE-TEMP-03` 不在 `uncovered_cases`，无 runner/reporter 缺失诊断；若其它 smoke 用例均通过则 Gate PASS |

### 三、覆盖度校验补充
- [ ] smoke runner 缺失诊断：已覆盖（SMOKE-core-28）
- [ ] smoke reporter 缺失诊断：已覆盖（SMOKE-core-29）
- [ ] 统一 dispatcher 覆盖新增 smoke case：已覆盖（SMOKE-core-30）

## 五、verify 结果账本一致性发布后冒烟用例

### 一、冒烟测试范围补充

| 环境 | 覆盖范围 | 说明 |
|------|----------|------|
| staging | verify 结果账本一致性、非法 status 诊断、未定义结果 ID 诊断、last-write-wins 兼容性 | 发布后验证不自洽 verify 账本不会被误判 PASS |

### 二、冒烟测试用例补充

| ID | 描述 | 来源 | 目标环境 | 前置条件 | 操作 | 预期结果 |
|----|------|------|----------|----------|------|----------|
| SMOKE-core-31 | verify 拒绝非法 status 结果账本 | verify 结果账本一致性 | staging | 安装含本变更的 CLI；临时项目定义 `UT-S13-SMOKE-31`；JSONL 同时写入该用例 pass 和一个 `status:"unknown"` 结果 | 执行 `openlogos verify --format json` | 命令失败；`gate.result="FAIL"`；诊断包含非法 status；不写入 `VERIFY_PASS` |
| SMOKE-core-32 | verify 拒绝未定义结果 ID | verify 结果账本一致性 | staging | 安装含本变更的 CLI；临时项目定义用例全部 pass；JSONL 另写入 `UT-S13-GHOST` pass | 执行 `openlogos verify --format json` | 命令失败；诊断包含 `UT-S13-GHOST`；不允许 Gate PASS |
| SMOKE-core-33 | verify 保持合法 last-write-wins 行为 | verify 结果账本一致性 | staging | 安装含本变更的 CLI；同一已定义用例先写 fail 后写 pass，且无额外非法结果 | 执行 `openlogos verify --format json` | 最后一次结果生效；若全部定义用例最终 pass，则 Gate PASS |

### 三、覆盖度校验补充

- [ ] 非法 status 发布后冒烟：SMOKE-core-31
- [ ] 未定义结果 ID 发布后冒烟：SMOKE-core-32
- [ ] last-write-wins 兼容性发布后冒烟：SMOKE-core-33

## 六、Codex / Claude Skill 命名空间发布后冒烟用例

### 一、冒烟测试范围补充

| 环境 | 覆盖范围 | 说明 |
|------|----------|------|
| staging | Codex repo marketplace、OpenLogos 插件命名空间、历史 Codex 资产兼容、Claude Code 项目 skill 保留、官网命名空间文档 | 发布后验证 OpenLogos 方法论技能与项目专属技能不会混入同一命名空间 |

### 二、冒烟测试用例补充

| ID | 描述 | 来源 | 目标环境 | 前置条件 | 操作 | 预期结果 |
|----|------|------|----------|----------|------|----------|
| SMOKE-core-34 | Codex init 生成 OpenLogos repo marketplace 命名空间 | Codex Skill 命名空间 | staging | 安装含本变更的 CLI，准备空目录 | 执行 `openlogos init smoke --locale zh --ai-tool codex` | `.agents/plugins/marketplace.json` 存在 `openlogos` 条目；OpenLogos 官方 skill 位于 `openlogos` 插件；`AGENTS.md` 说明 `openlogos:<skill>` 为方法论技能 |
| SMOKE-core-35 | Codex sync 不吸收项目专属 skill | Codex 项目 skill 边界 | staging | 安装含本变更的 CLI，准备已初始化项目并预置 `.agents/skills/release-guard/SKILL.md` 或 `.agents/plugins/adcn/skills/release-guard/SKILL.md` | 执行 `openlogos sync` | 项目 skill 原样保留；`openlogos` 插件不包含 `release-guard`；生成文档中不存在 `openlogos:release-guard` |
| SMOKE-core-36 | Claude Code init/sync 保留 `.claude/skills` 项目技能 | Claude Code 项目 skill 边界 | staging | 安装含本变更的 CLI，准备项目并预置 `.claude/skills/release-guard/SKILL.md` | 执行 `openlogos init smoke --locale zh --ai-tool claude-code` 或在已初始化项目中执行 `openlogos sync` | `.claude/skills/release-guard/SKILL.md` 内容不变；OpenLogos 官方插件不包含该 skill；`CLAUDE.md` 单独说明项目专属技能 |
| SMOKE-core-37 | 官网展示 Codex / Claude Skill 命名空间边界说明 | 官网文档 | staging | 官网已构建或部署 | 访问 Codex 插件规范、AGENTS.md 生成规范及对应中文页 | 页面说明 OpenLogos 方法论技能与项目专属技能的目录和命名空间边界 |

### 三、覆盖度校验补充

- [ ] Codex repo marketplace 发布后冒烟：SMOKE-core-34
- [ ] Codex 项目专属 skill 保留发布后冒烟：SMOKE-core-35
- [ ] Claude Code 项目专属 skill 保留发布后冒烟：SMOKE-core-36
- [ ] 官网命名空间文档发布后冒烟：SMOKE-core-37

## 七、UI/UX 前置确认（proposal-ui-ux-first）发布后冒烟用例

### 一、冒烟测试范围补充

| 环境 | 覆盖范围 | 说明 |
|------|----------|------|
| staging | `proposal.md` 模板注入「UI/UX 变更声明」段、page-design 原型 delta 经 merge 整份落盘、plan 阶段写入 allowlist、非法 `.md` delta 缺段标记报错不覆盖、双阶段发布状态（contract-ready 默认降级 / feature-enabled 需 capability 就绪）契约侧判定 | 发布后验证 UI/UX 前置确认契约已随 npm 包分发且默认降级（capability-disabled），不误判为 feature-enabled；跨仓端到端 smoke 由关联 change `ui-ux-first-panel` 承载，本文件仅覆盖 openlogos 契约侧 |

### 二、冒烟测试用例补充

| ID | 描述 | 来源 | 目标环境 | 前置条件 | 操作 | 预期结果 |
|----|------|------|----------|----------|------|----------|
| SMOKE-core-38 | `proposal.md` 模板注入「UI/UX 变更声明」段 | proposal.md 模板注入 | staging | 安装含本变更的 CLI，准备已 `launched` 的 GUI 项目（`product_type∈GUI`） | 执行 `openlogos change ui-first-smoke` | 生成的 `proposal.md` 含机器可读的「UI/UX 变更声明」段（`ui_impact` + 原型页清单占位）；`proposal.md` markdown 结构不变，不打断 CLI/runlogos 解析 |
| SMOKE-core-39 | page-design 原型经 `commitVerifiedPrototypes()` 落入原型图文件夹 | commitVerifiedPrototypes 落盘（复用路径映射、非 merge-executor） | staging | 安装含本变更的 CLI；活跃 GUI 提案，`deltas/prd/2-product-design/2-page-design/core-01-home.html` 已产出、`PLAN_APPROVED` 含匹配 `hashes` | 执行 `openlogos merge <slug>` 并 apply | 原型经 `commitVerifiedPrototypes()`（复用现有路径映射，落盘唯一入口、merge-executor 绝不触碰原型资产）落入 `logos/resources/prd/2-product-design/2-page-design/`；落盘 hash == `PLAN_APPROVED.hashes`；无需新增 `ui/` 目录 |
| SMOKE-core-40 | plan 阶段写入 allowlist 仅放行原型路径 | guard plan allowlist | staging | 安装含本变更的 CLI；launched GUI 项目、active guard、plan 阶段 | 分别尝试写 `deltas/prd/2-product-design/2-page-design/x.html` 与 `deltas/prd/2-product-design/1-feature-specs/x.md` | 原型 `.html` 放行（exit 0）；非原型 `.md` 在 plan 阶段被拒（exit 2）；其余 `deltas/**` plan 阶段禁写 |
| SMOKE-core-41 | 无段标记 `.md` delta 报错不覆盖 | merge-executor 整份落盘收窄（F3） | staging | 安装含本变更的 CLI；活跃提案，`deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md` 缺 `ADDED/MODIFIED/REMOVED` 段标记 | 执行 `openlogos merge <slug>` | 判为非法 delta 并报错停下；**不静默整份覆盖**主文档；不写 `SPEC_MERGED`（整份 create/replace 仅限资产目录 `.html`/`.png`/`.svg`） |
| SMOKE-core-42 | 双阶段发布状态：contract-ready 默认降级不 claim 已启用 | 双阶段发布状态（F2 R7 契约侧） | staging | 安装含本变更的 CLI（OpenLogos npm+文档站已发布）；**无** `logos/.session-capabilities.json`（capability 缺失） | 运行 `openlogos status --format json` / `next --format json` | `capabilities` 无 `ui_prototype_render`（缺失=降级模式）；对外状态=contract-ready；不得 claim「UI/UX 确认已前移」已启用；plan-exit 前走降级模式、advisory 不阻断 |
| SMOKE-core-43 | 双阶段发布状态：feature-enabled 需 capability 就绪 | 双阶段发布状态（F2 R7 契约侧） | staging | 安装含本变更的 CLI；写入 `logos/.session-capabilities.json`（`{"ui_prototype_render":true}`） | 运行 `openlogos status --format json` / `next --format json`，并检查两 SessionStart 入口上下文 | `status`/`next` JSON `capabilities` 含 `ui_prototype_render:true`；两源模板（`plugin/bin/openlogos-phase` + `plugin-codex/session-start.sh`）上下文 `capabilities` 段与 JSON 一致 surface（契约侧就绪；feature-enabled 终判仍需跨仓端到端 smoke，见边界说明） |

### 三、覆盖度校验补充

- [ ] `proposal.md` 模板注入 UI/UX 变更声明段：已覆盖（SMOKE-core-38）
- [ ] page-design 原型经 `commitVerifiedPrototypes()` 落盘（复用路径映射、非 merge-executor）：已覆盖（SMOKE-core-39）
- [ ] plan 阶段写入 allowlist 仅放行原型路径：已覆盖（SMOKE-core-40）
- [ ] 无段标记 `.md` delta 报错不覆盖：已覆盖（SMOKE-core-41）
- [ ] 双阶段发布状态 contract-ready 默认降级：已覆盖（SMOKE-core-42）
- [ ] 双阶段发布状态 feature-enabled capability 就绪契约侧：已覆盖（SMOKE-core-43）
- [ ] 跨仓端到端 smoke（capability 注入→双 SessionStart 一致 surface→面板渲染写 provenance→merge 严格 hash 拒漂移→区分两态）：**边界外**——由关联 change `ui-ux-first-panel`（runlogos 仓）承载并登记为其交付；本文件仅覆盖 openlogos 契约侧，不在此重复登记跨仓端到端用例

## 八、brownfield-adopter 发布后冒烟用例

### 一、范围补充
覆盖已发布包中 `openlogos adopt` 后直接 change 的默认路径、用户显式选择 `openlogos baseline-seed` 时的种子状态提交协议与安全 partial 恢复，以及 `status`/`next` 的兼容 coverage、事务恢复硬门和 `verify` 无确认软告警。ID 顺延主规格当前已占用的 `SMOKE-core-43`，取 `SMOKE-core-44`…`48`。

### 二、冒烟测试用例补充
| ID | 描述 | 来源 | 目标环境 | 前置条件 | 操作 | 预期结果 |
|----|------|------|----------|----------|------|----------|
| SMOKE-core-44 | adopt 后 required 默认直接引导 change | brownfield-adopter adopt 衔接 | staging | 安装含本变更的 CLI；空存量项目执行 `openlogos adopt`；无未终结 journal | 执行 `openlogos next` | 模块兼容字段为 `baseline_seed_state: required`；主动作指向 `openlogos change <slug>`，baseline-seed 仅显式可选；不要求先建基线、不建议 `add-baseline-docs` |
| SMOKE-core-45 | adopt 能力缺失不伪造且 change 可达 | adopt 降级路径 | staging | 安装含本变更的 CLI；无可用 AI 会话（CLI-only / 非交互） | 执行 `openlogos adopt` 后 `openlogos status --format json` 与 `next` | adopt 不启动 AI、不产逆向内容；`baseline_seed_state` 保持 `required`；next 给出可复制 change 主提示，可附可选 seed 说明；不显示「基线已建立」 |
| SMOKE-core-46 | status/next 暴露兼容 baseline_coverage 字段一致 | 覆盖率 JSON 呈现 | staging | 安装含本变更的 CLI；构造 `bootstrap: adopted` 且 `seeded`、含逆向候选、无未终结 journal的项目 | 执行 `openlogos status --format json` 与 `openlogos next --format json` | 两命令均含 `baseline_coverage` 的 `state`/`incomplete`/`denominator`/`tombstones`/`source`/`freshness` 且一致；不含已删除的 `human_verified`/`human_verified_delta`/`coverage`；零候选报 `n/a`，索引失效时 `freshness=stale/unknown` 且不输出精确计数结论 |
| SMOKE-core-47 | verify 对逆向 spec 不产软告警、JSON 无 baseline_warnings（确认机制移除反向回归） | verify 反向回归 | staging | 安装含本变更的 CLI；构造含 `verified:false` 逆向 spec 区域的提案 | 执行 `openlogos verify --format json` | verify 不输出现状基线/未确认逆向的软告警文本，JSON 不含 `baseline_warnings`；verify gate 结果不受基线逆向候选影响 |
| SMOKE-core-48 | 显式 baseline-seed 提交协议 + 安全 partial 非阻断恢复 | 种子状态提交（F7/F8） | staging | 安装含本变更的 CLI；adopt 完成、用户显式选择预扫、无未终结 journal | `baseline-seed begin`（N 产物）→ 仅写部分 staging 后 `commit`（partial）→ 运行 next/status → 补齐后再 commit | 首次 commit 写 `partial`、`missing` 非空；next 主动作仍为 `openlogos change <slug>`，status/next 一致输出 `state=partial`/`incomplete=true`，seed commit/begin 仅旁路 recovery；stale run 非零且不写状态；补齐后写 `seeded` |

### 三、覆盖度校验补充
- [ ] adopt 后 required 默认 change：SMOKE-core-44
- [ ] adopt 能力缺失不伪造且 change 可达：SMOKE-core-45
- [ ] coverage 兼容字段一致 + 已删除字段不复活 + tombstone/零分母/新鲜度：SMOKE-core-46
- [ ] verify 对逆向 spec 不产软告警、JSON 无 baseline_warnings：SMOKE-core-47
- [ ] 显式 baseline-seed 提交协议 + 安全 partial 主动作 change、恢复旁路：SMOKE-core-48

## 九、契约自描述与防误杀发布后冒烟用例

### 一、冒烟测试范围补充
| 环境 | 覆盖范围 | 说明 |
|------|----------|------|
| staging | status/next 契约自描述字段（contract.version / step_meta / facts）、spec 阶段 loop_state 缺席 | 发布后用真实安装包验证生产者契约真实挂出，且 loop_state 激活时机收紧生效（loop 劫持整类回归锚）；消费方保守模式验收归 runlogos R5，不在本文件 |

### 二、冒烟测试用例补充
| ID | 描述 | 来源 | 目标环境 | 前置条件 | 操作 | 预期结果 |
|----|------|------|----------|----------|------|----------|
| SMOKE-core-49 | status/next 真实携带 contract.version / step_meta / facts | 契约自描述（C1/C3/C5） | staging | 安装含本变更的 CLI（全局 npm）；构造 launched 活跃提案 | 执行 `openlogos status --format json` 与 `openlogos next --format json` | 两命令 `data` 顶层均含 `contract.version=="1.0.0"`，且与包内 `spec/schema/status.schema.json` / `next.schema.json` 内嵌契约版本一致；`modules[].active_change.step_meta{phase,kind}` 取值在闭合枚举内且与当前 `proposal_step` 的注册表映射一致；`facts` 六布尔字段（`spec_complete`/`slices_planned`/`slices_approved`/`code_required`/`has_delta_tasks`/`verify_pass`）齐备并与磁盘事实相符 |
| SMOKE-core-50 | spec 阶段（未 merge 的活跃提案）确不挂 loop_state | loop_state 激活时机（C2） | staging | 安装含本变更的 CLI；构造未 merge 的活跃提案（proposal/tasks 已填、delta 产出中或已全勾、**无** `SPEC_MERGED`、无 `SLICES_APPROVED`） | 执行 `openlogos status --format json` 与 `openlogos next --format json` | 两命令输出均**不含** `loop_state` key；`facts.spec_complete:false`、`facts.slices_approved:false`；`step_meta.phase=="pre-implement"`（pre-implement + loop_state 属非法组合，验证其不存在）；流程照常可推进（不因缺席被判死） |

### 三、覆盖度校验补充
- [ ] status/next 携带 contract.version / step_meta / facts 且与打包 schema 一致：SMOKE-core-49
- [ ] spec 阶段活跃提案不挂 loop_state（pre-implement 反面锚）：SMOKE-core-50

## 十、change-lint 发布后冒烟用例（change-lint-shift-left）

### 一、冒烟测试范围补充

验证 `openlogos change-lint` 新命令从打包到全局入口的真实链路：安装产物中命令注册有效、双格式输出契约生效、只读红线成立。ID 按现行模块级约定 `SMOKE-core-<序号>` 顺延，追溯矩阵关联 S35。

### 二、冒烟测试用例补充

| ID | 描述 | 来源 | 目标环境 | 前置条件 | 验证步骤 | 通过标准 |
|----|------|------|---------|---------|---------|---------|
| SMOKE-core-51 | 命令可见与可发现 | 部署方案 §二十一 | local | 新版全局安装完成，`openlogos --version` 与 `cli/package.json` 一致 | 运行 `openlogos --help` | 输出含 `change-lint` 条目 |
| SMOKE-core-52 | text/JSON 调用契约 | `spec/cli-json-output.md` §3.15 | local | 存在可检查的提案目录（本提案自身或夹具） | 分别运行 `openlogos change-lint --slug <slug>` 与 `--format json` | text 逐项 ✓/✗；JSON 为 stdout 通用信封 `{command:"change-lint",…,data:{slug,pass,violations}}`；exit ∈ {0,2}；对不存在 slug 运行 → stderr error envelope + exit 1 |
| SMOKE-core-53 | 只读红线（项目级） | S35 场景 §四 | local | 同上 | 运行前后对**整个项目根**做文件清单 + 逐文件 sha256 快照对比（覆盖 exit 0 / 2 / 1 三条调用路径） | 项目根文件集合与全部哈希完全不变（含 guard、marker、`logos-project.yaml`、verify 账本；且无 `UI_PROTOTYPE_HASHES.json` 新增） |

### 三、覆盖度校验补充

- SMOKE-core-51…53 全部经 `openlogos smoke` 门禁执行并由 runner/reporter 写入结果账本；任一失败阻断 archive。
- 三条用例分别锚定：入口注册（打包正确性）、双格式与三退出码契约（机器可消费性）、只读性（授权语义）——与 UT/ST 层不互相替代（三层证据各自独立）。

## 十一、baseline-on-touch 发布后冒烟用例（S39）

### 一、冒烟范围

在真实安装的 npm tarball/发布包上验证存量接入主路径、L9 结构门、缺失目标 CREATE apply 与无 JIT 回归。所有用例必须由 smoke runner 执行并通过 OpenLogos smoke reporter 写入 `logos/resources/verify/smoke-results.jsonl`；仅手工运行命令或只写规格不算覆盖。

### 二、冒烟测试用例

| ID | 描述 | 目标环境 | 前置条件 | 操作 | 通过标准 |
|---|---|---|---|---|---|
| SMOKE-core-54 | adopt 后无需 seed 直接 change，未终结 journal 仍硬阻断 | staging | 从新版 tarball 安装 CLI；准备未初始化存量 CLI 项目；另备不可恢复 journal 夹具与 resources/index 读取哨兵 | 执行 adopt；在无未终结 journal 下分别构造 required/安全 partial/seeded 后运行 next 并创建首个 change；再注入不可恢复 journal 重跑 next/status | 恢复门通过时三态主动作均可创建 change且 partial staging 不被当规格；不可恢复夹具返回 `baseline_commit_in_progress`、读取哨兵为 0、无 proposal/delta 写入 |
| SMOKE-core-55 | 权威 targets、逐场景完备与 plan L9 | staging | 新提案显式 touched S05/S39，并为每场景列强制维度和全部条件 disposition；两个场景共享同一测试/feature target | 生成 proposal/tasks，运行 change-lint text/JSON；依次删除 S05 维度、复制 canonical target、构造非法 SKIP/AMBIGUOUS | 合法计划 `P==T` 且每目标仅一 task；负例分别返回 `baseline_closure_target_missing`、`delta_target_duplicate`、`baseline_closure_malformed`/`baseline_closure_ambiguous`，不得由 tasks 反推通过 |
| SMOKE-core-56 | 缺失目标全量 CREATE 与 API/DB non-Markdown apply | staging | 提案触达无正式场景/测试/OpenAPI/DDL 的 HTTP+SQLite 场景；准备真实 OpenAPI YAML 与 SQLite SQL ADDED 控制 delta，并含一个既有目标的 MODIFIED 对照 | 按场景→API/DB→测试/编排产出最终态 deltas，经授权 merge/apply；重读目标并实际 parse OpenAPI、在临时 SQLite 事务执行 DDL | 场景含完整时序/异常，测试/编排含真实 ID/reporter；API/DB 只剥离首行且最终目标无 marker、可解析/执行；所有目标/counter/index 原子落盘，成功后才有 `SPEC_MERGED` |
| SMOKE-core-57 | P/T/D、模式漂移与残缺/非法 delta fail-closed | staging | 准备合法 plan 后分别替换一个等量不同成员的 task/delta、外部创建原 CREATE 目标、删除场景 Mermaid、让 non-Markdown 首行 target 漂移/SQL 失效 | 分别运行 change-lint/merge 消费路径 | 逐例返回集合差异、`delta_target_mode_mismatch`、`create_target_incomplete`、`non_markdown_delta_invalid`；不覆盖、不部分 apply、不写 `SPEC_MERGED`，既有目标字节保持不变 |
| SMOKE-core-58 | 无 JIT/verified/baseline warning 回归 | staging | adopted + committed `verified:false` candidate，直接执行首个 on-touch change 到 verify 消费前沿 | 检查人读/JSON、delta、主规格预期与 marker 集合 | 无确认提示、无 verified:true/confirmed_* 写回、无 baseline_warnings、无新 gate/marker；唯一用户方案门仍为 plan-exit |

### 三、覆盖与发布判定

- SMOKE-core-54 同时锚定“用户无需单独建立基线”与“不可恢复 journal 绝不读取半新资源”。
- SMOKE-core-55 锚定 proposal 权威 targets、逐场景维度完备与 `P==T`，证明遗漏/SKIP/AMBIGUOUS 可被 L9 发现。
- SMOKE-core-56 锚定 CREATE 不是骨架，并验证 API/DB non-Markdown 首行剥离、真实 parse/执行与原子落盘。
- SMOKE-core-57 锚定 `P==T==D` 成员对账、模式/完整度/非 Markdown 语法及 merge 纵深 fail-closed。
- SMOKE-core-58 锚定已删除 JIT 确认流程不会复活。
- 任一用例未被 runner/reporter 分派、未写结果或失败，都必须阻断 archive；不得以 UT/ST 通过替代发布后证据。

## 二十二、决策澄清协议 v0.13.25 本地全局安装冒烟用例

> 适用部署：`plan-decision-clarification`。仅在 verify PASS、0.13.25 tarball 已安装到当前开发机 npm 全局环境且部署完成已受控落标后，由独立 `openlogos smoke` 门禁执行。所有用例必须通过统一 smoke dispatcher 写入 OpenLogos reporter；不得手工伪造 `SMOKE_PASS`。

### 冒烟测试用例补充

| ID | 用例 | 前置条件 | 操作 | 通过标准 | 失败处理 |
|---|---|---|---|---|---|
| SMOKE-core-59 | 全局命令与安装包版本一致 | 已使用本次生成的本地 tarball 完成 npm 全局安装；部署报告记录安装前路径/版本 | 在干净 shell 中重新解析 `openlogos` 命令，执行 `openlogos --version`，并读取全局安装包的 package/plugin 版本元数据 | 命令路径指向当前 npm 全局 prefix；CLI、`cli/package.json` 与插件元数据均为精确 `0.13.25`；运行时包包含两份 JSON Schema 与 change-writer Skill | 任一版本/路径/包内容不一致即 FAIL，停止后续归档并按部署方案恢复 0.13.24 |
| SMOKE-core-60 | 已安装 CLI 暴露 clarification JSON 契约 | 使用隔离临时项目，存在合法 pending clarification@1 proposal，当前项为 C02 | 分别执行已安装 CLI 的 `status --format json` 与 `next --format json`，按随包 schema 校验 data | 两者均通过 schema；`plan_state.clarification` 同义，含 schema/mode/status/required、稳定去重 `required_categories`、未决数量、C02 和完整 `next_decision`；next 不要求宿主解析 Markdown | 任一字段缺失、schema 不通过或 status/next 漂移即 FAIL，保留隔离 fixture 和输出供诊断并回滚 |
| SMOKE-core-61 | 部署必选决定缺失时全局 CLI fail-closed | 隔离临时项目的 proposal 声明“是否需要部署：是”，clarification 结构合法但无 `deployment/source=user` 决定；记录批准 marker 初始不存在 | 依次运行 `status --format json`、`next --format json` 与 `next --auto --format json`，随后重读 proposal 和 marker | 三次均保持 `proposal_step=writing`、`next_node.id=write-proposal`，reason=`deployment-clarification-required`；auto 不写 `PLAN_APPROVED`/`GATE_AUTO_PASSED`，不改 proposal，不进入 tasks/Delta | 任何越门、写 marker、自动采用推荐答案或文件漂移均 FAIL，立即停止归档并恢复 0.13.24 |

### 环境隔离与清理

- fixture 必须位于安全创建的临时目录，不得复用真实活跃提案或修改当前仓库 guard。
- 用例只读取全局安装包与临时 fixture；不得执行 npm publish、Git tag、GitHub Release、官网部署或远端 push。
- smoke 成功后清理临时 fixture；失败时保留诊断路径并写入 smoke report。
- 任一用例未执行、无 reporter 记录或状态不是 PASS，统一门禁不得生成 `SMOKE_PASS`。

### 回滚验收

若任一用例失败，按部署方案重新安装准备好的 0.13.24 包，并确认新 shell 中 `openlogos --version` 返回 0.13.24。回滚只恢复本机全局 CLI，不触发公开发布动作；失败原因、原 0.13.25 tarball 摘要和恢复结果写入部署/冒烟报告。
