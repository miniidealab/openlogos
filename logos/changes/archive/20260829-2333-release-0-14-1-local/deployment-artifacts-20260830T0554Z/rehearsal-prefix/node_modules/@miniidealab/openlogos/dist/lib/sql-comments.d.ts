export interface ColumnMeta {
    name: string;
    comment?: string;
}
export interface TableMeta {
    name: string;
    comment?: string;
    columns: ColumnMeta[];
}
export interface SchemaMetadata {
    tables: TableMeta[];
}
export declare function parseSqlComments(sql: string): SchemaMetadata;
//# sourceMappingURL=sql-comments.d.ts.map