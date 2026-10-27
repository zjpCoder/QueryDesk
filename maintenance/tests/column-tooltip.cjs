"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { EventEmitter } = require("node:events");
const root = path.resolve(__dirname, "..");
const dir = path.join(root, "design/column-tooltip-app/dist-electron");
const localRequire = createRequire(path.join(dir, "worker.cjs"));
const context = vm.createContext({ require: name => name === "electron" ? {} : localRequire(name), __dirname: dir, process, Buffer, console, setTimeout, clearTimeout, AbortController, TextDecoder, URL });
let source = fs.readFileSync(path.join(dir, "worker.cjs"), "utf8");
vm.runInContext(source.slice(0, source.indexOf("var port = process.parentPort;")), context);
const calls = [];
const catalog = {
  MERCHANT: [
    { COLUMN_NAME: "ID", DATA_TYPE: "NUMBER", DATA_PRECISION: 18, DATA_SCALE: 0, COMMENTS: "商户主键" },
    { COLUMN_NAME: "MERCHANT_CODE", DATA_TYPE: "VARCHAR2", DATA_LENGTH: 64, CHAR_USED: "B", COMMENTS: "商户编号" },
    { COLUMN_NAME: "NAME", DATA_TYPE: "VARCHAR2", DATA_LENGTH: 100, CHAR_USED: "B", COMMENTS: null }
  ],
  DOUYIN: [
    { COLUMN_NAME: "ID", DATA_TYPE: "NUMBER", DATA_PRECISION: 18, DATA_SCALE: 0, COMMENTS: "抖音主键" },
    { COLUMN_NAME: "AUDIT_STATUS", DATA_TYPE: "VARCHAR2", DATA_LENGTH: 10, CHAR_USED: "B", COMMENTS: "审核状态" }
  ]
};
const { metadata } = require("../tools/column-metadata.cjs")({
  raw: async (s, sql, binds) => { calls.push({ sql, binds }); if (binds.table === "DENIED") throw new Error("无权限"); return catalog[binds.table] || []; },
  oracleType: context.oracleType,
  mysqlTypes: { 3: "LONG" }
});
const oracle = { profile: { dialect: "oracle" }, info: { schema: "APP" } };
const plain = value => JSON.parse(JSON.stringify(value));
(async () => {
  let result = await metadata(oracle, "SELECT m.*, d.AUDIT_STATUS AS DY_STATUS, d.ID AS DY_ID FROM APP.MERCHANT m LEFT JOIN APP.DOUYIN d ON d.ID=m.ID", ["ID", "MERCHANT_CODE", "NAME", "DY_STATUS", "DY_ID"]);
  assert.deepEqual(result.map(c => c.comment), ["商户主键", "商户编号", "", "审核状态", "抖音主键"]);
  assert.equal(result[1].type, "VARCHAR2(64 BYTE)");
  assert.equal(result[2].commentKnown, true);
  assert.equal(calls.length, 2, "每个表只读取一次字段字典");
  result = await metadata(oracle, 'SELECT "m"."MERCHANT_CODE" "编号", \'FROM FAKE\' AS TXT, COUNT(*) AS TOTAL FROM "APP"."MERCHANT" "m"', ["编号", "TXT", "TOTAL"], [{ type: "VARCHAR2(64)" }, { type: "CHAR(9)" }, { type: "NUMBER" }]);
  assert.equal(result[0].comment, "商户编号");
  assert.equal(result[1].commentKnown, false);
  assert.equal(result[2].type, "NUMBER");
  for (const sql of ["SELECT ID FROM MERCHANT m JOIN DOUYIN d ON d.ID=m.ID", "SELECT m.ID+1 AS ID FROM MERCHANT m", "WITH x AS (SELECT ID FROM MERCHANT) SELECT ID FROM x", "SELECT ID FROM MERCHANT UNION SELECT ID FROM DOUYIN", "SELECT ID FROM (SELECT ID FROM MERCHANT)", "SELECT ID FROM MERCHANT@REMOTE", "SELECT ID FROM MERCHANT m JOIN DENIED d ON d.ID=m.ID"]) {
    result = await metadata(oracle, sql, ["ID"], [{ type: "NUMBER" }]);
    assert.equal(result[0].commentKnown, false, sql);
    assert.equal(result[0].type, "NUMBER");
  }
  result = await metadata(oracle, "/* FROM FAKE */ SELECT d.ID, m.ID FROM MERCHANT m, DOUYIN d WHERE m.ID=d.ID", ["ID", "ID_2"]);
  assert.deepEqual(result.map(c => c.comment), ["抖音主键", "商户主键"]);
  result = await metadata(oracle, "SELECT * FROM DENIED", ["ID"], [{ type: "NUMBER" }]);
  assert.equal(result[0].commentKnown, false);
  const mysql = { profile: { dialect: "mysql" }, info: { schema: "app" } };
  const mysqlFields = require("../tools/column-metadata.cjs")({ raw: async () => [{ COLUMN_NAME: "code", COLUMN_TYPE: "varchar(64)", COLUMN_COMMENT: "编号" }] });
  result = await mysqlFields.metadata(mysql, "SELECT code AS ID FROM t", ["ID"], [{ db: "app", orgTable: "t", orgName: "code", columnType: 253 }]);
  assert.equal(result[0].comment, "编号");
  assert.equal(result[0].type, "varchar(64)");
  result = await metadata(mysql, "SELECT 1 AS ID", ["ID"], [{ columnType: 3 }]);
  assert.equal(result[0].type, "LONG");

  // 通过真实查询/分页函数验证元数据并未在结果组装和分页时丢失。
  const rows = Array.from({ length: 201 }, (_, i) => [i]);
  const state = { profile: { dialect: "oracle" }, info: { connected: true, autoCommit: true, schema: "APP" }, cursors: new Map(), cachedBytes: 0 };
  state.connection = { execute: async (sql, binds, options) => options.resultSet ? { resultSet: { metaData: [{ name: "ID", type: "NUMBER(18,0)" }], getRows: async count => rows.splice(0, count), close: async () => {} } } : { rows: catalog[binds.table] || [] } };
  const query = await context.query(state, "SELECT ID FROM MERCHANT", {});
  assert.equal(query.error, undefined);
  assert.equal(query.results[0].columnMetadata[0].comment, "商户主键");
  const next = await context.fetchMore(state, query.results[0].id);
  assert.deepEqual(plain(next.columnMetadata), plain(query.results[0].columnMetadata));
  assert.equal(next.rows.length, 1);
  assert.equal(next.hasMore, false);

  const mysqlState = { ...state, profile: { dialect: "mysql" }, cursors: new Map(), cachedBytes: 0, connection: { connection: { query: () => {
    const emitter = new EventEmitter();
    queueMicrotask(() => { emitter.emit("fields", [{ name: "ALIAS", orgName: "code", orgTable: "t", db: "app", type: 253 }]); emitter.emit("result", ["x"]); emitter.emit("end"); });
    return emitter;
  } }, execute: async () => [[{ COLUMN_NAME: "code", COLUMN_TYPE: "varchar(64)", COLUMN_COMMENT: "编号" }]] } };
  const groups = await context.mysqlQuery(mysqlState, "SELECT code AS ALIAS FROM t", []);
  assert.equal(groups[0].columnMetadata[0].comment, "编号");
  assert.equal(groups[0].rows[0].ALIAS, "x");
  console.log("通过：Oracle 联表/别名/通配符/重复字段/引号/无注释、MySQL 驱动来源、表达式类型、歧义和无权限降级、真实查询组装及分页保留元数据。");
})().catch(error => { console.error(error); process.exitCode = 1; });
