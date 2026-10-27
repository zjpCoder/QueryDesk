"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { _electron } = require(process.env.QUERYDESK_PLAYWRIGHT || "playwright");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "querydesk-locate-"));
const profile = { id: "locate-demo", name: "定位测试", dialect: "oracle", host: "demo.invalid", port: 1521, database: "APP_DEMO", user: "DEMO" };
fs.writeFileSync(path.join(temp, "settings.json"), JSON.stringify({ connections: [profile], ai: { model: "", baseUrl: "https://example.invalid/v1" }, theme: "champagne", history: [] }));
let app;
(async () => {
  try {
    const env = { ...process.env, QUERYDESK_TEST_USER_DATA: temp };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: process.env.QUERYDESK_TEST_EXE || path.join(root, "locate-table-test/QueryDesk.exe"), env });
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 900);
      const original = ipcMain._invokeHandlers.get("querydesk:call");
      globalThis.locateCalls = [];
      const state = { connected: true, autoCommit: true, readOnly: false, dirty: false, needsRollback: false, version: "隔离测试", schema: "APP_DEMO" };
      const columns = [{ name: "ID", type: "NUMBER", primary: true, nullable: false }];
      ipcMain.removeHandler("querydesk:call");
      ipcMain.handle("querydesk:call", (event, method, payload) => {
        globalThis.locateCalls.push({ method, payload });
        let value;
        if (["session.open", "session.state", "session.reconnect"].includes(method)) value = state;
        else if (method === "session.close") value = {};
        else if (method === "schema.list") value = ["APP_DEMO"];
        else if (method === "object.list") value = Array.from({ length: 545 }, (_, i) => ({ name: `TABLE_${String(i).padStart(4, "0")}`, kind: "table", schema: "APP_DEMO" })).concat([{ name: "VIEW_DEMO", kind: "view", schema: "APP_DEMO" }]);
        else if (method === "table.describe") value = { name: payload.table, schema: "APP_DEMO", columns, indexes: [], foreignKeys: [] };
        else if (method === "table.browse") value = { def: { name: payload.table, schema: "APP_DEMO", columns, indexes: [], foreignKeys: [] }, rows: [{ ID: 1 }], hasMore: false, editable: false, reason: "测试数据" };
        else return original(event, method, payload);
        return { ok: true, value };
      });
    });
    await page.locator(".connection-main").click();
    const locate = page.getByRole("button", { name: "定位当前表", exact: true });
    assert.equal(await locate.isEnabled(), false, "SQL 标签下按钮应禁用");
    const search = page.getByPlaceholder("搜索数据库对象…", { exact: true });
    async function open(name) {
      await search.fill(name);
      await page.waitForFunction(name => {
        const names = [...document.querySelectorAll(".object-tree .object-title")];
        return names.length === 1 && names[0].textContent.trim() === name;
      }, name);
      await page.locator(".object-title").filter({ hasText: name }).dblclick();
      await page.locator(".tab-name").filter({ hasText: name }).waitFor();
      await page.waitForFunction(() => !document.querySelector('button[aria-label="定位当前表"]')?.disabled);
    }
    async function selected(name) {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const node = page.locator(".object-tree .ant-tree-node-selected").filter({ hasText: name });
      await node.waitFor({ state: "visible" });
      await page.waitForFunction(name => {
        const row = [...document.querySelectorAll(".object-tree .ant-tree-node-selected")].find(el => el.textContent.includes(name));
        const holder = document.querySelector(".object-tree .ant-tree-list-holder");
        if (!row || !holder) return false;
        const r = row.getBoundingClientRect(), h = holder.getBoundingClientRect();
        return r.top >= h.top - 1 && r.bottom <= h.bottom + 1;
      }, name);
      assert.ok(await page.locator(".object-tree .ant-tree-treenode").count() < 60, "定位不能挂载全部表节点");
    }
    await open("TABLE_0544");
    await search.fill("TABLE_0001");
    await locate.click();
    await selected("TABLE_0544");
    assert.equal(await search.inputValue(), "", "定位应清除阻挡目标的筛选");
    await page.screenshot({ path: path.join(root, "design/locate-table.png") });
    await page.locator(".object-tree .ant-tree-switcher_open").first().click();
    await locate.click();
    await selected("TABLE_0544");
    await locate.click();
    await selected("TABLE_0544");
    await open("TABLE_0001");
    await locate.click();
    await selected("TABLE_0001");
    await page.locator(".tab-name").filter({ hasText: "TABLE_0544" }).click();
    await page.waitForFunction(() => !document.querySelector('button[aria-label="定位当前表"]')?.disabled);
    await locate.click();
    await selected("TABLE_0544");
    await open("VIEW_DEMO");
    await search.fill("TABLE_0001");
    await locate.click();
    await selected("VIEW_DEMO");
    await page.locator(".tab-name").filter({ hasText: "Console" }).first().dispatchEvent("click");
    await page.waitForFunction(() => document.querySelector('button[aria-label="定位当前表"]')?.disabled);
    assert.equal(await app.evaluate(() => globalThis.locateCalls.filter(c => c.method === "table.describe").length), 0, "定位不应加载所有字段");
    assert.deepEqual(errors, []);
    console.log("通过：SQL 标签禁用、545 表末尾滚动与高亮、清除筛选、展开分组、重复定位、切换表标签、视图定位、保持虚拟列表，无字段预读或前端异常。");
  } finally {
    if (app) await app.close();
    assert.ok(temp.startsWith(path.join(os.tmpdir(), "querydesk-locate-")));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
