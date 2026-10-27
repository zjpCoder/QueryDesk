"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { _electron: electron, expect } = require(process.env.QUERYDESK_PLAYWRIGHT || "@playwright/test");
const root = path.resolve(__dirname, "..");
const testDir = path.join(root, "codex-connect-test");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "querydesk-codex-ui-"));
const home = path.join(data, "codex-home");
fs.mkdirSync(home);
fs.mkdirSync(path.join(testDir, "resources"), { recursive: true });
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && /\.(exe|dll|pak|dat|bin)$/.test(entry.name) && !/Uninstall/.test(entry.name)) {
    const target = path.join(testDir, entry.name);
    if (!fs.existsSync(target)) fs.linkSync(path.join(root, entry.name), target);
  }
}
for (const dir of ["locales", "resources/runtime", "resources/app.asar.unpacked"]) {
  const target = path.join(testDir, dir);
  if (!fs.existsSync(target)) fs.symlinkSync(path.join(root, dir), target, "junction");
}
fs.copyFileSync(path.join(root, "resources/app.asar"), path.join(testDir, "resources/app.asar"));
fs.copyFileSync(path.join(root, "querydesk-mcp.cjs"), path.join(testDir, "querydesk-mcp.cjs"));
let app;
(async () => {
  try {
    const env = { ...process.env, QUERYDESK_TEST_USER_DATA: path.join(data, "user-data"), CODEX_HOME: home };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath: path.join(testDir, "QueryDesk.exe"), env });
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const button = page.getByRole("button", { name: "连接至 Codex", exact: true });
    await expect(button).toBeVisible();
    await button.hover();
    await expect(page.getByRole("tooltip")).toContainText("自动为本机 Codex 配置 QueryDesk MCP");
    await page.screenshot({ path: path.join(root, "codex-connect-preview.png") });
    await button.click();
    await expect(page.locator(".ant-modal-confirm-title").filter({ hasText: "Codex 配置成功" })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("重启 Codex 后，即可用自然语言查询数据库、查看表结构和执行数据库操作。")).toBeVisible();
    await page.getByRole("button", { name: "知道了" }).click();
    const config = path.join(home, "config.toml");
    const installed = fs.readFileSync(config, "utf8");
    await button.click();
    await expect(page.locator(".ant-modal-confirm-title").filter({ hasText: "Codex 已配置" })).toBeVisible();
    assert.equal(fs.readFileSync(config, "utf8"), installed);
    await page.getByRole("button", { name: "知道了" }).click();
    fs.writeFileSync(config, 'model = [损坏配置');
    await button.click();
    await expect(page.getByText(/无法读取 Codex MCP 配置/)).toBeVisible();
    await expect(button).toBeEnabled();
    assert.equal(fs.readFileSync(config, "utf8"), 'model = [损坏配置');
    assert.deepEqual(errors, []);
    console.log("通过：安装版按钮可见、悬浮说明、真实 IPC 首次配置、重复点击、失败提示、按钮状态恢复，无前端异常。");
  } finally {
    if (app) await app.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
