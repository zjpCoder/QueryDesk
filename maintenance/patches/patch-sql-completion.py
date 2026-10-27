"""基于当前安装包修复 SQL 标识符补全，仅替换匹配与编辑器适配代码。"""
import hashlib
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = 'dist/assets/index-BiPxEQzb.js'
EDITOR = 'dist/assets/EditorCore-DPy74pA7.js'


def replace(source, old, new):
    assert source.count(old) == 1, (old[:100], source.count(old))
    return source.replace(old, new)


def patch(name, data):
    if name not in (INDEX, EDITOR):
        return data
    source = data.decode('utf-8')
    if name == INDEX:
        helper = '''function sqlCompletionMatch(label,prefix,fuzzy){
const name=label.toUpperCase(),query=prefix.toUpperCase();
if(name.startsWith(query))return 0;
if(!fuzzy)return -1;
if(name.includes(query))return 1;
let offset=0;
for(const letter of query){offset=name.indexOf(letter,offset);if(offset<0)return -1;offset++;}
return 2;
}
'''
        source = replace(source, 'function ble(e,t,n,r,a,l=""){', helper+'function ble(e,t,n,r,a,l=""){')
        source = replace(source,
                         'g.toUpperCase().startsWith(s.prefix.toUpperCase())&&c.push({label:g,insertText:v,kind:p,detail:b,priority:S})',
                         'const match=sqlCompletionMatch(g,s.prefix,["table","field","function"].includes(p));if(match>=0)c.push({label:g,insertText:v,kind:p,detail:b,priority:S,match})')
        source = replace(source, 'g.priority-v.priority||g.label.localeCompare(v.label)',
                         'g.priority-v.priority||g.match-v.match||g.label.localeCompare(v.label)')
    else:
        # 候选已由共享匹配函数筛选；让 Monaco 接受命中，并在继续输入时重新计算。
        source = replace(source, 'return{suggestions:dne(I,D,a,s,O,l).map',
                         'return{incomplete:!0,suggestions:dne(I,D,a,s,O,l).map')
        source = replace(source, 'filterText:Z.label,', 'filterText:P.prefix?P.prefix+" "+Z.label:Z.label,')
        source = replace(source, 'suggest:{matchOnWordStartOnly:!0}', 'suggest:{matchOnWordStartOnly:!1}')
    return source.encode('utf-8')


def build():
    original = (ROOT / 'resources/app.asar').read_bytes()
    _, header_size, _, json_size = struct.unpack('<4I', original[:16])
    header = json.loads(original[16:16+json_size])
    entries = []

    def walk(tree, prefix=''):
        for name, entry in tree['files'].items():
            current = f'{prefix}/{name}' if prefix else name
            if 'files' in entry:
                walk(entry, current)
            elif 'offset' in entry:
                start = 8+header_size+int(entry['offset'])
                entries.append((current, entry, original[start:start+entry['size']]))

    walk(header)
    entries.sort(key=lambda item: int(item[1]['offset']))
    payload, expected, changed = bytearray(), {}, []
    for name, entry, old in entries:
        data = patch(name, old)
        if data != old:
            changed.append(name)
            block = 4194304
            entry['integrity'] = {'algorithm': 'SHA256', 'hash': hashlib.sha256(data).hexdigest(), 'blockSize': block,
                                  'blocks': [hashlib.sha256(data[i:i+block]).hexdigest() for i in range(0, len(data), block)]}
            local = ROOT / 'design/autocomplete-patched' / name
            local.parent.mkdir(parents=True, exist_ok=True)
            local.write_bytes(data)
        expected[name] = data
        entry.update(offset=str(len(payload)), size=len(data))
        payload.extend(data)
    assert set(changed) == {INDEX, EDITOR}, changed
    raw = json.dumps(header, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    padded = (4+len(raw)+3)//4*4
    pickle = struct.pack('<II', padded, len(raw))+raw+b'\0'*(padded-4-len(raw))
    package = struct.pack('<II', 4, len(pickle))+pickle+payload
    for name, entry, _ in entries:
        start = 8+len(pickle)+int(entry['offset'])
        assert package[start:start+entry['size']] == expected[name], name
    (ROOT / 'resources/app.asar.sql-completion.new').write_bytes(package)
    manifest = {'before': hashlib.sha256(original).hexdigest().upper(), 'after': hashlib.sha256(package).hexdigest().upper()}
    (ROOT / 'resources/sql-completion-install.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(f'已逐项核对 {len(entries)} 个归档文件；修改：{changed}')


if __name__ == '__main__':
    build()
