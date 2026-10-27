"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require(process.env.QUERYDESK_PLAYWRIGHT || "playwright");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "querydesk-safety-ui-"));
const profile = {id:"prod",name:"生产数据库",environment:"production",readOnly:false,group:"我的连接",dialect:"mysql",host:"demo.invalid",port:3306,user:"demo",database:"app",oracleMode:"service",clientPath:"",tls:false,caPath:""};
fs.writeFileSync(path.join(temp,"settings.json"), JSON.stringify({connections:[profile,{...profile,id:"old",name:"旧连接",environment:undefined,readOnly:undefined}],ai:{baseUrl:"https://example.invalid/v1",model:""},theme:"champagne",history:[]}));
let app;
(async()=>{
  try {
    const env={...process.env,QUERYDESK_TEST_USER_DATA:temp};
    delete env.ELECTRON_RUN_AS_NODE;
    app=await _electron.launch({executablePath:process.env.QUERYDESK_TEST_EXE||path.join(root,"theme-test/QueryDesk.exe"),env});
    const page=await app.firstWindow();
    page.setDefaultTimeout(7000);
    const errors=[];
    page.on("pageerror",error=>errors.push(error.message));
    await app.evaluate(({utilityProcess,dialog,BrowserWindow})=>{
      BrowserWindow.getAllWindows()[0].setContentSize(1558,1010);
      globalThis.safetyCalls=[];
      globalThis.safetyDialogs=[];
      globalThis.safetyResponse=0;
      dialog.showMessageBox=async (_,options)=>{globalThis.safetyDialogs.push(options);return {response:globalThis.safetyResponse};};
      // 只模拟数据库工作进程；连接存储、参数校验和执行保护均走真实主进程。
      utilityProcess.fork=()=>{
        const listeners=new Map();
        const worker={on:(name,listener)=>{listeners.set(name,listener);},emit:(name,message)=>listeners.get(name)?.(message)};
        const states=new Map();
        worker.kill=()=>{worker.emit("exit",0);};
        worker.postMessage=({id,method,payload:p})=>{
          globalThis.safetyCalls.push({method,payload:p});
          let value,error;
          const state=states.get(p.sessionId);
          if(method==="session.open"||method==="session.reconnect"){
            value={connected:true,readOnly:!!p.profile.readOnly,autoCommit:!p.profile.readOnly,dirty:false,needsRollback:false,schema:p.profile.database,version:"MySQL · 隔离测试"};
            states.set(p.sessionId,value);
          }else if(method==="session.close"){states.delete(p.sessionId);value={};}
          else if(method==="session.state")value=state;
          else if(method==="schema.list")value=["app"];
          else if(method==="object.list")value=[{name:"merchant",schema:"app",kind:"table"}];
          else if(method==="query.run")value={results:[{id:"result-1",sql:p.sql,schema:"app",columns:["ID"],rows:[{ID:42}],affected:0,elapsed:1,hasMore:false,truncated:false}],state};
          else if(method==="query.cancel")value=state;
          else error="测试未实现："+method;
          setImmediate(()=>worker.emit("message",error?{id,ok:false,error}:{id,ok:true,value}));
        };
        return worker;
      };
    });
    await page.locator(".connection-item").filter({hasText:"旧连接"}).locator(".env-unspecified").waitFor();
    await page.getByRole("button",{name:"旧连接菜单",exact:true}).hover();
    await page.getByRole("menuitem",{name:"编辑连接",exact:true}).waitFor({state:"visible"});
    await page.getByRole("menuitem",{name:"编辑连接",exact:true}).dispatchEvent("click");
    const modal=page.locator(".ant-modal-content:visible");
    assert.equal(await modal.locator("#readOnly").getAttribute("aria-checked"),"false");
    assert.match(await modal.innerText(),/未标记/);
    await modal.getByRole("button",{name:/取\s*消/}).click();
    await page.getByRole("button",{name:"新建连接",exact:true}).click();
    await modal.locator("#name").fill("生产只读");
    await modal.locator("#host").fill("demo.invalid");
    await modal.locator("#user").fill("demo");
    await modal.locator("#database").fill("app");
    await modal.locator(".ant-select").filter({has:page.locator("#environment")}).click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({hasText:/^生产$/}).click();
    await modal.locator("#readOnly").click();
    await page.waitForFunction(()=>document.getElementById("readOnly")?.getAttribute("aria-checked")==="true");
    await page.waitForTimeout(250);
    await page.screenshot({path:path.join(root,"design/connection-safety-settings.png")});
    await modal.getByRole("button",{name:"保存连接",exact:true}).click();
    await page.locator(".connection-main").filter({hasText:"生产只读"}).waitFor();
    let settings=JSON.parse(fs.readFileSync(path.join(temp,"settings.json")));
    assert.equal(settings.connections.find(p=>p.name==="生产只读").readOnly,true);
    assert.equal(settings.connections.find(p=>p.name==="生产只读").environment,"production");
    await page.reload();
    const readOnlyConnection=page.locator(".connection-main").filter({hasText:"生产只读"});
    await readOnlyConnection.locator(".connection-readonly").waitFor();
    await readOnlyConnection.click();
    await page.locator(".connection-strip").getByText("只读连接",{exact:true}).waitFor();
    assert.equal(await page.locator(".autocommit button").isDisabled(),true);
    await page.locator(".workspace-tabs .connection-readonly").waitFor();
    // 直接调用真实 IPC，确认只读策略在数据库工作进程之前拒绝写入。
    const roSession=await app.evaluate(()=>globalThis.safetyCalls.find(c=>c.method==="session.open").payload.sessionId);
    await assert.rejects(page.evaluate(id=>window.querydesk.call("query.run",{sessionId:id,sql:"DELETE FROM merchant"}),roSession),/只读连接/);
    assert.equal(await app.evaluate(()=>globalThis.safetyCalls.filter(c=>c.method==="query.run").length),0);
    await page.locator(".connection-main").filter({hasText:"生产数据库"}).click();
    await page.locator(".connection-strip").getByText("生产数据库",{exact:true}).waitFor();
    const activeEditor=page.locator(".tab-page:visible .monaco-editor");
    async function sql(text){
      await activeEditor.click({position:{x:160,y:30}});
      await page.keyboard.press("Control+A");
      await page.keyboard.insertText(text);
    }
    await sql("SELECT 42 AS ID;");
    await page.locator(".tab-page:visible .query-toolbar .ant-btn-primary").click();
    await page.locator(".tab-page:visible .ag-row").first().waitFor();
    const runCount=()=>app.evaluate(()=>globalThis.safetyCalls.filter(c=>c.method==="query.run").length);
    assert.equal(await runCount(),1);
    await sql("SELECT 1; DELETE FROM merchant;");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Control+Enter");
    await page.getByText("已取消执行，未发送本次操作",{exact:true}).waitFor();
    assert.equal(await runCount(),1,"取消时整批均不执行");
    await page.locator(".tab-page:visible .ag-row").first().waitFor();
    assert.equal(await app.evaluate(()=>globalThis.safetyDialogs.length),1);
    assert.match(await app.evaluate(()=>globalThis.safetyDialogs[0].message),/生产环境/);
    await app.evaluate(()=>{globalThis.safetyResponse=1;});
    await page.keyboard.press("Control+Enter");
    await page.waitForFunction(()=>!document.querySelector(".tab-page:not([style*='none']) .query-toolbar .ant-btn-loading"));
    assert.equal(await runCount(),2,"确认后仅执行一次");
    for(const [key,label] of [["light","经典紫"],["studio","清透紫"],["champagne","香槟金"]]){
      await page.getByRole("button",{name:"选择主题",exact:true}).click();
      await page.getByRole("menuitem",{name:new RegExp(label)}).click();
      await page.waitForFunction(key=>document.documentElement.dataset.variant===key,key);
      await page.locator(".production-strip .env-production").waitFor();
      await page.screenshot({path:path.join(root,`design/connection-safety-${key}.png`)});
    }
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1100,760));
    await page.waitForTimeout(250);
    const bounds=await page.locator(".connection-strip").evaluate(el=>Array.from(el.querySelectorAll("button,.connection-environment")).map(child=>{const r=child.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}));
    assert.ok(bounds.every(Boolean),"窄窗口连接栏操作和环境标识必须可见");
    await page.screenshot({path:path.join(root,"design/connection-safety-1100.png")});
    const activeSession=await app.evaluate(()=>globalThis.safetyCalls.filter(c=>c.method==="session.open").at(-1).payload.sessionId);
    const beforePolicy=await runCount();
    settings=JSON.parse(fs.readFileSync(path.join(temp,"settings.json")));
    settings.connections.find(p=>p.id==="prod").readOnly=true;
    fs.writeFileSync(path.join(temp,"settings.json"),JSON.stringify(settings));
    await assert.rejects(page.evaluate(id=>window.querydesk.call("query.run",{sessionId:id,sql:"DELETE FROM merchant WHERE ID=1"}),activeSession),/只读连接/);
    assert.equal(await runCount(),beforePolicy,"存量会话必须遵守最新保存的只读策略");
    assert.deepEqual(errors,[]);
    console.log("通过：实际设置表单及保存/重载、旧配置默认值、三处环境标识、只读状态及真实 IPC 阻断、快捷键整批检查、取消保留结果、确认单次执行、三主题与窄窗口，无前端异常。");
  }catch(error){
    console.error("界面验证失败：",error);
    throw error;
  }finally{
    if(app){
      const exited=new Promise(resolve=>app.process().once("exit",resolve));
      await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
      await exited;
    }
    fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
