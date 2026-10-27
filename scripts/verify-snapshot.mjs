import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
export function verifySnapshot() {
  const snapshot = path.join(root, 'runtime-snapshot');
  const manifest = JSON.parse(fs.readFileSync(path.join(snapshot, 'manifest.json'), 'utf8'));
  for (const [name, expected] of Object.entries(manifest.files)) {
    const target = path.resolve(snapshot, name);
    if (!target.startsWith(snapshot + path.sep)) throw new Error('快照路径超出目录');
    const data = fs.readFileSync(target);
    if (data.length !== expected.size || crypto.createHash('sha256').update(data).digest('hex') !== expected.sha256) {
      throw new Error(`发布快照校验失败：${name}`);
    }
  }
  console.log(`发布快照校验通过：${Object.keys(manifest.files).length} 个文件，${manifest.version}`);
  return snapshot;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) verifySnapshot();
