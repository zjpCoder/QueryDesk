"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/shared/sql.ts
function maskSql(sql, dialect = "mysql") {
  const out = sql.split("");
  let i = 0;
  const blank = (a, b) => {
    for (let n = a; n < b; n++) if (out[n] !== "\n" && out[n] !== "\r") out[n] = " ";
  };
  while (i < sql.length) {
    const start2 = i;
    if (sql.startsWith("--", i) || dialect === "mysql" && sql[i] === "#") {
      i = sql.indexOf("\n", i);
      if (i < 0) i = sql.length;
      blank(start2, i);
      continue;
    }
    if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) throw new Error("SQL \u6CE8\u91CA\u672A\u95ED\u5408");
      i = end + 2;
      blank(start2, i);
      continue;
    }
    if ((sql[i] === "q" || sql[i] === "Q") && sql[i + 1] === "'") {
      const open = sql[i + 2];
      const close2 = { "[": "]", "{": "}", "(": ")", "<": ">" }[open] || open;
      const end = sql.indexOf(close2 + "'", i + 3);
      if (end < 0) throw new Error("Oracle q \u5B57\u7B26\u4E32\u672A\u95ED\u5408");
      i = end + 2;
      blank(start2, i);
      continue;
    }
    if ("'\"`".includes(sql[i])) {
      const quote = sql[i++];
      let closed = false;
      while (i < sql.length) {
        if (dialect === "mysql" && sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) throw new Error("SQL \u5B57\u7B26\u4E32\u6216\u6807\u8BC6\u7B26\u672A\u95ED\u5408");
      blank(start2, i);
      continue;
    }
    i++;
  }
  return out.join("");
}
function splitSql(sql, dialect) {
  const mask = maskSql(sql, dialect);
  const result = [];
  let start2 = 0, delimiter = ";";
  const push = (end) => {
    const text = sql.slice(start2, end).trim();
    if (mask.slice(start2, end).trim()) result.push({ sql: text, start: start2, end });
  };
  for (let i = 0; i < sql.length; i++) {
    if (i === 0 || sql[i - 1] === "\n") {
      const line = mask.slice(i).split("\n", 1)[0];
      const command2 = /^\s*DELIMITER\s+(\S+)\s*$/i.exec(line);
      if (dialect === "mysql" && command2) {
        if (mask.slice(start2, i).trim()) throw new Error("DELIMITER \u5FC5\u987B\u4F4D\u4E8E\u8BED\u53E5\u4E4B\u95F4");
        delimiter = command2[1];
        start2 = i + line.length + 1;
        i = start2 - 1;
        continue;
      }
      if (dialect === "oracle" && /^\s*\/\s*$/.test(line)) {
        push(i);
        start2 = i + line.length + 1;
        i = start2 - 1;
        continue;
      }
    }
    if (mask.startsWith(delimiter, i)) {
      const head = mask.slice(start2, i).trim();
      const plsql = dialect === "oracle" && /^(DECLARE\b|BEGIN\b|CREATE\s+(OR\s+REPLACE\s+)?((NON)?EDITIONABLE\s+)?(PROCEDURE|FUNCTION|TRIGGER|PACKAGE|TYPE)\b)/i.test(head);
      if (!plsql) {
        push(i);
        i += delimiter.length - 1;
        start2 = i + 1;
      }
    }
  }
  push(sql.length);
  return result;
}
function bindNames(sql, dialect = "mysql") {
  return [...new Set([...maskSql(sql, dialect).matchAll(/(?<!:):([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))];
}
function bindSql(sql, values, dialect) {
  const names = bindNames(sql, dialect);
  for (const name of names) if (!(name in values)) throw new Error(`\u7F3A\u5C11\u53C2\u6570 :${name}`);
  if (dialect === "oracle") return { sql, binds: Object.fromEntries(names.map((n) => [n, values[n]])) };
  const mask = maskSql(sql, dialect);
  const binds = [];
  let last = 0, text = "";
  for (const match of mask.matchAll(/(?<!:):([A-Za-z_][A-Za-z0-9_]*)/g)) {
    text += sql.slice(last, match.index) + "?";
    last = match.index + match[0].length;
    binds.push(values[match[1]]);
  }
  return { sql: text + sql.slice(last), binds };
}
function sqlKind(sql, dialect = "mysql") {
  const text = maskSql(sql, dialect).trim();
  if (/^(COMMIT|ROLLBACK|BEGIN|START\s+TRANSACTION|SAVEPOINT|SET\b|ALTER\s+SESSION)\b/i.test(text)) return "control";
  if (/^(CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE|COMMENT)\b/i.test(text)) return "ddl";
  if (/^(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i.test(text)) return "read";
  return "write";
}
function quoteId(name, dialect) {
  if (!name || name.includes("\0") || name.length > 128) throw new Error("\u6570\u636E\u5E93\u6807\u8BC6\u7B26\u65E0\u6548");
  const q = dialect === "mysql" ? "`" : '"';
  return q + name.replaceAll(q, q + q) + q;
}
function qualified(schema, table, dialect) {
  return `${quoteId(schema, dialect)}.${quoteId(table, dialect)}`;
}
function csv(rows, columns) {
  const cell2 = (v) => '"' + (v == null ? "" : String(v)).replaceAll('"', '""') + '"';
  return "\uFEFF" + [columns.map(cell2).join(","), ...rows.map((r) => columns.map((c) => cell2(r[c])).join(","))].join("\r\n");
}

// src/shared/filters.ts
function valuePlaceholder(dialect, column, name) {
  if (dialect === "oracle") {
    if (column.type === "DATE") return `TO_DATE(:${name}, 'YYYY-MM-DD HH24:MI:SS')`;
    if (/^TIMESTAMP.*TIME ZONE/.test(column.type)) return `TO_TIMESTAMP_TZ(:${name}, 'YYYY-MM-DD HH24:MI:SS.FF TZH:TZM')`;
    if (/^TIMESTAMP/.test(column.type)) return `TO_TIMESTAMP(:${name}, 'YYYY-MM-DD HH24:MI:SS.FF')`;
  }
  return `:${name}`;
}
function tableSelect(def, dialect, filters = [], mode = "and", sort) {
  if (filters.length > 20 || !["and", "or"].includes(mode)) throw new Error("\u7B5B\u9009\u6761\u4EF6\u65E0\u6548");
  const values = {};
  const conditions = filters.map((f, i) => {
    const column = def.columns.find((c) => c.name === f.column);
    if (!column) throw new Error("\u7B5B\u9009\u5B57\u6BB5\u4E0D\u5B58\u5728");
    const q = quoteId(column.name, dialect), key = `f${i}`;
    if (f.op === "is null" || f.op === "is not null") return `${q} ${f.op.toUpperCase()}`;
    if (!["=", "<>", ">", "<", ">=", "<=", "contains"].includes(f.op)) throw new Error("\u7B5B\u9009\u64CD\u4F5C\u65E0\u6548");
    values[key] = f.op === "contains" ? "%" + f.value.replace(/[!%_]/g, (c) => "!" + c) + "%" : f.value;
    return `${q} ${f.op === "contains" ? "LIKE" : f.op} ${valuePlaceholder(dialect, column, key)}${f.op === "contains" ? " ESCAPE '!'" : ""}`;
  });
  if (sort && (!def.columns.some((c) => c.name === sort.column) || !["asc", "desc"].includes(sort.direction))) throw new Error("\u6392\u5E8F\u5B57\u6BB5\u6216\u65B9\u5411\u65E0\u6548");
  const order = sort ? `${quoteId(sort.column, dialect)} ${sort.direction}` : def.columns.filter((c) => c.primary).map((c) => quoteId(c.name, dialect)).join(", ");
  return { sql: `SELECT ${def.columns.map((c) => quoteId(c.name, dialect)).join(", ")} FROM ${qualified(def.schema, def.name, dialect)}${conditions.length ? " WHERE (" + conditions.join(mode === "or" ? " OR " : " AND ") + ")" : ""}${order ? " ORDER BY " + order : ""}`, values };
}

// src/shared/queryError.ts
function queryFailure(message, part, index, dialect) {
  const masked = maskSql(part.sql, dialect);
  const params = [...masked.matchAll(/(?<!:):([A-Za-z_][A-Za-z0-9_]*)/g)];
  const driverSql = params.reduceRight((s, m) => s.slice(0, m.index) + "?" + s.slice(m.index + m[0].length), part.sql);
  const oracle = /ORA-06550:\s*(?:line\s+(\d+),\s*column\s+(\d+)|第\s*(\d+)\s*行[,，]\s*第\s*(\d+)\s*列)/i.exec(message);
  const mysql2 = /\bat line (\d+)\s*$/i.exec(message);
  const line = Number(oracle?.[1] ?? oracle?.[3] ?? mysql2?.[1]), column = Number(oracle?.[2] ?? oracle?.[4]);
  const lines = driverSql.split("\n");
  if (!line || line > lines.length) return { statementIndex: index + 1, offset: part.start + Math.max(0, masked.search(/\S/)), precision: "statement" };
  let driverOffset = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
  if (column && column <= lines[line - 1].length + 1) driverOffset += column - 1;
  let offset = driverOffset, removed = 0;
  for (const param of params) {
    const bound = param.index - removed;
    if (driverOffset <= bound) break;
    offset += param[0].length - 1;
    removed += param[0].length - 1;
  }
  return { statementIndex: index + 1, offset: part.start + offset, precision: column && column <= lines[line - 1].length + 1 ? "column" : "line" };
}

// electron/worker.ts
var import_node_fs2 = __toESM(require("node:fs"));
var import_node_crypto2 = __toESM(require("node:crypto"));
var import_promise = __toESM(require("mysql2/promise"));

// src/shared/ddl.ts
var typePatterns = {
  mysql: /^(TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|FLOAT|DOUBLE|REAL|DECIMAL|NUMERIC|CHAR|VARCHAR|BINARY|VARBINARY|BIT|DATE|DATETIME|TIMESTAMP|TIME|YEAR|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB|JSON|BOOLEAN)(\s*\(\s*\d+\s*(,\s*\d+\s*)?\))?(\s+UNSIGNED)?$/i,
  oracle: /^(VARCHAR2|NVARCHAR2|CHAR|NCHAR|NUMBER|FLOAT|BINARY_FLOAT|BINARY_DOUBLE|INTEGER|INT|SMALLINT|DATE|TIMESTAMP|RAW|LONG RAW|LONG|CLOB|NCLOB|BLOB)(\s*\(\s*\d+\s*(,\s*[-+]?\d+\s*|\s+(BYTE|CHAR)\s*)?\))?(\s+WITH(\s+LOCAL)?\s+TIME\s+ZONE)?$/i
};
var literal = (v) => "'" + v.replaceAll("'", "''") + "'";
function validateTable(def, dialect) {
  const names = /* @__PURE__ */ new Set();
  if (!def.columns.length) throw new Error("\u81F3\u5C11\u9700\u8981\u4E00\u4E2A\u5B57\u6BB5");
  quoteId(def.schema, dialect);
  quoteId(def.name, dialect);
  if (dialect === "oracle" && Buffer.byteLength(def.name, "utf8") > 30) throw new Error("Oracle 11g \u5BF9\u8C61\u540D\u79F0\u4E0D\u5F97\u8D85\u8FC7 30 \u5B57\u8282");
  for (const c of def.columns) {
    quoteId(c.name, dialect);
    const key = dialect === "mysql" ? c.name.toLowerCase() : c.name;
    if (names.has(key)) throw new Error(`\u5B57\u6BB5\u91CD\u590D\uFF1A${c.name}`);
    names.add(key);
    if (!typePatterns[dialect].test(c.type.trim())) throw new Error(`\u4E0D\u652F\u6301\u7684\u5B57\u6BB5\u7C7B\u578B\uFF1A${c.type}`);
    if (c.primary && c.nullable) throw new Error(`\u4E3B\u952E\u5B57\u6BB5\u4E0D\u53EF\u4E3A\u7A7A\uFF1A${c.name}`);
    if (dialect === "oracle" && Buffer.byteLength(c.name, "utf8") > 30) throw new Error(`Oracle 11g \u5B57\u6BB5\u540D\u79F0\u8D85\u8FC7 30 \u5B57\u8282\uFF1A${c.name}`);
    if (c.defaultValue.trim()) {
      const masked = maskSql(c.defaultValue, dialect);
      if (/[;]/.test(masked) || /--|\/\*|#/.test(c.defaultValue.replace(/'(?:''|[^'])*'/g, ""))) throw new Error("\u9ED8\u8BA4\u503C\u53EA\u5141\u8BB8\u5355\u4E2A\u8868\u8FBE\u5F0F");
      let depth = 0;
      for (const x of masked) {
        if (x === "(") depth++;
        if (x === ")" && --depth < 0) throw new Error("\u9ED8\u8BA4\u503C\u62EC\u53F7\u4E0D\u5339\u914D");
      }
      if (depth) throw new Error("\u9ED8\u8BA4\u503C\u62EC\u53F7\u4E0D\u5339\u914D");
    }
  }
  const actualNames = new Set(def.columns.map((c) => c.name));
  const constraints = /* @__PURE__ */ new Set();
  for (const item of [...def.indexes, ...def.foreignKeys]) {
    quoteId(item.name, dialect);
    const key = item.name.toLowerCase();
    if (constraints.has(key)) throw new Error(`\u7D22\u5F15\u6216\u7EA6\u675F\u540D\u91CD\u590D\uFF1A${item.name}`);
    constraints.add(key);
    if (dialect === "oracle" && Buffer.byteLength(item.name, "utf8") > 30) throw new Error("Oracle 11g \u7EA6\u675F\u6216\u7D22\u5F15\u540D\u4E0D\u5F97\u8D85\u8FC7 30 \u5B57\u8282");
    if (!item.columns.length || item.columns.some((n) => !actualNames.has(n))) throw new Error(`\u7D22\u5F15\u6216\u7EA6\u675F\u5B57\u6BB5\u4E0D\u5B58\u5728\uFF1A${item.name}`);
  }
  for (const f of def.foreignKeys) {
    if (f.columns.length !== f.refColumns.length || !f.refTable || !f.refSchema) throw new Error(`\u5916\u952E\u5B9A\u4E49\u4E0D\u5B8C\u6574\uFF1A${f.name}`);
    f.refColumns.forEach((n) => quoteId(n, dialect));
    if (f.onDelete === "SET NULL" && f.columns.some((n) => !def.columns.find((c) => c.name === n)?.nullable)) throw new Error("SET NULL \u5916\u952E\u7684\u5B57\u6BB5\u5FC5\u987B\u5141\u8BB8\u7A7A\u503C");
  }
}
function col(c, d, altering = false) {
  return `${quoteId(c.name, d)} ${c.type.trim()}${c.defaultValue.trim() ? ` DEFAULT ${c.defaultValue.trim()}` : altering && d === "oracle" ? " DEFAULT NULL" : ""}${c.nullable ? " NULL" : " NOT NULL"}${d === "mysql" ? ` COMMENT ${literal(c.comment)}` : ""}`;
}
function tableFingerprint(t) {
  return JSON.stringify(t && { ...t, indexes: [...t.indexes].sort((a, b) => a.name.localeCompare(b.name)), foreignKeys: [...t.foreignKeys].sort((a, b) => a.name.localeCompare(b.name)) });
}
function buildDDL(before, after, dialect) {
  validateTable(after, dialect);
  const statements = [], warnings = [];
  const q = (n) => quoteId(n, dialect);
  const table = qualified(after.schema, after.name, dialect);
  const columns = (list) => list.map(q).join(", ");
  const fk = (f) => `CONSTRAINT ${q(f.name)} FOREIGN KEY (${columns(f.columns)}) REFERENCES ${qualified(f.refSchema, f.refTable, dialect)} (${columns(f.refColumns)})${f.onDelete === "NO ACTION" ? "" : ` ON DELETE ${f.onDelete}`}`;
  const pk = (t) => t.columns.filter((c) => c.primary).map((c) => c.name);
  if (before && (before.name !== after.name || before.schema !== after.schema)) throw new Error("\u9996\u7248\u6539\u8868\u4E0D\u652F\u6301\u91CD\u547D\u540D\u8868\u6216\u79FB\u52A8 Schema\uFF0C\u8BF7\u4F7F\u7528 SQL");
  if (!before) {
    const parts = after.columns.map((c) => col(c, dialect));
    if (pk(after).length) parts.push(`PRIMARY KEY (${columns(pk(after))})`);
    parts.push(...after.foreignKeys.map(fk));
    statements.push(`CREATE TABLE ${table} (
  ${parts.join(",\n  ")}
)${dialect === "mysql" ? ` ENGINE=InnoDB COMMENT=${literal(after.comment)}` : ""}`);
  } else {
    for (const f of before.foreignKeys) if (!after.foreignKeys.some((n) => JSON.stringify(n) === JSON.stringify(f))) statements.push(`ALTER TABLE ${table} DROP ${dialect === "mysql" ? "FOREIGN KEY" : "CONSTRAINT"} ${q(f.name)}`);
    for (const index of before.indexes) if (!after.indexes.some((n) => JSON.stringify(n) === JSON.stringify(index))) {
      if (dialect === "oracle" && index.constraintName) statements.push(`ALTER TABLE ${table} DROP CONSTRAINT ${q(index.constraintName)} KEEP INDEX`);
      statements.push(dialect === "mysql" ? `DROP INDEX ${q(index.name)} ON ${table}` : `DROP INDEX ${qualified(after.schema, index.name, dialect)}`);
    }
    if (JSON.stringify(pk(before)) !== JSON.stringify(pk(after)) && pk(before).length) statements.push(`ALTER TABLE ${table} DROP PRIMARY KEY`);
    for (const c of before.columns) if (!after.columns.some((n) => n.name === c.name)) {
      statements.push(`ALTER TABLE ${table} DROP COLUMN ${q(c.name)}`);
      warnings.push(`\u5220\u9664\u5B57\u6BB5 ${c.name} \u4F1A\u4E22\u5931\u8BE5\u5217\u5168\u90E8\u6570\u636E`);
    }
    for (const c of after.columns) {
      const old = before.columns.find((n) => n.name === c.name);
      if (!old) statements.push(`ALTER TABLE ${table} ADD ${dialect === "mysql" ? "COLUMN " : ""}${dialect === "oracle" ? "(" : ""}${col(c, dialect)}${dialect === "oracle" ? ")" : ""}`);
      else if (["type", "nullable", "defaultValue", ...dialect === "mysql" ? ["comment"] : []].some((k) => old[k] !== c[k])) {
        if (old.generated || c.generated) throw new Error(`\u751F\u6210\u5217 ${c.name} \u8BF7\u4F7F\u7528 SQL \u4FEE\u6539\uFF0C\u907F\u514D\u4E22\u5931\u751F\u6210\u8868\u8FBE\u5F0F`);
        statements.push(`ALTER TABLE ${table} MODIFY ${dialect === "mysql" ? "COLUMN " : "("}${col(c, dialect, true)}${dialect === "oracle" ? ")" : ""}`);
        if (old.type !== c.type || old.nullable && !c.nullable) warnings.push(`\u4FEE\u6539 ${c.name} \u7684\u7C7B\u578B\u6216\u975E\u7A7A\u7EA6\u675F\u53EF\u80FD\u5931\u8D25\u6216\u9020\u6210\u6570\u636E\u8F6C\u6362`);
      }
    }
    if (JSON.stringify(pk(before)) !== JSON.stringify(pk(after)) && pk(after).length) statements.push(`ALTER TABLE ${table} ADD PRIMARY KEY (${columns(pk(after))})`);
    for (const f of after.foreignKeys) if (!before.foreignKeys.some((n) => JSON.stringify(n) === JSON.stringify(f))) statements.push(`ALTER TABLE ${table} ADD ${fk(f)}`);
    if (dialect === "mysql" && before.comment !== after.comment) statements.push(`ALTER TABLE ${table} COMMENT=${literal(after.comment)}`);
  }
  for (const index of after.indexes) if (!before?.indexes.some((n) => JSON.stringify(n) === JSON.stringify(index))) {
    statements.push(`CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${dialect === "oracle" ? qualified(after.schema, index.name, dialect) : q(index.name)} ON ${table} (${columns(index.columns)})`);
    if (dialect === "oracle" && index.unique) statements.push(`ALTER TABLE ${table} ADD CONSTRAINT ${q(index.constraintName || index.name)} UNIQUE (${columns(index.columns)}) USING INDEX ${qualified(after.schema, index.name, dialect)}`);
  }
  if (dialect === "oracle") {
    if (!before || before.comment !== after.comment) statements.push(`COMMENT ON TABLE ${table} IS ${literal(after.comment)}`);
    for (const c of after.columns) if (!before && c.comment || before && before.columns.find((n) => n.name === c.name)?.comment !== c.comment) statements.push(`COMMENT ON COLUMN ${table}.${q(c.name)} IS ${literal(c.comment)}`);
  }
  if (statements.length) warnings.unshift("DDL \u53EF\u80FD\u9690\u5F0F\u63D0\u4EA4\uFF1B\u9010\u6761\u6267\u884C\uFF0C\u5DF2\u6210\u529F\u7684\u7ED3\u6784\u53D8\u66F4\u4E0D\u80FD\u6574\u4F53\u56DE\u6EDA\u3002");
  return { statements, warnings };
}

// electron/jdbc.ts
var import_node_child_process = require("node:child_process");
var import_node_path = __toESM(require("node:path"));
var import_node_fs = __toESM(require("node:fs"));
var import_node_crypto = __toESM(require("node:crypto"));
var import_node_readline = require("node:readline");
function jdbcBinds(sql, values) {
  const mask = maskSql(sql, "oracle");
  const binds = [];
  let last = 0, text = "";
  for (const match of mask.matchAll(/(?<!:):([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (!(match[1] in values)) throw new Error(`\u7F3A\u5C11\u53C2\u6570 :${match[1]}`);
    text += sql.slice(last, match.index) + "?";
    last = match.index + match[0].length;
    binds.push(values[match[1]]);
  }
  return { sql: text + sql.slice(last), binds };
}
var child;
var pending = /* @__PURE__ */ new Map();
function start() {
  if (child) return child;
  const root = process.env.QUERYDESK_JDBC_ROOT || import_node_path.default.resolve(__dirname, "../runtime");
  const java = import_node_path.default.join(root, "java/bin/java.exe");
  if (!import_node_fs.default.existsSync(java) || !import_node_fs.default.existsSync(import_node_path.default.join(root, "jdbc/querydesk-bridge.jar"))) throw new Error("\u5185\u7F6E JDBC \u8FD0\u884C\u73AF\u5883\u7F3A\u5931\uFF0C\u8BF7\u91CD\u65B0\u5B89\u88C5 QueryDesk");
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (["JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS", "CLASSPATH"].includes(key.toUpperCase())) delete env[key];
  const current = (0, import_node_child_process.spawn)(java, ["-Xms16m", "-Xmx256m", "-XX:+UseSerialGC", "-Dfile.encoding=UTF-8", "-cp", import_node_path.default.join(root, "jdbc/*"), "QueryDeskBridge", String(process.pid)], { windowsHide: true, stdio: "pipe", env });
  child = current;
  const fail = () => {
    if (child !== current) return;
    child = void 0;
    for (const p of pending.values()) p.reject(new Error("JDBC \u5DE5\u4F5C\u8FDB\u7A0B\u5DF2\u9000\u51FA\uFF0C\u8BF7\u5173\u95ED\u6807\u7B7E\u540E\u91CD\u65B0\u8FDE\u63A5\uFF1B\u5199\u64CD\u4F5C\u4E0D\u4F1A\u81EA\u52A8\u91CD\u8BD5"));
    pending.clear();
  };
  current.on("error", fail);
  current.on("exit", fail);
  current.stdin.on("error", fail);
  current.stderr.resume();
  (0, import_node_readline.createInterface)({ input: current.stdout }).on("line", (line) => {
    try {
      const response = JSON.parse(line);
      const p = pending.get(response.id);
      if (!p) return;
      pending.delete(response.id);
      response.ok ? p.resolve(response.value) : p.reject(new Error(response.error));
    } catch {
      fail();
      current.kill();
    }
  });
  return current;
}
function rpc(method, payload = {}) {
  const process2 = start();
  const id = import_node_crypto.default.randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    process2.stdin.write(JSON.stringify({ id, method, ...payload }) + "\n");
  });
}
function inspectJdbc() {
  return rpc("inspect");
}
async function openJdbc(options) {
  const info = await rpc("connect", options);
  const owner = child;
  const call = (method, payload = {}) => {
    if (!owner || child !== owner) return Promise.reject(new Error("JDBC \u4F1A\u8BDD\u5DF2\u5173\u95ED\uFF0C\u8BF7\u91CD\u65B0\u8FDE\u63A5"));
    return rpc(method, { session: info.session, ...payload });
  };
  return {
    oracleServerVersionString: info.version,
    async execute(sql, binds = {}, options2 = {}) {
      const result = await call("execute", { ...jdbcBinds(sql, binds), resultSet: !!options2.resultSet, autoCommit: !!options2.autoCommit });
      if (result.cursor) result.resultSet = { metaData: result.metaData, getRows: (count) => call("fetch", { cursor: result.cursor, count }), close: () => call("cursor.close", { cursor: result.cursor }) };
      return result;
    },
    commit: () => call("commit"),
    rollback: () => call("rollback"),
    close: () => call("close"),
    break: () => call("cancel")
  };
}

// src/shared/agent.ts
function readOnlySql(sql, dialect) {
  const parts = splitSql(sql, dialect);
  if (parts.length !== 1) throw new Error("\u81EA\u52A8\u67E5\u8BE2\u4E00\u6B21\u53EA\u80FD\u6267\u884C\u4E00\u6761 SELECT\uFF1B\u5199\u5165\u8BF7\u5148\u6253\u5F00 SQL \u8349\u7A3F");
  const statement = parts[0].sql, masked = maskSql(statement, dialect);
  if (!/^\s*(SELECT|WITH)\b/i.test(masked) || /\/\*(?:!|M!)/i.test(statement) || /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|CALL|EXECUTE|FUNCTION|PROCEDURE|INTO|OUTFILE|DUMPFILE|NEXTVAL|LOCK)\b|@|:=/i.test(masked)) throw new Error("\u6B64 SQL \u4E0D\u5C5E\u4E8E\u53EF\u81EA\u52A8\u6267\u884C\u7684\u53EA\u8BFB\u67E5\u8BE2\uFF0C\u8BF7\u5148\u6253\u5F00 SQL \u8349\u7A3F");
  const allowed = new Set("SELECT FROM WHERE AS IN EXISTS NOT AND OR ON OVER PARTITION VALUES COUNT SUM AVG MIN MAX ABS ROUND TRUNC CEIL CEILING FLOOR MOD POWER SQRT COALESCE NVL NVL2 NULLIF DECODE CAST CONVERT TO_CHAR TO_DATE TO_TIMESTAMP TO_NUMBER EXTRACT SUBSTR SUBSTRING LENGTH CHAR_LENGTH LOWER UPPER TRIM LTRIM RTRIM REPLACE CONCAT INSTR LPAD RPAD REGEXP_LIKE REGEXP_REPLACE REGEXP_SUBSTR DATE_FORMAT DATE_ADD DATE_SUB DATEDIFF TIMESTAMPDIFF NOW CURDATE CURRENT_DATE CURRENT_TIMESTAMP YEAR MONTH DAY LAST_DAY ADD_MONTHS MONTHS_BETWEEN ROW_NUMBER RANK DENSE_RANK LAG LEAD FIRST_VALUE LAST_VALUE LISTAGG GROUP_CONCAT IF IFNULL GREATEST LEAST JSON_VALUE JSON_EXTRACT".split(" "));
  for (const match of masked.matchAll(/([A-Za-z_][A-Za-z0-9_$#]*)\s*\(/g)) {
    if (!allowed.has(match[1].toUpperCase()) || /\.\s*$/.test(masked.slice(0, match.index))) throw new Error(`\u81EA\u52A8\u67E5\u8BE2\u4E0D\u8C03\u7528\u672A\u7ECF\u5141\u8BB8\u7684\u51FD\u6570\uFF1A${match[1]}\u3002\u8BF7\u5728 SQL \u8349\u7A3F\u4E2D\u68C0\u67E5\u540E\u8FD0\u884C`);
  }
  for (const match of statement.matchAll(/("(?:[^"]|"")*"|`(?:[^`]|``)*`)\s*\(/g)) {
    if (masked[match.index + match[0].lastIndexOf("(")] === "(") throw new Error("\u81EA\u52A8\u67E5\u8BE2\u4E0D\u8C03\u7528\u5E26\u5F15\u53F7\u7684\u51FD\u6570\uFF0C\u8BF7\u4F7F\u7528 SQL \u8349\u7A3F");
  }
  return statement;
}

// electron/worker.ts
var connectionSafety = require("./safety.cjs")({ maskSql, splitSql, readOnlySql });
var { metadata: queryColumnMetadata } = require("./column-metadata.cjs")({ raw, oracleType, mysqlTypes: import_promise.default.Types });
var BATCH = 200;
var LIMIT = 1e4;
var BYTE_LIMIT = 32 * 1024 * 1024;
var sessions = /* @__PURE__ */ new Map();
var queues = /* @__PURE__ */ new Map();
async function connect(profile) {
  let c;
  if (profile.dialect === "mysql") {
    c = await import_promise.default.createConnection({ host: profile.host, port: profile.port, user: profile.user, password: profile.password ?? "", database: profile.database || void 0, connectTimeout: 12e3, supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, dateStrings: true, multipleStatements: false, charset: "utf8mb4", ...profile.tls ? { ssl: { rejectUnauthorized: true, ...profile.caPath ? { ca: import_node_fs2.default.readFileSync(profile.caPath, "utf8") } : {} } } : {} });
    c.connection.on("error", () => {
    });
  } else {
    if (!profile.database || /[()=\s]/.test(profile.database)) throw new Error("\u8BF7\u8F93\u5165\u6709\u6548\u7684 Oracle Service Name \u6216 SID");
    const connectString = `(DESCRIPTION=(CONNECT_TIMEOUT=12)(TRANSPORT_CONNECT_TIMEOUT=8)(ADDRESS=(PROTOCOL=TCP)(HOST=${profile.host})(PORT=${profile.port}))(CONNECT_DATA=(${profile.oracleMode === "sid" ? "SID" : "SERVICE_NAME"}=${profile.database})))`;
    c = await openJdbc({ user: profile.user, password: profile.password ?? "", connectString });
    try {
      await c.execute(`ALTER SESSION SET NLS_DATE_FORMAT='YYYY-MM-DD HH24:MI:SS' NLS_TIMESTAMP_FORMAT='YYYY-MM-DD HH24:MI:SS.FF' NLS_TIMESTAMP_TZ_FORMAT='YYYY-MM-DD HH24:MI:SS.FF TZH:TZM' NLS_NUMERIC_CHARACTERS='.,'`);
    } catch (e) {
      await c.close();
      throw e;
    }
  }
  const s = { profile, connection: c, info: { readOnly: !!profile.readOnly, version: "", schema: profile.database, autoCommit: !profile.readOnly, dirty: false, needsRollback: false, connected: true }, cursors: /* @__PURE__ */ new Map(), busy: false, cancelled: false, cachedBytes: 0 };
  if (profile.dialect === "mysql") c.connection.on("error", () => {
    s.info.connected = false;
    s.info.needsRollback = !s.info.autoCommit;
  });
  try {
    if (profile.dialect === "mysql") {
      const rows = await raw(s, "SELECT VERSION() AS version, DATABASE() AS db");
      s.info.version = rows[0].version;
      s.info.schema = rows[0].db ?? "";
    } else {
      s.info.version = c.oracleServerVersionString;
      const rows = await raw(s, "SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AS SCHEMA_NAME FROM DUAL");
      s.info.schema = rows[0].SCHEMA_NAME;
    }
    return s;
  } catch (e) {
    await close(s);
    throw e;
  }
}
async function raw(s, sql, binds = {}) {
  const b = bindSql(sql, binds, s.profile.dialect);
  if (s.profile.dialect === "mysql") {
    const [rows] = b.binds.length ? await s.connection.execute(b.sql, b.binds) : await s.connection.query(b.sql);
    return rows;
  }
  const r = await s.connection.execute(b.sql, b.binds, {});
  return r.rows ?? [];
}
async function command(s, sql, binds = {}, autoCommit = false) {
  const b = bindSql(sql, binds, s.profile.dialect);
  if (s.profile.dialect === "mysql") {
    const [r2] = await s.connection.execute(b.sql, b.binds);
    return r2.affectedRows ?? 0;
  }
  const r = await s.connection.execute(b.sql, b.binds, { autoCommit });
  return r.rowsAffected ?? 0;
}
function cell(value) {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return `[\u4E8C\u8FDB\u5236 ${value.length} \u5B57\u8282]`;
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && typeof value.getData === "function") {
    void value.close?.().catch(() => {
    });
    return "[LOB\uFF1A\u8BF7\u4F7F\u7528 SQL \u622A\u53D6\u67E5\u770B]";
  }
  if (typeof value === "string" && value.length > 65536) return value.slice(0, 65536) + "[\u5185\u5BB9\u5DF2\u622A\u65AD]";
  if (typeof value === "object") return cell(JSON.stringify(value));
  return typeof value === "bigint" ? value.toString() : value;
}
function uniqueNames(names) {
  const used = /* @__PURE__ */ new Set();
  return names.map((name) => {
    let n = name, i = 2;
    while (used.has(n)) n = `${name}_${i++}`;
    used.add(n);
    return n;
  });
}
function toRows(names, rows) {
  return rows.map((row) => Object.fromEntries(names.map((n, i) => [n, cell(row[i])])));
}
function retain(s, row) {
  const bytes = Buffer.byteLength(JSON.stringify(row));
  if (s.cachedBytes + bytes > BYTE_LIMIT) return false;
  s.cachedBytes += bytes;
  return true;
}
async function closeCursors(s) {
  for (const c of s.cursors.values()) if (c.rs) await c.rs.close().catch(() => {
  });
  s.cursors.clear();
  s.cachedBytes = 0;
}
async function close(s) {
  await closeCursors(s);
  if (!s.info.autoCommit || s.info.dirty) await s.connection.rollback().catch(() => {
  });
  if (s.profile.dialect === "mysql") await s.connection.end().catch(() => {
  });
  else await s.connection.close().catch(() => {
  });
}
async function describe(s, schema, table) {
  if (s.profile.dialect === "mysql") {
    const base2 = await raw(s, "SELECT TABLE_COMMENT, TABLE_TYPE, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=:schema AND TABLE_NAME=:table", { schema, table });
    if (!base2.length) throw new Error("\u8868\u4E0D\u5B58\u5728\u6216\u6CA1\u6709\u8BBF\u95EE\u6743\u9650");
    const cols2 = await raw(s, "SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,COLUMN_COMMENT,COLUMN_KEY,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=:schema AND TABLE_NAME=:table ORDER BY ORDINAL_POSITION", { schema, table });
    const indexes2 = await raw(s, "SELECT INDEX_NAME,COLUMN_NAME,NON_UNIQUE,SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=:schema AND TABLE_NAME=:table AND INDEX_NAME <> 'PRIMARY' ORDER BY INDEX_NAME,SEQ_IN_INDEX", { schema, table });
    const foreign = await raw(s, `SELECT k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_SCHEMA,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=:schema AND k.TABLE_NAME=:table AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME,k.ORDINAL_POSITION`, { schema, table });
    const idx2 = /* @__PURE__ */ new Map(), fks2 = /* @__PURE__ */ new Map();
    for (const i of indexes2) {
      if (!i.COLUMN_NAME) continue;
      if (!idx2.has(i.INDEX_NAME)) idx2.set(i.INDEX_NAME, { name: i.INDEX_NAME, columns: [], unique: !Number(i.NON_UNIQUE) });
      idx2.get(i.INDEX_NAME).columns.push(i.COLUMN_NAME);
    }
    for (const f of foreign) {
      if (!fks2.has(f.CONSTRAINT_NAME)) fks2.set(f.CONSTRAINT_NAME, { name: f.CONSTRAINT_NAME, columns: [], refSchema: f.REFERENCED_TABLE_SCHEMA, refTable: f.REFERENCED_TABLE_NAME, refColumns: [], onDelete: ["CASCADE", "SET NULL"].includes(f.DELETE_RULE) ? f.DELETE_RULE : "NO ACTION" });
      const entry = fks2.get(f.CONSTRAINT_NAME);
      entry.columns.push(f.COLUMN_NAME);
      entry.refColumns.push(f.REFERENCED_COLUMN_NAME);
    }
    return { schema, name: table, comment: base2[0].TABLE_COMMENT || "", engine: base2[0].ENGINE || "", columns: cols2.map((c) => ({ name: c.COLUMN_NAME, type: c.COLUMN_TYPE, nullable: c.IS_NULLABLE === "YES", defaultValue: mysqlDefault(c.COLUMN_DEFAULT, c.COLUMN_TYPE, c.EXTRA), comment: c.COLUMN_COMMENT || "", primary: c.COLUMN_KEY === "PRI", generated: /auto_increment|VIRTUAL GENERATED|STORED GENERATED|on update/i.test(c.EXTRA) })), indexes: [...idx2.values()], foreignKeys: [...fks2.values()] };
  }
  const base = await raw(s, "SELECT COMMENTS FROM ALL_TAB_COMMENTS WHERE OWNER=:schema AND TABLE_NAME=:table", { schema, table });
  if (!base.length) throw new Error("\u8868\u4E0D\u5B58\u5728\u6216\u6CA1\u6709\u8BBF\u95EE\u6743\u9650");
  const cols = await raw(s, `SELECT c.COLUMN_NAME,c.DATA_TYPE,c.DATA_LENGTH,c.CHAR_LENGTH,c.CHAR_USED,c.DATA_PRECISION,c.DATA_SCALE,c.NULLABLE,c.DATA_DEFAULT,m.COMMENTS FROM ALL_TAB_COLUMNS c LEFT JOIN ALL_COL_COMMENTS m ON m.OWNER=c.OWNER AND m.TABLE_NAME=c.TABLE_NAME AND m.COLUMN_NAME=c.COLUMN_NAME WHERE c.OWNER=:schema AND c.TABLE_NAME=:table ORDER BY c.COLUMN_ID`, { schema, table });
  const constraints = await raw(s, `SELECT c.CONSTRAINT_NAME,c.CONSTRAINT_TYPE,k.COLUMN_NAME,k.POSITION,c.R_OWNER,c.R_CONSTRAINT_NAME,c.DELETE_RULE FROM ALL_CONSTRAINTS c JOIN ALL_CONS_COLUMNS k ON k.OWNER=c.OWNER AND k.CONSTRAINT_NAME=c.CONSTRAINT_NAME WHERE c.OWNER=:schema AND c.TABLE_NAME=:table AND c.CONSTRAINT_TYPE IN ('P','R') ORDER BY c.CONSTRAINT_NAME,k.POSITION`, { schema, table });
  const indexes = await raw(s, `SELECT i.INDEX_NAME,i.UNIQUENESS,k.COLUMN_NAME,k.COLUMN_POSITION,(SELECT MAX(u.CONSTRAINT_NAME) FROM ALL_CONSTRAINTS u WHERE u.OWNER=i.OWNER AND u.INDEX_NAME=i.INDEX_NAME AND u.CONSTRAINT_TYPE='U') AS CONSTRAINT_NAME FROM ALL_INDEXES i JOIN ALL_IND_COLUMNS k ON k.INDEX_OWNER=i.OWNER AND k.INDEX_NAME=i.INDEX_NAME WHERE i.TABLE_OWNER=:schema AND i.TABLE_NAME=:table AND i.INDEX_TYPE='NORMAL' AND NOT EXISTS (SELECT 1 FROM ALL_CONSTRAINTS c WHERE c.OWNER=i.OWNER AND c.INDEX_NAME=i.INDEX_NAME AND c.CONSTRAINT_TYPE='P') ORDER BY i.INDEX_NAME,k.COLUMN_POSITION`, { schema, table });
  const primary = new Set(constraints.filter((c) => c.CONSTRAINT_TYPE === "P").map((c) => c.COLUMN_NAME));
  const idx = /* @__PURE__ */ new Map(), fks = /* @__PURE__ */ new Map();
  for (const i of indexes) {
    if (!idx.has(i.INDEX_NAME)) idx.set(i.INDEX_NAME, { name: i.INDEX_NAME, columns: [], unique: i.UNIQUENESS === "UNIQUE", ...i.CONSTRAINT_NAME ? { constraintName: i.CONSTRAINT_NAME } : {} });
    idx.get(i.INDEX_NAME).columns.push(i.COLUMN_NAME);
  }
  for (const f of constraints.filter((c) => c.CONSTRAINT_TYPE === "R")) {
    if (!fks.has(f.CONSTRAINT_NAME)) {
      const referenced = await raw(s, "SELECT TABLE_NAME,COLUMN_NAME FROM ALL_CONS_COLUMNS WHERE OWNER=:owner AND CONSTRAINT_NAME=:name ORDER BY POSITION", { owner: f.R_OWNER, name: f.R_CONSTRAINT_NAME });
      fks.set(f.CONSTRAINT_NAME, { name: f.CONSTRAINT_NAME, columns: [], refSchema: f.R_OWNER, refTable: referenced[0]?.TABLE_NAME ?? "", refColumns: referenced.map((r) => r.COLUMN_NAME), onDelete: f.DELETE_RULE });
    }
    fks.get(f.CONSTRAINT_NAME).columns.push(f.COLUMN_NAME);
  }
  return { schema, name: table, comment: base[0].COMMENTS || "", columns: cols.map((c) => ({ name: c.COLUMN_NAME, type: oracleType(c), nullable: c.NULLABLE === "Y", defaultValue: (c.DATA_DEFAULT || "").trim(), comment: c.COMMENTS || "", primary: primary.has(c.COLUMN_NAME) })), indexes: [...idx.values()], foreignKeys: [...fks.values()] };
}
function mysqlDefault(value, type, extra) {
  if (value == null) return "";
  if (/^CURRENT_TIMESTAMP(?:\(\d*\))?$/i.test(value) || /DEFAULT_GENERATED/i.test(extra) || /^(tinyint|smallint|mediumint|int|bigint|decimal|float|double|bit)/i.test(type)) return String(value);
  return "'" + String(value).replaceAll("'", "''") + "'";
}
function oracleType(c) {
  if (["VARCHAR2", "NVARCHAR2", "CHAR", "NCHAR"].includes(c.DATA_TYPE)) return `${c.DATA_TYPE}(${c.CHAR_USED === "C" ? c.CHAR_LENGTH : c.DATA_LENGTH}${["NVARCHAR2", "NCHAR"].includes(c.DATA_TYPE) ? "" : c.CHAR_USED === "C" ? " CHAR" : " BYTE"})`;
  if (c.DATA_TYPE === "NUMBER" && c.DATA_PRECISION) return `NUMBER(${c.DATA_PRECISION}${c.DATA_SCALE == null ? "" : "," + c.DATA_SCALE})`;
  if (c.DATA_TYPE === "RAW") return `RAW(${c.DATA_LENGTH})`;
  return c.DATA_TYPE;
}
async function schemas(s) {
  if (s.profile.dialect === "mysql") return (await raw(s, "SHOW DATABASES")).map((r) => r.Database);
  return (await raw(s, "SELECT USERNAME FROM ALL_USERS ORDER BY USERNAME")).map((r) => r.USERNAME);
}
async function objects(s, schema) {
  if (s.profile.dialect === "mysql") {
    const tables = await raw(s, "SELECT TABLE_NAME,TABLE_TYPE,TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA=:schema ORDER BY TABLE_NAME", { schema });
    const routines = await raw(s, "SELECT ROUTINE_NAME,ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=:schema ORDER BY ROUTINE_NAME", { schema });
    const triggers = await raw(s, "SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=:schema ORDER BY TRIGGER_NAME", { schema });
    return [...tables.map((r) => ({ name: r.TABLE_NAME, schema, comment: r.TABLE_COMMENT ?? "", kind: r.TABLE_TYPE === "VIEW" ? "view" : "table" })), ...routines.map((r) => ({ name: r.ROUTINE_NAME, schema, kind: r.ROUTINE_TYPE.toLowerCase() })), ...triggers.map((r) => ({ name: r.TRIGGER_NAME, schema, kind: "trigger" }))];
  }
  const rows = await raw(s, "SELECT o.OBJECT_NAME,o.OBJECT_TYPE,c.COMMENTS FROM ALL_OBJECTS o LEFT JOIN ALL_TAB_COMMENTS c ON c.OWNER=o.OWNER AND c.TABLE_NAME=o.OBJECT_NAME AND c.TABLE_TYPE=o.OBJECT_TYPE WHERE o.OWNER=:schema AND o.OBJECT_TYPE IN ('TABLE','VIEW','PROCEDURE','FUNCTION','PACKAGE','TRIGGER','SEQUENCE') ORDER BY o.OBJECT_TYPE,o.OBJECT_NAME", { schema });
  return rows.map((r) => ({ name: r.OBJECT_NAME, schema, comment: r.COMMENTS ?? "", kind: r.OBJECT_TYPE.toLowerCase() }));
}
async function source(s, schema, table, kind) {
  if (s.profile.dialect === "mysql") {
    const rows = await raw(s, `SHOW CREATE ${kind.toUpperCase()} ${qualified(schema, table, "mysql")}`);
    return Object.entries(rows[0] ?? {}).filter(([k]) => /create|statement/i.test(k)).map(([, v]) => v).join("\n");
  }
  if (kind === "view") return (await raw(s, "SELECT TEXT FROM ALL_VIEWS WHERE OWNER=:schema AND VIEW_NAME=:table", { schema, table }))[0]?.TEXT ?? "";
  if (kind === "sequence") return JSON.stringify(await raw(s, "SELECT * FROM ALL_SEQUENCES WHERE SEQUENCE_OWNER=:schema AND SEQUENCE_NAME=:table", { schema, table }), null, 2);
  return (await raw(s, "SELECT TEXT FROM ALL_SOURCE WHERE OWNER=:schema AND NAME=:table ORDER BY TYPE,LINE", { schema, table })).map((r) => r.TEXT).join("");
}
async function mysqlQuery(s, sql, binds, sourceSql = sql) {
  const started = Date.now();
  const groups = /* @__PURE__ */ new Map();
  await new Promise((resolve, reject) => {
    const query2 = binds.length ? s.connection.connection.execute({ sql, values: binds, rowsAsArray: true }) : s.connection.connection.query({ sql, rowsAsArray: true });
    query2.on("fields", (fields, index = 0) => groups.set(index, { names: uniqueNames((fields ?? []).map((f) => f.name)), fields: fields ?? [], rows: [], affected: 0, truncated: false }));
    query2.on("result", (row, index = 0) => {
      let group = groups.get(index);
      if (!group) {
        group = { names: [], rows: [], affected: 0, truncated: false };
        groups.set(index, group);
      }
      if (Array.isArray(row)) {
        if (group.rows.length < LIMIT && !group.truncated) {
          const mapped = toRows(group.names, [row])[0];
          if (retain(s, mapped)) group.rows.push(mapped);
          else group.truncated = true;
        } else group.truncated = true;
      } else group.affected += row.affectedRows ?? 0;
    });
    query2.on("error", reject);
    query2.on("end", resolve);
  });
  const results = [];
  for (const group of groups.values()) {
    const rows = group.rows.splice(0, BATCH);
    const result = { id: import_node_crypto2.default.randomUUID(), sql: sourceSql, schema: s.info.schema, columns: group.names, columnMetadata: await queryColumnMetadata(s, sourceSql, group.names, group.fields), rows, affected: group.affected, elapsed: Date.now() - started, hasMore: group.rows.length > 0, truncated: group.truncated };
    s.cursors.set(result.id, { result: { ...result, rows: [] }, cached: group.rows, offset: rows.length });
    results.push(result);
  }
  return results;
}
async function query(s, sql, params) {
  if (!s.info.connected) throw new Error("\u8FDE\u63A5\u5DF2\u65AD\u5F00\uFF0C\u8BF7\u5173\u95ED\u6807\u7B7E\u540E\u91CD\u65B0\u8FDE\u63A5\uFF1B\u5199\u64CD\u4F5C\u4E0D\u4F1A\u81EA\u52A8\u91CD\u653E\u3002");
  if (s.info.needsRollback) throw new Error("\u4F1A\u8BDD\u9700\u8981\u56DE\u6EDA\u3002\u8BF7\u5148\u56DE\u6EDA\u6216\u91CD\u65B0\u8FDE\u63A5\u3002");
  if (s.profile.readOnly) connectionSafety.assertProfileReadOnly(sql, s.profile.dialect);
  else if (s.info.readOnly) readOnlySql(sql, s.profile.dialect);
  await closeCursors(s);
  if (s.info.readOnly) await beginReadOnly(s);
  const statements = splitSql(sql, s.profile.dialect);
  if (!statements.length) throw new Error("\u6CA1\u6709\u53EF\u6267\u884C\u7684 SQL");
  if (statements.length > 50) throw new Error("\u6BCF\u6B21\u6700\u591A\u6267\u884C 50 \u6761\u8BED\u53E5");
  const results = [];
  let error, failure;
  for (const [statementIndex, statement] of statements.entries()) {
    const started = Date.now();
    try {
      if (s.cancelled) throw new Error("\u67E5\u8BE2\u5DF2\u53D6\u6D88");
      const text = statement.sql;
      const kind = sqlKind(text, s.profile.dialect);
      const unquoted = maskSql(text, s.profile.dialect).trim();
      if (/^(COMMIT|ROLLBACK)\s*;?\s*$/i.test(unquoted)) {
        await transaction(s, /^COMMIT/i.test(unquoted) ? "commit" : "rollback");
        results.push({ id: import_node_crypto2.default.randomUUID(), sql: text, schema: s.info.schema, columns: [], rows: [], affected: 0, elapsed: Date.now() - started, hasMore: false, truncated: false });
        continue;
      }
      if (/^(START\s+TRANSACTION|BEGIN)\s*;?\s*$/i.test(unquoted)) {
        await transaction(s, "auto", false);
        continue;
      }
      if (/\bAUTOCOMMIT\b/i.test(text) && kind === "control") throw new Error("\u8BF7\u901A\u8FC7\u5DE5\u5177\u680F\u5207\u6362\u81EA\u52A8\u63D0\u4EA4\uFF0C\u786E\u4FDD\u5BA2\u6237\u7AEF\u4E8B\u52A1\u72B6\u6001\u540C\u6B65");
      if (kind === "ddl" && !s.info.autoCommit) throw new Error("DDL \u4F1A\u9690\u5F0F\u63D0\u4EA4\uFF0C\u8BF7\u5148\u5904\u7406\u5F53\u524D\u4E8B\u52A1\u5E76\u5207\u6362\u81EA\u52A8\u63D0\u4EA4\uFF0C\u6216\u4F7F\u7528\u7ED3\u6784\u8BBE\u8BA1\u5668");
      if ((kind === "write" || kind === "control") && !s.info.autoCommit && !s.info.readOnly) s.info.dirty = true;
      const b = bindSql(text, params, s.profile.dialect);
      if (s.profile.dialect === "mysql") results.push(...await mysqlQuery(s, b.sql, b.binds, text));
      else {
        const r = await s.connection.execute(b.sql, b.binds, { resultSet: true, autoCommit: s.info.autoCommit });
        const sets = [r.resultSet, ...r.implicitResults ?? []].filter(Boolean);
        if (!sets.length) results.push({ id: import_node_crypto2.default.randomUUID(), sql: text, schema: s.info.schema, columns: [], rows: [], affected: r.rowsAffected ?? 0, elapsed: Date.now() - started, hasMore: false, truncated: false });
        for (const rs of sets) {
          const names = uniqueNames(rs.metaData.map((m) => m.name));
          const fetched = toRows(names, await rs.getRows(BATCH));
          const rows = [];
          for (const row of fetched) {
            if (!retain(s, row)) break;
            rows.push(row);
          }
          const truncated = rows.length < fetched.length;
          const result = { id: import_node_crypto2.default.randomUUID(), sql: text, schema: s.info.schema, columns: names, columnMetadata: await queryColumnMetadata(s, text, names, rs.metaData), rows, affected: r.rowsAffected ?? 0, elapsed: Date.now() - started, hasMore: !truncated && rows.length === BATCH, truncated };
          s.cursors.set(result.id, { result: { ...result, rows: [] }, rs, offset: rows.length });
          if (!result.hasMore) {
            await rs.close();
            s.cursors.get(result.id).rs = void 0;
          }
          results.push(result);
        }
      }
      if (/^(USE\b|ALTER\s+SESSION\b)/i.test(unquoted)) {
        const rows = await raw(s, s.profile.dialect === "mysql" ? "SELECT DATABASE() AS CURRENT_SCHEMA" : "SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AS CURRENT_SCHEMA FROM DUAL");
        s.info.schema = rows[0].CURRENT_SCHEMA ?? s.info.schema;
      }
    } catch (e) {
      if (isDisconnected(e)) s.info.connected = false;
      if (!s.info.autoCommit) s.info.needsRollback = true;
      error = `\u7B2C ${statementIndex + 1} \u6761\u8BED\u53E5\u5931\u8D25\uFF1A${e.message}`;
      const start2 = statement.start + sql.slice(statement.start, statement.end).search(/\S/);
      failure = queryFailure(e.message, { ...statement, start: start2 }, statementIndex, s.profile.dialect);
      break;
    }
  }
  return { results, error, failure, state: { ...s.info } };
}
async function fetchMore(s, id) {
  const cursor = s.cursors.get(id);
  if (!cursor) throw new Error("\u7ED3\u679C\u5DF2\u91CA\u653E\uFF0C\u8BF7\u91CD\u65B0\u6267\u884C\u67E5\u8BE2");
  const result = { ...cursor.result, rows: [] };
  if (cursor.cached) {
    result.rows = cursor.cached.splice(0, BATCH);
    cursor.offset += result.rows.length;
    result.hasMore = cursor.cached.length > 0;
  } else if (cursor.rs) {
    const fetched = toRows(result.columns, await cursor.rs.getRows(Math.min(BATCH, LIMIT - cursor.offset)));
    for (const row of fetched) {
      if (!retain(s, row)) break;
      result.rows.push(row);
    }
    cursor.offset += result.rows.length;
    result.truncated = result.rows.length < fetched.length;
    result.hasMore = !result.truncated && result.rows.length === BATCH && cursor.offset < LIMIT;
    if (cursor.offset >= LIMIT) result.truncated = (await cursor.rs.getRows(1)).length > 0;
    if (!result.hasMore) {
      await cursor.rs.close();
      cursor.rs = void 0;
    }
  } else result.hasMore = false;
  cursor.result = { ...result, rows: [] };
  return result;
}
async function transaction(s, action, value) {
  if (s.info.readOnly && action === "auto" && value === false) return { ...s.info };
  if (s.info.readOnly && action === "auto") throw new Error("当前会话为只读，不能切换自动提交；连接只读设置需关闭全部标签后修改");
  if (action === "auto") {
    if (s.info.dirty || s.info.needsRollback) throw new Error("\u8BF7\u5148\u63D0\u4EA4\u6216\u56DE\u6EDA\uFF0C\u518D\u5207\u6362\u81EA\u52A8\u63D0\u4EA4");
    if (s.profile.dialect === "mysql") await s.connection.query(`SET autocommit=${value ? 1 : 0}`);
    s.info.autoCommit = !!value;
  } else {
    if (action === "commit" && s.info.needsRollback) throw new Error("\u5F53\u524D\u4F1A\u8BDD\u72B6\u6001\u4E0D\u786E\u5B9A\uFF0C\u53EA\u80FD\u56DE\u6EDA\u6216\u91CD\u65B0\u8FDE\u63A5");
    if (action === "commit") await s.connection.commit();
    else await s.connection.rollback();
    s.info.dirty = false;
    s.info.needsRollback = false;
  }
  return { ...s.info };
}
async function cancel(s) {
  s.cancelled = true;
  if (!s.busy) return { ...s.info };
  if (!s.info.autoCommit) s.info.needsRollback = true;
  if (s.profile.dialect === "oracle") await s.connection.break();
  else {
    const control = await connect(s.profile);
    try {
      const threadId = Number(s.connection.threadId);
      if (!Number.isSafeInteger(threadId)) throw new Error("\u65E0\u6548\u4F1A\u8BDD\u7F16\u53F7");
      await control.connection.query(`KILL QUERY ${threadId}`);
    } finally {
      await close(control);
    }
  }
  return { ...s.info };
}
function valueBind(s, column, name) {
  return valuePlaceholder(s.profile.dialect, column, name);
}
async function browse(s, p) {
  if (s.info.readOnly) await beginReadOnly(s);
  const def = await describe(s, p.schema, p.table);
  const filter = tableSelect(def, s.profile.dialect, p.filters, p.filterMode, p.sort);
  const offset = p.page * BATCH, select = filter.sql;
  let sql;
  if (s.profile.dialect === "mysql") sql = `${select} LIMIT ${BATCH + 1} OFFSET ${offset}`;
  else sql = `SELECT * FROM (SELECT qd_inner.*, ROWNUM AS "__QD_PAGE_ROW__" FROM (${select}) qd_inner WHERE ROWNUM <= ${offset + BATCH + 1}) WHERE "__QD_PAGE_ROW__" > ${offset}`;
  const rows = await raw(s, sql, filter.values);
  const columns = def.columns.map((c) => c.name);
  const normalized = rows.slice(0, BATCH).map((r) => Object.fromEntries(columns.map((c) => [c, cell(r[c])])));
  const object = (await objects(s, p.schema)).find((o) => o.name === p.table);
  const transactional = s.profile.dialect !== "mysql" || def.engine?.toUpperCase() === "INNODB";
  const unsupported = def.columns.some((c) => /BLOB|CLOB|BINARY|RAW|LONG|JSON|TEXT|XML|GEOMETRY/i.test(c.type));
  return { def, rows: normalized, hasMore: rows.length > BATCH, editable: !s.info.readOnly && transactional && object?.kind === "table" && def.columns.some((c) => c.primary) && !unsupported, reason: s.info.readOnly ? "当前连接或会话为只读，不能编辑数据" : !transactional ? "\u6B64\u8868\u4E0D\u662F InnoDB\uFF0C\u9996\u7248\u4EC5\u63D0\u4F9B\u53EA\u8BFB\u6D4F\u89C8\uFF0C\u907F\u514D\u65E0\u6CD5\u56DE\u6EDA\u7684\u4FEE\u6539" : unsupported ? "\u542B\u5927\u5B57\u6BB5\u3001\u4E8C\u8FDB\u5236\u6216\u590D\u6742\u7C7B\u578B\uFF0C\u9996\u7248\u8BF7\u4F7F\u7528 SQL \u4FEE\u6539" : !def.columns.some((c) => c.primary) ? "\u6CA1\u6709\u4E3B\u952E\uFF0C\u7ED3\u679C\u53EA\u8BFB" : object?.kind !== "table" ? "\u89C6\u56FE\u53EA\u8BFB" : "" };
}
async function applyChanges(s, p) {
  if (s.info.needsRollback) throw new Error("\u8BF7\u5148\u56DE\u6EDA\u5F53\u524D\u4E8B\u52A1");
  const def = await describe(s, p.schema, p.table);
  const object = (await objects(s, p.schema)).find((o) => o.name === p.table);
  if (object?.kind !== "table" || !def.columns.some((c) => c.primary)) throw new Error("\u4EC5\u652F\u6301\u6709\u4E3B\u952E\u7684\u666E\u901A\u5355\u8868");
  if (def.columns.some((c) => /BLOB|CLOB|BINARY|RAW|LONG|JSON|TEXT|XML|GEOMETRY/i.test(c.type))) throw new Error("\u542B\u5927\u5B57\u6BB5\u6216\u590D\u6742\u7C7B\u578B\uFF0C\u8BF7\u4F7F\u7528 SQL \u4FEE\u6539");
  if (s.profile.dialect === "mysql" && def.engine?.toUpperCase() !== "INNODB") throw new Error("\u4EC5\u652F\u6301 InnoDB \u8868\u7684\u4E8B\u52A1\u7F16\u8F91");
  const tableName = qualified(p.schema, p.table, s.profile.dialect), q = (n) => quoteId(n, s.profile.dialect);
  const wasDirty = s.info.dirty;
  if (s.info.autoCommit && s.profile.dialect === "mysql") await s.connection.beginTransaction();
  else await command(s, "SAVEPOINT QD_GRID_EDIT");
  let affected = 0;
  try {
    for (const change of p.changes) {
      const values = {};
      let counter = 0;
      const bind = (column, value) => {
        const name = `v${counter++}`;
        values[name] = value;
        return valueBind(s, column, name);
      };
      for (const key of Object.keys(change.values)) if (!def.columns.some((c) => c.name === key)) throw new Error(`\u5B57\u6BB5\u4E0D\u5B58\u5728\uFF1A${key}`);
      let sql;
      if (change.kind === "insert") {
        const fields = def.columns.filter((c) => c.name in change.values && !c.generated);
        if (!fields.length) throw new Error("\u65B0\u589E\u884C\u81F3\u5C11\u9700\u8981\u4E00\u4E2A\u5B57\u6BB5\u503C");
        sql = `INSERT INTO ${tableName} (${fields.map((c) => q(c.name)).join(", ")}) VALUES (${fields.map((c) => bind(c, change.values[c.name])).join(", ")})`;
      } else {
        if (!change.original || def.columns.some((c) => !(c.name in change.original))) throw new Error("\u7F3A\u5C11\u5B8C\u6574\u539F\u59CB\u884C\uFF0C\u65E0\u6CD5\u68C0\u6D4B\u5E76\u53D1\u4FEE\u6539");
        if (Object.values(change.original).some((v) => typeof v === "string" && v.endsWith("[\u5185\u5BB9\u5DF2\u622A\u65AD]"))) throw new Error("\u539F\u59CB\u503C\u88AB\u622A\u65AD\uFF0C\u8BF7\u4F7F\u7528 SQL \u4FEE\u6539");
        const where = def.columns.map((c) => {
          const value = change.original[c.name];
          return value === null ? `${q(c.name)} IS NULL` : s.profile.dialect === "mysql" && /CHAR|TEXT|ENUM|SET/i.test(c.type) ? `BINARY ${q(c.name)} = BINARY ${bind(c, value)}` : `${q(c.name)} = ${bind(c, value)}`;
        }).join(" AND ");
        if (change.kind === "delete") sql = `DELETE FROM ${tableName} WHERE ${where}`;
        else {
          const changed = def.columns.filter((c) => c.name in change.values && change.values[c.name] !== change.original[c.name]);
          if (!changed.length) continue;
          if (changed.some((c) => c.generated)) throw new Error("\u751F\u6210\u5217\u4E0D\u53EF\u76F4\u63A5\u4FEE\u6539");
          sql = `UPDATE ${tableName} SET ${changed.map((c) => `${q(c.name)} = ${bind(c, change.values[c.name])}`).join(", ")} WHERE ${where}`;
        }
      }
      const count = await command(s, sql, values);
      if (count !== 1) throw new Error("\u6570\u636E\u5DF2\u88AB\u5176\u4ED6\u4F1A\u8BDD\u4FEE\u6539\u6216\u5220\u9664\uFF0C\u672C\u6279\u53D8\u66F4\u672A\u63D0\u4EA4\u3002\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002");
      affected += count;
    }
    if (s.info.autoCommit) await s.connection.commit();
    else s.info.dirty = true;
    return { affected, state: { ...s.info } };
  } catch (e) {
    try {
      if (s.info.autoCommit) await s.connection.rollback();
      else await command(s, s.profile.dialect === "mysql" ? "ROLLBACK TO SAVEPOINT QD_GRID_EDIT" : "ROLLBACK TO QD_GRID_EDIT");
      s.info.dirty = wasDirty;
    } catch {
      s.info.needsRollback = true;
    }
    throw e;
  }
}
async function ddl(s, p) {
  const isolated = await connect(s.profile);
  try {
    let current = null;
    const exists = (await objects(isolated, p.after.schema)).some((o) => o.name === p.after.name);
    if (exists) current = await describe(isolated, p.after.schema, p.after.name);
    if (tableFingerprint(current) !== p.fingerprint) throw new Error("\u8868\u7ED3\u6784\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u7ED3\u6784\u5E76\u91CD\u65B0\u9884\u89C8");
    const plan = buildDDL(current, p.after, s.profile.dialect);
    const results = [];
    for (const sql of plan.statements) {
      try {
        await command(isolated, sql, {}, true);
        results.push({ sql, ok: true });
      } catch (e) {
        results.push({ sql, ok: false, error: e.message });
        break;
      }
    }
    return results;
  } finally {
    await close(isolated);
  }
}
async function beginReadOnly(s) {
  await s.connection.rollback();
  if (s.profile.dialect === "mysql") {
    await s.connection.query("SET TRANSACTION READ ONLY");
    await s.connection.query("START TRANSACTION");
  } else await command(s, "SET TRANSACTION READ ONLY");
  s.info.autoCommit = false;
  s.info.dirty = false;
  s.info.needsRollback = false;
}
async function findTables(s, schema, search) {
  const term = "%" + search.toLowerCase().replace(/[!%_]/g, (c) => "!" + c) + "%";
  const rows = await raw(s, s.profile.dialect === "mysql" ? "SELECT TABLE_NAME AS NAME, TABLE_COMMENT AS DESCRIPTION FROM information_schema.TABLES WHERE TABLE_SCHEMA=:schema AND (LOWER(TABLE_NAME) LIKE :term ESCAPE '!' OR LOWER(TABLE_COMMENT) LIKE :term ESCAPE '!') ORDER BY TABLE_NAME LIMIT 101" : "SELECT * FROM (SELECT TABLE_NAME AS NAME, COMMENTS AS DESCRIPTION FROM ALL_TAB_COMMENTS WHERE OWNER=:schema AND TABLE_TYPE IN ('TABLE','VIEW') AND (LOWER(TABLE_NAME) LIKE :term ESCAPE '!' OR LOWER(COMMENTS) LIKE :term ESCAPE '!') ORDER BY TABLE_NAME) WHERE ROWNUM <= 101", { schema, term });
  return { tables: rows.slice(0, 100).map((r) => ({ name: r.NAME, comment: String(r.DESCRIPTION || "").slice(0, 500) })), hasMore: rows.length > 100 };
}
async function exportTable(s, p) {
  let sql, params = {};
  if (p.query) {
    sql = readOnlySql(p.query.sql, s.profile.dialect);
    params = p.query.params;
  } else {
    const object = (await objects(s, p.schema)).find((o) => o.name === p.table && ["table", "view"].includes(o.kind));
    if (!object) throw new Error("\u8868\u6216\u89C6\u56FE\u4E0D\u5B58\u5728\uFF0C\u8BF7\u5148\u67E5\u627E\u771F\u5B9E\u8868\u540D");
    if (p.filters?.length || p.sort) {
      const def = await describe(s, p.schema, p.table);
      const select = tableSelect(def, s.profile.dialect, p.filters, p.filterMode, p.sort);
      sql = select.sql;
      params = select.values;
    } else sql = `SELECT * FROM ${qualified(p.schema, p.table, s.profile.dialect)}`;
  }
  const bound = bindSql(sql, params, s.profile.dialect);
  await closeCursors(s);
  await beginReadOnly(s);
  const partial = p.filePath + "." + import_node_crypto2.default.randomUUID() + ".partial";
  let lastProgress = 0;
  const file = await import_node_fs2.default.promises.open(partial, "wx");
  let count = 0, warning = false, rs, stream;
  async function writeRows(names, rows) {
    if (s.cancelled) throw new Error("\u5BFC\u51FA\u5DF2\u53D6\u6D88");
    const mapped = toRows(names, rows);
    if (mapped.some((row) => Object.values(row).some((value) => typeof value === "string" && /\[LOB：|\[二进制 |\[复杂类型：|\[内容已截断\]/.test(value)))) warning = true;
    if (p.format === "csv") {
      const body = csv(mapped, names).slice(csv([], names).length + 2);
      if (body) await file.writeFile(body + "\r\n", "utf8");
    } else if (mapped.length) await file.writeFile((count ? ",\n" : "") + mapped.map((row) => JSON.stringify(row)).join(",\n"), "utf8");
    count += mapped.length;
    if (p.exportId && Date.now() - lastProgress > 300) {
      lastProgress = Date.now();
      port.postMessage({ exportProgress: { id: p.exportId, rows: count } });
    }
  }
  try {
    let names;
    if (s.profile.dialect === "oracle") {
      const result = await s.connection.execute(bound.sql, bound.binds, { resultSet: true, autoCommit: false });
      rs = result.resultSet;
      names = uniqueNames(rs.metaData.map((m) => m.name));
      await file.writeFile(p.format === "csv" ? csv([], names) + "\r\n" : "[\n", "utf8");
      while (true) {
        if (s.cancelled) throw new Error("\u5BFC\u51FA\u5DF2\u53D6\u6D88");
        const rows = await rs.getRows(BATCH);
        if (!rows.length) break;
        await writeRows(names, rows);
      }
    } else {
      const query2 = bound.binds.length ? s.connection.connection.execute({ sql: bound.sql, values: bound.binds, rowsAsArray: true }) : s.connection.connection.query({ sql: bound.sql, rowsAsArray: true });
      let namesReady = false;
      query2.on("fields", (fields) => {
        names = uniqueNames(fields.map((f) => f.name));
        namesReady = true;
      });
      stream = query2.stream({ highWaterMark: BATCH });
      let batch = [], header = false;
      for await (const row of stream) {
        if (!header) {
          await file.writeFile(p.format === "csv" ? csv([], names) + "\r\n" : "[\n", "utf8");
          header = true;
        }
        batch.push(row);
        if (batch.length === BATCH) {
          await writeRows(names, batch);
          batch = [];
        }
      }
      if (!header) {
        if (!namesReady) throw new Error("\u6570\u636E\u5E93\u672A\u8FD4\u56DE\u5B57\u6BB5\u4FE1\u606F");
        await file.writeFile(p.format === "csv" ? csv([], names) + "\r\n" : "[\n", "utf8");
      }
      if (batch.length) await writeRows(names, batch);
    }
    if (s.cancelled) throw new Error("\u5BFC\u51FA\u5DF2\u53D6\u6D88");
    if (p.format === "json") await file.writeFile("\n]\n", "utf8");
    await file.close();
    await import_node_fs2.default.promises.rename(partial, p.filePath);
    return { rows: count, warnings: warning ? ["\u5927\u5B57\u6BB5\u6216\u590D\u6742\u7C7B\u578B\u4F7F\u7528\u5360\u4F4D\u6587\u672C\uFF0C\u8D85\u957F\u5B57\u7B26\u503C\u53EF\u80FD\u622A\u65AD\uFF1B\u9700\u8981\u539F\u59CB\u5927\u5B57\u6BB5\u65F6\u8BF7\u5148\u7528 SQL \u8F6C\u6362\u3002"] : [] };
  } catch (e) {
    await file.close().catch(() => {
    });
    await import_node_fs2.default.promises.unlink(partial).catch(() => {
    });
    throw e;
  } finally {
    if (rs) await rs.close().catch(() => {
    });
    stream?.destroy();
    await s.connection.rollback().catch(() => {
    });
  }
}
async function handle(method, p) {
  if (method === "client.inspect") return inspectJdbc();
  if (method === "connection.test") {
    const s2 = await connect(p);
    try {
      return s2.info;
    } finally {
      await close(s2);
    }
  }
  if (method === "session.open") {
    if (sessions.has(p.sessionId)) throw new Error("\u4F1A\u8BDD\u91CD\u590D");
    const s2 = await connect(p.profile);
    if (p.readOnly || p.profile.readOnly) {
      s2.info.readOnly = true;
      s2.info.autoCommit = false;
    }
    sessions.set(p.sessionId, s2);
    return s2.info;
  }
  if (method === "session.reconnect") {
    const old = sessions.get(p.sessionId);
    if (old?.busy) throw new Error("\u8BF7\u5148\u505C\u6B62\u5F53\u524D\u64CD\u4F5C\u5E76\u7B49\u5F85\u7ED3\u675F");
    if (old && (old.info.dirty || old.info.needsRollback) && !p.allowDiscard) throw new Error("\u5F53\u524D\u4E8B\u52A1\u5C1A\u672A\u5904\u7406\uFF0C\u8BF7\u786E\u8BA4\u653E\u5F03\u540E\u518D\u91CD\u8FDE");
    const readOnly = p.profile.readOnly || old?.info.readOnly || p.readOnly;
    if (old) {
      await close(old);
      sessions.delete(p.sessionId);
    }
    const fresh = await connect(p.profile);
    try {
      if (p.schema && fresh.info.schema !== p.schema) {
        await raw(fresh, fresh.profile.dialect === "mysql" ? `USE ${quoteId(p.schema, "mysql")}` : `ALTER SESSION SET CURRENT_SCHEMA=${quoteId(p.schema, "oracle")}`);
        fresh.info.schema = p.schema;
      }
      if (readOnly) {
        fresh.info.readOnly = true;
        fresh.info.autoCommit = false;
      } else if (!p.autoCommit) await transaction(fresh, "auto", false);
      sessions.set(p.sessionId, fresh);
      return { ...fresh.info };
    } catch (e) {
      await close(fresh);
      throw e;
    }
  }
  if (method === "session.close" && !sessions.has(p.sessionId)) return;
  const s = sessions.get(p.sessionId);
  if (!s) throw new Error("\u6570\u636E\u5E93\u4F1A\u8BDD\u4E0D\u5B58\u5728\uFF0C\u8BF7\u91CD\u65B0\u8FDE\u63A5");
  if (s.info.readOnly && ["table.apply", "ddl.execute"].includes(method)) throw new Error("当前会话为只读，禁止数据及结构变更");
  if (method === "query.cancel") return cancel(s);
  if (method === "session.state") return s.info;
  if (s.busy) throw new Error("\u5F53\u524D\u6807\u7B7E\u6B63\u5728\u6267\u884C\u64CD\u4F5C\uFF0C\u8BF7\u7B49\u5F85\u5B8C\u6210\u6216\u53D6\u6D88");
  s.busy = true;
  s.cancelled = false;
  try {
    switch (method) {
      case "session.close":
        if ((s.info.dirty || s.info.needsRollback) && !p.force) throw new Error("\u5B58\u5728\u672A\u63D0\u4EA4\u4E8B\u52A1\uFF0C\u8BF7\u63D0\u4EA4\u6216\u56DE\u6EDA");
        await close(s);
        sessions.delete(p.sessionId);
        return;
      case "session.transaction":
        return await transaction(s, p.action, p.value);
      case "session.schema":
        await raw(s, s.profile.dialect === "mysql" ? `USE ${quoteId(p.schema, "mysql")}` : `ALTER SESSION SET CURRENT_SCHEMA=${quoteId(p.schema, "oracle")}`);
        s.info.schema = p.schema;
        return { ...s.info };
      case "schema.list":
        return await schemas(s);
      case "object.list":
        return await objects(s, p.schema);
      case "object.source":
        return await source(s, p.schema, p.table, p.kind);
      case "table.describe":
        return await describe(s, p.schema, p.table);
      case "agent.find":
        return await findTables(s, p.schema, p.search);
      case "agent.export":
        return await exportTable(s, p);
      case "query.run":
        return await query(s, p.sql, p.params);
      case "query.fetch":
        return await fetchMore(s, p.resultId);
      case "table.browse":
        return await browse(s, p);
      case "table.apply":
        return await applyChanges(s, p);
      case "ddl.preview":
        return buildDDL(p.before, p.after, s.profile.dialect);
      case "ddl.execute":
        return await ddl(s, p);
      default:
        throw new Error("\u672A\u77E5\u6570\u636E\u5E93\u64CD\u4F5C");
    }
  } catch (e) {
    if (isDisconnected(e)) {
      s.info.connected = false;
      s.info.needsRollback = !s.info.autoCommit;
    }
    throw e;
  } finally {
    s.busy = false;
  }
}
function isDisconnected(e) {
  return /ORA-03113|ORA-03114|ORA-03135|JDBC 工作进程已退出|JDBC 会话已关闭|JDBC 17002|JDBC 17008|JDBC 17410|ECONNRESET|EPIPE|connection.*(lost|closed)|closed.*connection/i.test(String(e?.message));
}
var port = process.parentPort;
port.on("message", async ({ data }) => {
  try {
    const key = data.payload?.sessionId;
    let value;
    if (key && !["query.cancel", "session.state"].includes(data.method)) {
      const previous = queues.get(key) ?? Promise.resolve();
      const operation = previous.catch(() => {
      }).then(() => handle(data.method, data.payload));
      queues.set(key, operation);
      try {
        value = await operation;
      } finally {
        if (queues.get(key) === operation) queues.delete(key);
      }
    } else value = await handle(data.method, data.payload);
    port.postMessage({ id: data.id, ok: true, value });
  } catch (e) {
    let error = e.message;
    const secret = data.payload?.profile?.password || data.payload?.password;
    if (secret) error = error.replaceAll(secret, "[\u5DF2\u9690\u85CF]");
    port.postMessage({ id: data.id, ok: false, error });
  }
});
//# sourceMappingURL=worker.cjs.map
