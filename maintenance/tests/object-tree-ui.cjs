"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { _electron } = require(process.env.QUERYDESK_PLAYWRIGHT || "playwright");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "querydesk-tree-"));
const profile = { id: "tree-demo", name: "对象树测试", dialect: "oracle", host: "demo.local", port: 1521, database: "APP_DEMO", user: "DEMO" };
fs.writeFileSync(path.join(temp, "settings.json"), JSON.stringify({ connections: [profile], ai: { model: "", baseUrl: "https://example.invalid/v1" }, theme: "champagne", history: [] }));
let app;
(async () => {
  try {
    const env = { ...process.env, QUERYDESK_TEST_USER_DATA: temp };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: process.env.QUERYDESK_TEST_EXE || path.join(root, "theme-test/QueryDesk.exe"), env });
    const page = await app.firstWindow();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 800);
      const original = ipcMain._invokeHandlers.get("querydesk:call");
      globalThis.objectTreeCalls = [];
      const state = { connected: true, autoCommit: true, readOnly: false, dirty: false, needsRollback: false, version: "演示数据库", schema: "APP_DEMO" };
      const columns = [{ name: "ID", type: "NUMBER", primary: true, nullable: false }, { name: "NAME", type: "VARCHAR2(100)", nullable: true }];
      ipcMain.removeHandler("querydesk:call");
      ipcMain.handle("querydesk:call", (event, method, payload) => {
        globalThis.objectTreeCalls.push({ method, payload });
        let value;
        if (["session.open", "session.state", "session.reconnect"].includes(method)) value = state;
        else if (method === "session.close") value = {};
        else if (method === "schema.list") value = ["APP_DEMO"];
        else if (method === "object.list") value = Array.from({ length: 545 }, (_, i) => ({ name: `TABLE_${String(i).padStart(4, "0")}`, kind: "table", schema: "APP_DEMO" })).concat(Array.from({ length: 100 }, (_, i) => ({ name: `SEQ_${i}`, kind: "sequence", schema: "APP_DEMO" })));
        else if (method === "table.describe") value = { name: payload.table, schema: "APP_DEMO", columns, indexes: [], foreignKeys: [] };
        else if (method === "table.browse") value = { def: { name: payload.table, schema: "APP_DEMO", columns, indexes: [], foreignKeys: [] }, rows: [{ ID: 1, NAME: "示例" }], hasMore: false, editable: false, reason: "测试数据" };
        else return original(event, method, payload);
        return { ok: true, value };
      });
    });
    await page.locator(".connection-main").click();
    await page.locator(".object-group-title").first().waitFor();
    const started = Date.now();
    await page.locator(".object-tree .ant-tree-switcher_close").first().click();
    await page.locator(".object-title").first().waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const expandedMs = Date.now() - started;
    const rendered = await page.locator(".object-tree .ant-tree-treenode").count();
    console.log(JSON.stringify({ expandedMs, rendered, totalTables: 545 }));
    assert.ok(rendered < 60, `首屏应只渲染可见几十个节点，实际 ${rendered}`);
    assert.equal(await app.evaluate(() => globalThis.objectTreeCalls.filter(c => c.method === "table.describe").length), 0, "不能预读所有表字段");
    await page.locator(".object-tree .ant-tree-list-holder").hover();
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 30000);
      await page.waitForTimeout(120);
      if (await page.getByText("TABLE_0544", { exact: true }).isVisible()) break;
    }
    await page.getByText("TABLE_0544", { exact: true }).waitFor();
    assert.ok(await page.locator(".object-tree .ant-tree-treenode").count() < 60);
    const search = page.getByPlaceholder("搜索数据库对象…", { exact: true });
    await search.fill("TABLE_0544");
    await page.getByText("TABLE_0544", { exact: true }).waitFor();
    assert.equal(await page.locator(".object-title").count(), 1, "搜索必须涵盖未显示的表");
    const row = page.locator(".object-tree .ant-tree-treenode").filter({ has: page.getByText("TABLE_0544", { exact: true }) });
    await row.locator(".ant-tree-switcher_close").click();
    await page.locator(".column-leaf").first().waitFor();
    assert.equal(await app.evaluate(() => globalThis.objectTreeCalls.filter(c => c.method === "table.describe").length), 1);
    await row.locator(".ant-tree-switcher_open").click();
    await row.locator(".ant-tree-switcher_close").click();
    assert.equal(await app.evaluate(() => globalThis.objectTreeCalls.filter(c => c.method === "table.describe").length), 1, "重复展开应复用字段缓存");
    await page.getByText("TABLE_0544", { exact: true }).dblclick();
    await page.locator(".data-browser").waitFor();
    assert.equal(await app.evaluate(() => globalThis.objectTreeCalls.filter(c => c.method === "table.browse").at(-1).payload.table), "TABLE_0544");
    await search.fill("");
    await page.locator(".object-title").first().waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 760));
    await page.waitForTimeout(150);
    const holderFits = await page.locator(".object-tree .ant-tree-list-holder").evaluate(el => {
      const parent = el.closest(".object-tree").getBoundingClientRect(), box = el.getBoundingClientRect();
      return box.height > 100 && box.bottom <= parent.bottom + 1;
    });
    assert.ok(holderFits, "虚拟列表高度必须跟随窗口变化");
    assert.equal(await app.evaluate(() => globalThis.objectTreeCalls.filter(c => c.method === "object.list").length), 2, "滚动与搜索不重复查询，只有新表会话重新读取对象");
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(root, "design/object-tree-virtual.png") });
    console.log("通过：545 表首屏节点受限、滚动显示末尾表、完整搜索、字段按需加载与缓存、双击打开表、窗口自适应，无前端异常。");
  } finally {
    if (app) await app.close();
    assert.ok(temp.startsWith(path.join(os.tmpdir(), "querydesk-tree-")));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
