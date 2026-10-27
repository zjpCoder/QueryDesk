"""精简表格按钮，把排序字段移到筛选值右侧；保留原服务端排序逻辑。"""
import hashlib
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = 'dist/assets/index-BiPxEQzb.js'
CSS = 'dist/assets/index-BXVoCd3S.css'


def replace(source, old, new):
    assert source.count(old) == 1, (old[:100], source.count(old))
    return source.replace(old, new)


def patch(name, data):
    if name not in (INDEX, CSS):
        return data
    source = data.decode('utf-8')
    if name == CSS:
        source += '''
/* 筛选值与排序控件共享一行，窄窗口自动换行。 */
.filter-fields{display:flex;flex-wrap:wrap;gap:0 12px;align-items:flex-start}
.filter-conditions{flex:1 1 500px;min-width:0}
.filter-builder .filter-row{flex-wrap:wrap}
.filter-builder .filter-row>.ant-input{flex:0 1 180px;width:180px;min-width:100px}
.table-sort-controls{display:flex;gap:8px;align-items:center;margin-top:8px;flex-shrink:0}
'''
    else:
        source = replace(source, 'L.jsx(Rt,{disabled:!$||R,onClick:Z,children:"设为 NULL"}),', '')
        source = replace(source, 'L.jsx(Rt,{icon:L.jsx(G4,{}),onClick:()=>{window.querydesk.call("file.export",{format:"csv",columns:g?.columns.map(X=>X.name)??[],rows:p.filter(X=>!X.deleted).map(X=>X.values)}).catch(X=>nn.error(X.message))},children:"导出本页"}),L.jsx(Rt,{onClick:()=>e(),children:"导出整表"}),', '')
        old_sort = 'L.jsx(Nr,{size:"small",placeholder:"服务端排序",style:{width:150},allowClear:!0,value:U?.column,options:g?.columns.map(X=>({value:X.name,label:X.name})),onChange:X=>{le(0,A,X?{column:X,direction:U?.direction??"asc"}:null)}}),L.jsx(Rt,{size:"small",disabled:!U,onClick:()=>U&&void le(0,A,{...U,direction:U.direction==="asc"?"desc":"asc"}),children:U?.direction==="desc"?"降序":"升序"})'
        source = replace(source, ',' + old_sort, '')
        sort = old_sort.replace('size:"small",placeholder:"服务端排序",', '"aria-label":"排序字段",placeholder:"排序字段",disabled:R,showSearch:!0,optionFilterProp:"label",')
        sort = sort.replace('size:"small",disabled:!U,', '"aria-label":"切换排序方向",disabled:R||!U,')
        source = replace(source, 'M.map((X,ue)=>L.jsxs("div",{className:"filter-row",', 'L.jsxs("div",{className:"filter-fields",children:[L.jsx("div",{className:"filter-conditions",children:M.map((X,ue)=>L.jsxs("div",{className:"filter-row",')
        source = replace(source, '})]},ue))]}),L.jsxs("div",{className:"data-toolbar",', '})]},ue))}),L.jsxs("div",{className:"table-sort-controls",children:[' + sort + ']})]})]}),L.jsxs("div",{className:"data-toolbar",')
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
    payload, changed = bytearray(), []
    for name, entry, old in entries:
        data = patch(name, old)
        if data != old:
            changed.append(name)
            block = 4194304
            entry['integrity'] = {'algorithm': 'SHA256', 'hash': hashlib.sha256(data).hexdigest(), 'blockSize': block,
                                  'blocks': [hashlib.sha256(data[i:i + block]).hexdigest() for i in range(0, len(data), block)]}
            local = ROOT / 'design/filter-toolbar-patched' / name
            local.parent.mkdir(parents=True, exist_ok=True)
            local.write_bytes(data)
        entry.update(offset=str(len(payload)), size=len(data))
        payload.extend(data)
    assert set(changed) == {INDEX, CSS}, changed
    raw = json.dumps(header, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    padded = (4 + len(raw) + 3) // 4 * 4
    pickle = struct.pack('<II', padded, len(raw)) + raw + b'\0' * (padded - 4 - len(raw))
    package = struct.pack('<II', 4, len(pickle)) + pickle + payload
    for name, entry, old in entries:
        start = 8 + len(pickle) + int(entry['offset'])
        assert package[start:start + entry['size']] == patch(name, old), name
    output = ROOT / 'resources/app.asar.filter-toolbar.new'
    output.write_bytes(package)
    manifest = {'before': hashlib.sha256(original).hexdigest().upper(), 'after': hashlib.sha256(package).hexdigest().upper()}
    (ROOT / 'resources/filter-toolbar-install.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(f'已逐项校验 {len(entries)} 个归档文件；仅修改：{changed}')


if __name__ == '__main__':
    build()
