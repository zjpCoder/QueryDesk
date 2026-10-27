"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {_electron} = require(process.env.QUERYDESK_PLAYWRIGHT || "playwright");
const root=path.resolve(__dirname,"..");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"querydesk-ddl-ui-"));
const profile={id:"ddl-demo",name:"DDL 测试",dialect:"oracle",host:"demo.invalid",port:1521,database:"APP",user:"APP",readOnly:true};
fs.writeFileSync(path.join(temp,"settings.json"),JSON.stringify({connections:[profile],ai:{model:"",baseUrl:"https://example.invalid/v1"},theme:"champagne",history:[]}));
let app;
(async()=>{
  try{
    const env={...process.env,QUERYDESK_TEST_USER_DATA:temp};delete env.ELECTRON_RUN_AS_NODE;
    app=await _electron.launch({executablePath:path.join(root,"theme-test/QueryDesk.exe"),env});
    const page=await app.firstWindow();page.setDefaultTimeout(10000);
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await app.evaluate(({ipcMain,BrowserWindow})=>{
      BrowserWindow.getAllWindows()[0].setContentSize(1440,900);
      const original=ipcMain._invokeHandlers.get("querydesk:call");globalThis.ddlCalls=[];
      ipcMain.removeHandler("querydesk:call");
      ipcMain.handle("querydesk:call",(event,method,payload)=>{
        globalThis.ddlCalls.push({method,payload});let value;
        if(["session.open","session.state"].includes(method))value={connected:true,autoCommit:false,readOnly:true,dirty:false,needsRollback:false,schema:"APP",version:"Oracle 隔离测试"};
        else if(method==="session.schema")value={connected:true,autoCommit:false,readOnly:true,dirty:false,schema:payload.schema};
        else if(method==="session.close")value={};
        else if(method==="schema.list")value=["APP","OTHER"];
        else if(method==="object.list")value=["MERCHANT","ORDERS","FAIL"].map(name=>({name,schema:payload.schema,kind:"table"}));
        else if(method==="object.source"){
          if(payload.table==="FAIL")return {ok:false,error:"无权读取测试表定义"};
          value=`CREATE TABLE "${payload.schema}"."${payload.table}" (\n  "ID" NUMBER NOT NULL,\n  CONSTRAINT "PK_${payload.table}" PRIMARY KEY ("ID")\n);\nCREATE INDEX "IX_${payload.table}" ON "${payload.schema}"."${payload.table}" ("ID");`;
        }else return original(event,method,payload);
        return {ok:true,value};
      });
    });
    await page.locator(".connection-main").click();
    await page.locator(".object-tree .ant-tree-switcher_close").first().click();
    const merchant=page.getByText("MERCHANT",{exact:true});await merchant.click();
    await page.keyboard.press("Control+b");
    await page.locator(".tab-name").filter({hasText:"MERCHANT (DDL)"}).waitFor();
    const activeEditor=()=>page.locator(".monaco-editor:visible").first();
    await page.waitForFunction(()=>[...document.querySelectorAll(".monaco-editor")].some(el=>el.getBoundingClientRect().height>0&&/CREATE\s+TABLE/.test(el.querySelector(".view-lines")?.textContent??"")));
    assert.equal(await page.locator(".ant-modal-wrap:visible").count(),0,"应打开编辑器标签而非弹窗");
    assert.equal(await page.locator(".tab-name").count(),2);
    await merchant.click();await page.keyboard.press("Control+b");
    await page.waitForTimeout(200);
    assert.equal(await page.locator(".tab-name").count(),2,"重复打开应复用标签");
    assert.equal(await app.evaluate(()=>ddlCalls.filter(call=>call.method==="object.source").length),1);
    const consoleTab=page.locator(".tab-name").filter({hasText:"Console"}).first();
    await consoleTab.dispatchEvent("click");
    await activeEditor().click();await page.keyboard.press("Control+a");await page.keyboard.insertText("orders");
    await page.keyboard.press("Control+a");await page.keyboard.press("Control+b");
    await page.locator(".tab-name").filter({hasText:"ORDERS (DDL)"}).waitFor();
    assert.equal(await page.locator(".tab-name").count(),3);
    await consoleTab.dispatchEvent("click");await activeEditor().click();await page.keyboard.press("Control+a");await page.keyboard.insertText('SELECT * FROM "OTHER"."MERCHANT"');
    await page.keyboard.press("ArrowLeft");await page.keyboard.press("Control+b");
    await page.waitForFunction(()=>[...document.querySelectorAll(".tab-name")].filter(el=>el.textContent==="MERCHANT (DDL)").length===2);
    const last=await app.evaluate(()=>ddlCalls.filter(call=>call.method==="object.source").at(-1));
    assert.equal(last.payload.schema,"OTHER");assert.equal(last.payload.table,"MERCHANT");
    await page.getByText("FAIL",{exact:true}).click();await page.keyboard.press("Control+b");
    await page.getByText("无权读取测试表定义",{exact:true}).waitFor();
    assert.equal(await page.locator(".tab-name").count(),4,"失败不创建空标签");
    assert.equal(await app.evaluate(()=>ddlCalls.filter(call=>["query.run","ddl.execute","table.apply"].includes(call.method)).length),0,"快捷键不能执行 DDL");
    assert.deepEqual(errors,[]);
    await page.screenshot({path:path.join(root,"design/table-ddl-editor.png")});
    console.log("通过：对象树 Ctrl+B、SQL 选区/光标 Ctrl+B、跨 Schema、重复复用、只读连接、失败提示，无 SQL 执行或前端异常。");
  }finally{
    if(app)await app.close();
    assert.ok(temp.startsWith(path.join(os.tmpdir(),"querydesk-ddl-ui-")));
    fs.rmSync(temp,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
