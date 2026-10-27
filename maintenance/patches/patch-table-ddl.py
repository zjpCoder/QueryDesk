"""在对象树和 SQL 编辑器中用 Ctrl+B 打开表定义，复用现有 SQL 标签。"""
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[1]
app = root / 'codex-connect-app'


def patch(relative, changes):
    path = app / relative
    saved = root / 'design/before-table-ddl' / relative
    saved.parent.mkdir(parents=True, exist_ok=True)
    if not saved.exists():
        shutil.copy2(path, saved)
    source = saved.read_text(encoding='utf-8')
    for old, new in changes:
        assert source.count(old) == 1, (relative, old[:100], source.count(old))
        source = source.replace(old, new)
    path.write_bytes(source.encode('utf-8'))


target = r'''function tableDefinitionTarget(editor,schema,objects,dialect){
const model=editor?.getModel(),selection=editor?.getSelection();
if(!model||!selection)return;
const identifier='(?:"(?:[^"\\r\\n]|"")+"|`(?:[^`\\r\\n]|``)+`|[\\p{L}_$#][\\p{L}\\p{N}_$#]*)';
const pattern=new RegExp(identifier+'(?:\\s*\\.\\s*'+identifier+')?','gu');
let text=model.getValueInRange(selection).trim();
if(!text){
 const position=editor.getPosition(),line=model.getLineContent(position.lineNumber),offset=position.column-1;
 text=[...line.matchAll(pattern)].find(match=>offset>=match.index&&offset<=match.index+match[0].length)?.[0]??'';
}
const match=[...text.matchAll(pattern)];
if(match.length!==1||match[0][0]!==text)return;
const parts=text.match(new RegExp(identifier,'gu'));
const decode=value=>value.startsWith('"')?value.slice(1,-1).replaceAll('""','"'):value.startsWith('`')?value.slice(1,-1).replaceAll('``','`'):dialect==='oracle'?value.toUpperCase():value;
const name=decode(parts.at(-1)),owner=parts.length===2?decode(parts[0]):schema;
const candidates=objects.filter(object=>(object.kind==='table'||object.kind==='view')&&object.schema===owner);
return candidates.find(object=>object.name===name)??(dialect==='mysql'?candidates.find(object=>object.name.toLowerCase()===name.toLowerCase()):null)??{kind:'table',name,schema:owner};
}
'''

open_ddl = '''async function openTableDefinition(object){
if(!object||!pe||!He)return;
if(!pe.info.connected){nn.info("请先连接数据库");return}
if(pe.busy||S||definitionOpening.current){nn.info("请等待当前操作完成");return}
const definitionKey=JSON.stringify([He.id,object.schema,object.kind,object.name]);
const existing=ue.current.find(tab=>tab.definitionKey===definitionKey);
if(existing){rt(existing.id);return}
definitionOpening.current=!0;
try{
 const sql=await window.querydesk.call("object.source",{sessionId:pe.id,schema:object.schema,table:object.name,kind:object.kind});
 if(!sql?.trim())throw new Error("未读取到表定义，请检查对象名称与访问权限");
 await ht(He,"sql",void 0,object.schema,sql,{title:object.name+" (DDL)",definitionKey});
}catch(error){nn.error(error.message)}finally{definitionOpening.current=!1}
}
'''

patch('dist/assets/index-BiPxEQzb.js', [
    ('function jn(e,t,n=!1,r=!1,a=!1)', target+'function jn(e,t,n=!1,r=!1,a=!1)'),
    ('[objectTreeHeight,setObjectTreeHeight]=d.useState(300)', '[objectTreeHeight,setObjectTreeHeight]=d.useState(300),definitionOpening=d.useRef(!1)'),
    ('async function ht(ne,de="sql",Ee,Be,St)', 'async function ht(ne,de="sql",Ee,Be,St,definition)'),
    ('schema:et.schema,busy:!1,dirtyGrid:!1};v(jt=>[...jt,dt]),b(Wt)', 'schema:et.schema,busy:!1,dirtyGrid:!1,...definition};definition&&(Ve.current={id:Wt,offset:0,length:0}),v(jt=>[...jt,dt]),b(Wt)'),
    ('function wt(ne){', open_ddl+'function wt(ne){'),
    ('if(jn(de,"KeyN",!0))Fn(de),ye("objects");', 'if(jn(de,"KeyB",!0)&&Ee.closest(".object-tree,.monaco-editor")){Fn(de);const object=Ee.closest(".object-tree")?$.find(item=>`${item.kind}:${item.name}`===Me&&(item.kind==="table"||item.kind==="view")):tableDefinitionTarget(he.current.get(pe?.id),pe?.schema,$,He?.dialect);object?openTableDefinition(object):nn.info("请先选中表或将光标放在表名上")}else if(jn(de,"KeyN",!0))Fn(de),ye("objects");'),
    ('{key:"structure",label:"查看结构"}', '{key:"definition",label:"在编辑器打开表结构 (Ctrl+B)"},{key:"structure",label:"查看结构"}'),
    ('it==="source"&&Wt(),it==="structure"', 'it==="source"&&Wt(),it==="definition"&&openTableDefinition(ne),it==="structure"'),
    ('["对象树","F4 · Ctrl+F6","打开数据或定义 / 修改表结构"]', '["对象树 / SQL 编辑器","Ctrl+B","在编辑器打开选中表或光标处表名的 DDL"],["对象树","F4 · Ctrl+F6","打开数据或定义 / 修改表结构"]'),
])

oracle_ddl = '''  if (kind === "table") {
    const binds = { schema, table };
    const rows = await raw(s, "SELECT DBMS_METADATA.GET_DDL('TABLE', :table, :schema) AS DDL FROM DUAL", binds);
    if (!rows[0]?.DDL) throw new Error("未读取到表定义，请检查对象名称与访问权限");
    const indexes = await raw(s, "SELECT DBMS_METADATA.GET_DDL('INDEX', I.INDEX_NAME, I.OWNER) AS DDL FROM ALL_INDEXES I WHERE I.TABLE_OWNER=:schema AND I.TABLE_NAME=:table AND I.INDEX_TYPE <> 'LOB' AND NOT EXISTS (SELECT 1 FROM ALL_CONSTRAINTS C WHERE C.INDEX_OWNER=I.OWNER AND C.INDEX_NAME=I.INDEX_NAME AND C.CONSTRAINT_TYPE IN ('P','U')) ORDER BY I.INDEX_NAME", binds);
    const comments = await raw(s, "SELECT NULL AS COLUMN_NAME, COMMENTS FROM ALL_TAB_COMMENTS WHERE OWNER=:schema AND TABLE_NAME=:table AND COMMENTS IS NOT NULL UNION ALL SELECT COLUMN_NAME, COMMENTS FROM ALL_COL_COMMENTS WHERE OWNER=:schema AND TABLE_NAME=:table AND COMMENTS IS NOT NULL", binds);
    const statements = [...rows, ...indexes].map(row => String(row.DDL).trim().replace(/;?$/, ';'));
    for (const row of comments) statements.push(`COMMENT ON ${row.COLUMN_NAME ? 'COLUMN' : 'TABLE'} ${qualified(schema, table, 'oracle')}${row.COLUMN_NAME ? '.' + quoteId(row.COLUMN_NAME, 'oracle') : ''} IS '${String(row.COMMENTS).replaceAll("'", "''")}';`);
    return statements.join("\\n\\n");
  }
'''
patch('dist-electron/worker.cjs', [
    ('  if (kind === "view") return (await raw(s, "SELECT TEXT FROM ALL_VIEWS', oracle_ddl+'  if (kind === "view") return (await raw(s, "SELECT TEXT FROM ALL_VIEWS'),
])
print('已补充 Ctrl+B 表定义导航、DDL 编辑器标签和 Oracle 表定义读取。')
