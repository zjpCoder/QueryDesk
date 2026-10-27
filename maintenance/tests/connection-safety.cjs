"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "..");
const dir = path.join(root, "codex-connect-app/dist-electron");

function load(file, stop, electron = {}) {
  const filename = path.join(dir, file);
  const localRequire = createRequire(filename);
  const context = vm.createContext({
    require: name => name === "electron" ? electron : name === "mysql2/promise" ? {} : localRequire(name),
    __dirname: dir, process, Buffer, console, setTimeout, clearTimeout, AbortController, TextDecoder, URL,
  });
  const source = fs.readFileSync(filename, "utf8");
  assert.ok(source.includes(stop));
  vm.runInContext(source.slice(0, source.indexOf(stop)), context, { filename });
  return context;
}

(async () => {
  const worker = load("worker.cjs", "var port = process.parentPort;");
  const { queryRisks, assertProfileReadOnly } = worker.connectionSafety;
  for (const dialect of ["mysql", "oracle"]) {
    for (const sql of ["UPDATE t SET x=1", "DELETE FROM t", "DROP TABLE t", "TRUNCATE TABLE t", "UPDATE t SET x='WHERE'", "DELETE FROM t -- WHERE id=1\n", "UPDATE t SET x=(SELECT x FROM s WHERE id=1)", "WITH x AS (SELECT id FROM s WHERE id=1) DELETE FROM t", "SELECT 1; DELETE FROM t"]) {
      assert.ok(queryRisks(sql, dialect).length, `${dialect}: 应提醒 ${sql}`);
    }
    for (const sql of ["SELECT 'DROP TABLE t; WHERE' FROM t", "UPDATE t SET x=1 WHERE id=2", "DELETE FROM t WHERE EXISTS (SELECT 1 FROM s)", "SELECT 1 -- DELETE FROM t\n", "/* DROP TABLE t */ SELECT 1"]) {
      assert.equal(queryRisks(sql, dialect).length, 0, `${dialect}: 不应提醒 ${sql}`);
    }
    for (const sql of ["SELECT 1", "SELECT COUNT(*) FROM t", "WITH x AS (SELECT 1 AS id FROM t) SELECT * FROM x", "SELECT 1; SELECT 2", "SHOW TABLES", "DESC t", "EXPLAIN SELECT * FROM t", "  /* 注释 */ EXPLAIN SELECT * FROM t"]) {
      assert.doesNotThrow(() => assertProfileReadOnly(sql, dialect), sql);
    }
    for (const sql of ["UPDATE t SET x=1 WHERE id=1", "DELETE FROM t", "CREATE TABLE t(x INT)", "SELECT 1; DELETE FROM t", "COMMIT", "SET TRANSACTION READ WRITE", "SELECT * FROM t FOR UPDATE", "SELECT side_effect()", "SELECT * INTO OUTFILE 'x' FROM t", "EXPLAIN ANALYZE DELETE FROM t", "EXPLAIN PLAN FOR SELECT * FROM t", "SELECT 1 /*! INTO OUTFILE 'x' */"]) {
      assert.throws(() => assertProfileReadOnly(sql, dialect), /只读连接/, sql);
    }
  }
  assert.ok(queryRisks("UPDATE t SET x=1 WHERE id=1", "mysql", true).length);
  assert.ok(queryRisks("INSERT INTO t VALUES(1)", "mysql", true).length);
  assert.equal(queryRisks("SELECT * FROM t", "mysql", true).length, 0);
  assert.equal(queryRisks("WITH x AS (SELECT 1) SELECT * FROM x", "mysql", true).length, 0);
  assert.ok(queryRisks("CREATE TABLE t AS SELECT * FROM s", "mysql", true).length);

  let response = 0;
  const dialogs = [];
  const main = load("main.cjs", "if (process.env.QUERYDESK_TEST_USER_DATA)", { dialog: { showMessageBox: async (_, options) => { dialogs.push(options); return { response }; } } });
  vm.runInContext(`
    store = { data: {connections:[{id:"test",name:"测试数据库",environment:"test",dialect:"mysql",host:"demo.invalid",port:3306}]}};
    win = { isDestroyed:()=>false };
    sessions.set("s", "test");
    globalThis.calls=[];
    rpc = async (key, method, payload)=>{ calls.push({key,method,payload});return {state:{},results:[]}; };
  `, main);
  const payload = sql => ({ sessionId: "s", sql, params: {} });
  await assert.rejects(main.handle("query.run", payload("SELECT 1; DELETE FROM t"), true), /已取消执行/);
  assert.equal(main.calls.length, 0, "取消时整批 SQL 均不得发往数据库");
  assert.equal(dialogs[0].defaultId, 0);
  assert.equal(dialogs[0].cancelId, 0);
  assert.match(dialogs[0].detail, /测试数据库/);
  response = 1;
  await main.handle("query.run", payload("DELETE FROM t"), true);
  assert.equal(main.calls.length, 1, "确认后仅执行一次");
  await assert.rejects(main.handle("query.run", payload("DELETE FROM t")), /执行保护已阻止自动执行/);
  assert.equal(main.calls.length, 1, "MCP 不得绕过危险 SQL 检查");
  await assert.rejects(main.handle("query.run", { ...payload("DELETE FROM t"), safetyApproved: true }),/执行保护已阻止自动执行/);
  vm.runInContext(`
    store={data:{connections:[{id:"p",name:"生产库",environment:"production",dialect:"mysql",host:"demo.invalid",port:3306}]}};
    win={isDestroyed:()=>false}; sessions.set("s","p");
    globalThis.calls=[];rpc=async (key,method,payload)=>{calls.push({key,method,payload});return {results:[]};};
  `, main);
  for (const sql of ["UPDATE t SET x=1 WHERE id=1", "INSERT INTO t VALUES(1)", "ALTER TABLE t ADD x INT"]) {
    await assert.rejects(main.handle("query.run", { sessionId: "s", sql }), /生产环境/);
  }
  const changes={sessionId:"s",schema:"app",table:"t",changes:[{kind:"update",original:{id:1,x:1},values:{id:1,x:2}}]};
  await assert.rejects(main.handle("table.apply",changes), /生产环境/);
  await main.handle("table.apply",changes,true);
  assert.equal(main.calls.length,1);
  const definition={schema:"app",name:"t",comment:"",columns:[{name:"id",type:"INT",nullable:false,defaultValue:"",comment:"",primary:true}],indexes:[],foreignKeys:[]};
  await assert.rejects(main.handle("ddl.execute",{sessionId:"s",before:null,after:definition,fingerprint:""}),/生产环境/);
  main.store.data.connections[0].readOnly = true;
  await assert.rejects(main.handle("query.run", { sessionId: "s", sql: "DELETE FROM t" }, true), /只读连接/);
  await assert.rejects(main.handle("table.apply",changes,true),/只读连接/);
  const parsed = main.validate2("connection.save", { id:"p", name:"旧配置", group:"", dialect:"mysql",host:"demo.invalid",port:3306,user:"u",database:"",oracleMode:"service",clientPath:"",tls:false,caPath:"" });
  assert.equal(parsed.environment, "unspecified");
  assert.equal(parsed.readOnly, false);
  assert.throws(() => main.validate2("connection.save", { ...parsed, environment:"invalid" }));
  assert.throws(() => main.validate2("connection.save", { ...parsed, readOnly:"false" }));

  vm.runInContext(`
    globalThis.calls=[];
    connect=async profile=>({profile,info:{connected:true,readOnly:!!profile.readOnly,autoCommit:!profile.readOnly,dirty:false,needsRollback:false,schema:"app"},cursors:new Map(),connection:{rollback:async()=>calls.push("rollback"),commit:async()=>calls.push("commit"),end:async()=>{},query:async sql=>{calls.push(sql);return [[]];}}});
    mysqlQuery=async (s,sql)=>{calls.push(sql);return [];};
    describe=async()=>({schema:"app",name:"t",columns:[{name:"id",primary:true,type:"INT"}],engine:"InnoDB"});
    objects=async()=>[{name:"t",kind:"table"}];
    raw=async()=>[];
  `, worker);
  let state = await worker.handle("session.open", { sessionId:"s",profile:{dialect:"mysql",database:"app",readOnly:true} });
  assert.equal(state.readOnly,true);
  assert.equal(state.autoCommit,false);
  await worker.handle("query.run", {sessionId:"s",sql:"SELECT 1",params:{}});
  assert.ok(worker.calls.includes("SET TRANSACTION READ ONLY"), "查询必须启动数据库只读事务");
  const count=worker.calls.length;
  await assert.rejects(worker.handle("query.run",{sessionId:"s",sql:"SELECT 1; DELETE FROM t",params:{}}), /只读连接/);
  assert.equal(worker.calls.length,count,"只读检查应在整批执行前完成");
  for (const method of ["table.apply","ddl.execute"]) await assert.rejects(worker.handle(method,{sessionId:"s"}),/只读/);
  await assert.rejects(worker.handle("session.transaction",{sessionId:"s",action:"auto",value:true}),/只读/);
  const page = await worker.handle("table.browse",{sessionId:"s",schema:"app",table:"t",page:0,filters:[],filterMode:"and"});
  assert.equal(page.editable,false);
  assert.match(page.reason,/只读/);
  state=await worker.handle("session.reconnect",{sessionId:"s",profile:{dialect:"mysql",database:"app",readOnly:true},schema:"app",autoCommit:true,readOnly:false});
  assert.equal(state.readOnly,true,"重连不得降低连接只读策略");
  console.log("通过：两种 SQL 方言风险识别、整批预检、取消及单次执行、MCP 阻断、旧配置兼容、输入校验、只读事务、表格与结构写入拦截及重连。");
})().catch(error=>{console.error(error);process.exitCode=1;});
