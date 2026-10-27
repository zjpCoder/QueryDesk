import { z } from 'zod';
const text = z.string().max(10000);
const id = z.string().min(1).max(128);
const name = z.string().min(1).max(128).refine(v => !v.includes('\0'));
const cell = z.union([z.string().max(200000), z.number().finite(), z.boolean(), z.null()]);
const row = z.record(z.string().max(128), cell);
export const profile = z.object({ id, name, group: z.string().max(100), dialect: z.enum(['mysql','oracle']), host: z.string().min(1).max(255).regex(/^[A-Za-z0-9.:[\]_-]+$/), port: z.number().int().min(1).max(65535), user: name, password: z.string().max(10000).optional(), hasPassword: z.boolean().optional(), database: z.string().max(128), oracleMode: z.enum(['service','sid']), clientPath: z.string().max(1024), tls: z.boolean(), caPath: z.string().max(1024) });
export const aiSettings = z.object({ baseUrl: z.string().url().max(2048), model: z.string().min(1).max(200), apiKey: z.string().max(10000).optional(), hasKey: z.boolean().optional() });
const column = z.object({ name, type: z.string().min(1).max(150), nullable: z.boolean(), defaultValue: z.string().max(4000), comment: z.string().max(4000), primary: z.boolean(), generated: z.boolean().optional() });
export const table = z.object({ schema: name, name, comment: z.string().max(4000), engine: z.string().max(100).optional(), columns: z.array(column).min(1).max(1000), indexes: z.array(z.object({ name, columns: z.array(name).min(1).max(32), unique: z.boolean(), constraintName: name.optional() })).max(100), foreignKeys: z.array(z.object({ name, columns: z.array(name).min(1).max(32), refSchema: name, refTable: name, refColumns: z.array(name).min(1).max(32), onDelete: z.enum(['NO ACTION','CASCADE','SET NULL']) })).max(100) });
const session = z.object({ sessionId: id });
const tableKey = session.extend({ schema: name, table: name });
const filters=z.array(z.object({column:name,op:z.enum(['=','<>','>','<','>=','<=','contains','is null','is not null']),value:z.string().max(10000)})).max(20);
const sort=z.object({column:name,direction:z.enum(['asc','desc'])}).optional();
const params=z.record(z.string().max(128),cell).default({});
export const workspaceDraft = z.object({activeId:z.string().max(128),tabs:z.array(z.object({id,connectionId:id,schema:z.string().max(128),title:z.string().max(255),sql:z.string().max(1000000),fileId:id.optional(),edited:z.boolean().optional(),autoCommit:z.boolean(),readOnly:z.boolean().optional()})).max(100)}).refine(v=>new Set(v.tabs.map(t=>t.id)).size===v.tabs.length,'标签 ID 重复');
export const schemas: Record<string, z.ZodType> = {
  'workspace.get':z.object({}), 'workspace.save':workspaceDraft,
  'sql.open':z.object({}), 'sql.save':z.object({fileId:id.optional(),sql:z.string().max(1000000),saveAs:z.boolean().optional()}),
  'session.reconnect':session.extend({connectionId:id,schema:z.string().max(128),autoCommit:z.boolean(),readOnly:z.boolean().optional(),allowDiscard:z.boolean().default(false)}),
  'export.start':z.object({id,connectionId:id,schema:name,table:name,format:z.enum(['csv','json']),filters:filters.default([]),filterMode:z.enum(['and','or']).default('and'),sort}),
  'export.query':z.object({id,connectionId:id,schema:z.string().max(128),format:z.enum(['csv','json']),query:z.object({sql:z.string().min(1).max(1000000),params})}),
  'export.cancel':z.object({id}),
  'settings.get': z.object({}), 'settings.theme': z.object({ theme: z.enum(['dark','light']) }),
  'connection.save': profile, 'connection.delete': z.object({ id }), 'connection.test': profile,
  'client.inspect': z.object({ path: z.string().max(1024) }), 'dialog.directory': z.object({}), 'dialog.file': z.object({}),
  'session.open': session.extend({ connectionId: id }), 'session.close': session.extend({ force: z.boolean().optional() }),
  'session.state': session, 'session.schema': session.extend({ schema: name }), 'session.transaction': session.extend({ action: z.enum(['commit','rollback','auto']), value: z.boolean().optional() }),
  'schema.list': session, 'object.list': session.extend({ schema: name }),
  'object.source': tableKey.extend({ kind: z.enum(['view','procedure','function','package','trigger','sequence','table']) }),
  'table.describe': tableKey,
  'query.run': session.extend({ sql: z.string().min(1).max(1000000), params: z.record(z.string().max(128), cell).default({}) }),
  'query.fetch': session.extend({ resultId: id }), 'query.cancel': session,
  'table.browse':tableKey.extend({page:z.number().int().min(0).max(1000000),sort,filters,filterMode:z.enum(['and','or']).default('and')}),
  'table.apply': tableKey.extend({ changes: z.array(z.object({ kind: z.enum(['insert','update','delete']), original: row.optional(), values: row })).min(1).max(200) }),
  'ddl.preview': session.extend({ before: table.nullable(), after: table }),
  'ddl.execute': session.extend({ before: table.nullable(), after: table, fingerprint: z.string().max(1000000) }),
  'ai.save': aiSettings, 'ai.test': aiSettings,
  'ai.clear': z.object({connectionId:id,schema:z.string().max(128)}),
  'ai.start': z.object({ id, action: z.enum(['operate','generate','explain','fix','optimize']), question: text, connectionId: id, dialect: z.enum(['mysql','oracle']), version: z.string().max(1000), schema: z.string().max(128), sql: z.string().max(100000), error: text, tables: z.array(table).max(20), rows: z.array(row).max(50), sessionId: id.optional(), activeTable: name.optional() }),
  'ai.cancel': z.object({ id }),
  'file.reveal': z.object({ id }),
  'file.export': z.object({ format: z.enum(['csv','json']), columns: z.array(z.string()).max(2000), rows: z.array(row).max(10000) }),
  'history.add': z.object({ connectionId: id, sql: z.string().max(100000), time: z.string().datetime(), ok: z.boolean() })
};
export function validate(method: string, value: unknown) {
  if (!schemas[method]) throw new Error('不允许的操作');
  return schemas[method].parse(value ?? {});
}
