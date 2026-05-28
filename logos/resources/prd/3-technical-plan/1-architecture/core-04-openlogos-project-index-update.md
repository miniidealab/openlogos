# core-04-openlogos-project-index-update

## 一、目标字段
`logos-project.yaml` 最终应至少包含：
- `project`
- `tech_stack`
- `modules`
- `scenario_counter`
- `scenarios`
- `resource_index`
- `deployment_gates`

为了支持 verify / smoke 沙箱标准化，`logos-project.yaml` 的索引说明还应覆盖：
- `verify` 预跑配置说明
- `smoke` 配置说明
- 沙箱模式与工作区写入保护的配置说明

## 二、资源索引策略
- 架构、场景、测试、部署和 Skills 规范都应能被索引到。
- 新增文档后必须重新同步索引。
- `logos/logos.config.json` 的 verify / smoke 沙箱配置字段说明也应被 resource_index / spec 文档索引到，供 `init`、`sync`、`adopt` 和 RunLogos 读取。

## 三、落盘策略
由于该文件本身不是现有 merge 机制的主文档目标，本次仅在受控规格中定义目标状态，落盘由后续同步流程完成。
