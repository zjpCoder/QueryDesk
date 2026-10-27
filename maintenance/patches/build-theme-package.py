"""只替换指定文件，保留安装包内其他文件、原生依赖和 unpacked 标志。"""
import hashlib
import json
import struct
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = root / 'resources/app.asar'
output = Path(sys.argv[1]).resolve()
assert output != source.resolve(), '先生成待验证包，禁止直接覆盖安装包'
original = source.read_bytes()
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
            entries.append((current, entry, original[base + int(entry['offset']):base + int(entry['offset']) + entry['size']]))


walk(header)
entries.sort(key=lambda item: int(item[1]['offset']))
replacements = [
    'dist/index.html', 'dist/assets/index-BiPxEQzb.js',
    'dist/assets/GridCore-BHNl3zCJ.js', 'dist/assets/EditorCore-DPy74pA7.js',
    'dist-electron/main.cjs', 'dist-electron/worker.cjs', 'dist-electron/safety.cjs',
    'dist/assets/themes.css', 'dist/assets/ai-bot.png',
]
existing = {name for name, _, _ in entries}
for name in replacements:
    if name not in existing:
        tree = header
        *dirs, filename = name.split('/')
        for dirname in dirs:
            tree = tree['files'][dirname]
        entry = {'size': 0, 'offset': '0'}
        tree['files'][filename] = entry
        entries.append((name, entry, b''))
payload = bytearray()
expected = {}
for name, entry, old_data in entries:
    data = (root / 'codex-connect-app' / name).read_bytes() if name in replacements else old_data
    expected[name] = data
    entry['offset'] = str(len(payload))
    entry['size'] = len(data)
    if name in replacements:
        block = 4194304
        entry['integrity'] = {
            'algorithm': 'SHA256', 'hash': hashlib.sha256(data).hexdigest(), 'blockSize': block,
            'blocks': [hashlib.sha256(data[i:i + block]).hexdigest() for i in range(0, len(data), block)],
        }
    payload.extend(data)
raw = json.dumps(header, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
padded = (4 + len(raw) + 3) // 4 * 4
pickle = struct.pack('<II', padded, len(raw)) + raw + b'\0' * (padded - 4 - len(raw))
package = struct.pack('<II', 4, len(pickle)) + pickle + payload
new_base = 8 + len(pickle)
for name, entry, _ in entries:
    start = new_base + int(entry['offset'])
    assert package[start:start + entry['size']] == expected[name], name
output.parent.mkdir(parents=True, exist_ok=True)
output.write_bytes(package)
print(f'已生成 {output}；逐项核对 {len(entries)} 个归档文件。')
