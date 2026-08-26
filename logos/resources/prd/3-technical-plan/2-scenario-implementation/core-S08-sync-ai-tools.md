
# S08: 同步 AI 工具资产与资源索引 — 时序图

```mermaid
sequenceDiagram
    participant U as User
    participant C as OpenLogos CLI

    U->>C: Step 1: openlogos sync
    C->>C: Step 2: 读取 logos.config.json 与 logos-project.yaml
    C->>C: Step 3: 同步项目名与 lifecycle
    C->>C: Step 4: 补全 scenarios[].module
    C->>C: Step 5: 扫描并补录 resource_index
    C->>C: Step 6: 检查 verify 预跑配置
    C->>C: Step 7: 合并刷新 AGENTS.md、CLAUDE.md 托管片段
    C->>C: Step 8: 同步插件资产
    C-->>U: Step 9: 输出同步结果
```

## 步骤说明
1. **用户**执行 `openlogos sync`。
2. **CLI** 加载配置与索引。
3. **CLI** 修正项目元数据。
4. **CLI** 补全场景模块字段。
5. **CLI** 补录资源索引。
6. **CLI** 检查 `verify.pre_run_command`、`verify.regression_command`、`verify.incremental_command` 是否至少存在一个。若缺失，按测试栈推断并补齐；无法推断时输出 TODO。
7. **CLI** 刷新 `AGENTS.md` / `CLAUDE.md` 时复用统一 managed block 合并逻辑，仅替换 OpenLogos 托管片段，保留托管片段外用户自定义内容；无 marker 旧文件保留原文并追加托管片段。
8. **CLI** 扫描目标宿主的项目专属 Skill 与插件资产。Codex 包括 `.agents/skills/*`、`.agents/plugins/*` 与历史 `.codex-plugin/`；Claude Code 包括 `.claude/skills/*` 与项目独立插件。
9. **CLI** 只同步 OpenLogos 官方插件资产。Codex 中刷新 repo marketplace 的 `openlogos` 插件条目、OpenLogos skills 和 SessionStart hook；Claude Code 中刷新 OpenLogos 官方插件和 guard；项目专属 skill、项目插件条目和未知归属资产原样保留。
10. **CLI** 汇总输出，同步结果中应包含兼容迁移说明和命名空间诊断，便于用户发现项目 skill 是否仍处于项目命名空间。
11. **CLI** 全部同步步骤成功完成后，写入版本戳文件 `logos/.openlogos-sync.json`（`cliVersion` + `syncedAt`，幂等覆盖）；任何失败退出路径（配置缺失、baseline 提交进行中）都不写、不刷新该文件。详见「版本戳落盘（.openlogos-sync.json）」章节。

## 版本戳落盘（.openlogos-sync.json）

`openlogos sync` 成功完成后，在项目本地落盘最近一次成功 sync 使用的 CLI 版本，供人或 AI 与全局安装版本（`openlogos --version`）对比，判断本地是否需要再次 sync。

**文件路径**：`logos/.openlogos-sync.json`

**文件内容**：

```json
{
  "cliVersion": "<当前 CLI VERSION，即 cli/package.json 的 version>",
  "syncedAt": "<ISO 8601 时间戳>"
}
```

**行为约束**：

1. **只在成功路径写入**：写入时机位于 sync 全部同步步骤正常执行完毕之后（即 `withRecoveredReadLocks` 回调成功返回、未因 `baseline_commit_in_progress` 退出）。sync 因 `logos.config.json` 缺失或 baseline 提交进行中而失败退出时，不写、不刷新该文件——避免失败的 sync 刷新版本戳造成「看似已同步」的假象。
2. **幂等覆盖**：每次成功 sync 整体覆盖写入（非追加），文件始终反映最近一次成功 sync 的版本与时间。
3. **私有会话态定位**：与 `logos/.session-capabilities.json` 同款做法——项目本地私有文件，约定 gitignore，CLI 不强制改写用户 `.gitignore`。
4. **消费边界**：本文件只是事实源；`status` / `next` 等命令的「CLI 已升级，建议重新 sync」对比提示不属于本场景范围。

## AI 工具 Skill 命名空间同步补充时序
```mermaid
sequenceDiagram
    participant U as User
    participant C as OpenLogos CLI

    U->>C: Step 1: openlogos sync
    C->>C: Step 2: 读取 logos.config.json 与 logos-project.yaml
    C->>C: Step 3: 同步项目名与 lifecycle
    C->>C: Step 4: 补全 scenarios[].module
    C->>C: Step 5: 扫描并补录 resource_index
    C->>C: Step 6: 检查 verify 预跑配置
    C->>C: Step 7: 合并刷新 AGENTS.md、CLAUDE.md 托管片段
    C->>C: Step 8: 扫描项目专属 Skill 与插件资产
    C->>C: Step 9: 只刷新 OpenLogos 官方插件资产
    C-->>U: Step 10: 输出同步结果、兼容迁移结果与命名空间诊断
```

## 异常用例
### EX-2.1: 配置缺失
- **触发条件**：目录未初始化。
- **期望响应**：输出错误并退出。
- **副作用**：不写、不刷新 `logos/.openlogos-sync.json` 版本戳。

### EX-6.1: 缺少 verify 预跑配置且无法推断
- **触发条件**：旧项目没有任何 verify 预跑命令，且 CLI 无法从项目清单推断测试命令。
- **期望响应**：sync 不失败，但输出明确诊断和配置建议。
- **副作用**：不写入不可执行的默认命令。

### EX-7.1: AI 指令文件 marker 不完整
- **触发条件**：已有 `AGENTS.md` / `CLAUDE.md` 中只存在 `OPENLOGOS:BEGIN` 或只存在 `OPENLOGOS:END`。
- **期望响应**：sync 失败并提示修复指令文件托管片段边界。
- **副作用**：不得覆盖用户指令文件。

### EX-8.1: 历史 Codex `.agents/skills` 中混有项目专属 Skill
- **触发条件**：已初始化项目存在 `.agents/skills/prd-writer/SKILL.md` 和 `.agents/skills/release-guard/SKILL.md`，其中 `release-guard` 不是 OpenLogos 官方技能。
- **期望响应**：sync 可刷新或迁移 OpenLogos 官方技能；`release-guard` 被保留为项目资产，不进入 `openlogos` 插件命名空间；输出诊断提示用户可创建项目插件命名空间。
- **副作用**：不得删除、重命名或改写项目专属 Skill。

### EX-9.1: repo marketplace 中存在项目插件条目
- **触发条件**：`.agents/plugins/marketplace.json` 已包含 `openlogos` 之外的项目插件条目。
- **期望响应**：sync 只更新 `openlogos` 条目和 OpenLogos 托管文件；项目插件条目保持顺序和内容不变。
- **副作用**：不得把项目插件下的技能复制到 OpenLogos 插件。

### EX-9.2: Claude Code `.claude/skills` 中存在项目技能
- **触发条件**：已初始化项目存在 `.claude/skills/release-guard/SKILL.md`。
- **期望响应**：sync 刷新 OpenLogos 官方 Claude 插件与 `CLAUDE.md` managed block，但 `.claude/skills/release-guard/SKILL.md` 原样保留，并在说明中标记为项目专属技能。
- **副作用**：不得把 `release-guard` 复制到 OpenLogos 插件 `plugin/skills`。

### EX-11.1: 同步失败时不写版本戳
- **触发条件**：sync 因 `baseline_commit_in_progress`（模块基线提交进行中、锁被占用且无法恢复）非零退出，或因配置缺失（EX-2.1）提前退出。
- **期望响应**：正常输出既有错误信息；`logos/.openlogos-sync.json` 不被创建；已存在的版本戳文件内容保持原样（仍反映上一次成功 sync）。
- **副作用**：零写副作用——失败路径不得刷新 `cliVersion` / `syncedAt`。

## S08 ZCode 托管资产幂等同步时序

### 场景目标

在不改变用户 ZCode 配置和项目自有插件资产的前提下，`openlogos sync` 通过 Registry 幂等刷新 OpenLogos ZCode 插件、根指令和当前 lifecycle 变体，并且只在所有同步事务成功后刷新版本戳。

### 参与者

- **用户**：触发同步并查看保留/刷新结果。
- **OpenLogos CLI**：持有同步总事务和版本戳写入时机。
- **Adapter Registry**：从历史或当前配置解析 Adapter 集合。
- **ZCode Adapter**：计算当前模板与目标的差异。
- **Managed Asset Transaction**：原子写入托管资产并保护未知 owner。

### 前置条件

- 项目已有合法 `logos.config.json` 与 `logos-project.yaml`。
- baseline seed commit journal 已恢复或不存在。
- ZCode Adapter 可读取随包模板；既有项目可能含旧版 OpenLogos ZCode 资产或用户自有资产。

### 成功后置条件

- OpenLogos 拥有的 ZCode 资产与当前 CLI、locale 和 lifecycle 一致。
- 用户 `.zcode` 配置、非 OpenLogos 插件、托管 marker 外内容保持不变。
- `.openlogos-sync.json` 记录本次全部同步成功后的版本和时间。

### 时序图

```mermaid
sequenceDiagram
    actor U as 用户
    participant C as OpenLogos CLI
    participant R as Adapter Registry
    participant Z as ZCode Adapter
    participant T as Managed Asset Transaction
    participant V as Sync Version Stamp

    U->>C: Step 1: openlogos sync
    C->>C: Step 2: 取得模块读锁并恢复 seed journal
    C->>C: Step 3: 同步索引、verify 配置与 lifecycle 事实
    C->>R: Step 4: parse/expand(config.aiTool)
    R-->>C: Step 5: Adapter 列表
    C->>Z: Step 6: planAssets(current lifecycle)
    Z->>Z: Step 7: 区分 managed / user / legacy assets
    Z-->>T: Step 8: 差异计划与保留清单
    alt 所有 Adapter 事务成功
        T->>T: Step 9: 原子刷新并读回
        T-->>C: Step 10: updated/unchanged/preserved
        C->>V: Step 11: 写 cliVersion + syncedAt
        C-->>U: Step 12: 输出完整同步结果
    else ZCode 或其它 Adapter 失败
        T->>T: Step 9E: 回滚本事务
        T-->>C: Step 10E: blocked/error
        C-->>U: Step 11E: 非零退出；版本戳不变
    end
```

### 步骤说明

1. 用户在项目根执行 sync。
2. CLI 在读取资源前完成既有 seed journal 恢复门。
3. CLI 处理宿主无关同步工作，但尚不刷新最终版本戳。
4. 配置中的标量、数组、历史值或 all 统一交给 Registry。
5. Registry 返回去重且稳定的 Adapter 列表。
6. ZCode Adapter 根据 module lifecycle 选择 initial/launched 指令和插件资产。
7. Adapter 只把 manifest identity、managed marker 或已知哈希可证明的文件视为 OpenLogos owner；其余列入 preserved 或 blocked。
8. 事务计划包含精确目标、变更状态和冲突原因。
9. 全部预检通过后原子刷新，并确认 Hooks JSON、manifest 和 Markdown frontmatter 可解析。
10. 结果明确区分更新、未变化和用户保留项。
11. 只有全部 Adapter 都成功，CLI 才覆盖写同步版本戳。
12. 输出提醒 ZCode Hook 配置仅对新 session 生效。

### 异常与边界

#### EX-ZC-1：历史配置不含 zcode

- **触发条件**：旧项目 aiTool 为既有单值或数组。
- **期望响应**：按原配置同步，不擅自加入 ZCode；只有 `all` 使用新 Registry 展开后自动包含 ZCode。
- **副作用**：既有宿主行为保持兼容。

#### EX-ZC-2：用户修改 OpenLogos 托管文件

- **触发条件**：目标有 OpenLogos identity，但托管边界外出现用户文件。
- **期望响应**：只刷新声明资产；未知文件 preserved 并逐项报告。
- **副作用**：不得用目录镜像删除用户文件。

#### EX-ZC-3：同步中途失败

- **触发条件**：暂存、rename、权限或读回校验失败。
- **期望响应**：回滚该事务并使 sync 整体失败。
- **副作用**：原版本戳不变；不得打印“Sync complete”。

### 追溯

- 需求：S08 同步验收、ZCode 资产与协议要求。
- 架构：28.3 资产规划与原子部署、28.6 状态读取与缓存边界。
- 测试：UT-S08-15～UT-S08-20、ST-S08-16～ST-S08-18。

## S08 Qoder 托管资产幂等同步时序

### 场景目标

`openlogos sync` 经 Registry 幂等刷新 OpenLogos Qoder 插件、根指令和 lifecycle 变体，保留 Qoder 用户 settings、其它插件与未知文件，并在全部 Adapter 成功后才更新同步版本戳。

### 参与者

- **用户**：触发同步并查看刷新/保留结果。
- **OpenLogos CLI**：持有同步总事务与版本戳。
- **Adapter Registry**：解析历史/当前配置。
- **Qoder Adapter**：计算托管资产差异。
- **Managed Asset Transaction**：原子刷新或回滚。

### 前置条件

- 项目配置、资源索引与 lifecycle 可解析，seed journal 已恢复或不存在。
- 随包 Qoder 模板可读；目标可能混合旧托管资产和用户资产。

### 成功后置条件

- Qoder 托管资产与 CLI 版本、locale、lifecycle 一致。
- 用户 settings、其它插件、未知文件和 marker 外内容哈希不变。
- 同步版本戳只记录完整成功结果。

### 时序图

```mermaid
sequenceDiagram
    actor U as 用户
    participant C as OpenLogos CLI
    participant R as Adapter Registry
    participant Q as Qoder Adapter
    participant T as Managed Asset Transaction
    participant V as Sync Version Stamp
    U->>C: Step 1: openlogos sync
    C->>C: Step 2: 恢复 seed journal 并读取当前事实
    C->>R: Step 3: parse/expand(config.aiTool)
    R-->>C: Step 4: 稳定 Adapter 列表
    C->>Q: Step 5: planAssets(current lifecycle)
    Q-->>T: Step 6: managed 差异 + preserved 清单
    alt 全部 Adapter 成功
        T->>T: Step 7: 暂存、原子替换、读回
        T-->>C: Step 8: updated/unchanged/preserved
        C->>V: Step 9: 写版本与 syncedAt
        C-->>U: Step 10: 完整结果与新 session 提示
    else 任一失败
        T->>T: Step 7E: 回滚
        T-->>C: Step 8E: blocked/error
        C-->>U: Step 9E: 非零退出；版本戳不变
    end
```

### 步骤说明

1. 用户从项目根触发 sync。
2. CLI 在读取 effective view 前通过 seed journal 恢复门。
3. 配置标量、数组、历史值与 all 统一交给 Registry。
4. 历史配置未选 Qoder 时不擅自加入；all 新展开包含 Qoder。
5. Qoder Adapter 选择当前 initial/launched 模板。
6. 仅 manifest identity、managed marker 或已知哈希可证明的文件进入更新计划，未知目标 preserved/blocked。
7. 校验 manifest/hooks/frontmatter 后原子替换，失败恢复备份。
8. 结果明确区分托管更新、未变化和用户保留项。
9. 只有所有 Adapter 成功才写同步版本戳。
10. 成功提示创建新 Qoder CLI session 获取插件/Hook 快照。

### 异常与边界

#### EX-QD-S08-1：历史配置未选择 Qoder
- **触发条件**：aiTool 为既有单值/数组且无 qoder。
- **期望响应**：只同步原宿主；all 才按新 Registry 包含 Qoder。
- **副作用**：历史行为零漂移。

#### EX-QD-S08-2：托管目录混入用户文件
- **触发条件**：插件中存在未声明文件或不同 owner 组件。
- **期望响应**：用户文件 preserved，冲突目标 blocked，不做目录镜像删除。
- **副作用**：用户哈希不变。

#### EX-QD-S08-3：提交/读回失败
- **触发条件**：rename、权限、内容或读回校验失败。
- **期望响应**：回滚总事务并非零退出。
- **副作用**：版本戳保持旧值，不输出 Sync complete。

### 追溯

- 需求：S08 Qoder 同步验收。
- 架构：29.5 状态读取与路径安全、29.6 资产事务与提交顺序。
- 测试：UT-S08-21～UT-S08-26、ST-S08-19～ST-S08-21。

## S08 WorkBuddy 托管插件幂等同步时序

### 场景目标

`sync` 依据 Registry 刷新当前 lifecycle 的 WorkBuddy 托管资产，只在所有 Adapter 成功后更新同步版本戳。

### 前置与后置条件

- 前置：项目已初始化，配置可能为历史单值、数组或 `all`。
- 成功后置：托管资产收敛，用户 settings、插件、项目资产和原生记忆不变，版本戳最后更新。
- 失败后置：本次变更全部回滚，版本戳保持旧值。

### 主时序

```mermaid
sequenceDiagram
    actor U as 用户
    participant C as Sync Command
    participant R as Adapter Registry
    participant W as WorkBuddy Adapter
    participant T as Managed Asset Transaction
    participant V as Sync Version Stamp
    U->>C: openlogos sync
    C->>R: expand(config.aiTool)
    R-->>C: 稳定 Adapter 列表
    C->>W: planAssets(current lifecycle)
    W-->>T: managed 差异 + preserved 边界
    alt 全部 Adapter 成功
        T->>T: 暂存、原子替换、读回
        T-->>C: updated/unchanged/preserved
        C->>V: 最后写 version 与 syncedAt
        C-->>U: 完整结果与新 session 提示
    else 任一步失败
        T->>T: 回滚
        T-->>C: blocked/error
        C-->>U: 非零退出；版本戳不变
    end
```

### 步骤与不变量

1. 历史配置未选 WorkBuddy 时不得自动加入；只有 `all` 按新 Registry 稳定包含它。
2. Adapter 仅更新 identity、managed marker 或已知清单可证明属于 OpenLogos 的资产；未知文件 preserved 或冲突 blocked。
3. 原生记忆不进入扫描内容、差异或备份，只比较不透明边界证据以确认未被触碰。
4. 任一 Adapter 暂存、替换或读回失败，恢复本次事务全部备份。
5. 全部成功后才写 `.openlogos-sync.json`；重复同步输出 `unchanged` 并保持内容哈希稳定。

### 异常

- `EX-WB-S08-1`：历史配置无 WorkBuddy 时只同步原宿主。
- `EX-WB-S08-2`：托管目录混入用户文件时禁止目录镜像删除。
- `EX-WB-S08-3`：rename、权限或读回失败时回滚且版本戳不变。

### 追溯

- 需求：S08 WorkBuddy 同步验收。
- 架构：30.2 资产模型、30.4 生命周期与事务顺序。
- 测试：UT-S08-27～UT-S08-32、ST-S08-22～ST-S08-24。

## TRAE non-deployable 同步负向时序

### 目标

S08 不因客户端发现或工作区已有 `.trae/**` 自动增加 TRAE Adapter。`all` 只同步既有七宿主；手工配置中的 `trae` 必须在总事务开始前失败，且不刷新同步版本戳。

### `all` 同步时序

```mermaid
sequenceDiagram
    actor U as 用户
    participant C as SyncCommand
    participant R as AiToolAdapterRegistry
    participant P as ManagedAssetTransaction
    participant S as SyncVersionStamp
    U->>C: sync（配置为 all）
    C->>R: resolve(all)
    R-->>C: 七个 deployable Adapter（无 trae）
    C->>P: 规划、预检、提交七宿主资产
    P-->>C: 全部成功并读回
    C->>S: 最后提交版本戳
    C-->>U: Sync complete；TRAE 用户资产未触达
```

### 非法配置失败时序

```mermaid
sequenceDiagram
    actor U as 用户
    participant C as SyncCommand
    participant R as AiToolAdapterRegistry
    participant P as ManagedAssetTransaction
    participant S as SyncVersionStamp
    U->>C: sync（配置含 trae）
    C->>R: resolve(configured tools)
    R-->>C: UnsupportedAiTool(trae)
    C-->>U: fail loud；不输出 Sync complete
    Note over C,P: 不开始暂存、替换或回滚事务
    Note over C,S: 版本戳保持旧值
```

### 不变量

- `.trae/` Rules、Skills、Agents、Hooks、MCP、settings、账号、记忆和未知文件不进入扫描、计划、暂存、备份、删除或回滚集合。
- 不因探测到 TRAE 国际版/CN 安装或登录状态而改变 Registry。
- 既有七宿主的目标顺序、内容哈希、结果分类、原子提交和版本戳语义保持不变。
