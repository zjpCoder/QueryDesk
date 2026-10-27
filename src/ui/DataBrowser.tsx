import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Modal, Select, Space, Tag, Tooltip, message } from 'antd';
import { PlusOutlined, DeleteOutlined, ReloadOutlined, SaveOutlined, LeftOutlined, RightOutlined, ExportOutlined } from '@ant-design/icons';
import type { AgGridReact } from 'ag-grid-react';
import type { Cell, Filter, ExportTarget, RowChange, SessionInfo, TableDef } from '../shared/types';
import { Grid } from './Grid';
import { shortcut, consume } from './shortcuts';
type GridRow = { key: string; values: Record<string, Cell>; original?: Record<string, Cell>; deleted?: boolean };
export function DataBrowser({ onExport, sessionId, schema, table, dark, onState, onDirty, onBusy, onTable, onRows }: { onExport:(options?:Pick<ExportTarget,'filters'|'filterMode'|'sort'>)=>void; sessionId: string; schema: string; table: string; dark: boolean; onState: (s: SessionInfo) => void; onDirty: (v:boolean) => void; onBusy: (v:boolean)=>void; onTable: (d:TableDef) => void; onRows: (rows:Record<string,Cell>[]) => void }) {
  const [def, setDef] = useState<TableDef>(), [rows, setRows] = useState<GridRow[]>([]), [page, setPage] = useState(0), [hasMore, setMore] = useState(false), [editable, setEditable] = useState(false), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [draftFilters,setDraftFilters]=useState<Filter[]>([{column:'',op:'contains',value:''}]),[draftMode,setDraftMode]=useState<'and'|'or'>('and');
  const [filters,setFilters]=useState<Filter[]>([]),[filterMode,setFilterMode]=useState<'and'|'or'>('and'),[sort,setSort]=useState<{column:string;direction:'asc'|'desc'}>();
  const filterChanged=JSON.stringify(draftFilters.filter(f=>f.column||f.value))!==JSON.stringify(filters)||draftMode!==filterMode;
  function editFilter(index:number,part:Partial<Filter>){setDraftFilters(list=>list.map((f,i)=>i===index?{...f,...part}:f));}
  function applyFilters(){
    if(busy)return;const next=draftFilters.length===1&&!draftFilters[0].column&&!draftFilters[0].value?[]:draftFilters;
    if(next.some(f=>!f.column)){message.warning('请为每个条件选择字段，或移除空条件');return;}
    void load(0,next,sort,false,draftMode);
  }
  const grid = useRef<AgGridReact>(null);
  const [editing,setEditing]=useState(false), [saveNotice,setSaveNotice]=useState('');
  const changes = rows.filter(r => r.deleted || !r.original || JSON.stringify(r.values) !== JSON.stringify(r.original));
  useEffect(() => { onDirty(changes.length > 0 || editing); }, [changes.length,editing]);
  useEffect(() => { onBusy(busy); }, [busy]);
  async function load(nextPage = page, nextFilters = filters, nextSort:typeof sort|null = sort, saved = false, nextMode=filterMode) {
    if(busy&&!saved)return false;
    if (!saved && pendingRows().length && !await new Promise<boolean>(resolve => Modal.confirm({ title: '放弃尚未保存的表格变更？', content: '刷新、筛选或翻页会重新读取数据。', okText: '放弃变更', cancelText: '取消', onOk: () => resolve(true), onCancel: () => resolve(false) }))) return;
    setBusy(true); setError('');
    try {
      const data = await window.querydesk.call<{def:TableDef; rows:Record<string,Cell>[]; hasMore:boolean; editable:boolean; reason:string}>('table.browse', { sessionId, schema, table, page: nextPage, filters: nextFilters, filterMode:nextMode, sort: nextSort??undefined });
      setDef(data.def); onTable(data.def); setRows(data.rows.map(values => ({ key: crypto.randomUUID(), values: {...values}, original: {...values} }))); onRows([]); setMore(data.hasMore); setEditable(data.editable); setReason(data.reason); setPage(nextPage); setFilters(nextFilters);setFilterMode(nextMode); setSort(nextSort??undefined);return true;
    } catch (e) { setError((e as Error).message);return false; } finally { setBusy(false); }
  }
  useEffect(() => { void load(0); }, [sessionId]);
  function addRow(){setRows(r => [{key:crypto.randomUUID(),values:{}},...r]);}
  function deleteRows(){ const keys = new Set((grid.current?.api.getSelectedRows() as GridRow[] ?? []).map(r => r.key)); if (!keys.size) { message.info('请先勾选要删除的行'); return; } setRows(r => r.flatMap(row => !keys.has(row.key) ? [row] : row.original ? [{...row,deleted:true}] : [])); }
  function setNull(){ const focused = grid.current?.api.getFocusedCell(); if (!focused) return; const row = grid.current?.api.getDisplayedRowAtIndex(focused.rowIndex)?.data as GridRow; const col = focused.column.getColId(); if (!row || !def?.columns.find(c => c.name === col)?.nullable) { message.warning('请选择允许为空的字段'); return; } setRows(r => r.map(x => x.key === row.key ? {...x, values:{...x.values,[col]:null}} : x)); }
  function pendingRows() {
    grid.current?.api?.stopEditing();
    const current:GridRow[]=[];
    grid.current?.api?.forEachNode(node=>{if(node.data)current.push(node.data);});
    return current.filter(r=>r.deleted||!r.original||JSON.stringify(r.values)!==JSON.stringify(r.original));
  }
  function confirmSave() {
    const pending=pendingRows();
    if(!pending.length){message.info('没有需要保存的变更');return;}
    const snapshot:RowChange[]=pending.map(r=>({kind:r.deleted?'delete':r.original?'update':'insert',values:{...r.values},original:r.original?{...r.original}:undefined}));
    Modal.confirm({title:`保存 ${snapshot.length} 行变更？`,content:'自动提交模式下直接提交；手动事务模式下仍需点击提交事务。并发冲突会回滚本批变更。',okText:'保存',cancelText:'取消',onOk:()=>save(snapshot)});
  }
  async function save(changed:RowChange[]) {
    setBusy(true); setError(''); setSaveNotice('');
    try {
      const result = await window.querydesk.call<{affected:number; state:SessionInfo}>('table.apply', { sessionId, schema, table, changes: changed });
      onState(result.state); setRows(current => current.filter(r => !r.deleted).map(r => ({ ...r, original: {...r.values} }))); onDirty(false); setSaveNotice(`${result.affected} 行已${result.state.autoCommit ? '提交' : '写入，等待提交事务'}`);
      await load(page,filters,sort,true);
    } catch (e) { setError((e as Error).message); await window.querydesk.call<SessionInfo>('session.state',{sessionId}).then(onState).catch(()=>{}); } finally { setBusy(false); }
  }
  return <div className="data-browser" onKeyDownCapture={event=>{
      if((event.target as HTMLElement).closest('.ant-modal'))return;
      const inGrid=!!(event.target as HTMLElement).closest('.grid-fill');
      if(shortcut(event,'F5',true)){consume(event);if(!busy)void load();return;}
      if(shortcut(event,'F2',true)){consume(event);if(busy)void window.querydesk.call<SessionInfo>('query.cancel',{sessionId}).then(onState).catch(e=>message.error(e.message));return;}
      if(!inGrid)return;
      if(shortcut(event,'Enter',true)){consume(event);if(editable&&!busy)confirmSave();}
      else if(shortcut(event,'Insert',false,false,true)){consume(event);if(editable&&!busy){grid.current?.api.stopEditing();addRow();}}
      else if(shortcut(event,'Delete',false,false,true)){consume(event);if(editable&&!busy){grid.current?.api.stopEditing();deleteRows();}}
      else if(shortcut(event,'KeyN',true,false,true)){consume(event);if(editable&&!busy){grid.current?.api.stopEditing();setNull();}}
      else if(shortcut(event,'KeyZ',true,false,true)){consume(event);if(!busy){grid.current?.api.stopEditing();void load();}}
      else if(shortcut(event,'ArrowUp',true,false,true)){consume(event);if(!busy&&page>0)void load(page-1);}
      else if(shortcut(event,'ArrowDown',true,false,true)){consume(event);if(!busy&&hasMore)void load(page+1);}
    }}>
    <div className="filter-builder"><Space wrap>
      <Select aria-label="条件关系" disabled={busy} value={draftMode} onChange={setDraftMode} options={[{value:'and',label:'全部满足（AND）'},{value:'or',label:'任一满足（OR）'}]}/>
      <Button disabled={busy||draftFilters.length>=20} onClick={()=>setDraftFilters(list=>[...list,{column:'',op:'contains',value:''}])}>添加条件</Button>
      <Button onClick={applyFilters} loading={busy}>应用</Button>
      <Button disabled={busy} onClick={()=>void load(0,[],sort,false,'and').then(ok=>{if(ok){setDraftFilters([{column:'',op:'contains',value:''}]);setDraftMode('and');}})}>清除</Button>
      <Tooltip title="刷新数据"><Button aria-label="刷新数据" icon={<ReloadOutlined/>} loading={busy} onClick={()=>void load()}/></Tooltip>
      {busy&&<Button onClick={()=>void window.querydesk.call<SessionInfo>('query.cancel',{sessionId}).then(onState).catch(e=>message.error(e.message))}>取消操作</Button>}
      <span className="muted">已应用 {filters.length} 个条件 · {filterMode.toUpperCase()}{filterChanged?' · 条件已修改，尚未应用':''}</span>
    </Space>{draftFilters.map((filter,i)=><div className="filter-row" key={i}>
      <Select aria-label={i?`筛选字段 ${i+1}`:'筛选字段'} placeholder="筛选字段" disabled={busy} style={{width:150}} value={filter.column||undefined} onChange={column=>editFilter(i,{column})} options={def?.columns.map(c=>({value:c.name,label:c.name}))}/>
      <Select aria-label={i?`筛选条件 ${i+1}`:'筛选条件'} disabled={busy} style={{width:115}} value={filter.op} onChange={op=>editFilter(i,{op})} options={['contains','=','<>','>','<','>=','<=','is null','is not null'].map(v=>({value:v,label:({'contains':'包含','is null':'为空','is not null':'非空'} as Record<string,string>)[v]||v}))}/>
      <Input aria-label={`筛选值 ${i+1}`} placeholder="筛选值" value={filter.value} disabled={busy||filter.op.includes('null')} onChange={e=>editFilter(i,{value:e.target.value})} onPressEnter={applyFilters}/>
      <Button aria-label={`移除条件 ${i+1}`} disabled={busy} icon={<DeleteOutlined/>} onClick={()=>setDraftFilters(list=>list.filter((_,n)=>n!==i))}/>
    </div>)}</div>
    <div className="data-toolbar"><Space wrap>
      <Button icon={<PlusOutlined/>} disabled={!editable || busy} onClick={addRow}>新增行</Button>
      <Button icon={<DeleteOutlined/>} disabled={!editable || busy} onClick={deleteRows}>删除所选</Button>
      <Button disabled={!editable || busy} onClick={setNull}>设为 NULL</Button>
      <Button type="primary" icon={<SaveOutlined/>} disabled={(!changes.length&&!editing)||busy} loading={busy} onClick={confirmSave}>保存变更{changes.length ? ` (${changes.length})` : ''}</Button>
      <Button icon={<ExportOutlined/>} onClick={() => void window.querydesk.call('file.export', {format:'csv',columns:def?.columns.map(c=>c.name) ?? [],rows:rows.filter(r=>!r.deleted).map(r=>r.values)}).catch(e=>message.error(e.message))}>导出本页</Button><Button onClick={()=>onExport()}>导出整表</Button><Button disabled={busy||!filters.length&&!sort} onClick={()=>onExport({filters:structuredClone(filters),filterMode,sort})}>导出筛选结果</Button>
    </Space><Tag color={editable ? 'green' : 'default'}>{editable ? '可编辑 · 双击单元格' : '只读'}</Tag></div>
    {saveNotice&&<Alert type="success" showIcon message={saveNotice} closable onClose={()=>setSaveNotice('')}/>}
    {reason && <div className="inline-note">{reason}</div>}{error && <Alert type="error" showIcon message={error} closable onClose={()=>setError('')}/>}
    <div className="grid-fill"><Grid ref={grid} dark={dark} stopEditingWhenCellsLoseFocus onCellEditingStarted={()=>setEditing(true)} onCellEditingStopped={()=>setEditing(false)} rowData={rows} loading={busy} getRowId={p=>p.data.key} rowSelection={{mode:'multiRow',enableClickSelection:false}} onSelectionChanged={()=>onRows((grid.current?.api.getSelectedRows() as GridRow[] ?? []).map(r=>r.values))} columnDefs={def?.columns.map(c=>({headerName:c.name,field:c.name,colId:c.name,headerTooltip:`${c.type}${c.primary?' · 主键':''} ${c.comment}`,sortable:false,editable:(p:any)=>editable&&!busy&&!c.generated&&!p.data.deleted,valueGetter:(p:any)=>p.data.values[c.name],valueSetter:(p:any)=>{p.data.values[c.name]=p.newValue;return true;},cellEditor:'agTextCellEditor'}))} onCellValueChanged={()=>setRows(r=>r.map(row=>({...row,values:{...row.values}})))} getRowStyle={p=>p.data?.deleted?{backgroundColor:dark?'#41252a':'#ffebee',textDecoration:'line-through'}:!p.data?.original?{backgroundColor:dark?'#19312e':'#e9faf3',textDecoration:'none'}:undefined} /></div>
    <div className="result-footer"><Space><span>第 {page+1} 页 · {rows.length} 行</span><span className="muted">每页 200 行</span><Select size="small" placeholder="服务端排序" style={{width:150}} allowClear value={sort?.column} options={def?.columns.map(c=>({value:c.name,label:c.name}))} onChange={column=>void load(0,filters,column?{column,direction:sort?.direction??'asc'}:null)}/><Button size="small" disabled={!sort} onClick={()=>sort&&void load(0,filters,{...sort,direction:sort.direction==='asc'?'desc':'asc'})}>{sort?.direction==='desc'?'降序':'升序'}</Button></Space><Space><Button icon={<LeftOutlined/>} disabled={page===0||busy} onClick={()=>void load(page-1)}>上一页</Button><Button icon={<RightOutlined/>} disabled={!hasMore||busy} onClick={()=>void load(page+1)}>下一页</Button></Space></div>
  </div>;
}
