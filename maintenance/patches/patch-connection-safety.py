"""为已解包安装产物补充连接环境、只读策略与统一执行检查。"""
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[1]
app = root / 'codex-connect-app'
backup = root / 'design/before-connection-safety'


def patch(relative, changes):
    path = app / relative
    saved = backup / relative
    saved.parent.mkdir(parents=True, exist_ok=True)
    if not saved.exists():
        shutil.copy2(path, saved)
    source = saved.read_text(encoding='utf-8')
    for old, new in changes:
        assert source.count(old) == 1, (relative, old[:100], source.count(old))
        source = source.replace(old, new)
    path.write_bytes(source.encode('utf-8'))


patch('dist-electron/main.cjs', [
    ('  save() {\n    import_node_fs.default.mkdirSync', '  refresh() { this.data = new Store().data; }\n  save() {\n    import_node_fs.default.mkdirSync'),
    ('var profile = external_exports.object({ id, name,', 'var profile = external_exports.object({ id, name, environment: external_exports.enum(["unspecified", "development", "test", "production"]).default("unspecified"), readOnly: external_exports.boolean().default(false),'),
    ('async function handle(method, payload) {\n  const p = validate2(method, payload);', '''var connectionSafety = require("./safety.cjs")({ maskSql, splitSql, readOnlySql });
var pendingSafety = new Set();
async function handle(method, payload, interactive = false) {
  const p = validate2(method, payload);
  if (["settings.get", "connection.save", "connection.delete", "session.open", "session.reconnect", "query.run", "table.apply", "ddl.execute"].includes(method)) store.refresh?.();
  if (["query.run", "table.apply", "ddl.execute"].includes(method)) {
    const connectionId = sessions.get(p.sessionId);
    if (!connectionId) throw new Error("会话已断开，请重新连接");
    const profile = store.data.connections.find(c => c.id === connectionId);
    if (!profile) throw new Error("连接不存在");
    if (profile.readOnly) {
      if (method !== "query.run") throw new Error("此连接为只读连接，禁止数据及结构变更");
      connectionSafety.assertProfileReadOnly(p.sql, profile.dialect);
    } else {
      const risks = method === "query.run" ? connectionSafety.queryRisks(p.sql, profile.dialect, profile.environment === "production") : profile.environment === "production" ? ["将在生产环境" + (method === "table.apply" ? "保存表格数据变更" : "执行表结构变更")] : [];
      if (risks.length) {
        if (!interactive || !win || win.isDestroyed()) throw new Error("执行保护已阻止自动执行：" + risks.join("；") + "。请在 QueryDesk 界面检查并手动执行。");
        if (pendingSafety.has(p.sessionId)) throw new Error("此会话正在等待执行确认");
        pendingSafety.add(p.sessionId);
        try {
          const environment = { production: "生产", test: "测试", development: "开发", unspecified: "未标记" }[profile.environment] || "未标记";
          const preview = method === "query.run" ? p.sql : method === "table.apply" ? `${p.schema}.${p.table} · ${p.changes.length} 条变更` : `${p.after.schema}.${p.after.name}`;
          const result = await import_electron2.dialog.showMessageBox(win, { type: "warning", title: "执行保护", message: profile.environment === "production" ? "确认在生产环境执行？" : "确认执行高风险操作？", detail: `连接：${profile.name}\\n环境：${environment}\\n地址：${profile.host}:${profile.port}\\n\\n${risks.join("\\n")}\\n\\n${preview.slice(0, 3000)}${preview.length > 3000 ? "\\n…（预览已截断）" : ""}\\n\\n请检查目标与条件。已提交的数据及部分 DDL 无法通过回滚恢复。`, buttons: ["取消", "确认执行"], defaultId: 0, cancelId: 0, noLink: true });
          if (result.response !== 1) throw new Error("已取消执行，未发送本次操作");
          if (sessions.get(p.sessionId) !== connectionId) throw new Error("会话已变化，请重新检查后执行");
          store.refresh?.();
          const latest = store.data.connections.find(c => c.id === connectionId);
          if (!latest || latest.readOnly !== profile.readOnly || latest.environment !== profile.environment) throw new Error("连接保护设置已变化，请重新检查后执行");
        } finally { pendingSafety.delete(p.sessionId); }
      }
    }
  }'''),
    ('value: await handle(method, payload)', 'value: await handle(method, payload, true)'),
    ('if (args.autoCommit === false) await handle("session.transaction",', 'if (args.autoCommit === false && !info.readOnly) await handle("session.transaction",'),
    ('if (name === "connections.list") {\n    const settings = store.public();', 'if (name === "connections.list") {\n    store.refresh?.();\n    const settings = store.public();'),
    ('group, dialect, host, port, database, oracleMode, tls, hasPassword }) => ({ id, name: label, group, dialect, host, port, database, oracleMode, tls: !!tls, hasPassword: !!hasPassword', 'group, dialect, host, port, database, oracleMode, tls, hasPassword, environment = "unspecified", readOnly = false }) => ({ id, name: label, group, dialect, host, port, database, oracleMode, environment, readOnly, tls: !!tls, hasPassword: !!hasPassword'),
])

patch('dist-electron/worker.cjs', [
    ('var BATCH = 200;', 'var connectionSafety = require("./safety.cjs")({ maskSql, splitSql, readOnlySql });\nvar BATCH = 200;'),
    ('info: { version: "", schema: profile.database, autoCommit: true,', 'info: { readOnly: !!profile.readOnly, version: "", schema: profile.database, autoCommit: !profile.readOnly,'),
    ('if (s.info.readOnly) readOnlySql(sql, s.profile.dialect);', 'if (s.profile.readOnly) connectionSafety.assertProfileReadOnly(sql, s.profile.dialect);\n  else if (s.info.readOnly) readOnlySql(sql, s.profile.dialect);'),
    ('const readOnly = old?.info.readOnly || p.readOnly;', 'const readOnly = p.profile.readOnly || old?.info.readOnly || p.readOnly;'),
    ('if (p.readOnly) {', 'if (p.readOnly || p.profile.readOnly) {'),
    ('if (s.info.readOnly && action === "auto") throw new Error(', 'if (s.info.readOnly && action === "auto" && value === false) return { ...s.info };\n  if (s.info.readOnly && action === "auto") throw new Error('),
    ('"AI \\u67E5\\u8BE2\\u6807\\u7B7E\\u56FA\\u5B9A\\u4E3A\\u53EA\\u8BFB\\u4F1A\\u8BDD\\uFF1B\\u9700\\u8981\\u5199\\u5165\\u65F6\\u8BF7\\u65B0\\u5EFA SQL \\u6807\\u7B7E"', '"当前会话为只读，不能切换自动提交；连接只读设置需关闭全部标签后修改"'),
    ('"AI \\u4F1A\\u8BDD\\u7981\\u6B62\\u5199\\u5165\\uFF1B\\u8BF7\\u5728\\u72EC\\u7ACB SQL \\u8349\\u7A3F\\u4E2D\\u68C0\\u67E5\\u540E\\u6267\\u884C"', '"当前会话为只读，禁止数据及结构变更"'),
    ('async function browse(s, p) {\n', 'async function browse(s, p) {\n  if (s.info.readOnly) await beginReadOnly(s);\n'),
    ('editable: transactional && object?.kind', 'editable: !s.info.readOnly && transactional && object?.kind'),
    ('reason: !transactional ?', 'reason: s.info.readOnly ? "当前连接或会话为只读，不能编辑数据" : !transactional ?'),
])

environment_form = '''L.jsxs("div",{className:"form-pair",children:[L.jsx(Hn.Item,{name:"environment",label:"连接环境",children:L.jsx(Nr,{"aria-label":"连接环境",options:[{value:"unspecified",label:"未标记"},{value:"development",label:"开发"},{value:"test",label:"测试"},{value:"production",label:"生产"}]})}),L.jsx(Hn.Item,{name:"readOnly",label:"只读连接",valuePropName:"checked",extra:"禁止执行写入与结构变更；修改前请关闭此连接的全部标签。",children:L.jsx(jd,{"aria-label":"只读连接"})})]}),'''
badge = '''function connectionEnvironment(profile){const value=profile?.environment||"unspecified";return L.jsx("span",{className:`connection-environment env-${value}`,title:`连接环境：${{production:"生产",test:"测试",development:"开发",unspecified:"未标记"}[value]||"未标记"}`,children:{production:"生产",test:"测试",development:"开发",unspecified:"未标记"}[value]||"未标记"})}'''
patch('dist/assets/index-BiPxEQzb.js', [
    ('name:"",group:"我的连接",dialect:"mysql"', 'name:"",environment:"unspecified",readOnly:!1,group:"我的连接",dialect:"mysql"'),
    ('L.jsx(Hn.Item,{name:"name",label:"连接名称"', environment_form + 'L.jsx(Hn.Item,{name:"name",label:"连接名称"'),
    ('function ole({', badge + 'function ole({'),
    ('L.jsx("strong",{children:de.name}),L.jsxs("small",{children:[de.host,":",de.port]})', 'L.jsxs("strong",{children:[L.jsx("span",{className:"connection-name",children:de.name}),connectionEnvironment(de),de.readOnly&&L.jsx("span",{className:"connection-readonly",children:"只读"})]}),L.jsxs("small",{children:[de.host,":",de.port]})'),
    ('className:"connection-main",onClick:', 'className:"connection-main",title:de.name,onClick:'),
    ('L.jsx("span",{className:"tab-name",children:ne.title}),', 'L.jsx("span",{className:"tab-name",children:ne.title}),connectionEnvironment(e.connections.find(de=>de.id===ne.connectionId)),(ne.info.readOnly||e.connections.find(de=>de.id===ne.connectionId)?.readOnly)&&L.jsx("span",{className:"connection-readonly",children:"只读"}),'),
    ('className:"connection-strip",children:', 'className:`connection-strip ${He.environment==="production"?"production-strip":""}`,children:'),
    ('L.jsx("span",{children:He.name}),', 'L.jsx("span",{children:He.name}),connectionEnvironment(He),'),
    ('pe.info.readOnly&&L.jsx(Fi,{color:"cyan",children:"AI 只读会话"})', '(pe.info.readOnly||He.readOnly)&&L.jsx(Fi,{color:"cyan",children:He.readOnly?"只读连接":"AI 只读会话"})'),
    ('async function yt(ne,de){if(!(!pe||!He))try{', 'async function yt(ne,de){if(pe&&(pe.info.readOnly||He?.readOnly)){nn.info("当前会话为只读，不能修改表结构");return}if(!(!pe||!He))try{'),
    ('S([]),E([]);try{const ae=await window.querydesk.call("query.run"', 'S([]);try{const ae=await window.querydesk.call("query.run"'),
])

css = app / 'dist/assets/themes.css'
saved = backup / 'dist/assets/themes.css'
saved.parent.mkdir(parents=True, exist_ok=True)
if not saved.exists():
    shutil.copy2(css, saved)
css.write_bytes((saved.read_text(encoding='utf-8') + '''
/* 环境文字与颜色同时显示，三套主题保持可识别。 */
.connection-environment,.connection-readonly{display:inline-flex;align-items:center;flex-shrink:0;padding:1px 6px;border:1px solid;border-radius:4px;font-size:11px;line-height:18px;font-weight:600;white-space:nowrap}
.connection-environment.env-production{color:#b42318;background:#fef3f2;border-color:#fda29b}
.connection-environment.env-test{color:#92400e;background:#fffbeb;border-color:#fcd34d}
.connection-environment.env-development{color:#166534;background:#f0fdf4;border-color:#86efac}
.connection-environment.env-unspecified{color:#475467;background:#f2f4f7;border-color:#d0d5dd}
.connection-readonly{color:#155e75;background:#ecfeff;border-color:#67e8f9}
.connection-main strong{display:flex!important;align-items:center;gap:5px;min-width:0;flex-wrap:wrap}
.connection-main .connection-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.connection-main{position:relative}
.connection-main .connection-environment,.connection-main .connection-readonly{font-size:10px;line-height:15px;padding:0 4px}
@media(max-width:1300px){.connection-main .connection-name{flex-basis:100%;max-width:100%}}
.connection-main>span:nth-child(2){min-width:0;flex:1}
.connection-strip.production-strip{box-shadow:inset 4px 0 #d92d20;background-image:linear-gradient(90deg,rgba(217,45,32,.09),transparent)}
[data-theme="dark"] .env-production,[data-theme="champagne"] .env-production{color:#fda29b;background:#3b2020;border-color:#8e3e37}
[data-theme="dark"] .env-test,[data-theme="champagne"] .env-test{color:#fcd34d;background:#352c19;border-color:#80612d}
[data-theme="dark"] .env-development,[data-theme="champagne"] .env-development{color:#86efac;background:#193126;border-color:#356b49}
[data-theme="dark"] .env-unspecified,[data-theme="champagne"] .env-unspecified{color:#d0d5dd;background:#282c34;border-color:#515967}
[data-theme="dark"] .connection-readonly,[data-theme="champagne"] .connection-readonly{color:#67e8f9;background:#17303a;border-color:#386576}
''').encode('utf-8'))
print('已补充连接环境标识、只读连接和统一执行保护。')
