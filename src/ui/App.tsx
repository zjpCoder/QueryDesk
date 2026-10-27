import { useEffect, useRef, useState } from 'react';
import { Alert, Button, ConfigProvider, Dropdown, Input, Modal, Select, Space, Spin, Switch, Table, Tabs, Tag, Tooltip, Tree, message, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { PlusOutlined, DatabaseOutlined, CodeOutlined, TableOutlined, SearchOutlined, ReloadOutlined, SettingOutlined, MoreOutlined, ThunderboltOutlined, HistoryOutlined, CheckOutlined, UndoOutlined, FolderOutlined, EyeOutlined, BulbOutlined, RightOutlined, CloseOutlined } from '@ant-design/icons';
import type * as monaco from 'monaco-editor';
import type { Cell, ConnectionProfile, DBObject, QueryResult, SessionInfo, Settings, TableDef, SqlFile, WorkspaceSnapshot, WorkspaceDraft, ExportTarget, AISqlTarget } from '../shared/types';
import { ConnectionModal } from './ConnectionModal';
import { AIPanel, AISettingsModal } from './AIPanel';
import { SqlWorkspace } from './SqlWorkspace';
import { DataBrowser } from './DataBrowser';
import { TableDesigner, type DesignerIntent } from './TableDesigner';
import { qualified, quoteId, splitSql } from '../shared/sql';
import { SqlEditor } from './Editor';
import { ExportTable } from './ExportTable';
import { shortcut, consume, shortcutHelp, editorKeys } from './shortcuts';
import { QuickPick, type PickItem } from './QuickPick';
import { matchesSearch, textMatches, sqlOutline } from '../shared/navigation';
interface WorkTab { id:string; connectionId:string; title:string; kind:'sql'|'table'; sql:string; info:SessionInfo; table?:string; schema:string; busy:boolean; dirtyGrid:boolean; initialResults?:QueryResult[]; fileId?:string; edited?:boolean; generation?:number; }
const objectKinds: {kind:DBObject['kind'];label:string}[] = [
  {kind:'table',label:'表'},{kind:'view',label:'视图'},{kind:'sequence',label:'序列'},
  {kind:'procedure',label:'存储过程'},{kind:'function',label:'函数'},{kind:'package',label:'程序包'},{kind:'trigger',label:'触发器'},
];
const initialSQL=(dialect:string)=>dialect==='oracle'?'-- 开始你的 Oracle 查询\n-- Ctrl + Enter 执行当前语句\n\nSELECT SYSDATE AS CURRENT_TIME\nFROM DUAL;\n':'-- 开始你的 MySQL 查询\n-- Ctrl + Enter 执行当前语句\n\nSELECT NOW() AS current_time;\n';
export function App(){
  const [settings,setSettings]=useState<Settings>(), [fatal,setFatal]=useState(''), [connectionModal,setConnectionModal]=useState<Partial<ConnectionProfile>|null>(null), [aiSettings,setAISettings]=useState(false), [showAI,setShowAI]=useState(true), [tabs,setTabs]=useState<WorkTab[]>([]), [activeId,setActiveId]=useState(''), [opening,setOpening]=useState(false), [schemas,setSchemas]=useState<string[]>([]), [objects,setObjects]=useState<DBObject[]>([]), [objectLoading,setObjectLoading]=useState(false), [search,setSearch]=useState(''), [definitions,setDefinitions]=useState<Record<string,TableDef>>({}), [designer,setDesigner]=useState<{sessionId:string;schema:string;before:TableDef|null;dialect:'mysql'|'oracle';intent?:DesignerIntent}>(), [selectedRows,setSelectedRows]=useState<Record<string,Cell>[]>([]), [lastErrors,setLastErrors]=useState<Record<string,string>>({}), [history,setHistory]=useState(false), [detail,setDetail]=useState<TableDef>(), [source,setSource]=useState<{name:string;sql:string}>();
  const [workspaceReady,setWorkspaceReady]=useState(false),[draftError,setDraftError]=useState(''),[fileBusy,setFileBusy]=useState(false),[sqlFiles,setSqlFiles]=useState<Record<string,SqlFile>>({});
  const [exportTarget,setExportTarget]=useState<ExportTarget>(),[exportBusy,setExportBusy]=useState(false);
  const filesRef=useRef(sqlFiles);filesRef.current=sqlFiles;
  const exportBusyRef=useRef(exportBusy);exportBusyRef.current=exportBusy;
  const readyRef=useRef(workspaceReady);readyRef.current=workspaceReady;
  const tabsRef=useRef(tabs), editors=useRef(new Map<string,monaco.editor.IStandaloneCodeEditor>()), requestVersion=useRef(0);
  const [expandedObjects,setExpandedObjects]=useState<React.Key[]>([]);
  const [shortcutsOpen,setShortcutsOpen]=useState(false),[selectedObject,setSelectedObject]=useState('');
  const [navigationMode,setNavigator]=useState<'objects'|'search'|'outline'|'recent'|'actions'>(),[helpSearch,setHelpSearch]=useState('');
  const jumpRef=useRef<{id:string;offset:number;length:number}|undefined>(undefined), recentRef=useRef<string[]>([]);
  tabsRef.current=tabs;
  const activeIdRef=useRef(activeId);activeIdRef.current=activeId;
  const visitedTabs=useRef(new Set<string>());if(activeId)visitedTabs.current.add(activeId);
  useEffect(()=>window.querydesk.onAI(event=>{if(!event.opened)return;const o=event.opened;const current=tabsRef.current.find(t=>t.id===activeIdRef.current);setTabs(list=>list.some(t=>t.id===o.sessionId)?list:[...list,{id:o.sessionId,connectionId:o.connectionId,title:o.title,kind:'sql',sql:o.sql,info:o.info,schema:o.info.schema,busy:false,dirtyGrid:false,initialResults:o.results}]);if(current?.connectionId===o.connectionId)setActiveId(o.sessionId);}),[]);
  const active=tabs.find(t=>t.id===activeId), profile=settings?.connections.find(c=>c.id===active?.connectionId), dark=settings?.theme!=='light';
  const patch=(id:string,part:Partial<WorkTab>)=>setTabs(list=>list.map(t=>t.id===id?{...t,...part}:t));
  async function refreshSettings(){try{setSettings(await window.querydesk.call<Settings>('settings.get'));}catch(e){setFatal((e as Error).message);}}
  useEffect(()=>{void (async()=>{
    try{
      const loaded=await window.querydesk.call<Settings>('settings.get').catch(e=>{setFatal(e.message);throw e;});setSettings(loaded);
      const snapshot=await window.querydesk.call<WorkspaceSnapshot>('workspace.get');
      setSqlFiles(Object.fromEntries(snapshot.files.map(f=>[f.id,f])));
      const restored:WorkTab[]=snapshot.tabs.filter(t=>loaded.connections.some(c=>c.id===t.connectionId)).map(t=>({...t,kind:'sql',busy:false,dirtyGrid:false,info:{version:'',schema:t.schema,connected:false,autoCommit:t.autoCommit,readOnly:t.readOnly,dirty:false,needsRollback:false}}));
      setTabs(restored);setActiveId(restored.some(t=>t.id===snapshot.activeId)?snapshot.activeId:restored[0]?.id??'');if(restored.length!==snapshot.tabs.length){setDraftError('部分草稿对应的连接配置已不存在，已保留原草稿文件并暂停自动覆盖；请恢复连接配置，或先将当前 SQL 另存为文件。');return;}setWorkspaceReady(true);
    }catch(e){setDraftError((e as Error).message);}
  })();},[]);
  function snapshotWorkspace():WorkspaceDraft{return {activeId:activeIdRef.current,tabs:tabsRef.current.filter(t=>t.kind==='sql').map(t=>({id:t.id,connectionId:t.connectionId,schema:t.schema,title:t.title,sql:t.sql,fileId:t.fileId,edited:t.edited,autoCommit:t.info.autoCommit,readOnly:t.info.readOnly}))};}
  async function flushWorkspace(){if(!readyRef.current)throw new Error('草稿存储尚未就绪，未覆盖原工作区');await window.querydesk.call('workspace.save',snapshotWorkspace());setDraftError('');}
  useEffect(()=>{if(!workspaceReady)return;const timer=setTimeout(()=>{void flushWorkspace().catch(e=>setDraftError(e.message));},700);return()=>clearTimeout(timer);},[workspaceReady,tabs,activeId]);
  function sqlModified(tab:WorkTab){return tab.kind==='sql'&&(tab.fileId?tab.sql!==filesRef.current[tab.fileId]?.savedSql:!!tab.edited);}
  async function saveSql(saveAs=false){
    if(!active||active.kind!=='sql'||fileBusy)return false;
    const id=active.id,text=editors.current.get(id)?.getValue()??active.sql;setFileBusy(true);
    try{const file=await window.querydesk.call<SqlFile|null>('sql.save',{fileId:active.fileId,sql:text,saveAs});if(!file)return false;setSqlFiles(f=>({...f,[file.id]:file}));patch(id,{fileId:file.id,title:file.name,edited:false});message.success('SQL 已保存（UTF-8）');return true;}catch(e){message.error((e as Error).message);return false;}finally{setFileBusy(false);}
  }
  async function openSql(){
    const connection=profile??settings?.connections[0];if(!connection){message.info('请先保存一个数据库连接');return;}if(fileBusy)return;setFileBusy(true);
    try{const file=await window.querydesk.call<SqlFile|null>('sql.open');if(!file)return;setSqlFiles(f=>({...f,[file.id]:file}));const id=crypto.randomUUID(),schema=active?.schema??connection.database;setTabs(list=>[...list,{id,connectionId:connection.id,schema,title:file.name,sql:file.savedSql,fileId:file.id,kind:'sql',busy:false,dirtyGrid:false,info:{version:'',schema,connected:false,autoCommit:true,dirty:false,needsRollback:false}}]);setActiveId(id);}catch(e){message.error((e as Error).message);}finally{setFileBusy(false);}
  }
  async function reconnect(){
    if(!active||active.busy)return;const tab=active;
    const connect=async(allowDiscard=false)=>{
      patch(tab.id,{busy:true});
      try{const info=await window.querydesk.call<SessionInfo>('session.reconnect',{sessionId:tab.id,connectionId:tab.connectionId,schema:tab.schema,autoCommit:tab.info.autoCommit,readOnly:tab.info.readOnly,allowDiscard});patch(tab.id,{info,schema:info.schema,busy:false,dirtyGrid:false,generation:(tab.generation??0)+1,initialResults:undefined});setDefinitions({});message.success('已建立新会话，SQL 未自动执行');}
      catch(e){patch(tab.id,{busy:false,info:{...tab.info,connected:false}});message.error((e as Error).message);}
    };
    if(tab.info.dirty||tab.info.needsRollback||tab.dirtyGrid)Modal.confirm({title:'放弃当前事务并重连？',content:'将结束原会话、尝试回滚未提交事务并丢弃表格草稿。SQL 文本保留；已提交操作不会撤销，也不会自动重放语句。',okText:'放弃并重连',cancelText:'取消',onOk:()=>connect(true)});else await connect();
  }

  useEffect(()=>{document.documentElement.dataset.theme=dark?'dark':'light';},[dark]);
  useEffect(()=>window.querydesk.onClose(()=>{
    const exit=async()=>{try{await flushWorkspace();window.querydesk.confirmClose();}catch(e){setDraftError((e as Error).message);Modal.confirm({title:'草稿保存失败，仍要退出？',content:'请先将重要 SQL 另存为文件。继续退出不会覆盖原有草稿，但本次编辑可能丢失。',okText:'仍然退出',cancelText:'返回保存',onOk:()=>window.querydesk.confirmClose()});}};
    const pending=tabsRef.current.filter(t=>t.info.dirty||t.info.needsRollback||t.dirtyGrid||t.busy);
    const unsavedFiles=tabsRef.current.filter(t=>t.fileId&&sqlModified(t));
    if(!pending.length&&!unsavedFiles.length&&!exportBusyRef.current){void exit();return;}
    Modal.confirm({title:'关闭 QueryDesk？',content:`SQL 文本会保存到恢复草稿，尚未写回的 SQL 文件仍需保存。${pending.length} 个标签有未提交事务、表格草稿或正在执行；关闭会中断操作并放弃未提交变更。${exportBusyRef.current?'完整导出仍在进行，关闭将中断导出。':''}`,okText:'保存草稿并退出',cancelText:'继续工作',okButtonProps:{danger:true},onOk:exit});
  }),[]);
  async function reloadObjects(tab=active){if(!tab||!tab.info.connected)return;const version=++requestVersion.current;setObjectLoading(true);try{const list=await window.querydesk.call<DBObject[]>('object.list',{sessionId:tab.id,schema:tab.schema});if(version===requestVersion.current)setObjects(list);}catch(e){message.error((e as Error).message);}finally{if(version===requestVersion.current)setObjectLoading(false);}}
  useEffect(()=>{setSelectedRows([]);setObjects([]);setSchemas([]);if(!active?.info.connected)return;const id=active.id;void window.querydesk.call<string[]>('schema.list',{sessionId:id}).then(list=>{if(activeIdRef.current===id)setSchemas(list);}).catch(e=>message.error(e.message));void reloadObjects(active);},[activeId,active?.schema,active?.info.connected,active?.generation]);
  async function openTab(connection:ConnectionProfile,kind:'sql'|'table'='sql',table?:string,schema?:string,sql?:string){
    if(opening)return;setOpening(true);const id=crypto.randomUUID();
    try{let info=await window.querydesk.call<SessionInfo>('session.open',{sessionId:id,connectionId:connection.id});if(schema&&schema!==info.schema)info=await window.querydesk.call<SessionInfo>('session.schema',{sessionId:id,schema});const tab:WorkTab={id,connectionId:connection.id,title:kind==='table'?table!: `Console ${tabs.filter(t=>t.kind==='sql').length+1}`,kind,sql:sql??initialSQL(connection.dialect),info,table,schema:info.schema,busy:false,dirtyGrid:false};setTabs(list=>[...list,tab]);setActiveId(id);}catch(e){message.error((e as Error).message);void window.querydesk.call('session.close',{sessionId:id,force:true}).catch(()=>{});}finally{setOpening(false);}
  }
  async function closeTab(id:string){const tab=tabs.find(t=>t.id===id);if(!tab)return;if(tab.busy){message.warning('请先停止查询并等待结束');return;}const close=async()=>{try{await window.querydesk.call('session.close',{sessionId:id,force:true});}catch(e){message.warning((e as Error).message);}setTabs(list=>list.filter(t=>t.id!==id));editors.current.delete(id);visitedTabs.current.delete(id);setLastErrors(current=>{const next={...current};delete next[id];return next;});if(activeId===id)setActiveId(tabs.filter(t=>t.id!==id).at(-1)?.id??'');};if(sqlModified(tab))Modal.confirm({title:'关闭并移除 SQL 草稿？',content:'此标签有未保存到 SQL 文件的文本。关闭会将它从恢复工作区移除；未提交事务也会回滚。可取消并先保存 SQL。',okText:'放弃并关闭',cancelText:'返回保存',onOk:close});else if(tab.info.dirty||tab.info.needsRollback||tab.dirtyGrid)Modal.confirm({title:'关闭标签并放弃未提交变更？',content:'未提交事务将回滚，表格草稿将丢弃。',okText:'关闭并回滚',cancelText:'取消',onOk:close});else await close();}
  async function transaction(action:'commit'|'rollback'|'auto',value?:boolean){if(!active)return;try{const info=await window.querydesk.call<SessionInfo>('session.transaction',{sessionId:active.id,action,value});patch(active.id,{info});message.success(action==='commit'?'事务已提交':action==='rollback'?'事务已回滚':'提交模式已切换');if(action==='rollback'&&active.kind==='table')message.info('请刷新表格，显示回滚后的实际数据');}catch(e){message.error((e as Error).message);}}
  async function describe(name:string){if(!active)return;const def=await window.querydesk.call<TableDef>('table.describe',{sessionId:active.id,schema:active.schema,table:name});setDefinitions(d=>({...d,[`${active.connectionId}.${active.schema}.${name}`]:def}));return def;}
  async function design(name?:string,intent?:DesignerIntent){if(!active||!profile)return;try{const before=name?await describe(name):null;setDesigner({sessionId:active.id,schema:active.schema,before:before??null,dialect:profile.dialect,intent});}catch(e){message.error((e as Error).message);}}
  function aiSqlTarget(scope:'auto'|'selection'|'statement'|'all'):AISqlTarget{
    if(!active||active.kind!=='sql'||!profile)throw new Error('请先打开 SQL 标签并选择要处理的文本');
    const editor=editors.current.get(active.id),model=editor?.getModel(),selection=editor?.getSelection();
    if(!editor||!model||!selection)throw new Error('SQL 编辑器尚未就绪');
    const fullSql=model.getValue();let start=0,end=fullSql.length,label='全文';
    if(scope==='selection'||scope==='auto'&&!selection.isEmpty()){
      if(selection.isEmpty())throw new Error('请先在编辑器中选中 SQL');start=model.getOffsetAt(selection.getStartPosition());end=model.getOffsetAt(selection.getEndPosition());label='选中 SQL';
    }else if(scope!=='all'){
      const offset=model.getOffsetAt(editor.getPosition()!),parts=splitSql(fullSql,profile.dialect),part=parts.find(s=>offset>=s.start&&offset<=s.end+1)??parts.at(-1);
      if(!part)throw new Error('当前位置没有可处理的 SQL');start=part.start+fullSql.slice(part.start,part.end).search(/\S/);end=part.end;if(fullSql[end]===';')end++;else if(profile.dialect==='oracle'){const slash=/^[ \t]*\/[ \t]*(?:\r?\n|$)/.exec(fullSql.slice(end));if(slash)end+=slash[0].length;}label='当前语句';
    }
    return {tabId:active.id,fullSql,sql:fullSql.slice(start,end),start,end,version:model.getVersionId(),scope:label};
  }
  function replaceAISql(text:string,target:AISqlTarget){
    const editor=editors.current.get(target.tabId),model=editor?.getModel();
    if(activeId!==target.tabId||!editor||!model)throw new Error('请先切回发送请求时的 SQL 标签');
    if(model.getVersionId()!==target.version||model.getValue()!==target.fullSql)throw new Error('原 SQL 已修改，未覆盖任何内容。请重新选择并发送请求。');
    const start=model.getPositionAt(target.start),end=model.getPositionAt(target.end);
    editor.pushUndoStop();editor.executeEdits('querydesk.ai.replace',[{range:{startLineNumber:start.lineNumber,startColumn:start.column,endLineNumber:end.lineNumber,endColumn:end.column},text}]);editor.pushUndoStop();editor.focus();
  }
  function insertAI(text:string,replace=false){if(!profile)return;if(active?.kind==='sql'){const e=editors.current.get(active.id);if(replace){patch(active.id,{sql:text,edited:true});return;}if(e){e.executeEdits('querydesk.ai',[{range:e.getSelection()!,text}]);e.focus();}else patch(active.id,{sql:active.sql+'\n\n'+text,edited:true});}else void openTab(profile,'sql',undefined,active?.schema,text);}
  useEffect(()=>{
    const handle=(event:KeyboardEvent)=>{
      if(document.querySelector('.ant-modal-wrap:not([style*="display: none"])'))return;
      const target=event.target as HTMLElement;
      if(target.closest('.ai-panel,input:not(.monaco-mouse-cursor-text),textarea:not(.inputarea),[contenteditable="true"]')&&!target.closest('.monaco-editor,.object-tree'))return;
      if(shortcut(event,'KeyN',true)){consume(event);setNavigator('objects');}
      else if(shortcut(event,'KeyF',true,true)){consume(event);setNavigator('search');}
      else if(shortcut(event,'F12',true)&&!target.closest('.grid-fill')){consume(event);if(active?.kind==='sql')setNavigator('outline');}
      else if(shortcut(event,'KeyE',true)){consume(event);setNavigator('recent');}
      else if(shortcut(event,'KeyA',true,true)){consume(event);setNavigator('actions');}
      else if(shortcut(event,'KeyE',true,false,true)){consume(event);void refreshSettings();setHistory(true);}
      else if(shortcut(event,'F10',true,true)){consume(event);if(profile)void openTab(profile,'sql',undefined,active?.schema);}
      else if(shortcut(event,'KeyF',true)&&target.closest('.sidebar')){consume(event);document.querySelector<HTMLInputElement>('.object-search input')?.focus();}
      else if(shortcut(event,'KeyS',true)||shortcut(event,'KeyS',true,true)){consume(event);void saveSql(event.shiftKey);}
      else if(shortcut(event,'KeyO',true)){consume(event);void openSql();}
      else if(shortcut(event,'F4',true)){consume(event);if(active)void closeTab(active.id);}
      else if(shortcut(event,'ArrowLeft',false,false,true)||shortcut(event,'ArrowRight',false,false,true)||shortcut(event,'Tab',true)||shortcut(event,'Tab',true,true)){
        consume(event);if(tabs.length){const step=event.code==='ArrowLeft'||event.shiftKey?-1:1;setActiveId(tabs[(tabs.findIndex(t=>t.id===activeId)+step+tabs.length)%tabs.length].id);}
      }
    };
    document.addEventListener('keydown',handle,true);return()=>document.removeEventListener('keydown',handle,true);
  });
  function applyJump(){
    const jump=jumpRef.current;if(!jump||jump.id!==activeIdRef.current)return;
    const editor=editors.current.get(jump.id),model=editor?.getModel();if(!editor||!model)return;
    const start=model.getPositionAt(jump.offset),end=model.getPositionAt(jump.offset+jump.length);
    editor.setSelection({startLineNumber:start.lineNumber,startColumn:start.column,endLineNumber:end.lineNumber,endColumn:end.column});editor.revealPositionInCenter(start);editor.focus();jumpRef.current=undefined;
  }
  useEffect(()=>{if(activeId)recentRef.current=[activeId,...recentRef.current.filter(id=>id!==activeId)].slice(0,100);requestAnimationFrame(applyJump);},[activeId]);
  function jumpTo(id:string,offset=0,length=0){jumpRef.current={id,offset,length};setActiveId(id);requestAnimationFrame(applyJump);}
  function openObject(object:DBObject){
    if(!active||!profile)return;
    if(object.kind==='table'||object.kind==='view')void openTab(profile,'table',object.name,object.schema);
    else void window.querydesk.call<string>('object.source',{sessionId:active.id,schema:object.schema,table:object.name,kind:object.kind}).then(sql=>setSource({name:object.name,sql})).catch(e=>message.error(e.message));
  }
  function navigationItems(query:string):PickItem[]{
    if(navigationMode==='objects')return objects.filter(o=>matchesSearch(query,o.name,o.schema,o.comment,objectKinds.find(k=>k.kind===o.kind)?.label)).map(o=>({id:`${o.kind}:${o.schema}:${o.name}`,label:o.name,detail:`${o.schema} · ${objectKinds.find(k=>k.kind===o.kind)?.label} · ${o.comment??''}`,run:()=>openObject(o)}));
    if(navigationMode==='recent')return [...tabs].sort((a,b)=>recentRef.current.indexOf(a.id)-recentRef.current.indexOf(b.id)).filter(t=>matchesSearch(query,t.title,t.schema,settings?.connections.find(c=>c.id===t.connectionId)?.name)).map(t=>({id:t.id,label:t.title,detail:`${settings?.connections.find(c=>c.id===t.connectionId)?.name} / ${t.schema}`,run:()=>{setActiveId(t.id);requestAnimationFrame(()=>editors.current.get(t.id)?.focus());}}));
    if(navigationMode==='search'){
      const results:PickItem[]=[];
      for(const tab of tabs.filter(t=>t.kind==='sql')){
        for(const hit of textMatches(tab.sql,query,200-results.length))results.push({id:`${tab.id}:${hit.offset}`,label:`${tab.title}:${hit.line}:${hit.column} · ${hit.preview}`,detail:`${settings?.connections.find(c=>c.id===tab.connectionId)?.name} / ${tab.schema}`,run:()=>jumpTo(tab.id,hit.offset,hit.length)});
        if(results.length>=200)break;
      }return results;
    }
    if(navigationMode==='outline'&&active&&profile){try{return sqlOutline(active.sql,profile.dialect).filter(item=>matchesSearch(query,item.label)).map(item=>({id:String(item.offset)+item.label,label:item.label,detail:`第 ${item.line} 行`,run:()=>jumpTo(active.id,item.offset)}));}catch{return [{id:'incomplete',label:'SQL 尚未闭合，暂时无法生成结构',detail:'请先补齐字符串或注释；可使用 Ctrl+F 查找',run:()=>editors.current.get(active.id)?.focus()}];}}
    if(navigationMode==='actions'){
      const actions:PickItem[]=[
        {id:'objects',label:'搜索数据库对象',detail:'Ctrl+N · 当前连接 / Schema',run:()=>setNavigator('objects')},
        {id:'search',label:'在所有 SQL 标签中查找',detail:'Ctrl+Shift+F',run:()=>setNavigator('search')},
        {id:'recent',label:'最近打开的标签',detail:'Ctrl+E',run:()=>setNavigator('recent')},
        {id:'history',label:'查询历史',detail:'Ctrl+Alt+E',run:()=>{void refreshSettings();setHistory(true);}},
        {id:'help',label:'快捷键帮助',run:()=>setShortcutsOpen(true)},
        {id:'open',label:'打开 SQL 文件',detail:'Ctrl+O',run:()=>{void openSql();}},
        {id:'connection',label:'新建数据库连接',run:()=>setConnectionModal({})},
      ];
      if(active?.kind==='sql'){
        actions.push({id:'save',label:'保存 SQL 文件',detail:'Ctrl+S',run:()=>{void saveSql();}},{id:'outline',label:'当前 SQL 结构',detail:'Ctrl+F12',run:()=>setNavigator('outline')});
        for(const item of editorKeys)actions.push({id:item.action,label:item.label,detail:item.keys.join(' · '),run:()=>{const e=editors.current.get(active.id);e?.focus();e?.trigger('querydesk',`querydesk.key.${item.action}`,undefined);}});
      }
      if(profile)actions.push({id:'console',label:'新建查询控制台',detail:'Ctrl+Shift+F10',run:()=>{void openTab(profile,'sql',undefined,active?.schema);}});
      return actions.filter(item=>matchesSearch(query,item.label,item.detail));
    }return [];
  }
  const groups=settings?[...new Set(settings.connections.map(c=>c.group||'我的连接'))]:[];
  const copyName=(name:string)=>void navigator.clipboard.writeText(name).then(()=>message.success('已复制')).catch(e=>message.error(e.message));
  const objectNodes=objects.filter(o=>!search||o.name.toLowerCase().includes(search.toLowerCase())).map(o=>{
    const key=`${o.kind}:${o.name}`,def=definitions[`${active?.connectionId}.${o.schema}.${o.name}`];
    const isTable=o.kind==='table',hasColumns=isTable||o.kind==='view';
    const showSource=()=>{if(active)void window.querydesk.call<string>('object.source',{sessionId:active.id,schema:o.schema,table:o.name,kind:o.kind}).then(sql=>setSource({name:o.name,sql})).catch(e=>message.error(e.message));};
    const open=()=>{if(!active||!profile)return;if(hasColumns)void openTab(profile,'table',o.name,o.schema);else showSource();};
    const menu={items:[...(hasColumns?[{key:'browse',label:'打开数据'},{key:'query',label:'生成 SELECT 查询'},{key:'export',label:'导出整表…'},{key:'structure',label:'查看结构'}]:[{key:'source',label:'查看定义'}]),...(isTable?[{key:'add',label:'添加列'},{key:'design',label:'修改表结构'},{key:'index',label:'添加索引'}]:[]),{key:'copy',label:'复制名称'},{key:'refresh',label:'刷新对象'}],onClick:({key:action}:{key:string})=>{
      if(!active||!profile)return;
      if(action==='browse')open();
      if(action==='export')setExportTarget({connectionId:profile.id,schema:o.schema,table:o.name});
      if(action==='source')showSource();
      if(action==='structure')void describe(o.name).then(d=>setDetail(d)).catch(e=>message.error(e.message));
      if(action==='design')void design(o.name);
      if(action==='add'||action==='index')void design(o.name,{action});
      if(action==='copy')copyName(o.name);
      if(action==='refresh'){setDefinitions({});void reloadObjects();}
      if(action==='query')void openTab(profile,'sql',undefined,o.schema,`SELECT * FROM ${qualified(o.schema,o.name,profile.dialect)};`);
    }};
    const title=<Tooltip mouseEnterDelay={0.4} title={<div className="object-tooltip"><strong>{o.name}</strong><div>{def?.comment||o.comment||'无注释'}</div></div>}><span className="object-title" onDoubleClick={open}><span>{o.name}</span><Dropdown trigger={['click']} menu={menu}><MoreOutlined onClick={e=>e.stopPropagation()}/></Dropdown></span></Tooltip>;
    return {key,title:<Dropdown trigger={['contextMenu']} menu={menu}>{title}</Dropdown>,icon:isTable?<TableOutlined/>:hasColumns?<EyeOutlined/>:<CodeOutlined/>,isLeaf:!hasColumns,children:def?.columns.map(c=>({
      key:`${key}.${c.name}`,isLeaf:true,title:<Dropdown trigger={['contextMenu']} menu={{items:[...(isTable?[{key:'edit',label:'修改列'},{key:'drop',label:'删除列…',danger:true},{key:'index',label:'为此列添加索引'}]:[]),{key:'copy',label:'复制列名'},{key:'insert',label:'插入列名到编辑器'}],onClick:({key:action})=>{
        if(action==='copy')copyName(c.name);
        if(action==='insert'&&profile)insertAI(quoteId(c.name,profile.dialect));
        if(action==='edit'||action==='drop'||action==='index')void design(o.name,{action,column:c.name});
      }}}><Tooltip mouseEnterDelay={0.4} title={<div className="object-tooltip"><strong>{c.name}</strong><div>{c.type}{c.primary?' · 主键':''}{c.nullable?' · 可空':' · 非空'}</div><div>{c.comment||'无注释'}</div>{c.defaultValue&&<div>默认值：{c.defaultValue}</div>}</div>}><span className="column-leaf"><span>{c.primary?'◆ ':''}{c.name}</span><small>{c.type}</small></span></Tooltip></Dropdown>
    }))};
  });
  const treeData=objectKinds.flatMap(({kind,label})=>{
    const children=objectNodes.filter(node=>node.key.startsWith(`${kind}:`));
    if(!children.length)return [];
    return [{key:`group:${kind}`,title:<span className="object-group-title"><span>{label}</span><span className="muted">{children.length}</span></span>,icon:<FolderOutlined/>,selectable:false,children}];
  });
  if(fatal)return <div style={{padding:40}}><Alert type="error" message="启动失败" description={fatal}/></div>;
  if(!settings)return <div className="boot"><Spin size="large"/><p>正在加载 QueryDesk…</p></div>;
  return <ConfigProvider locale={zhCN} theme={{algorithm:dark?theme.darkAlgorithm:theme.defaultAlgorithm,token:{colorPrimary:'#8982f8',colorBgBase:dark?'#141820':'#ffffff',colorBorder:dark?'#303641':'#dfe4ed',borderRadius:6,fontFamily:"'Segoe UI', 'Microsoft YaHei', sans-serif",fontSize:12,controlHeight:30},components:{Button:{primaryShadow:'none'},Modal:{contentBg:dark?'#1a1f29':'#fff'},Tabs:{horizontalMargin:'0 0 0 0'},Tree:{nodeHoverBg:dark?'#222835':'#eff1f8',nodeSelectedBg:dark?'#2a2943':'#e8e5ff'}}}}>
    <div className="app-shell"><header className="app-header"><div className="brand"><div className="brand-mark"><DatabaseOutlined/></div><span>Query<span className="brand-light">Desk</span></span><Tag className="version-tag">PREVIEW 0.3</Tag></div><nav className="header-nav"><span className="nav-active">数据库工作台</span><button onClick={()=>{void refreshSettings();setHistory(true);}}>查询历史</button></nav><div className="header-actions"><Button type="text" size="small" onClick={()=>setShortcutsOpen(true)}>快捷键</Button><span className="local-label"><span className="status-dot"/>本地工作区</span><Tooltip title={dark?'切换浅色主题':'切换深色主题'}><Button aria-label="切换主题" type="text" icon={<BulbOutlined/>} onClick={()=>void window.querydesk.call<Settings>('settings.theme',{theme:dark?'light':'dark'}).then(setSettings)}/></Tooltip><Tooltip title="AI 模型设置"><Button aria-label="打开模型设置" type="text" icon={<SettingOutlined/>} onClick={()=>setAISettings(true)}/></Tooltip></div></header>
    <div className="app-body"><aside className="sidebar"><div className="panel-heading"><span className="section-label">数据源</span><Space size={2}><Tooltip title="新建连接"><Button aria-label="新建连接" type="text" size="small" icon={<PlusOutlined/>} onClick={()=>setConnectionModal({})}/></Tooltip><Tooltip title="刷新对象"><Button aria-label="刷新对象" type="text" size="small" icon={<ReloadOutlined/>} disabled={!active?.info.connected||active.busy} loading={objectLoading} onClick={()=>{setDefinitions({});void reloadObjects();}}/></Tooltip></Space></div>
    <div className="connection-list">{!settings.connections.length?<div className="sidebar-empty"><DatabaseOutlined/><span>还没有数据库连接</span><button onClick={()=>setConnectionModal({})}>添加第一个连接 <RightOutlined/></button></div>:groups.map(group=><div className="connection-group" key={group}><div className="group-name"><FolderOutlined/>{group}</div>{settings.connections.filter(c=>(c.group||'我的连接')===group).map(c=><div className={`connection-item ${profile?.id===c.id?'selected':''}`} key={c.id}><button className="connection-main" onClick={()=>void openTab(c)} disabled={opening}><span className={`db-icon ${c.dialect}`}>{c.dialect==='mysql'?'M':'O'}</span><span><strong>{c.name}</strong><small>{c.host}:{c.port}</small></span>{tabs.some(t=>t.connectionId===c.id)&&<span className="status-dot"/>}</button><Dropdown menu={{items:[{key:'open',label:'新建查询标签'},{key:'edit',label:'编辑连接'},{key:'delete',label:'删除连接',danger:true}],onClick:({key})=>{if((key==='edit'||key==='delete')&&tabs.some(t=>t.connectionId===c.id)){message.info('请先关闭此连接的全部标签（包括恢复的草稿）');return;}if(key==='open')void openTab(c);if(key==='edit')setConnectionModal(c);if(key==='delete')Modal.confirm({title:`删除连接“${c.name}”？`,content:'仅删除本机连接配置，不会删除数据库。',okText:'删除',cancelText:'取消',onOk:async()=>setSettings(await window.querydesk.call<Settings>('connection.delete',{id:c.id}))});}}}><Button aria-label={`${c.name}菜单`} type="text" size="small" icon={<MoreOutlined/>}/></Dropdown></div>)}</div>)}</div>
    {active&&<><div className="schema-selector"><Select aria-label="当前 Schema" showSearch value={active.schema||undefined} placeholder="选择数据库 / Schema" disabled={!active.info.connected||active.busy||active.kind==='table'} options={schemas.map(s=>({value:s,label:s}))} onChange={async schema=>{try{const info=await window.querydesk.call<SessionInfo>('session.schema',{sessionId:active.id,schema});patch(active.id,{schema,info});}catch(e){message.error((e as Error).message);}}}/></div><div className="object-search"><Input prefix={<SearchOutlined/>} placeholder="搜索数据库对象…" value={search} onChange={e=>{setSearch(e.target.value);if(e.target.value)setExpandedObjects(objectKinds.map(({kind})=>`group:${kind}`));}} allowClear/></div><div className="object-heading"><span>对象 · {objects.length}</span><Tooltip title="创建数据表"><Button aria-label="创建数据表" size="small" type="text" icon={<PlusOutlined/>} disabled={!active.info.connected||!active.schema||active.busy} onClick={()=>void design()}/></Tooltip></div><div className="object-tree" onKeyDownCapture={event=>{if(shortcut(event,'F5',true)){consume(event);if(!active.busy){setDefinitions({});void reloadObjects();}}}}><Tree onSelect={keys=>{setSelectedObject(String(keys[0]??''));document.querySelector<HTMLInputElement>('.object-tree input')?.focus();}} onKeyDown={event=>{const object=objects.find(o=>`${o.kind}:${o.name}`===selectedObject);if(!object||!active||!profile)return;if(shortcut(event,'F6',true)&&object.kind==='table'){consume(event);void design(object.name);}else if(shortcut(event,'F4')){consume(event);if(object.kind==='table'||object.kind==='view')void openTab(profile,'table',object.name,object.schema);else void window.querydesk.call<string>('object.source',{sessionId:active.id,schema:object.schema,table:object.name,kind:object.kind}).then(sql=>setSource({name:object.name,sql})).catch(e=>message.error(e.message));}}} key={`${active.connectionId}.${active.schema}`} showIcon blockNode treeData={treeData} loadedKeys={[...treeData.map(node=>node.key),...objectNodes.filter(node=>node.children).map(node=>node.key)]} expandedKeys={expandedObjects} onExpand={keys=>setExpandedObjects(keys)} loadData={async node=>{const key=String(node.key);if(!node.children&&(key.startsWith('table:')||key.startsWith('view:')))await describe(key.slice(key.indexOf(':')+1));}}/></div></>}
    <div className="sidebar-bottom"><span className="driver-badge">MySQL</span><span className="driver-badge oracle">Oracle 11g</span><span className="muted">x64</span></div></aside>
    <main className="workspace">{draftError&&<Alert type="error" showIcon message="SQL 草稿保存异常" description={draftError}/>}<div className="workspace-tabs">{tabs.length?<Tabs type="editable-card" hideAdd activeKey={activeId} onChange={setActiveId} onEdit={(id,action)=>{if(action==='remove')void closeTab(String(id));}} items={tabs.map(t=>({key:t.id,label:<span className="tab-label" title={`${t.title} · ${settings.connections.find(c=>c.id===t.connectionId)?.name??''} / ${t.schema}`}><span className="tab-icon anticon">{t.kind==='sql'?<CodeOutlined/>:<TableOutlined/>}</span><span className="tab-name">{t.title}</span><span className="tab-connection">{settings.connections.find(c=>c.id===t.connectionId)?.name}</span>{(t.info.dirty||t.dirtyGrid||sqlModified(t))&&<span className="unsaved-dot" title="有未保存的 SQL 或未提交的变更"/>}</span>}))}/>:<div className="welcome-tab"><DatabaseOutlined/> 欢迎使用 QueryDesk</div>}<div className="tab-actions"><Button size="small" disabled={!settings.connections.length||fileBusy} onClick={()=>void openSql()}>打开 SQL</Button><Button size="small" disabled={active?.kind!=='sql'||fileBusy} onClick={()=>void saveSql()}>保存 SQL</Button><Button size="small" disabled={active?.kind!=='sql'||fileBusy} onClick={()=>void saveSql(true)}>另存为</Button><Tooltip title="新建查询"><Button aria-label="新建查询" type="text" size="small" icon={<PlusOutlined/>} disabled={!profile||opening} onClick={()=>profile&&void openTab(profile,'sql',undefined,active?.schema)}/></Tooltip><Button className={showAI?'ai-toggle active':'ai-toggle'} type="text" size="small" icon={<ThunderboltOutlined/>} onClick={()=>setShowAI(!showAI)}>AI</Button></div></div>
    {active&&profile&&<div className="connection-strip"><Space><span className={`status-dot ${active.info.connected?'':'offline'}`}/><span>{profile.name}</span><span className="muted">/</span><span>{active.schema||'未选择数据库'}</span><Tag bordered={false}>{profile.dialect.toUpperCase()}</Tag>{active.info.readOnly&&<Tag color="cyan">AI 只读会话</Tag>}</Space><Space><Button size="small" disabled={active.busy} onClick={()=>void reconnect()}>{active.info.connected?'重新连接':'连接会话'}</Button><Tooltip title="每个标签独立会话；切换模式前需处理未提交事务"><span className="autocommit"><Switch size="small" checked={active.info.autoCommit} disabled={!active.info.connected||active.busy||active.info.readOnly} onChange={value=>void transaction('auto',value)}/>自动提交</span></Tooltip><Tooltip title="提交当前标签事务"><Button aria-label="提交事务" type="text" size="small" icon={<CheckOutlined/>} disabled={!active.info.connected||active.busy||active.info.autoCommit||active.info.needsRollback} onClick={()=>void transaction('commit')}/></Tooltip><Tooltip title="回滚当前标签事务"><Button aria-label="回滚事务" type="text" size="small" icon={<UndoOutlined/>} disabled={!active.info.connected||active.busy||active.info.autoCommit&&!active.info.needsRollback} onClick={()=>void transaction('rollback')}/></Tooltip></Space></div>}
    {opening&&<div className="connecting-banner"><Spin size="small"/>正在连接数据库…</div>}
    {!tabs.length?<div className="welcome"><div className="welcome-eyebrow"><span/> YOUR DATA. YOUR WORKSPACE.</div><h1>让数据工作，<br/><span>更从容一些。</span></h1><p className="welcome-description">连接数据库，专注查询。<br/>从第一条 SQL 到下一次灵感，AI 与你并肩。</p><Button type="primary" size="large" icon={<PlusOutlined/>} onClick={()=>setConnectionModal({})}>新建数据库连接</Button><span className="welcome-supported">支持 MySQL 与 Oracle 11gR2</span><div className="welcome-cards"><div><div className="feature-icon"><CodeOutlined/></div><h3>熟悉的查询体验</h3><p>多标签 SQL 编辑器<br/>结构补全与独立事务</p></div><div><div className="feature-icon green"><TableOutlined/></div><h3>看得见的数据</h3><p>表格编辑与结构设计<br/>变更预览后再执行</p></div><div><div className="feature-icon violet"><ThunderboltOutlined/></div><h3>懂上下文的 AI</h3><p>生成、解释和优化 SQL<br/>使用你选择的模型</p></div></div><div className="welcome-footnote"><span className="lock-glyph">◇</span>本地连接管理 · Windows 凭据加密 · AI 按需发送上下文</div></div>:<div className="tab-content">{tabs.map(tab=>{const c=settings.connections.find(p=>p.id===tab.connectionId)!;return <div className="tab-page" key={tab.id} style={{display:tab.id===activeId?'flex':'none'}}>{!tab.info.connected&&<Alert type="info" showIcon message="SQL 已保留，当前未连接。点击“连接会话”后可执行；原事务和结果不会恢复。"/>}{tab.info.needsRollback&&<Alert type="warning" showIcon message="会话状态需要确认，请先回滚或重新连接。"/>}{visitedTabs.current.has(tab.id)&&(tab.kind==='sql'?<SqlWorkspace key={`${tab.id}:${tab.generation??0}`} onExport={(query,schema)=>setExportTarget({connectionId:tab.connectionId,schema,query})} connected={tab.info.connected} sessionId={tab.id} schema={tab.schema} profile={c} sql={tab.sql} initialResults={tab.initialResults} dark={dark} objects={tab.id===activeId?objects:[]} tables={Object.entries(definitions).filter(([key])=>key.startsWith(`${tab.connectionId}.${tab.schema}.`)).map(([,v])=>v)} onSql={sql=>patch(tab.id,{sql,edited:true})} onState={info=>patch(tab.id,{info,schema:info.schema})} onBusy={busy=>patch(tab.id,{busy})} onError={error=>setLastErrors(e=>({...e,[tab.id]:error}))} onSelected={rows=>tab.id===activeId&&setSelectedRows(rows)} onEditor={e=>{editors.current.set(tab.id,e);requestAnimationFrame(applyJump);if(tab.initialResults)patch(tab.id,{initialResults:undefined});}}/>:<DataBrowser key={`${tab.id}:${tab.generation??0}`} onExport={options=>setExportTarget({connectionId:tab.connectionId,schema:tab.schema,table:tab.table!,...options})} sessionId={tab.id} schema={tab.schema} table={tab.table!} dark={dark} onState={info=>patch(tab.id,{info,schema:info.schema})} onDirty={dirtyGrid=>patch(tab.id,{dirtyGrid})} onBusy={busy=>patch(tab.id,{busy})} onTable={def=>setDefinitions(d=>({...d,[`${tab.connectionId}.${tab.schema}.${tab.table}`]:def}))} onRows={rows=>tab.id===activeId&&setSelectedRows(rows)}/>)}</div>;})}</div>}
    </main>{showAI&&<AIPanel key={`${profile?.id??'none'}:${active?.schema??''}`} profile={active?.info.connected?profile:undefined} sessionId={active?.id} info={active?.info} activeTable={active?.table} sql={active?.kind==='sql'?active.sql:''} error={lastErrors[activeId]??''} objects={objects} selectedRows={selectedRows} settings={settings.ai} dark={dark} onSettings={()=>setAISettings(true)} onInsert={text=>insertAI(text)} getSqlTarget={aiSqlTarget} onReplace={replaceAISql}/>}</div>
    <footer className="statusbar"><Space size={16}><span><span className={`status-dot ${active?'':'offline'}`}/>{active?(active.info.connected?'已连接':'连接已断开'):'等待连接'}</span><span>{active?`${profile?.dialect.toUpperCase()} ${active.info.version}`:'QueryDesk · Windows 工作台'}</span></Space><Space size={18}><span>{tabs.length} 个会话</span><span>UTF-8</span><span>SQL</span><span className="status-ai"><ThunderboltOutlined/> AI 副驾驶</span></Space></footer>
    </div>{exportTarget&&<ExportTable {...exportTarget} onBusy={setExportBusy} onClose={()=>setExportTarget(undefined)}/>}<ConnectionModal value={connectionModal} onClose={()=>setConnectionModal(null)} onSaved={setSettings}/>{aiSettings&&<AISettingsModal settings={settings.ai} onClose={()=>setAISettings(false)} onSaved={setSettings}/>} {designer&&<TableDesigner {...designer} dark={dark} onClose={()=>setDesigner(undefined)} onDone={()=>{setDefinitions({});void reloadObjects();}}/>}
    {navigationMode&&<QuickPick key={navigationMode} title={{objects:'搜索数据库对象',search:'在所有 SQL 标签中查找',outline:'当前 SQL 结构',recent:'最近打开的标签',actions:'查找操作'}[navigationMode]} hint={{objects:`当前连接 ${profile?.name??'未连接'} / ${active?.schema??'未选择 Schema'} · 表、视图及程序对象${active?.info.connected?'':' · 请先连接会话'}`,search:'仅搜索已打开或已恢复的 SQL 文本，不扫描磁盘或数据库数据',outline:'语句与子句导航，不执行 SQL',recent:'当前工作区仍打开的标签，按最近使用排序',actions:'搜索并选择已支持的应用或编辑器操作'}[navigationMode]} items={navigationItems} onClose={()=>setNavigator(undefined)}/>}
    <Modal open={shortcutsOpen} title="DataGrip Windows 常用快捷键" width={780} footer={null} onCancel={()=>setShortcutsOpen(false)}><p className="muted">按当前焦点生效；表格写入和结构变更保留确认步骤。此处列出已支持的键位，未覆盖的 DataGrip 功能不绑定。</p><Input aria-label="搜索快捷键" placeholder="搜索操作、作用区域或快捷键…" value={helpSearch} onChange={e=>setHelpSearch(e.target.value)} allowClear/><Table size="small" rowKey={row=>row[0]+row[1]} pagination={false} dataSource={shortcutHelp.filter(row=>matchesSearch(helpSearch,...row))} columns={[{title:'作用区域',render:(_,r)=>r[0]},{title:'快捷键',render:(_,r)=><code>{r[1]}</code>},{title:'操作',render:(_,r)=>r[2]}]} scroll={{y:480}}/></Modal>
    <Modal open={history} width={850} title={<Space><HistoryOutlined/>查询历史 · 最近 100 条</Space>} footer={null} onCancel={()=>setHistory(false)}><Alert type="info" message="查询历史保存在本机，SQL 中的字面值也会保留。"/><div className="history-list">{!settings.history.length?<p className="muted">尚无查询记录</p>:settings.history.map((entry,i)=><button key={i} className="history-entry" onClick={()=>{const c=settings.connections.find(p=>p.id===entry.connectionId);if(!c){message.info('原连接配置已删除');return;}setHistory(false);void openTab(c,'sql',undefined,undefined,entry.sql);}}><span><Tag color={entry.ok?'green':'red'}>{entry.ok?'成功':'失败'}</Tag>{settings.connections.find(c=>c.id===entry.connectionId)?.name??'已删除连接'}<small>{new Date(entry.time).toLocaleString('zh-CN')}</small></span><pre>{entry.sql}</pre></button>)}</div></Modal>
    <Modal open={!!detail} width={1000} title={detail?`${detail.schema}.${detail.name} · 结构`:''} onCancel={()=>setDetail(undefined)} footer={<Button onClick={()=>setDetail(undefined)}>关闭</Button>}><p className="muted">{detail?.comment||'无表注释'}</p><Table size="small" rowKey="name" pagination={false} dataSource={detail?.columns} columns={[{title:'字段',dataIndex:'name'},{title:'类型',dataIndex:'type'},{title:'主键',dataIndex:'primary',render:v=>v?'是':''},{title:'允许空',dataIndex:'nullable',render:v=>v?'是':'否'},{title:'默认值',dataIndex:'defaultValue'},{title:'注释',dataIndex:'comment'}]} scroll={{y:360}}/><h4>索引与外键</h4><pre className="context-preview">{detail&&JSON.stringify({indexes:detail.indexes,foreignKeys:detail.foreignKeys},null,2)}</pre></Modal>
    <Modal destroyOnHidden open={!!source} width={1000} title={source?.name} footer={null} onCancel={()=>setSource(undefined)}><SqlEditor readOnly dark={dark} value={source?.sql??''} height="500px"/></Modal>
  </ConfigProvider>;
}
