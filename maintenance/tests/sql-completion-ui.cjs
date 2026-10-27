"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {_electron} = require(process.env.QUERYDESK_PLAYWRIGHT || "playwright");
const root = path.resolve(__dirname, "..");
const install = path.join(root, "design/autocomplete-test");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "querydesk-completion-"));
fs.mkdirSync(path.join(install, "resources"), {recursive: true});
for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
  if (entry.isFile() && /\.(exe|dll|pak|dat|bin)$/.test(entry.name) && !/Uninstall/.test(entry.name)) {
    const target = path.join(install, entry.name);
    if (!fs.existsSync(target)) fs.linkSync(path.join(root, entry.name), target);
  }
}
for (const dir of ["locales", "resources/runtime", "resources/app.asar.unpacked"]) {
  const target = path.join(install, dir);
  if (!fs.existsSync(target)) fs.symlinkSync(path.join(root, dir), target, "junction");
}
fs.copyFileSync(process.env.QUERYDESK_COMPLETION_ARCHIVE || path.join(root, "resources/app.asar.sql-completion.new"), path.join(install, "resources/app.asar"));
const profile = {id: "completion-demo", name: "补全测试", dialect: "oracle", host: "demo.invalid", port: 1521, database: "APP", user: "APP", readOnly: true};
fs.writeFileSync(path.join(temp, "settings.json"), JSON.stringify({connections: [profile], ai: {model: "", baseUrl: "https://example.invalid/v1"}, theme: "champagne", history: []}));
let app;
(async () => {
  try {
    const env = {...process.env, QUERYDESK_TEST_USER_DATA: temp};
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({executablePath: path.join(install, "QueryDesk.exe"), env});
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await app.evaluate(({ipcMain, BrowserWindow}) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 900);
      const original = ipcMain._invokeHandlers.get("querydesk:call");
      globalThis.completionCalls = [];
      ipcMain.removeHandler("querydesk:call");
      ipcMain.handle("querydesk:call", (event, method, payload) => {
        globalThis.completionCalls.push({method, payload});
        let value;
        if (["session.open", "session.state"].includes(method)) value = {connected: true, autoCommit: false, readOnly: true, dirty: false, needsRollback: false, schema: "APP", version: "Oracle 隔离补全测试"};
        else if (method === "session.close") value = {};
        else if (method === "schema.list") value = ["APP"];
        else if (method === "object.list") value = Array.from({length: 545}, (_, i) => ({name: `TABLE_${i}`, kind: "table", schema: "APP"})).concat([
          {name: "DEMO_TAB_MERCHANT", schema: "APP", kind: "table"},
          {name: "MERCH_EXACT", schema: "APP", kind: "table"},
          {name: "DEMO_TAB_MEMBER", schema: "APP", kind: "table"}
        ]);
        else if (method === "table.describe") value = {name: payload.table, schema: payload.schema, columns: [{name: "MERCHANT_CODE", type: "VARCHAR2(64)"}], indexes: [], foreignKeys: []};
        else return original(event, method, payload);
        return {ok: true, value};
      });
    });
    await page.locator(".connection-main").click();
    const editor = page.locator(".monaco-editor:visible").first();
    await editor.locator(".view-lines").waitFor();
    const rows = page.locator(".suggest-widget.visible .monaco-list-row");
    async function input(sql) {
      await page.keyboard.press("Escape");
      await editor.click();
      await page.keyboard.press("Control+a");
      await page.keyboard.insertText(sql);
    }
    async function candidate(name = "DEMO_TAB_MERCHANT") {
      await rows.filter({hasText: name}).first().waitFor({state: "visible"});
    }
    // 使用真实逐字输入，验证列表已打开时继续输入也会重新筛选。
    for (const prefix of ["DTC", "merch", "demotabm"]) {
      await input("UPDATE ");
      await page.keyboard.type(prefix, {delay: 70});
      await candidate();
      await page.screenshot({path: path.join(root, `design/sql-completion-${prefix.toLowerCase()}.png`)});
      await page.keyboard.press("Escape");
    }
    await input("UPDATE HY");
    await page.keyboard.press("Control+Space");
    await candidate();
    await candidate("DEMO_TAB_MEMBER");
    await page.keyboard.type("C", {delay: 70});
    await candidate();
    await page.waitForFunction(() => ![...document.querySelectorAll(".suggest-widget.visible .monaco-list-row")].some(el => el.textContent.includes("DEMO_TAB_MEMBER")));
    await page.keyboard.press("Tab");
    await page.waitForFunction(() => document.querySelector(".monaco-editor .view-lines")?.textContent.replace(/\u00a0/g, " ").includes("UPDATE DEMO_TAB_MERCHANT"));
    await input("SELECT * FROM merch");
    await page.keyboard.press("Control+Space");
    await candidate();
    assert.ok((await rows.first().innerText()).includes("MERCH_EXACT"), "前缀命中应排在子串前");
    await input("SELECT m. FROM DEMO_TAB_MERCHANT m");
    await page.keyboard.press("Home");
    for (let i = 0; i < 9; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.type("code", {delay: 70});
    await candidate("MERCHANT_CODE");
    await input("UPDATE zyxq");
    await page.keyboard.press("Control+Space");
    await page.waitForTimeout(250);
    assert.equal(await rows.filter({hasText: "DEMO_TAB_MERCHANT"}).count(), 0);
    assert.deepEqual(errors, []);
    const calls = await app.evaluate(() => completionCalls);
    assert.equal(calls.filter(call => call.method === "query.run").length, 0);
    assert.equal(calls.filter(call => call.method === "table.describe").length, 1, "表名补全无需预读所有字段");
    console.log("通过：真实 Monaco 逐字输入 DTC/merch/demotabm、545 张表后的目标表、继续输入刷新、Tab 插入、前缀排序、别名字段补全，无 SQL 执行或前端异常。");
  } finally {
    if (app) await app.close();
    assert.ok(path.resolve(temp).startsWith(path.join(os.tmpdir(), "querydesk-completion-")));
    fs.rmSync(temp, {recursive: true, force: true});
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
