import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readOnlySql } from '../src/shared/agent';
import { runAgent, toolArguments } from '../electron/agent';
import type { AIRequest } from '../src/shared/types';
test('自动查询允许 SELECT/CTE，拒绝脚本、写入、文件操作、外部函数和序列',()=>{
  assert.equal(readOnlySql('SELECT COUNT(*) FROM "APP"."MERCHANT";','oracle'),'SELECT COUNT(*) FROM "APP"."MERCHANT"');
  assert.ok(readOnlySql('WITH t AS (SELECT id FROM orders) SELECT * FROM t','mysql'));
  assert.ok(readOnlySql("SELECT 'DROP TABLE x' AS note FROM dual",'oracle'));
  for(const sql of ['DELETE FROM t','SELECT 1; DROP TABLE t','WITH x AS (DELETE FROM t) SELECT * FROM x','SELECT evil() FROM dual','SELECT "EVIL"() FROM dual','SELECT seq.NEXTVAL FROM dual','SELECT * FROM t FOR UPDATE','SELECT * INTO OUTFILE \'a\' FROM t','SELECT LOAD_FILE(\'secret\')','SELECT * FROM t@remote','SELECT 1 /*! INTO OUTFILE \'a\' */','SELECT SYS.DBMS_FOO() FROM dual'])assert.throws(()=>readOnlySql(sql,'oracle'),Error,sql);
});
test('应用工具参数不接受连接切换、任意文件路径或未知格式',()=>{
  assert.throws(()=>toolArguments.export_table.parse({table:'t',format:'csv',path:'C:/secret'}));
  assert.throws(()=>toolArguments.query_sql.parse({sql:'SELECT 1',title:'查询',connectionId:'other'}));
  assert.throws(()=>toolArguments.export_table.parse({table:'t',format:'exe'}));
});
test('工具循环只分派允许的方法，保留工具结果并支持完整 API 地址',async()=>{
  const requests:any[]=[];let round=0;
  const server=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
    assert.equal(req.url,'/v1/chat/completions');const body=JSON.parse(raw);requests.push(body);
    const message=round++===0?{role:'assistant',content:null,tool_calls:[{id:'tool-1',type:'function',function:{name:'find_tables',arguments:'{"search":"商户"}'}}]}:{role:'assistant',content:'已找到商户表'};
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message}]}));
  });});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const request:AIRequest={id:'test',action:'operate',question:'查询商户表',connectionId:'conn',dialect:'mysql',version:'8.0',schema:'app',sql:'',error:'',tables:[],rows:[]};
  try{
    const called:string[]=[];let output='';
    await runAgent({baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1/chat/completions`,model:'fixture'},request,new AbortController().signal,async(name,args)=>{called.push(name);assert.deepEqual(args,{search:'商户'});return{tables:[{name:'MERCHANT',comment:'商户'}]};},text=>output+=text);
    assert.deepEqual(called,['find_tables']);assert.match(output,/商户/);assert.equal(requests[1].messages.at(-1).role,'tool');
    assert.ok(requests[0].tools.some((t:any)=>t.function.name==='export_table'));
    assert.ok(!requests[0].tools.some((t:any)=>t.function.name==='execute_write'));
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
