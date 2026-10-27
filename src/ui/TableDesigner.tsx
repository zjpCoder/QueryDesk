import { useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Select, Space, Table, Tabs, Tag, message } from 'antd';
import { PlusOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import type { Column, DDLPlan, DDLResult, Dialect, TableDef } from '../shared/types';
import { tableFingerprint } from '../shared/ddl';
import { SqlEditor } from './Editor';
export interface DesignerIntent { action:'add'|'edit'|'drop'|'index'; column?:string; }
export function TableDesigner({ before, schema, sessionId, dialect, dark, intent, onClose, onDone }: { before:TableDef|null; schema:string; sessionId:string; dialect:Dialect; dark:boolean; intent?:DesignerIntent; onClose:()=>void; onDone:()=>void }) {
  const [def,setDef]=useState<TableDef>(()=>{
    const initial:TableDef=before?structuredClone(before):{schema,name:'',comment:'',columns:[{name:dialect==='oracle'?'ID':'id',type:dialect==='oracle'?'NUMBER(19)':'BIGINT',nullable:false,defaultValue:'',comment:'',primary:true}],indexes:[],foreignKeys:[]};
    if(intent?.action==='add')initial.columns.push({name:'',type:dialect==='oracle'?'VARCHAR2(255 CHAR)':'VARCHAR(255)',nullable:true,defaultValue:'',comment:'',primary:false});
    if(intent?.action==='drop')initial.columns=initial.columns.filter(c=>c.name!==intent.column);
    if(intent?.action==='index')initial.indexes.push({name:'',columns:intent.column?[intent.column]:[],unique:false});
    return initial;
  });
  const [plan,setPlan]=useState<DDLPlan>(), [busy,setBusy]=useState(false), [error,setError]=useState(''), [results,setResults]=useState<DDLResult[]>(), [tab,setTab]=useState(intent?.action==='index'?'indexes':'fields');
  const update=(next:TableDef)=>{setDef(next);setPlan(undefined);setResults(undefined);};
  const col=(i:number,patch:Partial<Column>)=>update({...def,columns:def.columns.map((c,n)=>n===i?{...c,...patch}:c)});
  const columnOptions=def.columns.map(c=>({value:c.name,label:c.name}));
  async function preview(){setBusy(true);setError('');try{const p=await window.querydesk.call<DDLPlan>('ddl.preview',{sessionId,before,after:def});setPlan(p);setTab('preview');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function execute(){setBusy(true);setError('');try{const r=await window.querydesk.call<DDLResult[]>('ddl.execute',{sessionId,before,after:def,fingerprint:tableFingerprint(before)});setResults(r);setPlan(undefined);onDone();if(r.every(x=>x.ok))message.success('结构变更已执行');else setError('部分语句失败，已成功的变更已保留。关闭后重新打开结构设计器，以实际结构为准。');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <Modal open width={1100} afterOpenChange={open=>{if(open){const input=document.querySelector<HTMLInputElement>('.designer-focus input:not(:disabled)');input?.scrollIntoView({block:'nearest'});input?.focus();}}} title={<Space>{before?'修改表结构':'创建数据表'}<Tag>{dialect.toUpperCase()}</Tag></Space>} onCancel={onClose} maskClosable={false} footer={<Space><Button onClick={onClose}>关闭</Button><Button icon={<EyeOutlined/>} onClick={preview} loading={busy} disabled={!!results}>预览 SQL</Button><Button type="primary" disabled={!plan?.statements.length||!!results} loading={busy} onClick={()=>Modal.confirm({title:'执行结构变更？',content:'DDL 可能隐式提交，成功的语句无法整体回滚。请核对 SQL 与变更影响。',okText:'执行变更',cancelText:'返回检查',onOk:execute})}>执行变更</Button></Space>}>
    {intent?.action==='drop'&&<Alert type="warning" showIcon message={`待删除列：${intent.column}。该列数据将丢失，请预览 SQL 后再执行。`}/>}
    <div className="designer-meta"><Input addonBefore="Schema" value={def.schema} disabled/><Input aria-label="表名称" addonBefore="表名称" value={def.name} disabled={!!before||!!results} onChange={e=>update({...def,name:e.target.value})}/><Input aria-label="表注释" addonBefore="注释" value={def.comment} onChange={e=>update({...def,comment:e.target.value})}/></div>
    {error&&<Alert type="error" showIcon message={error}/>}
    <Tabs activeKey={tab} onChange={setTab} items={[
      {key:'fields',label:`字段 (${def.columns.length})`,children:<><Table size="small" rowKey={(_,i)=>String(i)} pagination={false} scroll={{y:380,x:950}} dataSource={def.columns} rowClassName={(c,i)=>(intent?.action==='edit'&&c.name===intent.column)||(intent?.action==='add'&&i===def.columns.length-1)?'designer-focus':''} columns={[
        {title:'字段名称',width:160,render:(_,c,i)=><Input aria-label={`${c.name||'新字段'} 名称`} value={c.name} onChange={e=>col(i,{name:e.target.value})} disabled={!!before?.columns.some(o=>o.name===c.name)}/>},
        {title:'类型（含长度 / 精度）',width:200,render:(_,c,i)=><Input aria-label={`${c.name||'新字段'} 类型`} value={c.type} onChange={e=>col(i,{type:e.target.value})}/>},
        {title:'主键',width:55,render:(_,c,i)=><Checkbox checked={c.primary} onChange={e=>col(i,{primary:e.target.checked,...(e.target.checked?{nullable:false}:{})})}/>},
        {title:'可空',width:55,render:(_,c,i)=><Checkbox checked={c.nullable} disabled={c.primary} onChange={e=>col(i,{nullable:e.target.checked})}/>},
        {title:'默认值表达式',width:160,render:(_,c,i)=><Input value={c.defaultValue} placeholder="如 'text' / 0" onChange={e=>col(i,{defaultValue:e.target.value})}/>},
        {title:'注释',width:180,render:(_,c,i)=><Input aria-label={`${c.name||'新字段'} 注释`} value={c.comment} onChange={e=>col(i,{comment:e.target.value})}/>},
        {title:'',width:45,render:(_,c,i)=><Button type="text" danger aria-label={`删除字段${c.name}`} icon={<DeleteOutlined/>} onClick={()=>update({...def,columns:def.columns.filter((_,n)=>n!==i)})}/>}
      ]}/><Button style={{marginTop:12}} icon={<PlusOutlined/>} onClick={()=>update({...def,columns:[...def.columns,{name:'',type:dialect==='oracle'?'VARCHAR2(255 CHAR)':'VARCHAR(255)',nullable:true,defaultValue:'',comment:'',primary:false}]})}>添加字段</Button><div className="inline-note">已存在的字段不在此处重命名；请使用 SQL。生成列和复杂类型保留原定义，需通过 SQL 修改。</div></>},
      {key:'indexes',label:`索引 / 唯一约束 (${def.indexes.length})`,children:<><Table size="small" rowKey={(_,i)=>String(i)} pagination={false} dataSource={def.indexes} columns={[
        {title:'索引名称',render:(_,c,i)=><Input value={c.name} onChange={e=>update({...def,indexes:def.indexes.map((x,n)=>n===i?{...x,name:e.target.value}:x)})}/>},
        {title:'字段（选择顺序即索引顺序）',width:450,render:(_,c,i)=><Select mode="multiple" style={{width:'100%'}} value={c.columns} options={columnOptions} onChange={columns=>update({...def,indexes:def.indexes.map((x,n)=>n===i?{...x,columns}:x)})}/>},
        {title:'唯一',render:(_,c,i)=><Checkbox checked={c.unique} onChange={e=>update({...def,indexes:def.indexes.map((x,n)=>n===i?{...x,unique:e.target.checked}:x)})}/>},
        {title:'',render:(_,c,i)=><Button danger type="text" icon={<DeleteOutlined/>} onClick={()=>update({...def,indexes:def.indexes.filter((_,n)=>n!==i)})}/>}
      ]}/><Button style={{marginTop:12}} icon={<PlusOutlined/>} onClick={()=>update({...def,indexes:[...def.indexes,{name:'',columns:[],unique:false}]})}>添加索引</Button></>},
      {key:'foreign',label:`外键 (${def.foreignKeys.length})`,children:<><div className="foreign-list">{def.foreignKeys.map((f,i)=><div className="foreign-card" key={i}><div className="form-pair"><Input addonBefore="名称" value={f.name} onChange={e=>update({...def,foreignKeys:def.foreignKeys.map((x,n)=>n===i?{...x,name:e.target.value}:x)})}/><Select mode="multiple" placeholder="本表字段" value={f.columns} options={columnOptions} onChange={columns=>update({...def,foreignKeys:def.foreignKeys.map((x,n)=>n===i?{...x,columns}:x)})}/></div><div className="form-pair"><Input addonBefore="引用 Schema" value={f.refSchema} onChange={e=>update({...def,foreignKeys:def.foreignKeys.map((x,n)=>n===i?{...x,refSchema:e.target.value}:x)})}/><Input addonBefore="引用表" value={f.refTable} onChange={e=>update({...def,foreignKeys:def.foreignKeys.map((x,n)=>n===i?{...x,refTable:e.target.value}:x)})}/></div><div className="form-pair"><Select mode="tags" tokenSeparators={[',']} placeholder="引用字段，按对应顺序输入" value={f.refColumns} onChange={refColumns=>update({...def,foreignKeys:def.foreignKeys.map((x,n)=>n===i?{...x,refColumns}:x)})}/><Space><Select style={{width:200}} value={f.onDelete} options={['NO ACTION','CASCADE','SET NULL'].map(v=>({value:v,label:`ON DELETE ${v}`}))} onChange={onDelete=>update({...def,foreignKeys:def.foreignKeys.map((x,n)=>n===i?{...x,onDelete}:x)})}/><Button danger icon={<DeleteOutlined/>} onClick={()=>update({...def,foreignKeys:def.foreignKeys.filter((_,n)=>n!==i)})}/></Space></div></div>)}</div><Button icon={<PlusOutlined/>} onClick={()=>update({...def,foreignKeys:[...def.foreignKeys,{name:'',columns:[],refSchema:def.schema,refTable:'',refColumns:[],onDelete:'NO ACTION'}]})}>添加外键</Button></>},
      {key:'preview',label:'SQL 预览与执行记录',children:<>{plan?.warnings.map((w,i)=><Alert key={i} type="warning" message={w} showIcon style={{marginBottom:8}}/>)}{!plan&&!results&&<div className="inline-note">点击“预览 SQL”生成当前变更脚本。</div>}{plan&&<SqlEditor dark={dark} readOnly height="350px" value={plan.statements.join(';\n\n')+(plan.statements.length?';':'')}/>} {results?.map((r,i)=><div key={i} className="ddl-result"><Tag color={r.ok?'green':'red'}>{r.ok?'成功':'失败'}</Tag><pre>{r.sql}</pre>{r.error&&<Alert type="error" message={r.error}/>}</div>)}</>}
    ]}/>
  </Modal>;
}
