import type { Dialect } from './types';

// 保留字符位置，屏蔽字符串与注释；用于分句和占位符识别，不声称是完整 SQL 解析器。
export function maskSql(sql: string, dialect: Dialect = 'mysql'): string {
  // 使用 UTF-16 下标，与 Monaco 及 String.slice 保持一致。
  const out = sql.split('');
  let i = 0;
  const blank = (a: number, b: number) => { for (let n = a; n < b; n++) if (out[n] !== '\n' && out[n] !== '\r') out[n] = ' '; };
  while (i < sql.length) {
    const start = i;
    if (sql.startsWith('--', i) || (dialect === 'mysql' && sql[i] === '#')) {
      i = sql.indexOf('\n', i); if (i < 0) i = sql.length; blank(start, i); continue;
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2); if (end < 0) throw new Error('SQL 注释未闭合');
      i = end + 2; blank(start, i); continue;
    }
    if ((sql[i] === 'q' || sql[i] === 'Q') && sql[i + 1] === "'") {
      const open = sql[i + 2]; const close = ({ '[': ']', '{': '}', '(': ')', '<': '>' } as Record<string, string>)[open] || open;
      const end = sql.indexOf(close + "'", i + 3); if (end < 0) throw new Error('Oracle q 字符串未闭合');
      i = end + 2; blank(start, i); continue;
    }
    if ("'\"`".includes(sql[i])) {
      const quote = sql[i++]; let closed = false;
      while (i < sql.length) {
        if (dialect === 'mysql' && sql[i] === '\\') { i += 2; continue; }
        if (sql[i] === quote) { if (sql[i + 1] === quote) { i += 2; continue; } i++; closed = true; break; }
        i++;
      }
      if (!closed) throw new Error('SQL 字符串或标识符未闭合');
      blank(start, i); continue;
    }
    i++;
  }
  return out.join('');
}
export interface Statement { sql: string; start: number; end: number; }
export function splitSql(sql: string, dialect: Dialect): Statement[] {
  const mask = maskSql(sql, dialect); const result: Statement[] = [];
  let start = 0, delimiter = ';';
  const push = (end: number) => { const text = sql.slice(start, end).trim(); if (mask.slice(start, end).trim()) result.push({ sql: text, start, end }); };
  for (let i = 0; i < sql.length; i++) {
    if (i === 0 || sql[i - 1] === '\n') {
      const line = mask.slice(i).split('\n', 1)[0];
      const command = /^\s*DELIMITER\s+(\S+)\s*$/i.exec(line);
      if (dialect === 'mysql' && command) {
        if (mask.slice(start, i).trim()) throw new Error('DELIMITER 必须位于语句之间');
        delimiter = command[1]; start = i + line.length + 1; i = start - 1; continue;
      }
      if (dialect === 'oracle' && /^\s*\/\s*$/.test(line)) {
        push(i); start = i + line.length + 1; i = start - 1; continue;
      }
    }
    if (mask.startsWith(delimiter, i)) {
      const head = mask.slice(start, i).trim();
      const plsql = dialect === 'oracle' && /^(DECLARE\b|BEGIN\b|CREATE\s+(OR\s+REPLACE\s+)?((NON)?EDITIONABLE\s+)?(PROCEDURE|FUNCTION|TRIGGER|PACKAGE|TYPE)\b)/i.test(head);
      if (!plsql) { push(i); i += delimiter.length - 1; start = i + 1; }
    }
  }
  push(sql.length);
  return result;
}
export function currentSql(sql: string, offset: number, dialect: Dialect): string {
  const parts = splitSql(sql, dialect);
  return (parts.find(s => offset >= s.start && offset <= s.end + 1) ?? parts.at(-1))?.sql ?? '';
}
export function bindNames(sql: string, dialect: Dialect = 'mysql'): string[] {
  return [...new Set([...maskSql(sql, dialect).matchAll(/(?<!:):([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1]))];
}
export function bindSql(sql: string, values: Record<string, unknown>, dialect: Dialect) {
  const names = bindNames(sql, dialect);
  for (const name of names) if (!(name in values)) throw new Error(`缺少参数 :${name}`);
  if (dialect === 'oracle') return { sql, binds: Object.fromEntries(names.map(n => [n, values[n]])) };
  const mask = maskSql(sql, dialect); const binds: unknown[] = []; let last = 0, text = '';
  for (const match of mask.matchAll(/(?<!:):([A-Za-z_][A-Za-z0-9_]*)/g)) {
    text += sql.slice(last, match.index) + '?'; last = match.index! + match[0].length; binds.push(values[match[1]]);
  }
  return { sql: text + sql.slice(last), binds };
}
export function sqlKind(sql: string, dialect: Dialect = 'mysql'): 'read' | 'ddl' | 'write' | 'control' {
  const text = maskSql(sql, dialect).trim();
  if (/^(COMMIT|ROLLBACK|BEGIN|START\s+TRANSACTION|SAVEPOINT|SET\b|ALTER\s+SESSION)\b/i.test(text)) return 'control';
  if (/^(CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE|COMMENT)\b/i.test(text)) return 'ddl';
  if (/^(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i.test(text)) return 'read';
  // WITH 可以包含写入；保守跟踪事务，避免将其误认为只读。
  return 'write';
}
export function quoteId(name: string, dialect: Dialect): string {
  if (!name || name.includes('\0') || name.length > 128) throw new Error('数据库标识符无效');
  const q = dialect === 'mysql' ? '`' : '"'; return q + name.replaceAll(q, q + q) + q;
}
export function qualified(schema: string, table: string, dialect: Dialect) { return `${quoteId(schema, dialect)}.${quoteId(table, dialect)}`; }
export function csv(rows: Record<string, unknown>[], columns: string[]): string {
  const cell = (v: unknown) => '"' + (v == null ? '' : String(v)).replaceAll('"', '""') + '"';
  return '\uFEFF' + [columns.map(cell).join(','), ...rows.map(r => columns.map(c => cell(r[c])).join(','))].join('\r\n');
}
