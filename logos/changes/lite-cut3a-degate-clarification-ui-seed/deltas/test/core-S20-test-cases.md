# Delta: core-S20-test-cases.md

> change: lite-cut3a-degate-clarification-ui-seed
> 目标：`logos/resources/test/core-S20-test-cases.md`

seed 恢复门由「不可恢复即硬阻塞」改为「隔离损坏 journal 后继续」（§2.74.3）。**只改损坏分支**：可前滚/可回滚路径与读锁竞争语义逐字不变，故本文件中断言锁竞争的用例一律不动。

## MODIFIED — 五、adopt 后直接 change 测试（baseline-on-touch）


> 所有用例实现必须写入 OpenLogos reporter `logos/resources/verify/test-results.jsonl`。

### 5.1 单元测试

| ID | 检查项 | 输入 | 期望 |
|---|---|---|---|
| UT-S20-14 | adopt 完成主提示 | 新存量项目执行 adopt | 主动作是 `openlogos change <slug>`；seed 仅可选说明 |
| UT-S20-15 | required 不劫持 next | adopted + `baseline_seed_state: required` + 无提案 | next action 指向 change；不指向强制 baseline-seed |
| UT-S20-16 | 安全 partial 不劫持 next | adopted + partial/open run、无未终结 journal | 未提交 staging 不采信；change 仍可达；seed 重试为非阻断诊断 |
| UT-S20-18 | legacy 缺字段兼容 | adopted、缺 seed 字段 | helper 可派生兼容状态；默认 action 仍为 change，JSON shape 合法 |
| UT-S20-19 | 未终结 journal 恢复失败即隔离并继续 | adopted + journal=`prepared|committing`，故障注入使前滚/回滚失败 | **零退出并告警**；损坏 journal 重命名为 `<run>.commit-journal.corrupt-<时间戳>.json` 且内容逐字节保留；在 resources/index/coverage 读取前停止，不输出 change 主动作 |

### 5.2 场景测试

| ID | 场景 | 操作 | 期望 |
|---|---|---|---|
| ST-S20-10 | 从 adopt 到首个 plan | 真实临时项目 adopt → next → change → 生成 proposal/tasks | 无 baseline-seed 步骤即可到 plan；proposal/tasks 结构完整可解析 |
| ST-S20-11 | 能力缺失降级 | CLI-only adopt，无 AI seed 能力 | 不伪造文档；给出可复制 change 命令；不把 required 当阻塞 |
| ST-S20-13 | safe partial 与半新事务分流 | 分别构造仅 staging 的 partial 与 rename 中断的未终结 journal，执行 next/change 入口 | 前者直接 change 且 staging 排除；后者恢复失败硬报 **零退出并告警**；损坏 journal 重命名为 `<run>.commit-journal.corrupt-<时间戳>.json` 且内容逐字节保留，读取哨兵未触发、无 proposal 写入 |

### 5.3 覆盖与兼容

- Initial phase 仍显示“已跳过（存量项目接入）”，launch 豁免不变。
- 既有 AI 指令文件合并、reference 目录、verify 预跑推断与重复初始化拒绝均保持。
- 不删除 seed 字段/命令，不触发数据迁移；只改变默认用户路径与消费优先级。

