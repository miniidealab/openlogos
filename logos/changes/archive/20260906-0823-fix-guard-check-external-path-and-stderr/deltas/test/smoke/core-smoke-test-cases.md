# Delta: core-smoke-test-cases.md（fix-guard-check-external-path-and-stderr）

## ADDED — OpenLogos 0.14.22 guard 修复发布 Smoke

### 授权与统一前置

- 执行 `SMOKE-core-193` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.22`。
- 全部断言在一次性临时项目与临时 HOME 中构造；**不得触碰本仓或用户其它项目的活跃提案、guard、settings.json 与真实 `~/.claude` 目录**（项目外路径断言使用临时 HOME 下构造的 `~/.claude` 形态路径，不动真实 runlogos）。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-193 | 0.14.22 guard 两处修复全链且误拦截/无 stderr 在 0.14.21 复现 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 asset identity（含随包 guard-check 新字节与 manifest 条目）；② **管辖边界**：隔离 prefix init 新项目 → 置 launched 无提案，以 stdin JSON + env 驱动随包 guard-check：Edit 项目根之外目标（临时 HOME 下 `~/.claude/projects/x/memory/a.md` 形态路径、另一临时仓库绝对路径）→ exit 0 放行；③ **阻断 stderr 可见性**：同项目 Edit 项目内源码 → exit 2 且 stderr 含「变更管理拦截」与 `openlogos change` 指引、stdout `{"reason":…}` JSON 结构不变；Step 0 fail-closed 两形态（变量指向坏目录 / 变量缺失且 cwd 非根）→ exit 2 且 stderr 非空；④ **项目内零回归**：白名单路径放行、写 guard 文件后同一调用放行、`git push` 安全白名单放行；⑤ **0.14.21 对照**：固定 0.14.21 上重放② → **必须 exit 2 误拦截**（缺陷①复现），重放③ → exit 2 但 **stderr 必须为空**（缺陷②复现）；⑥ 演练 `0.14.21→0.14.22→0.14.21→0.14.22` 并复核每阶段 identity 与②③⑤结论 | ② 项目外一律放行；③ 拦截双通道齐备且 stdout JSON 可解析、与 stderr 文本语义一致；④ 逐项与 0.14.21 一致；⑤ **0.14.21 必须复现误拦截与空 stderr**——旧版也放行/也有 stderr 则矩阵空转判 FAIL；⑥ 往返无混装且结论不变；全程无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-193`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须写显式 `skip` 记录并携带缺失项，禁止静默零记录退出。
3. **guard 行为断言必须以 stdin JSON + env + cwd 驱动真实随包 guard-check 脚本，并同时捕获 stdout 与 stderr 两通道**；库级函数直调不计入闭环证据。
4. 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-193` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。

### 零回归对照（强制）

步骤⑤是本用例的空转防线：固定 `0.14.21` 上项目外目标**必须**误拦截、项目内拦截 stderr **必须**为空；否则矩阵空转，必须重写矩阵而非放行部署。

### OpenLogos Smoke Reporter

- 失败不得写 pass；缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。
