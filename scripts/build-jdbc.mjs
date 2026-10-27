import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const build = path.resolve('.cache/jdbc-classes');
fs.mkdirSync(build, { recursive: true });
execFileSync('javac', ['--release', '11', '-encoding', 'UTF-8', '-cp', 'runtime/jdbc/*', '-d', build, 'java/QueryDeskBridge.java'], { stdio: 'inherit', windowsHide: true });
execFileSync('jar', ['--create', '--file', 'runtime/jdbc/querydesk-bridge.jar', '-C', build, '.'], { stdio: 'inherit', windowsHide: true });
