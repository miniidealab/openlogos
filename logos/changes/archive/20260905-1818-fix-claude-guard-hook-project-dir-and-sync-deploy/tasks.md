# 实现任务

## [delta] 规格变更

- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：S01/S08/S09 验收条件补 hook 注册形态、sync 补齐 guard 资产、非根 cwd fail-closed
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：三项修复功能规格（注册与幂等迁移、工作目录收敛、sync 托管 guard 资产）
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-cli-init.md`：init 写入 hook 的 $CLAUDE_PROJECT_DIR 形态与新旧条目幂等迁移
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S08-sync-ai-tools.md`：托管资产面纳入 guard（bin+hook 注册+manifest 登记），存量项目 sync 补齐
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`：guard-check 工作目录收敛时序与 fail-closed 异常边界
- [x] [MODIFY] `deltas/spec/pretooluse-guard.md`：配置示例改 $CLAUDE_PROJECT_DIR 形态；成文工作目录收敛 fail-closed 与 sync 资产面部署合同
- [x] [MODIFY] `deltas/test/core-S01-test-cases.md`：UT-S01-137～138、ST-S01-30
- [x] [MODIFY] `deltas/test/core-S08-test-cases.md`：UT-S08-59～60、ST-S08-37
- [x] [MODIFY] `deltas/test/core-S09-test-cases.md`：UT-S09-313～314、ST-S09-120

## [code] 代码实现

> 六维打分：影响范围 1（init.ts/sync 面/plugin/bin/guard-check + 三测试文件）、行为复杂度 1（fail-closed 与新旧迁移少量分支）、契约变化 1（hook 注册形态与资产面登记，无 API/发布面）、测试规模 2（9 个新 ID）、风险 1（不部署、判定语义零变化、易回滚）、不确定性 0 → 6 分，非大任务。
> 删后续自检：单切片无后续可删；三项修复（注册形态/工作目录收敛/sync 补齐）共享同一幂等迁移语义与同一脚本，拆开则任一片都要引用未落地的另一半（迁移判据或收敛后语义），不自闭环——按 SKILL 硬规则 0-7 分单切。
- [x] 单切片：Claude guard hook 三项修复——init/adopt 写入 PreToolUse/SessionStart 的 $CLAUDE_PROJECT_DIR 注册形态与新旧 command 幂等迁移；plugin/bin/guard-check 工作目录收敛（变量在场 cd、缺失且 cwd 非根 fail-closed exit 2 + 诊断，cd 后既有判定零改动）；guard 资产（bin + hook 注册）纳入 openlogos sync 托管资产面（asset-manifest 版本化哈希），存量项目 sync 补齐、幂等零重复；实现含 OpenLogos reporter 的 UT-S01-137～138、ST-S01-30、UT-S08-59～60、ST-S08-37、UT-S09-313～314、ST-S09-120