import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindNames, bindSql, csv, currentSql, maskSql, qualified, splitSql } from '../src/shared/sql';
test('分句忽略字符串、标识符和注释中的分号', () => {
  assert.deepEqual(splitSql("SELECT ';' AS `a;b`; -- ignored ;\nSELECT 'it''s;ok'; /* ; */", 'mysql').map(s=>s.sql), ["SELECT ';' AS `a;b`", "-- ignored ;\nSELECT 'it''s;ok'"]);
});
test('Oracle PL/SQL 保留内部语句，并按独立斜杠分隔', () => {
  const sql="DECLARE\n v VARCHAR2(20) := q'[a;b]';\nBEGIN\n NULL;\nEND;\n/\nSELECT 1 FROM DUAL;";
  const parts=splitSql(sql,'oracle'); assert.equal(parts.length,2); assert.ok(parts[0].sql.endsWith('END;')); assert.equal(parts[1].sql,'SELECT 1 FROM DUAL');
});
test('Oracle CREATE OR REPLACE PACKAGE 不拆分内部过程', () => {
  const parts=splitSql('CREATE OR REPLACE PACKAGE test AS\n PROCEDURE p;\nEND;\n/\nSELECT 1 FROM DUAL;', 'oracle'); assert.equal(parts.length,2);
});
test('MySQL DELIMITER 允许创建存储过程后继续查询',()=>{
  const parts=splitSql('DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END$$\nDELIMITER ;\nSELECT 3;','mysql'); assert.equal(parts.length,2); assert.ok(parts[0].sql.endsWith('END'));
});
test('参数识别不读取字符串、注释和 Oracle 赋值符号',()=>{
  assert.deepEqual(bindNames("SELECT :id,:id, ':secret' FROM x -- :no\n WHERE y=:other AND a:=2"),['id','other']);
});
test('MySQL 参数按出现次序绑定，注入文本保持为参数值',()=>{
  const injection="' OR 1=1 --"; const result=bindSql('SELECT * FROM t WHERE a=:a OR b=:a',{a:injection},'mysql'); assert.equal(result.sql,'SELECT * FROM t WHERE a=? OR b=?'); assert.deepEqual(result.binds,[injection,injection]);
});
test('Oracle 仅绑定 SQL 中出现的参数，缺少参数必须拒绝',()=>{
  assert.deepEqual(bindSql('SELECT :id FROM DUAL',{id:'9007199254740993',extra:'secret'},'oracle').binds,{id:'9007199254740993'}); assert.throws(()=>bindSql('SELECT :id',{},'mysql'),/缺少参数/);
});
test('SQL 当前语句选择保留 UTF-16 偏移与中文内容',()=>{
  const text="SELECT '😀中文';\nSELECT 2;"; assert.equal(currentSql(text,text.indexOf('2'),'mysql'),'SELECT 2');
});
test('未闭合字符串和注释不会送往执行器',()=>{assert.throws(()=>maskSql("SELECT 'oops"),/未闭合/);assert.throws(()=>maskSql('SELECT 1 /*'),/未闭合/);});
test('Oracle 不将反斜杠当转义符，允许 # 标识符',()=>{assert.equal(splitSql("SELECT 'a\\' FROM T#; SELECT :x FROM DUAL;",'oracle').length,2);assert.deepEqual(bindNames('SELECT :id FROM T# WHERE ID=:next','oracle'),['id','next']);});
test('标识符安全引用和 CSV 精度、转义',()=>{
  assert.equal(qualified('db','a`b','mysql'),'`db`.`a``b`'); assert.equal(qualified('A','a"b','oracle'),'"A"."a""b"');
  assert.equal(csv([{a:'9007199254740993',b:'a,"b"\n中',c:null}],['a','b','c']),'\uFEFF"a","b","c"\r\n"9007199254740993","a,""b""\n中",""');
});
