# 按触达目标规格闭包规范（baseline-on-touch）

> 状态：规范性｜策略标识：`on-touch-v1`｜决策：D02｜场景：S39

## 18. 测试变更集原子固化

### 18.1 事务边界与协议分层

baseline closure 的严格 Agent 输入继续精确使用 `openlogos/baseline-merge-apply@1`。`MERGE_APPLY_MANIFEST.json` 的顶层、prepared target 与 metadata target 字段合同不得为测试变化扩展；Agent 不填写 changed/removed ID，也不拥有正式测试记录的语义差异。

只有 `openlogos merge-apply` 同时掌握已验证 before/current 字节与 prepared final 字节，因而由它在首写前为 category=`test` targets 计算 `openlogos/test-change-set@1`，嵌入最终 `SPEC_MERGED.test_change_set`，并将完整 marker 字节加入同一 `applyBaselineClosureBatch()`。`SPEC_MERGED` 必须最后写入。

### 18.2 before/final 事实

- MODIFY：before 是与 strict manifest `before_sha256` 匹配的当前正式目标原始字节；final 是已验证 `content_base64` 解码字节。
- CREATE：语义 before 是空态，change-set `before_sha256` 必须为 `null`；final 是已验证解码字节。
- SKIP/AMBIGUOUS：不得进入 apply 批次或 change-set targets。
- 未触及 category=`test`：本批 change set 的 targets/C/R 为空。

TestDefinitionDiff 必须按 `spec/test-slice-manifest.md` 的 authority scanner 在所有测试 targets 上构建全局 before/final 记录映射，得到新增或语义修改集合 C、删除集合 R 与原样记录集合。整份 Delta 中原样携带的已有测试不能进入 C；正式 target 路径属于规范化记录，跨 target 移动必须进入 C。

### 18.3 预写校验

生成 marker 前必须完成：

1. strict apply manifest 既有 L1～L9、P=T=D、source/before/final hash 与路径 containment 校验；
2. before/final UTF-8、Markdown authority 表格和全局测试 ID 唯一性校验；
3. change-set 精确字段、排序、集合、target identity 与 canonical payload hash 自校验；
4. `change`、`module`、guard、baseline plan、strict manifest 和 marker 身份一致性校验。

任一步失败都必须在第一个正式目标写入前返回非零；不得写 resources、metadata、counter、index、marker 或恢复性 slice manifest。Git 仓库、commit、parent、branch、squash/rebase 状态不得参与计算。

### 18.4 原子 apply、复核与回滚

批事务按既有规范备份 MODIFY/metadata，跟踪本批 CREATE，并以 marker 为最后写入。写入后必须从磁盘重读全部 category=`test` targets 与 `SPEC_MERGED`，复核：

- 正式目标字节哈希等于 change-set `after_sha256`；
- marker 中 change set 可由 TestChangeSetReader 完整读取，payload hash 正确；
- targets 精确等于 baseline plan 中 category=`test` 的 canonical targets；
- marker 的 `manifest_sha256` 继续只绑定严格 apply manifest，未被 change-set payload 替代。

任一写入、fault injection、fsync/rename 或后置复核失败时，必须恢复所有 MODIFY/metadata/counter/index，删除本批 CREATE 与 marker，并返回 `rolled_back=true`。不得留下只有资源或只有 change set 的半提交状态。

### 18.5 no-delta 与历史兼容

`type=no_delta_spec_complete` 且磁盘确无 mergeable Delta 的既有 marker 可由读取器可信派生空 C/R；不得为此改写旧 marker，也不得扫描正式规格声称存在本提案变化。

新 baseline apply marker 缺少 `test_change_set` 是完整性错误。历史 marker 的兼容读取必须由明确 marker 类型和可证 no-delta 条件约束；含测试 Delta、身份不一致、未知 schema 或 target 哈希漂移时一律 fail-closed，不从 Delta 或 Git 补算。

### 18.6 验收

- before/final 的新增、语义修改、原样、删除与跨 target 移动分类准确且确定；
- 严格 apply manifest 字段合同保持逐字不变；
- resources、metadata 与带 change set 的 marker 全有或全无；
- 重启和无 Git 环境读取结果一致；篡改 target 或 marker 必须稳定拒绝；
- S32 所有消费者只读取同一 change set，`O = C`，R 不进入切片归属。

## 合并事务中的 baseline closure

### 单一事务边界

当一次合并触碰受 baseline 管理的正式目标时，canonical resources 与由 OpenLogos 生产的 metadata 必须属于同一个 `merge transaction`。事务目标闭包由 seal 前的 canonical target set 加确定性 metadata expansion 得出；任何消费者不得在 seal 后增删目标。

闭包至少覆盖：

- proposal 声明的所有 canonical resource targets；
- 这些目标触发的 `logos-project.yaml` 场景计数器、资源索引及 ownership 元数据；
- OpenLogos 仓内 dogfood 镜像；
- `SPEC_MERGED` 或等价完成 marker；
- completed receipt 本身及其持久化索引。

### 内容槽与身份冻结

每个需要 Agent 合成的资源目标对应一个声明式 `content_slot`。slot 身份至少包含 `slot_id`、`delta_path`、`target_path`、`mode`、`source_sha256` 与 `before_sha256`；Agent 只提交最终字节。metadata 目标由核心根据 sealed resources 确定性生成，不开放 Agent 可写 slot。

`seal` 必须在任何正式写入前验证：目标集合唯一、路径位于允许根、delta/source hash 匹配、MODIFY 的 before hash 匹配、CREATE 不存在、全部必需 slot 已填充且内容 hash 可复算。校验失败不得产生正式目标副作用。

### 原子 apply 与恢复

核心事务 writer 必须先预演完整闭包，再以全有或全无方式提交 resources、metadata、dogfood 与 marker。崩溃恢复以持久化 transaction journal 和 seal hash 为依据：

- 未开始正式写入时可安全重试 apply；
- 已完成全部写入但 receipt 未持久化时，复核目标 hash 后补写同一 receipt；
- 任一目标与 sealed hash 不符时进入 `failed`，给出稳定 classification，不得将部分态标为 completed；
- 对 completed 事务重复 apply 必须返回同一 receipt，且不重写目标。

### no-delta 与历史边界

no-delta 事务的 resource target set 可以为空，但 metadata closure、seal、apply 与 receipt 规则不变。历史 manifest 只可作为迁移诊断输入，不能充当 0.14.0 新事务的写入授权或成功证明。本节优先于本文件中任何“逐目标 apply 后再补 metadata/marker”的旧描述。

### 完成判定

只有同时满足以下条件才可进入 `completed`：sealed closure 完整、所有 after hash 已复核、metadata 与 resources 属于同一提交、marker 指向同一 transaction id、completed receipt 已持久化且通过 `openlogos/merge-transaction@1` 校验。

## 消费者可提交闭包与无环 hash


### 集合定义

`payload_paths` 是 apply 产生的非自引用正式内容集合，等于 changed_paths 与 created_paths 的去重并集。`final_hashes` 必须逐项覆盖 payload_paths。

`protocol_artifact_paths` 固定为公共 receipt 与 `SPEC_MERGED` marker；`artifact_hashes` 必须逐项覆盖该集合。`commit_paths` 等于 payload_paths 与 protocol_artifact_paths 的去重并集。

### 守恒不变量

- final_hashes 与 artifact_hashes 的 path 不得重叠；
- 两者 path 并集必须精确等于 commit_paths；
- 所有 path 均为规范化项目根相对路径、稳定排序、无逃逸和 symlink；
- content、Agent staging、临时文件、backup、journal、私有 transaction state 永不进入 commit_paths；
- receipt_sha256 是排除自身字段后的 canonical receipt payload identity；
- receipt/marker 文件 hash 只位于 completed projection 外层，禁止自引用。

### 阶段门

seal 冻结 payload 输入；apply 验证 payload 后写 receipt/marker；completed projector 最后计算 artifact hashes。任何集合或 hash 不变量失败都不能写 completed。

上述集合相等、互斥、稳定排序、计数守恒与 canonical identity 由 `openlogos/merge-transaction-semantic@1` 校验；JSON Schema 负责结构、类型、枚举和可表达的阶段条件。生产者与消费者必须同时执行两层校验，不得把 Schema 通过等同为事务合同通过。

## 19. Seal-bound Preflight 与 Test-change-set 归因


### 19.1 Preflight 输入与纯度

merge transaction在seal前以冻结Delta source、正式before和全部candidate final bytes构建`openlogos/merge-preflight@1`内部view。builder必须纯只读：不得写phase、journal、staging、backup、receipt、marker或正式target，也不得调用带恢复/清理副作用的apply入口。

### 19.2 Canonical View

view至少包含：

- transaction ID、plan hash、target-set hash；
- planned/derived targets的canonical path、mode、producer、before/final SHA-256；
- after测试定义严格扫描与`test-change-set` SHA-256；
- metadata/counter/index、dogfood/prototype绑定；
- 最终target path集合；
- view自身SHA-256。

数组ASCII排序去重，object固定键序列化。`completed_at`、临时路径、进程ID等非确定性值不得进入view。

### 19.3 Seal 与 Apply

新`seal_sha256`绑定content hashes和`preflight_sha256`。apply首个可变动作前重算view并逐项相等；metadata/before/derived/path集合漂移均fatal，禁止基于新基线静默rebase。apply成功的receipt确定性payload必须来自sealed view。

### 19.4 Test-change-set 结构化错误

after侧继续严格拒绝列数不一致、重复ID、非法UTF-8；before侧历史兼容不变。scanner/builder内部错误至少携带`code,target_paths[],producer,retryable`。跨target duplicate只有明确列出全部责任targets且全部唯一映射到可修复Agent slots时才可共同reopen；无法确定责任集合则fatal。

### 19.5 Legacy 事务

缺preflight record的0.14.1 sealed事务在apply首写前生成ephemeral view。pass则保持legacy seal完成apply；attributable fail则reopen。reopen后下一次seal使用新view/new seal。completed、applying或任何journal/receipt/marker/正式新字节不兼容迁移。

### 19.6 Reopen 与闭包守恒

reopen先原子持久化collecting：外层seal null、全部sealed hash null、rejected submitted hash null、其它submitted hash不变；之后才清理rejected私有字节。正式闭包、metadata和marker在该路径零写。只有completed receipt的final/artifact/commit paths构成可提交闭包。

### 19.7 验收

UT-S39-56～58、ST-S39-27与SMOKE-core-160～162必须覆盖歧义after、metadata drift、多target归因、legacy fixture、崩溃窗口、残留私有字节和RunLogos真实事务。

## 废止说明

> 状态：已废止（0.15.0）｜原策略标识：`on-touch-v1`｜替代判据：merge 目标集由 `deltas/` 目录派生（功能规格 §2.71）

按触达目标规格闭包于 0.15.0 整体废止。原规范要求作者在规划阶段枚举本次触达的场景，为每个触达场景补齐 requirement/feature/scenario/test 四维目标与其余维度的证据化 disposition，再由 change-lint L9 做 P==T==D 三方对账。

**废止理由**：让作者预测「改动会波及哪些规格」是错误的分工。本次减法自身在四个提案中漏标四次（合计 200 余个用例），全部由测试覆盖度发现、无一由 L9 发现；L9 实际拦下的是 targets 排序、SKIP 证据组合这类格式问题。更严重的是它逼出编造——一处只涉及测试规格表格格式的修复，也被要求为该场景补齐并不存在的场景文档变更。

**替代**：merge 的目标集是 `deltas/` 目录的无逻辑投影——每个可 merge 的 delta 经 `canonicalTargetFromDeltaPath` 映射为唯一 canonical target，目标存在即 MODIFY、缺失即 CREATE，在 merge 执行时按磁盘事实判定。规格是否波及完整，由 `openlogos verify` 的 ID 覆盖检查（规格声明的用例必须都有执行结果）保障。

**消费方影响**：`change-lint` 检查项由 10 项收敛为 9 项（L0～L8）；`baseline_closure_*` violation 码族不再发射；`proposal.md` 中已存在的 `baseline_closure` 块自 0.15.0 起被忽略而非报错，无需迁移。

**保留不变**：`canonicalTargetFromDeltaPath` 等路径映射判据、non-Markdown（OpenAPI / SQL）整文件 delta 的 marker 协议、以及 apply 阶段的原子落盘与恢复 journal——它们与闭包规划无关，逐行保留。
