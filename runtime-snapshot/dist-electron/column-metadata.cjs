"use strict";

module.exports = ({ raw, oracleType, mysqlTypes = {} }) => {
  // ponytail: 仅解析直接 SELECT 的字段来源；子查询、CTE、集合运算使用驱动类型，避免猜错注释。
  function projection(sql, dialect, schema) {
    const tokens = [];
    const lexer = /--[^\r\n]*|\/\*[\s\S]*?\*\/|q'\[[\s\S]*?\]'|q'\{[\s\S]*?\}'|q'\([\s\S]*?\)'|q'<[\s\S]*?>'|'(?:''|\\.|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|[\p{L}_][\p{L}\p{N}_$#]*|\S/giu;
    for (const match of sql.matchAll(lexer)) {
      const text = match[0];
      if (/^(--|\/\*)/.test(text)) continue;
      const quoted = /^["`]/.test(text), literal = /^'|^q'/i.test(text);
      tokens.push({ text, key: quoted || literal ? "" : text.toUpperCase(), id: quoted ? text.slice(1, -1).replaceAll(text[0] + text[0], text[0]) : dialect === "oracle" ? text.toUpperCase() : text, identifier: quoted || /^[\p{L}_][\p{L}\p{N}_$#]*$/u.test(text) });
    }
    if (tokens[0]?.key !== "SELECT") return;
    let depth = 0;
    const top = tokens.map(t => { if (t.text === ")") depth--; const level = depth; if (t.text === "(") depth++; return level; });
    if (tokens.some((t, i) => top[i] === 0 && ["UNION", "INTERSECT", "MINUS", "EXCEPT"].includes(t.key))) return;
    const from = tokens.findIndex((t, i) => top[i] === 0 && t.key === "FROM");
    if (from < 0) return;
    const reserved = new Set("WHERE GROUP ORDER HAVING OFFSET FETCH LIMIT FOR CONNECT START MODEL QUALIFY JOIN INNER LEFT RIGHT FULL CROSS NATURAL OUTER ON USING UNION INTERSECT MINUS EXCEPT PARTITION".split(" "));
    const sources = [];
    for (let i = from; i < tokens.length; i++) {
      if (top[i] !== 0) continue;
      if (i > from && ["WHERE", "GROUP", "ORDER", "HAVING", "OFFSET", "FETCH", "LIMIT", "FOR", "CONNECT", "START", "MODEL", "QUALIFY"].includes(tokens[i].key)) break;
      if (i !== from && tokens[i].key !== "JOIN" && tokens[i].text !== ",") continue;
      let j = i + 1;
      if (!tokens[j]?.identifier) return;
      let owner = schema, table = tokens[j++].id;
      if (tokens[j]?.text === ".") { owner = table; table = tokens[j + 1]?.id; j += 2; }
      if (!table || ["(", ".", "@"].includes(tokens[j]?.text)) return;
      if (tokens[j]?.key === "AS") j++;
      const alias = tokens[j]?.identifier && !reserved.has(tokens[j].key) ? tokens[j].id : table;
      sources.push({ schema: owner, table, alias });
    }
    const parts = [];
    let start = ["DISTINCT", "ALL"].includes(tokens[1]?.key) ? 2 : 1;
    for (let i = start; i <= from; i++) if (i === from || top[i] === 0 && tokens[i].text === ",") { parts.push(tokens.slice(start, i)); start = i + 1; }
    return { sources, parts };
  }

  async function metadata(s, sql, names, fields = []) {
    const dialect = s.profile.dialect;
    const parsed = dialect === "oracle" ? projection(sql, dialect, s.info.schema) : undefined;
    const cache = new Map();
    async function columns(source) {
      const key = JSON.stringify([source.schema, source.table]);
      if (!cache.has(key)) {
        cache.set(key, (async () => {
          try {
            const rows = await raw(s, dialect === "mysql"
              ? "SELECT COLUMN_NAME,COLUMN_TYPE,COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=:schema AND TABLE_NAME=:table ORDER BY ORDINAL_POSITION"
              : "SELECT c.COLUMN_NAME,c.DATA_TYPE,c.DATA_LENGTH,c.CHAR_LENGTH,c.CHAR_USED,c.DATA_PRECISION,c.DATA_SCALE,m.COMMENTS FROM ALL_TAB_COLUMNS c LEFT JOIN ALL_COL_COMMENTS m ON m.OWNER=c.OWNER AND m.TABLE_NAME=c.TABLE_NAME AND m.COLUMN_NAME=c.COLUMN_NAME WHERE c.OWNER=:schema AND c.TABLE_NAME=:table ORDER BY c.COLUMN_ID", { schema: source.schema, table: source.table });
            return rows.map(c => ({ name: c.COLUMN_NAME, type: dialect === "mysql" ? c.COLUMN_TYPE : oracleType(c), comment: (dialect === "mysql" ? c.COLUMN_COMMENT : c.COMMENTS) || "" }));
          } catch { return []; } // 注释权限不足不影响原查询结果。
        })());
      }
      return cache.get(key);
    }
    const projected = [];
    if (parsed) {
      for (let part of parsed.parts) {
        const as = part.findIndex(t => t.key === "AS");
        if (as >= 0) part = part.slice(0, as);
        else if (part.length > 1 && part.at(-1).identifier && part.at(-2).text !== ".") part = part.slice(0, -1);
        const direct = part.length % 2 === 1 && part.every((t, i) => i % 2 ? t.text === "." : t.identifier || t.text === "*");
        if (!direct || part.length > 5) { projected.push(undefined); continue; }
        const column = part.at(-1).id, wildcard = part.at(-1).text === "*";
        const sources = part.length === 1 ? parsed.sources : parsed.sources.filter(t => (t.alias === part.at(-3).id || t.table === part.at(-3).id) && (part.length < 5 || t.schema === part[0].id));
        const matches = [];
        let complete = true;
        for (const source of sources) {
          const cols = await columns(source);
          if (!cols.length) complete = false;
          matches.push(...(wildcard ? cols : cols.filter(c => c.name === column)));
        }
        if (wildcard) { if (!matches.length) return names.map((name, i) => ({ name, type: fields[i]?.type || "", comment: "", commentKnown: false })); projected.push(...matches); }
        else projected.push(complete && matches.length === 1 ? matches[0] : undefined);
      }
    }
    const result = [];
    for (const [i, name] of names.entries()) {
      const field = fields[i] || {};
      let found = projected.length === names.length ? projected[i] : undefined;
      if (dialect === "mysql" && field.orgTable && field.orgName) found = (await columns({ schema: field.db || s.info.schema, table: field.orgTable })).find(c => c.name === field.orgName);
      const type = typeof field.type === "string" ? field.type : mysqlTypes[field.columnType ?? field.type];
      result.push({ name, type: found?.type || type || "", comment: found?.comment || "", commentKnown: !!found });
    }
    return result;
  }
  return { metadata, projection };
};
