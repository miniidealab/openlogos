# Delta: cli-json-output.md

> change: lite-cut2a-remove-authority-closure
> 目标：`spec/cli-json-output.md`

Authority Closure JSON 契约随 change-lint L10 废止。该节在主文档中存在两处字节相同的同名标题（第 2773、2776 行），章节锚不可唯一定位，故按其**子节**逐节删除；两个空标题壳留待后续清理。

## REMOVED — evaluation schema

本子节定义 change-lint / status / next / flow 共用的 `authority_closure` evaluation 对象结构。L10 删除后该对象不再产出。

## REMOVED — change-lint violations

本子节定义 `authority_closure_incomplete` 等 issue 码族与其映射规则。该码族从码表整体移除（提案决策 C02）后失去定义对象。

## REMOVED — 同源与挂载

本子节要求 change-lint 在 `data.authority_closure` 输出 summary 并与其余消费方同源挂载。该字段不再产出。

## REMOVED — Authority Closure JSON 契约 > 兼容

本子节定义旧 CLI 无 authority 合同时的宿主降级读法。合同废止后不再需要兼容分级。
