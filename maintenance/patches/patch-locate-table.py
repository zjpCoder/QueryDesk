"""为对象树添加当前表定位；仅修改安装包中的前端主文件。"""
import hashlib
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = 'dist/assets/index-BiPxEQzb.js'


def patch(source):
    if 'objectTreeLocateTarget' in source:
        return source
    changes = [
        ('[objectTreeHeight,setObjectTreeHeight]=d.useState(300),',
         '[objectTreeHeight,setObjectTreeHeight]=d.useState(300),objectTreeRef=d.useRef(null),[objectTreeLocateTarget,setObjectTreeLocateTarget]=d.useState(null),'),
        (']:[]});return n?L.jsx("div",{style:{padding:40}',
         ''']:[]});const currentTableObject=pe?.kind==="table"?$.find(item=>item.name===pe.table&&(item.kind==="table"||item.kind==="view")):void 0;
d.useLayoutEffect(()=>{if(!objectTreeLocateTarget||objectTreeLocateTarget.sessionId!==p)return;const frame=requestAnimationFrame(()=>{objectTreeRef.current?.scrollTo({key:objectTreeLocateTarget.key,align:"auto"});document.querySelector(".object-tree input")?.focus({preventScroll:true})});return()=>cancelAnimationFrame(frame)},[objectTreeLocateTarget,p]);
return n?L.jsx("div",{style:{padding:40}'''),
        ('children:["对象 · ",$.length]}),L.jsx(gr,{title:"创建数据表",',
         '''children:["对象 · ",$.length]}),L.jsxs(tr,{size:2,children:[L.jsx(gr,{title:"定位当前表",children:L.jsx(Rt,{"aria-label":"定位当前表",size:"small",type:"text",disabled:!currentTableObject||N,icon:L.jsxs("svg",{width:14,height:14,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:1.8,"aria-hidden":!0,children:[L.jsx("circle",{cx:12,cy:12,r:7}),L.jsx("circle",{cx:12,cy:12,r:2}),L.jsx("path",{d:"M12 2v3m0 14v3M2 12h3m14 0h3"})]}),onClick:()=>{if(!currentTableObject)return;const key=`${currentTableObject.kind}:${currentTableObject.name}`,group=`group:${currentTableObject.kind}`;j("");xe(keys=>keys.includes(group)?keys:[...keys,group]);Xe(key);setObjectTreeLocateTarget({key,sessionId:p})}})}),L.jsx(gr,{title:"创建数据表",'''),
        ('onClick:()=>{yt()}})})]}),L.jsx("div",{className:"object-tree object-tree-virtual",',
         'onClick:()=>{yt()}})})]})]}),L.jsx("div",{className:"object-tree object-tree-virtual",'),
        ('children:L.jsx(Nh,{onSelect:ne=>{Xe(String(ne[0]??""))',
         'children:L.jsx(Nh,{ref:objectTreeRef,selectedKeys:Me?[Me]:[],onSelect:ne=>{Xe(String(ne[0]??""))'),
    ]
    for old, new in changes:
        assert source.count(old) == 1, (old, source.count(old))
        source = source.replace(old, new)
    return source


def build():
    installed = ROOT / 'resources/app.asar'
    original = installed.read_bytes()
    _, header_size, _, json_size = struct.unpack('<4I', original[:16])
    header = json.loads(original[16:16 + json_size])
    base = 8 + header_size
    entries = []

    def walk(tree, prefix=''):
        for name, entry in tree['files'].items():
            current = f'{prefix}/{name}' if prefix else name
            if 'files' in entry:
                walk(entry, current)
            elif 'offset' in entry:
                start = base + int(entry['offset'])
                entries.append((current, entry, original[start:start + entry['size']]))

    walk(header)
    entries.sort(key=lambda item: int(item[1]['offset']))
    payload = bytearray()
    expected = {}
    for name, entry, data in entries:
        if name == BUNDLE:
            (ROOT / 'design/before-locate-table').mkdir(exist_ok=True)
            (ROOT / 'design/before-locate-table/index-BiPxEQzb.js').write_bytes(data)
            data = patch(data.decode('utf-8')).encode('utf-8')
            (ROOT / 'design/locate-table-index.js').write_bytes(data)
            block = 4194304
            entry['integrity'] = {'algorithm': 'SHA256', 'hash': hashlib.sha256(data).hexdigest(),
                                  'blockSize': block, 'blocks': [hashlib.sha256(data[i:i + block]).hexdigest() for i in range(0, len(data), block)]}
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
    output = ROOT / 'resources/app.asar.locate-table.new'
    output.write_bytes(package)
    manifest = {'before': hashlib.sha256(original).hexdigest().upper(), 'after': hashlib.sha256(package).hexdigest().upper()}
    (ROOT / 'resources/locate-table-install.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    local = ROOT / 'codex-connect-app' / BUNDLE
    local.write_bytes(patch(local.read_text(encoding='utf-8')).encode('utf-8'))
    print(f'已生成 {output}，逐项校验 {len(entries)} 个归档文件；仅前端主文件内容改变。')


if __name__ == '__main__':
    build()
