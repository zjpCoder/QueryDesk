import { _electron as electron, expect } from '@playwright/test';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import mysql from 'mysql2';
import { workspaceSmoke } from './workspace-smoke.mjs';
import { workflowSmoke } from './workflow-smoke.mjs';
import { keymapSmoke } from './keymap-smoke.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const mysqlRoot = path.dirname(require.resolve('mysql2'));
const Packet = require(path.join(mysqlRoot, 'lib/packets/packet.js'));
const Packets = require(path.join(mysqlRoot, 'lib/packets/index.js'));

const project = process.cwd();
const work = path.resolve(project, '../../work', 'smoke-' + Date.now());
fs.mkdirSync(work, { recursive: true });
const errors = [], sqlLog = [], receivedAI = [];
const preparedLog = [], delayed = new Map();
let nextWriteConflict = false, failIndex = false;
let releaseSuccessfulQuery;
let sequence = 1;
const db = mysql.createServer();
const sockets = new Set();
db.on('connection', conn => {
  sockets.add(conn);conn.on('error',e=>{if(!/ECONNRESET|server closed/.test(e.message))console.error('fixture error:',e.message);});conn.stream.on('close',()=>sockets.delete(conn));
  const ok=conn.writeOk.bind(conn);conn.writeOk=args=>{ok(args);conn._resetSequenceId();};
  const connectionId=sequence++;
  conn.serverHandshake({ protocolVersion:10, serverVersion:'8.0.36-querydesk-protocol-fixture', connectionId, statusFlags:2, characterSet:45, capabilityFlags:0x0008f7ff, authCallback:({user},callback)=>callback(null,user==='reject_fixture'?{code:1045,message:'Access denied by protocol fixture'}:null) });
  const definition=name=>({catalog:'def',schema:'querydesk_test',table:'',orgTable:'',name,orgName:name,characterSet:45,columnLength:1024,columnType:253,flags:0,decimals:0});
  let binary=false, currentSchema='querydesk_test';
  const binaryRow=values=>{const bitmap=Buffer.alloc(Math.floor((values.length+9)/8));let length=5+bitmap.length;values.forEach((value,i)=>{if(value===null)bitmap[Math.floor((i+2)/8)]|=1<<((i+2)%8);else length+=Packet.lengthCodedStringLength(value,'utf8');});const packet=new Packet(0,Buffer.alloc(length),0,length);packet.offset=4;packet.writeInt8(0);for(const b of bitmap)packet.writeInt8(b);for(const value of values)if(value!==null)packet.writeLengthCodedString(value,'utf8');conn.writePacket(packet);};
  const send=(rows, names=Object.keys(rows[0]??{}))=>{conn.writeColumns(names.map(definition));for(const row of rows){const values=names.map(n=>row[n]==null?null:String(row[n]));if(binary)binaryRow(values);else conn.writeTextRow(values);}conn.writeEof(0,2);conn._resetSequenceId();};
  const query=sql=>{
    sqlLog.push(sql);
    if(/VERSION\(\)/i.test(sql))return send([{version:'8.0.36 protocol fixture',db:'querydesk_test'}]);
    if(/SHOW DATABASES/i.test(sql))return send([{Database:'querydesk_test'},{Database:'other_schema'}]);
    if(/^USE\s+/i.test(sql)){currentSchema=sql.replace(/^USE\s+/i,'').replace(/[`;]/g,'').trim();return conn.writeOk({affectedRows:0});}
    if(/SELECT DATABASE\(\) AS CURRENT_SCHEMA/i.test(sql))return send([{CURRENT_SCHEMA:currentSchema}]);
    if(/information_schema\.TABLES/i.test(sql))return /AS NAME/i.test(sql)?send([{NAME:'customers',DESCRIPTION:'商户表'}]):/SELECT TABLE_COMMENT/i.test(sql)?send([{TABLE_COMMENT:'协议测试数据，非真实数据库',TABLE_TYPE:'BASE TABLE',ENGINE:'InnoDB'}]):send([{TABLE_NAME:'customers',TABLE_TYPE:'BASE TABLE',TABLE_COMMENT:'客户表注释'},{TABLE_NAME:'many_rows',TABLE_TYPE:'BASE TABLE'},{TABLE_NAME:'slow_export',TABLE_TYPE:'BASE TABLE'}]);
    if(/information_schema\.(ROUTINES|TRIGGERS|STATISTICS|KEY_COLUMN_USAGE)/i.test(sql))return send([],['name']);
    if(/information_schema\.COLUMNS/i.test(sql))return send([
      {COLUMN_NAME:'id',COLUMN_TYPE:'bigint',IS_NULLABLE:'NO',COLUMN_DEFAULT:null,COLUMN_COMMENT:'编号',COLUMN_KEY:'PRI',EXTRA:''},
      {COLUMN_NAME:'name',COLUMN_TYPE:'varchar(100)',IS_NULLABLE:'YES',COLUMN_DEFAULT:null,COLUMN_COMMENT:'姓名',COLUMN_KEY:'',EXTRA:''},
      {COLUMN_NAME:'balance',COLUMN_TYPE:'decimal(20,2)',IS_NULLABLE:'YES',COLUMN_DEFAULT:'0.00',COLUMN_COMMENT:'余额',COLUMN_KEY:'',EXTRA:''}
    ]);
    if(/SELECT.*SLEEP\(30\)/i.test(sql)){delayed.set(connectionId,()=>{conn.writeError({code:1317,message:'Query execution was interrupted'});conn._resetSequenceId();});return;}
    if(/SELECT.*delayed_success/i.test(sql)){releaseSuccessfulQuery=()=>send([{value:'完成'}]);return;}
    if(/KILL QUERY (\d+)/i.test(sql)){const id=Number(sql.match(/KILL QUERY (\d+)/i)[1]);delayed.get(id)?.();delayed.delete(id);return conn.writeOk({affectedRows:0});}
    if(/SELECT.*slow_export/i.test(sql)){delayed.set(connectionId,()=>{conn.writeError({code:1317,message:'Export interrupted'});conn._resetSequenceId();});return;}
    if(/SELECT.*many_rows/i.test(sql))return send(Array.from({length:10005},(_,i)=>({id:String(i+1)})));
    if(/^UPDATE/i.test(sql)){const affectedRows=nextWriteConflict?0:1;nextWriteConflict=false;return conn.writeOk({affectedRows});}
    if(/^CREATE.*INDEX/i.test(sql)&&failIndex){conn.writeError({code:1061,message:'Deliberate fixture index failure'});conn._resetSequenceId();return;}
    if(/^CREATE|^COMMENT|^ALTER TABLE|^SAVEPOINT/i.test(sql))return conn.writeOk({affectedRows:0});
    if(/SELECT.*9007199254740993/i.test(sql))return send([{big:'9007199254740993',amount:'123456789012345678.90',中文:'测试'}]);
    if(/workflow_bad/i.test(sql)){conn.writeError({code:1064,message:"Syntax error near workflow_bad at line 2"});conn._resetSequenceId();return;}
    if(/SELECT.*customers/i.test(sql))return send([{id:'1',name:'陈小北',balance:'1200.50'},{id:'2',name:'林夏',balance:'680.00'},{id:'3',name:'王晨',balance:'3200.00'}]);
    if(/SELECT.*NOW/i.test(sql))return send([{current_time:'2026-10-12 14:30:00'}]);
    if(/SELECT\s+1/i.test(sql))return send([{value:'1'}]);
    if(/COMMIT|ROLLBACK|USE|START TRANSACTION|^SET /i.test(sql))return conn.writeOk({affectedRows:0});
    conn.writeError({code:1064,message:'Protocol fixture does not execute this SQL'});
  };
  conn.on('query',sql=>{binary=false;query(sql);});
  const statements=new Map();let statementId=1;
  conn.on('stmt_prepare',sql=>{
    if(/^SET/i.test(sql)){conn.writeOk({affectedRows:0});return;}
    const id=statementId++, count=(sql.match(/\?/g)||[]).length;statements.set(id,sql);
    const packet=new Packet(0,Buffer.alloc(16),0,16);packet.offset=4;packet.writeInt8(0);packet.writeInt32(id);packet.writeInt16(0);packet.writeInt16(count);packet.writeInt8(0);packet.writeInt16(0);conn.writePacket(packet);
    for(let i=0;i<count;i++)conn.writePacket(Packets.ColumnDefinition.toPacket(definition('p'+i),conn.serverConfig.encoding));if(count)conn.writeEof(0,2);conn._resetSequenceId();
  });
  conn.on('stmt_execute',(id,flags,count,values)=>{binary=true;preparedLog.push({sql:statements.get(id),values});query(mysql.format(statements.get(id),values));});
});
await new Promise(resolve=>db.listen(0,'127.0.0.1',resolve));
const dbPort=db._server.address().port;
const aiServer=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{const parsed=JSON.parse(body);receivedAI.push({path:req.url,body:parsed,auth:req.headers.authorization});
if(parsed.tools){
 const latest=JSON.parse(parsed.messages.filter(m=>m.role==='user').at(-1).content).request;
 const called=parsed.messages.filter(m=>m.role==='tool').length;
 let name,args;
 if(/导出/.test(latest)){if(!called){name='export_table';args={table:'many_rows',format:/JSON/i.test(latest)?'json':'csv'};}}
 else if(/删除/.test(latest)){if(!called){name='prepare_sql';args={sql:'DELETE FROM customers',title:'删除草稿'};}}
 else if(called===0){name='find_tables';args={search:'商户'};}
 else if(called===1){name='describe_table';args={table:'customers'};}
 else if(called===2){name='query_sql';args={sql:'SELECT * FROM customers',title:'商户查询'};}
 const message=name?{role:'assistant',content:null,tool_calls:[{id:'fixture-'+called,type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{role:'assistant',content:'应用操作已完成，请查看结果标签或导出文件。'};
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message}]}));return;
}
res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{delta:{content:'### 字段说明\n\n- **状态**：`STATUS`\n\n| 字段 | 说明 |\n| --- | --- |\n| name | 姓名 |\n\n<script>window.mdInjected=true</script>\n![图片](https://invalid.example/no-fetch.png)\n\n```sql\nSELECT * FROM customers;\n```'}}]})+'\n\n');res.end('data: [DONE]\n\n');});});
await new Promise(resolve=>aiServer.listen(0,'127.0.0.1',resolve));
const env={...process.env,QUERYDESK_TEST_USER_DATA:path.join(work,'user-data')};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
  app=await electron.launch({executablePath:process.env.QUERYDESK_EXECUTABLE||electronPath,args:process.env.QUERYDESK_EXECUTABLE?[]:[project],env,timeout:60000});
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
  await expect(page.getByText('让数据工作，')).toBeVisible({timeout:60000});
  assert.equal(await page.evaluate(()=>performance.getEntriesByType('resource').some(r=>/EditorCore-|GridCore-|editor\.worker/.test(r.name))),false,'欢迎页不加载编辑器和表格运行时');
  await page.screenshot({path:path.join(work,'welcome.png')});
  await page.getByRole('button',{name:'新建数据库连接',exact:false}).click();
  await page.getByLabel('连接名称',{exact:false}).fill('开发数据库 · 协议测试');
  await page.getByLabel('主机',{exact:false}).fill('127.0.0.1');
  await page.getByLabel('端口',{exact:false}).fill(String(dbPort));
  await page.getByLabel('用户名',{exact:false}).fill('querydesk_test');
  await page.getByLabel('密码',{exact:false}).fill('test-password-not-real');
  await page.getByLabel('默认数据库（可选）').fill('querydesk_test');
  await page.getByRole('button',{name:'测试连接',exact:false}).click();
  await expect(page.getByText(/连接成功 ·/)).toBeVisible({timeout:20000});
  await page.getByRole('button',{name:'保存连接',exact:false}).click();
  await page.getByRole('button',{name:/开发数据库 · 协议测试/}).first().click();
  await expect(page.getByRole('button',{name:'运行',exact:false})).toBeVisible({timeout:30000});
  await page.locator('.ant-tree-treenode').filter({has:page.locator('.object-group-title')}).first().locator('.ant-tree-switcher').click();
  await expect(page.locator('.object-title').filter({hasText:'customers'})).toBeVisible({timeout:15000});
  await page.getByRole('button',{name:'运行',exact:false}).click();
  await expect(page.locator('.ag-cell').filter({hasText:'2026-10-12'})).toBeVisible({timeout:20000});
  const sqlEditor=page.locator('.tab-page:visible .editor-area .monaco-editor');
  const setSql=async text=>{await sqlEditor.click();await page.keyboard.press('Control+a');await page.keyboard.insertText(text);await expect(sqlEditor.locator('.view-lines')).toContainText(text.replace(/\r?\n/g,''));};
  if(!process.env.QUERYDESK_WORKSPACE_ONLY&&!process.env.QUERYDESK_KEYMAP_ONLY&&!process.env.QUERYDESK_WORKFLOW_ONLY){
  const successMark=sqlEditor.locator('.query-success-mark');
  await expect(successMark).toHaveCount(1);
  await expect(successMark).toHaveAttribute('title','执行成功');
  await setSql('SELECT 1;\nSELECT 1;');await expect(successMark).toHaveCount(0);
  await page.keyboard.press('Control+End');await page.keyboard.press('Control+Enter');await expect(successMark).toHaveCount(1);
  const markBox=await successMark.boundingBox(),lineBox=await sqlEditor.locator('.line-numbers').filter({hasText:/^2$/}).boundingBox();
  assert.ok(Math.abs(markBox.y-lineBox.y)<3,'重复 SQL 的成功标记应位于实际执行的第二行');
  await page.keyboard.press('Control+Home');await page.keyboard.press('Shift+End');await page.keyboard.press('Control+Enter');await expect(successMark).toHaveCount(1);
  const selectedBox=await successMark.boundingBox(),firstLineBox=await sqlEditor.locator('.line-numbers').filter({hasText:/^1$/}).boundingBox();
  assert.ok(Math.abs(selectedBox.y-firstLineBox.y)<3,'选区执行的成功标记应位于第一行');
  await page.getByRole('button',{name:'执行脚本',exact:true}).click();await expect(successMark).toHaveCount(2);
  await setSql('SELECT 1;\nINVALID_SQL');await page.getByRole('button',{name:'执行脚本',exact:true}).click();await expect(page.locator('.query-error')).toBeVisible();await expect(successMark).toHaveCount(0);
  await setSql('SELECT delayed_success');await page.keyboard.press('Control+Enter');await expect.poll(()=>typeof releaseSuccessfulQuery).toBe('function');
  await expect(successMark).toHaveCount(0);await page.keyboard.insertText(' ');releaseSuccessfulQuery();
  await expect(page.getByRole('button',{name:'运行',exact:false})).toBeEnabled();await expect(successMark).toHaveCount(0);
  // 验证真实 Monaco 候选、接受行为、模板占位符，以及补全不执行查询。
  const suggestions=page.locator('.suggest-widget.visible .monaco-list-row');
  const suggest=async()=>{await page.keyboard.press('Control+Space');await expect(suggestions.first()).toBeVisible({timeout:15000});};
  const queryCount=()=>sqlLog.filter(sql=>/^SELECT(?!.*information_schema)/i.test(sql)).length;
  const beforeCompletion=queryCount();
  await setSql('selec');await suggest();await expect(suggestions.first()).toContainText('SELECT');
  assert(!(await suggestions.allTextContents()).some(t=>t.includes('customers')));
  await page.keyboard.press('Tab');await expect(sqlEditor.locator('.view-lines')).toContainText('SELECT');
  await setSql('selECT');await page.keyboard.press('Control+Home');
  for(let i=0;i<3;i++)await page.keyboard.press('ArrowRight');
  await suggest();await page.keyboard.press('Tab');await expect(sqlEditor.locator('.view-lines')).toHaveText('SELECT');
  await setSql('SELECT * FROM cust');await suggest();await expect(suggestions.first()).toContainText('customers');
  await page.keyboard.press('Tab');await expect(sqlEditor.locator('.view-lines')).toContainText('SELECT * FROM customers');
  const beforeDescribe=sqlLog.filter(sql=>/information_schema\.COLUMNS/i.test(sql)).length;
  await setSql('SELECT c. FROM customers c');await page.keyboard.press('Control+Home');
  for(let i=0;i<9;i++)await page.keyboard.press('ArrowRight');
  await suggest();await expect(suggestions.filter({hasText:'name'}).first()).toBeVisible();
  assert(sqlLog.filter(sql=>/information_schema\.COLUMNS/i.test(sql)).length>beforeDescribe,'未展开对象树时按需读取字段');
  await page.screenshot({path:path.join(work,'completion-alias.png')});
  await page.keyboard.press('Escape');await setSql('selec');await suggest();
  const templateIndex=(await suggestions.allTextContents()).findIndex(t=>t.includes('SELECT · 查询模板'));assert(templateIndex>=0);
  for(let i=0;i<templateIndex;i++)await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');await expect(sqlEditor.locator('.view-lines')).toContainText('table_name');
  await page.keyboard.insertText('name');await page.keyboard.press('Tab');await page.keyboard.insertText('customers');
  await page.keyboard.press('Tab');await page.keyboard.insertText('id = 1');await page.keyboard.press('Tab');
  await expect(sqlEditor.locator('.view-lines')).toContainText('SELECT nameFROM customersWHERE id = 1;');
  assert.equal(queryCount(),beforeCompletion,'补全和模板不得自动执行 SQL');
  await setSql('SELECT * FROM');await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('dialog')).toContainText('SQL 完整性提示');
  assert.equal(queryCount(),beforeCompletion,'未完成语句确认前不得发送查询');
  await page.getByRole('button',{name:'继续编辑',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.equal(queryCount(),beforeCompletion,'返回编辑不得执行查询');
  await setSql('select 1');await page.keyboard.press('Control+Alt+l');await expect(sqlEditor.locator('.view-lines')).toContainText('SELECT');
  await page.keyboard.press('Control+z');await expect(sqlEditor.locator('.view-lines')).toContainText('select');
  await page.keyboard.press('Control+Shift+z');await expect(sqlEditor.locator('.view-lines')).toContainText('SELECT');
  await setSql('SELECT 1');await page.keyboard.press('Control+d');await expect(sqlEditor.locator('.view-line')).toHaveCount(2);
  await page.keyboard.press('Control+y');await expect(sqlEditor.locator('.view-line')).toHaveCount(1);
  await page.keyboard.press('Control+Home');await page.keyboard.press('Control+Slash');await expect(sqlEditor.locator('.view-lines')).toContainText('--');await page.keyboard.press('Control+Slash');
  await page.keyboard.press('Control+a');await page.keyboard.press('Control+Shift+Slash');await expect(sqlEditor.locator('.view-lines')).toContainText('/*');await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+r');await expect(sqlEditor.locator('.find-widget')).toBeVisible();await page.keyboard.press('Escape');
  for(const light of [false,true]){
    if(light)await page.getByRole('button',{name:'切换主题',exact:true}).click();
    await sqlEditor.click();await page.keyboard.press('Control+f');
    const closeFind=sqlEditor.locator('.find-widget .codicon-widget-close');await closeFind.hover();
    await expect(closeFind).toHaveAttribute('title',/Escape/);
    const hoverState=await closeFind.evaluate(async button=>{
      const samples=[];for(let i=0;i<12;i++){await new Promise(r=>setTimeout(r,80));const rect=button.getBoundingClientRect();const at=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);samples.push({buttonHit:at===button||button.contains(at),customTooltip:[...document.querySelectorAll('.workbench-hover')].some(n=>n.textContent?.includes('Escape')&&n.getBoundingClientRect().height>0)});}return samples;
    });
    assert.ok(hoverState.every(s=>s.buttonHit&&!s.customTooltip),'查找提示不得覆盖按钮或产生闪烁浮层');
    await closeFind.click();await expect(sqlEditor.locator('.find-widget')).not.toHaveClass(/visible/);
    await sqlEditor.click();await page.keyboard.press('Control+r');await expect(sqlEditor.locator('.find-widget')).toHaveClass(/visible/);await page.keyboard.press('Escape');await expect(sqlEditor.locator('.find-widget')).not.toHaveClass(/visible/);
    if(light)await page.getByRole('button',{name:'切换主题',exact:true}).click();
  }
  await page.keyboard.press('Control+w');await expect(page.locator('.workspace')).toBeVisible();await page.keyboard.press('Control+Shift+w');
  await setSql('SELECT 1');const keyboardQueries=sqlLog.filter(sql=>/^SELECT 1$/i.test(sql)).length;
  await page.keyboard.press('Control+Enter');await expect.poll(()=>sqlLog.filter(sql=>/^SELECT 1$/i.test(sql)).length).toBe(keyboardQueries+1);
  await expect(page.getByRole('button',{name:'运行',exact:false})).toBeEnabled();
  await setSql('SELECT SLEEP(30)');await page.keyboard.press('Control+Enter');await expect.poll(()=>delayed.size).toBe(1);await page.keyboard.press('Control+F2');await expect.poll(()=>delayed.size).toBe(0);
  await expect(page.getByRole('button',{name:'运行',exact:false})).toBeEnabled();await expect(successMark).toHaveCount(0);await setSql('SELECT 1');
  const queriesBeforeAI=sqlLog.length;await page.getByRole('textbox',{name:'AI 问题',exact:false}).fill('快捷键不应执行');await page.keyboard.press('Control+Enter');assert.equal(sqlLog.length,queriesBeforeAI);
  await page.getByRole('button',{name:'快捷键',exact:true}).click();await expect(page.getByText('DataGrip Windows 常用快捷键',{exact:true})).toBeVisible();await page.keyboard.press('Control+F4');await expect(page.locator('.workspace-tabs .ant-tabs-tab')).toHaveCount(1);await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'新建查询',exact:true}).click();await expect(page.locator('.workspace-tabs .ant-tabs-tab')).toHaveCount(2);
  await page.locator('.workspace-tabs .ant-tabs-tab-active').click();await page.keyboard.press('Alt+ArrowLeft');await expect(page.locator('.workspace-tabs .ant-tabs-tab-active')).toContainText('Console 1');
  await page.keyboard.press('Control+Tab');await expect(page.locator('.workspace-tabs .ant-tabs-tab-active')).toContainText('Console 2');
  await page.keyboard.press('Control+F4');await expect(page.locator('.workspace-tabs .ant-tabs-tab')).toHaveCount(1);
  const saved=await page.evaluate(()=>window.querydesk.call('settings.get'));
  assert.equal(saved.connections[0].hasPassword,true);assert.equal(saved.connections[0].password,undefined);
  const configText=fs.readFileSync(path.join(work,'user-data','settings.json'),'utf8');assert.ok(!configText.includes('test-password-not-real'));
  const recovered=await page.evaluate(async original=>{
    const profile={...original,id:'smoke-recovery',name:'恢复连接测试',user:'reject_fixture',password:'dummy-recovery'};
    await window.querydesk.call('connection.save',profile);let failed=false;
    try{await window.querydesk.call('session.open',{sessionId:'failed-recovery',connectionId:profile.id});}catch{failed=true;}
    await window.querydesk.call('connection.save',{...profile,user:'querydesk_test'});
    for(let i=0;i<3;i++){await window.querydesk.call('session.open',{sessionId:'recovered-'+i,connectionId:profile.id});await window.querydesk.call('session.close',{sessionId:'recovered-'+i,force:true});}
    await window.querydesk.call('connection.delete',{id:profile.id});return failed;
  },saved.connections[0]);assert.equal(recovered,true);
  const states=await page.evaluate(async connectionId=>{
    const a=await window.querydesk.call('session.open',{sessionId:'smoke-a',connectionId});
    const b=await window.querydesk.call('session.open',{sessionId:'smoke-b',connectionId});
    const a2=await window.querydesk.call('session.transaction',{sessionId:'smoke-a',action:'auto',value:false});
    const b2=await window.querydesk.call('session.state',{sessionId:'smoke-b'});
    const results=await window.querydesk.call('query.run',{sessionId:'smoke-b',sql:"SELECT '9007199254740993' AS big",params:{}});
    await window.querydesk.call('session.close',{sessionId:'smoke-a',force:true});await window.querydesk.call('session.close',{sessionId:'smoke-b',force:true});
    return {a2,b2,results};
  },saved.connections[0].id);
  assert.equal(states.a2.autoCommit,false);assert.equal(states.b2.autoCommit,true);assert.equal(states.results.results[0].rows[0].big,'9007199254740993');
  const connectionId=saved.connections[0].id;
  await page.evaluate(connectionId=>window.querydesk.call('session.open',{sessionId:'boundary',connectionId}),connectionId);
  const change={kind:'update',original:{id:'1',name:'陈小北',balance:'1200.50'},values:{id:'1',name:'测试修改',balance:'1200.50'}};
  const applied=await page.evaluate(changes=>window.querydesk.call('table.apply',{sessionId:'boundary',schema:'querydesk_test',table:'customers',changes}),[change]);
  assert.equal(applied.affected,1);assert.ok(preparedLog.some(p=>/^UPDATE/.test(p.sql)&&p.sql.includes('?')&&p.sql.includes('BINARY')&&p.values.includes('陈小北')));
  nextWriteConflict=true;const conflictStart=sqlLog.length;
  const conflict=await page.evaluate(async changes=>{try{await window.querydesk.call('table.apply',{sessionId:'boundary',schema:'querydesk_test',table:'customers',changes});return '';}catch(e){return e.message;}},[change]);
  assert.match(conflict,/其他会话修改/);assert.ok(sqlLog.slice(conflictStart).some(sql=>/^ROLLBACK/i.test(sql)));
  const pagination=await page.evaluate(async()=>{const response=await window.querydesk.call('query.run',{sessionId:'boundary',sql:'SELECT * FROM many_rows',params:{}});const result=response.results[0];const next=await window.querydesk.call('query.fetch',{sessionId:'boundary',resultId:result.id});return{initial:result.rows.length,next:next.rows.length,truncated:result.truncated};});
  assert.deepEqual(pagination,{initial:200,next:200,truncated:true});
  const drained=await page.evaluate(async()=>{
    const {results}=await window.querydesk.call('query.run',{sessionId:'boundary',sql:'SELECT * FROM many_rows; SELECT * FROM customers',params:{}});
    const first=results[0],ids=first.rows.map(row=>row.id);let batch=first;
    while(batch.hasMore){batch=await window.querydesk.call('query.fetch',{sessionId:'boundary',resultId:first.id});ids.push(...batch.rows.map(row=>row.id));}
    const exhausted=await window.querydesk.call('query.fetch',{sessionId:'boundary',resultId:first.id});
    return {ordered:ids.every((id,i)=>id===String(i+1)),count:ids.length,truncated:batch.truncated,exhausted:exhausted.rows.length,hasMore:exhausted.hasMore,other:results[1].rows.length};
  });
  assert.deepEqual(drained,{ordered:true,count:10000,truncated:true,exhausted:0,hasMore:false,other:3});
  await page.evaluate(()=>{window.__slowQuery=window.querydesk.call('query.run',{sessionId:'boundary',sql:'SELECT SLEEP(30)',params:{}});});
  await expect.poll(()=>delayed.size).toBe(1);
  await page.evaluate(()=>window.querydesk.call('query.cancel',{sessionId:'boundary'}));
  const cancelled=await page.evaluate(()=>window.__slowQuery);assert.match(cancelled.error,/interrupted/);
  const newTable={schema:'querydesk_test',name:'new_table',comment:'',columns:[{name:'id',type:'BIGINT',nullable:false,defaultValue:'',comment:'',primary:true}],indexes:[{name:'test_index',columns:['id'],unique:false}],foreignKeys:[]};
  // 对象列表夹具只有 customers；新建表的预期指纹为 null。
  failIndex=true;
  const ddl=await page.evaluate(after=>window.querydesk.call('ddl.execute',{sessionId:'boundary',before:null,after,fingerprint:'null'}),newTable);
  assert.equal(ddl.length,2);assert.equal(ddl[0].ok,true);assert.equal(ddl[1].ok,false);failIndex=false;
  await page.evaluate(()=>window.querydesk.call('session.close',{sessionId:'boundary',force:true}));
  await page.locator('.object-title').filter({hasText:'customers'}).click();await page.keyboard.press('F4');
  await expect(page.getByRole('button',{name:'新增行',exact:false})).toBeVisible({timeout:20000});
  await expect(page.locator('.tab-page:visible .ag-cell').filter({hasText:'陈小北'})).toBeVisible({timeout:15000});
  await page.screenshot({path:path.join(work,'table.png')});
  const object=page.locator('.object-title').filter({hasText:'customers'});
  await expect(page.getByRole('button',{name:'刷新对象',exact:true})).not.toHaveClass(/ant-btn-loading/);
  await expect(page.locator('.ant-tree-treenode-motion')).toHaveCount(0);
  await expect(async()=>{await page.mouse.move(700,180);await object.hover();await expect(page.getByRole('tooltip')).toContainText('协议测试数据，非真实数据库',{timeout:1500});}).toPass({timeout:10000});
  await object.click({button:'right'});await page.getByRole('menuitem',{name:'添加列',exact:true}).click();
  await expect(page.getByLabel('新字段 名称',{exact:true})).toBeFocused();
  await page.getByLabel('新字段 名称',{exact:true}).fill('extra_note');
  await page.getByRole('button',{name:'预览 SQL',exact:false}).click();
  await expect(page.locator('.ant-modal .view-lines')).toContainText(/ADD\s+COLUMN/);
  await page.locator('.ant-modal-footer').getByRole('button',{name:/关\s*闭/}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const tableNode=page.locator('.ant-tree-treenode').filter({has:object});
  if(!await page.locator('.column-leaf').count())await tableNode.locator('.ant-tree-switcher').click();
  const field=page.locator('.column-leaf').filter({has:page.getByText('name',{exact:true})});
  await expect(page.locator('.ant-tree-treenode-motion')).toHaveCount(0);
  await page.mouse.move(600,100);await field.hover();await expect(page.getByRole('tooltip')).toContainText('姓名');
  await page.mouse.move(600,100);await expect(page.getByRole('tooltip')).toBeHidden();
  await object.click();await page.keyboard.press('Control+F6');await expect(page.getByRole('dialog').getByText('修改表结构',{exact:true})).toBeVisible();await page.locator('.ant-modal-footer').getByRole('button',{name:/关\s*闭/}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await field.click({button:'right'});await page.getByRole('menuitem',{name:'修改列',exact:true}).click();
  await expect(page.getByLabel('name 类型',{exact:true})).toBeFocused();
  await page.getByLabel('name 注释',{exact:true}).fill('更新字段注释');
  await page.getByRole('button',{name:'预览 SQL',exact:false}).click();
  await expect(page.locator('.ant-modal .view-lines')).toContainText('更新字段注释');
  await page.locator('.ant-modal-footer').getByRole('button',{name:/关\s*闭/}).click();
  const describeCount=sqlLog.filter(sql=>/information_schema\.COLUMNS/i.test(sql)).length;
  await page.getByRole('button',{name:'刷新对象',exact:true}).click();
  await expect.poll(()=>sqlLog.filter(sql=>/information_schema\.COLUMNS/i.test(sql)).length).toBeGreaterThan(describeCount);
  await expect(field).toBeVisible();
  const firstName=page.locator('.tab-page:visible .ag-row[row-index="0"] .ag-cell[col-id="name"]');
  await firstName.dblclick();await page.locator('.tab-page:visible .ag-cell-inline-editing input').fill('取消保存测试');
  const writeCount=preparedLog.filter(p=>/^UPDATE/.test(p.sql)).length;
  await page.getByRole('button',{name:/保存变更/}).click();await expect(page.locator('.ant-modal-confirm-title').filter({hasText:'保存 1 行变更？'})).toBeVisible();
  await page.locator('.ant-modal-confirm').getByRole('button',{name:/取\s*消/}).click();
  assert.equal(preparedLog.filter(p=>/^UPDATE/.test(p.sql)).length,writeCount);
  await firstName.dblclick();await page.locator('.tab-page:visible .ag-cell-inline-editing input').fill('最终单元格输入');
  await page.keyboard.press('Control+Enter');await page.locator('.ant-modal-confirm').getByRole('button',{name:/保\s*存/}).click();
  await expect(page.getByText('1 行已提交',{exact:true})).toBeVisible();
  assert.ok(preparedLog.filter(p=>/^UPDATE/.test(p.sql)).at(-1).values.includes('最终单元格输入'));
  await expect(page.getByRole('button',{name:/保存变更/})).toBeDisabled();
  await firstName.dblclick();await page.locator('.tab-page:visible .ag-cell-inline-editing input').fill('冲突保留测试');nextWriteConflict=true;
  await page.getByRole('button',{name:/保存变更/}).click();await page.locator('.ant-modal-confirm').getByRole('button',{name:/保\s*存/}).click();
  await expect(page.locator('.tab-page:visible .ant-alert-error')).toContainText('其他会话修改');
  await expect(firstName).toHaveText('冲突保留测试');
  await firstName.click();await page.keyboard.press('Control+Alt+z');
  await expect(page.locator('.ant-modal-confirm-title').filter({hasText:'放弃尚未保存的表格变更？'})).toBeVisible();
  await page.locator('.ant-modal-confirm').getByRole('button',{name:'放弃变更',exact:true}).click();
  await expect(firstName).toHaveText('陈小北');
  await firstName.dblclick();await page.locator('.tab-page:visible .ag-cell-inline-editing input').fill('未结束编辑刷新');await page.keyboard.press('Control+F5');await expect(page.locator('.ant-modal-confirm-title')).toContainText('放弃');await page.locator('.ant-modal-confirm').getByRole('button',{name:/取\s*消/}).click();await expect(firstName).toHaveText('未结束编辑刷新');
  await firstName.click();await page.keyboard.press('Control+Alt+n');await expect(firstName).toHaveText('NULL');
  await page.keyboard.press('Control+F5');await page.locator('.ant-modal-confirm').getByRole('button',{name:'放弃变更',exact:true}).click();await expect(firstName).toHaveText('陈小北');
  await firstName.click();await page.keyboard.press('Alt+Insert');await expect(page.locator('.tab-page:visible .ag-center-cols-container .ag-row')).toHaveCount(4);
  await page.keyboard.press('Control+F5');await page.locator('.ant-modal-confirm').getByRole('button',{name:'放弃变更',exact:true}).click();await expect(page.locator('.tab-page:visible .ag-center-cols-container .ag-row')).toHaveCount(3);

  await page.getByRole('button',{name:'创建数据表',exact:false}).click();
  await page.getByRole('textbox',{name:'表名称',exact:false}).fill('smoke_table');
  await page.getByRole('button',{name:'预览 SQL',exact:false}).click();
  await expect(page.locator('.ant-modal').getByText(/DDL 可能隐式提交/)).toBeVisible();
  await page.screenshot({path:path.join(work,'designer.png')});
  await page.locator('.ant-modal-footer').getByRole('button',{name:/关\s*闭/}).click();
  const aiPort=aiServer.address().port;
  await page.evaluate(async ({port})=>window.querydesk.call('ai.save',{baseUrl:`http://127.0.0.1:${port}/v1`,model:'protocol-test-model',apiKey:'test-ai-key-not-real'}),{port:aiPort});
  // 通过设置界面刷新 React 配置，并验证密钥不会回传。
  await page.getByRole('button',{name:'AI 模型设置',exact:false}).click();
  await page.getByLabel('API 根地址',{exact:false}).fill(`http://127.0.0.1:${aiPort}/v1/chat/completions/`);
  await page.getByLabel('模型名称',{exact:false}).fill('protocol-test-model');
  await page.getByRole('button',{name:'测试连接',exact:true}).click();
  await expect(page.getByText('模型连接成功',{exact:true})).toBeVisible({timeout:15000});
  assert.equal(receivedAI[0].path,'/v1/chat/completions');receivedAI.length=0;
  await page.getByRole('button',{name:'保存设置',exact:false}).click();
  await page.getByRole('button',{name:'新建查询',exact:true}).click();
  await expect(page.locator('.tab-page:visible .monaco-editor')).toBeVisible();
  await page.locator('.ant-select[aria-label="AI 操作"]').click();
  await page.locator('.ant-select-dropdown:visible').getByText('生成 SQL',{exact:true}).click();
  await page.getByRole('textbox',{name:'AI 问题',exact:false}).fill('读取客户列表');
  await page.getByRole('button',{name:'预览并发送',exact:false}).click();
  await expect(page.getByText('确认发送给模型的上下文',{exact:false})).toBeVisible();
  const before=sqlLog.length;
  await page.getByRole('button',{name:'发送给模型',exact:false}).click();
  await expect(page.getByRole('button',{name:'插入编辑器',exact:false})).toBeVisible({timeout:15000});
  await expect(page.locator('.ai-markdown h3')).toHaveText('字段说明');
  await expect(page.locator('.ai-markdown li code')).toHaveText('STATUS');
  await expect(page.locator('.ai-markdown table')).toContainText('姓名');
  await expect(page.locator('.ai-markdown pre code')).toContainText('SELECT * FROM customers;');
  assert.equal(await page.locator('.ai-markdown script, .ai-markdown img').count(),0);
  assert.equal(await page.evaluate(()=>window.mdInjected),undefined);
  await page.screenshot({path:path.join(work,'markdown.png')});
  assert.equal(sqlLog.length,before,'AI 不得调用数据库');assert.equal(receivedAI[0].path,'/v1/chat/completions');assert.deepEqual(JSON.parse(receivedAI[0].body.messages[1].content).context.rows,[]);
  const editorCount=await page.locator('.monaco-editor').count();
  for(let i=0;i<2;i++){
    await page.getByRole('button',{name:'对比替换',exact:true}).click();
    await expect(page.getByRole('dialog').locator('.monaco-diff-editor')).toBeVisible();
    await page.getByRole('dialog').getByRole('button',{name:/取\s*消/}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.monaco-editor')).toHaveCount(editorCount);
  }
  await page.evaluate(()=>{window.agentEvents=[];window.querydesk.onAI(event=>window.agentEvents.push(event));});
  await page.locator('.ant-select[aria-label="AI 操作"]').click();await page.locator('.ant-select-dropdown:visible').getByText('直接操作应用',{exact:true}).click();
  await page.getByRole('textbox',{name:'AI 问题',exact:false}).fill('查询商户表');
  await page.getByRole('button',{name:'发送并执行',exact:false}).click();
  await expect(page.getByText('✓ 已执行并打开：AI · 商户查询',{exact:true})).toBeVisible({timeout:20000});
  await expect(page.locator('.tab-page:visible .ag-cell').filter({hasText:'陈小北'})).toBeVisible({timeout:15000});
  await expect(page.getByRole('button',{name:'发送并执行',exact:false})).toBeEnabled({timeout:15000});
  await expect(page.locator('.tab-page:visible .query-success-mark')).toHaveCount(1);
  const opened=await page.evaluate(()=>window.agentEvents.find(e=>e.opened).opened);
  assert.equal(opened.info.readOnly,true);
  const forbidden=await page.evaluate(async id=>{const r=await window.querydesk.call('query.run',{sessionId:id,sql:'DELETE FROM customers',params:{}}).catch(e=>({error:e.message}));return r.error;},opened.sessionId);assert.match(forbidden,/只读|草稿/);
  await page.getByRole('textbox',{name:'AI 问题',exact:false}).fill('导出 many_rows 表为 CSV');
  await page.getByRole('button',{name:'发送并执行',exact:false}).click();
  await expect(page.getByText('已导出 10,005 行',{exact:true})).toBeVisible({timeout:25000});
  await expect(page.getByRole('button',{name:'发送并执行',exact:false})).toBeEnabled({timeout:15000});
  const exported=await page.evaluate(()=>window.agentEvents.filter(e=>e.file).at(-1).file);
  assert.equal(exported.rows,10005);assert.ok(exported.path.startsWith(path.join(work,'user-data','exports')));
  const data=fs.readFileSync(exported.path,'utf8');assert.ok(data.includes('"10005"'));assert.equal(data.trimEnd().split('\r\n').length,10006);
  await page.getByRole('textbox',{name:'AI 问题',exact:false}).fill('导出 many_rows 表为 JSON');
  await page.getByRole('button',{name:'发送并执行',exact:false}).click();
  await expect(page.getByText('已导出 10,005 行',{exact:true})).toBeVisible({timeout:25000});
  await expect(page.getByRole('button',{name:'发送并执行',exact:false})).toBeEnabled({timeout:15000});
  const jsonFile=await page.evaluate(()=>window.agentEvents.filter(e=>e.file).at(-1).file);
  assert.ok(jsonFile.name.endsWith('.json'));assert.equal(JSON.parse(fs.readFileSync(jsonFile.path,'utf8')).length,10005);
  const writesBefore=sqlLog.filter(sql=>/^DELETE/i.test(sql)).length;
  await page.getByRole('textbox',{name:'AI 问题',exact:false}).fill('删除商户数据');
  await page.getByRole('button',{name:'发送并执行',exact:false}).click();
  await expect(page.getByText('✓ 已打开未执行草稿：待确认 · 删除草稿',{exact:true})).toBeVisible({timeout:20000});
  assert.equal(sqlLog.filter(sql=>/^DELETE/i.test(sql)).length,writesBefore);
  const toolRequests=receivedAI.filter(r=>r.body.tools);assert.ok(toolRequests.length>=4);assert.ok(!JSON.stringify(toolRequests).includes('陈小北'),'结果数据不得自动发送给模型');
  await page.screenshot({path:path.join(work,'agent.png')});
  const jdbc=await page.evaluate(()=>window.querydesk.call('client.inspect',{path:''}));assert.match(jdbc.message,/JDBC Thin/);
  await page.getByRole('button',{name:'切换主题',exact:false}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.screenshot({path:path.join(work,'light.png')});
  await page.getByRole('button',{name:'切换主题',exact:false}).click();
  await page.screenshot({path:path.join(work,'workspace.png')});
  }
  const security=await app.evaluate(({BrowserWindow})=>{const p=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();return {sandbox:p.sandbox,contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration};});
  assert.deepEqual(security,{sandbox:true,contextIsolation:true,nodeIntegration:false});
  const workflowChecks=await workflowSmoke({app,page,work,sqlLog,preparedLog,receivedAI,aiPort:aiServer.address().port});
  const keymapChecks=process.env.QUERYDESK_WORKFLOW_ONLY?[]:await keymapSmoke({page,work,sqlLog});
  const workspaceResult=process.env.QUERYDESK_KEYMAP_ONLY||process.env.QUERYDESK_WORKFLOW_ONLY?{app,checks:[]}:await workspaceSmoke({app,page,work,sqlLog,errors,relaunch:async()=>{app=await electron.launch({executablePath:process.env.QUERYDESK_EXECUTABLE||electronPath,args:process.env.QUERYDESK_EXECUTABLE?[]:[project],env,timeout:60000});return app;}});app=workspaceResult.app;
  const actualErrors=errors.filter(e=>!e.includes('Download the React DevTools'));
  assert.deepEqual(actualErrors,[]);
  const report={passed:true,kind:'Electron + MySQL 协议夹具 + 本地 AI SSE 夹具；不等价于真实数据库验收',work,checks:[...workflowChecks,...keymapChecks,...workspaceResult.checks,...(process.env.QUERYDESK_WORKSPACE_ONLY||process.env.QUERYDESK_KEYMAP_ONLY||process.env.QUERYDESK_WORKFLOW_ONLY?[]:['关键字优先及 Tab 接受','FROM 表名上下文补全','别名字段按需加载','SQL 模板占位符 Tab 填写且不自动执行','未完成 SQL 提示与返回编辑','成功对号定位当前语句选区和脚本','编辑执行中修改失败取消清除成功标记','AI 已执行结果带成功标记','欢迎页按需加载编辑器和表格','完整分页顺序及已读取缓存释放后多结果集可用','差异弹窗关闭释放编辑器及重复打开','深浅主题查找提示不遮挡与连续采样无自定义浮层','查找关闭按钮及 Escape/替换快捷键保持可用','DataGrip 编辑器格式化注释复制删行重做查找键位','Ctrl+Enter 查询及 Ctrl+F2 取消','AI 输入和弹窗快捷键隔离','标签切换及 Ctrl+F4 关闭','对象 F4 打开及 Ctrl+F6 修改结构','表格快捷键提交刷新新增 NULL 和撤销草稿','刷新对象重新读取字段元数据','注释悬浮提示','表右键添加列及 SQL 预览','字段右键修改列及注释预览','保存确认与取消不写入','保存包含最新编辑值并显示提交状态','界面冲突提示及保留草稿','放弃变更确认','Markdown 标题列表表格代码及禁用 HTML/外部图片','窗口渲染','连接表单和驱动协议','Windows 密钥加密','连接失败后修复及连续重连','对象树','SQL 查询','大整数保留','多会话提交模式隔离','参数化表格修改','并发冲突触发回滚','200 行分批加载与 10000 行上限','取消查询','DDL 部分失败逐条返回','数据浏览','建表 SQL 预览','AI SSE 与默认上下文','建议模式不执行 SQL','直接操作打开只读结果','整表 CSV / JSON 导出超过 10000 行','写入只打开草稿','结果不回传模型','内置 JDBC 驱动启动','深浅主题','Electron 沙箱'])],security,rendererErrors:actualErrors};
  fs.writeFileSync(path.join(work,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(e){if(app){const page=await app.firstWindow().catch(()=>null);await page?.screenshot({path:path.join(work,'failure.png')}).catch(()=>{});}console.error('SMOKE FAILED',e);console.error('Renderer errors:',errors);console.error('Fixture SQL tail:',sqlLog.slice(-8));console.error('AI paths:',receivedAI.map(r=>r.path));console.error('Artifacts:',work);process.exitCode=1;}
finally{if(app){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>{});await app.close().catch(()=>{});}for(const c of sockets)c.destroy();await new Promise(r=>db.close(r));await new Promise(r=>aiServer.close(r));}
