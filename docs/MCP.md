# 将 QueryDesk 接入 Codex / MCP 客户端

本文针对当前 Windows 安装版。MCP 复用 QueryDesk 保存的连接及数据库实现；不需要把数据库密码写入 MCP 配置。

## 一键连接 Codex

1. 安装并至少启动一次本机 Codex。
2. 打开 QueryDesk，点击顶部“连接至 Codex”。
3. 程序查找本机 Codex，备份已有配置，通过 Codex CLI 添加名为 `querydesk` 的 stdio MCP 服务。
4. 看到成功提示后，重新启动 Codex，加载新配置。
5. 让 Codex 列出 QueryDesk 已保存连接，确认工具可用。

重复点击相同配置不会重复添加。配置沿用 `CODEX_HOME`，未指定时使用用户目录中的 `.codex`；不会把数据库密码复制到 Codex 的 TOML 文件。

## 手动配置 Codex

在 Codex 的配置文件中添加以下内容，将两处路径改成自己的实际安装路径：

```toml
[mcp_servers.querydesk]
command = 'C:\Tools\QueryDesk\QueryDesk.exe'
args = ['C:\Tools\QueryDesk\querydesk-mcp.cjs']
startup_timeout_sec = 30

[mcp_servers.querydesk.env]
ELECTRON_RUN_AS_NODE = "1"
```

两份文件必须来自同一套安装目录。`ELECTRON_RUN_AS_NODE=1` 让 Electron 可执行文件以 Node 模式承载 stdio 桥接；不要把同一环境变量全局添加到普通桌面启动环境。

也可以让支持命令式配置的本机 Codex 执行：

```powershell
codex mcp add querydesk --env ELECTRON_RUN_AS_NODE=1 -- 'C:\Tools\QueryDesk\QueryDesk.exe' 'C:\Tools\QueryDesk\querydesk-mcp.cjs'
codex mcp get querydesk --json
```

上述命令只是配置示例，需要本机可找到 `codex` 命令。不同客户端如何加载 MCP 配置，以对应客户端的设置界面为准。

## 其他 MCP 客户端

支持 stdio 和环境变量的客户端可以使用同样的可执行文件、参数及环境变量。例如：

```json
{
  "mcpServers": {
    "querydesk": {
      "command": "C:\\Tools\\QueryDesk\\QueryDesk.exe",
      "args": ["C:\\Tools\\QueryDesk\\querydesk-mcp.cjs"],
      "env": {
        "ELECTRON_RUN_AS_NODE": "1"
      }
    }
  }
}
```

安装目录也提供相对定位程序文件的 `querydesk-mcp.cmd`，可在支持 `.cmd` 启动项的 Windows 客户端中使用。客户端若区分应用窗口与后台服务，应选择后台 stdio 服务。

## 提供哪些工具

客户端可能把工具名称中的 `.` 映射为 `_`，以实际工具列表为准。

| 工具 | 用途 |
| --- | --- |
| `connections.list` | 列出保存的连接元数据，不返回密码 |
| `database.connect` | 使用保存的连接建立 MCP 会话 |
| `database.disconnect` | 关闭 MCP 会话 |
| `database.schemas` | 获取可访问的 Schema |
| `database.objects` | 列出 Schema 中的对象 |
| `database.describe_table` | 查看字段、主键、索引、外键和注释 |
| `database.object_source` | 读取表 / 程序对象定义 |
| `database.execute` | 执行单条 SQL，支持命名参数 |
| `database.fetch` | 继续读取查询分页 |
| `database.browse_table` | 按页浏览，可指定筛选和排序 |
| `database.transaction` | 切换提交模式、提交或回滚 |
| `database.apply_changes` | 对符合条件的表写入新增 / 修改 / 删除 |
| `database.ddl_preview` | 根据结构定义生成 DDL 预览 |
| `database.ddl_execute` | 核对结构指纹后执行 DDL |

**MCP 包含写入、事务和 DDL 能力，不能等同于 AI 面板的只读查询模式。** 希望只读访问时，在 QueryDesk 中把对应连接设为只读，并使用适当的数据库账号权限。客户端自己的工具审批设置仍由客户端控制。

## 一次典型调用流程

1. 调用 `connections.list`，选择需要的连接 ID。
2. 调用 `database.connect`，保存返回的 `sessionId`。
3. 使用这个会话查询 Schema、对象和字段。
4. 执行有明确范围的 SQL，或使用表浏览工具。
5. 手动事务中明确选择提交或回滚。
6. 完成后调用 `database.disconnect`。

可以向 Codex 提出明确任务，例如：

```text
使用 QueryDesk 列出已保存的数据库连接，先不要连接。
连接指定的只读测试连接，列出当前 Schema 的表和注释。
查看指定表的字段和索引，只读取元数据。
执行这条参数化查询，并解释结果。
```

切换连接或 Schema 前明确目标。断开连接或后台重启后，旧 `sessionId` 不再有效，需要重新建立会话。

## 工作原理

`querydesk-mcp.cjs` 使用 stdio 接收 MCP 消息，启动仅监听 `127.0.0.1` 随机端口的 QueryDesk 后台，通过随机令牌验证这对本地进程之间的通信。数据库连接继续使用 QueryDesk 当前用户的配置、Windows safeStorage 和数据库工作进程。

Oracle 凭据通过私有进程管道传给 Java，不写入 Java 启动参数。MCP 后台没有普通桌面窗口，关闭客户端时应结束其对应后台进程。后台可以独立于 QueryDesk 主窗口存活，因此升级时也可能占用安装文件。

## 常见问题

| 现象 | 检查方式 |
| --- | --- |
| 提示找不到 Codex | 先安装并启动本机 Codex；一键入口依赖可用的 Codex CLI |
| 配置成功但工具未出现 | 重启 Codex，确认实际使用的 `CODEX_HOME` 与配置文件 |
| 后台启动超时 | 检查程序路径、脚本路径、环境变量及安装目录完整性 |
| 看不到原有连接 | MCP 必须运行在保存连接的同一 Windows 用户下 |
| 会话不存在 | 后台重启或断开后重新调用 `database.connect` |
| 无法写入 | 检查连接只读设置、数据库权限和表编辑条件 |
| 升级提示文件被占用 | 退出 QueryDesk 主窗口及使用该 MCP 的客户端后重试 |

不要把 stdio 的普通日志写到标准输出；协议通道要求每行都是有效 MCP JSON。当前桥接日志使用标准错误输出。
