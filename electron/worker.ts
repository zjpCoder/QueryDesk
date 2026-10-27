import { tableSelect, valuePlaceholder } from '../src/shared/filters';
import { queryFailure } from '../src/shared/queryError';
import type { QueryFailure } from '../src/shared/types';
import fs from 'node:fs';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import type { Cell, Column, ConnectionProfile, DBObject, DDLResult, Filter, QueryResult, RowChange, SessionInfo, TableDef } from '../src/shared/types';
import { bindSql, maskSql, qualified, quoteId, splitSql, sqlKind } from '../src/shared/sql';
import { buildDDL, tableFingerprint } from '../src/shared/ddl';
import { openJdbc, inspectJdbc } from './jdbc';
import { readOnlySql } from '../src/shared/agent';
import { csv } from '../src/shared/sql';
const BATCH = 200, LIMIT = 10000, BYTE_LIMIT = 32 * 1024 * 1024;
interface ResultCursor { result: QueryResult; cached?: Record<string, Cell>[]; offset: number; rs?: any; rawNames?: string[]; }
interface Session { profile: ConnectionProfile; connection: any; info: SessionInfo; cursors: Map<string, ResultCursor>; busy: boolean; cancelled: boolean; cachedBytes: number; }
const sessions = new Map<string, Session>();
const queues = new Map<string, Promise<unknown>>();
async function connect(profile: ConnectionProfile): Promise<Session> {
  let c: any;
  if (profile.dialect === 'mysql') {
    c = await mysql.createConnection({ host: profile.host, port: profile.port, user: profile.user, password: profile.password ?? '', database: profile.database || undefined, connectTimeout: 12000, supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, dateStrings: true, multipleStatements: false, charset: 'utf8mb4', ...(profile.tls ? { ssl: { rejectUnauthorized: true, ...(profile.caPath ? { ca: fs.readFileSync(profile.caPath, 'utf8') } : {}) } } : {}) });
    c.connection.on('error', () => {});
  } else {
    if (!profile.database || /[()=\s]/.test(profile.database)) throw new Error('请输入有效的 Oracle Service Name 或 SID');
    const connectString = `(DESCRIPTION=(CONNECT_TIMEOUT=12)(TRANSPORT_CONNECT_TIMEOUT=8)(ADDRESS=(PROTOCOL=TCP)(HOST=${profile.host})(PORT=${profile.port}))(CONNECT_DATA=(${profile.oracleMode === 'sid' ? 'SID' : 'SERVICE_NAME'}=${profile.database})))`;
    c = await openJdbc({ user: profile.user, password: profile.password ?? '', connectString });
    try {
      await c.execute(`ALTER SESSION SET NLS_DATE_FORMAT='YYYY-MM-DD HH24:MI:SS' NLS_TIMESTAMP_FORMAT='YYYY-MM-DD HH24:MI:SS.FF' NLS_TIMESTAMP_TZ_FORMAT='YYYY-MM-DD HH24:MI:SS.FF TZH:TZM' NLS_NUMERIC_CHARACTERS='.,'`);
    } catch (e) { await c.close(); throw e; }
  }
  const s: Session = { profile, connection: c, info: { version: '', schema: profile.database, autoCommit: true, dirty: false, needsRollback: false, connected: true }, cursors: new Map(), busy: false, cancelled: false, cachedBytes: 0 };
  if (profile.dialect === 'mysql') c.connection.on('error', () => { s.info.connected = false; s.info.needsRollback = !s.info.autoCommit; });
  try {
    if (profile.dialect === 'mysql') { const rows = await raw(s, 'SELECT VERSION() AS version, DATABASE() AS db'); s.info.version = rows[0].version; s.info.schema = rows[0].db ?? ''; }
    else { s.info.version = c.oracleServerVersionString; const rows = await raw(s, "SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AS SCHEMA_NAME FROM DUAL"); s.info.schema = rows[0].SCHEMA_NAME; }
    return s;
  } catch (e) { await close(s); throw e; }
}
async function raw(s: Session, sql: string, binds: any = {}): Promise<any[]> {
  const b = bindSql(sql, binds, s.profile.dialect);
  if (s.profile.dialect === 'mysql') { const [rows] = (b.binds as unknown[]).length ? await s.connection.execute(b.sql, b.binds) : await s.connection.query(b.sql); return rows; }
  const r = await s.connection.execute(b.sql, b.binds, {});
  return r.rows ?? [];
}
async function command(s: Session, sql: string, binds: any = {}, autoCommit = false): Promise<number> {
  const b = bindSql(sql, binds, s.profile.dialect);
  if (s.profile.dialect === 'mysql') { const [r] = await s.connection.execute(b.sql, b.binds); return r.affectedRows ?? 0; }
  const r = await s.connection.execute(b.sql, b.binds, { autoCommit }); return r.rowsAffected ?? 0;
}
function cell(value: any): Cell {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return `[二进制 ${value.length} 字节]`;
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && typeof value.getData === 'function') { void value.close?.().catch(() => {}); return '[LOB：请使用 SQL 截取查看]'; }
  if (typeof value === 'string' && value.length > 65536) return value.slice(0, 65536) + '[内容已截断]';
  if (typeof value === 'object') return cell(JSON.stringify(value));
  return typeof value === 'bigint' ? value.toString() : value;
}
function uniqueNames(names: string[]) {
  const used = new Set<string>(); return names.map(name => { let n = name, i = 2; while (used.has(n)) n = `${name}_${i++}`; used.add(n); return n; });
}
function toRows(names: string[], rows: any[][]): Record<string, Cell>[] { return rows.map(row => Object.fromEntries(names.map((n, i) => [n, cell(row[i])]))); }
function retain(s: Session, row: Record<string, Cell>): boolean { const bytes = Buffer.byteLength(JSON.stringify(row)); if (s.cachedBytes + bytes > BYTE_LIMIT) return false; s.cachedBytes += bytes; return true; }
async function closeCursors(s: Session) { for (const c of s.cursors.values()) if (c.rs) await c.rs.close().catch(() => {}); s.cursors.clear(); s.cachedBytes = 0; }
async function close(s: Session) { await closeCursors(s); if (!s.info.autoCommit || s.info.dirty) await s.connection.rollback().catch(() => {}); if (s.profile.dialect === 'mysql') await s.connection.end().catch(() => {}); else await s.connection.close().catch(() => {}); }

async function describe(s: Session, schema: string, table: string): Promise<TableDef> {
  if (s.profile.dialect === 'mysql') {
    const base = await raw(s, "SELECT TABLE_COMMENT, TABLE_TYPE, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=:schema AND TABLE_NAME=:table", { schema, table });
    if (!base.length) throw new Error('表不存在或没有访问权限');
    const cols = await raw(s, 'SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,COLUMN_COMMENT,COLUMN_KEY,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=:schema AND TABLE_NAME=:table ORDER BY ORDINAL_POSITION', { schema, table });
    const indexes = await raw(s, "SELECT INDEX_NAME,COLUMN_NAME,NON_UNIQUE,SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=:schema AND TABLE_NAME=:table AND INDEX_NAME <> 'PRIMARY' ORDER BY INDEX_NAME,SEQ_IN_INDEX", { schema, table });
    const foreign = await raw(s, `SELECT k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_SCHEMA,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=:schema AND k.TABLE_NAME=:table AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME,k.ORDINAL_POSITION`, { schema, table });
    const idx = new Map<string, any>(), fks = new Map<string, any>();
    for (const i of indexes) { if (!i.COLUMN_NAME) continue; if (!idx.has(i.INDEX_NAME)) idx.set(i.INDEX_NAME, { name: i.INDEX_NAME, columns: [], unique: !Number(i.NON_UNIQUE) }); idx.get(i.INDEX_NAME).columns.push(i.COLUMN_NAME); }
    for (const f of foreign) { if (!fks.has(f.CONSTRAINT_NAME)) fks.set(f.CONSTRAINT_NAME, { name: f.CONSTRAINT_NAME, columns: [], refSchema: f.REFERENCED_TABLE_SCHEMA, refTable: f.REFERENCED_TABLE_NAME, refColumns: [], onDelete: ['CASCADE','SET NULL'].includes(f.DELETE_RULE) ? f.DELETE_RULE : 'NO ACTION' }); const entry = fks.get(f.CONSTRAINT_NAME); entry.columns.push(f.COLUMN_NAME); entry.refColumns.push(f.REFERENCED_COLUMN_NAME); }
    return { schema, name: table, comment: base[0].TABLE_COMMENT || '', engine: base[0].ENGINE || '', columns: cols.map((c: any) => ({ name: c.COLUMN_NAME, type: c.COLUMN_TYPE, nullable: c.IS_NULLABLE === 'YES', defaultValue: mysqlDefault(c.COLUMN_DEFAULT, c.COLUMN_TYPE, c.EXTRA), comment: c.COLUMN_COMMENT || '', primary: c.COLUMN_KEY === 'PRI', generated: /auto_increment|VIRTUAL GENERATED|STORED GENERATED|on update/i.test(c.EXTRA) })), indexes: [...idx.values()], foreignKeys: [...fks.values()] };
  }
  const base = await raw(s, 'SELECT COMMENTS FROM ALL_TAB_COMMENTS WHERE OWNER=:schema AND TABLE_NAME=:table', { schema, table });
  if (!base.length) throw new Error('表不存在或没有访问权限');
  const cols = await raw(s, `SELECT c.COLUMN_NAME,c.DATA_TYPE,c.DATA_LENGTH,c.CHAR_LENGTH,c.CHAR_USED,c.DATA_PRECISION,c.DATA_SCALE,c.NULLABLE,c.DATA_DEFAULT,m.COMMENTS FROM ALL_TAB_COLUMNS c LEFT JOIN ALL_COL_COMMENTS m ON m.OWNER=c.OWNER AND m.TABLE_NAME=c.TABLE_NAME AND m.COLUMN_NAME=c.COLUMN_NAME WHERE c.OWNER=:schema AND c.TABLE_NAME=:table ORDER BY c.COLUMN_ID`, { schema, table });
  const constraints = await raw(s, `SELECT c.CONSTRAINT_NAME,c.CONSTRAINT_TYPE,k.COLUMN_NAME,k.POSITION,c.R_OWNER,c.R_CONSTRAINT_NAME,c.DELETE_RULE FROM ALL_CONSTRAINTS c JOIN ALL_CONS_COLUMNS k ON k.OWNER=c.OWNER AND k.CONSTRAINT_NAME=c.CONSTRAINT_NAME WHERE c.OWNER=:schema AND c.TABLE_NAME=:table AND c.CONSTRAINT_TYPE IN ('P','R') ORDER BY c.CONSTRAINT_NAME,k.POSITION`, { schema, table });
  const indexes = await raw(s, `SELECT i.INDEX_NAME,i.UNIQUENESS,k.COLUMN_NAME,k.COLUMN_POSITION,(SELECT MAX(u.CONSTRAINT_NAME) FROM ALL_CONSTRAINTS u WHERE u.OWNER=i.OWNER AND u.INDEX_NAME=i.INDEX_NAME AND u.CONSTRAINT_TYPE='U') AS CONSTRAINT_NAME FROM ALL_INDEXES i JOIN ALL_IND_COLUMNS k ON k.INDEX_OWNER=i.OWNER AND k.INDEX_NAME=i.INDEX_NAME WHERE i.TABLE_OWNER=:schema AND i.TABLE_NAME=:table AND i.INDEX_TYPE='NORMAL' AND NOT EXISTS (SELECT 1 FROM ALL_CONSTRAINTS c WHERE c.OWNER=i.OWNER AND c.INDEX_NAME=i.INDEX_NAME AND c.CONSTRAINT_TYPE='P') ORDER BY i.INDEX_NAME,k.COLUMN_POSITION`, { schema, table });
  const primary = new Set(constraints.filter((c:any) => c.CONSTRAINT_TYPE === 'P').map((c:any) => c.COLUMN_NAME));
  const idx = new Map<string, any>(), fks = new Map<string, any>();
  for (const i of indexes) { if (!idx.has(i.INDEX_NAME)) idx.set(i.INDEX_NAME, { name: i.INDEX_NAME, columns: [], unique: i.UNIQUENESS === 'UNIQUE', ...(i.CONSTRAINT_NAME ? { constraintName: i.CONSTRAINT_NAME } : {}) }); idx.get(i.INDEX_NAME).columns.push(i.COLUMN_NAME); }
  for (const f of constraints.filter((c:any) => c.CONSTRAINT_TYPE === 'R')) {
    if (!fks.has(f.CONSTRAINT_NAME)) {
      const referenced = await raw(s, 'SELECT TABLE_NAME,COLUMN_NAME FROM ALL_CONS_COLUMNS WHERE OWNER=:owner AND CONSTRAINT_NAME=:name ORDER BY POSITION', { owner: f.R_OWNER, name: f.R_CONSTRAINT_NAME });
      fks.set(f.CONSTRAINT_NAME, { name: f.CONSTRAINT_NAME, columns: [], refSchema: f.R_OWNER, refTable: referenced[0]?.TABLE_NAME ?? '', refColumns: referenced.map((r:any) => r.COLUMN_NAME), onDelete: f.DELETE_RULE });
    }
    fks.get(f.CONSTRAINT_NAME).columns.push(f.COLUMN_NAME);
  }
  return { schema, name: table, comment: base[0].COMMENTS || '', columns: cols.map((c:any) => ({ name: c.COLUMN_NAME, type: oracleType(c), nullable: c.NULLABLE === 'Y', defaultValue: (c.DATA_DEFAULT || '').trim(), comment: c.COMMENTS || '', primary: primary.has(c.COLUMN_NAME) })), indexes: [...idx.values()], foreignKeys: [...fks.values()] };
}
function mysqlDefault(value: any, type: string, extra: string) {
  if (value == null) return '';
  if (/^CURRENT_TIMESTAMP(?:\(\d*\))?$/i.test(value) || /DEFAULT_GENERATED/i.test(extra) || /^(tinyint|smallint|mediumint|int|bigint|decimal|float|double|bit)/i.test(type)) return String(value);
  return "'" + String(value).replaceAll("'", "''") + "'";
}
function oracleType(c: any) {
  if (['VARCHAR2','NVARCHAR2','CHAR','NCHAR'].includes(c.DATA_TYPE)) return `${c.DATA_TYPE}(${c.CHAR_USED === 'C' ? c.CHAR_LENGTH : c.DATA_LENGTH}${['NVARCHAR2','NCHAR'].includes(c.DATA_TYPE) ? '' : c.CHAR_USED === 'C' ? ' CHAR' : ' BYTE'})`;
  if (c.DATA_TYPE === 'NUMBER' && c.DATA_PRECISION) return `NUMBER(${c.DATA_PRECISION}${c.DATA_SCALE == null ? '' : ',' + c.DATA_SCALE})`;
  if (c.DATA_TYPE === 'RAW') return `RAW(${c.DATA_LENGTH})`;
  return c.DATA_TYPE;
}
async function schemas(s: Session) {
  if (s.profile.dialect === 'mysql') return (await raw(s, 'SHOW DATABASES')).map((r:any) => r.Database);
  return (await raw(s, 'SELECT USERNAME FROM ALL_USERS ORDER BY USERNAME')).map((r:any) => r.USERNAME);
}
async function objects(s: Session, schema: string): Promise<DBObject[]> {
  if (s.profile.dialect === 'mysql') {
    const tables = await raw(s, 'SELECT TABLE_NAME,TABLE_TYPE,TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA=:schema ORDER BY TABLE_NAME', { schema });
    const routines = await raw(s, 'SELECT ROUTINE_NAME,ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=:schema ORDER BY ROUTINE_NAME', { schema });
    const triggers = await raw(s, 'SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=:schema ORDER BY TRIGGER_NAME', { schema });
    return [...tables.map((r:any) => ({ name: r.TABLE_NAME, schema, comment: r.TABLE_COMMENT ?? '', kind: r.TABLE_TYPE === 'VIEW' ? 'view' : 'table' })), ...routines.map((r:any) => ({ name: r.ROUTINE_NAME, schema, kind: r.ROUTINE_TYPE.toLowerCase() })), ...triggers.map((r:any) => ({ name: r.TRIGGER_NAME, schema, kind: 'trigger' }))];
  }
  const rows = await raw(s, "SELECT o.OBJECT_NAME,o.OBJECT_TYPE,c.COMMENTS FROM ALL_OBJECTS o LEFT JOIN ALL_TAB_COMMENTS c ON c.OWNER=o.OWNER AND c.TABLE_NAME=o.OBJECT_NAME AND c.TABLE_TYPE=o.OBJECT_TYPE WHERE o.OWNER=:schema AND o.OBJECT_TYPE IN ('TABLE','VIEW','PROCEDURE','FUNCTION','PACKAGE','TRIGGER','SEQUENCE') ORDER BY o.OBJECT_TYPE,o.OBJECT_NAME", { schema });
  return rows.map((r:any) => ({ name: r.OBJECT_NAME, schema, comment: r.COMMENTS ?? '', kind: r.OBJECT_TYPE.toLowerCase() }));
}
async function source(s: Session, schema: string, table: string, kind: string) {
  if (s.profile.dialect === 'mysql') {
    const rows = await raw(s, `SHOW CREATE ${kind.toUpperCase()} ${qualified(schema, table, 'mysql')}`);
    return Object.entries(rows[0] ?? {}).filter(([k]) => /create|statement/i.test(k)).map(([,v]) => v).join('\n');
  }
  if (kind === 'view') return (await raw(s, 'SELECT TEXT FROM ALL_VIEWS WHERE OWNER=:schema AND VIEW_NAME=:table', { schema, table }))[0]?.TEXT ?? '';
  if (kind === 'sequence') return JSON.stringify(await raw(s, 'SELECT * FROM ALL_SEQUENCES WHERE SEQUENCE_OWNER=:schema AND SEQUENCE_NAME=:table', { schema, table }), null, 2);
  return (await raw(s, 'SELECT TEXT FROM ALL_SOURCE WHERE OWNER=:schema AND NAME=:table ORDER BY TYPE,LINE', { schema, table })).map((r:any) => r.TEXT).join('');
}

async function mysqlQuery(s: Session, sql: string, binds: unknown[], sourceSql=sql): Promise<QueryResult[]> {
  const started = Date.now(); const groups = new Map<number, { names: string[]; rows: Record<string, Cell>[]; affected: number; truncated: boolean }>();
  await new Promise<void>((resolve, reject) => {
    const query = binds.length ? s.connection.connection.execute({ sql, values: binds, rowsAsArray: true }) : s.connection.connection.query({ sql, rowsAsArray: true });
    query.on('fields', (fields: any[] | undefined, index = 0) => groups.set(index, { names: uniqueNames((fields??[]).map(f => f.name)), rows: [], affected: 0, truncated: false }));
    query.on('result', (row: any, index = 0) => {
      let group = groups.get(index); if (!group) { group = { names: [], rows: [], affected: 0, truncated: false }; groups.set(index, group); }
      if (Array.isArray(row)) { if (group.rows.length < LIMIT && !group.truncated) { const mapped = toRows(group.names, [row])[0]; if (retain(s, mapped)) group.rows.push(mapped); else group.truncated = true; } else group.truncated = true; }
      else group.affected += row.affectedRows ?? 0;
    });
    query.on('error', reject); query.on('end', resolve);
  });
  return [...groups.values()].map(group => {
    const rows = group.rows.splice(0, BATCH);
    const result: QueryResult = { id: crypto.randomUUID(), sql:sourceSql, schema:s.info.schema, columns: group.names, rows, affected: group.affected, elapsed: Date.now() - started, hasMore: group.rows.length > 0, truncated: group.truncated };
    // 已发送的数据由界面持有，后台只保留尚未读取的分页和游标元信息。
    s.cursors.set(result.id, { result: { ...result, rows: [] }, cached: group.rows, offset: rows.length }); return result;
  });
}
async function query(s: Session, sql: string, params: Record<string, Cell>) {
  if (!s.info.connected) throw new Error('连接已断开，请关闭标签后重新连接；写操作不会自动重放。');
  if (s.info.needsRollback) throw new Error('会话需要回滚。请先回滚或重新连接。');
  if(s.info.readOnly)readOnlySql(sql,s.profile.dialect);
  await closeCursors(s);
  if(s.info.readOnly)await beginReadOnly(s);
  const statements = splitSql(sql, s.profile.dialect);
  if (!statements.length) throw new Error('没有可执行的 SQL');
  if (statements.length > 50) throw new Error('每次最多执行 50 条语句');
  const results: QueryResult[] = []; let error: string | undefined, failure:QueryFailure|undefined;
  for (const [statementIndex, statement] of statements.entries()) {
    const started = Date.now();
    try {
      if (s.cancelled) throw new Error('查询已取消');
      const text = statement.sql; const kind = sqlKind(text, s.profile.dialect); const unquoted = maskSql(text, s.profile.dialect).trim();
      if (/^(COMMIT|ROLLBACK)\s*;?\s*$/i.test(unquoted)) {
        await transaction(s, /^COMMIT/i.test(unquoted) ? 'commit' : 'rollback');
        results.push({ id: crypto.randomUUID(), sql: text, schema:s.info.schema, columns: [], rows: [], affected: 0, elapsed: Date.now() - started, hasMore: false, truncated: false }); continue;
      }
      if (/^(START\s+TRANSACTION|BEGIN)\s*;?\s*$/i.test(unquoted)) { await transaction(s, 'auto', false); continue; }
      if (/\bAUTOCOMMIT\b/i.test(text) && kind === 'control') throw new Error('请通过工具栏切换自动提交，确保客户端事务状态同步');
      if (kind === 'ddl' && !s.info.autoCommit) throw new Error('DDL 会隐式提交，请先处理当前事务并切换自动提交，或使用结构设计器');
      if ((kind === 'write' || kind === 'control') && !s.info.autoCommit && !s.info.readOnly) s.info.dirty = true;
      const b = bindSql(text, params, s.profile.dialect);
      if (s.profile.dialect === 'mysql') results.push(...await mysqlQuery(s, b.sql, b.binds as unknown[], text));
      else {
        const r = await s.connection.execute(b.sql, b.binds, { resultSet: true, autoCommit: s.info.autoCommit });
        const sets = [r.resultSet, ...(r.implicitResults ?? [])].filter(Boolean);
        if (!sets.length) results.push({ id: crypto.randomUUID(), sql: text, schema:s.info.schema, columns: [], rows: [], affected: r.rowsAffected ?? 0, elapsed: Date.now() - started, hasMore: false, truncated: false });
        for (const rs of sets) {
          const names = uniqueNames(rs.metaData.map((m:any) => m.name)); const fetched = toRows(names, await rs.getRows(BATCH)); const rows:Record<string,Cell>[] = []; for (const row of fetched) { if (!retain(s,row)) break; rows.push(row); }
          const truncated = rows.length < fetched.length;
          const result: QueryResult = { id: crypto.randomUUID(), sql: text, schema:s.info.schema, columns: names, rows, affected: r.rowsAffected ?? 0, elapsed: Date.now() - started, hasMore: !truncated && rows.length === BATCH, truncated };
          s.cursors.set(result.id, { result: { ...result, rows: [] }, rs, offset: rows.length }); if (!result.hasMore) { await rs.close(); s.cursors.get(result.id)!.rs = undefined; } results.push(result);
        }
      }
      if (/^(USE\b|ALTER\s+SESSION\b)/i.test(unquoted)) {
        const rows = await raw(s,s.profile.dialect === 'mysql' ? 'SELECT DATABASE() AS CURRENT_SCHEMA' : "SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AS CURRENT_SCHEMA FROM DUAL"); s.info.schema = rows[0].CURRENT_SCHEMA ?? s.info.schema;
      }
    } catch (e) {
      if (isDisconnected(e)) s.info.connected = false;
      if (!s.info.autoCommit) s.info.needsRollback = true;
      error = `第 ${statementIndex + 1} 条语句失败：${(e as Error).message}`;
      const start=statement.start+sql.slice(statement.start,statement.end).search(/\S/);
      failure=queryFailure((e as Error).message,{...statement,start},statementIndex,s.profile.dialect);break;
    }
  }
  return { results, error, failure, state: { ...s.info } };
}
async function fetchMore(s: Session, id: string) {
  const cursor = s.cursors.get(id); if (!cursor) throw new Error('结果已释放，请重新执行查询');
  const result = { ...cursor.result, rows: [] as Record<string, Cell>[] };
  if (cursor.cached) { result.rows = cursor.cached.splice(0, BATCH); cursor.offset += result.rows.length; result.hasMore = cursor.cached.length > 0; }
  else if (cursor.rs) {
    const fetched = toRows(result.columns, await cursor.rs.getRows(Math.min(BATCH, LIMIT - cursor.offset))); for (const row of fetched) { if (!retain(s,row)) break; result.rows.push(row); } cursor.offset += result.rows.length;
    result.truncated = result.rows.length < fetched.length;
    result.hasMore = !result.truncated && result.rows.length === BATCH && cursor.offset < LIMIT;
    if (cursor.offset >= LIMIT) result.truncated = (await cursor.rs.getRows(1)).length > 0;
    if (!result.hasMore) { await cursor.rs.close(); cursor.rs = undefined; }
  } else result.hasMore = false;
  cursor.result = { ...result, rows: [] }; return result;
}
async function transaction(s: Session, action: string, value?: boolean) {
  if(s.info.readOnly && action==='auto')throw new Error('AI 查询标签固定为只读会话；需要写入时请新建 SQL 标签');
  if (action === 'auto') {
    if (s.info.dirty || s.info.needsRollback) throw new Error('请先提交或回滚，再切换自动提交');
    if (s.profile.dialect === 'mysql') await s.connection.query(`SET autocommit=${value ? 1 : 0}`);
    s.info.autoCommit = !!value;
  } else {
    if (action === 'commit' && s.info.needsRollback) throw new Error('当前会话状态不确定，只能回滚或重新连接');
    if (action === 'commit') await s.connection.commit(); else await s.connection.rollback();
    s.info.dirty = false; s.info.needsRollback = false;
  }
  return { ...s.info };
}
async function cancel(s: Session) {
  s.cancelled = true;
  if (!s.busy) return { ...s.info };
  if (!s.info.autoCommit) s.info.needsRollback = true;
  if (s.profile.dialect === 'oracle') await s.connection.break();
  else {
    const control = await connect(s.profile);
    try { const threadId = Number(s.connection.threadId); if (!Number.isSafeInteger(threadId)) throw new Error('无效会话编号'); await control.connection.query(`KILL QUERY ${threadId}`); }
    finally { await close(control); }
  }
  return { ...s.info };
}
function valueBind(s:Session,column:Column,name:string){return valuePlaceholder(s.profile.dialect,column,name);}
async function browse(s: Session, p: any) {
  const def=await describe(s,p.schema,p.table);
  const filter=tableSelect(def,s.profile.dialect,p.filters,p.filterMode,p.sort);
  const offset=p.page*BATCH, select=filter.sql;
  let sql: string;
  if (s.profile.dialect === 'mysql') sql = `${select} LIMIT ${BATCH + 1} OFFSET ${offset}`;
  else sql = `SELECT * FROM (SELECT qd_inner.*, ROWNUM AS "__QD_PAGE_ROW__" FROM (${select}) qd_inner WHERE ROWNUM <= ${offset + BATCH + 1}) WHERE "__QD_PAGE_ROW__" > ${offset}`;
  const rows = await raw(s, sql, filter.values); const columns = def.columns.map(c => c.name);
  const normalized = rows.slice(0, BATCH).map((r:any) => Object.fromEntries(columns.map(c => [c, cell(r[c])])));
  const object = (await objects(s, p.schema)).find(o => o.name === p.table);
  const transactional = s.profile.dialect !== 'mysql' || def.engine?.toUpperCase() === 'INNODB';
  const unsupported = def.columns.some(c => /BLOB|CLOB|BINARY|RAW|LONG|JSON|TEXT|XML|GEOMETRY/i.test(c.type));
  return { def, rows: normalized, hasMore: rows.length > BATCH, editable: transactional && object?.kind === 'table' && def.columns.some(c => c.primary) && !unsupported, reason: !transactional ? '此表不是 InnoDB，首版仅提供只读浏览，避免无法回滚的修改' : unsupported ? '含大字段、二进制或复杂类型，首版请使用 SQL 修改' : !def.columns.some(c => c.primary) ? '没有主键，结果只读' : object?.kind !== 'table' ? '视图只读' : '' };
}
async function applyChanges(s: Session, p: any) {
  if (s.info.needsRollback) throw new Error('请先回滚当前事务');
  const def = await describe(s, p.schema, p.table);
  const object = (await objects(s, p.schema)).find(o => o.name === p.table);
  if (object?.kind !== 'table' || !def.columns.some(c => c.primary)) throw new Error('仅支持有主键的普通单表');
  if (def.columns.some(c => /BLOB|CLOB|BINARY|RAW|LONG|JSON|TEXT|XML|GEOMETRY/i.test(c.type))) throw new Error('含大字段或复杂类型，请使用 SQL 修改');
  if (s.profile.dialect === 'mysql' && def.engine?.toUpperCase() !== 'INNODB') throw new Error('仅支持 InnoDB 表的事务编辑');
  const tableName = qualified(p.schema, p.table, s.profile.dialect), q = (n:string) => quoteId(n, s.profile.dialect);
  const wasDirty = s.info.dirty;
  if (s.info.autoCommit && s.profile.dialect === 'mysql') await s.connection.beginTransaction();
  else await command(s, 'SAVEPOINT QD_GRID_EDIT');
  let affected = 0;
  try {
    for (const change of p.changes as RowChange[]) {
      const values: Record<string, Cell> = {}; let counter = 0;
      const bind = (column: Column, value: Cell) => { const name = `v${counter++}`; values[name] = value; return valueBind(s, column, name); };
      for (const key of Object.keys(change.values)) if (!def.columns.some(c => c.name === key)) throw new Error(`字段不存在：${key}`);
      let sql: string;
      if (change.kind === 'insert') {
        const fields = def.columns.filter(c => c.name in change.values && !c.generated);
        if (!fields.length) throw new Error('新增行至少需要一个字段值');
        sql = `INSERT INTO ${tableName} (${fields.map(c => q(c.name)).join(', ')}) VALUES (${fields.map(c => bind(c, change.values[c.name])).join(', ')})`;
      } else {
        if (!change.original || def.columns.some(c => !(c.name in change.original!))) throw new Error('缺少完整原始行，无法检测并发修改');
        if (Object.values(change.original).some(v => typeof v === 'string' && v.endsWith('[内容已截断]'))) throw new Error('原始值被截断，请使用 SQL 修改');
        const where = def.columns.map(c => { const value = change.original![c.name]; return value === null ? `${q(c.name)} IS NULL` : s.profile.dialect === 'mysql' && /CHAR|TEXT|ENUM|SET/i.test(c.type) ? `BINARY ${q(c.name)} = BINARY ${bind(c, value)}` : `${q(c.name)} = ${bind(c, value)}`; }).join(' AND ');
        if (change.kind === 'delete') sql = `DELETE FROM ${tableName} WHERE ${where}`;
        else {
          const changed = def.columns.filter(c => c.name in change.values && change.values[c.name] !== change.original![c.name]);
          if (!changed.length) continue;
          if (changed.some(c => c.generated)) throw new Error('生成列不可直接修改');
          sql = `UPDATE ${tableName} SET ${changed.map(c => `${q(c.name)} = ${bind(c, change.values[c.name])}`).join(', ')} WHERE ${where}`;
        }
      }
      const count = await command(s, sql, values);
      if (count !== 1) throw new Error('数据已被其他会话修改或删除，本批变更未提交。请刷新后重试。'); affected += count;
    }
    if (s.info.autoCommit) await s.connection.commit(); else s.info.dirty = true;
    return { affected, state: { ...s.info } };
  } catch (e) {
    try { if (s.info.autoCommit) await s.connection.rollback(); else await command(s, s.profile.dialect === 'mysql' ? 'ROLLBACK TO SAVEPOINT QD_GRID_EDIT' : 'ROLLBACK TO QD_GRID_EDIT'); s.info.dirty = wasDirty; }
    catch { s.info.needsRollback = true; }
    throw e;
  }
}
async function ddl(s: Session, p: any) {
  const isolated = await connect(s.profile);
  try {
    let current: TableDef | null = null;
    const exists = (await objects(isolated, p.after.schema)).some(o => o.name === p.after.name);
    if (exists) current = await describe(isolated, p.after.schema, p.after.name);
    if (tableFingerprint(current) !== p.fingerprint) throw new Error('表结构已变化，请刷新结构并重新预览');
    const plan = buildDDL(current, p.after, s.profile.dialect); const results: DDLResult[] = [];
    for (const sql of plan.statements) {
      try { await command(isolated, sql, {}, true); results.push({ sql, ok: true }); }
      catch (e) { results.push({ sql, ok: false, error: (e as Error).message }); break; }
    }
    return results;
  } finally { await close(isolated); }
}
async function beginReadOnly(s: Session) {
  await s.connection.rollback();
  if(s.profile.dialect==='mysql'){await s.connection.query('SET TRANSACTION READ ONLY');await s.connection.query('START TRANSACTION');}
  else await command(s,'SET TRANSACTION READ ONLY');
  s.info.autoCommit=false;s.info.dirty=false;s.info.needsRollback=false;
}
async function findTables(s: Session, schema: string, search: string) {
  const term='%'+search.toLowerCase().replace(/[!%_]/g,c=>'!'+c)+'%';
  const rows=await raw(s,s.profile.dialect==='mysql'
    ? "SELECT TABLE_NAME AS NAME, TABLE_COMMENT AS DESCRIPTION FROM information_schema.TABLES WHERE TABLE_SCHEMA=:schema AND (LOWER(TABLE_NAME) LIKE :term ESCAPE '!' OR LOWER(TABLE_COMMENT) LIKE :term ESCAPE '!') ORDER BY TABLE_NAME LIMIT 101"
    : "SELECT * FROM (SELECT TABLE_NAME AS NAME, COMMENTS AS DESCRIPTION FROM ALL_TAB_COMMENTS WHERE OWNER=:schema AND TABLE_TYPE IN ('TABLE','VIEW') AND (LOWER(TABLE_NAME) LIKE :term ESCAPE '!' OR LOWER(COMMENTS) LIKE :term ESCAPE '!') ORDER BY TABLE_NAME) WHERE ROWNUM <= 101",{schema,term});
  return {tables:rows.slice(0,100).map((r:any)=>({name:r.NAME,comment:String(r.DESCRIPTION||'').slice(0,500)})),hasMore:rows.length>100};
}
async function exportTable(s: Session,p:any) {
  let sql:string,params:Record<string,Cell>={};
  if(p.query){sql=readOnlySql(p.query.sql,s.profile.dialect);params=p.query.params;}
  else {
    const object=(await objects(s,p.schema)).find(o=>o.name===p.table&&['table','view'].includes(o.kind));
    if(!object)throw new Error('表或视图不存在，请先查找真实表名');
    if(p.filters?.length||p.sort){const def=await describe(s,p.schema,p.table);const select=tableSelect(def,s.profile.dialect,p.filters,p.filterMode,p.sort);sql=select.sql;params=select.values;}
    else sql=`SELECT * FROM ${qualified(p.schema,p.table,s.profile.dialect)}`;
  }
  const bound=bindSql(sql,params,s.profile.dialect);
  await closeCursors(s);await beginReadOnly(s);
  const partial=p.filePath+'.'+crypto.randomUUID()+'.partial';
  let lastProgress=0;
  const file=await fs.promises.open(partial,'wx');let count=0, warning=false, rs:any, stream:any;
  async function writeRows(names:string[],rows:any[][]){
    if(s.cancelled)throw new Error('导出已取消');
    const mapped=toRows(names,rows);
    if(mapped.some(row=>Object.values(row).some(value=>typeof value==='string'&&/\[LOB：|\[二进制 |\[复杂类型：|\[内容已截断\]/.test(value))))warning=true;
    if(p.format==='csv') { const body=csv(mapped,names).slice(csv([],names).length+2);if(body)await file.writeFile(body+'\r\n','utf8'); }
    else if(mapped.length)await file.writeFile((count?',\n':'')+mapped.map(row=>JSON.stringify(row)).join(',\n'),'utf8');
    count+=mapped.length;
    if(p.exportId&&Date.now()-lastProgress>300){lastProgress=Date.now();port.postMessage({exportProgress:{id:p.exportId,rows:count}});}
  }
  try{
    let names:string[];
    if(s.profile.dialect==='oracle'){
      const result=await s.connection.execute(bound.sql,bound.binds, {resultSet:true,autoCommit:false});rs=result.resultSet;
      names=uniqueNames(rs.metaData.map((m:any)=>m.name));
      await file.writeFile(p.format==='csv'?csv([],names)+'\r\n':'[\n','utf8');
      while(true){if(s.cancelled)throw new Error('导出已取消');const rows=await rs.getRows(BATCH);if(!rows.length)break;await writeRows(names,rows);}
    }else{
      const query=(bound.binds as unknown[]).length?s.connection.connection.execute({sql:bound.sql,values:bound.binds,rowsAsArray:true}):s.connection.connection.query({sql:bound.sql,rowsAsArray:true});
      let namesReady=false;
      query.on('fields',(fields:any[])=>{names=uniqueNames(fields.map(f=>f.name));namesReady=true;});
      stream=query.stream({highWaterMark:BATCH});let batch:any[][]=[],header=false;
      for await(const row of stream){
        if(!header){await file.writeFile(p.format==='csv'?csv([],names!)+'\r\n':'[\n','utf8');header=true;}
        batch.push(row);if(batch.length===BATCH){await writeRows(names!,batch);batch=[];}
      }
      if(!header){if(!namesReady)throw new Error('数据库未返回字段信息');await file.writeFile(p.format==='csv'?csv([],names!)+'\r\n':'[\n','utf8');}
      if(batch.length)await writeRows(names!,batch);
    }
    if(s.cancelled)throw new Error('导出已取消');
    if(p.format==='json')await file.writeFile('\n]\n','utf8');
    await file.close();
    await fs.promises.rename(partial,p.filePath);
    return {rows:count,warnings:warning?['大字段或复杂类型使用占位文本，超长字符值可能截断；需要原始大字段时请先用 SQL 转换。']:[]};
  }catch(e){await file.close().catch(()=>{});await fs.promises.unlink(partial).catch(()=>{});throw e;}
  finally{if(rs)await rs.close().catch(()=>{});stream?.destroy();await s.connection.rollback().catch(()=>{});}
}
async function handle(method: string, p: any) {
  if (method === 'client.inspect') return inspectJdbc();
  if (method === 'connection.test') { const s = await connect(p); try { return s.info; } finally { await close(s); } }
  if (method === 'session.open') { if (sessions.has(p.sessionId)) throw new Error('会话重复'); const s = await connect(p.profile); if(p.readOnly){s.info.readOnly=true;s.info.autoCommit=false;} sessions.set(p.sessionId, s); return s.info; }
  if(method==='session.reconnect'){
    const old=sessions.get(p.sessionId);
    if(old?.busy)throw new Error('请先停止当前操作并等待结束');
    if(old&&(old.info.dirty||old.info.needsRollback)&&!p.allowDiscard)throw new Error('当前事务尚未处理，请确认放弃后再重连');
    const readOnly=old?.info.readOnly||p.readOnly;
    if(old){await close(old);sessions.delete(p.sessionId);}
    const fresh=await connect(p.profile);
    try{
      if(p.schema&&fresh.info.schema!==p.schema){await raw(fresh,fresh.profile.dialect==='mysql'?`USE ${quoteId(p.schema,'mysql')}`:`ALTER SESSION SET CURRENT_SCHEMA=${quoteId(p.schema,'oracle')}`);fresh.info.schema=p.schema;}
      if(readOnly){fresh.info.readOnly=true;fresh.info.autoCommit=false;}else if(!p.autoCommit)await transaction(fresh,'auto',false);
      sessions.set(p.sessionId,fresh);return {...fresh.info};
    }catch(e){await close(fresh);throw e;}
  }
  if(method==='session.close'&&!sessions.has(p.sessionId))return;
  const s = sessions.get(p.sessionId); if (!s) throw new Error('数据库会话不存在，请重新连接');
  if(s.info.readOnly && ['table.apply','ddl.execute'].includes(method))throw new Error('AI 会话禁止写入；请在独立 SQL 草稿中检查后执行');
  if (method === 'query.cancel') return cancel(s);
  if (method === 'session.state') return s.info;
  if (s.busy) throw new Error('当前标签正在执行操作，请等待完成或取消');
  s.busy = true; s.cancelled = false;
  try {
    switch (method) {
      case 'session.close': if ((s.info.dirty || s.info.needsRollback) && !p.force) throw new Error('存在未提交事务，请提交或回滚'); await close(s); sessions.delete(p.sessionId); return;
      case 'session.transaction': return await transaction(s, p.action, p.value);
      case 'session.schema': await raw(s, s.profile.dialect === 'mysql' ? `USE ${quoteId(p.schema, 'mysql')}` : `ALTER SESSION SET CURRENT_SCHEMA=${quoteId(p.schema, 'oracle')}`); s.info.schema = p.schema; return { ...s.info };
      case 'schema.list': return await schemas(s);
      case 'object.list': return await objects(s, p.schema);
      case 'object.source': return await source(s, p.schema, p.table, p.kind);
      case 'table.describe': return await describe(s, p.schema, p.table);
      case 'agent.find': return await findTables(s,p.schema,p.search);
      case 'agent.export': return await exportTable(s,p);
      case 'query.run': return await query(s, p.sql, p.params);
      case 'query.fetch': return await fetchMore(s, p.resultId);
      case 'table.browse': return await browse(s, p);
      case 'table.apply': return await applyChanges(s, p);
      case 'ddl.preview': return buildDDL(p.before, p.after, s.profile.dialect);
      case 'ddl.execute': return await ddl(s, p);
      default: throw new Error('未知数据库操作');
    }
  } catch (e) { if (isDisconnected(e)) { s.info.connected = false; s.info.needsRollback = !s.info.autoCommit; } throw e; }
  finally { s.busy = false; }
}
function isDisconnected(e: unknown) { return /ORA-03113|ORA-03114|ORA-03135|JDBC 工作进程已退出|JDBC 会话已关闭|JDBC 17002|JDBC 17008|JDBC 17410|ECONNRESET|EPIPE|connection.*(lost|closed)|closed.*connection/i.test(String((e as Error)?.message)); }
const port = (process as any).parentPort;
port.on('message', async ({ data }: any) => {
  try {
    const key = data.payload?.sessionId;
    let value: unknown;
    if (key && !['query.cancel', 'session.state'].includes(data.method)) {
      const previous = queues.get(key) ?? Promise.resolve();
      const operation = previous.catch(() => {}).then(() => handle(data.method, data.payload));
      queues.set(key, operation);
      try { value = await operation; } finally { if (queues.get(key) === operation) queues.delete(key); }
    } else value = await handle(data.method, data.payload);
    port.postMessage({ id: data.id, ok: true, value });
  }
  catch (e) { let error = (e as Error).message; const secret = data.payload?.profile?.password || data.payload?.password; if (secret) error = error.replaceAll(secret, '[已隐藏]'); port.postMessage({ id: data.id, ok: false, error }); }
});
