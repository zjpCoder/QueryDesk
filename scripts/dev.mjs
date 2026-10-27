import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import './build-jdbc.mjs';
import './build.mjs';
import electron from 'electron';
const server = await createServer();
await server.listen();
const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, QUERYDESK_DEV_URL: 'http://127.0.0.1:5173' } });
child.on('exit', async code => { await server.close(); process.exit(code ?? 0); });
