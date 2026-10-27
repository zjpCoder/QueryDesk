import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jdbcBinds } from '../electron/jdbc';
test('JDBC 按位置重复绑定，跳过字符串、注释与 PL/SQL 赋值', () => {
  const sql = "BEGIN x := :value; y := :value; z := q'[:ignored]'; -- :comment\nNULL; END;";
  assert.deepEqual(jdbcBinds(sql, { value: "中文' OR 1=1 --" }), { sql: "BEGIN x := ?; y := ?; z := q'[:ignored]'; -- :comment\nNULL; END;", binds: ["中文' OR 1=1 --", "中文' OR 1=1 --"] });
});
test('JDBC 保留 NULL 和高精度字符串并拒绝缺少的参数', () => {
  assert.deepEqual(jdbcBinds('SELECT :n, :v FROM DUAL', { n: null, v: '9007199254740993' }).binds, [null, '9007199254740993']);
  assert.throws(() => jdbcBinds('SELECT :missing FROM DUAL', {}), /缺少参数/);
});
