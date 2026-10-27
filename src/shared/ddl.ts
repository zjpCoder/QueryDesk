import type { Column, DDLPlan, Dialect, ForeignKey, TableDef } from './types';
import { maskSql, qualified, quoteId } from './sql';

const typePatterns = {
  mysql: /^(TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|FLOAT|DOUBLE|REAL|DECIMAL|NUMERIC|CHAR|VARCHAR|BINARY|VARBINARY|BIT|DATE|DATETIME|TIMESTAMP|TIME|YEAR|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB|JSON|BOOLEAN)(\s*\(\s*\d+\s*(,\s*\d+\s*)?\))?(\s+UNSIGNED)?$/i,
  oracle: /^(VARCHAR2|NVARCHAR2|CHAR|NCHAR|NUMBER|FLOAT|BINARY_FLOAT|BINARY_DOUBLE|INTEGER|INT|SMALLINT|DATE|TIMESTAMP|RAW|LONG RAW|LONG|CLOB|NCLOB|BLOB)(\s*\(\s*\d+\s*(,\s*[-+]?\d+\s*|\s+(BYTE|CHAR)\s*)?\))?(\s+WITH(\s+LOCAL)?\s+TIME\s+ZONE)?$/i
};
const literal = (v: string) => "'" + v.replaceAll("'", "''") + "'";
export function validateTable(def: TableDef, dialect: Dialect) {
  const names = new Set<string>();
  if (!def.columns.length) throw new Error('至少需要一个字段');
  quoteId(def.schema, dialect); quoteId(def.name, dialect);
  if (dialect === 'oracle' && Buffer.byteLength(def.name, 'utf8') > 30) throw new Error('Oracle 11g 对象名称不得超过 30 字节');
  for (const c of def.columns) {
    quoteId(c.name, dialect);
    const key = dialect === 'mysql' ? c.name.toLowerCase() : c.name;
    if (names.has(key)) throw new Error(`字段重复：${c.name}`); names.add(key);
    if (!typePatterns[dialect].test(c.type.trim())) throw new Error(`不支持的字段类型：${c.type}`);
    if (c.primary && c.nullable) throw new Error(`主键字段不可为空：${c.name}`);
    if (dialect === 'oracle' && Buffer.byteLength(c.name, 'utf8') > 30) throw new Error(`Oracle 11g 字段名称超过 30 字节：${c.name}`);
    if (c.defaultValue.trim()) {
      const masked = maskSql(c.defaultValue, dialect);
      if (/[;]/.test(masked) || /--|\/\*|#/.test(c.defaultValue.replace(/'(?:''|[^'])*'/g, ''))) throw new Error('默认值只允许单个表达式');
      let depth = 0; for (const x of masked) { if (x === '(') depth++; if (x === ')' && --depth < 0) throw new Error('默认值括号不匹配'); } if (depth) throw new Error('默认值括号不匹配');
    }
  }
  const actualNames = new Set(def.columns.map(c => c.name));
  const constraints = new Set<string>();
  for (const item of [...def.indexes, ...def.foreignKeys]) {
    quoteId(item.name, dialect); const key = item.name.toLowerCase(); if (constraints.has(key)) throw new Error(`索引或约束名重复：${item.name}`); constraints.add(key);
    if (dialect === 'oracle' && Buffer.byteLength(item.name, 'utf8') > 30) throw new Error('Oracle 11g 约束或索引名不得超过 30 字节');
    if (!item.columns.length || item.columns.some(n => !actualNames.has(n))) throw new Error(`索引或约束字段不存在：${item.name}`);
  }
  for (const f of def.foreignKeys) {
    if (f.columns.length !== f.refColumns.length || !f.refTable || !f.refSchema) throw new Error(`外键定义不完整：${f.name}`);
    f.refColumns.forEach(n => quoteId(n, dialect));
    if (f.onDelete === 'SET NULL' && f.columns.some(n => !def.columns.find(c => c.name === n)?.nullable)) throw new Error('SET NULL 外键的字段必须允许空值');
  }
}
function col(c: Column, d: Dialect, altering = false) {
  return `${quoteId(c.name, d)} ${c.type.trim()}${c.defaultValue.trim() ? ` DEFAULT ${c.defaultValue.trim()}` : altering && d === 'oracle' ? ' DEFAULT NULL' : ''}${c.nullable ? ' NULL' : ' NOT NULL'}${d === 'mysql' ? ` COMMENT ${literal(c.comment)}` : ''}`;
}
export function tableFingerprint(t: TableDef | null) {
  // 元数据列表顺序不应影响结构冲突检测，字段顺序除外。
  return JSON.stringify(t && { ...t, indexes: [...t.indexes].sort((a,b) => a.name.localeCompare(b.name)), foreignKeys: [...t.foreignKeys].sort((a,b) => a.name.localeCompare(b.name)) });
}
export function buildDDL(before: TableDef | null, after: TableDef, dialect: Dialect): DDLPlan {
  validateTable(after, dialect);
  const statements: string[] = [], warnings: string[] = [];
  const q = (n: string) => quoteId(n, dialect); const table = qualified(after.schema, after.name, dialect);
  const columns = (list: string[]) => list.map(q).join(', ');
  const fk = (f: ForeignKey) => `CONSTRAINT ${q(f.name)} FOREIGN KEY (${columns(f.columns)}) REFERENCES ${qualified(f.refSchema, f.refTable, dialect)} (${columns(f.refColumns)})${f.onDelete === 'NO ACTION' ? '' : ` ON DELETE ${f.onDelete}`}`;
  const pk = (t: TableDef) => t.columns.filter(c => c.primary).map(c => c.name);
  if (before && (before.name !== after.name || before.schema !== after.schema)) throw new Error('首版改表不支持重命名表或移动 Schema，请使用 SQL');
  if (!before) {
    const parts = after.columns.map(c => col(c, dialect));
    if (pk(after).length) parts.push(`PRIMARY KEY (${columns(pk(after))})`);
    parts.push(...after.foreignKeys.map(fk));
    statements.push(`CREATE TABLE ${table} (\n  ${parts.join(',\n  ')}\n)${dialect === 'mysql' ? ` ENGINE=InnoDB COMMENT=${literal(after.comment)}` : ''}`);
  } else {
    // 先移除变更的约束，再改变字段，最后恢复约束。
    for (const f of before.foreignKeys) if (!after.foreignKeys.some(n => JSON.stringify(n) === JSON.stringify(f))) statements.push(`ALTER TABLE ${table} DROP ${dialect === 'mysql' ? 'FOREIGN KEY' : 'CONSTRAINT'} ${q(f.name)}`);
    for (const index of before.indexes) if (!after.indexes.some(n => JSON.stringify(n) === JSON.stringify(index))) {
      if (dialect === 'oracle' && index.constraintName) statements.push(`ALTER TABLE ${table} DROP CONSTRAINT ${q(index.constraintName)} KEEP INDEX`);
      statements.push(dialect === 'mysql' ? `DROP INDEX ${q(index.name)} ON ${table}` : `DROP INDEX ${qualified(after.schema, index.name, dialect)}`);
    }
    if (JSON.stringify(pk(before)) !== JSON.stringify(pk(after)) && pk(before).length) statements.push(`ALTER TABLE ${table} DROP PRIMARY KEY`);
    for (const c of before.columns) if (!after.columns.some(n => n.name === c.name)) { statements.push(`ALTER TABLE ${table} DROP COLUMN ${q(c.name)}`); warnings.push(`删除字段 ${c.name} 会丢失该列全部数据`); }
    for (const c of after.columns) {
      const old = before.columns.find(n => n.name === c.name);
      if (!old) statements.push(`ALTER TABLE ${table} ADD ${dialect === 'mysql' ? 'COLUMN ' : ''}${dialect === 'oracle' ? '(' : ''}${col(c, dialect)}${dialect === 'oracle' ? ')' : ''}`);
      else if (['type', 'nullable', 'defaultValue', ...(dialect === 'mysql' ? ['comment'] : [])].some(k => old[k as keyof Column] !== c[k as keyof Column])) {
        if (old.generated || c.generated) throw new Error(`生成列 ${c.name} 请使用 SQL 修改，避免丢失生成表达式`);
        statements.push(`ALTER TABLE ${table} MODIFY ${dialect === 'mysql' ? 'COLUMN ' : '('}${col(c, dialect, true)}${dialect === 'oracle' ? ')' : ''}`);
        if (old.type !== c.type || (old.nullable && !c.nullable)) warnings.push(`修改 ${c.name} 的类型或非空约束可能失败或造成数据转换`);
      }
    }
    if (JSON.stringify(pk(before)) !== JSON.stringify(pk(after)) && pk(after).length) statements.push(`ALTER TABLE ${table} ADD PRIMARY KEY (${columns(pk(after))})`);
    for (const f of after.foreignKeys) if (!before.foreignKeys.some(n => JSON.stringify(n) === JSON.stringify(f))) statements.push(`ALTER TABLE ${table} ADD ${fk(f)}`);
    if (dialect === 'mysql' && before.comment !== after.comment) statements.push(`ALTER TABLE ${table} COMMENT=${literal(after.comment)}`);
  }
  for (const index of after.indexes) if (!before?.indexes.some(n => JSON.stringify(n) === JSON.stringify(index))) {
    statements.push(`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${dialect === 'oracle' ? qualified(after.schema, index.name, dialect) : q(index.name)} ON ${table} (${columns(index.columns)})`);
    if (dialect === 'oracle' && index.unique) statements.push(`ALTER TABLE ${table} ADD CONSTRAINT ${q(index.constraintName || index.name)} UNIQUE (${columns(index.columns)}) USING INDEX ${qualified(after.schema, index.name, dialect)}`);
  }
  if (dialect === 'oracle') {
    if (!before || before.comment !== after.comment) statements.push(`COMMENT ON TABLE ${table} IS ${literal(after.comment)}`);
    for (const c of after.columns) if ((!before && c.comment) || (before && before.columns.find(n => n.name === c.name)?.comment !== c.comment)) statements.push(`COMMENT ON COLUMN ${table}.${q(c.name)} IS ${literal(c.comment)}`);
  }
  if (statements.length) warnings.unshift('DDL 可能隐式提交；逐条执行，已成功的结构变更不能整体回滚。');
  return { statements, warnings };
}
