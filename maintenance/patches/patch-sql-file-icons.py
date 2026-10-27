"""仅将 SQL 文件操作改为带悬浮名称的图标按钮，保留归档其余内容。"""
from pathlib import Path
import hashlib
import json
import struct

root = Path(__file__).resolve().parents[1]
installed = root / 'resources/app.asar'
output = root / 'resources/app.asar.sql-file-icons.new'
original = installed.read_bytes()
_, header_size, _, json_size = struct.unpack('<4I', original[:16])
header = json.loads(original[16:16 + json_size])
base = 8 + header_size
target = 'dist/assets/index-BiPxEQzb.js'


def patch(source):
    for label, icon, disabled, action in [
        ('打开 SQL', 'EY', '!e.connections.length||ee', 'bt()'),
        ('保存 SQL', 'ree', 'pe?.kind!=="sql"||ee', 'tt()'),
        ('另存为', '$Z', 'pe?.kind!=="sql"||ee', 'tt(!0)'),
    ]:
        old = f'L.jsx(Rt,{{size:"small",disabled:{disabled},onClick:()=>{{{action}}},children:"{label}"}})'
        new = f'L.jsx(gr,{{title:"{label}",children:L.jsx("span",{{children:L.jsx(Rt,{{"aria-label":"{label}",type:"text",size:"small",style:{{width:30,height:30,padding:0}},icon:L.jsx({icon},{{}}),disabled:{disabled},onClick:()=>{{{action}}}}})}})}})'
        assert source.count(old) == 1, (label, source.count(old))
        source = source.replace(old, new)
    return source


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
changes = []
for name, entry, old in entries:
    data = patch(old.decode('utf-8')).encode('utf-8') if name == target else old
    if data != old:
        changes.append(name)
        block = 4194304
        entry['integrity'] = {
            'algorithm': 'SHA256', 'hash': hashlib.sha256(data).hexdigest(), 'blockSize': block,
            'blocks': [hashlib.sha256(data[i:i + block]).hexdigest() for i in range(0, len(data), block)],
        }
        (root / 'design/sql-file-icons-index.js').write_bytes(data)
    entry['offset'] = str(len(payload))
    entry['size'] = len(data)
    payload.extend(data)
assert changes == [target], changes
raw = json.dumps(header, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
padded = (4 + len(raw) + 3) // 4 * 4
pickle = struct.pack('<II', padded, len(raw)) + raw + b'\0' * (padded - 4 - len(raw))
output.write_bytes(struct.pack('<II', 4, len(pickle)) + pickle + payload)
local = root / 'codex-connect-app' / target
source = local.read_text(encoding='utf-8')
if '"aria-label":"打开 SQL",type:"text"' not in source:
    local.write_bytes(patch(source).encode('utf-8'))
manifest = {'before': hashlib.sha256(original).hexdigest(), 'after': hashlib.sha256(output.read_bytes()).hexdigest()}
(root / 'resources/sql-file-icons-install.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print('仅修改三个 SQL 文件按钮；其余归档文件保留。待安装包：', output)
