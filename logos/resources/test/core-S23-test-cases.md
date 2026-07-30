# S23: 实时观测派生研发状态（watch） — 测试用例

## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S23-01 | 启动先输出一次初始快照 | watch loop | 已初始化项目 | 启动 watch | 立即产出一条 `seq=0`、`event="snapshot"` 的输出，无需等变化 |
| UT-S23-02 | 仅在派生 data 变化时输出 | watch diff | 已初始化项目 | 连续两次轮询 data 相同 | 不产生新输出；data 深比较不相等才产出 |
| UT-S23-03 | 变化判定 = 相邻两次 data 深比较 | watch diff | 已初始化项目 | 第二次轮询 data 变化 | 产出一条 `event="change"`、`seq` 递增的输出 |
| UT-S23-04 | 每条输出含递增 seq 与 timestamp | watch envelope | `--format json` | 初始快照 + 多次变化 | 每条含递增 `seq` 与 `timestamp` |
| UT-S23-05 | `--format json` 的 data.status 与 status 同构 | watch json | `--format json` | 输出一条 | `data.status` 与 `openlogos status` 的 `data` 同结构 |
| UT-S23-06 | `--interval` 控制轮询间隔（默认 2s） | watch interval | `--interval 5` | 启动 watch | 轮询间隔为 5s；缺省为 2s |
| UT-S23-07 | 继承 `--module` 过滤 | watch module | 多模块项目 | `--module core` | 派生与变化判定仅针对 core，与 `status --module core` 派生一致 |
| UT-S23-08 | 只读无副作用 | watch readonly | 已初始化项目 | 运行一段 watch 后退出 | 运行期间不写任何文件、不改提案/派生状态 |
| UT-S23-09 | SIGINT 优雅退出 | watch signal | watch 运行中 | 发送 SIGINT | 清理轮询并优雅退出，无写副作用 |
| UT-S23-10 | 未初始化报 PROJECT_NOT_INITIALIZED | watch guard | 无 `logos/logos.config.json` | 启动 watch | 输出 `PROJECT_NOT_INITIALIZED`，非零退出，不进入轮询 |

## 二、场景测试用例
### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S23-01 | watch 启动输出初始快照后仅变化时刷新 | Step 1→7 | 已初始化项目 | 启动 watch → 制造一次派生变化 | 先一条初始快照（seq=0）；无变化时静默；变化后一条 change 事件（seq=1）|
| ST-S23-02 | `--format json` 输出行分隔 JSON 流 | Step 1→7 | 已初始化项目 | `openlogos watch --format json` | 每行一个 envelope（command="watch"），含 `seq`/`timestamp`，`data.status` 与 status 同构 |
| ST-S23-03 | `--module` 过滤的派生与 status 一致 | Step 1→7 | 多模块项目 | `openlogos watch --module core` | watch 的 `data.status` 与 `openlogos status --module core` 派生一致 |
| ST-S23-04 | `--interval` 自定义轮询间隔 | Step 5 | 已初始化项目 | `openlogos watch --interval 5` | 轮询周期约 5s（不在 5s 内重复轮询）|
| ST-S23-05 | Ctrl-C 优雅退出且只读 | Step 8→9 | watch 运行中 | 发送 SIGINT | 优雅退出，运行期间工作区无任何文件写入 |

## 三、异常测试用例
| ID | 描述 | 覆盖异常 | 前置条件 | 操作序列 | 预期结果 |
|----|------|----------|---------|---------|---------|
| ST-S23-EX-2.1 | 项目未初始化 | EX-2.1 | 缺少 `logos/logos.config.json` | `openlogos watch` | 输出 `PROJECT_NOT_INITIALIZED`，非零退出，不进入轮询 |

## 四、覆盖度校验清单
- [ ] 启动初始快照已覆盖：UT-S23-01、ST-S23-01
- [ ] 仅变化时输出 + data 深比较已覆盖：UT-S23-02、UT-S23-03、ST-S23-01
- [ ] seq/timestamp 流已覆盖：UT-S23-04、ST-S23-02
- [ ] `--format json` 与 status 同构已覆盖：UT-S23-05、ST-S23-02
- [ ] `--interval` 已覆盖：UT-S23-06、ST-S23-04
- [ ] 继承 `--module` 已覆盖：UT-S23-07、ST-S23-03
- [ ] 只读无副作用已覆盖：UT-S23-08、ST-S23-05
- [ ] SIGINT 优雅退出已覆盖：UT-S23-09、ST-S23-05
- [ ] 未初始化错误已覆盖：UT-S23-10、ST-S23-EX-2.1
