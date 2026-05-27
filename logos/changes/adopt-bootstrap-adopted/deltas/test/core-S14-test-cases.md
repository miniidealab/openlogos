## MODIFIED — # S14: 切换到 launched 生命周期 — 测试用例
# S14: 切换到 launched 生命周期 — 测试用例

## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S14-01 | 检查 deployment_required | launch 逻辑 | module 配置 | launch | 判断是否需要部署 |
| UT-S14-bootstrap-01 | bootstrap=adopted 时豁免 Initial 文档门禁 | launch 逻辑 | 模块 bootstrap=adopted（或历史 skipped），Initial 文档为空 | launch | 不检查 Initial 文档，直接通过 |
| UT-S14-bootstrap-02 | bootstrap=normal 时仍检查 Initial 文档门禁 | launch 逻辑 | 模块 bootstrap=normal（默认），Initial 文档为空 | launch | 拒绝并报错，提示 Initial 文档不完整 |

## 二、场景测试用例
### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S14-01 | 标记 launched 生命周期 | Step 1→7 | verify PASS 且门禁满足 | launch | lifecycle 变更为 launched |
| ST-S14-bootstrap-01 | 存量项目接入模块 launch 豁免门禁 | Step 1→7（接入分支） | adopt 完成，bootstrap=adopted，Initial 文档为空 | 执行 launch | 成功，lifecycle=launched，无门禁错误 |
| ST-S14-bootstrap-02 | 历史 skipped 模块 launch 豁免门禁 | Step 1→7（接入分支） | 旧项目 bootstrap=skipped，Initial 文档为空 | 执行 launch | 成功，lifecycle=launched，无门禁错误 |
