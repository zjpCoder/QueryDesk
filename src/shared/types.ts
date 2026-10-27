export type Dialect = 'mysql' | 'oracle';
export interface ConnectionProfile {
  id: string; name: string; group: string; dialect: Dialect; host: string; port: number;
  user: string; password?: string; hasPassword?: boolean; database: string;
  oracleMode: 'service' | 'sid'; clientPath: string;
  tls: boolean; caPath: string;
}
export interface AISettings { baseUrl: string; model: string; apiKey?: string; hasKey?: boolean; }
export interface Settings { connections: ConnectionProfile[]; ai: AISettings; theme: 'dark' | 'light'; history: HistoryEntry[]; }
export interface HistoryEntry { connectionId: string; sql: string; time: string; ok: boolean; }
export interface SqlFile { id:string; name:string; path:string; savedSql:string; }
export interface DraftTab { id:string; connectionId:string; schema:string; title:string; sql:string; fileId?:string; edited?:boolean; autoCommit:boolean; readOnly?:boolean; }
export interface WorkspaceDraft { tabs:DraftTab[]; activeId:string; }
export interface WorkspaceSnapshot extends WorkspaceDraft { files:SqlFile[]; }
export interface ExportEvent { id:string; rows?:number; done?:boolean; error?:string; file?:AIFile; }
export interface DBObject { name: string; kind: 'table' | 'view' | 'procedure' | 'function' | 'package' | 'trigger' | 'sequence'; schema: string; comment?: string; }
export interface Column { name: string; type: string; nullable: boolean; defaultValue: string; comment: string; primary: boolean; generated?: boolean; }
export interface DBIndex { name: string; columns: string[]; unique: boolean; constraintName?: string; }
export interface ForeignKey { name: string; columns: string[]; refSchema: string; refTable: string; refColumns: string[]; onDelete: 'NO ACTION' | 'CASCADE' | 'SET NULL'; }
export interface TableDef { schema: string; name: string; comment: string; columns: Column[]; indexes: DBIndex[]; foreignKeys: ForeignKey[]; engine?: string; }
export type Cell = string | number | boolean | null;
export interface QueryResult { id: string; sql: string; schema?: string; columns: string[]; rows: Record<string, Cell>[]; affected: number; elapsed: number; hasMore: boolean; truncated: boolean; }
export interface SessionInfo { version: string; schema: string; autoCommit: boolean; dirty: boolean; needsRollback: boolean; connected: boolean; readOnly?: boolean; }
export interface RowChange { kind: 'insert' | 'update' | 'delete'; original?: Record<string, Cell>; values: Record<string, Cell>; }
export interface Filter { column: string; op: '=' | '<>' | '>' | '<' | '>=' | '<=' | 'contains' | 'is null' | 'is not null'; value: string; }
export interface AIRequest { id: string; action: 'operate' | 'generate' | 'explain' | 'fix' | 'optimize'; question: string; connectionId: string; dialect: Dialect; version: string; schema: string; sql: string; error: string; tables: TableDef[]; rows: Record<string, Cell>[]; sessionId?: string; activeTable?: string; }
export interface AIOpened { sessionId:string; connectionId:string; title:string; sql:string; info:SessionInfo; results:QueryResult[]; }
export interface AIFile { id:string; name:string; path:string; rows:number; warnings:string[]; }
export interface AIEvent { id:string; text?:string; done?:boolean; error?:string; progress?:string; opened?:AIOpened; file?:AIFile; }
export interface DDLPlan { statements: string[]; warnings: string[]; }
export interface DDLResult { sql: string; ok: boolean; error?: string; }
export type Method = 'settings.get' | 'settings.theme' | 'connection.save' | 'connection.delete' | 'connection.test' | 'client.inspect' | 'dialog.directory' | 'dialog.file' | 'session.open' | 'session.close' | 'session.state' | 'session.transaction' | 'schema.list' | 'object.list' | 'object.source' | 'table.describe' | 'query.run' | 'query.fetch' | 'query.cancel' | 'table.browse' | 'table.apply' | 'ddl.preview' | 'ddl.execute' | 'ai.save' | 'ai.test' | 'ai.start' | 'ai.cancel' | 'file.export' | 'history.add';
export type ExtendedMethod = Method | 'session.schema' | 'file.reveal' | 'workspace.get' | 'workspace.save' | 'sql.open' | 'sql.save' | 'session.reconnect' | 'export.start' | 'export.cancel' | 'export.query' | 'ai.clear';
export interface QueryDeskAPI {
  call<T = unknown>(method: ExtendedMethod, payload?: unknown): Promise<T>;
  onAI(listener: (event: AIEvent) => void): () => void;
  onClose(listener: () => void): () => void;
  onExport(listener: (event:ExportEvent) => void): () => void;
  confirmClose(): void;
}
declare global { interface Window { querydesk: QueryDeskAPI; } }

export interface QueryFailure { statementIndex:number; offset:number; precision:'column'|'line'|'statement'; }
export interface ExportTarget { connectionId:string; schema:string; table?:string; filters?:Filter[]; filterMode?:'and'|'or'; sort?:{column:string;direction:'asc'|'desc'}; query?:{sql:string;params:Record<string,Cell>}; }
export interface AISqlTarget { tabId:string; sql:string; fullSql:string; start:number; end:number; version:number; scope:string; }
