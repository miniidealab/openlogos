
# S20: 已有项目接入 OpenLogos — 时序图

```mermaid
sequenceDiagram
    participant U as User
    participant C as OpenLogos CLI
    participant N as status/next
    participant W as change-writer

    U->>C: Step 1: openlogos adopt
    C->>C: Step 2: 检查 logos/logos.config.json 是否已存在
    C->>C: Step 3: 读取已有项目信息（package.json / Cargo.toml / pyproject.toml / 目录名）
    C->>U: Step 4: 交互确认项目名、locale、aiTool
    C->>C: Step 5: 推断测试命令与 verify 预跑配置
    C->>C: Step 6: 推断或补齐推荐 sandbox 配置
    C->>C: Step 7: 创建 logos/ 标准目录结构与 Reference 子目录
    C->>C: Step 8: 写入配置与索引（bootstrap: adopted, lifecycle: launched，可含兼容 baseline_seed_state: required）
    C->>C: Step 9: 合并 AI 指令托管片段并部署 AI tools 与 logos/spec/
    C-->>U: Step 10: 接入完成；主提示为 openlogos change <slug>，baseline-seed 仅显式可选
    U->>N: Step 11: openlogos next（无提案）
    N-->>U: Step 12: required/安全 partial/seeded 均返回 change 主动作
    U->>C: Step 13: openlogos change <slug>
    C->>W: Step 14: 在 proposal/tasks 按触达场景建立 S39 闭包
```

> **交接说明**：`adopt` 只做确定性初始化，CLI 本身不启动 AI、不产逆向内容、不声称规格基线已建立。可继续写 `baseline_seed_state: required` 以兼容旧消费者，但 driver 不得因该状态自动派发 `brownfield-adopter`。默认交接对象是首个 change；只有用户或宿主显式选择 eager seed 时才进入 S33。

## 步骤说明
1. **用户**执行 `openlogos adopt`。
2. **CLI** 校验 `logos/logos.config.json` 是否已存在，若已存在则报错退出。
3. **CLI** 扫描当前目录，按优先级读取 `package.json` → `Cargo.toml` → `pyproject.toml` → 目录名，提取项目名称。
4. **CLI** 交互式确认项目名、locale 与 aiTool（有默认值，可直接回车确认）。
5. **CLI** 推断测试命令。Node 项目优先读取 `package.json` 的 `test` 脚本；Python / Go / Rust 项目按常见命令推断。无法推断时记录 TODO。
6. **CLI** 推断或补齐推荐的 `verify.sandbox_mode=auto`、`verify.sandbox_root` 和 `verify.sandbox_deny_workspace_write=true`，但不得覆盖用户已有沙箱配置。
7. **CLI** 创建 `logos/` 标准目录结构（与 `init` 相同）；其中 `logos/resources/reference/` 下必须同时创建 `requirement/`、`todolist/`、`code/`、`image/`、`temp/`、`note/` 子目录，并写入 `.gitkeep`。
8. **CLI** 写入 `logos.config.json` 与 `logos-project.yaml`；`logos.config.json` 包含 `verify.result_path`，并在可推断时包含 verify 预跑命令与推荐沙箱配置；`logos-project.yaml` 中模块 `bootstrap` 为 `adopted`、`lifecycle` 为 `launched`，可保留兼容枚举 `baseline_seed_state: required`。该枚举不是 change gate。
9. **CLI** 写入根目录 AI 指令文件时复用 `init` 的 managed block 合并策略：已有用户内容必须保留；OpenLogos 内容写入或刷新在托管片段内；同时部署 AI 工具资产与 `logos/spec/`。
10. **CLI** 输出接入报告，说明 verify/sandbox 配置结果，并把主提示写成「现在可直接运行 `openlogos change <slug>`；提案将按触达场景补齐规格」。可附显式 `baseline-seed` 预扫选项，但不得把它写成下一步前置。
11. **next/status 读取门**在访问资源、索引或覆盖率前，先在同一模块锁内恢复未终结 seed commit journal。无法恢复时返回 `baseline_commit_in_progress`，不得读取半新集合；安全 open run / staging 则排除后继续。
12. 无未终结 journal 时，`required`、安全 `partial`、`seeded` 均不得改写 next 的 change 主动作；状态只作旁路信息。
13. 用户直接创建首个提案，不需要先运行 S33。
14. change-writer 按 S39 写规范化闭包清单与唯一 delta tasks；缺失目标全量 CREATE，已有目标 MODIFY。

## 异常用例
### EX-2.1: 项目已初始化
- **触发条件**：`logos/logos.config.json` 已存在。
- **期望响应**：输出错误并退出，提示该项目已初始化，不覆盖已有文件。
- **副作用**：无文件被修改。

### EX-5.1: 无法推断测试命令
- **触发条件**：已有项目没有可识别测试脚本或测试框架。
- **期望响应**：adopt 成功，但接入报告显示 TODO，提示用户配置 `verify.pre_run_command` 或 `verify.regression_command`，并说明 sandbox 配置仍可按默认推荐值写入。
- **副作用**：不写入虚假的测试命令。

### EX-9.1: AI 指令文件 marker 不完整
- **触发条件**：已有项目的 `AGENTS.md` / `CLAUDE.md` 中只存在 `OPENLOGOS:BEGIN` 或只存在 `OPENLOGOS:END`。
- **期望响应**：adopt 失败并提示用户修复指令文件托管片段边界。
- **副作用**：不得覆盖用户既有 AI 指令文件。

### EX-10.1: adopt 不越权逆向扫描
- **触发条件**：adopt 完成初始化。
- **期望响应**：adopt 不启动 AI、不产任何逆向基线内容、不声称基线已建立；默认提示创建 change。AI 能力缺失不影响 change；显式 seed 才派发 `brownfield-adopter`（见 S33）。
- **副作用**：可保留 `baseline_seed_state: required` 兼容值，但不得据此自动派发或阻断。

### EX-11.1: 安全 partial 与未终结 journal 必须分流
- **触发条件**：adopted 模块存在 seed run。
- **期望响应**：仅 open run / 未提交 staging 时排除 staging，next 仍指向 change并附非阻断重试信息；journal=`prepared|committing` 时先恢复，恢复失败返回 `baseline_commit_in_progress`，不得继续读取 resources/index 或输出 change 建议。
- **副作用**：不把半新资源当权威，不把安全 staging 升格为硬门。

### EX-11.2: 不得把自动 skip 当永久技术结论
- **触发条件**：adopt 自动写入 `skip_phases`，首个 change 实际出现 API/持久化边界。
- **期望响应**：S39 必须规划 API/DB/编排或以 AMBIGUOUS 阻断，不能因接入元数据静默 SKIP。
- **副作用**：Initial 阶段豁免保持，launched change 的适用性单独判定。

## S20 存量项目选择 ZCode 的安全接入时序

### 场景目标

存量项目执行 adopt 时可选择 `zcode`，在保留已有根 `AGENTS.md`、`.zcode` 配置与非 OpenLogos 插件的前提下，以同 init 等级的原子事务部署 Registry、ZCode 插件和 guard 基础设施，并保持“接入后可直接 change”的主路径。

### 参与者

- **用户**：确认项目元数据、locale 与 ZCode 宿主。
- **Adopt Command**：扫描存量项目、编排接入事务和输出交接。
- **Adapter Registry**：解析 `zcode`/`all` 并提供资产能力。
- **ZCode Adapter**：规划插件、指令、AGENTS 与 Hooks 资产。
- **Managed Asset Transaction**：保护存量 owner、原子提交或回滚。

### 前置条件

- 当前目录尚无 `logos/logos.config.json`。
- 存量项目可以包含用户 `AGENTS.md`、`.zcode/config.json`、`.zcode` 其它内容或已安装插件。
- 随包 ZCode 模板和共享 Hook runtime 均可读取。

### 成功后置条件

- 配置持久化 `aiTool: zcode`，模块为 `bootstrap: adopted`、`lifecycle: launched`。
- OpenLogos ZCode 资产完整可发现，存量用户资产逐项 preserved。
- 接入报告仍以 `openlogos change <slug>` 为下一主动作，不增加 ZCode 特有前置门。

### 时序图

```mermaid
sequenceDiagram
    actor U as 用户
    participant A as Adopt Command
    participant R as Adapter Registry
    participant Z as ZCode Adapter
    participant T as Managed Asset Transaction

    U->>A: Step 1: adopt
    A->>A: Step 2: 扫描项目并确认未初始化
    A->>U: Step 3: 询问项目、locale、aiTool
    U-->>A: Step 4: 选择 zcode
    A->>R: Step 5: resolve(zcode)
    R-->>A: Step 6: ZCode capability manifest
    A->>Z: Step 7: planAssets(adopted + launched)
    Z->>T: Step 8: 目标、owner 与保留计划
    T->>T: Step 9: 全量预检配置、marker、路径和冲突
    alt 预检及提交成功
        T->>T: Step 10: 原子写入 logos 与托管资产
        T-->>A: Step 11: installed/preserved
        A-->>U: Step 12: 接入报告与 change 主提示
    else 冲突或任一写入失败
        T->>T: Step 10E: 回滚整个接入事务
        T-->>A: Step 11E: blocked/error
        A-->>U: Step 12E: 非零退出和恢复建议
    end
```

### 步骤说明

1. 用户在存量项目根执行 adopt。
2. CLI 读取项目事实并拒绝覆盖已初始化项目。
3. 交互选项由 Registry 枚举，ZCode 与既有宿主并列；非交互参数同样接受 `zcode`。
4. 用户选择被规范化为稳定 id，不用自由文本触发宿主分支。
5. Adopt Command 向 Registry 解析单宿主或 `all`。
6. capability manifest 声明 ZCode 支持 init/sync/launch/adopt、AGENTS、插件与 Hooks。
7. adopted 模块直接选 launched 资产变体，不先部署 initial 再覆盖。
8. 计划区分 OpenLogos 托管目标、已存在用户目标和不可安全合并的冲突。
9. 根 AGENTS 必须能安全插入完整 marker 对；现有 `.zcode/config.json` 和非 OpenLogos 插件只读不覆盖。
10. logos 结构、配置、索引、spec 与 Adapter 资产作为一个接入提交单元处理。
11. 成功结果列出 installed、unchanged、preserved；不得把 preserved 误报为 installed。
12. 交接明确 ZCode 需新 session 装载插件，同时保留可直接创建 change 的路径。

### 异常与边界

#### EX-ZC-1：AGENTS marker 不完整

- **触发条件**：根 AGENTS 只有 BEGIN 或 END marker。
- **期望响应**：在任何写入前阻断，给出人工修复路径。
- **副作用**：不得创建半套 logos 或 ZCode 资产。

#### EX-ZC-2：ZCode 目标存在不同 owner

- **触发条件**：OpenLogos 插件 identity 或目标文件名已被非 OpenLogos 资产占用。
- **期望响应**：默认阻断，不覆盖、不改名规避、不删除。
- **副作用**：完整回滚接入事务，用户资产保持字节不变。

#### EX-ZC-3：存量 `.zcode/config.json`

- **触发条件**：项目已有 ZCode 配置，包含用户模型、权限或其它插件配置。
- **期望响应**：不把项目级配置当 Hook 安装点，不改写用户设置；OpenLogos Hooks 随插件交付。
- **副作用**：配置保留结果进入接入报告。

#### EX-ZC-4：接入后首个 change

- **触发条件**：adopt 成功后执行 status/next/change。
- **期望响应**：与其它宿主相同，直接进入 S39 规格闭包；不得要求先运行 ZCode 专用 seed。
- **副作用**：ZCode 只是宿主能力，不改变 OpenLogos 方法论前沿。

### 追溯

- 需求：S20 ZCode 存量接入、保护与后续 change 可达性。
- 架构：28.2 Adapter Registry、28.3 资产事务、28.5 打包边界。
- 测试：UT-S20-20～UT-S20-26、ST-S20-14～ST-S20-16。
