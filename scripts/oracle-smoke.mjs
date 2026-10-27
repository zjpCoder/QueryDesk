import { _electron as electron, expect } from '@playwright/test';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
const work = path.resolve('../../work', 'oracle-jdbc-' + Date.now()); fs.mkdirSync(work, { recursive: true });
const profile = { id: 'oracle-integration', name: 'Oracle JDBC 验证', group: '验证', dialect: 'oracle', host: process.env.QD_DB_HOST, port: Number(process.env.QD_DB_PORT || 1521), user: process.env.QD_DB_USER, password: process.env.QD_DB_PASSWORD, database: process.env.QD_DB_SERVICE, oracleMode: 'service', clientPath: '', tls: false, caPath: '' };
if (!profile.host || !profile.user || !profile.password || !profile.database) throw new Error('请设置 QD_DB_HOST / QD_DB_USER / QD_DB_PASSWORD / QD_DB_SERVICE，仅从环境变量读取测试配置');
const env = { ...process.env, QUERYDESK_TEST_USER_DATA: path.join(work, 'user-data') }; delete env.ELECTRON_RUN_AS_NODE;
env.JAVA_HOME = path.join(work, 'java-not-installed');
for (const key of Object.keys(env)) if (key.toUpperCase() === 'PATH') env[key] = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
for (const key of Object.keys(env)) if (key.startsWith('QD_DB_')) delete env[key];
const checks = [], errors = []; let app, javaPid;
const model=http.createServer((req,res)=>{let text='';req.on('data',chunk=>text+=chunk);req.on('end',()=>{const body=JSON.parse(text);const used=body.messages.some(m=>m.role==='tool');const message=used?{role:'assistant',content:'只读查询已完成。'}:{role:'assistant',content:null,tool_calls:[{id:'oracle-read',type:'function',function:{name:'query_sql',arguments:JSON.stringify({sql:"SELECT 9007199254740993 AS BIG_VALUE, TO_CHAR(SYSDATE,'YYYY-MM-DD') AS TODAY FROM DUAL",title:'Oracle AI 查询'})}}]};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message}]}));});});
await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
try {
  app = await electron.launch({ executablePath: process.env.QUERYDESK_EXECUTABLE || electronPath, args: process.env.QUERYDESK_EXECUTABLE ? [] : [process.cwd()], env, timeout: 60000 });
  const page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  await expect(page.getByText('让数据工作，')).toBeVisible({ timeout: 60000 });
  const call = (method, payload = {}) => page.evaluate(({method,payload}) => window.querydesk.call(method,payload), {method,payload});
  const driver = await call('client.inspect', { path: '' }); assert.match(driver.message, /JDBC Thin/); javaPid = driver.pid;
  assert.equal(path.resolve(driver.runtime).toLowerCase(), path.resolve(process.env.QUERYDESK_EXECUTABLE ? path.join(path.dirname(process.env.QUERYDESK_EXECUTABLE),'resources/runtime/java') : 'runtime/java').toLowerCase());
  checks.push('内置 Java 与 JDBC 驱动正常启动');
  const tested = await call('connection.test', profile); assert.match(tested.version, /11\.2\.0\.4/); checks.push('真实 Oracle 11.2.0.4 Service Name 认证成功');
  await call('connection.save', profile);
  await page.reload();
  await page.getByRole('button', { name: /Oracle JDBC 验证/ }).first().click();
  await expect(page.getByRole('button', { name: '运行', exact: false })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: '运行', exact: false }).click();
  await expect(page.locator('.ag-cell').filter({ hasText: /20\d\d-\d\d-\d\d/ })).toBeVisible({ timeout: 20000 });
  checks.push('实际工作区查询并渲染 Oracle 日期结果');
  await call('session.open', { sessionId: 'oracle-a', connectionId: profile.id });
  await call('session.open', { sessionId: 'oracle-b', connectionId: profile.id });
  const second = { ...profile, id: 'oracle-second-profile', name: '第二连接验证' }; await call('connection.save', second);
  await call('session.open', { sessionId: 'oracle-c', connectionId: second.id });
  assert.equal((await call('client.inspect', { path: '' })).pid, javaPid); checks.push('多个连接配置共用一个 Java 进程');
  const query = async (sql, params = {}, sessionId = 'oracle-a') => { const r = await call('query.run', { sessionId, sql, params }); assert.equal(r.error, undefined, r.error); return r; };
  const r = await query("SELECT :text AS TEXT_VALUE, :text AS TEXT_AGAIN, CAST(9007199254740993 AS NUMBER(19)) AS BIG_VALUE, CAST(123456789012345678.90 AS NUMBER(20,2)) AS AMOUNT, CAST(NULL AS VARCHAR2(1)) AS NULL_VALUE, TO_DATE('2026-10-12 15:30:45','YYYY-MM-DD HH24:MI:SS') AS DATE_VALUE, TO_TIMESTAMP('2026-10-12 15:30:45.123456','YYYY-MM-DD HH24:MI:SS.FF') AS TS_VALUE, TO_CLOB('中文大字段') AS LOB_VALUE FROM DUAL", { text: "中文' :ignore" });
  const row = r.results[0].rows[0];
  assert.equal(row.TEXT_VALUE, "中文' :ignore"); assert.equal(row.TEXT_AGAIN, row.TEXT_VALUE); assert.equal(row.BIG_VALUE, '9007199254740993'); assert.equal(row.AMOUNT, '123456789012345678.90'); assert.equal(row.NULL_VALUE, null); assert.equal(row.DATE_VALUE, '2026-10-12 15:30:45'); assert.equal(row.TS_VALUE, '2026-10-12 15:30:45.123456'); assert.match(row.LOB_VALUE, /LOB/);
  checks.push('中文、重复参数、NULL、大整数、高精度数值、DATE/TIMESTAMP 与 LOB 占位');
  const sid = async sessionId => (await query("SELECT SYS_CONTEXT('USERENV','SID') AS SESSION_ID FROM DUAL", {}, sessionId)).results[0].rows[0].SESSION_ID;
  assert.notEqual(await sid('oracle-a'), await sid('oracle-b')); checks.push('多标签数据库会话独立');
  await call('session.transaction', { sessionId: 'oracle-a', action: 'auto', value: false });
  assert.equal((await call('session.state', { sessionId: 'oracle-b' })).autoCommit, true);
  await query('BEGIN NULL; NULL; END;');
  await call('session.transaction', { sessionId: 'oracle-a', action: 'rollback' });
  await call('session.transaction', { sessionId: 'oracle-a', action: 'commit' });
  await call('session.transaction', { sessionId: 'oracle-a', action: 'auto', value: true });
  checks.push('PL/SQL 整块执行、事务模式隔离、无写入的提交与回滚调用');
  const schemas = await call('schema.list', { sessionId: 'oracle-a' }); assert.ok(schemas.includes(tested.schema));
  const objects = await call('object.list', { sessionId: 'oracle-a', schema: tested.schema });
  const table = objects.find(o => o.kind === 'table');
  if (table) { const def = await call('table.describe', { sessionId: 'oracle-a', schema: tested.schema, table: table.name }); assert.ok(def.columns.length); checks.push('Schema、对象列表、实际表字段与约束元数据'); }
  const many = await query('SELECT LEVEL AS N FROM DUAL CONNECT BY LEVEL <= 10005'); let batch = many.results[0]; assert.equal(batch.rows.length, 200); let loaded = batch.rows.length;
  while(batch.hasMore) { batch = await call('query.fetch', {sessionId: 'oracle-a', resultId: batch.id}); loaded += batch.rows.length; }
  assert.equal(loaded,10000);assert.equal(batch.truncated,true);checks.push('真实游标按 200 行获取并在 10,000 行标记截断');
  const waiting = call('query.run', { sessionId: 'oracle-a', sql: "SELECT DBMS_PIPE.RECEIVE_MESSAGE('QD_CANCEL_' || RAWTOHEX(SYS_GUID()), 10) AS WAIT_RESULT FROM DUAL", params: {} });
  await new Promise(resolve => setTimeout(resolve, 700));
  await call('query.cancel', { sessionId: 'oracle-a' });
  const cancelled = await waiting; assert.match(cancelled.error || '', /01013|取消/);
  await query('SELECT 1 AS OK FROM DUAL'); checks.push('取消等待查询并恢复只读查询，未自动重放');
  const bad = await call('query.run', { sessionId: 'oracle-a', sql: 'SELECT FROM DUAL', params: {} }); assert.ok(bad.error);
  await query('SELECT 1 AS OK FROM DUAL'); checks.push('SQL 错误后会话仍可用');
  await call('ai.save',{baseUrl:`http://127.0.0.1:${model.address().port}/v1/chat/completions`,model:'local-oracle-tool-fixture',apiKey:''});
  const events=await page.evaluate(async ({connectionId,version,schema})=>{
    const id='oracle-agent-read';return new Promise((resolve,reject)=>{
      const events=[];const timer=setTimeout(()=>{off();reject(new Error('Oracle AI 检查超时'));},30000);
      const off=window.querydesk.onAI(e=>{if(e.id!==id)return;events.push(e);if(e.done){clearTimeout(timer);off();resolve(events);}});
      window.querydesk.call('ai.start',{id,action:'operate',question:'执行只读验证查询',connectionId,sessionId:'oracle-a',dialect:'oracle',version,schema,sql:'',error:'',tables:[],rows:[]}).catch(e=>{clearTimeout(timer);off();reject(e);});
    });
  },{connectionId:profile.id,version:tested.version,schema:tested.schema});
  assert.equal(events.find(e=>e.error),undefined);const auto=events.find(e=>e.opened)?.opened;assert.ok(auto);assert.equal(auto.info.readOnly,true);assert.equal(auto.results[0].rows[0].BIG_VALUE,'9007199254740993');
  checks.push('本地模型工具调用触发真实 Oracle 独立只读事务并打开结果');
  await call('session.close',{sessionId:auto.sessionId});
  await page.screenshot({ path: path.join(work,'oracle-jdbc.png') });
  for(const sessionId of ['oracle-a','oracle-b','oracle-c']) await call('session.close',{sessionId});
  assert.equal(errors.length,0);
  const report={passed:true,version:tested.version,driver:driver.message,bundledRuntimeVerified:true,checks,rendererErrors:errors,scope:'真实 Oracle 只读集成验证；未修改业务数据，未创建表，未验证写入隔离、DDL 和并发编辑冲突',work};
  fs.writeFileSync(path.join(work,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {
  if(app) await app.close();
  model.closeAllConnections();await new Promise(resolve=>model.close(resolve));
  if(javaPid) { await new Promise(resolve=>setTimeout(resolve,2500)); let alive=true;try{process.kill(javaPid,0);}catch{alive=false;}assert.equal(alive,false,'关闭应用后 Java 进程必须退出'); console.log('Java 子进程退出检查通过'); }
}
