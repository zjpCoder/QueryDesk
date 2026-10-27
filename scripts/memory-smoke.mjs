// 独立配置 + 本地 MySQL 协议夹具；不连接用户数据库，不强制 GC 或清空工作集。
import { _electron, expect } from '@playwright/test';
import mysql from 'mysql2';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),mysqlRoot=path.dirname(require.resolve('mysql2'));
const Packet=require(path.join(mysqlRoot,'lib/packets/packet.js')),Packets=require(path.join(mysqlRoot,'lib/packets/index.js'));
const executablePath=process.env.QUERYDESK_EXECUTABLE;
if(!executablePath)throw new Error('请指定 QUERYDESK_EXECUTABLE');
const work=path.resolve('.cache/memory-'+Date.now());fs.mkdirSync(work,{recursive:true});
const db=mysql.createServer(),sockets=new Set();
db.on('connection',conn=>{
  sockets.add(conn);conn.on('error',()=>{});conn.stream.on('close',()=>sockets.delete(conn));
  const ok=conn.writeOk.bind(conn);conn.writeOk=args=>{ok(args);conn._resetSequenceId();};
  conn.serverHandshake({protocolVersion:10,serverVersion:'8.0.36-memory-fixture',connectionId:1,statusFlags:2,characterSet:45,capabilityFlags:0x0008f7ff,authCallback:(_,cb)=>cb(null)});
  const send=(rows,names=Object.keys(rows[0]??{}))=>{conn.writeColumns(names.map(name=>({catalog:'def',schema:'memory_test',table:'',orgTable:'',name,orgName:name,characterSet:45,columnLength:1024,columnType:253,flags:0,decimals:0})));for(const row of rows)conn.writeTextRow(names.map(n=>row[n]==null?null:String(row[n])));conn.writeEof(0,2);conn._resetSequenceId();};
  conn.on('query',sql=>{
    if(/VERSION\(\)/i.test(sql))return send([{version:'8.0.36 fixture',db:'memory_test'}]);
    if(/SHOW DATABASES/i.test(sql))return send([{Database:'memory_test'}]);
    if(/information_schema/i.test(sql))return send([],['name']);
    if(/SELECT/i.test(sql))return send(Array.from({length:200},(_,i)=>({id:String(i),name:'内存测试数据 '+i})));
    conn.writeOk({affectedRows:0});conn._resetSequenceId();
  });
  let statementId=1;
  conn.on('stmt_prepare',sql=>{
    const count=(sql.match(/\?/g)||[]).length,packet=new Packet(0,Buffer.alloc(16),0,16);packet.offset=4;packet.writeInt8(0);packet.writeInt32(statementId++);packet.writeInt16(0);packet.writeInt16(count);packet.writeInt8(0);packet.writeInt16(0);conn.writePacket(packet);
    for(let i=0;i<count;i++)conn.writePacket(Packets.ColumnDefinition.toPacket({catalog:'def',schema:'memory_test',table:'',orgTable:'',name:'p'+i,orgName:'',characterSet:45,columnLength:1024,columnType:253,flags:0,decimals:0},conn.serverConfig.encoding));
    if(count)conn.writeEof(0,2);conn._resetSequenceId();
  });
  conn.on('stmt_execute',()=>send([],['name']));
});
await new Promise(r=>db.listen(0,'127.0.0.1',r));
const env={...process.env,QUERYDESK_TEST_USER_DATA:path.join(work,'profile')};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
  app=await _electron.launch({executablePath,env});const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push({message:e.message,stack:e.stack}));
  await expect(page.getByText('让数据工作，')).toBeVisible({timeout:30000});
  const version=await app.evaluate(({app})=>app.getVersion());
  const stages=[];
  async function measure(name){
    await page.waitForTimeout(3000);
    const samples=[];
    for(let i=0;i<5;i++){
      samples.push(await app.evaluate(({app})=>app.getAppMetrics().map(p=>({type:p.type,name:p.name,pid:p.pid,privateKiB:p.memory.privateBytes,workingSetKiB:p.memory.workingSetSize}))));
      await page.waitForTimeout(500);
    }
    const totals=samples.map(s=>s.reduce((sum,p)=>sum+p.privateKiB,0)/1024).sort((a,b)=>a-b);
    stages.push({name,medianPrivateMiB:totals[2],samples,domEditors:await page.locator('.monaco-editor').count()});
    console.log(name,totals[2].toFixed(1)+' MiB');
  }
  await measure('welcome');
  await page.evaluate(port=>window.querydesk.call('connection.save',{id:'memory-fixture',name:'内存测试',dialect:'mysql',group:'测试',host:'127.0.0.1',port,user:'fixture',password:'fixture',database:'memory_test',oracleMode:'service',clientPath:'',tls:false,caPath:''}),db._server.address().port);
  await page.reload();
  for(let i=0;i<3;i++){
    await page.getByRole('button',{name:/内存测试/}).first().click();
    await expect(page.locator('.workspace-tabs .ant-tabs-tab')).toHaveCount(i+1);
    await expect(page.locator('.tab-page:visible .editor-area .monaco-editor')).toBeVisible();
    await page.locator('.tab-page:visible').getByRole('button',{name:'运行',exact:false}).click();
    await expect(page.locator('.tab-page:visible .ag-cell').filter({hasText:'内存测试数据 0'})).toBeVisible();
    if(i===0)await measure('one-query-200-rows');
  }
  await measure('three-query-tabs');
  for(let i=0;i<3;i++){
    await page.locator('.tab-page:visible .editor-area .monaco-editor').click();await page.keyboard.press('Control+F4');
    await expect(page.locator('.workspace-tabs .ant-tabs-tab')).toHaveCount(2-i);
  }
  await expect(page.getByText('让数据工作，')).toBeVisible();
  await expect(page.locator('.monaco-editor')).toHaveCount(0);
  await measure('tabs-closed');
  const report={version,kind:'同机独立配置，Electron 所有进程 privateBytes 合计中位数，5 次采样；无强制 GC，非任务管理器相同口径，不含 JDBC，200 行协议夹具',stages,rendererErrors:errors};
  fs.writeFileSync(path.join(work,'report.json'),JSON.stringify(report,null,2));console.log('Report: '+path.join(work,'report.json'));
}catch(error){
  if(app){const page=await app.firstWindow();await page.screenshot({path:path.join(work,'failure.png')});console.log('Failure artifacts: '+work);console.log(await page.locator('.tab-page').evaluateAll(nodes=>nodes.map(n=>({style:n.getAttribute('style'),rect:n.getBoundingClientRect().toJSON(),buttons:[...n.querySelectorAll('.query-toolbar button')].map(b=>({text:b.textContent,rect:b.getBoundingClientRect().toJSON()}))}))));}
  throw error;
}finally{
  if(app){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>{});await app.close().catch(()=>{});}
  for(const conn of sockets)conn.destroy();await new Promise(r=>db.close(r));
}
