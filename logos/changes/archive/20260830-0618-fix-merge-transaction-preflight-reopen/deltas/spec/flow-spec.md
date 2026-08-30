## ADDED — Preflight Reopen 后的 Flow 前沿派生

### 权威输入

Flow只消费OpenLogos merge transaction公共projection。不得读取merge-content/merge-staging、错误message、mtime、宿主ledger或旧dispatch completion推导slot状态。

### 前沿映射

| Transaction事实 | Flow前沿 |
|---|---|
| collecting + missing slots | `submit-content` producer工作单；可选abort按既有动作 |
| ready | `seal` |
| sealed | `apply` |
| applying或recovery_required | `recover` |
| completed有效receipt | spec-complete/切片前沿 |
| fatal/unattributable | 人工诊断；不派发regenerate或apply |

legacy sealed apply若core原子reopen，下一次派生必须立即从apply前沿回到collecting producer工作单；这是读取新权威snapshot，不是Flow自行倒转phase。

### Dispatch 规则

- 每个missing slot生成至多一个幂等内容工作单，artifact只能写声明staging path。
- 未受影响submitted slots不得重新派发。
- producer完成以submit后transaction hash为准，不以文件存在或Agent completion为准。
- 全部missing slots提交后重新派生ready/seal；seal失败可再次回collecting。

### 错误与并发

- response lost后先status/next；sealed与collecting都可安全重放其规范动作。
- status/next不一致、未知action、missing与item hash不一致时contract-invalid并停止派发。
- journal存在时禁止派发content，即使旧slot文件缺失。
- 多target错误由core给出最终missing集合，Flow不二次归因。

### 授权

plan-exit批准不使spec-exit/merge、verify、deliver、smoke、archive或push自动放行。只有用户显式`--auto`选择才应用standing授权；本次普通PLAN_APPROVED保持半自动确认点。

### 追溯

UT-S05-46/ST-S05-21验证next前沿；UT-S11-74/ST-S11-43验证status权威；UT-S16-33～34/ST-S16-10验证JSON同源；S09/S39验证core状态转换。
