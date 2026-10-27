import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { workspaceDraft } from './validation';
import type { SqlFile, WorkspaceDraft, WorkspaceSnapshot } from '../src/shared/types';

type Document = SqlFile & { hash:string };
const digest=(buffer:Buffer)=>crypto.createHash('sha256').update(buffer).digest('hex');
export function decodeSql(bytes:Buffer) {
  if(bytes.length>4*1024*1024)throw new Error('SQL 文件超过 4 MiB，请拆分后打开');
  let sql:string;
  try { sql=bytes[0]===0xff&&bytes[1]===0xfe?new TextDecoder('utf-16le',{fatal:true}).decode(bytes):bytes[0]===0xfe&&bytes[1]===0xff?new TextDecoder('utf-16be',{fatal:true}).decode(bytes):new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
  catch {throw new Error('文件不是有效的 UTF-8 / UTF-16，请转换编码后打开');}
  if(sql.includes('\0'))throw new Error('SQL 文件包含二进制内容');
  if(sql.length>1000000)throw new Error('SQL 文件超过 100 万字符，请拆分后打开');
  return sql;
}
function atomicWrite(file:string,bytes:string|Buffer){
  const tmp=file+'.'+crypto.randomUUID()+'.tmp';
  try{fs.writeFileSync(tmp,bytes,{flag:'wx'});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
/** 文件路径只能来自系统对话框；渲染器保存时仅能引用已打开文件的 ID。 */
export class WorkspaceStore {
  private documents=new Map<string,Document>();
  private snapshot:WorkspaceDraft={tabs:[],activeId:''};
  private loadError:Error|undefined;
  constructor(private file:string,private encrypt:(s:string)=>string,private decrypt:(s:string)=>string){
    if(!fs.existsSync(file))return;
    try{
      const parsed=JSON.parse(decrypt(fs.readFileSync(file,'utf8')));
      this.snapshot=workspaceDraft.parse(parsed);
      for(const d of parsed.files??[]){
        if(typeof d.id!=='string'||typeof d.path!=='string'||!path.isAbsolute(d.path)||typeof d.savedSql!=='string'||typeof d.hash!=='string')throw new Error();
        this.documents.set(d.id,{...d,name:path.basename(d.path)});
      }
    }catch{this.loadError=new Error('工作区草稿无法读取，原文件已保留；请备份后修复，避免覆盖原草稿');}
  }
  get():WorkspaceSnapshot{if(this.loadError)throw this.loadError;const used=new Set(this.snapshot.tabs.map(t=>t.fileId));return {...this.snapshot,files:[...this.documents.values()].filter(d=>used.has(d.id)).map(({hash,...d})=>d)};}
  save(value:WorkspaceDraft){
    if(this.loadError)throw this.loadError;
    const snapshot=workspaceDraft.parse(value);
    const files=[...new Set(snapshot.tabs.flatMap(t=>t.fileId?[t.fileId]:[]))].map(id=>this.document(id));
    const text=JSON.stringify({...snapshot,files});
    if(Buffer.byteLength(text)>20*1024*1024)throw new Error('工作区草稿超过 20 MiB，请将 SQL 保存为文件并关闭多余标签');
    fs.mkdirSync(path.dirname(this.file),{recursive:true});atomicWrite(this.file,this.encrypt(text));
    const retained=new Set(snapshot.tabs.map(t=>t.fileId));for(const tab of this.snapshot.tabs)if(tab.fileId&&!retained.has(tab.fileId))this.documents.delete(tab.fileId);
    this.snapshot=snapshot;
  }
  document(id:string){const doc=this.documents.get(id);if(!doc)throw new Error('SQL 文件记录已失效，请使用另存为');return doc;}
  open(file:string):SqlFile{
    if(fs.statSync(file).size>4*1024*1024)throw new Error('SQL 文件超过 4 MiB，请拆分后打开');
    const bytes=fs.readFileSync(file),sql=decodeSql(bytes);
    const d={id:crypto.randomUUID(),path:file,name:path.basename(file),savedSql:sql,hash:digest(bytes)};
    this.documents.set(d.id,d);const {hash,...result}=d;return result;
  }
  write(sql:string,fileId?:string,destination?:string):SqlFile{
    const old=fileId?this.document(fileId):undefined;
    const file=destination??old?.path;if(!file)throw new Error('请先选择 SQL 文件保存位置');
    // 同一路径外部修改时拒绝覆盖；用户可另存其他文件。
    if(old&&path.resolve(file).toLowerCase()===path.resolve(old.path).toLowerCase()){
      if(!fs.existsSync(file)||digest(fs.readFileSync(file))!==old.hash)throw new Error('SQL 文件已被外部修改或删除，请另存其他文件，或重新打开核对后再保存');
    }
    const bytes=Buffer.from(sql,'utf8');atomicWrite(file,bytes);
    const d={id:destination?crypto.randomUUID():old!.id,path:file,name:path.basename(file),savedSql:sql,hash:digest(bytes)};
    this.documents.set(d.id,d);const {hash,...result}=d;return result;
  }
}
