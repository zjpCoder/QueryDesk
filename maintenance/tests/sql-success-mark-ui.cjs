"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { _electron: electron } = require(process.env.QUERYDESK_PLAYWRIGHT || "playwright");
const root = path.resolve(__dirname, "..");
const assets = path.join(root, "codex-connect-app/dist/assets");
const bundle = fs.readFileSync(path.join(assets, "index-BiPxEQzb.js"), "utf8");
const mark = bundle.slice(bundle.indexOf("function B(J,Z=!1)"), bundle.indexOf("function K(){k.current?.clear()"));
assert.ok(mark.startsWith("function B("), "必须找到实际使用的成功标记函数");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "querydesk-success-mark-"));
for (const name of fs.readdirSync(assets)) fs.copyFileSync(path.join(assets, name), path.join(temp, name));
fs.appendFileSync(path.join(temp, "EditorCore-DPy74pA7.js"), "\nexport { FI as testEditor };\n");
fs.writeFileSync(path.join(temp, "index.html"), '<!doctype html><link rel="stylesheet" href="EditorCore-COg077tV.css"><link rel="stylesheet" href="index-BXVoCd3S.css"><div id="root" hidden></div><div id="editor" style="width:420px;height:400px"></div>');
let app;
(async () => {
  try {
    const env = { ...process.env, QUERYDESK_TEST_USER_DATA: path.join(temp, "user-data") };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath: path.join(root, "QueryDesk.exe"), env });
    const page = await app.firstWindow();
    await page.goto(pathToFileURL(path.join(temp, "index.html")).href);
    await page.evaluate(async ({ core, mark }) => {
      const { testEditor } = await import(core);
      const editor = testEditor.create(document.getElementById("editor"), {
        value: "", language: "sql", wordWrap: "on", lineHeight: 25,
        lineDecorationsWidth: 20, minimap: { enabled: false }, scrollBeyondLastLine: false
      });
      const U = { current: editor.createDecorationsCollection() };
      const q = { current: editor };
      window.fixture = { editor, marks: U.current, draw: new Function("q", "U", `${mark};return B;`)(q, U) };
    }, { core: pathToFileURL(path.join(temp, "EditorCore-DPy74pA7.js")).href, mark });
    async function draw(sql, lines) {
      await page.evaluate(({ sql, lines }) => {
        const { editor, marks, draw } = window.fixture;
        marks.clear();
        editor.setValue(sql);
        const model = editor.getModel();
        draw({ model, version: model.getVersionId(), start: 0, lines });
        editor.render(true);
      }, { sql, lines });
      await page.waitForTimeout(100);
      return page.locator(".query-success-mark").count();
    }
    const longSQL = "SELECT " + Array.from({ length: 24 }, (_, i) => `COLUMN_${i}`).join(", ") + " FROM TABLE_A;";
    assert.equal(await draw(longSQL, [1]), 1, "长 SQL 自动折行后只能显示一个对号");
    assert.ok(await page.locator("#editor .view-line").count() > 2, "必须实际触发多次自动折行");
    await page.evaluate(() => { const e = window.fixture.editor; e.getDomNode().style.width = "260px"; e.layout(); e.render(true); });
    await page.waitForTimeout(100);
    assert.equal(await page.locator(".query-success-mark").count(), 1, "窗口变窄后仍只有一个对号");
    assert.equal(await draw("SELECT COLUMN_1,\n COLUMN_2\nFROM TABLE_A;", [1]), 1, "手动换行的一条 SQL 只有一个对号");
    assert.equal(await draw(longSQL + "\nSELECT 2;", [1, 2]), 2, "两条 SQL 各显示一个对号");
    await page.evaluate(() => { window.fixture.marks.clear(); window.fixture.editor.render(true); });
    await page.waitForTimeout(100);
    assert.equal(await page.locator(".query-success-mark").count(), 0, "清除执行状态后不残留对号");
    console.log("通过：长 SQL 自动折行、窗口变窄、手动换行、多条 SQL、清除标记。");
  } finally {
    if (app) await app.close();
    assert.ok(temp.startsWith(path.join(os.tmpdir(), "querydesk-success-mark-")));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
