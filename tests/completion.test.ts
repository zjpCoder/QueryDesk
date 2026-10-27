import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completionContext, incompleteSql, sqlSuggestions } from '../src/shared/completion';
import type { DBObject, Dialect, TableDef } from '../src/shared/types';

const objects:DBObject[]=[{schema:'APP',name:'CUSTOMERS',kind:'table'},{schema:'APP',name:'ORDERS',kind:'table'},{schema:'APP',name:'V_CUSTOMERS',kind:'view'},{schema:'APP',name:'SEQ_COUPON_TEMPLATE_CODE',kind:'sequence'},{schema:'OTHER',name:'CUSTOMERS',kind:'table'}];
const tables:TableDef[]=objects.filter(o=>o.kind==='table').map(o=>({schema:o.schema,name:o.name,comment:'',indexes:[],foreignKeys:[],columns:(o.schema==='OTHER'?['SECRET']:o.name==='CUSTOMERS'?['ID','NAME']:['ID','TOTAL']).map(name=>({name,type:'VARCHAR2',nullable:true,primary:false,defaultValue:'',comment:'字段注释'}))}));
function suggest(marked:string,dialect:Dialect='oracle',obs=objects,defs=tables){const offset=marked.indexOf('|');return sqlSuggestions(marked.replace('|',''),offset,dialect,obs,defs,'APP');}

test('输入 selec 优先 SELECT，保留查询模板，排除模糊匹配对象',()=>{
  const list=suggest('selec|');assert.equal(list[0].label,'SELECT');assert(list.some(s=>s.kind==='snippet'));assert(list.every(s=>s.label.startsWith('SELECT')));
});
test('FROM/JOIN/UPDATE/INTO 和逗号后只提供可查询对象，不混入序列或所有字段',()=>{
  for(const sql of ['SELECT * FROM CU|','SELECT * FROM ORDERS o JOIN CU|','UPDATE CU|','INSERT INTO CU|','SELECT * FROM ORDERS, CU|'])assert.deepEqual(suggest(sql).filter(s=>s.kind==='table').map(s=>s.label),['CUSTOMERS']);
  assert(suggest('SELECT * FROM |').every(s=>s.kind!=='field'));
  assert(!suggest('SELECT * FROM SEQ|').some(s=>s.kind==='table'));
});
test('字段跟随引用表和别名，支持光标后的 FROM，隔离 Schema',()=>{
  const list=suggest('SELECT c.| FROM CUSTOMERS c');assert.deepEqual(list.map(s=>s.label),['ID','NAME']);assert(!list.some(s=>s.label==='SECRET'));
  assert.deepEqual(suggest('SELECT x.| FROM ORDERS x').map(s=>s.label),['ID','TOTAL']);
  assert.deepEqual(suggest('SELECT unknown.| FROM CUSTOMERS c'),[]);
  assert.deepEqual(suggest('SELECT c.| FROM OTHER.CUSTOMERS c').map(s=>s.label),['SECRET']);
});
test('JOIN 同名字段自动带别名，Oracle 未引用别名不额外加引号',()=>{
  const list=suggest('SELECT I| FROM CUSTOMERS c JOIN ORDERS o ON c.ID=o.ID');
  assert.deepEqual(list.filter(s=>s.kind==='field').map(s=>s.insertText),['c.ID','o.ID']);
  assert(suggest('SELECT I| FROM CUSTOMERS "c c" JOIN ORDERS o ON 1=1').some(s=>s.insertText==='"c c".ID'));
});
test('注释、字符串与 Oracle q 引用未闭合时不补全，不因编辑中状态报错',()=>{
  for(const sql of ["SELECT 'selec|",'-- selec|','/* selec|',"SELECT q'[selec|",'SELECT "selec|'])assert.deepEqual(suggest(sql),[]);
  assert.equal(suggest("SELECT 'FROM bogus';\nselec|")[0].label,'SELECT');
});
test('方言模板、函数和序列伪列正确，Oracle 11g 不使用 LIMIT/FETCH',()=>{
  const ora=suggest('sel|').find(s=>s.label.includes('200'))!.insertText;
  assert.match(ora,/ROWNUM/);assert.doesNotMatch(ora,/LIMIT|FETCH/);
  assert.match(suggest('sel|','mysql').find(s=>s.label.includes('200'))!.insertText,/LIMIT/);
  assert(suggest('SELECT NV|').some(s=>s.label==='NVL(…)'));assert(!suggest('SELECT NV|','mysql').length);
  assert.deepEqual(suggest('SELECT SEQ_COUPON_TEMPLATE_CODE.N| FROM DUAL').map(s=>s.label),['NEXTVAL']);
});
test('按当前语句和子查询作用域解析，忽略字符串中的伪表名',()=>{
  assert.deepEqual(suggest('SELECT * FROM ORDERS o; SELECT c.| FROM CUSTOMERS c').map(s=>s.label),['ID','NAME']);
  assert.deepEqual(suggest('SELECT * FROM ORDERS o WHERE EXISTS (SELECT c.| FROM CUSTOMERS c)').map(s=>s.label),['ID','NAME']);
  const c=completionContext("SELECT 'FROM ORDERS' FROM CUSTOMERS",7,'oracle',objects,'APP');assert.deepEqual(c.references.map(r=>r.object.name),['CUSTOMERS']);
});
test('有空格或保留字的标识符正确引用；空元数据仍能补全关键字',()=>{
  const obs:DBObject[]=[{schema:'APP',name:'ORDER',kind:'table'},{schema:'APP',name:'order details',kind:'table'}];
  assert.deepEqual(suggest('SELECT * FROM ord|','mysql',obs,[]).filter(s=>s.kind==='table').map(s=>s.insertText),['`ORDER`','`order details`']);
  assert.equal(suggest('selec|','mysql',[],[])[0].label,'SELECT');
});
test('完整度提示明显缺项，不误拦无分号、常量、字符串、绑定和 PL/SQL',()=>{
  for(const sql of ['SELECT','SELECT * FROM','SELECT * FROM CUSTOMERS WHERE','UPDATE CUSTOMERS SET','SELECT 1; SELECT * FROM CUSTOMERS ORDER BY','SELECT * FROM CUSTOMERS WHERE ID ='])assert(incompleteSql(sql,'oracle'),sql);
  for(const sql of ['SELECT 1','SELECT * FROM CUSTOMERS',"SELECT 'FROM' FROM DUAL",'SELECT "FROM" FROM DUAL','SELECT * FROM CUSTOMERS WHERE ID=:id','BEGIN NULL; END;','CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;','SELECT COUNT(*) FROM CUSTOMERS','SELECT NULL'])assert.equal(incompleteSql(sql,'oracle'),undefined,sql);
});
