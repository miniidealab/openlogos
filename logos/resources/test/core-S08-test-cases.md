# S08: 同步 AI 工具资产与资源索引 — 测试用例


## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S08-01 | 同步项目名 | syncLogosProjectName | yaml 与 config 名称不一致 | sync | 修正名称 |
| UT-S08-02 | 补全 scenarios.module | syncScenariosModuleField | scenarios 缺失 module | sync | 回填 module |
| UT-S08-03 | 同步时补齐 verify.pre_run_command | sync 逻辑 | 已初始化项目缺少预跑配置但可识别测试栈 | sync | 写入全量测试命令 |
| UT-S08-04 | 同步时无法推断测试命令 | sync 逻辑 | 已初始化项目缺少预跑配置且无法识别测试栈 | sync | 输出 TODO，不写入伪造命令 |
| UT-S08-05 | sync 只替换 managed block | 根指令文件同步 | `AGENTS.md` / `CLAUDE.md` 含完整 marker 且 marker 外有用户内容 | sync | marker 内内容更新，marker 外内容不变 |
| UT-S08-06 | sync 无 marker 时追加托管片段 | 根指令文件同步 | 文件无 marker 且含用户内容 | sync | 保留原文并追加 OpenLogos managed block |
| UT-S08-07 | sync 幂等刷新托管片段 | 根指令文件同步 | 文件已有 OpenLogos managed block | 连续执行 sync 两次 | 不重复追加 managed block，用户内容仍保留 |

## 二、场景测试用例

### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S08-01 | 同步 AI 资产与索引 | Step 1→9 | 已初始化 | 执行 sync | 更新 AGENTS、CLAUDE 与 resource_index，并在可识别测试栈时补齐 verify 预跑配置 |
| ST-S08-02 | 旧项目缺失 verify 预跑配置时输出诊断 | Step 1→9 | 已初始化且缺少预跑配置 | 执行 sync | 输出 verify 预跑配置补齐结果或 TODO 诊断，不静默跳过 |
| ST-S08-03 | sync 保留根指令文件用户配置 | Step 7 | 已初始化，`AGENTS.md` / `CLAUDE.md` marker 外有用户内容 | 执行 sync | 用户内容仍存在；OpenLogos managed block 被刷新；没有重复 block |


## 三、覆盖度校验
- [x] 同步项目名：已覆盖（UT-S08-01）
- [x] 补全 scenarios.module：已覆盖（UT-S08-02）
- [x] 同步时补齐 verify 预跑配置：已覆盖（UT-S08-03）
- [x] 无法推断时输出 TODO：已覆盖（UT-S08-04）
- [x] sync 主路径：已覆盖（ST-S08-01）
- [x] sync 诊断路径：已覆盖（ST-S08-02）
- [x] sync 根指令文件合并：已覆盖（UT-S08-05 / UT-S08-06 / UT-S08-07 / ST-S08-03）

## 四、Codex / Claude Skill 命名空间同步测试补充

### 4.1 单元测试用例补充
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S08-08 | sync 只刷新 marketplace 的 `openlogos` 条目 | Codex repo marketplace 同步 | `.agents/plugins/marketplace.json` 含 `openlogos` 与项目插件条目 | sync | 只更新 `openlogos` 条目；项目插件条目内容不变 |
| UT-S08-09 | sync 不把 `.agents/skills` 未知 skill 迁移到 OpenLogos 插件 | Codex Skill 归属判定 | `.agents/skills/release-guard/SKILL.md` 存在 | sync | 文件原样保留；`openlogos` 插件不新增 `release-guard` |
| UT-S08-10 | sync 可刷新 OpenLogos 官方 Codex skills | Codex 官方 skill 同步 | `openlogos` 插件内存在旧版 `prd-writer` | sync | 官方 skill 被刷新为当前模板 |
| UT-S08-11 | sync 保留 Claude `.claude/skills` 项目技能 | Claude Skill 边界 | `.claude/skills/release-guard/SKILL.md` 存在 | sync | 项目 skill 内容与路径不变；OpenLogos 官方插件不包含该 skill |
| UT-S08-12 | sync 输出项目 skill 命名空间诊断 | 同步结果输出 | 存在项目专属 Codex 或 Claude skill | sync | 输出中说明项目 skill 未进入 OpenLogos 命名空间 |

### 4.2 场景测试用例补充
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S08-04 | sync 保留 Codex 项目插件并刷新 OpenLogos 插件 | Step 8→10 | 已初始化 Codex 项目，marketplace 含 `openlogos` 与 `adcn` | 执行 sync | `openlogos` 插件刷新；`adcn` 插件不被删除、改名或重排为 OpenLogos 插件 |
| ST-S08-05 | sync 保留历史 `.agents/skills` 项目 skill | Step 8→10 | 已初始化项目存在 `.agents/skills/release-guard/SKILL.md` | 执行 sync | 项目 skill 原样保留；生成说明不出现 `openlogos:release-guard` |
| ST-S08-06 | sync 保留 Claude 项目 skill 并刷新托管片段 | Step 7→10 | 已初始化 Claude 项目，`.claude/skills/release-guard/SKILL.md` 与 `CLAUDE.md` 均存在 | 执行 sync | `CLAUDE.md` managed block 刷新；项目 skill 原样保留且单独分组 |

### 4.3 覆盖度校验补充
- [x] Codex marketplace 项目插件保留：已覆盖（UT-S08-08 / ST-S08-04）
- [x] 历史 `.agents/skills` 项目 skill 不被吸收：已覆盖（UT-S08-09 / ST-S08-05）
- [x] OpenLogos 官方 Codex skills 可刷新：已覆盖（UT-S08-10）
- [x] Claude 项目 skill 保留：已覆盖（UT-S08-11 / ST-S08-06）
- [x] 同步输出命名空间诊断：已覆盖（UT-S08-12）
