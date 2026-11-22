# Baby Tracker MCP 功能与权限说明

本文适用于 Baby Tracker `1.9.0`，说明 MCP 三档权限、工具范围、数据边界和管理页配置方式。

MCP 默认关闭。管理员需要先在“管理 > 管理配置 > MCP 服务”中启用服务并生成独立 API Key。

## 权限档位

| 档位 | 数据读取范围 | 写入能力 | 管理能力 |
| --- | --- | --- | --- |
| 基础 | 最近 30 天 | 无 | 无 |
| 进阶 | 最近 30 天 | 新增日常、成长、疫苗和健康随访记录 | 无 |
| 完全 | 全部历史数据 | 新增、修改和删除业务数据 | 修改宝宝资料、快捷按钮、业务设置、疫苗计划、健康随访、倒数日和用户 |

默认档位为“基础”。“最近 30 天”按服务器本地日期计算，包含今天和之前 29 天。

切换到“完全”时，管理页会显示风险提示，并要求先确认完整数据备份。后端同时要求请求携带：

```json
{
  "permission_level": "full",
  "acknowledge_full_access": true
}
```

缺少确认时，服务端拒绝将权限切换到“完全”。

## 权限边界

MCP 使用一个全局 Bearer API Key，不绑定具体网页用户。三档权限只作用于 MCP 工具，不会改变网页用户自身的角色。

- 工具注册按当前档位执行。客户端只能看到当前档位允许的工具。
- 每个工具执行时还会再次读取当前权限，不依赖客户端隐藏菜单或工具列表。
- 基础档不能通过构造请求调用进阶或完全档工具。
- 进阶档不能通过构造请求调用完全档工具。
- 完全档可操作全部业务数据，但不等同于网页管理员会话。
- 密钥、MCP 开关、MCP 权限档位和 MCP API Key 仅由管理员网页会话管理。
- MCP 不开放 CSV 导出、备份恢复、HA 接口和 MCP 控制面接口。

MCP API Key 应视为共享服务凭据。重新生成 API Key 后，旧 Key 立即失效。

## 基础档工具

基础档只读最近 30 天数据，不提供写入或管理工具。

| 工具 | 用途 | 时间范围 |
| --- | --- | --- |
| `baby_tracker_get_summary` | 读取指定日期的概览、最近记录和快捷按钮 | 指定日期及最近记录限定在 30 天内 |
| `baby_tracker_list_records` | 按单日或日期范围列出记录 | 起止日期均限定在 30 天内 |
| `baby_tracker_list_growth_logs` | 分页列出体重和身高记录 | 默认及允许查询范围均为 30 天内 |
| `baby_tracker_get_baby` | 读取当前宝宝资料 | 资料本身不受记录日期限制 |
| `baby_tracker_list_quick_buttons` | 读取已启用快捷按钮 | 不返回停用按钮 |

`baby_tracker_list_records` 支持 `date` 单日查询，或使用 `start_date` 和 `end_date` 查询范围。两种方式不能同时使用。

## 进阶档工具

进阶档包含基础档全部只读工具，并允许新增记录。新增记录的时间同样限制在最近 30 天。

| 工具 | 用途 |
| --- | --- |
| `baby_tracker_create_record` | 新增喂养、排泄、症状或补充记录 |
| `baby_tracker_press_quick_button` | 使用已启用快捷按钮新增记录 |
| `baby_tracker_add_growth_log` | 新增体重或身高记录 |
| `baby_tracker_record_vaccine` | 记录疫苗名称、剂次和接种日期 |
| `baby_tracker_record_health_followup` | 记录健康随访完成日期 |

进阶档不能修改或删除已有记录，也不能修改宝宝资料、快捷按钮、设置或用户。

## 完全档工具

完全档包含基础档和进阶档全部工具，并增加全部历史数据读取和业务管理工具。

### 全量读取

| 工具 | 用途 |
| --- | --- |
| `baby_tracker_list_records` | 查询任意历史日期或日期范围 |
| `baby_tracker_list_growth_logs` | 查询全部成长记录，省略起始日期时从最早记录开始 |
| `baby_tracker_get_vaccine_schedule` | 读取完整疫苗计划和接种状态 |
| `baby_tracker_get_health_schedule` | 读取完整健康随访计划 |
| `baby_tracker_list_countdowns` | 读取全部倒数日 |
| `baby_tracker_get_settings` | 读取业务设置；密钥和 MCP 控制面配置不会返回 |
| `baby_tracker_get_stats` | 读取全量记录数、喂养数、奶量、记录天数和待审批用户数 |
| `baby_tracker_list_users` | 读取用户列表，不返回密码哈希 |
| `baby_tracker_list_audit_logs` | 按时间倒序读取审计日志 |

### 业务管理

| 工具 | 用途 |
| --- | --- |
| `baby_tracker_update_baby` | 修改宝宝姓名、性别、出生日期、体重和早产标记 |
| `baby_tracker_manage_records` | 修改或删除已有日常记录 |
| `baby_tracker_manage_quick_buttons` | 创建、修改、排序或删除快捷按钮 |
| `baby_tracker_update_settings` | 修改业务设置；密钥和 MCP 控制面配置不可修改 |
| `baby_tracker_manage_growth_logs` | 修改或删除已有成长记录 |
| `baby_tracker_manage_vaccines` | 删除接种记录、调整或删除计划、新增自定义计划 |
| `baby_tracker_manage_health_followups` | 删除随访记录或调整计划日期 |
| `baby_tracker_manage_countdowns` | 新增、修改或删除倒数日 |
| `baby_tracker_manage_users` | 批准、拒绝、删除、改名或重置用户密码 |
| `baby_tracker_clear_records` | 清空全部日常记录，必须提交确认短语 `CLEAR_ALL_RECORDS` |

完全档不会删除管理员账号。`baby_tracker_clear_records` 只清空 `records` 表中的日常记录，不会清空成长、疫苗、健康随访、倒数日或用户数据。

## 完全权限风险

完全权限显著扩大凭据泄露后的影响范围。持有有效 Key 的客户端可以读取全部历史业务数据，并可修改或删除管理数据。

启用前应完成以下操作：

1. 在管理页下载完整 JSON 备份。
2. 将备份保存到受控且安全的位置。
3. 仅在可信设备、受控局域网或 VPN 中使用完全权限。
4. 使用完毕后及时降级到基础或进阶档。
5. 怀疑 Key 泄露时立即重新生成 API Key。

备份文件包含业务数据、用户信息和密码哈希，不应通过公开渠道传输或保存。

## 访问链路

```text
管理员网页会话
    -> 打开 MCP 开关
    -> 选择基础、进阶或完全权限
    -> 完全权限：确认风险并备份
    -> 生成或轮换 MCP API Key

MCP 客户端
    -> Baby Tracker HTTP 服务
    -> 可选反向代理子路径
    -> /mcp
    -> 来源检查
    -> Bearer API Key 校验
    -> 请求体限制和限流
    -> 按当前权限注册工具
    -> 工具执行时再次校验权限和数据范围
```

MCP 只有在以下条件同时满足时才可访问：

1. 管理员已打开 MCP 开关。
2. 请求提供有效的 MCP API Key。
3. 请求未被同源保护检查判定为不可信跨站来源。

## API 配置

| 接口 | 所需权限 | 用途 |
| --- | --- | --- |
| `GET /api/mcp/config` | 管理员网页会话 | 查看开关、权限档位、数据范围和风险提示 |
| `PUT /api/mcp/config` | 管理员网页会话 | 修改开关或权限档位 |
| `GET /api/mcp/api-key` | 管理员网页会话 | 查看当前 MCP API Key |
| `POST /api/mcp/api-key` | 管理员网页会话 | 生成或轮换 MCP API Key |
| `POST /mcp` | MCP Bearer API Key | MCP Streamable HTTP 入口 |
| `GET /mcp` | MCP Bearer API Key | MCP Streamable HTTP 入口 |
| `DELETE /mcp` | MCP Bearer API Key | MCP Streamable HTTP 会话删除 |

普通 `/api/settings` 接口不能修改 `mcp_enabled` 或 `mcp_permission_level`，必须使用专用 MCP 配置接口。

## 网络与请求限制

- MCP 开关关闭时，`/mcp` 返回 `404 Not Found`。
- 缺少或错误的 API Key 返回 `401 Unauthorized`。
- 不可信跨站来源返回 `403 Forbidden`。
- 单一来源超过每分钟 60 次请求时返回 `429 Too Many Requests`。
- 请求体最大为 1 MiB。
- 服务使用同源保护检查浏览器请求来源。

如果服务位于反向代理之后，应由代理层提供 TLS、访问控制和网络边界。不要把未受保护的 MCP 端点直接暴露到不可信网络。

## 审计范围

管理页会记录：

- 开启 MCP：`开启MCP服务`。
- 关闭 MCP：`关闭MCP服务`。
- 修改权限：`修改MCP权限`。
- 生成或轮换 API Key：`生成MCP密钥`。

业务写入和管理工具会以 `MCP` 服务身份记录对应审计日志，例如 `MCP创建记录`、`MCP修改设置`、`MCP删除用户` 和 `MCP清除数据`。

读取工具本身不写入业务审计日志。

## 当前限制

- MCP 只有一个全局 API Key，没有多 Key 管理、独立吊销或过期时间。
- 三档权限不按网页用户、宝宝或单条数据进一步细分。
- MCP 控制面配置、CSV 导出、备份恢复和 HA 接口不通过 MCP 开放。
- 没有单独的只读 API Key；只读能力由“基础”档管理。

## 实现依据

当前权限以以下实现为准：

- `internal/app/mcp.go`
- `internal/app/mcp_management.go`
- `internal/app/handlers_admin.go`
- `internal/app/database.go`
- `internal/app/routes.go`
