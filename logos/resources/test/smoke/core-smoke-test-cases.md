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

## 二十二、决策澄清协议 v0.13.25 本地全局安装冒烟用例

> 适用部署：`plan-decision-clarification`。仅在 verify PASS、0.13.25 tarball 已安装到当前开发机 npm 全局环境且部署完成已受控落标后，由独立 `openlogos smoke` 门禁执行。所有用例必须通过统一 smoke dispatcher 写入 OpenLogos reporter；不得手工伪造 `SMOKE_PASS`。

### 冒烟测试用例补充

| ID | 用例 | 前置条件 | 操作 | 通过标准 | 失败处理 |
|---|---|---|---|---|---|
| SMOKE-core-59 | 全局命令与安装包版本一致 | 已使用本次生成的本地 tarball 完成 npm 全局安装；部署报告记录安装前路径/版本 | 在干净 shell 中重新解析 `openlogos` 命令，执行 `openlogos --version`，并读取全局安装包的 package/plugin 版本元数据 | 命令路径指向当前 npm 全局 prefix；CLI、`cli/package.json` 与插件元数据均为精确 `0.13.25`；运行时包包含两份 JSON Schema 与 change-writer Skill | 任一版本/路径/包内容不一致即 FAIL，停止后续归档并按部署方案恢复 0.13.24 |
| SMOKE-core-60 | 已安装 CLI 不再发射 clarification 字段（§2.74.1 判定→文档） | 使用隔离临时项目，存在合法 clarification@1 小节的 proposal | 分别执行已安装 CLI 的 `status --format json` 与 `next --format json`，按随包 schema 校验 data | 两者均通过 schema；**均不发射** `plan_state.clarification`（该字段自 lite-cut3a 起退出机器判定面），status/next 口径一致 | 任一路仍发射该字段、schema 不通过或 status/next 漂移即 FAIL，保留隔离 fixture 和输出供诊断并回滚 |
| SMOKE-core-61 | 部署必选决定缺失不再阻断，且 auto 的只读边界不变（§2.74.1） | 隔离临时项目的 proposal 声明“是否需要部署：是”，clarification 结构合法但无 `deployment/source=user` 决定 | 依次运行 `status --format json`、`next --format json` 与 `next --auto --format json`，随后重读 proposal | 三次均**不以 clarification 为由阻断**、不发射该字段；`next --auto` 不改写 `proposal.md`（澄清自 lite-cut3a 起为文档，不参与流程判定） | 任一路仍产生 `deployment-clarification-required`、仍发射 clarification，或 auto 改写 proposal 即 FAIL，保留 fixture 供诊断并回滚 |

### 环境隔离与清理

- fixture 必须位于安全创建的临时目录，不得复用真实活跃提案或修改当前仓库 guard。
- 用例只读取全局安装包与临时 fixture；不得执行 npm publish、Git tag、GitHub Release、官网部署或远端 push。
- smoke 成功后清理临时 fixture；失败时保留诊断路径并写入 smoke report。
- 任一用例未执行、无 reporter 记录或状态不是 PASS，统一门禁不得生成 `SMOKE_PASS`。

### 回滚验收

若任一用例失败，按部署方案重新安装准备好的 0.13.24 包，并确认新 shell 中 `openlogos --version` 返回 0.13.24。回滚只恢复本机全局 CLI，不触发公开发布动作；失败原因、原 0.13.25 tarball 摘要和恢复结果写入部署/冒烟报告。

## 二十三、切片感知 verify v0.13.26 本地全局安装冒烟用例

> 适用部署：`make-verify-slice-aware`。仅在 final verify PASS、用户明确授权把 `0.13.26` tarball 安装到本机 npm 全局环境、且部署完成受控落标后，由独立 `openlogos smoke` 门禁执行。所有用例通过统一 smoke dispatcher 与 OpenLogos reporter 写结果；不得手工生成 `SMOKE_PASS`。

### 冒烟测试用例补充

| ID | 用例 | 前置条件 | 操作 | 通过标准 | 失败处理 |
|---|---|---|---|---|---|
| SMOKE-core-62 | 全局版本与协议资产一致 | 已从记录哈希的本地 tarball 全局安装；新 shell | 检查命令路径/版本、全局 package/plugin 元数据和包内容 | 版本均精确 `0.13.26`；包含 slice-planner、`spec/test-slice-manifest.md` 与 1.1.0 JSON Schema | 任一不符即 FAIL，停止后续归档并回滚 0.13.25 |
| SMOKE-core-63 | 五切片 checkpoint 到 final | 隔离临时项目；有效五切片 manifest；各片 runner/reporter 可独立执行 | 依序为 5 片写交付结果并各运行 verify，最后再运行 final | 每轮 eligible/pending 正确；前 5 次仅写对应 PASS checkpoint、不写最终 `VERIFY_PASS`；final 覆盖全部 defined 并写 PASS | 保留 fixture、manifest/checkpoint/JSON 输出；回滚并诊断 |
| SMOKE-core-64 | 真实失败跨进程锁定 attempted slice | 承接第2片，先勾 task 但 reporter 置 fail | verify FAIL→退出 shell/重启→next/verify→修复 PASS | 两次失败都携同一第2片 ID，只计真实失败；修复 PASS 后才前移第3片 | 任何串片、iteration 虚增或 pending 入分母即 FAIL |
| SMOKE-core-65 | 缺 manifest 的 RunLogos 恢复合同 | 隔离多切片提案已部分 checkpoint，删除 manifest；使用 consumer harness 模拟宿主 | next JSON→按 plan-slices 动作派恢复→validator→next/verify | 首次 reason=`test-slice-manifest-missing`，无 Gate/loop 副作用；恢复保留 tasks/checkpoint，从原 attempted 续跑；consumer 不解析 Markdown | 文件存在但 validator 不过不得继续；失败保留动作/violation，回滚 |
| SMOKE-core-66 | final 硬门与 0.13.25 回滚可用 | 五片 checkpoint 全过；准备 final 缺一条结果 fixture；保留 0.13.25 tarball/hash | 先执行 final 负例，再补齐通过；随后在隔离验证窗口演练重新安装旧包并复核版本 | 负例必须 FAIL 且缺失 ID 不列 pending；补齐后 PASS；回滚演练精确恢复 `0.13.25` 与原命令路径，再按部署决定恢复新包或结束 | final 假通过、回滚失败或版本漂移即阻断 archive |

### 环境隔离与证据

- 所有 fixture 位于安全临时目录，不修改真实活跃提案、guard 或项目资源。
- 记录 tarball SHA-256、npm prefix、命令解析路径、每次 verify JSON、manifest/checkpoint/loop 哈希与 reporter 结果。
- 不执行 npm publish、Git tag、GitHub Release、官网部署或 git push。
- 任一 SMOKE ID 缺 reporter 行、非 PASS 或未实际执行，统一门禁不得生成 `SMOKE_PASS`。

### 回滚验收

失败时重新安装部署前保存且哈希匹配的 `miniidealab-openlogos-0.13.25.tgz`。新 shell 的 `openlogos --version` 必须精确为 `0.13.25`，命令路径位于原 npm prefix；回滚结果和失败制品路径写入部署/冒烟报告。

## ZCode 真实 tarball 与真实客户端 staging smoke

### 范围与统一前置条件

- 环境：隔离 staging；安装本提案真实 `npm pack` tarball，不允许 workspace link、源码直跑或已发布版本替代。
- 宿主：真实 ZCode CLI/客户端，记录版本、插件目录和新 session 标识。
- 安全：使用一次性项目与隔离用户目录；不得执行 `npm publish`、Git tag、GitHub Release、官网发布或 `git push`。
- 运行器：统一 smoke dispatcher 必须发现本节全部 ID，并把结果写入 `logos/resources/verify/smoke-results.jsonl` 或 `logos.config.json.smoke.result_path` 声明路径。

### 冒烟测试用例

| ID | 验证点 | 操作 | 预期结果与证据 |
|---|---|---|---|
| SMOKE-core-100 | 真实 tarball 与版本 | build/test 后 `npm pack`，记录哈希并隔离安装 | 实际 CLI 路径来自该 tarball；版本、大小、SHA-256 可追溯；包清单含全部 ZCode 模板/runtime |
| SMOKE-core-101 | ZCode 插件发现与启用 | 用 tarball CLI 初始化 zcode 项目，按真实 ZCode 流程安装/启用插件并开新 session | ZCode 发现唯一 OpenLogos plugin identity；manifest 来源为安装产物，不引用仓库源码 |
| SMOKE-core-102 | Skills/Commands/Agents | 在真实 ZCode 会话列出并调用最小无副作用入口 | OpenLogos Skills、Commands、必要 Agents 可发现；名称、描述、frontmatter 与 locale 正确 |
| SMOKE-core-103 | SessionStart 上下文 | 有/无 active guard 各开新 session | additionalContext 与磁盘 lifecycle/proposal_step 一致，含允许范围和下一确认点 |
| SMOKE-core-104 | PreToolUse 允许路径 | delta-writing 下由真实 ZCode 写本提案允许的 delta/任务 fixture | 工具执行成功；Hook 返回 allow；目标内容和审计日志一致 |
| SMOKE-core-105 | PreToolUse hard deny | 同一阶段请求写源码、提案外路径和 symlink 逃逸路径 | 三者均在执行前 deny，reason 清晰且为 exit 2 阻断；所有目标哈希不变 |
| SMOKE-core-106 | sync/launch 幂等与新 session | 连续 sync，两次 adopted launch，并在刷新后重开 ZCode session | 第二次资产 unchanged；用户配置/插件不变；新 session 读取 launched 资产和最新阶段 |
| SMOKE-core-107 | 既有宿主回归与回滚 | 对四个既有宿主跑最小初始化资产回归；禁用本次插件并恢复上一 tarball | Claude Code/OpenCode/Codex/Cursor 契约不变；回滚后版本、插件状态和用户资产恢复可证 |

### 判定与 reporter 契约

- 每个 runner 必须写一行合法 JSONL，至少含 `id`、`status`、`timestamp`、`duration_ms`、`environment: "staging"`；失败必须含 `error` 和证据路径。
- `SMOKE-core-100`～`SMOKE-core-107` 任一缺失、skip、fail、runner 未发现或 reporter 未写入，都不得产生 `SMOKE_PASS`。
- `SMOKE-core-105` 必须同时保留 ZCode Hook 原始响应、exit code 和文件哈希证据；仅看到报错文案不算通过。
- `SMOKE-core-107` 的回滚演练是本提案完成条件，不得以“已有回滚方案”替代实际 staging 证据。
- 所有日志必须脱敏；禁止把真实用户配置、凭据或生产目录复制到 smoke 证据。

### 覆盖度校验补充

- [x] 真实 tarball 来源与完整性：SMOKE-core-100
- [x] 真实 ZCode 插件发现：SMOKE-core-101
- [x] Skills/Commands/Agents：SMOKE-core-102
- [x] SessionStart：SMOKE-core-103
- [x] PreToolUse allow/hard deny：SMOKE-core-104 / SMOKE-core-105
- [x] sync/launch 幂等与快照边界：SMOKE-core-106
- [x] 既有宿主回归和 staging 回滚：SMOKE-core-107

## Qoder 真实 tarball 与真实 CLI staging smoke

### 范围与统一前置条件

- 环境：隔离 staging；安装本提案真实 `npm pack` tarball，禁止 workspace link、源码直跑或已发布包替代。
- 宿主：真实 Qoder CLI，记录绝对路径、版本、插件数据根和新 session 标识；mock/wrapper 直调不可替代。
- 安全：一次性 init/adopt 项目与隔离用户目录；禁止 npm publish、Git tag、GitHub Release、官网/Cloudflare 部署和 git push。
- 运行器：统一 smoke dispatcher 发现本节全部 ID，并写入 `logos/resources/verify/smoke-results.jsonl` 或配置声明路径。

### 冒烟测试用例

| ID | 验证点 | 操作 | 预期结果与证据 |
|---|---|---|---|
| SMOKE-core-108 | 真实 tarball 与 CLI 身份 | build/test/pack，记录哈希并隔离安装 | 实际 OpenLogos 路径来自本 tarball；版本/大小/SHA-256 可追溯；清单含全部 Qoder 资产/runtime |
| SMOKE-core-109 | Qoder 插件发现与启用 | 用 tarball CLI init qoder，按真实 Qoder CLI 流程 validate/install/enable 并开新 session | 唯一 OpenLogos identity 可发现；manifest/组件来自安装产物，不引用仓库源码 |
| SMOKE-core-110 | Skills/Commands/Agents/静态记忆 | 在真实 session 列出并调用最小无副作用入口，检查根 AGENTS | 声明组件与实际集合一致；locale 正确；用户 AGENTS/rules/settings 未被吸收或改写 |
| SMOKE-core-111 | SessionStart 上下文 | 无 guard/有 guard 各开新 session | hookEventName/additionalContext 合法，与磁盘 lifecycle/proposal_step/允许范围/确认点一致 |
| SMOKE-core-112 | PreToolUse allow | delta-writing 下由真实 Qoder 写允许的 delta fixture | permissionDecision=allow、exit0，工具执行；内容和审计证据一致 |
| SMOKE-core-113 | PreToolUse hard deny | 请求源码、提案外、`..` 与 symlink 逃逸写入，并注入 runtime 异常 | 全部执行前 deny、reason 非空、exit2；一般非零不计通过；所有目标哈希不变 |
| SMOKE-core-114 | sync/launch 幂等与用户资产 | 连续 sync、两次 adopted launch，每次刷新后开新 session | 第二次托管资产 unchanged；settings/用户 plugin/AGENTS marker 外哈希不变；新 session 为 launched |
| SMOKE-core-115 | 既有宿主回归与回滚 | 跑五个既有宿主最小资产回归；禁用 Qoder plugin 并恢复上一 tarball | Claude Code/OpenCode/Codex/Cursor/ZCode 契约不变；回滚后版本、插件状态和用户哈希恢复可证 |

### 判定与 reporter 契约

- 每个 runner 写一行合法 JSONL，至少含 `id`、`status`、`timestamp`、`duration_ms`、`environment: "staging"`；失败含 `error` 与证据路径。
- SMOKE-core-108～115 任一缺失、skip、fail、未发现或 reporter 未写入，都不得产生 `SMOKE_PASS`。
- SMOKE-core-112/113 保留脱敏 Qoder Hook 原始 stdout、stderr、exit code、tool input 摘要和文件 SHA-256；只看到 UI/文本报错不算通过。
- SMOKE-core-115 必须实际演练隔离回滚，不得用“已有方案”代替；日志不得包含凭据、真实用户配置或生产目录。

### 覆盖度校验补充

- [x] 真实 tarball 与 CLI 身份：SMOKE-core-108
- [x] 真实 Qoder plugin：SMOKE-core-109
- [x] Skills/Commands/Agents/AGENTS：SMOKE-core-110
- [x] SessionStart：SMOKE-core-111
- [x] PreToolUse allow/hard deny：SMOKE-core-112 / SMOKE-core-113
- [x] sync/launch 幂等与用户资产：SMOKE-core-114
- [x] 既有五宿主回归与 staging 回滚：SMOKE-core-115

## WorkBuddy v0.13.28 真实 tarball 与真实宿主 staging smoke

### 范围与统一前置条件

- 环境：隔离 staging；安装本提案真实 `npm pack` tarball，禁止 workspace link、源码直跑或公开包替代。
- 宿主：真实 WorkBuddy 5.3.5+，记录绝对路径、版本、隔离 profile/plugin 根与新 session 标识。
- 安全：一次性 init/adopt workspace；不执行 npm publish、Git tag、GitHub Release、官网部署或 `git push`。
- 运行器：统一 smoke dispatcher 必须发现本节全部 ID，并写入配置声明的 smoke JSONL 结果路径。

### 冒烟测试用例

| ID | 验证点 | 操作 | 通过标准与证据 |
|---|---|---|---|
| SMOKE-core-116 | `0.13.28` 真实 tarball 与身份 | build/test/pack、记录 SHA-256、隔离安装 | 实际 CLI 来自该 tarball；版本精确 0.13.28；清单含全部 WorkBuddy 插件资产/runtime |
| SMOKE-core-117 | WorkBuddy 版本、插件发现与 Hook capability | 探测真实 5.3.5+，按官方流程安装/启用插件并开新 session | 唯一 OpenLogos identity 可发现；扩展 SessionStart/PreToolUse capability 可用；不引用仓库源码 |
| SMOKE-core-118 | Skills/Commands/Agents 与记忆边界 | 在真实会话列出并调用最小无副作用入口，比较边界证据 | 声明组件可发现且 locale 正确；settings、用户插件、项目资产和原生记忆未被读取性改写 |
| SMOKE-core-119 | SessionStart 磁盘上下文 | 无 guard/有 guard 各开新 session | additionalContext 与 lifecycle/proposal_step/范围/确认点一致，不依赖原生记忆 |
| SMOKE-core-120 | PreToolUse allow | delta-writing 下由真实 WorkBuddy 执行允许的 delta fixture 写入 | `permissionDecision=allow`、exit 0，工具执行，内容和审计证据一致 |
| SMOKE-core-121 | PreToolUse hard deny | 请求源码、提案外、`..`、symlink 逃逸，并注入 runtime/状态异常 | 均执行前 deny、reason 非空、exit 2；exit 1 不计通过；目标哈希不变 |
| SMOKE-core-122 | sync/launch 幂等与记忆零写入 | 连续 sync、两次 adopted launch，每次刷新后开新 session | 第二次托管资产 unchanged；用户边界和原生记忆证据不变；新 session 为 launched |
| SMOKE-core-123 | 既有宿主回归与真实回滚 | 跑六个既有宿主最小回归；禁用插件并恢复 0.13.27 tarball | Claude Code/OpenCode/Codex/Cursor/ZCode/Qoder 契约不变；版本、插件状态和用户边界恢复可证 |

### 判定与 reporter 合同

- 每个 runner 写一行合法 JSONL，至少含 `id`、`status`、`timestamp`、`duration_ms`、`environment: "staging"`、WorkBuddy 版本和 tarball SHA-256；失败包含 `error` 与证据路径。
- SMOKE-core-116～123 任一缺失、skip、fail、未发现或 reporter 未写入，都不得生成 `SMOKE_PASS`。
- SMOKE-core-120/121 必须保留脱敏的真实 WorkBuddy Hook 响应、stderr、exit code、tool input 摘要和文件 SHA-256；直接调用 runtime 不算真实宿主通过。
- SMOKE-core-118/122 只记录记忆边界的不透明前后证据，不收集或输出记忆正文。
- SMOKE-core-123 必须实际演练隔离回滚，不得用“已有方案”替代。

### 覆盖度校验

- [x] 真实 tarball 与精确版本：SMOKE-core-116
- [x] WorkBuddy 5.3.5+、插件和扩展 Hook capability：SMOKE-core-117
- [x] Skills/Commands/Agents 与原生记忆零写入：SMOKE-core-118
- [x] SessionStart：SMOKE-core-119
- [x] PreToolUse allow/hard deny：SMOKE-core-120 / SMOKE-core-121
- [x] sync/launch 幂等和用户边界：SMOKE-core-122
- [x] 既有六宿主回归与 staging 回滚：SMOKE-core-123

## TRAE `0.13.29` 本地隔离负向 Smoke

### 范围与统一前置条件

- 环境：`local-isolated`；HOME、npm prefix、cache、workspace 与 evidence root 均为一次性目录，禁止真实 HOME、全局 npm、workspace link 或源码直跑。
- 候选：`OPENLOGOS_TRAE_LOCAL_TARBALL` 指向本次真实 `@miniidealab/openlogos@0.13.29` tarball；包名、版本、清单、大小与 SHA-256 已在部署报告中固定。
- 回滚：`OPENLOGOS_TRAE_ROLLBACK_TARBALL` 指向真实 `0.13.28` tarball，版本与 SHA-256 已固定且可离线安装。
- 门禁：verify 已通过、`[deploy]` 已完成、`DEPLOY_DONE` 环境为 `local-isolated`，且用户独立授权 smoke。
- 边界：不启动 TRAE 国际版/CN，不执行真实写入工具，不读取或修改真实 `.trae/**`、账号、信任状态或记忆正文。

### 冒烟测试用例

| ID | 验证点 | 操作 | 通过标准与证据 |
|---|---|---|---|
| SMOKE-core-124 | `0.13.29` 真实 tarball 与 CLI 身份 | 只读核验候选 tarball 包名/version/清单/大小/SHA；从一次性 prefix 安装并解析 `openlogos` realpath 与版本 | 实际入口位于隔离 prefix，版本精确 `0.13.29`，清单含 CLI 与本地负向 runner/reporter；无 workspace link、源码入口、全局回退或网络替代 |
| SMOKE-core-125 | 本地隔离与公开副作用为零 | 核验 HOME、prefix、cache、workspace、evidence realpath；审计进程环境与允许写入根；检查发布调用审计 | 所有写入仅在一次性根；未触达真实 HOME、全局 npm、用户项目或真实 TRAE 状态；未执行 npm publish/dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署或 push |
| SMOKE-core-126 | 显式 TRAE 首写前拒绝 | 在隔离 workspace 预置合成 TRAE fixture 并记录清单/SHA；用安装态 CLI 执行 `init --ai-tool trae` | 非零退出且错误列出真实七宿主；不映射为 `other`；写入审计为零；配置、logos 与 fixture 前后清单/SHA 完全不变；输出不宣称 TRAE 可部署 |
| SMOKE-core-127 | `all` / sync 七宿主排除与严格失败 | 独立 fixture 执行 `init --ai-tool all`、`sync`；再用含 `trae` 的配置执行 sync | 成功路径精确包含 Claude Code、OpenCode、Codex、Cursor、ZCode、Qoder、WorkBuddy 且顺序稳定；无 `.trae/**` 新增；非法配置在总事务和版本戳前失败、无部分提交 |
| SMOKE-core-128 | 用户边界零触达且软控制非 PASS | 比较合成 Rules、Skills、Agents、Hooks、MCP、settings、账号占位、`enabled_folders`、不透明记忆与未知文件；审计 runner 的证据类型 | 全部文件清单/大小/SHA 不变，记忆正文未读取；runner 未启动 TRAE 或调用 wrapper；文件存在、UI、Rules/MCP/人工确认未被报告为 hard guard/capability PASS |
| SMOKE-core-129 | `0.13.29 → 0.13.28 → 0.13.29` 实际回滚恢复 | 在同一隔离 prefix 安装固定 0.13.28，核验入口/版本/七宿主最小状态，再恢复原 0.13.29 并重跑 SMOKE-core-126 的最小断言 | 两次切换均来自固定 tarball 且版本/realpath/SHA 可证；最终恢复 0.13.29；TRAE fixture 与用户边界始终不变；无真实全局安装或公开副作用 |

### 判定与 Reporter 合同

- dispatcher 必须发现并实际执行 SMOKE-core-124～SMOKE-core-129；不得由旧结果、mock、文件存在检查或手写 pass 补齐。
- 每个 runner 向配置的 smoke JSONL 路径写一行，至少含 `id`、`status`、`timestamp`、`duration_ms`、`environment: "local-isolated"`、候选/回滚 tarball SHA-256 和脱敏 `evidence`；失败还须含 `error`。
- 六个 ID 任一缺失、skip、fail、重复矛盾、环境/SHA 不匹配、runner/reporter 缺失或证据审计失败，均不得生成 `SMOKE_PASS`。
- SMOKE-core-126/127 保存脱敏命令、exit code、stderr 摘要、写入审计及目标 SHA-256；SMOKE-core-128 只保留不透明元数据与哈希，不保存账号或记忆正文。
- 本节全部 pass 只证明 OpenLogos 候选 tarball 保持 TRAE non-deployable 和隔离可回滚，不改变 D06 hard guard **BLOCKED**。

### 覆盖度校验

- [ ] 真实 tarball、版本与 CLI 身份：SMOKE-core-124。
- [ ] 一次性路径隔离与公开副作用为零：SMOKE-core-125。
- [ ] 显式 TRAE 首写前拒绝：SMOKE-core-126。
- [ ] `all`/sync 七宿主排除及严格配置失败：SMOKE-core-127。
- [ ] TRAE 用户边界零触达、软控制不得判定 PASS：SMOKE-core-128。
- [ ] 固定双 tarball 的真实回滚与恢复：SMOKE-core-129。

## 测试变更语义修复 `0.13.30` 本机全局 Smoke

### 范围与统一前置条件

- 环境：`local-global`；部署报告证明当前实际 `openlogos` 来自本次真实 `@miniidealab/openlogos@0.13.30` tarball，且已完成 `0.13.30 → 0.13.29 → 0.13.30` 部署演练。
- fixture：所有 merge/篡改/无 Git 测试只在一次性项目副本执行，禁止对本仓库活跃提案、真实用户项目或正式全局配置写入。
- 门禁：最终 verify PASS、全部 `[deploy]` 已完成、全局部署完成，且用户另行明确授权 smoke。
- runner：统一 smoke dispatcher 必须发现本节五个真实 ID，并通过随包 OpenLogos reporter 写入配置声明的 smoke JSONL；旧结果、mock 或手写 PASS 不得补齐。
- 边界：禁止 npm publish/dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署和 `git push`；无需 registry、发布或业务凭据。

### 冒烟测试用例

| ID | 验证点 | 操作 | 通过标准与证据 |
|---|---|---|---|
| SMOKE-core-130 | `0.13.30` 全局制品与入口身份 | 在新 shell 解析命令 realpath/npm prefix，读取 CLI、package 与有版本字段的 plugin metadata；校验部署报告中的 tarball 清单、大小与 SHA-256 | 实际入口位于记录的全局 prefix 并关联候选 tarball；CLI/package/Claude/Codex/ZCode/Qoder/WorkBuddy 版本均精确 `0.13.30`；不存在 workspace link、源码入口、旧缓存或 registry 替代 |
| SMOKE-core-131 | 安装态事故 fixture 得到精确六 ID | 在一次性项目构造事故 before/final，使用全局 CLI 的真实 merge-apply 写出正式 test target 与 `SPEC_MERGED`，再生成/验证 slice manifest | C 精确为 ST-S10-44、UT-S10-129、UT-S10-137、UT-S10-138、UT-S10-139、UT-S10-140；UT-S10-121～128 与 ST-S10-36～39 原样 ID 留在 baseline 且不 owned；无 18-ID 假阳性，marker/target hash 合法 |
| SMOKE-core-132 | 安装态 missing/unknown/duplicate 与 removed 语义 | 在独立 fixture 依次漏配一个 C、把 baseline/R 放入 owned、把同一 C 多片归属，并构造一个仅删除 ID | 漏配返回 missing，baseline/R owned 返回 unknown，多片返回 duplicate/ambiguous；removed 只在 R，不要求定义存在或 owned；每个负例在 runner 前失败且 checkpoint/Gate/loop/marker 无变化 |
| SMOKE-core-133 | 无 Git 重启一致与篡改 fail-closed | 成功 fixture 后移除 Git 元数据并启动新进程，比较 C/R/hash；再分别篡改 change-set schema/payload hash、target identity 与正式 target 字节 | 未篡改时跨进程输出逐字节一致且无 Git 调用；每个篡改均 `manifest_status=invalid`、human action required，不派 `plan-slices`、不启动 runner、不产生 verify/slice 副作用 |
| SMOKE-core-134 | 全局真实回滚恢复与公开副作用为零 | 复核部署证据并在同一全局 prefix 用固定本地 tarball实际执行 `0.13.30 → 0.13.29 → 0.13.30`；每步开新 shell检查 realpath/版本，最终重跑 SMOKE-core-131 最小断言 | 两个 tarball 包名/版本/SHA 固定；两次切换与最终恢复可证，最终六 ID 仍正确；本仓库/用户项目未触达；npm publish/dist-tag、Git tag、GitHub Release、官网/Cloudflare 与 push 调用均为零 |

### 判定与 Reporter 合同

- 每个 runner 必须写一行合法 JSONL，至少包含 `id`、`status`、`timestamp`、`duration_ms`、`environment: "local-global"`、候选与回滚 tarball SHA-256、全局入口 realpath 和脱敏 evidence 路径；失败还须包含 error。
- SMOKE-core-130～SMOKE-core-134 任一缺失、skip、fail、重复矛盾、环境/tarball identity 不匹配、runner/reporter 未发现或证据审计失败，均不得生成 `SMOKE_PASS`。
- SMOKE-core-131 必须保存 before/final/marker 的脱敏 hash 与逐 ID C/B 断言；不得保存真实用户数据，也不得把数组长度当作充分证据。
- SMOKE-core-132/133 必须保存命令、exit code、violation、写入哨兵和前后文件 SHA-256；看到错误文案但发生副作用不算通过。
- SMOKE-core-134 必须实际切换全局包；“部署报告曾演练”或“理论可回滚”不能替代本次 smoke 的真实证据。

### 清理与失败边界

- 成功后只可清理本次显式创建且 realpath 已核验的一次性 fixture；不得宽泛递归删除仓库、HOME、npm prefix 或未知路径。
- 失败保留脱敏 fixture/evidence 供诊断，并按部署方案恢复 `0.13.29` 或部署前版本；恢复失败必须显式报告，不得写 `SMOKE_PASS`。
- 全部 PASS 只证明本机全局 `0.13.30` 候选可工作并可回滚，不构成任何公开发布、远程部署或 push 授权。

### 覆盖度校验

- [ ] 全局 tarball、入口与版本 identity：SMOKE-core-130
- [ ] 跨仓事故精确六 ID 与 baseline 原样保留：SMOKE-core-131
- [ ] missing/unknown/duplicate/removed 分层语义：SMOKE-core-132
- [ ] 无 Git 重启稳定与篡改 fail-closed：SMOKE-core-133
- [ ] `0.13.30 → 0.13.29 → 0.13.30` 真实回滚恢复及公开副作用为零：SMOKE-core-134

### 范围与前置条件

- verify 已 PASS，部署报告固定真实 0.13.31 候选与 0.13.30 回滚 tarball 的绝对路径、大小和 SHA-256。
- 全局部署、`DEPLOY_DONE` 与用户独立 smoke 授权均已完成；本节不得由 plan/merge 授权隐式触发。
- 所有破坏性 fixture 位于一次性 HOME/prefix/cache/workspace/evidence 根；不对本仓活跃提案或真实用户项目执行 change/merge/sync fixture。
- 统一 dispatcher 必须发现以下六个 ID，runner 通过 OpenLogos reporter 写 smoke JSONL；旧结果、mock、skip 或手写 PASS 不得补齐。

### 冒烟测试用例

| ID | 验证点 | 操作 | 通过标准与证据 |
|---|---|---|---|
| SMOKE-core-135 | 0.13.31 全局制品与 asset manifest 身份 | 新 shell 解析 realpath/prefix/version，解包并重算 CLI/plugin/Skill/template/schema hash | 入口关联固定 tarball；所有版本为 0.13.31，Plan contract=1.3.0，manifest hash 全匹配，无 workspace link/源码/旧缓存 |
| SMOKE-core-136 | 中英文 scaffold 与精确 L0 issues | 一次性 zh/en launched fixture 执行 change；检查空 code；分别注入 summary 改名与 code checkbox | 合法 scaffold canonical；反例 lint exit 2，issue 含 path/section/actual/expected/fix_hint；不写 approval/Delta |
| SMOKE-core-137 | 四方一致与零写副作用 | 对合法、双错误、操作错误、历史 marker fixture 运行 lint/status/next/flow，比较全量文件 hash | plan fixture 四方 ready/issue 同源；操作错误分层正确；所有只读命令零写；历史不回退 |
| SMOKE-core-138 | sync stamp、幂等与用户资产保护 | 隔离项目连续 sync 两次并重开 session；对托管/用户/未知资产前后 hash | stamp 含合同版本/hash；第二次 unchanged；新 session 读新 Skill；用户/未知资产逐字节不变 |
| SMOKE-core-139 | Codex plugin cache 同版本漂移识别 | 预置同 semver 旧 Skill 字节，再安装候选插件并触发发现/校验 | 缓存键含版本+hash；旧内容被拒绝/刷新，不静默复用；最终 Skill 与 tarball manifest 一致 |
| SMOKE-core-140 | 真实回滚恢复与公开副作用为零 | 同一全局 prefix 实际执行 `0.13.31 → 0.13.30 → 0.13.31`，每步新 shell 校验；最终重跑 SMOKE-core-136 最小正例 | 两包 SHA/入口/版本可证，最终恢复 0.13.31；无 publish/dist-tag/tag/release/官网/push；用户项目与真实 cache 未触达 |

### Reporter 合同

- 每个 ID 写一行，至少包含 `id/status/timestamp/duration_ms/environment`、候选/回滚 SHA、入口 realpath、Plan contract version 与脱敏 evidence 路径；失败含 error。
- 任一缺失、重复矛盾、skip、fail、环境/制品/hash 不匹配、runner 未发现或证据不完整，均不得生成 `SMOKE_PASS`。
- SMOKE-core-136/137 保存命令、exit code、issue 摘要、前后文件集合/hash；SMOKE-core-138/139 只保存资产元数据/hash，不保存用户 Skill 或对话正文。

### 清理与失败边界

- 仅清理本次创建且 realpath 已验证位于一次性根的目录；不得宽泛递归删除 HOME、仓库、全局 prefix 或未知路径。
- 失败保留脱敏证据并按部署方案恢复 0.13.30 或部署前状态；恢复失败必须显式阻塞，不写 SMOKE_PASS。
- 六项全绿只证明本机候选可安装、收敛、同步和回滚，不构成公开发布或 RunLogos 已适配的声明。

### 覆盖度校验

- [ ] 制品与资产 identity：SMOKE-core-135。
- [ ] 中英文 scaffold 与 issue：SMOKE-core-136。
- [ ] 四方一致、只读与历史：SMOKE-core-137。
- [ ] sync/new session/用户资产：SMOKE-core-138。
- [ ] Codex cache 漂移：SMOKE-core-139。
- [ ] 真实回滚与公开副作用为零：SMOKE-core-140。

## OpenLogos 0.14.0 merge transaction 全局安装态 Smoke

### 冒烟测试用例

| 用例 ID | 场景 | 必须通过的真实断言 |
|---|---|---|
| SMOKE-core-141 | 全局命令与版本 | 新 shell 的 `command -v openlogos` 指向部署记录路径，`--version` 精确为 0.14.0 |
| SMOKE-core-142 | 随包合同自检 | tarball SHA、merge transaction schema、双语 Skill 与 contract hash 全部匹配冻结值 |
| SMOKE-core-143 | 纯 CREATE transaction | 全局 CLI 完成 slot→seal→apply，目标/receipt/marker 同批出现 |
| SMOKE-core-144 | 纯 MODIFY transaction | before/final hash、正式字节、receipt 与重复读取一致 |
| SMOKE-core-145 | 多根 mixed transaction | resources/spec/skills/test/decision/metadata 20+ targets 全批提交 |
| SMOKE-core-146 | validator retry | 首次 seal retryable，原子替换 slot 后同 transaction 完成 |
| SMOKE-core-147 | no-delta 与 UI | 零 slot 和 UI 绑定分支都生成同形 receipt，无旁路 marker |
| SMOKE-core-148 | status 只读与动作权威 | status/next 同源，调用前后目标树不变，只执行 allowed action |
| SMOKE-core-149 | 崩溃恢复与 response lost | journal 故障注入后只得全旧/全新，重复 apply 返回同 receipt |
| SMOKE-core-150 | RunLogos candidate 接缝 | 下游仅通过冻结全局路径完成真实 E2E；源码/mock/手工 target 对照组被拒绝 |

### Runner 约束

1. runner 必须在隔离临时项目中调用部署后的绝对全局 `openlogos`，不得调用仓库 `cli/dist`、ts runner、npm link 或 mock。
2. SMOKE-core-143～149 使用真实命令子进程与文件系统；除 transaction 声明的 Agent slot 外，不得手工写正式 target、metadata、receipt 或 `SPEC_MERGED`。
3. SMOKE-core-150 由 RunLogos 真实 AgentAdapter/WorkUnit/DriverCommandExecutor 接缝驱动，至少覆盖 CREATE、MODIFY、mixed 和 response-lost；预造 completed transaction 无效。
4. runner 调用图不得包含 npm publish、Git tag、GitHub Release、官网部署或 git push。
5. 任一用例缺失、skip、fail、重复矛盾、candidate 路径/版本/hash 不符或 reporter 缺失，smoke Gate 必须 FAIL。

### Reporter 约束

每个用例向 `logos/resources/verify/smoke-results.jsonl` 追加一条 OpenLogos reporter 记录，至少包含：

- `id`、`status`、`timestamp`、`duration_ms`、`environment="local-global"`；
- candidate command basename/允许披露的路径摘要、版本、tarball SHA-256；
- schema hash、contract hash、transaction/receipt hash；
- 脱敏 evidence 与失败阶段。

只有 SMOKE-core-141～150 全部真实 pass 且无 uncovered，才能写 `SMOKE_PASS`。RunLogos 跨仓 E2E 结果必须与 OpenLogos smoke report 中冻结的 candidate facts 对账。

## 修正后 OpenLogos 0.14.0 消费者合同 Smoke


### 冒烟测试用例

| 用例 ID | 场景 | 必须通过的真实断言 |
|---|---|---|
| SMOKE-core-151 | 安装态 abort/action parity | 部署后的绝对全局 CLI 暴露 abort，next/status 已知 action 与实际子命令一一对应，未知 action 保守失败 |
| SMOKE-core-152 | 声明 staging path | Agent 只在公共 slot descriptor 的 staging_path 原子写；同路径 submit 成功，任意其它路径/canonical target/symlink 负例均零正式副作用 |
| SMOKE-core-153 | completed 无环 receipt | CREATE/MODIFY/mixed 完成后 final/artifact hashes 互斥且精确覆盖 commit_paths，receipt hash 可重算，精确 Git 暂存无额外路径 |
| SMOKE-core-154 | abort 清理与幂等 | collecting/ready/sealed abort 均收敛 failed/aborted，私有制品清理、正式目标不变，重复 abort 返回同 `aborted_at` |
| SMOKE-core-155 | RunLogos 真实消费者接缝 | RunLogos 仅消费冻结的 slot/action/receipt 公共字段完成真实 E2E，不读 OpenLogos 私有 transaction 文件、不自行推导提交集 |
| SMOKE-core-156 | stacked slug 证据归属 | 旧 slug 的 SMOKE-core-150 与本 follow-up 的 SMOKE-core-151～156 分别绑定各自 guard/marker/candidate hash，不能互相顶替归档证据 |

### Runner 与边界

1. runner 必须在隔离临时项目中调用部署后的绝对全局 `openlogos`；不得调用源码入口、mock 或预造 completed receipt。
2. SMOKE-core-155 必须由 RunLogos 真实 AgentAdapter/WorkUnit/DriverCommandExecutor 驱动，并回传同一 candidate、schema 与 contract hash。
3. SMOKE-core-156 只核对各 worktree/slug 的证据归属与集成前置，不代替任一 archive，也不得删除另一 slug 的 guard/marker。
4. 调用图不得包含 npm publish、Git tag、GitHub Release、官网部署或 git push；失败时按部署方案回滚。

### Reporter 约束

每个 ID 向 `logos/resources/verify/smoke-results.jsonl` 追加唯一 OpenLogos reporter 记录，至少包含 `id/status/timestamp/duration_ms/environment="local-global"`、candidate/tarball/schema/contract hash、transaction/receipt 摘要与脱敏 evidence。任一缺失、skip、fail、重复矛盾或证据归属漂移均不得生成 `SMOKE_PASS`。

## OpenLogos 0.14.1 本地全局 patch 候选 Smoke

### 冒烟范围与前置

- 环境固定为 `local-global`，实际命令必须来自部署报告冻结的本机 npm 全局绝对入口。
- `VERIFY_PASS`、`DEPLOY_DONE.environment="local-global"` 与 `[deploy]` 全勾必须同时成立；用户需另行明确授权 `openlogos smoke --env local-global`。
- 候选与回滚输入分别为已记录 SHA-256 的 0.14.1 和 0.14.0 真实 tarball；不得使用 workspace link、仓库源码、mock、预造 receipt 或可变 registry 下载替代。
- smoke 调用图禁止 npm publish、dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署和 git push。

### 冒烟测试用例

| ID | 描述 | 来源 | 目标环境 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|---|
| SMOKE-core-157 | 0.14.1 全局入口与完整制品身份同源 | S19-AC-01、S19-AC-02、部署方案“本机全局安装与自检” | local-global | 已从冻结的 0.14.1 tarball 全局安装；部署报告含入口、prefix、tarball SHA 与清单 | 启动新 shell，读取 `command -v`/realpath/`--version`；读取全局 package、Claude/Codex/ZCode/Qoder/WorkBuddy manifest 与 asset manifest；重算 tarball/asset hash | 命令位于记录的 npm prefix，版本全部精确为 0.14.1，bin/文件清单/asset hash 与同一 tarball SHA 一致；不存在 link、源码入口、旧 cache 或混合版本 |
| SMOKE-core-158 | 0.14.1 安装态 merge transaction 公共消费者合同可用 | S19-AC-03、功能规格 2.44.9、S19 Step 10 | local-global | SMOKE-core-157 已通过；隔离临时 launched fixture；candidate schema/contract hash 已冻结 | 仅通过部署报告中的绝对全局入口读取 status/next transaction 投影，执行最小 CREATE/MODIFY content slot 提交、seal/apply、completed receipt 校验和 abort/action parity；校验 candidate evidence validator 与 reporter 归属 | 公共 slot/action/receipt 合同完成且 final/artifact hashes 无环覆盖 commit_paths；validator 接受同源 0.14.1 facts、拒绝 0.14.0/混合 facts；runner 不读取 OpenLogos 私有 transaction 文件，不手写正式 target/receipt/marker |
| SMOKE-core-159 | 真实 0.14.0 回滚、0.14.1 恢复与公开副作用为零 | S19-AC-04、EX-10.1、部署方案“失败与回滚” | local-global | 两个固定 tarball、SHA、安装前事实和可复制命令已记录；SMOKE-core-157～158 已通过 | 在同一全局 prefix 依次安装 0.14.0、重新安装原 0.14.1 tarball；每一步启动新 shell 核对入口/版本/package/plugin/asset identity；审计本次命令图和远程状态 | 实际序列为 `0.14.1 → 0.14.0 → 0.14.1`，每一步绑定正确 tarball SHA，最终保持 0.14.1 且消费者合同最小断言仍通过；无 publish/dist-tag/tag/release/官网部署/push，失败时恢复明确版本并阻断成功 marker |

### Runner、Reporter 与 Dispatcher 合同

1. 后续 `[code]` 切片必须实现或更新 `scripts/smoke-release-0-14-1-local.*`（或等价 canonical runner），并由 `scripts/run-smoke.js` 在活跃 slug 为 `release-0-14-1-local` 时发现并执行 SMOKE-core-157～159。
2. runner 必须调用部署报告冻结的绝对全局入口；若入口版本、realpath、prefix、candidate SHA 或部署环境不匹配，在执行 transaction fixture 前失败。
3. 每个 ID 向 `logos/resources/verify/smoke-results.jsonl` 追加唯一结果，至少包含 `id`、`status`、`timestamp`、`duration_ms`、`environment="local-global"`、candidate/rollback tarball SHA、入口摘要、package/asset/schema/contract/receipt hash 与脱敏 evidence。
4. status 只允许 `pass` 或 `fail`；本组任何 skip 都视为未完成并使 Gate FAIL。缺失、重复矛盾、旧结果归属、证据不完整或 runner/reporter 未发现不得由其它历史 SMOKE ID 补位。
5. runner 只清理本次创建且 realpath containment 已验证的临时 fixture；不得递归删除 HOME、npm prefix、仓库、用户项目或未知路径。
6. code 阶段完成前必须运行 smoke 覆盖预检，确认 SMOKE-core-157～159 均有 runner/reporter/dispatcher 归属且不在 uncovered cases 中；不得预写 pass 结果冒充覆盖。

### 失败与门禁

- SMOKE-core-157 失败：停止后续用例，按部署方案恢复 0.14.0，不写 `SMOKE_PASS`。
- SMOKE-core-158 失败：保留隔离 transaction fixture 和脱敏诊断，恢复 0.14.0；不得以既有 SMOKE-core-141～156 的结果替代。
- SMOKE-core-159 在回滚或恢复任一步失败：显式报告全局环境可能不一致，阻断归档；不得继续从网络下载未知版本自愈。
- 任一用例检测到公开发布命令或远程状态变更：立即 FAIL，记录越界动作并停止。

### 覆盖度与追溯

- [x] S19-AC-01：SMOKE-core-157。
- [x] S19-AC-02：SMOKE-core-157、SMOKE-core-159。
- [x] S19-AC-03：SMOKE-core-158。
- [x] S19-AC-04：SMOKE-core-159。
- [x] EX-3.2、EX-5.1、EX-6.1：SMOKE-core-157 的前置身份门与失败恢复。
- [x] EX-10.1：SMOKE-core-158～159 的结果完整性、归属和公开副作用门。

只有三个 ID 全部由真实 runner 产生唯一 PASS、最终全局入口为同一 0.14.1 candidate，且无公开发布副作用，才能写 `SMOKE_PASS`。

## OpenLogos 0.14.2 Preflight/Reopen 安装态 Smoke


### 前置与授权

仅在verify PASS、固定0.14.2 tarball完成隔离验证并获得smoke明确授权后执行。SMOKE-core-162还需单独获得RunLogos恢复/继续merge授权。runner必须使用安装态绝对`openlogos`入口，不得源码直跑。

### 冒烟测试用例

| 用例ID | 场景 | 执行步骤 | PASS判据 |
|---|---|---|---|
| SMOKE-core-160 | 新事务seal preflight | 安装态CLI创建含歧义after测试表的事务，提交全部slots并seal；随后修正missing slot、reseal/apply | 首次seal前退回collecting且零正式/apply私有写；next指向submit_content；修正后completed receipt/marker有效 |
| SMOKE-core-161 | 0.14.1 legacy sealed兼容与回滚 | 加载无preflight record的sealed fixture；apply触发局部reopen；保留无关slots，修正后完成；演练0.14.1↔0.14.2 | 同transaction/plan/target-set；只有rejected missing；新seal后completed；每次版本/入口/资产hash一致，无混装 |
| SMOKE-core-162 | RunLogos真实事务恢复 | 在RunLogos根读取`mtx_7e0341e3719feccd22ef7615`；apply、核对missing、修正UT-S44-24声明slot、submit/reseal/apply | 仅S44 slot退回、其余14个保留；正式写前无journal/marker；同transaction最终completed，receipt/test-change-set/SPEC_MERGED可复算 |

### Runner 与 Dispatcher

- `scripts/run-smoke.js`或受控子runner必须显式分派SMOKE-core-160～162，记录实际安装态命令路径、版本、tarball SHA-256和fixture/项目根。
- SMOKE-core-160/161使用隔离临时项目并清理；SMOKE-core-162不得复制或伪造RunLogos transaction，只能在授权后使用真实项目。
- 任一步fatal、drift、journal/recovery错误立即停止，不abort或新建transaction掩盖。

### OpenLogos Smoke Reporter

每个ID向`logos/resources/verify/smoke-results.jsonl`写`id/status/timestamp/duration_ms/environment/evidence`；evidence至少绑定CLI realpath/version、candidate hash、transaction ID和关键before/after hashes。三个ID全部真实PASS后才可生成smoke报告/SMOKE_PASS；缺runner、缺reporter、mock或源码直跑均FAIL。

### 失败与回滚

安装态失败先恢复固定0.14.1并核验全部身份；RunLogos失败不伪造completed/receipt/marker。smoke失败不触发archive、公开发布或git push。

## OpenLogos 0.14.4 嵌套章节锚与原事务恢复安装态 Smoke

### 授权与统一前置

- 仅在 `openlogos verify` PASS、固定 `0.14.4` tarball 隔离矩阵通过、用户已明确授权本机全局部署且部署身份自检通过后执行。
- 执行 SMOKE-core-168 需要独立 smoke 授权；其中写入并完成 RunLogos 原 transaction 的步骤还需要 RunLogos merge 独立授权。只有 smoke 授权时，可完成安装态临时 fixture 与原事务只读核对，但不得写 RunLogos并不得把用例报 PASS。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.4`；源码入口、workspace link、mock transaction 或手工 receipt 不算验收。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-168 | 0.14.4 嵌套章节锚、回滚与 RunLogos 原事务恢复 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 package/plugin/asset/schema/Skill identity；② 在临时项目使用真实标题路径与重复叶结构，写 Agent final 后运行 submit/status/seal/apply；③ 运行围栏伪 marker、单段歧义、错误父链与 OpenLogos producer路径锚正反例；④ 演练 `0.14.4→0.14.3→0.14.4` 并复核每阶段 identity；⑤ 在 RunLogos 根只读核对 `mtx_e7f7b924499d49f96aaf8a2f`、6/7 hash与唯一 missing slot；⑥ 仅在 RunLogos merge已授权时写声明 staging、submit目标slot、seal/apply同一事务 | candidate各身份绑定同一tarball；submit不做锚语义拒绝，seal/apply共享resolver且正式标题层级正确、不含路径字面量；负例零正式副作用且仅可归因slot局部reopen；往返无混装；原transaction保持ID/plan/target-set/其它6 hash并最终7/7 completed，receipt/final/artifact hashes与`SPEC_MERGED`可复算；全程无abort/新transaction/公开发布副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-168`，不得依靠通配发现后无条件 PASS。
2. evidence 至少包含：tarball路径/大小/SHA-256、全局入口/realpath/version、package/plugin/asset hash、临时 transaction ID、共享 hit `level/text/path/range`、各 phase/hash、回滚每阶段 identity，以及脱敏后的 RunLogos transaction/slot/receipt hash。
3. 临时 fixture 在结果持久化后清理；RunLogos 原 transaction、正式目标、receipt 与 marker是跨仓审计证据，不得由 smoke runner伪造或删除。
4. runner 不得执行 `npm publish`、dist-tag、Git tag、GitHub Release、官网部署或 git push；检测到任一远程副作用立即 FAIL。

### OpenLogos Smoke Reporter

- 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-168` 结果，字段包含 `id/status/timestamp/duration_ms/environment/evidence`。
- 原事务只读核对完成但尚未获得 RunLogos merge授权时，状态只能保持未完成，不得以 SKIP/PASS替代最终步骤。
- 缺失、skip、重复矛盾、源码直跑、candidate/hash归属漂移、回滚未恢复、其它6 slot hash漂移或 receipt 不可复算均判 FAIL，不得写 `SMOKE_PASS`。

### 失败、自愈与完成边界

- 临时 fixture 失败：保留脱敏诊断，修复后重新 verify/build/pack/install/smoke；不得只重跑失败断言绕过 candidate identity。
- 全局身份或回滚失败：立即尝试恢复固定 `0.14.3` 并报告环境状态；未证明全旧或全新时阻断后续动作。
- RunLogos 失败：只处理 transaction 返回的可归因 missing slot；source/before/plan漂移、journal/recovery错误立即停止，不abort、不新建事务。
- 只有本机全局最终恢复为同一 `0.14.4` candidate、SMOKE-core-168 唯一真实 PASS、RunLogos 原 transaction completed且远程副作用为零，才允许生成 smoke报告/`SMOKE_PASS`并进入后续 archive授权点。

### 追溯

- 需求：AC-MT-ANCHOR-01～07。
- 功能规格：§2.46.3～§2.46.7。
- 架构：§37.4～§37.7。
- 部署：OpenLogos 0.14.4 嵌套章节锚修复本机全局部署方案。
- UT/ST：UT-S09-271～274、ST-S09-106～107、UT-S37-37～40、ST-S37-09～10。

## OpenLogos 0.14.5 sync YAML 与 overlay 版本安装态 Smoke

### 授权与统一前置

- 仅在 `openlogos verify` PASS、固定 `0.14.5` tarball 隔离矩阵通过、用户已明确授权本机全局部署且部署身份自检通过后执行。
- 执行 SMOKE-core-169 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.5`；源码入口、workspace link 或手工构造的 fixture 产物不算验收。
- 全部操作只在一次性临时项目与临时 npm prefix 中进行；**不得触碰本仓或用户其它项目的 `logos-project.yaml` 与 `logos/flow/*.yaml`**。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-169 | 0.14.5 资源索引结构化写入、降级可见与 overlay 版本单一权威 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 package/plugin/asset/schema/Skill identity；② 在临时目录执行真实 `openlogos init <name> --locale zh --ai-tool claude-code`，确认模板产出 `resource_index: []`；③ 放入 `logos/resources/prd/3-technical-plan/1-architecture/<any>.md` 后执行 `openlogos sync`，读回 `logos-project.yaml` 并用 CLI 捆绑解析器解析；④ 重复 `sync` 两次核对幂等与字节稳定；⑤ 另建含 GUI 模块（`product_type: web`）的 launched fixture，执行 `sync` 后立即执行 `flow show --resolved --lifecycle launched`；⑥ 构造落后 overlay 的正反两例（引用全部可解析 / 含失效 node id）各跑一次 `sync`；⑦ 构造 `recovered` 与 `error` 两态 fixture，分别执行 `status` 与 `next` 并前后比对文件 SHA-256；⑧ 演练 `0.14.4→0.14.5→0.14.4→0.14.5` 并复核每阶段 identity | candidate 各身份绑定同一 tarball；③ 解析无异常且新条目挂在 `resource_index` 下（**上游 Bug 报告三步复现路径在安装态不再复现**）；④ 二三次为 no-op 且文件逐字节稳定；⑤ `flow show` 输出**不含** `FLOW_VERSION_MISMATCH`；⑥ 正例 `extends` 提升至映射值且用户自定义 ops 保留，反例保持原值并继续告警；⑦ 两态下 `status` 与 `next` 均打印可见告警并点名 `resource_index`，且命令前后文件 SHA-256 相同（CLI 未代改写）；⑧ 往返无混装；全程无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-169`，不得依靠通配发现后无条件 PASS。
2. evidence 至少包含：tarball 路径/大小/SHA-256、全局入口/realpath/version、package/plugin/asset hash、临时项目路径（脱敏）、步骤 ③ 的解析结果与新增条目 path、步骤 ④/⑦ 前后的文件 SHA-256、步骤 ⑤/⑥ 的 `warnings[]` 原文与 `extends` 前后值、回滚每阶段 identity。
3. 临时 fixture 在结果持久化后清理；证据中不得包含用户真实项目路径或文档正文。
4. runner 不得执行 `npm publish`、dist-tag、Git tag、GitHub Release、官网部署或 git push；检测到任一远程副作用立即 FAIL。

### OpenLogos Smoke Reporter

- 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-169` 结果，字段包含 `id/status/timestamp/duration_ms/environment/evidence`。
- 缺失、skip、重复矛盾、源码直跑、candidate/hash 归属漂移、回滚未恢复，或任一分步判据未取证即报 PASS，均判 FAIL，不得写 `SMOKE_PASS`。
- 步骤 ⑦ 若观察到 CLI 改写了 fixture 的 `logos-project.yaml`（SHA-256 变化），直接 FAIL——该行为违反「处置权归人」的既定决策。

### 失败、自愈与完成边界

- 临时 fixture 失败：保留脱敏诊断，修复后重新 verify/build/pack/install/smoke；不得只重跑失败断言绕过 candidate identity。
- 全局身份或回滚失败：立即尝试恢复固定 `0.14.4` 并报告环境状态；未证明全旧或全新时阻断后续动作。
- 不得为让断言通过而放宽 `FLOW_VERSION_MISMATCH` 判定条件或改写用户正式文档。

### 追溯

- 需求：AC-YAMLW-01～08。
- 功能规格：§2.47；架构：§三十八；方法论规格：`spec/flow-spec.md` §10.1。
- 场景：S08、S09、S11；UT/ST：UT-S08-43～46、ST-S08-30～31、UT-S09-275～278、ST-S09-108、UT-S11-75～77、ST-S11-44。
- 部署方案：OpenLogos 0.14.5 sync YAML 与 overlay 版本修复本机全局部署方案。

## OpenLogos 0.14.6 归档寻址与 smoke 账本安装态 Smoke

### 授权与统一前置

- 仅在 `openlogos verify` PASS、固定 `0.14.6` tarball 隔离矩阵通过、用户已明确授权本机全局部署且部署身份自检通过后执行。
- 执行 `SMOKE-core-170` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.6`；源码入口或 workspace link 不算验收。
- 归档寻址断言只对**已存在的**归档提案做只读核对；不得为构造断言而归档新提案、改写 guard 或改写任何归档内容。临时可写夹具一律建在一次性目录中。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-170 | 0.14.6 归档事务只读寻址、写动作 fail-closed 与不适用显式 skip | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 package/plugin/asset identity；② 在一次性夹具项目中建含 completed 事务的提案，记录其 `transaction_id`/`receipt_sha256` 后执行 `openlogos archive`；③ 以原 slug 只读查询该事务并与归档前冻结事实比对；④ 对该归档提案依次发起 `submit-content`/`seal`/`apply`/`recover`/`abort`，并比对事务文件与 receipt 的 SHA-256；⑤ 构造两个同 slug 不同时间戳的归档目录，核对歧义 fail-closed；⑥ 清空账本执行 `smoke.command`，检查是否存在零记录退出的 runner，并核对不具备环境的用例是否全部以带原因的 skip 出现；⑦ 演练 `0.14.5→0.14.6→0.14.5→0.14.6` 并复核每阶段 identity | ③ 归档前后 `transaction_id`/`phase`/slot 计数/`receipt_sha256` 全一致；④ 五个写动作全部被拒且给出稳定 classification，事务文件与 receipt 字节**执行前后不变**；⑤ 报歧义且不取任一候选；⑥ 账本中不存在零记录退出的 runner，skip 均带可读缺失项且不再计入 uncovered，真实失败仍记 fail；⑦ 往返无混装；全程未改写 guard、未触碰既有归档内容，无 `npm publish`/tag/release/官网/git push 副作用 |

### 同轮复核：SMOKE-core-168 的恢复

`SMOKE-core-170` 与 `SMOKE-core-168` 必须在**同一轮账本**中执行并一并判读：

- `SMOKE-core-168` 应由「永久失败」恢复为「幂等重放通过」——其 runner 经 `--slug` 显式寻址已归档的目标事务，命中 completed 终态后只做只读核对；
- 若 `SMOKE-core-168` 仍失败，必须给出稳定归因（寻址失败 / 身份漂移 / 授权缺失），**不得**通过改写 guard、abort 或新建事务使其转绿；
- 该复核是本提案「门禁从恒红回到真实防线」这一目标的唯一端到端证据。

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-170`，不得依靠通配发现后无条件 PASS。
2. evidence 至少包含：tarball 路径/大小/SHA-256、全局入口/realpath/version、归档前后事务身份与 receipt 摘要、五个写动作各自的拒绝 classification、事务文件前后 SHA-256、歧义用例的错误摘要、本轮账本中零记录退出 runner 的数量（应为 0）与 skip 原因清单、回滚每阶段 identity。
3. 一次性夹具在结果持久化后清理；既有归档提案、guard 与正式目标是审计证据，runner 不得改写或删除。
4. runner 不得执行 `npm publish`、dist-tag、Git tag、GitHub Release、官网部署或 git push；检测到任一远程副作用立即 FAIL。

### OpenLogos Smoke Reporter

- 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-170` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。
- 观察到任一 runner 零记录退出、skip 缺原因、真实失败被降级为 skip，或出现伪造 pass，直接 FAIL。
- 观察到 runner 改写了 guard 或既有归档内容，直接 FAIL——该行为违反「可读不可写」的既定边界。
- 缺失、skip、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。

### 失败、自愈与完成边界

- 夹具失败：保留脱敏诊断，修复后重新 verify/build/pack/install/smoke；不得只重跑失败断言绕过 candidate identity。
- 全局身份或回滚失败：立即尝试恢复固定 `0.14.5` 并报告环境状态；未证明全旧或全新时阻断后续动作。
- Gate 仍 FAIL 时必须逐条归因（哪条 fail、哪条仍 uncovered、为何），不得以放宽判据、伪造记录或改写 guard 收尾。

### 追溯

- 需求：AC-TXADDR-01～05、AC-SMOKE-NA-01～04。
- 功能规格：§2.48；架构：§三十九。
- 场景：S09、S19；UT/ST：UT-S09-279～282、ST-S09-109、UT-S19-29～32、ST-S19-18。
- 部署方案：OpenLogos 0.14.6 归档寻址与 smoke 账本修复本机全局部署方案。

## OpenLogos 0.14.7 资源索引扫描与描述规则安装态 Smoke

### 授权与统一前置

- 仅在 `openlogos verify` PASS、固定 `0.14.7` tarball 隔离矩阵通过、用户已明确授权本机全局部署且部署身份自检通过后执行。
- 执行 `SMOKE-core-171` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.7`；源码入口或 workspace link 不算验收。
- 全部断言在一次性临时项目中构造。**不得触碰本仓或用户其它项目的 `logos-project.yaml`**，也不得为构造断言而清理任何既有索引条目。
- 判据用的 YAML 解析器必须取自**安装态 CLI 自己捆绑的 yaml**，而非 runner 宿主的依赖——判据是「CLI 读这份文件时能不能解析、读到什么」。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-171 | 0.14.7 资源索引候选范围、判据锚定与 kind 对齐 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 package/plugin/asset identity；② 在临时目录执行真实 `openlogos init`，放入两份权威文档（`1-architecture/core-system-map.md`、`2-scenario-implementation/core-scenario-candidates.md`）；③ 在 `verify/baseline-seed-runs/<run>/staging/` 下放同名陈旧快照，并在 `verify/` 顶层放一份 `acceptance-report.md`；④ 执行 `sync` 并用 CLI 捆绑解析器读回索引；⑤ 预置一条指向 `verify/` 子目录的历史条目后再次 `sync`；⑥ 连续 `sync` 两次核对幂等；⑦ 演练 `0.14.6→0.14.7→0.14.6→0.14.7` 并复核每阶段 identity | ④ 索引**恰含 3 条**：两份权威文档 + 顶层 `acceptance-report.md`；**0 条**快照条目；`core-scenario-candidates.md` 在列且描述为场景实现语义、非「验收报告」；`core-system-map.md` 的描述为架构语义且索引中不存在第二条同描述条目；⑤ 预置的历史条目**逐字保留**（CLI 不删除既有条目），且未新增快照条目；⑥ 两次 sync 后文件逐字节相同；⑦ 往返无混装；全程未触碰临时项目之外的任何文件，无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-171`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须为 `SMOKE-core-171` 写显式 `skip` 记录并携带缺失项，禁止静默零记录退出——沿用既有的不适用留痕契约。
3. evidence 至少包含：tarball 路径/大小/SHA-256、全局入口/realpath/version、临时项目路径（脱敏）、④ 步读回的完整 `resource_index` 条目列表（path + desc）、⑤ 步预置条目前后的文件 SHA-256、⑥ 步两次 sync 的 SHA-256、回滚每阶段 identity。
4. 临时项目在结果持久化后清理；证据中不得包含用户真实项目路径或文档正文。
5. runner 不得执行 `npm publish`、dist-tag、Git tag、GitHub Release、官网部署或 git push；检测到任一远程副作用立即 FAIL。

### OpenLogos Smoke Reporter

- 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-171` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。
- 观察到索引中出现任何 `verify/` 子目录路径、出现两条描述相同的同名文档条目，或 `core-scenario-candidates.md` 缺席，直接 FAIL。
- 观察到 runner 删除了预置的既有条目，直接 FAIL——该行为违反「既有条目处置权归人」的既定决策。
- 缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。

### 失败、自愈与完成边界

- 临时项目失败：保留脱敏诊断，修复后重新 verify/build/pack/install/smoke；不得只重跑失败断言绕过 candidate identity。
- 全局身份或回滚失败：立即尝试恢复固定 `0.14.6` 并报告环境状态；未证明全旧或全新时阻断后续动作。
- 不得为让断言通过而清理既有索引条目、放宽描述判据或改写用户正式文档。

### 追溯

- 需求：AC-RIDX-01～07。
- 功能规格：§2.49；架构：§四十。
- 场景：S08；UT/ST：UT-S08-47～50、ST-S08-32～33。
- 部署方案：OpenLogos 0.14.7 资源索引扫描与描述规则修复本机全局部署方案。

## OpenLogos 0.14.8 plan 门死锁修复安装态 Smoke

### 授权与统一前置

- 仅在 `openlogos verify` PASS、固定 `0.14.8` tarball 隔离矩阵通过、用户已明确授权本机全局部署且部署身份自检通过后执行。
- 执行 `SMOKE-core-172` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.8`。
- 全部断言在一次性临时项目中构造。**不得触碰本仓或用户其它项目的活跃提案、guard 与 marker**，**不得手工创建 `PLAN_APPROVED`**——手工创建正是本缺陷当前的绕法，用它构造前提会使本用例失去意义。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-172 | 0.14.8 plan 门死锁解除与强度不降 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 package/plugin/asset identity；② 在临时目录构造 launched 夹具项目与一个活跃提案，其 `authority_impact.applicability: required` 且含 `change: create` 的 fact，`tests` 引用尚不存在但格式合法的 ID，**不产出任何 test delta**；③ 跑 `next --format json` 读 `proposal_step`；④ 经正常 gate 路径批准，核对 `PLAN_APPROVED` 与 `GATE_AUTO_PASSED` 均由 CLI 写入；⑤ 批准后再跑 `next`，并实际写一份 `deltas/test/*.md`；⑥ 负向：把 `tests` 改为空数组与非法 ID 各跑一次 `next`；⑦ 强度不降：对引用不存在 ID 的提案跑 `change-lint`；⑧ 判据单点：从**安装态入口**核验 `HISTORICAL_MARKERS` 定义处数与 `next.schema.json` 的 `proposalStep` ↔ `REGISTERED_STEPS` 一致性；⑨ 演练 `0.14.7→0.14.8→0.14.7→0.14.8` 并复核每阶段 identity | ③ `proposal_step == "ready-to-delta"`（修复前为 `writing`）；④ 两个 marker/审计行均存在且非手工创建；⑤ 派生为 `delta-writing` 且 test delta 写入成功（此前被 guard 拦下）；⑥ 两种负向均判 `authority_closure_incomplete` 并停在 `writing`，诊断点名具体 fact 与字段；⑦ `change-lint` 的 L10 仍 FAIL 并点名未命中 ID——**证明强度不降**；⑧ `HISTORICAL_MARKERS` 恰 1 处定义、两集合逐项相等（证明单点与锚随包分发、非仅 workspace 成立）；⑨ 往返无混装；全程未触碰临时项目之外的任何文件，无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-172`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须为 `SMOKE-core-172` 写显式 `skip` 记录并携带缺失项，禁止静默零记录退出——沿用既有的不适用留痕契约。
3. evidence 至少包含：tarball 路径/大小/SHA-256、全局入口/realpath/version、临时项目路径（脱敏）、③ 与 ⑤ 两次 `proposal_step` 取值、④ 两个 marker 的存在性与来源、⑥ 两种负向的诊断码与点名字段、⑦ `change-lint` 的 L10 结论、⑧ 单点定义处数与枚举差集（应为空）、⑨ 回滚每阶段 identity。
4. 临时项目在结果持久化后清理；证据中不得包含用户真实项目路径或提案正文。
5. runner 不得执行 `npm publish`、dist-tag、Git tag、GitHub Release、官网部署或 git push；检测到任一远程副作用立即 FAIL。

### OpenLogos Smoke Reporter

- 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-172` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。
- 观察到 runner 手工创建 `PLAN_APPROVED`，直接 FAIL——那会把被测能力换成绕法。
- 观察到步骤 ⑦ 的 `change-lint` 通过（即强校验被削弱），直接 FAIL；**死锁解除与强度不降必须同时成立**，缺一即判失败。
- 缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。

### 失败、自愈与完成边界

- 临时项目失败：保留脱敏诊断，修复后重新 verify/build/pack/install/smoke；不得只重跑失败断言绕过 candidate identity。
- 全局身份或回滚失败：立即尝试恢复固定 `0.14.7` 并报告环境状态；未证明全旧或全新时阻断后续动作。
- 不得为让断言通过而手工写 marker、放宽 spec 阶段校验或改写用户正式文档。

### 追溯

- 需求：AC-PLANGATE-01～11。
- 功能规格：§2.50；架构：§四十一。
- 场景：S05、S35；UT/ST：UT-S05-47～50、ST-S05-22、UT-S35-121～126、ST-S35-22～23。
- 部署方案：OpenLogos 0.14.8 plan 门死锁修复本机全局部署方案。

## OpenLogos 0.14.9 merge 准入单点化安装态 Smoke

### 授权与统一前置

- 仅在 `openlogos verify` PASS、固定 `0.14.9` tarball 隔离矩阵通过、用户已明确授权本机全局部署且部署身份自检通过后执行。
- 执行 `SMOKE-core-173` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.9`。
- 全部断言在一次性临时项目中构造。**不得触碰本仓或用户其它项目的活跃提案、guard 与 marker**，**不得手工创建任何 marker**。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-173 | 0.14.9 merge 准入单点化与误伤边界 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 package/plugin/asset identity；② **合法提案不被误拦**：构造 change-lint PASS 的完整提案，经正常 gate 路径批准后跑 `merge`；③ 准入同源：对同一提案先跑 `change-lint` 再跑 `merge`，比对两者结论；④ 无信号提案也经预检：构造不含 `baseline_closure` 声明、`[delta]` 任务无 `[MODIFY]`/`[CREATE]` 标记、但 authority fact 引用不存在测试 ID 的提案，跑 `merge`；⑤ 阻断可归因：捕获 ④ 的 stderr；⑥ 围栏单点：构造含四反引号示意块的提案，跑 `next` 取 `proposal_step`；⑦ 语法单点：从安装态 dist 入口核验测试 ID 语法定义处数，并对随包规格的全部表格首列 ID 逐个判定；⑧ 门禁可满足性：对每阶段的合法最小提案在安装态跑对应门；⑨ 演练 `0.14.8→0.14.9→0.14.8→0.14.9` 并复核每阶段 identity | ② `merge` 成功并生成事务——**收紧未造成误伤**；③ 两者结论一致，lint 绿则 merge 绿、lint 红则 merge 红；④ 判 `authority_closure_incomplete` 并拒绝（修复前此处完全不经预检、直接放行）；⑤ 逐条含 code/路径/字段/fix_hint 且点名具体实体，无「L1-L9 未全过」这类聚合结论；⑥ 派生为 `ready-to-delta`，示意块未被误算；⑦ 语法恰 1 处定义、全部表格首列 ID 均被接纳（差集为空）；⑧ 每阶段最小提案均通过；⑨ 往返无混装；全程未触碰临时项目之外的任何文件，无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-173`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须为 `SMOKE-core-173` 写显式 `skip` 记录并携带缺失项，禁止静默零记录退出——沿用既有的不适用留痕契约。
3. evidence 至少包含：tarball 路径/大小/SHA-256、全局入口/realpath/version、临时项目路径（脱敏）、② 的 merge 退出码与事务 id、③ 两次结论的比对结果、④ 的诊断码、⑤ 的逐条诊断条数与是否点名、⑥ 的 `proposal_step`、⑦ 的定义处数与未被接纳 ID 差集、⑧ 各阶段结论、⑨ 回滚每阶段 identity。
4. 临时项目在结果持久化后清理；证据中不得包含用户真实项目路径或提案正文。
5. runner 不得执行 `npm publish`、dist-tag、Git tag、GitHub Release、官网部署或 git push；检测到任一远程副作用立即 FAIL。

### OpenLogos Smoke Reporter

- 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-173` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。
- **步骤 ② 失败直接 FAIL**：合法提案被拦下意味着收紧造成了误伤，是本次最需要防的后果，不得以「其余步骤都过」为由记 pass。
- 观察到步骤 ④ 的 `merge` 通过（即准入未收紧），直接 FAIL；**误伤为零与准入收紧必须同时成立**，缺一即判失败。
- 观察到 runner 手工创建任何 marker，直接 FAIL——那会把被测能力换成绕法。
- 缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。

### 失败、自愈与完成边界

- 临时项目失败：保留脱敏诊断，修复后重新 verify/build/pack/install/smoke；不得只重跑失败断言绕过 candidate identity。
- 步骤 ② 失败：立即以固定 `0.14.8` 回滚并报告触发条件——误伤必须在扩散前止住。
- 全局身份或回滚失败：立即尝试恢复固定 `0.14.8` 并报告环境状态；未证明全旧或全新时阻断后续动作。
- 不得为让断言通过而手工写 marker、放宽准入判据或改写用户正式文档。

### 追溯

- 需求：AC-MERGEGATE-01～11。
- 功能规格：§2.51；架构：§四十一.6。
- 场景：S05、S09、S13、S19、S32、S35；UT/ST：UT-S05-51、ST-S05-23、UT-S09-283～286、ST-S09-110、UT-S13-65～66、ST-S13-18、UT-S19-33、ST-S19-19、UT-S32-50～51、ST-S32-17、UT-S35-127～131、ST-S35-24。
- 部署方案：OpenLogos 0.14.9 merge 准入单点化本机全局部署方案。

## OpenLogos 0.14.10 SQL 分层校验安装态 Smoke

### 授权与统一前置

- 仅在 `openlogos verify` PASS、固定 `0.14.10` tarball 隔离矩阵通过、用户已明确授权本机全局部署且部署身份自检通过后执行。
- 执行 `SMOKE-core-174` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.10`。
- 全部断言在一次性临时项目中构造。**不得触碰本仓或用户其它项目的活跃提案、guard 与 marker**，**不得手工创建任何 marker**，**不得连接任何真实数据库实例**。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-174 | 0.14.10 SQL 分层校验与能力缺失降级 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 package/plugin/asset identity；② **解析器随包可加载**：从全局 package root 加载解析器并对已知 PG DDL 求 AST；③ 核验其 package.json 无 postinstall/preinstall 脚本；④ **PG delta 可交付**：临时项目声明 `tech_stack.database: postgresql`，构造结构完整的 `.sql` delta 与配套 Markdown delta，跑 `change-lint` 与 `merge`；⑤ PG 语法错仍被拒：同一项目换成语法错误的 `.sql` 重跑 `change-lint`；⑥ **MySQL 降级而非阻断**：换 `mysql` 方言重跑，取 warnings；⑦ 结构检查不放宽：分别构造缺 `CREATE TABLE` / 主键 / 约束 / 索引 / 迁移回滚语义的 payload，在三种方言下各跑一次；⑧ 不跨方言冒充：核验 PG/MySQL 路径未产生 sqlite 相关诊断；⑨ 演练 `0.14.9→0.14.10→0.14.9→0.14.10` 并复核每阶段 identity 与 ④⑥ 的结论 | ② 加载成功且返回 AST——证明随包分发而非借用 workspace 依赖；③ 无安装脚本；④ `change-lint` L9 通过、整体 PASS，`merge` 正常开启事务——**这是本次最核心的一条，失败即整体 FAIL**；⑤ 判 `non_markdown_delta_invalid` 并含解析器给出的错误位置；⑥ L9 通过且 `warnings` 含降级留痕（点名方言、缺失项、已执行层级），该条不在 violations 中；⑦ 五种缺项在三种方言下全部被拒且点名同一缺项；⑧ 无 sqlite 相关诊断；⑨ 往返无混装且结论不变；全程未触碰临时项目之外的任何文件，未连接数据库，无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-174`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须为 `SMOKE-core-174` 写显式 `skip` 记录并携带缺失项，禁止静默零记录退出——沿用既有的不适用留痕契约。
3. evidence 至少包含：tarball 路径/大小/SHA-256、全局入口/realpath/version、解析器加载结果与 AST 节点计数、安装脚本核查结论、④ 的 `change-lint` 与 `merge` 退出码、⑤ 的诊断码与错误位置、⑥ 的 warning 全文与 violations 计数、⑦ 的 15 组（5 缺项 × 3 方言）结论、⑧ 的核验依据、⑨ 回滚每阶段 identity。
4. 临时项目在结果持久化后清理；证据中不得包含用户真实项目路径或提案正文。
5. runner 不得执行 `npm publish`、dist-tag、Git tag、GitHub Release、官网部署或 git push；不得连接任何数据库实例；检测到任一远程副作用立即 FAIL。

### OpenLogos Smoke Reporter

- 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-174` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。
- **步骤 ④ 失败直接 FAIL**：PG delta 仍不可交付意味着本次修复未真正解除阻断，不得以「其余步骤都过」为由记 pass。
- 观察到步骤 ⑤ 的语法错被放行（即接入的解析器形同虚设），直接 FAIL；**解除阻断与仍拦得住真错误必须同时成立**，缺一即判失败。
- 观察到步骤 ⑦ 有任一缺项被放行，直接 FAIL——降级不得波及结构层。
- 观察到步骤 ② 借用 workspace 依赖而非随包产物，直接 FAIL。
- 缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。

### 失败、自愈与完成边界

- 临时项目失败：保留脱敏诊断，修复后重新 verify/build/pack/install/smoke；不得只重跑失败断言绕过 candidate identity。
- 步骤 ④ 失败：立即以固定 `0.14.9` 回滚并报告触发条件。
- 全局身份或回滚失败：立即尝试恢复固定 `0.14.9` 并报告环境状态；未证明全旧或全新时阻断后续动作。
- 不得为让断言通过而手工写 marker、放宽结构检查、改用其它方言的校验器兜底，或改写用户正式文档。

### 追溯

- 需求：AC-SQLGATE-01～09。
- 功能规格：§2.52；架构：§四十二。
- 场景：S35、S39；UT/ST：UT-S39-59～64、ST-S39-28、UT-S35-132～133、ST-S35-25。
- 部署方案：OpenLogos 0.14.10 SQL 分层校验本机全局部署方案。

## OpenLogos 0.14.11 测试切片事务安装态 Smoke

### 授权与统一前置

- 仅在 `openlogos verify` PASS、固定 `0.14.11` tarball 隔离矩阵通过、用户已明确授权本机全局部署且部署身份自检通过后执行。
- 执行 `SMOKE-core-175` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.11`。
- 全部断言在一次性临时项目中构造。**不得触碰本仓或用户其它项目的活跃提案、guard 与 marker**，**不得手工创建任何 marker**，**不得手工写 `tasks.md` 的 `[code]` 段或 `TEST_SLICE_MANIFEST.json`**——手工写正是本次要消除的旧路径，用它构造前提会使本用例失去意义。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-175 | 0.14.11 测试切片事务全链与原子回滚 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 package/plugin/asset identity；② 命令面随包可用：从全局入口跑 `slice transaction status`，核对 envelope 的 `schema_sha256` / `contract_sha256` 与冻结值；③ **initial-plan 全链**：临时 launched 项目构造 spec-complete 提案，两次 `submit-content` → `seal` → `apply`；④ 核对两产物同时存在、`task_fingerprint` 与实际 `[code]` 段一致、`[delta]`/`[deploy]` 段字节恒等；⑤ **apply 中途失败整体回滚**：注入失败后核对两产物同时不存在、phase=failed；⑥ **manifest-recovery 全链**：构造 manifest 失效态，经 `next` 取恢复事务投影、提交 `slot_slices` 后 apply，核对 `required=1` 且 `[code]` 段字节恒等；⑦ 归档只读：对归档提案尝试五个写动作；⑧ 旧路径不可用：核对安装态下不存在让外部直接写两产物的命令或入口；⑨ 演练 `0.14.10→0.14.11→0.14.10→0.14.11` 并复核每阶段 identity 与 ③⑥ 的结论 | ② 契约哈希逐字一致；③④ apply 后两产物落盘且一致，非 `[code]` 段字节恒等；⑤ **两产物同时不存在，无半写态**——失败即整体 FAIL；⑥ 恢复事务 `required=1`、`[code]` 字节恒等、仅 manifest 被重写；⑦ 五个写动作均被拒且无副作用；⑧ 无可用旧入口；⑨ 往返无混装且结论不变；全程未触碰临时项目之外的任何文件，无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-175`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须写显式 `skip` 记录并携带缺失项，禁止静默零记录退出——沿用既有的不适用留痕契约。
3. evidence 至少包含：tarball 路径/大小/SHA-256、全局入口/realpath/version、`schema_sha256` 与 `contract_sha256` 实测值、③ 各阶段 phase 序列、④ 两产物路径与指纹一致性结论、⑤ 回滚后两产物的存在性、⑥ 恢复事务的 `required` 与 `[code]` 段哈希前后对比、⑦ 五个写动作的拒绝码、⑧ 旧入口核查依据、⑨ 回滚每阶段 identity。
4. 临时项目在结果持久化后清理；证据中不得包含用户真实项目路径或提案正文。
5. runner 不得执行 `npm publish`、dist-tag、Git tag、GitHub Release、官网部署或 git push；检测到任一远程副作用立即 FAIL。

### OpenLogos Smoke Reporter

- 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-175` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。
- **步骤 ⑤ 失败直接 FAIL**：回滚留下半写态意味着原子性未由构造保证，是本次修复的核心目标落空，不得以「其余步骤都过」为由记 pass。
- 观察到步骤 ③ 或 ⑥ 中 runner 手工写 `[code]` 段或 manifest，直接 FAIL——那会把被测能力换成旧路径。
- 观察到步骤 ⑧ 仍存在可用旧入口，直接 FAIL；**写入权归位与原子性保证必须同时成立**，缺一即判失败。
- 缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。

### 失败、自愈与完成边界

- 临时项目失败：保留脱敏诊断，修复后重新 verify/build/pack/install/smoke；不得只重跑失败断言绕过 candidate identity。
- 步骤 ③ 或 ⑤ 失败：立即以固定 `0.14.10` 回滚并报告触发条件——切片流程是本仓自身的关键路径，不得带伤运行。
- 全局身份或回滚失败：立即尝试恢复固定 `0.14.10` 并报告环境状态；未证明全旧或全新时阻断后续动作。
- 不得为让断言通过而手工写产物、放宽 slot 校验或改写用户正式文档。

### 追溯

- 需求：AC-SLICETX-01～12。
- 功能规格：§2.53；架构：§四十三。
- 场景：S09、S13、S19、S28、S32；UT/ST：UT-S32-52～58、ST-S32-18～19、UT-S28-45～46、UT-S09-287～288、UT-S13-67、UT-S19-34。
- 部署方案：OpenLogos 0.14.11 测试切片事务本机全局部署方案。

## OpenLogos 0.14.12 切片事务终态自校验与恢复可达 Smoke


### 授权与统一前置

- 仅在 `openlogos verify` PASS、固定 `0.14.12` tarball 隔离矩阵通过、用户已明确授权本机全局部署且部署身份自检通过后执行。
- 执行 `SMOKE-core-176` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.12`。
- 全部断言在一次性临时项目中构造。**不得触碰本仓或用户其它项目的活跃提案、guard 与 marker**，**不得手工创建任何 marker**，**不得手工写 `tasks.md` 的 `[code]` 段或 `TEST_SLICE_MANIFEST.json`**。
- **不得在任何步骤中删除或改名 `TEST_SLICE_TRANSACTION.json`**——那是本次要消除的人工绕过，用它构造前提会使本用例失去意义（报告 §七）。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-176 | 0.14.12 apply 终态自校验与终态事务不堵恢复 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 package/plugin/asset identity；② **业务非法 slot 全链**：临时 launched 项目构造 spec-complete 提案，提交**结构合法但业务非法**的 slot（`spec_targets` 指向非测试规格文档、`task_text` 与 `[code]` 行不一致）→ `seal` → `apply`；③ 核对 apply 非零退出、两产物同时恢复到 apply 前字节、`phase=failed`、`classification=recovery_required`、violations 保真可定位到字段；④ **修正后重提**：修正两处后重新 `submit-content` → `seal` → `apply`，核对抵达 `completed` 且 manifest 判 `valid`，全程未删除任何 OpenLogos 拥有的文件；⑤ **终态不堵恢复**：走一次健康 apply 抵达 `completed` 后删除 manifest（**保留事务文件**），经 `next` 取投影；⑥ 核对 `origin=manifest-recovery`、`required=1`、`[code]` 段字节恒等，且 detail 不含「（无缺口）」、不对 `allowed_actions=[]` 提示提交内容；⑦ 提交 `slot_slices` → `seal` → `apply`，核对恢复成功且 `[code]` 段仍字节恒等；⑧ `recover` 的拒绝文案不得出现「apply 失败已整体回滚」这一在 apply 成功现场不成立的前提；⑨ 回归既有 `SMOKE-core-175` 的全部断言；⑩ 演练 `0.14.11→0.14.12→0.14.11→0.14.12` 并复核每阶段 identity 与 ②～⑦ 的结论 | ② ③ **apply 必须失败且两产物同时回滚**——若 apply 成功即整体 FAIL，那正是被修复的缺陷；③ violations 含 `code`/`path`/`message`/`fix_hint` 且能指到具体 `spec_targets` 与 `task_text`；④ 修正后可 `completed`、manifest `valid`；⑤⑥ **必须创建出 `origin=manifest-recovery` 事务**——若返回的是 `origin=initial-plan` 的终态事务即整体 FAIL；⑦ 恢复后 `[code]` 字节恒等、仅 manifest 被重写；⑧ 文案不含不成立前提；⑨ 既有断言零回归；⑩ 往返无混装且结论不变；全程未触碰临时项目之外的任何文件，无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-176`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须写显式 `skip` 记录并携带缺失项，禁止静默零记录退出。
3. **全部断言必须穿过公开 `openlogos slice transaction` 命令**。以库级函数调用（`node -e` 直接 import `applyTestSliceTransaction` 等）构造或断言的步骤一律不计入闭环证据（报告 §七）。
4. evidence 至少包含：tarball 路径/大小/SHA-256、全局入口/realpath/version、② 提交内容的业务非法点、③ apply 退出码与两产物回滚前后的哈希、violations 全文、④ 修正后的 phase 序列、⑤⑥ 恢复事务的 `origin`/`required`/detail 原文、⑦ 恢复前后 `[code]` 段哈希、⑧ `recover` 拒绝文案原文、⑨ 既有断言结论、⑩ 回滚每阶段 identity。
5. 临时项目在结果持久化后清理；证据中不得包含用户真实项目路径或提案正文。
6. runner 不得执行 `npm publish`、dist-tag、Git tag、GitHub Release、官网部署或 git push；检测到任一远程副作用立即 FAIL。

### 零回归对照（强制）

同一 runner 必须在固定 `0.14.11` 上执行一次并**记录其失败点**：步骤 ② 的 apply 在 0.14.11 上会成功（缺陷本身），步骤 ⑤ 在 0.14.11 上会返回 `origin=initial-plan` 的终态事务。**若 runner 在 0.14.11 上也全过，说明断言是空转，必须重写用例而非放行部署。**

### OpenLogos Smoke Reporter

- 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-176` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。
- **步骤 ③ 与 ⑤⑥ 是双红线**：前者失败意味着终态自校验未生效，后者失败意味着恢复入口仍被堵死——二者任一失败即整体 FAIL，不得以「其余步骤都过」为由记 pass。
- 观察到 runner 在任何步骤中删除或改名 `TEST_SLICE_TRANSACTION.json`，直接 FAIL。
- 观察到 runner 以库级调用替代公开命令构造关键断言，直接 FAIL。
- 缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。

### 失败、自愈与完成边界

- 临时项目失败：保留脱敏诊断，修复后重新 verify/build/pack/install/smoke；不得只重跑失败断言绕过 candidate identity。
- 步骤 ③ 或 ⑤⑥ 失败：立即以固定 `0.14.11` 回滚并报告触发条件——切片流程是本仓自身与 RunLogos 的关键路径，不得带伤运行。
- 全局身份或回滚失败：立即尝试恢复固定 `0.14.11` 并报告环境状态；未证明全旧或全新时阻断后续动作。
- 不得为让断言通过而手工写产物、放宽 slot 校验、删除事务文件或改写用户正式文档。

### 追溯

- 需求：AC-SLICEFIX-01～12。
- 功能规格：§2.53.5.1、§2.53.6.1、§2.53.6.2；架构：§四十三.2.1。
- 场景：S19、S28、S32；UT/ST：UT-S32-59～60、ST-S32-20、UT-S28-47～48、ST-S28-15、UT-S19-35。
- 部署方案：OpenLogos 0.14.12 切片事务终态自校验本机全局部署方案。

## OpenLogos 0.14.13 并发只读读锁重试 Smoke

### 授权与统一前置

- 仅在 `openlogos verify` PASS、固定 `0.14.13` tarball 隔离矩阵通过、用户已明确授权本机全局部署且部署身份自检通过后执行。
- 执行 `SMOKE-core-177` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.13`。
- 全部断言在一次性临时项目中构造。**不得触碰本仓或用户其它项目的活跃提案、guard 与 marker**，**不得手工创建任何 marker**，**不得手工删除或改写模块锁文件与 journal 来构造前提**（人为持锁必须经受控夹具进程以协议内方式持有）。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-177 | 0.14.13 安装态并发只读全零退出与真冲突如实报错 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 package/plugin/asset identity；② **并发复现路径**：临时 adopted 项目内（无 writer、无未终结 journal）8 路并发执行全局 `openlogos status --format json`，收集全部退出码、错误码与输出投影；③ 核对 8 路全部零退出、无 `baseline_commit_in_progress`、各输出 modules/phase 投影一致、结束后无残留 `<module>.commit.lock`；④ **真冲突对照**：受控夹具进程以协议内方式持有模块锁超过读者预算期间执行 status，核对非零退出且错误码为 `baseline_commit_in_progress`、envelope 合同不变；⑤ 释放后重跑 status，核对恢复零退出；⑥ 回归抽查既有 `SMOKE-core-176` 的关键断言（切片事务终态自校验与恢复可达）；⑦ 演练 `0.14.12→0.14.13→0.14.12→0.14.13` 并复核每阶段 identity 与 ②③ 的结论 | ③ **8 路必须全部零退出**——任一路出现 `baseline_commit_in_progress` 即整体 FAIL，那正是被修复的缺陷；④ 真持锁必须如实报错——若成功返回说明硬门被弱化，整体 FAIL；⑤ 释放后可恢复；⑥ 既有断言零回归；⑦ 往返无混装且结论不变；全程无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-177`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须写显式 `skip` 记录并携带缺失项，禁止静默零记录退出。
3. **并发断言必须由 N 个真实独立 CLI 进程构成**。以单进程库级调用或注入时钟模拟并发的步骤一律不计入闭环证据。
4. evidence 至少包含：tarball 路径/大小/SHA-256、全局入口/realpath/version、② 各路退出码与错误码计数、③ 投影一致性对比结论与锁残留检查、④ 持锁窗口时长与 status 退出码/错误码、⑦ 回滚每阶段 identity。
5. 临时项目在结果持久化后清理；证据中不得包含用户真实项目路径或提案正文。
6. runner 不得执行 `npm publish`、dist-tag、Git tag、GitHub Release、官网部署或 git push；检测到任一远程副作用立即 FAIL。

### 零回归对照（强制）

同一 runner 的步骤 ② 必须在固定 `0.14.12` 上执行一次并**记录其失败点**：8 并发中应有多路以 `baseline_commit_in_progress` 非零退出（缺陷本身，2026-09-03 实测 8 路 7 失败）。**若步骤 ② 在 0.14.12 上也全零退出，说明并发断言是空转（并发度或时序未撞锁），必须重写用例而非放行部署。** 步骤 ④ 在两版本上行为应一致（该硬门语义不变）。

### OpenLogos Smoke Reporter

- 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-177` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。
- **步骤 ③ 与 ④ 是双红线**：前者失败意味着并发假阳性未消除，后者失败意味着真冲突硬门被弱化——二者任一失败即整体 FAIL，不得以「其余步骤都过」为由记 pass。
- 观察到 runner 手工删除锁文件或 journal 构造前提，直接 FAIL。
- 缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。

### 失败、自愈与完成边界

- 临时项目失败：保留脱敏诊断，修复后重新 verify/build/pack/install/smoke；不得只重跑失败断言绕过 candidate identity。
- 步骤 ③ 或 ④ 失败：立即以固定 `0.14.12` 回滚并报告触发条件——status 读取门是本仓与 RunLogos 面板的关键路径，不得带伤运行。
- 全局身份或回滚失败：立即尝试恢复固定 `0.14.12` 并报告环境状态；未证明一致前阻断后续动作。
- 不得为让断言通过而降低并发度、在读者间插入人工间隔、放宽预算或改写错误码合同。

### 追溯

- 需求：AC-READLOCK-01～08。
- 功能规格：§2.54；架构：§四.B。
- 场景：S11、S20、S33；UT/ST：UT-S33-56～60、ST-S33-10、UT-S11-78～79、ST-S11-45、UT-S20-41～42。
- 部署方案：OpenLogos 0.14.13 读锁竞争假阳性修复本机全局部署方案。

## OpenLogos 0.14.14 单切片终态判定 Smoke

### 授权与统一前置

- 仅在 `openlogos verify` PASS、固定 `0.14.14` tarball 隔离矩阵通过、用户已明确授权本机全局部署且部署身份自检通过后执行。
- 执行 `SMOKE-core-178` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.14`。
- 全部断言在一次性临时项目中构造。**不得触碰本仓或用户其它项目的活跃提案、guard 与 marker**，**不得手工创建任何 marker**，**不得手工写 `tasks.md` 的 `[code]` 段或 `TEST_SLICE_MANIFEST.json`**，**不得删除或改名 `TEST_SLICE_TRANSACTION.json` 构造前提**。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-178 | 0.14.14 单切片计划经事务写出 [code] 且三分支守门如实 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 package/plugin/asset identity；② **单切片全链**：临时 launched 项目构造 spec-complete 提案，提交**单切片** slot 内容（一条标注真实测试 ID 的切片）→ `seal` → `apply`；③ 核对 `phase=completed`、receipt 出具、`tasks.md` 的 `[code]` 段正确写出且 `[delta]`/`[deploy]` 字节恒等、manifest 落盘、全程输出不含 `unknown`；④ **多切片零回归**：另一临时提案两切片健康全链达 `completed`；再以业务非法 slot（`spec_targets` 指向非测试规格文档）重放 apply，核对整体回滚、`phase=failed`、violations 保真（含 `code`/`path`/`message`/`fix_hint`）且违规数非零；⑤ **终态不堵恢复回归（多切片形态）**：多切片健康提案 completed 后删除 manifest（保留事务文件），核对仍可创建 `origin=manifest-recovery` 事务、`required=1`、恢复后 `[code]` 字节恒等——单切片下判定器按设计不适用（derive 恒 `null`）、manifest 惰性，删除后**不产生恢复事务**属正确形态，不作恢复断言；⑥ 演练 `0.14.13→0.14.14→0.14.13→0.14.14` 并复核每阶段 identity 与 ②③ 的结论 | ③ **单切片 apply 必须 completed**——若整体回滚且报「判为 unknown……0 条违规」即整体 FAIL，那正是被修复的缺陷；④ 业务非法 slot 必须仍被拦下（守门未被放宽过头），违规数非零；⑤ 恢复能力零回退；⑥ 往返无混装且结论不变；全程无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-178`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须写显式 `skip` 记录并携带缺失项，禁止静默零记录退出。
3. **全部关键断言必须穿过公开 `openlogos slice transaction` 命令**。以库级函数调用构造或断言的步骤一律不计入闭环证据。
4. evidence 至少包含：tarball 路径/大小/SHA-256、全局入口/realpath/version、② 单切片 slot 内容摘要与 apply 的 phase 序列、③ `[code]` 段写出结论与 manifest 存在性、④ 健康与业务非法两路的结论及 violations 全文、⑤ 恢复事务的 `origin`/`required` 与 `[code]` 段哈希对照、⑥ 回滚每阶段 identity。
5. 临时项目在结果持久化后清理；证据中不得包含用户真实项目路径或提案正文。
6. runner 不得执行 `npm publish`、dist-tag、Git tag、GitHub Release、官网部署或 git push；检测到任一远程副作用立即 FAIL。

### 零回归对照（强制）

同一 runner 的步骤 ② 必须在固定 `0.14.13` 上执行一次并**记录其失败点**：单切片 apply 在 0.14.13 上会整体回滚并报「判为 unknown，已整体回滚：0 条违规」（缺陷本身）。**若步骤 ② 在 0.14.13 上也达 completed，说明断言是空转，必须重写用例而非放行部署。** 步骤 ④ 在两版本上行为应一致（业务非法拦截语义不变）。

### OpenLogos Smoke Reporter

- 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-178` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。
- **步骤 ③ 与 ④ 是双红线**：前者失败意味着单切片仍被守门误拒，后者失败意味着放宽越界（业务非法产物获得成功终态）——二者任一失败即整体 FAIL，不得以「其余步骤都过」为由记 pass。
- 观察到 runner 手工写产物、删除事务文件或以库级调用替代公开命令构造关键断言，直接 FAIL。
- 缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。

### 失败、自愈与完成边界

- 临时项目失败：保留脱敏诊断，修复后重新 verify/build/pack/install/smoke；不得只重跑失败断言绕过 candidate identity。
- 步骤 ③ 或 ④ 失败：立即以固定 `0.14.13` 回滚并报告触发条件——切片事务是本仓自身与 RunLogos 的关键路径，不得带伤运行。
- 全局身份或回滚失败：立即尝试恢复固定 `0.14.13` 并报告环境状态；未证明一致前阻断后续动作。
- 不得为让断言通过而放宽业务非法拦截、跳过自校验、手工写产物或删除事务文件。

### 追溯

- 需求：AC-VERDICT-01～07。
- 功能规格：§2.55；架构：§四十三.2.1；根规范：`spec/test-slice-manifest.md` §2.2.1。
- 场景：S19、S32；UT/ST：UT-S32-61～64、ST-S32-21、UT-S19-36。
- 部署方案：OpenLogos 0.14.14 单切片终态判定修复本机全局部署方案；回归：SMOKE-core-176。

## OpenLogos 0.14.15 切片重划 Smoke

### 授权与统一前置

- 仅在 `openlogos verify` PASS、固定 `0.14.15` tarball 隔离矩阵通过、用户已明确授权本机全局部署且部署身份自检通过后执行。
- 执行 `SMOKE-core-179` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.15`。
- 全部断言在一次性临时项目中构造。**不得触碰本仓或用户其它项目的活跃提案、guard 与 marker**，**不得手工创建任何 marker**（含 `SLICES_APPROVED`——已批准分支由 UT-S32-65 进程内覆盖），**不得手工写 `[code]` 段或 manifest**，**不得删除或改名 `TEST_SLICE_TRANSACTION.json`**。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-179 | 0.14.15 已完成规划经受控重开完成重划 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 package/plugin/asset identity；② **首次规划**：临时 launched 项目构造 spec-complete 提案，提交单切片划分 → seal → apply 达 `completed`，记录 manifest sha 与旧 `transaction_id`；③ **重开**：`slice transaction reopen --reason "<原因>"`，核对进入 `collecting`（`origin=initial-plan`、`required=2`）、`SLICE_REPLANS.jsonl` 留痕含旧 `transaction_id` 与非空原因、旧事务归档于 `slice-transactions/`、`[code]`/manifest 仍为旧划分（无半新半旧）；④ **重划**：提交**两切片**新划分 → seal → apply → `completed`，核对 `[code]` 与 manifest 完全为新划分、无旧残留、manifest sha 已变化；⑤ **零回归**：另一临时提案 completed 后不执行 reopen，核对 submit-content/abort 仍被拒、行为与 0.14.14 一致；单切片 apply（0.14.14 能力）与业务非法拦截（0.14.12 能力）不回退；⑥ 演练 `0.14.14→0.14.15→0.14.14→0.14.15` 并复核每阶段 identity 与 ③④ 的结论 | ③ **reopen 必须成功进入 collecting 且留痕/归档齐备**——被拒即缺口未修；④ **新划分必须整体替换**——出现旧划分残留或半新半旧即整体 FAIL；⑤ 未重开的 completed 行为逐项一致（reopen 为唯一新增动作）；⑥ 往返无混装且结论不变；全程无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-179`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须写显式 `skip` 记录并携带缺失项，禁止静默零记录退出。
3. **全部关键断言必须穿过公开 `openlogos slice transaction` 命令**。以库级函数调用构造或断言的步骤一律不计入闭环证据。
4. evidence 至少包含：tarball 路径/大小/SHA-256、全局入口/realpath/version、② 旧 `transaction_id` 与旧 manifest sha、③ 留痕行原文与归档文件存在性、④ 新旧划分对照结论与新 manifest sha、⑤ 零回归各断言结论、⑥ 回滚每阶段 identity。
5. 临时项目在结果持久化后清理；证据中不得包含用户真实项目路径或提案正文。
6. runner 不得执行 `npm publish`、dist-tag、Git tag、GitHub Release、官网部署或 git push；检测到任一远程副作用立即 FAIL。

### 零回归对照（强制）

同一 runner 的步骤 ③ 必须在固定 `0.14.14` 上执行一次并**记录其失败点**：`reopen` 在 0.14.14 上必须被拒（动作不可用），且 completed 后 `submit-content`/`abort` 被拒的锁死现场复现（缺口本身）。**若步骤 ③ 在 0.14.14 上也能重开，说明断言是空转，必须重写用例而非放行部署。** 步骤 ⑤ 在两版本上行为应一致。

### OpenLogos Smoke Reporter

- 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-179` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。
- **步骤 ③ 与 ④ 是双红线**：前者失败意味着重划出口仍不存在，后者失败意味着替换不完整（半新半旧比无法重划更坏）——任一失败即整体 FAIL。
- 观察到 runner 手工写产物、手工创建 marker、删除事务文件或以库级调用替代公开命令构造关键断言，直接 FAIL。
- 缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。

### 失败、自愈与完成边界

- 临时项目失败：保留脱敏诊断，修复后重新 verify/build/pack/install/smoke；不得只重跑失败断言绕过 candidate identity。
- 步骤 ③ 或 ④ 失败：立即以固定 `0.14.14` 回滚并报告触发条件——切片事务是本仓自身与 RunLogos 的关键路径，不得带伤运行。
- 全局身份或回滚失败：立即尝试恢复固定 `0.14.14` 并报告环境状态；未证明一致前阻断后续动作。
- 不得为让断言通过而放宽准入、跳过留痕、手工写产物或删除事务文件。

### 追溯

- 需求：AC-REPLAN-01～10。
- 功能规格：§2.56；架构：§四十四；根规范：`spec/test-slice-manifest.md` §2.4。
- 场景：S19、S28、S32；UT/ST：UT-S32-65～68、ST-S32-22、UT-S28-49、UT-S19-37。
- 部署方案：OpenLogos 0.14.15 切片重划本机全局部署方案；回归：SMOKE-core-176、SMOKE-core-178。

## OpenLogos 0.14.16 勘误散文订正通道 Smoke

### 授权与统一前置

- 仅在 `openlogos verify` PASS、固定 `0.14.16` tarball 隔离矩阵通过、用户已明确授权本机全局部署且部署身份自检通过后执行。
- 执行 `SMOKE-core-180` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.16`。
- 全部断言在一次性临时项目中构造。**不得触碰本仓或用户其它项目的活跃提案、guard 与 marker**，**不得手工创建任何 marker**，**不得手工改写夹具提案的 lint/merge 结论**。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-180 | 0.14.16 docs-only 勘误可携带 deployment/smoke 散文订正且判据 fail-closed | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 package/plugin/asset identity；② **放行正例**：临时 launched 项目构造 docs-only 勘误提案（`deployment_required=false`），deployment/smoke 各一份散文订正 delta（仅 MODIFIED 块、目标结构化 ID 集合合并前后完全相等），运行 `openlogos change-lint --format json`，核对 exit 0、`pass=true`、无 deployment/smoke disposition violation；③ **fail-closed 反例**：同夹具违例变体逐一重放——ID 增删、含 ADDED 块（新增版本节）、target mode=CREATE、无需部署提案携带 `[deploy]` section——核对逐一 exit 2 且 violation 含 `code`/`path`/`message`/`fix_hint` 精确归因；④ **既有路径零回归**：`deployment_required=true` 夹具的 deployment/smoke 实质变更 delta 照常放行；deployment/smoke 均 SKIP 的既有合法夹具照常通过；⑤ 演练 `0.14.15→0.14.16→0.14.15→0.14.16` 并复核每阶段 identity 与 ②③ 的结论 | ② **正例必须放行**——被拒即缺口未修；③ **反例必须逐一被拒**——任一放行即放宽越界（实质变更混入无部署提案），整体 FAIL；④ 既有判定两形态零变化；⑤ 往返无混装且结论不变；全程无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-180`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须写显式 `skip` 记录并携带缺失项，禁止静默零记录退出。
3. **全部关键断言必须穿过公开 `openlogos change-lint` / `openlogos merge` 命令**。以库级函数调用构造或断言的步骤一律不计入闭环证据。
4. evidence 至少包含：tarball 路径/大小/SHA-256、全局入口/realpath/version、② 正例夹具的 delta 形态摘要与 lint 结论、③ 每个违例变体的 violation 全文、④ 零回归各断言结论、⑤ 回滚每阶段 identity。
5. 临时项目在结果持久化后清理；证据中不得包含用户真实项目路径或提案正文。
6. runner 不得执行 `npm publish`、dist-tag、Git tag、GitHub Release、官网部署或 git push；检测到任一远程副作用立即 FAIL。

### 零回归对照（强制）

同一 runner 的步骤 ② 必须在固定 `0.14.15` 上执行一次并**记录其失败点**：docs-only 勘误的 deployment/smoke delta 在 0.14.15 上会被 disposition 检查拒绝（缺口本身）。**若步骤 ② 在 0.14.15 上也放行，说明断言是空转，必须重写用例而非放行部署。** 步骤 ③④ 在两版本上行为应一致（拒绝与放行语义不变）。

### OpenLogos Smoke Reporter

- 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-180` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。
- **步骤 ② 与 ③ 是双红线**：前者失败意味着勘误通道仍不存在，后者失败意味着放宽越界——任一失败即整体 FAIL，不得以「其余步骤都过」为由记 pass。
- 观察到 runner 手工改写夹具结论、跳过违例变体或以库级调用替代公开命令构造关键断言，直接 FAIL。
- 缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。

### 失败、自愈与完成边界

- 临时项目失败：保留脱敏诊断，修复后重新 verify/build/pack/install/smoke；不得只重跑失败断言绕过 candidate identity。
- 步骤 ② 或 ③ 失败：立即以固定 `0.14.15` 回滚并报告触发条件——闭包门是本仓自身与 RunLogos 的关键路径，不得带伤运行。
- 全局身份或回滚失败：立即尝试恢复固定 `0.14.15` 并报告环境状态；未证明一致前阻断后续动作。
- 不得为让断言通过而放宽判据、跳过守恒点数或伪造 violation 结论。

### 追溯

- 需求：AC-ERRATA-01～05。
- 功能规格：§2.57；根规范：`spec/baseline-closure.md` §7；场景：S19、S39 勘误散文订正通道（EX-ERRATA-1/2）。
- UT/ST：UT-S39-65～67、ST-S39-29。
- 部署方案：OpenLogos 0.14.16 勘误散文订正通道本机全局部署方案；回归：SMOKE-core-176、SMOKE-core-178、SMOKE-core-179。

## OpenLogos 0.14.17 合并事务终态出路 Smoke

### 授权与统一前置

- 仅在 `openlogos verify` PASS、固定 `0.14.17` tarball 隔离矩阵通过、用户已明确授权本机全局部署且部署身份自检通过后执行。
- 执行 `SMOKE-core-181` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.17`。
- 全部断言在一次性临时项目中构造。**不得触碰本仓或用户其它项目的活跃提案、guard 与 marker**，**不得手工删除或改名 `MERGE_TRANSACTION.json`**，**不得手工创建、作废或改写 `SPEC_MERGED` 与 `MERGE_REOPENS.jsonl`**。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-181 | 0.14.17 合并事务终态出路（abort 重建 / completed 重开）且判据 fail-closed | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 package/plugin/asset identity；② **abort 重建**：临时 launched 项目构造可合并提案 → `openlogos merge` → `merge transaction abort` → 修正 delta → 重跑 merge，核对旧事务归档至 `merge-transactions/`、新事务新 transaction_id/新 target 集合 → 全链 submit-content → seal → apply 达 completed；③ **completed 重开全链**：另一临时提案 completed（`SPEC_MERGED` 在场）→ `reopen --reason "<原因>" --confirm-spec-merged`，核对 `MERGE_REOPENS.jsonl` 留痕（旧 transaction_id、非空原因、confirmed）、旧事务归档、`SPEC_MERGED` 作废 → 修正 delta 重合并全链 → `SPEC_MERGED` 与 receipt 重写、下游产物零删除；④ **fail-closed 反例**：空 `--reason`、未附确认、非 completed 执行 reopen、completed+`SPEC_MERGED` 完好直接重跑 merge——逐一被拒且零副作用；⑤ **既有能力零回归**：非终态幂等返回、0.14.2 preflight-reopen、`recovery_required → recover` 与 abort 既有拒绝面逐项一致；⑥ 演练 `0.14.16→0.14.17→0.14.16→0.14.17` 并复核每阶段 identity 与 ②③ 的结论 | ② **abort 后必须能重建**——重跑 merge 仍返回 aborted 投影即整体 FAIL（死锁面①）；③ **重开全链必须齐备**——留痕/归档/作废/重写任一缺失即 FAIL（缺口①）；④ 反例必须逐一被拒（放宽越界即 FAIL）；⑤ 既有行为逐项一致；⑥ 往返无混装且结论不变；全程无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-181`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须写显式 `skip` 记录并携带缺失项，禁止静默零记录退出。
3. **全部关键断言必须穿过公开 `openlogos merge` / `openlogos merge transaction` 命令**。以库级函数调用构造或断言的步骤一律不计入闭环证据。
4. evidence 至少包含：tarball 路径/大小/SHA-256、全局入口/realpath/version、② 旧/新 transaction_id 与归档文件存在性、③ 留痕行原文、`SPEC_MERGED` 作废与重写前后对照、④ 每个反例的拒绝结论、⑤ 零回归各断言结论、⑥ 回滚每阶段 identity。
5. 临时项目在结果持久化后清理；证据中不得包含用户真实项目路径或提案正文。
6. runner 不得执行 `npm publish`、dist-tag、Git tag、GitHub Release、官网部署或 git push；检测到任一远程副作用立即 FAIL。

### 零回归对照（强制）

同一 runner 的步骤 ②③ 必须在固定 `0.14.16` 上执行一次并**记录其失败点**：② abort 后重跑 merge 在 0.14.16 上会原样返回 aborted 投影、无法重建（死锁面①本身）；③ `reopen` 在 0.14.16 上动作不可用（缺口①本身）。**若 ②③ 在 0.14.16 上也能重建或重开，说明断言是空转，必须重写用例而非放行部署。** 步骤 ④⑤ 在两版本上行为应一致。

### OpenLogos Smoke Reporter

- 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-181` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。
- **步骤 ② 与 ③ 是双红线**：前者失败意味着 abort 死锁未解，后者失败意味着二次 merge 通道仍不存在——任一失败即整体 FAIL，不得以「其余步骤都过」为由记 pass。
- 观察到 runner 手工删事务文件、手工写 marker/留痕或以库级调用替代公开命令构造关键断言，直接 FAIL。
- 缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。

### 失败、自愈与完成边界

- 临时项目失败：保留脱敏诊断，修复后重新 verify/build/pack/install/smoke；不得只重跑失败断言绕过 candidate identity。
- 步骤 ② 或 ③ 失败：立即以固定 `0.14.16` 回滚并报告触发条件——合并事务是本仓自身与 RunLogos 的关键路径，不得带伤运行。
- 全局身份或回滚失败：立即尝试恢复固定 `0.14.16` 并报告环境状态；未证明一致前阻断后续动作。
- 不得为让断言通过而放宽准入、跳过留痕/归档或伪造 marker 状态。

### 追溯

- 需求：AC-MTXOUT-01～07。
- 功能规格：§2.58；架构：§三十四、§四十五；根规范：`spec/change-management.md`、`spec/cli-json-output.md` 终态出路修订。
- 场景：S09、S19；UT/ST：UT-S09-289～292、ST-S09-111。
- 部署方案：OpenLogos 0.14.17 合并事务终态出路本机全局部署方案；回归：SMOKE-core-176、SMOKE-core-178、SMOKE-core-179、SMOKE-core-180。

## OpenLogos 0.14.18 Cursor 三件套补齐 Smoke

### 授权与统一前置

- 执行 `SMOKE-core-182`～`SMOKE-core-189` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.18`。
- 本机具备真实 cursor-agent CLI（记录绝对路径与版本）；全部断言在一次性临时项目与隔离 `.cursor` 根中构造，不触碰本仓或用户其它项目的活跃提案、guard、marker 与真实 Cursor 配置。
- 宿主交互断言必须穿过真实 cursor-agent 新 session；以 mock 或直接调用 runtime 冒充宿主的步骤不计入闭环证据。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-182 | candidate identity 与随包 cursor 资产 | 核对固定 tarball SHA、全局 entry/realpath/version；解包核对 cursor-plugin-template 全部声明资产与 `spec/cursor-plugin.md` 在包内 | version 精确 0.14.18、无 workspace link；任一声明资产缺失即 FAIL |
| SMOKE-core-183 | `init --ai-tool cursor` 三件套落盘 | 临时项目 init；核对 `.cursor/skills/`（含 commands 形式）、subagent、hooks 托管三条目、guard 部分强度提示行；另验证 `all` 稳定展开含 cursor | 逐资产读回成功且提示行在场；`all` 顺序稳定 |
| SMOKE-core-184 | 存量 adopt 与托管 .mdc 迁移 | 预置「历史托管 .mdc + 用户自有 rules + 用户 hooks 条目」fixture → `adopt --ai-tool cursor` | 三件套就位、托管 .mdc 清空、用户 rules 与 hooks 条目字节不变并逐项 preserved |
| SMOKE-core-185 | 真实宿主 Skills 与显式命令发现 | 新 cursor-agent session 列出/触发 OpenLogos Skill 与 `/<command>` 显式命令 | 真实宿主可发现并触达；发现失败即 FAIL |
| SMOKE-core-186 | sessionStart 实测与事件覆盖面 | 新 session 核对阶段上下文注入内容与磁盘状态一致；实测记录本机 cursor-agent 的 hook 事件覆盖面清单 | 注入内容与磁盘一致；覆盖面清单写入部署报告；sessionStart 不触发即 FAIL |
| SMOKE-core-187 | 部分强度门禁实测 | delta-writing 下：允许写入放行；越界 shell 写入观察 deny 与完整原因；真实宿主执行越界原生编辑观察事后检测报告与文件实态 | shell deny 原因四要素齐备；编辑报告如实声明未阻断且文件确已修改；任一伪装成阻断即 FAIL |
| SMOKE-core-188 | hooks.json 合并保真与幂等 | 用户条目 fixture 上 init/sync 前后比对字节；注入损坏 hooks.json 验证 fail loud 零写入；连续两次 sync | 用户条目零漂移；损坏时零写入且报告精确路径；第二次 sync unchanged 收敛 |
| SMOKE-core-189 | 既有宿主零回归与回滚往返 | 六既有宿主最小回归矩阵；演练 `0.14.17→0.14.18→0.14.17→0.14.18` 并复核每阶段 identity 与 183/184 结论 | 既有宿主行为两版本一致；往返无混装且结论不变 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-182`～`SMOKE-core-189`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选/回滚 tarball、cursor-agent 不可执行）必须写显式 `skip` 记录并携带缺失项，禁止静默零记录退出。
3. 宿主交互步骤保存 cursor-agent 版本、session 证据、hook stdin/stdout/exit code 与目标文件 SHA-256。
4. 用例向 `logos/resources/verify/smoke-results.jsonl` 逐条写结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。

### 零回归对照（强制）

`SMOKE-core-183`/`SMOKE-core-184` 的对应操作必须在固定 `0.14.17` 上执行一次并记录：init 只产 `.mdc` 降级档、迁移不存在。若 0.14.17 上也出现三件套，矩阵空转，FAIL。

### OpenLogos Smoke Reporter

- 每条用例唯一一条结果记录；失败不得写 pass；缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。

### 失败、自愈与完成边界

- `SMOKE-core-185`～`SMOKE-core-187` 是真实宿主红线：任一失败说明能力假设失效或接线错误，停止并回实现/提案层修订，不得放宽断言。
- 观察到 runner 绕过真实宿主、虚标 capability 或手工伪造覆盖面记录，直接 FAIL。
- 全程无 `npm publish`/tag/release/官网/git push 副作用。

### 追溯

- 部署方案：OpenLogos 0.14.18 Cursor 三件套补齐本机全局部署方案。
- 需求：Cursor 完整宿主集成需求「部署与非目标」。

## OpenLogos 0.14.19 merge 流程契约自洽 Smoke

### 授权与统一前置

- 执行 `SMOKE-core-190` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.19`。
- 全部断言在一次性临时项目中构造；**不得触碰本仓或用户其它项目的活跃提案、guard 与事务文件**，**不得手工创建 / 删除 / 改写 `MERGE_TRANSACTION.json`、MERGE_PROMPT marker 与 `SPEC_MERGED`**（越权路径仅在专用反例中以隔离副本演示）。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-190 | 0.14.19 merge 前沿事务事实全链（含跨组件验收）且旧死区在 0.14.18 复现 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 asset identity；② **跨组件全链**：临时 launched 项目构造有 delta 提案 → `openlogos merge` 开事务 → `status`/`next` 断言 `proposal_step=merge-generated`、`next_node=apply-merge`、`data.merge_transaction` 必挂且与 `merge transaction status` 同快照一致 → submit-content ×N → seal → apply → `SPEC_MERGED` 在场 → `status`/`next` 前沿越过 merge 段；③ **后置条件二分**：no-delta 提案 merge 当场 `SPEC_MERGED` 前沿即进；有 delta 收尾提示为事务引导且无「MERGE_PROMPT.md」字样；④ **幂等与终态协同**：非终态重跑 merge 幂等返回、前沿不回退；abort 后重跑归档让位重建、前沿仍 merge-generated；⑤ **错误码验收**：存量失配事务隔离 fixture → 稳定码 + 双方摘要 + remediation；status/next 既有失败路径抽样断言结构化 `error.code`；⑥ **零回归对照**：固定 `0.14.18` 上重放步骤②首段——merge 开事务后 `proposal_step` 必须仍停 `ready-to-merge`、`next_node` 停 `generate-merge-prompt`（死区复现，防断言空转）；⑦ 演练 `0.14.18→0.14.19→0.14.18→0.14.19` 并复核每阶段 identity 与 ②⑥ 结论 | ② 全链每步前沿与磁盘事实一致，任一步滞留即 FAIL（死区未除）；③ 二分成立且提示无旧文案；④ 幂等 / 重建后前沿正确；⑤ 稳定码齐备、无纯文本退化；⑥ **0.14.18 必须复现死区**——旧版也推进则矩阵空转判 FAIL；⑦ 往返无混装且结论不变；全程无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-190`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须写显式 `skip` 记录并携带缺失项，禁止静默零记录退出。
3. **全部关键断言必须穿过公开 `openlogos merge` / `merge transaction` / `status` / `next` 命令**；库级函数调用构造或断言的步骤不计入闭环证据。
4. 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-190` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。

### 零回归对照（强制）

步骤⑥是本用例的空转防线：固定 `0.14.18` 上 merge 开事务后前沿**必须**仍死区；否则矩阵空转，必须重写矩阵而非放行部署。

### OpenLogos Smoke Reporter

- 失败不得写 pass；缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。

### 失败、自愈与完成边界

- 步骤②是红线：任一步前沿滞留说明判据未同源或 done_when 未生效，停止并回实现，不得放宽断言。
- 观察到 runner 手工写事务文件 / marker 或以库级调用替代公开命令构造关键断言，直接 FAIL。

### 追溯

- 部署方案：OpenLogos 0.14.19 merge 流程契约自洽本机全局部署方案。
- 需求：merge 流程契约自洽需求「部署与非目标」；跨仓验收对齐 RunLogos 提案 `fix-driver-merge-transaction-contract-alignment`。

## OpenLogos 0.14.20 reopen 前滚修复 Smoke

### 授权与统一前置

- 执行 `SMOKE-core-191` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.20`。
- 全部断言在一次性临时项目中构造；**不得触碰本仓或用户其它项目的活跃提案、guard 与事务文件**，**不得手工创建 / 删除 / 改写 `SPEC_MERGED`、`MERGE_REOPENS.jsonl` 与归档 receipt**（失配反例仅在隔离副本中篡改演示）。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-191 | 0.14.20 reopen 后 change set 前滚全链且空 change set 缺陷在 0.14.19 复现 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 asset identity；② **前滚全链**：临时 launched 项目首次 merge 全链 completed，断言 `SPEC_MERGED.test_change_set.changed_test_ids` 含全部新增 ID → `merge transaction reopen --reason ... --confirm-spec-merged` → 仅修正一个非测试目标、其余 delta 幂等 → 重跑 merge→submit→seal→apply → 断言 changed 仍含首轮全部 ID 且 sha256 合法；③ **removed 后写胜出**：追加一轮 reopen 删除一个首轮 ID → 重合并后该 ID 在 removed、不在 changed；④ **失配 fail-closed**：隔离副本篡改归档 receipt 身份 → seal 稳定拒绝并点名路径；⑤ **无留痕零回归**：未 reopen 的对照提案 change set 与 0.14.19 逐字节等价；⑥ **零回归对照**：固定 `0.14.19` 上重放步骤② → `changed_test_ids` 必须为空或缺失首轮 ID（缺陷复现，防断言空转）；⑦ 演练 `0.14.19→0.14.20→0.14.19→0.14.20` 并复核每阶段 identity 与 ②⑥ 结论 | ② changed 提案级完整，任一首轮 ID 丢失即 FAIL；③ removed 语义正确；④ 稳定拒绝、无静默降级；⑤ 逐字节等价；⑥ **0.14.19 必须复现空 change set**——旧版也完整则矩阵空转判 FAIL；⑦ 往返无混装且结论不变；全程无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-191`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须写显式 `skip` 记录并携带缺失项，禁止静默零记录退出。
3. **全部关键断言必须穿过公开 `openlogos merge` / `merge transaction` 命令与 `SPEC_MERGED` 磁盘事实**；库级函数调用构造或断言的步骤不计入闭环证据。
4. 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-191` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。

### 零回归对照（强制）

步骤⑥是本用例的空转防线：固定 `0.14.19` 上 reopen 后部分幂等重合并的 change set **必须**为空或缺失首轮 ID；否则矩阵空转，必须重写矩阵而非放行部署。

### OpenLogos Smoke Reporter

- 失败不得写 pass；缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。

## OpenLogos 0.14.21 guard 修复发布 Smoke

### 授权与统一前置

- 执行 `SMOKE-core-192` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.21`。
- 全部断言在一次性临时项目中构造；**不得触碰本仓或用户其它项目的活跃提案、guard 与 settings.json**（存量项目补齐实测使用临时构造项目，不动真实 runlogos）。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-192 | 0.14.21 guard 修复全链且 fail-open/资产缺失在 0.14.20 复现 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 asset identity（含随包 guard-check 新字节与 manifest 条目）；② **guard 全链**：隔离 prefix `openlogos init --ai-tool claude-code` 新项目 → settings.json 两 hook 均 `$CLAUDE_PROJECT_DIR` 形态 → 置 launched 无提案，以子目录 cwd + CLAUDE_PROJECT_DIR 驱动 guard-check：Edit 源码拦截（exit 2 + reason）、写 guard 文件后同一调用放行；③ **fail-closed**：变量缺失且 cwd 为子目录 → exit 2 + 诊断；变量指向坏目录 → exit 2；④ **存量项目 sync 补齐**：构造无 guard-check、settings 仅旧相对 SessionStart 的项目 → `openlogos sync` → bin 与随包同字节、PreToolUse 补齐新形态、旧条目迁移；重复 sync settings 字节零变化；⑤ **0.14.20 对照**：固定 0.14.20 上重放②的子目录 cwd 无提案 Edit → **必须静默放行 exit 0**（fail-open 复现），重放④ → guard-check 必须不落盘（资产缺失复现）；⑥ 演练 `0.14.20→0.14.21→0.14.20→0.14.21` 并复核每阶段 identity 与②⑤结论 | ② 拦截/放行行为与规格一致，reason 结构完整；③ 两形态均 exit 2 无静默放行；④ 补齐齐备且幂等；⑤ **0.14.20 必须复现 fail-open 与资产缺失**——旧版也拦/也补则矩阵空转判 FAIL；⑥ 往返无混装且结论不变；全程无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-192`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须写显式 `skip` 记录并携带缺失项，禁止静默零记录退出。
3. **guard 行为断言必须以 stdin JSON + env + cwd 驱动真实随包 guard-check 脚本、sync 断言必须穿过公开 `openlogos init`/`openlogos sync` 命令**；库级函数直调不计入闭环证据。
4. 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-192` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。

### 零回归对照（强制）

步骤⑤是本用例的空转防线：固定 `0.14.20` 上子目录 cwd 场景**必须**静默放行、存量 sync **必须**不补齐；否则矩阵空转，必须重写矩阵而非放行部署。

### OpenLogos Smoke Reporter

- 失败不得写 pass；缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。

## OpenLogos 0.14.22 guard 修复发布 Smoke

### 授权与统一前置

- 执行 `SMOKE-core-193` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.22`。
- 全部断言在一次性临时项目与临时 HOME 中构造；**不得触碰本仓或用户其它项目的活跃提案、guard、settings.json 与真实 `~/.claude` 目录**（项目外路径断言使用临时 HOME 下构造的 `~/.claude` 形态路径，不动真实 runlogos）。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-193 | 0.14.22 guard 两处修复全链且误拦截/无 stderr 在 0.14.21 复现 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 asset identity（含随包 guard-check 新字节与 manifest 条目）；② **管辖边界**：隔离 prefix init 新项目 → 置 launched 无提案，以 stdin JSON + env 驱动随包 guard-check：Edit 项目根之外目标（临时 HOME 下 `~/.claude/projects/x/memory/a.md` 形态路径、另一临时仓库绝对路径）→ exit 0 放行；③ **阻断 stderr 可见性**：同项目 Edit 项目内源码 → exit 2 且 stderr 含「变更管理拦截」与 `openlogos change` 指引、stdout `{"reason":…}` JSON 结构不变；Step 0 fail-closed 两形态（变量指向坏目录 / 变量缺失且 cwd 非根）→ exit 2 且 stderr 非空；④ **项目内零回归**：白名单路径放行、写 guard 文件后同一调用放行、`git push` 安全白名单放行；⑤ **0.14.21 对照**：固定 0.14.21 上重放② → **必须 exit 2 误拦截**（缺陷①复现），重放③ → exit 2 但 **stderr 必须为空**（缺陷②复现）；⑥ 演练 `0.14.21→0.14.22→0.14.21→0.14.22` 并复核每阶段 identity 与②③⑤结论 | ② 项目外一律放行；③ 拦截双通道齐备且 stdout JSON 可解析、与 stderr 文本语义一致；④ 逐项与 0.14.21 一致；⑤ **0.14.21 必须复现误拦截与空 stderr**——旧版也放行/也有 stderr 则矩阵空转判 FAIL；⑥ 往返无混装且结论不变；全程无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-193`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须写显式 `skip` 记录并携带缺失项，禁止静默零记录退出。
3. **guard 行为断言必须以 stdin JSON + env + cwd 驱动真实随包 guard-check 脚本，并同时捕获 stdout 与 stderr 两通道**；库级函数直调不计入闭环证据。
4. 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-193` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。

### 零回归对照（强制）

步骤⑤是本用例的空转防线：固定 `0.14.21` 上项目外目标**必须**误拦截、项目内拦截 stderr **必须**为空；否则矩阵空转，必须重写矩阵而非放行部署。

### OpenLogos Smoke Reporter

- 失败不得写 pass；缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。

## OpenLogos 0.14.23 next 问即建发布 Smoke

### 授权与统一前置

- 执行 `SMOKE-core-194` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.23`。
- 全部断言在一次性临时项目中构造；**不得触碰本仓或用户其它项目的活跃提案、guard 与事务文件**。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-194 | 0.14.23 next 问即建全链且无投影缺陷在 0.14.22 复现 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 asset identity；② **问即建**：隔离 prefix init 新项目 → launched → 建提案并构造 spec-complete 态（`SPEC_MERGED`、tasks.md 含已勾 `[delta]` 与空 `[code]` 标题、`PLAN_APPROVED`）→ `next --format json` → 模块项携 `slice_transaction` 投影（`origin=initial-plan`、`phase=collecting`、`content_slots.required=2`）且 `TEST_SLICE_TRANSACTION.json` 落盘；③ **幂等与续用**：重跑 `next` → `transaction_id` 不变；`slice transaction submit-content` 提交 slot → 同一事务受理不重建；④ **非触发零回归**：delta-writing 前沿的提案 `next` 不创建事务、不输出该字段；⑤ **0.14.22 对照**：固定 0.14.22 上重放② → 输出**必须无 `slice_transaction` 字段**且事务文件**不落盘**（缺陷复现）；⑥ 演练 `0.14.22→0.14.23→0.14.22→0.14.23` 并复核每阶段 identity 与②⑤结论 | ② 投影在场且事务落盘；③ 幂等且续用同一事务；④ 逐项与 0.14.22 一致；⑤ **0.14.22 必须复现无投影且不落盘**——旧版也有投影则矩阵空转判 FAIL；⑥ 往返无混装且结论不变；全程无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-194`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须写显式 `skip` 记录并携带缺失项，禁止静默零记录退出。
3. **next 行为断言必须驱动真实安装态 `openlogos next --format json` 并解析 JSON 输出**；库级函数直调不计入闭环证据。
4. 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-194` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。

### 零回归对照（强制）

步骤⑤是本用例的空转防线：固定 `0.14.22` 上同场景 `next` **必须**无投影且事务文件不落盘；否则矩阵空转，必须重写矩阵而非放行部署。

### OpenLogos Smoke Reporter

- 失败不得写 pass；缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。

## OpenLogos 0.14.24 guard Bash 管辖判定发布 Smoke

### 授权与统一前置

- 执行 `SMOKE-core-195` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.24`。
- 全部断言在一次性临时项目与临时 HOME 中构造；**不得触碰本仓或用户其它项目的活跃提案、guard、settings.json 与真实 `~/.claude` 目录**（项目外路径断言使用临时 HOME 与临时 scratchpad 目录构造，不动真实 runlogos）。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-195 | 0.14.24 Bash 写命令管辖判定全链且全外误拦在 0.14.23 复现 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 asset identity（含随包 guard-check 新字节与 manifest 条目）；② **项目外放行**：隔离 prefix init 新项目 → 置 launched 无提案，以 stdin JSON + env 驱动随包 guard-check：`rm -rf <项目外路径>`（session scratchpad 形态）、`cp <项目外→项目外>`、`mkdir <项目外>` → 一律 exit 0 放行；③ **项目内拦截零回归**：`rm <项目内源码>`、混合形态 `cp <项目外> <项目内非白名单>` → exit 2 且 stderr 含「变更管理拦截」与 `openlogos change` 指引、stdout `{"reason":…}` JSON 结构不变；白名单目标放行、`git push` 安全白名单放行、写 guard 文件后同一调用放行、`>`/`>>` 重定向判定不变；④ **解析不出保守臂**：`rm $VAR`、`rm $(cmd)`、`rm a && rm b` 形态 → exit 2 维持拦截；⑤ **0.14.23 对照**：固定 0.14.23 上重放② → **必须 exit 2 误拦截**（缺陷复现）；⑥ 演练 `0.14.23→0.14.24→0.14.23→0.14.24` 并复核每阶段 identity 与②③⑤结论 | ② 全外路径一律放行；③ 逐项与 0.14.23 一致（安全面零放宽）；④ 保守臂维持拦截；⑤ **0.14.23 必须复现全外误拦截**——旧版也放行则矩阵空转判 FAIL；⑥ 往返无混装且结论不变；全程无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-195`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须写显式 `skip` 记录并携带缺失项，禁止静默零记录退出。
3. **guard 行为断言必须以 stdin JSON + env + cwd 驱动真实随包 guard-check 脚本，并同时捕获 stdout 与 stderr 两通道**；库级函数直调不计入闭环证据。
4. 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-195` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。

### 零回归对照（强制）

步骤⑤是本用例的空转防线：固定 `0.14.23` 上全部路径实参在项目外的 `rm`/`cp` **必须**被误拦截（exit 2）；否则矩阵空转，必须重写矩阵而非放行部署。

### OpenLogos Smoke Reporter

- 失败不得写 pass；缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。

## OpenLogos 0.14.25 生命周期 fail-closed 发布 Smoke

### 授权与统一前置

- 执行 `SMOKE-core-196` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.25`。
- 全部断言在一次性临时项目中构造；**不得触碰本仓或用户其它项目的活跃提案、guard 与 marker 文件**（本用例会构造缺 `DEPLOY_DONE`、缺 `VERIFY_PASS` 等异常提案态并驱动 `archive`，必须完全隔离）。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-196 | 0.14.25 生命周期 fail-closed 与对账投影全链且缺陷在 0.14.24 复现 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 asset identity；② **smoke 拒绝**：隔离 prefix init 新项目 → launched → 建需部署需 smoke 提案，置 `VERIFY_PASS` + `deployment-report.md`，`[deploy]` 全勾但**不跑** `deploy-done` → `openlogos smoke` → 非零退出、`SMOKE_DEPLOY_NOT_DONE`、提示含 `openlogos deploy-done`，且 `SMOKE_PASS`/`SMOKE_FAIL`/`smoke-report.md` 未产生、`smoke-results.jsonl` 行数未变；另构造 `[deploy]` 未全勾态 → `SMOKE_DEPLOY_TASKS_INCOMPLETE`；③ **archive 拒绝**：缺 `VERIFY_PASS` → `ARCHIVE_VERIFY_NOT_PASSED`；需部署缺 `DEPLOY_DONE`（且 `SMOKE_PASS` 在场的孤儿态）→ `ARCHIVE_DEPLOY_NOT_DONE`；需 smoke 缺 `SMOKE_PASS` → `ARCHIVE_SMOKE_NOT_PASSED`；三者均**不移动提案目录、不删 guard**；④ **对账投影**：孤儿态下 `status --format json` 的 `active_change.state_inconsistency` 三字段齐备（`kind`/`evidence` 顺序稳定/`remediation="openlogos deploy-done"`）、`proposal_step` 仍 `ready-to-deploy`；`next` 人读引导含补救命令；⑤ **补标后放行**：执行 `openlogos deploy-done` → smoke 进入正常执行路径、archive 链条通过并成功归档、投影字段消失；⑥ **零回归**：无需部署提案 `VERIFY_PASS` 后 archive 照常成功；一致状态下 `status`/`next` 无 `state_inconsistency` 键；⑦ **0.14.24 对照**：固定 0.14.24 上重放②③④ → smoke **必须照常写 `SMOKE_PASS`**、archive **必须照常成功**、status **必须无投影字段**（缺陷复现）；⑧ 演练 `0.14.24→0.14.25→0.14.24→0.14.25` 并复核每阶段 identity 与②～⑦结论 | ② 两类拒绝均生效且副作用清零（以磁盘事实取证）；③ 三类拒绝均生效且目录/guard 未动；④ 投影三字段齐备、派生未变；⑤ 补标后全链放行、投影消失；⑥ 逐项与 0.14.24 一致；⑦ **0.14.24 必须复现三处缺陷**——旧版也拒绝或已有投影则矩阵空转判 FAIL；⑧ 往返无混装且结论不变；全程无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-196`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须写显式 `skip` 记录并携带缺失项，禁止静默零记录退出。
3. **fail-closed 与投影断言必须驱动真实安装态 `openlogos smoke` / `archive` / `status` / `next` 命令并解析其 stdout/stderr 与磁盘事实**；库级函数直调不计入闭环证据。副作用清零必须以磁盘取证（marker 文件不存在、报告文件不存在、JSONL 行数未变、提案目录仍在原处、guard 仍在盘），不得只断言退出码。
4. 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-196` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。

### 零回归对照（强制）

步骤⑦是本用例的空转防线：固定 `0.14.24` 上缺 `DEPLOY_DONE` 的 smoke **必须**照常执行并写入 `SMOKE_PASS`、缺链 archive **必须**照常成功、孤儿态 status **必须**无 `state_inconsistency` 字段；否则矩阵空转，必须重写矩阵而非放行部署。

### OpenLogos Smoke Reporter

- 失败不得写 pass；缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。

## OpenLogos 0.15.0 打包候选安装态 smoke（SMOKE-core-197～199）

> 在**一次性隔离 npm prefix** 中对固定 0.15.0 tarball 取证。runner 必须为每个 owned ID 写 `pass|fail|skip`，禁止零记录退出；全程不得触碰本机全局 prefix。

| ID | 描述 | 精确期望 |
|---|---|---|
| SMOKE-core-197 | candidate identity 冻结 | 隔离 prefix 内 `--version` 为 `0.15.0`；入口 realpath 落在该 prefix 内；package 与 asset manifest 的 hash 与固定 tarball 逐字节一致，无 workspace link |
| SMOKE-core-198 | 破坏性契约生效 | `merge transaction status`、`merge-apply`、切片事务命令一律非零退出；临时项目内 `merge <slug>` 一次调用合并多目标并写 `SPEC_MERGED`；`change-lint` 输出恰 9 项检查；`slice plan --file` 与 `lint-specs` 均可执行 |
| SMOKE-core-199 | 本机全局零触碰 | smoke 执行前后 `command -v openlogos` 指向同一路径且 `--version` 均为 `0.14.25`；本机全局 prefix 下无 0.15.0 制品残留 |

### 自动化与证据要求

- runner 记录 tarball 路径与 SHA-256、隔离 prefix 路径、每步入口 realpath 与 version。
- 命令图中不得出现 `npm publish` / `dist-tag` / `git tag` / `gh release` / `git push` / 本机全局 `npm install -g`。

## OpenLogos 0.15.2 checkpoint 身份绑定安装态 smoke（SMOKE-core-200～202）

> 覆盖 checkpoint 身份绑定在**真实安装态**的行为（功能规格 §2.77；根规范 `spec/test-slice-manifest.md` §6.1～§6.3）。缺陷只在安装态发作——宿主调用的是全局 `openlogos`，仓库内测试绿不代表宿主拿到的判定是对的。全部用例在一次性隔离临时项目内执行，**不得触碰本机全局 prefix 与本仓活跃提案**。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-200 | 安装态恢复重跑保住 checkpoint 账本 | 全局已安装候选版本；`mktemp -d` 一次性临时项目，launched 模块，提案含合法 `[code]`/`[delta]`/`[deploy]` 与已合并测试规格 | ① 全局 `openlogos slice plan --file slices.json` 写入 2 切片；② 为切片 1 追加一条真实 PASS checkpoint 并勾选该条目；③ 删除 `TEST_SLICE_MANIFEST.json`；④ 以**逐字相同**的 `slices.json` 重跑 `slice plan`；⑤ 读全局 `openlogos next --format json` | ④ 后 manifest 重建、`[code]` 首条仍为 `- [x]`；⑤ 的切片派生中**切片 1 仍在 `confirmed_slice_ids`**、前沿指向切片 2；`SLICE_CHECKPOINTS.jsonl` 字节只增不改 | 保留隔离 fixture、两次 manifest 与账本原文供诊断；停止部署，按 `cli/rollback/` 回滚全局 |
| SMOKE-core-201 | 安装态重划作废旧账本（互为反例） | 同上，续 SMOKE-core-200 的项目状态 | ① 改动 `slices.json`（改写某片 `task_text` 或调整划分）；② 重跑全局 `slice plan`；③ 读 `next --format json` | `confirmed_slice_ids` **变空**、前沿回到第一片——证明身份绑定并非一律放行，「划分真的变了」仍作废旧绿；账本历史行未被删除或重写 | 同上。**本条与 SMOKE-core-200 必须成对通过**：只过其一说明绑定对象仍然错误 |
| SMOKE-core-202 | 安装态混合账本按行 schema 分派 | 同上；账本中人为并存一条 `openlogos/slice-checkpoint@1` 行（其 `manifest_sha256` 为当前 manifest 的**文件字节**哈希）与候选版本写出的 `@2` 行 | 读全局 `openlogos next --format json` 与 `openlogos verify --format json` 的切片派生 | 两行**各按其 schema** 被采信，对应切片同时进入 `confirmed_slice_ids`；再注入一条未知主版本（`@9`）行 → 该行不被采信，且**不产生 violation、不中断命令**，其余行照常 | 保留账本原文与两条命令输出；混合读失败意味着升级会让在途提案的已确认切片一次性作废，停止部署 |

### 二、执行边界

- 全部用例只在 `mktemp -d` 的一次性项目内读写；结束即删除。**不得**在本仓活跃提案、`logos/resources/` 或本机全局 prefix 上产生任何写入。
- 命令图中不得出现 `npm publish` / `dist-tag` / `git tag` / `gh release` / `git push`。
- 判定一律读命令的 `--format json` 结构化输出，不解析文本渲染。

### 三、追溯与覆盖

- AC-SLICE-ID-05 恢复保住账本 / 重划作废账本互为反例（安装态）：SMOKE-core-200、SMOKE-core-201。
- AC-SLICE-ID-03 混合账本按行分派、AC-SLICE-ID-04 未知主版本保守处置（安装态）：SMOKE-core-202。
- 功能规格：§2.77；根规范：`spec/test-slice-manifest.md` §6.1～§6.3、§8、§11；仓库内对应用例：UT-S32-96～99、ST-S32-42。

### 四、自动化与证据要求

- runner 记录候选版本号、全局入口 realpath、隔离项目路径，以及每一步的 manifest 身份与账本行原文。
- 结果写入 smoke reporter（`smoke-results.jsonl`）；失败不得写 pass。
- SMOKE-core-200 与 SMOKE-core-201 必须**成对**评估：仅 200 通过而 201 失败，等于身份函数退化成常量，属实现缺陷而非环境问题。

## OpenLogos 0.15.3 slice plan fail-closed 与阻塞理由自检安装态 smoke（SMOKE-core-203～205）

> 覆盖写入侧 fail-closed 与 `change-lint` L9 在**真实安装态**的行为（功能规格 §2.78、§2.79；根规范 `spec/test-slice-manifest.md` §2.2、§2.2.1、§10）。缺陷只在安装态发作——RunLogos 等宿主调用的是全局安装的 `openlogos slice plan` / `change-lint`，仓库改完不重新打包安装，宿主拿到的仍是旧的 fail-open 写入口。全部用例在一次性隔离临时项目内执行，**不得触碰本机全局 prefix 与本仓活跃提案**。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-203 | 安装态非法 `spec_targets` 被写入口拒绝且两产物零改写 | 全局已安装 0.15.3；`mktemp -d` 一次性临时项目，launched 模块，提案已 `SPEC_MERGED` 且测试规格含真实 ID | ① 记录 `tasks.md` 与 `TEST_SLICE_MANIFEST.json`（若在盘）的 SHA-256 与 mtime；② 以某片 `spec_targets` 含非 `logos/resources/test/` 路径的 `slices.json`（复刻 2026-09-10 事故输入）执行全局 `openlogos slice plan --file`；③ 复算两文件的 SHA-256 与 mtime；④ 列出提案目录文件 | ② 退出码为 **2**，stdout 逐条列出 violations（每条含 `code` / `path` / `message` / `fix_hint`，`path` 精确指向出问题的切片与字段）；③ 两文件 SHA-256 与 mtime **均未变**；④ 无临时文件残留。**0.15.2 下该输入被放行、两产物落盘，本条即新旧行为的判别点** | 保留隔离 fixture、`slices.json` 与命令原文；停止部署，按 `cli/rollback/` 回滚全局至 0.15.2 |
| SMOKE-core-204 | 安装态合法输入零行为变化 | 同上，续 SMOKE-core-203 的项目状态 | ① 依 SMOKE-core-203 的 `fix_hint` 把 `spec_targets` 改为真实测试规格路径后重跑全局 `slice plan`；② 读 `openlogos next --format json`；③ 运行全局 `openlogos verify --format json` | ① 退出码 0，两产物落盘且互相一致，五个 `data` 字段取值与 0.15.2 同输入下**逐字相同**；② 前沿正常推进，无 `test-slice-manifest-invalid`；③ 进入 `slice-checkpoint` 模式，增量验收零回归 | 保留两版本同输入的输出对照；行为漂移即说明收紧越界，停止部署并回滚 |
| SMOKE-core-205 | 安装态 change-lint 覆盖 8 条阻塞理由 | 同上；在隔离项目内逐条构造使各 `ProposalBlockReason` 成立的最小状态（含直接放置非法在盘 manifest 以模拟历史遗留态） | ① 对每种状态执行全局 `openlogos change-lint --format json`；② 同状态下执行全局 `openlogos next --format json`；③ 比对项目根在 lint 前后的字节快照 | ① 8 条理由**逐条被检出并点名**，7 条进 `violations` 且退出码 2、`test-slice-manifest-stale` 进 `warnings` 且退出码不变；② lint 与 next 的理由及 violations 逐条一致；③ 快照相等（含 guard、marker、`logos-project.yaml` 与 verify 账本），只读红线不破。**0.15.2 下仅 1 条被检出** | 保留每种状态的 lint 与 next 输出原文；覆盖不足意味着自检入口仍不可达，停止部署 |

### 二、执行边界

- 全部用例只在 `mktemp -d` 的一次性项目内读写；结束即删除。**不得**在本仓活跃提案、`logos/resources/` 或本机全局 prefix 上产生任何写入。
- 命令图中不得出现 `npm publish` / `dist-tag` / `git tag` / `gh release` / `git push`——本次为本地全局部署，不做公网发布。
- 判定一律读命令的 `--format json` 结构化输出与磁盘字节，不解析文本渲染，也不以命令自述的成功作为通过依据。

### 三、追溯与覆盖

- AC-SLICE-FAILCLOSED-01 / 02 非法输入被拒且两产物零改写（安装态）：SMOKE-core-203。
- AC-SLICE-FAILCLOSED-05 合法路径零行为变化（安装态）：SMOKE-core-204。
- AC-LINT-BLOCK-01 / 02 / 06 阻塞理由 8/8 覆盖、与 next 同结论、只读红线（安装态）：SMOKE-core-205。
- 功能规格：§2.78、§2.79；根规范：`spec/test-slice-manifest.md` §2.2、§2.2.1、§8、§10；仓库内对应用例：UT-S32-100～103、ST-S32-43、UT-S35-138～141、ST-S35-27。

### 四、自动化与证据要求

- runner 记录候选版本号（0.15.3）、全局入口 realpath、隔离项目路径，以及每一步的两产物 SHA-256 与命令退出码。
- 结果写入 smoke reporter（`smoke-results.jsonl`）；失败不得写 pass。
- SMOKE-core-203 与 SMOKE-core-204 必须**成对**评估：只过 203 说明收紧过头（合法输入也被拒），只过 204 说明写入口仍是 fail-open——两者共同界定「单向收紧且不产生新失败面」。

## OpenLogos 0.15.4 发布身份与环境事实断言边界安装态 smoke（SMOKE-core-206）

> 覆盖发布身份在**真实安装态**的一致性，以及该校验**自身不钉死包版本**（架构 §四十九、部署方案「发布前检查通则」）——注意判据是「包版本承载位不得有字面量」，**不是**「源码里不许出现任何 `x.y.z`」：契约版本 `1.0.0` 的固定断言必须保留（delta-r1 F2）。缺陷只在发布后发作：0.15.3 的实证是仓库 `npm test` 已红却仍完成了全局安装，因此本条同时验「装对了」与「验的方式不会随下次发布过期」。用例在一次性隔离临时项目内执行，**不得触碰本机全局 prefix 与本仓活跃提案**。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-206 | 安装态发布身份一致且断言不钉死环境事实 | 全局已安装本次候选；`mktemp -d` 一次性临时项目 | ① 运行时读取三处版本：全局 `openlogos --version`、安装态 `package.json`、安装态 `asset-manifest.json`；② 读取安装包内 `dist/lib/local-release-candidate.js` 的 `LOCAL_RELEASE_CANDIDATE_VERSION` 与 `LOCAL_RELEASE_ROLLBACK_VERSION`；③ 在临时项目内执行 `openlogos status --format json`；④ 自检 runner 自身源码：**按位置语义**扫描——包版本承载位不得出现任何 `x.y.z` 字面量，契约版本位的固定期望值**明确放行** | ① 三处版本**互相相等**（关系断言，不与任何字面量比较）；② 候选常量 == 该版本，回滚常量 != 该版本；③ `data.contract.version` 为 `1.0.0`（契约字段，**逐字节守死**——它不是环境事实）；④ 自检通过，且同批自证两类边界：**(a) 保留 `expect(contract.version).toBe('1.0.0')` 时自检仍通过**；**(b) 向 runner 注入一个包版本字面量（如把步骤①的关系断言改成与 `'0.15.4'` 比较）时自检失败并点名该行** | 保留三处读数与 runner 源码片段；版本不一致 → 停止部署并按 `cli/rollback/` 回滚；若失败原因是 runner 钉死了包版本 → 先改 runner 为关系断言，不得以「更新期望值」了事 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目内；结束即删除。**不得**触碰本仓活跃提案、`logos/resources/` 或本机全局 prefix（本条只读全局安装态，不做安装/卸载）。
- 命令图中不得出现 `npm publish` / dist-tag / `git tag` / `gh release` / `git push`——本次为本地全局部署。
- 判定一律读命令的 `--format json` 结构化输出与磁盘字节，不解析文本渲染。

### 三、追溯与覆盖

- AC-ENVFACT-05 安装态发布身份三处同源（关系断言）：SMOKE-core-206 步骤①②。
- AC-ENVFACT-06 契约字段在安装态仍逐字节守死：SMOKE-core-206 步骤③。
- AC-ENVFACT-07 校验逻辑不钉死包版本、但保留固定契约期望值（两类边界自证）：SMOKE-core-206 步骤④ (a)(b)。
- 架构：§四十九；部署方案：「OpenLogos 0.15.4 发布方案」；仓库内对应用例：UT-S19-46、UT-S19-47、UT-S34-29。

### 四、自动化与证据要求

- runner 记录三处版本读数、全局入口 realpath 与隔离项目路径；结果写入 smoke reporter（`smoke-results.jsonl`），失败不得写 pass。
- 步骤④是**自指检查**，判据与 `UT-S19-47` 同源：按**位置语义**而非「是否等于某个版本」判定——**包版本承载位**（三处版本读数的期望值、tarball 版本）不得出现 `x.y.z` 字面量；**契约版本位**（`data.contract.version`）的固定期望值是必需的，扫描必须放行。二者缺一即错：只禁不放，会让合法的 `1.0.0` 契约断言触发假红，或诱使实现者拼接字符串规避扫描（delta-r1 F2）；只放不禁，本条就退回成一句没有检查者的约定。
- 契约版本的期望值必须是**独立固定值**，不得改成「读取安装包自己的契约常量再与输出比较」——常量与输出一起漂移时那种检查照样通过，等于没检查。

## OpenLogos 0.15.5 标题保真安装态 smoke（SMOKE-core-207）

> 覆盖合并引擎的**标题保真**在真实安装态的行为（架构 §五十一、功能规格 §2.80）。缺陷只在安装态发作——宿主执行 merge 用的是全局安装的 CLI，仓库改完不发版，后续每一个含行内代码标题的 `ADDED` 块仍会被静默吞字，且**被吞内容无法从落盘文本反推**。用例在一次性隔离临时项目内执行，**不得触碰本机全局 prefix 与本仓活跃提案**。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-207 | 安装态下含行内代码的 `ADDED` 标题原样落盘 | 全局已安装本次候选；`mktemp -d` 一次性临时项目，launched 模块 | ① 在临时项目内构造提案，其 delta 含 ``## ADDED — 3.9 `x_field` 与 `y_field` 投影`` 与一个常规 `MODIFIED` 块；② 全局 `openlogos change-lint`；③ 全局 `openlogos merge <slug>`；④ 读回目标文档标题行原始字节；⑤ 再构造一个含 `RENAMED` 块的提案并 merge（零回归对照） | ② lint 通过；③ merge exit 0 并写 `SPEC_MERGED`；④ 落盘标题**逐字等于** ``## 3.9 `x_field` 与 `y_field` 投影``——反引号与两个字段名全部保留（**0.15.4 及之前会落成 `## 3.9  与  投影`**）；⑤ `RENAMED` 仍正确应用，H1 更名与正文不变逐条成立 | 保留隔离 fixture、delta 原文与落盘标题行；标题被吞 → 停止部署并按 `cli/rollback/` 回滚；`RENAMED` 回归失败同样停止部署 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目内；结束即删除。**不得**触碰本仓活跃提案、`logos/resources/` 或本机全局 prefix（本条只读全局安装态，不做安装/卸载）。
- 命令图中不得出现 `npm publish` / dist-tag / `git tag` / `gh release` / `git push`——本次为本地全局部署。
- 判定一律读**落盘文本的原始字节**，不得先做任何规范化——检查者与被检查者共用规范化管道时检查恒真，那正是本缺陷两次静默通过的机制。

### 三、追溯与覆盖

- AC-TITLE-FIDELITY-01 安装态下标题逐字保真：SMOKE-core-207 步骤④。
- AC-TITLE-FIDELITY-04 `RENAMED` 零回归：SMOKE-core-207 步骤⑤。
- 架构：§五十一；功能规格：§2.80；仓库内对应用例：UT-S09-349、UT-S09-350。

### 四、自动化与证据要求

- runner 记录全局入口 realpath、候选版本、隔离项目路径、delta 原文标题行与落盘标题行两侧字节。
- 结果写入 smoke reporter（`smoke-results.jsonl`）；失败不得写 pass。
- 标题比对必须**逐字节**，不得用 `includes` 近似——吞字的表现恰是「其余部分都在、只少了一段」，近似比对会放行。

## verify 判据收敛进入安装态 smoke（SMOKE-core-208）

> 覆盖「修复真的进了全局安装包」这一件事。下游 RunLogos 消费的是**安装态** CLI：仓内源码修好、
> 安装态未更新，对下游等于没修——阻塞照旧且无人发现（`AC-VERIFY-MANUAL-04`）。
> 用例在 `mktemp -d` 一次性隔离项目内执行，**只读**全局安装态，不触碰本机全局 prefix 与本仓活跃提案。
> 判据用**行为断言**而非版本号比较：版本号只说明装了新包，不说明这两条判据真的收敛了。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-208 | 安装态的 verify 判据已收敛：描述列字面量不再误排除，舍入不再触发覆盖矛盾 | 全局已安装本次候选；`mktemp -d` 一次性临时项目，内含最小 OpenLogos 骨架 | ① 在临时项目内写一份测试规格：**A 行**首格为纯自动化 ID、描述列含裸 manual 标记字面量；**B 行**首格带 manual 标记（真人工用例）；另补若干普通 ID 使 `defined` 足够大，且刻意留 **1 条**未覆盖以构造真实覆盖率 ≥ 99.5%；② 按该规格写结果账本（A 行与普通 ID 全 `pass`，B 行无记录，留空的那条无记录）；③ 在临时项目内执行全局 `openlogos verify --format json`；④ 读回 `acceptance-report.md` | ① envelope 的 `summary` 内 `passed + failed + skipped == executed_count`，且 A 行 ID 计入 `executed_count`；② `mismatches` **不含** `coverage_full_with_uncovered` 与 `passed_failed_skipped_ne_executed`；③ `uncovered_count == 1` 并点名那条真实未覆盖的 ID（判定强度不放宽）；④ B 行仍被排除在 `defined` / `executed` 之外；⑤ 控制台 `执行用例` 与报告 `Executed cases` **取值相同** | 保留 envelope、报告 Summary 与临时项目规格片段；若 ①②⑤ 任一不成立说明安装态仍是旧判据 → 停止部署，按 `cli/rollback/` 回滚安装态，不得以「本地源码已修」了事；若 ③④ 不成立说明收敛过头（把真实矛盾或真人工用例也吞了）→ 同样回滚 |

### 二、追溯与覆盖

- AC-VERIFY-MANUAL-01 描述列字面量不影响计入（安装态）：SMOKE-core-208 步骤①③。
- AC-VERIFY-MANUAL-02 真人工用例判定不变（安装态）：SMOKE-core-208 预期④。
- AC-VERIFY-COUNT-01 舍入不再触发覆盖矛盾（安装态）：SMOKE-core-208 预期②。
- AC-VERIFY-COUNT-03 真实矛盾仍被判出（安装态）：SMOKE-core-208 预期③。
- AC-VERIFY-MANUAL-04 修复进入安装态：本条整体即该验收的唯一证据。
- 场景：S13 >「人工用例判据的声明位与一致性判据的输入」（EX-7.6、EX-7.7、EX-7.9）；
  仓库内对应用例：UT-S13-69～75、ST-S13-20～21。

### 三、自动化与证据要求

- runner 记录全局入口 realpath、安装态版本号、隔离项目路径、每一步的命令退出码与 envelope 摘要。
- 结果写入 smoke reporter（`smoke-results.jsonl`）；**失败不得写 pass**。
- runner **不得**以「安装态版本号等于本次候选」替代行为断言——版本号相等只证明装了新包，
  不证明判据收敛；本条要的是可观察的行为差异（`mismatches` 为空 + 计数自洽）。

## OpenLogos 0.15.15 guard 资料目录与基线 staging 默认豁免安装态 smoke（SMOKE-core-209～210）

> 覆盖「修复真的进了本机全局安装态与其分发出的托管 guard」。guard 是托管资产：仓内源码修好、全局 CLI 或项目托管副本未更新，用户现场的误拦截照旧。用例在 `mktemp -d` 一次性隔离项目内执行，**只读**本机全局安装态（不做安装 / 卸载），不触碰本仓活跃提案与用户其他仓库。判据用**行为断言**：版本号相等只证明装了新包，不证明规则生效。版本号为计划值 `0.15.15`，实际以部署记录的候选版本为准（关系断言：全局 `--version` == 部署记录版本）。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-209 | 安装态身份与托管 guard 放行 / 阻断矩阵 | 本机全局已安装本次候选；`mktemp -d` 一次性临时项目，经全局 `openlogos init` 建立并置 launched，无 guard 文件 | ① 读取全局入口 realpath、`openlogos --version`、全局包内 `asset-manifest.json` 与随包 guard 的 SHA-256；② 以 stdin JSON + cwd 调用临时项目托管 `.claude/openlogos/bin/guard-check`：Write `logos/resources/reference/notes.md`、`logos/resources/reference/a/b/c.md`、`logos/resources/verify/baseline-seed-runs/<run_id>/staging/system-map.md`、`.../staging/scenarios/s.md`；Bash `mkdir -p logos/resources/reference/temp`、`touch .../staging/a.md`；③ 同一 hook 调用：Write `logos/resources/reference-evil/x.md`、`.../baseline-seed-runs/<run_id>/staging-backup/x.md`、`.../baseline-seed-runs/a/b/staging/x.md`、`.../<run_id>/run.json`、`.../<run_id>/commit-journal.json`、`.../<run_id>/resolved/x.md`、`.../<run_id>/backup/x.md`、`logos/resources/verify/test-results.jsonl`、`logos/resources/prd/1-product-requirements/core-01-requirements.md`、`src/index.ts`；Bash `cp logos/resources/reference/a.md src/a.md` | ① `--version` 等于部署记录版本；包内 asset-manifest `payloadHash` 自洽；托管 guard 与随包 guard 逐字节一致；② 全部 exit 0，且未产生 `logos/changes/*` 或 guard 文件；③ 全部 exit 2，stdout 含拦截 JSON、stderr 含可读指引 | 保留隔离项目、hook 输入与输出；① 不成立或 ②③ 任一不符 → 停止后续流程，按部署方案以 `cli/rollback/` 旧制品回装全局，并用旧版 sync 恢复本仓托管副本；不得以「仓内源码已修」了事 |
| SMOKE-core-210 | 新建 / 存量项目经全局 CLI 分发获得同一规则 | 本机全局已安装本次候选；两个 `mktemp -d` 一次性临时项目：P1 空目录；P2 为已初始化项目，其托管 `guard-check` 预置为上一版本（回滚制品内）的旧字节 | ① P1 执行全局 `openlogos init`；② P2 执行全局 `openlogos sync`；③ 对 P1、P2 的托管 guard 各跑 SMOKE-core-209 步骤②③的核心子集（reference 正向、staging 正向、run.json 负向、源码负向） | ①② 后两份托管 guard 与随包 guard 逐字节一致；P2 sync 前旧字节对 reference 正向输入 exit 2（对照），sync 后 exit 0；③ 两项目结论与 SMOKE-core-209 一致 | 同上；另保留 P2 sync 前后 guard 的 SHA-256 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目内；结束即删除。**不得**触碰本仓活跃提案、`logos/resources/`、用户其他仓库或本机全局 prefix（本节只读全局安装态）。
- 命令图中不得出现 `npm publish` / dist-tag / `git tag` / `gh release` / `git push`——本次为本地全局部署。
- `<run_id>` 由 runner 以合法 run_id 格式生成；不在断言中硬编码主机路径、墙上时钟或本机全局安装现值（通则第 1 条）。

### 三、追溯与覆盖

- 根规范：`spec/pretooluse-guard.md` §资料目录与基线 staging 默认路径豁免。
- 场景：S09「无活跃提案时资料目录与基线 staging 的 guard 放行时序」EX-9.31～EX-9.36；S08「sync 托管 guard 资产补齐时序」。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.15.15 发布方案（guard 资料目录与基线 staging 默认豁免，本地全局）」。
- 仓库内对应用例：UT-S09-365～UT-S09-372、ST-S09-147～ST-S09-148。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-guard-reference-staging-0-15-15.js`，由既有 `scripts/run-smoke.js` 发现并执行；记录全局入口 realpath、安装态版本、隔离项目路径、每次 hook 调用的输入、退出码与 stdout/stderr 摘要。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`）；**失败不得写 pass**。
- runner **不得**以「安装态版本号等于候选」替代行为断言；字节一致性以 SHA-256 比对，不得以「文件存在」代替。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-209、SMOKE-core-210 均被 runner 覆盖。

## OpenLogos 0.15.16 后态测试 ID 重复判据安装态 smoke（SMOKE-core-211～212）

> 覆盖「§2.85 的 lint 前移判据与写作规范真的进了本机全局安装态及其分发出的托管 Skill」。判据只在安装态对宿主生效：仓内源码修好、全局 CLI 未更新，RunLogos 驱动的宿主项目仍会在合成期硬停于 `test-change-set-duplicate-id`。用例在 `mktemp -d` 一次性隔离项目内执行，**只读**本机全局安装态（不做安装 / 卸载），不触碰本仓活跃提案与用户其他仓库。判据用**行为断言**：版本号相等只证明装了新包，不证明判据生效。版本号为计划值 `0.15.16`，实际以部署记录的候选版本为准（关系断言：全局 `--version` == 部署记录版本）。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-211 | 安装态身份与事故形态在 write-delta 节点闭环 | 本机全局已安装本次候选；`mktemp -d` 一次性临时项目，经全局 `openlogos init` 建立并置 launched；以全局 `openlogos change <slug>` 创建提案，proposal.md 与 tasks.md 填为可合并最小形态；目标 `logos/resources/test/core-S09-test-cases.md` 为五个并列 H2（导言、一、二、三、四）含 ID 表的测试用例文档 | ① 读取全局入口 realpath、`openlogos --version`、全局包内 `asset-manifest.json` 与随包 `skills/change-writer/SKILL.md` 的 SHA-256；② 写入 `deltas/test/core-S09-test-cases.md` 为「单块 `## MODIFIED — <导言标题>`、正文抄整份文档」的事故形态，执行全局 `openlogos change-lint --slug <slug> --format json`；③ 续跑全局真实 `openlogos merge <slug>`；④ 把 delta 改为每个 H2 各一个同锚 MODIFIED 块（只携带该章节自己的正文），重跑 ②③ | ① `--version` 等于部署记录版本；包内 asset-manifest `payloadHash` 自洽；随包 Skill 含「整节」边界说明且与本仓 `logos/skills/change-writer/SKILL.md` 逐字节一致；② exit 2、`data.pass=false`、`violations` 含 `delta_test_id_duplicate`，其 `path` 指向该 delta，message 含「合并后态行号」标注、delta 内行号与「疑似整篇改写吞并兄弟章节」提示，fix_hint 含逐章节拆块指引，violation 公开键集合恒为 code / path / message / fix_hint；③ 非零退出、stderr 含「change-lint 未通过」与该码、**不**含「merge 失败（test-change-set-duplicate-id）」、无 `SPEC_MERGED`、目标字节不变；④ lint exit 0 且 PASS，merge 退出码 0 且生成 `SPEC_MERGED`，合并后目标 ID 集合与合并前逐一一致 | 保留隔离项目、两次 delta、lint JSON 与 merge stderr；① 不成立或 ②③④ 任一不符 → 停止后续流程，按部署方案以 `cli/rollback/` 的 `0.15.15` 制品回装全局，并用旧版 sync 恢复本仓托管副本；不得以「仓内源码已修」了事 |
| SMOKE-core-212 | 合法下沉写法不受影响、整文件纳入 ID 检查 | 本机全局已安装本次候选；四个 `mktemp -d` 一次性临时 launched 项目（同 SMOKE-core-211 的提案脚手架）：P1 目标含 `## 模块甲 > ### 行为` 与 `## 模块乙 > ### 事件与最终态交互`（后者定义 UT-S09-01）；P2 目标含 `## 导言` 与 `## 单元测试`（定义 UT-S09-01）；P3 目标含单个 `## 一、单元测试用例` ID 表；P4 无既有 test 目标 | ① P1 写 `## MODIFIED — 模块甲 > 行为` 正文含 `### 事件与最终态交互` 定义 UT-S09-02；P2 写 `## MODIFIED — 导言` 正文含 `## 单元测试` 定义 UT-S09-02；P3 写 `## MODIFIED — 一、单元测试用例 [1]` 正文首行重复该根标题后接原表；三者各执行全局 `change-lint --format json` 与真实 `openlogos merge`；② P4 写封装合法的 Markdown 整文件 CREATE test delta（首行 `## ADDED — <target>（新文件，整文件）`），payload 内两条同 ID 行，执行 `change-lint --format json`；③ P4 另写一份 target 与 canonical 不一致的整文件 delta（payload 同 ②），执行 `change-lint --format json`；④ 全程前后读取 `command -v openlogos` 与 `--version` | ① 三项目 lint 均 PASS（零 `delta_test_id_duplicate`）、merge 均退出码 0；P1 合并后 `事件与最终态交互` 在 `模块甲 > 行为` 下为 H4 且 `模块乙` 原 H3 保留；P2 合并后 `单元测试` 在 `导言` 下为 H3 且原 `## 单元测试` 保留；P3 合并后 H2 与其下同名 H3 并存、ID 不变；② exit 2 且 `violations` 含 `delta_test_id_duplicate`，path 指向该整文件 delta、message 列出两处 delta 内行号、**不**含「疑似整篇改写」提示；③ 只报 `non_markdown_delta_invalid`、零 `delta_test_id_duplicate`；④ 入口路径与版本逐字一致 | 同上；另保留四个项目的合并后目标字节与 lint JSON；① 任一误红即表示候选把合法下沉写法判为违规，属行为回归，必须回装旧版并回流来源提案 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目内；结束即删除。**不得**触碰本仓活跃提案、`logos/resources/`、用户其他仓库或本机全局 prefix（本节只读全局安装态）。
- 命令图中不得出现 `npm publish` / dist-tag / `git tag` / `gh release` / `git push`——本次为本地全局部署。
- 临时项目的 merge 以 `OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY=0` 走直接合并，使 `SPEC_MERGED` 在场性与目标字节成为可断言事实；不在断言中硬编码主机路径、墙上时钟或本机全局安装现值（通则第 1 条）。
- 夹具 ID 一律使用临时项目私有的 `UT-S09-xx`，与本仓规格 ID 无交集；runner 不读本仓 `logos/changes/`。

### 三、追溯与覆盖

- 功能规格：§2.85.1～§2.85.4（判据、新码、三条边界、零回归边界）、§2.84.5（锁边界扩展）。
- 场景：S35「后态测试 ID 重复判据的同源前移」。
- 根规范 / Skill：`spec/change-management.md` `deltas/ 目录`、`skills/change-writer/SKILL.md` 守恒写作规范「整节」边界。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.15.16 发布方案（后态测试 ID 重复判据同源前移，本地全局）」。
- 仓库内对应用例：UT-S35-196（事故必红）、UT-S35-197（拆块必绿）、UT-S35-198（合法下沉）、UT-S35-200（整文件纳入与封装不合法）、UT-S35-201（诊断信号与公开键集合）、ST-S35-36（真实 CLI 端到端）；版本身份 `UT-S19-46` / `UT-S19-49`。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-after-state-test-id-duplicate-0-15-16.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行；记录全局入口 realpath、安装态版本、每个隔离项目路径、每次 lint 的 JSON 摘要（code / path / message 前 200 字）、每次 merge 的退出码与 stderr 首行、合并后目标 ID 集合。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`）；**失败不得写 pass**。
- runner **不得**以「安装态版本号等于候选」替代行为断言；Skill 字节一致性以 SHA-256 比对，不得以「文件存在」代替；lint 结论以 `--format json` 的 `violations[].code` 判定，不解析人类可读文案。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-211、SMOKE-core-212 均被 runner 覆盖。

## OpenLogos 0.15.17 目标既有测试欠债继承口径安装态 smoke（SMOKE-core-213～214）

> 覆盖「§2.86 的继承口径真的进了本机全局安装态」。判据只在安装态对宿主生效：仓内源码修好、全局 CLI 未更新，RunLogos 驱动的宿主项目仍会因目标文件既有欠债在 merge 合成期硬停。用例在 `mktemp -d` 一次性隔离项目内执行，**只读**本机全局安装态（不做安装 / 卸载），不触碰本仓活跃提案与用户其他仓库。判据用**行为断言**：版本号相等只证明装了新包，不证明判据生效。版本号为计划值 `0.15.17`，实际以部署记录的候选版本为准（关系断言：全局 `--version` == 部署记录版本）。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-213 | 安装态身份与事故形态放行 | 本机全局已安装本次候选；`mktemp -d` 一次性临时项目，经全局 `openlogos init` 建立并置 launched；以全局 `openlogos change <slug>` 创建提案，proposal.md 与 tasks.md 填为可合并最小形态；目标 `logos/resources/test/core-S68-test-cases.md` 场景测试表表头 4 列、`ST-S68-05` / `ST-S68-06` 两行 5 列；目标 `logos/resources/test/core-S37-test-cases.md` 含同一 ID `UT-S37-01` 的两条记录 | ① 读取全局入口 realpath、`openlogos --version`、全局包内 `asset-manifest.json`，并确认包内 `dist/lib/test-change-set.js` 导出 `inheritedAmbiguousRowKeys`；② 对两目标各写一个合规纯 ADDED 块，执行全局 `openlogos change-lint --slug <slug> --format json`；③ 续跑全局真实 `openlogos merge <slug>`；④ 读回 `SPEC_MERGED` 与两个合并后目标 | ① `--version` 等于部署记录版本；包内 asset-manifest `payloadHash` 自洽；判据导出在场；② exit 0、`data.pass=true`；③ 退出码 0、stderr **不**含「merge 失败（test-change-set-ambiguous-table）」或「merge 失败（test-change-set-duplicate-id）」；④ `SPEC_MERGED` 在场，`test_change_set.changed_test_ids` 恰为两个 ADDED 块新增的 ID，合并后两条欠债行与两条重复记录逐字节保留 | 保留隔离项目、delta、lint JSON 与 merge stderr；① 不成立或 ②③④ 任一不符 → 停止后续流程，按部署方案以 `cli/rollback/` 的 `0.15.16` 制品回装全局；不得以「仓内源码已修」了事 |
| SMOKE-core-214 | 原样携带放行、合并后不重放、新增欠债仍拒 | 本机全局已安装本次候选；两个 `mktemp -d` 一次性临时 launched 项目（同 SMOKE-core-213 的提案脚手架与 S68 目标）：P1、P2 | ① P1 写 `## MODIFIED — <场景测试章节>` 整节替换：只改 `ST-S68-01` 的一个单元格、`ST-S68-05` / `ST-S68-06` 逐字节原样携带，并附一个合规 `## ADDED` 章节；执行全局 `change-lint --format json` → 真实 `openlogos merge` → 再次 `change-lint --format json`；② P2 写同一 MODIFIED，但在表末再追加一条与 `ST-S68-05` 逐字节相同的行；执行 `change-lint --format json` 与真实 `openlogos merge`；③ 全程前后读取 `command -v openlogos` 与 `--version` | ① 首次 lint exit 0；merge 退出码 0 且生成 `SPEC_MERGED`；合并后再次 lint exit 0、`violations` 不含 `delta_test_table_column_mismatch`、stderr 不含「ADDED 章节已存在或不唯一」；② lint exit 2 且 `violations` 含 `delta_test_table_column_mismatch`；merge 非零退出、stderr 含「change-lint 未通过」、无 `SPEC_MERGED`、目标字节不变；③ 入口路径与版本逐字一致 | 同上；另保留两个项目的合并后目标字节与 lint JSON；① 任一误红即表示候选仍把原样携带的欠债判为违规，② 放行即表示宽容外溢到本提案引入的欠债，均属行为回归，必须回装旧版并回流来源提案 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目内；结束即删除。**不得**触碰本仓活跃提案、`logos/resources/`、用户其他仓库或本机全局 prefix（本节只读全局安装态）。
- 命令图中不得出现 `npm publish` / dist-tag / `git tag` / `gh release` / `git push`——本次为本地全局部署。
- 临时项目的 merge 以 `OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY=0` 走直接合并，使 `SPEC_MERGED` 在场性与目标字节成为可断言事实；不在断言中硬编码主机路径、墙上时钟或本机全局安装现值（通则第 1 条）。
- 夹具 ID 一律使用临时项目私有的 `ST-S68-xx` / `UT-S37-xx` / `UT-S68-xx`，与本仓规格 ID 无交集；runner 不读本仓 `logos/changes/`。

### 三、追溯与覆盖

- 功能规格：§2.86.1～§2.86.4（继承判据、变更集结论不变、实现单点与阶段边界、零回归边界）、§2.84.2（L4 列数检查过滤）。
- 场景：S09「test-change-set 的捕获集变化」、S35「后态测试 ID 重复判据的同源前移」。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.15.17 发布方案（目标既有测试欠债继承口径，本地全局）」。
- 仓库内对应用例：UT-S35-202（事故形态）、UT-S35-203（既有重复 ID）、UT-S35-207（MODIFIED 原样携带）、UT-S35-208（同字节副本拒绝）、UT-S35-215（合并后阶段边界）、ST-S35-37、ST-S09-151（真实 CLI 端到端）；版本身份 `UT-S19-46` / `UT-S19-49`。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-inherited-test-debt-0-15-17.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行；记录全局入口 realpath、安装态版本、每个隔离项目路径、每次 lint 的 JSON 摘要（code / path / message 前 200 字）、每次 merge 的退出码与 stderr 首行、合并后 `changed_test_ids`。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`）；**失败不得写 pass**。
- runner **不得**以「安装态版本号等于候选」替代行为断言；lint 结论以 `--format json` 的 `violations[].code` 判定，不解析人类可读文案；欠债行保留以逐字节包含判定。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-213、SMOKE-core-214 均被 runner 覆盖。

## OpenLogos 0.15.18 guard 以版本控制内容为保护对象安装态 smoke（SMOKE-core-215～222）

> 这组用例验证新判据、事后检查引擎、hook 注册与 `ignore` / `exempt` 子命令确实进入了本机全局安装态，以及它分发出去的托管资产。guard 与引擎是托管资产：仓内源码修好以后，只要全局 CLI 或项目托管副本没有更新，用户现场仍会碰到 `npm ci` 被误拦、复合命令绕过写入门禁的问题。
>
> 除 SMOKE-core-222 外，用例都在 `mktemp -d` 一次性隔离 **git 仓库**内执行。runner **只读**本机全局安装态，不做安装或卸载，也不触碰本仓活跃提案与用户其他仓库。判据用**行为断言**，因为版本号相等只证明装了新包，不证明规则生效。版本号以计划值 `0.15.18` 为准，实际以部署记录的候选版本为准，断言写成关系式：全局 `--version` == 部署记录版本。
>
> hook 一律以宿主真实 stdin 形态驱动临时项目的**安装态托管脚本**，按 `PreToolUse` → 真实执行命令 → `PostToolUse`（成功）或 `PostToolUseFailure`（非零退出）的顺序调用，cwd 为临时项目根。输入含 `hook_event_name`、`tool_name`、`tool_input`、`tool_use_id`、`session_id`、`cwd`；`PostToolUse` 另带 `tool_response`。不以直接调用内部函数代替 hook。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-215 | 安装态版本与资产身份 | 本机全局已安装本次候选；部署记录中有候选版本与 tarball SHA-256 | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json`，计算包内 `claude-plugin-template/bin/guard-check`、`claude-plugin-template/bin/guard-post-check.cjs` 的 SHA-256；③ 计算包内 Cursor 模板中引擎副本的 SHA-256，读取模板 `hooks/hooks.json`；④ 执行全局 `openlogos --help`、`openlogos ignore list --format json`、`openlogos exempt list --format json`（在临时项目内） | ① `--version` 等于部署记录版本，入口无 workspace link；② asset-manifest `payloadHash` 自洽；两个脚本的 SHA-256 各自等于 manifest 对应条目，并与本仓 `plugin/bin/` 下同名源文件逐字节一致；③ Cursor 引擎副本与 `guard-post-check.cjs` 逐字节一致，模板 `hooks.json` 含 `afterShellExecution`；④ 帮助中列出 `ignore` 与 `exempt`；`exempt list` 的 JSON `entries` 含两条 `source=default` 的内置默认项 | 保留读取结果。任一不符 → 停止后续流程，按部署方案用 `cli/rollback/` 的 `0.15.17` 制品回装全局，并按「失败处置与回滚边界」恢复本仓托管态；不得以「仓内源码已修」了事 |
| SMOKE-core-216 | 安装态放行矩阵：依赖、产物、豁免与 git 调用 | 本机全局已安装本次候选；`mktemp -d` 临时目录执行 `git init` 并完成首个提交（含 `src/a.js`、`.gitignore`，`.gitignore` 忽略 `node_modules/` 与 `dist/`）；经全局 `openlogos init` 建立并置 launched，无 guard 文件；另建分支 `feat` 并提交一处 `src/b.js` 改动后切回原分支；准备零依赖 `package.json` 与 lockfile | 以真实 hook 输入依次驱动并真实执行：① Bash `npm ci`；② Bash `mkdir -p dist/x`；③ Bash `node -e "require('fs').writeFileSync('dist/build.log','x')" > dist/run.log`；④ Write `dist/a.txt`；⑤ Write `logos/resources/reference/notes.md`；⑥ Bash `git checkout feat`，再执行 `git checkout -`；⑦ Bash `git stash list`；⑧ 以上全部完成后，用 `hook_event_name=Stop` 调用 `guard-post-check.cjs check --stop` | ①～⑦ 的 PreToolUse 与 PostToolUse 全部 exit 0，stdout 不含拦截 JSON；⑥ 切换分支带来的 `src/b.js` 变化不被报告；⑧ exit 0，无待报告项；全程未产生 `logos/changes/*` 或 guard 文件；`logos/.openlogos-runtime/` 被 `git check-ignore` 判为忽略 | 保留隔离项目、每次 hook 的输入、退出码与 stdout/stderr 摘要；任一误拦即表示安装态仍按命令文字判定，属于行为回归，按 SMOKE-core-215 的方式回装 |
| SMOKE-core-217 | 安装态阻断矩阵：事前阻断与事后检查生效 | 同 SMOKE-core-216 的临时项目形态（独立新建），另加以下夹具：`.gitignore` 以 `/logos/*` 加例外的形式忽略 `logos/resources/`（模拟 openlogos 本仓形态），并在 `logos/resources/prd/x.md` 预置一个被忽略的规格文件；在 `logos/logos.config.json` 中写入 `guard.exempt: ["docs/"]`（夹具直接写入，不经 CLI），`docs/.gitignore` 已入库；仓库级 `core.autocrlf=true`，另有未跟踪、未被忽略的 `src/crlf.txt`，内容为 CRLF 行尾；仓库级 `filter.up.clean = tr a-z A-Z`，`.gitattributes` 含 `src/up.txt filter=up`，`src/up.txt` 工作区内容为 `hello` 且已提交（索引中为 `HELLO`），提交后 `git status` 干净 | ① Edit `src/a.js`（已跟踪）；② Write `src/new.js`（未跟踪、未被忽略）；③ Write `logos/resources/prd/x.md`；④ Edit `.gitignore`；⑤ Bash `cd <临时项目根> && sed -i.bak 's/a/b/' src/a.js`，走 PreToolUse → 执行 → PostToolUse；⑥ Bash `node -e "require('fs').writeFileSync('src/a.js','y')"`，同上；⑦ Bash `node -e "require('fs').writeFileSync('src/a.js','z');process.exit(3)"`，走 PreToolUse → 执行 → **PostToolUseFailure**；⑧ Bash `git status && node -e "require('fs').writeFileSync('src/a.js','w')"`；⑨ Bash `echo 'src/' >> .git/info/exclude`；⑩ 执行 ⑥ 的反馈给出的恢复命令；⑪ Edit `docs/.gitignore`；⑫ Bash `node -e "require('fs').appendFileSync('.git/config','\\n[alias]\\n  x = status\\n')"`；⑬ Bash `node -e "require('fs').writeFileSync('src/crlf.txt','changed')"`，然后执行反馈给出的恢复命令；⑭ Bash `node -e "require('fs').writeFileSync('src/up.txt','HELLO')"`，记录过滤后的 `git diff --quiet -- src/up.txt` 结果，然后执行反馈给出的恢复命令；⑮ Bash `node -e "require('fs').writeFileSync('src/a.js','X')"` → 执行反馈给出的恢复命令 → 以新的 `tool_use_id` 再次执行完全相同的命令；随后连续发送两次 `Stop` | ①～④ 与 ⑪ 的 PreToolUse 都 exit 2，stdout 含拦截 JSON，stderr 有可读指引；⑪ 证明 exempt 目录内的忽略规则来源仍受保护；⑤⑥ 的 PostToolUse exit 2，⑦ 的 PostToolUseFailure exit 2：反馈列出 `src/a.js` 与变化类型，归因为本次调用，并给出恢复命令（统一为 `node "$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/guard-post-check.cjs" restore <record_id> -- <path>`，不出现 shell 重定向或 `git checkout`）和「回滚或 `openlogos change <slug>` 立案」的下一步；⑧ 不享受 git 豁免，PostToolUse exit 2，反馈提示拆分调用；⑨ 被事后检查发现，变化列表含 `.git/info/exclude`；⑩ `src/a.js` 恢复为 ⑥ 执行前的内容（SHA-256 比对）；⑫ PostToolUse exit 2，变化列表含 `.git/config`；⑬ PostToolUse exit 2，恢复命令为引擎子命令形态，执行后 `src/crlf.txt` 与执行前**逐字节一致**，CRLF 保留；⑭ 过滤后 `git diff` 为空，但 PostToolUse 仍 exit 2，变化列表含 `src/up.txt`；恢复后 `src/up.txt` 原始字节为 `hello`；⑮ 两次相同修改都 PostToolUse exit 2 并列出 `src/a.js`（恢复后再写入视为新的变化事件），恢复命令本身不产生新报告，第二次修改之后的两次 `Stop` 不再重复报告 | 同上；另保留每步前后 `src/a.js`、`src/crlf.txt`、`src/up.txt`、`.git/config` 与 `.git/info/exclude` 的 SHA-256。任一放行都表示写入门禁仍可被绕过，⑬⑭ 字节不一致表示备份或基线经过了内容过滤，⑮ 第二次未报告表示去重吞掉了新的变化事件；两者都属于行为回归，必须回装旧版并回流来源提案 |
| SMOKE-core-218 | 安装态执行记录：缺结束事件时补查并经 Stop 送达 | 同 SMOKE-core-216 的临时项目形态（独立新建） | ① 对 Bash `node -e "require('fs').writeFileSync('src/a.js','late')"` 只发送 PreToolUse，再真实执行命令，**不发送**结束事件；② 发送一次 Write `dist/c.txt` 的 PreToolUse（补查点）；③ 发送 `Stop`；④ 再发送一次 `Stop`；⑤ 读取 `logos/.openlogos-runtime/guard-records/` 下该 `tool_use_id` 对应的记录 | ② exit 0，不阻断当前调用本身；③ exit 2，反馈列出 `src/a.js`；④ exit 0，同一变化事件（路径、原始摘要与事件签名均未变）不重复报告；⑤ 记录仍为 `closed:false`，因为它没有收到执行结束证据 | 同上；另保留 `guard-records/`、`pending-reports.jsonl`、`reported.jsonl` 的快照。③ 不报告表示事后检查在安装态未生效，必须回装 |
| SMOKE-core-219 | 安装态保护范围变更须经宿主原生审批（C14） | 同 SMOKE-core-216 的临时项目形态（独立新建）；Claude Code 托管资产 | 以真实 hook 输入驱动 PreToolUse（`tool_name=Bash`），只调用 hook、不执行命令：① `openlogos exempt add src/`，`permission_mode=default`；② 同一命令，`permission_mode=acceptEdits`；③ 同一命令，`permission_mode` 依次为 `bypassPermissions`、`dontAsk`、`auto`，以及字段缺失；④ `cd <临时项目根> && openlogos ignore add src/`，`permission_mode=default`；⑤ `openlogos ignore add src/ && echo ok`，`permission_mode=default`；⑥ `openlogos exempt list`，`permission_mode=bypassPermissions`；⑦ 在 `logos/.openlogos-runtime/` 下伪造任意形态的「授权」文件（例如以命令原文 SHA-256 命名的 JSON），然后以 `permission_mode=bypassPermissions` 重跑 ①；⑧ 全程前后计算 `logos/logos.config.json` 与 `.gitignore` 的 SHA-256 | ①② exit 0，stdout JSON 为 `hookSpecificOutput.hookEventName=PreToolUse`、`permissionDecision=ask`，`permissionDecisionReason` 含命令原文；③ 每种取值都 exit 2，reason 含当前权限模式，并提示用户用 `! <命令原文>` 自行执行或切换到默认权限模式，且不以对话中的口头同意替代；④ exit 0 且 `permissionDecision=ask`（允许 `cd` 前缀）；⑤ exit 2（复合形态）；⑥ exit 0，不输出 `permissionDecision`（list 不受限）；⑦ 仍 exit 2，伪造文件不起作用；⑧ 两个文件字节都不变 | 同上；任一受限命令在不能弹出审批的权限模式下被放行，或伪造文件改变了结论，都表示门禁可以被「先扩豁免再写代码」绕开，必须回装 |
| SMOKE-core-220 | 安装态 `ignore` / `exempt` 子命令：区块外不变与幂等 | 同 SMOKE-core-216 的临时项目形态（独立新建）；`.gitignore` 区块外含用户条目与注释，使用 CRLF 行尾；`build/out.txt` 已被强制入库 | 以全局 CLI 直接执行（不经 hook）：① `openlogos ignore add coverage/`；② 再执行一次 ①；③ `openlogos ignore add build/`；④ `openlogos ignore remove coverage/`；⑤ `openlogos ignore list --format json`；⑥ `openlogos exempt add docs/notes/`、`openlogos exempt remove logos/resources/reference/`、`openlogos exempt list --format json`；⑦ 在 `.gitignore` 中再追加一个起始标记 `# >>> openlogos managed >>>` 后执行 `openlogos ignore add tmp/`；⑧ 每步前后计算 `.gitignore` 区块外内容与 `logos.config.json` 的 SHA-256 | ① exit 0，托管区块含 `logos/.openlogos-runtime/` 与 `coverage/`，区块外内容逐字节不变，行尾仍为 CRLF；② exit 0，提示「已存在」，`.gitignore` 与 `logos.config.json` 字节都不变；③ exit 0，输出已跟踪文件数量、示例与按实际文件生成的命令 `git --literal-pathspecs rm --cached -- 'build/out.txt'`，`git ls-files build/out.txt` 仍有结果（不代为执行）；④ 区块内不再有 `coverage/`；⑤ `entries` 与配置一致；⑥ 内置默认项先物化再删除，`list` 含 `docs/notes/` 与剩余默认项，不含 `logos/resources/reference/`；⑦ exit 1，`.gitignore` 与 `logos.config.json` 零写入 | 同上；另保留每步 `.gitignore` 与配置的字节。区块外任何字节变化都属于破坏用户内容，必须回装 |
| SMOKE-core-221 | 新建项目 init 与存量项目 sync 后 hook 注册正确 | 本机全局已安装本次候选；三个 `mktemp -d` 一次性临时 git 仓库：P1 空项目；P2 用 `cli/rollback/` 的 `0.15.17` 制品在隔离 prefix 中 init，得到旧版托管资产，`.claude/settings.json` 另含用户自有 PreToolUse 条目，`.cursor/hooks.json` 另含用户自有条目；P3 空项目，用于 Cursor | ① P1 执行全局 `openlogos init`（Claude Code）；② P3 执行全局 `openlogos init --ai-tool cursor`；③ P2 先用旧托管 guard 对 Bash `mkdir -p dist/x` 跑一次 PreToolUse（对照），再执行全局 `openlogos sync`，再跑同一输入；④ P2 连续第二次 `openlogos sync`；⑤ 对 P1、P2 的托管资产各跑一遍 SMOKE-core-216 的 ②④ 与 SMOKE-core-217 的 ①⑥；⑥ 在 P2 中以 hook 输入驱动独立调用 Bash `openlogos sync` 的 PreToolUse → 执行 → PostToolUse | ① P1 的 `.claude/settings.json` 含既有 PreToolUse 条目，含 PostToolUse（matcher `Bash\|PowerShell\|BashOutput\|TaskOutput\|KillShell\|TaskStop`）、PostToolUseFailure（matcher `Bash\|PowerShell`）与 Stop 条目，均为 `node "$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/guard-post-check.cjs" check`（Stop 为 `check --stop`），无 SessionEnd 条目；托管 `guard-check`、`guard-post-check.cjs` 与随包字节一致；`.gitignore` 托管区块含 `logos/.openlogos-runtime/`；② `.cursor/hooks.json` 含 sessionStart、beforeShellExecution、afterFileEdit、afterShellExecution 四个托管事件，`.cursor/hooks/openlogos-guard-post.cjs` 与引擎字节一致；③ sync 前 exit 2（旧判据对照），sync 后 exit 0；托管资产更新为随包字节，用户自有条目逐字节保留；④ 两个 hook 配置文件与 `.gitignore` 字节不变；⑤ 结论与 SMOKE-core-216 / SMOKE-core-217 对应步骤一致；⑥ PostToolUse exit 0，不报告 sync 写入的 `.gitignore` 与 `.gitattributes`（C13） | 同上；另保留 P2 sync 前后各托管文件与 hook 配置的 SHA-256。③ 对照 sync 前即为 exit 0 时，说明 P2 夹具没有装上旧版，矩阵空转，判 FAIL |
| SMOKE-core-222 | Cursor 真实宿主 `afterShellExecution` 反馈渠道实测（人工实测项） | 本机全局已安装本次候选；本机有可执行的真实 Cursor 宿主（cursor-agent CLI 或 Cursor IDE，记录绝对路径与版本）；在一次性临时 git 仓库中经全局 `openlogos init --ai-tool cursor` 建立并置 launched，无 guard 文件；`src/a.js` 已入库 | 由人类操作者在真实宿主的新 session 中执行：① 让 agent 运行 `node -e "require('fs').writeFileSync('src/a.js','x')"`；② 观察宿主界面与 agent 后续行为：反馈是否注入 agent 上下文、是否阻断 agent 后续步骤，或只记录事后报告；③ 读取 `logos/.openlogos-runtime/guard-records/` 中该次调用的记录，确认关联标识形态（宿主调用标识，或 `anonymous:true`）；④ 让 agent 运行 `mkdir -p dist/x`，观察是否无反馈；⑤ 让 agent 运行 `openlogos ignore add src/`，分别在宿主默认模式与自动运行模式下观察宿主是否弹出审批，并记录拒绝审批后命令是否未执行 | ① 后，`afterShellExecution` 被宿主触发，执行记录被创建并完成对比，变化列表含 `src/a.js`；② 实测的反馈渠道与合并后 `spec/cursor-plugin.md` 的声明一致：声明「可注入 agent」的，agent 上下文中出现变化列表；声明「事后报告」的，宿主侧日志或输出中可见报告，且规范没有宣称阻断；③ 关联方式与规范声明一致，没有可靠标识时为匿名记录，不猜测关联；④ 无反馈；⑤ `beforeShellExecution` 返回 `permission: "ask"`；两种模式下宿主都弹出审批，拒绝后 `logos/logos.config.json` 与 `.gitignore` 字节不变。如果自动运行模式下不弹出审批，合并后的 `spec/cursor-plugin.md` 必须已声明该情形改为 deny，且实测为 deny | 人类操作者把宿主版本、session 标识、操作时间、hook stdin/stdout/退出码、截图或宿主日志摘录、`src/a.js` 前后 SHA-256 与结论写入证据文件 `logos/resources/verify/smoke-evidence/SMOKE-core-222.json`，字段为 `operator`、`host`、`host_version`、`observed_channel`、`spec_declared_channel`、`steps[]`、`verdict`。实测与规范声明不一致时判 FAIL，回流来源提案修订 `spec/cursor-plugin.md` 的能力声明，不得通过放宽判据或改写证据放行 |

### 二、执行边界

- SMOKE-core-215～221 的全部读写只在 `mktemp -d` 一次性项目内进行，结束即删除。SMOKE-core-221 中 P2 的旧版资产来自隔离 prefix，不改动本机全局。**不得**触碰本仓活跃提案、`logos/resources/`、用户其他仓库或本机全局 prefix；本节对全局安装态只读。
- SMOKE-core-222 是**人工实测项**：真实宿主交互必须由人类操作者在真实 Cursor 新 session 中完成，以 mock 或直接调用 runtime 冒充宿主的步骤不计入证据。项目同样只用一次性临时仓库，不触碰真实 Cursor 用户配置。
- 命令图中不得出现 `npm publish` / dist-tag / `git tag` / `gh release` / `git push`，本次为本地全局部署。
- 临时仓库的 git 用户名与邮箱只在仓库级配置中设置，不改全局 git 配置。断言中不硬编码主机路径、墙上时钟或本机全局安装现值（通则第 1 条）。SMOKE-core-219 的 10 分钟过期不靠真实等待验证，过期分支由仓库内 UT 覆盖。

### 三、追溯与覆盖

- 根规范：`spec/pretooluse-guard.md`（受保护内容判据、事前轻判与事后检查、执行记录生命周期、独立 git / openlogos 调用豁免、保护范围变更的宿主审批）；`spec/cursor-plugin.md`（`afterShellExecution` 接线、能力分层声明）；`spec/logos.config.schema.json`。
- 场景：S40 版本管理范围配置；S09 launched 无提案时按版本控制内容判定；S08 sync 注册 hook 与分发新 guard；S01 init 托管区块。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.15.18 发布方案（guard 以版本控制内容为保护对象，本地全局）」。
- 验收标准映射（来源提案）：1 → SMOKE-core-216；2、3、4 → SMOKE-core-217、SMOKE-core-218；5 可恢复 → SMOKE-core-217 ⑩；6 CLI 自身写入、保护范围确认、忽略规则来源 → SMOKE-core-219、SMOKE-core-221 ⑥、SMOKE-core-217 ④⑨；7 → SMOKE-core-220；9 → SMOKE-core-221 ②、SMOKE-core-222；10 → SMOKE-core-215、SMOKE-core-221。
- 仓库内对应用例：`core-S09`、`core-S40`、`core-S08`、`core-S01` 测试用例文件中本提案新增的 UT/ST；版本身份 `UT-S19-46` / `UT-S19-49`。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-guard-versioned-content-0-15-18.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-215～SMOKE-core-222，不得依靠通配发现后无条件 PASS。runner 记录全局入口 realpath、安装态版本、每个隔离项目路径、每次 hook 调用的事件名、输入、退出码与 stdout/stderr 摘要（前 200 字），以及相关文件前后的 SHA-256。
- SMOKE-core-222 由 runner 读取证据文件 `logos/resources/verify/smoke-evidence/SMOKE-core-222.json`：文件存在、字段齐全且 `verdict` 为 `pass` 时写 pass；`verdict` 为 `fail` 时写 fail；证据文件缺失或字段不全时写显式 `skip` 记录并携带缺失项。skip 不计为通过，有 skip 时不得写 `SMOKE_PASS`。runner 不得自行生成或改写该证据文件。
- 环境不具备时（缺候选或回滚 tarball、git 不可用）写显式 `skip` 记录并携带缺失项，禁止静默零记录退出。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/evidence`；**失败不得写 pass**。
- runner **不得**以「安装态版本号等于候选」替代行为断言。放行或阻断以 hook 退出码与 stdout 拦截 JSON 判定；字节一致性以 SHA-256 比对，不以「文件存在」代替；事后检查的变化列表以反馈中的路径判定，不解析其余人类可读文案。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-215～SMOKE-core-222 均被 runner 覆盖。

## OpenLogos 0.15.19 提案阶段部署方案检查与 Claude Code 回复语言设置安装态 smoke（SMOKE-core-223～225）

> 这组用例验证两项行为确实进入了本机全局安装态：change-lint L5 的部署方案覆盖判定（功能规格 §2.90），以及 `init` / `sync` 按 `locale` 写入项目 `.claude/settings.json` 的 `language`（功能规格 §2.89）。两项都只有装进全局 CLI 才对用户生效。
>
> 用例在 `mktemp -d` 一次性隔离项目内执行。runner **只读**本机全局安装态，不做安装或卸载，不触碰本仓活跃提案、本仓 `logos/resources/`、用户其他仓库（包括 runlogos）与用户级 `~/.claude/settings.json`。判据用**行为断言**：版本号相等只证明装了新包，不证明行为生效。版本号以计划值 `0.15.19` 为准，实际以部署记录的候选版本为准，断言写成关系式：全局 `--version` == 部署记录版本。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-223 | 安装态版本与制品身份 | 本机全局已安装本次候选；部署记录中有候选版本与 tarball SHA-256 | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并重算 `payloadHash`；③ 在全局包目录中以 Node 动态导入 `dist/commands/init.js` 与 `dist/lib/proposal-lifecycle.js`，读取 `dist/i18n.js` | ① `--version` 等于部署记录版本，入口无 workspace link；② `payloadHash` 自洽，`dist/i18n.js` 的 SHA-256 等于 manifest 对应条目；③ `init.js` 导出 `mergeClaudeLanguageSetting` 与 `CLAUDE_LANGUAGE_BY_LOCALE`（值为 `{ zh: 'chinese', en: 'english' }`），`proposal-lifecycle.js` 导出 `evaluateDeploymentPlanCoverage`，`i18n.js` 含 `init.claudeLanguageCustom` | 保留读取结果。任一不符 → 停止后续流程，按部署方案用 `cli/rollback/miniidealab-openlogos-0.15.18.tgz` 回装全局，并按「失败处置与回滚边界」恢复本仓托管态；不得以「仓内源码已修」了事 |
| SMOKE-core-224 | 安装态 change-lint L5 部署方案覆盖 | 本机全局已安装本次候选；`mktemp -d` 临时目录经全局 `openlogos init --locale zh --ai-tool claude-code` 建立并置 launched；以全局 `openlogos change <slug>` 创建提案，proposal.md 与 tasks.md 填为可通过 L0～L4、L6、L7 的最小形态，「部署影响」为「是否需要部署：是」，`[deploy]` 非空；临时项目 `logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` 含唯一的 `## OpenLogos 9.9.1 发布方案（夹具）` 与两处 `### 本机全局部署` | 每步后执行全局 `openlogos change-lint --slug <slug> --format json`：① 初始形态（无部署方案任务、无 delta、无依据）；② 在 `[delta]` 追加一条含 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` 的任务；③ 撤回 ②，在部署影响段写「- 部署方案依据：OpenLogos 9.9.1 发布方案（夹具）」；④ 把依据改为「本机全局部署」；⑤ 把「是否需要部署」改为「否」并删除 `[deploy]` 与依据；⑥ 在 ① 的形态下执行全局 `openlogos next --format json`；⑦ 全程前后读取 `command -v openlogos` 与 `--version` | ① exit 2，`violations[].code` 含 `deployment_plan_missing`；② exit 0；③ exit 0；④ exit 2，`violations[].code` 含 `deployment_plan_reference_unresolved`；⑤ exit 0，`violations` 无任何部署相关码；⑥ `proposal_step` 不为 `ready-to-delta`；⑦ 入口路径与版本逐字一致 | 同上；另保留每步的 proposal / tasks 字节与 lint JSON。① 通过（exit 0）表示安装态仍是旧 L5，部署方案缺失仍会拖到部署节点才暴露；④ 通过表示引用未逐字唯一定位；均属行为回归，必须回装旧版并回流来源提案 |
| SMOKE-core-225 | 安装态 `init` / `sync` 写入 `language` | 本机全局已安装本次候选；三个 `mktemp -d` 临时目录：P1、P2 空目录；P3 经 `cli/rollback/miniidealab-openlogos-0.15.18.tgz`（部署记录中冻结自全局安装目录、已通过内容身份与旧行为验证的那一份，SHA-256 与记录一致）在一次性隔离 prefix 中以 `--locale zh --ai-tool claude-code` init，得到无 `language` 的旧版设置文件，再加入用户自有 PreToolUse 条目与顶层 `permissions` 键，并预置 `.claude/settings.local.json` 为 `{"language":"japanese"}` | ① P1 执行全局 `openlogos init --locale zh --ai-tool claude-code`；② P2 执行全局 `openlogos init --locale en --ai-tool claude-code`；③ P3 执行全局 `openlogos sync`；④ P3 连续第二次 `openlogos sync`；⑤ P3 把 `.claude/settings.json` 的 `language` 改为 `"japanese"` 后执行 `openlogos sync`；⑥ P3 把 `logos/logos.config.json` 的 `locale` 改为 `en`、`language` 改回 `"chinese"` 后执行 `openlogos sync`；⑦ P3 把 `.claude/settings.json` 改为非法 JSON 后执行 `openlogos sync` | ① `.claude/settings.json` 含 `"language": "chinese"`；② 含 `"language": "english"`；③ 退出码 0，含 `"language": "chinese"`，其它字段的值与用户条目顺序与 sync 前一致；④ `.claude/settings.json` 字节不变；⑤ 值保持 `"japanese"`，stdout 恰有一行含「language 为自定义值」的提示，退出码 0；⑥ 值变为 `"english"`；⑦ 文件字节不变、退出码 0；全程 `.claude/settings.local.json` 字节不变 | 同上；另保留 P1～P3 每步前后 `.claude/settings.json` 与 `.claude/settings.local.json` 的 SHA-256。③ 未写入表示安装态仍为旧版或写入落在 commands 跳过分支之后；⑤ 被覆盖表示自定义值未受保护；均属行为回归，必须回装旧版并回流来源提案 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目与隔离 prefix 内进行，结束即删除。SMOKE-core-225 中 P3 的旧版资产来自隔离 prefix，不改动本机全局。**不得**触碰本仓活跃提案、本仓 `logos/resources/`、用户其他仓库（包括 runlogos）、用户级 `~/.claude/settings.json` 或本机全局 prefix；本节对全局安装态只读。
- 命令图中不得出现 `npm publish` / dist-tag / `git tag` / `gh release` / `git push`，本次为本地全局部署。
- 断言中不硬编码主机路径、墙上时钟或本机全局安装现值（通则第 1 条）；夹具部署方案的版本号 `9.9.1` 只是临时项目内的标题文字，与真实版本无关。

### 三、追溯与覆盖

- 功能规格：§2.89「Claude Code 项目回复语言设置托管」、§2.90「change-lint L5 部署方案覆盖」。
- CLI 交互设计：§2.42「change-lint L5 部署方案覆盖违规体验」。
- 场景：S08「S08 sync 合并 Claude Code 项目回复语言设置时序」、S35「L5 部署方案覆盖判定」。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.15.19 发布方案（提案阶段部署方案检查与 Claude Code 回复语言设置，本地全局）」。
- 验收标准映射（来源提案 deploy-plan-gate-release-0-15-19）：1、2、3 → SMOKE-core-224 ①～④；4 → SMOKE-core-224 ⑤；6 → SMOKE-core-223、SMOKE-core-225。
- 仓库内对应用例：UT-S35-216～UT-S35-224、ST-S35-38～ST-S35-39、UT-S08-79～UT-S08-83、ST-S08-42～ST-S08-43；版本身份 `UT-S19-46` / `UT-S19-49`。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-deploy-plan-gate-0-15-19.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-223～SMOKE-core-225，不得依靠通配发现后无条件 PASS。runner 记录全局入口 realpath、安装态版本、每个隔离项目路径、每次 lint 的 JSON 摘要（`violations[].code`、`path`、`message` 前 200 字）与退出码、每次 sync 的退出码与 stdout 摘要，以及相关文件前后的 SHA-256。
- 环境不具备时（缺候选或回滚 tarball）写显式 `skip` 记录并携带缺失项，禁止静默零记录退出；skip 不计为通过，有 skip 时不得写 `SMOKE_PASS`。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/evidence`；**失败不得写 pass**。
- runner **不得**以「安装态版本号等于候选」替代行为断言。lint 结论以 `--format json` 的 `violations[].code` 与退出码判定，不解析人类可读文案；`language` 以解析后的 JSON 值判定，字节不变以 SHA-256 比对。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-223～SMOKE-core-225 均被 runner 覆盖。

## OpenLogos 0.15.20 verify / smoke / guard 修复与 merge 增量修正安装态 smoke（SMOKE-core-226～230）

> 这组用例验证五项行为确实进入了本机全局安装态：verify 预跑失败进入门禁（功能规格 §2.7、§2.75.1）、smoke 平台不可执行例外（§2.48.5）、guard 非 git 回落逐段判定（根规范 `spec/pretooluse-guard.md`）、merge 增量修正失败文案（§2.84.3）与 merge 增量修正本身（§2.69.4）。它们都只有装进全局 CLI（guard 还需经 sync 分发）才对用户生效。
>
> 用例在 `mktemp -d` 一次性隔离项目内执行。runner **只读**本机全局安装态，不做安装或卸载，不触碰本仓活跃提案、本仓 `logos/resources/` 与用户其他仓库（包括 runlogos）。判据用**行为断言**：版本号相等只证明装了新包，不证明行为生效。版本号以计划值 `0.15.20` 为准，实际以部署记录的候选版本为准，断言写成关系式：全局 `--version` == 部署记录版本。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-226 | 安装态版本与制品身份 | 本机全局已安装本次候选；部署记录中有候选版本与 tarball SHA-256 | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并重算 `payloadHash`；③ 检查全局包内 `dist/lib/merge-amend.js`、`dist/lib/merge-baseline.js` 存在，`dist/commands/verify.js` 含 `pre_run_failed`，`dist/commands/smoke.js` 含 `platform-unavailable`，随包 guard 模板的 SHA-256 等于 manifest 条目 | ① `--version` 等于部署记录版本，入口无 workspace link；② `payloadHash` 自洽；③ 全部成立 | 保留读取结果。任一不符 → 停止后续流程，按部署方案用 `cli/rollback/miniidealab-openlogos-0.15.19.tgz` 回装全局，并按「失败处置与回滚边界」恢复本仓托管态；不得以「仓内源码已修」了事 |
| SMOKE-core-227 | 安装态 verify 预跑失败判 `pre_run_failed` | 本机全局已安装本次候选；临时项目经全局 `openlogos init` 建立，`verify.pre_run_command` 为「写半份结果后非零退出、退出前把结果文件回滚为完整全 pass 旧账本」的运行器，并在 stderr 输出唯一哨兵字符串 | ① 全局 `openlogos verify --format json`；② 读取 `acceptance-report.md`；③ 把运行器改为正常退出并写入完整全 pass 账本后再执行 ① | ① 退出码非零，`gate.result=="FAIL"`、`gate.reason=="pre_run_failed"`，`pre_run.commands[0].stderr_tail` 含哨兵；② 报告不含哨兵；③ `gate.result=="PASS"` | 同上；保留每次 JSON 摘要。① 为 `result_ledger_inconsistent` 或 PASS 表示安装态仍是旧判据，必须回装旧版并回流来源提案 |
| SMOKE-core-228 | 安装态 smoke 平台不可执行例外 | 本机全局已安装本次候选；临时 launched 项目按 S19 夹具口径构造活跃提案的新增 smoke 用例与前置标记；`smoke.command` 指向写入指定结果的 runner | ① runner 为新增用例写 `{status:"skip", reason_code:"platform-unavailable", detail:"requires win32"}`，执行全局 `openlogos smoke --format json`；② 改为不写 `reason_code` 后重跑 | ① `gate.result=="PASS"`，`platform_skipped_cases` 含该用例；② `gate.result=="FAIL"`、`gate.reason=="required_cases_skipped"` | 同上；① FAIL 表示平台不可执行例外未进入安装态 |
| SMOKE-core-229 | 安装态 guard 非 git 回落逐段判定 | 本机全局已安装本次候选；非 git 临时项目经全局 `openlogos init --ai-tool claude-code`、置 launched、全局 `openlogos sync` 部署托管 guard；项目内有 `src/a.ts`、`src/x`；无活跃提案 | 以托管 `.claude/openlogos/bin/guard-check`（cwd 为项目根）逐条喂 PreToolUse hook JSON：`ls && rm -rf src`、`true; rm src/x`、`cd src && rm ../src/a.ts`、`cd "$D" && rm a.ts`、`cd /dev/null && true; rm src/a.ts`、`ls && cat src/x`、`cd src && cat a.ts` | 前五条 exit 2，后两条 exit 0；托管副本与全局包内随包 guard 模板 SHA-256 一致；`src/` 下文件字节不变 | 同上；前三条任一 exit 0 表示安装态 guard 仍按整条命令前缀放行或未推进有效工作目录 |
| SMOKE-core-230 | 安装态 merge 增量修正与修正被拒文案 | 本机全局已安装本次候选；临时 git 项目经全局 `openlogos init`、置 launched、全局 `openlogos change <slug>` 创建含一个 MODIFY 测试规格 delta 的提案，plan 已批准 | ① 全局 `openlogos merge <slug> --format json` 并提交；② 再次执行；③ 修改 delta 后执行全局 `openlogos status --format json` 与 `openlogos merge <slug> --format json`；④ 再修改 delta，并手工改动一个已应用目标，执行 merge | ① `result=="merged"`；② `result=="already-merged"`；③ `spec_amend.pending==true` 后 merge `result=="amended"`；④ 非零退出 `MERGE_AMEND_DRIFT`，stderr 含「未进入修正写入」，stderr 与 JSON 错误 message 均不含 `git checkout logos/resources/` | 同上；保留每步 stdout / stderr 与 `SPEC_MERGED`。③ 返回 `already-merged` 或 ④ 含回滚建议表示行为未进入安装态 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目内进行，结束即删除。**不得**触碰本仓活跃提案、本仓 `logos/resources/`、用户其他仓库（包括 runlogos）或本机全局 prefix；本节对全局安装态只读。
- 命令图中不得出现 `npm publish` / dist-tag / `git tag` / `gh release` / `git push`，本次为本地全局部署。
- 断言中不硬编码主机路径、墙上时钟或本机全局安装现值（通则第 1 条）。

### 三、追溯与覆盖

- 功能规格：§2.7、§2.75.1、§2.48.5、§2.84.3「增量修正路径的状态声明」、§2.69.4。
- 根规范：`spec/pretooluse-guard.md`「Bash 非 git 回落的复合命令逐段判定」。
- 场景：S13 EX-9.1、S19 EX-19.7 / EX-19.8、S09-F EX-9F.32～EX-9F.38、S09 EX-9.47、S11「已合并提案的增量修正只读投影」。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.15.20 发布方案（verify / smoke / guard 修复与 merge 增量修正，本地全局）」。
- 验收标准映射（来源提案 verify-smoke-guard-fixes-0-15-20）：1、2 → SMOKE-core-227；4 → SMOKE-core-228；5 → SMOKE-core-229；6 → SMOKE-core-230 ④；7 → SMOKE-core-226。merge 增量修正 → SMOKE-core-230 ①～③。
- 仓库内对应用例：UT-S13-81～UT-S13-88、ST-S13-23～ST-S13-24、UT-S19-51～UT-S19-56、ST-S19-23～ST-S19-24、UT-S09-448～UT-S09-458、ST-S09-202～ST-S09-204；版本身份 `UT-S19-46` / `UT-S19-49`。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-verify-smoke-guard-0-15-20.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-226～SMOKE-core-230，不得依靠通配发现后无条件 PASS。runner 记录全局入口 realpath、安装态版本、每个隔离项目路径、每次命令的退出码与 JSON 摘要，以及相关文件前后的 SHA-256。
- 环境不具备时（缺候选或回滚 tarball、缺 git）写显式 `skip` 记录并携带缺失项，禁止静默零记录退出；这些都是可补齐的环境缺口，**不得**标 `reason_code:"platform-unavailable"`。有 skip 时不得写 `SMOKE_PASS`。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/evidence`；**失败不得写 pass**。
- 判据以 `--format json` 的结构化字段、退出码与 SHA-256 为准，不解析人类可读文案（SMOKE-core-230 ④ 的文案断言只针对固定短语与「不含回滚建议」）。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-226～SMOKE-core-230 均被 runner 覆盖。

## OpenLogos 0.16.0 公开发布 smoke（SMOKE-core-231～234）

> 这组用例验证首次公开发布的三处公网制品——npm registry、GitHub Release、Cloudflare Pages 官网——确实同源于本次实际发布版本 V，并且从公网安装的包可以正常使用。在案用例（SMOKE-core-01 / 02 / 04 / 07 / 08 / 15）面向本地 tarball 或本地预览，都不能证明 registry 上的包可装可用，所以本组只补这一层，其余复用在案用例。
>
> **版本口径**：V 为部署记录中实际成功发布的版本，初始为 `0.16.0`；按部署方案档 B2 前滚时，V 为前滚后的 patch。断言一律写成关系式（如「registry `dist-tags.latest` == V」「Release 附件 SHA-256 == registry tarball SHA-256」），不硬编码 `0.16.0`。V 与 `v<V>` 指向的提交从部署记录读取；缺失即 skip 并写明缺失项。
>
> **执行边界**：runner 对公网**只读**——只用 `npm view`、`npm pack <spec>`（下载到临时目录）、`gh release view` / `gh release download`、`gh api`、HTTP GET。不执行 `npm publish`、`npm dist-tag`、`npm deprecate`、`git tag`、`git push`、`gh release create/edit/upload` 或 `wrangler`。安装态用例只装到 `mktemp -d` 一次性 prefix，不触碰本机全局 prefix、本仓活跃提案与用户其他仓库（包括 runlogos）。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-231 | registry 发布身份与 provenance | `v<V>` 的 publish run 中 `Publish` 步骤 success（原 run 全绿，或部署方案档 C 已完成补做）；部署记录有 V 与 tag 提交号 | ① `npm view @miniidealab/openlogos dist-tags --json`；② `npm view @miniidealab/openlogos@<V> version gitHead dist.integrity dist.attestations --json`，并读取 `dist.attestations.url` 指向的证明；③ `npm pack @miniidealab/openlogos@<V>` 到临时目录并解包；④ 对照 tag 提交的 `cli/src/` 文件清单（`git ls-tree -r v<V> -- cli/src`）检查包内 `dist/**/*.js` | ① `latest` == V，`old` 不变；② `version` == V；SLSA provenance（predicate `https://slsa.dev/provenance/v1`）的 `resolvedDependencies[0].uri` 指向 `refs/tags/v<V>`，`digest.gitCommit` == `v<V>` 提交（tarball 发布不写 `gitHead`，来源提交以 provenance 为准；`gitHead` 存在时须同样相等）；③ 包内 `package.json` 版本 == V，asset-manifest 版本 == V 且 `payloadHash` 自洽、全部条目经 `validateAssetManifest` 校验通过，随包 guard 模板 SHA-256 == manifest 条目；④ 每个 `dist/**/*.js` 都有同名 `cli/src/**/*.ts`，不含 `dist/lib/authority-closure.js` 等已删除源码的产物 | 保留读取结果与 tarball SHA-256。①② 不符 → 按部署方案档 D 回退（`dist-tag latest` 回指 0.13.24、`npm deprecate <V>`）；③④ 不符表示公网制品与预演不同源，同样按档 D 处置并另立修复提案前滚 |
| SMOKE-core-232 | registry 隔离安装态可用 | SMOKE-core-231 通过；本机有 node、npm、git | ① `npm install -g --prefix <tmp> @miniidealab/openlogos@<V>`（从 registry 安装）；② `<tmp>/bin/openlogos --version`；③ 临时目录执行 `openlogos init smoke --locale zh --ai-tool all`；④ 在 ③ 项目内执行 `openlogos sync`；⑤ 另建临时项目 `init --locale en --ai-tool claude-code` 后 `sync`，比对托管 `.claude/openlogos/bin/guard-check` 与包内随包模板；⑥ `openlogos status --format json` | ① 退出码 0，入口 realpath 在 `<tmp>` 包目录内且非链接；② == V；③ 退出码 0，生成 `logos/` 与各工具资产（SMOKE-core-02 口径）；④ 退出码 0，输出不含 `asset hash 不匹配`；⑤ 两者 SHA-256 一致；⑥ 输出合法 JSON envelope，`version` == V | 保留各步 stdout / stderr。任一失败 → 按档 D 回退，并另立修复提案前滚；④ 失败表示 asset-manifest 与公网包不一致（干净构建缺陷复发） |
| SMOKE-core-233 | GitHub Release 与 registry 同源 | SMOKE-core-231 通过；`gh` 已认证 | ① `gh release view v<V> --json tagName,isDraft,isPrerelease,body,assets`（`gh release view` 没有 latest 字段，latest 身份由 ② 的 latest endpoint 判定）；② `gh api repos/{owner}/{repo}/releases/latest --jq .tag_name`；③ `gh release download v<V> --pattern 'miniidealab-openlogos-*.tgz'` 到临时目录；④ 按 `publish.yml`「Prepare release notes」同规则，从 `v<V>` 提交的 `CHANGELOG.md` 提取 `## [V]` 节 | ① 存在，非 draft、非 prerelease；② == `v<V>`（非 latest 的有效 Release 在此失败，不得归为缺 Release）；③ 恰一个附件 `miniidealab-openlogos-<V>.tgz`，SHA-256 == SMOKE-core-231 记录的 registry tarball SHA-256；④ Release 正文与提取结果去首尾空白后逐字一致，且含「从 0.13.x 升级」与 `openlogos sync` 指引 | 保留 Release JSON 与附件 SHA-256。缺 Release 或缺附件 → 按部署方案档 C 受控补做（不重复 create）；附件与 registry 不同源 → 以 registry 制品为准替换附件并在部署记录说明 |
| SMOKE-core-234 | 官网 latest 等于 V、英文摘要在场、改名资源可访问 | 官网已由 publish run 或档 C 补做部署到 Cloudflare Pages | ① GET `https://openlogos.ai/releases` 与 `https://openlogos.ai/zh/releases`；② GET 首页 `https://openlogos.ai/`，取最近发布入口；③ GET `https://openlogos.ai/runlogos` 与 `https://openlogos.ai/zh/runlogos`，提取数据库编辑器面板 `<img>` 的 `src`；④ GET ③ 中的图片 URL；⑤ GET 旧路径 `/runlogos/4.db-editor(sqllite:postgresql:mysql).jpg` | ① 均为 200，页面 latest 版本 == V（SMOKE-core-15 口径），V 条目展示英文价值摘要（不是固定回退提示）及中文原文次级内容（SMOKE-core-07 口径）；② 入口指向 `/releases` 且非 404（SMOKE-core-08 口径）；③ 两页 `src` 均为改名后的 `/runlogos/4.db-editor.sqlite-postgresql-mysql.jpg`，不含 `:`；④ 200 且 `content-type` 为 `image/jpeg`；⑤ 不要求可访问（旧路径仅作记录） | 保留 HTTP 状态码与页面摘录。① latest 不等于 V 时，先确认 registry `dist-tags.latest` 已是 V；若是，则按档 C 重新生成并部署官网，不得手改 `releases.json`。③④ 失败 → 修复引用后经官网部署前滚（不涉及 npm） |

### 二、复用的在案用例

以下在案用例沿用其原定义，本次只规定执行对象（定义不在本节重复登记）：

- 版本用例 SMOKE-core-01：以 SMOKE-core-232 的隔离 prefix 入口执行，`openlogos --version` == V。
- init 资产用例 SMOKE-core-02：以 SMOKE-core-232 ③ 的 `init smoke --locale zh --ai-tool all` 结果核对 `logos/resources/reference/` 六个子目录。
- 插件模板用例 SMOKE-core-04：以 SMOKE-core-231 ③ 解包的 registry tarball 核对 Claude Code、OpenCode、Codex 插件模板在场。
- 发布动态双语摘要用例 SMOKE-core-07：以 SMOKE-core-234 ① 的 `/releases` 页面执行。
- 首页入口用例 SMOKE-core-08：以 SMOKE-core-234 ② 执行。
- tag 与官网一致用例 SMOKE-core-15：以 SMOKE-core-234 ① 的 latest 版本断言执行，tag 版本取 V。

### 三、执行边界

- 公网只读（见本节导言）；命令图中不得出现发布写操作。
- 安装态只装到 `mktemp -d` 一次性 prefix，结束即删除；本机全局切换属部署方案「发布后同步」，不在 smoke 内执行。
- 断言不硬编码主机路径、墙上时钟、本机全局安装现值或 `0.16.0` 字面量（发布前检查通则第 1 条）；V、tag 提交号与 registry tarball SHA-256 运行时读取并在用例间传递。
- 网络不可达、`gh` 未认证、部署记录缺 V 时写显式 `skip` 并携带缺失项。这些都是可补齐的环境缺口，**不得**标 `reason_code:"platform-unavailable"`；有 skip 时不得写 `SMOKE_PASS`。

### 四、追溯与覆盖

- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.0 公开发布方案（npm / GitHub Release / 官网）」，以及 §一、§七、§十一。
- 来源提案：release-0-16-0（决策 C01～C07）。
- 覆盖关系：
  - registry 身份 → SMOKE-core-231；
  - 公网安装可用、干净构建缺陷不复发 → SMOKE-core-232；
  - GitHub Release 同源 → SMOKE-core-233；
  - 官网 latest、英文摘要与 Windows 非法文件名改名 → SMOKE-core-234；
  - 版本、init 资产、插件模板、官网入口 → 复用的 SMOKE-core-01 / 02 / 04 / 07 / 08 / 15。

### 五、自动化与证据要求

- 新增 runner `scripts/smoke-public-release-0-16-0.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-231～SMOKE-core-234 及上表复用用例，不得依靠通配发现后无条件 PASS。
- runner 提供自测模式：注入本地 tarball 替代 registry 规格、注入本地预览 URL 替代官网域名，并把结果写入独立账本。自测结果不得写入项目正式 smoke 账本。正式模式拒绝注入。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/evidence`；evidence 记录 V、tag 提交号、registry tarball SHA-256、Release 附件 SHA-256、HTTP 状态码与隔离 prefix 路径。**失败不得写 pass**。
- 判据以 JSON 字段、退出码、SHA-256 与 HTTP 状态码为准；页面断言只针对版本号、固定路径与是否为回退提示，不解析其余人类可读文案。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-231～SMOKE-core-234 均被 runner 覆盖。

## 官网文档 0.16.0 补齐发布后 smoke（SMOKE-core-235～238）

> 这组用例验证官网文档站（中英文）在生产环境已经反映 0.16.0 的实际行为，分四个层面：
> - 新增页面与 CLI 参考覆盖 0.16.0 命令面（235）；
> - 全站不再以现行操作的口吻呈现旧指引（236）；
> - 宿主适配内容与 CLI 枚举一致（237）；
> - 升级指南内容完整（238）。
>
> 发布动态、中文路由与字体用复用的在案用例确认不受影响。
>
> **执行对象**：正式模式固定为生产域名 `https://openlogos.ai`。下文 `<base>` 指该域名。自测模式下 `<base>` 为本地预览 URL（`cd website && npm run preview`）。
>
> **URL 重定位**：站点 `site` 固定为 `https://openlogos.ai`（`website/astro.config.mjs`），所以 sitemap 索引、子 sitemap 与页面 `<loc>` 都是生产绝对 URL。runner 读取这些 URL 和页面内的站内链接时：
> - 凡 origin 为 `https://openlogos.ai` 的，保留 pathname 与 query，把 origin 改写为 `<base>` 的 origin 后再请求；
> - 其他 origin 的 URL 不请求，只记入 evidence。
>
> 正式模式下 `<base>` 就是生产 origin，改写不改变任何地址。两种模式都要逐条记录实际请求 URL，并断言每条的 origin 都等于 `<base>` 的 origin。出现任何一条去往其他 origin 的实际请求，当次所有用例判 fail，不得把生产内容当作候选构建的自测结果。
>
> **命令面口径**：命令集合不硬编码，运行时从已安装 CLI 的 `openlogos --help` 的 Commands 段解析顶层命令。另外补入 `slice`：help 漏列 `slice` 是已知 CLI 缺陷（来源提案 K4），但 `cli/src/index.ts` 实际分派该命令。
>
> **执行边界**：runner 对公网**只读**，只发 HTTP GET 并在本机执行 `openlogos --help`。不执行 `wrangler`、`npm publish`、`git tag`、`git push` 或任何写操作。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-235 | 新增页面与 CLI 参考覆盖 0.16.0 命令面 | 官网已按部署方案「OpenLogos 0.16.0 官网文档补齐发布检查」部署；本机已安装 0.16.0 CLI | ① 解析 `openlogos --help` 得到顶层命令集合 C，补入 `slice`，去掉 `baseline-seed`（由 Skill 页承载，见 ④），并按固定映射得到页面 slug：`index`→`index-command`、`flow show`→`flow-show`、`feature list` 与 `feature-backfill`→`feature`、`ignore` 与 `exempt`→`ignore-exempt`，其余同名；② 对每个 slug GET `<base>/cli/<slug>` 与 `<base>/zh/cli/<slug>`；③ GET `<base>/cli` 与 `<base>/zh/cli`，提取侧边栏与命令表中的 `/cli/…` 链接；④ GET 新增的非 CLI 页面：`/specs/pretooluse-guard`、`/specs/test-slice-manifest`、`/skills/brownfield-adopter`，以及各自的 `/zh/` 版本；⑤ 从 `<base>/cli`、`<base>/cli/verify`、`<base>/cli/smoke`、`<base>/cli/deploy-done` 及其中文页提取「Gate x.y」编号 | ① C 非空且包含 `change-lint`、`lint-specs`、`ignore`、`exempt`、`impact`、`slice`；② 每个页面均返回 200，正文包含 `openlogos <命令名>`（`ignore-exempt` 页同时包含 `openlogos ignore` 与 `openlogos exempt`；`feature` 页同时包含 `feature list` 与 `feature-backfill`）；③ 中英文概览页的侧边栏与命令表都链接到 ② 中的全部 slug，没有遗漏；④ 全部返回 200，`skills/brownfield-adopter` 中英文页正文包含 `openlogos baseline-seed`；⑤ 对同一命令，概览页与命令页标注的 Gate 编号一致，中英文一致 | 保留每个 URL 的状态码与缺失项清单。缺页或缺链接时补写 `website/` 源码，重走部署方案发布前检查后重新部署；页面出现异常内容时，先按部署方案在 Cloudflare Pages 回滚 |
| SMOKE-core-236 | 中英文全站不再以现行操作呈现旧指引 | 同 SMOKE-core-235 | ① GET `<base>/sitemap-index.xml` 及其引用的子 sitemap，按本节「URL 重定位」规则得到全站页面 URL 集合 P；② 对 P 中每个页面 GET，先解析 DOM，记录每段文本所属的 `article.release-card` 容器及其版本标题（`.release-title h3`），再去掉 `<script>` 与 `<style>`，按 h2 / h3 标题切成小节；③ 在正文中检索关键词集合 K = `MERGE_PROMPT`、`merge-apply`、`merge transaction`、`.cursor/rules`、`Layer 1`、`Layer1`、`Layer 3`、`Layer3`、`Design-time Coverage`、`Acceptance Criteria Traceability`、`git checkout logos/resources`；④ 正向断言：GET `/skills/code-implementor`、`/cli/merge` 及其中文页 | ③ 每条命中只属于以下允许情况：<br>• 位于升级指南页（`/getting-started/upgrade-from-0-13` 及中文页）；<br>• 位于 `/cli/sync`、`/cli/merge` 及其中文页标题为「从旧版迁移」/ "Migrating from earlier versions" 的小节内；<br>• 位于 `/deep-dive/engineering-foundation` 及中文页，且关键词为 `Layer 1` / `Layer 3`；<br>• **发布历史**：位于 `/releases` 或 `/zh/releases`（路径比较忽略末尾 `/`），且命中文本在某个 `article.release-card` 容器内，该容器的 `.release-title h3` 文本匹配 `^v\d+\.\d+\.\d+`。这些是带版本标识的历史记录，不是当前使用指引。同一页面中位于任何版本卡片之外的命中（页首、安装说明、侧栏等）仍判 fail。<br>其余任何命中都判 fail。④ `code-implementor` 中英文页都包含「initial」与「launched」两种情形的说明，并写明 launched 下逐行消费 `[code]` 切片、不自行分批（中文含「不得自行」或「不自行」，英文含 "must not re-batch" 或 "not re-split"），英文页同时包含 `slice-planner`；`cli/merge` 中英文页都包含增量修正标识 `amended`，并写明一次调用完成合并（中文含「一次」，英文含 "single call" 或 "one call"） | 保留命中清单（URL、小节标题、关键词、上下文 80 字符）。命中不在允许范围内时，修正对应页面后重新部署；不得通过扩大允许范围来让用例通过，扩大范围须另立变更；也不得为了通过本用例删改发布历史摘要（`website/src/data/releases.json`、`release-summaries-en.mjs`、`CHANGELOG.md` 历史条目） |
| SMOKE-core-237 | 宿主适配内容与 CLI 枚举一致 | 同 SMOKE-core-235 | ① 从 `openlogos --help` 的 `init` 段解析 `--ai-tool <…>` 的取值集合 A；② GET `<base>/cli/init` 与 `<base>/zh/cli/init`；③ GET `/specs/zcode-plugin`、`/specs/qoder-plugin`、`/specs/workbuddy-plugin`、`/specs/cursor-plugin` 及其中文页；④ GET `<base>/`、`<base>/zh/`、`<base>/about`、`<base>/zh/about`；⑤ GET `/cli/sync` 与 `/zh/cli/sync` | ① A 包含 `claude-code`、`opencode`、`codex`、`cursor`、`zcode`、`qoder`、`workbuddy`、`other`、`all`；② 两页都包含 A 中的每一个取值；③ 全部返回 200，`cursor-plugin` 中英文页包含 `.cursor/skills/` 与 `afterShellExecution`；④ 四个页面都包含 Claude Code、OpenCode、Codex、Cursor、ZCode、Qoder、WorkBuddy 七个工具名；⑤ 两页都包含 `.cursor/skills/` 与 `language` | 保留缺失的取值或工具名清单。补写页面后重新部署 |
| SMOKE-core-238 | 中英文升级指南可达且内容完整 | 同 SMOKE-core-235 | ① GET `<base>/getting-started/upgrade-from-0-13` 与 `<base>/zh/getting-started/upgrade-from-0-13`；② GET `<base>/getting-started` 与 `<base>/zh/getting-started`，提取侧边栏链接；③ 在 ① 两页正文中逐项检索 CHANGELOG 0.16.0「从 0.13.x 升级」各步的判据标记 | ① 均返回 200；② 两种语言的「快速开始」侧边栏分组都链接到对应语言的升级指南；③ 两页**各自**包含全部判据，缺任一项即 fail：<br>• 全局更新 CLI：`npm install -g @miniidealab/openlogos@latest`；<br>• 确认版本：`openlogos --version` 与 `0.16.0`；<br>• 逐项目 sync：`openlogos sync`，且写明在每个已有项目根目录执行（中文含「每个已有项目」，英文含 "each existing project"），并写明不执行的后果（中文含「旧版 guard」，英文含 "old guard"）；<br>• Cursor 迁移：同时包含 `.cursor/rules/` 与 `.cursor/skills/`；<br>• 事务命令移除：包含 `openlogos merge`、`openlogos slice plan`，以及 `merge transaction` 或 `merge-apply` 之一；<br>• JSON 消费方：包含 `data.contract.version` | 保留每种语言缺失的判据清单。补写升级指南后重新部署。判据标记与 CHANGELOG 0.16.0「从 0.13.x 升级」节逐项对应；该节变化时同步更新本用例 |

### 二、复用的在案用例

以下在案用例沿用其原定义，本次只规定执行对象（定义不在本节重复登记）：

- 发布动态双语摘要用例 SMOKE-core-07：对 `<base>/releases` 执行，并确认 latest 仍为 0.16.0。
- 首页入口用例 SMOKE-core-08：对 `<base>/` 执行。
- 中文路由与语言切换用例 SMOKE-core-21：对 `<base>/zh`、`<base>/zh/getting-started`、`<base>/zh/cli` 及新增的 `<base>/zh/cli/slice` 执行。
- 中文字体用例 SMOKE-core-23：对已部署站点执行。从中文营销页与中文文档页的 CSS 提取 `NotoSansSC-*.subset.woff2` 引用，逐个 GET，确认返回 200 且体积非空。

### 三、执行边界

- 公网只读（见本节导言）；命令图中不得出现部署或发布写操作。
- 断言不硬编码主机路径、墙上时钟或部署 ID。命令集合与 `--ai-tool` 取值从已安装 CLI 运行时读取。部署 URL 与部署 ID 从 `logos/resources/verify/deployment-report.md` 读取，只写入 evidence，不参与判定。
- 判据以 HTTP 状态码、链接集合与固定判据标记的出现与否为准，不解析其余人类可读文案。
- 网络不可达、本机未安装 CLI、部署记录缺失时写显式 `skip` 并带缺失项。这些都是可补齐的环境缺口，**不得**标 `reason_code:"platform-unavailable"`；有 skip 时不得写 `SMOKE_PASS`。

### 四、追溯与覆盖

- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.0 官网文档补齐发布检查」，以及 §十一、§十五。
- 来源提案：website-docs-0-16-0（决策 C01、C02；事实核对点 K1～K4；旧指引残留检索规则）。
- 覆盖关系：
  - 新增页面、CLI 命令面、Gate 编号一致 → SMOKE-core-235；
  - 旧合并流程、Cursor 旧路径、verify 旧判据、launched 下自行分批的残留 → SMOKE-core-236；
  - 七个宿主、`--ai-tool` 枚举、Cursor Skills 迁移 → SMOKE-core-237；
  - 升级指南五步 → SMOKE-core-238；
  - 发布动态、首页入口、中文路由、中文字体不受影响 → 复用的 SMOKE-core-07 / 08 / 21 / 23。

### 五、自动化与证据要求

- 新增 runner `scripts/smoke-website-docs-0-16-0.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行。runner 显式分派 SMOKE-core-235～SMOKE-core-238 及上表复用用例，不得依靠通配发现后无条件 PASS。
- **自测模式**：runner 可注入本地预览 URL 替代 `https://openlogos.ai`，结果写入独立账本，不得写入项目正式 smoke 账本。正式模式拒绝注入。
- **重定位自证**：自测模式的 evidence 必须包含实际请求 URL 清单，且清单中每条的 origin 都等于注入的预览 origin（见导言「URL 重定位」）。
- **判据对照夹具**：runner 自带三份 HTML 夹具，自测时先跑判据对照，再跑真实页面：
  - 夹具 A：`/releases` 页，`MERGE_PROMPT.md` 与 `.cursor/rules/` 只出现在 `<article class="release-card">` 内，且该卡片标题为 `<h3>v0.9.19</h3>`。预期 SMOKE-core-236 判据**通过**。
  - 夹具 B：当前使用指引页（如 `/cli/merge`），在「从旧版迁移」小节之外以操作步骤写出「读取 `MERGE_PROMPT.md` 并执行合并」。预期判据**失败**。
  - 夹具 C：同样的旧词出现在 `/releases` 页、但位于任何版本卡片之外，也预期失败。
  - 任一夹具结果与预期不符，runner 自身即判 fail，不进入真实页面检查。
- **结果记录**：结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条记录，字段含 `id/status/timestamp/duration_ms/environment/evidence`。evidence 记录：
  - `<base>`、部署 URL / 部署 ID（取自部署记录）；
  - 每个检查 URL 的状态码；
  - 缺失项或命中清单。
- **失败不得写 pass**。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-235～SMOKE-core-238 均被 runner 覆盖。

## OpenLogos 0.16.1 沙箱复用安装态 smoke（SMOKE-core-239～241）

> 这组用例验证 verify / smoke 沙箱复用（功能规格 §2.91）确实进入了本机全局安装态。沙箱复用是 CLI 运行时行为，只有全局 `openlogos` 升级后才对用户的各项目生效。
>
> 用例在 `mktemp -d` 一次性隔离项目与一次性 `sandbox_root` 内执行。runner **只读**本机全局安装态，不做安装或卸载，不触碰本仓活跃提案、本仓 `logos/resources/`、本仓配置的沙箱根与用户其他仓库（包括 runlogos）。判据用**行为断言**：版本号相等只证明装了新包，不证明行为生效。版本号以计划值 `0.16.1` 为准，实际以部署记录的候选版本为准，断言写成关系式：全局 `--version` == 部署记录版本。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-239 | 安装态版本与制品身份 | 本机全局已安装本次候选；部署记录中有候选版本与 tarball SHA-256 | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并重算 `payloadHash`；③ 检查全局包内 `dist/lib/sandbox.js` 含 `openlogos-cli-sandbox-reuse-` 与 `sync-manifest.json`，`dist/index.js` 注册 `--fresh-sandbox` | ① `--version` 等于部署记录版本，入口无 workspace link；② `payloadHash` 自洽；③ 全部成立 | 保留读取结果。任一不符 → 停止后续流程，按部署方案用 `cli/rollback/miniidealab-openlogos-0.16.0.tgz` 回装全局；不得以「仓内源码已修」了事 |
| SMOKE-core-240 | 安装态 verify 复用沙箱的增量收益与内容正确性 | 本机全局已安装本次候选；临时项目经全局 `openlogos init` 建立，按 ST-S13-25 夹具口径配置模拟增量编译器（N=20 个源文件）、`sandbox_mode=auto`、`sandbox_root` 为一次性目录、`sandbox_cache_paths=["build-cache"]` | ① 全局 `openlogos verify --format json`；② 改 1 个源文件后再执行；③ 不改动再执行；④ 把另一个源文件等长改写并以 `utimes` 恢复原 mtime 后再执行，编译器同时输出该文件内容 | 四次 `gate.result=="PASS"`；① `compiled=20`、`reuse.state=="created"`；② `compiled=1`、`reused`；③ `compiled=0`、`reused`，四次 `reuse.dir` 相同；④ `compiled=1` 且输出的是等长改写后的新内容 | 同上；保留每次 JSON 摘要。② ③ 为 `compiled=20` 表示安装态仍是一次性沙箱；④ 输出旧内容表示同步漏判，必须回装旧版并回流来源提案 |
| SMOKE-core-241 | 安装态 `--fresh-sandbox`、关闭复用与 smoke 共用 | 本机全局已安装本次候选；沿用 SMOKE-core-240 的临时项目，另按 S19 夹具口径补齐 smoke 前置标记与 runner | ① 全局 `openlogos verify --fresh-sandbox --format json`；② 全局 `openlogos smoke --format json`；③ 置 `verify.sandbox_reuse=false` 后执行 verify；④ 置 `verify.sandbox_mode=off` 后执行 verify | ① `reuse.state=="fresh"`、`compiled=20`；② smoke `reuse.dir` 与 ① 相同、`state=="reused"`；③ `state=="disabled"`、`compiled=20`，`sandbox.root` 指向的一次性目录运行后不存在；④ 不出现 `sandbox.reuse`；各步门禁结论与对应输入一致 | 同上；③ ④ 行为偏离表示零回归被破坏，回装旧版并回流来源提案 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目与一次性 `sandbox_root` 内进行，结束即删除（含持久沙箱项目目录）。**不得**触碰本仓活跃提案、本仓 `logos/resources/`、本仓配置的沙箱根 `/Volumes/BuildWork/openlogos-sandbox`、用户其他仓库（包括 runlogos）或本机全局 prefix；本节对全局安装态只读。
- 命令图中不得出现 `npm publish` / dist-tag / `git tag` / `gh release` / `git push`，本次为本地全局部署。
- 断言中不硬编码主机路径、墙上时钟或本机全局安装现值（通则第 1 条）。

### 三、追溯与覆盖

- 功能规格：§2.91。
- 根规范：`spec/cli-json-output.md`「verify / smoke `sandbox.reuse` 沙箱复用字段」。
- 场景：S13「S13 沙箱复用与增量同步时序」EX-3.5、EX-3.9、EX-3.12；S19「smoke 沙箱复用」。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.1 发布方案（verify / smoke 沙箱复用，本地全局）」。
- 验收标准映射（来源提案 verify-sandbox-reuse-0-16-1）：1、3 → SMOKE-core-240 ①～③；2 → SMOKE-core-240 ④；6、7 → SMOKE-core-241；8 → SMOKE-core-239。验收标准 4、5（隔离不变量、锁交错与非正常退出）依赖测试钩子与进程注入，由仓库内 UT-S13-95～UT-S13-98 覆盖，不在安装态重复。
- 仓库内对应用例：UT-S13-89～UT-S13-100、ST-S13-25、UT-S19-57；版本身份 `UT-S19-46` / `UT-S19-49`。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-sandbox-reuse-0-16-1.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-239～SMOKE-core-241，不得依靠通配发现后无条件 PASS。runner 记录全局入口 realpath、安装态版本、每个隔离项目路径、每次命令的退出码与 JSON 摘要（含 `sandbox.reuse`）。
- 环境不具备时（缺候选 tarball 或部署记录）写显式 `skip` 记录并携带缺失项，禁止静默零记录退出；这些都是可补齐的环境缺口，**不得**标 `reason_code:"platform-unavailable"`。有 skip 时不得写 `SMOKE_PASS`。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/evidence`；**失败不得写 pass**。
- 判据以 `--format json` 的结构化字段、退出码与命令实际输出为准，不解析人类可读文案。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-239～SMOKE-core-241 均被 runner 覆盖。

## OpenLogos 0.16.1 公开发布 smoke（SMOKE-core-242～245）

> 这组用例验证 0.16.1 公开发布的三处公网制品——npm registry、GitHub Release、Cloudflare Pages 官网——同源于本次实际发布版本 V，并且从公网安装的包可以正常使用、具备沙箱复用能力。判据沿用「OpenLogos 0.16.0 公开发布 smoke（SMOKE-core-231～234）」的口径，只替换版本、发布说明与官网资源的断言对象；0.16.0 那组用例保持原定义，不复用其 ID。
>
> **版本口径**：V 为部署记录中实际成功发布的版本，初始为 `0.16.1`；按部署方案档 B2 前滚时为前滚后的 patch。V 与 tag 提交号从部署记录 `logos/resources/verify/deployment-report.md` 中**标题含 `release-0-16-1` 的那一节**的 `public_release_version: <V>` / `public_release_commit: <sha>` 两行读取（同文件内 0.16.0 的同名行不得被误读）；提交号缺省时取 `git rev-parse v<V>^{commit}`。断言一律写成关系式，不硬编码 `0.16.1`；缺 V 或缺提交号时写显式 skip 并带缺失项。
>
> **执行边界**：runner 对公网**只读**——只用 `npm view`、`npm pack <spec>`（下载到临时目录）、`gh release view` / `gh release download`、`gh api`、HTTP GET。不执行 `npm publish`、`npm dist-tag`、`npm deprecate`、`git tag`、`git push`、`gh release create/edit/upload` 或 `wrangler`。安装态用例只装到 `mktemp -d` 一次性 prefix 与一次性 `sandbox_root`，不触碰本机全局 prefix、本仓活跃提案、本仓配置的沙箱根与用户其他仓库（包括 runlogos）。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-242 | registry 发布身份与 provenance | `v<V>` 的 publish run 中 `Publish` 步骤 success（原 run 全绿，或部署方案档 C 已完成补做）；部署记录有 V 与 tag 提交号 | ① `npm view @miniidealab/openlogos dist-tags --json`；② `npm view @miniidealab/openlogos@<V> version gitHead dist.integrity dist.attestations --json`，并读取 `dist.attestations.url` 指向的证明；③ `npm pack @miniidealab/openlogos@<V>` 到临时目录并解包；④ 对照 tag 提交的 `cli/src/` 文件清单（`git ls-tree -r v<V> -- cli/src`）检查包内 `dist/**/*.js` | ① `latest` == V，`old` 不变；② `version` == V；SLSA provenance 的 `resolvedDependencies[0].uri` 指向 `refs/tags/v<V>`，`digest.gitCommit` == `v<V>` 提交（`gitHead` 存在时须同样相等）；③ 包内 `package.json` 版本 == V，asset-manifest 版本 == V 且经 `validateAssetManifest` 校验通过；包内含 `dist/lib/sandbox-reuse.js`，`dist/lib/sandbox.js` 引入它，`dist/index.js` 注册 `--fresh-sandbox`；④ 每个 `dist/**/*.js` 都有同名 `cli/src/**/*.ts` | 保留读取结果与 tarball SHA-256。①② 不符 → 按部署方案档 D 回退（`dist-tag latest` 回指 0.16.0、`npm deprecate <V>`）；③④ 不符表示公网制品与预演不同源，同样按档 D 处置并另立修复提案前滚 |
| SMOKE-core-243 | registry 隔离安装态可用（含沙箱复用） | SMOKE-core-242 通过；本机有 node、npm、git | ① `npm install -g --prefix <tmp> @miniidealab/openlogos@<V>`（从 registry 安装）；② `<tmp>` 入口 `--version`；③ 临时目录执行 `openlogos init smoke --locale zh --ai-tool all` 后 `sync`；④ `openlogos status --format json`；⑤ 另建临时项目，按 SMOKE-core-240 夹具口径（模拟增量编译器、一次性 `sandbox_root`、`sandbox_cache_paths=["build-cache"]`）连续执行 `openlogos verify --format json` 两次，中间改 1 个源文件 | ① 退出码 0，入口 realpath 在 `<tmp>` 包目录内且非链接；② == V；③ 均退出码 0，生成 `logos/` 与各工具资产，`sync` 输出不含 `asset hash 不匹配`；④ 合法 JSON envelope；⑤ 两次 `gate.result=="PASS"`，`sandbox.reuse.state` 依次为 `created` / `reused`，`compiled` 依次为 20 / 1。若首次 `reuse.state=="unsupported"`（Seatbelt 等嵌套沙箱内 setuid `/bin/ps` 不可执行，属规格 §2.91.6 的正确行为），⑤ 不计失败，整条用例按 `skip` + `reason_code:"platform-unavailable"` + 非空 detail 记录，且 ①～④ 已通过 | 保留各步 stdout / stderr。①～④ 失败 → 按档 D 回退并另立修复提案前滚；⑤ 在可复用环境中失败表示沙箱复用未进入公网包，同样按档 D 处置 |
| SMOKE-core-244 | GitHub Release 与 registry 同源 | SMOKE-core-242 通过；`gh` 已认证 | ① `gh release view v<V> --json tagName,isDraft,isPrerelease,body,assets`；② `gh api repos/{owner}/{repo}/releases/latest --jq .tag_name`；③ `gh release download v<V> --pattern 'miniidealab-openlogos-*.tgz'` 到临时目录；④ 按 `publish.yml`「Prepare release notes」同规则，从 `v<V>` 提交的 `CHANGELOG.md` 提取 `## [V]` 节 | ① 存在，非 draft、非 prerelease；② == `v<V>`；③ 恰一个附件 `miniidealab-openlogos-<V>.tgz`，SHA-256 == SMOKE-core-242 记录的 registry tarball SHA-256；④ Release 正文与提取结果去首尾空白后逐字一致，含沙箱复用说明与「从 0.16.0 升级」指引，且**不含**「未发布到 npm」 | 保留 Release JSON 与附件 SHA-256。缺 Release 或缺附件 → 按部署方案档 C 受控补做（不重复 create）；附件与 registry 不同源 → 以 registry 制品为准替换附件并在部署记录说明 |
| SMOKE-core-245 | 官网 latest 等于 V、0.16.1 英文摘要在场 | 官网已由 publish run 或档 C 补做部署到 Cloudflare Pages | ① GET `https://openlogos.ai/releases` 与 `https://openlogos.ai/zh/releases`；② GET 首页 `https://openlogos.ai/`，取最近发布入口 | ① 均为 200，页面 latest 版本 == V（SMOKE-core-15 口径），V 条目展示英文价值摘要（不是固定回退提示）及中文原文次级内容（SMOKE-core-07 口径）；② 入口指向 `/releases` 且非 404（SMOKE-core-08 口径） | 保留 HTTP 状态码与页面摘录。① latest 不等于 V 时，先确认 registry `dist-tags.latest` 已是 V；若是，则按档 C 重新生成并部署官网，不得手改 `releases.json`；英文摘要缺失 → 补 `release-summaries-en.mjs` 后经官网部署前滚（不涉及 npm） |

### 二、复用的在案用例

以下在案用例沿用其原定义，本次只规定执行对象（定义不在本节重复登记）：

- 版本用例 SMOKE-core-01：以 SMOKE-core-243 的隔离 prefix 入口执行，`openlogos --version` == V。
- init 资产用例 SMOKE-core-02：以 SMOKE-core-243 ③ 的 `init smoke --locale zh --ai-tool all` 结果核对 `logos/resources/reference/` 六个子目录。
- 插件模板用例 SMOKE-core-04：以 SMOKE-core-242 ③ 解包的 registry tarball 核对 Claude Code、OpenCode、Codex 插件模板在场。
- 发布动态双语摘要用例 SMOKE-core-07：以 SMOKE-core-245 ① 的 `/releases` 页面执行。
- 首页入口用例 SMOKE-core-08：以 SMOKE-core-245 ② 执行。
- tag 与官网一致用例 SMOKE-core-15：以 SMOKE-core-245 ① 的 latest 版本断言执行，tag 版本取 V。

### 三、执行边界

- 公网只读（见本节导言）；命令图中不得出现发布写操作。
- 安装态只装到 `mktemp -d` 一次性 prefix，结束即删除（含一次性 `sandbox_root` 下的持久沙箱项目目录）；本机全局切换属部署方案「发布后同步」，不在 smoke 内执行。
- 断言不硬编码主机路径、墙上时钟、本机全局安装现值或 `0.16.1` 字面量；V、tag 提交号与 registry tarball SHA-256 运行时读取并在用例间传递。
- 网络不可达、`gh` 未认证、部署记录缺 V 时写显式 `skip` 并携带缺失项。这些都是可补齐的环境缺口，**不得**标 `reason_code:"platform-unavailable"`；`platform-unavailable` 只用于 SMOKE-core-243 ⑤ 的嵌套沙箱情形。有非 platform-unavailable 的 skip 时不得写 `SMOKE_PASS`。

### 四、追溯与覆盖

- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.1 公开发布方案（npm / GitHub Release / 官网）」。
- 来源提案：release-0-16-1（决策 C01～C05）；能力来源 verify-sandbox-reuse-0-16-1（功能规格 §2.91）。
- 覆盖关系：registry 身份 → SMOKE-core-242；公网安装可用与沙箱复用 → SMOKE-core-243；GitHub Release 同源与发布说明正确 → SMOKE-core-244；官网 latest 与英文摘要 → SMOKE-core-245；版本、init 资产、插件模板、官网入口 → 复用的 SMOKE-core-01 / 02 / 04 / 07 / 08 / 15。

### 五、自动化与证据要求

- 新增 runner `scripts/smoke-public-release-0-16-1.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-242～SMOKE-core-245 及上表复用用例，不得依靠通配发现后无条件 PASS；可复用 `scripts/smoke-public-release-0-16-0.js` 与 `scripts/smoke-sandbox-reuse-0-16-1.js` 的判据实现（抽取共用函数或导入），但 0.16.0 runner 的分派与适用窗口不变。
- runner 适用窗口：活跃变更为 `release-0-16-1`（或显式环境变量开启）；窗口之外按既有留痕机制为全部 owned ID 写 skip。
- runner 提供自测模式：注入本地 tarball 替代 registry 规格、注入本地预览 URL 替代官网域名，并把结果写入独立账本。自测结果不得写入项目正式 smoke 账本；正式模式拒绝注入。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/evidence`；evidence 记录 V、tag 提交号、registry tarball SHA-256、Release 附件 SHA-256、HTTP 状态码、隔离 prefix 路径与 `sandbox.reuse` 摘要。**失败不得写 pass**。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-242～SMOKE-core-245 均被 runner 覆盖。

## OpenLogos 0.16.2 公开发布 smoke（SMOKE-core-246～250）

> 这组用例验证 0.16.2 公开发布的三处公网制品——npm registry、GitHub Release、Cloudflare Pages 官网——同源于本次实际发布版本 V；从公网安装的包可以正常使用，并在 macOS 与 Linux 上都能复用沙箱。Linux 用例（SMOKE-core-248）是本次修复（功能规格 §2.92）进入公网包的直接证据：在存在同用户不可转储进程的 Linux 容器内，registry 安装的 CLI 第二次 verify 仍得 `reused`。判据沿用「OpenLogos 0.16.1 公开发布 smoke（SMOKE-core-242～245）」的口径，只替换版本、发布说明与官网资源的断言对象，并新增 Linux 用例。
>
> **与 SMOKE-core-242～245 的关系**：SMOKE-core-242～245 绑定的发布提案 `release-0-16-1` 已撤销（门 ② 未通过，未推 tag、未发布），这组用例**保留不执行**，`scripts/smoke-public-release-0-16-1.js` 的适用窗口不会再打开；本组不复用其 ID，也不改写其定义。
>
> **版本口径**：V 为部署记录中实际成功发布的版本，初始为 `0.16.2`；按部署方案档 B2 前滚时为前滚后的 patch。V 与 tag 提交号从部署记录 `logos/resources/verify/deployment-report.md` 中**标题行含 `release-0-16-2` 的那一节**的 `public_release_version: <V>` / `public_release_commit: <sha>` 两行读取（同文件内 0.16.0 等其他节的同名行不得被误读）；提交号缺省时取 `git rev-parse v<V>^{commit}`。断言一律写成关系式，不硬编码 `0.16.2`；缺 V 或缺提交号时写显式 skip 并带缺失项。
>
> **执行边界**：runner 对公网**只读**——只用 `npm view`、`npm pack <spec>`（下载到临时目录）、`gh release view` / `gh release download`、`gh api`、HTTP GET。不执行 `npm publish`、`npm dist-tag`、`npm deprecate`、`git tag`、`git push`、`gh release create/edit/upload` 或 `wrangler`。安装态用例只装到 `mktemp -d` 一次性 prefix 与一次性 `sandbox_root`，或 `docker run --rm` 的一次性容器内，不触碰本机全局 prefix、本仓活跃提案、本仓配置的沙箱根与用户其他仓库（包括 runlogos）。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-246 | registry 发布身份与 provenance | `v<V>` 的 publish run 中 `Publish` 步骤 success（原 run 全绿，或部署方案档 C 已完成补做）；部署记录有 V 与 tag 提交号 | ① `npm view @miniidealab/openlogos dist-tags --json`；② `npm view @miniidealab/openlogos@<V> version gitHead dist.integrity dist.attestations --json`，并读取 `dist.attestations.url` 指向的证明；③ `npm pack @miniidealab/openlogos@<V>` 到临时目录并解包；④ 对照 tag 提交的 `cli/src/` 文件清单（`git ls-tree -r v<V> -- cli/src`）检查包内 `dist/**/*.js`；⑤ `npm view @miniidealab/openlogos@0.16.1 version` | ① `latest` == V，`old` 不变；② `version` == V；SLSA provenance（predicate `https://slsa.dev/provenance/v1`）的 `resolvedDependencies[0].uri` 指向 `refs/tags/v<V>`，`digest.gitCommit` == `v<V>` 提交（`gitHead` 存在时须同样相等）；③ 包内 `package.json` 版本 == V，asset-manifest 版本 == V 且经 `validateAssetManifest` 校验通过；包内含 `dist/lib/sandbox-reuse.js` 且其中含 `command_started_uptime`，`dist/lib/sandbox.js` 引入它，`dist/index.js` 注册 `--fresh-sandbox`；④ 每个 `dist/**/*.js` 都有同名 `cli/src/**/*.ts`；⑤ 返回 E404（0.16.1 从未进入 registry） | 保留读取结果与 tarball SHA-256。①② 不符 → 按部署方案档 D 回退（`dist-tag latest` 回指 0.16.0、`npm deprecate <V>`）；③④ 不符表示公网制品与预演不同源，同样按档 D 处置并另立修复提案前滚；⑤ 返回版本号表示 0.16.1 被意外发布，停止后续流程并在部署记录说明，由用户决定是否 `npm deprecate` 该版本 |
| SMOKE-core-247 | 宿主机（macOS）registry 隔离安装态可用与沙箱复用 | SMOKE-core-246 通过；宿主机有 node、npm、git | ① `npm install -g --prefix <tmp> @miniidealab/openlogos@<V>`（从 registry 安装）；② `<tmp>` 入口 `--version`；③ 临时目录执行 `openlogos init smoke --locale zh --ai-tool all` 后 `sync`；④ `openlogos status --format json`；⑤ 另建临时项目，按 SMOKE-core-240 夹具口径（模拟增量编译器、N=20 个源文件、一次性 `sandbox_root`、`sandbox_cache_paths=["build-cache"]`）连续执行 `openlogos verify --format json` 两次，中间改 1 个源文件 | ① 退出码 0，入口 realpath 在 `<tmp>` 包目录内且非链接；② == V；③ 均退出码 0，生成 `logos/` 与各工具资产，`sync` 输出不含 `asset hash 不匹配`；④ 合法 JSON envelope，`version` == V；⑤ 两次 `gate.result=="PASS"`，`sandbox.reuse.state` 依次为 `created` / `reused`，`compiled` 依次为 20 / 1。若首次 `reuse.state=="unsupported"`（Seatbelt 等嵌套沙箱内 setuid `/bin/ps` 不可执行，属规格 §2.91.6 的正确行为），⑤ 不计失败，整条用例按 `skip` + `reason_code:"platform-unavailable"` + 非空 detail 记录，且 ①～④ 已通过 | 保留各步 stdout / stderr。①～④ 失败 → 按档 D 回退并另立修复提案前滚；⑤ 在可复用环境中失败表示沙箱复用未进入公网包，同样按档 D 处置 |
| SMOKE-core-248 | Linux 容器内 registry 安装态与不可转储进程下的沙箱复用 | SMOKE-core-246 通过；宿主机 docker 可用且可拉取 `node:20` | ① `docker run --rm node:20`（记录镜像摘要），容器内以**非 root 用户**执行后续全部步骤，读取 `id -u` 非 0；② `npm install -g --prefix <tmp> @miniidealab/openlogos@<V>` 后执行 `<tmp>` 入口 `--version`；③ 构造不可转储进程：把 `sleep` 复制为权限 0111 的副本并以该用户 exec 长时间运行；读取其 `/proc/<pid>/environ` 与 `/proc/<pid>/stat`，并等待到以实际读数校验「`/proc/uptime` − 该进程 starttime 秒数」大于 2 秒；④ 容器内另建临时项目，按 SMOKE-core-240 夹具口径（模拟增量编译器、N=20 个源文件、一次性 `sandbox_root`、`sandbox_cache_paths=["build-cache"]`）连续执行 `openlogos verify --format json` 两次，中间改 1 个源文件；⑤ 读取持久沙箱中最新世代的释放记录 | ① 容器启动成功，uid 非 0；② 安装退出码 0，`--version` == V；③ 进程存活，environ 读取得 EACCES，stat 可读，等待后差值 > 2 秒（即首轮命令启动时该进程必然早于「命令启动时刻 − 1 秒」）；④ 两次 `gate.result=="PASS"`，`sandbox.reuse.state` 依次为 `created` / `reused`，`compiled` 依次为 20 / 1（Linux 容器内运行标记扫描应可用，`unsupported` 计失败，不按 platform-unavailable 处理）；⑤ 最新释放记录为 `released` 而非 `tainted`，且含数字型 `command_started_uptime` | 保留镜像摘要、uid、各步退出码、environ / stat 读数与每次 JSON 摘要。①③ 环境构造失败（docker 不可用、无法得到 EACCES 进程）→ 显式 `skip` 并携带缺失项，不得标 platform-unavailable，不得写 `SMOKE_PASS`；② 失败 → 按档 D 处置；④⑤ 第二次为 `recovered` 或释放记录为 `tainted` → Linux 修复未进入公网包，按档 D 回退并另立修复提案前滚 |
| SMOKE-core-249 | GitHub Release 与 registry 同源，0.16.1 无 Release | SMOKE-core-246 通过；`gh` 已认证 | ① `gh release view v<V> --json tagName,isDraft,isPrerelease,body,assets`；② `gh api repos/{owner}/{repo}/releases/latest --jq .tag_name`；③ `gh release download v<V> --pattern 'miniidealab-openlogos-*.tgz'` 到临时目录；④ 按 `publish.yml`「Prepare release notes」同规则，从 `v<V>` 提交的 `CHANGELOG.md` 提取 `## [V]` 节；⑤ `gh api repos/{owner}/{repo}/releases/tags/v0.16.1` | ① 存在，非 draft、非 prerelease；② == `v<V>`；③ 恰一个附件 `miniidealab-openlogos-<V>.tgz`，SHA-256 == SMOKE-core-246 记录的 registry tarball SHA-256；④ Release 正文与提取结果去首尾空白后逐字一致，含「沙箱复用」、「Linux」与「从 0.16.0 升级」，且**不含**「未发布到 npm」；⑤ 返回 404 | 保留 Release JSON 与附件 SHA-256。缺 Release 或缺附件 → 按部署方案档 C 受控补做（不重复 create）；附件与 registry 不同源 → 以 registry 制品为准替换附件并在部署记录说明；⑤ 返回 Release 表示 0.16.1 被意外发布，停止并由用户决定处置 |
| SMOKE-core-250 | 官网 latest 等于 V、V 英文摘要在场且无 0.16.1 摘要 | 官网已由 publish run 或档 C 补做部署到 Cloudflare Pages | ① GET `https://openlogos.ai/releases` 与 `https://openlogos.ai/zh/releases`；② GET 首页 `https://openlogos.ai/`，取最近发布入口；③ `git show v<V>:website/src/data/release-summaries-en.mjs` | ① 均为 200，页面 latest 版本 == V（SMOKE-core-15 口径），V 条目展示英文价值摘要（不是固定回退提示）及中文原文次级内容（SMOKE-core-07 口径）；② 入口指向 `/releases` 且非 404（SMOKE-core-08 口径）；③ 含键 `'<V>'`，不含键 `'0.16.1'` | 保留 HTTP 状态码与页面摘录。① latest 不等于 V 时，先确认 registry `dist-tags.latest` 已是 V；若是，则按档 C 重新生成并部署官网，不得手改 `releases.json`；英文摘要缺失或 ③ 不符 → 修正 `release-summaries-en.mjs` 后经官网部署前滚（不涉及 npm） |

### 二、复用的在案用例

以下在案用例沿用其原定义，本次只规定执行对象（定义不在本节重复登记）：

- 版本用例 SMOKE-core-01：以 SMOKE-core-247 的隔离 prefix 入口执行，`openlogos --version` == V。
- init 资产用例 SMOKE-core-02：以 SMOKE-core-247 ③ 的 `init smoke --locale zh --ai-tool all` 结果核对 `logos/resources/reference/` 六个子目录。
- 插件模板用例 SMOKE-core-04：以 SMOKE-core-246 ③ 解包的 registry tarball 核对 Claude Code、OpenCode、Codex 插件模板在场。
- 发布动态双语摘要用例 SMOKE-core-07：以 SMOKE-core-250 ① 的 `/releases` 页面执行。
- 首页入口用例 SMOKE-core-08：以 SMOKE-core-250 ② 执行。
- tag 与官网一致用例 SMOKE-core-15：以 SMOKE-core-250 ① 的 latest 版本断言执行，tag 版本取 V。

### 三、执行边界

- 公网只读（见本节导言）；命令图中不得出现发布写操作。
- 宿主机安装态只装到 `mktemp -d` 一次性 prefix，结束即删除（含一次性 `sandbox_root` 下的持久沙箱项目目录）；Linux 安装态只在 `docker run --rm` 的一次性容器内进行，结束时终止 ③ 构造的进程并移除容器；本机全局切换属部署方案「发布后同步」，不在 smoke 内执行。
- 断言不硬编码主机路径、墙上时钟、本机全局安装现值或 `0.16.2` 字面量；V、tag 提交号与 registry tarball SHA-256 运行时读取并在用例间传递。`0.16.1` 只作为「从未公开」的反向断言对象出现（SMOKE-core-246 ⑤、SMOKE-core-249 ⑤、SMOKE-core-250 ③）。
- 网络不可达、`gh` 未认证、部署记录缺 V、docker 不可用时写显式 `skip` 并携带缺失项。这些都是可补齐的环境缺口，**不得**标 `reason_code:"platform-unavailable"`；`platform-unavailable` 只用于 SMOKE-core-247 ⑤ 的嵌套沙箱情形。有非 platform-unavailable 的 skip 时不得写 `SMOKE_PASS`。

### 四、追溯与覆盖

- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.2 公开发布方案（npm / GitHub Release / 官网）」。
- 来源提案：release-0-16-2（决策 C01～C07）；能力来源 verify-sandbox-reuse-0-16-1（功能规格 §2.91）与 fix-sandbox-reuse-linux-liveness（功能规格 §2.92）。
- 覆盖关系：
  - registry 身份、Linux 修复进入构建产物、0.16.1 未进入 registry → SMOKE-core-246；
  - 宿主机公网安装可用与沙箱复用 → SMOKE-core-247；
  - Linux 公网安装态与不可转储进程下的复用（本次修复的公网验证，对应仓库内 ST-S13-26 与 S13 EX-3.13 ①）→ SMOKE-core-248；
  - GitHub Release 同源、发布说明正确、0.16.1 无 Release → SMOKE-core-249；
  - 官网 latest 与英文摘要 → SMOKE-core-250；
  - 版本、init 资产、插件模板、官网入口 → 复用的 SMOKE-core-01 / 02 / 04 / 07 / 08 / 15。

### 五、自动化与证据要求

- 新增 runner `scripts/smoke-public-release-0-16-2.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-246～SMOKE-core-250 及上表复用用例，不得依靠通配发现后无条件 PASS；可参照 `scripts/smoke-public-release-0-16-1.js` 的判据实现，但不修改该 runner，也不抽取两者共用库。
- runner 适用窗口：活跃变更为 `release-0-16-2`，或 `OPENLOGOS_PR162_SMOKE=1`；窗口之外按既有留痕机制为全部 owned ID 写 skip。环境变量一律使用 `OPENLOGOS_PR162_` 前缀，不得复用 `OPENLOGOS_PR161_` 前缀。
- runner 提供自测模式：注入本地 tarball 替代 registry 规格（SMOKE-core-248 以只读挂载把 tarball 传入容器）、注入本地预览 URL 替代官网域名，并把结果写入独立账本。自测结果不得写入项目正式 smoke 账本；正式模式拒绝注入。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/evidence`；evidence 记录 V、tag 提交号、registry tarball SHA-256、Release 附件 SHA-256、HTTP 状态码、隔离 prefix 路径、`sandbox.reuse` 摘要，SMOKE-core-248 另记镜像摘要、容器内 uid、不可转储进程的 environ / stat 读数与释放记录摘要。**失败不得写 pass**。
- 判据以 JSON 字段、退出码、SHA-256、HTTP 状态码与释放记录字段为准；页面与发布说明断言只针对版本号、固定路径、是否为回退提示与上表列出的关键字，不解析其余人类可读文案。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-246～SMOKE-core-250 均被 runner 覆盖。

## OpenLogos 0.16.3 环境登记表安装态 smoke（SMOKE-core-251～253）

> 这组用例验证环境登记表与部署账本（来源提案 environment-registry，功能规格 §2.93）及其复核修复（来源提案 fix-environment-registry-review-gaps，决策 C01～C04）确实进入了本机全局安装态。两者都是 CLI 运行时行为，只有全局 `openlogos` 升级后才对用户的各项目（含 RunLogos 环境面板）生效。
>
> 用例在 `mktemp -d` 一次性隔离项目内执行（临时项目经全局 `openlogos init` 建立，并按 S19 夹具口径补齐活跃提案、`[deploy]` 全勾、`VERIFY_PASS` 等 smoke 前置）。runner 对全局安装态**只读**，不做安装或卸载，不触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态账本与用户其他仓库（包括 runlogos）；唯一读取本仓的是 SMOKE-core-251 ④ 对本仓托管 guard 副本的只读比对。判据用**行为断言**：版本号相等只证明装了新包，不证明行为生效。版本号以计划值 `0.16.3` 为准，实际以部署记录的候选版本为准，断言写成关系式：全局 `--version` == 部署记录版本。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-251 | 安装态版本、制品身份与本仓 sync 同源 | 本机全局已安装本次候选；部署记录中有候选版本与 tarball SHA-256；本仓已按部署方案执行 `openlogos sync` | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并重算 `payloadHash`；③ 检查全局包内存在 `dist/commands/env.js` 与 `dist/lib/deployment-ledger.js`，`claude-plugin-template/bin/guard-check` 的内置默认豁免含 `logos/environments.yaml`，包内 `spec/logos.config.schema.json` 可按 JSON 解析且 `guard.exempt.default` 为 3 条；④ 逐字节比对本仓 `.claude/openlogos/bin/guard-check` 与全局包内 `claude-plugin-template/bin/guard-check` | ① `--version` 等于部署记录版本，入口无 workspace link；② `payloadHash` 自洽；③ 全部成立；④ 字节一致 | 保留读取结果。①～③ 任一不符 → 停止后续流程，按部署方案用 `cli/rollback/miniidealab-openlogos-0.16.2.tgz` 回装全局；④ 不一致 → 重新执行本仓 `openlogos sync` 后复核，仍不一致则回流本提案；不得以「仓内源码已修」了事 |
| SMOKE-core-252 | 安装态环境登记全链路（登记 → 部署 → smoke → 已验证） | 本机全局已安装本次候选；临时 git 项目写入含 `test`、`prod`（`prod` 带 alias `生产`）的 `logos/environments.yaml`；smoke runner 夹具读取 `OPENLOGOS_SMOKE_ENV` 并按读到的值写入结果行 `target_environment` | ① 全局 `openlogos env check --format json`；② `openlogos deploy-done --env 生产 --ref HEAD --format json`；③ `openlogos smoke --env prod --format json`；④ `openlogos env show prod --format json`；⑤ `openlogos status --format json` | ① 通过、无 error 级问题；② `DEPLOY_DONE` 为单行 JSON 且 `environment=="prod"`、`ref` 为当时 HEAD 的 40 位 commit，账本新增一行 deploy 记录；③ 门禁 PASS，`environment_evidence.env_evidence=="declared"`、`verified==true`、`ledger_written==true`，runner 读到 `prod`；④ `last_smoke.verified==true`，`current_ref` 等于 ② 的 `ref`；⑤ `environments` 中 prod 与 ④ 一致 | 同上；保留每步 JSON 摘要。任一环节不成立表示环境登记能力未进入安装态，回装旧版并回流来源提案 environment-registry |
| SMOKE-core-253 | 安装态复核修复：错误 `details` 与账本 / 标记一致性 | 本机全局已安装本次候选；沿用 SMOKE-core-252 的临时项目（已有合法 prod 部署） | ① 把 `DEPLOY_DONE` 截断为前 10 字节后 `openlogos smoke --env prod --format json`，随后重新 `deploy-done --env prod --ref HEAD`；② 在临时项目运行态目录预置新鲜账本锁文件 `logos/.openlogos-runtime/deployments.jsonl.lock`，记录执行前两种 smoke 标记与账本字节，执行 `openlogos smoke --env prod --format json`，结束后删除锁文件；③ 在提案目录放置旧 `SMOKE_FAIL`、删除 `SMOKE_PASS`，把提案目录置为只读（root 下按既有口径 skip），执行一次 runner 全部通过的 `openlogos smoke --env prod --format json`，结束后恢复目录权限 | ① 错误 `SMOKE_DEPLOY_MARKER_INVALID`、退出码 1，`error.details.problems` 为非空数组，命令未运行；② 错误 `SMOKE_LEDGER_WRITE_FAILED`、退出码 1，`error.details.stage=="ledger"`，两种 smoke 标记与账本字节与执行前一致，stderr 只有一份 JSON envelope；③ 错误 `SMOKE_LEDGER_WRITE_FAILED`，`error.details.stage=="marker"`、`rollback=="complete"`，旧 `SMOKE_FAIL` 仍在、无 `SMOKE_PASS`，账本无本次 smoke 行 | 同上；任一不成立表示复核修复未进入安装态或回滚语义被破坏，回装旧版并回流本提案 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目内进行，结束即删除（含运行态账本与锁文件）。**不得**触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态目录 `logos/.openlogos-runtime/`、用户其他仓库（包括 runlogos）或本机全局 prefix；本节对全局安装态只读，对本仓只做 SMOKE-core-251 ④ 的只读比对。
- 命令图中不得出现 `npm publish` / dist-tag / `git tag` / `gh release` / `git push`，本次为本地全局部署。
- 断言中不硬编码主机路径、墙上时钟或本机全局安装现值（通则第 1 条）；commit 以临时仓库内 `git rev-parse HEAD` 的实际值比较。

### 三、追溯与覆盖

- 功能规格：§2.93（环境登记表与部署账本）、§2.11（deploy-done 受控落标命令）。
- 根规范：`spec/environments.md` §3、§4、§5、§6、§8；`spec/cli-json-output.md`「deploy-done / smoke / status 环境字段（environment-registry）」「`openlogos env list|show|check --format json`」；`spec/logos.config.schema.json` `guard.exempt`。
- 场景：S41；S21；S19「smoke 环境一致性、环境证据与部署账本（environment-registry）」EX-19.12、EX-19.20、EX-19.21；S11。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.3 发布方案（环境登记表与评审缺口修复，本地全局）」。
- 验收标准映射（来源提案 fix-environment-registry-review-gaps）：1 → SMOKE-core-253 ①；2 → SMOKE-core-253 ②；3 → SMOKE-core-253 ③（恢复失败分支依赖注入，由仓库内 UT-S19-71 覆盖，不在安装态重复）；5 → SMOKE-core-251 ③；6 → SMOKE-core-251、SMOKE-core-252。验收标准 4（未传 `--env` / 无活跃提案零回归）由仓库内 UT-S19-69 ③④ 覆盖。
- 仓库内对应用例：UT-S41-01～UT-S41-11、ST-S41-01～ST-S41-03、UT-S21-11～UT-S21-19、ST-S21-05、UT-S19-58～UT-S19-71、ST-S19-25～ST-S19-28、UT-S11-96～UT-S11-100、ST-S11-52、UT-S40-29；版本身份 `UT-S19-46` / `UT-S19-49`。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-environment-registry-0-16-3.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-251～SMOKE-core-253，不得依靠通配发现后无条件 PASS。runner 记录全局入口 realpath、安装态版本、每个隔离项目路径、每次命令的退出码与 JSON 摘要（含 `environment_evidence` 与 `error.details`）。
- 环境不具备时（缺候选 tarball、部署记录或本仓 sync 未执行）写显式 `skip` 记录并携带缺失项，禁止静默零记录退出；这些都是可补齐的环境缺口，**不得**标 `reason_code:"platform-unavailable"`。SMOKE-core-253 ③ 在 root 下无法构造只读目录时按既有口径写 `skip` 并说明原因。有 skip 时不得写 `SMOKE_PASS`。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/evidence`；**失败不得写 pass**。
- 判据以 `--format json` 的结构化字段、退出码与命令实际输出为准，不解析人类可读文案。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-251～SMOKE-core-253 均被 runner 覆盖。

## OpenLogos 0.16.4 环境部署执行安装态 smoke（SMOKE-core-254～257）

> 这组用例验证 `openlogos deploy` 执行器、版本通道、回滚与 smoke 部署身份核对（来源提案 environment-deploy，功能规格 §2.94）确实进入了本机全局安装态。它们是 CLI 运行时行为，只有全局 `openlogos` 升级后才对用户的各项目（含 RunLogos 环境面板）生效。
>
> 用例在 `mktemp -d` 一次性隔离 git 项目内执行（经全局 `openlogos init` 建立，登记 `staging` 环境，`deploy.mode: script`；部署脚本把版本标识写入另一个一次性目录模拟「发布」，不触达任何真实服务）。runner 对全局安装态**只读**，不做安装或卸载，不触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态账本与用户其他仓库（包括 runlogos）；唯一读取本仓的是 SMOKE-core-254 ④ 对本仓托管副本的只读比对。判据用**行为断言**：全局 `--version` == 部署记录版本只证明装了新包。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-254 | 安装态版本、制品身份与本仓 sync 同源 | 本机全局已安装本次候选；部署记录中有候选版本与 tarball SHA-256；本仓已按部署方案执行 `openlogos sync` | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并重算 `payloadHash`；③ 检查全局包内存在 `dist/commands/deploy.js`、`dist/lib/deploy-runner.js`、`dist/lib/deploy-ci.js`，`asset-manifest.json` 同时登记 `skills/deployment-designer/SKILL.md` 与 `skills/deployment-executor/SKILL.md`；④ 逐字节比对本仓 `logos/skills/deployment-designer/SKILL.md`、`logos/skills/deployment-executor/SKILL.md` 与全局包内同名 Skill | ① `--version` 等于部署记录版本，入口无 workspace link；② `payloadHash` 自洽；③ 全部成立；④ 字节一致 | 保留读取结果。①～③ 任一不符 → 停止后续流程，按部署方案用 `cli/rollback/miniidealab-openlogos-0.16.3.tgz` 回装全局；④ 不一致 → 重新执行本仓 `openlogos sync` 后复核，仍不一致则回流本提案 |
| SMOKE-core-255 | 安装态 script 版本通道、隔离工作树与回滚 | 本机全局已安装本次候选；临时 git 项目含两个 tag（`v1`、`v2`），各自带一版可执行部署脚本，脚本把 `OPENLOGOS_DEPLOY_REF` 与工作目录 HEAD 写入发布目录；工作区另有一处未提交改动 | ① `openlogos deploy --env staging --ref v1 --format json`；② `openlogos deploy --env staging --ref v2 --format json`；③ `openlogos env show staging --format json`；④ `openlogos deploy --env staging --rollback --format json`；⑤ 再次 `env show staging --format json` | ① 退出码 0，`channel=version`、`mode=script`、`ref` 等于 `v1` 的 commit；发布目录记录的 ref 与 HEAD 都等于该 commit，且未包含未提交改动；② 同理为 `v2`；③ `current_ref` 为 v2、`previous_ref` 为 v1；④ 部署 v1，`rollback=true`、`rollback_from` 为 v2 的 commit，发布目录内容回到 v1 脚本的输出；⑤ `current_ref` 为 v1 | 同上；保留每步 JSON 摘要与发布目录内容。任一不成立表示部署执行器未进入安装态或版本真实性被破坏，回装旧版并回流本提案 |
| SMOKE-core-256 | 安装态提案通道首次部署与 smoke 部署身份核对 | 本机全局已安装本次候选；临时项目活跃提案处于 ready-to-deploy（`VERIFY_PASS`、`[deploy]` 任务齐全），**没有任何旧部署报告**；smoke runner 读取 `OPENLOGOS_SMOKE_ENV` 并写 `target_environment` | ① `openlogos deploy --env staging --format json`；② `openlogos smoke --env staging --format json`；③ `openlogos deploy --env staging --ref <另一 tag> --channel version --format json`；④ 再次 `openlogos smoke --env staging --format json` | ① 退出码 0，`channel=proposal`；`logos/resources/verify/deployment-report.md` 新增本次部署报告；`[deploy]` 全勾，`DEPLOY_DONE.deploy_id` 等于账本该次记录的 `deploy_id`；② 门禁 PASS、`environment_evidence.verified=true`；③ 版本通道部署成功；④ 错误 `SMOKE_DEPLOY_SUPERSEDED`、退出码 1，`SMOKE_PASS` / `SMOKE_FAIL`、`DEPLOY_DONE` 与账本字节与执行前一致 | 同上；任一不成立表示提案通道或部署身份核对未进入安装态，回装旧版并回流本提案 |
| SMOKE-core-257 | 安装态 dry-run、失败记录、密钥遮盖与并发锁 | 本机全局已安装本次候选；临时项目登记 `staging` 声明密钥 `SMOKE_DEPLOY_TOKEN`；准备一版非零退出且会打印该密钥值的部署脚本，以及一版运行期间休眠数秒的脚本 | ① 不导出 `SMOKE_DEPLOY_TOKEN` 执行 `deploy --env staging --ref <tag> --format json`；② 导出该变量后 `deploy --env staging --ref <tag> --dry-run --format json`，记录执行前后临时项目全部文件的 SHA-256；③ 用失败脚本的 tag 执行部署；④ 用休眠脚本的 tag 在后台部署，期间再次执行 `deploy --env staging --ref <tag> --format json` | ① 错误 `DEPLOY_SECRETS_MISSING`，`details.missing` 只含变量名；② 退出码 0、`status=dry-run`，文件快照前后一致；③ 错误 `DEPLOY_FAILED`、`failure_reason=exit-code`，账本追加 `result=failed`、`current_ref` 不变，日志与 `output_tail` 中不出现密钥值而出现 `***`；④ 第二次报 `DEPLOY_IN_PROGRESS` 且零执行，后台部署照常完成 | 同上；任一不成立表示前置检查、失败记录、遮盖或并发控制未进入安装态，回装旧版并回流本提案 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目与一次性「发布目录」内进行，结束即删除（含运行态账本、部署日志、锁、隔离工作树）。**不得**触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态目录、用户其他仓库（包括 runlogos）或本机全局 prefix；本节对全局安装态只读，对本仓只做 SMOKE-core-254 ④ 的只读比对。
- 不触发真实 CI、不访问任何远程服务；ci 方式已由仓库内替身 `gh` 的 UT/ST 覆盖，不在安装态重复。
- 命令图中不得出现 `npm publish` / dist-tag / `git tag`（临时项目内为构造夹具创建的本地 tag 除外）/ `gh release` / `git push`。
- 断言中不硬编码主机路径、墙上时钟或本机全局安装现值；commit 以临时仓库内 `git rev-parse` 的实际值比较。

### 三、追溯与覆盖

- 功能规格：§2.94（环境部署执行）、§2.93（环境登记表与部署账本）。
- 根规范：`spec/environments.md` §4.2、§5、§7.1、§11；`spec/cli-json-output.md`「`openlogos deploy --format json`」「smoke / env / status 部署字段增量（environment-deploy）」。
- 场景：S42；S19「smoke 部署身份核对（environment-deploy）」；S41。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.4 发布方案（环境部署执行，本地全局）」。
- 仓库内对应用例：`core-S42-test-cases.md` 全部用例、UT-S41-12～UT-S41-15、ST-S41-04、UT-S19-72、UT-S19-73、ST-S19-29；版本身份 `UT-S19-46` / `UT-S19-49`。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-environment-deploy-0-16-4.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-254～SMOKE-core-257，不得依靠通配发现后无条件 PASS。runner 记录全局入口 realpath、安装态版本、每个隔离项目路径、每次命令的退出码与 JSON 摘要。
- **适用性判定不得依赖自动流程不会设置的环境变量**（0.16.3 smoke 实证）：候选 tarball 先取显式环境变量，未设置时按候选版本取本仓 `cli/miniidealab-openlogos-<候选版本>.tgz`，并要求其 SHA-256 已写入部署记录；只有制品、部署记录或本仓 sync 确实缺失时才写显式 `skip` 并携带缺失项，不得标 `reason_code:"platform-unavailable"`。有 skip 时不得写 `SMOKE_PASS`。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/evidence`；**失败不得写 pass**。
- 判据以 `--format json` 的结构化字段、退出码与命令实际输出为准，不解析人类可读文案。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-254～SMOKE-core-257 均被 runner 覆盖。

## OpenLogos 0.16.5 环境晋级与审批安装态 smoke（SMOKE-core-258～262）

> 这组用例验证晋级顺序、审批门禁、`openlogos approve`、`--force-promote` 留痕越过与 `deploy-done` 对受门环境的拒绝（来源提案 environment-promotion-approval，功能规格 §2.95）确实进入了本机全局安装态。它们是 CLI 运行时行为，只有全局 `openlogos` 升级后才对用户的各项目（含 RunLogos 审批入口）生效。
>
> 用例在 `mktemp -d` 一次性隔离 git 项目内执行（经全局 `openlogos init` 建立，登记 `staging` 与 `prod` 两个环境，均为 `deploy.mode: script`，prod 配置 `promote_from: staging` 与 `require_approval: true`；部署脚本把版本标识写入另一个一次性目录模拟「发布」，不触达任何真实服务）。runner 以子进程直接调用 CLI（不经 AI 宿主，因此不经过 guard），对全局安装态**只读**，不做安装或卸载，不触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态账本与用户其他仓库（包括 runlogos）；唯一读取本仓的是 SMOKE-core-258 ④ 对本仓托管副本的只读比对。判据用**行为断言**：全局 `--version` == 部署记录版本只证明装了新包。guard 的受限命令与登记表保护由源码测试（`core-S09-test-cases.md` UT-S09-461～UT-S09-466、ST-S09-205）以真实 guard-check 覆盖，安装态只核对 guard-check 同源。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-258 | 安装态版本、制品身份与本仓 sync 同源 | 本机全局已安装本次候选；部署记录中有候选版本与 tarball SHA-256；本仓已按部署方案执行 `openlogos sync` | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并重算 `payloadHash`；③ 检查全局包内存在 `dist/commands/approve.js`，`dist/index.js` 注册 `approve`，`claude-plugin-template/bin/guard-check` 含 `openlogos approve`、`--force-promote` 的受限识别与已配置门禁的登记表判定；④ 逐字节比对本仓 `.claude/openlogos/bin/guard-check`、`logos/skills/deployment-designer/SKILL.md`、`logos/skills/deployment-executor/SKILL.md` 与全局包内同名文件 | ① `--version` 等于部署记录版本，入口无 workspace link；② `payloadHash` 自洽；③ 全部成立；④ 字节一致 | 保留读取结果。①～③ 任一不符 → 停止后续流程，按部署方案用 `cli/rollback/miniidealab-openlogos-0.16.4.tgz` 回装全局；④ 不一致 → 重新执行本仓 `openlogos sync` 后复核，仍不一致则回流本提案 |
| SMOKE-core-259 | 安装态晋级拦截与留痕越过 | 本机全局已安装本次候选；临时 git 项目含 tag `v1`、`v2`，各带一版可执行部署脚本 | ① `openlogos approve --env prod --ref v1 --format json`；② `openlogos deploy --env prod --ref v1 --format json`；③ `openlogos deploy --env staging --ref v1` 后 `openlogos smoke --env staging --format json`（夹具 runner 写 `target_environment`）；④ 再次 `deploy --env prod --ref v1`；⑤ `approve --env prod --ref v2` 后 `deploy --env prod --ref v2 --force-promote "smoke 越过" --format json` | ① 写入审批；② 错误 `DEPLOY_PROMOTION_UNVERIFIED`、退出码 1，发布目录无痕迹、账本无 deploy 记录；③ smoke `verified=true`；④ 成功，记录 `promoted_from=staging`、`approval_id` 为 ① 的值；⑤ 成功，记录 `promotion_override_reason="smoke 越过"`、`promoted_from=null` | 同上；保留每步 JSON 摘要与发布目录内容。任一不成立表示晋级检查未进入安装态，回装旧版并回流本提案 |
| SMOKE-core-260 | 安装态审批拦截、写入、幂等与使用 | 同上；staging 已验证 `v1`、`v2` | ① `deploy --env prod --ref v1 --format json`（未审批）；② 连续两次 `approve --env prod --ref v1 --format json`；③ `deploy --env prod --ref v1`；④ `env show prod --format json`；⑤ 再次 `deploy --env prod --ref v1` | ① `DEPLOY_APPROVAL_REQUIRED`，`details.approve_command` 为可直接执行的命令原文，零执行；② 两次返回同一 `approval_id`，第二次 `created=false`，账本只多一条 `approval`；③ 成功，记录 `approval_id` 等于 ②；④ `open_approvals` 为空，`promotion.candidate_ref` 非空；⑤ 再次 `DEPLOY_APPROVAL_REQUIRED` | 同上；任一不成立表示审批门未进入安装态，回装旧版并回流本提案 |
| SMOKE-core-261 | 安装态 dry-run、回滚审批与 `deploy-done` 受门拒绝 | 同上；prod 已先后成功部署 `v1`、`v2`；临时项目另有活跃提案处于 ready-to-deploy | ① 对 `v2` 审批后 `deploy --env prod --ref v2 --dry-run --format json`，记录执行前后临时项目全部文件的 SHA-256；② `deploy --env prod --rollback --format json`（未对回滚目标审批）；③ `deploy-done --env prod --ref HEAD --format json` | ① 退出码 0、`status=dry-run`，`plan.approval_id` 为该审批，文件快照前后一致，审批仍在 `open_approvals`；② `DEPLOY_APPROVAL_REQUIRED`（不报晋级错误）；③ `DEPLOY_DONE_GATED_ENV`、退出码 1，tasks.md、`DEPLOY_DONE` 与账本字节不变 | 同上；任一不成立表示 dry-run、回滚或受门拒绝未进入安装态，回装旧版并回流本提案 |
| SMOKE-core-262 | 安装态未配置门禁零回归 | 本机全局已安装本次候选；另一临时项目登记表只有 `staging`（配置 `deploy`，无门） | ① `deploy --env staging --ref v1 --format json`；② `env show staging --format json`；③ `status --format json` | ① 成功，记录不含 `approval_id`、`promoted_from`、`promotion_override_reason` 字段；② ③ 视图不含 `promote_from`、`require_approval`、`open_approvals`、`promotion` | 同上；任一不成立表示零回归被破坏，回装旧版并回流本提案 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目与一次性「发布目录」内进行，结束即删除（含运行态账本、部署日志、锁、隔离工作树）。**不得**触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态目录、用户其他仓库（包括 runlogos）或本机全局 prefix；本节对全局安装态只读，对本仓只做 SMOKE-core-258 ④ 的只读比对。
- 不触发真实 CI、不访问任何远程服务。
- 命令图中不得出现 `npm publish` / dist-tag / `git tag`（临时项目内为构造夹具创建的本地 tag 除外）/ `gh release` / `git push`。
- 断言中不硬编码主机路径、墙上时钟或本机全局安装现值；commit 以临时仓库内 `git rev-parse` 的实际值比较。

### 三、追溯与覆盖

- 功能规格：§2.95（环境晋级与部署审批）、§2.93、§2.94。
- 根规范：`spec/environments.md` §12；`spec/cli-json-output.md`「`openlogos approve --format json`」。
- 场景：S43；S41；S42；S21「受门环境拒绝」。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.5 发布方案（环境晋级与审批，本地全局）」。
- 仓库内对应用例：`core-S43-test-cases.md` 全部用例、UT-S41-16～UT-S41-19、ST-S41-05、UT-S09-461～UT-S09-466、ST-S09-205；版本身份 `UT-S19-46` / `UT-S19-49`。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-environment-promotion-approval-0-16-5.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-258～SMOKE-core-262，不得依靠通配发现后无条件 PASS。runner 记录全局入口 realpath、安装态版本、每个隔离项目路径、每次命令的退出码与 JSON 摘要。
- **适用性判定不得依赖自动流程不会设置的环境变量**：候选 tarball 先取显式环境变量，未设置时按候选版本取本仓 `cli/miniidealab-openlogos-<候选版本>.tgz`，并要求其 SHA-256 已写入部署记录；候选版本早于 0.16.5 时按缺候选制品处理。只有制品、部署记录或本仓 sync 确实缺失时才写显式 `skip` 并携带缺失项，不得标 `reason_code:"platform-unavailable"`。有 skip 时不得写 `SMOKE_PASS`。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/evidence`；**失败不得写 pass**。
- 判据以 `--format json` 的结构化字段、退出码与命令实际输出为准，不解析人类可读文案。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-258～SMOKE-core-262 均被 runner 覆盖。

## OpenLogos 0.16.6 提案默认部署环境安装态 smoke（SMOKE-core-263～267）

> 这组用例验证登记表顶层字段 `proposal_default_env` 的校验与 `env list` 输出，以及配套改动的 change-writer / deployment-designer 两个 Skill（来源提案 proposal-default-environment，功能规格 §2.93.1、§2.93.6）确实进入了本机全局安装态与本仓托管副本。change-writer 的提问行为由 Skill 文本承载，安装态只核对 Skill 同源且含新规则，不驱动 AI 填写提案。
>
> 用例在 `mktemp -d` 一次性隔离 git 项目内执行（经全局 `openlogos init` 建立，`locale: zh`）。runner 以子进程直接调用 CLI，对全局安装态**只读**，不做安装或卸载，不触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态账本与用户其他仓库（包括 runlogos）；唯一读取本仓的是 SMOKE-core-263 ④ 对本仓托管副本的只读比对。判据用**行为断言**：全局 `--version` == 部署记录版本只证明装了新包。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-263 | 安装态版本、制品身份与本仓 sync 同源 | 本机全局已安装本次候选；部署记录中有候选版本与 tarball SHA-256；本仓已按部署方案执行 `openlogos sync` | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并重算 `payloadHash`；③ 检查全局包内 `skills/change-writer/SKILL.md` 含「`proposal_default_env`」与「`source: policy`」规则及四种必须提问的负例，`skills/deployment-designer/SKILL.md` 含「只在用户明确指定时写入」；④ 逐字节比对本仓 `logos/skills/change-writer/SKILL.md`、`logos/skills/deployment-designer/SKILL.md` 与全局包内同名文件 | ① `--version` 等于部署记录版本，入口无 workspace link；② `payloadHash` 自洽；③ 全部成立；④ 字节一致 | 保留读取结果。①～③ 任一不符 → 停止后续流程，按部署方案用 `cli/rollback/miniidealab-openlogos-0.16.5.tgz` 回装全局；④ 不一致 → 重新执行本仓 `openlogos sync` 后复核，仍不一致则回流本提案 |
| SMOKE-core-264 | 安装态合法默认环境的校验与输出 | 本机全局已安装本次候选；临时项目登记表含 `test`（aliases 含「测试」）与 `prod`，顶层 `proposal_default_env: test` | ① `openlogos env check --format json`；② `openlogos env list --format json`；③ `openlogos env list`（文本模式）；④ `openlogos env show test --format json` 与 `openlogos status --format json` | ① 退出码 0，`errors` 为空，`warnings` 中无 `field=proposal_default_env`；② data 顶层 `proposal_default_env` 为 `"test"`；③ test 行后有「（提案默认）」，prod 行无标注；④ 两者 data 均不含 `proposal_default_env` | 同上；任一不成立表示字段校验或输出未进入安装态，回装旧版并回流本提案 |
| SMOKE-core-265 | 安装态非法默认环境 fail-closed | 同上，但顶层依次改为 `proposal_default_env: stage`（未登记）、`proposal_default_env: 测试`（alias）；临时项目另有活跃提案处于 ready-to-deploy | 对每种写法：① `env check --format json`；② `deploy-done --env test --ref HEAD --format json`；③ `smoke --env test --format json`；记录执行前后 tasks.md、`DEPLOY_DONE`、smoke marker 与运行态账本的 SHA-256 | ① 退出码 1，`errors` 含 `ENV_FIELD_INVALID`（`field=proposal_default_env`）；② ③ 报 `ENV_REGISTRY_INVALID`、退出码 1；快照前后一致（零副作用） | 同上；任一不成立表示非法值未 fail-closed，回装旧版并回流本提案 |
| SMOKE-core-266 | 安装态默认环境可指向受门环境，部署仍受门 | 同上；登记表中 staging 与 prod 均为 `deploy.mode: script`（部署脚本把版本标识写入另一个一次性目录），prod 配置 `promote_from: staging`、`require_approval: true`，顶层 `proposal_default_env: prod`；临时 git 项目含 tag `v1` | ① `env check --format json`；② `env list --format json`；③ `approve --env prod --ref v1` 后 `deploy --env prod --ref v1 --format json`（staging 未验证 `v1`）；④ `env show prod --format json` | ① 退出码 0，无 `field=proposal_default_env` 的 error；② `proposal_default_env` 为 `"prod"`；③ `DEPLOY_PROMOTION_UNVERIFIED`、退出码 1，发布目录无痕迹、账本无 deploy 记录；④ `environment.deploy.mode` 为 `script`，`environment.deploy.script` 等于登记表所写脚本路径，输出不含密钥值 | 同上；任一不成立表示默认环境误被禁止或绕过了既有门禁，回装旧版并回流本提案 |
| SMOKE-core-267 | 安装态未配置零回归 | 本机全局已安装本次候选；两个临时项目：A 无登记表；B 登记表只有 `test`、未写该字段 | 对 A、B 分别执行 `env list --format json`、`env check --format json`（A 预期报 `ENV_REGISTRY_NOT_FOUND`）、`status --format json`；对同一夹具以 `cli/rollback/miniidealab-openlogos-0.16.5.tgz` 在一次性隔离 prefix 中执行同样命令作为基线 | 退出码一致；data 不含 `proposal_default_env`；除版本相关字段外，关键字段（`registry_present`、`environments[].id`、`errors`、`warnings`）与 0.16.5 基线一致 | 同上；任一不成立表示零回归被破坏，回装旧版并回流本提案 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目、一次性「发布目录」与一次性基线 prefix 内进行，结束即删除。**不得**触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态目录、用户其他仓库（包括 runlogos）或本机全局 prefix；本节对全局安装态只读，对本仓只做 SMOKE-core-263 ④ 的只读比对。
- 不触发真实 CI、不访问任何远程服务。
- 命令图中不得出现 `npm publish` / dist-tag / `git tag`（临时项目内为构造夹具创建的本地 tag 除外）/ `gh release` / `git push`。
- 断言中不硬编码主机路径、墙上时钟或本机全局安装现值；commit 以临时仓库内 `git rev-parse` 的实际值比较。

### 三、追溯与覆盖

- 功能规格：§2.93.1、§2.93.6。
- 根规范：`spec/environments.md` §2.2、§7.2、§13；`spec/cli-json-output.md`「`env list`（data）」。
- 场景：S41「提案默认部署环境（proposal-default-environment）」。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.6 发布方案（提案默认部署环境，本地全局）」。
- 仓库内对应用例：UT-S41-20～UT-S41-22、ST-S41-06。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-proposal-default-environment-0-16-6.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-263～SMOKE-core-267，不得依靠通配发现后无条件 PASS。runner 记录全局入口 realpath、安装态版本、每个隔离项目路径、每次命令的退出码与 JSON 摘要。
- **适用性判定不得依赖自动流程不会设置的环境变量**：候选 tarball 先取显式环境变量，未设置时按候选版本取本仓 `cli/miniidealab-openlogos-<候选版本>.tgz`，并要求其 SHA-256 已写入部署记录；候选版本早于 0.16.6 时按缺候选制品处理。只有制品、部署记录、回滚制品或本仓 sync 确实缺失时才写显式 `skip` 并携带缺失项，不得标 `reason_code:"platform-unavailable"`。有 skip 时不得写 `SMOKE_PASS`。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/evidence`；**失败不得写 pass**。
- 判据以 `--format json` 的结构化字段、退出码与命令实际输出为准，不解析人类可读文案（SMOKE-core-264 ③ 的文本标注除外，它本身就是被测输出）。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-263～SMOKE-core-267 均被 runner 覆盖。

## 本机测试环境脚本部署安装态 smoke（SMOKE-core-268～271）

> 这组用例验证经 `openlogos deploy --env test`（`scripts/deploy-local.mjs`）部署后的本机全局安装态，与账本、脚本回执一致，且候选与回滚制品留存可用。依据：部署方案「本机测试环境脚本部署（scripts/deploy-local.mjs）」第二、四～七节，来源提案 local-install-deploy-script（决策 C01～C04）。本组是 `test` 环境的**通用**安装态检查，此后每次部署到 `test` 都会执行；各提案自己的行为用例另列。
>
> runner 对本机全局安装态、本仓运行态目录（回执、候选 tarball、回滚制品、账本）**只读**，不安装、不卸载、不改写任何文件；唯一的安装动作是 SMOKE-core-271 在 `mktemp -d` 一次性隔离 prefix 中试装回滚制品，结束即删除。判据以回执、账本（`openlogos env show test --format json`）与实际安装内容的交叉比对为准。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-268 | 登记表部署配置合法且预检零执行 | 本仓 `logos/environments.yaml` 的 `test` 已配置 `deploy: {mode: script, script: scripts/deploy-local.mjs}`；HEAD 含该脚本 | ① `openlogos env check --format json`；② `openlogos env show test --format json`；③ `openlogos deploy --env test --ref HEAD --channel version --dry-run --format json`；记录 ③ 前后本机全局入口 realpath、`--version`、运行态目录 `local-install/` 与账本的 SHA-256 | ① 退出码 0，`errors` 为空；② `environment.deploy.mode` 为 `script`，`environment.deploy.script` 为 `scripts/deploy-local.mjs`；③ 退出码 0、`status=dry-run`，`plan` 中脚本路径为 `scripts/deploy-local.mjs`；快照前后一致（零执行、零写入） | 保留输出。① ② 不成立 → 修正登记表后重跑；③ 不成立（如脚本缺可执行位）→ 回流实现修复，不执行部署 |
| SMOKE-core-269 | 全局身份与账本、回执一致 | 已经 `openlogos deploy --env test` 成功部署；回执 `logos/.openlogos-runtime/local-install/last-deploy.json` 存在 | ① 读取回执；② `openlogos env show test --format json`；③ 在新子进程中读取 `command -v openlogos` 的 realpath、`openlogos --version`、全局安装目录 `package.json` 版本与 `dist/index.js` 的 SHA-256 | ① 回执 `result=done`、`environment=test`；② `last_deploy.deploy_id` 等于回执 `deploy_id`，`last_deploy.result=done`、`last_deploy.mode=script`，`current_ref` 等于回执 `ref`；③ realpath 等于回执 `entry_realpath` 且位于回执 `prefix` 之下，`--version` 与 `package.json` 版本等于 `candidate_version`，`dist/index.js` 的 SHA-256 等于 `candidate_entry_sha256`；`evidence` 逐项记录比对值，不一致时点名字段 | 停止后续流程。按部署方案第五节：若账本最近部署成功而全局不一致，在部署报告记录偏离，以 `openlogos deploy --env test --ref <含本脚本的提交>` 重新部署；不得手改账本或回执 |
| SMOKE-core-270 | 候选 tarball 留存且可复算 | 同 SMOKE-core-269 | ① 读取回执 `candidate_tarball.path`；② 计算该文件 SHA-256；③ 解包到一次性目录，读取 `package/package.json` 版本与 `package/dist/index.js` 的 SHA-256 | 文件存在；② 等于 `candidate_tarball.sha256`；③ 版本等于 `candidate_version`，`dist/index.js` 哈希等于 `candidate_entry_sha256` | 停止后续流程。候选缺失或被改动时，以 `openlogos deploy --env test --ref <当前 current_ref>` 重新部署生成新回执与候选 |
| SMOKE-core-271 | 回滚制品可用 | 同 SMOKE-core-269，且回执 `rollback_artifact` 非 null | ① 计算 `rollback_artifact.path` 的 SHA-256；② 在 `mktemp -d` 隔离 prefix 中安装该制品，从隔离入口执行 `--version`，读取隔离安装目录 `dist/index.js` 的 SHA-256；③ 删除隔离 prefix 并复核本机全局入口与 `--version` 前后不变 | ① 等于 `rollback_artifact.sha256`；② `--version` 等于 `previous_version`，`dist/index.js` 哈希等于 `previous_entry_sha256`；③ 全局不变 | 回滚制品不可用不影响当前安装态，但须在部署报告记录，并在下次部署前确认脚本 ④ 的试装判据；不得以此跳过脚本 ④ |

### 二、执行边界

- 对本机全局 prefix、本仓 `logos/resources/`、本仓运行态目录与账本只读；唯一的写入是一次性解包目录与 SMOKE-core-271 的隔离 prefix，结束即删除。不触碰用户其他仓库（包括 runlogos），不访问 npm registry 以外的远程服务。
- `OPENLOGOS_SMOKE_ENV` 为 `test`（或未设置）时执行本组用例，每条结果写 `target_environment: "test"`；为其他环境时本组不适用，写显式 `skip` 并注明 `reason: "env-not-test"`。
- 回执缺失（`test` 从未经脚本部署）时，SMOKE-core-269～271 写显式 `skip` 并携带缺失项；SMOKE-core-271 在回执 `rollback_artifact` 为 null（部署前未全局安装）时写显式 `skip` 并注明原因。有 skip 时不得写 `SMOKE_PASS`。不得标 `reason_code:"platform-unavailable"`。

### 三、追溯与覆盖

- 部署：`core-01-deployment-plan.md`「本机测试环境脚本部署（scripts/deploy-local.mjs）」、「local-install-deploy-script 部署（本机测试环境首次脚本部署）」。
- 根规范：`spec/environments.md` §2.2、§7.1、§11.2～§11.6。
- 场景：S42（script 方式）、S41（环境视图）。
- 仓库内对应用例：UT-S42-19、UT-S42-24、ST-S42-05、ST-S42-06、ST-S42-08。
- 本组任一用例失败而部署已成功落账时，按部署方案第五节「(c) 成功落账后 smoke 失败」处置：不手工回装旧包，经 `openlogos deploy` 部署修复提交后重跑。
- 局限：手工安装的包若与回执记录的候选在版本、入口 realpath 与 `dist/index.js` 内容上完全相同，SMOKE-core-269 无法证明安装来源（部署方案第五节）。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-local-install-deploy.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-268～SMOKE-core-271，不得依靠通配发现后无条件 PASS。runner 的项目根、回执路径与 `npm` 可执行文件经参数或环境变量可覆盖，供 UT-S42-24 / ST-S42-06 指向一次性夹具；默认指向本仓与本机。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 判据以 JSON 字段、文件哈希与命令退出码为准，不解析人类可读文案。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-268～SMOKE-core-271 均被 runner 覆盖。

## OpenLogos 0.16.7 公开发布 smoke（SMOKE-core-272～279）

> 这组用例验证 0.16.7 公开发布的三处公网制品——npm registry、GitHub Release、Cloudflare Pages 官网——同源于本次实际发布版本 V；从公网安装的包在 macOS 与 Linux 上都能使用环境能力（环境登记表与部署账本、`openlogos deploy`、晋级与审批、提案默认部署环境，功能规格 §2.93～§2.95）；官网中英文文档已上线这些能力的页面。判据沿用「OpenLogos 0.16.2 公开发布 smoke（SMOKE-core-246～250）」的公网口径；安装态断言沿用 0.16.3～0.16.6 安装态 smoke（SMOKE-core-252、255、259、260、264）的行为判据，只把执行对象从「本机全局安装的本地候选」换成「从 registry 安装到一次性 prefix 的公网包」。
>
> **与既有用例的关系**：SMOKE-core-246～250 绑定已归档的 `release-0-16-2`，SMOKE-core-251～271 绑定各自来源提案并只验证本地候选或本仓本机部署，这些用例的适用窗口都不会因本提案打开；本组不复用其 ID，也不改写其定义。0.16.3～0.16.6 从未进入 npm，本组以它们在 registry 与 GitHub Release 上**不存在**作为反向断言。
>
> **版本口径**：V 为部署记录中实际成功发布的版本，初始为 `0.16.7`；按部署方案档 B2 前滚时为前滚后的 patch。V 与 tag 提交号从部署记录 `logos/resources/verify/deployment-report.md` 中**标题行含 `release-0-16-7` 的那一节**的 `public_release_version: <V>` / `public_release_commit: <sha>` 两行读取（同文件内其他节的同名行不得被误读）；提交号缺省时取 `git rev-parse v<V>^{commit}`。断言一律写成关系式，不硬编码 `0.16.7`；缺 V 或缺提交号时写显式 skip 并带缺失项。
>
> **执行边界**：runner 对公网**只读**——只用 `npm view`、`npm pack <spec>`（下载到临时目录）、`gh release view` / `gh release download`、`gh api`、HTTP GET。不执行 `npm publish`、`npm dist-tag`、`npm deprecate`、`git tag`、`git push`、`gh release create/edit/upload` 或 `wrangler`。安装态用例只装到 `mktemp -d` 一次性 prefix，或 `docker run --rm` 的一次性容器内；环境能力用例只在一次性临时 git 项目内执行，部署脚本只写该项目下的一次性发布目录。不触碰本机全局 prefix、本仓 `logos/environments.yaml`、本仓运行态账本、本仓活跃提案与用户其他仓库（包括 runlogos）。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-272 | registry 发布身份与 provenance，0.16.3～0.16.6 未进入 registry | `v<V>` 的 publish run 中 `Publish` 步骤 success（原 run 全绿，或部署方案档 C 已完成补做）；部署记录有 V 与 tag 提交号 | ① `npm view @miniidealab/openlogos dist-tags --json`；② `npm view @miniidealab/openlogos@<V> version gitHead dist.integrity dist.attestations --json`，并读取 `dist.attestations.url` 指向的证明；③ `npm pack @miniidealab/openlogos@<V>` 到临时目录并解包；④ 对照 tag 提交的 `cli/src/` 文件清单（`git ls-tree -r v<V> -- cli/src`）检查包内 `dist/**/*.js`；⑤ 对 `0.16.3`、`0.16.4`、`0.16.5`、`0.16.6` 逐个 `npm view @miniidealab/openlogos@<版本> version` | ① `latest` == V，`old` 不变；② `version` == V；SLSA provenance（predicate `https://slsa.dev/provenance/v1`）的 `resolvedDependencies[0].uri` 指向 `refs/tags/v<V>`，`digest.gitCommit` == `v<V>` 提交（`gitHead` 存在时须同样相等）；③ 包内 `package.json` 版本 == V，asset-manifest 版本 == V 且经 `validateAssetManifest` 校验通过；包内含 `dist/commands/env.js`、`dist/commands/deploy.js`、`dist/commands/approve.js`、`dist/commands/deploy-done.js` 与 `dist/lib/deployment-ledger.js`，`dist/index.js` 注册 `env`、`deploy`、`approve` 三个命令；`claude-plugin-template/bin/guard-check` 的受限命令清单含 `openlogos approve`；④ 每个 `dist/**/*.js` 都有同名 `cli/src/**/*.ts`；⑤ 四个版本均返回 E404 | 保留读取结果与 tarball SHA-256。①② 不符 → 按部署方案档 D 回退（`dist-tag latest` 回指 0.16.2、`npm deprecate <V>`）；③④ 不符表示公网制品与预演不同源，同样按档 D 处置并另立修复提案前滚；⑤ 返回版本号表示本机候选版本被意外发布，停止后续流程并在部署记录说明，由用户决定是否 `npm deprecate` 该版本 |
| SMOKE-core-273 | 宿主机（macOS）registry 隔离安装态可用，环境登记与默认环境生效 | SMOKE-core-272 通过；宿主机有 node、npm、git | ① `npm install -g --prefix <tmp> @miniidealab/openlogos@<V>`（从 registry 安装）；② `<tmp>` 入口 `--version`；③ 临时目录执行 `openlogos init smoke --locale zh --ai-tool all` 后 `sync`，再 `openlogos status --format json`；④ 另建临时 git 项目（经 `<tmp>` 入口 `init`），写入登记表：`test`（aliases 含「测试」）、`staging`、`prod`（alias `生产`），顶层 `proposal_default_env: test`，依次执行 `env check --format json`、`env list --format json`、`env list`（文本模式）；⑤ 在 ④ 项目内按 S19 夹具口径补齐活跃提案（`VERIFY_PASS`、`[deploy]` 全勾），smoke runner 夹具读取 `OPENLOGOS_SMOKE_ENV` 并写入结果行 `target_environment`，执行 `deploy-done --env 生产 --ref HEAD --format json`、`smoke --env prod --format json`、`env show prod --format json` | ① 退出码 0，入口 realpath 在 `<tmp>` 包目录内且非链接；② == V；③ 均退出码 0，生成 `logos/` 与各工具资产，`sync` 输出不含 `asset hash 不匹配`；status 为合法 JSON envelope 且 `version` == V；④ check 退出码 0、`errors` 为空；list 的 data 顶层 `proposal_default_env` == `"test"`；文本模式 test 行后有「（提案默认）」，其余行无标注（SMOKE-core-264 口径）；⑤ `DEPLOY_DONE` 为单行 JSON，`environment=="prod"`、`ref` 为当时 HEAD 的 40 位 commit；smoke 门禁 PASS，`environment_evidence.env_evidence=="declared"`、`verified==true`；`env show` 的 `last_smoke.verified==true`、`current_ref` 等于 `DEPLOY_DONE.ref`（SMOKE-core-252 口径） | 保留各步 stdout / stderr 与 JSON 摘要。任一失败表示环境登记能力未进入公网包或公网包不可用，按档 D 回退并另立修复提案前滚 |
| SMOKE-core-274 | 宿主机 registry 安装态部署执行、晋级与审批 | SMOKE-core-273 ①② 通过；另建临时 git 项目含 tag `v1`、`v2`，各带一版可执行部署脚本（脚本把 `OPENLOGOS_DEPLOY_REF` 与工作目录 HEAD 写入项目内一次性发布目录）；登记表中 `staging` 与 `prod` 均为 `deploy.mode: script`，`prod` 配置 `promote_from: staging`、`require_approval: true`；工作区另有一处未提交改动 | 全部经 `<tmp>` 入口：① `deploy --env staging --ref v1 --dry-run --format json`；② `deploy --env staging --ref v1 --format json` 与 `deploy --env staging --ref v2 --format json`，再 `env show staging --format json`；③ `deploy --env staging --rollback --format json`；④ `deploy --env prod --ref v1 --format json`（staging 尚未以 v1 通过 smoke）；⑤ `deploy --env staging --ref v1` 后 `smoke --env staging --format json`（夹具 runner 写 `target_environment`），再 `deploy --env prod --ref v1 --format json`（未审批）；⑥ 连续两次 `approve --env prod --ref v1 --format json`，再 `deploy --env prod --ref v1 --format json` | ① 退出码 0，不执行脚本、发布目录与账本无新增；② 退出码 0，`channel=version`、`mode=script`，`ref` 依次等于 v1、v2 的 commit，发布目录记录的 ref 与 HEAD 都等于对应 commit 且不含未提交改动；`current_ref` 为 v2、`previous_ref` 为 v1；③ 部署 v1，`rollback=true`、`rollback_from` 为 v2 的 commit（SMOKE-core-255 口径）；④ 错误 `DEPLOY_PROMOTION_UNVERIFIED`、退出码 1，零执行、账本无 deploy 记录；⑤ smoke `verified=true`；随后 prod 部署报 `DEPLOY_APPROVAL_REQUIRED`、退出码 1、`details.approve_command` 为可直接执行的命令原文，零执行；⑥ 两次返回同一 `approval_id`，第二次 `created=false`；部署成功，记录 `promoted_from=staging`、`approval_id` 等于 ⑥ 的值（SMOKE-core-259 / 260 口径） | 保留每步 JSON 摘要与发布目录内容。任一不成立表示部署执行器或晋级与审批门未进入公网包，按档 D 回退并另立修复提案前滚 |
| SMOKE-core-275 | Linux 容器内 registry 安装态环境能力 | SMOKE-core-272 通过；宿主机 docker 可用且可拉取 `node:20` | ① `docker run --rm node:20`（记录镜像摘要），容器内以**非 root 用户**执行后续全部步骤，读取 `id -u` 非 0；② `npm install -g --prefix <tmp> @miniidealab/openlogos@<V>` 后执行 `<tmp>` 入口 `--version`；③ 容器内按 SMOKE-core-273 ④⑤ 的夹具与步骤执行；④ 容器内按 SMOKE-core-274 的夹具与步骤执行 | ① 容器启动成功，uid 非 0；② 安装退出码 0，`--version` == V；③ 与 SMOKE-core-273 ④⑤ 预期相同；④ 与 SMOKE-core-274 预期相同（隔离工作树、子进程执行、审批幂等在 Linux 上同样成立） | 保留镜像摘要、uid、各步退出码与 JSON 摘要。① 环境构造失败（docker 不可用、镜像不可拉取）→ 显式 `skip` 并携带缺失项，不得标 platform-unavailable，不得写 `SMOKE_PASS`；②～④ 失败 → 公网包在 Linux 上不可用，按档 D 回退并另立修复提案前滚 |
| SMOKE-core-276 | GitHub Release 与 registry 同源，0.16.3～0.16.6 无 Release | SMOKE-core-272 通过；`gh` 已认证 | ① `gh release view v<V> --json tagName,isDraft,isPrerelease,body,assets`；② `gh api repos/{owner}/{repo}/releases/latest --jq .tag_name`；③ `gh release download v<V> --pattern 'miniidealab-openlogos-*.tgz'` 到临时目录；④ 按 `publish.yml`「Prepare release notes」同规则，从 `v<V>` 提交的 `CHANGELOG.md` 提取 `## [V]` 节；⑤ 对 `v0.16.3`、`v0.16.4`、`v0.16.5`、`v0.16.6` 逐个 `gh api repos/{owner}/{repo}/releases/tags/<tag>` | ① 存在，非 draft、非 prerelease；② == `v<V>`；③ 恰一个附件 `miniidealab-openlogos-<V>.tgz`，SHA-256 == SMOKE-core-272 记录的 registry tarball SHA-256；④ Release 正文与提取结果去首尾空白后逐字一致，含「环境」、「openlogos deploy」、「openlogos approve」与「从 0.16.2 升级」，且**不含**「未发布到 npm」；⑤ 均返回 404 | 保留 Release JSON 与附件 SHA-256。缺 Release 或缺附件 → 按部署方案档 C 受控补做（不重复 create）；附件与 registry 不同源 → 以 registry 制品为准替换附件并在部署记录说明；⑤ 返回 Release 表示未公开版本被意外发布，停止并由用户决定处置 |
| SMOKE-core-277 | 官网 latest 等于 V、V 英文摘要在场 | 官网已由 publish run 或档 C 补做部署到 Cloudflare Pages | ① GET `https://openlogos.ai/releases` 与 `https://openlogos.ai/zh/releases`；② GET 首页 `https://openlogos.ai/`，取最近发布入口；③ `git show v<V>:website/src/data/release-summaries-en.mjs` | ① 均为 200，页面 latest 版本 == V（SMOKE-core-15 口径），V 条目展示英文价值摘要（不是固定回退提示）及中文原文次级内容（SMOKE-core-07 口径）；② 入口指向 `/releases` 且非 404（SMOKE-core-08 口径）；③ 含键 `'<V>'`，不含键 `'0.16.3'`、`'0.16.4'`、`'0.16.5'`、`'0.16.6'` | 保留 HTTP 状态码与页面摘录。① latest 不等于 V 时，先确认 registry `dist-tags.latest` 已是 V；若是，则按档 C 重新生成并部署官网，不得手改 `releases.json`；英文摘要缺失或 ③ 不符 → 修正 `release-summaries-en.mjs` 后经官网部署前滚（不涉及 npm） |
| SMOKE-core-278 | 官网中英文新增文档页上线且可从侧边栏进入 | 同 SMOKE-core-277 | ① GET 英文页 `https://openlogos.ai/cli/env/`、`/cli/deploy/`、`/cli/approve/`、`/specs/environments/` 与中文页 `/zh/cli/env/`、`/zh/cli/deploy/`、`/zh/cli/approve/`、`/zh/specs/environments/`；② GET `https://openlogos.ai/cli/` 与 `https://openlogos.ai/zh/cli/`；③ 对 `v<V>` 提交执行 `git ls-tree -r v<V> -- website/src/content/docs` | ① 八页均为 200；中文页 `<html lang="zh-CN">`（SMOKE-core-21 口径）；env 页含 `openlogos env list`、`env check` 与 `proposal_default_env`；deploy 页含 `openlogos deploy --env`、`--dry-run`、`--rollback`、`DEPLOY_APPROVAL_REQUIRED` 与 `DEPLOY_PROMOTION_UNVERIFIED`；approve 页含 `openlogos approve --env` 与 `--ref`；environments 页含 `logos/environments.yaml`、`promote_from`、`require_approval` 与 `deployments.jsonl`；② 两页侧边栏均含指向本语言 `cli/env`、`cli/deploy`、`cli/approve` 的链接，规范分组含指向 `specs/environments` 的链接；③ 中英文两份均含 `cli/env.md`、`cli/deploy.md`、`cli/approve.md`、`specs/environments.md` | 保留 HTTP 状态码与页面摘录。页面 404 而 ③ 在场 → 官网未部署到 `v<V>`，按档 C 重新构建并部署官网；③ 缺文件 → 文档未进入发布提交，补文档后经官网部署前滚（不涉及 npm） |
| SMOKE-core-279 | 官网中英文既有文档页已补环境能力 | 同 SMOKE-core-277 | GET 以下英文页及其 `/zh/` 对应页：`/cli/deploy-done/`、`/cli/smoke/`、`/cli/status/`、`/cli/ignore-exempt/`、`/specs/change-management/`、`/skills/deployment-executor/`、`/skills/change-writer/` | 全部为 200；deploy-done 页含 `--ref` 与 `DEPLOY_DONE_GATED_ENV`；smoke 页含 `OPENLOGOS_SMOKE_ENV` 与 `target_environment`；status 页含 `environments`；ignore-exempt 页含 `logos/environments.yaml`；change-management 页含 `openlogos approve` 与 `--force-promote`；deployment-executor 页含 `openlogos deploy`；change-writer 页含 `proposal_default_env`；中英文两页的命中项一致 | 保留 HTTP 状态码与页面摘录。缺项 → 修正对应文档后经官网部署前滚（不涉及 npm） |

### 二、复用的在案用例

以下在案用例沿用其原定义，本次只规定执行对象（定义不在本节重复登记）：

- 版本用例 SMOKE-core-01：以 SMOKE-core-273 的隔离 prefix 入口执行，`openlogos --version` == V。
- init 资产用例 SMOKE-core-02：以 SMOKE-core-273 ③ 的 `init smoke --locale zh --ai-tool all` 结果核对 `logos/resources/reference/` 六个子目录。
- 插件模板用例 SMOKE-core-04：以 SMOKE-core-272 ③ 解包的 registry tarball 核对 Claude Code、OpenCode、Codex 插件模板在场。
- 发布动态双语摘要用例 SMOKE-core-07：以 SMOKE-core-277 ① 的 `/releases` 页面执行。
- 首页入口用例 SMOKE-core-08：以 SMOKE-core-277 ② 执行。
- tag 与官网一致用例 SMOKE-core-15：以 SMOKE-core-277 ① 的 latest 版本断言执行，tag 版本取 V。
- 中文站点路由用例 SMOKE-core-21：以 SMOKE-core-278 ① 的中文新页执行，并照原定义访问 `/zh`、`/zh/getting-started`、`/zh/cli`。

### 三、执行边界

- 公网只读（见本节导言）；命令图中不得出现发布写操作。
- 宿主机安装态只装到 `mktemp -d` 一次性 prefix，结束即删除（含临时项目及其发布目录、账本）；Linux 安装态只在 `docker run --rm` 的一次性容器内进行，结束时移除容器；本机全局切换与 `deploy-done --env prod` 落标属部署方案「发布后同步」，不在 smoke 内执行。
- 安装态用例调用的 CLI 一律是 `<tmp>` 入口的绝对路径，不得经 PATH 解析到本机全局；子进程环境中移除继承的 `OPENLOGOS_DEPLOY_*` 与 `OPENLOGOS_SMOKE_RESULT_PATH`，夹具 runner 的结果文件写在临时项目内。
- 断言不硬编码主机路径、墙上时钟、本机全局安装现值或 `0.16.7` 字面量；V、tag 提交号与 registry tarball SHA-256 运行时读取并在用例间传递。`0.16.3`～`0.16.6` 只作为「从未公开」的反向断言对象出现（SMOKE-core-272 ⑤、SMOKE-core-276 ⑤、SMOKE-core-277 ③）。
- 页面断言比对文本时，原文或其 HTML 转义形式任一在场即可（与 `website/scripts/smoke-releases.mjs` 的口径一致）。
- 网络不可达、`gh` 未认证、部署记录缺 V、docker 不可用时写显式 `skip` 并携带缺失项。这些都是可补齐的环境缺口，**不得**标 `reason_code:"platform-unavailable"`；有 skip 时不得写 `SMOKE_PASS`。

### 四、追溯与覆盖

- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.7 公开发布方案（npm / GitHub Release / 官网，含官网文档补齐）」。
- 来源提案：release-0-16-7（决策 C01～C10）；能力来源 environment-registry、fix-environment-registry-review-gaps（功能规格 §2.93）、environment-deploy（§2.94）、environment-promotion-approval（§2.95）、proposal-default-environment（§2.93.1、§2.93.6）。
- 覆盖关系：
  - registry 身份、环境命令进入构建产物、0.16.3～0.16.6 未进入 registry → SMOKE-core-272；
  - 宿主机公网安装可用、环境登记全链路与提案默认环境 → SMOKE-core-273；
  - 宿主机公网包的 script 部署、回滚、晋级与审批 → SMOKE-core-274；
  - Linux 公网安装态的环境能力（对应仓库内 core-S41 / S42 / S43 用例的公网验证）→ SMOKE-core-275；
  - GitHub Release 同源、发布说明正确、未公开版本无 Release → SMOKE-core-276；
  - 官网 latest 与英文摘要 → SMOKE-core-277；
  - 官网新增文档页与侧边栏 → SMOKE-core-278；
  - 官网既有文档页补齐 → SMOKE-core-279；
  - 版本、init 资产、插件模板、官网入口、中文路由 → 复用的 SMOKE-core-01 / 02 / 04 / 07 / 08 / 15 / 21。

### 五、自动化与证据要求

- 新增 runner `scripts/smoke-public-release-0-16-7.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-272～SMOKE-core-279 及上表复用用例，不得依靠通配发现后无条件 PASS；可参照 `scripts/smoke-public-release-0-16-2.js` 与 0.16.3～0.16.6 安装态 runner 的判据实现，但不修改这些 runner，也不抽取共用库。
- runner 适用窗口：活跃变更为 `release-0-16-7`，或 `OPENLOGOS_PR167_SMOKE=1`；窗口之外按既有留痕机制为全部 owned ID 写 skip。环境变量一律使用 `OPENLOGOS_PR167_` 前缀，不得复用其他发布的前缀。
- runner 提供自测模式：注入本地 tarball 替代 registry 规格（SMOKE-core-275 以只读挂载把 tarball 传入容器）、注入本地预览 URL 替代官网域名，并把结果写入独立账本。自测结果不得写入项目正式 smoke 账本；正式模式拒绝注入。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；`target_environment` 取本次 `OPENLOGOS_SMOKE_ENV`（正式执行为 `prod`），skip 记录不声明 `target_environment`；evidence 记录 V、tag 提交号、registry tarball SHA-256、Release 附件 SHA-256、HTTP 状态码、隔离 prefix 路径与各步 JSON 摘要，SMOKE-core-275 另记镜像摘要与容器内 uid。**失败不得写 pass**。
- 判据以 JSON 字段、退出码、SHA-256、HTTP 状态码与发布目录内容为准；页面与发布说明断言只针对版本号、固定路径、是否为回退提示与上表列出的关键字，不解析其余人类可读文案。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-272～SMOKE-core-279 均被 runner 覆盖。

## OpenLogos 0.16.8 按模块限定 verify 范围安装态 smoke（SMOKE-core-280～284）

> 这组用例验证按模块限定 verify 范围（来源提案 module-scoped-verify，功能规格 §2.96）确实进入了本机全局安装态：模块范围的启用条件、范围 M 的计算与回落全量、`openlogos verify --all`，以及 `openlogos change` 在 guard 中记录 `baseRef`。它们都是 CLI 运行时行为，只有全局 `openlogos` 升级后才对用户的各项目（含 runlogos 的 Team 版模块）生效。
>
> 用例在 `mktemp -d` 一次性隔离 git 项目内执行（经全局 `openlogos init` 建立，再写入多模块 `logos/logos-project.yaml`：`core` 的 `paths` 为 `["src/**"]`、`portal-web` 的 `paths` 为 `["portal-web/**"]`，测试规格 `core-S01-test-cases.md`、`portal-web-S50-test-cases.md` 与全局 `shared-S90-test-cases.md`；`verify.modules` 两个模块各配一条「记录型运行器」命令，项目级命令为同一运行器带参数 `project`，`verify.sandbox_mode` 为 `off`）。记录型运行器把自身参数与 `OPENLOGOS_VERIFY_MODULES` 逐行写入项目外一次性调用日志，并写入对应模块用例的本轮结果（全部 pass，除非用例另行说明）。运行器支持两个夹具开关（review F5，所有失败与范围外结果都由本轮运行器输出）：`MSV_EMIT_FOREIGN=1` 时被调用为 portal-web 的那次另输出一条 core 用例 UT-S01-01 的 fail 行；`MSV_CORE_FAIL=1` 时被调用为 core 的那次把 UT-S01-01 写为 fail。需要验证结果新鲜度的用例在 verify 前向结果文件预置一条「上一轮遗留」的 core 失败行。提案经全局 `openlogos change` 创建，因此 guard 带安装态写入的 `baseRef`。runner 以子进程直接调用全局 CLI，对全局安装态**只读**，不做安装或卸载，不触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态账本与用户其他仓库（包括 runlogos）；唯一读取本仓的是 SMOKE-core-280 ④ 对本仓托管副本的只读比对。判据用**行为断言**：全局 `--version` 等于部署记录版本只证明装了新包。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.8`。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-280 | 安装态版本、制品身份与本仓 sync 同源 | 本机全局已安装本次候选；部署记录中有候选版本与 tarball SHA-256；本仓已按部署方案执行 `openlogos sync` | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并重算 `payloadHash`；③ 检查全局包内存在范围计算实现（`dist/lib/` 下的模块范围计算文件）、`dist/index.js` 注册 `verify --all`、`dist/commands/change.js` 写入 `baseRef`；④ 逐字节比对本仓 `.claude/openlogos/bin/guard-check` 与全局包内 `claude-plugin-template/bin/guard-check` | ① `--version` 等于部署记录候选版本，入口无 workspace link；② `payloadHash` 自洽；③ 全部成立；④ 字节一致 | 保留读取结果。①～③ 任一不符 → 停止后续流程，按部署方案以 `openlogos deploy --env test --rollback`（或部署方案指定的回滚制品）回到 0.16.7；④ 不一致 → 重新执行本仓 `openlogos sync` 后复核，仍不一致则回流本提案 |
| SMOKE-core-281 | 安装态只改一个模块时只执行该模块命令 | 本机全局已安装本次候选；多模块临时项目已初始提交；`openlogos change msv-smoke` 创建归属 `portal-web` 的提案；工作区只改 `portal-web/app.ts`；设 `MSV_EMIT_FOREIGN=1`；verify 前向结果文件预置一条上一轮遗留的 core 失败行 | ① 读取 guard；② `openlogos verify --format json`；③ 读取调用日志与 `acceptance-report.md` | ① guard 的 `baseRef` 等于创建提案时的 `git rev-parse HEAD`；② 退出码 0，`gate.result=="PASS"`，`scope.mode=="module"`、`scope.modules==["portal-web"]`，`scope.reasons` 含 `source:"proposal"`，`summary.defined_count` 只含 portal-web 与全局用例，`scope.out_of_scope_result_count==1`（本轮 portal-web 运行器输出的 core 行），预置的遗留行已被执行前清空、不被采信；③ 调用日志只有 portal-web 命令一次，`OPENLOGOS_VERIFY_MODULES=="portal-web"`；报告 Summary 含「范围」行 | 同上；任一不成立表示范围计算或按模块执行未进入安装态，回装旧版并回流本提案 |
| SMOKE-core-282 | 安装态改动归不到模块时回落全量 | 同 SMOKE-core-281 的临时项目，另新建 `scripts/release.sh`（不在任何 `paths` 内） | `openlogos verify --format json`；读取调用日志 | `scope.mode=="fallback-full"`、`scope.fallback_reason.code=="unmapped_file"`、`detail` 含 `scripts/release.sh`；调用日志 core、portal-web 命令各一次；defined 含全部用例 | 同上；任一不成立表示回落全量未进入安装态，回装旧版并回流本提案 |
| SMOKE-core-283 | 安装态 `--all` 全量 | 同 SMOKE-core-281 的临时项目（只改 `portal-web/app.ts`），不设 `MSV_EMIT_FOREIGN`；verify 前向结果文件预置一条上一轮遗留的 core 失败行 | ① `openlogos verify --all --format json`；② 设 `MSV_CORE_FAIL=1` 后重跑 ①；每次读取调用日志 | ① `scope.mode=="all"`、`scope.modules==["core","portal-web"]`、`fallback_reason==null`；两个模块命令各执行一次；遗留行不被采信，`gate.result=="PASS"`；② 本轮 core 命令输出的 UT-S01-01 fail 进入 `failed_cases`，`gate.reason=="failed_cases"`（review F5） | 同上；任一不成立表示 `--all` 未进入安装态，回装旧版并回流本提案 |
| SMOKE-core-284 | 安装态未启用零回归（单模块与无 `paths` 的多模块项目） | 本机全局已安装本次候选；两个临时项目：A 单模块项目（只登记 `core`）；B 多模块项目，两个模块都不写 `paths`；两者都以全局 `openlogos change` 创建提案并只写带模块前缀的 delta（纯规格提案）；对同一夹具以 0.16.7 回滚制品在一次性隔离 prefix 中执行同样命令作为基线 | 对 A、B 分别执行 `openlogos verify --format json` 与读取 `acceptance-report.md`，与基线剔除 `timestamp`、`duration_ms` 后比对 | 两者都无 `scope` 键、`pre_run.commands[]` 无 `modules`、报告无「范围」行；defined 为全部用例；只执行项目级命令；除版本字段外与 0.16.7 基线逐字一致 | 同上；任一不成立表示零回归被破坏（review F1），回装旧版并回流本提案 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目、一次性调用日志目录与一次性基线 prefix 内进行，结束即删除。**不得**触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态目录、用户其他仓库（包括 runlogos）或本机全局 prefix；本节对全局安装态只读，对本仓只做 SMOKE-core-280 ④ 的只读比对。
- 不触发真实 CI、不访问任何远程服务。
- 命令图中不得出现 `npm publish` / dist-tag / `git tag` / `gh release` / `git push`。
- 断言中不硬编码主机路径、墙上时钟、本机全局安装现值或版本字面量；commit 以临时仓库内 `git rev-parse` 的实际值比较。

### 三、追溯与覆盖

- 功能规格：§2.96。
- 需求：`core-01-requirements.md`「S13 按模块限定 verify 范围验收补充」。
- 根规范：`spec/logos-project.md` §modules（`paths`）、`spec/logos.config.schema.json`（`verify.modules`）、`spec/test-results.md` §运行约定、`spec/cli-json-output.md` §4（`scope`）、`spec/change-management.md`（guard `baseRef`）。
- 场景：`core-S13-verify-results.md`「S13 按模块限定范围的 verify」。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.8 本机测试环境发布（module-scoped-verify）」。
- 仓库内对应用例：UT-S13-104～UT-S13-121、ST-S13-27～ST-S13-32。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-module-scoped-verify-0-16-8.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-280～SMOKE-core-284，不得依靠通配发现后无条件 PASS。runner 记录全局入口 realpath、安装态版本、每个隔离项目路径、每次命令的退出码、调用日志与 JSON 摘要。
- 适用窗口：活跃变更为 `module-scoped-verify`，或 `OPENLOGOS_MSV_SMOKE=1`；窗口之外按既有留痕机制为全部 owned ID 写 skip。环境变量一律使用 `OPENLOGOS_MSV_` 前缀。
- **适用性判定不得依赖自动流程不会设置的环境变量**：候选版本取自部署记录与 `cli/src/lib/local-release-candidate.ts`，候选版本早于 0.16.8 时按缺候选制品处理；只有部署记录、回滚制品或本仓 sync 确实缺失时才写显式 `skip` 并携带缺失项，不得标 `reason_code:"platform-unavailable"`。有 skip 时不得写 `SMOKE_PASS`。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`，`target_environment` 取本次 `OPENLOGOS_SMOKE_ENV`，skip 记录不声明；**失败不得写 pass**。
- 判据以 `--format json` 的结构化字段、退出码、调用日志与报告 Summary 表行为准，不解析其余人类可读文案。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-280～SMOKE-core-284 均被 runner 覆盖。

## OpenLogos 0.16.9 guard 按模块生命周期判定安装态 smoke（SMOKE-core-285～288）

> 这组用例验证 guard 按模块生命周期判定（来源提案 module-lifecycle-guard，功能规格 §2.97）确实进入了本机全局安装态，并经 `openlogos sync` 落到使用仓库：混合生命周期项目中 initial 模块的前缀规格与 `paths` 内代码免提案写入；launched 模块文件、共享配置与未归属文件仍被拦截；sync 后 AGENTS.md / CLAUDE.md 托管段不再含覆盖 initial 模块的全局禁令；全 initial 项目零改动。
>
> 用例在 `mktemp -d` 一次性隔离 git 项目内执行：经全局 `openlogos init`（`aiTool: claude`）建立，再写入混合生命周期 `logos/logos-project.yaml`——`core`（launched，`paths: ["src/**"]`）与 `team`（initial，`paths: ["team/**"]`），`scenarios` 中 `S44` 的 `module` 为 `team`；已跟踪 `src/main.ts`、`team/app.ts`、`scripts/release.sh` 并完成初始提交；随后以全局 `openlogos sync` 部署项目内 guard 副本。guard 判定一律以该项目 sync 后的 `.claude/openlogos/bin/guard-check` 与 `guard-post-check.cjs` 为被测对象，向 stdin 喂 PreToolUse / PostToolUse hook JSON（`permission_mode: "default"`），以退出码判定。runner 以子进程直接调用全局 CLI，对全局安装态**只读**，不做安装或卸载；对本仓与 runlogos 仓库只做 SMOKE-core-285 ④⑤ 的只读比对与读回。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.9`。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-285 | 安装态版本、制品身份与两仓 sync 同源 | 本机全局已安装本次候选；部署记录中有候选版本、tarball SHA-256 与 runlogos 项目根路径；本仓与 runlogos 已按部署方案执行 `openlogos sync` | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并重算 `payloadHash`；③ 检查全局包内存在共享向量 `guard-module-lifecycle.json`，且 `claude-plugin-template/bin/guard-check` 与 `guard-post-check.cjs` 含按模块归属判定；④ 逐字节比对本仓 `.claude/openlogos/bin/guard-check` 与全局包内同名文件；⑤ 逐字节比对 runlogos 仓 `.claude/openlogos/bin/guard-check` 与全局包内同名文件，并读回其 AGENTS.md / CLAUDE.md 托管段 | ① `--version` 等于部署记录候选版本，入口无 workspace link；② `payloadHash` 自洽；③ 全部成立；④⑤ 字节一致；⑤ 托管段对 `team` 按 initial 给出免提案条款，且不含不加限定的「无 guard 文件 → 禁止修改任何源代码」与「存在任何 launched 模块 → 必须先创建变更提案」 | 保留读取结果。①～③ 任一不符 → 停止后续流程，按部署方案以 `openlogos deploy --env test --rollback` 回到 0.16.8；④ 不一致 → 重新执行本仓 `openlogos sync` 后复核，仍不一致则回流本提案；⑤ 不一致 → 记录并回流本提案，不在 runlogos 中修改文件 |
| SMOKE-core-286 | 安装态 initial 模块免提案写入，launched 与共享文件仍被拦 | 本机全局已安装本次候选；混合生命周期临时项目已 sync；无活跃提案 | 以项目内 guard-check 依次判定：Write `logos/resources/prd/1-product-requirements/team-01-requirements.md`；Write `team/app.ts`；Write `logos/resources/api/S44-seats.yaml`；Write `src/main.ts`；Write `scripts/release.sh`；Write `logos/logos.config.json`；Write `team/.gitignore`；Bash `echo x > team/c.ts && echo y > src/main.ts`；再以 PreToolUse → 真实执行 → PostToolUse 链路执行 `node -e` 写 `team/b.ts` | 前三条 exit 0；`src/main.ts`、`scripts/release.sh` exit 2；`logos/logos.config.json`、`team/.gitignore` 按保护范围来源处理（不放行）；Bash 复合命令 exit 2 且 reason 只列 `src/main.ts`；`node -e` 链路 PostToolUse exit 0，无待报告项 | 同上；任一不成立表示按模块判定未进入安装态，回装旧版并回流本提案 |
| SMOKE-core-287 | 安装态 sync 后指令读回与其他模块有活跃提案 | 同 SMOKE-core-286 的临时项目 | ① 读回 AGENTS.md / CLAUDE.md 托管段；② 以全局 `openlogos change core-x` 创建 `core` 提案，`openlogos sync` 后再次读回托管段；③ 提案处于 plan 阶段（无 `PLAN_APPROVED`）时判定 Write `team/app.ts`、Write `src/main.ts` 与 Write `logos/changes/core-x/deltas/prd/1-product-requirements/core-01-requirements.md` | ① 托管段含「按模块生命周期豁免」小节，列出 `team`、`team-` 前缀规格与 `paths: team/**`，「无 guard 文件 → 禁止修改」限定为 launched 模块文件、共享配置与未归属文件；② 托管段写明 initial 模块文件在其他模块有活跃提案时也不受该提案范围限制；③ `team/app.ts` exit 0；`src/main.ts` exit 0，与 0.16.8 对同一输入的结论相同（Claude Code 提案期只收窄 plan 阶段的本提案 delta，review delta-r1 F2）；非原型 delta exit 2（既有 plan 收窄保留） | 同上；任一不成立表示持久化指令或提案期判定未进入安装态，回装旧版并回流本提案 |
| SMOKE-core-288 | 安装态全 initial 与全 launched 零回归 | 本机全局已安装本次候选；两个临时项目：A 全部模块 initial、B 全部模块 launched，其余同上；对同一夹具以 0.16.8 回滚制品在一次性隔离 prefix 中执行同样命令作为基线 | 对 A、B 分别执行 `openlogos sync`、读回托管段，并以项目内 guard-check 判定 SMOKE-core-286 的全部写入；与基线比对 | 托管段与基线逐字节一致；每条判定的退出码与 reason 与基线相同 | 同上；任一不成立表示零回归被破坏，回装旧版并回流本提案 |

### 二、执行边界

- 全部写入只在 `mktemp -d` 的一次性项目与一次性基线 prefix 内进行，结束即删除。**不得**触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态目录或本机全局 prefix；对全局安装态只读；对本仓与 runlogos 仓库只做 SMOKE-core-285 ④⑤ 的只读比对与读回，不在 runlogos 中执行任何命令。
- 不触发真实 CI、不访问任何远程服务。
- 命令图中不得出现 `npm publish` / dist-tag / `git tag` / `gh release` / `git push`。
- 断言中不硬编码主机路径、墙上时钟、本机全局安装现值或版本字面量；runlogos 项目根取自部署记录。

### 三、追溯与覆盖

- 功能规格：§2.97。
- 需求：`core-01-requirements.md`「guard 按模块生命周期判定需求」（AC-GUARD-MOD-10）。
- 根规范：`spec/pretooluse-guard.md`「按文件归属的模块生命周期判定（module-lifecycle-guard，规范性）」、`spec/agents-md.md`「混合生命周期项目的变更管理条款生成（module-lifecycle-guard）」。
- 场景：`core-S09-change-management.md`「S09-H 混合生命周期项目中 initial 模块免提案写入」。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.9 本机测试环境发布（module-lifecycle-guard）」。
- 仓库内对应用例：UT-S09-467～UT-S09-480、ST-S09-206～ST-S09-209。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-module-lifecycle-guard-0-16-9.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-285～SMOKE-core-288，不得依靠通配发现后无条件 PASS。runner 记录全局入口 realpath、安装态版本、每个隔离项目路径、每次判定的退出码与 reason 摘要。
- 适用窗口：活跃变更为 `module-lifecycle-guard`，或 `OPENLOGOS_MLG_SMOKE=1`；窗口之外按既有留痕机制为全部 owned ID 写 skip。环境变量一律使用 `OPENLOGOS_MLG_` 前缀。
- **适用性判定不得依赖自动流程不会设置的环境变量**：候选版本取自部署记录与 `cli/src/lib/local-release-candidate.ts`，候选版本早于 0.16.9 时按缺候选制品处理；只有部署记录、回滚制品、本仓或 runlogos 的 sync 确实缺失时才写显式 `skip` 并携带缺失项，不得标 `reason_code:"platform-unavailable"`。有 skip 时不得写 `SMOKE_PASS`。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`，`target_environment` 取本次 `OPENLOGOS_SMOKE_ENV`，skip 记录不声明；**失败不得写 pass**。
- 判据以退出码、托管段 marker 之间的文本与 hook stdout JSON 为准，不解析其余人类可读文案。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-285～SMOKE-core-288 均被 runner 覆盖。

## OpenLogos 0.16.10 按模块区分环境与 smoke 安装态 smoke（SMOKE-core-289～293）

> 这组用例验证按模块区分环境与 smoke（来源提案 module-scoped-env-smoke，功能规格 §2.98）确实进入了本机全局安装态。它们都是 CLI 运行时行为，只有全局 `openlogos` 升级后才对用户的各项目（含 runlogos 的 Team 版）生效。
>
> 用例在 `mktemp -d` 一次性隔离 git 项目内执行，经全局 `openlogos init` 建立后写入多模块 `logos-project.yaml`（`core` 不声明环境；`team` 声明 `deployment_gates.team.environments: [team-prod]`）、登记表（`test`、`team-prod`，`team-prod` 配置 script 方式 `deploy`，脚本为夹具内的记录型脚本）、smoke 规格（core / team / 全局三份）与两个记录型 smoke runner（项目级与 `smoke.modules.team.command`，把被调用模块与注入变量写入项目外一次性调用日志）。runner 以子进程直接调用全局 CLI，对全局安装态**只读**，不做安装或卸载，不触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态账本与用户其他仓库（包括 runlogos）；唯一读取本仓的是 SMOKE-core-289 ④ 的只读比对。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.10`。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-289 | 安装态版本、制品身份与本仓 sync 同源 | 本机全局已安装本次候选；部署记录中有候选版本与 tarball SHA-256；本仓已按部署方案执行 `openlogos sync` | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并重算 `payloadHash`；③ 检查全局包内 `spec/logos.config.schema.json` 含 `smoke.modules` 定义、`spec/environments.md` 含 §14、`dist/` 内存在 `ENV_MODULE_MISMATCH` 的实现；④ 逐字节比对本仓 `logos/spec/environments.md`、`logos/skills/change-writer/SKILL.md` 与全局包内同名文件 | ① `--version` 等于部署记录候选版本，入口无 workspace link；② `payloadHash` 自洽；③ 全部成立；④ 字节一致 | 保留读取结果；①～③ 任一不符 → 停止后续流程，按部署方案以 `openlogos deploy --env test --rollback` 回到 0.16.9；④ 不一致 → 重新执行本仓 `openlogos sync` 后复核，仍不一致则回流本提案 |
| SMOKE-core-290 | 安装态未声明模块不被登记表拦截、声明模块归属校验 | 本机全局已安装本次候选；多模块临时项目已初始提交；以全局 `openlogos change` 创建归属 core 的提案并满足部署前置 | ① core 提案执行 `deploy-done`（不传 `--env`）与 `smoke`；② core 提案执行 `deploy-done --env team-prod`；③ 改建归属 team 的提案，执行 `deploy-done --env test` 与不传 `--env` | ① 均成功，`DEPLOY_DONE.environment` 为 null，不写部署账本；② `ENV_MODULE_MISMATCH`、零写入；③ 依次 `ENV_MODULE_MISMATCH` 与 `ENV_REQUIRED`，均零写入 | 同上；任一不成立表示按模块区分未进入安装态，回装旧版并回流本提案 |
| SMOKE-core-291 | 安装态 core 有活跃提案时 team 版本部署与 team smoke | 同 SMOKE-core-290 的临时项目；core 有活跃提案且尚未部署 | ① `deploy --env team-prod --ref <HEAD>`；② `smoke --env team-prod --format json`；③ 读取调用日志与 core 提案目录 | ① 版本通道成功；② 通过，`scope.module="team"`、`scope.context="version"`，部署身份取自 ① 的账本记录；③ 调用日志只有 team 命令一次、`OPENLOGOS_SMOKE_MODULE=team`；core 提案目录前后字节一致，无 `DEPLOY_DONE` / `SMOKE_PASS` / `SMOKE_FAIL` | 同上 |
| SMOKE-core-292 | 安装态引用失效拒绝不降级 | 同上；把 team 的声明改为一个不存在的别名，`team-prod` 配置 `require_approval: true`，team 有活跃提案 | 执行 `deploy-done --env team-prod`、`smoke --env team-prod`、`deploy --env team-prod` | 三者均 `ENV_GATE_REFERENCE_UNKNOWN`，提案目录与账本字节不变，部署脚本未运行 | 同上 |
| SMOKE-core-293 | 安装态单模块零回归与 next 带 --env | 本机全局已安装本次候选；单模块临时项目带登记表；对同一夹具以 0.16.9 回滚制品在一次性隔离 prefix 中执行同样命令作为基线 | ① `deploy-done --env test`、`smoke --env test --format json` 与基线比对（剔除时间戳、耗时、随机 id）；② ready-to-smoke 时 `next --auto --format json` | ① 与基线一致，无 `scope`；② `auto_execute.command` 为 `openlogos smoke --env test`（基线为 `openlogos smoke`） | 同上 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目、一次性调用日志目录与一次性基线 prefix 内进行，结束即删除；**不得**触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态目录、用户其他仓库（包括 runlogos）或本机全局 prefix。
- 不触发真实 CI、不访问任何远程服务；`team-prod` 的部署脚本只写临时目录内的调用日志。
- 命令图中不得出现 `npm publish` / dist-tag / `git tag` / `gh release` / `git push`。

### 三、追溯与覆盖

- 功能规格：§2.98。需求：`core-01-requirements.md`「S41/S19/S21/S42 按模块区分环境与 smoke 验收补充」。
- 根规范：`spec/environments.md` §14；`spec/cli-json-output.md`「smoke / env / next 按模块区分增量」；`spec/test-results.md`「按模块限定 smoke 范围的运行约定」。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.10 本机测试环境发布（module-scoped-env-smoke）」。
- 仓库内对应用例：UT-S41-24～29、ST-S41-07、UT-S19-74～82、ST-S19-30～31、UT-S21-20～22、UT-S42-26～28。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-module-scoped-env-smoke-0-16-10.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-289～SMOKE-core-293，不得依靠通配发现后无条件 PASS。
- 适用窗口：活跃变更为 `module-scoped-env-smoke`，或 `OPENLOGOS_MSES_SMOKE=1`；窗口之外按既有留痕机制为全部 owned ID 写 skip。环境变量一律使用 `OPENLOGOS_MSES_` 前缀。
- 适用性判定不得依赖自动流程不会设置的环境变量；只有部署记录、回滚制品或本仓 sync 确实缺失时才写显式 `skip` 并携带缺失项，不得标 `reason_code:"platform-unavailable"`。有 skip 时不得写 `SMOKE_PASS`。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-289～SMOKE-core-293 均被 runner 覆盖。

## OpenLogos 0.16.11 独立 smoke 模块应覆盖集合安装态 smoke（SMOKE-core-294～297）

> 这组用例验证独立 smoke 模块的应覆盖集合规则（来源提案 smoke-scope-isolated-modules，决策 C01、proposal-r1 F1，功能规格 §2.98.6）确实进入了本机全局安装态。这是 CLI 运行时行为，只有全局 `openlogos` 升级后才对用户的各项目（含 runlogos 的 Team 版）生效。
>
> 用例在 `mktemp -d` 一次性隔离 git 项目内执行，经全局 `openlogos init` 建立后写入 runlogos 形态的配置：
> - 多模块 `logos-project.yaml`：`core` 不声明环境；`team` 声明 `deployment_gates.team.environments: [team-prod]`。
> - 登记表：`test`、`team-prod`；`team-prod` 配置 script 方式 `deploy`，脚本为夹具内的记录型脚本。
> - smoke 规格：`core-smoke-test-cases.md`、`team-smoke-test-cases.md`，以及两份不带任何模块前缀、ID 段不统一的 core 发布规格。
> - 两个记录型 smoke runner：项目级 `smoke.command`，与 `smoke.modules.team.command`。它们把被调用模块与注入变量写入项目外一次性调用日志，并按用例写结果。
>
> runner 以子进程直接调用全局 CLI，对全局安装态**只读**，不做安装或卸载；不触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态账本与用户其他仓库（包括 runlogos）。唯一读取本仓的是 SMOKE-core-294 ④ 的只读比对。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.11`。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-294 | 安装态版本、制品身份与本仓 sync 同源 | 本机全局已安装本次候选；部署记录中有候选版本与 tarball SHA-256；本仓已按部署方案执行 `openlogos sync` | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并重算 `payloadHash`；③ 检查全局包内 `spec/environments.md` §14.5 含「独立 smoke 模块」定义；④ 逐字节比对本仓 `logos/spec/environments.md`、`logos/spec/test-results.md` 与全局包内同名文件 | ① `--version` 等于部署记录候选版本，入口无 workspace link；② `payloadHash` 自洽；③ 成立；④ 字节一致 | 保留读取结果；①～③ 任一不符 → 停止后续流程，按部署方案以 `openlogos deploy --env test --rollback` 回到 0.16.10；④ 不一致 → 重新执行本仓 `openlogos sync` 后复核，仍不一致则回流本提案 |
| SMOKE-core-295 | 安装态独立模块不被不带前缀的规格拖住 | 本机全局已安装本次候选；多模块临时项目已初始提交；以全局 `openlogos change` 创建归属 core 的提案且尚未部署 | ① `deploy --env team-prod --ref <HEAD>`；② `smoke --env team-prod --format json`（team runner 只写 team 前缀用例结果）；③ 读取调用日志与 core 提案目录 | ① 版本通道成功；② 通过，`summary.defined_count` 等于 team 前缀用例数，不带前缀的发布用例不在 `uncovered_cases`，`scope.reasons` 含 `isolated_module`；③ 调用日志只有 team 命令一次；core 提案目录前后字节一致 | 同上；任一不成立表示独立模块规则未进入安装态，回装旧版并回流本提案 |
| SMOKE-core-296 | 安装态非独立模块仍覆盖不带前缀的规格（含只配置路径覆盖） | 同 SMOKE-core-295 的临时项目；core 提案满足部署前置；另一变体在 `smoke.modules.core` 只写 `report_path` | ① core 提案 `deploy-done` 后 `smoke --format json`，项目级 runner 写全部结果；② 项目级 runner 把一条不带前缀的发布用例写为 `fail` 后重跑；③ 在只写 `report_path` 的变体上重复 ② | ① 通过，应覆盖集合含全部不带前缀的发布用例，不含 team 前缀用例；② `gate.result=FAIL`，该用例进入 `failed_cases`，不计入 `scope.out_of_scope_result_count`；③ 与 ② 相同，`scope.command_source="project"`，报告写入 `report_path` 所指位置 | 同上 |
| SMOKE-core-297 | 安装态单模块零回归与无独立模块项目覆盖范围扩大（delta-r1 F1） | 本机全局已安装本次候选；以 0.16.10 回滚制品在一次性隔离 prefix 中执行同样命令作为基线。夹具甲：单模块临时项目带登记表（按模块区分未启用）。夹具乙：多模块临时项目，team 声明 `deployment_gates.team.environments: [team-prod]`（按模块区分已启用），不配置 `smoke.modules`（无独立模块）；smoke 规格中 core 前缀、team 前缀与不带前缀的发布规格各至少一条用例（均非空） | ① 夹具甲：`deploy-done --env test`、`smoke --env test --format json`；② 夹具乙：team 版本部署后 `smoke --env team-prod --format json`，项目级 runner 依次：为全部用例写 `pass`；把一条 core 前缀用例写为 `fail`；不写该 core 用例的结果——三次分别在候选与基线上执行 | ① 与基线一致（剔除时间戳、耗时、随机 id），无 `scope`；② 不要求与基线等值，按新版完整范围验收：全部 `pass` 时候选 `summary.defined_count` 等于全部 smoke 规格用例数，且大于基线的 `defined_count`（基线不计入 core 前缀用例），候选 `gate.result=PASS`；core 用例 `fail` 时候选将其列入 `failed_cases` 且 `gate.result=FAIL`（基线把该行当范围外结果忽略）；缺结果时候选将其列入 `uncovered_cases`、门禁不通过，且基线的 `uncovered_cases` 是候选 `uncovered_cases` 的子集 | 同上 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目、一次性调用日志目录与一次性基线 prefix 内进行，结束即删除。
- **不得**触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态目录、用户其他仓库（包括 runlogos）或本机全局 prefix。
- 不触发真实 CI、不访问任何远程服务；`team-prod` 的部署脚本只写临时目录内的调用日志。
- 命令图中不得出现 `npm publish` / dist-tag / `git tag` / `gh release` / `git push`。

### 三、追溯与覆盖

- 功能规格：§2.98.6。需求：`core-01-requirements.md`「S41/S19/S21/S42 按模块区分环境与 smoke 验收补充」中的「异常：不带前缀的规格只计入非独立模块」「异常：只配置路径覆盖的模块不是独立模块」。
- 根规范：`spec/environments.md` §14.5；`spec/test-results.md`「按模块限定 smoke 范围的运行约定」中的「应覆盖用例」。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.11 本机测试环境发布（smoke-scope-isolated-modules）」。
- 仓库内对应用例：UT-S19-83～89、ST-S19-32，以及按新规则修订的 UT-S19-74、UT-S19-76、ST-S19-30。
- SMOKE-core-297 ② 是覆盖范围扩大的行为验收（已启用但无独立模块的项目，S 由「目标模块前缀 ∪ 不带前缀」扩大为全部规格，与 UT-S19-87 同口径），不是零回归；只有 ① 的单模块（未启用）项目要求与基线等值（delta-r1 F1）。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-smoke-scope-isolated-modules-0-16-11.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-294～SMOKE-core-297，不得依靠通配发现后无条件 PASS。
- 适用窗口：活跃变更为 `smoke-scope-isolated-modules`，或 `OPENLOGOS_SSIM_SMOKE=1`；窗口之外按既有留痕机制为全部 owned ID 写 skip。环境变量一律使用 `OPENLOGOS_SSIM_` 前缀。
- 适用性判定不得依赖自动流程不会设置的环境变量。只有部署记录、回滚制品或本仓 sync 确实缺失时，才写显式 `skip` 并携带缺失项，不得标 `reason_code:"platform-unavailable"`；有 skip 时不得写 `SMOKE_PASS`。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-294～SMOKE-core-297 均被 runner 覆盖。

## OpenLogos 0.16.12 多模块按模块阶段报告安装态 smoke（SMOKE-core-298～302）

> 这组用例验证多模块项目按模块的阶段报告（来源提案 module-scoped-phase-reports，决策 C01、proposal-r1 F1～F3，功能规格 §2.99）确实进入了本机全局安装态。这是 CLI 运行时行为，只有全局 `openlogos` 升级后才对用户的各项目（含 runlogos 的 team）生效。
>
> 用例在 `mktemp -d` 一次性隔离 git 项目内执行，经全局 `openlogos init` 建立后写入 runlogos 形态的配置：
> - 多模块 `logos-project.yaml`：`core`（launched）不声明环境；`team`（initial、`bootstrap: normal`）声明 `deployment_gates.team.environments: [team-prod]`；team 的 phase.3-0～3-5 产物齐全（均带 `team-` 前缀）。
> - 登记表：`test`、`team-prod`；`team-prod` 配置 script 方式 `deploy`，脚本为夹具内的记录型脚本，按设定退出码退出。
> - 测试规格：`core-S01-test-cases.md`、`team-S60-test-cases.md`；记录型 verify runner 按设定写结果并退出。smoke 规格：`core-smoke-test-cases.md`、`team-smoke-test-cases.md`；`smoke.modules.team.command` 为 team 记录型 smoke runner。
> - 另放入 core 历史留下的共用 `acceptance-report.md`、`deployment-report.md`、`smoke-report.md`（Gate PASS）与 `core-deployment-report.md`。
>
> runner 以子进程直接调用全局 CLI，对全局安装态**只读**，不做安装或卸载；不触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态账本与用户其他仓库（包括 runlogos）。唯一读取本仓的是 SMOKE-core-298 ④ 的只读比对。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.12`。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-298 | 安装态版本、制品身份与本仓 sync 同源 | 本机全局已安装本次候选；部署记录中有候选版本与 tarball SHA-256；本仓已按部署方案执行 `openlogos sync` | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并重算 `payloadHash`；③ 检查全局包内 `spec/flow-spec.md` §9 含多模块 initial 模块报告阶段的解析规则、`spec/environments.md` 含 §14.9；④ 逐字节比对本仓 `logos/spec/flow-spec.md`、`logos/spec/test-results.md`、`logos/spec/environments.md`、`logos/spec/directory-convention.md`、`logos/skills/deployment-executor/SKILL.md` 与全局包内同名文件 | ① `--version` 等于部署记录候选版本，入口无 workspace link；② `payloadHash` 自洽；③ 成立；④ 字节一致 | 保留读取结果；①～③ 任一不符 → 停止后续流程，按部署方案以 `openlogos deploy --env test --rollback` 回到 0.16.11；④ 不一致 → 重新执行本仓 `openlogos sync` 后复核，仍不一致则回流本提案 |
| SMOKE-core-299 | 安装态 initial 模块凭本模块验收报告离开 3-6 | 本机全局已安装本次候选；上述临时项目已初始提交；无活跃提案 | ① `status --format json`；② verify runner 为全部用例写 `pass`，执行 `verify --all --format json`；③ `status --format json`；④ verify runner 改为写全部 `pass` 后以退出码 1 退出，重跑 ②，再 `status` | ① team 的 current phase 为 phase.3-6（共用报告不计入）；② 写出 `team-acceptance-report.md`，Summary 含「模块」行 `team`、Gate PASS，不写 `core-acceptance-report.md`；③ team 进入 phase.3-7（共用与 core 的部署报告不让它越过 3-7）；④ `team-acceptance-report.md` Gate 变为 FAIL，team 回到 phase.3-6 | 同上；任一不成立表示模块验收报告未进入安装态，回装旧版并回流本提案 |
| SMOKE-core-300 | 安装态部署：失败不写，版本通道成功写并推进 3-7 | 同 SMOKE-core-299 的临时项目，team 已有 Gate PASS 的模块验收报告；以全局 `openlogos change` 创建归属 core 的提案且尚未部署 | ① 部署脚本退出 1 时 `deploy --env team-prod --ref <HEAD> --format json`；② 改为退出 0 后重跑 ①；③ `status --format json`；④ 读取 core 提案目录与共用 `deployment-report.md` | ① `DEPLOY_FAILED`，无 `team-deployment-report.md`；② 版本通道成功，写出 `team-deployment-report.md`；③ team 进入 phase.3-8；④ core 提案目录与共用部署报告前后字节一致 | 同上 |
| SMOKE-core-301 | 安装态冒烟报告与 launch 改认模块报告 | 同 SMOKE-core-300，team 已有模块验收报告（PASS）与模块部署报告 | ① 另建同形态临时项目但只保留共用报告，执行 `launch team`；② 回到本项目，team smoke runner 写全部 `pass`，执行 `smoke --env team-prod --format json`；③ `status --format json`；④ `launch team` | ① 拒绝，退出码 1，错误信息点名 `team-acceptance-report.md`，`logos-project.yaml` 字节不变；② 通过，写出 Gate PASS 的 `team-smoke-report.md`；③ team 全部阶段 done 或 skipped；④ 成功，team 的 lifecycle 为 launched | 同上 |
| SMOKE-core-302 | 安装态单模块项目零回归 | 本机全局已安装本次候选；以 0.16.11 回滚制品在一次性隔离 prefix 中执行同样命令作为基线；夹具甲：单模块临时项目（只登记 `core`，initial），带登记表 `test` | ① `verify --format json`；② `deploy-done --env test`（需活跃提案时以全局 `openlogos change` 创建）与 `smoke --env test --format json`；③ `status --format json`；④ 列出 `logos/resources/verify/` | ①～③ 与基线一致（剔除时间戳、耗时、随机 id）；④ 只有共用报告，没有任何 `<module>-*-report.md` | 同上 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目、一次性调用日志目录与一次性基线 prefix 内进行，结束即删除。
- **不得**触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态目录、用户其他仓库（包括 runlogos）或本机全局 prefix。
- 结果写入本仓 `logos/resources/verify/smoke-results.jsonl`，结果行带 `target_environment="test"`。

## OpenLogos 0.16.13 CLI 管道输出完整排空安装态 smoke（SMOKE-core-303～305）

> 这组用例验证 CLI 退出时管道输出完整排空（来源提案 fix-cli-exit-truncates-piped-output，场景 S16「非零退出时 JSON envelope 排空后退出 > CLI 入口统一设置阻塞写」EX-2.7、EX-2.8）确实进入了本机全局安装态。这是 CLI 运行时行为，只有全局 `openlogos` 升级后才对各项目（含 RunLogos driver 的消费）生效。
>
> 用例在 `mktemp -d` 一次性隔离项目内执行，经全局 `openlogos init` 建立后写入夹具；一律以 Node `child_process.spawn` 启动全局 CLI（默认 stdio 为 socketpair，macOS 下 8192 字节即截断），输出量 > 65536 字节，断言前先断言收到字节数。runner 以子进程调用全局 CLI，对全局安装态**只读**，不做安装或卸载；不触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态账本与用户其他仓库（包括 runlogos）。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.13`。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-303 | 安装态版本与制品身份 | 本机全局已安装本次候选；部署记录中有候选版本 | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并重算 `payloadHash`；③ 检查全局包内存在 `dist/lib/stdio-blocking.js`，且 `dist/index.js` 引用 `ensureBlockingStdio` | ① `--version` 等于部署记录候选版本，入口无 workspace link；② `payloadHash` 自洽；③ 成立 | 保留读取结果；任一不符 → 停止后续流程，按部署方案以 `openlogos deploy --env test --rollback` 回到 0.16.12 |
| SMOKE-core-304 | 安装态写出后立即退出的命令经 Node spawn 管道输出完整 | 本机全局已安装本次候选；临时 launched 单模块项目，活跃提案 `big-lint` 含 300 个缺段标记的 delta | ① Node `spawn` 全局 CLI `change-lint --format json` 读至 EOF；② Node `spawn` 全局 CLI `merge big-lint` 读 stderr 至 EOF | ① 收到字节数 > 65536，`JSON.parse` 成功，delta 违规条数为 300，退出码 2；② stderr > 65536 字节，逐条违规行数等于 ① 的违规总数，末尾自查提示在场，退出码 1 | 同上；任一不成立表示管道排空修复未进入安装态 |
| SMOKE-core-305 | 安装态消费方暂停读取时运行期区间仍及时响应 | 本机全局已安装本次候选；POSIX；临时 git 项目，登记表 `prod` 为 script 部署（脚本先记录进程号并派生孙进程，再回显 > 65536 字节后休眠），`timeout_sec: 3` | ① Node `spawn` 全局 CLI `deploy --env prod --ref HEAD`（text 模式）且不读取输出，等待脚本与孙进程被终止；② 恢复读取直至 EOF；③ 另起 400 模块临时项目，Node `spawn` 全局 CLI `watch --format json --interval 60` 且不读取输出，经 `OPENLOGOS_STDIO_TRACE` 观测到 `watch-ready` 后发 SIGINT | ① 在 `timeout_sec` + 10s 内脚本与孙进程均已终止，此时 CLI 尚未退出；② 回显末行在场，退出码 1；③ 10s 内以退出码 0 退出、无信号终止 | 同上 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目与一次性日志目录内进行，结束即删除；部署夹具的 `deploy` 只作用于一次性项目自带的登记表与一次性发布目录。
- **不得**触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态目录、用户其他仓库（包括 runlogos）或本机全局 prefix。
- 结果写入本仓 `logos/resources/verify/smoke-results.jsonl`，结果行带 `target_environment="test"`。

### 三、追溯与覆盖

- 场景：S16「非零退出时 JSON envelope 排空后退出 > CLI 入口统一设置阻塞写」EX-2.7（SMOKE-core-304）、EX-2.8（SMOKE-core-305）。需求：`core-01-requirements.md`「S16: CLI 退出时管道输出完整排空要求」。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.13 本机测试环境发布（release-0-16-13）」。
- 仓库内对应用例：UT-S16-46～48、ST-S16-06（对应 SMOKE-core-304）；UT-S16-51、UT-S16-53（对应 SMOKE-core-305）。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-release-0-16-13.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-303～SMOKE-core-305，不得依靠通配发现后无条件 PASS。
- 适用窗口：活跃变更为 `release-0-16-13`，或 `OPENLOGOS_R01613_SMOKE=1`；窗口之外按既有留痕机制为全部 owned ID 写 skip。环境变量一律使用 `OPENLOGOS_R01613_` 前缀。
- 适用性判定不得依赖自动流程不会设置的环境变量。只有部署记录确实缺失，或候选版本早于 0.16.13 时，才写显式 `skip` 并携带缺失项；非 POSIX 平台的 SMOKE-core-305 写显式 `skip`。有 skip 时不得写 `SMOKE_PASS`。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-303～SMOKE-core-305 均被 runner 覆盖。

## 官网提示词速查页发布后 smoke（SMOKE-core-306～307）

> 这组用例验证官网新增的中英文「提示词速查」页（slug `getting-started/prompt-cheatsheet`，来源提案 docs-prompt-cheatsheet）已在生产环境上线，内容满足两条判据：
> - 页面可达、入口齐全，覆盖两条主线、核心命令与人类确认点（306）；
> - 宿主差异区块覆盖 0.16.7 的全部具体宿主，并写明 ZCode / Qoder / WorkBuddy 下哪些 CLI 步骤由人在终端执行（307）。
>
> 中文路由与字体用复用的在案用例确认不受影响。
>
> **执行对象**：正式模式固定为生产域名 `https://openlogos.ai`，下文 `<base>` 指该域名。自测模式下 `<base>` 为本地预览 URL（`cd website && npm run preview`）。
>
> **URL 重定位**：沿用「官网文档 0.16.0 补齐发布后 smoke（SMOKE-core-235～238）」导言中的同名规则。origin 为 `https://openlogos.ai` 的站内 URL 改写到 `<base>` 的 origin 后再请求，其他 origin 的 URL 不请求、只记入 evidence；逐条记录实际请求 URL，出现任何一条去往其他 origin 的实际请求，当次所有用例判 fail。
>
> **宿主口径**：速查页按已公开的 0.16.7 编写，判据用的宿主集合也固定为 0.16.7 的取值，不随本机 CLI 版本变化。固定集合 H₀ = `claude-code`、`opencode`、`codex`、`cursor`、`zcode`、`qoder`、`workbuddy`。来源是 `v0.16.7` 提交中 `cli/src/index.ts` 帮助文本的 `--ai-tool <…>` 取值，去掉 `other` 与 `all`；runner 内以常量写死，并在注释中注明来源。取值到页面显示名的固定映射：`claude-code`→`Claude Code`、`opencode`→`OpenCode`、`codex`→`Codex`、`cursor`→`Cursor`、`zcode`→`ZCode`、`qoder`→`Qoder`、`workbuddy`→`WorkBuddy`。runner 另外读取本机 `openlogos --version` 与 `--help` 中的 `--ai-tool` 取值，**只写入 evidence，不参与判定**：本机 CLI 多出 H₀ 之外的取值时，在 evidence 中记为 `hosts_beyond_baseline=<取值>`，提示速查页在下次公开发版时更新，本用例不因此失败。
>
> **执行边界**：runner 对公网**只读**，只发 HTTP GET，并在本机执行 `openlogos --version` 与 `openlogos --help`。不执行 `wrangler`、`npm publish`、`git tag`、`git push` 或任何写操作。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-306 | 中英文速查页可达、入口齐全，覆盖两条主线、核心命令与人类确认点 | 正式模式：官网已按部署方案「官网提示词速查页发布检查（docs-prompt-cheatsheet）」部署，且本次部署记录已写入；自测模式：本地预览已启动 | ① GET `<base>/getting-started/prompt-cheatsheet` 与 `<base>/zh/getting-started/prompt-cheatsheet`；② 从 ① 两页的侧边栏提取「快速开始」/ "Getting Started" 分组内的链接序列；③ GET `<base>/getting-started` 与 `<base>/zh/getting-started`，提取正文中的站内链接；④ 取 ① 两页的正文区域（Starlight `.sl-markdown-content`，去掉 `<script>` 与 `<style>`），按 h2 / h3 标题切成小节 | ① 均返回 200；② 分组含指向本语言速查页的链接，且紧跟在本语言 `getting-started/first-collaboration` 链接之后（路径比较忽略末尾 `/`）；③ 英文简介页含指向 `/getting-started/prompt-cheatsheet` 的链接，中文简介页含指向 `/zh/getting-started/prompt-cheatsheet` 的链接；④ 每页同时满足：存在标题含「场景 A」与「场景 B」的小节（英文页为 "Scenario A" 与 "Scenario B"）；正文包含 `openlogos next`、`openlogos change`、`openlogos merge`、`openlogos verify`、`openlogos archive` 五个命令；存在标题含「人类确认点」的小节（英文页标题含 "human confirmation"，不区分大小写），该小节正文同时包含 `merge`、`verify`、`archive`、`git push` | 保留每个 URL 的状态码、侧边栏链接序列与缺失项清单。缺页、缺入口或缺判据内容时补写 `website/` 源码，重走部署方案发布前检查后重新部署；页面出现错误内容时，先按部署方案在 Cloudflare Pages 回滚 |
| SMOKE-core-307 | 宿主差异区块覆盖 0.16.7 全部具体宿主，并写明终端执行的步骤 | 同 SMOKE-core-306 | ① 取本节「宿主口径」的固定集合 H₀ 及其显示名；② 对 ① 中两页（SMOKE-core-306 ①），在正文区域找出宿主差异区块：标签（`[role="tab"]`）文本中出现任一宿主显示名的 Starlight Tabs 组件；③ 收集该区块全部标签文本；④ 定位标签文本同时含 `ZCode`、`Qoder`、`WorkBuddy` 的标签页，取其对应面板（`[role="tabpanel"]`）的正文 | ② 每页恰好找到一个宿主差异区块；③ 每页的标签文本合起来覆盖 H₀ 的全部显示名（大小写敏感，按子串匹配）；④ 每页都能定位到该标签页，面板正文同时包含 `openlogos change`、`openlogos merge`、`openlogos verify`，并包含「终端」（英文页为 "terminal"，不区分大小写） | 保留 H₀、本机 CLI 版本与 `--ai-tool` 取值（evidence）、每页标签文本清单、缺失的显示名与面板缺失项。宿主缺失或面板缺内容时补写 `website/` 源码后重新部署。速查页基线升级到新的公开版本时，另立变更同时更新页面与 H₀，不得在 runner 中改为读取本机 CLI |

### 二、复用的在案用例

以下在案用例沿用其原定义，本次只规定执行对象（定义不在本节重复登记）：

- 中文路由与语言切换用例 SMOKE-core-21：对 `<base>/zh`、`<base>/zh/getting-started`、`<base>/zh/getting-started/prompt-cheatsheet` 执行。
- 中文字体用例 SMOKE-core-23：对已部署站点执行。从中文营销页与中文速查页的 CSS 提取 `NotoSansSC-*.subset.woff2` 引用，逐个 GET，确认返回 200 且体积非空。

### 三、复用用例的记账交接

SMOKE-core-21 / 23 的既有认领者是 `website/scripts/smoke-releases.mjs`（按本地 `dist` 断言）。`scripts/run-smoke.js` 按路径排序执行 runner，`scripts/smoke-website-prompt-cheatsheet.js` 先于 `website/scripts/smoke-releases.mjs` 执行。后者会先删除其 `WEBSITE_SMOKE_IDS` 的已有结果再重写，不交接就会删掉本次生产证据，换成本地构建结果。因此：

- **交接窗口**：活跃变更为 `docs-prompt-cheatsheet`，或设置 `OPENLOGOS_PCS_SMOKE=1`。
- **窗口内**：`website/scripts/smoke-releases.mjs` 把 SMOKE-core-21 / 23 视为让出 ID：仍按本地构建执行断言并打印结果，但不删除、也不写入这两个 ID 的记录。这两个 ID 只由 `scripts/smoke-website-prompt-cheatsheet.js` 按 `<base>` 记账。
- **窗口外**：`website/scripts/smoke-releases.mjs` 行为不变。既有 `website-docs-0-16-0` 窗口（让出 07 / 08 / 21 / 23）保持不变，两个窗口的让出集合取并集。
- **必要改动范围**：只改 `website/scripts/smoke-releases.mjs` 的窗口判定与让出集合，不引入新的调度机制，不改 `scripts/run-smoke.js` 的发现顺序。
- **验证**：在交接窗口内经完整发现链路执行 `node scripts/run-smoke.js`。结束后正式账本中 SMOKE-core-21、23、306、307 各恰有一条记录，且都来自 `scripts/smoke-website-prompt-cheatsheet.js`（`target_environment` 为 `prod`，evidence 中实际请求 URL 的 origin 都等于 `<base>` 的 origin）。

### 四、执行边界

- 公网只读（见本节导言）；命令图中不得出现部署或发布写操作。
- 断言不硬编码主机路径、墙上时钟或部署 ID。
- **部署记录只在正式模式要求**：
  - 自测模式不要求生产部署记录（部署前还没有本次部署），evidence 写 `deploy_record=not-required(self-test)`；
  - 正式模式读取 `logos/resources/verify/deployment-report.md` 中本次部署的三行：`website_docs_deploy_change: docs-prompt-cheatsheet`、`website_docs_deploy_url: <部署 URL>`、`website_docs_deploy_id: <部署 ID>`。缺任一行，或 `website_docs_deploy_change` 不等于 `docs-prompt-cheatsheet`（即读到的是旧部署的记录），全部用例写显式 `skip` 并在 `missing_requirements` 中列出缺失项。URL 与 ID 只写入 evidence，不参与判定。
- 判据只看 HTTP 状态码、链接集合、标题与固定判据标记是否出现，不解析其余人类可读文案。
- 网络不可达、正式模式缺本次部署记录时写显式 `skip` 并带缺失项。这些都是可补齐的环境缺口，**不得**标 `reason_code:"platform-unavailable"`；有 skip 时不得写 `SMOKE_PASS`。本机未安装 CLI 不影响判定，只在 evidence 中记为缺失。

### 五、追溯与覆盖

- 部署：`core-01-deployment-plan.md`「官网提示词速查页发布检查（docs-prompt-cheatsheet）」，以及 §十一、§十五。
- 来源提案：docs-prompt-cheatsheet（决策 C01、C02）。
- 覆盖关系：
  - 页面可达、侧边栏与简介页入口、两条主线、核心命令、人类确认点 → SMOKE-core-306；
  - 宿主差异覆盖 0.16.7 全部具体宿主、ZCode / Qoder / WorkBuddy 终端执行说明 → SMOKE-core-307；
  - 中文路由、中文字体不受影响 → 复用的 SMOKE-core-21 / 23（记账交接见第三节）。

### 六、自动化与证据要求

- 新增 runner `scripts/smoke-website-prompt-cheatsheet.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行。runner 显式分派 SMOKE-core-306～SMOKE-core-307 及第二节复用用例，不得依靠通配发现后无条件 PASS。
- 适用窗口与第三节交接窗口相同：活跃变更为 `docs-prompt-cheatsheet`，或设置 `OPENLOGOS_PCS_SMOKE=1`。窗口之外只为 SMOKE-core-306～307 写 skip 留痕，不写 SMOKE-core-21 / 23。环境变量一律使用 `OPENLOGOS_PCS_` 前缀。
- 自测模式：设置 `OPENLOGOS_PCS_BASE=<本地预览 URL>` 时进入自测模式，结果写独立账本，不进项目正式 smoke 账本；该值的 origin 必须是 `localhost` 或 `127.0.0.1`，否则全部用例判 fail。未设置 `OPENLOGOS_PCS_BASE` 即为正式模式，`<base>` 固定为 `https://openlogos.ai`，不接受其他来源的地址。
- runner 写结果前先删除本 runner 记账 ID（SMOKE-core-306、307、21、23）在目标账本中的旧记录，保证每个 ID 只有一条结果。结果写入 smoke reporter，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`，`target_environment` 为 `prod`；**失败不得写 pass**。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-306～SMOKE-core-307 均被 runner 覆盖。

## 官网友情链接发布后 smoke（SMOKE-core-308）

> 这组用例验证官网营销页 footer 的 Markdown6 友情链接（来源提案 add-markdown6-friend-link）已在生产环境上线，且写法满足外链安全与可访问性要求。
>
> **执行对象**：正式模式固定为生产域名 `https://openlogos.ai`，下文 `<base>` 指该域名。自测模式下 `<base>` 为本地预览 URL（`cd website && npm run preview`）。
>
> **URL 重定位与重定向**：沿用「官网提示词速查页发布后 smoke（SMOKE-core-306～307）」的规则——origin 为 `https://openlogos.ai` 的地址改写到 `<base>` 的 origin 后再请求，其他 origin 的地址（含重定向 Location）不请求、只记入 evidence；重定向逐跳跟随并逐跳记录，跳数设上限。**不请求 `https://markdown6.com/` 本身**：本用例只验证官网上的链接写法，不验证第三方站点可用性。
>
> **执行边界**：runner 对公网**只读**，只发 HTTP GET。不执行 `wrangler`、`npm publish`、`git tag`、`git push` 或任何写操作。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-308 | 中英文营销页 footer 含 Markdown6 友情链接且写法合规 | 正式模式：官网已按部署方案「官网友情链接发布检查（add-markdown6-friend-link）」部署，且本次部署记录已写入；自测模式：本地预览已启动 | ① GET `<base>/`、`<base>/zh/`、`<base>/about/`、`<base>/zh/about/`；② 取每页 `<footer class="site-footer">` 元素内的 HTML；③ 在 footer 内找出 `href` 规范化后等于 `https://markdown6.com/` 的 `<a>` 元素 | ① 均返回 200；② 每页恰好一个 `site-footer`；③ 每页 footer 内恰好一个指向 `https://markdown6.com/` 的链接，其属性满足：`target="_blank"`；`rel` 同时含 `noopener` 与 `noreferrer`；有非空 `aria-label`；链接文本含 `Markdown6`。footer 文本含友情链接标签：中文页含「友情链接」，英文页含 "Friends" | 保留每个 URL 的状态码、footer 中匹配到的链接数量与属性。缺链接或属性不合规时修正 `website/src/layouts/BaseLayout.astro`，重走部署方案发布前检查后重新部署；页面出现错误内容时，先按部署方案在 Cloudflare Pages 回滚 |

### 二、执行边界

- 公网只读（见本节导言）；命令图中不得出现部署或发布写操作。
- 断言不硬编码主机路径、墙上时钟或部署 ID。
- **部署记录只在正式模式要求**：
  - 自测模式不要求生产部署记录，evidence 写 `deploy_record=not-required(self-test)`；
  - 正式模式读取 `logos/resources/verify/deployment-report.md` 中 `website_docs_deploy_change: add-markdown6-friend-link` 所属那份报告（到下一个一级标题为止）里的 `website_docs_deploy_url` 与 `website_docs_deploy_id`。缺 change 行、change 行属于其他提案，或该份报告缺 url / id，用例写显式 `skip` 并在 `missing_requirements` 中列出缺失项。URL 与 ID 只写入 evidence，不参与判定。
- 判据只看 HTTP 状态码、footer 元素、链接属性与固定标签文字是否出现，不解析其余人类可读文案。
- 网络不可达、正式模式缺本次部署记录时写显式 `skip` 并带缺失项。这些都是可补齐的环境缺口，**不得**标 `reason_code:"platform-unavailable"`；有 skip 时不得写 `SMOKE_PASS`。

### 三、追溯与覆盖

- 页面设计：`core-02-docs-website-experience.md`「二、信息结构」页脚条目。
- 部署：`core-01-deployment-plan.md`「官网友情链接发布检查（add-markdown6-friend-link）」。
- 来源提案：add-markdown6-friend-link（决策 C01、C02、C03）。
- 覆盖关系：营销页 footer 友情链接的存在、唯一性、外链安全属性与中英文标签 → SMOKE-core-308。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-website-friend-link.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-308，不得依靠通配发现后无条件 PASS。
- 适用窗口：活跃变更为 `add-markdown6-friend-link`，或设置 `OPENLOGOS_FRIEND_LINK_SMOKE=1`；窗口之外为 SMOKE-core-308 写 skip 留痕。环境变量一律使用 `OPENLOGOS_FRIEND_LINK_` 前缀。
- 自测模式：设置 `OPENLOGOS_FRIEND_LINK_BASE=<本地预览 URL>` 时进入自测模式，结果写独立账本（`OPENLOGOS_SMOKE_RESULT_PATH` 不得指向项目正式账本，路径按真实路径比较），该值的 origin 必须是 `localhost` 或 `127.0.0.1`，否则用例判 fail。未设置即为正式模式，`<base>` 固定为 `https://openlogos.ai`。
- runner 写结果前先删除 SMOKE-core-308 在目标账本中的旧记录，保证只有一条结果。结果写入 smoke reporter，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`，`target_environment` 为 `prod`；**失败不得写 pass**。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-308 被 runner 覆盖。

## OpenLogos 0.16.14 提案分支同步安装态 smoke（SMOKE-core-309～311）

> 这组用例验证「提案分支同步主分支」（来源提案 branch-sync-generated-files，场景 S44，规范 `spec/branch-sync.md`）在本机全局安装态中以 0.16.14 的身份可用。完整行为已由仓库内 S44 的 33 个用例覆盖；安装态只取证三件事：装上的是本次候选、`branch status` 与 `branch sync` 能在真实仓库上跑通、关键保护在安装态生效。
>
> 用例在 `mktemp -d` 一次性 git 仓库内执行：经全局 `openlogos init` 建立项目后写入夹具，在 `main` 上提交共同起点，分出 `proposal/a`，两条分支各自提交；仓库不配置远端，以 `--base main` 指定主分支。runner 以子进程调用全局 CLI，对全局安装态**只读**，不做安装或卸载；不触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态账本与用户其他仓库（包括 runlogos）。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.14`。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-309 | 安装态版本与制品身份 | 本机全局已安装本次候选；部署记录中有候选版本 | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并重算 `payloadHash`；③ 检查全局包内存在 `dist/commands/branch.js`、`dist/lib/branch-sync.js`、`dist/lib/registry-merge.js` 与 `spec/branch-sync.md`，以 `JSON.parse` 读取包内 `spec/logos.config.schema.json`；④ 执行 `openlogos --help` | ① `--version` 等于部署记录候选版本，入口无 workspace link；② `payloadHash` 自洽；③ 四个文件都在，schema 解析成功且 `properties.branch_sync` 含 `base_branch` 与 `replace_paths`；④ 帮助中有 `branch <sync\|status>` 一行 | 保留读取结果；任一不符 → 停止后续流程，按部署方案以 `openlogos deploy --env test --rollback` 回退 |
| SMOKE-core-310 | 安装态 `branch status` 与 `branch sync` 主链路 | 本机全局已安装本次候选；一次性仓库：共同起点的登记表含场景 S01 与 `scenario_counter.next_id: 50`；`main` 重写验收报告与测试结果账本、新增场景 S50、计数器推进到 51；`proposal/a` 重写验收报告与测试结果账本、新增场景 S51、计数器推进到 51，提案目录下有 `VERIFY_PASS` | ① 全局 CLI `branch status --base main --format json`；② 全局 CLI `branch sync --base main --format json`；③ 读取验收报告、测试结果账本、登记表与提案目录；④ `git status --porcelain` 与 `git rev-list --parents -n 1 HEAD` | ① 退出码 0，`behind=1`、`ahead=1`，`merge_base` 等于 `git merge-base` 的结果；② 退出码 0，`result=synced`，`replaced` 含验收报告与测试结果账本，`registry.status=merged`，计数器 `merged=51` 且 `both_advanced=true`，`invalidated_markers` 列出 `VERIFY_PASS`；③ 两个文件的字节等于 `git cat-file blob main:<path>`，登记表同时含 S50 与 S51，`VERIFY_PASS` 已不存在；④ 工作区干净，HEAD 是以同步前的提交与 `main` 为两个父提交的合并提交 | 同上；任一不成立表示同步能力未完整进入安装态 |
| SMOKE-core-311 | 安装态下的冲突报告与未入库文件保护 | 本机全局已安装本次候选；两个一次性仓库：甲在 SMOKE-core-310 的构造上让两条分支修改同一份需求文档的同一段；乙中 `main` 新增并跟踪 `notes.md`，`proposal/a` 有自己的提交且工作区有一个被 `.gitignore` 忽略的本地 `notes.md` | ① 在甲执行全局 CLI `branch sync --base main --format json`；② 在甲再次执行同一命令；③ 在乙记录全部文件、`git ls-files -s` 与 HEAD 的 SHA-256 后执行同一命令 | ① 退出码 2，`result=conflicts`，`remaining_conflicts` 只有该需求文档（`category=spec`、`reason=git-conflict`），`MERGE_HEAD` 存在，验收报告已取 `main` 版本；② 退出码 1，错误码 `BRANCH_OPERATION_IN_PROGRESS`；③ 退出码 1，错误码 `BRANCH_UNTRACKED_COLLISION`，`details.paths` 为 `["notes.md"]`，`MERGE_HEAD` 不存在，全部文件（含本地 `notes.md`）、索引与 HEAD 的 SHA-256 与执行前一致 | 同上 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性仓库内进行，结束即删除；`git` 操作只作用于这些一次性仓库，不配置远端、不联网。
- **不得**触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态目录、本仓的 git 分支与工作区、用户其他仓库（包括 runlogos）或本机全局 prefix。
- 结果写入本仓 `logos/resources/verify/smoke-results.jsonl`，结果行带 `target_environment="test"`。

### 三、追溯与覆盖

- 场景：S44「提案分支同步主分支：生成文件与登记表」Step 1～12（SMOKE-core-310）；EX-44.12、EX-44.15 与剩余冲突报告（SMOKE-core-311）。需求：`core-01-requirements.md`「S44: 提案分支同步主分支：生成文件与登记表」S44-AC-01、S44-AC-03、S44-AC-06、S44-AC-07、S44-AC-08、S44-AC-11、S44-AC-15、S44-AC-17。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.14 本机测试环境发布（release-0-16-14）」。
- 仓库内对应用例：UT-S44-28（对应 SMOKE-core-309 的 schema 检查）；ST-S44-01、UT-S44-22（对应 SMOKE-core-310）；ST-S44-02、UT-S44-24（对应 SMOKE-core-311）。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-release-0-16-14.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-309～SMOKE-core-311，不得依靠通配发现后无条件 PASS。
- 适用窗口：活跃变更为 `release-0-16-14`，或 `OPENLOGOS_R01614_SMOKE=1`；窗口之外按既有留痕机制为全部 owned ID 写 skip。环境变量一律使用 `OPENLOGOS_R01614_` 前缀。
- 适用性判定不得依赖自动流程不会设置的环境变量。只有部署记录确实缺失，或候选版本早于 0.16.14 时，才写显式 `skip` 并携带缺失项。有 skip 时不得写 `SMOKE_PASS`。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-309～SMOKE-core-311 均被 runner 覆盖。

## OpenLogos 0.16.15 guard 后台记录收敛与 merge 基线写入安装态 smoke（SMOKE-core-312～314）

> 这组用例验证两项修复在本机全局安装态中以 0.16.15 的身份可用：guard 后台执行记录的关闭（来源提案 fix-guard-background-record-never-closed，场景 S09-F，规范 `spec/pretooluse-guard.md`「执行记录生命周期（C12）」关闭条件 4、5），以及 `openlogos merge` 的合并基线写入不再经标准输入（来源提案 fix-merge-hang-on-baseline-blob-stdin，场景 S09 EX-9.46）。完整行为已由仓库内 UT-S09-481～UT-S09-488、ST-S09-210～ST-S09-217 覆盖；安装态只取证三件事：装上的是本次候选、全局 CLI 的 merge 基线写入正确、随包分发的 guard 引擎与 SessionStart 入口按新规则关闭记录。
>
> 用例在 `mktemp -d` 一次性 git 项目内执行：经全局 `openlogos init` 建立项目（由它把随包的 guard 与事后检查引擎部署到该项目的 `.claude/openlogos/bin/`），再写入夹具并提交。runner 以子进程调用全局 CLI 与该一次性项目内的托管脚本，对全局安装态**只读**，不做安装或卸载；不触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态目录（含本仓的 `guard-records/`）与用户其他仓库（包括 runlogos）。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.15`。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-312 | 安装态版本与制品身份 | 本机全局已安装本次候选；部署记录中有候选版本 | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并重算 `payloadHash`；③ 读取全局包内 `dist/lib/merge-baseline.js`、`claude-plugin-template/bin/guard-post-check.cjs` 与 `claude-plugin-template/bin/openlogos-phase`；④ 以 `require` 加载包内 `guard-post-check.cjs` 并读取其导出 | ① `--version` 等于部署记录候选版本，入口无 workspace link；② `payloadHash` 自洽；③ `merge-baseline.js` 的 `hash-object` 调用带 `--no-filters`、不带 `--stdin`；`openlogos-phase` 在调用引擎 `check --session-start` 时把保存的宿主输入写入引擎标准输入，不再固定传入空输入；④ 导出中有 `backgroundTasksOf`、`closableByBackgroundTasks`、`recordExpired`，`RECORD_EXPIRE_MS` 等于 7 天的毫秒数 | 保留读取结果；任一不符 → 停止后续流程，按部署方案以 `openlogos deploy --env test --rollback` 回退 |
| SMOKE-core-313 | 安装态 merge 的合并基线写入 | 本机全局已安装本次候选；一次性项目：`git config core.autocrlf true`，活跃提案含首次 MODIFY 的需求、功能规格、场景与测试规格目标，其中功能规格目标在工作区中为 CRLF 换行并已提交；runner 为 merge 子进程把 `TMPDIR` 指向一个事先为空的独占目录 | ① 记录功能规格目标合并前的工作区字节；② 全局 CLI `merge <slug> --format json`；③ 读取 `SPEC_MERGED` 的 `merge_baseline`，取该目标的 `before.git_blob`，执行 `git cat-file blob`；④ 列出受控 `TMPDIR` 的内容；⑤ `git add -A && git commit` 后修改该目标的 delta，再次执行全局 CLI `merge <slug> --format json` | ② 退出码 0，`result=merged`，在 runner 设定的时限内返回；③ `git_blob` 非 null，读回字节与 ① 逐字节相同（仍为 CRLF），其 SHA-256 等于 `before.sha256`；④ 没有以 `openlogos-merge-baseline-` 开头的残留；⑤ 退出码 0，`result=amended`，受控 `TMPDIR` 仍无上述残留 | 同上；任一不成立表示 merge 修复未完整进入安装态 |
| SMOKE-core-314 | 安装包内 guard 引擎的后台记录关闭 | 本机全局已安装本次候选；一次性项目经全局 `openlogos init` 部署 `.claude/openlogos/bin/guard-check`、`guard-post-check.cjs` 与 `openlogos-phase`，模块为 `launched`，无活跃提案；runner 先断言这三个托管文件与全局包内 `claude-plugin-template/bin/` 下的同名文件逐字节一致；hook 输入按 Claude Code 真实字段构造；记录年龄由引擎的可注入时钟构造，不 sleep、不改写文件时间 | ① 会话 s1 两条后台调用 R1、R2：托管 `guard-check` 的 PreToolUse（`run_in_background: true`）→ 托管引擎 `check` 的 PostToolUse（`tool_response.backgroundTaskId` 分别为 t1、t2）；② s1 Stop，`background_tasks` 只含 t2；③ s1 Stop，`background_tasks` 为空数组；④ 会话 s0 在时刻 T 建立后台记录 R0，会话 s2 在同一时刻建立未回填标识的后台记录 Rb；时钟推进到 T 加 7 天零 1 秒，以 hook 模式运行托管 `openlogos-phase`，向其标准输入写入 `session_id` 为 s2 的 SessionStart JSON；⑤ 重建 R0，以空标准输入运行同一入口 | ① 两条记录文件存在，`background: true` 且已回填标识；② R1 被删除并有墓碑，R2 仍在；③ R2 被删除；④ 入口退出码 0，标准输出为合法的 SessionStart JSON；R0 被删除并有墓碑，Rb（当前会话）仍在；⑤ 入口退出码 0，R0 仍在（缺少会话标识时不做超期关闭） | 同上；任一不成立表示 guard 修复未完整进入安装态 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目与受控临时目录内进行，结束即删除；`git` 操作只作用于这些一次性项目，不配置远端、不联网。
- **不得**触碰本仓活跃提案、本仓 `logos/resources/`、本仓运行态目录（含 `logos/.openlogos-runtime/guard-records/`）、本仓 `.claude/` 下的托管副本、本仓的 git 分支与工作区、用户其他仓库（包括 runlogos）或本机全局 prefix。
- SMOKE-core-314 驱动的是一次性项目内由全局 CLI 部署的托管脚本，不调用本仓 `plugin/bin/` 下的分发源，也不调用本仓 `.claude/openlogos/bin/` 下的副本。
- 结果写入本仓 `logos/resources/verify/smoke-results.jsonl`；实际执行的结果行带 `target_environment="test"`，窗口之外的 skip 行不声明 `target_environment`。

### 三、追溯与覆盖

- 场景：S09-F Step 63→64（SMOKE-core-314 ①～③）、Step 29 与 Step 65、EX-9F.46（SMOKE-core-314 ④⑤）；S09「S09 已合并提案的增量修正时序」Step 1～4、EX-9.46（SMOKE-core-313）。需求：`core-01-requirements.md`「guard 以版本控制内容为保护对象需求」AC-GUARD-VCS-08、AC-GUARD-VCS-29。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.15 本机测试环境发布（release-0-16-15）」。
- 仓库内对应用例：UT-S09-488（对应 SMOKE-core-312 的 merge 写法检查）；ST-S09-217（对应 SMOKE-core-313）；ST-S09-210、ST-S09-214、ST-S09-216（对应 SMOKE-core-314）。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-release-0-16-15.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-312～SMOKE-core-314，不得依靠通配发现后无条件 PASS。
- 适用窗口：活跃变更为 `release-0-16-15`，或 `OPENLOGOS_R01615_SMOKE=1`；窗口之外按既有留痕机制为全部 owned ID 写 skip，skip 行不声明 `target_environment`。环境变量一律使用 `OPENLOGOS_R01615_` 前缀。
- 适用性判定不得依赖自动流程不会设置的环境变量。只有部署记录确实缺失，或候选版本早于 0.16.15 时，才写显式 `skip` 并携带缺失项。有 skip 时不得写 `SMOKE_PASS`。
- SMOKE-core-313 的 merge 子进程由 runner 设时限（不超过 120 秒）；超时判 fail 并在证据中写明，不得重试后写 pass。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-312～SMOKE-core-314 均被 runner 覆盖。

## OpenLogos 0.16.16 切片验收范围冻结与 owned checkpoint 安装态 smoke（SMOKE-core-315～317）

> 这组用例验证来源提案 slice-verify-efficient-mode 的能力在本机全局安装态中以 0.16.16 的身份可用：`openlogos slice plan` 冻结 checkpoint 验收范围（场景 S32「S32 切片规划冻结验收范围时序」，根规范 `spec/test-slice-manifest.md` §2.3.2、§2.4），以及 owned 范围下 checkpoint 只验收 owned 用例、注入 `OPENLOGOS_VERIFY_SLICE_SCOPE`、final 仍全量（场景 S13「S13 切片 checkpoint 的 owned 验收范围」，根规范 §7）。完整行为已由仓库内 UT-S13-132～UT-S13-140、ST-S13-35～ST-S13-37、UT-S32-103～UT-S32-117、ST-S32-44～ST-S32-45 覆盖；安装态只取证三件事：装上的是本次候选且包内带着新能力、全局 CLI 的 `slice plan` 按规则冻结范围、全局 CLI 的 verify 按冻结范围收窄 checkpoint 并在 final 全量回归。
>
> 用例在 `mktemp -d` 一次性 git 项目内执行：经全局 `openlogos init` 建立项目，再写入夹具（单模块 `core` 为 `launched`；基线测试规格 `core-S01-test-cases.md` 定义 UT-S01-01～UT-S01-03 与 ST-S01-01，变更测试规格 `core-S90-test-cases.md` 定义 UT-S90-01～UT-S90-03；活跃提案的 `SPEC_MERGED.test_change_set` 只把 S90 记为变更；`slices.json` 两片：`slice-a` 拥有 UT-S90-01、UT-S90-02，`slice-b` 拥有 UT-S90-03）并提交。change set 由全局安装包内 `dist/lib/test-change-set.js` 的生成函数构造。runner 以子进程调用全局 CLI，对全局安装态**只读**，不做安装或卸载；不触碰本仓活跃提案、本仓 `logos/resources/`（结果账本除外）、本仓运行态目录与用户其他仓库（包括 runlogos）。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.16`。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-315 | 安装态版本与制品身份 | 本机全局已安装本次候选；部署记录中有候选版本 | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并重算 `payloadHash`；③ 以 `import` 加载包内 `dist/lib/test-slice-manifest.js`，对同一份固定 manifest 分别以缺省、`baseline`、`owned` 的 `verify_scope` 计算 `computeSliceManifestIdentity`；④ 读取包内 `dist/commands/verify.js`、`skills/slice-planner/SKILL.md` 与 `spec/test-slice-manifest.md` | ① `--version` 等于部署记录候选版本，入口无 workspace link；② `payloadHash` 自洽；③ 模块导出 `manifestVerifyScope`、`sameSlicePartition`、`recoverVerifyScopeFromLedger`；缺省与 `baseline` 的身份相等，`owned` 的身份与之不同；④ `verify.js` 含 `OPENLOGOS_VERIFY_SLICE_SCOPE`；`SKILL.md` 含「删后续能否独立过本片 checkpoint」；`test-slice-manifest.md` 含「2.3.2 验收范围的沿用与恢复」 | 保留读取结果；任一不符 → 停止后续流程，按部署方案以 `openlogos deploy --env test --rollback` 回退 |
| SMOKE-core-316 | 全局 CLI 的 slice plan 冻结验收范围 | 本机全局已安装本次候选；一次性项目按上述夹具建立，`verify.slice_scope_threshold` 为 3（已定义用例 7 个） | ① 全局 CLI `slice plan --file slices.json --format json`；② 以相同 `slices.json` 再执行一次；③ 把 `slice_scope_threshold` 改为 2000 后以相同 `slices.json` 再执行；④ 改用把 UT-S90-02 移到 `slice-b` 的 `slices-v2.json` 执行；⑤ 把 `verify.slice_scope` 改为 `full`，改回 `slices.json`（相对在盘 v2 为新划分）执行，执行前后记录 `tasks.md` 与 manifest 的字节 | ① 退出码 0，`data.verify_scope=owned`、`verify_scope_source=decided`，manifest 的 `verify_scope` 为 `owned`；② `owned`、`retained`；③ `owned`、`retained`（配置变化本身不改变冻结范围）；④ `baseline`、`decided`；⑤ 退出码 1，错误码 `SLICE_PLAN_VERIFY_SCOPE_CONFIG_INVALID`，两份文件字节不变 | 同上；任一不成立表示冻结规则未完整进入安装态 |
| SMOKE-core-317 | 全局 CLI 的 owned checkpoint、账本恢复与 final | 本机全局已安装本次候选；一次性项目按上述夹具建立，`verify.slice_scope` 为 `owned`、`sandbox_mode` 为 `off`、`pre_run_command` 为项目内记录型 runner（只为 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 中的用例写 pass，并把收到的 `OPENLOGOS_VERIFY_SLICE_SCOPE` 及其是否存在记入调用日志） | ① 全局 CLI `slice plan` 后执行 `verify --format json`；② 删除 manifest，把 `verify.slice_scope` 改为 `baseline`，以相同 `slices.json` 重跑 `slice plan`，再执行 `next --format json`；③ 勾选 `slice-a` 后执行 `verify --format json`；④ 勾选 `slice-b` 后，在父进程环境预置 `OPENLOGOS_VERIFY_SLICE_SCOPE=owned` 执行 `verify --format json` | ① checkpoint PASS，`eligible_test_ids` 为 UT-S90-01、UT-S90-02；runner 收到 `owned` 与这 2 个用例；`acceptance-report.md` 含「验收范围 / Verify scope: `owned`」；② `slice plan` 输出 `owned`、`recovered`；`slice_verification_state` 的 `verify_scope=owned`、`confirmed_slice_ids=[slice-a]`、`attempted_slice_id=slice-b`；③ checkpoint PASS，runner 只收到 3 个 UT-S90-* 用例；④ `verify_mode=final`、Gate PASS，runner 收到全部 7 个用例且环境中不存在 `OPENLOGOS_VERIFY_SLICE_SCOPE`，写 `VERIFY_PASS` | 同上；任一不成立表示 owned checkpoint 或 final 行为未完整进入安装态 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目与受控临时目录内进行，结束即删除；`git` 操作只作用于这些一次性项目，不配置远端、不联网。
- **不得**触碰本仓活跃提案、本仓 `logos/resources/`（结果账本除外）、本仓运行态目录、本仓 `.claude/` 下的托管副本、本仓的 git 分支与工作区、用户其他仓库（包括 runlogos）或本机全局 prefix。
- 记录型 runner 写在一次性项目内，由全局 CLI 的 verify 以预跑命令调用；runner 不调用本仓任何脚本。
- 结果写入本仓 `logos/resources/verify/smoke-results.jsonl`；实际执行的结果行带 `target_environment="test"`，窗口之外的 skip 行不声明 `target_environment`。

### 三、追溯与覆盖

- 场景：S32「S32 切片规划冻结验收范围时序」Step 1～8、EX-32.26、EX-32.27、EX-32.31（SMOKE-core-316），EX-32.30 的反面与账本恢复 Step 6（SMOKE-core-317 ②）；S13「S13 切片 checkpoint 的 owned 验收范围」Step 1～13（SMOKE-core-317 ①③④）。需求：`core-01-requirements.md`「S13/S16/S27/S28/S31/S32 多切片验收边界与自动恢复要求」高效模式验收条件。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.16 本机测试环境发布（release-0-16-16）」。
- 仓库内对应用例：UT-S32-107（对应 SMOKE-core-315 ③）；UT-S32-104、UT-S32-108、UT-S32-110、UT-S32-106（对应 SMOKE-core-316）；ST-S32-45、ST-S13-35、UT-S13-135、UT-S13-138（对应 SMOKE-core-317）。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-release-0-16-16.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-315～SMOKE-core-317，不得依靠通配发现后无条件 PASS。
- 适用窗口：活跃变更为 `release-0-16-16`，或 `OPENLOGOS_R01616_SMOKE=1`；窗口之外按既有留痕机制为全部 owned ID 写 skip，skip 行不声明 `target_environment`。环境变量一律使用 `OPENLOGOS_R01616_` 前缀。
- 适用性判定不得依赖自动流程不会设置的环境变量。只有部署记录确实缺失，或候选版本早于 0.16.16 时，才写显式 `skip` 并携带缺失项。有 skip 时不得写 `SMOKE_PASS`。
- 全局 CLI 子进程由 runner 设时限（不超过 120 秒）；超时判 fail 并在证据中写明，不得重试后写 pass。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-315～SMOKE-core-317 均被 runner 覆盖。

## OpenLogos 0.16.17 企业知识安装态 smoke（SMOKE-core-318～320）

> 这组用例验证本提案 enterprise-knowledge-base 的能力在本机全局安装态中以 0.16.17 的身份可用：`knowledge` delta 类别注册并经 `openlogos merge` 与场景同批落盘（场景 S45「S45：企业知识沉淀与场景引用」Step 3～11，功能规格 §2.102.2、§2.102.11），以及 change-lint 的知识引用、重号与退役校验（§2.102.10）。完整行为已由仓库内 UT-S45-01～UT-S45-20、ST-S45-01～ST-S45-05 覆盖；安装态只取证三件事：装上的是本次候选且包内带着新能力、全局 CLI 能把预定编号的知识条目与场景同批合并并登记索引、全局 CLI 的 change-lint 按规则报出知识诊断。
>
> 用例在 `mktemp -d` 一次性 git 项目内执行：经全局 `openlogos init` 建立项目，写入夹具（单模块 `core` 为 `launched`；已合并知识条目 `core-K01-refund.md`，其中 K01-R1 为 `active`、K01-R2 为 `deprecated`）并提交，再经全局 `openlogos change` 创建一次性提案。runner 以子进程调用全局 CLI，对全局安装态**只读**，不做安装或卸载；不触碰本仓活跃提案、本仓 `logos/resources/`（结果账本除外）、本仓运行态目录与用户其他仓库（包括 runlogos）。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.17`。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-318 | 安装态版本与制品身份 | 本机全局已安装本次候选；部署记录中有候选版本 | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并重算 `payloadHash`；③ 以 `import` 加载包内 `dist/lib/delta-classify.js` 与 `dist/lib/knowledge-view.js`；④ 读取包内 `skills/scenario-architect/SKILL.md` 与 `spec/directory-convention.md`；⑤ 在一次性目录执行全局 `openlogos init` | ① `--version` 等于部署记录候选版本，入口无 workspace link；② `payloadHash` 自洽；③ `DELTA_TO_RESOURCE.knowledge === 'logos/resources/knowledge'`，`knowledge-view.js` 可加载；④ `SKILL.md` 含「适用业务约束」，`directory-convention.md` 含「logos/resources/knowledge/」；⑤ 存在 `logos/resources/knowledge/` 与 `logos/resources/reference/knowledge/` | 保留读取结果；任一不符 → 停止后续流程，按部署方案以 `openlogos deploy --env test --rollback` 回退 |
| SMOKE-core-319 | 全局 CLI 把预定编号的知识与场景同批合并 | 本机全局已安装本次候选；一次性项目按上述夹具建立；一次性提案含 ADDED `deltas/knowledge/core-K02-settle-day.md`（术语条目）与一个新场景 delta（「适用业务约束」引用 `K01-R1` 与 `K02`） | ① 全局 CLI `change-lint --format json`；② 全局 CLI `merge <slug>`；③ 读取 `logos/resources/knowledge/`、场景文件、`logos-project.yaml` 的 `resource_index` 与提案目录 | ① `pass=true`，不含知识相关 violation；② 退出码 0；③ `core-K02-settle-day.md` 与场景文件已落盘，`resource_index` 含两者的登记，`SPEC_MERGED` 存在 | 同上；任一不成立表示 `knowledge` 类别或有效知识视图未完整进入安装态 |
| SMOKE-core-320 | 全局 CLI 的知识诊断 | 本机全局已安装本次候选；一次性项目按上述夹具建立；四个一次性提案分别：① 场景引用 `K01-R9`；② 场景引用 `K01-R2`；③ ADDED `core-K01-customer-id.md`；④ 用 `MODIFIED` 把 `K01-R2` 改回 `active` 并改写正文 | 对每个提案执行全局 CLI `change-lint --format json`，并记录执行前后项目文件的 SHA-256 | ① violation `knowledge_reference_unknown`，exit 2；② `warnings[]` 含 `knowledge_reference_deprecated`，`pass=true`；③ violation `knowledge_id_duplicate`，以 `code` 与 `path`（本提案的 `core-K01-customer-id.md` 来源）判定，`message` 包含两个 K01 路径；④ violation `knowledge_retired_id_mutated`；四次执行前后项目文件不变 | 同上；任一不成立表示知识校验未完整进入安装态 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目与受控临时目录内进行，结束即删除；`git` 操作只作用于这些一次性项目，不配置远端、不联网。
- **不得**触碰本仓活跃提案、本仓 `logos/resources/`（结果账本除外）、本仓运行态目录、本仓 `.claude/` 下的托管副本、本仓的 git 分支与工作区、用户其他仓库（包括 runlogos）或本机全局 prefix。
- 结果写入本仓 `logos/resources/verify/smoke-results.jsonl`；实际执行的结果行带 `target_environment="test"`，窗口之外的 skip 行不声明 `target_environment`。

### 三、追溯与覆盖

- 场景：S45「S45：企业知识沉淀与场景引用」Step 3～11（SMOKE-core-319）、Step 8 与 EX-45.1～EX-45.5（SMOKE-core-320）。需求：`core-01-requirements.md`「S45: 企业知识沉淀与场景引用」S45-AC-03、S45-AC-04、S45-AC-07、S45-AC-08、S45-AC-10、S45-AC-12。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.17 本机测试环境发布（enterprise-knowledge-base）」。
- 仓库内对应用例：UT-S45-01、UT-S45-13（对应 SMOKE-core-318）；ST-S45-01（对应 SMOKE-core-319）；UT-S45-04、UT-S45-05、UT-S45-06、UT-S45-08（对应 SMOKE-core-320）。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-enterprise-knowledge-base.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-318～SMOKE-core-320，不得依靠通配发现后无条件 PASS。
- 适用窗口：活跃变更为 `enterprise-knowledge-base`，或 `OPENLOGOS_EKB_SMOKE=1`；窗口之外按既有留痕机制为全部 owned ID 写 skip，skip 行不声明 `target_environment`。环境变量一律使用 `OPENLOGOS_EKB_` 前缀。
- 只有部署记录确实缺失，或候选版本早于 0.16.17 时，才写显式 `skip` 并携带缺失项。有 skip 时不得写 `SMOKE_PASS`。
- 全局 CLI 子进程由 runner 设时限（不超过 120 秒）；超时判 fail 并在证据中写明，不得重试后写 pass。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-318～SMOKE-core-320 均被 runner 覆盖。

## OpenLogos 0.16.18 企业知识直接录入安装态 smoke（SMOKE-core-321～323）

> 这组用例验证本提案 knowledge-direct-intake 的能力在本机全局安装态中以 0.16.18 的身份可用：无提案时 `openlogos knowledge apply` 录入与强拦截（场景 S45「S45：企业知识沉淀与场景引用」Step 12～17，功能规格 §2.103.3～§2.103.6），以及 `knowledge index / list / refs / check` 与 L10 标签判据（Step 18～19，§2.103.7～§2.103.11）。完整行为已由仓库内 UT-S45-21～UT-S45-43、ST-S45-06～ST-S45-10 覆盖；安装态只取证三件事：装上的是本次候选且包内带着新命令、全局 CLI 能在没有活跃提案且显式 `guard.exempt: []` 的项目中录入并在不合规时零写入、全局 CLI 的检索与诊断命令按规则输出。
>
> 用例在 `mktemp -d` 一次性 git 项目内执行：经全局 `openlogos init` 建立项目，写入夹具（单模块 `core` 为 `launched`；`logos/logos.config.json` 显式 `guard.exempt: []`；无活跃提案；一个已落盘场景文档在「适用业务约束」中引用 `K01-R1`）并提交；候选目录另以 `mktemp -d` 建在项目根之外。runner 以子进程调用全局 CLI，对全局安装态**只读**，不做安装或卸载；不触碰本仓活跃提案、本仓 `logos/resources/`（结果账本除外）、本仓运行态目录与用户其他仓库（包括 runlogos）。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.18`。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-321 | 安装态版本与制品身份 | 本机全局已安装本次候选；部署记录中有候选版本 | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并重算 `payloadHash`；③ 执行全局 `openlogos knowledge --help`；④ 读取包内 `skills/change-writer/SKILL.md` 与 `spec/directory-convention.md`；⑤ 在一次性目录执行全局 `openlogos init` 后 `openlogos change demo` | ① `--version` 等于部署记录候选版本，入口无 workspace link；② `payloadHash` 自洽；③ 列出 `apply`、`index`、`check`、`list`、`show`、`refs` 六个子命令；④ `SKILL.md` 含「knowledge apply」，`directory-convention.md` 含「TAGS.md」与「INDEX.md」；⑤ `logos/changes/demo/deltas/knowledge/` 存在 | 保留读取结果；任一不符 → 停止后续流程，按部署方案以 `openlogos deploy --env test --rollback` 回退 |
| SMOKE-core-322 | 全局 CLI 无提案直接录入与强拦截 | 本机全局已安装本次候选；一次性项目按上述夹具建立；项目外候选目录 A：结构有效的 `core-K01-refund.md`（含 K01-R1，标签「退款」）与 `sources/refund-v3.md`；候选目录 B：`core-K02-settle.md` 缺 `source`、且标签「售后」不在标签表 | ① 全局 CLI `knowledge apply <A> --format json`；② 记录项目文件 SHA-256 后执行 `knowledge apply <B> --format json`；③ 再次记录 SHA-256；④ 读取 `logos/logos.config.json` | ① 退出码 0，`data.written[]` 含原文、条目、`TAGS.md`、`.tags-enabled`、`INDEX.md`，项目中不存在 `logos/.openlogos-guard`；② 退出码 1，`errors[]` 含 `knowledge_entry_invalid` 与 `knowledge_tag_unknown`；③ 与②执行前一致（零写入）；④ `guard.exempt` 仍为 `[]` | 同上；任一不成立表示直接录入或强拦截未完整进入安装态 |
| SMOKE-core-323 | 全局 CLI 的检索、诊断与 L10 标签判据 | 本机全局已安装本次候选；SMOKE-core-322 ① 完成后的同一项目 | ① `knowledge list --module core --format json` 与 `knowledge show K01 --format json`；② `knowledge refs K01-R1 --format json`；③ `knowledge index` 后 `knowledge check --format json`；④ 删除 `TAGS.md` 后 `knowledge index` 与 `knowledge check --format json`；⑤ 以 git 恢复 `TAGS.md`，`openlogos change p1` 产出引用 `K01-R1` 的场景 delta 后 `change-lint --format json` | ① list 含 K01，show 的全文含 `K01-R1` 规则行；② 返回已落盘场景的引用行（文件、行号）；③ 退出码 0，`errors[]` 为空；④ `knowledge index` 退出码 1，check 的 `errors[]` 含 `knowledge_tags_missing`；⑤ `pass=true` | 同上；任一不成立表示检索、诊断或标签三态未完整进入安装态 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目、项目外候选目录与受控临时目录内进行，结束即删除；`git` 操作只作用于这些一次性项目，不配置远端、不联网。
- **不得**触碰本仓活跃提案、本仓 `logos/resources/`（结果账本除外）、本仓运行态目录、本仓 `.claude/` 下的托管副本、本仓的 git 分支与工作区、用户其他仓库（包括 runlogos）或本机全局 prefix。
- 结果写入本仓 `logos/resources/verify/smoke-results.jsonl`；实际执行的结果行带 `target_environment="test"`，窗口之外的 skip 行不声明 `target_environment`。

### 三、追溯与覆盖

- 场景：S45「S45：企业知识沉淀与场景引用」Step 12～17 与 EX-45.12、EX-45.14、EX-45.19（SMOKE-core-322）；Step 18～19 与 EX-45.16（SMOKE-core-323）。需求：`core-01-requirements.md`「S45: 企业知识沉淀与场景引用」S45-AC-14、S45-AC-15、S45-AC-17～S45-AC-22、S45-AC-25。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.18 本机测试环境发布（knowledge-direct-intake）」。
- 仓库内对应用例：UT-S45-36（对应 SMOKE-core-321）；UT-S45-21、UT-S45-23、UT-S45-25、ST-S45-06、ST-S45-07（对应 SMOKE-core-322）；UT-S45-28～UT-S45-32、UT-S45-37（对应 SMOKE-core-323）。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-knowledge-direct-intake.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-321～SMOKE-core-323，不得依靠通配发现后无条件 PASS。
- 适用窗口：活跃变更为 `knowledge-direct-intake`，或 `OPENLOGOS_KDI_SMOKE=1`；窗口之外按既有留痕机制为全部 owned ID 写 skip，skip 行不声明 `target_environment`。环境变量一律使用 `OPENLOGOS_KDI_` 前缀。
- 只有部署记录确实缺失，或候选版本早于 0.16.18 时，才写显式 `skip` 并携带缺失项。有 skip 时不得写 `SMOKE_PASS`。
- 全局 CLI 子进程由 runner 设时限（不超过 120 秒）；超时判 fail 并在证据中写明，不得重试后写 pass。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-321～SMOKE-core-323 均被 runner 覆盖。

## OpenLogos 0.16.19 SessionStart 横幅 API 阶段安装态 smoke（SMOKE-core-324～325）

> 这组用例验证本提案 fix-phase-banner-api-false-missing 的修复在本机全局安装态中以 0.16.19 的身份可用：安装包里的插件模板 `openlogos-phase` 在 API 阶段不再输出逐场景 `missing`，并按 initial 模块的 API 进度判定（场景 S11「per-scenario 覆盖判定的权威口径与 SessionStart 同口径约束」约束 5 / 5a、EX-11.26）。完整行为已由仓库内 UT-S11-82、UT-S11-111～UT-S11-115、ST-S11-47 覆盖；安装态只取证两件事：装上的是本次候选且包内插件模板带着修复、该模板在一次性多模块项目中对三种 API 形态给出正确横幅。
>
> 用例在 `mktemp -d` 一次性项目内执行：经全局 `openlogos init` 建立项目后写入多模块夹具（`core` launched 且 `skip_phases: [api, database, scenario]`，`team` initial；team 的前序阶段——需求、产品设计、架构、场景时序——齐全，**测试用例、编排、验收目录默认不放任何文件**，以免 CLI 的兼容兜底把 team 的 API 阶段标为 skipped、或触发 shell 的「向后看兜底」），以 `bash` 子进程运行**安装包内**的 `claude-plugin-template/bin/openlogos-phase`，`PATH` 首位为全局 `openlogos` 所在目录（status 路径）或不含 `openlogos`（降级路径）。runner 对全局安装态**只读**，不做安装或卸载；不触碰本仓活跃提案、本仓 `logos/resources/`（结果账本除外）、本仓运行态目录与用户其他仓库（包括 runlogos）。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.19`。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-324 | 安装态版本与插件模板身份 | 本机全局已安装本次候选；部署记录中有候选版本 | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并重算 `payloadHash`；③ 比较全局包内 `claude-plugin-template/bin/openlogos-phase` 与仓内源模板 `plugin/bin/openlogos-phase` 的 SHA-256，并检查其 API 分支不再引用 `check_scenarios_complete "$P_API"` | ① `--version` 等于部署记录候选版本，入口无 workspace link；② `payloadHash` 自洽；③ 两者逐字节一致，包内模板不含 API 逐场景调用 | 保留读取结果；任一不符 → 停止后续流程，按部署方案以 `openlogos deploy --env test --rollback` 回退 |
| SMOKE-core-325 | 安装包插件模板的 API 阶段横幅 | 本机全局已安装本次候选；一次性多模块项目按上述夹具建立，`logos-project.yaml` 声明 30 个场景 | ① `logos/resources/api/` 只放 `team-auth.yaml`、`team-requirements.yaml`，status 路径运行模板；② 改为只放 `core-auth.yaml`：先以全局 CLI 执行 `status --format json` 读取 team 的 `phase.3-2-api`，再以 status 路径运行模板；③ 清空 `logos/resources/api/`，降级路径（`PATH` 不含 `openlogos`）运行模板；④ 对照臂：API 目录与测试目录仍为空，在编排目录 `logos/resources/scenario/` 放入 `team-refund-flow.json`（更后置的产物），降级路径运行模板；⑤ 记录每次运行前后项目文件的 SHA-256 | ① 横幅不含 `missing`、不是 API 阶段的 `Phase 3 Step 2: API & Database Design`，确切到达 `Phase 3 Step 2: Database Design`（team 未声明跳过数据库、数据库目录只有被排除的 `.gitkeep`，证明模板已通过 API 判定）；② status 中 team 的 `phase.3-2-api` 为 `done=false, skipped=false`，横幅为 `Phase 3 Step 2: API & Database Design (modules: team)`，不含 `missing`；③ 横幅为 `Phase 3 Step 2: API & Database Design`，不含 `missing`（未命中 `SKIP_API`）；④ 命中「向后看兜底」，横幅继续到 `Phase 3 Step 3a: Test Cases`（测试目录为空，不触发测试用例的逐场景判定），不报 Step 2、不含 `missing`；⑤ 每次运行前后项目文件不变（模板只读） | 同上；任一不成立表示修复未完整进入安装包里的插件模板 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目与受控临时目录内进行，结束即删除；不配置远端、不联网。
- **不得**触碰本仓活跃提案、本仓 `logos/resources/`（结果账本除外）、本仓运行态目录、本仓 `.claude/` 下的托管副本、本仓的 git 分支与工作区、用户其他仓库（包括 runlogos）或本机全局 prefix。
- 结果写入本仓 `logos/resources/verify/smoke-results.jsonl`；实际执行的结果行带 `target_environment="test"`，窗口之外的 skip 行不声明 `target_environment`。

### 三、追溯与覆盖

- 场景：S11「per-scenario 覆盖判定的权威口径与 SessionStart 同口径约束」约束 5 / 5a、EX-11.26（SMOKE-core-325）。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.19 本机测试环境发布（fix-phase-banner-api-false-missing）」。
- 仓库内对应用例：UT-S11-82（对应 SMOKE-core-324 ③）；UT-S11-111、UT-S11-112、UT-S11-113（对应 SMOKE-core-325，含 UT-S11-113 的兜底对照臂）。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-fix-phase-banner-api.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-324～SMOKE-core-325，不得依靠通配发现后无条件 PASS。
- 适用窗口：活跃变更为 `fix-phase-banner-api-false-missing`，或 `OPENLOGOS_FPB_SMOKE=1`；窗口之外按既有留痕机制为全部 owned ID 写 skip，skip 行不声明 `target_environment`。环境变量一律使用 `OPENLOGOS_FPB_` 前缀。
- 只有部署记录确实缺失，或候选版本早于 0.16.19 时，才写显式 `skip` 并携带缺失项。有 skip 时不得写 `SMOKE_PASS`。
- 全局 CLI 与模板子进程由 runner 设时限（不超过 120 秒）；超时判 fail 并在证据中写明，不得重试后写 pass。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-324～SMOKE-core-325 均被 runner 覆盖。

## OpenLogos 0.16.20 验收历史安装态 smoke（SMOKE-core-326～327）

> 这组用例验证本提案 verification-history 的验收历史能力在本机全局安装态中以 0.16.20 的身份可用（功能规格 §2.104）。完整行为已由仓库内 UT-S13-141～UT-S13-156、ST-S13-38～ST-S13-39、UT-S19-100～UT-S19-107、ST-S19-34 覆盖；安装态只取证两件事：装上的是本次候选，以及全局 CLI 在一次性项目中真实写出并查得到历史。
>
> 用例在 `mktemp -d` 一次性 git 项目内执行：经全局 `openlogos init` 建立项目后写入夹具——单模块 `core` launched，已合并测试规格含 UT-S01-01、UT-S01-02，smoke 规格含 SMOKE-core-901；`verify.pre_run_command` 与 `smoke.command` 指向夹具内的记录型脚本，可按环境变量决定结果并在 `error` / `detail` 中写入占位值 `SECRET-PLACEHOLDER-7f3a`；环境登记表 `logos/environments.yaml` 登记 `test`，`deploy.mode: script` 指向夹具内只返回 0 的部署脚本。活跃提案 `vh-smoke` 复用 S19 测试夹具的「待部署」状态：`proposal.md` 的部署影响声明「是否需要部署：是」「是否需要 smoke：是」、影响环境 `test`；`tasks.md` 含已全部勾选的 `[code]` 与未勾选的 `[deploy]` 段；提案目录有 spec-complete 标记 `SPEC_MERGED`；写入 guard 文件。每次执行全局 CLI 前把夹具改动提交到本地 git（历史文件在一次性项目中未被忽略，随 `git add -A` 提交），使部署请求的 HEAD 干净。外层本仓候选安装态只读，不为一次性项目提供任何生命周期事实。runner 对全局安装态**只读**，不做安装或卸载；不触碰本仓活跃提案、本仓 `logos/resources/`（结果账本除外）、本仓运行态目录与用户其他仓库（包括 runlogos）。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.20`。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-326 | 安装态版本、制品身份与 history 命令 | 本机全局已安装本次候选；部署账本中有本提案在 test 的成功部署记录，本机回执与之同一 deploy_id | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并重算 `payloadHash`；③ 执行 `openlogos --help` 与在空的一次性项目中执行 `openlogos history list --format json` | ① `--version` 等于本次成功部署回执中的候选版本，入口无 workspace link；② `payloadHash` 自洽；③ 帮助列出 `history`，`history list` 退出码 0、`data.runs=[]` | 保留读取结果；任一不符 → 停止后续流程，按部署方案以 `openlogos deploy --env test --rollback` 回退 |
| SMOKE-core-327 | 全局 CLI 写出并查得到验收历史 | 本机全局已安装本次候选；一次性项目按上述夹具建立 | ① 第一次 `verify --format json`（UT-S01-02 失败，`error` 含占位值），记下 `data.history.run_id`；② 第二次 `verify --format json`（全部通过，写出 `VERIFY_PASS`）；③ 部署前先执行一次 `smoke --env test --format json`；④ 执行 `deploy --env test --format json`（真实命令写 `DEPLOY_DONE`、勾选 `[deploy]`、写部署账本）；⑤ 两次 `smoke --env test --format json`（第一次 SMOKE-core-901 失败、`detail` 含占位值，第二次通过并写 `SMOKE_PASS`）；⑥ `history list --format json` 与以第①轮 run_id 执行 `history show --format json`；⑦ 全文搜索占位值；⑧ 执行 `archive vh-smoke` 后再次以第①轮 run_id `history show --format json` | ①②各写一个 verify 中央索引文件；③ 以既有错误信封 `SMOKE_DEPLOY_NOT_DONE` 拒绝，不新增历史文件（前置拒绝不留历史）；④ 部署成功；⑤各写一个 smoke 中央索引文件，`environment="test"`、`deploy_id` 等于④的 deploy_id；⑥ 列表共 4 条、按 `started_at` 倒序：smoke PASS、smoke FAIL、verify PASS、verify FAIL；第①轮详情 `failed_ids=["UT-S01-02"]` 且 `full_record` 指向活动提案运行目录；⑦ 中央索引文件不含占位值，提案运行目录的完整结果含占位值（缺省 `raw_in_proposal: true`）；⑧ archive 成功，`full_record` 指向 `logos/changes/archive/<日期>-vh-smoke/verify-runs/<run_id>/`，中央索引文件字节不变 | 同上；任一不成立表示历史能力未完整进入安装态 |

### 二、执行边界

- 全部读写只在 `mktemp -d` 的一次性项目与受控临时目录内进行，结束即删除；不配置远端、不联网。
- **不得**触碰本仓活跃提案、本仓 `logos/resources/`（结果账本除外）、本仓运行态目录、本仓的 git 分支与工作区、用户其他仓库（包括 runlogos）或本机全局 prefix。
- 结果写入本仓 `logos/resources/verify/smoke-results.jsonl`；实际执行的结果行带 `target_environment="test"`，窗口之外的 skip 行不声明 `target_environment`。

### 三、追溯与覆盖

- 功能规格：§2.104；场景：S13「验收历史留存与查询时序（verification-history）」、S19「smoke 验收历史留存（verification-history）」。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.20 本机测试环境发布（verification-history）」。
- 仓库内对应用例：UT-S13-141、UT-S13-145、UT-S13-149、UT-S13-155（对应 SMOKE-core-327）；UT-S19-100、UT-S19-101（对应 SMOKE-core-327 ③⑤）。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-verification-history.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行，显式分派 SMOKE-core-326～SMOKE-core-327，不得依靠通配发现后无条件 PASS。
- 适用窗口：活跃变更为 `verification-history`，或 `OPENLOGOS_VH_SMOKE=1`；窗口之外按既有留痕机制为全部 owned ID 写 skip，skip 行不声明 `target_environment`。环境变量一律使用 `OPENLOGOS_VH_` 前缀。
- 部署前置：以部署账本中本提案在 test 的最后一条成功 deploy 与本机部署回执（同一 deploy_id、`result=done`、`candidate_version` 逐字段等于源码候选版本）为准；账本中没有本提案成功部署记录时写显式 `skip` 并携带缺失项，记录存在但回执不符时判 fail。有 skip 时不得写 `SMOKE_PASS`。
- 全局 CLI 子进程在独立进程组中运行并限时 120 秒，到时对整个进程组强制终止并判 fail；每一步按**预期的退出码与输出通道**判定后再解析输出：SMOKE-core-327 中第①步 verify 预期退出码 1、解析 stdout 的 FAIL 成功信封（取 `data.history.run_id`），第②步 verify 与第⑤步第二次 smoke 预期退出码 0、解析 stdout，第③步部署前 smoke 预期退出码 1、解析 stderr 的既有错误信封（`error.code=SMOKE_DEPLOY_NOT_DONE`），第④步 deploy 预期退出码 0、解析 stdout 的成功信封，第⑧步 archive 预期退出码 0，第⑤步第一次 smoke 预期退出码 1、解析 stdout 的 FAIL 信封，SMOKE-core-326 与查询命令预期退出码 0；凡要求解析信封的步骤一律以 `--format json` 调用，文本模式输出视为信封不匹配。超时、被信号终止、启动错误、非预期退出码或信封通道 / 形态不匹配均判该用例 fail，不得重试后写 pass。
- 自测模式只接受仓库之外的独立结果账本，并在正式 smoke 上下文（已注入 `OPENLOGOS_SMOKE_ENV` / `OPENLOGOS_SMOKE_MODULE`）中拒绝运行；自测结果不声明 `target_environment`。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-326～SMOKE-core-327 均被 runner 覆盖。

## OpenLogos 0.16.21 公开发布 smoke（SMOKE-core-328～333）

本组核验 npm registry、GitHub Release 与 Cloudflare Pages 官网是否同源，并用 registry 安装的 CLI 验证本次公开能力。判据沿用 SMOKE-core-272～279；实际 V 和完整 tag 提交号从 `logos/resources/verify/deployment-report.md` 标题含 `release-0-16-21` 的发布记录节读取 `public_release_version` 与 `public_release_commit`，并与 `v<V>` 核对。初始计划版本为 0.16.21，档 B2 前滚按实际 V 取证。

### 一、冒烟测试用例

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-328 | Registry 身份与 provenance | 发布记录有 V 和完整提交号；对应 tag 的 publish run 已有 Publish success | 查询 `npm view @miniidealab/openlogos dist-tags --json` 与 `@<V>` 的 `version`、`gitHead`、`dist.integrity`、`dist.attestations`；读取 provenance；下载并解包 registry tarball；逐个查询 0.16.8～0.16.20 | `latest=V`、`old` 与部署前一致；provenance 的源码引用为本仓 `refs/tags/v<V>`、提交等于发布记录，有 `gitHead` 时一致；tarball 符合 registry integrity，包版本和 asset manifest 为 V 且自洽，包含 knowledge、history、branch 命令与 verification-history、result-path-lock 模块；本机发布的 13 个旧号均为 E404；留存 SHA-256 供 Release 核对 | 身份、散列或制品不符记 fail，停止放行并按发布方案处理；有网络错误时记录缺失项 |
| SMOKE-core-329 | macOS registry 隔离安装态功能验收 | SMOKE-core-328 已取得 registry 版本与制品身份；宿主机具备 node、npm 与 git | 在一次性 prefix 从 registry 安装 `@miniidealab/openlogos@<V>`，核对入口 realpath 和 `--version`；从该入口执行下文四个夹具 | 入口位于隔离安装包内，版本等于 V；知识可录入并查询，verify 和 smoke 的历史可追溯，branch status 与已知提交拓扑一致，verify 的模块范围与 `--all` 可区分 | 任一能力断言失败记 fail，留存该夹具的退出码及 JSON 摘要 |
| SMOKE-core-330 | Linux registry 隔离安装态功能验收 | SMOKE-core-328 已取得 registry 版本与制品身份；docker 可启动 `node:20` | 在一次性 Linux 容器内以非 root 用户从 registry 装同一 V 至临时 prefix，按 SMOKE-core-329 执行四个夹具 | uid 非 0，入口和版本同 SMOKE-core-329，各夹具行为一致；留存镜像摘要、uid 和各子步骤退出码 | Docker 或镜像不可用记显式 skip；可执行但安装或功能断言失败记 fail |
| SMOKE-core-331 | GitHub Release 与 registry 同源 | SMOKE-core-328 已取得 tarball SHA-256；`gh` 已认证 | 读取 `v<V>` Release、仓库 latest Release 及 tag 指向；下载 Release 的 CLI tarball；按 publish.yml 规则从该 tag 提取 V 的 CHANGELOG 节 | Release 为公开正式版且最新 tag 为 `v<V>`；tag 提交等于部署记录，唯一 CLI tarball 的 SHA-256 等于 registry；正文去首尾空白后与同一 CHANGELOG 节相同，含从 0.16.7 升级指引，无「未发布到 npm」 | 缺 Release/附件按档 C 核对和补做；同源性不符记 fail，停止放行 |
| SMOKE-core-332 | 官网 latest 与英文摘要 | 对应版本的官网已由原 run 或档 C 部署 | HTTP GET 首页及英文 `/releases`、中文 `/zh/releases`；与 tag 内 `website/src/data/release-summaries-en.mjs` 的 V 条目和 Release 链接核对 | HTTP 200；首页最近发布与中英文发布页的最新版本均为 V；英文页呈现 V 的英文摘要并指向 `v<V>` Release；0.16.8～0.16.20 的本机发布号未被列为公开发布 | 保留 HTTP 结果与摘录；错版、缺摘要或错链记 fail，并按官网发布事实处理 |
| SMOKE-core-333 | 官网中英文新页、侧边栏与版本一致 | 同 SMOKE-core-332；tag 内包含提案指定的官网文档 | 以 HTTP GET 读取下文五个双语路由，核对各语言侧边栏链接和发布 tag 中对应页面的关键内容 | 中英文路由均返回 200，侧边栏指向同语言、同主题页面，关键命令、配置键与 V 对应的 tag 文档一致 | 404、错链、缺关键内容或语言错配记 fail；只涉及文档时按官网修正路径处理 |

### 二、隔离安装态夹具（SMOKE-core-329、330）

每组夹具用独立临时项目，所有 CLI 调用指向隔离 prefix 的绝对入口。指定 JSON 输出的步骤先核对退出码和输出通道，再解析信封。Git 夹具使用本地提交。

1. **知识直接录入**。复用 SMOKE-core-322 的无提案、显式 `guard.exempt: []` 夹具和项目外有效候选，候选含 `core-K01-refund.md` 与 `sources/refund-v3.md`；如需标签表，同批准备其词条和首次启用参数。运行 `knowledge apply <候选目录> --format json`，需退出 0、`data.result=applied`，知识条目与原文实际落在项目资源路径；`knowledge list --module core --format json` 的 `data.entries` 含 K01 与落盘路径。
2. **verify 与 smoke 历史**。复用 SMOKE-core-327 的已合并临时提案、可记录结果的 runner、test 登记表与一次性部署脚本。第一次 verify 由夹具产生一个失败 ID，第二次通过；两次均加 `--format json` 并取各自 `data.history.run_id`，期望退出 1、0 且在 stdout 给出门禁数据。第二次通过后提交临时项目以获得干净 HEAD，用隔离 CLI 执行 `deploy --env test --format json`（退出 0，保存 `data.deploy_id`），再执行两次 `smoke --env test --format json`（退出 1、0，均读 stdout 门禁数据）。runner 为结果声明 test 的 `target_environment`。`history list --slug <夹具提案> --format json` 返回按时间倒序的两条 verify 和两条 smoke，`--kind smoke` 只返回 smoke；两轮 smoke 记录的 `environment=test`、`deploy_id` 等于夹具部署，属于各自的运行 ID。`history show <第一次的 run_id> --format json` 验证失败用例 ID，并实际打开该轮结果文件和报告快照核对失败证据。
3. **分支状态**。在单独的已初始化 Git 夹具从共同提交分出 `main` 和检查分支，两侧各增加一个提交。在检查分支执行 `branch status --base main --format json`，断言 `ahead=1`、`behind=1`、`up_to_date=false`，`head`、`base.commit` 和 `merge_base` 与夹具三个提交相符。
4. **按模块限定 verify**。复用 SMOKE-core-281、283 的多模块夹具，声明 `core`、`portal-web` 的非空 `paths` 和独立记录型命令，活跃提案归属 `portal-web`，工作区只改该模块。比较 `verify --format json` 与 `verify --all --format json` 的 `data.scope.mode`（分别为 `module`、`all`）、模块集合与 runner 调用日志；后者必须实际执行两个模块的命令。

### 三、官网路由与复用用例

新页覆盖下表列出的英文路由及其 `/zh/` 对应路径。检查正文及侧边栏实际链接，关键内容以发布 tag 中该语言的页面为比对基准，允许 HTML 转义。

| 路由 | 内容证据 |
|---|---|
| `/cli/knowledge/` | `knowledge apply`、`knowledge list` |
| `/cli/history/` | `history list`、`history show`、运行 ID |
| `/cli/branch/` | `branch status`、`branch sync` |
| `/specs/branch-sync/` | `branch_sync` 与生成文件处理规则 |
| `/concepts/enterprise-knowledge/` | 企业知识条目和引用约定、`logos/resources/knowledge/` |

复用既有通用用例定义。SMOKE-core-01、02 使用 SMOKE-core-329 的隔离入口与一次性 init 项目，SMOKE-core-04 使用 SMOKE-core-328 解包的 registry 制品，SMOKE-core-07、08、15 使用 SMOKE-core-332 的双语发布页和首页，SMOKE-core-21 复用中文站点路由断言并补核 SMOKE-core-333 的中文新页。复用 ID 沿用原定义及原有结果归属。

### 四、执行边界与自动化证据

- 新 runner 为 `scripts/smoke-public-release-0-16-21.js`，由既有 `scripts/run-smoke.js` 发现，显式分派 SMOKE-core-328～333。窗口为活跃提案 `release-0-16-21` 或 `OPENLOGOS_PR1621_SMOKE=1`，本 runner 自有环境变量统一用 `OPENLOGOS_PR1621_`。窗口外按既有留痕机制为本组用例写 skip。
- 公网只读：查询 registry、下载临时 tarball、查询/下载 GitHub Release、HTTP GET。宿主安装只使用一次性 prefix，容器用 `--rm`，夹具、临时发布目录及账本随用例清理。本机 npm 全局切换、正式 prod 账本落标与所有公网写入均属于部署方案。子进程隔离继承的 `OPENLOGOS_DEPLOY_*`、`OPENLOGOS_SMOKE_ENV` 与 `OPENLOGOS_SMOKE_RESULT_PATH`，各夹具只用自己的运行路径。
- Docker 不可用、网络不可达、缺少 `gh` 认证或缺发布记录时，相关用例写显式 skip 并记录缺失项。此类缺口可补齐，不标记 `platform-unavailable`；本组任一未通过不得作为 `SMOKE_PASS` 的放行证据。窗口外的其他提案 runner 仍按各自契约记账。
- 每个 owned ID 向 smoke reporter 写一条结果，含 `id`、`status`、`timestamp`、`duration_ms`、`environment`、证据或缺失项；正式运行的 pass/fail 带 `target_environment=prod`（取自 `OPENLOGOS_SMOKE_ENV`），skip 行省略该字段。证据按用例记录 V、tag 提交号、tarball 散列、子进程退出码与信封摘要、容器身份或 HTTP 状态与页面摘录。覆盖预检确认 SMOKE-core-328～333 均有 runner。
- 追溯至部署方案「OpenLogos 0.16.21 公开发布方案（npm / GitHub Release / 官网，含官网文档补齐）」和提案 C05～C09。安装态夹具对应 S45 知识直接录入（SMOKE-core-322、323）、S13/S19 验收历史（SMOKE-core-327）、S44 分支状态及模块限定 verify（SMOKE-core-281、283）。

## OpenLogos 0.16.22 Windows 公开升级 smoke

| ID | 场景 | 操作 | 期望 |
|---|---|---|---|
| SMOKE-core-334 | 公开制品与升级入口 | 从 prod 部署记录读取版本与提交，读取官方 npm、GitHub Release、官网中英文升级页及官网下载脚本 | 官方版本可下载，GitHub 资产与 registry 制品一致；官网脚本与发布提交同源，升级指引指定官方源与目标版本 |
| SMOKE-core-335 | 真实 Windows 升级证据 | 按部署 ref 查询 GitHub Windows CI 的升级用例与部署证据，核对候选包版本及实际 CMD 输出 | Windows 旧版原地升级、多入口遮蔽与不可修复分支实际执行，通过证据绑定发布提交与版本，用户重新打开 CMD 后的版本断言在场 |

公开 smoke 由既有 dispatcher 发现并记录当前目标环境。镜像传播的版本与 tarball 可用性附在 334 证据中。公告指向经过核验的官方源。

## OpenLogos 0.16.23 smoke runner 发现安装态 smoke（SMOKE-core-336～337）

> 这组用例验证本提案 fix-smoke-runner-discovery-overflow 对 smoke runner 发现的修复已在本机全局安装态中以 0.16.23 的身份生效（场景 S19「runner 发现的遍历规则」、默认 dispatcher 下零 runner 判定、EX-19.25）。完整行为已由仓库内 UT-S19-113～UT-S19-121、ST-S19-38～ST-S19-39 覆盖。安装态只取证两件事：装上的是本次候选；全局 CLI 在含目录链接（含指回项目根的环形链接）的一次性项目中，`verify` 正常输出结果且不进入链接。超宽目录的参数上限不在安装态物理建档验证：链接后的文件对正确实现不可见，也走不到展开处，检不出该缺陷；这一项由 UT-S19-115（CLI）与 UT-S19-121（dispatcher）的内存合成目录项覆盖。
>
> **夹具**：用例在 `mktemp -d` 一次性 git 项目 `P` 内执行，经全局 `openlogos init` 建立项目后写入：
> - 单模块 `core` launched，已合并测试规格含 UT-S01-01；`verify.pre_run_command` 指向夹具内只写 UT-S01-01 `pass` 的记录型脚本；
> - `smoke.command` 为 `node scripts/run-smoke.js`，`P/scripts/run-smoke.js` 为最小 dispatcher 夹具，只在被执行时写标记；
> - 项目外临时目录 `X`：含哨兵 runner `X/scripts/smoke-linked.sh`，另放少量普通文件即可；实现错误地跟随链接时，该哨兵会出现在 `runners` 中；
> - 项目内的目录链接：`P/release → X`，以及指回项目根的 `P/loop → .`。
>
> 两种变体：
> - **臂 A**：活跃提案 `rd-smoke` 不含 smoke 用例 delta；仓内另有 runner `scripts/smoke-a.sh`。
> - **臂 B**：活跃提案 `rd-smoke` 在 `deltas/test/smoke/` 下新增 SMOKE-core-950（夹具专用编号）；仓内没有任何 runner，唯一 runner 在链接目录 `release/scripts/` 内；本轮无 smoke 结果文件。
>
> 每次执行全局 CLI 前把夹具改动提交到本地 git。runner 对全局安装态**只读**，不做安装或卸载。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.23`。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-336 | 安装态版本与制品身份 | 本机全局已安装本次候选；部署账本中有本提案在 test 的成功部署记录，本机回执与之同一 deploy_id | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并重算 `payloadHash` | ① `--version` 等于本次成功部署回执中的候选版本，入口无 workspace link，入口 realpath 等于回执 `entry_realpath`；② `payloadHash` 自洽 | 保留读取结果；任一不符则停止后续流程，按部署方案以 `openlogos deploy --env test --rollback` 回退 |
| SMOKE-core-337 | 含目录链接的项目中 verify 正常输出 | 本机全局已安装本次候选；一次性项目按上述夹具建立 | ① 臂 A：在 `P` 执行 `openlogos verify --format json`；② 臂 B：在同一形态的项目中执行 `openlogos verify --format json`；③ 两臂结束后检查 `P/scripts/run-smoke.js` 的执行标记 | ① 进程正常结束，stdout 为可解析的 JSON 信封，退出码 0 且 `gate.result="PASS"`；`data.smoke_precheck.runners` 含 `scripts/smoke-a.sh`，不含任何 `release/` 或 `loop/` 下的路径；stderr 不含 `RangeError`。② 进程正常结束，stdout 为可解析的 JSON 信封，退出码 1 且 `gate.result="FAIL"`；`data.smoke_precheck.runners=[]`，诊断含 `code="smoke_runner_missing"`；`gate.reason="smoke_runner_missing"`；stderr 不含 `RangeError`。③ dispatcher 未被执行，`verify` 只做静态预检 | 同上；任一不成立表示修复未完整进入安装态 |

### 二、执行边界

- 全部读写只在一次性项目 `P`、项目外临时目录 `X` 与受控临时目录内进行，结束即删除（先删链接，再删 `X`）；不配置远端、不联网。
- **不得**触碰本仓活跃提案、本仓 `logos/resources/`（结果账本除外）、本仓运行态目录、本仓的 git 分支与工作区、用户其他仓库（包括 runlogos、markdown6）或本机全局 prefix。
- 结果写入本仓 `logos/resources/verify/smoke-results.jsonl`。只有目标为 `test`（或未指定）且实际执行的结果行才带 `target_environment="test"`；目标非 test 的 skip 行与窗口之外的 skip 行都不声明 `target_environment`。

### 三、追溯与覆盖

- 场景：S19「smoke runner / reporter / dispatcher 覆盖检查」（runner 发现的遍历规则、Gate 判定补充、EX-19.25）。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.23 本机测试环境发布（fix-smoke-runner-discovery-overflow）」。
- 仓库内对应用例：UT-S19-113、UT-S19-115、ST-S19-38 对应 SMOKE-core-337 ①；UT-S19-119 对应 SMOKE-core-337 ②。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-runner-discovery.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行。runner 显式分派 SMOKE-core-336～SMOKE-core-337，不得依靠通配发现后无条件 PASS。
- **目标环境优先判断**：沿用通用安装态 runner `scripts/smoke-local-install-deploy.js` 的入口判断。宿主已指定 `OPENLOGOS_SMOKE_ENV` 且不是 `test` 时，runner 首先为全部 owned ID 写带原因的显式 skip（原因 `env-not-test`，缺失项 `OPENLOGOS_SMOKE_ENV=test`），skip 行不声明 `target_environment`，随即以成功状态退出，不再判断提案窗口与部署回执。只有目标为 `test` 或未指定目标时，才进入下面的窗口与前置判断。
- 适用窗口：活跃变更为 `fix-smoke-runner-discovery-overflow`，或设置了 `OPENLOGOS_RD_SMOKE=1`。窗口之外按既有留痕机制为全部 owned ID 写 skip，skip 行不声明 `target_environment`。环境变量一律使用 `OPENLOGOS_RD_` 前缀。
- **非 test 目标对照（普通 runner 入口，不是自测模式）**：在临时项目中调用 runner 的普通入口，结果路径 `OPENLOGOS_SMOKE_RESULT_PATH` 指向仓库之外的独立临时文件，`OPENLOGOS_SMOKE_ENV` 设为非 test 值，并以 `OPENLOGOS_RD_SMOKE=1` 打开适用窗口，证明目标判断先于窗口判断。逐行断言：恰有 SMOKE-core-336、SMOKE-core-337 两条 `skip`，原因均为 `env-not-test`，缺失项为 `OPENLOGOS_SMOKE_ENV=test`；两行都没有 `target_environment` 字段；runner 退出码 0。该对照不启用自测开关，与下条自测拒绝规则互不冲突。
- 部署前置：以部署账本中本提案在 test 的最后一条成功 deploy 与本机部署回执为准，二者须为同一 deploy_id、`result=done`、`candidate_version` 逐字段等于源码候选版本。账本中没有本提案成功部署记录时写显式 `skip` 并携带缺失项；记录存在但回执不符时判 fail。有 skip 时不得写 `SMOKE_PASS`。
- 全局 CLI 子进程在独立进程组中运行，每次限时 120 秒，到时对整个进程组强制终止并判 fail。
- 每一步按**预期的退出码与输出通道**判定后再解析输出：SMOKE-core-337 ① 预期退出码 0，② 预期退出码 1，均解析 stdout 的 JSON 信封；SMOKE-core-336 的读取步骤预期退出码 0。凡要求解析信封的步骤一律以 `--format json` 调用。超时、被信号终止、启动错误、非预期退出码或信封通道 / 形态不匹配，均判该用例 fail，不得重试后写 pass。
- 自测模式只接受仓库之外的独立结果账本，并在正式 smoke 上下文（已注入 `OPENLOGOS_SMOKE_ENV` / `OPENLOGOS_SMOKE_MODULE` 任一变量）中拒绝运行，与既有同类 runner（如 `scripts/smoke-fix-phase-banner-api.js`）一致；自测结果不声明 `target_environment`。
- 结果写入 smoke reporter（`logos/resources/verify/smoke-results.jsonl`），每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-336～SMOKE-core-337 均被 runner 覆盖。

## OpenLogos 0.16.24 verify 自足安装态 smoke（SMOKE-core-338～341）

> 这组用例验证本提案 verify-self-sufficient-cases 的 verify 自足能力已在本机全局安装态中以 0.16.24 的身份生效（功能规格 §2.106；需求 AC-VERIFY-SELF-12）。完整行为已由仓库内 UT-S13-157～UT-S13-173、ST-S13-40～ST-S13-43、UT-S09-490～UT-S09-492、UT-S35-225～UT-S35-230、UT-S08-90～UT-S08-92 覆盖。安装态只取证：装上的是本次候选；全局 CLI 在一次性项目中确实按新规则对账、预检、分类跳过；新建提案与生成指令带新内容。
>
> **夹具**：每条用例在各自的 `mktemp -d` 一次性 git 项目 `P` 内执行，经全局 `openlogos init` 建立项目后写入：
> - 单模块 `core` launched，已合并测试规格含 UT-S01-01；`verify.pre_run_command` 指向夹具内的记录型脚本：被执行时在项目外临时目录写标记 `RAN`，按环境变量为每条用例写 pass 或 skip（skip 可带 `reason_code` / `detail`）；
> - 活跃提案 `vs-smoke`：从不含 UT-S01-90 的已合并基线出发，测试 delta 新增 UT-S01-90，经全局 CLI 的正常 `openlogos merge` 合并，产生 `SPEC_MERGED.test_change_set`；proposal 含「验收标准」段。**启动 verify 前**以全局包内的正式读取器（`readTestChangeSet`）断言变更集包含 UT-S01-90、不含存量对照 UT-S01-02，不满足即判该用例 fail（评审 delta-r1 F4）；
> - 项目外临时 bin 目录 `B`，内含可执行脚本 `vs-fake-tool`；是否把 `B` 加入 `PATH` 由用例控制。
>
> 每次执行全局 CLI 前把夹具改动提交到本地 git。runner 对全局安装态**只读**，不做安装或卸载。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.24`。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-338 | 安装态版本与制品身份 | 本机全局已安装本次候选；部署账本中有本提案在 test 的成功部署记录，本机回执与之同一 deploy_id | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并以包内校验器重算 | ① `--version` 等于本次成功部署回执中的候选版本，入口无 workspace link，回执 `entry_realpath` 为非空绝对路径且等于入口 realpath；② 校验器不抛错（payloadHash 与全部资源摘要自洽） | 保留读取结果；任一不符则停止后续流程，按部署方案以 `openlogos deploy --env test --rollback` 回退 |
| SMOKE-core-339 | 对账与环境预检先于预跑 | 本机全局已安装本次候选；夹具按上述建立，验收标准写 `` `command:vs-fake-tool` `` | ① 配置未声明该命令，执行 `openlogos verify --format json`；② 配置写入 `verify.requirements.commands: ["vs-fake-tool"]`，`PATH` 不含 `B`，再执行；③ 把 `B` 加入 `PATH` 再执行 | ① 退出码 1，`gate.result="FAIL"`，`gate.reason="acceptance_requirement_undeclared"`，诊断点名 `command:vs-fake-tool`，`RAN` 不存在；② 退出码 1，`gate.reason="verify_env_not_ready"`，缺失项含 `vs-fake-tool`，`RAN` 不存在；③ `RAN` 存在，退出码 0，`gate.result="PASS"` | 同上；任一不成立表示新规则未完整进入安装态 |
| SMOKE-core-340 | 本次改动用例的跳过分类 | 同上，配置无环境要求、验收标准字段为「无」；已按夹具说明断言真实变更集包含 UT-S01-90 | ① 记录型脚本对 UT-S01-90 写无原因 skip，执行 `openlogos verify --format json`；② 改写为 `reason_code:"platform-unavailable"`、`detail:"requires win32"` 再执行 | ① 退出码 1，`gate.reason="case_tier_mismatch"`，`tier_mismatch_cases` 含 UT-S01-90；② 退出码 0，`gate.result="PASS"`，`platform_skipped_cases` 含 `{id:"UT-S01-90", detail:"requires win32"}` | 同上 |
| SMOKE-core-341 | 新建提案带验收标准段、生成指令为新口径 | 本机全局已安装本次候选；另建一次性 launched 项目（`locale: "zh"`），无活跃提案 | ① 执行 `openlogos change vs-smoke-new` 并读取 proposal.md；② 删除该段后执行 `openlogos change-lint --format json`；③ 读取 `openlogos init` 生成的 CLAUDE.md | ① 含「## 验收标准」段与三个字段；② 退出码 0（若无其他违规），`warnings` 含 `acceptance_criteria_missing`；③「保护范围配置」条款写明只禁止直接修改 `.gitignore`、`.git/info/exclude` 与 `logos.config.json` 的 `guard` 字段，其他字段限已立案的提案范围内可改 | 同上 |

### 二、执行边界

- 全部读写只在一次性项目 `P`、项目外临时目录与受控临时目录内进行，结束即删除；不配置远端、不联网。
- **不得**触碰本仓活跃提案、本仓 `logos/resources/`（结果账本除外）、本仓运行态目录、本仓的 git 分支与工作区、用户其他仓库（包括 runlogos、markdown6）或本机全局 prefix。
- 结果写入本仓 `logos/resources/verify/smoke-results.jsonl`。只有目标为 `test`（或未指定）且实际执行的结果行才带 `target_environment="test"`；目标非 test 的 skip 行与窗口之外的 skip 行都不声明 `target_environment`。

### 三、追溯与覆盖

- 需求：AC-VERIFY-SELF-12；功能规格：§2.106。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.24 本机测试环境发布（verify-self-sufficient-cases）」。
- 仓库内对应用例：UT-S13-158、ST-S13-40 对应 SMOKE-core-339 ①；UT-S13-161、ST-S13-40 对应 SMOKE-core-339 ②③；UT-S13-165、UT-S13-166、ST-S13-42 对应 SMOKE-core-340；UT-S09-490、UT-S35-225、UT-S08-90 对应 SMOKE-core-341。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-verify-self-sufficient.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行。runner 显式分派 SMOKE-core-338～SMOKE-core-341，不得依靠通配发现后无条件 PASS。
- **目标环境优先判断**：沿用通用安装态 runner 的入口判断。宿主已指定 `OPENLOGOS_SMOKE_ENV` 且不是 `test` 时，runner 首先为全部 owned ID 写带原因的显式 skip（原因 `env-not-test`，缺失项 `OPENLOGOS_SMOKE_ENV=test`），skip 行不声明 `target_environment`，随即以成功状态退出，不再判断提案窗口与部署回执。
- 适用窗口：活跃变更为 `verify-self-sufficient-cases`，或设置了 `OPENLOGOS_VS_SMOKE=1`。窗口之外为全部 owned ID 写 skip，不声明 `target_environment`。环境变量一律使用 `OPENLOGOS_VS_` 前缀。
- 部署前置：先读部署账本中本提案在 test 的最后一条成功 deploy；没有记录时写显式 `skip` 并携带缺失项；有记录时要求源码候选版本可读，且回执同一 deploy_id、`result=done`、`candidate_version` 等于源码候选版本、`entry_realpath` 为非空绝对路径，任一不符判 fail。有 skip 时不得写 `SMOKE_PASS`。
- 全局 CLI 子进程在独立进程组中运行，每次限时 120 秒，到时对整个进程组强制终止并判 fail。
- 按预期退出码与输出通道判定：要求解析信封的步骤一律以 `--format json` 调用，并对 `stdout.trim()` 整体 `JSON.parse`；超时、被信号终止、启动错误、非预期退出码或信封无法整体解析，均判该用例 fail，不得重试后写 pass。
- 「预跑未执行」以项目外标记 `RAN` 是否存在判定。
- 结果写入 smoke reporter，每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-338～SMOKE-core-341 均被 runner 覆盖。

## OpenLogos 0.16.25 冒烟阶段人工验收安装态 smoke（SMOKE-core-342～346）

> 这组用例验证本提案 smoke-manual-acceptance 的冒烟阶段人工验收能力，已在本机全局安装态中以 0.16.25 的身份生效（功能规格 §2.107；需求 AC-SMOKE-MANUAL-01～AC-SMOKE-MANUAL-14）。完整行为已由仓库内用例覆盖：UT-S46-01 起、ST-S46-01 起、UT-S19-127 起、ST-S19-40 起、UT-S41-30 起、UT-S05-58 起、UT-S09-493 起、UT-S08-93 起。安装态只取证三件事：装上的是本次候选；全局 CLI 在一次性项目中确实按新规则读取人工标记、等待、记录、通过、失败与过期；不部署提案的人工用例会被累积。
>
> **夹具**：每条用例在各自的 `mktemp -d` 一次性 git 项目 `P` 内执行，经全局 `openlogos init` 建立项目后写入：
> - 单模块 `core` launched；
> - 登记表含两个环境：`ma-test` 不写 `manual_acceptance`；`ma-prod` 写 `manual_acceptance: {enabled: true}`。两者都配置 `deploy: {mode: script, script: deploy/noop.sh}`，`deploy/noop.sh` 为被 git 跟踪、立即以 0 退出的脚本；
> - 测试规格含 `ST-S01-05 [manual]`，smoke 规格含 `SMOKE-core-01`（自动）与 `SMOKE-core-901 [manual]`；
> - `smoke.command` 指向夹具内的记录型 runner，为 SMOKE-core-01 写 pass，并按环境变量控制是否额外为 SMOKE-core-901 写一行（用于判定 `manual_smoke_result_id`）。
>
> 部署一律经全局 CLI 的 `openlogos deploy --env <环境> --ref HEAD --format json`（版本通道，无活跃提案；版本通道必须显式给出 `--ref`，否则报 `DEPLOY_REF_REQUIRED`，评审 delta-r1 F5）真实落账，**不手写账本**。每次部署前先把夹具改动提交，`HEAD` 即该步骤刚提交的版本；重新部署同一提交时同样传 `--ref HEAD`。每次部署都以「退出码 0、`data.status === "done"`、`data.deploy_id` 非空」作为该步的前置断言（部署成功信封的字段见 `spec/cli-json-output.md`「deploy 成功输出」，评审 delta-r2 F5），不满足即判该用例 fail，不再继续后续断言；需要核验 `result` 时，读取 `P` 内账本中同一 `deploy_id` 的 deploy 行。
>
> 每条用例在**各自的** `P` 中独立执行；需要以 SMOKE-core-344 的通过状态为起点的用例，在自己的 `P` 中先重放 SMOKE-core-344 的 ①～④。`openlogos accept` 由 runner 在 `P` 内以子进程直接调用：不经 AI 宿主，因此不触发 guard。每次执行全局 CLI 前，把夹具改动提交到本地 git。runner 对全局安装态**只读**，不做安装或卸载。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.25`。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-342 | 安装态版本与制品身份 | 本机全局已安装本次候选；部署账本中有本提案在 test 的成功部署记录，本机回执与之为同一 deploy_id | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json`，并以包内校验器重算 | ① `--version` 等于本次成功部署回执中的候选版本，入口无 workspace link，回执 `entry_realpath` 为非空绝对路径且等于入口 realpath；② 校验器不抛错 | 保留读取结果；任一不符即停止后续流程，按部署方案以 `openlogos deploy --env test --rollback` 回退 |
| SMOKE-core-343 | 人工标记读取与关闭环境只列出 | 夹具如上；另建一个只含 `SMOKE-core-901 [manual]`、没有 runner 与结果文件的全人工子夹具 | ① `deploy --env ma-test --ref HEAD` 后执行 `smoke --env ma-test --format json`；② 让 runner 额外写 SMOKE-core-901 后重跑；③ 在全人工子夹具中 `deploy --env ma-test --ref HEAD` 后执行 `smoke --env ma-test --format json` | ① 退出码 0，`gate.result="PASS"`，`defined_count` 不含 SMOKE-core-901，`manual_acceptance.unexecuted` 含 ST-S01-05 与 SMOKE-core-901，账本没有 pending 行；② 退出码 1，诊断 `manual_smoke_result_id`；③ 不报 `NO_SMOKE_RESULTS` / `NO_SMOKE_CASES`，`gate.result="PASS"` | 保留 JSON 与账本副本；按失败回流修复 |
| SMOKE-core-344 | 开启环境：等待 → 记录 → 通过 | 夹具如上 | ① `deploy --env ma-prod --ref HEAD --format json`，取返回的 deploy_id D，并与 `env show ma-prod --format json` 核对一致；② `smoke --env ma-prod --format json`；③ `accept --env ma-prod --deploy <D> --case ST-S01-05,SMOKE-core-901 --result pass --format json`；④ 重跑 smoke；⑤ `env show ma-prod --format json` | ② 退出码 1，`gate.result="PENDING"`，`gate.reason="manual_acceptance_pending"`，`manual_acceptance.pending` 含两条，账本最近 smoke 行 `result=pending`；③ 退出码 0，`remaining=[]`；④ 退出码 0，`gate.result="PASS"`，账本最近 smoke 行 `manual_passed=true`；⑤ `manual_acceptance.waiting=null` | 同上 |
| SMOKE-core-345 | 首次通过后更正普通用例、部署已更换 | 自己的 `P`（夹具不配置 regression），先重放 SMOKE-core-344 的 ①～④ 使 ma-prod 在 D 上通过 | ① 读取 `env show ma-prod --format json` 确认通过；② `accept --env ma-prod --deploy <D> --case SMOKE-core-901 --result fail --note 白屏 --format json`；③ 重跑 smoke；④ `deploy --env ma-prod --ref HEAD` 重新部署同一提交得到 D2，然后执行 `accept --env ma-prod --deploy <D> --case ST-S01-05 --result pass` | ② 退出码 0，`expired_pass=true`（D 自己的通过不作为 D 的基线，SMOKE-core-901 仍在清单中）；③ 退出码 1，`gate.reason="manual_cases_failed"`，`failed` 含 SMOKE-core-901 与说明；④ 部署断言通过且 D2≠D；accept 退出码 1，错误码 `ACCEPT_DEPLOY_CHANGED`，账本行数不变 | 同上 |
| SMOKE-core-346 | 不部署提案的人工用例被累积 | 自己的 `P`，先重放 SMOKE-core-344 的 ①～④（基线为该次部署的提交） | ① 新提交加入 `ST-S01-08 [manual]`（模拟一个已归档、未部署的提案）；② 再提交一处无关改动；③ `deploy --env ma-prod --ref HEAD` 后执行 `smoke --env ma-prod --format json` | ③ `manual_acceptance.pending` 含 ST-S01-08，不含基线中未改动的 ST-S01-05，`baseline_ref` 等于 SMOKE-core-344 通过时的提交 | 同上 |

### 二、执行边界

- 全部读写只在一次性项目 `P`、项目外临时目录与受控临时目录内进行，结束即删除；不配置远端、不联网。
- **不得**触碰以下对象：本仓活跃提案；本仓 `logos/resources/`（结果账本除外）；本仓运行态目录与账本；本仓的 git 分支与工作区；本仓登记表；用户其他仓库（包括 runlogos、markdown6）；本机全局 prefix。
- 结果写入本仓 `logos/resources/verify/smoke-results.jsonl`。只有目标为 `test`（或未指定）且实际执行的结果行，才带 `target_environment="test"`；目标不是 test 的 skip 行与窗口之外的 skip 行，都不声明 `target_environment`。

### 三、追溯与覆盖

- 需求：AC-SMOKE-MANUAL-01～AC-SMOKE-MANUAL-14；功能规格：§2.107。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.25 本机测试环境发布（smoke-manual-acceptance）」。
- 仓库内对应用例：
  - SMOKE-core-343：UT-S19-127～UT-S19-132、ST-S46-05、ST-S46-10；
  - SMOKE-core-344：ST-S46-01、UT-S46-23；
  - SMOKE-core-345：ST-S46-02、ST-S46-03、UT-S46-15、UT-S46-31；
  - SMOKE-core-346：ST-S46-04、UT-S46-03。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-manual-acceptance.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行。runner 显式分派 SMOKE-core-342～SMOKE-core-346，不得依靠通配发现后无条件 PASS。
- **目标环境优先判断**：沿用通用安装态 runner 的入口判断。宿主已指定 `OPENLOGOS_SMOKE_ENV` 且不是 `test` 时，runner 首先为全部 owned ID 写带原因的显式 skip（原因 `env-not-test`，缺失项 `OPENLOGOS_SMOKE_ENV=test`），skip 行不声明 `target_environment`，随即以成功状态退出，不再判断提案窗口与部署回执。
- **适用窗口**：活跃变更为 `smoke-manual-acceptance`，或设置了 `OPENLOGOS_MA_SMOKE=1`。窗口之外，为全部 owned ID 写 skip，不声明 `target_environment`。环境变量一律使用 `OPENLOGOS_MA_` 前缀。
- **部署前置**：先读部署账本中本提案在 test 的最后一条成功 deploy。没有记录时写显式 `skip`，并携带缺失项。有记录时，要求源码候选版本可读，且回执满足以下全部条件，任一不符判 fail：同一 deploy_id；`result=done`；`candidate_version` 等于源码候选版本；`entry_realpath` 为非空绝对路径。有 skip 时不得写 `SMOKE_PASS`。
- **子进程与超时**：全局 CLI 子进程在独立进程组中运行，每次限时 120 秒；到时对整个进程组强制终止，判 fail。
- **判定方式**：按预期退出码与输出通道判定。要求解析信封的步骤一律以 `--format json` 调用，并对 `stdout.trim()` 整体 `JSON.parse`。以下情况都判该用例 fail，不得重试后写 pass：超时、被信号终止、启动错误、非预期退出码、信封无法整体解析。账本断言读取 `P` 内的 `logos/.openlogos-runtime/deployments.jsonl`，只读不写。
- **结果写入**：写入 smoke reporter，每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-342～SMOKE-core-346 均被 runner 覆盖。

## OpenLogos 0.16.26 verify 复跑安装态 smoke（SMOKE-core-347～351）

> 这组用例验证本提案 verify-flaky-rerun 的失败用例复跑与偶发判定，已在本机全局安装态中以 0.16.26 的身份生效（功能规格 §2.108；需求 AC-VERIFY-RERUN-12）。完整行为已由仓库内 UT-S13-180～UT-S13-216、ST-S13-44～ST-S13-47 覆盖。安装态只取证：装上的是本次候选；全局 CLI 在一次性项目中确实会复跑、判偶发、在该 FAIL 时仍 FAIL、在该不复跑时不复跑。
>
> **夹具**：每条用例在各自的 `mktemp -d` 一次性 git 项目 `P` 内执行，经全局 `openlogos init` 建立项目后写入：
> - 单模块 `core` launched，已合并测试规格含 UT-S01-01、UT-S01-02、UT-S01-03；
> - `verify.pre_run_command` 指向夹具内的记录型脚本 `rr-runner.mjs`：每次被执行时在项目外临时目录追加一行调用记录（第几次调用、收到的 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 与 `OPENLOGOS_VERIFY_RERUN`）；启动时清空结果文件；按夹具内的剧本文件决定每条用例在第 1 次、第 2 次调用时写 pass 或 fail；有 fail 时以非零状态退出；收到集合时只写集合内用例。
>
> 每次执行全局 CLI 前把夹具改动提交到本地 git。runner 对全局安装态**只读**，不做安装或卸载。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.26`。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-347 | 安装态版本与制品身份 | 本机全局已安装本次候选；部署账本中有本提案在 test 的成功部署记录，本机回执与之同一 deploy_id | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并以包内校验器重算 | ① `--version` 等于本次成功部署回执中的候选版本，入口无 workspace link，回执 `entry_realpath` 为非空绝对路径且等于入口 realpath；② 校验器不抛错 | 保留读取结果；回流部署，不继续后续用例的通过判定 |
| SMOKE-core-348 | 首跑失败、复跑通过记为偶发 | 夹具 `P`；剧本：UT-S01-01 第 1 次 fail、第 2 次 pass，其余 pass | 全局 `openlogos verify --format json`；读取调用记录、`result_path` 与 `acceptance-report.md` | 退出码 0；`gate.result="PASS"`；`flaky_cases` 含 UT-S01-01，`failed_cases` 为空，`warnings` 含 `flaky_cases_present`；`rerun.attempted=true`；runner 被调用 2 次，第 2 次收到 `["UT-S01-01"]` 与 `RERUN=1`；`result_path` 含三条用例；报告含「偶发用例」小节 | 保留信封、调用记录与报告；回流实现 |
| SMOKE-core-349 | 两次都失败照常 FAIL | 夹具 `P`；UT-S01-01 两次都 fail | 全局 `openlogos verify --format json` | 退出码非 0；`gate.result="FAIL"`、`gate.reason="failed_cases"`；`failed_cases` 含 UT-S01-01；无 `flaky_cases` | 同上 |
| SMOKE-core-350 | 超过上限不复跑 | 夹具 `P`；`verify.rerun_failed.max_cases: 1`；首跑 UT-S01-01、UT-S01-02 都 fail | 全局 `openlogos verify --format json` | runner 只被调用 1 次；FAIL `failed_cases`；`rerun.attempted=false`、`rerun.skipped_reason="too_many_failures"` | 同上 |
| SMOKE-core-351 | 关闭配置后不复跑 | 夹具 `P`；`verify.rerun_failed.enabled: false`；UT-S01-01 第 1 次 fail | 全局 `openlogos verify --format json` | runner 只被调用 1 次；FAIL `failed_cases`；`rerun.skipped_reason="disabled"` | 同上 |

### 二、执行边界

- 全部读写只在一次性项目 `P`、项目外临时目录与受控临时目录内进行，结束即删除；不配置远端、不联网。
- **不得**触碰以下对象：本仓活跃提案；本仓 `logos/resources/`（结果账本除外）；本仓运行态目录与账本；本仓的 git 分支与工作区；本仓登记表；用户其他仓库（包括 runlogos、markdown6）；本机全局 prefix。
- 结果写入本仓 `logos/resources/verify/smoke-results.jsonl`。只有目标为 `test`（或未指定）且实际执行的结果行，才带 `target_environment="test"`；目标不是 test 的 skip 行与窗口之外的 skip 行，都不声明 `target_environment`。

### 三、追溯与覆盖

- 需求：AC-VERIFY-RERUN-01、02、05、06、07、12；功能规格：§2.108。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.26 本机测试环境发布（verify-flaky-rerun）」。
- 仓库内对应用例：
  - SMOKE-core-348：UT-S13-180、UT-S13-185、UT-S13-205、ST-S13-44；
  - SMOKE-core-349：UT-S13-181、ST-S13-45；
  - SMOKE-core-350：UT-S13-187、ST-S13-47；
  - SMOKE-core-351：UT-S13-189、ST-S13-46。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-verify-flaky-rerun.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行。runner 显式分派 SMOKE-core-347～SMOKE-core-351，不得依靠通配发现后无条件 PASS。
- **目标环境优先判断**：沿用通用安装态 runner 的入口判断。宿主已指定 `OPENLOGOS_SMOKE_ENV` 且不是 `test` 时，runner 首先为全部 owned ID 写带原因的显式 skip（原因 `env-not-test`，缺失项 `OPENLOGOS_SMOKE_ENV=test`），skip 行不声明 `target_environment`，随即以成功状态退出，不再判断提案窗口与部署回执。
- **适用窗口**：活跃变更为 `verify-flaky-rerun`，或设置了 `OPENLOGOS_RR_SMOKE=1`。窗口之外，为全部 owned ID 写 skip，不声明 `target_environment`。环境变量一律使用 `OPENLOGOS_RR_` 前缀。
- **部署前置**：先读部署账本中本提案在 test 的最后一条成功 deploy。没有记录时写显式 `skip`，并携带缺失项。有记录时，要求源码候选版本可读，且回执满足以下全部条件，任一不符判 fail：同一 deploy_id；`result=done`；`candidate_version` 等于源码候选版本；`entry_realpath` 为非空绝对路径。有 skip 时不得写 `SMOKE_PASS`。
- **子进程与超时**：全局 CLI 子进程在独立进程组中运行，每次限时 120 秒；到时对整个进程组强制终止，判 fail。
- **判定方式**：按预期退出码与输出通道判定。要求解析信封的步骤一律以 `--format json` 调用，并对 `stdout.trim()` 整体 `JSON.parse`。以下情况都判该用例 fail，不得重试后写 pass：超时、被信号终止、启动错误、非预期退出码、信封无法整体解析。「runner 被调用几次」读项目外的调用记录，不从 CLI 输出推断。
- **结果写入**：写入 smoke reporter，每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 这组用例都不需要人参与，不带 `[manual]` 标记。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-347～SMOKE-core-351 均被 runner 覆盖。

## OpenLogos 0.16.27 分层验收安装态 smoke（SMOKE-core-352～358）

> 这组用例验证本提案 layered-verification 的分层验收与发布级验收，已在本机全局安装态中以 0.16.27 的身份生效（功能规格 §2.109；需求 AC-VERIFY-TIER-22）。完整行为已由仓库内 UT-S13-217～UT-S13-274、ST-S13-48～ST-S13-51、UT-S09-504～506、UT-S35-231～239、UT-S32-118～125 覆盖。安装态只取证：装上的是本次候选；全局 CLI 在一次性项目中未开启时不变、开启后只采信三层合集、该扩大时扩大、主链路超限时在执行前 FAIL、发布级实际执行全量并与提交号绑定。
>
> **夹具**：每条用例在各自的 `mktemp -d` 一次性 git 项目 `P` 内执行，经全局 `openlogos init` 建立项目后写入：
> - 单模块 `core` launched；已合并测试规格 `core-S01-test-cases.md`（UT-S01-01、02）、`core-S02-test-cases.md`（UT-S02-01、02）、`core-S03-test-cases.md`（UT-S03-01、02，含「主链路用例」小节，列出 UT-S03-01）；
> - `verify.pre_run_command` 指向夹具内的记录型脚本 `lv-runner.mjs`：每次被执行时在项目外临时目录追加一行调用记录（收到的 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS`、实际执行的用例 ID）；启动时清空结果文件；收到清单时只执行、只上报清单内的用例，否则执行全部；按剧本决定每条用例写 pass 或 fail；
> - 需要活跃提案的用例：经全局 `openlogos change` 建立提案（脚手架即含「受影响场景」段），按用例填写该段，guard 带 `baseRef`。
>
> 每次执行全局 CLI 前把夹具改动提交到本地 git。runner 对全局安装态**只读**，不做安装或卸载。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.27`。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-352 | 安装态版本与制品身份 | 本机全局已安装本次候选；部署账本中有本提案在 test 的成功部署记录，本机回执与之同一 deploy_id | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并以包内校验器重算 | ① `--version` 等于本次成功部署回执中的候选版本，入口无 workspace link，回执 `entry_realpath` 为非空绝对路径且等于入口 realpath；② 校验器不抛错 | 保留读取结果；回流部署，不继续后续用例的通过判定 |
| SMOKE-core-353 | 未开启时范围不变，脚手架含「受影响场景」段 | 夹具 `P`；不写 `verify.layered`；全部 pass | ① 全局 `openlogos change lv-smoke`，读取 `proposal.md`；② 全局 `openlogos verify --format json`；读取调用记录 | ① 提案含「受影响场景」段与 `schema: openlogos/affected-scenarios@1`；② `data.level="proposal"`，没有 `layers`；入口未收到分层清单，执行全部 6 条用例；`gate.result="PASS"` | 保留信封与调用记录；回流实现 |
| SMOKE-core-354 | 开启后提案级验收只采信三层合集 | 夹具 `P`；`verify.layered.enabled: true`；活跃提案声明 `assessment: assessed`、`scenarios: [S02]`；全部 pass | 全局 `openlogos verify --format json`；读取调用记录与 `acceptance-report.md` | 退出码 0；`gate.result="PASS"`；`layers.expansion.level="none"`；`layers.total.ids` 为 S02 的两条加 UT-S03-01；入口收到的清单与之相同，实际只执行这 3 条，S01 的用例与 UT-S03-02 未被执行、不计未覆盖；报告含「级别」行（提案级）与验收范围小节 | 同上 |
| SMOKE-core-355 | 评估不可用时扩大 | 承 SMOKE-core-354 的夹具；把声明改回 `assessment: pending` | 全局 `openlogos verify --format json`；读取调用记录 | `layers.expansion.level="full"`，原因含 `declaration_invalid`；入口执行全部 6 条用例；`gate.result="PASS"`（扩大不是失败） | 同上 |
| SMOKE-core-356 | 主链路超过上限在执行前 FAIL | 夹具 `P`；`verify.layered.enabled: true`、`main_path_max: 1`；`core-S03` 的主链路小节列 2 条 | 全局 `openlogos verify --format json`；读取调用记录 | 退出码非 0；`gate.reason="main_path_over_limit"`；`layers.main_path` 给出 `limit=1`、`count=2`；入口未被调用 | 同上 |
| SMOKE-core-357 | 发布级验收实际执行全量并写独立报告 | 夹具 `P`；`verify.layered.enabled: true`；没有活跃提案；全部内容已提交、工作区干净；全部 pass | ① 全局 `openlogos verify --release --format json`；② 读取调用记录、`logos/resources/verify/release/acceptance-report.md` 与最新一条验收历史；③ 新项目去掉 `pre_run_command`、预置全绿结果后执行 `openlogos verify --release --format json` | ① 退出码 0；`data.level="release"`；`data.release.commit` 等于运行前的 HEAD；② 入口未收到清单、执行全部 6 条用例；发布级报告含级别（发布级）、提交号与平台；历史记录 `level="release"`、`commit.head` 为该提交；③ `RELEASE_VERIFY_NO_COMMAND`，退出码 2，入口未被调用 | 同上 |
| SMOKE-core-358 | 发布级结论的查询：后一次失败推翻前一次通过，提交变了即作废 | 承 SMOKE-core-357 ① 的项目 | ① `openlogos verify --release --check --format json`；② 把剧本改为一条用例 fail，该改动放在项目外的剧本文件中（不改变提交），再执行 `openlogos verify --release`，随后 `--release --check`；③ 新建一个空提交后 `--release --check`；④ 留下一个未提交的源码改动后执行 `openlogos verify --release --format json` | ① `valid=true`，退出码 0；② 发布级 FAIL；查询 `valid=false`、`reason="latest_failed"`，退出码 1；③ `valid=false`、`reason="other_commit_only"`，退出码 1；④ `RELEASE_VERIFY_DIRTY`，退出码 2，入口未被调用 | 同上 |

### 二、执行边界

- 全部读写只在一次性项目 `P`、项目外临时目录与受控临时目录内进行，结束即删除；不配置远端、不联网。
- **不得**触碰以下对象：本仓活跃提案；本仓 `logos/resources/`（结果账本除外）；本仓运行态目录与账本；本仓的 git 分支与工作区；本仓登记表；用户其他仓库（包括 runlogos、markdown6）；本机全局 prefix。发布级验收只在一次性项目内执行，不对本仓执行。
- 结果写入本仓 `logos/resources/verify/smoke-results.jsonl`。只有目标为 `test`（或未指定）且实际执行的结果行，才带 `target_environment="test"`；目标不是 test 的 skip 行与窗口之外的 skip 行，都不声明 `target_environment`。

### 三、追溯与覆盖

- 需求：AC-VERIFY-TIER-02、05、06、09、10、11、14、15、17、18、19、22；功能规格：§2.109。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.27 本机测试环境发布（layered-verification）」。
- 仓库内对应用例：
  - SMOKE-core-353：UT-S13-218、UT-S09-504；
  - SMOKE-core-354：UT-S13-221、UT-S13-222、UT-S13-247、ST-S13-48；
  - SMOKE-core-355：UT-S13-229、UT-S13-234、ST-S13-49；
  - SMOKE-core-356：UT-S13-238；
  - SMOKE-core-357：UT-S13-254、UT-S13-255、UT-S13-257、UT-S13-258、ST-S13-50；
  - SMOKE-core-358：UT-S13-253、UT-S13-261、UT-S13-263、ST-S13-51。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-layered-verification.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行。runner 显式分派 SMOKE-core-352～SMOKE-core-358，不得依靠通配发现后无条件 PASS。
- **目标环境优先判断**：沿用通用安装态 runner 的入口判断。宿主已指定 `OPENLOGOS_SMOKE_ENV` 且不是 `test` 时，runner 首先为全部 owned ID 写带原因的显式 skip（原因 `env-not-test`，缺失项 `OPENLOGOS_SMOKE_ENV=test`），skip 行不声明 `target_environment`，随即以成功状态退出，不再判断提案窗口与部署回执。
- **适用窗口**：活跃变更为 `layered-verification`，或设置了 `OPENLOGOS_LV_SMOKE=1`。窗口之外，为全部 owned ID 写 skip，不声明 `target_environment`。环境变量一律使用 `OPENLOGOS_LV_` 前缀。
- **部署前置**：先读部署账本中本提案在 test 的最后一条成功 deploy。没有记录时写显式 `skip`，并携带缺失项。有记录时，要求源码候选版本可读，且回执满足以下全部条件，任一不符判 fail：同一 deploy_id；`result=done`；`candidate_version` 等于源码候选版本；`entry_realpath` 为非空绝对路径。有 skip 时不得写 `SMOKE_PASS`。
- **子进程与超时**：全局 CLI 子进程在独立进程组中运行，每次限时 120 秒；到时对整个进程组强制终止，判 fail。
- **判定方式**：按预期退出码与输出通道判定。要求解析信封的步骤一律以 `--format json` 调用，并对 `stdout.trim()` 整体 `JSON.parse`（错误信封在 stderr 时同样整体解析）。以下情况都判该用例 fail，不得重试后写 pass：超时、被信号终止、启动错误、非预期退出码、信封无法整体解析。「入口被调用几次」「实际执行了哪些用例」读项目外的调用记录，不从 CLI 输出推断。
- **结果写入**：写入 smoke reporter，每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 这组用例都不需要人参与，不带 `[manual]` 标记。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-352～SMOKE-core-358 均被 runner 覆盖。

## OpenLogos 0.16.28 验收范围字段判断与切片模块安装态 smoke（SMOKE-core-359～366）

> 这组用例验证本提案 verify-scope-fields-and-slice-module 的两项修正，已在本机全局安装态中以 0.16.28 的身份生效（功能规格 §2.96.3.1、§2.110；需求 AC-VERIFY-FIELD-01～10）。完整行为已由仓库内 UT-S13-275～UT-S13-293、ST-S13-52～ST-S13-54、UT-S32-126～UT-S32-134 覆盖。安装态只取证：装上的是本次候选；全局 CLI 在一次性项目中，只改无关字段时范围不回落、改了相关字段或无法判断时回落并写明原因、工作区缺配置时入口错误不变；非 core 模块提案能规划切片并进入切片验收，`--slug` 指向非活跃提案时拒绝。
>
> **夹具 `P`（多模块）**：每条用例在各自的 `mktemp -d` 一次性 git 项目内执行，经全局 `openlogos init` 建立项目后写入：
> - 模块 `core` 与 `web`（均 launched），各自声明非空 `paths`（`core/**`、`web/**`）；已合并测试规格 `core-S01-test-cases.md`（UT-S01-01、02）、`web-S05-test-cases.md`（UT-S05-01、02）；
> - `verify.modules.core` 与 `verify.modules.web` 各有命令组，指向夹具内的记录型脚本：每次被执行时在项目外临时目录追加一行调用记录（模块、收到的清单、实际执行的用例 ID），并写出本模块用例的结果（缺省全部 pass）；`logos/logos.config.json` 另含 `smoke` 与 `description`，`logos/logos-project.yaml` 含 `resource_index`；分层验收关闭；
> - 全部内容提交后，经全局 `openlogos change <slug> --module web` 建立活跃提案（guard 带 `baseRef` 与 `module: web`）。
>
> **夹具 `L`（分层）**：同「OpenLogos 0.16.27 分层验收安装态 smoke」的单模块夹具，`verify.layered.enabled: true`，活跃提案声明 `assessment: assessed`、`scenarios: [S02]`。
>
> runner 对全局安装态**只读**，不做安装或卸载。版本以部署记录与 `cli/src/lib/local-release-candidate.ts` 的候选版本为准，断言写成关系式，不硬编码 `0.16.28`。`detail` 的断言为精确字符串比较。

### 一、冒烟测试用例补充

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 | 失败处置 |
|---|---|---|---|---|---|
| SMOKE-core-359 | 安装态版本与制品身份 | 本机全局已安装本次候选；部署账本中有本提案在 test 的成功部署记录，本机回执与之同一 deploy_id | ① 读取 `command -v openlogos`、入口 realpath、`openlogos --version`；② 读取全局包内 `asset-manifest.json` 并以包内校验器重算 | ① `--version` 等于本次成功部署回执中的候选版本，入口无 workspace link，回执 `entry_realpath` 为非空绝对路径且等于入口 realpath；② 校验器不抛错 | 保留读取结果；回流部署，不继续后续用例的通过判定 |
| SMOKE-core-360 | 多模块项目只改无关字段时验收范围不回落 | 夹具 `P`；提案期间修改 `web/app.ts`，在 `logos/logos-project.yaml` 新增一条 `resource_index`，在 `logos/logos.config.json` 写入 `driver.review` | 全局 `openlogos verify --format json`；读取各命令组的调用记录 | 退出码 0；`scope.mode="module"`、`scope.modules=["web"]`、`scope.fallback_reason` 为 null；只有 `web` 的命令组被执行；`gate.result="PASS"` | 保留信封与调用记录；回流实现 |
| SMOKE-core-361 | 改了相关字段时回落全量并写明字段 | 承 SMOKE-core-360 的夹具；再修改 `logos/logos.config.json` 中 `verify.modules.core` 命令的一个参数 | 全局 `openlogos verify --format json`；读取调用记录 | `scope.mode="fallback-full"`、`fallback_reason.code="shared_config_changed"`、`detail` 为 `logos/logos.config.json（verify）`；两个模块的命令组都被执行 | 同上 |
| SMOKE-core-362 | 提案起点或工作区内容无法严格解析时回落 | ① 夹具 `P` 的变体：建立提案时的提交中 `logos/logos.config.json` 是损坏的 JSON，随后在工作区修正为有效内容；② 夹具 `P`：在工作区 `logos/logos-project.yaml` 中重复一个顶层 `resource_index` 键，`modules` 仍为两个带 `paths` 的模块 | 每个项目执行全局 `openlogos verify --format json` | ① `scope.mode="fallback-full"`、`detail` 为 `logos/logos.config.json（提案起点中的内容无法解析）`；② `scope.mode="fallback-full"`、`detail` 为 `logos/logos-project.yaml（工作区中的内容无法解析）`；两者 `code` 均为 `shared_config_changed` | 同上 |
| SMOKE-core-363 | 工作区缺项目配置时入口错误不变 | 夹具 `P`；删除工作区 `logos/logos.config.json` | 全局 `openlogos verify --format json`；读取调用记录 | 退出码 1；stderr 错误信封 `error.code="PROJECT_NOT_INITIALIZED"`；没有任何命令组被执行；输出中没有 `shared_config_changed` | 同上 |
| SMOKE-core-364 | 分层项目只改无关字段时保持收窄 | 夹具 `L`；提案期间只在 `logos/logos-project.yaml` 新增 `resource_index` 条目、修改 `logos/logos.config.json` 的 `description` | ① 全局 `openlogos verify --format json`，读取调用记录；② 再修改 `logos/logos.config.json` 的 `smoke.command` 后重跑 | ① `layers.expansion.level="none"`，入口只执行提案集合内的用例；② `layers.expansion.level="full"`，原因含 `shared_path_changed`，`detail` 为 `logos/logos.config.json（smoke）`，入口执行全部用例 | 同上 |
| SMOKE-core-365 | 非 core 模块提案规划切片后验收不报清单无效 | 夹具 `P`；活跃提案登记在 `web`，经全局 `openlogos merge` 写入 `SPEC_MERGED`（变更用例两条），切片输入把两条用例分给两个切片 | ① 全局 `openlogos slice plan --file slices.json --format json`，读取 `TEST_SLICE_MANIFEST.json`；② 全局 `openlogos verify --format json` | ① 退出码 0，清单 `module="web"`；② 输出中没有 `test-slice-manifest-invalid`，`verify_mode="slice-checkpoint"`，`attempted_slice_id` 为第一个切片 | 同上 |
| SMOKE-core-366 | `--slug` 指向非活跃提案时拒绝且不改文件 | 承 SMOKE-core-365 的项目；另建第二个提案目录 `other-demo`（含 `tasks.md`），guard 仍指向第一个提案；记录 `other-demo/tasks.md` 的哈希 | 全局 `openlogos slice plan --slug other-demo --file slices.json --format json` | 退出码 1；stderr 错误信封 `error.code="SLICE_PLAN_NO_ACTIVE_CHANGE"`；`other-demo/tasks.md` 哈希不变，目录中没有生成切片清单 | 同上 |

### 二、执行边界

- 全部读写只在一次性项目、项目外临时目录与受控临时目录内进行，结束即删除；不配置远端、不联网。
- **不得**触碰以下对象：本仓活跃提案；本仓 `logos/resources/`（结果账本除外）；本仓运行态目录与账本；本仓的 git 分支与工作区；本仓登记表；用户其他仓库（包括 runlogos）；本机全局 prefix。
- 结果写入本仓 `logos/resources/verify/smoke-results.jsonl`。只有目标为 `test`（或未指定）且实际执行的结果行，才带 `target_environment="test"`；目标不是 test 的 skip 行与窗口之外的 skip 行，都不声明 `target_environment`。

### 三、追溯与覆盖

- 需求：AC-VERIFY-FIELD-01、02、05、06、07、08、09；功能规格：§2.96.3.1、§2.110。
- 部署：`core-01-deployment-plan.md`「OpenLogos 0.16.28 本机测试环境发布（verify-scope-fields-and-slice-module）」。
- 仓库内对应用例：
  - SMOKE-core-360：UT-S13-275、UT-S13-276、ST-S13-52、ST-S13-53；
  - SMOKE-core-361：UT-S13-109、UT-S13-277、ST-S13-53；
  - SMOKE-core-362：UT-S13-282、UT-S13-284；
  - SMOKE-core-363：UT-S13-286；
  - SMOKE-core-364：UT-S13-288、UT-S13-289、ST-S13-54；
  - SMOKE-core-365：UT-S32-126、UT-S32-127；
  - SMOKE-core-366：UT-S32-129。

### 四、自动化与证据要求

- 新增 runner `scripts/smoke-verify-scope-fields.js`，由既有 `scripts/run-smoke.js` 按 `smoke-*.js` 发现并执行。runner 显式分派 SMOKE-core-359～SMOKE-core-366，不得依靠通配发现后无条件 PASS。
- **目标环境优先判断**：沿用通用安装态 runner 的入口判断。宿主已指定 `OPENLOGOS_SMOKE_ENV` 且不是 `test` 时，runner 首先为全部 owned ID 写带原因的显式 skip（原因 `env-not-test`，缺失项 `OPENLOGOS_SMOKE_ENV=test`），skip 行不声明 `target_environment`，随即以成功状态退出，不再判断提案窗口与部署回执。
- **适用窗口**：活跃变更为 `verify-scope-fields-and-slice-module`，或设置了 `OPENLOGOS_VSF_SMOKE=1`。窗口之外，为全部 owned ID 写 skip，不声明 `target_environment`。环境变量一律使用 `OPENLOGOS_VSF_` 前缀。
- **部署前置**：先读部署账本中本提案在 test 的最后一条成功 deploy。没有记录时写显式 `skip`，并携带缺失项。有记录时，要求源码候选版本可读，且回执满足以下全部条件，任一不符判 fail：同一 deploy_id；`result=done`；`candidate_version` 等于源码候选版本；`entry_realpath` 为非空绝对路径。有 skip 时不得写 `SMOKE_PASS`。
- **子进程与超时**：全局 CLI 子进程在独立进程组中运行，每次限时 120 秒；到时对整个进程组强制终止，判 fail。
- **判定方式**：按预期退出码与输出通道判定。要求解析信封的步骤一律以 `--format json` 调用，并对 `stdout.trim()` 整体 `JSON.parse`（错误信封在 stderr 时同样整体解析）。以下情况都判该用例 fail，不得重试后写 pass：超时、被信号终止、启动错误、非预期退出码、信封无法整体解析。「哪些命令组被执行」「实际执行了哪些用例」读项目外的调用记录，不从 CLI 输出推断。
- **既有 smoke 夹具随行为变化同步**：既有 runner 中凡是靠「改动两个配置文件即回落」构造前置的，改为修改相关字段；本提案实现时逐个核对 `scripts/smoke-*.js`。
- **结果写入**：写入 smoke reporter，每条用例只有一条结果记录，字段含 `id/status/timestamp/duration_ms/environment/target_environment/evidence`；**失败不得写 pass**。
- 这组用例都不需要人参与，不带 `[manual]` 标记。
- 完成后运行 smoke 覆盖预检，确认 SMOKE-core-359～SMOKE-core-366 均被 runner 覆盖。
