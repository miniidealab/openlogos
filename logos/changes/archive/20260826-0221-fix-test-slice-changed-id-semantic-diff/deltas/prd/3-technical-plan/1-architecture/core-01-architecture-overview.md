## MODIFIED — 二十七、切片验收事实、Gate 与恢复架构

### 27.1 组件与单一事实源

```text
MERGE_APPLY_MANIFEST + before/final test bytes
                    │
                    ▼
        TestDefinitionDiff（纯函数）
                    │
                    ▼
resources + metadata + SPEC_MERGED.test_change_set
              （同一原子事务）
                    │
                    ▼
        TestChangeSetReader（先验来源门）
                    │
                    ▼
slice-planner ──原子写──► TEST_SLICE_MANIFEST.json
                              │
                 ┌────────────┴────────────┐
                 ▼                         ▼
       SliceVerificationService      status/next/change-lint
                 │                         │
        ┌────────┴────────┐                └──► recovery 或 human block
        ▼                 ▼
 verify collector   SLICE_CHECKPOINTS.jsonl
        │
        ├──► VERIFY_PASS / VERIFY_FAIL
        └──► LOOP_ITERS(attempted_slice_id)
```

`TestDefinitionDiff` 是测试表解析、规范化、before/after 差异与 canonical hash 的唯一实现；`TestChangeSetReader` 是 marker/schema/hash/target identity 校验的唯一实现；`SliceVerificationService` 是 manifest、fingerprint、attempted slice、eligible/pending 与模式选择的唯一计算点。命令层只能消费这些不可变结果，禁止各自扫描 Delta、Git 历史或 checkbox 建立第二套算法。

### 27.2 文件职责

| 文件/事实 | 写入者 | 语义 |
|---|---|---|
| `MERGE_APPLY_MANIFEST.json` | merge-executor Agent | 严格 `baseline-merge-apply@1` prepared/metadata 最终字节；合同键不扩展 |
| `SPEC_MERGED.test_change_set` | `openlogos merge-apply` | `openlogos/test-change-set@1`；C/R、测试 target before/after identity 与 payload hash |
| `TEST_SLICE_MANIFEST.json` | `slice-planner` | 稳定切片身份、C 的唯一归属、runner selector、task/spec fingerprint |
| `SLICE_CHECKPOINTS.jsonl` | `openlogos verify` | append-only checkpoint；PASS 绑定 `slice_id + slice_manifest_sha256` |
| `LOOP_ITERS` | `openlogos verify` | 真实 Gate 尝试；checkpoint 行携 verify mode 与 attempted identity |
| `VERIFY_PASS` | `openlogos verify` | 仅 final 全量 Gate PASS |
| `VERIFY_FAIL` | `openlogos verify` | eligible/final 的真实失败；来源或 manifest 恢复态不写 |

change set 不含时间戳，输入相同则字节稳定；`SPEC_MERGED.completed_at` 继续是 marker 审计字段，不进入 change-set hash。checkpoint 读取先按 slice manifest 哈希过滤，过期行只保留审计。

### 27.3 TestChangeSet v1 数据模型

```ts
interface TestChangeSetV1 {
  schema: 'openlogos/test-change-set@1';
  change: string;
  module: string;
  source: 'semantic-before-after-diff';
  changed_test_ids: string[];
  removed_test_ids: string[];
  targets: Array<{
    target_path: string;
    before_sha256: string | null;
    after_sha256: string;
  }>;
  sha256: `sha256:${string}`;
}
```

顶层与 target 项均严格键；ID 与 target 按 ASCII 排序、去重；C/R 不相交。`sha256` 对排除自身字段的固定键序 canonical JSON 计算。change/module 与 guard 匹配；targets 与 baseline plan 中 category=test 的 prepared targets 一一相等；MODIFY before 非空，CREATE before 为 null。

### 27.4 结构化解析与差异算法

1. 使用 Markdown authority scanner 排除围栏代码与 HTML 注释。
2. 只识别具有表头、分隔行且首逻辑单元格精确匹配 canonical UT/ST/SMOKE ID 的行；逻辑 cell parser 支持 escaped pipe 与 inline-code pipe。
3. 为每个 ID 构造 `{target_path, column_identity[], cell_semantics[]}`；统一 LF、外围空白与表格对齐，不折叠内部语义文本。
4. 前态或后态的全局 ID 重复、非法 UTF-8、无法唯一确定表结构均 fail-closed。
5. 后态新增或同 ID 记录变化进入 C；前后相同留 baseline；前有后无进入 R；target_path 变化视为修改。
6. 行顺序、CRLF/LF、对齐与外围空白不触发修改；列身份/顺序或有意义 cell 变化触发修改。

### 27.5 merge-apply 原子提交

`merge-apply` 在任何写入前完成 L1～L9、guard、严格 manifest、P=T=D、source/before/final hashes、CREATE/MODIFY 与 metadata 预检。随后对全部 test targets 计算 change set，构造完整 marker，并把 resources、metadata、`SPEC_MERGED` 作为同一 `applyBaselineClosureBatch()` inputs；marker 最后写。

事务返回成功前必须重读测试 targets 与 marker，复核 after hashes、change-set hash、schema、change/module 和 manifest 绑定。任一预检、写入、fault injection 或事后复核失败，都恢复 MODIFY/metadata、删除本批 CREATE 和 marker，不留下半完成 spec-complete。

### 27.6 状态推导与恢复分层

1. 已有合法 final `VERIFY_PASS` 的 legacy 提案保持完成。
2. no-delta marker 且确无 mergeable delta时可信派生空 C/R。
3. 其余多切片提案先加载 change set；缺失、unsupported、hash/target 漂移时返回 `test-slice-manifest-invalid` + `test-slice-change-set-*` violation + human action，不派 `plan-slices`。
4. change set 有效后加载 slice manifest；missing/invalid/stale 才返回既有 `plan-slices` recovery。
5. 两层均有效时，从 PASS checkpoints 恢复 confirmed，选择首个未确认 slice 为 attempted；存在 attempted 进入 checkpoint，无 attempted 且 code 完成进入 final。

### 27.7 失败域隔离

- change set 来源失败：规格来源域；无 runner/Gate/loop/checkpoint 副作用，不能由 slice-planner 修复。
- slice manifest 缺失/已知 schema 非法/fingerprint 漂移：切片规划恢复域，不消耗代码 repair budget。
- slice 归属重复、未知 ID或 selector 不闭合：保守切片阻塞域。
- eligible 测试失败：当前 slice repair 域，写 attempted identity。
- final 失败：最终回归 repair 域，pending 必须为空。

### 27.8 OpenLogos 与 RunLogos 边界

OpenLogos 提供 C/R、violation、manifest state、next node 与 Gate 结论；RunLogos 只消费结构化动作。OpenLogos change-set 不可信时不得伪造可恢复动作；RunLogos 的 `manifest_data` 可空解析、`classifyManifest()` 生产接线、WorkUnit 与 allowlist 修复属于 companion change，不在本仓修改。

### 27.9 实现映射

- `cli/src/commands/merge-apply.ts`：before/final 输入接线、marker 构造与事务后置复核。
- 新共享纯函数模块：authority table parser、规范化 diff、canonical hash、strict reader。
- `cli/src/lib/test-slice-manifest.ts`：生产路径移除 `extractChangedTestIds()`，改从 reader 获取 C/R。
- status/next/change-lint/verify：继续消费共享 slice state，不直接解析 marker。
- `cli/test/`：S32/S39 UT/ST、fault injection、无 Git/重启与事故 fixture。

### 27.10 架构不变量

1. `MERGE_APPLY_MANIFEST` 严格合同不扩展；change set 随 marker 原子持久化。
2. `O = C` 与唯一归属继续 fail-closed；R 不进入 O。
3. C 只来自 before/after 结构化语义差异，不来自 Delta 出现集合或 Git。
4. change set 无效不得误派 slice-planner；slice manifest 无效且 change set 有效才可恢复。
5. attempted slice 从 manifest + checkpoint 恢复，不从 checkbox 反推。
6. pending 不是结果；checkpoint PASS 不等于 final PASS。
7. final 始终覆盖全部已定义非 manual 测试。
