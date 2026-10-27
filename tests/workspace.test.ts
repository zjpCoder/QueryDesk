import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore, decodeSql } from '../electron/workspace';
import { validate } from '../electron/validation';

function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'querydesk-workspace-'));
  // 测试适配器不依赖 Electron，真实 safeStorage 由端到端验证。
  const create=()=>new WorkspaceStore(path.join(dir,'workspace.enc'),s=>Buffer.from(s).toString('base64'),s=>Buffer.from(s,'base64').toString('utf8'));
  return {dir,create,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('草稿与文件关联重启恢复，不序列化会话/结果/事务状态',()=>{
  const f=fixture();try{
    const store=f.create(),file=path.join(f.dir,'中文.sql');fs.writeFileSync(file,'SELECT 1');const doc=store.open(file);
    const draft={activeId:'tab',tabs:[{id:'tab',connectionId:'connection',schema:'APP',title:doc.name,sql:'SELECT 中文 FROM test',fileId:doc.id,edited:true,autoCommit:false}]};
    store.save(draft);const restored=f.create().get();assert.deepEqual(restored.tabs,draft.tabs);assert.equal(restored.files[0].savedSql,'SELECT 1');
    assert.equal(fs.readFileSync(path.join(f.dir,'workspace.enc'),'utf8').includes('SELECT'),false);
    assert.equal('results' in restored.tabs[0],false);
    assert.equal(f.create().write('SELECT 2',doc.id).savedSql,'SELECT 2');assert.equal(fs.readFileSync(file,'utf8'),'SELECT 2');
  }finally{f.cleanup();}
});
test('外部修改与删除拒绝覆盖，另存为保留原文件，未知 ID 拒绝',()=>{
  const f=fixture();try{
    const store=f.create(),file=path.join(f.dir,'a.sql');fs.writeFileSync(file,'SELECT 1');const doc=store.open(file);fs.writeFileSync(file,'external');
    assert.throws(()=>store.write('new',doc.id),/外部修改/);assert.equal(fs.readFileSync(file,'utf8'),'external');
    const saved=store.write('new',doc.id,path.join(f.dir,'b.sql'));assert.notEqual(saved.id,doc.id);assert.equal(fs.readFileSync(saved.path,'utf8'),'new');
    fs.unlinkSync(file);assert.throws(()=>store.write('new',doc.id),/删除/);assert.throws(()=>store.write('x','untrusted-id'),/失效/);
  }finally{f.cleanup();}
});
test('编码检测支持中文 UTF-8/BOM 和 UTF-16；二进制/非法编码不静默损坏',()=>{
  assert.equal(decodeSql(Buffer.from('\ufeffSELECT 中文')),'SELECT 中文');
  assert.equal(decodeSql(Buffer.concat([Buffer.from([255,254]),Buffer.from('SELECT 中文','utf16le')])),'SELECT 中文');
  assert.throws(()=>decodeSql(Buffer.from([0xff,0x99])),/编码/);assert.throws(()=>decodeSql(Buffer.from('A\0B')),/二进制/);
});
test('损坏草稿不覆盖、非法和过大工作区不覆盖先前数据',()=>{
  const f=fixture();try{
    const file=path.join(f.dir,'workspace.enc');fs.writeFileSync(file,'broken');const broken=f.create();assert.throws(()=>broken.get(),/无法读取/);assert.throws(()=>broken.save({activeId:'',tabs:[]}),/无法读取/);assert.equal(fs.readFileSync(file,'utf8'),'broken');
    fs.unlinkSync(file);const store=f.create();store.save({activeId:'',tabs:[]});const original=fs.readFileSync(file);
    assert.throws(()=>store.save({activeId:'bad',tabs:[{id:'bad',connectionId:'c',schema:'s',title:'t',sql:'x'.repeat(1000001),autoCommit:true}]}));assert.deepEqual(fs.readFileSync(file),original);
  }finally{f.cleanup();}
});
test('IPC 文件保存只接受句柄；导出不能传路径或 SQL；工作区剔除运行状态',()=>{
  const save=validate('sql.save',{sql:'SELECT 1',path:'C:/unexpected.sql'}) as any;assert.equal(save.path,undefined);
  const exp=validate('export.start',{id:'e',connectionId:'c',schema:'s',table:'t',format:'csv',filePath:'C:/unexpected',sql:'DELETE FROM t'}) as any;assert.equal(exp.filePath,undefined);assert.equal(exp.sql,undefined);
  const draft=validate('workspace.save',{activeId:'t',tabs:[{id:'t',connectionId:'c',schema:'s',title:'t',sql:'SELECT 1',autoCommit:false,dirty:true,results:['secret']}]}) as any;
  assert.equal(draft.tabs[0].dirty,undefined);assert.equal(draft.tabs[0].results,undefined);
});
