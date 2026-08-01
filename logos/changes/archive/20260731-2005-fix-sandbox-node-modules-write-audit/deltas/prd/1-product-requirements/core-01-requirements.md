## MODIFIED — S13 验收条件「异常：sandbox always 无法隔离」

##### 异常：sandbox always 无法隔离
- **GIVEN** `logos.config.json` 配置 `verify.sandbox_mode=always`
- **WHEN** 当前环境无法创建沙箱、无法启用运行期写保护、沙箱副本存在解析目标逃逸沙箱的 symlink，或预跑命令尝试写入仓库非白名单路径（沙箱内一次性依赖目录豁免：规范化后存在完整路径段严格等于 `node_modules` 的写入不参与非白名单判定，见功能规格 §2.9）
- **THEN** `openlogos verify` 失败，输出失败原因、沙箱路径和修复建议，不得伪装为普通测试失败

## MODIFIED — S19 验收条件「异常：sandbox always 无法隔离」

##### 异常：sandbox always 无法隔离
- **GIVEN** `logos.config.json` 配置 `smoke.sandbox_mode=always`
- **WHEN** 当前环境无法创建沙箱、无法启用运行期写保护、沙箱副本存在解析目标逃逸沙箱的 symlink，或 `smoke.command` 尝试写入仓库非白名单路径（沙箱内一次性依赖目录豁免：规范化后存在完整路径段严格等于 `node_modules` 的写入不参与非白名单判定，见功能规格 §2.9）
- **THEN** `openlogos smoke` 失败，输出失败原因、沙箱路径和修复建议，不得写入通过标记
