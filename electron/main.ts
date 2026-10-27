import type { ExportTarget } from '../src/shared/types';
import { app, BrowserWindow, dialog, ipcMain, utilityProcess, shell, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Store } from './store';
import { WorkspaceStore } from './workspace';
import { validate } from './validation';
import { aiBody, aiEndpoint, aiHttpError, readSSE } from '../src/shared/ai';
import { csv } from '../src/shared/sql';
import type { AIRequest, AISettings } from '../src/shared/types';
import { runAgent } from './agent';
import { readOnlySql } from '../src/shared/agent';

let win: BrowserWindow, store: Store, workspace:WorkspaceStore, closing = false;
const exportJobs=new Map<string,{connectionId:string;sessionId:string;cancelled:boolean}>();
const reconnecting=new Set<string>();
const workers = new Map<string, ReturnType<typeof utilityProcess.fork>>();
const sessions = new Map<string, string>();
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; worker: string; instance: ReturnType<typeof utilityProcess.fork> }>();
const aiRequests = new Map<string, AbortController>();
const exportedFiles = new Map<string,string>();
const agentHistory = new Map<string,{role:'user'|'assistant';content:string}[]>();
const ORACLE_WORKER = '__querydesk_oracle_jdbc__';
function workerKey(key: string) { return store.data.connections.find(c => c.id === key)?.dialect === 'oracle' ? ORACLE_WORKER : key; }
function worker(key: string) {
  let w = workers.get(key); if (w) return w;
  w = utilityProcess.fork(path.join(__dirname, 'worker.cjs'), [], { serviceName: 'QueryDesk Database', stdio: 'ignore', env: { ...process.env, QUERYDESK_JDBC_ROOT: app.isPackaged ? path.join(process.resourcesPath, 'runtime') : path.join(app.getAppPath(), 'runtime') } }); workers.set(key, w);
  w.on('message', (message: any) => { if(message.exportProgress){if(exportJobs.has(message.exportProgress.id)&&!win.isDestroyed())win.webContents.send('querydesk:export',message.exportProgress);return;} const p = pending.get(message.id); if (!p) return; pending.delete(message.id); message.ok ? p.resolve(message.value) : p.reject(new Error(message.error)); });
  w.on('exit', () => { if (workers.get(key) === w) { workers.delete(key); for (const [id, k] of sessions) if (workerKey(k) === key) sessions.delete(id); } for (const [id, item] of pending) if (item.instance === w) { pending.delete(id); item.reject(new Error('数据库工作进程已退出，请重新连接；未提交事务不会重试。')); } });
  return w;
}
function rpc(key: string, method: string, payload: unknown): Promise<any> {
  key = workerKey(key);
  return new Promise((resolve, reject) => { const id = crypto.randomUUID(); const w = worker(key); pending.set(id, { resolve, reject, worker: key, instance: w }); w.postMessage({ id, method, payload }); });
}
function retireWorker(key: string) { key = workerKey(key); if (key === ORACLE_WORKER) return; const current = workers.get(key); if (current) { workers.delete(key); current.kill(); } }
function senderAllowed(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) { return event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame; }
function redact(message: string) {
  // 不输出网络请求对象；如驱动错误包含凭据，仅返回经过替换的短错误文本。
  let result = message.slice(0, 4000);
  for (const item of store.data.connections) { try { const secret = store.decrypt(item.secret); if (secret) result = result.replaceAll(secret, '[已隐藏]'); } catch {} }
  try { const key = store.ai().apiKey; if (key) result = result.replaceAll(key, '[已隐藏]'); } catch {}
  return result;
}
async function requestAI(settings: AISettings, request: AIRequest, controller: AbortController, emit: (s: string) => void) {
  let timedOut=false; const timer = setTimeout(() => { timedOut=true; controller.abort(); }, 120000);
  try {
    let response:Response;
    try { response = await fetch(aiEndpoint(settings.baseUrl), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}) }, body: JSON.stringify(aiBody(settings, request)), signal: controller.signal, redirect: 'error' }); }
    catch(e) { if(controller.signal.aborted)throw new Error(timedOut?'模型请求超时（120 秒），可缩小上下文后重试':'模型请求已取消'); throw new Error('无法连接模型服务，请检查网络、地址和代理设置'); }
    if (!response.ok) { const retry=response.headers.get('retry-after'); await response.body?.cancel(); throw new Error(aiHttpError(response.status,retry)); }
    if (!response.body) throw new Error('模型服务未返回内容');
    if (response.headers.get('content-type')?.includes('text/event-stream')) await readSSE(response.body, emit);
    else { const body = await response.json() as any; if (body.error) throw new Error('模型服务返回错误，请检查模型配置'); const content = body.choices?.[0]?.message?.content; if (typeof content !== 'string') throw new Error('响应不兼容 Chat Completions'); emit(content); }
  } catch(e) { if(controller.signal.aborted && timedOut)throw new Error('模型请求超时（120 秒），可缩小上下文后重试'); throw e; } finally { clearTimeout(timer); }
}
async function operateAI(request:AIRequest,controller:AbortController,emit:(event:object)=>void) {
  if(!request.sessionId || sessions.get(request.sessionId)!==request.connectionId)throw new Error('当前会话与 AI 连接不匹配');
  const origin=await rpc(request.connectionId,'session.state',{sessionId:request.sessionId});
  const profile=store.connection(request.connectionId);
  request={...request,schema:origin.schema,version:origin.version,dialect:profile.dialect};
  if(!request.schema)throw new Error('请先选择当前数据库 / Schema');
  const owned=new Set<string>();const performed:string[]=[];
  const cancel=()=>{for(const sessionId of owned)void rpc(request.connectionId,'query.cancel',{sessionId}).catch(()=>{});};
  controller.signal.addEventListener('abort',cancel);
  const open=async(readOnly=true)=>{
    controller.signal.throwIfAborted();const sessionId=crypto.randomUUID();owned.add(sessionId);
    let info=await rpc(request.connectionId,'session.open',{sessionId,profile,readOnly});sessions.set(sessionId,request.connectionId);
    controller.signal.throwIfAborted();
    if(info.schema!==request.schema)info=await rpc(request.connectionId,'session.schema',{sessionId,schema:request.schema});
    return {sessionId,info};
  };
  const close=async(sessionId:string)=>{try{await rpc(request.connectionId,'session.close',{sessionId,force:true});}finally{owned.delete(sessionId);sessions.delete(sessionId);}};
  const timer=setTimeout(()=>controller.abort(),180000);
  try{
    const metadata=await open();
    const historyKey=request.connectionId+'\0'+request.schema;
    emit({progress:'正在理解需求并查找可用操作…'});
    const summary=await runAgent(store.ai(),request,controller.signal,async(tool,args)=>{
      controller.signal.throwIfAborted();
      if(tool==='find_tables'){emit({progress:`正在查找表：${args.search||'当前 Schema'}`});const found=await rpc(request.connectionId,'agent.find',{sessionId:metadata.sessionId,schema:request.schema,search:args.search});if(Array.isArray(found)&&found.length>1)emit({progress:`找到 ${found.length} 个候选对象，请确认具体表名`});return found;}
      if(tool==='describe_table'){emit({progress:`正在读取结构：${args.table}`});return rpc(request.connectionId,'table.describe',{sessionId:metadata.sessionId,schema:request.schema,table:args.table});}
      if(tool==='query_sql'||tool==='prepare_sql'){
        const sql=tool==='query_sql'?readOnlySql(args.sql,profile.dialect):args.sql;
        emit({progress:tool==='query_sql'?'正在执行只读查询…':'正在打开待确认的 SQL 草稿…'});
        const opened=await open(tool==='query_sql');
        let results:any[]=[];
        if(tool==='query_sql'){
          const queried=await rpc(request.connectionId,'query.run',{sessionId:opened.sessionId,sql,params:{}});
          if(queried.error){await close(opened.sessionId);throw new Error(queried.error);}
          opened.info=queried.state;results=queried.results;
        }
        controller.signal.throwIfAborted();
        emit({opened:{...opened,connectionId:request.connectionId,title:(tool==='query_sql'?'AI · ':'待确认 · ')+args.title,sql,results}});
        performed.push(`${tool==='query_sql'?'已执行查询':'未执行草稿'}：${sql}`);
        owned.delete(opened.sessionId);
        return {status:tool==='query_sql'?'已执行并打开结果标签':'仅打开 SQL 草稿，尚未执行；请用户检查后点击运行',title:args.title,columns:results[0]?.columns||[],loadedRows:results[0]?.rows.length||0,hasMore:results[0]?.hasMore||false,rowsSentToModel:false};
      }
      emit({progress:`正在导出 ${args.table} 的全部行…`});
      const opened=await open();
      try{
        const directory=process.env.QUERYDESK_TEST_USER_DATA?path.join(app.getPath('userData'),'exports'):path.join(app.getPath('downloads'),'QueryDesk');
        await fs.promises.mkdir(directory,{recursive:true});
        const id=crypto.randomUUID();const label=args.table.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,70);
        const name=`${label}-${new Date().toISOString().replace(/[:.]/g,'-')}-${id.slice(0,8)}.${args.format}`;
        const filePath=path.join(directory,name);
        const result=await rpc(request.connectionId,'agent.export',{sessionId:opened.sessionId,schema:request.schema,table:args.table,format:args.format,filePath});
        exportedFiles.set(id,filePath);if(exportedFiles.size>100)exportedFiles.delete(exportedFiles.keys().next().value!);
        emit({file:{id,name,path:filePath,...result}});
        performed.push(`已导出 ${request.schema}.${args.table} 为 ${args.format}，共 ${result.rows} 行`);
        return {status:'文件已生成',fileName:name,...result,rowsSentToModel:false};
      }finally{await close(opened.sessionId);}
    },text=>emit({text}),agentHistory.get(historyKey)||[]);
    const previous=agentHistory.get(historyKey)||[];
    agentHistory.set(historyKey,[...previous,{role:'user',content:request.question},{role:'assistant',content:(summary+'\n应用记录：'+performed.join('\n')).slice(0,6000)}].slice(-8) as {role:'user'|'assistant';content:string}[]);
    if(agentHistory.size>20)agentHistory.delete(agentHistory.keys().next().value!);
  }finally{clearTimeout(timer);controller.signal.removeEventListener('abort',cancel);for(const sessionId of owned)await close(sessionId).catch(()=>{});}
}
async function startExport(p:ExportTarget&{id:string;format:'csv'|'json'}) {
  if(exportJobs.has(p.id))throw new Error('导出任务已存在');
  const profile=store.connection(p.connectionId);
  if(p.query)readOnlySql(p.query.sql,profile.dialect);
  const choice=await dialog.showSaveDialog(win,{defaultPath:(p.table??'query-result').replace(/[<>:"/\\|?*]/g,'_')+'.'+p.format,filters:[{name:p.format.toUpperCase(),extensions:[p.format]}]});
  if(choice.canceled||!choice.filePath)return false;
  const job={connectionId:p.connectionId,sessionId:crypto.randomUUID(),cancelled:false};exportJobs.set(p.id,job);
  const emit=(event:object)=>{if(!win.isDestroyed())win.webContents.send('querydesk:export',{id:p.id,...event});};
  const task=async()=>{
    try{
      await rpc(p.connectionId,'session.open',{sessionId:job.sessionId,profile,readOnly:true});sessions.set(job.sessionId,p.connectionId);
      if(job.cancelled)throw new Error('导出已取消');
      if(p.query&&p.schema)await rpc(p.connectionId,'session.schema',{sessionId:job.sessionId,schema:p.schema});
      if(job.cancelled)throw new Error('导出已取消');
      const result=await rpc(p.connectionId,'agent.export',{...p,sessionId:job.sessionId,filePath:choice.filePath,exportId:p.id});
      exportedFiles.set(p.id,choice.filePath!);if(exportedFiles.size>100)exportedFiles.delete(exportedFiles.keys().next().value!);
      emit({done:true,file:{id:p.id,name:path.basename(choice.filePath!),path:choice.filePath,...result}});
    }catch(e){emit({done:true,error:job.cancelled?'导出已取消':redact((e as Error).message)});}
    finally{await rpc(p.connectionId,'session.close',{sessionId:job.sessionId,force:true}).catch(()=>{});sessions.delete(job.sessionId);exportJobs.delete(p.id);if(![...sessions.values()].includes(p.connectionId))retireWorker(p.connectionId);}
  };
  void task();return true;
}
async function handle(method: string, payload: unknown) {
  const p = validate(method, payload) as any;
  switch (method) {
    case 'workspace.get': return workspace.get();
    case 'workspace.save': workspace.save(p);return;
    case 'sql.open': {const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'SQL 文件',extensions:['sql']}]});return r.canceled||!r.filePaths[0]?null:workspace.open(r.filePaths[0]);}
    case 'sql.save': {
      let destination:string|undefined;
      if(!p.fileId||p.saveAs){const r=await dialog.showSaveDialog(win,{defaultPath:p.fileId?workspace.document(p.fileId).path:'query.sql',filters:[{name:'SQL 文件（UTF-8）',extensions:['sql']}]});if(r.canceled||!r.filePath)return null;destination=r.filePath;}
      return workspace.write(p.sql,p.fileId,destination);
    }
    case 'export.start':case 'export.query':return startExport(p);
    case 'export.cancel': {const job=exportJobs.get(p.id);if(job){job.cancelled=true;await rpc(job.connectionId,'query.cancel',{sessionId:job.sessionId}).catch(()=>{});}return;}
    case 'session.reconnect': {
      if(reconnecting.has(p.sessionId))throw new Error('正在重连，请等待');
      const old=sessions.get(p.sessionId);if(old&&old!==p.connectionId)throw new Error('不能改变标签所属连接');
      reconnecting.add(p.sessionId);
      try{const result=await rpc(p.connectionId,method,{...p,profile:store.connection(p.connectionId)});sessions.set(p.sessionId,p.connectionId);return result;}
      catch(e){await rpc(p.connectionId,'session.state',{sessionId:p.sessionId}).catch(()=>sessions.delete(p.sessionId));throw e;}finally{reconnecting.delete(p.sessionId);}
    }
    case 'settings.get': return store.public();
    case 'settings.theme': store.data.theme = p.theme; store.save(); return store.public();
    case 'connection.save': if ([...sessions.values()].includes(p.id)) throw new Error('请先关闭该连接的查询标签，再修改连接配置'); return store.saveConnection(p);
    case 'connection.delete': if ([...sessions.values()].includes(p.id)) throw new Error('请先关闭该连接的查询标签'); store.data.connections = store.data.connections.filter(c => c.id !== p.id); store.save(); return store.public();
    case 'connection.test': { const key = p.dialect === 'oracle' ? ORACLE_WORKER : 'test-' + crypto.randomUUID(); if (p.password === undefined && store.data.connections.some(c => c.id === p.id)) p.password = store.connection(p.id).password; try { return await rpc(key, 'connection.test', p); } finally { retireWorker(key); } }
    case 'client.inspect': return rpc(ORACLE_WORKER, method, p);
    case 'dialog.directory': { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); return r.filePaths[0] ?? ''; }
    case 'dialog.file': { const r = await dialog.showOpenDialog(win, { properties: ['openFile'] }); return r.filePaths[0] ?? ''; }
    case 'session.open': { if (sessions.has(p.sessionId)) throw new Error('会话已存在'); try { const result = await rpc(p.connectionId, method, { ...p, profile: store.connection(p.connectionId) }); sessions.set(p.sessionId, p.connectionId); return result; } catch (e) { if (![...sessions.values()].includes(p.connectionId)) retireWorker(p.connectionId); throw e; } }
    case 'session.close': { const key = sessions.get(p.sessionId); if (!key) return; await rpc(key, method, p); sessions.delete(p.sessionId); if (![...sessions.values()].includes(key)) retireWorker(key); return; }
    case 'ai.save': aiEndpoint(p.baseUrl); return store.saveAI(p);
    case 'ai.test': { const controller = new AbortController(); const settings = { ...p, apiKey: p.apiKey ?? store.ai().apiKey }; await requestAI(settings, { id: 'test', action: 'explain', question: '仅回复：连接成功', connectionId: 'test', dialect: 'mysql', version: '', schema: '', sql: '', error: '', tables: [], rows: [] }, controller, () => {}); return '模型连接成功'; }
    case 'ai.start': {
      if (aiRequests.has(p.id)) throw new Error('请求 ID 已存在');
      const profile = store.data.connections.find(c => c.id === p.connectionId); if (!profile || profile.dialect !== p.dialect) throw new Error('AI 上下文与连接不匹配');
      if (Buffer.byteLength(JSON.stringify(p)) > 500000) throw new Error('AI 上下文过大，请减少表结构或结果行');
      const controller = new AbortController(); aiRequests.set(p.id, controller);
      const emit = (event: object) => { if (!win.isDestroyed()) win.webContents.send('querydesk:ai', { id: p.id, ...event }); };
      const operation=p.action==='operate'?operateAI(p,controller,emit):requestAI(store.ai(), p, controller, text => emit({ text }));
      void operation.then(() => emit({ done: true })).catch(e => emit({ done: true, error: controller.signal.aborted ? '请求已取消或超时；已完成的查询和导出仍保留' : redact(String(e.message)) })).finally(() => aiRequests.delete(p.id)); return;
    }
    case 'ai.cancel': aiRequests.get(p.id)?.abort(); return;
    case 'ai.clear': { for (const key of [...agentHistory.keys()]) if (key === `${p.connectionId}\0${p.schema}`) agentHistory.delete(key); return; }
    case 'file.reveal': { const file=exportedFiles.get(p.id);if(!file)throw new Error('此导出记录已失效，请从下载目录打开');shell.showItemInFolder(file);return; }
    case 'file.export': { const r = await dialog.showSaveDialog(win, { defaultPath: `query-result.${p.format}`, filters: [{ name: p.format.toUpperCase(), extensions: [p.format] }] }); if (r.canceled || !r.filePath) return false; await fs.promises.writeFile(r.filePath, p.format === 'csv' ? csv(p.rows, p.columns) : JSON.stringify(p.rows, null, 2), 'utf8'); return true; }
    case 'history.add': store.data.history = [p, ...store.data.history].slice(0, 100); store.save(); return;
    default: { const key = sessions.get(p.sessionId); if (!key) throw new Error('会话已断开，请关闭标签后重新连接'); return rpc(key, method, p); }
  }
}
if (process.env.QUERYDESK_TEST_USER_DATA) app.setPath('userData', process.env.QUERYDESK_TEST_USER_DATA);
const ownsInstance=app.requestSingleInstanceLock();
if(!ownsInstance)app.quit();
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
app.whenReady().then(() => {
  if(!ownsInstance)return;
  try { store = new Store(); workspace=new WorkspaceStore(path.join(app.getPath('userData'),'workspace.enc'),s=>store.encrypt(s),s=>store.decrypt(s)); } catch (e) { dialog.showErrorBox('QueryDesk 配置错误', String((e as Error).message)); app.quit(); return; }
  // Windows 默认菜单会先拦截 Ctrl+W / Ctrl+R 等键位，交给应用按焦点处理。
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({ width: 1520, height: 980, minWidth: 1100, minHeight: 720, backgroundColor: '#11151c', title: 'QueryDesk', icon: path.join(__dirname, '../assets/icon.png'), autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
  ipcMain.handle('querydesk:call', async (event, method, payload) => { try { if (!senderAllowed(event)) throw new Error('不允许的调用来源'); return { ok: true, value: await handle(method, payload) }; } catch (e) { return { ok: false, error: redact(e instanceof Error ? e.message : '操作失败') }; } });
  ipcMain.on('querydesk:close-confirmed', event => { if (senderAllowed(event)) { closing = true; win.close(); } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.on('close', event => { if (!closing) { event.preventDefault(); win.webContents.send('querydesk:close'); } });
  const dev = process.env.QUERYDESK_DEV_URL;
  if (!app.isPackaged && dev === 'http://127.0.0.1:5173') void win.loadURL(dev); else void win.loadFile(path.join(__dirname, '../dist/index.html'));
});
app.on('window-all-closed', () => { for (const c of aiRequests.values()) c.abort(); for (const w of workers.values()) w.kill(); app.quit(); });
