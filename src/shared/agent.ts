import { maskSql, splitSql } from './sql';
import type { Dialect } from './types';

// Database read-only transactions provide the second boundary behind this conservative filter.
export function readOnlySql(sql: string, dialect: Dialect): string {
  const parts = splitSql(sql, dialect);
  if (parts.length !== 1) throw new Error('自动查询一次只能执行一条 SELECT；写入请先打开 SQL 草稿');
  const statement = parts[0].sql, masked = maskSql(statement, dialect);
  if (!/^\s*(SELECT|WITH)\b/i.test(masked) || /\/\*(?:!|M!)/i.test(statement) || /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|CALL|EXECUTE|FUNCTION|PROCEDURE|INTO|OUTFILE|DUMPFILE|NEXTVAL|LOCK)\b|@|:=/i.test(masked)) throw new Error('此 SQL 不属于可自动执行的只读查询，请先打开 SQL 草稿');
  const allowed = new Set(('SELECT FROM WHERE AS IN EXISTS NOT AND OR ON OVER PARTITION VALUES COUNT SUM AVG MIN MAX ABS ROUND TRUNC CEIL CEILING FLOOR MOD POWER SQRT COALESCE NVL NVL2 NULLIF DECODE CAST CONVERT TO_CHAR TO_DATE TO_TIMESTAMP TO_NUMBER EXTRACT SUBSTR SUBSTRING LENGTH CHAR_LENGTH LOWER UPPER TRIM LTRIM RTRIM REPLACE CONCAT INSTR LPAD RPAD REGEXP_LIKE REGEXP_REPLACE REGEXP_SUBSTR DATE_FORMAT DATE_ADD DATE_SUB DATEDIFF TIMESTAMPDIFF NOW CURDATE CURRENT_DATE CURRENT_TIMESTAMP YEAR MONTH DAY LAST_DAY ADD_MONTHS MONTHS_BETWEEN ROW_NUMBER RANK DENSE_RANK LAG LEAD FIRST_VALUE LAST_VALUE LISTAGG GROUP_CONCAT IF IFNULL GREATEST LEAST JSON_VALUE JSON_EXTRACT').split(' '));
  for (const match of masked.matchAll(/([A-Za-z_][A-Za-z0-9_$#]*)\s*\(/g)) {
    if (!allowed.has(match[1].toUpperCase()) || /\.\s*$/.test(masked.slice(0,match.index))) throw new Error(`自动查询不调用未经允许的函数：${match[1]}。请在 SQL 草稿中检查后运行`);
  }
  // Quoted function names cannot bypass the function allowlist; quoted table/column names remain valid.
  for (const match of statement.matchAll(/("(?:[^"]|"")*"|`(?:[^`]|``)*`)\s*\(/g)) {
    if (masked[match.index! + match[0].lastIndexOf('(')] === '(') throw new Error('自动查询不调用带引号的函数，请使用 SQL 草稿');
  }
  return statement;
}
