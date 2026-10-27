"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {createRequire} = require("node:module");
const root = path.resolve(__dirname, "..");
const bundle = fs.readFileSync(path.join(root,"codex-connect-app/dist/assets/index-BiPxEQzb.js"),"utf8");
const context = vm.createContext({});
vm.runInContext(bundle.slice(bundle.indexOf("function tableDefinitionTarget("),bundle.indexOf("function jn(e,t,n=!1")),context);
const objects=[{name:"MERCHANT",schema:"APP",kind:"table"},{name:"Mixed.Table",schema:"APP",kind:"table"}];
function target(text,selected=true,column=text.length+1,dialect="oracle") {
  return context.tableDefinitionTarget({getModel:()=>({getValueInRange:()=>selected?text:"",getLineContent:()=>text}),getSelection:()=>({}),getPosition:()=>({lineNumber:1,column})},"APP",objects,dialect);
}
assert.equal(target("merchant").name,"MERCHANT");
assert.equal(target('"APP"."Mixed.Table"').name,"Mixed.Table");
assert.equal(target('"other" . "lower"').schema,"other");
assert.equal(target('"other" . "lower"').name,"lower");
assert.equal(target("select * from APP.MERCHANT;",false,22).name,"MERCHANT");
assert.equal(target("`app`.`a``b`",true,1,"mysql").name,"a`b");
for(const sql of ["SELECT * FROM MERCHANT","'MERCHANT'","MERCHANT; DROP TABLE X",""])assert.equal(target(sql),undefined);

const filename=path.join(root,"codex-connect-app/dist-electron/worker.cjs");
const localRequire=createRequire(filename);
const worker=vm.createContext({require:name=>name==="mysql2/promise"?{}:localRequire(name),__dirname:path.dirname(filename),process,Buffer,console,setTimeout,clearTimeout,AbortController,TextDecoder,URL});
const source=fs.readFileSync(filename,"utf8");
vm.runInContext(source.slice(0,source.indexOf("var port = process.parentPort;")),worker);
(async()=>{
  const calls=[];
  const longDDL='CREATE TABLE "APP"."MERCHANT" ("ID" NUMBER) /*'+"x".repeat(70000)+'*/';
  const oracle={profile:{dialect:"oracle"},connection:{execute:async(sql,binds)=>{
    calls.push({sql,binds});
    if(sql.includes("GET_DDL('TABLE'"))return {rows:[{DDL:longDDL}]};
    if(sql.includes("GET_DDL('INDEX'"))return {rows:[{DDL:'CREATE UNIQUE INDEX "IX_MERCHANT" ON "APP"."MERCHANT" ("ID")'}]};
    return {rows:[{COLUMN_NAME:null,COMMENTS:"商户's"},{COLUMN_NAME:"ID",COMMENTS:"编号"}]};
  }}};
  const ddl=await worker.source(oracle,"APP","MERCHANT","table");
  assert.ok(ddl.startsWith(longDDL+";\n\n"));
  assert.match(ddl,/CREATE UNIQUE INDEX/);
  assert.ok(ddl.includes('COMMENT ON TABLE "APP"."MERCHANT" IS \'商户\'\'s\';'));
  assert.ok(ddl.includes('COMMENT ON COLUMN "APP"."MERCHANT"."ID" IS \'编号\';'));
  assert.equal(calls.length,3);
  assert.ok(calls.every(call=>call.sql.startsWith("SELECT ")),"只读取元数据");
  assert.match(calls[1].sql,/NOT EXISTS.*ALL_CONSTRAINTS/);
  const mysqlCalls=[];
  const mysql={profile:{dialect:"mysql"},connection:{query:async sql=>{mysqlCalls.push(sql);return [[{"Create Table":"CREATE TABLE `merchant` (`id` int)"}]];}}};
  assert.equal(await worker.source(mysql,"app","merchant","table"),"CREATE TABLE `merchant` (`id` int)");
  assert.equal(mysqlCalls[0],"SHOW CREATE TABLE `app`.`merchant`");
  oracle.connection.execute=async()=>{throw new Error("ORA-31603: object not found");};
  await assert.rejects(worker.source(oracle,"APP","MISSING","table"),/ORA-31603/);
  console.log("通过：选区/光标、带引号与跨 Schema 表名、无效选区、Oracle 完整 DDL/独立索引/注释/长文本、MySQL 定义及读取失败。");
})().catch(error=>{console.error(error);process.exitCode=1;});
