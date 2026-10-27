import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createInterface } from 'node:readline';
import { maskSql } from '../src/shared/sql';

export function jdbcBinds(sql: string, values: Record<string, unknown>) {
  const mask = maskSql(sql, 'oracle'); const binds: unknown[] = []; let last = 0, text = '';
  for (const match of mask.matchAll(/(?<!:):([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (!(match[1] in values)) throw new Error(`缺少参数 :${match[1]}`);
    text += sql.slice(last, match.index) + '?'; last = match.index! + match[0].length; binds.push(values[match[1]]);
  }
  return { sql: text + sql.slice(last), binds };
}
let child: ChildProcessWithoutNullStreams | undefined;
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
function start() {
  if (child) return child;
  const root = process.env.QUERYDESK_JDBC_ROOT || path.resolve(__dirname, '../runtime');
  const java = path.join(root, 'java/bin/java.exe');
  if (!fs.existsSync(java) || !fs.existsSync(path.join(root, 'jdbc/querydesk-bridge.jar'))) throw new Error('内置 JDBC 运行环境缺失，请重新安装 QueryDesk');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (['JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', '_JAVA_OPTIONS', 'CLASSPATH'].includes(key.toUpperCase())) delete env[key];
  const current = spawn(java, ['-Xms16m', '-Xmx256m', '-XX:+UseSerialGC', '-Dfile.encoding=UTF-8', '-cp', path.join(root, 'jdbc/*'), 'QueryDeskBridge', String(process.pid)], { windowsHide: true, stdio: 'pipe', env });
  child = current;
  const fail = () => { if (child !== current) return; child = undefined; for (const p of pending.values()) p.reject(new Error('JDBC 工作进程已退出，请关闭标签后重新连接；写操作不会自动重试')); pending.clear(); };
  current.on('error', fail); current.on('exit', fail); current.stdin.on('error', fail);
  current.stderr.resume(); // No driver dumps in application logs.
  createInterface({ input: current.stdout }).on('line', line => {
    try { const response = JSON.parse(line); const p = pending.get(response.id); if (!p) return; pending.delete(response.id); response.ok ? p.resolve(response.value) : p.reject(new Error(response.error)); }
    catch { fail(); current.kill(); }
  });
  return current;
}
function rpc(method: string, payload: object = {}) {
  const process = start(); const id = crypto.randomUUID();
  return new Promise<any>((resolve, reject) => { pending.set(id, { resolve, reject }); process.stdin.write(JSON.stringify({ id, method, ...payload }) + '\n'); });
}
export function inspectJdbc() { return rpc('inspect'); }
export function stopJdbc() { child?.stdin.end(); }
export async function openJdbc(options: { user: string; password: string; connectString: string }) {
  const info = await rpc('connect', options); const owner = child;
  const call = (method: string, payload: object = {}) => { if (!owner || child !== owner) return Promise.reject(new Error('JDBC 会话已关闭，请重新连接')); return rpc(method, { session: info.session, ...payload }); };
  return {
    oracleServerVersionString: info.version,
    async execute(sql: string, binds: Record<string, unknown> = {}, options: { resultSet?: boolean; autoCommit?: boolean } = {}) {
      const result = await call('execute', { ...jdbcBinds(sql, binds), resultSet: !!options.resultSet, autoCommit: !!options.autoCommit });
      if (result.cursor) result.resultSet = { metaData: result.metaData, getRows: (count: number) => call('fetch', { cursor: result.cursor, count }), close: () => call('cursor.close', { cursor: result.cursor }) };
      return result;
    },
    commit: () => call('commit'), rollback: () => call('rollback'), close: () => call('close'), break: () => call('cancel')
  };
}
