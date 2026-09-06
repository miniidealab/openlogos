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

## 场景 CREATE 完整性修复 v0.13.27 本地全局安装冒烟用例

> 适用部署：`fix-scenario-create-completeness-contract`。仅在 verify PASS、用户另行授权部署、`0.13.27` tarball 已安装到当前开发机 npm 全局环境且部署完成受控落标后，由独立 `openlogos smoke` 门执行。所有结果必须经统一 dispatcher/reporter 写入 `logos/resources/verify/smoke-results.jsonl`。

### 冒烟测试用例补充

| ID | 用例 | 来源 | 目标环境 | 前置条件 | 操作 | 通过标准 | 失败处理 |
|---|---|---|---|---|---|---|---|
| SMOKE-core-67 | 全局版本、命令路径与合同资产一致 | 部署方案“部署后成功证据”1～2 | local | 已从记录 SHA-256 的本地 tarball 全局安装；开启新 shell | 解析 `openlogos` 命令路径，执行 `openlogos --version`，读取全局 package/plugin 版本及包内规格/Skill | 路径位于预期 npm prefix；版本均精确 `0.13.27`；包内存在更新后的 `spec/baseline-closure.md`、`spec/change-management.md`、change-writer 与 scenario-architect Skills | 任一不一致即 FAIL，停止后续归档并恢复 0.13.26 |
| SMOKE-core-68 | 安装态兼容标题通过且关键词伪证据失败 | S39-AC-08～11、部署方案成功证据 3～4 | local | 隔离临时 launched 项目；准备完整 canonical/alias 参数化夹具及散文、fence、注释、少步骤、伪 Mermaid、空章节反例 | 对每个夹具用全局安装的 CLI 运行 `openlogos change-lint --format json`，保存 JSON/exit 和前后快照 | `步骤说明`、`主流程`、`主路径步骤`、`主路径`、`正常流程`、`main path` 全部 exit 0；所有反例 exit 2 且给出精确 `create_target_incomplete`；项目字节不变 | 任一假阴性/假阳性、非只读或诊断退化即 FAIL，保留 fixture 并回滚 |
| SMOKE-core-69 | 安装态 merge 缺步骤 fail-closed 与 0.13.26 回滚可用 | S39-AC-12、部署方案“失败处理与回滚” | local | 隔离临时项目有完整 P/T/D，仅 scenario CREATE 缺权威步骤；保存全项目哈希；保留 0.13.26 tarball/hash | 用全局 CLI 运行 change-lint 与 merge 负例，比较快照；随后在隔离验证窗口重新安装 0.13.26 并复核版本/路径，按部署决定恢复 0.13.27 或结束 | lint exit 2、merge 非零且无 `MERGE_PROMPT.md`/资源/guard/counter/index/marker 变化；回滚精确恢复 0.13.26、原路径与制品哈希 | merge 假通过、任何副作用或回滚失败均 FAIL，阻断 archive |

### Runner、reporter 与隔离要求

- code 阶段必须新增或更新等效 `scripts/smoke-*` runner，并接入 `logos.config.json.smoke.command` 指向的统一 dispatcher；runner 必须逐项覆盖 SMOKE-core-67～69。
- 每个用例必须写一条最终状态到 `logos/resources/verify/smoke-results.jsonl` 或配置的 `smoke.result_path`；不得手工创建 `SMOKE_PASS`。
- smoke 前运行覆盖预检，SMOKE-core-67～69 任一出现在 uncovered cases、无 reporter 行或非 PASS 时统一门失败。
- 所有夹具位于安全临时目录，不修改真实活跃提案、guard 或资源；失败时可保留诊断目录，成功后清理。
- 本组用例不执行 npm publish、Git tag、GitHub Release、官网部署、远端 push，也不把本机安装授权扩张为公开发布。

### 覆盖度结论

- [x] 健康/核心入口：由 SMOKE-core-67 的全局命令、版本和包资产覆盖。
- [x] 关键合法与异常链路：由 SMOKE-core-68 的安装态 change-lint 矩阵覆盖。
- [x] 合并纵深、无副作用与回滚：由 SMOKE-core-69 覆盖。
- [x] 数据库迁移、远端配置、密钥和静态站点不适用；本次无 DB/远端服务/GUI 部署。

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

## Authority Closure 安装态 smoke（SMOKE-core-163～167）


| ID | 主路径/异常/边界 | 安装态操作 | 精确期望 |
|---|---|---|---|
| SMOKE-core-163 | candidate 资产同源主路径 | 从固定 tarball 隔离安装，核对根 spec、六 Skill、plugin/cache、manifest/hash | 全部身份一致；CLI 入口/版本/realpath 指向 candidate |
| SMOKE-core-164 | required/not_applicable 与五类 violation | 在隔离 fixture 运行合法两分支及缺失/畸形/引用/闭包/cutover 反例 | 正例 exit 0；反例 exit 2 且 code/summary 精确、无写副作用 |
| SMOKE-core-165 | stale/conflict/restart | 写入与 authority 冲突的旧 projection，丢失响应并用新进程查询 | 决定只来自 authority/receipt；旧 projection 被拒绝或重建 |
| SMOKE-core-166 | legacy writer 与 cutover | 关闭旧入口、启用新 mutation、重建投影，再调用旧入口 | 旧 writer 明确失败；新入口唯一；freshness/exit evidence 完整 |
| SMOKE-core-167 | 回滚与再安装 | candidate→冻结旧版→candidate 的实际往返安装 | 每阶段入口/版本/资产/行为对应自身版本；无混合资产，重装幂等 |

### 覆盖与 reporter

覆盖 Authority Closure required/not_applicable、AC-01～AC-08、五类机器 violation、共享 evaluator、asset freshness、writer cutover 与 rollback。执行器必须把逐 ID 结果、candidate SHA、入口、realpath 和资产 hash 写入 `logos/resources/verify/smoke-results.jsonl`；不得手工伪造 `SMOKE_PASS`。

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
