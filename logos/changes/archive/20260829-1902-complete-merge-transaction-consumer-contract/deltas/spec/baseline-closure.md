## ADDED — 消费者可提交闭包与无环 hash

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
