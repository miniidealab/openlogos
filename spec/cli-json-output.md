# CLI JSON 结构化输出规格

> 版本: 1.0.0 | 创建日期: 2026-04-13

## 1. 概述

OpenLogos CLI 的 `status`、`next`、`verify`、`smoke`、`detect`、`deploy-done`、`flow show`、`watch` 等命令支持 `--format json` 参数，输出结构化 JSON 供外部工具（如 RunLogos）以编程方式消费。

> `openlogos watch` 的 `--format json` 输出**每条一行的 JSON 流**（多条 envelope，逐行换行分隔），而非单条；其余命令仍为单条 envelope。详见「`openlogos watch --format json`」一节。

### 1.1 通用约定

- **触发方式**：在命令后追加 `--format json`
- **输出目标**：JSON 输出到 **stdout**；错误信息仍输出到 **stderr**
- **JSON 格式**：紧凑单行输出（无缩进），方便管道处理
- **退出码**：与人类可读模式保持一致
- **编码**：UTF-8
- **字段命名**：snake_case

### 1.2 通用信封结构

所有命令的 JSON 输出共享同一信封结构（`watch` 为该信封的流式多条输出）：

```jsonc
{
  "command": "<command-name>",   // "status" | "next" | "verify" | "smoke" | "detect" | "deploy-done" | "module list" | "flow show" | "watch"
  "version": "<cli-version>",
  "timestamp": "<ISO-8601>",
  "data": { ... }
}
```

**`contract` 契约版本握手（contract-self-description）**：`status` / `next` 的 `data` 顶层新增 `"contract": {"version": "1.0.0"}`（语义化契约版本，独立于 CLI 版本演进；信封顶层 `version` 仍为 CLI 版本串，两者互不替代、不得混用）。

- **初始 `contract.version = "1.0.0"`**：本次交付的契约形态即 1.0.0；此前无 `contract` 字段的历史输出视为「0.x 前契约时代」，消费方按缺字段保守分支处理。
- **SemVer 规则**：**major** = 必填字段删除/改义、闭合枚举语义变化（含移除值）、既有字段挂出判据变更；**minor** = 向后兼容扩展（新增可选字段、闭合枚举新增值）；**patch** = 不改形态与语义的澄清。
- **版本-schema 一一映射**：`spec/schema/status.schema.json`、`spec/schema/next.schema.json`（内嵌契约版本号，随 npm prepack 打包）；响应 `contract.version` 与打包 schema 版本一致，CI 校验。详见「JSON Schema 发布与契约版本（contract-self-description）」一节。
- **消费方约定（规范性引用，验收归 runlogos R5）**：未知 major / 缺 `contract` 字段 → 保守模式（仅 next 驱动普通推进 + 看门狗，启发式判定降级为仅观察）；契约内任何枚举遇未知值 → 保守分支。本条为规范性引用：生产者侧（本仓）不验收消费方行为，见「JSON Schema 发布与契约版本（contract-self-description）」的验收边界。

**主动破例声明（golden 全量重拍）**：新增 `data` 顶层 `contract` 对象破坏既有「data 顶层逐字节不变（golden 零漂移）」不变量——**全部 9 个 golden 基线快照**（`cli/test/golden-baseline.test.ts`）重拍。这是本提案唯一的全量 golden 重拍点，破坏性集中在此，随大版本发布。

### 1.3 JSON Schema 发布与契约版本（contract-self-description）

status / next 机器契约随包发布 JSON Schema，并以 CI 把「契约自描述」变成可证伪判据。

**Schema 发布**：

- CLI 仓发布 status/next 的 JSON Schema：`spec/schema/status.schema.json`、`spec/schema/next.schema.json`（内嵌契约版本号，随 `contract.version` 演进，见 §1.2 版本-schema 一一映射）。
- schema 文件随 npm `prepack` 打包进发布产物，附**包内容验证测试**：打包产物必须包含两份 schema 文件，且其内嵌版本号与响应 `contract.version` 一致。

**版本一致性 CI 校验**：

- 响应 `contract.version` 与打包 schema 版本一一对应（§1.2 映射规则的 CI 落点）；不一致 → CI 失败。
- 每个注册步骤/节点必须通过 schema 校验（含 `step_meta` / `dispatch` 必填；overlay-add 未声明 `dispatch` 走保守默认后同样过校验——节点 schema 校验按完整对象通过）。

**生产者一致性漂移注入测试（反面锚）**：

- 在 CLI 注册全新步骤（如 `x-future-step`, `phase=pre-implement`）→ 断言：
  - (a) 注册表 / step_meta / schema 三方同步、schema 校验通过；
  - (b) **该 pre-implement 步骤下 `loop_state` 不输出**（§3.9 激活判据的反面锚——`pre-implement + loop_state` 是非法组合，生产者测试断言其不存在，而非将其固化为合法夹具）。

**验收边界（消灭跨仓越权）**：

- openlogos 本提案只验**生产者契约**：注册表/step_meta/schema 三方同步；`pre-implement 步骤不输出 loop_state` 的反面锚（漂移注入 x-future-step 生产者一致性测试）；contract.version 与打包 schema 一致；dispatch/facts 字段来源正确；包内 schema 完整。
- 消费方保守模式 / 零误杀 / suspect 可逆态验收归 runlogos R5 提案（用本提案发布的新生产者夹具喂旧/现役消费者做韧性测试）；双向契约测试是跨仓总方案完成定义，不是本仓单仓的完成判据。

### 1.4 modules[].features feature 分组契约（add-feature-model）

status / next 的 `data.modules[]` 新增**可选字段 `features`**，承载 module → feature → scenario 三层模型的 feature 分组。按 §1.2 SemVer 规则，新增可选字段属 **minor**（`1.0.0` → `1.1.0`）。

> **版本策略：条件版本（范围锚所有者裁定 = B，回应 delta-F1）**：为**真正满足"feature 全缺失时逐字节一致"验收**（含 `contract.version` 字段），采用**条件版本发射**——`data.contract.version` = **`1.1.0` 当且仅当**本次响应至少含一个 `modules[].features` 字段；否则**保持 `1.0.0`**。
> - **纯 pre-feature 项目**（响应无任何 `features`）→ `contract.version` 仍为 `1.0.0`，输出**逐字节完全不变**（含版本字段），真正零漂移、无 golden 重拍。
> - **带 feature 的响应**（≥1 module 输出 `features`）→ `contract.version` = `1.1.0`。
> - **两版契约各自自洽**：`features` 出现 ⟺ `contract.version==1.1.0`；`1.0.0` 响应**永不含** `features`。这不构成"同版本两形态"——1.0.0 与 1.1.0 是两个自洽契约，响应按 contract-self-description 声明各自实际满足的版本。
> - **schema 与 CI**：两版契约同时打包并存（见下"schema 版本并存"）；一一映射 CI 校验调整为：**响应 `contract.version` ∈ schema 支持的版本集**，且 **`features` present ⟹ version `1.1.0`**、**version `1.0.0` ⟹ 无 `features`**。npm prepack 包内容验证覆盖两版。

#### 字段形态

```json
"modules": [
  {
    "id": "core",
    "features": [
      {
        "id": "F01",
        "name": "项目生命周期与初始化",
        "spec": "core-01",
        "scenarios": [
          { "id": "S01", "name": "初始化 OpenLogos 项目" },
          { "id": "S14", "name": "切换到 launched 生命周期" }
        ]
      },
      {
        "id": "__ungrouped__",
        "name": "未分组",
        "spec": null,
        "scenarios": [ { "id": "S30", "name": "cmd: 放开到 verify/deploy/smoke gate" } ]
      }
    ]
  }
]
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `modules[].features` | array \| 省略 | 否 | **省略当且仅当**该 module 既无注册 feature（`features[]` 中 `module==本 module`）**且**其下无任何场景带 `feature` 键。**当响应所有 module 都省略 `features`（纯 pre-feature 项目）→ `contract.version` 保持 `1.0.0`、输出逐字节完全不变**；任一 module 输出 `features` → 响应 `contract.version=1.1.0`。否则**输出**（见下"输出条件与降级桶"，回应 delta-F10） |
| `features[].id` | string | 是 | 合法 `F0X`（`^F(?:0[1-9]\|[1-9]\d+)$`，项目全局唯一，禁 `F00`/前导零如 `F001`）**或**固定保留伪 feature `"__ungrouped__"` |
| `features[].name` | string | 是 | feature 名称；未分组桶为「未分组」 |
| `features[].spec` | string \| null | 是 | feature-specs 文档序号（如 `core-01`），无链接时为 `null`（键恒在场） |
| `features[].scenarios` | array | 是 | **稳定场景成员列表**，元素 `{id,name}`；空成员为 `[]` |

#### 语义约束

- **coverage 基准**：`features[].scenarios` 是**稳定成员列表（与 phase / module 生命周期无关）**，在 initial / launched / 独立 `feature list` 三种上下文取值一致；**不复用**依附具体 phase/node 计算的 `scenario_coverage`。phase 维度覆盖率仍只由 `modules[].phase_progress[].scenario_coverage` 承载，不下放 feature 层。
- **输出条件与降级桶（回应 delta-F10）**：status/next 的 `modules[].features` **省略当且仅当**该 module 既无注册 feature、**且**其下无任何场景带 `feature` 键（纯 pre-feature module）。**只要**该 module 有 ≥1 个注册 feature，**或**有 ≥1 个场景带 `feature` 键（含未知/跨 module 的悬空引用），就**必须输出** `features`——因此显式写了未知/跨 module 引用的场景**一定能**出现在末位 `__ungrouped__` 桶，绝不因"无注册 feature"被省略而丢失降级桶。当响应任一 module 输出 `features` 时该响应 `contract.version=1.1.0`；全响应无 `features` 时保持 `1.0.0`（条件版本，见上）。
- **schema 版本并存（条件版本，回应 delta-F1）**：`status.schema.json` / `next.schema.json` 的 `contract.version` 由 `const "1.0.0"` 放宽为 `enum ["1.0.0","1.1.0"]`，并加条件约束 `features` present ⟹ `contract.version=="1.1.0"`、`contract.version=="1.0.0"` ⟹ module 无 `features`。`x-contract-version` 标为向后兼容 superset 的最高版本 `1.1.0`，`$comment` 说明本 schema 同时校验 1.0.0 与 1.1.0 响应；一一映射 CI 校验相应调整为"响应 version ∈ schema 支持集 + features⟹1.1.0"。
- **空成员 feature 展示规则（回应 delta-F4）**：合法模型允许先登记 F01、再逐步归属。**输出时**始终列出该 module 下全部注册 feature（空成员 `scenarios:[]`，不过滤）；末位 `__ungrouped__` 仅当该 module 有 ≥1 个未归属/降级场景时出现。
- **"未分组"= 固定保留伪 feature**：机器值 `id:"__ungrouped__"`（双下划线包裹，不匹配 `^F(?:0[1-9]|[1-9]\d+)$` 合法 ID，防冲突），恒排 `features[]` **末位**。
- **feature item 形态由 schema 锁定（回应 delta-F8）**：`status.schema.json` / `next.schema.json` 的 `$defs/feature` 将 `id`/`name`/`spec`/`scenarios` 全部列为 `required`（`spec` 类型 `["string","null"]`，无链接为 `null` 但键在场），`id` 用 `anyOf(pattern "^F(?:0[1-9]|[1-9]\\d+)$"`（**规范编号**：`F01`…`F09`/`F10`…`F99`/`F100`+，拒 `F00`/`F0`/`F001` 等前导零非规范编号）`, const "__ungrouped__")`，杜绝非法 id / 缺 spec 通过校验。
- **稳定排序**：合法 feature 按 `features[]` YAML 声明顺序；其名下 `scenarios` 按 `scenarios[]` YAML 顺序。
- **归属降级**：`scenario.feature` 缺失 / 指向未知 feature / 指向跨 module 的 feature —— 三态一律入所属 module 的"未分组"桶（不报错、不阻断），且据上"输出条件"，即使 module 无注册 feature 也会因存在 `feature` 键而输出该桶。
- **next 透传**：`next` 的 `modules[].features` 与 status 输出的 feature 集合一致（同一派生），`next` 不在 feature 层改变"下一步"选择逻辑；文本与 JSON 同构。

#### feature list / feature-backfill 命令契约

- **`openlogos feature list [--module <id>] [--format json]`**（只读，专用分组视图，回应 delta-F10）：
  - 成功 → `makeEnvelope("feature list", data)`，`data.modules[].features[]` 的 item 形态与上文同构。**feature list 作为专用分组视图无 legacy golden、不受零漂移约束**：对每个 module 列出全部注册 feature（空成员 `scenarios:[]`）+ 末位 `__ungrouped__`（当且仅当该 module 有 ≥1 个未归属/降级场景）。因此 module 有场景但无注册 feature 时返回 `features:[{"id":"__ungrouped__",...}]`（**非** `[]`）。
  - `features: []` **仅**用于**真正空 module**——既无注册 feature、也无任何场景成员。
  - 与 status/next 关系：三命令对**已输出**的 feature 集合一致；差异仅在 status/next 为保零漂移，对纯 pre-feature 项目省略 `features` 字段，而 feature list 始终展示分组（含 `__ungrouped__`）。
  - `--module <id>` 未注册 → 通用错误 envelope（§6），错误码 **`MODULE_NOT_FOUND`**，输出 stderr、非零退出码。
- **`openlogos feature-backfill [--module <id>] [--format json]`**（生成 prompt，不改 yaml）：
  - 文本模式打印 prompt 路径与引导语；`--format json` 返回 `{ prompt_path, scenarios_total, ungrouped_total, features_existing }`。
  - 幂等：重复运行覆盖同一 `logos/feature-backfill-prompt.md`，退出码 0。


### 1.5 feature-backfill 纳入逆向候选契约（feature-backfill-brownfield）

扩展 §1.4 的 `feature-backfill` 命令契约，接回 S33 逆向**场景**候选（S34 能力增量，向后兼容 = 响应新增字段）。

- **读侧扩展（只筛 scenario-candidates，回应 F1）**：`feature-backfill` 生成 prompt 时,除 `scenarios[]` 外**只纳入逆向场景候选**——因候选无 `kind` 字段,权威筛选 = 读**已提交 run manifest** 的 `kind==scenario-candidates → target_path`,只取这些文档 `## 逆向基线来源` 的 `candidates[]`,筛选谓词**固定 `state=="active" && verified==false`**（`verified:true` 已人工确认候选**排除**、不计数);纳入项全部 `verified:false`,prompt 中如实标注"逆向候选 / verified:false / 未进 scenarios[]"。system-map 候选**不纳入**。
- **提交恢复读锁（回应 F2）**：候选筛选/计数/prompt 构造在 `withRecoveredReadLocks` 同一临界区内完成;无法取锁/恢复 → 走通用错误 envelope（§6),错误码 **`BASELINE_COMMIT_IN_PROGRESS`**、输出 stderr、非零退出、**不写/不覆盖** prompt。
- **输出字段(必填,回应 F4)**：`feature-backfill --format json` 成功响应的 `data` **必含** `baseline_candidates_total`（integer,`minimum: 0`,键恒在场):**最终写入 prompt 的场景候选数**（`kind + module + state + verified + 去重` 全部过滤后)。完整成功形态:
  ```json
  { "prompt_path": "logos/feature-backfill-prompt.md", "scenarios_total": 0, "ungrouped_total": 0, "features_existing": 0, "baseline_candidates_total": 4 }
  ```
  零候选时 `baseline_candidates_total: 0`（**键仍在场**,区分"零候选"与"旧实现无键")。
- **`--module` 口径(回应 F5)**：传 `--module` 只纳入该 module 候选、未注册 → 错误码 `MODULE_NOT_FOUND`(与 `feature list` 一致);无 `--module` 按 `modules[]` 顺序聚合全项目;`baseline_candidates_total` 恒等于过滤后最终纳入数。
- **降级(回应 F6，唯一行为)**：索引 stale → 锁内从权威文档重算(成功、照常纳入);**权威章节解析失败 → 走通用错误 envelope、错误码 `BASELINE_PROVENANCE_INVALID`、非零退出、不写/不覆盖 prompt**（不以 `baseline_candidates_total=0` 冒充非存量零候选、不走 warning 成功)。
- **红线**：本命令仍**只生成 prompt、不改 `logos-project.yaml`、不改 `## 逆向基线来源` 章节、不触发覆盖率副作用**;逆向候选进 `scenarios[]`（含 scenario 取号/计数器推进）与 feature 分配由 AI 按 prompt 回写,且**不改动 provenance `verified`**（导航 ≠ 可信度）。
- **status/next 契约不变**：status/next 仍只读 `scenarios[]`、不吞逆向候选;条件版本（§1.4）不变。

### 1.5.1 feature-backfill 错误 envelope 富化：触发文件路径 + 分类（provenance-scan-canonical-recompute）

扩展 §1.5：`feature-backfill` 报 `BASELINE_PROVENANCE_INVALID` 时，通用错误 envelope（§6）的 `error` 对象**新增两字段**（向后兼容 = 新增字段；错误码语义、非零退出、「不写/不覆盖 prompt」红线均不变）：

- **`paths`**（`string[]`，键恒在场，可为空数组）：本次判定为 provenance 迹象、导致失败的文件**相对项目根路径**清单，确定性排序（按路径升序）。
- **`reason`**（`string` 闭合枚举）：失败原因分类——
  - `unparseable`：权威/约定目标 `## 逆向基线来源` 坏 fenced YAML（解析失败）；
  - `unclassifiable-evidence`：有 provenance / `baseline_index` 迹象，但无 committed run manifest 且无约定命名文件（`<module>-scenario-candidates.md`），不可定类。

错误形态示例：

```json
{
  "error": {
    "code": "BASELINE_PROVENANCE_INVALID",
    "message": "reverse baseline provenance section invalid/unparseable for module(s): core. reason=unparseable; paths=[logos/resources/reference/x.md]",
    "paths": ["logos/resources/reference/x.md"],
    "reason": "unparseable"
  }
}
```

- **与扫描侧 canonical 采信（core-06 §一.A / feature-specs §2.27.10）配合**：格式合法但 hash 失配的编造/示例 key 在候选采信阶段即被排除、**不再进入本错误路径**（此前会误报）。进入本路径者必为真实坏结构或真不可定类，`paths` 直指问题文件。
- **消费方约定**：`reason` 遇未知值 → 保守分支（当作一般 provenance 失败处理）；`paths` 缺失 → 视为空清单（旧实现无该字段）。
---

## 2. `openlogos detect --format json`

探测 CLI 版本和当前目录的项目信息。合并了 `--version` 的功能并扩展了项目探测能力。

### 2.1 用法

```bash
openlogos detect                # 人类可读格式
openlogos detect --format json  # JSON 格式
```

### 2.2 JSON Schema（data 部分）

```jsonc
{
  "cli": {
    "version": "0.5.9",           // CLI 版本号
    "node_version": "v22.0.0"     // Node.js 运行时版本
  },
  "project": null | {             // null 表示当前目录不是 OpenLogos 项目
    "name": "my-project",         // 项目名
    "locale": "zh",               // 语言设置
    "lifecycle": "launched",        // "initial" | "launched"
    "modules": [
      {
        "id": "core",
        "name": "核心功能",
        "lifecycle": "launched"
      }
    ],
    "description": "项目描述",     // 项目描述
    "source_roots": null | {      // 源代码根目录，null 表示未配置
      "src": ["src"],             // 业务代码根目录列表
      "test": ["test"]            // 测试代码根目录列表
    }
  },
  "yaml_diagnostics": null | {
    "parse_status": "recovered",
    "messages": ["logos-project.yaml 存在可恢复的解析错误"]
  }
}
```

### 2.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `cli.version` | string | 是 | CLI 包版本号 |
| `cli.node_version` | string | 是 | 当前 Node.js 版本（`process.version`）|
| `project` | object \| null | 是 | 若当前目录含 `logos/logos.config.json` 则返回项目信息，否则 null |
| `project.name` | string | 是 | 项目名（来自 config） |
| `project.locale` | string | 是 | 项目语言设置 |
| `project.lifecycle` | string | 是 | 项目生命周期阶段；由 `project.modules` 派生，任一模块为 `launched` 时项目也必须为 `launched` |
| `project.modules` | array | 否 | 模块注册表；存在 `logos-project.yaml` 的 `modules[]` 时返回。即使 YAML 存在可恢复解析错误，也不得省略此字段 |
| `project.modules[].id` | string | 是 | 模块标识符 |
| `project.modules[].name` | string | 是 | 模块名称 |
| `project.modules[].lifecycle` | string | 是 | 模块生命周期：`"initial"` 或 `"launched"` |
| `project.description` | string | 是 | 项目描述 |
| `project.source_roots` | object \| null | 是 | 源代码根目录配置；未配置时为 null |
| `project.source_roots.src` | string[] | 是 | 业务代码根目录列表 |
| `project.source_roots.test` | string[] | 是 | 测试代码根目录列表 |
| `yaml_diagnostics` | object \| null | 否 | `logos-project.yaml` 的解析诊断；存在可恢复/不可恢复错误时返回 |
| `yaml_diagnostics.parse_status` | string | 是 | `"recovered"` 或 `"error"`；`recovered` 表示已从 AST 恢复可用的 `modules` 等数据 |
| `yaml_diagnostics.messages` | string[] | 是 | 诊断消息摘要 |

### 2.4 解析语义

- 当 `yaml_diagnostics.parse_status = "recovered"` 时，`project.modules` 必须保留，`project.lifecycle` 必须按恢复后的模块状态派生。
- 当 `yaml_diagnostics.parse_status = "error"` 时，CLI 必须返回明确诊断消息，不得静默伪装成正常的 `initial` 项目。

---

## 3. `openlogos status --format json`

### 3.1 用法

```bash
openlogos status                # 人类可读格式
openlogos status --format json  # JSON 格式
```

### 3.2 JSON Schema（data 部分）

```jsonc
{
  "phases": [
    {
      "key": "phase.1",
      "label": "Phase 1 · 需求文档 (WHY)",
      "done": true,
      "skipped": false,
      "files": ["core-01-requirements.md"]
    },
    {
      "key": "phase.2",
      "label": "Phase 2 · 产品设计 (WHAT)",
      "done": false,
      "skipped": false,
      "files": []
    },
    {
      "key": "phase.3-3-deployment",
      "label": "Phase 3-3 · 部署方案",
      "done": true,
      "skipped": false,
      "files": ["core-01-deployment-plan.md"]
    },
    {
      "key": "phase.3-7-deploy",
      "label": "Phase 3-7 · 部署执行",
      "done": false,
      "skipped": false,
      "files": []
    },
    {
      "key": "phase.3-8-smoke",
      "label": "Phase 3-8 · 部署冒烟测试（smoke）",
      "done": false,
      "skipped": false,
      "files": []
    }
    // ... 所有 phase
  ],
  "modules": [                      // 模块注册表（来自 logos-project.yaml）
    {
      "id": "core",
      "name": "核心功能",
      "lifecycle": "initial",       // "initial" | "launched"
      "current_phase": "phase.3-2-api",  // 当前推进阶段 key；launched 模块为 null
      "current_phase_label": "Phase 3.2 · API 设计",
      "phase_progress": {           // 各阶段进度；launched 模块为 null
        "phase.1": { "done": true, "skipped": false },
        "phase.3-1": {
          "done": false, "skipped": false,
          "scenario_coverage": { "total": 3, "covered": 2, "missing": ["S03"] }
        }
      },
      "active_change": null,        // 仅 launched 模块有值
      "suggestion": "对 AI 说：「设计 API」"
    },
    {
      "id": "payment",
      "name": "支付模块",
      "lifecycle": "launched",
      "current_phase": null,
      "current_phase_label": null,
      "phase_progress": null,
      "active_change": {            // 当前活跃变更提案
        "slug": "add-refund",
        "proposal_step": "delta-writing",  // 见 proposal_step 枚举
        "proposal_step_label": "撰写 Delta",
        "has_proposal": true,
        "has_tasks": true,
        "tasks_checked": 2,
        "tasks_total": 5,
        "delta_count": 1,
        "deployment_required": false,
        "smoke_required": false,
        "deployment_reason": "文档-only 提案，不需要发布运行产物",
        "deployment_decision_source": "proposal",
        "deployment_decision_conflict": false,
        "deployment_decision_conflict_reason": null
      },
      "suggestion": "继续为 add-refund 产出 delta 文件，完成后明确授权执行 openlogos merge add-refund"
    }
  ],
  "active_proposals": [
    {
      "name": "add-feature",
      "has_proposal": true,
      "has_tasks": true,
      "delta_count": 3
    }
  ],
  "current_phase": "phase.2",      // 第一个未完成 phase 的 key，若全部完成则为 null
  "suggestion": "对 AI 说：「基于需求文档做产品设计」",  // 建议的下一步操作
  "all_done": false,               // 是否所有 phase 都已完成
  "lifecycle": "launched",          // 项目生命周期，派生值："initial" | "launched"
  "source_roots": null | {         // 源代码根目录，null 表示未配置
    "src": ["src"],
    "test": ["test"]
  },
  "yaml_diagnostics": null | {
    "parse_status": "recovered",
    "messages": ["logos-project.yaml 存在可恢复的解析错误"]
  }
}
```

### 3.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `phases` | array | 是 | 所有阶段的状态列表（固定 10 个元素） |
| `phases[].key` | string | 是 | 阶段标识符（如 `phase.1`, `phase.3-2-api`） |
| `phases[].label` | string | 是 | 阶段的本地化标签 |
| `phases[].done` | boolean | 是 | 该阶段是否已完成（有文件 = true） |
| `phases[].skipped` | boolean | 是 | 该阶段是否被跳过（空但后续阶段已完成） |
| `phases[].files` | string[] | 是 | 该阶段目录下的文件列表 |
| `modules` | array | 否 | 模块注册表；`logos-project.yaml` 无 `modules[]` 时省略此字段（向下兼容） |
| `modules[].id` | string | 是 | 模块标识符 |
| `modules[].name` | string | 是 | 模块名称 |
| `modules[].lifecycle` | string | 是 | 模块生命周期：`"initial"` 或 `"launched"` |
| `modules[].current_phase` | string \| null | 是 | 当前推进阶段 key；`launched` 模块为 null |
| `modules[].current_phase_label` | string \| null | 是 | 当前阶段本地化标签；`launched` 模块为 null |
| `modules[].phase_progress` | object \| null | 是 | 各阶段进度 map（key = phase key）；`launched` 模块为 null |
| `modules[].phase_progress[key].done` | boolean | 是 | 该阶段是否已完成 |
| `modules[].phase_progress[key].skipped` | boolean | 是 | 该阶段是否被跳过 |
| `modules[].phase_progress[key].scenario_coverage` | object \| undefined | 否 | 仅场景类阶段（`phase.3-1`、`phase.3-4a`）存在 |
| `modules[].active_change` | object \| null | 是 | 当前活跃变更提案；`initial` 模块或无活跃提案时为 null |
| `modules[].active_change.slug` | string | 是 | 提案 slug |
| `modules[].active_change.proposal_step` | string | 是 | 提案阶段：`"writing"` \| `"ready-to-delta"` \| `"delta-writing"` \| `"ready-to-merge"` \| `"merge-generated"` \| `"ready-to-implement"` \| `"coding"` \| `"ready-to-verify"` \| `"verify-passed"` \| `"verify-failed"` \| `"ready-to-deploy"` \| `"deploy-done"` \| `"ready-to-smoke"` \| `"smoke-passed"` \| `"smoke-failed"`；`"implementing"` / `"in-progress"` 为旧版本兼容值。`ready-to-implement`（split-slice-planner-stage 新增）置于 `"merge-generated"` 与 `"coding"` 之间，详见 §3.10 |
| `modules[].active_change.proposal_step_label` | string | 是 | 提案阶段本地化标签 |
| `modules[].active_change.step_meta` | object | 是（`active_change` 非 null 时） | 步骤自描述元数据 `{"phase", "kind"}`，来自步骤注册表（唯一铸造点），见下文「step_meta 与步骤注册表（contract-self-description）」 |
| `modules[].active_change.step_meta.phase` | string | 是 | `"pre-implement"` \| `"implement"` \| `"post-implement"`；小闭合枚举，消费方遇未知值必须走保守分支（见 §1.2 消费方约定） |
| `modules[].active_change.step_meta.kind` | string | 是 | `"produce"` \| `"gate"` \| `"command-required"` \| `"residency"`；小闭合枚举，消费方遇未知值必须走保守分支 |
| `modules[].active_change.facts` | object | 是（`active_change` 非 null 时） | CLI 权威计算的确定性事实块（全布尔，仅活跃提案时输出），见下文「facts 权威事实块（contract-self-description）」 |
| `modules[].active_change.has_proposal` | boolean | 是 | 是否存在 proposal.md |
| `modules[].active_change.has_tasks` | boolean | 是 | 是否存在 tasks.md |
| `modules[].active_change.tasks_checked` | number | 是 | 已勾选任务数 |
| `modules[].active_change.tasks_total` | number | 是 | 总任务数 |
| `modules[].active_change.delta_count` | number | 是 | deltas 目录下的文件数 |
| `modules[].active_change.code_required` | boolean | 是（`active_change` 非 null 时；为 null 时整个对象不出现，本字段亦不出现） | 当前活跃提案是否需要代码实现。取值**必须**等于内部谓词 `isCodeRequiredForProposal`（`cli/src/lib/proposal-lifecycle.ts`），供外部消费方直接读取，替代自行用关键词正则重判「要不要代码」。详见 §3.11 |
| `modules[].active_change.deployment_required` | boolean \| null | 是 | 活跃提案是否需要部署；无法判断时为 null |
| `modules[].active_change.smoke_required` | boolean \| null | 是 | 活跃提案是否需要部署后 smoke；无法判断时为 null |
| `modules[].active_change.deployment_reason` | string \| null | 是 | 来自 `proposal.md` 的部署原因或兼容推断说明 |
| `modules[].active_change.deployment_decision_source` | string | 是 | `"proposal"` \| `"tasks"` \| `"module-default"` \| `"legacy-fallback"`，表示部署决策来源 |
| `modules[].active_change.deployment_decision_conflict` | boolean | 是 | `proposal.md` 与 `[deploy]` section 是否冲突 |
| `modules[].active_change.deployment_decision_conflict_reason` | string \| null | 否 | 冲突原因摘要；无冲突时为 null |
| `modules[].suggestion` | string | 是 | 针对该模块的下一步建议（本地化文本） |
| `modules[].baseline_seed_state` | string | 否（非 adopted 模块省略；**adopted 模块恒输出**） | brownfield-adopter（S33）：`required｜partial｜seeded`；`bootstrap=adopted` 模块**无条件输出**（含活跃提案与 `baseline_commit_in_progress` 降级分支）——explicit 显式值优先，yaml 缺省（legacy）时经共享 helper `effectiveBaselineSeedState` 派生（有候选+open run→`partial`、有候选无 open run→`seeded`、无候选→`required`，见架构 core-06 §4.1）；**无 `unknown` 取值、无「缺省 → 字段缺失」路径**（baseline-seed-legacy-default-unify）。不新增 `baseline_seed_state_source` 字段 |
| `modules[].baseline_coverage` | object | 否 | S33 现状基线覆盖率；仅 `bootstrap=adopted` 且基线派生可用时输出（不随 `baseline_seed_state` 的恒输出扩展），`status`/`next` 字段一致。见 §3.12 |
| `active_proposals` | array | 是 | 活跃变更提案列表 |
| `active_proposals[].name` | string | 是 | 提案目录名 |
| `active_proposals[].has_proposal` | boolean | 是 | 是否存在 proposal.md |
| `active_proposals[].has_tasks` | boolean | 是 | 是否存在 tasks.md |
| `active_proposals[].delta_count` | number | 是 | deltas 目录下的文件数 |
| `current_phase` | string \| null | 是 | 当前应推进的阶段 key；全部完成时为 null |
| `suggestion` | string | 是 | 建议的下一步操作（本地化文本） |
| `all_done` | boolean | 是 | 是否全部阶段已完成（skipped 阶段不阻塞） |
| `lifecycle` | string | 是 | 项目生命周期（`initial` 或 `launched`，由模块状态派生） |
| `source_roots` | object \| null | 是 | 源代码根目录配置；未配置时为 null |
| `yaml_diagnostics` | object \| null | 否 | `logos-project.yaml` 的解析诊断；存在可恢复/不可恢复错误时返回 |
| `yaml_diagnostics.parse_status` | string | 是 | `"recovered"` 或 `"error"`；`recovered` 表示已从 AST 恢复可用的 `modules` 等数据 |
| `yaml_diagnostics.messages` | string[] | 是 | 诊断消息摘要 |

**step_meta 与步骤注册表（contract-self-description）**

- `modules[].active_change.step_meta = {"phase", "kind"}`；`phase ∈ pre-implement|implement|post-implement`；`kind ∈ produce|gate|command-required|residency`。
- 唯一铸造点 = `cli/src/lib/step-registry.ts`（收敛 `detectProposalStep` 与 `detectProposalStepViaFlow` 双镜像及 status/next 覆盖点）；任何代码路径产生 `proposal_step` 必须经注册表。CI lint：字面量赋 proposal_step 不经注册表 → 测试失败。
- **不新增 proposal_step 枚举值**；`step_meta` 不构成第二枚举——phase/kind 为小闭合枚举，消费方遇未知值必须按保守分支处理（§1.2），CLI 新增值不再构成对旧 driver 的破坏。
- 全量注册表（`proposal_step` → phase/kind 映射，与实现中 `step-registry.ts` 一一对应）：

| proposal_step | phase | kind |
|---|---|---|
| writing | pre-implement | produce |
| ready-to-delta | pre-implement | gate |
| delta-writing | pre-implement | produce |
| ready-to-merge | pre-implement | gate |
| merge-generated | pre-implement | command-required |
| spec-complete-required | pre-implement | command-required |
| test-id-required | pre-implement | residency |
| ready-to-implement | pre-implement | residency |
| coding | implement | produce |
| ready-to-verify | implement | command-required |
| verify-failed | implement | residency |
| verify-passed | post-implement | residency |
| ready-to-deploy | post-implement | gate |
| deploy-done | post-implement | residency |
| ready-to-smoke | post-implement | command-required |
| smoke-passed | post-implement | residency |
| smoke-failed | post-implement | residency |
| implementing（旧兼容） | implement | produce |
| in-progress（旧兼容） | implement | produce |

**facts 权威事实块（contract-self-description）**

- `modules[].active_change.facts = {"spec_complete", "slices_planned", "slices_approved", "code_required", "has_delta_tasks", "verify_pass"}`（全布尔，仅活跃提案时输出）。
- CLI 权威计算：spec_complete = SPEC_MERGED/MERGED 在场；slices_planned = tasks.md `[code]` 含真实脱占位条目；slices_approved = SLICES_APPROVED marker 在场；code_required / has_delta_tasks 沿现行判定；verify_pass = VERIFY_PASS marker。单一事实源在 CLI，driver 的自读/私有解析降级为低版本 fallback。
- §3.9 的 `loop_state` 激活判据与 facts 同源（同一份计算，不允许两处实现），driver 可直接从 facts 读出「implement 是否已进入」。
- `facts.code_required` 与既有 `active_change.code_required`（§3.11）取值恒相等（同一谓词）；facts 与既有 `consistency` 契约对齐、不矛盾。

**扩展口径（golden）**：`step_meta` / `facts` 为 `active_change` 新增 key，走 §3.11(2) 既有可控扩展口径——仅在 `active_change` 非 null 时出现，**无活跃提案的项目其 `next`/`status` JSON 不新增任何字段、既有 golden 不漂移**；有活跃提案的受影响 golden 须同步更新。

### 3.4 解析语义

`yaml_diagnostics.parse_status = "recovered"` 时，`modules` 必须保留，`lifecycle` 必须按恢复后的模块状态派生，不得因为 YAML 局部损坏而退回 `initial`。若无法恢复任何模块信息，则 CLI 必须返回明确的 `yaml_diagnostics`，而不是静默吞错。

### 3.5 冲突语义

`deployment_decision_conflict=true` 表示 CLI 检测到活跃提案的 `proposal.md` 部署影响声明与 `tasks.md` 的 `[deploy]` section 不一致。客户端必须将其视为阻塞态，提示用户修正提案或任务清单，不得继续展示部署、smoke 或归档主动作。

### 3.12 现状基线覆盖率字段（baseline_coverage，brownfield-adopter S33）

`bootstrap=adopted` 且无活跃提案的模块下，`status`/`next --format json` 在 `modules[].baseline_coverage` 输出现状基线覆盖率对象（`next` 挂 `modules[].baseline_coverage`，legacy 无 `modules[]` 才回退顶层 `baseline_coverage`）。字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `state` | string | `required｜partial｜seeded`，映射模块级 `baseline_seed_state` |
| `incomplete` | boolean | **恒存在为布尔**（稳定 shape，不省略）：`state==partial` → `true`，`required`/`seeded` → `false`。`partial` 时不得用已落盘候选当最终分母算精确百分比 |
| `human_verified` | number | 分子 = 该 module 下 `verified:true` 的 `active` 候选数 |
| `denominator` | number | 分母 = `active ∪ tombstone`（`retired` 不计入）；`0` 表示覆盖率 `n/a` |
| `tombstones` | number | 分母内未经人工确认的 tombstone 数 |
| `human_verified_delta` | number | 与派生索引记录的上次 `human_verified` 之差（无索引为 0）；**禁止把分母波动解读为新增人工确认** |
| `source` | string | `derived-index`（用了 `baseline_index` 派生索引）｜`documents`（直接从文档权威章节重算） |
| `freshness` | string | `fresh｜stale｜unknown`；索引 `source_hash` 与文档实时聚合 hash 不符时为 `stale`，此时不输出貌似精确的百分比 |
| `recovery` | object | **仅 `state==partial` 且存在活跃提案时出现**：结构化恢复 advisory `{ available:true, entry:"openlogos baseline-seed commit --run-id <id>", run_id }`——不改写 `proposal_step`、不阻断 change |
| `commit_in_progress` | boolean | 仅恢复门无法取模块锁（提交进行中）时置 `true`：机器消费者**不把当前集合当权威**（不据其算覆盖率/报 seeded） |

**partial 与活跃提案的优先级**：**无活跃提案**时 partial 主 `action`/`next_node` 指向 `openlogos baseline-seed` 恢复入口；**有活跃提案**时 `action`/`next_node`/`proposal_step` 保持该提案真实前沿，partial 恢复仅作 `recovery` advisory、不阻断 change。**只读已合并主文档**：覆盖率从各产物 `## 逆向基线来源` 章节实时聚合（可再经 `logos-project.yaml` 的 `baseline_index` 缓存加速 + 新鲜度对账），merge 前的未合并 delta 不计入；机器读取入口读前先经恢复门（取模块锁 + 检测未终结 journal → 先恢复，否则 `baseline_commit_in_progress`）。`verify --format json` 另在 `data.baseline_warnings`（string[]）输出对 `verified:false` 逆向 spec 的软告警——**不改 `gate.result`、不写 `VERIFY_FAIL`、不硬失败**（grandfather 豁免存量代码）。

### 3.13 `openlogos baseline-seed --format json`（brownfield-adopter S33）

`baseline_seed_state` 与逆向目标文件的**唯一写入入口**，两阶段 staging。三子命令共用 envelope `command: "baseline-seed"`：

- **begin**：`data = { ok, run_id, module, baseline_seed_state, expected, staging }`（`baseline_seed_state` 为当前值，begin 不下调）。
- **commit**：`data = { ok, run_id, module, baseline_seed_state, committed:[], missing:[], invalid:[] }`；`baseline_seed_state` = `seeded`（必需 kind 齐 + 全部合法）｜`partial`（≥1 未全，不提交不完整集合）｜保持。
- **status**：`data = { ok, module, baseline_seed_state, run_id, staged, expected, missing:[] }`。

**错误 envelope**（协议错误非零退出）：`error.code ∈ { missing_required_kind, path_escape, candidate_key_mismatch, unknown_run, stale_run, run_locked, baseline_commit_in_progress, invalid_manifest }`；错误时不写 `baseline_seed_state`、不提交任何 staged 文件。

### 3.6 overlay 派生字段（overlay_nodes / current_node）

派生引擎基于 **resolved flow（内置 + 项目 overlay 合并）**。overlay `op:add` 引入的节点
**无 phase key、无 proposal_step**，经以下 node 级字段承载（与 §3.3 既有 phase / proposal_step 维度并存）：

**`modules[].overlay_nodes[]`**（仅承载 overlay-ADDED 节点；省略规则见下）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `overlay_nodes[].id` | string | overlay-added 节点 id |
| `overlay_nodes[].name` | string | 节点展示名 |
| `overlay_nodes[].state` | string | `"done"` \| `"active"` \| `"skipped"` \| `"failed"` |
| `overlay_nodes[].subflow_id` | string | 所属 subflow id |
| `overlay_nodes[].node_index` | number | resolved 序列内 0 基序号（判 gate 前后关系） |
| `overlay_nodes[].overlay_op` | string | 恒为 `"add"` |

> **只输出已到达节点**：`overlay_nodes` 仅列出**已到达**的 overlay-added 节点——其态必为 `done`/`active`/`skipped`/`failed` 之一（`active` 恒为唯一当前节点）。**尚未到达（未轮到）的 overlay-added 节点不在 `overlay_nodes` 中**（其计划可经 `flow show --resolved` 查看）。`pending`（未到达/未求值）态本切片不引入，留 cmd: 切片（S26）。

**`modules[].current_node`**（object \| 省略；**仅当当前节点为 overlay-added 时输出**）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `current_node.id` | string | 当前 overlay-added 节点 id |
| `current_node.name` | string | 节点展示名 |
| `current_node.state` | string | `done` / `active` / `skipped` / `failed` |
| `current_node.subflow_id` | string | 所属 subflow id |
| `current_node.node_index` | number | resolved 序列 0 基序号 |
| `current_node.phase_key` | null | **恒为 null**（current_node 仅为 overlay-added 节点输出）|
| `current_node.overlay_op` | string | **恒为 `"add"`** |

> **收紧约束（避免破坏 golden）**：`current_node` **只在当前节点是 overlay-added 时输出**；builtin 当前节点**不输出** `current_node`（由既有 `current_phase` / `proposal_step` 表达）。实现**不得**为 builtin current 输出 `current_node`，否则无 overlay 项目会产生新字段、破坏零漂移。

**省略规则（可测，保 golden）**：
1. `overlay_nodes` 仅当该模块 resolved flow 含 **≥1 个已到达的** overlay-added 节点时输出，否则**省略字段**（不输出空数组）。故「存在 overlay `add` 但尚未到达」与「无 overlay」一样：`overlay_nodes` 省略（计划仍可经 `flow show --resolved` 查看）；
2. `current_node` 仅当当前节点为 overlay-added 时输出，否则省略；
3. 有效 overlay-only-builtin（无 add = initial 的 skip/modify/reorder + launched 的 modify）不新增任何字段。
据此**无 overlay 文件 → 三条均不触发 → §3.2/§3.3 输出逐字节不变**。

**legacy 回退**：`modules[]` 省略的无注册表项目（见 §3.3 `modules` 字段），`overlay_nodes` / `current_node` 回退到**顶层**同名字段；消费方先读 `modules[].*`、缺则读顶层。

### 3.7 launched proposal_step 与 overlay-added 当前节点

`modules[].active_change.proposal_step`（§3.3 既有枚举值集合不变）在 launched 当前节点落于 **overlay-added 节点**时，
取值 = resolved 序列中该节点**之前最近一个 builtin 节点**对应的 step（保持合法枚举、后向兼容，**不置 null**）；
**若无前序 builtin（`add ... before` 插到首个 builtin 之前），取 `"writing"`**（状态机首态）。精确位置由 §3.6 `current_node` 承载。

### 3.8 cmd: 谓词字段（M2 切片 1b）

`cmd:<command>` 谓词（仅 overlay-add 节点）点亮后，机器契约新增：

**(a) node 级 state 枚举追加 `pending`**：`overlay_nodes[].state` 与 `current_node.state` 取值集扩为
`"done" | "active" | "skipped" | "failed" | "pending"`。`pending` 表示该 `cmd:` 节点**在观察派生（status/watch）下未被求值**——status/watch 不执行命令。无 `cmd:` 节点时不会出现 `pending`。

**(b) `flow show --resolved` node 字段新增 `cmd_timeout_seconds`**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `flow.subflows[].nodes[].cmd_timeout_seconds` | integer ≥ 1 \| null | 节点级 cmd 超时秒数；缺省 null（回退项目级 `flow.cmd_timeout_seconds` / 内置 60s）。`< 1` 或非整数 → `FLOW_SCHEMA_INVALID` |

**(c) `next --format json` 的 cmd 结果字段**（success envelope `data` 顶层；**仅本次 next 执行了 cmd 时出现，否则整组省略**）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `cmd_node_id` | string | 被求值的 cmd 节点 id（即使 done 后 current 已续推，仍归属被求值节点）|
| `cmd_predicate_field` | string | `"done_when"` \| `"fail_when"` |
| `cmd_exit_code` | number \| null | 命令退出码；超时为 null |
| `cmd_timed_out` | boolean | 是否超时 |
| `cmd_satisfied` | boolean | 该 cmd 谓词是否满足（exit 0）；**非节点最终完成态**（看 `current_node.state`）|

出现条件矩阵：

| 触发 | `cmd_predicate_field` | `cmd_exit_code` | `cmd_timed_out` | `cmd_satisfied` | 结果 |
|---|---|---|---|---|---|
| done_when:cmd exit 0 | done_when | 0 | false | true | 节点 done、本次续推 |
| done_when:cmd 非 0 | done_when | N | false | false | active |
| done_when:cmd 超时 | done_when | null | true | false | active |
| fail_when:cmd exit 0 | fail_when | 0 | false | true | failed |
| fail_when:cmd 非 0/超时（未命中） | fail_when | N/null | false/true | false | 继续评该节点（非 cmd 的）done_when |
| 本次未执行 cmd | — | — | — | — | 字段整组省略 |

**(d) 执行输出隔离 / 容量边界**：`next` 执行 cmd 时 child stdout/stderr **必须捕获、绝不写父进程 stdout**（保 `next --format json` 单条合法 envelope）；
持续 drain 防阻塞、每路尾部 ≤64KiB 截断；**命令输出不进 envelope**。

**(e) 每次 next cmd budget = 1**：单次 `next` 至多执行 1 个 cmd；续推后若新 current 又是 cmd 节点，输出为 `current_node`（`state: "pending"`）但不执行第二个。

**(f) builtin gate 的 `cmd_gate` 字段（S30）**：S30 把 cmd: 放开到 launched `verify`/`deploy`/`smoke` gate。因 `current_node` **仅承载 overlay-add 节点**
（§3.6 收紧约束不变），builtin gate 的 observe-pending 另由 **`cmd_gate`** 字段承载：

| 字段 | 类型 | 说明 |
|---|---|---|
| `cmd_gate.node_id` | string | `"verify"` \| `"deploy"` \| `"smoke"` |
| `cmd_gate.field` | string | `"done_when"` \| `"fail_when"` |
| `cmd_gate.command` | string | cmd: 之后的命令串（已 trim） |
| `cmd_gate.timeout_seconds` | integer ≥ 1 | 生效超时（节点级 > 项目级 > 60s） |

- **出现条件**：当前前沿是 verify/deploy/smoke 且其 cmd 字段仍 pending（节点态 `pending`）时输出——含三路径：① `status`/`watch` 恒不求值；② `next` 中该 cmd 非 0/超时/未命中；③ `next` 中**因 `budget=1` 已被前序 cmd 耗尽而未求值**、停在该 cmd gate。**仅 cmd gate（overlay modify）时出现，否则整字段省略 → golden 零漂移**。
- **挂载位置（与 `loop_state` §3.9 同构）**：有 `modules[]` → **`modules[].cmd_gate`**（**与 `active_change` 平级**，**不**挂在 `active_change` 下——`next` 的 module item 里 `active_change` 是**字符串**而非对象，见 §3.7）；legacy 无 `modules[]` → 回退**顶层 `cmd_gate`**；`next` base data 同步挂 `next.modules[].cmd_gate`。消费方先读 `modules[].*`、缺则读顶层。
- builtin gate 由 **`cmd_gate` + `proposal_step`（停门前）**共同表达；`current_node` 维持只给 overlay-add。

**(g) `cmd_node_id` 支持 builtin 节点 id（S30）**：§3.8(c) 的 cmd 结果字段（`cmd_node_id`/`cmd_predicate_field`/`cmd_exit_code`/`cmd_timed_out`/`cmd_satisfied`）
按「被求值的 cmd 节点 id」定义，**天然支持 builtin gate id**（`cmd_node_id: "verify"|"deploy"|"smoke"`），`next` 求值 builtin gate cmd 时复用、无需新增字段。

**(h) next 瞬态 `proposal_step` 与 status 有意不一致（S30，落契约）**：cmd gate 下 `next` 据 cmd 求值合成本次 envelope 的 `proposal_step`：
`done_when:cmd` exit 0 → 显示**推进过门**（按部署决策落 `verify-passed` / `ready-to-deploy`）；`fail_when:cmd` exit 0 → 显示 `verify-failed`/`smoke-failed`。
但 **`next` 不写 marker** → **下一次 `status`/`watch` 回到停门前**（如 `ready-to-verify`）。这是**有意的 next/status 不一致**：`next` envelope 门后态 = 「本次响应据 cmd 求值合成」；`status`/`watch` 反映「持久化前沿（停门前）」。消费方**不得**把 `next` 的瞬态 `proposal_step` 当持久状态缓存。

### 3.9 loop_state 派生字段（M2 切片 2）

implement（code/verify）子流程的 resolved loop 定义满足 `max_iters > 1`（builtin launched 默认 `max_iters:30`，或经 overlay `set-loop`）时，机器契约可输出 `loop_state`；是否真正挂出由下方激活判据决定。

**激活判据（contract-self-description，主动破例收紧）**：`loop_state` 挂出 **iff** `code_required ∧ spec_complete ∧ slices_planned ∧ slices_approved`（与 facts 同一份计算，见 §3.3「facts 权威事实块」；`slices_approved` 的权威事实 = `SLICES_APPROVED` marker 在场）；否则省略字段。四条缺一即不挂出：

- `ready-to-implement`（切片已规划、待 slice-exit 批准）的合法驻留态**不挂**；
- docs-only / no-code 提案（`code_required=false`）**永不挂**，不因 launched flow 含 loop 定义而挂出；
- spec 阶段（`writing` 至 `merge-generated` / `spec-complete-required` / `test-id-required`）不挂。

**主动破例声明**：本判据破坏既有「launched 下 `loop_state` 常驻输出」不变量（本节旧口径「launched 模块下常驻输出」、`spec/flow-spec.md` §6/§12.2、S27「常驻输出」措辞——各处同步修订）。收紧后 spec 阶段 / 切片未规划 / 切片待批准时不再输出 `loop_state`；launched 活跃提案 golden 系列（用例 5/6/8/9）重拍。**`slice_state` 常驻口径（§3.10(2)）不变**，两者激活判据分别写明、不得互相推导。

**`modules[].loop_state`**（object \| 省略；**仅按上方激活判据挂出时输出**）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `loop_state.subflow_id` | string | 激活 loop 的 subflow id（如 `"implement"`）|
| `loop_state.until` | string | 收敛谓词，**闭合枚举 `"tests_green" \| "code_slices_green"`**（builtin launched 默认 `"code_slices_green"`；schema 锁定双值，消费方遇未知值走保守分支）|
| `loop_state.max_iters` | number | resolved loop 的迭代上限（整数 ≥ 1；> 1 才会出现本对象）|
| `loop_state.iteration` | number | 已完成的 verify 轮次（= `LOOP_ITERS` 按当前 module 过滤后的行数）|
| `loop_state.converged` | boolean | **按 resolved `until` 求值**（两分支，无无条件公式）：`tests_green` → 末轮测试绿（账本末行 `result == "pass"`）；`code_slices_green` → `section_complete:code ∧ tests_green`（`[code]` 全勾 且 末轮绿；空 `[code]` 退化为纯 `tests_green`）。派生细节见 `spec/flow-spec.md` §6/§12.2/§12.4 |
| `loop_state.escalated` | boolean | `iteration >= max_iters && !converged`（达上限仍未绿）|
| `loop_state.activated_at` | string \| **省略** | implement loop 激活时刻（ISO 8601，审计用），读自结构化 `SLICES_APPROVED` marker 的 `approved_at`；旧格式空 marker → **省略该字段**（兼容） |
| `loop_state.exhausted_skippable` | boolean \| **省略** | 达上限退出 gate 是否可被 `next --auto` 放行 = resolved loop 的 `exhausted_gate.skippable`。**仅当 overlay `set-loop` 显式写了 `exhausted_gate` 时输出**；未写则**省略**，消费方按 `false` 处理 |

- **`exhausted_skippable`（S29）省略规则（保真零漂移）**：**只有** overlay `set-loop` 显式写了 `set.exhausted_gate`（如 `{skippable:true}`）时，
  才把 `exhausted_skippable` 加入 `loop_state`；**未写 `exhausted_gate` → 字段省略**（不输出 `exhausted_skippable:false`）。
  这样**既有 S27 激活-loop（仅 `max_iters>1`、无 `exhausted_gate`）的 `loop_state` JSON 不新增此字段**。
  它只在 `escalated == true` 时影响 `--auto` 放行（见 §11.1），其余态仅为声明。builtin / 未激活 loop → 整个 `loop_state` 省略。
  **零漂移口径（S29 字段自身）**：未写任何 S29 字段（`exhausted_gate` / `coverage_threshold`）的项目，`status`/`next`/`watch`/`flow show` 输出不因 S29 新增任何字段。

**`SLICES_APPROVED` 结构化 marker（修订 §3.10(1.1) 的「内容可为空」约定）**：消费 slice-exit 时原子写入一次，JSON 单行：`{"schema":"openlogos/slices-approved@1","approved_at":"<ISO 8601>"}`；已存在不重写（重复 `next --auto` 不刷新）；兼容读旧空文件（视为已批准、无时间戳，`activated_at` 省略）。同一磁盘状态永远派生同一 JSON，不破坏 A 被动派生确定性。

**挂载位置（与 §3.6 overlay 字段同构）**：
- 有 `modules[]` 的项目 → `modules[].loop_state`（按模块）；
- legacy 无 `modules[]` → 回退**顶层** `loop_state`；消费方先读 `modules[].*`、缺则读顶层；
- `openlogos next --format json` 的 base data **同步挂 `next.modules[].loop_state`**（顶层仅 legacy fallback）；
- `openlogos watch` 的 data 与 status 同构，**继承同一挂载与省略规则**（见 §10.5）。

**省略规则（可测）**：`loop_state` **仅当** resolved 目标 subflow `loop.max_iters > 1` **且满足上方四合取激活判据**时输出，
否则**省略字段**。据此 builtin（`max_iters:1`）、未激活的项目、以及 **initial 多模块**（不支持、不激活）→ `loop_state`
一律省略；无活跃提案项目输出逐字节不变。

**与 `proposal_step` 的关系（JSON 兼容）**：`loop-exhausted` **不是新的 `proposal_step` 枚举值**——§3.3 的 `proposal_step`
集合保持不变（launched loop 未收敛时仍为 `ready-to-verify` / `verify-failed` 等既有值）。"是否达上限"**只由 `loop_state.escalated`
\+ `next --auto` 的 gate 字段表达**（见 §11.1），实现不得为表达本 gate 而新增 `proposal_step`。

**出环判定（消费方须知）**：loop 激活且 `converged == false` 时，implement 视为**未完成**——`current_phase`（initial）/
`proposal_step`（launched）**不得**前进到后续 subflow（deliver/deploy/launch），即便 verify 节点的 `done_when`
（如 initial 的 `file:acceptance-report.md`，FAIL 也会写报告）已满足。

---

## 3.10 change-flow-redesign 契约增量（proposal_step / slice_state / next_node.slice / plan 门）

本节定义 change-flow-redesign 对既有契约的增量；显式修订 §3.3（proposal_step 枚举）、§3.9（loop_state）、§9（flow show）相关字段与 `openlogos next` 的 `next_node`。

### (1) `proposal_step` 枚举新增 `ready-to-delta`（修订 §3.3）

`§3.3` 的 `modules[].active_change.proposal_step` 闭合枚举**新增取值 `"ready-to-delta"`**，置于 `"writing"` 与 `"delta-writing"` 之间。完整集合为：
`"writing"` | `"ready-to-delta"` | `"delta-writing"` | `"ready-to-merge"` | `"merge-generated"` | `"coding"` | `"ready-to-verify"` | `"verify-passed"` | `"verify-failed"` | `"ready-to-deploy"` | `"deploy-done"` | `"ready-to-smoke"` | `"smoke-passed"` | `"smoke-failed"`（`"implementing"` / `"in-progress"` 仍为旧版本兼容值）。

- 语义：`proposal.md` 与 `tasks.md` 均已脱模板、但尚未产出任何 delta 且不存在 `PLAN_APPROVED` marker 时的驻留态，对应 launched `plan` 出口「批准方案」门。
- `proposal_step_label`（本地化）：`zh` = `"方案待批准"`。
- 说明：本提案为开发态、主动扩展该闭合枚举（破"枚举不新增"不变量），消费方（含 RunLogos）须同步识别新值。

### (1.1) `proposal_step` 枚举再新增 `ready-to-implement`（修订 §3.3）

`§3.3` 的 `modules[].active_change.proposal_step` 闭合枚举**再新增取值 `"ready-to-implement"`**（split-slice-planner-stage），置于 `"merge-generated"` 与 `"coding"` 之间。叠加 (1) 后的完整集合为：
`"writing"` | `"ready-to-delta"` | `"delta-writing"` | `"ready-to-merge"` | `"merge-generated"` | `"ready-to-implement"` | `"coding"` | `"ready-to-verify"` | `"verify-passed"` | `"verify-failed"` | `"ready-to-deploy"` | `"deploy-done"` | `"ready-to-smoke"` | `"smoke-passed"` | `"smoke-failed"`（`"implementing"` / `"in-progress"` 仍为旧版本兼容值）。

- 语义：`SPEC_MERGED` 存在、提案 `code_required`、`[code]` section 尚未由 slice-planner 写定（仍为模板/空、未全部勾选）且 `SLICES_APPROVED` marker 不存在时的驻留态，对应 launched `slice` 出口「切片待批准」门（`gate_id=slice-exit`、`skippable:true`）。`[code]` 切片由 merge 后的 `slice` 子流程（slice-planner）对已合并规格 + 真实测试 ID 撰写。
- `proposal_step_label`（本地化）：`zh` = `"切片待批准"`。
- **gate / current 映射**：`STEP_TO_GATE_SUBFLOW` 增 `ready-to-implement → slice` 出口门（`gate_id=slice-exit`、`skippable:true`）；`STEP_TO_CURRENT_BUILTIN` 增 `ready-to-implement → plan-slices` 节点。`next --auto` 的 `gate_id` / `skippable` 映射见 §11。
- **`slice-exit` `--auto` 放行 = 消费 gate**（对齐 (5) plan 门写法）：`next --auto` 在 `ready-to-implement` 自动放行 `slice-exit` 时，必须：
  1. 向活跃提案目录 `GATE_AUTO_PASSED` 追加一行 `{gate_id:"slice-exit", proposal_step:"ready-to-implement", timestamp}`；
  2. 写入 `SLICES_APPROVED` marker（活跃提案目录下，内容可为空、存在性为准；类比 `plan-exit` 写 `PLAN_APPROVED`）。
  写入后**同次响应重新派生**为 `coding` / `code` 前沿，`proposal_step == "coding"`、`next_node.id == "code"`。
- **`slice-exit` 顶层 gate 字段的出现条件（fix-post-merge-slice-planner-auto-skip）**：`proposal_step=="ready-to-implement"` 时，顶层 `gate_id:"slice-exit"` / `gate_auto_passed:true` 只允许在 `tasks_code_filled==true` 后出现。若 `[code]` 仍为模板、空 section 或占位项，`next --auto --format json` 必须保持前沿为 `plan-slices`，输出形态应满足：`modules[].proposal_step == "ready-to-implement"`；`modules[].next_node.id == "plan-slices"`；`modules[].next_node.gate_id` 省略；`gate_auto_passed` 为 `false` 或省略；`gate_id` 为 `null` 或省略，绝不得为 `"slice-exit"`；不写入 `SLICES_APPROVED`，不追加 `GATE_AUTO_PASSED{gate_id:"slice-exit"}`，不返回 `next_node.id=="code"`。`[code]` 已脱模板且 `SLICES_APPROVED` 不存在时，既有语义保持不变：默认 `next` 输出 `next_node.id=="plan-slices"` 且 `next_node.gate_id=="slice-exit"`；`next --auto` 消费该门，写入 `SLICES_APPROVED`，并在同次响应重新派生为 `coding` / `next_node.id=="code"`。
- **`SLICES_APPROVED` marker**：表示 slice 出口 gate 已被消费；存在后即使 `[code]` 尚未勾选，也派生为 `coding` / `code` 前沿。`GATE_AUTO_PASSED` 仍只表示审计轨迹。
- **幂等边界**：同一提案已存在 `SLICES_APPROVED` 时，`proposal_step` 不再是 `ready-to-implement`，重复 `next --auto` 不得再次追加 `gate_id:"slice-exit"` 审计行。
- 说明：本提案为开发态、主动扩展该闭合枚举（破"枚举不新增"不变量），消费方（含 RunLogos）须同步识别新值。

### (2) 新增 `slice_state`（代码切片循环；修订 §3.9 同构挂载）

切片循环激活（`implement` resolved `loop.until == code_slices_green` 且 `max_iters > 1`；builtin launched 默认满足）时，机器契约新增 `slice_state`。挂载与 `loop_state` 同构：有 `modules[]` → `modules[].slice_state`，legacy 无 `modules[]` → 顶层 `slice_state`；`openlogos next` 同步挂 `next.modules[].slice_state`；`watch.data` 继承。`status` / `watch` / `next` 携带，`flow show` 不带。

| 字段 | 类型 | 说明 |
|---|---|---|
| `slice_state.total` | number | `[code]` 切片总数 |
| `slice_state.done` | number | 已勾选切片数（= `section_complete:code` 的已完成计数）|
| `slice_state.current` | string \| 省略 | 当前待实现切片（第一个未勾 `[code]` 行标题）；全部完成时省略 |
| `slice_state.remaining` | number | `total - done` |

**省略规则（保 golden）**：`slice_state` **仅切片循环激活时输出**，否则整字段省略（不物化 `null`）。空 `[code]`（`total==0`）下 `code_slices_green` 退化为 `tests_green`，此时 `slice_state` 仍可输出 `{total:0, done:0, remaining:0}`（无 `current`）供展示，loop 收敛按 `tests_green` 判。**因 builtin launched `implement` 默认激活，launched 模块下 `slice_state` 常驻输出——该常驻口径经 contract-self-description 明示维持不变**；`loop_state` 则不再常驻，按 §3.9 的四合取激活判据挂出（contract-self-description 主动破例，两者激活判据分别写明）；initial 多模块不支持、省略。`slice_state` 是切片规划进度的展示面、不触发 driver loop 分支。

### (3) `LOOP_ITERS` 账本新增可选 `slice` 字段（修订 §3.9 计数来源）

切片循环激活时，`openlogos verify` 追加的 `LOOP_ITERS` 账本行可带可选 `slice` 字段：
`{ "iter": 5, "node": "verify", "result": "pass", "slice": "切片3：API 编排", "module": "core", "timestamp": "…" }`。
`iteration` / `converged` 计数语义不变（`slice` 仅承载每片尝试历史，非权威完成依据——完成以 `[code]` 勾选为准）。未激活时省略 `slice`，账本逐字节兼容既有。

### (4) `next_node` 在切片循环下带 `slice` 子提示

`openlogos next` 的 `next_node`（见 next base data 节）在切片循环未收敛、未达上限时（`next_node` 按 R7 指向 `code` 工作节点），新增可选子字段 `next_node.slice`（string，= `slice_state.current`），供宿主注入"只做这一片"的上下文。非切片循环 / 收敛 / 达上限时省略。

### (5) plan 门与 deliver 门的 `--auto` 契约（修订 §11 auto gate）

- **`plan-exit`（修订）**：`ready-to-delta` 下 `next --auto` 自动放行该可跳门时，必须向活跃提案目录 `GATE_AUTO_PASSED` JSONL 追加一行 `{gate_id:"plan-exit", proposal_step:"ready-to-delta", timestamp}`，并写入 `PLAN_APPROVED` marker。写入后同次响应重新派生为 `delta-writing` / `write-delta` 前沿，`next_node.id == "write-delta"`。
- **`PLAN_APPROVED` marker**：活跃提案目录下的持久化 marker（`logos/changes/<slug>/PLAN_APPROVED`，内容可为空，存在性为准）。它表示 plan 出口 gate 已被消费；`GATE_AUTO_PASSED` 仍只表示审计轨迹。
- **幂等边界**：同一提案已存在 `PLAN_APPROVED` 时，`proposal_step` 不再是 `ready-to-delta`，重复 `next --auto` 不得再次追加 `gate_id:"plan-exit"` 审计行。
- **`deliver-entry`（不变）**：该门 `skippable:true`。`ready-to-deploy` 下 `next --auto` 自动放行，输出 `gate_id="deliver-entry"`、`skippable:true`、`gate_auto_passed:true`，并追加 `GATE_AUTO_PASSED` 审计行。
- **授权语义（钉死）**：部署放行依据 = **本次 `next --auto` 响应输出 `gate_auto_passed === true`**（live 决策）；`GATE_AUTO_PASSED` 为 append-only 审计轨迹，**历史审计行不构成对后续部署或 plan gate 的授权**，默认 `next`（无 `--auto`）一律忽略之（与 S24 一致）。plan gate 状态推进只认 `PLAN_APPROVED` 或实际 delta 产出。
- `ready-to-merge`（`spec` 出口）保持 `skippable:true`（语义不变，仅 gate 归属子流程由 `propose` 改为 `spec`）。

---

## 3.11 `code_required` 契约字段（expose-code-required-field）

把已在 flow 派生中使用的内部谓词 `code_required`（驱动 `when: code_required` 子流程跳过、`plan-slices` 判定等，见 §3.10 与场景 S32/S24/S31）暴露为**显式契约字段**，作为「是否需要代码实现」的**单一事实源**，供外部消费方（如 RunLogos 驱动）直接读取，替代自行用关键词正则重判。

### (1) 字段定义（修订 §3.3）
- 路径：`modules[].active_change.code_required`
- 类型：`boolean`
- 取值：等于内部谓词 `isCodeRequiredForProposal`（`cli/src/lib/proposal-lifecycle.ts`）——`true`＝提案含 `## [code]` 产出需求（有 `[code]` 段 / `[delta]` 新增 `UT-*`/`ST-*`/`SMOKE-*` / proposal 声明代码级）；`false`＝纯文档 / 纯规格提案。

### (2) 出现条件与零漂移边界
- **仅在 `active_change` 非 null 时出现**；无活跃提案时 `active_change==null`，本字段随整个对象一并不出现。
- 因此**无活跃提案的项目其 `next`/`status` JSON 不新增任何字段，既有 golden 不漂移**；有活跃提案的项目 `active_change` 对象新增一个 key，受影响 golden 须同步更新。

### (3) 一致性约束
- `code_required==false` ⟹ `next_node.id` 不为 `"code"`/`"plan-slices"`；`slice` 子流程（`when: code_required`）整段跳过。
- `code_required==true` 且 `[code]` 未脱模板 ⟹ 维持 `proposal_step=="ready-to-implement"`、`next_node.id=="plan-slices"`。
- 本字段只读、纯派生；`next` 不因输出本字段而写任何 marker。

---

## 3.13 launched plan_state 诊断对象

为避免消费方把 `tasks.md` checkbox 执行进度误判为任务规划失败，`status` / `next` / `watch` 在 launched 活跃提案下新增可选诊断对象 `plan_state`。该对象是非破坏性扩展；缺失时旧消费方行为不变，新消费方应优先使用它区分 plan ready、plan gate pending 与任务执行进度。

### 挂载位置

- 有 `modules[]` 的输出：挂载到 `modules[].active_change.plan_state`。
- legacy 单模块或顶层兼容输出：可回退到顶层 `plan_state`。
- `next --format json` 的 module item 与 `status --format json` 保持同构；`watch` 事件中的 `data` 与 `status` 同构。

### Schema

```jsonc
{
  "plan_state": {
    "plan_ready": true,
    "plan_gate_pending": true,
    "plan_approved": false,
    "tasks_template_filled": true,
    "tasks_execution_done": 0,
    "tasks_execution_total": 8,
    "tasks_execution_scope": "delta",
    "diagnostic": "proposal/tasks 已完成，等待 plan-exit 批准；checkbox 表示 delta 执行进度"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `plan_ready` | boolean | 是 | proposal/tasks 已脱模板，且无部署决策冲突等 plan 层阻断 |
| `plan_gate_pending` | boolean | 是 | 当前停在 plan 出口门：`proposal_step=="ready-to-delta"` 且 `PLAN_APPROVED` 不存在 |
| `plan_approved` | boolean | 是 | plan gate 已消费：`PLAN_APPROVED` 存在，或当前已离开 `ready-to-delta` |
| `tasks_template_filled` | boolean | 是 | `tasks.md` 已脱模板并含有效 section 结构 |
| `tasks_execution_done` | number | 是 | 当前执行 section 的已勾选任务数；不得用于反推 plan 是否 ready |
| `tasks_execution_total` | number | 是 | 当前执行 section 的任务总数 |
| `tasks_execution_scope` | `"delta"` \| `"deploy"` \| `"code"` \| `"none"` | 是 | 当前统计口径；plan 段通常为 `"delta"` |
| `diagnostic` | string | 否 | 面向 AI driver / UI 的短诊断，说明等待态或阻断原因 |

### 派生规则

- `proposal_step=="writing"`：`plan_ready=false`；`plan_gate_pending=false`；`plan_approved=false`；若 `tasks.md` 尚未脱模板，`tasks_template_filled=false`。
- `proposal_step=="ready-to-delta"`：当 proposal/tasks 已脱模板且无冲突时，必须输出 `plan_ready=true`、`plan_gate_pending=true`、`plan_approved=false`。此时 `tasks_execution_done` 可以为 0；这表示 delta 尚未执行，不表示任务规划失败。
- `proposal_step=="delta-writing"` 或后续态：`plan_gate_pending=false`；`plan_approved=true`。
- `deployment_decision_conflict==true` 或 proposal/tasks 结构冲突：`plan_ready=false`，`diagnostic` 应说明冲突；不得伪装为 plan gate pending。
- `[delta]` section 存在时，`tasks_execution_scope="delta"`，统计 `[delta]` checkbox；无 `[delta]` 且有 `[deploy]` 时统计 `[deploy]`；无可统计 section 时为 `"none"` 且 done/total 均为 0。

### 消费方契约

- UI / driver 不得再通过 `tasks_execution_done / tasks_execution_total` 比值判断 plan 是否失败。
- `plan_ready=true && plan_gate_pending=true` 应展示为“方案已完成，等待 plan gate 批准或 auto 消费”。
- `next --auto` 若消费 `plan-exit` 并返回 `gate_auto_passed=true` 与 `next_node.id=="write-delta"`，消费方必须继续派发 `write-delta`。
- 历史 `GATE_AUTO_PASSED` 仍只是审计；`plan_approved` 的状态源为 `PLAN_APPROVED` 或实际离开 `ready-to-delta` 的派生事实。

---

## 3.14 `capabilities` 段（UI 前置能力门载体，status / next）

为把 UI-first 的**前置能力门**（capability gate）表达为机器可读契约，`openlogos status` / `next` 的 `--format json`
输出在 `data` 顶层**新增可选对象 `capabilities`**。它承载「当前会话是否具备渲染 UI 原型的能力」，
供 openlogos 侧在 `plan-exit` **之前**决定进入「渲染确认模式」还是「降级模式」。

### (1) 输入通道：`logos/.session-capabilities.json`

`status` / `next` 是 openlogos 的**输出**；能力信号的**输入**由持久化文件通道提供：

- **runlogos 在会话建立时写** `logos/.session-capabilities.json`，例：

  ```json
  { "ui_prototype_render": true }
  ```

- **`openlogos-phase` 钩子（SessionStart 上下文）与 `status` / `next`（JSON）读该文件**，据以生成上下文
  `capabilities` 段与 JSON `capabilities` 字段。
- **文件缺失 = 能力缺失（降级模式）**：文件不存在、无法解析、或缺 `ui_prototype_render` 键时，
  `capabilities.ui_prototype_render` 一律派生为 `false`（安全默认降级，不 claim UI 确认）。
- 该文件是 **runlogos 私有会话态**，位于 `logos/` 下（gitignore），**非方法论产物**，openlogos 侧只读不写。

由此闭环：**runlogos 写文件 → openlogos 读并 surface → 流程在 plan-exit 前决定模式**。

### (2) `capabilities` 段 Schema（status / next 的 `data` 顶层）

```jsonc
{
  // ... 既有 status / next data 字段 ...
  "capabilities": {
    "ui_prototype_render": true    // 当前会话是否具备渲染 UI 原型的能力（缺失=false，降级）
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `capabilities` | object \| 省略 | 否 | 会话能力声明；见「出现与省略规则」。挂载于 `status` / `next` 的 `data` 顶层 |
| `capabilities.ui_prototype_render` | boolean | 是（`capabilities` 出现时）| 当前会话是否能渲染 UI 原型：由 `logos/.session-capabilities.json` 的 `ui_prototype_render` 派生；文件缺失 / 不可解析 / 缺键 → `false`（降级） |

### (3) 出现与省略规则（零漂移边界）

- `capabilities` **仅当** `logos/.session-capabilities.json` 存在**且**可解析出至少一个已知能力键时输出；
  文件缺失 / 不可解析 → **整个 `capabilities` 段省略**（不输出 `{"ui_prototype_render": false}`）。
- 由此**未提供 capability 文件的项目**（现有绝大多数项目、纯 CLI / API / Skills 项目）——其
  `status` / `next` JSON **逐字节不变**，既有 golden 不漂移。
- 消费方语义：**`capabilities` 段省略 == 能力缺失（降级）**；`capabilities.ui_prototype_render:false` 显式声明降级；
  二者对下游模式选择等价。
- `watch` 的 `data` 与 `status` 同构：若实现将 `capabilities` 纳入 `watch` 流，须遵循同一出现 / 省略规则；
  本切片契约以 `status` / `next` 为准。

### (4) 消费契约：capability 仅用于 plan-exit *之前* 的模式选择（红线，F4 R7）

- **模式选择（plan-exit 之前）** 才读 `capabilities`：
  - `capabilities.ui_prototype_render == true`（会话就绪）→ **渲染确认模式**：面板渲染原型，批准即构成 UI 视觉确认，
    要求写入绑定 `pages` / `hashes` 的 `PLAN_APPROVED` provenance。
  - `capabilities` 缺失 / `ui_prototype_render == false`（旧面板 / openlogos-CLI-only）→ **降级模式**：
    不 claim「UI/UX 确认已前移」，给 advisory 提示、不阻断。
- **这是 `logos/.session-capabilities.json` 与本 `capabilities` 段的唯一合法用途**——只用于 plan-exit **之前**选择交互模式。

- **强制语义（plan-exit *之后*：merge / 落盘 / 落盘后复核）绝不读会话 capability**，一律以持久化
  `PLAN_APPROVED` provenance 为准：
  - `PLAN_APPROVED` 含 UI provenance（`ui_prototype_rendered:true` + `pages` + `hashes`，即该批准曾走渲染确认路径）
    ⇒ 所有 merge / 落盘 / 落盘后复核入口**永久 fail closed**：`hashes` 必须存在且逐文件重算匹配；
    缺失 / 损坏 / 失配一律拒绝。**当前会话 `capabilities` 段缺失 / `.session-capabilities.json` 被清理一律不得降级**——
    「曾渲染确认」的证据已固化在批准记录里，易失会话态无权推翻它。
  - 仅当批准记录明确为 legacy/degraded、或旧空 marker 且无任何「曾渲染确认」证据时，才走 F3 向后兼容 advisory 放行。
- **反例（明令禁止）**：不得以「消费 merge 时 `capabilities` 段缺失」为由，对已含 UI provenance 的 `PLAN_APPROVED`
  放行漂移原型——这构成跨会话降级绕过（渲染会话写 `hashes` → 原型被改 → 新 CLI-only 会话 merge 放行「确认 vX、实现 vY」）。

### (5) JSON 字段示例

**会话就绪（runlogos 写入 `{"ui_prototype_render": true}`）** — `openlogos status --format json` 片段：

```json
{
  "command": "status",
  "version": "0.5.9",
  "timestamp": "2026-07-10T12:00:00.000Z",
  "data": {
    "capabilities": { "ui_prototype_render": true },
    "current_phase": null,
    "suggestion": "...",
    "all_done": false,
    "lifecycle": "launched"
  }
}
```

**能力缺失（无 `logos/.session-capabilities.json`）** — `capabilities` 段**省略**，输出与既有 golden 逐字节一致：

```json
{
  "command": "next",
  "version": "0.5.9",
  "timestamp": "2026-07-10T12:00:00.000Z",
  "data": {
    "current_phase": null,
    "suggestion": "...",
    "lifecycle": "launched"
  }
}
```

### (6) [code] 触点（本 delta 只定契约）

- **改源模板**：`plugin/bin/openlogos-phase`（Claude）+ `plugin-codex/session-start.sh`（Codex 入口）读
  `logos/.session-capabilities.json`，在注入上下文块追加 `capabilities` 段；`.claude/openlogos/bin/openlogos-phase`
  为 sync 部署副本、**不直接改**。
- **改 JSON 输出**：`cli/src/commands/status.ts` / `cli/src/commands/next.ts` 读该文件、按本节规则派生并挂 `data.capabilities`。
- **上下文 `capabilities` 段与 JSON `capabilities` 字段必须一致 surface**（同一 `.session-capabilities.json` 派生源），
  跨仓端到端 smoke 断言两入口一致（见提案 F2 R7）。

---

## 4. `openlogos deploy-done --format json`

### 4.1 用法

```bash
openlogos deploy-done
openlogos deploy-done --env staging
openlogos deploy-done --format json
```

### 4.2 JSON Schema（data 部分）

```jsonc
{
  "slug": "add-feature",
  "environment": "staging",
  "marker_path": "logos/changes/add-feature/DEPLOY_DONE",
  "deployment_report_path": "logos/resources/verify/deployment-report.md",
  "deploy_tasks_checked": 3,
  "deploy_tasks_total": 3,
  "cleared_smoke_markers": ["SMOKE_PASS", "SMOKE_FAIL"],
  "next_step": "ready-to-smoke"
}
```

### 4.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `slug` | string | 是 | 当前活跃提案 slug |
| `environment` | string \| null | 是 | `--env` 指定的部署环境标签；未指定时为 null |
| `marker_path` | string | 是 | 写入的 `DEPLOY_DONE` marker 路径 |
| `deployment_report_path` | string | 是 | 部署报告路径 |
| `deploy_tasks_checked` | number | 是 | `deploy-done` 后 `[deploy]` section 已勾选任务数 |
| `deploy_tasks_total` | number | 是 | `[deploy]` section 任务总数 |
| `cleared_smoke_markers` | string[] | 是 | 本次清理的旧 smoke marker 名称 |
| `next_step` | string | 是 | 下一步状态：`"ready-to-smoke"` 或 `"deploy-done"` |

### 4.4 错误语义

`deploy-done --format json` 的错误仍使用通用错误 envelope，错误码建议包括：

- `PROJECT_NOT_INITIALIZED`
- `NO_ACTIVE_CHANGE`
- `CHANGE_NOT_FOUND`
- `VERIFY_NOT_PASSED`
- `DEPLOYMENT_DECISION_CONFLICT`
- `DEPLOYMENT_NOT_REQUIRED`
- `DEPLOY_TASKS_MISSING`
- `DEPLOYMENT_REPORT_MISSING`

任何错误分支都不得写入 `DEPLOY_DONE`，不得勾选 `[deploy]` 任务，也不得清理 smoke marker。

---

## 4. `openlogos verify --format json`

### 4.1 用法

```bash
openlogos verify                # 人类可读格式
openlogos verify --format json  # JSON 格式
```

### 4.2 JSON Schema（data 部分）

```jsonc
{
  "summary": {
    "defined_count": 10,          // 定义的测试用例总数（不含 [manual] 用例）
    "ut_count": 6,                // 单元测试用例数
    "st_count": 4,                // 场景测试用例数
    "manual_count": 2,            // 标记为 [manual] 的用例数（已从 defined_count 中排除）
    "executed_count": 10,         // 已执行的测试用例数
    "passed_count": 8,            // 通过数
    "failed_count": 1,            // 失败数
    "skipped_count": 1,           // 跳过数
    "uncovered_count": 0,         // 未覆盖数
    "coverage_pct": 100,          // 覆盖率百分比（整数）
    "pass_rate_pct": 80           // 通过率百分比（整数）
  },
  "gate": {
    "result": "FAIL",             // "PASS" | "FAIL"
    "reason": "failed_cases"      // 失败原因分类，见下表
  },
  "failed_cases": [
    {
      "id": "UT-S01-03",
      "error": "Expected 200, got 500"
    }
  ],
  "uncovered_cases": ["ST-S02-01"],
  "skipped_cases": ["UT-S01-05"],
  "checklist": {
    "total": 5,
    "checked": 5,
    "unchecked_items": []         // 未确认的覆盖度校验项
  },
  "ac_trace": {
    "total": 4,
    "passed": 3,
    "failed_criteria": [
      {
        "ac_id": "S01-AC-02",
        "description": "异常处理",
        "linked_case_ids": ["ST-S01-02"],
        "status": "FAIL"
      }
    ]
  },
  "pre_run": {
    "mode": "two_phase",          // "none" | "pre_run_command" | "two_phase"
    "commands": [
      {
        "stage": "regression",    // "pre_run" | "regression" | "incremental"
        "command": "npm test",
        "status": "pass",         // "pass" | "fail" | "skipped"
        "exit_code": 0,
        "duration_ms": 1200
      },
      {
        "stage": "incremental",
        "command": "npm run test:changed",
        "status": "pass",
        "exit_code": 0,
        "duration_ms": 600
      }
    ],
    "result_paths": {
      "final": "logos/resources/verify/test-results.jsonl",
      "regression": "logos/resources/verify/test-results.regression.jsonl",
      "incremental": "logos/resources/verify/test-results.incremental.jsonl"
    },
    "merge_strategy": "last-write-wins",
    "diagnostics": [],
    "suggestions": []
  },
  "sandbox": {
    "mode": "auto",               // "off" | "auto" | "always"
    "root": "/private/tmp",
    "isolated": true,
    "workspace_write_denied": true,
    "status": "pass",             // "pass" | "warn" | "fail" | "skipped"
    "diagnostics": [],
    "suggestions": []
  },
  "report_path": "logos/resources/verify/acceptance-report.md"
}
```

### 4.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `summary.defined_count` | number | 是 | 规格中定义的测试用例总数 |
| `summary.ut_count` | number | 是 | 其中的 UT 数量 |
| `summary.st_count` | number | 是 | 其中的 ST 数量 |
| `summary.executed_count` | number | 是 | 实际执行的用例数 |
| `summary.passed_count` | number | 是 | 通过的用例数 |
| `summary.failed_count` | number | 是 | 失败的用例数 |
| `summary.skipped_count` | number | 是 | 跳过的用例数 |
| `summary.uncovered_count` | number | 是 | 未覆盖的用例数 |
| `summary.coverage_pct` | number | 是 | 覆盖率（0-100 整数） |
| `summary.pass_rate_pct` | number | 是 | 通过率（0-100 整数） |
| `gate.result` | string | 是 | 门禁结果：`"PASS"` 或 `"FAIL"` |
| `gate.reason` | string \| null | 是 | FAIL 时的原因分类，PASS 时为 null |
| `failed_cases` | array | 是 | 失败的测试用例列表 |
| `uncovered_cases` | string[] | 是 | 未覆盖的用例 ID 列表 |
| `skipped_cases` | string[] | 是 | 跳过的用例 ID 列表 |
| `checklist.total` | number | 是 | 覆盖度校验项总数 |
| `checklist.checked` | number | 是 | 已确认的项数 |
| `checklist.unchecked_items` | array | 是 | 未确认项列表（含 text 和 file） |
| `ac_trace.total` | number | 是 | 验收条件总数 |
| `ac_trace.passed` | number | 是 | 通过的验收条件数 |
| `ac_trace.failed_criteria` | array | 是 | 未通过的验收条件列表 |
| `pre_run.mode` | string | 是 | verify 预跑模式：`"none"`、`"pre_run_command"` 或 `"two_phase"` |
| `pre_run.commands` | array | 是 | 实际执行或跳过的命令阶段 |
| `pre_run.commands[].stage` | string | 是 | `pre_run`、`regression` 或 `incremental` |
| `pre_run.commands[].command` | string | 是 | 实际执行的命令文本 |
| `pre_run.commands[].status` | string | 是 | `pass`、`fail` 或 `skipped` |
| `pre_run.commands[].exit_code` | number | 否 | 命令退出码 |
| `pre_run.commands[].duration_ms` | number | 否 | 命令执行时长 |
| `pre_run.result_paths.final` | string | 是 | 最终验收读取的 JSONL 路径 |
| `pre_run.result_paths.regression` | string \| null | 否 | 回归阶段结果路径 |
| `pre_run.result_paths.incremental` | string \| null | 否 | 增量阶段结果路径 |
| `pre_run.merge_strategy` | string \| null | 否 | 两阶段合并策略，当前为 `last-write-wins` |
| `pre_run.diagnostics` | string[] | 是 | 可展示给用户的问题诊断 |
| `pre_run.suggestions` | string[] | 是 | 可展示给用户的修复建议 |
| `sandbox.mode` | string | 是 | verify 沙箱模式：`"off"`、`"auto"` 或 `"always"` |
| `sandbox.root` | string | 是 | 沙箱根目录 |
| `sandbox.isolated` | boolean | 是 | 本次执行是否实际隔离 |
| `sandbox.workspace_write_denied` | boolean | 是 | 是否拒绝写入仓库工作区 |
| `sandbox.status` | string | 是 | 沙箱执行结果 |
| `sandbox.diagnostics` | string[] | 是 | 沙箱诊断信息 |
| `sandbox.suggestions` | string[] | 是 | 沙箱修复建议 |
| `report_path` | string | 是 | 生成的验收报告路径 |

### 4.4 gate.reason 取值

| 值 | 说明 |
|----|------|
| `null` | 门禁通过 |
| `"failed_cases"` | 存在失败的测试用例 |
| `"incomplete_coverage"` | 存在未覆盖的测试用例 |
| `"checklist_incomplete"` | 设计时覆盖度校验未完全确认 |
| `"ac_trace_incomplete"` | 验收条件追溯未完全通过 |

### 4.5 预跑状态兼容规则

- 旧项目只配置 `verify.pre_run_command` 时，`pre_run.mode="pre_run_command"`。
- 配置 `verify.regression_command` 或 `verify.incremental_command` 时，`pre_run.mode="two_phase"`。
- 没有任何预跑命令时，`pre_run.mode="none"`。
- `sandbox_mode="off"` 时，`sandbox.status="skipped"`，并保持历史兼容行为。
- `sandbox_mode="auto"` 时，环境支持隔离则 `sandbox.status="pass"`，不支持则 `sandbox.status="warn"` 并给出降级原因。
- `sandbox_mode="always"` 时，若无法隔离则必须失败。
- 覆盖不足且 `pre_run.mode="none"` 时，必须输出局部测试诊断和配置建议。

---

## 5. `openlogos smoke --format json`

冒烟测试用于验收部署后的目标环境是否可用，不并入 `openlogos verify`。

### 5.1 用法

```bash
openlogos smoke                # 人类可读格式
openlogos smoke --format json  # JSON 格式
openlogos smoke --env staging
openlogos smoke --env production --format json
```

### 5.2 JSON Schema（data 部分）

```jsonc
{
  "environment": "staging",             // smoke 目标环境；未指定时为 null
  "summary": {
    "defined_count": 5,                 // 定义的 smoke 用例数
    "executed_count": 5,                // 已执行 smoke 用例数
    "passed_count": 5,
    "failed_count": 0,
    "skipped_count": 0,
    "uncovered_count": 0,
    "coverage_pct": 100,
    "pass_rate_pct": 100
  },
  "gate": {
    "result": "PASS",                  // "PASS" | "FAIL"
    "reason": null                     // 失败原因分类
  },
  "failed_cases": [],
  "uncovered_cases": [],
  "skipped_cases": [],
  "changed_cases": [],
  "diagnostics": [],
  "runners": [],
  "sandbox": {
    "mode": "auto",               // "off" | "auto" | "always"
    "root": "/private/tmp",
    "isolated": true,
    "workspace_write_denied": true,
    "status": "pass",             // "pass" | "warn" | "fail" | "skipped"
    "diagnostics": [],
    "suggestions": []
  },
  "report_path": "logos/resources/verify/smoke-report.md",
  "result_path": "logos/resources/verify/smoke-results.jsonl"
}
```

### 5.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `environment` | string \| null | 是 | 目标环境，由 `--env` 指定 |
| `summary.defined_count` | number | 是 | smoke 用例规格中定义的用例数 |
| `summary.executed_count` | number | 是 | smoke 结果中实际执行的用例数 |
| `gate.result` | string | 是 | `PASS` 或 `FAIL` |
| `gate.reason` | string \| null | 是 | 失败原因，如 `failed_cases` / `incomplete_coverage` / `smoke_runner_missing` / `smoke_reporter_missing` / `smoke_cases_uncovered` |
| `changed_cases` | string[] | 是 | 当前活跃提案新增或修改的 `SMOKE-*` 用例 ID；无活跃提案或无 smoke 变更时为空 |
| `diagnostics` | array | 是 | smoke 覆盖预检诊断；每项包含 `code`、`message`、可选 `case_ids` / `runner_paths` / `result_path` |
| `runners` | string[] | 是 | 静态发现的 `scripts/smoke-*` runner 路径 |
| `failed_cases` | array | 是 | 失败 smoke 用例 |
| `uncovered_cases` | array | 是 | 未覆盖 smoke 用例 ID |
| `sandbox.mode` | string | 是 | smoke 沙箱模式：`"off"`、`"auto"` 或 `"always"` |
| `sandbox.root` | string | 是 | 沙箱根目录 |
| `sandbox.isolated` | boolean | 是 | 本次执行是否实际隔离 |
| `sandbox.workspace_write_denied` | boolean | 是 | 是否拒绝写入仓库工作区 |
| `sandbox.status` | string | 是 | 沙箱执行结果 |
| `sandbox.diagnostics` | string[] | 是 | 沙箱诊断信息 |
| `sandbox.suggestions` | string[] | 是 | 沙箱修复建议 |
| `report_path` | string | 是 | smoke 报告路径 |
| `result_path` | string | 是 | smoke 结果路径 |

`openlogos smoke` 与 `openlogos verify` 共享 JSONL 结果思想，但读取的是 `smoke.result_path`，默认 `logos/resources/verify/smoke-results.jsonl`。冒烟测试用例建议存放在 `logos/resources/test/smoke/`。

### 5.4 兼容规则

- `smoke.command` 仍按既有语义执行。
- `sandbox_mode` / `sandbox_root` / `sandbox_deny_workspace_write` 仅影响执行环境，不改变 smoke 门禁定义。
- 当沙箱失败时，`smoke` 仍应写入结果报告，但 JSON 输出必须明确失败原因。
- 当活跃提案新增或修改 `SMOKE-*` 用例时，`openlogos smoke` 必须额外执行 smoke 覆盖预检：缺少可达 runner 时输出 `smoke_runner_missing`，发现 runner 但没有有效结果时输出 `smoke_reporter_missing`，新增 ID 没有执行结果时输出 `smoke_cases_uncovered`。
- 推荐 `smoke.command` 指向 `node scripts/run-smoke.js` 统一 dispatcher；dispatcher 自动发现并执行 `scripts/smoke-*` runner。

---

## 6. 错误处理

当命令因错误退出时（如项目未初始化、找不到文件等），JSON 模式下输出错误 JSON 到 **stderr** 并以非零退出码退出：

```jsonc
{
  "command": "<command-name>",
  "version": "<cli-version>",
  "timestamp": "<ISO-8601>",
  "error": {
    "code": "PROJECT_NOT_INITIALIZED",
    "message": "logos/logos.config.json not found."
  }
}
```

### 6.1 错误码

| 错误码 | 说明 |
|--------|------|
| `PROJECT_NOT_INITIALIZED` | 当前目录不是 OpenLogos 项目 |
| `NO_TEST_RESULTS` | 找不到测试结果文件 |
| `NO_TEST_CASES` | 找不到测试用例规格文件 |
| `FLOW_NOT_FOUND` | 内置 flow 模板缺失 / 无法定位 |
| `FLOW_SCHEMA_INVALID` | flow 或 overlay 校验失败（含 overlay-add 谓词不可求值、launched builtin skip/reorder、`op:modify` 覆盖 `id`、`cmd:` 用于 builtin、同节点双 cmd、`cmd_timeout_seconds` < 1 等）|
| `FLOW_CMD_SPAWN_FAILED` | `cmd:` 命令的 **shell 进程本身无法启动**（child_process `'error'` 事件，如 shell 缺失 / `EACCES`）；message 含节点 id + 命令名 + errno。**命令不存在（shell exit 127/9009）不属此类**，按非 0 走 success envelope |

> `openlogos watch` 的错误仍使用通用错误 envelope（`command: "watch"`）；项目未初始化时输出 `PROJECT_NOT_INITIALIZED` 并以非零退出码退出，不进入轮询循环。`openlogos next --auto` 的错误沿用 `next` 既有错误语义（如 `PROJECT_NOT_INITIALIZED` / `NO_ACTIVE_CHANGE`），不新增错误码。

### 6.2 overlay 派生错误信封

派生（`status` / `next` / `watch` 调 `collectStatusData`）抛 `FlowError` 时，命令以
**`makeErrorEnvelope(command, e.code, e.message)`** 输出到 stderr 并非零退出——**`code` 取 `e.code`、不硬编码**
（`FlowErrorCode` ∈ `PROJECT_NOT_INITIALIZED` / `FLOW_NOT_FOUND` / `FLOW_SCHEMA_INVALID`，见 §6.1）。
本切片新增的语义错误——**launched builtin `skip`/`reorder`**、**overlay-add 节点谓词组合不可求值**——`code` 为 `FLOW_SCHEMA_INVALID`。
`watch` 命中该错误时不进入 / 停止轮询。

---

## 7. `openlogos module list --format json`

列出项目中注册的所有模块及其生命周期状态。

### 7.1 用法

```bash
openlogos module list                # 人类可读格式
openlogos module list --format json  # JSON 格式
```

### 7.2 JSON Schema（data 部分）

```jsonc
{
  "modules": [
    {
      "id": "core",
      "name": "核心功能",
      "lifecycle": "initial"    // "initial" | "launched"
    },
    {
      "id": "payment",
      "name": "支付模块",
      "lifecycle": "launched"
    }
  ]
}
```

### 7.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `modules` | array | 是 | 模块列表（与 `logos-project.yaml` 中的顺序一致） |
| `modules[].id` | string | 是 | 模块标识符（小写字母/数字/连字符） |
| `modules[].name` | string | 是 | 模块名称 |
| `modules[].lifecycle` | string | 是 | 模块生命周期：`"initial"` 或 `"launched"` |

> 若项目未注册任何模块，`modules` 为空数组 `[]`，不报错。

---

## 8. 完整用法示例

```bash
# 获取项目状态（机器可读）
openlogos status --format json | jq '.data.current_phase'

# 获取 CLI 版本和项目探测信息
openlogos detect --format json | jq '.data.cli.version'

# 获取测试验收摘要
openlogos verify --format json | jq '.data.gate.result'

# 列出所有模块的生命周期
openlogos module list --format json | jq '.data.modules[] | {id, lifecycle}'

# 在脚本中检查是否有 launched 模块
openlogos module list --format json | jq -e '.data.modules | any(.lifecycle == "launched")'

# 在脚本中检查门禁结果
if openlogos verify --format json 2>/dev/null | jq -e '.data.gate.result == "PASS"' > /dev/null; then
  echo "All tests passed!"
fi
```

---

## 9. `openlogos flow show --format json`

查看 OpenLogos 研发流程编排：默认输出内置 raw flow，`--resolved` 输出应用项目 overlay 合并后的生效流程。本命令为只读，不写文件、不接入 status / next 派生。

### 9.1 用法

```bash
openlogos flow show                                  # 内置 raw flow（人类可读）
openlogos flow show --format json                    # 内置 raw flow（JSON）
openlogos flow show --resolved --format json         # overlay 合并后的生效流程（JSON）
openlogos flow show --lifecycle launched --format json
```

### 9.2 JSON Schema（data 部分）

```jsonc
{
  "lifecycle": "initial",          // "initial" | "launched"，本次查看的 flow
  "resolved": false,               // 是否为 overlay 合并后的生效流程（--resolved 时为 true）
  "overlay_applied": false,        // 是否实际应用了项目 logos/flow/<lifecycle>.yaml overlay
  "builtin_version": "v1",         // 内置模板内容版本（对应 extends 的 @vN）
  "warnings": [                    // 解析告警；无告警时为空数组
    {
      "code": "FLOW_VERSION_MISMATCH",
      "message": "overlay 引用 builtin:initial@v1，内置模板当前为 v2，请复核 overlay 是否仍引用有效 node id"
    }
  ],
  "flow": {                        // flow 结构本体（subflows / nodes / gates）
    "flow": "initial",             // flow id（与文件名一致）
    "version": 1,                  // flow 文件 schema 版本（整数）
    "extends": null,               // resolved 时可保留来源；raw 内置为 null
    "subflows": [
      {
        "id": "why",
        "name": "WHY 需求",
        "when": null,              // subflow 级条件，可选
        "loop": null,              // 可选；M1 退化环
        "gate": {
          "type": "human",         // "none" | "human" |（"cmd" 为 M2 预留）
          "position": "exit",      // "entry" | "exit"
          "skippable": true
        },
        "nodes": [
          {
            "id": "prd",
            "name": "需求",
            "skill": "prd-writer",
            "when": "bootstrap != adopted",
            "for_each": null,
            "produces": "logos/resources/prd/1-product-requirements/",
            "done_when": "dir_nonempty",
            "fail_when": null,
            "skipped": false,        // resolved 输出：overlay skip 或 when=false 生效时为 true（节点保留不删除）
            "overlay_op": null       // resolved 输出：触及该节点的 overlay 操作 "skip"|"add"|"modify"|"reorder"|null
          }
          // ... 其余 nodes
        ]
      }
      // ... 其余 subflows
    ]
  }
}
```

### 9.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `lifecycle` | string | 是 | 本次查看的 flow：`"initial"` 或 `"launched"` |
| `resolved` | boolean | 是 | 是否为 overlay 合并后的生效流程；`--resolved` 时为 true |
| `overlay_applied` | boolean | 是 | 是否实际应用了项目 `logos/flow/<lifecycle>.yaml` overlay（无 overlay 文件时为 false，即便 `--resolved`）|
| `builtin_version` | string | 是 | 内置模板内容版本，对应 `extends` 的 `@vN`（如 `"v1"`）|
| `warnings` | array | 是 | 解析告警列表；无告警为 `[]` |
| `warnings[].code` | string | 是 | 告警码，如 `"FLOW_VERSION_MISMATCH"` |
| `warnings[].message` | string | 是 | 告警可读描述 |
| `flow` | object | 是 | flow 结构本体 |
| `flow.flow` | string | 是 | flow id（与文件名一致）|
| `flow.version` | number | 是 | flow 文件 schema 版本（整数）|
| `flow.extends` | string \| null | 否 | overlay 基线引用；raw 内置为 null |
| `flow.subflows` | array | 是 | 有序子流程列表 |
| `flow.subflows[].id` | string | 是 | subflow id |
| `flow.subflows[].name` | string | 是 | subflow 展示名 |
| `flow.subflows[].when` | string \| null | 否 | subflow 级条件 |
| `flow.subflows[].loop` | object \| null | 否 | loop 字段；M1 解析但按退化环处理 |
| `flow.subflows[].gate` | object | 是 | 门禁定义 |
| `flow.subflows[].gate.type` | string | 是 | `"none"` \| `"human"`（`"cmd"` 为 M2 预留）|
| `flow.subflows[].gate.position` | string | 是 | `"entry"` \| `"exit"`（默认 exit）|
| `flow.subflows[].gate.skippable` | boolean | 是 | auto 模式下该 human gate 是否允许自动跳过 |
| `flow.subflows[].nodes` | array | 是 | 有序 node 列表 |
| `flow.subflows[].nodes[].id` | string | 是 | node id，flow 内全局唯一 |
| `flow.subflows[].nodes[].name` | string | 是 | node 展示名 |
| `flow.subflows[].nodes[].skill` | string \| null | 否 | 绑定 skill |
| `flow.subflows[].nodes[].when` | string \| null | 否 | 条件谓词 |
| `flow.subflows[].nodes[].for_each` | string \| null | 否 | fan-out 维度 |
| `flow.subflows[].nodes[].produces` | string \| null | 否 | 产出位置/模板 |
| `flow.subflows[].nodes[].coverage_threshold` | number | 否 | fan-out 聚合阈值（`0 < x <= 1`）；**仅 `done_when: all_present` 的 fan-out 节点可设**。**仅在 overlay 显式设置了有效 number 时才作为键出现；未设置则该键完全省略**（**绝不输出 `null`**）。非法值（越界/非数）**或设在非 `all_present` 节点** → `FLOW_SCHEMA_INVALID`（fail loud） |
| `flow.subflows[].nodes[].done_when` | string \| null | 否 | 完成判定谓词 |
| `flow.subflows[].nodes[].fail_when` | string \| null | 否 | 失败/阻塞判定谓词 |
| `flow.subflows[].nodes[].skipped` | boolean | 否 | **resolved 输出专用**：节点是否被标记 skipped（overlay `skip` 或 `when=false` 生效；节点**保留不删除**）。raw 输出省略或为 false |
| `flow.subflows[].nodes[].overlay_op` | string \| null | 否 | **resolved 输出专用**：触及该节点的 overlay 操作 `"skip"`/`"add"`/`"modify"`/`"reorder"`/null；raw 输出为 null |

- **`coverage_threshold` 省略-非-null（保 flow show 零漂移，关键，S29）**：与 `skill`/`when`/`for_each` 等**恒为 `null`** 的兄弟字段**不同**——`coverage_threshold` **未显式设置时必须整键省略，不得物化为 `coverage_threshold: null`**；若 overlay YAML 写了 `coverage_threshold: null`，派生时**normalize 为 absent**（视同未设置、省略）。这样既有所有节点的 flow show 快照**不新增键** → builtin / 未设阈值项目 `flow show` 逐字节不变。
- **fan-out done 语义（S29）**：`done_when: all_present` 的节点，其 done 判定为 `covered / total >= coverage_threshold`（缺省阈值 = `1.0` → 等价「全部就绪」）；`total == 0` 维持 `all_present` 现状（视为未 done）。覆盖度对象 `{ total, covered, missing }` 不变；status/watch 的 `scenario_coverage` 结构不变，其 `done` 在设置阈值时按阈值判定。builtin 模板不写 `coverage_threshold` → 行为与 `all_present` 1:1 → golden 零漂移。

### 9.4 错误语义

`flow show --format json` 的错误仍使用通用错误 envelope（见「错误处理」一节），错误码建议包括：

- `PROJECT_NOT_INITIALIZED` — 当前目录不是 OpenLogos 项目
- `FLOW_NOT_FOUND` — 包内内置模板或指定 `--lifecycle` 对应的 flow 不存在
- `FLOW_SCHEMA_INVALID` — flow 文件或 overlay 基础 schema 校验失败（未知 op、缺必填字段、target node id 不存在等），message 应指出具体非法位置
- `FLOW_VERSION_MISMATCH` — 仅作为 `warnings[]` 中的**告警码**出现（不阻断解析）；不作为错误 envelope 的 `error.code`

错误分支不输出半成品 `flow`；schema 非法时必须以 `FLOW_SCHEMA_INVALID` 失败，而非静默返回部分合并结果。

---

## 10. `openlogos watch --format json`（实时派生状态流）

`openlogos watch` 是 `status` 的实时版：轮询 `collectStatusData`（与 `status` 同一派生数据源），把一次性快照变成实时流。本命令**只读**，不写文件、不推进状态、不接入 status / next 的写副作用。

### 10.1 用法

```bash
openlogos watch                          # 文本模式
openlogos watch --format json            # JSON 流
openlogos watch --interval 5             # 轮询间隔 5 秒（默认 2 秒）
openlogos watch --module core            # 继承 --module 过滤
openlogos watch --module core --format json
```

### 10.2 流契约（须严格遵守）

- **启动先输出一次初始快照**（`seq=0`，`event="snapshot"`），无需等到下一次变化。
- 之后**仅在派生状态变化时**输出一条（`event="change"`，`seq` 递增）。
- **变化判定** = 相邻两次 `collectStatusData` 的 `data` 深比较（深相等则不输出）。
- 每条输出携带递增 `seq` 与 `timestamp`。
- `data.status` 与 `openlogos status --format json` 的 `data` **同构**（同一派生结构）。
- **继承 `--module`**：派生与变化判定仅针对该模块，等价 `openlogos status --module <id>` 的派生数据。
- **退出**：Ctrl-C / SIGINT 优雅退出，全程无写副作用。
- **错误**：项目未初始化时输出 `PROJECT_NOT_INITIALIZED` 错误 envelope（到 stderr）并以非零退出码退出，不进入轮询循环。

### 10.3 JSON Schema（每条 envelope 的 data 部分）

```jsonc
{
  "seq": 0,                         // 事件序号，从 0（初始快照）起递增
  "event": "snapshot",             // "snapshot"（初始快照）| "change"（变化事件）
  "module": "core",                // 继承的 --module 过滤；未指定时为 null
  "status": { /* 与 openlogos status 的 data 同构 */ }
}
```

### 10.4 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `seq` | number | 是 | 事件序号；初始快照为 0，之后每条变化事件递增 |
| `event` | string | 是 | `"snapshot"`（启动初始快照）或 `"change"`（后续仅变化时输出） |
| `module` | string \| null | 是 | 继承的 `--module` 过滤值；未指定时为 null |
| `status` | object | 是 | 派生状态，结构与 `openlogos status --format json` 的 `data` 一致 |

> 注：顶层 envelope 的 `timestamp` 即该条事件的产生时间；每条 envelope 独立成行（行分隔的 JSON 流）。

### 10.5 watch 的 overlay 派生字段（继承 status data）

`openlogos watch` 的每条 envelope `data` **结构同构于 `status` data**（见 §10.3）。因此 §3.6 / §3.7 的
`overlay_nodes` / `current_node` 字段、§3.9 的 `loop_state` 字段及其省略规则**对 watch 同样适用**——
存在已到达 overlay-added 节点 / loop 激活时随流输出，无 overlay / 未激活时省略（流内容与未引入相应切片时一致）。
watch 为**观察派生**：遇 loop 只读账本展示 `loop_state`、**不执行测试、不写账本**。

---

## `openlogos next --format json`（base data）

`openlogos next --format json` 的 base `data` 新增 `modules[].current_node`（结构同 §3.6），
**仅当当前节点为 overlay-added 时输出**，否则省略；legacy 无 `modules[]` 时回退顶层 `current_node`。
默认（无 overlay）`next` **不新增 `current_node`**（此处仅就 `current_node` 而言）；**`next_node`（S28）另按下文规则输出**——即默认 builtin 当前节点也会带 `next_node`。`--auto` 的 gate 字段见下节 §11。

### next_node 编排提示字段（S28）

`openlogos next` 的 `data` 新增 **`next_node`** 对象——把「下一步该处理的真实 flow node 用哪个 skill/agent、要不要跑脚本」
以机器字段透出给宿主编排。**仅 `next` 暴露**（`status`/`watch` 不输出）；仍 **A 被动派生**：字段是不透明标签，OpenLogos 不解释、
不映射 agent、不执行 script，是否执行/以何权限执行由宿主决定。

**总定义**：`next_node` = 取自 **resolved flow（含 overlay）** 的「**本次 `next` 响应最终建议处理的真实 flow node**」的 hints。
**默认 = 当前前沿节点**；R3（cmd 续推）/ R4（auto 放行）/ R7（loop 阻塞）/ R5（命令级建议）/ R8（切片出口门前沿）是对默认的例外（见下）。

**字段与类型**（对象本身可省略；一旦出现，`id`/`name`/`subflow_id`、下列 5 个 hint 字段与 `dispatch`（完整对象）固定存在，`gate_id` / `slice` / `slice_children` / `requires_reviewed` 为可选）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `next_node.id` | string | 节点 id（取自 resolved flow）|
| `next_node.name` | string | 节点展示名 |
| `next_node.subflow_id` | string | 所属 subflow id |
| `next_node.skill` | string \| null | 绑定的 skill；无绑定为 `null`（如 verify/deploy/smoke 由 CLI 驱动、`skill` 为 `null`）|
| `next_node.working_agent` | string \| null | working agent 标签；无绑定为 `null` |
| `next_node.review_agent` | string \| null | review agent 标签；无绑定为 `null` |
| `next_node.pre_script` | string \| null | 前置脚本；无为 `null` |
| `next_node.post_script` | string \| null | 后置脚本；无为 `null` |
| `next_node.dispatch` | object | **恒存在的完整派发契约对象**（contract-self-description）：`{"idempotent": bool, "timeout_seconds": int, "artifacts_hint": string[]}`，无二义分支，规则见下文「dispatch 派发契约」 |
| `next_node.dispatch.idempotent` | boolean | 该节点派发重投是否安全；`false` = 重投不安全 |
| `next_node.dispatch.timeout_seconds` | integer | 派发超时秒数；唯一默认值源（fallback） = flow 文件顶层 `defaults.dispatch.timeout_seconds`（resolved 时物化进每个节点，输出层不再有第二处默认） |
| `next_node.dispatch.artifacts_hint` | string[] | 节点产物提示（如 `["proposal.md"]`）；`[]` ＝「产物未知」契约语义：消费方不得据此判死，只能升级观察 |
| `next_node.requires_reviewed` | string[] | **可选**。节点声明的前置评审要求（如 apply-merge 声明 `["proposal","delta"]`）；driver 的 `priorReviewNode` 本地映射表退化为消费该声明。未声明时省略 |
| `next_node.gate_id` | string | **可选**。当前沿是「某 flow node 已完成、停在其所属 subflow 的出口/入口人类门待批准」时出现，值 = 派生 gate id（`<subflow.id>-<gate.position>`，见 §11）。**出现即表示：该节点的产出已完成、宿主不得再派该节点的 skill 重跑，而应把它当人类门处理（半自动停等确认；`--auto` 则该门被自动放行、见 R4）**。非门前沿时省略（R8） |

- **`skill`/`working_agent`/`review_agent`/`pre_script`/`post_script` 这 5 个 hint 字段固定存在、用 `null` 表示无绑定**；
  消费方**不得**把 `skill` 当作必有 `string`。
- **`gate_id` 是可选子字段，出现与否是消费方区分「派节点 vs 停门」的判据**——不出现时按 `id` 派节点的 skill/agent；出现时前沿在门上、不重派节点。**注意与顶层 `gate_id`（§11 gate 字段表）区分**：顶层 `gate_id` 仅 `--auto` 输出、描述「当前 `--auto` 放行/停在的门」；`next_node.gate_id` 是**前沿子字段、任意档（含默认 `next`）均可出现**、描述「前沿节点后紧邻的待批准门」。二者在语义与出现条件上均不同，不得混用。
- 取自 **resolved flow** → overlay `modify code set:{review_agent: my-reviewer}` 会如实反映为 `next_node.review_agent = "my-reviewer"`。

**dispatch 派发契约（contract-self-description）**：

- 每个 `next_node` 恒带完整 `dispatch: {"idempotent": bool, "timeout_seconds": int, "artifacts_hint": string[]}`；节点可另声明 `requires_reviewed: string[]`。
- **权威数据源 = flow 节点定义**（内置模板 `spec/flow/initial.yaml`、`spec/flow/launched.yaml` 逐节点人工声明，**不从 produces/done_when 推导**——推导算法本身会成为新的隐式世界模型）；显式声明则以声明为准；resolved flow 派生把节点元数据透传进 `next_node`。
- **overlay-add 未声明 `dispatch` 时的保守默认（完整对象，消灭实现自行猜测）**：

```yaml
dispatch:
  idempotent: false            # 未声明即视为重投不安全（宁慢勿错杀）
  timeout_seconds: <flow 文件 defaults.dispatch.timeout_seconds>
  artifacts_hint: []           # 空数组 = 「产物未知」，语义写入契约：
                               # 消费方不得以 artifacts_hint 为空/不达作为判死依据，只能升级观察
```

- `timeout_seconds` 的**唯一默认值源（fallback）** = flow 文件顶层新增 `defaults: {dispatch: {timeout_seconds: 900}}`（内置模板给出具体数值，项目 overlay 可覆盖；resolved 时物化进每个节点）。flow 文件 schema `version: 1` 保持不变（字段为向后兼容扩展）。
- 内置节点声明基准（权威声明在 flow 模板，此处为口径摘要）：内容产出/评审节点（write-proposal、write-tasks、write-delta、plan-slices、review 类、code）idempotent:true；一次性落盘/执行节点（apply-merge、deploy、archive 类）idempotent:false；verify/smoke 命令节点 idempotent:true。timeout_seconds：默认 900，code/implement 类 3600，deploy 类 1800。artifacts_hint 写该节点的具体产物提示（如 `["proposal.md"]`、`["logos/resources/**","SPEC_MERGED"]`）。apply-merge 声明 `requires_reviewed: ["proposal","delta"]`。

**挂载位置（与 `current_node`/`loop_state` 同构）**：有 `modules[]` → `modules[].next_node`；legacy 无 `modules[]` → 顶层 `next_node`。

**前沿节点解析（默认，无例外时）**：overlay `current_node` 存在 → 取该节点；否则 launched 用 `STEP_TO_CURRENT_BUILTIN[proposal_step]`、
initial 用 `current_phase → PHASE_KEY_TO_NODE_ID`（显式正向 map，**不**反查 `NODE_TO_PHASE_KEY`）定位 builtin 节点 id，再从 resolved flow 取 hints。

**例外**：
- **【R3】cmd 瞬态求值（overlay-add 节点 + builtin verify/deploy/smoke cmd gate，S30）**：`next_node` 取**本次响应 cmd 求值（cmdEval 回灌）后**的最终节点——`done_when:cmd` `exit 0` 续推 → 指向**续推后**节点（**不**指向已 done 的 cmd 节点/gate）；`fail_when:cmd` `exit 0` → 该节点/gate `failed` → 指向**该 cmd 节点/gate**；cmd 非 0/超时 → 指向**该 cmd 节点/gate**（求值后 `active`/停门前）；budget=1 遇第二个 cmd → 指向**第二个 pending cmd** 节点/gate。builtin gate id 取 `cmd_gate.node_id`。
- **【R4】`--auto` 放行**：`gate_auto_passed === true` 时默认**省略 `next_node`**（放行后宿主走 gate 的 command，下一节点待重新 `next` 派生）。**例外一：`gate_id === "plan-exit"` 时，CLI 已写入 `PLAN_APPROVED` 并重新派生到 `write-delta`，本次响应必须输出 `next_node.id == "write-delta"`。例外二（split-slice-planner-stage）：仅当 `gate_id === "slice-exit"`、`gate_auto_passed === true` 且 CLI 已确认 `[code]` 满足 `tasks_code_filled` 时，CLI 才会写入 `SLICES_APPROVED` 并重新派生到 `coding` / `code` 前沿，本次响应必须输出 `next_node.id == "code"`。若 `[code]` 未脱模板，则 `slice-exit` 尚未到达，不适用 R4 放行例外；响应必须按 R8 走 `plan-slices` 节点前沿。** `--auto` 放行态下 `next_node` 不带 `gate_id`（门已被消费，非"待批准"，见 R8）。
- **【R7】loop 阻塞**：未达上限 → `next_node` = loop subflow 的**工作节点**（overlay `current_node` 优先；否则 resolved flow 中 `id == "code"` 且未 `skipped` 的节点，**非 `verify`**，对齐 action「修代码」）；`code` 缺失/被 overlay `skip` → **省略**（仅 initial 等**合法 resolved flow**——launched 对 builtin `code` 的 `skip`/`reorder` 在派生入口已 `FLOW_SCHEMA_INVALID`、走不到此省略）；达上限（`escalated`）→ **省略**（宿主读 `loop_state.escalated`）。与 `loop_state` 互补：环状态看 `loop_state`，这一轮派哪个节点的 skill/agent 看 `next_node`。
- **【R5】命令级建议**：当前建议不指向某 flow node（`all_done` / launched 无 active proposal → `openlogos change <slug>` / 补 baseline → `openlogos change add-baseline-docs` / `openlogos launch` 等）→ **省略 `next_node`**。`plan-exit` / `slice-exit` auto 消费后已分别指向真实 `write-delta` / `code` 节点，不按命令级建议省略。
- **【R8】切片出口门前沿（默认 `next`，含半自动/手动；本次修复）**：`proposal_step == "ready-to-implement"` 是「`plan-slices` 节点完成判定 `tasks_code_filled` 二分」的驻留态，`next_node` 据此二分（落地 `spec/flow-spec.md` §12.5(2)/§12.6(2) 已规定的前沿）：
  - `[code]` 仍为模板（未 `tasks_code_filled`）→ `plan-slices` 未完成，前沿 = 该节点：`next_node.id == "plan-slices"`、**不带** `gate_id`。默认 `next` 与 `next --auto` 在此前沿上一致：宿主应派 slice-planner 规划切片，CLI 不得自动消费 `slice-exit`。
  - `[code]` 已脱模板（`tasks_code_filled`）且 `SLICES_APPROVED` **不存在** → `plan-slices` 完成、前沿移到 `slice` 出口门：`next_node.id == "plan-slices"` **并附加** `next_node.gate_id == "slice-exit"`（宿主**不得**再派 slice-planner；半自动/手动停等人类在 `slice-exit` 门确认，`--auto` 则按 R4 例外二自动放行、消费后 `next_node.id == "code"` 且无 `gate_id`）。
  - `SLICES_APPROVED` 已存在（门已消费）→ `proposal_step == "coding"`、`next_node.id == "code"`、无 `gate_id`（不属本例外，走默认前沿）。
  - **动机**：修复「半自动 driver 以 `next_node` 派活时，`ready-to-implement` 恒得 `next_node.id == "plan-slices"`（切片写好也不带门信号）→ 反复重派 slice-planner 死循环」的 openlogos 侧根因。此前仅顶层 `--auto` `gate_id` 落地，`next_node.gate_id`（flow-spec §12.5 承诺的前沿子字段）从未实现。

**golden**：`next_node` 对有当前节点的项目新增 → `next --format json` 快照更新（本切片有意为 next 加字段、重新 baseline）；「`status`/`watch`/`flow show` 输出不变」是 S28 切片的**历史局部口径，已被 contract-self-description 的提案级差异白名单覆盖、在本提案内不再成立**（全部 9 个 status/next golden 快照均**允许且要求**新增 `data.contract`——与 §1.2 的全量重拍声明一致；活跃提案快照允许 `step_meta`/`facts`；launched 活跃提案用例 5/6/8/9 允许且要求 pre-implement `loop_state` 缺席；`flow show` 允许顶层 `defaults` 与逐节点 `dispatch`/`requires_reviewed`；白名单之外逐字节零漂移，复核锚 = ST-S28-11）。本次修复新增 `plan-exit` auto 例外，`next --auto --format json` 的相关 golden 需要同步重拍并复核差异仅为 `proposal_step` 前移、`next_node=write-delta` 与一次性 `PLAN_APPROVED` 副作用；split-slice-planner-stage 新增 `slice-exit` auto 例外，差异须仅为 `proposal_step` 由 `ready-to-implement` 前移到 `coding`、`next_node=code` 与一次性 `SLICES_APPROVED` 副作用。fix-next-node-slice-exit-frontier（R8）新增「切片已划未批准」态的 `next_node.gate_id == "slice-exit"`：默认 `next --format json` 相关 golden 已重拍，该态下 `next_node` 新增可选 `gate_id` 字段。**contract-self-description（主动破例）破 R8「既有字段逐字节不变」锚**：此前锚定的「`id`/`name`/`subflow_id`/5 个 hint 逐字节不变」既有 8 字段口径由本提案主动破例——`next_node` 新增恒存在的 `dispatch` 完整对象与可选 `requires_reviewed` 子字段，next golden（用例 2/6）重拍，差异须严格限定为新增这两个子字段（既有 8 字段的取值逐字节不变；`--auto` 放行态与其它 proposal_step 的既有字段输出不变）。

---

## 11. `openlogos next --auto` 的 gate 字段

`openlogos next --auto`（skip-gate）在既有 `next` data 基础上附带 gate 决策字段，描述当前停顿点对应的 launched flow gate 及 auto 放行结果。**默认 `next`（无 `--auto`）不输出这些 gate/auto 字段；此处「`data` 1:1 不变」仅就 auto/gate 字段而言——默认 `next` 仍按 base data 契约输出，含 S28 的 `next_node`。**

```jsonc
{
  // ... 既有 next data 字段 ...
  "auto": true,
  "gate_id": "plan-exit",
  "skippable": true,
  "gate_auto_passed": true
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `auto` | boolean | 否 | 是否启用 `--auto`；默认 `next` 省略或为 false |
| `gate_id` | string \| null | 否 | 当前停顿点对应的 launched gate id；`ready-to-delta`→`plan-exit`、`ready-to-merge`→`spec-exit`、`ready-to-implement`→`slice-exit`、`ready-to-deploy`→`deliver-entry`；无对应 gate（如 `ready-to-smoke`）时为 null |
| `skippable` | boolean \| null | 否 | 该 human gate 是否允许 auto 跳过：`ready-to-delta` / `ready-to-merge` / `ready-to-implement` / `ready-to-deploy`→true；达上限 `loop-exhausted`→默认 false |
| `gate_auto_passed` | boolean | 否 | 本次 `--auto` 是否实际放行并追加审计。`plan-exit` 放行还必须写入 `PLAN_APPROVED`、`slice-exit` 放行还必须写入 `SLICES_APPROVED`；`skippable:false` 或无 gate 时为 false；放行依据为本次响应而非历史审计行 |

`ready-to-implement` 的 gate 字段是**到达 slice 出口门后**的字段，不是该驻留态的无条件字段。CLI 必须先用 `tasks_code_filled` 二分 `ready-to-implement`：未脱模板时 `gate_id` 不得为 `"slice-exit"`，`gate_auto_passed` 不得为 `true`；已脱模板且 `SLICES_APPROVED` 不存在时，才允许输出 / 消费 `"slice-exit"`。

**`gate_id` 派生规则（契约闭合）**：`spec/flow/launched.yaml` 的 gate 挂在 subflow 上、无显式 id 字段，
故 `gate_id` 为**派生值** = `<subflow.id>-<gate.position>`（`gate.position` 缺省为 `exit`）。
据此：plan subflow 出口 gate → **`plan-exit`**；spec subflow 出口 gate → **`spec-exit`**；slice subflow 出口 gate → **`slice-exit`**；deliver subflow 的入口 gate → **`deliver-entry`**。
实现侧 gate 助手须按此规则生成 `gate_id`。

**plan-exit 消费后的同次响应**：当 `gate_id=="plan-exit"` 且 `gate_auto_passed==true` 时，CLI 必须在写入 `GATE_AUTO_PASSED` 和 `PLAN_APPROVED` 后重新派生响应数据；响应中的活跃提案 `proposal_step` 应为 `"delta-writing"`，并带 `next_node.id=="write-delta"`。消费方不得把 `gate_auto_passed==true` 一概理解为“本次无 next_node”。

**slice-exit 消费后的同次响应（split-slice-planner-stage）**：当 `gate_id=="slice-exit"`、`gate_auto_passed==true` 且 `[code]` 已满足 `tasks_code_filled` 时，CLI 必须在写入 `GATE_AUTO_PASSED` 和 `SLICES_APPROVED` 后重新派生响应数据；响应中的活跃提案 `proposal_step` 应为 `"coding"`，并带 `next_node.id=="code"`。同一提案已存在 `SLICES_APPROVED` 时不再追加同一 `slice-exit` 审计行（幂等）。若 `[code]` 未脱模板，则不得进入本分支。

**缺失 `[code]` section 的代码必需态 JSON 契约（fix-missing-code-section-slice-gate）**：当 launched 活跃提案处于 post-merge 阶段，且 CLI 根据 proposal / delta / 测试规格变化推导出 `code_required==true`，但 `tasks.md` 缺失 `## [code]` 或 `[code]` 尚未脱模板时，`status` / `next` / `watch` 的机器契约必须表达为“待切片”，不得表达为“可 verify”。

- `modules[].active_change.proposal_step` 保持 `"ready-to-implement"`；
- `modules[].next_node.id` 必须为 `"plan-slices"`；
- `modules[].next_node.gate_id` 必须省略；
- 顶层 `gate_id` 必须为 `null` 或省略，不得为 `"slice-exit"`；
- `gate_auto_passed` 必须为 `false` 或省略；
- 不得返回 `next_node.id=="verify"` 或 `next_node.id=="code"`；
- 不得写入 `SLICES_APPROVED`，不得追加 `GATE_AUTO_PASSED{gate_id:"slice-exit"}`。

实现可在 module item 或 next payload 中追加非破坏性诊断对象，消费方按可选字段处理：

```json
{
  "slice_diagnostic": {
    "reason": "tasks-code-section-missing",
    "tasksPath": "logos/changes/<slug>/tasks.md",
    "remediation": "补空 ## [code] section 后重新进入 plan-slices，或由 slice-planner 创建 section"
  }
}
```

`reason` 取值建议：

| reason | 含义 |
|---|---|
| `tasks-code-section-missing` | `code_required==true`，但 `tasks.md` 缺失 `## [code]` section |
| `slices-not-planned` | `## [code]` 存在但为空、模板或占位项，尚未满足 `tasks_code_filled` |

该诊断不新增 `proposal_step` 枚举，不改变既有成功 envelope；它用于防止 RunLogos 等消费方把“没有切片”误解释为“可以 verify / repair”。

**范围边界（auto-full-unattended 重定义）**：`--auto` = **全自动 / 无人值守 standing run-scoped 授权**，作用对象分两层：

1. **可跳 flow 门（经上表 `gate_id` / `skippable` / `gate_auto_passed` 字段表达）**：launched 的 plan 出口（`ready-to-delta`，会被 `PLAN_APPROVED` 消费）、spec 出口（`ready-to-merge`）、slice 出口（`ready-to-implement`，会被 `SLICES_APPROVED` 消费）、deliver 入口（`ready-to-deploy`）四门，`skippable:true`，`--auto` 自动放行。
2. **代码已绿后的盖章 / 发布红线步骤（无 flow gate，不经 `gate_id` 字段表达）**：`verify`、`smoke`、`archive`、`git push` 没有对应 flow gate（故停在这些步骤时 `gate_id==null`），不由 `next --auto` 的 gate 字段表达。它们在全自动下的「自动执行」**纯由生成的指令文本（AGENTS.md / CLAUDE.md）承载**——宿主 AI driver 读到全自动授权后自行运行；CLI **不**引入运行域 marker、**不**写合成审计行。其中 `git push` 无需任何额外机制：PreToolUse guard 的安全白名单本就放行 `git push`（`plugin/bin/guard-check` 的 `BASH_SAFE_PATTERNS` 含 `^git push`），全自动与半自动的唯一差异在于指令文本是否授权 AI 自行发起。这一层是无人值守**授权语义**，不是 `next --auto` 的 gate 字段语义。

**硬红线（任何模式、含 `--auto` 都不放行）**：`gate:implement:loop-exhausted` 默认不可跳（见 §11.1），全自动也照常阻塞、绝不放行未收敛代码——不在上述两层放行范围内。

`initial` 的 WHY/WHAT 建议门本轮不接入 `--auto`（仅 schema 预留）。

### 11.1 loop-exhausted gate（M2 切片 2 / S29 可放行）

当 implement loop 激活且 `loop_state.escalated == true`（达 `max_iters` 仍未收敛）时，`next` 派生为 implement 子流程的
**退出 human gate**。其 `--auto` 行为由 resolved loop 的 `exhausted_gate.skippable` 决定（机器字段 `loop_state.exhausted_skippable`，
**未写 `exhausted_gate` 时该字段省略、按 `false` 处理**）。

**默认（`exhausted_skippable` 省略或 `false`，S27 行为不变）** —— `--auto` 下 gate 字段（§11）取值：

| 字段 | 值 | 说明 |
|------|----|------|
| `gate_id` | `"gate:implement:loop-exhausted"` | loop 退出 gate 的确定性 id（`gate:<subflow>:loop-exhausted`）|
| `skippable` | `false` | 默认不可跳（未声明 `exhausted_gate.skippable`）|
| `gate_auto_passed` | `false` | 达上限 gate 即使 `--auto` 也**不放行、不追加 `GATE_AUTO_PASSED`** |

- 行为：达上限 gate 默认 `skippable:false` → `--auto` **照常阻塞**（不放行未收敛代码）。

**opt-in 放行（`exhausted_skippable == true`，S29 高危）** —— overlay `set-loop` 写了 `set.exhausted_gate.skippable: true` 时，
`--auto` 下：

| 字段 | 值 | 说明 |
|------|----|------|
| `gate_id` | `"gate:implement:loop-exhausted"` | 同上 |
| `skippable` | `true` | 用户显式声明达上限可跳 |
| `gate_auto_passed` | `true` | **本次 `--auto` 实际放行未收敛代码**，并向 `GATE_AUTO_PASSED` 追加审计行 |

- 放行语义同既有 skippable gate 的 `--auto`：写 `GATE_AUTO_PASSED`（§12 schema，`gate_id:"gate:implement:loop-exhausted"`）、action 转 proceed，
  implement 放行进入后续 subflow（**无人值守放行未通过测试的代码**——这是用户在 overlay 显式开启的高危行为，OpenLogos 据 overlay 被动派生）。
- **R2 安全优先**：以上放行的**前提是当前未卡在未完成的 overlay-added 节点**（`current_node` 为 active/failed）。若仍卡在未完成 overlay 节点，gate 尚未到达 →
  **不放行**：`gate_auto_passed:false`、`gate_id:null`、`skippable:null`、不写 `GATE_AUTO_PASSED`（即便 `escalated` + `exhausted_skippable:true`）。
- 默认 `next`（无 `--auto`）始终忽略 `GATE_AUTO_PASSED`、绝不因其越过 gate（§12 不变）。

- "继续迭代" = 人类用 overlay `set-loop` 调大 `max_iters`（`escalated` 自动解除）或修到收敛出环；**gate 不重置计数**。
- `proposal_step` 不因本 gate 改变（仍为既有枚举值）；达上限信息只在 `loop_state.escalated` / `exhausted_skippable` + 本节 gate 字段表达。

### 11.1 补充：loop-exhausted 不在全自动盖章/发布放行内

> **auto-full-unattended 澄清（不改 §11.1 既有派生逻辑）**：本提案把 `verify` / `smoke` / `archive` / `git push` 这 4 样「代码已绿后的盖章/发布」红线纳入全自动 standing 授权放行，但 **`gate:implement:loop-exhausted` 明确排除在外**。§11.1 的默认表（`skippable:false` / `gate_auto_passed:false` / `--auto` 照常阻塞）与 opt-in 表（仅 overlay `exhausted_skippable==true` 时放行）**全部保持不变**。理由：loop-exhausted = 代码未过测试，放行它即发布未验证成果，与全自动「只发布已验证成果」的前提相悖。它是该前提的守门人，永不随 `--auto` 自动放行；唯一放行通道仍是用户在 overlay 显式声明的高危 opt-in（与是否 `--auto` 无关）。

### 11.2 `auto_execute`：非门动作步骤的无人值守执行信号（auto-execute-redline-steps）

`gate_auto_passed` 只覆盖**可跳 flow 门**（plan/spec/slice/deliver）。但 `verify` / `smoke` / `archive` **不是 flow 门**——它们是要 driver 去**执行的 CLI 命令**，无 gate 可「跳」。为让无人值守 driver（runlogos）在 `--auto` 下自动执行它们，`next --auto` 新增 **`auto_execute`** 字段。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `auto_execute` | boolean | 否 | `--auto` 下，当前停顿点是一个**已就绪、可在无人值守模式自动执行的 CLI 命令动作步骤**时为 `true`，并把 `command` 填为该具体命令。默认 `next`（无 `--auto`）**永不输出**此字段。 |

**置 `true` 的条件**（全部满足）：

1. `auto === true`；
2. 当前**未被阻塞**——不卡在未完成 overlay-added 节点（R2 安全闸）、且 `!blockedByLoop`（loop 未阻塞/未达上限）；
3. `proposal_step ∈ { ready-to-verify, verify-passed, deploy-done, smoke-passed, ready-to-smoke }`。

**伴随 `command` 填充**（这些步骤默认 `command:null`，`auto_execute` 时填具体命令）：

| proposal_step | command |
|---|---|
| `ready-to-verify` | `openlogos verify` |
| `ready-to-smoke` | `openlogos smoke` |
| `verify-passed` / `deploy-done` / `smoke-passed` | `openlogos archive <slug>` |

`action` / `detail` 同时改为「auto: 自动执行 …，无需人工确认」措辞。

**不置 `auto_execute`（保持人类确认 / 修复语义）**：

- 默认 `next`（无 `--auto`）——永不输出。
- **硬红线**：loop 达上限未收敛（`blockedByLoop` + `loop_state.escalated`）→ 由 §11.1 的 loop-exhausted gate 处理，**绝不** `auto_execute`（不放行未过测试代码）。
- `verify-failed` / `smoke-failed`——属「修复后重试」语义，非「就绪可执行」，不置。
- flow 门步骤（`ready-to-delta` / `ready-to-merge` / `ready-to-implement` / `ready-to-deploy`）——由 `gate_auto_passed` 表达，不走 `auto_execute`。

**语义**：`auto_execute === true` = 在无人值守 `--auto` 模式下，宿主 driver 被授权**立即执行 `command`、无需人类确认**。它是 `gate_auto_passed`（门放行）在「非门 CLI 命令步骤」上的对应物；二者正交、同一响应里至多一个为真。**消费方契约**：runlogos 等 driver 据 `auto_execute===true` + `command` 自动执行该命令；为 false / 缺省时按既有「提示人类授权」处理（半自动行为不变）。

---

## 12. `GATE_AUTO_PASSED` JSONL 审计 schema

`GATE_AUTO_PASSED` 是活跃提案目录下的 **JSONL 审计日志**：`logos/changes/<slug>/GATE_AUTO_PASSED`。

- **审计不是状态源**：默认 `next`（无 `--auto`）与 `status` **忽略**该文件、绝不因其存在而让默认 `next` 自动越过 gate；此处「不改变」仅指**不因 `GATE_AUTO_PASSED` 越过 gate**——`next` 的 base data 仍按当前契约输出（S28 起可能含 `next_node`）。
- **plan gate 的状态源是 `PLAN_APPROVED`**：`plan-exit` auto 放行时除追加审计外，还必须写入 `PLAN_APPROVED` marker；后续状态推进由该 marker 或实际 delta 产出驱动，不由审计行驱动。
- **slice gate 的状态源是 `SLICES_APPROVED`（split-slice-planner-stage）**：`slice-exit` auto 放行时除追加审计外，还必须写入 `SLICES_APPROVED` marker；后续状态推进由该 marker 或实际 `[code]` 全部勾选驱动，不由审计行驱动。
  > **auto-full-unattended 说明**：全自动盖章/发布红线步骤（`verify` / `smoke` / `archive` / `git push`）**不**写 `GATE_AUTO_PASSED`——它们无 flow gate、由指令文本授权宿主 driver 自行执行，审计落在各步既有 marker（`VERIFY_PASS` / `SMOKE_PASS` / `DEPLOY_DONE`）与提案归档动作上。`GATE_AUTO_PASSED` 仅记录可跳 flow 门（plan/spec/slice/deliver）的放行。
- **追加策略**：处于可跳 gate 且本次实际放行时追加一行。`plan-exit` 第一次放行后前沿离开 `ready-to-delta`，重复 `next --auto` 不得再追加同一 `plan-exit` 审计；`slice-exit` 第一次放行后前沿离开 `ready-to-implement`（已存在 `SLICES_APPROVED`），重复 `next --auto` 不得再追加同一 `slice-exit` 审计；`ready-to-merge` / `ready-to-deploy` 等未被本命令消费的 gate 仍保留既有 append-only 审计轨迹。

每行 schema：

```jsonc
{ "gate_id": "plan-exit", "proposal_step": "ready-to-delta", "timestamp": "2026-06-25T08:01:12Z" }
```

`slice-exit` 放行行示例：

```jsonc
{ "gate_id": "slice-exit", "proposal_step": "ready-to-implement", "timestamp": "2026-06-30T08:01:12Z" }
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `gate_id` | string | 是 | 被本次 `--auto` 放行的可跳 flow 门 id（`plan-exit` / `spec-exit` / `slice-exit` / `deliver-entry`） |
| `proposal_step` | string | 是 | 放行前的 proposal_step；`plan-exit` 应记录 `"ready-to-delta"`、`slice-exit` 应记录 `"ready-to-implement"` |
| `timestamp` | string | 是 | ISO 时间戳 |

## 13. `LOOP_ITERS` JSONL 账本 schema

`LOOP_ITERS` 是 loop 真迭代的**迭代账本**（append-only JSONL），由 `openlogos verify` 在 **loop 激活时**追加。

- **路径**：launched = `logos/changes/<slug>/LOOP_ITERS`（提案级 episode）；initial = `logos/resources/verify/LOOP_ITERS`（项目级）。
- **写入责任与时机**：由 **CLI 主进程**在**算出 gate 结果（PASS/FAIL）之后、不依赖 guard 的共享路径**追加（**非 pre-run 命令写**，免 sandbox 白名单）；
  `result` 取**沙箱降级后的最终** gate 结果。**配置类早退**（`NO_TEST_RESULTS` / `NO_TEST_CASES` / `PROJECT_NOT_INITIALIZED`）
  **不计为一次迭代、不写**。未激活（builtin `max_iters:1`）时不写（零副作用）。
- **launched 额外写 `VERIFY_PASS`/`VERIFY_FAIL` marker + 写账本；initial 不进 guard 块、只写 `LOOP_ITERS`**。

每行 schema：

```jsonc
{ "iter": 2, "node": "verify", "result": "fail", "module": "core", "timestamp": "2026-06-20T20:31:07Z" }
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `iter` | number | 是 | 本轮序号 = **同 `module` 已有行数 + 1**（按 module 过滤计数，**非整文件总行数**），与读取侧 `loop_state.iteration` 对齐 |
| `node` | string | 是 | 求值节点，本切片恒为 `"verify"` |
| `result` | string | 是 | `"pass"`（测试绿）\| `"fail"`（未绿/沙箱降级 FAIL）|
| `module` | string | 是 | 该轮归属模块；读取侧按 `module` 过滤（避免 initial 项目级账本多模块串号）|
| `timestamp` | string | 是 | ISO-8601 |

- **module 来源**：launched = `guard.module`；initial 单模块 = 该唯一模块；**initial 多模块** = verify 为项目级单次运行、无法归属 →
  **不写账本、loop 视为未激活**（本切片已知不支持）。launch 后 initial 账本仅历史产物，launched 派生只读提案目录账本。
- **状态回退**：verify 再次 FAIL 沿用现有行为清除 `VERIFY_PASS` 及下游 `DEPLOY_DONE`/`SMOKE_*` → implement loop 重新打开；账本续写、`converged` 反映最后一次。

## 自动流程韧性诊断 JSON 契约

### 12. 自动流程诊断字段

`status` / `next` / `verify` 的 JSON 输出可包含 `automation_diagnostic`，供 RunLogos / driver 消费。

```json
{
  "automation_diagnostic": {
    "reason": "global-verify-failed",
    "completion_state": "slice_done_global_verify_failed",
    "failed_tests": ["UT-S05-10c"],
    "required_test_ids": ["UT-S32-19"],
    "validated_artifacts": ["cli/src/lib/flow-derive.ts"],
    "missing_artifacts": [],
    "suggested_next_node": "code",
    "human_action_required": false,
    "remediation": "全量 verify 仍失败，基于 failed_tests 派发 repair/code。"
  }
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `reason` | string | 结构化失败原因 |
| `completion_state` | string | dispatch 完成状态分层 |
| `failed_tests` | string[] | 全量 verify 失败测试 |
| `required_test_ids` | string[] | 当前切片要求覆盖的测试 ID |
| `validated_artifacts` | string[] | 已确认存在且在范围内的 artifacts |
| `missing_artifacts` | string[] | 缺失或无法验证的 artifacts |
| `suggested_next_node` | string | 建议下一节点，如 `code`、`plan-slices`、`verify` |
| `human_action_required` | boolean | 是否必须人工介入 |
| `remediation` | string | 可行动修复说明 |

### 原因枚举

- `artifact-missing`
- `artifact-out-of-scope`
- `focused-tests-missing`
- `reporter-missing`
- `global-verify-failed`
- `driver-cannot-validate-artifacts`
- `no-progress`

### 兼容规则

- 既有 `proposal_step` / `next_node` 字段保持兼容。
- 默认文本输出可摘要诊断；JSON 输出必须保留机器字段。
- `claimed-done-but-unverified` 若保留，仅作为兼容别名，不得替代 `reason`。

> **auto-full-unattended 注**：本提案曾设想引入 `AUTO_MODE` 运行域 marker 让 PreToolUse guard 放行 `git push`，后经实测证伪——guard 的安全白名单（`plugin/bin/guard-check` `BASH_SAFE_PATTERNS`）本就含 `^git push`，从不拦截，故该 marker 多余、未引入。全自动下 `git push` 的「自动发起」纯由生成的指令文本授权宿主 driver 承载（见 §11 范围边界第 2 层）。

## 12.1 `automation_diagnostic` 前沿作用域

`automation_diagnostic` 分为两类输出：

- **执行结果诊断**：`openlogos verify --format json` 可在本次 verify 结果中输出 `automation_diagnostic`，用于解释当前验收失败、缺失 reporter、缺失 focused tests 或全量失败原因。
- **可驱动前沿诊断**：`openlogos status --format json` / `openlogos next --format json` 只有在当前活跃提案前沿属于实现/验证闭环时，才可输出会改变下一步动作的 `automation_diagnostic`，即带有 `reason:"global-verify-failed"`、`suggested_next_node:"code"` 或等价 repair 语义、`human_action_required:false` 的诊断。

实现/验证闭环前沿仅包括：

- `proposal_step=="coding"`；
- `proposal_step=="ready-to-verify"` 且 implement loop 已进入过代码实现阶段；
- `proposal_step=="verify-failed"`；
- implement loop 未收敛、未达上限并需要重新派发 `code` / repair 的状态。

以下前沿不得被历史 verify 失败、历史 `test-results.jsonl`、历史 `acceptance-report.md` 或上一轮提案残留的 `automation_diagnostic` 覆盖为 repair/code 建议：

- `writing`
- `ready-to-delta`
- `delta-writing`
- `ready-to-merge`
- `merge-generated`
- `ready-to-implement` 且 `plan-slices` 未完成或正停在 `slice-exit`
- `ready-to-deploy`
- `deploy-done`
- `ready-to-smoke`
- `smoke-passed`

在上述非实现/验证前沿，`status` / `next` 可以省略 `automation_diagnostic`，也可以输出不改变 flow 前沿的只读诊断；但不得输出 `suggested_next_node:"code"` / `"verify"`，不得把 `action` 改为 repair/code，不得清空当前 gate 或命令步骤本应返回的 `command`。

## 11.3 `ready-to-merge --auto` 与 stale diagnostic 的命令保留

当活跃提案处于 `ready-to-merge`，且调用 `openlogos next --auto --format json` 时，即使工作区存在历史 verify 失败证据或 stale `automation_diagnostic`，响应仍必须保留 spec 出口门的自动放行语义：

- 顶层或模块级 `proposal_step` 为 `"ready-to-merge"` 或本次 gate 响应对应的 spec 出口前沿；
- `gate_id=="spec-exit"`；
- `skippable===true`；
- `gate_auto_passed===true`；
- `command=="openlogos merge <slug>"` 出现在既有契约定义的顶层和 / 或 `modules[].active_change.command` 位置；
- `action` / `detail` 表达 merge 可执行，而不是 repair/code；
- 不写 `PLAN_APPROVED`、不写 `SLICES_APPROVED`；
- 不得因 `global-verify-failed` 将 `command` 置为 `null`。

该规则同样适用于多模块输出：模块级活跃提案的 command 不得被非当前前沿的 `automation_diagnostic` 清空。

## 3.13 no-delta spec-complete 与测试 ID 门禁 JSON 契约

### `spec-complete-required`

当活跃提案需要代码实现，但缺少 `SPEC_MERGED` / `MERGED` 时，`status` / `next` / `watch` 必须表达为 spec-complete 阻塞。

```json
{
  "proposal_step": "spec-complete-required",
  "active_change": {
    "code_required": true,
    "code_planning_diagnostic": {
      "reason": "no_delta_spec_marker_missing",
      "remediation": "run openlogos merge <slug> to write SPEC_MERGED"
    }
  }
}
```

约束：

- 不得返回 `next_node.id=="plan-slices"`；
- 不得返回 `next_node.id=="code"`；
- 不得返回 `next_node.id=="verify"`；
- `next --auto` 不得把该状态当作 skippable gate。

### `test-id-required`

当活跃提案已完成 spec-complete 且需要代码实现，但缺少真实测试 ID 时，`status` / `next` / `watch` 必须表达为测试 ID 阻塞。

```json
{
  "proposal_step": "test-id-required",
  "active_change": {
    "code_required": true,
    "code_planning_diagnostic": {
      "reason": "code_change_requires_real_test_ids",
      "remediation": "add or reference real UT/ST/SMOKE IDs before plan-slices"
    }
  }
}
```

约束：

- 不得返回 `next_node.id=="plan-slices"`；
- 不得写入 `SLICES_APPROVED`；
- 不得输出 `gate_auto_passed:true`；
- 不得进入 implement loop repair。

### `reason` 取值

| reason | 含义 | 建议处理 |
|---|---|---|
| `no_delta_spec_marker_missing` | 代码提案缺少 spec-complete marker | 执行 `openlogos merge <slug>`；无 delta 时写 no-delta `SPEC_MERGED` |
| `code_change_requires_real_test_ids` | 代码提案缺少真实测试 ID | 补充测试资源或显式声明复用真实 UT/ST/SMOKE ID |

### `SPEC_MERGED` 内容

no-delta merge 写入的 `SPEC_MERGED` 建议为：

```json
{
  "type": "no_delta_spec_complete",
  "reason": "pure-code proposal has no spec delta",
  "completed_at": "..."
}
```

## product_type 迁移相关 JSON 契约（proposal-ui-ux-first）

> **背景（F1 critical）**：存量已 `launched` 的 GUI 项目升级后不重跑 `init`/`adopt`，其
> `logos-project.yaml` 的 `modules[]` 普遍**缺 `product_type` 字段**。本节把「缺字段迁移入口」
> 与「回填结果」定义为机器可读契约，供 driver / RunLogos 精确发现待确认项并回填。
>
> **数据源与迁移语义权威**：`spec/logos-project.md`（`modules[].product_type` 是唯一事实源，
> 枚举 `web|desktop|mobile|cli|api|library|skills|service`，GUI 集合 = {`web`,`desktop`,`mobile`}，缺失=非 GUI 安全默认）。
> 本节只定义 **JSON 输出形态**（`status`/`next` 诊断信号、`module list` 字段、`set-product-type` 结果 envelope）。

### (1) `status` / `next` 缺字段诊断信号 `PRODUCT_TYPE_CONFIRMATION_REQUIRED`

`status` / `next` 的 success envelope 检测到**任一 `launched` 模块缺 `product_type` 字段**时，
在 `data` 顶层输出**可选诊断对象 `product_type_confirmation`**。它是 **warning（不阻断既有流程）**，
携带 `next_action` 指向 `openlogos module set-product-type`，并**列出全部缺字段的 module ids** 供精确回填。

**Schema（挂 `status` / `next` 的 `data` 顶层）**：

```jsonc
{
  // ... 既有 status / next data 字段 ...
  "product_type_confirmation": {
    "signal": "PRODUCT_TYPE_CONFIRMATION_REQUIRED",
    "level": "warning",                      // 恒为 warning：不阻断，仅暴露待确认项
    "missing_module_ids": ["web", "admin"],  // 缺 product_type 的 launched module id 列表（保持 modules[] 内出现顺序）
    "next_action": {
      "command": "openlogos module set-product-type",
      "enum": ["web", "desktop", "mobile", "cli", "api", "library", "skills", "service"],
      "gui_enum": ["web", "desktop", "mobile"],
      "hint": "为每个缺字段 launched 模块显式设置 product_type；缺字段前一律按非 GUI 处理（安全默认）"
    }
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `product_type_confirmation` | object \| 省略 | 否 | 见「出现与省略规则」。仅当存在缺字段的 launched 模块时输出 |
| `product_type_confirmation.signal` | string | 是（对象出现时）| 恒为 `"PRODUCT_TYPE_CONFIRMATION_REQUIRED"` |
| `product_type_confirmation.level` | string | 是 | 恒为 `"warning"`（不阻断） |
| `product_type_confirmation.missing_module_ids` | string[] | 是 | 缺 `product_type` 的 **launched** module id 列表；非空、去重、按 `modules[]` 出现顺序（golden 确定性）|
| `product_type_confirmation.next_action.command` | string | 是 | 恒为 `"openlogos module set-product-type"` |
| `product_type_confirmation.next_action.enum` | string[] | 是 | 全部合法枚举值（固定顺序 = `["web","desktop","mobile","cli","api","library","skills","service"]`；扩展只允许尾部追加，既有前缀顺序不变）|
| `product_type_confirmation.next_action.gui_enum` | string[] | 是 | GUI 子集 `["web","desktop","mobile"]` |
| `product_type_confirmation.next_action.hint` | string | 否 | 面向 driver / UI 的短提示 |

**挂载位置（module-aware，与既有 overlay/loop 字段挂载同构）**：
- `missing_module_ids` 是**项目级聚合**（跨所有 launched 模块的缺字段并集），故 `product_type_confirmation`
  **挂 `data` 顶层**（不挂 `modules[].active_change`，因缺字段与是否有活跃提案无关）。
- `next --format json` 的 base data 与 `status` 同构挂顶层 `product_type_confirmation`；
  `watch` 的 `data` 与 `status` 同构，继承同一出现 / 省略规则。

**出现与省略规则（零漂移边界）**：
- `product_type_confirmation` **仅当**存在 **≥1 个 launched 模块缺 `product_type` 字段**时输出；
  否则**整个对象省略**（不输出 `missing_module_ids:[]`）。
- 由此**所有 launched 模块均已显式设置 `product_type` 的项目**、以及**无 launched 模块的 initial 项目**——
  其 `status` / `next` JSON **逐字节不变**，既有 golden 不漂移。
- **确定性**：`missing_module_ids` 按 `modules[]` 出现顺序枚举缺字段模块，同一 `logos-project.yaml` 下输出稳定，golden 可钉。

**消费契约（安全默认不因诊断改变）**：
- 该信号**只暴露待确认项，绝不隐式升级为 GUI**：缺字段模块在**显式设置前仍按非 GUI 处理**
  （`ui_impact` 恒 `false`、不注入 overlay）。
- `next --auto` 检测到缺字段时**照常输出本诊断对象**（不阻断推进、不猜测升级），供 driver 暴露 next action；
  仅在经 `set-product-type` / `module add` 显式配置 GUI 枚举后才注入 overlay（红线，见 `spec/logos-project.md` §4）。

### (2) `openlogos module list --format json` 每模块新增 `product_type`

修订 §7.2 / §7.3：`module list` 的 `data.modules[]` 每项**新增可选字段 `product_type`**，
让消费方无需另读 `logos-project.yaml` 即可判定 GUI / 非 GUI。

**修订后 Schema（data 部分）**：

```jsonc
{
  "modules": [
    {
      "id": "web",
      "name": "Web 控制台",
      "lifecycle": "launched",
      "product_type": "web"       // 缺失时该键省略（不物化 null）——见向后兼容
    },
    {
      "id": "api",
      "name": "后端服务",
      "lifecycle": "launched",
      "product_type": "api"
    },
    {
      "id": "legacy",
      "name": "历史模块",
      "lifecycle": "launched"
      // 无 product_type 键：存量未回填模块 → 消费方按「缺失=非 GUI 安全默认」处理
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `modules[].product_type` | string \| 省略 | 否 | 模块产品类型枚举（`web`/`desktop`/`mobile`/`cli`/`api`/`library`/`skills`/`service`）。**`logos-project.yaml` 中该模块无 `product_type` 字段时，本键整体省略（不输出 `null`）**，与源 YAML 一一对应 |

**向后兼容（省略而非 null）**：
- **字段缺失即省略**：源 `modules[].product_type` 不存在时，JSON **不输出该键**（不物化 `product_type:null`）。
  消费方语义：**键缺失 == 非 GUI 安全默认**（与 `spec/logos-project.md`「缺失=非 GUI」一致）。
- 由此**全部模块均未回填 `product_type` 的存量项目**，其 `module list --format json` 输出与本特性前
  **逐字节一致**（既有 §7 golden 不漂移）；仅已显式设置的模块多出一个 `product_type` 键。
- **golden 稳定性**：某模块是否出现 `product_type` 键，**确定性地**取决于源 YAML 是否含该字段——
  「缺字段 = 非 GUI」时 diagnostic（§1）出现 / 本字段省略，二者互为对照且可钉 golden。

### (3) `openlogos module set-product-type --format json` 结果 envelope

`openlogos module set-product-type <module-id> <enum> --format json` 走通用信封
（`command: "module set-product-type"`）。

**成功（写入 / 更新）** — success envelope `data`：

```json
{
  "command": "module set-product-type",
  "version": "0.5.9",
  "timestamp": "2026-07-10T12:00:00.000Z",
  "data": {
    "module_id": "web",
    "product_type": "web",
    "is_gui": true,
    "changed": true,
    "overlay_sync_hint": "openlogos sync"
  }
}
```

**成功（幂等 no-op，值与当前相同）** — `changed:false`，仍为成功（退出码 0）：

```json
{
  "command": "module set-product-type",
  "version": "0.5.9",
  "timestamp": "2026-07-10T12:00:00.000Z",
  "data": {
    "module_id": "web",
    "product_type": "web",
    "is_gui": true,
    "changed": false,
    "overlay_sync_hint": null
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `data.module_id` | string | 是 | 被设置的 module id |
| `data.product_type` | string | 是 | 设置后的 product_type 枚举值 |
| `data.is_gui` | boolean | 是 | 是否 ∈ GUI 集合 {`web`,`desktop`,`mobile`} |
| `data.changed` | boolean | 是 | 是否真正发生写入；幂等 no-op（值未变）为 `false`，仍成功 |
| `data.overlay_sync_hint` | string \| null | 是 | 设为 GUI 枚举且**新使项目含 GUI 模块**时提示 `"openlogos sync"`；否则 / no-op 时为 `null`。仅提示，`set-product-type` 本身不动 `launched.yaml` |

**错误** — 走通用错误 envelope（见 §6，输出到 stderr、非零退出）；新增错误码：

| 错误码 | 说明 |
|--------|------|
| `INVALID_PRODUCT_TYPE` | `<enum>` 非合法枚举；`message` **必须列出全部合法枚举**（`web`/`desktop`/`mobile`/`cli`/`api`/`library`/`skills`）|
| `MODULE_NOT_FOUND` | `<module-id>` 不在 `logos-project.yaml` 的 `modules[]` |
| `MISSING_ARGUMENT` | 缺 `<module-id>` 或 `<enum>`（usage error），`message` 含用法串 |

**非法枚举错误示例**：

```json
{
  "command": "module set-product-type",
  "version": "0.5.9",
  "timestamp": "2026-07-10T12:00:00.000Z",
  "error": {
    "code": "INVALID_PRODUCT_TYPE",
    "message": "非法的 product_type：frontend。合法枚举：web | desktop | mobile | cli | api | library | skills（GUI 集合 = web / desktop / mobile）"
  }
}
```

**未知 module 错误示例**：

```json
{
  "command": "module set-product-type",
  "version": "0.5.9",
  "timestamp": "2026-07-10T12:00:00.000Z",
  "error": {
    "code": "MODULE_NOT_FOUND",
    "message": "未知模块：payments。当前已注册模块：web、api、tooling"
  }
}
```

**契约不变量**：
- 任何错误分支**不得写入** `logos-project.yaml`（非法枚举 / 未知 module / 缺参一律零副作用）。
- `set-product-type` **仅改 `modules[].product_type`**，不注入 / 移除 overlay；overlay 收敛仍由 `sync` 幂等负责
  （见 `spec/logos-project.md` §5），`overlay_sync_hint` 只是引导。
- 成功 envelope 的 `is_gui` 由 `product_type ∈ {web,desktop,mobile}` 派生，供消费方直接判定，无需自行维护 GUI 集合。
