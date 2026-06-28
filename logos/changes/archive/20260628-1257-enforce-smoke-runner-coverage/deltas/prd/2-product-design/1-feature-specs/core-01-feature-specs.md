## ADDED — 2.24 smoke runner 覆盖强制规则

### 2.24.1 目标
当提案新增或修改 `logos/resources/test/smoke/*.md` 时，OpenLogos 必须把 smoke 用例从规格层推进到可执行验收层。新增 `SMOKE-*` ID 不能只存在于 Markdown 表格中；code 阶段必须同步交付 smoke runner、reporter 和 `smoke.command` / dispatcher 接入，确保部署后 `openlogos smoke` 不因 runner 缺失产生 uncovered。

### 2.24.2 code 阶段规则
- change-writer 生成 `[code]` 切片时，若本提案新增或修改 smoke 用例，切片描述必须显式包含 smoke runner/reporter/dispatcher 交付物。
- test-writer 生成 smoke 用例时，必须同步在后续 code 任务中加入以下要求：
  - 实现或更新 smoke runner，例如 `scripts/smoke-<change>.sh`、`scripts/smoke-<change>.mjs` 或项目等效入口。
  - smoke runner 必须写入 `logos/resources/verify/smoke-results.jsonl`，每行一个 `{ id, status, ... }` JSONL 结果。
  - 每个新增 `SMOKE-*` 用例 ID 至少有一条真实执行结果；禁止伪造未执行的 PASS。
  - 若项目使用 `logos.config.json.smoke.command`，必须确保该 command 能执行新增 runner，或由统一 dispatcher 自动发现并执行。
- code-implementor 执行 `[code]` 切片前必须列出本片覆盖的 UT/ST/SMOKE 用例 ID；若存在新增 `SMOKE-*`，本片交付物必须包含 smoke runner/reporter。
- `[code]` 切片只有在业务代码、UT/ST、OpenLogos verify reporter、smoke runner/reporter/dispatcher 接入均完成后才能勾选。

### 2.24.3 CLI 覆盖预检
CLI 应提供 smoke 覆盖预检能力，供 `openlogos verify`、code completion gate 或 RunLogos driver 在 code 阶段结束前调用：

1. 读取活跃提案的 delta 或已合并规格，找出本提案新增或修改的 `logos/resources/test/smoke/*.md`。
2. 提取新增或受影响的 `SMOKE-*` 用例 ID。
3. 读取 `logos/resources/verify/smoke-results.jsonl` 或 `logos.config.json.smoke.result_path` 指向的结果文件。
4. 检查 `logos.config.json.smoke.command` 是否存在，且能运行统一 dispatcher 或包含本提案 smoke runner。
5. 对新增 smoke 用例计算 defined/executed 覆盖关系；若存在未覆盖 ID，不允许 code 阶段被标记为完成。

### 2.24.4 诊断码
smoke 覆盖预检和 `openlogos smoke --format json` 应为 RunLogos 暴露可机器识别诊断：

| 诊断码 | 触发条件 | 建议 |
|---|---|---|
| `smoke_runner_missing` | 新增 `SMOKE-*` 用例，但未发现对应 `scripts/smoke-*`、统一 dispatcher 注册或等效 runner | 在 `[code]` 切片中实现 runner 并接入 dispatcher |
| `smoke_reporter_missing` | runner 存在，但未写入 `smoke-results.jsonl` 或写入路径与 `smoke.result_path` 不一致 | 使用 OpenLogos smoke reporter 写入配置声明的 result path |
| `smoke_cases_uncovered` | `smoke-results.jsonl` 中缺少新增 `SMOKE-*` ID 的执行结果 | 运行或修复 smoke runner，直到所有新增 ID 有真实结果 |

### 2.24.5 统一 smoke dispatcher
推荐为项目配置统一 smoke dispatcher，例如：

```json
{
  "smoke": {
    "command": "node scripts/run-smoke.js",
    "result_path": "logos/resources/verify/smoke-results.jsonl"
  }
}
```

dispatcher 至少应支持：
- 自动发现 `scripts/smoke-*.sh`、`scripts/smoke-*.mjs` 或项目声明的等效 runner。
- 在每次执行前按项目策略清空或隔离 `smoke-results.jsonl`，避免旧结果伪装覆盖。
- 将 runner exit code、失败用例和未覆盖用例传递给 `openlogos smoke` 的 JSON 输出。
- 可按活跃提案只运行相关 runner；若无法归属，则运行全部 canonical smoke runner。

## MODIFIED — S13
verify 必须关联测试用例与运行结果，并负责在读取结果前触发配置的测试预跑命令。若配置了 `regression_command` 与 `incremental_command`，verify 必须按顺序执行并合并结果；若配置了 `verify.sandbox_mode`，预跑命令必须通过沙箱执行器运行，并在 JSON 输出中暴露 `sandbox` 诊断；若覆盖不足且无预跑配置，必须诊断可能只运行了局部测试，并给出配置建议。若活跃提案新增或修改 smoke 用例，verify 或 code completion gate 还必须执行 smoke 覆盖预检，提前发现 smoke runner/reporter 缺失，避免问题延迟到部署后暴露。

## MODIFIED — S19
smoke 必须验证部署后环境的最小可用链路，但只在提案级 `smoke_required: true` 且部署完成后进入。部署进度摘要仅能来自 `tasks.md` 的 `[deploy]` section，不能把 `[code]` section 误当作部署进度。若配置了 `smoke.sandbox_mode` 且存在 `smoke.command`，CLI 必须通过沙箱执行器运行 smoke 命令，并在文本与 JSON 输出中暴露沙箱诊断。若 smoke 用例来自当前提案新增或修改，`openlogos smoke` 必须能区分 runner 缺失、reporter 缺失与用例 uncovered，并在 JSON 中暴露诊断码。

## MODIFIED — S31
launched `implement` 默认以切片循环推进：切片来自 `tasks.md` `[code]`，收敛 = 全部切片勾选 ∧ 末轮测试绿（`code_slices_green`），空 `[code]` 退化 `tests_green`。`next` 透出当前切片（`next_node.slice` + `slice_state`）；`verify` 全量回归并追加可带 `slice` 的 `LOOP_ITERS`；达 `max_iters:30` 未达成升级 `gate:implement:loop-exhausted`（`skippable:false`）。切片提示语义为"下一个未建切片"，回归修复目标由全量 verify 输出决定、归宿主判。initial 多模块不支持。若切片对应的规格变更新增或修改 smoke 用例，该切片必须同步完成 smoke runner/reporter/dispatcher 接入后才能勾选。
