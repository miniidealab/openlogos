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

const CREATE_TABLE_RE = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?/i;
const COMMENT_PREFIX = '-- @comment ';
const TABLE_COMMENT_PREFIX = '-- @table-comment ';
const CONSTRAINT_KEYWORDS = /^\s*(FOREIGN\s+KEY|CHECK|UNIQUE|PRIMARY\s+KEY|CONSTRAINT)\b/i;
const COLUMN_NAME_RE = /^\s*["']?(\w+)["']?\s/;

export function parseSqlComments(sql: string): SchemaMetadata {
  const lines = sql.split('\n');
  const tables: TableMeta[] = [];
  const tableMap = new Map<string, TableMeta>();

  let currentTable: TableMeta | null = null;
  let pendingComment: string[] = [];
  let insideCreateTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith(TABLE_COMMENT_PREFIX)) {
      const rest = trimmed.slice(TABLE_COMMENT_PREFIX.length);
      const spaceIdx = rest.indexOf(' ');
      if (spaceIdx > 0) {
        const tableName = rest.slice(0, spaceIdx);
        const description = rest.slice(spaceIdx + 1).trim();
        const table = tableMap.get(tableName);
        if (table) {
          table.comment = description;
        }
      }
      pendingComment = [];
      continue;
    }

    if (trimmed.startsWith(COMMENT_PREFIX)) {
      pendingComment.push(trimmed.slice(COMMENT_PREFIX.length));
      continue;
    }

    if (trimmed === '' || (trimmed.startsWith('--') && !trimmed.startsWith('-- @'))) {
      pendingComment = [];
      continue;
    }

    const createMatch = trimmed.match(CREATE_TABLE_RE);
    if (createMatch) {
      currentTable = { name: createMatch[1], columns: [] };
      tables.push(currentTable);
      tableMap.set(currentTable.name, currentTable);
      insideCreateTable = true;
      pendingComment = [];
      continue;
    }

    if (insideCreateTable && trimmed.startsWith(')')) {
      insideCreateTable = false;
      currentTable = null;
      pendingComment = [];
      continue;
    }

    if (insideCreateTable && currentTable) {
      if (CONSTRAINT_KEYWORDS.test(trimmed)) {
        continue;
      }

      const colMatch = trimmed.match(COLUMN_NAME_RE);
      if (colMatch) {
        const col: ColumnMeta = { name: colMatch[1] };
        if (pendingComment.length > 0) {
          col.comment = pendingComment.join(' ');
        }
        currentTable.columns.push(col);
        pendingComment = [];
      }
    }
  }

  return { tables };
}
