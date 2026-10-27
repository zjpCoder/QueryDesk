## QueryDesk 0.3.12 · 2026-10-27

Windows x64 中文数据库工作台，支持 MySQL / Oracle、SQL 多标签编辑、表数据筛选与排序、结构设计、CSV / JSON 导出、AI SQL 副驾驶及 Codex MCP 接入。

### 下载

- `QueryDesk-0.3.12-20261027-x64-Setup.exe`：完整安装程序，约 125 MiB，内置 Electron、Java 和数据库驱动。
- `QueryDesk-source-0.3.12-20261027.zip`：与本次仓库提交对应的源码归档。
- `SHA256SUMS.txt`：安装包和源码归档的 SHA256。

普通安装不需要 Node.js、JDK 或 Oracle Instant Client。运行旧版时先完成事务和草稿处理，再退出旧程序并安装。

### 本次调整

- 去掉表浏览工具栏中“设为 NULL”“导出本页”“导出整表”。
- 筛选值输入框缩短为 180px。
- 筛选区增加排序字段及升降序切换，保留列头 / 筛选 / 翻页联动。
- 包含此前的主题、连接环境与只读设置、对象定位、补全、表头复制与提示、Codex 接入等改进。

### 源码说明

仓库包含原始 TypeScript / React / Java 工程、后续产物补丁和与本安装版一致的执行代码快照。后续修改尚未全部回移到原始 TypeScript 文件；当前发布路线为 `npm run build:release` / `npm run dist:release`，原始工程路线为 `npm run build`。前端快照是编译文件，构建边界已在文档中说明。

### 文档和验证

- [详细使用手册](https://github.com/zjpCoder/QueryDesk/blob/main/docs/USER_GUIDE.md)
- [MCP / Codex 配置](https://github.com/zjpCoder/QueryDesk/blob/main/docs/MCP.md)
- [开发与构建](https://github.com/zjpCoder/QueryDesk/blob/main/docs/DEVELOPMENT.md)
- [发布验证范围](https://github.com/zjpCoder/QueryDesk/blob/main/docs/VERIFICATION.md)

已通过原工程 59 项单元测试、TypeScript / Vite / Electron 构建、发布快照校验和隔离 UI 启动测试；安装包内 525 个运行文件经解压核验。源码归档和安装包不包含个人连接设置、API 密钥、数据库导出或运行日志。
