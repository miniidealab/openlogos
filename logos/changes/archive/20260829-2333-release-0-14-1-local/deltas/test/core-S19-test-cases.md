## ADDED — S19 OpenLogos 0.14.1 本地全局 patch 候选测试用例

### 测试边界

本组用例只验证当前 0.14.1 candidate/package identity、本地真实打包与隔离安装回滚链。0.14.0 breaking cutover 的历史断言、协议兼容 fixture 和既有 SMOKE-core-141～156 保持不变；实现不得用全仓字符串替换让历史语义改写为 0.14.1。

UT 使用仓库文件和临时目录，不修改用户真实全局环境。ST-S19-15 使用隔离 npm prefix 完成真实 tarball 安装与回滚恢复；本机全局 `/opt/homebrew` 的实际覆盖只在 verify PASS 后由独立部署授权执行。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|---|---|---|---|---|---|
| UT-S19-22 | 当前 0.14.1 candidate identity 全源一致且历史 0.14.0 语义保留 | S19-AC-01、功能规格 2.44.9 | 仓库版本同步已完成，prepack 可生成 asset manifest | 读取 CLI package/lock 根版本、Claude/Codex/ZCode/Qoder/WorkBuddy manifest、candidate 常量、相关 golden 与打包后 asset manifest；同时扫描标注为 breaking/history/legacy fixture 的 0.14.0 语料 | 所有当前 identity 精确为 0.14.1，tarball metadata 与 manifest 同源；历史 0.14.0 注释、错误合同和兼容 fixture 保持预期值，未被机械替换 |
| UT-S19-23 | 旧证据、混合版本与公开发布动作 fail-closed，回滚命令只使用冻结的 0.14.0 制品 | S19-AC-02、S19-AC-04、EX-6.1 | 构造合法 0.14.1 candidate facts、0.14.0 旧 facts、缺字段/混合版本 facts 与固定回滚 tarball facts | 对每组证据运行 candidate validator 和部署命令构造器；注入 publish、dist-tag、tag、release、官网部署、push 命令 | 仅完整同源 0.14.1 facts 通过；旧/混合/缺失 facts 返回稳定错误且不安装；调用图含公开发布动作时拒绝；回滚命令引用固定 0.14.0 tarball 绝对路径并包含恢复后入口/版本校验 |

### 场景测试

| ID | 描述 | 覆盖 Steps / EX | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S19-15 | 隔离 prefix 完成真实 0.14.1 pack、install、self-check、0.14.0 rollback 与 0.14.1 restore | Step 2→7、Step 11；EX-3.2、EX-5.1、EX-6.1 | CLI 全量测试/构建已通过；临时 npm prefix；固定 0.14.0 回滚 tarball；不使用真实全局 prefix | 执行真实 `npm pack --json` 并记录 SHA；从 tarball 安装到隔离 prefix；新 shell 校验入口/版本/package/plugin/asset/candidate facts；安装 0.14.0 并复核；重新安装同一 0.14.1 tarball 并复核；分别注入版本、路径、hash 和安装失败 | 正常链最终为同一 0.14.1 tarball，两个版本切换均有入口/版本/SHA 证据；每个失败注入均在错误阶段 fail-closed、恢复到明确版本且无混合资产；命令图无公开发布动作，临时目录清理范围受 realpath containment 保护 |

### OpenLogos Reporter 合同

- 测试实现名称必须原样包含 UT-S19-22、UT-S19-23、ST-S19-15。
- 每个 ID 向 `logos/resources/verify/test-results.jsonl` 写一条结果，至少包含 `test_id`、`scenario_id="S19"`、`status`、`timestamp`、`duration_ms` 与脱敏 evidence。
- UT-S19-22 evidence 记录版本源清单、asset manifest hash 与历史语料保留摘要；UT-S19-23 记录拒绝分类和回滚 tarball SHA；ST-S19-15 记录隔离 prefix 摘要、candidate/rollback SHA、每次入口/版本与失败阶段。
- status 只能来自真实断言；不得为满足 verify 覆盖率预写或补写伪造 pass。

### 验收条件追溯

| AC ID | 验收条件摘要 | 覆盖用例 |
|---|---|---|
| S19-AC-01 | 真实 0.14.1 tarball 与全部版本/资产身份同源 | UT-S19-22、ST-S19-15 |
| S19-AC-02 | 固定 tarball 本地安装且新 shell 入口精确 | UT-S19-23、ST-S19-15 |
| S19-AC-03 | 安装态最小 smoke 使用同一 candidate 和真实 reporter | ST-S19-15、SMOKE-core-157、SMOKE-core-158 |
| S19-AC-04 | 失败回滚与 0.14.1→0.14.0→0.14.1 恢复，无公开发布副作用 | UT-S19-23、ST-S19-15、SMOKE-core-159 |

### 覆盖度与后续实现约束

- [x] package/candidate identity 正常与混合版本异常：UT-S19-22、UT-S19-23。
- [x] 真实 tarball、隔离安装、新 shell 入口与资产自检：ST-S19-15。
- [x] 固定 0.14.0 回滚、0.14.1 恢复与失败注入：UT-S19-23、ST-S19-15。
- [x] 公开发布副作用为零：UT-S19-23、ST-S19-15。
- [x] S19-AC-01～04 均有 UT/ST 或 smoke 追溯。

后续 `[code]` 切片必须同时实现或更新覆盖 SMOKE-core-157～159 的 `scripts/smoke-*` runner、OpenLogos smoke reporter 与 `scripts/run-smoke.js` dispatcher 接入；code 完成前必须运行 smoke 覆盖预检，确保三个新增 ID 均不在 uncovered cases 中。
