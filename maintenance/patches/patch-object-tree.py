"""使用现有 Ant Tree 的虚拟列表，避免展开时挂载数百个节点。"""
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'codex-connect-app/dist/assets'
bundle = root / 'index-BiPxEQzb.js'
source = bundle.read_text(encoding='utf-8')
changes = [
    ('[ke,Ie]=d.useState(!1),[Me,Xe]=d.useState("")', '[ke,Ie]=d.useState(!1),[objectTreeHeight,setObjectTreeHeight]=d.useState(300),[Me,Xe]=d.useState("")'),
    ('async function ut(){try{t(await window.querydesk.call("settings.get"))}', 'd.useLayoutEffect(()=>{const element=document.querySelector(".object-tree");if(!element)return;const resize=()=>{const style=getComputedStyle(element);setObjectTreeHeight(Math.max(100,Math.floor(element.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom))))};resize();const observer=new ResizeObserver(resize);observer.observe(element);return()=>observer.disconnect()},[!!pe,e?.theme]);async function ut(){try{t(await window.querydesk.call("settings.get"))}'),
    ('className:"object-tree",onKeyDownCapture:', 'className:"object-tree object-tree-virtual",onKeyDownCapture:'),
    ('showIcon:!0,blockNode:!0,treeData:_t,loadedKeys:', 'showIcon:!0,blockNode:!0,height:objectTreeHeight,virtual:!0,itemHeight:e.theme==="studio"||e.theme==="champagne"?33:28,treeData:_t,loadedKeys:'),
]
for old, new in changes:
    assert source.count(old) == 1, (old, source.count(old))
    source = source.replace(old, new)
bundle.write_bytes(source.encode('utf-8'))
css = root / 'themes.css'
source = css.read_text(encoding='utf-8')
source += '\n/* 由树组件内部滚动，外层仅提供真实可用高度。 */\n.object-tree.object-tree-virtual{overflow:hidden}\n'
css.write_bytes(source.encode('utf-8'))
print('已启用对象树虚拟列表与可用高度测量。')
