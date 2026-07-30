# S22: 查看与解析 flow 编排 — 测试用例

## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S22-01 | 从包内加载内置 initial 模板 | flow loader | 包内存在 `spec/flow/initial.yaml` | `loadFlow(root, "initial")` | 返回含 subflows/nodes/gates 的 flow 对象 |
| UT-S22-02 | 从包内加载内置 launched 模板 | flow loader | 包内存在 `spec/flow/launched.yaml` | `loadFlow(root, "launched")` | 返回 launched flow 对象 |
| UT-S22-03 | dev/test/prepack 三路径均能定位内置模板 | flow loader path resolver | 三种运行路径 | resolve builtin path | 命中包内已打包的根 spec，不依赖新增 assets |
| UT-S22-04 | 内置模板缺失返回 FLOW_NOT_FOUND | flow loader | 删除/不存在内置模板 | `loadFlow` | 抛出/返回 `FLOW_NOT_FOUND` |
| UT-S22-05 | 基础 schema 校验拦截缺失必填字段 | flow schema validator | flow 缺 `version`/`flow`/node 缺 `id` | `loadFlow` | `FLOW_SCHEMA_INVALID` |
| UT-S22-06 | overlay extends 解析出基线与 @vN | overlay parser | overlay 含 `extends: builtin:initial@v1` | parse extends | 返回 baseline=initial、version=v1 |
| UT-S22-07 | overlay skip 按 node id 标记节点 skipped | strategic-merge | overlay 含 `op: skip, target: orchestration-test` | resolve overlay | resolved flow 中该节点**保留但标记 skipped（等价 when:false）**，不从结构删除 |
| UT-S22-08 | overlay add 在 after/before 处插入节点 | strategic-merge | overlay 含 `op: add, after: code, node: {...}` | resolve overlay | 新节点出现在 code 之后 |
| UT-S22-09 | overlay modify 深合并目标节点字段 | strategic-merge | overlay 含 `op: modify, target: code, set: {review_agent: x}` | resolve overlay | code 节点 review_agent=x，其余字段保留 |
| UT-S22-10 | overlay reorder 调整节点顺序 | strategic-merge | overlay 含 `op: reorder, target: smoke, after: deploy` | resolve overlay | smoke 移动到 deploy 之后 |
| UT-S22-11 | overlay target node id 不存在时报错 | strategic-merge | `op: modify, target: not-exist` | resolve overlay | `FLOW_SCHEMA_INVALID`，指出非法 target |
| UT-S22-12 | overlay 含未知 op 时报错 | overlay validator | `op: rename` | resolve overlay | `FLOW_SCHEMA_INVALID` |
| UT-S22-13 | @vN 与内置内容版本不一致时产生告警 | version checker | overlay `@v1`，内置 `v2` | resolve overlay | warnings[] 含 `FLOW_VERSION_MISMATCH`，解析不中断 |
| UT-S22-14 | @vN 匹配时无版本告警 | version checker | overlay `@v1`，内置 `v1` | resolve overlay | warnings[] 不含版本告警 |
| UT-S22-15 | overlay_applied 反映是否实际应用 overlay | flow loader | 有/无 overlay 文件 | `loadFlow` resolved | 有 overlay→true，无→false |
| UT-S22-16 | flow show JSON envelope 字段完整 | flow command json | 已初始化 | `flow show --format json` | data 含 lifecycle/resolved/flow/overlay_applied/builtin_version/warnings |

## 二、场景测试用例
### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S22-01 | flow show 默认展示内置 raw flow | Step 1→10 | 已初始化（initial 阶段项目）| `openlogos flow show` | 输出内置 raw flow 结构，未应用项目 overlay |
| ST-S22-07 | 默认 lifecycle 推断：initial 项目 → initial flow | Step 1→2 | 项目所有模块 lifecycle=initial，未传 `--lifecycle` | `openlogos flow show` | 默认查看 initial flow |
| ST-S22-08 | 默认 lifecycle 推断：launched 项目 → launched flow | Step 1→2 | 项目存在 launched 模块，未传 `--lifecycle` | `openlogos flow show` | 默认查看 launched flow（非 initial）|
| ST-S22-02 | flow show --resolved 应用 overlay 四操作 | Step 1→10 | 项目存在 `logos/flow/initial.yaml`，含 skip/add/modify/reorder | `openlogos flow show --resolved` | 四种操作均按 node id 生效，输出合并后 flow |
| ST-S22-03 | flow show --format json 输出机器可读结构 | Step 1→10 | 已初始化 | `openlogos flow show --format json` | envelope command="flow show"，data 字段齐全 |
| ST-S22-04 | flow show --resolved --format json 暴露 overlay_applied | Step 1→10 | 项目存在 overlay | `openlogos flow show --resolved --format json` | resolved=true、overlay_applied=true |
| ST-S22-05 | flow show --lifecycle launched 查看 launched flow | Step 1→10 | 内置 launched 模板存在 | `openlogos flow show --lifecycle launched` | 输出 launched flow（含 close/archive 等） |
| ST-S22-06 | 零行为变更：flow show 不改变 status/next 输出 | Step 1→10 | 同一 fixture 下先后运行 | `openlogos status --format json` **与** `openlogos next --format json` 前后对比 | status 与 next 的 JSON 输出均与未引入 flow 时一致（与 golden-baseline 锚点等价） |

## 三、异常测试用例
| ID | 描述 | 覆盖异常 | 前置条件 | 操作序列 | 预期结果 |
|----|------|----------|---------|---------|---------|
| ST-S22-EX-2.1 | 项目未初始化 | EX-2.1 | 缺少 `logos/logos.config.json` | `openlogos flow show` | 输出 `PROJECT_NOT_INITIALIZED`，非零退出 |
| ST-S22-EX-4.1 | 内置模板或 lifecycle 缺失 | EX-4.1 | 内置模板缺失或 `--lifecycle` 非法 | `openlogos flow show --lifecycle bad` | 输出 `FLOW_NOT_FOUND` |
| ST-S22-EX-5.1 | overlay schema 非法 | EX-5.1 | overlay 含未知 op 或 target 不存在 | `openlogos flow show --resolved` | 输出 `FLOW_SCHEMA_INVALID`，不输出半成品 flow |
| ST-S22-EX-5.2 | @vN 版本不匹配仅告警 | EX-5.2 | overlay `@v1`，内置 `v2` | `openlogos flow show --resolved --format json` | warnings[] 含 `FLOW_VERSION_MISMATCH`，仍返回 resolved flow |

## 四、覆盖度校验清单
- [ ] 内置模板加载（initial/launched）已覆盖：UT-S22-01、UT-S22-02、ST-S22-05
- [ ] dev/test/prepack 三路径解析已覆盖：UT-S22-03
- [ ] overlay 四操作（skip/add/modify/reorder）已覆盖：UT-S22-07~10、ST-S22-02
- [ ] extends 解析已覆盖：UT-S22-06
- [ ] @vN 版本告警已覆盖：UT-S22-13、UT-S22-14、ST-S22-EX-5.2
- [ ] schema 校验失败已覆盖：UT-S22-05、UT-S22-11、UT-S22-12、ST-S22-EX-5.1
- [ ] flow show raw 已覆盖：ST-S22-01
- [ ] 默认 lifecycle 推断（initial/launched 两种）已覆盖：ST-S22-07、ST-S22-08
- [ ] flow show --resolved 已覆盖：ST-S22-02、ST-S22-04
- [ ] --format json 输出与错误 envelope 已覆盖：UT-S22-16、ST-S22-03、ST-S22-EX-2.1、ST-S22-EX-4.1
- [ ] 零行为变更锚点已覆盖：ST-S22-06（与 golden-baseline 等价）

## 五、flow 节点 dispatch / requires_reviewed 元数据测试（contract-self-description）

> 覆盖 D6 在 flow 加载/解析层（S22）的落点：内置模板逐节点人工声明 `dispatch`（权威数据源 = flow 节点定义，**不从 produces/done_when 推导**）、节点可选 `requires_reviewed` 声明、flow 文件顶层新增 `defaults: {dispatch: {timeout_seconds: 900}}` 唯一默认值源（fallback）。flow 文件 schema `version: 1` 保持不变（向后兼容扩展）。overlay-add 未声明 dispatch 的保守默认用例归 S25，本节不重复。本节用例编号顺延既有最大编号（UT-S22-16 / ST-S22-08）。用例实现必须写入 OpenLogos reporter，测试名包含对应 ID 供 verify 抽取。

### 5.1 单元测试用例补充

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S22-17 | 内置模板每节点加载后携带完整 dispatch 声明 | flow loader / D6 | 包内 `spec/flow/initial.yaml`、`spec/flow/launched.yaml` 已逐节点补齐 dispatch | `loadFlow(root, "initial")` / `loadFlow(root, "launched")` | **raw** 加载：每节点均声明 `idempotent` 与 `artifacts_hint`；`timeout_seconds` **仅特例节点显式声明**（code/implement 类 `3600`、deploy 类 `1800`），其余节点**省略**（由 defaults 物化，见 UT-S22-20）。**resolved** 后：每节点物化完整 `dispatch: {idempotent, timeout_seconds, artifacts_hint}`，未显式节点 `timeout_seconds==defaults.dispatch.timeout_seconds(900)`。抽样断言声明基准：内容产出/评审节点（write-proposal、write-tasks、write-delta、plan-slices、review 类、code）与 verify/smoke 命令节点 `idempotent:true`，一次性落盘/执行节点（apply-merge、deploy、archive 类）`idempotent:false`；`artifacts_hint` 为该节点具体产物提示（如 write-proposal→`["proposal.md"]`） |
| UT-S22-18 | requires_reviewed 节点声明加载 | flow loader / D6 | 内置 launched 模板 apply-merge 节点声明 `requires_reviewed: ["proposal","delta"]` | `loadFlow(root, "launched")` | apply-merge 节点 `requires_reviewed == ["proposal","delta"]`；未声明该字段的节点对象上不含 `requires_reviewed`（可选字段，不注入默认值） |
| UT-S22-19 | dispatch / requires_reviewed schema 校验拦截非法类型 | flow schema validator / D6 | 构造非法 flow 文件：`idempotent` 非布尔、或 `timeout_seconds` 非正整数、或 `artifacts_hint` 非字符串数组、或 `requires_reviewed` 非字符串数组 | `loadFlow` | 各非法形态均返回 `FLOW_SCHEMA_INVALID` 并指出非法字段；合法扩展后 flow 文件 schema `version` 保持 `1` 不变（向后兼容扩展不 bump） |
| UT-S22-20 | defaults.dispatch.timeout_seconds 顶层加载与 overlay 覆盖 | flow loader / D6 唯一默认值源（fallback） | 内置模板顶层含 `defaults: {dispatch: {timeout_seconds: 900}}`；项目 overlay 覆盖为其他值（如 600） | `loadFlow` raw 与 resolved 各一次 | raw flow 读出 `defaults.dispatch.timeout_seconds == 900`；应用 overlay 后 resolved 取覆盖值 600，并物化进每个未显式声明 `timeout_seconds` 的节点；输出层不存在第二处默认值来源 |

### 5.2 场景测试用例补充

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S22-09 | flow show 暴露节点 dispatch/requires_reviewed 与 defaults | Step 1→10 | launched 项目，存在覆盖 `defaults.dispatch.timeout_seconds` 的 overlay | `openlogos flow show --lifecycle launched --format json` 与 `--resolved --format json` | raw 输出含顶层 `defaults` 与逐节点 `dispatch` 声明（apply-merge 含 `requires_reviewed`）；resolved 输出中 overlay 覆盖的 timeout 生效并物化进节点；两次输出均通过 flow schema 校验 |

### 5.3 覆盖度校验补充

- [ ] 内置模板逐节点 dispatch 完整加载（含声明基准抽样）：UT-S22-17
- [ ] requires_reviewed 声明加载（含未声明不注入）：UT-S22-18
- [ ] dispatch/requires_reviewed schema 校验与 version:1 不变：UT-S22-19
- [ ] defaults.dispatch.timeout_seconds 加载与 overlay 覆盖物化：UT-S22-20
- [ ] flow show 端到端暴露 dispatch/requires_reviewed/defaults：ST-S22-09
