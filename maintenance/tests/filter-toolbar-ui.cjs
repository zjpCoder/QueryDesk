"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { _electron } = require(process.env.QUERYDESK_PLAYWRIGHT || "playwright");
const root = path.resolve(__dirname, "..");
const install = path.join(root, "design/filter-toolbar-test");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "querydesk-filter-toolbar-"));
fs.mkdirSync(path.join(install, "resources"), { recursive: true });
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && /\.(exe|dll|pak|dat|bin)$/.test(entry.name) && !/Uninstall/.test(entry.name)) {
    const target = path.join(install, entry.name);
    if (!fs.existsSync(target)) fs.linkSync(path.join(root, entry.name), target);
  }
}
for (const dir of ["locales", "resources/runtime", "resources/app.asar.unpacked"]) {
  const target = path.join(install, dir);
  if (!fs.existsSync(target)) fs.symlinkSync(path.join(root, dir), target, "junction");
}
fs.copyFileSync(process.env.QUERYDESK_TOOLBAR_ARCHIVE || path.join(root, "resources/app.asar.filter-toolbar.new"), path.join(install, "resources/app.asar"));
fs.writeFileSync(path.join(temp, "settings.json"), JSON.stringify({ connections: [{ id: "toolbar-demo", name: "工具栏测试", dialect: "oracle", host: "demo.invalid", port: 1521, database: "APP", user: "APP" }], ai: { model: "", baseUrl: "https://example.invalid/v1" }, theme: "champagne", history: [] }));
let app;
(async () => {
  try {
    const env = { ...process.env, QUERYDESK_TEST_USER_DATA: temp };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: process.env.QUERYDESK_TEST_EXE || path.join(install, "QueryDesk.exe"), env });
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1504, 900);
      const original = ipcMain._invokeHandlers.get("querydesk:call");
      globalThis.toolbarCalls = [];
      globalThis.toolbarFail = false;
      ipcMain.removeHandler("querydesk:call");
      ipcMain.handle("querydesk:call", (event, method, payload) => {
        globalThis.toolbarCalls.push({ method, payload });
        let value;
        if (["session.open", "session.state"].includes(method)) value = { connected: true, autoCommit: true, readOnly: false, dirty: false, needsRollback: false, schema: "APP", version: "隔离测试" };
        else if (method === "session.close") value = {};
        else if (method === "schema.list") value = ["APP"];
        else if (method === "object.list") value = [{ name: "MERCHANT", schema: "APP", kind: "table" }];
        else if (method === "table.browse") {
          if (globalThis.toolbarFail) return { ok: false, error: "模拟读取失败" };
          value = { def: { name: payload.table, schema: "APP", columns: ["ID", "LOGIN_NAME", "STATUS"].map(name => ({ name, type: "VARCHAR2(100)", comment: "", nullable: true })), indexes: [], foreignKeys: [] }, rows: [{ ID: "1", LOGIN_NAME: "merchant", STATUS: "1" }], hasMore: payload.page === 0, editable: true };
        } else return original(event, method, payload);
        return { ok: true, value };
      });
    });
    await page.locator(".connection-main").click();
    await page.getByPlaceholder("搜索数据库对象…", { exact: true }).fill("MERCHANT");
    await page.locator(".object-title").filter({ hasText: "MERCHANT" }).dblclick();
    const sort = page.getByRole("combobox", { name: "排序字段", exact: true });
    const direction = page.getByRole("button", { name: "切换排序方向", exact: true });
    const value = page.getByRole("textbox", { name: "筛选值 1", exact: true });
    const lastBrowse = () => app.evaluate(() => globalThis.toolbarCalls.filter(c => c.method === "table.browse").at(-1).payload);
    const choose = async (select, label) => {
      await select.locator("xpath=ancestor::div[contains(@class,'ant-select-single')][1]").click();
      await page.locator(".ant-select-dropdown:visible").getByTitle(label, { exact: true }).click();
    };
    await sort.waitFor();
    for (const name of ["设为 NULL", "导出本页", "导出整表"]) assert.equal(await page.locator(".data-toolbar").getByRole("button", { name, exact: true }).count(), 0);
    assert.equal(await page.locator(".result-footer .ant-select").count(), 0);
    assert.equal(await direction.isEnabled(), false);
    assert.ok((await value.boundingBox()).width <= 181);
    const rowBox = await value.boundingBox(), sortBox = await sort.locator("xpath=ancestor::div[contains(@class,'ant-select-single')][1]").boundingBox();
    assert.ok(Math.abs(rowBox.y - sortBox.y) < 2, "排序和筛选值在同一行");
    await choose(sort, "STATUS");
    await page.getByRole("button", { name: "降序 STATUS", exact: true }).waitFor();
    assert.deepEqual((await lastBrowse()).sort, { column: "STATUS", direction: "asc" });
    await direction.click();
    await page.getByRole("button", { name: "取消排序 STATUS", exact: true }).waitFor();
    assert.deepEqual((await lastBrowse()).sort, { column: "STATUS", direction: "desc" });
    await choose(page.getByRole("combobox", { name: "筛选字段", exact: true }), "ID");
    await value.fill("1");
    await value.press("Enter");
    await page.waitForFunction(() => document.querySelector(".filter-builder").textContent.includes("已应用 1 个条件"));
    await page.getByRole("button", { name: /下一页/ }).click();
    await page.waitForFunction(() => document.querySelector(".result-footer").textContent.includes("第 2 页"));
    assert.deepEqual((await lastBrowse()).filters, [{ column: "ID", op: "contains", value: "1" }]);
    assert.deepEqual((await lastBrowse()).sort, { column: "STATUS", direction: "desc" });
    await choose(sort, "LOGIN_NAME");
    await page.getByRole("button", { name: "取消排序 LOGIN_NAME", exact: true }).waitFor();
    assert.equal((await lastBrowse()).page, 0);
    assert.deepEqual((await lastBrowse()).sort, { column: "LOGIN_NAME", direction: "desc" });
    await page.getByRole("button", { name: "升序 ID", exact: true }).click();
    await page.getByRole("button", { name: "降序 ID", exact: true }).waitFor();
    assert.equal(await sort.inputValue(), "");
    assert.ok((await page.locator(".table-sort-controls").textContent()).includes("ID"));
    await sort.locator("xpath=ancestor::div[contains(@class,'ant-select-single')][1]").hover();
    await page.locator(".table-sort-controls .ant-select-clear").click();
    await page.waitForFunction(() => document.querySelector('[aria-label="切换排序方向"]').disabled);
    assert.equal((await lastBrowse()).sort, undefined);
    await page.getByRole("button", { name: "添加条件", exact: true }).click();
    assert.equal(await page.locator(".filter-row").count(), 2);
    assert.equal(await page.getByRole("combobox", { name: "排序字段", exact: true }).count(), 1);
    await page.getByRole("button", { name: "移除条件 2", exact: true }).click();
    await page.getByRole("button", { name: "移除条件 1", exact: true }).click();
    assert.equal(await page.locator(".filter-row").count(), 0);
    await choose(sort, "STATUS");
    await page.getByRole("button", { name: "降序 STATUS", exact: true }).waitFor();
    assert.deepEqual((await lastBrowse()).sort, { column: "STATUS", direction: "asc" });
    await page.getByRole("button", { name: /^清\s*除$/ }).click();
    await value.waitFor();
    await page.screenshot({ path: path.join(root, "design/filter-toolbar.png") });
    for (const width of [1280, 1100]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 800), width);
      await page.waitForTimeout(150);
      const bounds = await page.locator(".filter-builder").boundingBox();
      for (const item of [value, sort, direction, page.getByRole("button", { name: "移除条件 1", exact: true })]) {
        const box = await item.boundingBox();
        assert.ok(box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width + 1, `窄窗口 ${width} 控件不能横向溢出`);
      }
      await page.screenshot({ path: path.join(root, `design/filter-toolbar-${width}.png`) });
    }
    assert.deepEqual(errors, []);
    assert.equal(await app.evaluate(() => globalThis.toolbarCalls.filter(c => ["table.apply", "query.run", "file.export"].includes(c.method)).length), 0);
    console.log("通过：移除红框按钮、筛选值宽度与同行布局、排序字段/方向/取消、列头同步、筛选与翻页、移除全部条件、1100/1280 窄窗口；无前端异常，未访问数据库。");
  } catch (error) {
    if (app) await (await app.firstWindow()).screenshot({ path: path.join(root, "design/filter-toolbar-failure.png") });
    throw error;
  } finally {
    if (app) await app.close();
    assert.ok(temp.startsWith(path.join(os.tmpdir(), "querydesk-filter-toolbar-")));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
