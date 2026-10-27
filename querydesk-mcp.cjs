"use strict";
const net = require("node:net");
const crypto = require("node:crypto");
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const port = 43000 + crypto.randomInt(0, 1000);
const token = crypto.randomBytes(24).toString("hex");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const backend = spawn(process.execPath, [`--mcp-host=${port}`, `--mcp-token=${token}`], { stdio: ["ignore", "ignore", "inherit"], windowsHide: true, env });
let socket;
let connecting;
function connect() {
  if (socket && !socket.destroyed) return Promise.resolve(socket);
  if (connecting) return connecting;
  connecting = new Promise((resolve, reject) => {
    const started = Date.now();
    const attempt = () => {
      const candidate = net.connect({ host: "127.0.0.1", port }, () => {
        socket = candidate;
        socket.setNoDelay(true);
        socket.on("data", (chunk) => process.stdout.write(chunk));
        socket.on("close", () => { socket = undefined; });
        resolve(socket);
      });
      candidate.once("error", () => {
        candidate.destroy();
        if (Date.now() - started > 15000) reject(new Error("QueryDesk MCP 后端启动超时"));
        else setTimeout(attempt, 100);
      });
    };
    attempt();
  }).finally(() => { connecting = undefined; });
  return connecting;
}
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", async (line) => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); }
  catch { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "无效 JSON" } }) + "\n"); return; }
  try { const channel = await connect(); channel.write(JSON.stringify({ ...request, _querydeskToken: token }) + "\n"); }
  catch (error) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id ?? null, error: { code: -32603, message: error.message } }) + "\n"); }
});
input.on("close", () => { socket?.end(); backend.kill(); });
backend.on("exit", (code) => { if (code && !socket) process.stderr.write(`QueryDesk MCP 后端退出：${code}\n`); });
