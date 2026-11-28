## MODIFIED — verify `scope` 按模块限定范围字段 > 字段

```jsonc
"scope": {
  "mode": "module",                  // "module" | "all" | "fallback-full"
  "modules": ["core", "portal-web"],   // 本次范围内的模块 id，按 logos-project.yaml 中的顺序
  "reasons": [                       // mode=module 时列出每个模块进入范围的依据；其余模式为 []
    { "module": "portal-web", "source": "proposal", "ref": "module-scoped-demo" },
    { "module": "portal-web", "source": "delta", "ref": "deltas/test/portal-web-S50-test-cases.md" },
    { "module": "core", "source": "path", "ref": "src-tauri/src/protocol.rs" }
  ],
  "fallback_reason": null,           // mode=fallback-full 时为 { "code", "detail" }，否则 null
  "out_of_scope_result_count": 0     // 被忽略的范围外结果行数
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `mode` | string | `module`：按范围 M 执行与核对。`all`：传入 `--all`，按全部模块执行与核对。`fallback-full`：已启用模块范围，但本次无法可靠确定范围，按全部模块执行与核对。 |
| `modules` | string[] | 本次范围内的模块 id，按 `logos-project.yaml` 中的顺序。`all` / `fallback-full` 时为全部已登记模块。 |
| `reasons` | object[] | 仅 `mode=module` 时非空，每条为 `{ module, source, ref }`。`source` 取 `proposal`（提案归属模块，`ref` 为提案 slug）、`delta`（delta 目标文件前缀，`ref` 为 delta 相对提案目录的路径）、`spec`（`logos/resources/` 下带模块前缀的规格文件被改动，`ref` 为文件路径）或 `path`（改动文件命中 `modules[].paths`，`ref` 为文件路径）。同一模块可以有多条依据。 |
| `fallback_reason` | object \| null | 仅 `mode=fallback-full` 时为 `{ code, detail }`，否则为 `null`。`code` 取值见下表；`detail` 写明具体文件或原因。 |
| `out_of_scope_result_count` | integer | 结果文件中属于范围外模块用例的行数。这些行被忽略：不判未定义、不判 `outside_eligible`、不计入 `summary` 统计。`all` / `fallback-full` 时恒为 0。 |

`fallback_reason.code` 取值：

| code | 含义 |
|------|------|
| `no_active_change` | 没有活跃提案，无法确定提案归属与改动 |
| `base_ref_missing` | guard 没有 `baseRef`（引入前创建的提案） |
| `not_git_repository` | 项目不是 git 仓库 |
| `base_ref_unreachable` | `baseRef` 指向的提交在本地不存在（如历史被改写，或部分克隆中本地没有该提交对象——verify 不从远端取回），或检查该提交的调用超过时限；`detail` 写明具体情形 |
| `diff_failed` | 计算改动文件集合的 git 命令失败，包括本地读不到所需的文件内容（verify 不从远端取回）与调用超过时限；`detail` 写明具体情形 |
| `shared_config_changed` | `logos/logos.config.json` 或 `logos/logos-project.yaml` 按字段判断为相关变化：相关字段或清单未列出的字段有变化，或任一侧原文无法严格解析（功能规格 §2.96.3.1）。只有无关字段变化时不产生本原因。`detail` 逐个文件写明：`<路径>（<字段>、<字段>…）`（字段按字典序），或 `<路径>（提案起点中的内容<原因>）` / `<路径>（工作区中的内容<原因>）`，原因为 `不存在`、`读取失败`、`无法解析`、`顶层不是对象` 之一；两个文件都命中时用 `、` 连接，`logos/logos.config.json` 在前 |
| `unmapped_file` | 有改动文件一个模块也归不到；`detail` 为首个文件路径与总数 |
| `module_paths_invalid` | 某模块的 `paths` 不合法；`detail` 点名模块与非法项 |
