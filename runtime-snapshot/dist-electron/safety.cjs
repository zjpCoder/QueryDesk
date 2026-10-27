"use strict";

// 复用两端已有的 SQL 分句、引号及注释处理，检查整批后才允许执行。
module.exports = function safety({ maskSql, splitSql, readOnlySql }) {
  function outerSql(sql, dialect) {
    const masked = maskSql(sql, dialect);
    let depth = 0;
    return masked.replace(/[()]|[^()]+/g, part => {
      if (part === "(") { depth++; return " "; }
      if (part === ")") { depth--; return " "; }
      return depth === 0 ? part : " ";
    });
  }

  function queryRisks(sql, dialect, production = false) {
    const risks = [];
    for (const [index, statement] of splitSql(sql, dialect).entries()) {
      const outer = outerSql(statement.sql, dialect);
      const reasons = [];
      if (/\b(DROP|TRUNCATE)\b/i.test(outer)) reasons.push("DROP / TRUNCATE 可能删除对象或清空数据，通常无法回滚");
      if (/\b(UPDATE|DELETE)\b/i.test(outer) && !/\bWHERE\b/i.test(outer)) reasons.push("UPDATE / DELETE 未检测到外层 WHERE，可能影响整表");
      if (/^\s*(BEGIN|DECLARE|CALL|EXECUTE)\b/i.test(outer)) reasons.push("过程调用或程序块可能包含无法静态判断的写操作");
      if (/\/\*(?:!|M!)/i.test(statement.sql)) reasons.push("包含数据库可执行注释，需要人工检查实际执行内容");
      const operation = /\b(SELECT|UPDATE|DELETE|INSERT|MERGE|REPLACE)\b/i.exec(outer)?.[1].toUpperCase();
      const read = /^\s*(SELECT|SHOW|DESC|DESCRIBE)\b/i.test(outer) || /^\s*(WITH|EXPLAIN)\b/i.test(outer) && operation === "SELECT";
      const transaction = /^\s*(COMMIT|ROLLBACK|SAVEPOINT)\b/i.test(outer);
      if (production && !read && !transaction) reasons.push("将在生产环境执行写入或结构变更");
      if (reasons.length) risks.push(`第 ${index + 1} 条：${reasons.join("；")}`);
    }
    return risks;
  }

  function assertProfileReadOnly(sql, dialect) {
    try {
      const statements = splitSql(sql, dialect);
      if (!statements.length) throw new Error("没有可执行的 SQL");
      for (const statement of statements) {
        const masked = maskSql(statement.sql, dialect).trim();
        if (/\/\*(?:!|M!)/i.test(statement.sql)) throw new Error("不允许可执行注释");
        if (/^(SHOW|DESC|DESCRIBE)\b/i.test(masked)) continue;
        // EXPLAIN ANALYZE 可能真正执行语句；仍按 SELECT 的只读规则检查。
        if (/^EXPLAIN\b/i.test(masked)) {
          if (/^EXPLAIN\s+PLAN\b/i.test(masked)) throw new Error("EXPLAIN PLAN 会写入计划表");
          const start = /\b(SELECT|WITH)\b/i.exec(masked)?.index;
          if (start === undefined || /\b(INSERT|UPDATE|DELETE|REPLACE|CALL|EXECUTE)\b/i.test(masked.slice(0, start))) throw new Error("只允许解释只读查询");
          const offset = maskSql(statement.sql, dialect).search(/\S/);
          readOnlySql(statement.sql.slice(offset + start), dialect);
        } else readOnlySql(statement.sql, dialect);
      }
    } catch (error) {
      throw new Error(`只读连接已阻止此操作：${error.message}`);
    }
  }

  return { queryRisks, assertProfileReadOnly };
};
