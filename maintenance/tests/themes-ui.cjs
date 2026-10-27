"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { _electron: electron } = require(process.env.QUERYDESK_PLAYWRIGHT || "playwright");
const root = path.resolve(__dirname, "..");
const install = path.join(root, "theme-test");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "querydesk-themes-"));
const dataDir = path.join(temp, "user-data");
const profile = { id: "demo", name: "开发数据库", dialect: "oracle", host: "demo.local", port: 1521, database: "APP_DEMO", user: "DEMO" };
fs.mkdirSync(dataDir);
fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ connections: [profile], ai: { model: "deepseek-flash", baseUrl: "https://example.invalid/v1" }, theme: "light", history: [] }));
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
let app;
(async () => {
  try {
    const env = { ...process.env, QUERYDESK_TEST_USER_DATA: dataDir };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath: path.join(install, "QueryDesk.exe"), env });
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1558, 1010);
      const original = ipcMain._invokeHandlers.get("querydesk:call");
      globalThis.themeTestCalls = [];
      const state = { connected: true, autoCommit: false, readOnly: false, dirty: false, needsRollback: false, version: "Oracle Database 11g · 演示", schema: "APP_DEMO" };
      ipcMain.removeHandler("querydesk:call");
      ipcMain.handle("querydesk:call", (event, method, payload) => {
        globalThis.themeTestCalls.push({ method, payload });
        let value;
        if (["session.open", "session.reconnect", "session.state", "session.transaction"].includes(method)) value = state;
        else if (method === "session.close") value = {};
        else if (method === "schema.list") value = ["APP_DEMO"];
        else if (method === "object.list") value = ["MERCHANT", "ORDER", "USER", "PRODUCT", "PAYMENT"].map(name => ({ name, kind: "table", schema: "APP_DEMO" })).concat(["view", "sequence", "procedure", "function", "package", "trigger"].map(kind => ({ name: "DEMO_" + kind.toUpperCase(), kind, schema: "APP_DEMO" })));
        else if (method === "table.describe") value = { name: payload.table, schema: "APP_DEMO", columns: ["ID", "MERCHANT_CODE", "MERCHANT_NAME", "STATUS", "CREATE_TIME"].map(name => ({ name, type: "VARCHAR2(100)", nullable: true })), indexes: [], foreignKeys: [] };
        else if (method === "query.run") value = { state, results: [{ id: "demo-result", columns: ["ID", "MERCHANT_CODE", "MERCHANT_NAME", "STATUS", "CREATE_TIME"], rows: Array.from({ length: 100 }, (_, i) => ({ ID: i + 1, MERCHANT_CODE: `MCH${String(i + 1).padStart(4, "0")}`, MERCHANT_NAME: `示例商户${i + 1}`, STATUS: i % 2, CREATE_TIME: "2026-10-15 09:30:00" })), elapsed: 42, affected: 0, hasMore: false, truncated: false }] };
        else return original(event, method, payload);
        return { ok: true, value };
      });
    });
    await page.locator(".connection-main").waitFor();
    await page.locator(".connection-main").click();
    await page.locator(".monaco-editor .view-lines").waitFor();
    const sql = "SELECT ID, MERCHANT_CODE, MERCHANT_NAME, STATUS\nFROM MERCHANT WHERE ROWNUM <= 100;";
    await page.locator(".monaco-editor").click({ position: { x: 220, y: 35 } });
    await page.keyboard.press("Control+A");
    await page.keyboard.insertText(sql);
    await page.locator(".query-toolbar .ant-btn-primary").click();
    await page.locator(".ag-row").first().waitFor();
    await page.locator(".object-tree .ant-tree-switcher_close").first().click();
    await page.waitForTimeout(250);
    const runCount = () => app.evaluate(() => globalThis.themeTestCalls.filter(c => c.method === "query.run").length);
    assert.equal(await runCount(), 1);
    for (const [key, label] of [["light", "经典紫"], ["studio", "清透紫"], ["champagne", "香槟金"]]) {
      await page.getByRole("button", { name: "选择主题", exact: true }).click();
      await page.getByRole("menuitem", { name: new RegExp(label) }).click();
      await page.waitForFunction(key => document.documentElement.dataset.variant === key, key);
      await page.waitForTimeout(450);
      assert.equal((await page.evaluate(() => window.querydesk.call("settings.get"))).theme, key);
      assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"))).theme, key);
      assert.equal(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), key === "champagne" ? "dark" : "light", "窗口标题栏必须同步深浅主题");
      assert.equal(await runCount(), 1, "切换主题不能重新执行 SQL");
      assert.equal(await page.locator(".query-success-mark").count(), 1);
      assert.ok((await page.locator(".monaco-editor .view-lines").innerText()).includes("MERCHANT_CODE"));
      if (key !== "light") {
        assert.equal(await page.locator(".ai-bot").evaluate(img => img.complete && img.naturalWidth > 0), true);
        assert.ok(await page.getByText("你好，我是 QueryDesk AI", { exact: true }).isVisible());
      }
      await page.screenshot({ path: path.join(root, "design", `implementation-${key}.png`) });
    }
    const modelColors = await page.evaluate(() => ({ bg: getComputedStyle(document.querySelector(".monaco-editor-background")).backgroundColor, grid: getComputedStyle(document.querySelector(".ag-root-wrapper")).getPropertyValue("--ag-background-color") }));
    assert.equal(modelColors.bg, "rgb(17, 20, 24)", "编辑器必须应用香槟金的石墨黑背景");
    assert.ok(modelColors.grid.includes("111418") || modelColors.grid.includes("17, 20, 24"), "结果表格必须同步主题");
    await page.getByRole("button", { name: "查询商户表的核心字段", exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "AI 问题", exact: true }).inputValue(), "查询商户表的核心字段");
    await page.getByRole("textbox", { name: "AI 问题", exact: true }).fill("");
    await page.getByRole("button", { name: "生成导出 CSV 的 SQL", exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "AI 问题", exact: true }).inputValue(), "生成导出 CSV 的 SQL");
    await page.getByRole("textbox", { name: "AI 问题", exact: true }).fill("");
    await page.locator(".ai-compose > .ant-select").first().click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: "直接操作应用" }).click();
    await page.getByRole("button", { name: "AI 模型设置", exact: true }).click();
    await page.locator(".ant-modal-content").waitFor();
    await page.screenshot({ path: path.join(root, "design", "implementation-champagne-settings.png") });
    await page.locator(".ant-modal-close:visible").click();
    await page.waitForFunction(() => !Array.from(document.querySelectorAll(".ant-modal-wrap")).some(el => getComputedStyle(el).display !== "none"));
    for (const [width, height] of [[1280, 800], [1100, 760]]) {
      await app.evaluate(({ BrowserWindow }, { width, height }) => BrowserWindow.getAllWindows()[0].setContentSize(width, height), { width, height });
      await page.waitForTimeout(350);
      const checks = await page.evaluate(() => [".theme-picker", ".ai-compose", ".query-toolbar", ".tab-actions"].map(selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { selector, fits: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 };
      }));
      assert.ok(checks.every(c => c.fits), JSON.stringify(checks));
      await page.screenshot({ path: path.join(root, "design", `implementation-champagne-${width}.png`) });
    }
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.variant === "champagne");
    assert.equal(await runCount(), 1, "重载只能恢复草稿，不能重放查询");
    await assert.rejects(page.evaluate(() => window.querydesk.call("settings.theme", { theme: "yellow" })));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"))).theme, "champagne");
    assert.deepEqual(errors, []);
    await app.close();
    app = null;
    app = await electron.launch({ executablePath: path.join(install, "QueryDesk.exe"), env });
    const reopened = await app.firstWindow();
    await reopened.waitForFunction(() => document.documentElement.dataset.variant === "champagne");
    await reopened.locator(".monaco-editor-background").waitFor();
    assert.equal(await reopened.locator(".monaco-editor-background").first().evaluate(el => getComputedStyle(el).backgroundColor), "rgb(17, 20, 24)");
    assert.equal(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), "dark");
    console.log("通过：三个主题切换、真实设置持久化、重载恢复、SQL 与结果保留、单个成功标记、编辑器及表格配色、AI 推荐问题、设置弹窗、1280/1100 宽度、无前端异常。");
  } finally {
    if (app) await app.close();
    assert.ok(temp.startsWith(path.join(os.tmpdir(), "querydesk-themes-")));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
