import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, verifySnapshot } from './verify-snapshot.mjs';

const snapshot = verifySnapshot();
for (const name of ['dist', 'dist-electron']) {
  const target = path.resolve(root, name);
  if (path.dirname(target) !== path.resolve(root)) throw new Error('构建目录不合法');
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(path.join(snapshot, name), target, { recursive: true });
}
fs.copyFileSync(path.join(snapshot, 'THIRD_PARTY_NOTICES.txt'), path.join(root, 'THIRD_PARTY_NOTICES.txt'));
// 安装版增加的 JDBC 字段类型补丁，用可读 Java 源码重新编译。
const classes = path.join(root, '.cache/jdbc-classes');
fs.mkdirSync(classes, { recursive: true });
execFileSync('javac', ['--release', '17', '-encoding', 'UTF-8', '-d', classes, path.join(root, 'java/QueryDeskBridge$Cursor.java')], { stdio: 'inherit', windowsHide: true });
execFileSync('jar', ['--update', '--file', path.join(root, 'runtime/jdbc/querydesk-bridge.jar'), '-C', classes, 'QueryDeskBridge$Cursor.class'], { stdio: 'inherit', windowsHide: true });
console.log('已组装当前发布版代码；原始 TypeScript 工程保留在 src/、electron/。');
