## MODIFIED — Step 5: AI 驱动代码生成 + 测试代码（code-implementor Skill）
AI 面前已有完整上下文（原型 + 场景 + API + DB + 部署方案 + 测试用例 + 编排），此时生成的代码质量远高于直接写代码。按场景逐个生成、逐个验证。使用 `code-implementor` Skill 引导 AI 加载完整规格上下文、按场景分批实现、并确保代码与规格严格一致。

代码生成同时包括：
- **业务代码**：按时序图 Step 逐步实现
- **单元测试代码**：基于 Step 4a 的单元测试用例规格实现
- **场景测试代码**：基于 Step 4a 的场景测试用例规格实现
- **部署相关代码**：部署方案中要求的健康检查、迁移脚本、启动脚本或构建脚本
- **OpenLogos reporter 集成**：测试代码内嵌标准 reporter，将用例结果写入 `logos/resources/verify/test-results.jsonl` 或配置的阶段结果路径
- **verify 预跑配置检查**：代码完成前必须检查 `logos.config.json` 是否存在 `verify.pre_run_command`、`verify.regression_command` 或 `verify.incremental_command`；缺失时必须补齐或明确说明无法推断

## MODIFIED — Step 6: 测试验收
运行所有测试来验证代码，使用 `openlogos verify` 自动化判定验收结果。

**进入 Step 6 的前置门禁**：

- 仅当 Step 5 达到“业务代码 + UT/ST 测试代码 + reporter”完整交付时，才允许进入 Step 6
- 若发现“仅业务代码、无对应测试”或“测试代码缺少 reporter”，必须回到 Step 5 补齐后再执行验收
- Step 6 不承担“补写测试代码”的职责；其职责是对已完成的 Step 5 产物做自动化判定
- 项目应配置 verify 预跑命令；若无法推断，必须在交付说明中明确风险与手动配置方式

**验收流程**：

1. AI 在 Step 5 生成测试代码时，内嵌 OpenLogos reporter（见 [test-results.md](./test-results.md)）
2. 用户明确授权运行 `openlogos verify`
3. CLI 根据 `logos.config.json` 执行 `pre_run_command`，或按 `regression_command` → `incremental_command` 顺序执行两阶段测试
4. CLI 合并阶段结果，读取 JSONL + `logos/resources/test/*.md` 中的用例 ID → 自动计算验收结果

**验收三层判定**：

- **覆盖度**：JSONL 中出现的用例 ID / test-cases.md 中定义的全部用例 ID
- **通过率**：status=pass 的用例数 / JSONL 中的总用例数
- **需求追溯**（可选）：test-cases.md 中声明的覆盖范围是否覆盖 Phase 1 验收条件

**覆盖不足诊断**：

- 未配置任何 verify 预跑命令且覆盖不足时，CLI 必须提示可能只运行了局部测试
- 诊断必须建议配置 `verify.pre_run_command`，或配置 `verify.regression_command` + `verify.incremental_command`

**Gate 3.6**：`openlogos verify` 输出 PASS（所有用例通过 + 覆盖度 100%）。
