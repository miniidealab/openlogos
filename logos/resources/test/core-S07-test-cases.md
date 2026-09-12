# S07：代码生成与审查（code-implementor / code-reviewer）测试用例

> 本文件原有的全部用例（UT-S07-01～06、ST-S07-01～02）验证的是 code-reviewer 对 shadow authority 的扫描——旁路写入唯一写者、以 mtime 反向推导事实、投影被当作可写来源。change-lint L10 删除后 Authority Registry 不复存在，这些审查项失去判定依据，整体删除。
>
> S07 的通用代码生成与审查能力由 `logos/skills/code-implementor/SKILL.md` 与 `logos/skills/code-reviewer/SKILL.md` 约束，本轮不新增自动化用例。
