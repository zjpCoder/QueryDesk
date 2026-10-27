"""表数据和 SQL 结果共用的表头支持点击复制完整字段名。"""
import hashlib
import importlib.util
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GRID = 'dist/assets/GridCore-BHNl3zCJ.js'


def patch(source):
    if 'function CopyColumnName(' in source:
        return source
    component = '''function CopyColumnName(props){
const name=props.column.getColDef().headerName??props.column.getColDef().field??props.displayName;
const [status,setStatus]=m.useState("");const timer=m.useRef();
m.useEffect(()=>()=>clearTimeout(timer.current),[]);
async function copy(event){event.stopPropagation();try{await navigator.clipboard.writeText(String(name));setStatus("已复制")}catch{setStatus("复制失败，请重试")}clearTimeout(timer.current);timer.current=setTimeout(()=>setStatus(""),1800)}
return Oo.jsxs("button",{type:"button",className:"querydesk-copy-column-name","aria-label":`复制字段名 ${name}`,title:status?`${status}：${name}`:`点击复制字段名：${name}`,onClick:copy,onMouseDown:event=>event.stopPropagation(),onKeyDown:event=>{if(event.key==="Enter"||event.key===" ")event.stopPropagation()},style:{display:"block",maxWidth:"100%",minWidth:0,padding:0,border:0,background:"transparent",color:"inherit",font:"inherit",textAlign:"left",cursor:"copy",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},children:[name,status==="已复制"?" ✓":"",Oo.jsx("span",{role:"status",style:{position:"absolute",width:1,height:1,overflow:"hidden",clipPath:"inset(50%)"},children:status})]})
}
'''
    old = 'const OM=m.forwardRef(function({dark:t,...s},i)'
    assert source.count(old) == 1
    source = source.replace(old, component + old)
    old = 'defaultColDef:{resizable:!0,minWidth:110,width:160,sortable:!0,'
    assert source.count(old) == 1
    return source.replace(old, old + 'headerComponentParams:{innerHeaderComponent:CopyColumnName},')


if __name__ == '__main__':
    installed = ROOT / 'resources/app.asar'
    original = installed.read_bytes()
    # 把上次尚待安装的定位按钮一起保留，始终以当前安装包为基础。
    spec = importlib.util.spec_from_file_location('locate_patch', ROOT / 'tools/patch-locate-table.py')
    locate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(locate)
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
    payload = bytearray()
    expected = {}
    changed = []
    backup = ROOT / 'design/before-column-copy'
    backup.mkdir(exist_ok=True)
    for name, entry, data in entries:
        old = data
        if name == GRID:
            data = patch(data.decode('utf-8')).encode('utf-8')
            (ROOT / 'design/column-copy-grid.js').write_bytes(data)
        elif name == locate.BUNDLE:
            data = locate.patch(data.decode('utf-8')).encode('utf-8')
        if data != old:
            changed.append(name)
            saved = backup / Path(name).name
            if not saved.exists():
                saved.write_bytes(old)
            block = 4194304
            entry['integrity'] = {'algorithm': 'SHA256', 'hash': hashlib.sha256(data).hexdigest(), 'blockSize': block,
                                  'blocks': [hashlib.sha256(data[i:i + block]).hexdigest() for i in range(0, len(data), block)]}
        entry.update(offset=str(len(payload)), size=len(data))
        expected[name] = data
        payload.extend(data)
    raw = json.dumps(header, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    padded = (4 + len(raw) + 3) // 4 * 4
    pickle = struct.pack('<II', padded, len(raw)) + raw + b'\0' * (padded - 4 - len(raw))
    package = struct.pack('<II', 4, len(pickle)) + pickle + payload
    for name, entry, _ in entries:
        start = 8 + len(pickle) + int(entry['offset'])
        assert package[start:start + entry['size']] == expected[name], name
    (ROOT / 'resources/app.asar.column-copy.new').write_bytes(package)
    manifest = {'before': hashlib.sha256(original).hexdigest().upper(), 'after': hashlib.sha256(package).hexdigest().upper()}
    (ROOT / 'resources/column-copy-install.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    local = ROOT / 'codex-connect-app' / GRID
    local.write_bytes(patch(local.read_text(encoding='utf-8')).encode('utf-8'))
    print(f'已生成字段复制补丁，保留当前表定位；校验 {len(entries)} 个归档文件，仅修改：{changed}')
