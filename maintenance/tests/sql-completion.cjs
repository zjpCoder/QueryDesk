"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const archive = fs.readFileSync(process.env.QUERYDESK_COMPLETION_ARCHIVE || path.join(root, "resources/app.asar.sql-completion.new"));
const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)));
let entry = header;
for (const part of "dist/assets/index-BiPxEQzb.js".split("/")) entry = entry.files[part];
const start = 8 + archive.readUInt32LE(4) + Number(entry.offset);
const source = archive.subarray(start, start + entry.size).toString("utf8");
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function Dd('), source.indexOf("function nle(")), context);
const tables = Array.from({length: 545}, (_, i) => ({name: `TABLE_${i}`, schema: "APP", kind: "table"}));
tables.push({name: "DEMO_TAB_MERCHANT", schema: "APP", kind: "table"}, {name: "DEMO_TAB_MERCHANT", schema: "OTHER", kind: "table"});
const definitions = [{name: "DEMO_TAB_MERCHANT", schema: "APP", columns: [{name: "MERCHANT_CODE", type: "VARCHAR2(64)"}]}];
const complete = (sql, dialect = "oracle", objects = tables, cursor = sql.length) => Array.from(context.ble(sql, cursor, dialect, objects, definitions, "APP"));
for (const dialect of ["oracle", "mysql"]) {
  for (const clause of ["UPDATE", "SELECT * FROM", "SELECT * FROM TABLE_0 JOIN", "INSERT INTO", "DELETE FROM"]) {
    for (const query of ["DTC", "dtc", "merch", "demotabm", "DEMO_TAB_M", "TAB_MER", "merchant"]) {
      const result = complete(`${clause} ${query}`, dialect).filter(item => item.kind === "table");
      assert.ok(result.some(item => item.label === "DEMO_TAB_MERCHANT"), `${dialect}: ${clause} ${query}`);
      assert.ok(result.every(item => item.detail.startsWith("APP ·")), "应保留当前 Schema 范围");
    }
  }
}
assert.equal(complete("UPDATE zyxq").filter(item => item.kind === "table").length, 0);
assert.equal(complete("UPDATE CTMD").filter(item => item.kind === "table").length, 0, "不匹配字符逆序");
assert.equal(complete("-- UPDATE merch").length, 0);
assert.equal(complete("SELECT 'merch").length, 0);
assert.ok(complete("SELECT m.code FROM DEMO_TAB_MERCHANT m", "oracle", tables, 13).some(item => item.label === "MERCHANT_CODE"));
assert.ok(complete("SELECT m.mc FROM DEMO_TAB_MERCHANT m", "oracle", tables, 11).some(item => item.label === "MERCHANT_CODE"));
assert.ok(complete("UPDATE OTHER.merch").some(item => item.detail.startsWith("OTHER ·")));
assert.ok(complete("sel").some(item => item.label === "SELECT"));
assert.equal(complete("slct").some(item => item.kind === "keyword"), false, "关键字保留前缀匹配");
const ranked = ["X_MERCHANT", "M_E_R_C_H", "MERCHANT"].map(name => ({name, schema: "APP", kind: "table"}));
assert.deepEqual(complete("UPDATE merch", "oracle", ranked).filter(item => item.kind === "table").map(item => item.label), ["MERCHANT", "X_MERCHANT", "M_E_R_C_H"]);
const quoted = [{name: "Demo_Tab_Merchant", schema: "APP", kind: "table"}];
assert.equal(complete("UPDATE dtc", "oracle", quoted).find(item => item.kind === "table").insertText, '"Demo_Tab_Merchant"');
console.log("通过：Oracle/MySQL 全量表、大小写、子串、跨下划线与顺序模糊匹配、排序、Schema、字段、关键字、字符串/注释和引号规则。");
