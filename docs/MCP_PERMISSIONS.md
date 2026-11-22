# Baby Tracker MCP 功能与权限说明

本文适用于 Baby Tracker `1.9.0`，说明 MCP 服务可以访问哪些数据、执行哪些操作，以及管理员配置和网络访问的安全边界。

本文是参考文档，覆盖现有 MCP 接口和工具，不替代 MCP 协议规范。

## 权限结论

MCP 使用一个全局 API Key，不绑定具体用户，也没有只读、读写或按数据范围划分的独立密钥。

持有有效 MCP API Key 的客户端可以：

- 读取当前宝宝资料。
- 读取指定日期的每日概览和记录列表。
- 读取最近记录和已启用的快捷按钮。
- 创建喂养、排泄、症状或补充记录。
- 使用已启用的快捷按钮创建记录。

MCP 客户端不能：

- 修改或删除已有记录。
- 修改宝宝资料、快捷按钮或系统设置。
- 管理用户、审批账号或修改密码。
- 导出或备份数据、恢复备份、清空数据。
- 开启或关闭 MCP、查看或轮换 MCP API Key。
- 访问网页管理员接口或 Home Assistant API Key。

## 权限模型

| 主体 | 凭据 | 权限范围 |
| --- | --- | --- |
| 管理员网页会话 | 管理员账号和登录会话 | 开关 MCP、查看和轮换 MCP API Key |
| MCP 客户端 | `Authorization: Bearer <MCP_API_KEY>` | 使用全部 6 个 MCP 工具，不具备网页管理员权限 |
| 普通网页用户 | 普通用户登录会话 | 不能配置 MCP，也不能查看或轮换 MCP API Key |

MCP API Key 是服务凭据，不是用户账号。通过 MCP 创建或读取数据时，不会继承某个网页用户的角色和数据权限。

当前数据模型按单宝宝使用：

- `baby_tracker_get_baby` 读取数据库中的第一份宝宝资料。
- `baby_tracker_list_records` 按日期读取记录，不按用户过滤。
- 两个写入工具固定使用 `baby_id = 1`，并以 `MCP` 服务身份写入审计日志。

因此，API Key 应被视为可读写全部育儿记录的高权限凭据。

## 访问链路

```text
管理员网页会话
    -> 打开 MCP 开关
    -> 生成或轮换 MCP API Key

MCP 客户端
    -> Baby Tracker HTTP 服务
    -> 可选的反向代理子路径
    -> /mcp
    -> 来源检查
    -> Bearer API Key 校验
    -> 请求体限制和限流
    -> 调用 MCP 工具
```

MCP 只有在以下条件同时满足时才开放：

1. 管理员已打开 MCP 开关。
2. 请求提供有效的 MCP API Key。
3. 请求未被同源保护检查判定为不可信跨站来源。

MCP 默认关闭。服务本身只有一个 HTTP 入口，可通过 `BABY_TRACKER_LISTEN_ADDRESS` 调整监听地址，也可选配 `BABY_TRACKER_BASE_PATH` 以部署在反向代理子路径下。

## 工具权限矩阵

| MCP 工具 | 类型 | 可访问范围 | 是否改变数据 |
| --- | --- | --- | --- |
| `baby_tracker_get_summary` | 读取 | 每日统计、奶量估算、最近 5 条记录、启用的快捷按钮 | 否 |
| `baby_tracker_list_records` | 读取 | 指定日期的记录，可按类型筛选并分页 | 否 |
| `baby_tracker_get_baby` | 读取 | 当前第一份宝宝资料 | 否 |
| `baby_tracker_list_quick_buttons` | 读取 | 已启用的快捷按钮 | 否 |
| `baby_tracker_create_record` | 写入 | 创建一条记录 | 是，新增记录 |
| `baby_tracker_press_quick_button` | 写入 | 使用已启用的快捷按钮创建一条记录 | 是，新增记录 |

四个读取工具带有只读和幂等提示。两个写入工具带有非 destructive、非 open-world、非幂等提示。工具注解用于帮助客户端理解行为，实际权限仍由服务端代码执行。

## 读取能力

### `baby_tracker_get_summary`

读取指定日期的每日概览。日期省略时使用今天。

主要返回：

- 当日喂养总量、喂养次数和目标奶量。
- 剩余奶量、预计喂养次数和每次建议量。
- 当日尿、便次数。
- 最近一次喂养时间。
- 奶量估算依据和系数。
- 最近 5 条记录。
- 已启用的快捷按钮。

“最近 5 条记录”并不限定在请求日期当天，而是数据库中最近的记录。返回记录使用完整记录字段。

### `baby_tracker_list_records`

读取指定日期的记录，日期省略时使用今天。

输入参数：

| 参数 | 说明 |
| --- | --- |
| `date` | `YYYY-MM-DD`，省略时为今天 |
| `type` | 可选：`feed`、`excrete`、`symptom`、`supplement` |
| `limit` | 每页条数，默认 50，最大 200 |
| `offset` | 分页偏移量，默认 0 |

返回记录按时间倒序排列，并包含总数、分页信息和是否还有下一页。记录使用数据库完整字段，可包含记录 ID、宝宝 ID、用户 ID、类型、子类型、数量、持续时间、颜色、性状、体温、备注、记录时间、创建时间和辅食单位。

### `baby_tracker_get_baby`

读取数据库中的第一份宝宝资料，不接收筛选参数。

返回字段包括 ID、姓名、性别、出生日期、体重、早产标记和创建时间。

### `baby_tracker_list_quick_buttons`

只返回已启用的快捷按钮，按排序值和 ID 排列。

返回字段包括按钮 ID、记录类型、子类型、显示标签、预设数量、排序值和辅食单位。停用的快捷按钮不会通过该工具返回，也不能通过 `baby_tracker_press_quick_button` 使用。

## 写入能力

### `baby_tracker_create_record`

创建一条新记录，可用于：

- 喂养：`feed`。
- 排泄：`excrete`。
- 症状：`symptom`。
- 补充：`supplement`。

支持字段包括类型、子类型、数量、持续时间、颜色、性状、体温、备注、记录时间和辅食单位。

约束：

- `type` 必须是 `feed`、`excrete`、`symptom` 或 `supplement`。
- `sub_type` 不能为空。
- 时间省略时使用当前本地时间。
- 时间格式支持 `YYYY-MM-DD HH:MM:SS`、`YYYY-MM-DDTHH:MM:SS` 和 RFC3339。
- 创建后返回完整记录，并写入一条 `MCP创建记录` 审计日志。

### `baby_tracker_press_quick_button`

按快捷按钮 ID 创建记录。

行为：

- 按钮必须存在且处于启用状态。
- 记录类型、子类型、预设数量和辅食单位复制自快捷按钮。
- 时间省略时使用当前本地时间。
- 创建后返回快捷按钮和完整记录。
- 写入一条 `MCP快捷记录` 审计日志。

该工具不会修改快捷按钮本身。

## 不开放的权限

| 功能域 | MCP 是否可用 | 说明 |
| --- | --- | --- |
| 修改记录 | 否 | 只能新增记录 |
| 删除记录 | 否 | 没有删除工具 |
| 修改宝宝资料 | 否 | 只能读取 |
| 创建、修改、删除快捷按钮 | 否 | 只能读取和触发已启用按钮 |
| 用户与审批 | 否 | 不能读取或管理账号 |
| 管理员密码 | 否 | 不能修改密码 |
| MCP 开关 | 否 | 只能由管理员网页会话管理 |
| MCP API Key | 否 | 只能由管理员网页会话查看或轮换 |
| 设置读取和修改 | 否 | 每日概览仅返回计算后的必要统计 |
| CSV 导出 | 否 | 不能通过 MCP 导出 |
| 数据备份、恢复和清空 | 否 | 管理接口不对 MCP 开放 |
| 体重、趋势、疫苗、健康随访和倒计时 | 否 | 当前没有对应 MCP 工具 |
| 审计日志读取 | 否 | 当前没有对应 MCP 工具 |
| Home Assistant 接口 | 否 | MCP 和 HA 使用独立 API Key |

## 网络与安全边界

### HTTP 入口

MCP 与网页应用共用 Baby Tracker HTTP 服务，端点为 `/mcp`。

- MCP 开关关闭时，请求返回 `404 Not Found`。
- 可选的 `BABY_TRACKER_BASE_PATH` 只改变反向代理子路径，不改变 MCP 鉴权或权限。
- MCP 仍使用独立的 Bearer API Key，不继承网页登录会话。

如果服务位于反向代理之后，应由代理层提供 TLS、访问控制和网络边界。不要将未启用 API Key 的 MCP 端点直接暴露到不可信网络。

### API Key

- API Key 使用 Bearer 认证。
- 数据库中只有一个全局 MCP API Key。
- API Key 不设过期时间。
- API Key 没有只读或按工具划分的作用域。
- 重新生成 API Key 后，旧 Key 立即失效。
- 普通 `/api/settings` 响应不会暴露 MCP API Key。
- 查看和轮换 API Key 需要管理员网页会话。

### 请求限制

| 限制 | 当前值 |
| --- | --- |
| 请求体大小 | 最大 1 MiB |
| 单一来源请求频率 | 每分钟 60 次 |
| 限流窗口 | 固定 1 分钟窗口 |
| 限流维度 | HTTP 连接的远程 IP |
| 超限响应 | `429 Too Many Requests`，带 `Retry-After: 60` |

服务使用同源保护检查浏览器请求来源。被判定为不可信跨站来源的请求返回 `403 Forbidden`。

反向代理可能让多个客户端共享代理地址，因此应同时使用代理层限流、认证或受控网络访问。

### 响应安全头

MCP 响应包含：

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`

## HTTP 状态说明

| 状态码 | 场景 |
| --- | --- |
| `200` | 工具请求成功 |
| `401` | 缺少 MCP API Key，或 Key 不正确 |
| `403` | 请求来源不受信任 |
| `404` | MCP 开关关闭 |
| `429` | 单一来源超过每分钟 60 次限制 |

## 审计范围

会写入审计日志的 MCP 行为：

- 管理员开启 MCP：`开启MCP服务`。
- 管理员关闭 MCP：`关闭MCP服务`。
- 管理员生成或轮换 API Key：`生成MCP密钥`。
- 通过 MCP 创建记录：`MCP创建记录`。
- 通过 MCP 使用快捷按钮：`MCP快捷记录`。

读取工具本身不写入业务审计日志。

## 当前限制

- 没有按用户、宝宝或工具划分的细粒度权限。
- 没有只读 API Key。
- 没有多 API Key 管理和单独吊销。
- 没有 API Key 过期时间或轮换前的重叠窗口。
- 没有记录修改、删除和批量操作工具。
- 不按网页用户的角色或数据范围过滤 MCP 数据。

在存在多个家庭用户的环境中，应把 MCP API Key 视为全体共享数据的高权限密钥，仅在受控局域网或 VPN 中使用，并通过网络访问控制和 Key 轮换限制访问。

## 相关接口

| 接口 | 所需权限 | 用途 |
| --- | --- | --- |
| `GET /api/mcp/config` | 管理员网页会话 | 查看 MCP 开关、可用状态和端点 |
| `PUT /api/mcp/config` | 管理员网页会话 | 开启或关闭 MCP |
| `GET /api/mcp/api-key` | 管理员网页会话 | 查看当前 MCP API Key |
| `POST /api/mcp/api-key` | 管理员网页会话 | 生成或轮换 MCP API Key |
| `POST /mcp` | MCP Bearer API Key | MCP Streamable HTTP 入口 |
| `GET /mcp` | MCP Bearer API Key | MCP Streamable HTTP 入口 |
| `DELETE /mcp` | MCP Bearer API Key | MCP Streamable HTTP 会话删除 |

管理接口不能使用 MCP API Key 调用；MCP 入口也不能使用网页管理员会话替代 Bearer API Key。

## 实现依据

当前权限以以下实现为准：

- `internal/app/mcp.go`
- `internal/app/middleware.go`
- `internal/app/handlers_records.go`
- `internal/app/handlers_admin.go`
- `internal/app/routes.go`
