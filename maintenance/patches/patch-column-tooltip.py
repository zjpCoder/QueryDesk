"""以当前安装包为基准补充字段悬浮元数据，逐项校验归档，生成待验证安装包。"""
import hashlib
import json
import struct
import os
import shutil
import subprocess
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'design/column-tooltip-app'
GRID = 'dist/assets/GridCore-BHNl3zCJ.js'
INDEX = 'dist/assets/index-BiPxEQzb.js'
WORKER = 'dist-electron/worker.cjs'


def replace(source, old, new):
    assert source.count(old) == 1, (old[:100], source.count(old))
    return source.replace(old, new)


def patch(name, data):
    if name not in [GRID, INDEX, WORKER]:
        return data
    source = data.decode('utf-8')
    if name == GRID:
        source = replace(source, 'title:status?`${status}：${name}`:`点击复制字段名：${name}`',
                         'title:[props.column.getColDef().headerTooltip||`字段：${name}\\n注释：未获取\\n类型：未知`,status?`${status}：${name}`:"点击复制字段名"].join("\\n")')
        source = replace(source, 'animateRows:!1,enableCellTextSelection:!0,', 'animateRows:!1,enableBrowserTooltips:!0,enableCellTextSelection:!0,')
    elif name == INDEX:
        source = replace(source, 'function jn(e,t,n=!1,r=!1,a=!1)',
                         'function columnHeaderTooltip(name,meta){return `字段：${name}\\n注释：${meta?.comment||(meta?.commentKnown===false||!meta?"未获取":"无注释")}\\n类型：${meta?.type||"未知"}`}'
                         'function jn(e,t,n=!1,r=!1,a=!1)')
        source = replace(source, 'te.columns.map(J=>({field:J,headerName:J,tooltipField:J}))',
                         'te.columns.map((J,Z)=>({field:J,headerName:J,headerTooltip:columnHeaderTooltip(J,te.columnMetadata?.[Z]),tooltipField:J}))')
        source = replace(source, 'headerTooltip:`${X.type}${X.primary?" · 主键":""} ${X.comment}`',
                         'headerTooltip:columnHeaderTooltip(X.name,X)+(X.primary?"\\n主键":"")')
    elif name == WORKER:
        source = replace(source, 'var BATCH = 200;', 'var { metadata: queryColumnMetadata } = require("./column-metadata.cjs")({ raw, oracleType, mysqlTypes: import_promise.default.Types });\nvar BATCH = 200;')
        source = replace(source, 'names: uniqueNames((fields ?? []).map((f) => f.name)), rows:', 'names: uniqueNames((fields ?? []).map((f) => f.name)), fields: fields ?? [], rows:')
        source = replace(source, 'return [...groups.values()].map((group) => {', 'const results = [];\n  for (const group of groups.values()) {')
        source = replace(source, 'columns: group.names, rows, affected: group.affected,', 'columns: group.names, columnMetadata: await queryColumnMetadata(s, sourceSql, group.names, group.fields), rows, affected: group.affected,')
        source = replace(source, '    return result;\n  });\n}\nasync function query(', '    results.push(result);\n  }\n  return results;\n}\nasync function query(')
        source = replace(source, 'columns: names, rows, affected: r.rowsAffected', 'columns: names, columnMetadata: await queryColumnMetadata(s, text, names, rs.metaData), rows, affected: r.rowsAffected')
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
    extra = 'dist-electron/column-metadata.cjs'
    assert extra not in {name for name, _, _ in entries}
    entry = {'offset': '0', 'size': 0}
    header['files']['dist-electron']['files']['column-metadata.cjs'] = entry
    entries.append((extra, entry, (ROOT / 'tools/column-metadata.cjs').read_bytes()))
    expected, payload, changed = {}, bytearray(), []
    for name, entry, old in entries:
        data = patch(name, old)
        if data != old or name == extra:
            changed.append(name)
            block = 4194304
            entry['integrity'] = {'algorithm': 'SHA256', 'hash': hashlib.sha256(data).hexdigest(), 'blockSize': block,
                                  'blocks': [hashlib.sha256(data[i:i + block]).hexdigest() for i in range(0, len(data), block)]}
        entry.update(offset=str(len(payload)), size=len(data))
        expected[name] = data
        payload.extend(data)
        local = WORK / name
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_bytes(data)
    raw = json.dumps(header, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    padded = (4 + len(raw) + 3) // 4 * 4
    pickle = struct.pack('<II', padded, len(raw)) + raw + b'\0' * (padded - 4 - len(raw))
    package = struct.pack('<II', 4, len(pickle)) + pickle + payload
    for name, entry, _ in entries:
        start = 8 + len(pickle) + int(entry['offset'])
        assert package[start:start + entry['size']] == expected[name], name
    (ROOT / 'resources/app.asar.column-tooltip.new').write_bytes(package)
    manifest = {'before': hashlib.sha256(original).hexdigest().upper(), 'after': hashlib.sha256(package).hexdigest().upper()}
    classes = ROOT / 'design/column-tooltip-classes'
    javac = os.environ.get('QUERYDESK_JAVAC') or shutil.which('javac')
    assert javac, '需要 JDK 编译 JDBC 字段类型补丁；可设置 QUERYDESK_JAVAC'
    subprocess.run([javac, '--release', '17', '-d', str(classes), str(ROOT / 'tools/QueryDeskBridge$Cursor.java')], check=True)
    jar = ROOT / 'resources/runtime/jdbc/querydesk-bridge.jar'
    pending_jar = jar.with_suffix('.column-tooltip.new.jar')
    target = 'QueryDeskBridge$Cursor.class'
    with ZipFile(jar) as before, ZipFile(pending_jar, 'w') as after:
        assert target in before.namelist()
        for entry in before.infolist():
            after.writestr(entry, (classes / target).read_bytes() if entry.filename == target else before.read(entry.filename))
    with ZipFile(jar) as before, ZipFile(pending_jar) as after:
        assert before.namelist() == after.namelist()
        assert [name for name in before.namelist() if before.read(name) != after.read(name)] == [target]
    manifest.update(jdbcBefore=hashlib.sha256(jar.read_bytes()).hexdigest().upper(), jdbcAfter=hashlib.sha256(pending_jar.read_bytes()).hexdigest().upper())
    (ROOT / 'resources/column-tooltip-install.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(f'已逐项核对 {len(entries)} 个归档文件；修改：{changed}')


if __name__ == '__main__':
    build()
