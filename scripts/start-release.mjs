import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import electron from 'electron';
import { root, verifySnapshot } from './verify-snapshot.mjs';

verifySnapshot();
if (!fs.existsSync(path.join(root, 'dist-electron/main.cjs'))) throw new Error('请先运行 npm run build:release');
const env = { ...process.env, QUERYDESK_JDBC_ROOT: path.join(root, 'runtime') };
delete env.ELECTRON_RUN_AS_NODE;
delete env.QUERYDESK_DEV_URL;
const child = spawn(electron, [root], { stdio: 'inherit', env, windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
