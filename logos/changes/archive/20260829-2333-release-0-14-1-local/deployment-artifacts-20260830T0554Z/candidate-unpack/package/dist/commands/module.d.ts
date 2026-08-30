import { type OutputFormat } from '../lib/json-output.js';
export declare function moduleList(format?: OutputFormat): void;
export declare function moduleAdd(name: string | undefined, productType?: string): void;
/**
 * proposal-ui-ux-first（切片1）：设置/更新模块的 product_type（overlay 注入与 ui_impact 派生的唯一数据源）。
 * 唯一数据源 = logos-project.yaml modules[].product_type。
 * 缺参/非法枚举/未知 module → 报错退出（exit 1），不写文件；合法幂等写入（相同值为 no-op）。
 */
export declare function moduleSetProductType(moduleId: string | undefined, productType: string | undefined, format?: OutputFormat): void;
export declare function moduleRename(oldName: string | undefined, newName: string | undefined): void;
export declare function moduleRemove(name: string | undefined): void;
//# sourceMappingURL=module.d.ts.map