"""为安装版产物加入三套主题；每次替换都核对原文，避免误改压缩代码。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'codex-connect-app'


def patch(relative, replacements):
    p = ROOT / relative
    source = p.read_text(encoding='utf-8')
    for old, new in replacements:
        count = source.count(old)
        assert count == 1, (relative, old[:100], count)
        source = source.replace(old, new)
    p.write_bytes(source.encode('utf-8'))


patch('dist-electron/main.cjs', [
    ('theme: external_exports.enum(["dark", "light"])', 'theme: external_exports.enum(["dark", "light", "studio", "champagne"])'),
])

theme_menu = '''L.jsx(tl,{trigger:["click"],menu:{selectable:!0,selectedKeys:[e.theme==="dark"?"light":e.theme],items:[{key:"light",label:L.jsxs("span",{className:"theme-choice",children:[L.jsx("span",{className:"theme-swatch classic"}),L.jsxs("span",{children:[L.jsx("strong",{children:"经典紫"}),L.jsx("small",{children:"现有界面"})]})]})},{key:"studio",label:L.jsxs("span",{className:"theme-choice",children:[L.jsx("span",{className:"theme-swatch studio"}),L.jsxs("span",{children:[L.jsx("strong",{children:"清透紫"}),L.jsx("small",{children:"浅色工作台 · AI 新布局"})]})]})},{key:"champagne",label:L.jsxs("span",{className:"theme-choice",children:[L.jsx("span",{className:"theme-swatch champagne"}),L.jsxs("span",{children:[L.jsx("strong",{children:"香槟金"}),L.jsx("small",{children:"石墨黑 · 金属香槟色"})]})]})}],onClick:({key:theme})=>{window.querydesk.call("settings.theme",{theme}).then(t).catch(error=>nn.error(error.message||"主题切换失败"))}},children:L.jsxs(Rt,{"aria-label":"选择主题",className:"theme-picker",type:"text",children:[L.jsx(SJ,{}),L.jsx("span",{children:e.theme==="champagne"?"香槟金":e.theme==="studio"?"清透紫":"经典紫"})]})})'''

old_menu = '''L.jsx(gr,{title:Ae?"切换浅色主题":"切换深色主题",children:L.jsx(Rt,{"aria-label":"切换主题",type:"text",icon:L.jsx(SJ,{}),onClick:()=>{window.querydesk.call("settings.theme",{theme:Ae?"light":"dark"}).then(t)}})})'''

patch('dist/assets/index-BiPxEQzb.js', [
    ('Ae=e?.theme!=="light"', 'Ae=e?.theme!=="light"&&e?.theme!=="studio"'),
    ('d.useEffect(()=>{document.documentElement.dataset.theme=Ae?"dark":"light"},[Ae])', 'd.useLayoutEffect(()=>{const theme=e?.theme??"dark";document.documentElement.dataset.theme=theme==="studio"?"light":theme;document.documentElement.dataset.appearance=theme==="studio"||theme==="champagne"?"polished":"classic";document.documentElement.dataset.variant=theme;document.dispatchEvent(new Event("querydesk:theme"))},[e?.theme])'),
    (old_menu, theme_menu),
    ('colorPrimary:"#8982f8",colorBgBase:Ae?"#141820":"#ffffff",colorBorder:Ae?"#303641":"#dfe4ed",borderRadius:6,fontFamily:"\'Segoe UI\', \'Microsoft YaHei\', sans-serif",fontSize:12,controlHeight:30', 'colorPrimary:e.theme==="champagne"?"#bbaa87":e.theme==="studio"?"#7468e8":"#8982f8",colorBgBase:e.theme==="champagne"?"#15181c":Ae?"#141820":"#ffffff",colorText:e.theme==="champagne"?"#e8e6e1":void 0,colorBorder:e.theme==="champagne"?"#35393f":Ae?"#303641":"#dfe4ed",borderRadius:6,fontFamily:"\'Segoe UI\', \'Microsoft YaHei\', sans-serif",fontSize:e.theme==="studio"||e.theme==="champagne"?13:12,controlHeight:e.theme==="studio"||e.theme==="champagne"?34:30'),
    ('contentBg:Ae?"#1a1f29":"#fff"', 'contentBg:e.theme==="champagne"?"#1b1f24":Ae?"#1a1f29":"#fff"'),
    ('nodeHoverBg:Ae?"#222835":"#eff1f8",nodeSelectedBg:Ae?"#2a2943":"#e8e5ff"', 'nodeHoverBg:e.theme==="champagne"?"#20242a":Ae?"#222835":"#eff1f8",nodeSelectedBg:e.theme==="champagne"?"#302d27":Ae?"#2a2943":"#e8e5ff"'),
    ('className:"ai-orbit",children:L.jsx(bc,{})', 'className:"ai-orbit",children:[L.jsx(bc,{}),L.jsx("img",{className:"ai-bot",src:new URL("ai-bot.png",import.meta.url).href,alt:"",width:72,height:72})]'),
    ('L.jsx("div",{className:"ai-orbit",children:[', 'L.jsxs("div",{className:"ai-orbit",children:['),
    ('L.jsx("h3",{children:"说出需求，直接完成。"})', 'L.jsxs("h3",{children:[L.jsx("span",{className:"classic-copy",children:"说出需求，直接完成。"}),L.jsx("span",{className:"polished-copy",children:"你好，我是 QueryDesk AI"})]})'),
    ('L.jsx("p",{children:"查找表、执行查询、打开结果，或直接导出文件。"})', 'L.jsxs("p",{children:[L.jsx("span",{className:"classic-copy",children:"查找表、执行查询、打开结果，或直接导出文件。"}),L.jsx("span",{className:"polished-copy",children:"我可以帮你编写 SQL、解释查询结果，生成查询思路或优化 SQL。"})]})'),
    ('["查询商户表","导出当前表为 CSV","解释这段 SQL 的执行逻辑"].map((ae,ie)=>L.jsxs("button",{onClick:()=>{R(ae),N(ie===2?"explain":"operate")},children:[ae,L.jsx("span",{children:"↗"})]},ae))', '[{classic:"查询商户表",text:"查询商户表的核心字段",mode:"operate",icon:cg},{classic:"导出当前表为 CSV",text:"按状态统计商户数量",mode:"operate",icon:bc},{classic:"解释这段 SQL 的执行逻辑",text:"生成导出 CSV 的 SQL",mode:"generate",icon:bb}].map((ae,ie)=>L.jsxs("button",{onClick:()=>{const polished=document.documentElement.dataset.appearance==="polished";R(polished?ae.text:ae.classic),N(polished?ae.mode:ie===2?"explain":"operate"),requestAnimationFrame(()=>document.querySelector(".ai-compose textarea")?.focus())},children:[L.jsx("span",{className:"suggestion-icon polished-copy","aria-hidden":!0,children:L.jsx(ae.icon,{})}),L.jsx("span",{className:"classic-copy",children:ae.classic}),L.jsx("span",{className:"suggestion-label polished-copy",children:ae.text}),L.jsx("span",{className:"suggestion-arrow","aria-hidden":!0,children:L.jsx(Q4,{})})]},ae.classic))'),
    ('L.jsx(Rt,{"aria-label":"AI 模型设置",type:"text",size:"small",icon:L.jsx(Z4,{}),onClick:g})', 'L.jsxs("div",{className:"ai-heading-actions",children:[L.jsx(Rt,{className:"ai-model-chip polished-copy",type:"text",size:"small",title:f.model||"配置 AI 模型",onClick:g,children:f.model||"配置模型"}),L.jsx(Rt,{"aria-label":"AI 模型设置",type:"text",size:"small",icon:L.jsx(Z4,{}),onClick:g})]})'),
    ('L.jsx(Nr,{mode:"multiple","aria-label":"AI 结构上下文"', 'L.jsx("label",{className:"context-label polished-copy",htmlFor:"ai-context-structures",children:"选择上下文"}),L.jsx(Nr,{id:"ai-context-structures",mode:"multiple","aria-label":"AI 结构上下文"'),
])

patch('dist/index.html', [
    ('</head>', '  <link rel="stylesheet" href="./assets/themes.css">\n</head>'),
])

editor = ROOT / 'dist/assets/EditorCore-DPy74pA7.js'
source = editor.read_text(encoding='utf-8')
assert source.count('theme:t?"vs-dark":"light"') == 2
source = source.replace('theme:t?"vs-dark":"light"', 'theme:queryDeskTheme==="champagne"?"querydesk-champagne":queryDeskTheme==="dark"?"vs-dark":"light"')
source = source.replace('height:h="100%"}){const u=', 'height:h="100%"}){const queryDeskTheme=useQueryDeskEditorTheme();const u=')
source = source.replace('function NBe({before:o,after:e,dark:t}){const i=', 'function NBe({before:o,after:e,dark:t}){const queryDeskTheme=useQueryDeskEditorTheme();const i=')
source += '''\n// 全部编辑器共用已有 Monaco 主题机制，切换时不重建模型或丢失光标。
FI.defineTheme("querydesk-champagne",{base:"vs-dark",inherit:true,rules:[{token:"keyword",foreground:"C7B998"},{token:"number",foreground:"83B8A6"},{token:"string",foreground:"C6B491"},{token:"comment",foreground:"838992"},{token:"delimiter",foreground:"A8ADB4"},{token:"operator",foreground:"B6BBC2"}],colors:{"editor.background":"#111418","editor.foreground":"#E8E6E1","editorLineNumber.foreground":"#858C96","editorLineNumber.activeForeground":"#C7B998","editorCursor.foreground":"#D4C39D","editor.selectionBackground":"#484137","editor.inactiveSelectionBackground":"#302D28","editor.lineHighlightBackground":"#1B1F24","editorGutter.background":"#111418","editorIndentGuide.background1":"#292E34","editorWidget.background":"#1B1F24","editorWidget.border":"#3A3D42","editorSuggestWidget.background":"#1B1F24","editorSuggestWidget.foreground":"#E8E6E1","editorSuggestWidget.selectedBackground":"#39352D","editorHoverWidget.background":"#1B1F24","editorHoverWidget.border":"#3A3D42","editor.findMatchBackground":"#716345","editor.findMatchHighlightBackground":"#39352D"}});
function useQueryDeskEditorTheme(){const read=()=>document.documentElement.dataset.variant||"dark";const [theme,setTheme]=yt.useState(read);yt.useLayoutEffect(()=>{const changed=()=>setTheme(read());document.addEventListener("querydesk:theme",changed);changed();return()=>document.removeEventListener("querydesk:theme",changed)},[]);return theme;}
'''
source = source.replace('fontSize:14,fontFamily:', 'fontSize:queryDeskTheme==="studio"||queryDeskTheme==="champagne"?16:14,fontFamily:')
editor.write_bytes(source.encode('utf-8'))

patch('dist/assets/GridCore-BHNl3zCJ.js', [
    ('const l=(t?Un.withPart(nS):Un).withParams({fontFamily:', 'const [themeName,setThemeName]=m.useState(document.documentElement.dataset.variant);m.useEffect(()=>{const changed=()=>setThemeName(document.documentElement.dataset.variant);document.addEventListener("querydesk:theme",changed);changed();return()=>document.removeEventListener("querydesk:theme",changed)},[]);const gold=themeName==="champagne",polished=gold||themeName==="studio";const l=(t?Un.withPart(nS):Un).withParams({fontFamily:'),
    ('fontSize:12,headerFontSize:11,rowHeight:34,headerHeight:36,borderColor:t?"#2a303c":"#e3e7ee",backgroundColor:t?"#141820":"#ffffff",foregroundColor:t?"#d9dee7":"#25304a",headerBackgroundColor:t?"#1b202a":"#f4f6fa",accentColor:"#8b86fc",selectedRowBackgroundColor:t?"#30304c":"#edecff"', 'fontSize:polished?14:12,headerFontSize:polished?13:11,rowHeight:polished?40:34,headerHeight:polished?42:36,borderColor:gold?"#2b3036":t?"#2a303c":"#e3e7ee",backgroundColor:gold?"#111418":t?"#141820":"#ffffff",foregroundColor:gold?"#e8e6e1":t?"#d9dee7":"#25304a",headerBackgroundColor:gold?"#1d2228":t?"#1b202a":"#f4f6fa",accentColor:gold?"#bbaa87":"#8b86fc",selectedRowBackgroundColor:gold?"#353128":t?"#30304c":"#edecff"'),
])
print('已加入三主题选择、持久化、AI 新布局及编辑器/表格配色。')

patch('dist-electron/main.cjs', [
    ('store.data.theme = p.theme;\n      store.save();', 'store.data.theme = p.theme;\n      store.save();\n      applyWindowTheme(p.theme);'),
    ('import_electron2.app.whenReady().then(() => {', 'function applyWindowTheme(theme) {\n  const dark = theme === "dark" || theme === "champagne";\n  import_electron2.nativeTheme.themeSource = dark ? "dark" : "light";\n  win?.setBackgroundColor(theme === "champagne" ? "#111418" : dark ? "#11151c" : "#ffffff");\n}\nimport_electron2.app.whenReady().then(() => {'),
    ('  import_electron2.ipcMain.handle("querydesk:call",', '  applyWindowTheme(store.data.theme);\n  import_electron2.ipcMain.handle("querydesk:call",'),
])
