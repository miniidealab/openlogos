## ADDED — OpenLogos 0.14.21 guard 修复发布 Smoke

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
