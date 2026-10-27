"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { _electron } = require(process.env.QUERYDESK_PLAYWRIGHT || "playwright");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "querydesk-copy-column-"));
const install = path.join(root, "design/column-sort-test");
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
fs.copyFileSync(process.env.QUERYDESK_SORT_ARCHIVE || path.join(root, "resources/app.asar.column-sort.new"), path.join(install, "resources/app.asar"));
const profile = { id: "copy-demo", name: "字段复制测试", dialect: "oracle", host: "demo.invalid", port: 1521, database: "APP", user: "APP" };
const longName = "DOUYIN_MERCHANT_IDENTIFIER_WITH_A_LONG_COLUMN_NAME";
fs.writeFileSync(path.join(temp, "settings.json"), JSON.stringify({ connections: [profile], ai: { model: "", baseUrl: "https://example.invalid/v1" }, theme: "champagne", history: [] }));
let app;
(async () => {
  try {
    const env = { ...process.env, QUERYDESK_TEST_USER_DATA: temp };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: process.env.QUERYDESK_TEST_EXE || path.join(install, "QueryDesk.exe"), env });
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
        else if (method === "table.browse") value = { def: { name: payload.table, schema: "APP", columns: ["ID", longName].map(name => ({ name, type: "VARCHAR2(100)", comment: name === "ID" ? "" : "商户编号", nullable: true })), indexes: [], foreignKeys: [] }, rows: (payload.sort?.direction === "asc" ? ["1", "2"] : ["2", "1"]).map(ID => ({ ID, [longName]: "merchant" })), hasMore: payload.page === 0, editable: false, reason: "测试数据" };
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
    const sortButton = (action, name = "ID") => page.getByRole("button", { name: `${action} ${name}`, exact: true });
    const lastBrowse = () => app.evaluate(() => globalThis.columnCopyCalls.filter(call => call.method === "table.browse").at(-1).payload);
    const browseCount = () => app.evaluate(() => globalThis.columnCopyCalls.filter(call => call.method === "table.browse").length);
    await sortButton("升序").waitFor();
    const beforeCopy = await browseCount();
    await button("ID").click();
    assert.equal(await browseCount(), beforeCopy, "复制不能触发服务端排序");
    const assertSort = async (direction, column = "ID") => {
      const nextLabel = direction === "asc" ? "降序" : direction === "desc" ? "取消排序" : "升序";
      await sortButton(nextLabel, column).waitFor();
      const payload = await lastBrowse();
      assert.deepEqual(payload.sort, direction ? { column, direction } : undefined);
      assert.equal(payload.page, 0, "更改排序应回到第一页");
    };
    await sortButton("升序").click();
    await assertSort("asc");
    assert.equal(await page.locator('.ag-root:visible .ag-row[row-index="0"] [col-id="ID"]').innerText(), "1");
    assert.match(await sortButton("降序").getAttribute("title"), /当前升序.*全部数据/);
    await sortButton("降序").focus();
    await page.keyboard.press("Enter");
    await assertSort("desc");
    assert.equal(await page.locator('.ag-root:visible .ag-row[row-index="0"] [col-id="ID"]').innerText(), "2");
    await sortButton("取消排序").focus();
    await page.keyboard.press("Space");
    await assertSort(null);
    await sortButton("升序", longName).click();
    await assertSort("asc", longName);
    await sortButton("升序").click();
    await assertSort("asc");
    await sortButton("升序", longName).waitFor();
    const footer = page.locator(".result-footer");
    await footer.getByRole("button", {name: /^升\s*序$/, exact: true}).click();
    await assertSort("desc");
    await page.getByRole("button", {name: /下一页/}).click();
    await page.waitForFunction(() => document.querySelector(".result-footer")?.textContent.includes("第 2 页"));
    assert.equal((await lastBrowse()).page, 1);
    assert.deepEqual((await lastBrowse()).sort, {column: "ID", direction: "desc"});
    await sortButton("取消排序").click();
    await assertSort(null);
    // 已应用筛选在排序和翻页后继续传给服务端。
    await page.getByRole("combobox", {name: "筛选字段", exact: true}).click();
    await page.locator('.ant-select-dropdown:visible').getByTitle("ID", {exact: true}).click();
    await page.getByRole("textbox", {name: "筛选值 1", exact: true}).fill("1");
    await page.locator("button").filter({hasText: /^应\s*用$/}).click();
    await page.waitForFunction(() => document.querySelector(".filter-builder")?.textContent.includes("已应用 1 个条件") || document.body.textContent.includes("已应用 1 个条件"));
    await sortButton("升序").click();
    await assertSort("asc");
    assert.deepEqual((await lastBrowse()).filters, [{column: "ID", op: "contains", value: "1"}]);
    await page.screenshot({ path: path.join(root, "design/column-sort-table.png") });
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
    const serverCalls = await browseCount();
    const firstId = () => page.locator('.ag-root:visible .ag-row[row-index="0"] [col-id="ID"]').innerText();
    await sortButton("升序").click();
    await sortButton("降序").waitFor();
    assert.equal(await firstId(), "1", "SQL 结果在本地升序排列");
    await sortButton("降序").click();
    await sortButton("取消排序").waitFor();
    assert.equal(await firstId(), "2");
    await sortButton("取消排序").click();
    await sortButton("升序").waitFor();
    assert.equal(await browseCount(), serverCalls, "SQL 结果排序不得重新查询数据库");
    const header = button("ID").locator("xpath=ancestor::*[@role='columnheader']");
    await header.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(el => el.getAttribute("aria-sort") === "ascending", await header.elementHandle());
    assert.equal(await app.evaluate(() => globalThis.columnCopyCalls.filter(c => ["query.run", "table.apply"].includes(c.method)).length), 0, "复制不得触发数据库执行");
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(root, "design/column-sort-query.png") });
    console.log("通过：列头服务端升序/降序/取消、换列/分页/筛选/底部同步、SQL 本地排序、排序按钮 Enter/Space，以及表数据和 SQL 结果悬浮注释/类型、无注释及未知来源、多行注释、复制反馈保留元数据、长字段/中文/空格/引号复制、Enter/Space、失败重试、原排序保留，无前端异常；未改变用户剪贴板或访问数据库。");
  } catch (error) {
    if (app) { const page = await app.firstWindow(); await page.screenshot({path: path.join(root, "design/column-sort-failure.png")}); console.log(await page.locator(".result-footer:visible").allTextContents()); console.log(await page.getByRole("button").allTextContents()); }
    throw error;
  } finally {
    if (app) await app.close();
    assert.ok(temp.startsWith(path.join(os.tmpdir(), "querydesk-copy-column-")));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
