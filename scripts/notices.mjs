import fs from 'node:fs';
import path from 'node:path';
const notices = ['QueryDesk 第三方依赖许可说明\n\n以下包含本项目依赖（含开发工具）的许可证。Electron 分发目录另含 LICENSE 和 LICENSES.chromium.html。Oracle JDBC 使用 FUTC 许可；Gson 使用 Apache-2.0；内置 Eclipse Temurin 使用 GPLv2 + Classpath Exception，完整许可保存在 runtime/java/legal。Oracle Instant Client 不随本产品分发。'];
function visit(root) {
  if (!fs.existsSync(root)) return;
  for (const item of fs.readdirSync(root, { withFileTypes: true })) {
    if (!item.isDirectory() || item.name.startsWith('.')) continue;
    const folder = path.join(root, item.name);
    if (item.name.startsWith('@')) { visit(folder); continue; }
    const file = path.join(folder, 'package.json'); if (!fs.existsSync(file)) continue;
    const p = JSON.parse(fs.readFileSync(file, 'utf8'));
    const licenses = fs.readdirSync(folder).filter(n => /^(licen[sc]e|copying|notice)(\.|$)/i.test(n) && fs.statSync(path.join(folder,n)).isFile());
    notices.push(`\n${'='.repeat(72)}\n${p.name} ${p.version}\nLicense: ${typeof p.license === 'string' ? p.license : JSON.stringify(p.license ?? '参见项目来源')}\n${typeof p.repository === 'string' ? p.repository : p.repository?.url ?? p.homepage ?? ''}\n${licenses.map(n=>fs.readFileSync(path.join(folder,n),'utf8')).join('\n')}`);
    visit(path.join(folder,'node_modules'));
  }
}
visit('node_modules');
for (const name of ['ORACLE-LICENSE.txt','GSON-LICENSE.txt']) notices.push(fs.readFileSync('runtime/licenses/'+name,'utf8'));
fs.writeFileSync('THIRD_PARTY_NOTICES.txt', notices.join('\n'), 'utf8');
