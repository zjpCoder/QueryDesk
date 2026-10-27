import { build } from 'esbuild';
import './notices.mjs';
await build({ entryPoints: ['electron/main.ts', 'electron/preload.ts', 'electron/worker.ts'], outdir: 'dist-electron', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron', 'mysql2', 'mysql2/promise'], sourcemap: true });
