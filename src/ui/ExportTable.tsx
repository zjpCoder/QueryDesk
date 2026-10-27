import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Select, Space, Spin, message } from 'antd';
import type { AIFile, ExportTarget } from '../shared/types';

export function ExportTable({onClose,onBusy,...target}:ExportTarget&{onClose:()=>void;onBusy:(v:boolean)=>void}){
  const [format,setFormat]=useState<'csv'|'json'>('csv'),[busy,setBusy]=useState(false),[rows,setRows]=useState(0),[error,setError]=useState(''),[file,setFile]=useState<AIFile>();
  const id=useRef<string|undefined>(undefined);
  useEffect(()=>window.querydesk.onExport(event=>{
    if(event.id!==id.current)return;
    if(event.rows!==undefined)setRows(event.rows);
    if(event.file){setFile(event.file);setRows(event.file.rows);}
    if(event.error)setError(event.error);
    if(event.done){id.current=undefined;setBusy(false);onBusy(false);}
  }),[]);
  async function start(){
    if(busy)return;const job=crypto.randomUUID();id.current=job;setBusy(true);onBusy(true);setError('');setFile(undefined);setRows(0);
    try{const started=await window.querydesk.call<boolean>(target.query?'export.query':'export.start',{...target,id:job,format});if(!started){id.current=undefined;setBusy(false);onBusy(false);}}
    catch(e){setError((e as Error).message);id.current=undefined;setBusy(false);onBusy(false);}
  }
  return <Modal open title={target.query?'导出查询全部结果':`导出${target.filters?.length?'筛选结果':'整表'} · ${target.schema}.${target.table}`} maskClosable={!busy} closable={!busy} onCancel={()=>{if(!busy)onClose();}} footer={<Space>{busy?<Button onClick={()=>id.current&&void window.querydesk.call('export.cancel',{id:id.current}).catch(e=>message.error(e.message))}>取消导出</Button>:<><Button onClick={onClose}>关闭</Button><Button type="primary" onClick={()=>void start()}>选择位置并导出</Button></>}</Space>}>
    <p>使用独立只读会话重新读取已提交数据，不受界面 10,000 行上限限制。当前会话的未提交修改不会导出；数据可能与先前结果不同。</p>
    {target.query?<><p>查询 Schema：{target.schema||'默认'}</p><Alert type="info" message="仅导出一条 SELECT / WITH 查询，保留原参数和 SQL 中的行数限制；不重放写操作。自定义函数等不在只读导出支持范围。"/><pre className="context-preview">{target.query.sql}</pre>{Object.keys(target.query.params).length>0&&<pre className="context-preview">{JSON.stringify(target.query.params,null,2)}</pre>}</>:<p>{target.filters?.length?`使用已应用的 ${target.filters.length} 个条件，${target.filterMode==='or'?'任一满足（OR）':'全部满足（AND）'}。`:'整表导出，不包含当前筛选条件。'}{target.sort&&` 排序：${target.sort.column} ${target.sort.direction}`}</p>}
    <Select aria-label="整表导出格式" disabled={busy} value={format} onChange={setFormat} options={[{value:'csv',label:'CSV（UTF-8）'},{value:'json',label:'JSON'}]}/>
    {busy&&<p><Spin size="small"/> 正在导出 · 已写入 {rows.toLocaleString()} 行</p>}
    {error&&<Alert style={{marginTop:12}} type="error" showIcon message={error}/>}
    {file&&<Alert style={{marginTop:12}} type="success" showIcon message={`导出完成 · ${file.rows.toLocaleString()} 行`} description={<><p>{file.path}</p>{file.warnings.map(w=><p key={w}>{w}</p>)}<Button onClick={()=>void window.querydesk.call('file.reveal',{id:file.id}).catch(e=>message.error(e.message))}>打开所在文件夹</Button></>}/>}
  </Modal>;
}
