## ADDED — S16 Preflight/Reopen JSON 兼容测试

### 单元测试

| 用例ID | 验证目标 | 输入 | 关键断言 |
|---|---|---|---|
| UT-S16-33 | retryable error与status/next同源 | attributable preflight失败后捕获transaction command JSON，并读取status/next | error details为collecting/slot_identity_mismatch/submit_content/retryable=true；status与next identity/phase/actions逐值一致；missing只从既有content_slots读取 |
| UT-S16-34 | 公共schema零字段漂移 | new sealed、legacy sealed pass、reopened collecting、fatal、completed projections及错误envelope | merge/status/next schemas全过；公共对象键集合与golden一致；无`preflight_sha256/target_paths/producer`泄漏；receipt seal绑定正确 |

### 场景测试

| 用例ID | 验证目标 | 步骤 | 关键断言 |
|---|---|---|---|
| ST-S16-10 | 真实CLI跨进程错误重放 | subprocess apply legacy fixture触发retryable；分别运行status/next；修复后reseal/apply并再读completed | 所有stdout/stderr均可解析；错误后状态已落盘；新/旧seal兼容；response-lost可仅靠status恢复 |

### Runner 与 OpenLogos Reporter

UT-S16-33～34、ST-S16-10必须实际经过JSON序列化、AJV schema与语义validator，并逐ID写`test-results.jsonl`。内部结构化错误可以测试，但不得加入公共golden字段。
