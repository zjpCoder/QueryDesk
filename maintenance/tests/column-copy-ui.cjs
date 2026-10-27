"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { _electron } = require(process.env.QUERYDESK_PLAYWRIGHT || "playwright");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "querydesk-copy-column-"));
const profile = { id: "copy-demo", name: "字段复制测试", dialect: "oracle", host: "demo.invalid", port: 1521, database: "APP", user: "APP" };
const longName = "DOUYIN_MERCHANT_IDENTIFIER_WITH_A_LONG_COLUMN_NAME";
fs.writeFileSync(path.join(temp, "settings.json"), JSON.stringify({ connections: [profile], ai: { model: "", baseUrl: "https://example.invalid/v1" }, theme: "champagne", history: [] }));
let app;
(async () => {
  try {
    const env = { ...process.env, QUERYDESK_TEST_USER_DATA: temp };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: process.env.QUERYDESK_TEST_EXE || path.join(root, "locate-table-test/QueryDesk.exe"), env });
    const page = await app.firstWindow();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await app.evaluate(({ ipcMain, BrowserWindow }, longName) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 900);
      const original = ipcMain._invokeHandlers.get("querydesk:call");
      globalThis.columnCopyState = { connected: true, autoCommit: true, readOnly: false, dirty: false, needsRollback: false, schema: "APP", version: "隔离测试" };
      globalThis.columnCopyCalls = [];
      ipcMain.removeHandler("querydesk:call");
      ipcMain.handle("querydesk:call", (event, method, payload) => {
        globalThis.columnCopyCalls.push({ method, payload });
        let value;
        if (["session.open", "session.state"].includes(method)) value = globalThis.columnCopyState;
        else if (method === "session.close") value = {};
        else if (method === "schema.list") value = ["APP"];
        else if (method === "object.list") value = [{ name: "MERCHANT", schema: "APP", kind: "table" }];
        else if (method === "table.browse") value = { def: { name: payload.table, schema: "APP", columns: ["ID", longName].map(name => ({ name, type: "VARCHAR2(100)", comment: name === "ID" ? "" : "商户编号", nullable: true })), indexes: [], foreignKeys: [] }, rows: [{ ID: "2", [longName]: "merchant" }], hasMore: false, editable: false, reason: "测试数据" };
        else return original(event, method, payload);
        return { ok: true, value };
      });
    }, longName);
    // 只替换剪贴板边界以检查完整字符串和失败分支，保留用户当前剪贴板。
    await page.evaluate(() => {
      window.copiedColumnNames = [];
      window.copyShouldFail = false;
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => {
        if (window.copyShouldFail) throw new Error("测试复制失败");
        window.copiedColumnNames.push(text);
      } } });
    });
    await page.locator(".connection-main").click();
    await page.getByPlaceholder("搜索数据库对象…", { exact: true }).fill("MERCHANT");
    await page.locator(".object-title").filter({ hasText: "MERCHANT" }).dblclick();
    const button = name => page.getByRole("button", { name: `复制字段名 ${name}`, exact: true });
    await button(longName).waitFor();
    await button(longName).hover();
    assert.equal(await button(longName).getAttribute("title"), `字段：${longName}\n注释：商户编号\n类型：VARCHAR2(100)\n点击复制字段名`);
    assert.match(await button("ID").getAttribute("title"), /注释：无注释/);
    assert.ok(await button(longName).evaluate(el => el.scrollWidth > el.clientWidth), "长字段名应确实在界面截断");
    await button(longName).click();
    await page.waitForFunction(() => window.copiedColumnNames.length === 1);
    assert.equal(await page.evaluate(() => window.copiedColumnNames.at(-1)), longName, "复制完整字段名，不能包含省略号");
    assert.ok((await button(longName).getAttribute("title")).endsWith(`已复制：${longName}`));
    assert.match(await button(longName).getAttribute("title"), /注释：商户编号\n类型：VARCHAR2\(100\)/, "复制反馈期间保留注释和类型");
    await button("ID").focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.copiedColumnNames.length === 2);
    await page.keyboard.press("Space");
    await page.waitForFunction(() => window.copiedColumnNames.length === 3);
    assert.equal(await page.evaluate(() => window.copiedColumnNames.at(-1)), "ID");
    await page.evaluate(() => { window.copyShouldFail = true; });
    await button("ID").click();
    await page.waitForFunction(() => document.querySelector('button[aria-label="复制字段名 ID"]')?.title.includes("复制失败"));
    await page.evaluate(() => { window.copyShouldFail = false; });
    await button("ID").click();
    await page.waitForFunction(() => window.copiedColumnNames.length === 4);
    const queryNames = ["ID", "商户 名称", "Quote\"Field"];
    await app.evaluate(({ BrowserWindow }, queryNames) => {
      BrowserWindow.getAllWindows()[0].webContents.send("querydesk:ai", { opened: {
        sessionId: "copy-results", connectionId: "copy-demo", title: "字段复制查询结果", sql: "SELECT * FROM MERCHANT", info: globalThis.columnCopyState,
        results: [{ id: "copy-result-1", columns: queryNames, columnMetadata: [{name: "ID", type: "NUMBER(18,0)", comment: "", commentKnown: true}, {name: queryNames[1], type: "VARCHAR2(100 CHAR)", comment: "商户名称\n支持中文", commentKnown: true}, {name: queryNames[2], type: "VARCHAR2(20)", comment: "", commentKnown: false}], rows: [{ ID: "2", [queryNames[1]]: "示例", [queryNames[2]]: "quoted" }, { ID: "1" }], affected: 0, elapsed: 1, hasMore: false, truncated: false }]
      } });
    }, queryNames);
    await page.locator(".tab-name").filter({ hasText: "字段复制查询结果" }).waitFor();
    await button("商户 名称").waitFor();
    await button("商户 名称").hover();
    assert.equal(await button("商户 名称").getAttribute("title"), "字段：商户 名称\n注释：商户名称\n支持中文\n类型：VARCHAR2(100 CHAR)\n点击复制字段名");
    assert.match(await button('Quote"Field').getAttribute("title"), /注释：未获取\n类型：VARCHAR2\(20\)/);
    for (const name of queryNames) {
      await button(name).click();
      await page.waitForFunction(name => window.copiedColumnNames.at(-1) === name, name);
      assert.equal(await button(name).locator("xpath=ancestor::*[@role='columnheader']").getAttribute("aria-sort"), "none", "复制字段不能触发排序");
    }
    const header = button("ID").locator("xpath=ancestor::*[@role='columnheader']");
    await header.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(el => el.getAttribute("aria-sort") === "ascending", await header.elementHandle());
    assert.equal(await app.evaluate(() => globalThis.columnCopyCalls.filter(c => ["query.run", "table.apply"].includes(c.method)).length), 0, "复制不得触发数据库执行");
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(root, "design/column-copy.png") });
    console.log("通过：表数据和 SQL 结果悬浮注释/类型、无注释及未知来源、多行注释、复制反馈保留元数据、长字段/中文/空格/引号复制、Enter/Space、失败重试、原排序保留，无前端异常；未改变用户剪贴板或访问数据库。");
  } finally {
    if (app) await app.close();
    assert.ok(temp.startsWith(path.join(os.tmpdir(), "querydesk-copy-column-")));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
