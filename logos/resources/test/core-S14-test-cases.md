# S14: 切换到 launched 生命周期 — 测试用例


## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S14-01 | 检查 deployment_required | launch 逻辑 | module 配置 | launch | 判断是否需要部署 |
| UT-S14-bootstrap-01 | bootstrap=adopted 时豁免 Initial 文档门禁 | launch 逻辑 | 模块 bootstrap=adopted（或历史 skipped），Initial 文档为空 | launch | 不检查 Initial 文档，直接通过 |
| UT-S14-bootstrap-02 | bootstrap=normal 时仍检查 Initial 文档门禁 | launch 逻辑 | 模块 bootstrap=normal（默认），Initial 文档为空 | launch | 拒绝并报错，提示 Initial 文档不完整 |
| UT-S14-02 | launch 刷新 AI 指令时保留用户内容 | launch 逻辑 | 根指令文件 marker 外有用户自定义内容 | launch | 托管片段更新为 launched 规则，用户内容不变 |
| UT-S14-03 | 指定模块不存在时报错退出 | EX-1.1 | 注册表无该模块 id | `launch <未知module>` | 输出 moduleNotFound 错误、非零退出，不改任何文件 |
| UT-S14-04 | 多模块未指定 --module 时报错退出 | EX-1.2 | 注册表 ≥2 模块，未带模块参数 | `launch` | 输出 multiModuleError（列出模块 id）、非零退出；0 模块则输出「无已注册模块」错误 |
| UT-S14-05 | 已 launched 模块幂等不重复推进 | EX-5.1 | 模块 lifecycle 已为 launched | `launch <module>` | normal：输出 moduleAlreadyLaunched、零码 no-op；adopted：幂等刷新资产、不改写 lifecycle |

## 二、场景测试用例

### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S14-01 | 标记 launched 生命周期 | Step 1→7 | verify PASS 且门禁满足 | launch | lifecycle 变更为 launched |
| ST-S14-bootstrap-01 | 存量项目接入模块 launch 豁免门禁 | Step 1→7（接入分支） | adopt 完成，bootstrap=adopted，Initial 文档为空 | 执行 launch | 成功，lifecycle=launched，无门禁错误 |
| ST-S14-bootstrap-02 | 历史 skipped 模块 launch 豁免门禁 | Step 1→7（接入分支） | 旧项目 bootstrap=skipped，Initial 文档为空 | 执行 launch | 成功，lifecycle=launched，无门禁错误 |
| ST-S14-03 | launch 保留根指令文件用户配置 | Step 6 | launch 前根指令文件已有用户内容 | 执行 launch | OpenLogos managed block 更新；用户内容仍存在 |
| ST-S14-04 | 已 launched 模块重复执行幂等收敛 | Step 1→5（幂等分支） | 模块 lifecycle 已为 launched | 再次执行 `launch <module>` | normal：提示已 launched 并 no-op 返回；adopted：幂等刷新托管片段与资产、lifecycle 不变、无语义漂移 |

