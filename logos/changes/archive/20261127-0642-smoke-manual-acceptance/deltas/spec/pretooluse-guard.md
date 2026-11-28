## MODIFIED — 保护范围变更的宿主原生审批（C14）

- **受限命令**：`openlogos exempt add|remove`、`openlogos ignore add|remove`（`list` 不受限）；部署审批类命令（来源变更 environment-promotion-approval，决策 C05）：`openlogos approve …`（任何参数形态，含 `--help`）与带 `--force-promote` 的 `openlogos deploy …`（不带 `--force-promote` 的 `openlogos deploy` 不受限）；人工验收记录命令（来源变更 smoke-manual-acceptance，功能规格 §2.107.10）：`openlogos accept …`（任何参数形态，含 `--help`），类别名 `accept`，识别方式与 `approve` 相同（`bash -c` / `eval` 字符串实参中的 `openlogos accept` 按复合形态处理）。在任何 lifecycle、任何提案状态下都受限（有活跃提案时也需确认），且在两种模式下都先于安全白名单与独立调用豁免识别。受限命令只接受独立调用形态（允许 `cd` 前缀段）；复合形态一律 exit 2。
- **确认来源**：确认必须来自宿主对**这一次实际工具调用**的原生审批。guard 不采信 AI 在对话中转述的「用户已同意」，也不使用任何可被普通工具调用伪造的本地凭据文件。
- **Claude Code**：PreToolUse 按 hook 输入的 `permission_mode` 处理：
  - `default` 或 `acceptEdits` → stdout 输出 `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"该命令会改变 guard 的保护范围（<命令原文>），需要您确认后执行"}}`，exit 0。部署审批类命令的 reason 按类别改写：`approve` 为「该命令会写入部署审批（<命令原文>），需要您确认后执行」，`--force-promote` 为「该命令会越过晋级检查（<命令原文>），需要您确认后执行」，`accept` 为「该命令会记录人工验收结果（<命令原文>），人工验收结果只能由人记录，需要您确认后执行」。由宿主对这一次调用弹出审批：用户批准则执行（之后按独立 openlogos 调用更新基线），拒绝则不执行。
  - 其他值（`bypassPermissions`、`dontAsk`、`auto`、`plan`）、字段缺失或未知值、非交互运行 → exit 2 阻断，reason：「当前权限模式（<mode>）下宿主不会弹出确认，无法证明由用户批准。请让用户在终端用 `! <命令原文>` 自行执行，或切换到默认权限模式后重试；不要用对话中的口头同意替代。」（双通道输出）。
  - **依据**：Claude Code 官方 hooks 文档说明，`permissionDecision: "ask"` 在 `bypassPermissions` / `dontAsk` 模式下静默放行，在非交互模式下按 `defer` 处理，因此只有 `default` / `acceptEdits` 能保证弹出审批。实施时以真实宿主再次核实；若核实结果与此不同，以「不能证明会弹出审批即阻断」为不变量收紧。
- **Cursor**：`beforeShellExecution` 对受限命令返回 `{"permission": "ask", ...}`；宿主在自动运行等模式下是否仍弹出审批，以真实宿主实测为准；实测不能保证弹出时改为 deny，并在 `spec/cursor-plugin.md` 写明。
- **其他宿主**：不能保证人机审批 → 阻断受限命令（本案不改其适配层的，见「已知覆盖限制」）。
- **`--auto` / 无人值守**：`openlogos next --auto` 的 standing 授权不覆盖保护范围变更。无人值守运行通常处于 `bypassPermissions` / `auto` / 非交互模式，受限命令因此被阻断，不另设机制。**对宿主的合同要求**：任何驱动 AI 会话的宿主 driver（如 RunLogos 全自动模式）不得代替用户批准此类宿主审批，必须把审批交给真实用户，或让该调用保持阻断。
- **保护范围来源受保护**：各级 `.gitignore`、`info/exclude`、项目内 `core.excludesFile` 文件与 `logos/logos.config.json`（`guard.exempt` / `guard.unversioned` 所在的配置文件）属不可豁免项，纳入受保护判定与每次事后检查快照，即使被 git 忽略、位于白名单或 exempt 目录之下也受保护，Edit / Write / Bash 直接修改须立案；`logos.config.json` 中的保护范围只由经审批的受限子命令写入（之后按独立 openlogos 调用更新基线），`openlogos sync` 只按配置当前内容渲染托管区块、不改配置；`.gitignore` 托管区块只由经审批的 `openlogos ignore` 与 `openlogos sync`（按配置重渲染，适用独立 openlogos 调用豁免）写入。
- **已配置门禁的环境登记表**（来源变更 environment-promotion-approval，决策 C11，D14）：
  - **识别**：guard 读取 `logos/environments.yaml` 当前内容，出现 `promote_from`、`require_approval` 或 `manual_acceptance`（来源变更 smoke-manual-acceptance，人工验收开关，`spec/environments.md` §15.2）字段名，或出现反斜杠字符（YAML 双引号键可用 `\u`、`\x` 转义或续行写出字段名，guard 不解析 YAML、无法可靠证明无门禁），即视为已配置门禁；误判只会多拦。与之配套，登记表加载器要求门禁字段以普通键名书写，原文不含字段名字面量而解析出门禁字段时按 `ENV_FIELD_INVALID` 拒绝（`spec/environments.md` §12.1），因此 CLI 认定的门禁必然被本条识别（review delta-r1 F2）。文件不存在，或三个字段名都不出现、也无反斜杠字符时不适用本条。本条的识别字段同样适用于「guard.exempt 与内置默认」中环境登记表一项的例外（该处列举的两个字段名按本条扩展为三个）。
  - **保护**：已配置门禁时，该文件是部署门禁策略来源，与「保护范围来源受保护」同属不可豁免项——不适用内置默认豁免或 `guard.exempt`，不以活跃提案作为放行理由，有无活跃提案、任何 lifecycle 下结论相同。
  - **Edit / Write / MultiEdit / NotebookEdit**：Claude Code 在 `permission_mode` 为 `default` / `acceptEdits` 时返回 `permissionDecision: ask`，reason「该修改会改变部署门禁配置（logos/environments.yaml），需要您确认后执行」，由宿主对这一次修改弹出审批；其他模式、字段缺失、未知值、非交互运行 → exit 2，reason 提示由用户自行编辑该文件，或切换到默认权限模式后重试。不区分修改是否削弱门禁。
  - **Bash / PowerShell**：可确定写入目标为该文件的形态（重定向、`tee`、`sed -i`、`rm` / `mv` / `cp` 目标等）一律 exit 2（不返回 `ask`），提示同上；无法事前确定目标的写法属「已知覆盖限制」第 4、7 条。
  - **Cursor 与其他宿主**：不能保证弹出审批的入口一律阻断；Cursor `beforeShellExecution` 对可确定写入或删除该文件的命令返回 deny，文件编辑为事后报告（同 Cursor 既有限制）。
  - **未识别为已配置门禁**（三个字段名都不出现、也无反斜杠字符）：按 `guard.exempt`（含内置默认）判定，行为与引入前一致；从无门到加门的那一次修改按此放行。
- **非 Claude / Cursor 宿主**（来源变更 smoke-manual-acceptance，评审 delta-r1 F3）：qoder / workbuddy / zcode 适配层对 `openlogos accept` 一律拒绝，判定先于生命周期与安全命令的提前放行，见「已知覆盖限制」第 5 条例外；其他不能保证人机审批的宿主同样阻断。
- **人工验收结果的提示**（来源变更 smoke-manual-acceptance）：`accept` 被阻断时的提示与部署审批类命令一致，并补充「请在终端以 `! <命令原文>` 记录，或在 RunLogos 界面逐条记录；不要由 AI 代记」。宿主 driver 不得代替用户批准。

## MODIFIED — 已知覆盖限制

1. 宿主始终不报告结束的后台任务（脱离会话的守护进程、缺少调用标识的调用），其记录若不属于当前会话，在建立超过 7 天后的下一个检查点关闭（「执行记录生命周期」关闭条件 5），期间的受保护变化以「需向用户确认」形式各报告一次，不会静默放过。超期关闭后，该进程之后的写入不再归到任何记录，只会在下一次调用建立快照时被当作执行前已有内容。属于当前会话、又拿不到可信结束证据的记录（Stop 输入没有有效的后台任务现状，或记录未回填后台任务标识）不保证在 7 天内关闭：只要该会话仍在使用或被恢复，它就一直保留，换到另一个会话后才适用超期关闭；不为这类记录另设关闭依据。
2. 事后检查发生在写入之后：受保护内容已被改动，依赖反馈与恢复合同回滚；超过 5 MiB 或无法读取的条目不可自动恢复；恢复命令在 git 对象回收前有效。
3. 独立 git / openlogos 调用的残余风险见「独立 git / openlogos 调用豁免」。
4. Bash 经无法事前确定目标的写法（如 `node -e`）写入 `logos/.openlogos-runtime/` 时，该目录被忽略且不在快照范围内，事后检查无法发现；运行时目录的保护以 Edit / Write 事前阻断与可确定目标的 Bash 事前阻断为限。
5. qoder / workbuddy / zcode 的现有 shell 判定若把 `openlogos *` 视为安全命令，会放行保护范围变更受限命令（含部署审批类命令 `openlogos approve` 与带 `--force-promote` 的 `openlogos deploy`）而不经宿主审批；这三个适配层也不实施「已配置门禁的环境登记表」保护；本案与 environment-promotion-approval 均不改这三个适配层，该差异如实保留。
   例外（来源变更 smoke-manual-acceptance，评审 delta-r1 F3）：人工验收记录命令 `openlogos accept` **不**属于本条限制。这三个适配层不能保证弹出可靠的原生审批，因此在 `decideGuard` 的任何提前放行（含「initial 生命周期不启用变更硬门禁」与安全命令判定）之前，凡 Bash / `execute_command` 命令文本中出现 `openlogos accept`（独立、复合、`bash -c` / `eval` 内嵌，任何参数形态含 `--help`），一律返回拒绝，提示用户在终端执行或经 RunLogos 界面记录；有无活跃提案、任何生命周期下结论相同。
7. **威胁模型**：guard 防的是 AI 无意或惯性越界，不防有意对抗的 agent（例如它可以修改白名单内 `.claude/` 下的 hook 注册，或以无法事前确定目标的写法篡改运行时目录）。C14 的保证范围是：在宿主会弹出审批的模式下，保护范围变更必须经用户在宿主界面批准。
6. 被 git 忽略、不在 `logos/resources/` 下、未被跟踪且不属不可豁免项的内容按设计不受保护，事后检查不覆盖。
