# Delta: core-smoke-test-cases.md

> change: fix-guard-check-bash-write-target-jurisdiction
> 目标：`logos/resources/test/smoke/core-smoke-test-cases.md`

## ADDED — OpenLogos 0.14.24 guard Bash 管辖判定发布 Smoke

### 授权与统一前置

- 执行 `SMOKE-core-195` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.24`。
- 全部断言在一次性临时项目与临时 HOME 中构造；**不得触碰本仓或用户其它项目的活跃提案、guard、settings.json 与真实 `~/.claude` 目录**（项目外路径断言使用临时 HOME 与临时 scratchpad 目录构造，不动真实 runlogos）。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-195 | 0.14.24 Bash 写命令管辖判定全链且全外误拦在 0.14.23 复现 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 asset identity（含随包 guard-check 新字节与 manifest 条目）；② **项目外放行**：隔离 prefix init 新项目 → 置 launched 无提案，以 stdin JSON + env 驱动随包 guard-check：`rm -rf <项目外路径>`（session scratchpad 形态）、`cp <项目外→项目外>`、`mkdir <项目外>` → 一律 exit 0 放行；③ **项目内拦截零回归**：`rm <项目内源码>`、混合形态 `cp <项目外> <项目内非白名单>` → exit 2 且 stderr 含「变更管理拦截」与 `openlogos change` 指引、stdout `{"reason":…}` JSON 结构不变；白名单目标放行、`git push` 安全白名单放行、写 guard 文件后同一调用放行、`>`/`>>` 重定向判定不变；④ **解析不出保守臂**：`rm $VAR`、`rm $(cmd)`、`rm a && rm b` 形态 → exit 2 维持拦截；⑤ **0.14.23 对照**：固定 0.14.23 上重放② → **必须 exit 2 误拦截**（缺陷复现）；⑥ 演练 `0.14.23→0.14.24→0.14.23→0.14.24` 并复核每阶段 identity 与②③⑤结论 | ② 全外路径一律放行；③ 逐项与 0.14.23 一致（安全面零放宽）；④ 保守臂维持拦截；⑤ **0.14.23 必须复现全外误拦截**——旧版也放行则矩阵空转判 FAIL；⑥ 往返无混装且结论不变；全程无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-195`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须写显式 `skip` 记录并携带缺失项，禁止静默零记录退出。
3. **guard 行为断言必须以 stdin JSON + env + cwd 驱动真实随包 guard-check 脚本，并同时捕获 stdout 与 stderr 两通道**；库级函数直调不计入闭环证据。
4. 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-195` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。

### 零回归对照（强制）

步骤⑤是本用例的空转防线：固定 `0.14.23` 上全部路径实参在项目外的 `rm`/`cp` **必须**被误拦截（exit 2）；否则矩阵空转，必须重写矩阵而非放行部署。

### OpenLogos Smoke Reporter

- 失败不得写 pass；缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。
