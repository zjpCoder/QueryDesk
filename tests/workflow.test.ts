import test from 'node:test';
import assert from 'node:assert/strict';
import { tableSelect } from '../src/shared/filters';
import { bindSql } from '../src/shared/sql';
import { queryFailure } from '../src/shared/queryError';
import { validate } from '../electron/validation';
import type { TableDef } from '../src/shared/types';
const def:TableDef={schema:'app',name:'orders',comment:'',indexes:[],foreignKeys:[],columns:[{name:'id',type:'NUMBER',nullable:false,primary:true,comment:'',defaultValue:''},{name:'name',type:'VARCHAR(100)',nullable:true,primary:false,comment:'',defaultValue:''},{name:'created',type:'DATE',nullable:true,primary:false,comment:'',defaultValue:''}]};
test('多条件筛选使用同组 AND/OR 并绑定字面值，包含查询转义通配符',()=>{
  for(const dialect of ['mysql','oracle'] as const){
    const r=tableSelect(def,dialect,[{column:'name',op:'contains',value:"x%' OR 1=1 --"},{column:'id',op:'>=',value:'9007199254740993'}],'or',{column:'id',direction:'desc'});
    assert.match(r.sql,/WHERE \(.+ OR .+\) ORDER BY/);assert(!r.sql.includes('OR 1=1'));
    assert.equal(r.values.f0,"%x!%' OR 1=1 --%");assert.equal(r.values.f1,'9007199254740993');
    const b=bindSql(r.sql,r.values,dialect);assert(dialect==='oracle'||Array.isArray(b.binds));
  }
});
test('Oracle 日期筛选保留转换，NULL 不绑定，多条件限制及非法字段拒绝',()=>{
  const r=tableSelect(def,'oracle',[{column:'created',op:'>=',value:'2026-01-01 00:00:00'},{column:'name',op:'is null',value:''}]);
  assert.match(r.sql,/TO_DATE\(:f0/);assert.match(r.sql,/AND "name" IS NULL/);assert.deepEqual(Object.keys(r.values),['f0']);
  assert.throws(()=>tableSelect(def,'mysql',[{column:'missing',op:'=',value:'x'}]));
  assert.throws(()=>tableSelect(def,'mysql',[],'xor' as any));
  assert.throws(()=>validate('table.browse',{sessionId:'s',schema:'app',table:'orders',page:0,filterMode:'xor',filters:[]}));
  assert.throws(()=>validate('table.browse',{sessionId:'s',schema:'app',table:'orders',page:0,filters:Array(21).fill({column:'id',op:'=',value:'1'})}));
});
test('查询导出不接受路径或写入会话属性，参数保留精确字符串和 NULL',()=>{
  const r=validate('export.query',{id:'e',connectionId:'c',schema:'app',format:'csv',filePath:'C:/bad',autoCommit:true,query:{sql:'SELECT :id, :v',params:{id:'9007199254740993',v:null}}}) as any;
  assert.equal(r.filePath,undefined);assert.equal(r.autoCommit,undefined);assert.equal(r.query.params.id,'9007199254740993');assert.equal(r.query.params.v,null);
});
test('错误行号定位保留执行选区偏移，语句序号不依赖结果集数量',()=>{
  const text='SELECT\n bad FROM t';
  const r=queryFailure("Syntax error near 'bad' at line 2",{sql:text,start:30,end:30+text.length},4,'mysql');
  assert.deepEqual(r,{statementIndex:5,offset:37,precision:'line'});
  assert.equal(queryFailure('Disconnected',{sql:text,start:30,end:50},0,'mysql').precision,'statement');
});
test('Oracle PL/SQL 行列与占位符缩短映射回源文，非驱动行号不伪造位置',()=>{
  const sql='BEGIN\n  x := :long_parameter + bad;\nEND;';
  const driver='BEGIN\n  x := ? + bad;\nEND;',column=driver.split('\n')[1].indexOf('bad')+1;
  const r=queryFailure(`ORA-06550: line 2, column ${column}:\nPLS-00201`,{sql,start:10,end:10+sql.length},1,'oracle');
  assert.equal(queryFailure(`ORA-06550: 第 2 行, 第 ${column} 列:`,{sql,start:10,end:100},1,'oracle').offset,r.offset);
  assert.equal(r.offset,10+sql.indexOf('bad'));assert.equal(r.precision,'column');
  assert.equal(queryFailure('invalid identifier "line 77"',{sql,start:10,end:100},0,'oracle').precision,'statement');
});
