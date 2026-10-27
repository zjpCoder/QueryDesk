"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);

function findCodex() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const bin = path.join(local, "OpenAI", "Codex", "bin");
  const versions = fs.existsSync(bin) ? fs.readdirSync(bin, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(bin, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs) : [];
  const candidates = [
    ...versions.map(dir => path.join(dir, "codex.exe")),
    path.join(os.homedir(), ".codex", ".sandbox-bin", "codex.exe"),
    path.join(bin, "codex.exe"),
    ...(process.env.PATH || "").split(path.delimiter).filter(Boolean).map(dir => path.join(dir, "codex.exe")),
    path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "npm", "node_modules", "@openai", "codex", "vendor",
      process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc", "codex", "codex.exe")
  ];
  const executable = candidates.find(file => fs.existsSync(file) && fs.statSync(file).isFile());
  if (!executable) throw new Error("未找到本机 Codex，请先安装并启动 Codex，再点击连接。");
  return executable;
}

let configuring;
function configureCodex(appDir) {
  // ponytail: 同一进程合并重复点击，配置交给 Codex 自带的 TOML 编辑器。
  if (configuring) return configuring;
  configuring = install(appDir).finally(() => { configuring = undefined; });
  return configuring;
}
async function install(appDir) {
  const command = path.join(appDir, "QueryDesk.exe");
  const script = path.join(appDir, "querydesk-mcp.cjs");
  if (![command, script].every(file => fs.existsSync(file))) {
    throw new Error("QueryDesk MCP 启动文件缺失，请重新安装 QueryDesk。");
  }
  const codex = findCodex();
  const home = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const configPath = path.join(home, "config.toml");
  const options = { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024,
    encoding: "utf8", cwd: appDir, env: { ...process.env, CODEX_HOME: home } };
  let servers;
  try {
    servers = JSON.parse((await run(codex, ["mcp", "list", "--json"], options)).stdout);
    if (!Array.isArray(servers)) throw new Error();
  } catch {
    throw new Error("无法读取 Codex MCP 配置，请检查 Codex 是否正常运行及 config.toml 是否有效。");
  }
  const matches = server => server?.name === "querydesk" && server.enabled !== false &&
    server.transport?.type === "stdio" && server.transport.command === command &&
    server.transport.args?.length === 1 && server.transport.args[0] === script &&
    server.transport.env?.ELECTRON_RUN_AS_NODE === "1";
  if (servers.some(matches)) return { configPath, alreadyConfigured: true };
  let backupPath;
  try {
    if (fs.existsSync(configPath)) {
      backupPath = configPath + ".querydesk-" + crypto.randomUUID() + ".bak";
      fs.copyFileSync(configPath, backupPath, fs.constants.COPYFILE_EXCL);
    }
    await run(codex, ["mcp", "add", "querydesk", "--env", "ELECTRON_RUN_AS_NODE=1", "--", command, script], options);
    const installed = JSON.parse((await run(codex, ["mcp", "get", "querydesk", "--json"], options)).stdout);
    if (!matches(installed)) throw new Error();
  } catch {
    throw new Error("Codex MCP 配置未完成，请检查配置目录写入权限后重试。" +
      (backupPath ? "原配置已备份至：" + backupPath : ""));
  }
  return { configPath, backupPath, alreadyConfigured: false };
}
module.exports = { configureCodex, findCodex };
