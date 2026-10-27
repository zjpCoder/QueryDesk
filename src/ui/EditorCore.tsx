import { useEffect, useLayoutEffect, useRef } from 'react';
import Editor, { DiffEditor, loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import 'monaco-editor/esm/vs/editor/editor.all.js';
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import type { DBObject, Dialect, TableDef } from '../shared/types';
import { editorKeys } from './shortcuts';
import { completionContext, sqlSuggestions } from '../shared/completion';
(self as any).MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });
function nativeFindTooltips(editor:monaco.editor.IStandaloneCodeEditor){
  const container=editor.getDomNode();if(!container)return;
  // 查找栏的自定义 hover 会被可缩放编辑区裁切并盖住按钮，使用不参与页面布局的原生提示。
  const onMouseOver=(event:MouseEvent)=>{
    const target=event.target instanceof Element?event.target.closest<HTMLElement>('.find-widget [role="button"][aria-label], .find-widget [role="checkbox"][aria-label]'):null;
    if(!target||!container.contains(target))return;
    target.title=target.getAttribute('aria-label')??'';
    event.stopPropagation();
  };
  container.addEventListener('mouseover',onMouseOver,true);
  editor.onDidDispose(()=>container.removeEventListener('mouseover',onMouseOver,true));
}
export function SqlEditor({ value, onChange, dark, readOnly, onMount, objects = [], tables = [], dialect = 'mysql', schema = '', sessionId, busy = false, height = '100%' }: { value: string; onChange?: (v:string) => void; dark: boolean; readOnly?: boolean; onMount?: (e: monaco.editor.IStandaloneCodeEditor) => void; objects?: DBObject[]; tables?: TableDef[]; dialect?:Dialect; schema?:string; sessionId?:string; busy?:boolean; height?: string | number }) {
  const editorRef=useRef<monaco.editor.IStandaloneCodeEditor|null>(null);
  const contextRef=useRef({tables,busy});contextRef.current={tables,busy};
  function mount(editor:monaco.editor.IStandaloneCodeEditor){
    editorRef.current=editor;
    nativeFindTooltips(editor);
    editor.addAction({id:'querydesk.toggleCase',label:'切换大小写',precondition:'editorTextFocus && !editorReadonly',run:e=>{
      const model=e.getModel();if(!model||e.getOption(monaco.editor.EditorOption.readOnly))return;
      const edits=(e.getSelections()??[]).map(selection=>{
        const word=model.getWordAtPosition(selection.getPosition());
        const range=selection.isEmpty()&&word?new monaco.Range(selection.startLineNumber,word.startColumn,selection.startLineNumber,word.endColumn):selection;
        const text=model.getValueInRange(range);return {range,text:text===text.toUpperCase()?text.toLowerCase():text.toUpperCase()};
      });e.pushUndoStop();e.executeEdits('querydesk.case',edits);e.pushUndoStop();
    }});
    for(const item of editorKeys){
      const keys=item.keys.map(key=>key.split('+').reduce((value,part)=>value|({Ctrl:monaco.KeyMod.CtrlCmd,Shift:monaco.KeyMod.Shift,Alt:monaco.KeyMod.Alt}[part]??monaco.KeyCode[(part.length===1?'Key'+part:part) as keyof typeof monaco.KeyCode] as number),0));
      editor.addAction({id:`querydesk.key.${item.action}`,label:item.label,keybindings:keys,precondition:item.edit?'editorTextFocus && !editorReadonly':'editorTextFocus',run:e=>{if(item.edit&&e.getOption(monaco.editor.EditorOption.readOnly))return;e.trigger('querydesk',item.action,undefined);}});
    }
    onMount?.(editor);
  }
  useEffect(() => {
    if(readOnly)return;
    let disposed=false;
    const metadata=new Map<string,Promise<TableDef|undefined>>();
    const provider = monaco.languages.registerCompletionItemProvider('sql', { triggerCharacters:['.',' '], async provideCompletionItems(model, position, _context, token) {
      if(model!==editorRef.current?.getModel())return {suggestions:[]};
      const {tables,busy}=contextRef.current;
      const sql=model.getValue(),offset=model.getOffsetAt(position),version=model.getVersionId();
      const context=completionContext(sql,offset,dialect,objects,schema);
      if(context.blocked)return {suggestions:[]};
      const definitions=[...tables];
      if(sessionId&&!busy&&!context.atStart&&!context.tablePosition){
        const refs=context.references.filter(r=>!context.qualifier||[r.alias,r.object.name].some(n=>n.toUpperCase()===context.qualifier!.toUpperCase())).slice(0,4);
        await Promise.all(refs.map(async ({object})=>{
          if(definitions.some(t=>t.schema===object.schema&&t.name===object.name))return;
          const key=JSON.stringify([object.schema,object.name]);
          let request=metadata.get(key);
          if(!request){
            if(metadata.size>=24)metadata.delete(metadata.keys().next().value!);
            request=window.querydesk.call<TableDef>('table.describe',{sessionId,schema:object.schema,table:object.name}).catch(()=>undefined);
            metadata.set(key,request);
          }
          const def=await request;if(def)definitions.push(def);
        }));
      }
      if(disposed||token.isCancellationRequested||model.isDisposed()||model.getVersionId()!==version)return {suggestions:[]};
      const wordStart=model.getPositionAt(context.start), suffix=/^[\p{L}\p{N}_$#]*/u.exec(sql.slice(offset))?.[0]??'';
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: wordStart.column, endColumn: position.column+suffix.length };
      const kinds={keyword:monaco.languages.CompletionItemKind.Keyword,snippet:monaco.languages.CompletionItemKind.Snippet,table:monaco.languages.CompletionItemKind.Class,field:monaco.languages.CompletionItemKind.Field,function:monaco.languages.CompletionItemKind.Function};
      return { suggestions: sqlSuggestions(sql,offset,dialect,objects,definitions,schema).map((item,index)=>({label:item.label,insertText:item.insertText,detail:item.detail,kind:kinds[item.kind],range,sortText:String(index).padStart(5,'0'),filterText:item.label,insertTextRules:item.kind==='snippet'||item.kind==='function'&&item.label.endsWith('(…)')?monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet:undefined})) };
    } }); return () => {disposed=true;metadata.clear();provider.dispose();};
  }, [readOnly,dialect,schema,sessionId,objects]);
  return <Editor height={height} language="sql" theme={dark ? 'vs-dark' : 'light'} value={value} onChange={v => onChange?.(v ?? '')} onMount={mount} options={{ readOnly, fontSize: 14, fontFamily: "'Cascadia Code', Consolas, monospace", lineHeight: 25, minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 16 }, tabSize: 2, wordWrap: 'on', renderLineHighlight: 'gutter', fixedOverflowWidgets: true, wordBasedSuggestions:'off', suggestSelection:'first', snippetSuggestions:'inline', quickSuggestions:{other:true,comments:false,strings:false}, suggest:{matchOnWordStartOnly:true}, tabCompletion:'on' }} />;
}
export function SqlDiff({ before, after, dark }: { before: string; after: string; dark: boolean }) {
  const editorRef=useRef<monaco.editor.IStandaloneDiffEditor|null>(null);
  useLayoutEffect(()=>()=>{
    // Monaco 0.55 要求先解除 diff 模型，再释放文本；早于 React 包装器的被动清理执行。
    const editor=editorRef.current,model=editor?.getModel();
    editor?.setModel(null);model?.original.dispose();model?.modified.dispose();editorRef.current=null;
  },[]);
  return <DiffEditor height="460px" language="sql" theme={dark ? 'vs-dark' : 'light'} original={before} modified={after} keepCurrentOriginalModel keepCurrentModifiedModel onMount={editor=>{editorRef.current=editor;nativeFindTooltips(editor.getOriginalEditor());nativeFindTooltips(editor.getModifiedEditor());}} options={{ readOnly: true, minimap: { enabled: false }, automaticLayout: true }} />;
}
