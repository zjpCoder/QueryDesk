"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { findCodex } = require("../codex-connect-app/dist-electron/codex-config.cjs");
const installer = path.resolve(__dirname, "../codex-connect-app/dist-electron/codex-config.cjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "querydesk-codex-connect-"));
const appDir = path.join(temp, "QueryDesk 中文 & 空格");
const home = path.join(temp, "codex-home");
fs.mkdirSync(appDir);
fs.mkdirSync(home);
for (const file of ["QueryDesk.exe", "querydesk-mcp.cjs"]) fs.writeFileSync(path.join(appDir, file), "");
const config = path.join(home, "config.toml");
function connect() {
  const code = "const {configureCodex}=require(process.argv[1]); Promise.all([configureCodex(process.argv[2]),configureCodex(process.argv[2])]).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.log(JSON.stringify({error:e.message}));});";
  return JSON.parse(execFileSync(process.execPath, ["-e", code, installer, appDir], {
    encoding: "utf8", windowsHide: true, env: { ...process.env, CODEX_HOME: home }
  }));
}
function get(name) {
  return JSON.parse(execFileSync(findCodex(), ["mcp", "get", name, "--json"], {
    encoding: "utf8", windowsHide: true, cwd: appDir, env: { ...process.env, CODEX_HOME: home }
  }));
}
try {
  const original = '# 保留原配置\nmodel = "gpt-5"\n[mcp_servers.other]\ncommand = "other-server"\nargs = ["keep"]\n[mcp_servers.other.env]\nCUSTOM = "保留"\n';
  fs.writeFileSync(config, original);
  const first = connect();
  assert.equal(first[0].alreadyConfigured, false);
  assert.deepEqual(first[0], first[1]);
  assert.equal(fs.readFileSync(first[0].backupPath, "utf8"), original);
  assert.equal(get("other").transport.env.CUSTOM, "保留");
  assert.equal(get("other").transport.command, "other-server");
  assert.match(fs.readFileSync(config, "utf8"), /model = "gpt-5"/);
  assert.equal(get("querydesk").transport.command, path.join(appDir, "QueryDesk.exe"));
  assert.deepEqual(get("querydesk").transport.args, [path.join(appDir, "querydesk-mcp.cjs")]);
  assert.equal(get("querydesk").transport.env.ELECTRON_RUN_AS_NODE, "1");
  const installed = fs.readFileSync(config, "utf8");
  assert.equal(connect()[0].alreadyConfigured, true);
  assert.equal(fs.readFileSync(config, "utf8"), installed);
  assert.equal(fs.readdirSync(home).filter(file => file.endsWith(".bak")).length, 1);
  fs.writeFileSync(config, original + '\n[mcp_servers.querydesk]\ncommand = "old-path"\nenabled = false\n');
  assert.equal(connect()[0].alreadyConfigured, false);
  assert.equal(get("querydesk").enabled, true);
  assert.equal(get("other").transport.env.CUSTOM, "保留");
  const invalid = 'model = [损坏配置';
  fs.writeFileSync(config, invalid);
  assert.match(connect().error, /无法读取/);
  assert.equal(fs.readFileSync(config, "utf8"), invalid);
  fs.unlinkSync(config);
  assert.equal(connect()[0].alreadyConfigured, false);
  fs.unlinkSync(path.join(appDir, "querydesk-mcp.cjs"));
  const before = fs.readFileSync(config, "utf8");
  assert.match(connect().error, /启动文件缺失/);
  assert.equal(fs.readFileSync(config, "utf8"), before);
  console.log("通过：首次配置、保留其他设置、中文及特殊字符路径、备份、重复/并发点击、更新旧连接、无配置文件、损坏配置及缺失启动文件。");
} finally {
  // 仅清理本测试自行创建的临时目录。
  fs.rmSync(temp, { recursive: true, force: true });
}
