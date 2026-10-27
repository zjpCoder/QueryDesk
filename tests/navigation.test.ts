import test from 'node:test';
import assert from 'node:assert/strict';
import { textMatches, sqlOutline, matchesSearch } from '../src/shared/navigation';
import { editorKeys } from '../src/ui/shortcuts';

test('跨标签查找按字面值匹配并保留中文、换行、UTF-16 位置',()=>{
  const text="-- 😀商户\r\nSELECT '[a].*' AS x;\nSELECT '[a].*';";
  const hits=textMatches(text,'[a].*');
  assert.equal(hits.length,2);assert.equal(hits[0].line,2);assert.equal(hits[0].column,9);
  for(const hit of hits)assert.equal(text.slice(hit.offset,hit.offset+hit.length),'[a].*');
  assert.equal(textMatches(text,'SELECT',1).length,1);assert.deepEqual(textMatches(text,''),[]);
  assert.deepEqual(textMatches(text,'SELECT',0),[]);
});
test('SQL 结构跳过注释字符串中的关键字并保持 Oracle PL/SQL 完整',()=>{
  const sql="-- FROM fake\nSELECT 'WHERE fake' FROM customers;\nSELECT 2;";
  const outline=sqlOutline(sql,'mysql');
  assert.equal(outline.filter(i=>i.label.startsWith('语句')).length,2);
  assert.equal(outline.length,3);assert.equal(sql.slice(outline[1].offset).startsWith('FROM customers'),true);
  assert.equal(outline[0].line,2);
  assert.equal(sqlOutline('BEGIN\n NULL;\n NULL;\nEND;\n/','oracle').filter(i=>i.label.startsWith('语句')).length,1);
  assert.throws(()=>sqlOutline("SELECT 'unfinished",'mysql'));
});
test('对象和帮助搜索支持多关键字且快捷键绑定没有重复',()=>{
  assert.equal(matchesSearch('客户 TABLE','customers','客户表','table'),true);
  assert.equal(matchesSearch('客户 view','customers','客户表','table'),false);
  const keys=editorKeys.flatMap(k=>k.keys);assert.equal(new Set(keys).size,keys.length);
  assert.equal(new Set(editorKeys.map(k=>k.action)).size,editorKeys.length);
  assert(!keys.some(k=>['Ctrl+N','Ctrl+Shift+F','Ctrl+F12','Ctrl+Enter'].includes(k)));
});
