"""给现有字段复制表头添加排序按钮，表浏览复用服务端分页排序。"""
import hashlib
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GRID = 'dist/assets/GridCore-BHNl3zCJ.js'
INDEX = 'dist/assets/index-BiPxEQzb.js'


def replace(source, old, new):
    assert source.count(old) == 1, (old[:100], source.count(old))
    return source.replace(old, new)


def patch(name, data):
    if name not in (GRID, INDEX):
        return data
    source = data.decode('utf-8')
    if name == GRID:
        source = replace(source, 'function CopyColumnName(props){', '''function ColumnSortButton(props){
const {column,onServerSort,serverSort,sortDisabled}=props;
const [localSort,setLocalSort]=m.useState(column.getSort());
m.useEffect(()=>{const changed=()=>setLocalSort(column.getSort());column.addEventListener("sortChanged",changed);changed();return()=>column.removeEventListener("sortChanged",changed)},[column]);
if(!onServerSort&&!column.isSortable())return null;
const sort=onServerSort?serverSort:localSort,next=sort==="asc"?"desc":sort==="desc"?null:"asc";
const name=column.getColDef().headerName??column.getColId(),action=next==="asc"?"升序":next==="desc"?"降序":"取消排序";
return Oo.jsx("button",{type:"button",className:"querydesk-sort-column","aria-label":`${action} ${name}`,title:`${sort==="asc"?"当前升序":sort==="desc"?"当前降序":"未排序"}，点击${action}${onServerSort?"（全部数据）":"（已加载数据）"}`,disabled:!!sortDisabled,onMouseDown:event=>event.stopPropagation(),onKeyDown:event=>{if(event.key==="Enter"||event.key===" ")event.stopPropagation()},onClick:event=>{event.stopPropagation();onServerSort?onServerSort(next):props.progressSort(event.shiftKey)},style:{display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0,width:24,height:26,marginLeft:4,padding:2,border:0,borderRadius:3,background:"transparent",color:"inherit",cursor:sortDisabled?"wait":"pointer",opacity:sortDisabled?.45:1},children:Oo.jsxs("svg",{width:14,height:18,viewBox:"0 0 14 18",fill:"none",stroke:"currentColor",strokeWidth:1.6,"aria-hidden":!0,children:[Oo.jsx("path",{d:"m3 7 4-4 4 4",opacity:sort==="asc"?1:.35}),Oo.jsx("path",{d:"m3 11 4 4 4-4",opacity:sort==="desc"?1:.35})]})})
}
function CopyColumnName(props){''')
        source = replace(source, 'return Oo.jsxs("button",{type:"button",className:"querydesk-copy-column-name"',
                         'return Oo.jsxs("span",{className:"querydesk-column-header",style:{display:"flex",alignItems:"center",minWidth:0,width:"100%"},children:[Oo.jsxs("button",{type:"button",className:"querydesk-copy-column-name"')
        source = replace(source, 'style:{display:"block",maxWidth:"100%",minWidth:0,padding:0,',
                         'style:{display:"block",flex:1,maxWidth:"100%",minWidth:0,padding:0,')
        source = replace(source, 'children:status})]})\n}', 'children:status})]}),Oo.jsx(ColumnSortButton,{...props})]})\n}')
        source = replace(source, 'children:[Oo.jsx(IM,{ref:i,theme:l,',
                         'children:[Oo.jsx("style",{children:".ag-header-cell:has(.querydesk-column-header) .ag-header-cell-text{flex:1;min-width:0;width:100%}.ag-header-cell-text:has(.querydesk-column-header)>*{width:100%}.ag-header-cell:has(.querydesk-sort-column) .ag-sort-indicator-container{display:none}.querydesk-sort-column:hover:not(:disabled){background:color-mix(in srgb,currentColor 12%,transparent)}.querydesk-sort-column:focus-visible{outline:2px solid currentColor;outline-offset:-2px}"}),Oo.jsx(IM,{ref:i,theme:l,')
    else:
        source = replace(source, 'sortable:!1,editable:ue=>$&&!R&&!X.generated',
                         'sortable:!1,headerComponentParams:{serverSort:U?.column===X.name?U.direction:null,sortDisabled:R,onServerSort:direction=>{le(0,A,direction?{column:X.name,direction}:null)}},editable:ue=>$&&!R&&!X.generated')
    return source.encode('utf-8')


def build():
    original = (ROOT / 'resources/app.asar').read_bytes()
    _, header_size, _, json_size = struct.unpack('<4I', original[:16])
    header = json.loads(original[16:16 + json_size])
    entries = []

    def walk(tree, prefix=''):
        for name, entry in tree['files'].items():
            current = f'{prefix}/{name}' if prefix else name
            if 'files' in entry:
                walk(entry, current)
            elif 'offset' in entry:
                start = 8 + header_size + int(entry['offset'])
                entries.append((current, entry, original[start:start + entry['size']]))

    walk(header)
    entries.sort(key=lambda item: int(item[1]['offset']))
    payload, expected, changed = bytearray(), {}, []
    for name, entry, old in entries:
        data = patch(name, old)
        if data != old:
            changed.append(name)
            block = 4194304
            entry['integrity'] = {'algorithm': 'SHA256', 'hash': hashlib.sha256(data).hexdigest(), 'blockSize': block,
                                  'blocks': [hashlib.sha256(data[i:i + block]).hexdigest() for i in range(0, len(data), block)]}
            local = ROOT / 'design/column-sort-patched' / name
            local.parent.mkdir(parents=True, exist_ok=True)
            local.write_bytes(data)
        expected[name] = data
        entry.update(offset=str(len(payload)), size=len(data))
        payload.extend(data)
    assert set(changed) == {GRID, INDEX}, changed
    raw = json.dumps(header, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    padded = (4 + len(raw) + 3) // 4 * 4
    pickle = struct.pack('<II', padded, len(raw)) + raw + b'\0' * (padded - 4 - len(raw))
    package = struct.pack('<II', 4, len(pickle)) + pickle + payload
    for name, entry, _ in entries:
        start = 8 + len(pickle) + int(entry['offset'])
        assert package[start:start + entry['size']] == expected[name], name
    (ROOT / 'resources/app.asar.column-sort.new').write_bytes(package)
    manifest = {'before': hashlib.sha256(original).hexdigest().upper(), 'after': hashlib.sha256(package).hexdigest().upper()}
    (ROOT / 'resources/column-sort-install.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(f'逐项校验 {len(entries)} 个归档文件；仅修改：{changed}')


if __name__ == '__main__':
    build()
