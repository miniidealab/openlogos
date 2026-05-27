## MODIFIED — Step 6: 完成后引导用户运行 verify
### Step 6: 完成后引导用户运行 verify

代码实现完成后，AI 必须：

1. **确认测试结果**：运行或提示运行对应测试，确保 `logos/resources/verify/test-results.jsonl` 或配置的阶段结果文件已生成。
2. **检查 reporter**：所有本批新增 / 修改的 UT/ST 测试必须写入 OpenLogos reporter。
3. **检查 verify 预跑配置**：读取 `logos/logos.config.json`，确认至少存在一个字段：
   - `verify.pre_run_command`
   - `verify.regression_command`
   - `verify.incremental_command`
4. **自动补齐或明确诊断**：
   - 若项目已有配置，不覆盖。
   - 若缺失且可从技术栈推断，则写入 `verify.pre_run_command`。
   - 若无法推断，必须在交付说明中明确提示用户补充配置，不能只说“建议配置”。
5. **解释原因**：reporter 可能在测试运行时清空 JSONL；如果只运行局部测试，`openlogos verify` 会因覆盖不足失败。预跑配置是代码完成前检查项，不是可选建议。

默认推断规则：

| 技术栈 / 文件 | 默认命令 |
|---|---|
| `package.json` 存在 `scripts.test` | `npm test` |
| Vitest | `npx vitest run` |
| Jest | `npx jest` |
| pytest | `pytest` |
| Go | `go test ./...` |
| Cargo | `cargo test` |

若用户明确选择两阶段策略，可写入 `verify.regression_command` 与 `verify.incremental_command`，并确保阶段结果不会相互覆盖。
