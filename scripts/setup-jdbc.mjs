import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const manifest=JSON.parse(fs.readFileSync('runtime/manifest.json','utf8'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function download(asset,file) {
  if(fs.existsSync(file)&&hash(fs.readFileSync(file))===asset.sha256)return;
  const response=await fetch(asset.url);if(!response.ok)throw new Error(`下载失败 HTTP ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());if(hash(bytes)!==asset.sha256)throw new Error('运行时 SHA256 不匹配');
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);
}
for(const asset of manifest.jars)await download(asset,'runtime/jdbc/'+asset.file);
if(!fs.existsSync('runtime/java/bin/java.exe')) {
  const work=path.resolve('.cache/jdbc-setup');fs.mkdirSync(work,{recursive:true});
  const zip=path.join(work,'java.zip'), extracted=path.join(work,'extracted');
  await download(manifest.java,zip);
  const env={...process.env,QD_JAVA_ZIP:zip,QD_JAVA_EXTRACT:extracted};
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Expand-Archive -LiteralPath $env:QD_JAVA_ZIP -DestinationPath $env:QD_JAVA_EXTRACT -Force'],{env,stdio:'inherit',windowsHide:true});
  const root=fs.readdirSync(extracted,{withFileTypes:true}).find(d=>d.isDirectory());if(!root)throw new Error('Java 压缩包结构无效');
  fs.cpSync(path.join(extracted,root.name),'runtime/java',{recursive:true});
}
console.log('内置 JDBC 运行环境已准备，下载校验通过');
