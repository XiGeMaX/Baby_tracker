# Baby Tracker API 规范

本文档是 Baby Tracker HTTP API 的完整契约，覆盖 `/api/*` REST 接口和 `/mcp` 传输端点。HTML 页面与 `/static/*` 资源不属于业务 API，不在本文档中定义。

## 基本约定

### 地址与编码

- API 路径均相对于应用根地址，例如 `http://127.0.0.1:8964/api/records/today`。
- 使用反向代理子路径时，所有地址增加配置的 `BASE_PATH` 前缀，例如 `/baby-tracker/api/records/today`。
- JSON 请求使用 `Content-Type: application/json`，响应使用 `application/json; charset=utf-8`。
- 日期使用 `YYYY-MM-DD`，本地时间使用 `YYYY-MM-DD HH:MM:SS`，备份导出时间使用 RFC 3339。
- 普通 JSON 请求体上限为 2 MiB；备份恢复使用 `multipart/form-data`，上限为 64 MiB。
- API 响应默认设置 `Cache-Control: no-store`，客户端不应缓存业务数据。

### 认证总则

除完成登录、注册和登录态探测所需的最小入口外，所有业务读取和写入 API 都必须鉴权。新增 API 默认继承这项规则，不允许通过 GET 方法公开业务数据。

| 认证类型 | 凭据 | 适用接口 |
|---|---|---|
| 网页会话 | HttpOnly Cookie `baby_tracker_session` | 管理页、普通业务 API |
| HA API Key | `Authorization: Bearer <KEY>`、`X-API-Key: <KEY>` 或 `?api_key=<KEY>` | HA 传感器读取与按钮写入 |
| MCP API Key | `Authorization: Bearer <KEY>` | `/mcp` |
| 管理员网页会话 | 角色为 `admin` 且状态为 `approved` 的网页会话 | 用户、备份、密钥和系统配置 |

网页会话由 `POST /api/auth/login` 创建，并在后续同源请求中通过 Cookie 自动携带。状态必须为 `approved`；待审批或已拒绝用户不能访问业务 API。

以下入口不要求已登录：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 使用用户名和密码创建会话 |
| POST | `/api/auth/logout` | 清除会话；不要求已有会话 |
| POST | `/api/auth/register` | 注册待审批账户 |
| GET | `/api/auth/me` | 登录态探测；未登录时返回 `{"user": null}` |

`GET /api/auth/me` 是唯一允许匿名读取的 `/api` 端点，且只能返回当前会话身份，不能返回业务数据。`/mcp` 不走网页会话，而是由专用 MCP API Key 鉴权。

管理员尚未初始化管理密码时，除 `POST /api/auth/setup-password` 外的业务请求返回 `403`，响应包含 `password_setup_required: true`。

### 错误格式

所有 JSON 错误使用同一结构：

```json
{
  "error": "可读错误信息"
}
```

| 状态码 | 含义 |
|---|---|
| `400` | 请求格式、字段或日期无效 |
| `401` | 未登录、会话失效，或 HA/MCP 密钥无效 |
| `403` | 已登录但未审批、非管理员，或需先设置管理密码 |
| `404` | 资源不存在 |
| `409` | 用户名等唯一约束冲突 |
| `500` | 服务端或数据库错误 |

成功响应通常直接返回对象或数组；创建成功一般返回 `201`，更新和删除一般返回 `200`。布尔字段可能来自 SQLite，因此兼容表示为 JSON 布尔值或 `0/1`。

### 兼容性规则

- 当前 API 没有 URL 版本号。后续变更优先增加可选字段，不删除或改变既有字段含义。
- 需要破坏性变更时，必须新增版本化路径，并在同一版本周期内保留旧接口。
- 修改方法、认证方式、状态码、字段类型或必填性时，必须同步更新本文档、`docs/ha-integration.md` 或 `docs/MCP_PERMISSIONS.md`，补充回归测试并记录到 `CHANGELOG.md`。
- 新增读取接口默认要求已审批网页会话或相应专用密钥，不允许隐式公开。

## 认证 API

| 方法 | 路径 | 认证 | 请求 | 成功响应 |
|---|---|---|---|---|
| POST | `/api/auth/login` | 公开 | `username`、`password` | `200`，`message`、`user` |
| POST | `/api/auth/logout` | 公开 | 无 | `200`，`message` |
| POST | `/api/auth/register` | 公开 | `username`、`password`、可选 `nickname` | `201`，`message` |
| GET | `/api/auth/me` | 可选会话 | 无 | `200`，`user` 或 `null` |
| PUT | `/api/auth/nickname` | 已审批会话 | `nickname` | `200`，`message` |
| POST | `/api/auth/setup-password` | 管理员会话 | `password`、`confirm_password` | `200`，`message` |

认证用户对象：

```json
{
  "id": 1,
  "username": "admin",
  "nickname": "管理员",
  "role": "admin",
  "status": "approved"
}
```

密码长度为 6-128 位。注册用户名至少 3 个字符，管理员修改用户名时至少 2 个字符。注册账户默认状态为 `pending`，管理员审批后才能登录业务 API。

## 快速按钮 API

| 方法 | 路径 | 认证 | 请求 | 成功响应 |
|---|---|---|---|---|
| GET | `/api/quick-buttons` | 已审批会话 | 无 | `200`，快速按钮数组 |
| POST | `/api/quick-buttons` | 管理员 | 按钮字段 | `201`，`message` |
| POST | `/api/quick-buttons/reorder` | 管理员 | `ids: number[]` | `200`，`message` |
| PUT | `/api/quick-buttons/{id}` | 管理员 | 按钮字段的部分集合 | `200`，`message` |
| DELETE | `/api/quick-buttons/{id}` | 管理员 | 无 | `200`，`message` |
| POST | `/api/quick-record/{id}` | 已审批会话 | 可选 `timestamp`、`date` | `201`，今日摘要及 `record_id` |

快速按钮对象：

```json
{
  "id": 1,
  "type": "feed",
  "sub_type": "formula",
  "label": "配方奶 60ml",
  "amount": 60,
  "sort_order": 1,
  "is_active": 1,
  "food_unit": "",
  "created_at": "2026-11-23 08:00:00"
}
```

新增按钮时 `type`、`sub_type`、`label` 必填；可选 `amount`、`sort_order`、`food_unit`。更新时只处理提交的 `type`、`sub_type`、`label`、`amount`、`sort_order`、`is_active`、`food_unit`。普通用户只能看到启用按钮，管理员可看到全部按钮。

记录类型 `type` 固定为 `feed`、`excrete`、`symptom` 或 `supplement`。`sub_type` 是具体业务分类，例如 `formula`、`breast_left`、`urine`、`stool`、`solid_food`。

## 记录 API

| 方法 | 路径 | 认证 | 请求 | 成功响应 |
|---|---|---|---|---|
| GET | `/api/records/dates` | 已审批会话 | 无 | `200`，`YYYY-MM-DD` 数组 |
| GET | `/api/records/today` | 已审批会话 | 可选 `date` | `200`，今日摘要 |
| GET | `/api/records/{id}` | 已审批会话 | 无 | `200`，记录对象 |
| GET | `/api/records` | 已审批会话 | 可选 `date`、`type` | `200`，记录数组 |
| POST | `/api/records` | 已审批会话 | 记录字段 | `201`，今日摘要及 `record_id` |
| PUT | `/api/records/{id}` | 已审批会话 | 记录字段的部分集合、可选 `_date` | `200`，今日摘要及 `message` |
| DELETE | `/api/records/{id}` | 已审批会话 | 可选查询参数 `date` | `200`，今日摘要及 `message` |

记录对象：

```json
{
  "id": 18,
  "baby_id": 1,
  "user_id": 1,
  "type": "feed",
  "sub_type": "formula",
  "amount": 90,
  "duration": null,
  "color": "",
  "consistency": "",
  "temperature": null,
  "note": "",
  "timestamp": "2026-11-23 09:30:00",
  "food_unit": "",
  "created_at": "2026-11-23 09:30:01"
}
```

创建记录时 `type`、`sub_type` 必填；可选 `amount`、`duration`、`color`、`consistency`、`temperature`、`note`、`timestamp`、`food_unit`、`_date`。`timestamp` 为空时使用服务器当前时间；`_date` 只决定响应中刷新哪一天的摘要，不写入记录。

更新记录只修改提交的 `type`、`sub_type`、`amount`、`duration`、`color`、`consistency`、`temperature`、`note`、`timestamp`、`food_unit`。`timestamp` 一旦提交就不能为空。

今日摘要：

```json
{
  "date": "2026-11-23",
  "total_feed_ml": 420,
  "feed_count": 6,
  "target_ml": 500,
  "remaining_ml": 80,
  "estimated_feeds_per_day": 8,
  "estimated_feeds_left": 2,
  "feed_progress": 0.84,
  "per_feed_ml": 63,
  "urine_count": 5,
  "stool_count": 2,
  "last_feed_time": "2026-11-23 09:30:00",
  "estimate": {
    "daily_target_ml": 500,
    "per_feed_ml": 63,
    "estimated_feeds_per_day": 8,
    "method": "weight",
    "calculation_detail": "日龄7天: 3.5 × 150ml/kg = 525ml/天",
    "coefficients": {}
  },
  "recent_records": [],
  "quick_buttons": [],
  "logged_in": true,
  "is_admin": true
}
```

`recent_records` 返回最近 5 条记录。`quick_buttons` 返回当前用户可用的启用按钮。

## 宝宝与设置 API

| 方法 | 路径 | 认证 | 请求 | 成功响应 |
|---|---|---|---|---|
| GET | `/api/baby` | 已审批会话 | 无 | `200`，宝宝对象 |
| PUT | `/api/baby` | 管理员 | `name`、`gender`、`birth_date`、`weight`、`is_premature` | `200`，`message` |
| GET | `/api/settings` | 已审批会话 | 无 | `200`，键值对象；敏感密钥已过滤 |
| PUT | `/api/settings` | 管理员 | 非敏感设置键值对象 | `200`，`message` |
| GET | `/api/milk-estimate` | 已审批会话 | 无 | `200`，奶量估算对象 |

宝宝对象：

```json
{
  "id": 1,
  "name": "宝宝",
  "gender": "male",
  "birth_date": "2026-11-01",
  "weight": 3.5,
  "is_premature": 0,
  "created_at": "2026-11-01 08:00:00"
}
```

更新宝宝时缺省值分别为 `name=宝宝`、`gender=male`、`birth_date=当天`、`weight=3`、`is_premature=false`。`birth_date` 必须是有效日期。

`GET /api/settings` 不返回 `ha_api_key` 和 `mcp_api_key`。`PUT /api/settings` 也不接受敏感密钥；MCP 开关与权限必须使用 `/api/mcp/config`，HA 与 MCP 密钥必须使用各自的 `/api/*/api-key` 接口。

奶量估算对象：

```json
{
  "daily_target_ml": 500,
  "per_feed_ml": 63,
  "estimated_feeds_per_day": 8,
  "method": "weight",
  "calculation_detail": "日龄7天: 3.5 × 150ml/kg = 525ml/天",
  "coefficients": {}
}
```

## 成长与趋势 API

| 方法 | 路径 | 认证 | 请求 | 成功响应 |
|---|---|---|---|---|
| GET | `/api/growth-logs` | 已审批会话 | 无 | `200`，成长记录数组 |
| POST | `/api/growth-logs` | 已审批会话 | 成长字段 | `201`，`id`、`message` |
| PUT | `/api/growth-logs/{id}` | 已审批会话 | 成长字段 | `200`，`message` |
| DELETE | `/api/growth-logs/{id}` | 管理员 | 无 | `200`，`message` |
| GET | `/api/weight-logs` | 已审批会话 | 同 `/api/growth-logs` | 兼容别名 |
| POST | `/api/weight-logs` | 已审批会话 | 同 `/api/growth-logs` | 兼容别名 |
| PUT | `/api/weight-logs/{id}` | 已审批会话 | 同 `/api/growth-logs` | 兼容别名 |
| DELETE | `/api/weight-logs/{id}` | 管理员 | 同 `/api/growth-logs` | 兼容别名 |
| GET | `/api/stats/trends` | 已审批会话 | 趋势查询参数 | `200`，趋势对象 |

成长记录对象：

```json
{
  "id": 3,
  "baby_id": 1,
  "weight": 6.2,
  "height": 62.5,
  "recorded_date": "2026-11-23",
  "note": "",
  "created_at": "2026-11-23 10:00:00"
}
```

新增和更新成长记录时，`weight` 与 `height` 至少填写一个，`recorded_date` 必填，`note` 可选。体重范围为 0.1-100 kg，身高范围为 10-250 cm。更新接口当前要求提交完整有效目标状态，而不是只修改备注。

趋势查询参数：

| 参数 | 默认值 | 范围/取值 | 说明 |
|---|---|---|---|
| `days` | `14` | 1-90 | 喂养、排泄和辅食统计范围 |
| `mode` | `day` | `day`、`month`、`hour` | 聚合粒度 |
| `growth_days` | `days` | 1-1825 | 成长曲线范围，支持 3 年和 5 年 |
| `weight_days` | `growth_days` | 1-1825 | 旧参数，作为 `growth_days` 的兼容回退 |
| `date` | 空 | `YYYY-MM-DD` | `mode=hour` 时指定统计日期；无效时使用当前范围 |

趋势响应包含 `daily`、`feed_hours`、`feed_hours_by_day`、`food_by_unit`、`growth`、`weights`、`growth_days`、`weight_days`、`target_ml`、`days` 和 `mode`。`growth` 与 `weights` 当前返回同一组成长记录，后者用于兼容旧前端。

## 疫苗、健康随访与倒数日 API

| 方法 | 路径 | 认证 | 请求 | 成功响应 |
|---|---|---|---|---|
| GET | `/api/vaccine/schedule` | 已审批会话 | 无 | `200`，计划与概览 |
| POST | `/api/vaccine/record` | 已审批会话 | `vaccine_name`、`dose_index`、`vaccinated_date`、可选 `note` | `200`，`message` |
| DELETE | `/api/vaccine/record` | 已审批会话 | `vaccine_name`、`dose_index` | `200`，`message` |
| PUT | `/api/vaccine/plan-date` | 已审批会话 | `vaccine_name`、`dose_index`、`custom_due_date` | `200`，`message` |
| DELETE | `/api/vaccine/plan` | 已审批会话 | `vaccine_name`、`dose_index` | `200`，`message` |
| POST | `/api/vaccine/custom-plan` | 已审批会话 | `vaccine_name`、`doses[]` | `200`，`message` |
| DELETE | `/api/vaccine/custom-plan` | 已审批会话 | `vaccine_name`、`dose_index` | `200`，`message` |
| GET | `/api/vaccine/dates` | 已审批会话 | 无 | `200`，`vaccinated`、`overdue`、`upcoming` 日期数组 |
| GET | `/api/vaccine/day-records` | 已审批会话 | 可选 `date` | `200`，`vaccinated`、`planned` 数组 |
| GET | `/api/health/schedule` | 已审批会话 | 无 | `200`，计划与概览 |
| POST | `/api/health/record` | 已审批会话 | `label`、可选 `completed_date`、`note` | `201`，`message` |
| DELETE | `/api/health/record` | 已审批会话 | 查询参数 `label` | `200`，`message` |
| PUT | `/api/health/plan-date` | 已审批会话 | `label`、`custom_due_date` | `200`，`message` |
| GET | `/api/health/dates` | 已审批会话 | 无 | `200`，`completed`、`upcoming`、`overdue` 日期数组 |
| GET | `/api/health/day-records` | 已审批会话 | 可选 `date` | `200`，`completed`、`planned` 数组 |
| GET | `/api/countdowns` | 已审批会话 | 无 | `200`，倒数日数组 |
| POST | `/api/countdowns` | 已审批会话 | `title`、`target_date`、可选 `note` | `201`，`message` |
| PUT | `/api/countdowns/{id}` | 已审批会话 | `title`、`target_date`、可选 `note` | `200`，`message` |
| DELETE | `/api/countdowns/{id}` | 已审批会话 | 无 | `200`，`message` |

自定义疫苗计划请求示例：

```json
{
  "vaccine_name": "自定义疫苗",
  "doses": [
    {
      "dose_index": 1,
      "due_date": "2026-12-01",
      "note": "第一剂"
    }
  ]
}
```

`doses[].dose_index` 小于等于 0 时按 1 处理；缺少 `due_date` 的剂次会被跳过。`due_date` 等于当天时写入已完成记录，否则写入自定义计划。

疫苗计划项包含 `name`、`short`、`age_months`、`dose_index`、`note`、`due_date`、`default_due_date`、`status`、`vaccinated_date`、`note_text`、`is_custom`。`status` 为 `done`、`overdue` 或 `upcoming`。健康随访项包含对应的 `label`、`age_months`、`premature_only`、`location`、日期、状态和备注字段。

倒数日对象：

```json
{
  "id": 1,
  "title": "满月",
  "target_date": "2026-12-01",
  "note": "",
  "created_at": "2026-11-23 10:00:00",
  "days_left": 8
}
```

## 用户与运维 API

| 方法 | 路径 | 认证 | 请求 | 成功响应 |
|---|---|---|---|---|
| GET | `/api/users` | 管理员 | 无 | `200`，用户摘要数组 |
| POST | `/api/users/{id}/approve` | 管理员 | 无 | `200`，`message` |
| POST | `/api/users/{id}/reject` | 管理员 | 无 | `200`，`message` |
| DELETE | `/api/users/{id}` | 管理员 | 无 | `200`，`message`；不能删除管理员 |
| PUT | `/api/users/{id}/password` | 管理员 | `password` | `200`，`message` |
| PUT | `/api/users/{id}/username` | 管理员 | `username` | `200`，`message`、`username` |
| GET | `/api/audit-logs` | 管理员 | 可选 `limit` | `200`，审计日志数组 |
| GET | `/api/export/csv` | 管理员 | 无 | `200`，UTF-8 BOM CSV 附件 |
| GET | `/api/backup/export` | 管理员 | 无 | `200`，JSON 备份附件 |
| POST | `/api/backup/restore` | 管理员 | `multipart/form-data` 字段 `file` | `200`，`message`、`counts` |
| POST | `/api/data/clear` | 管理员 | 可选 `date` 或 `_date` | `200`，今日摘要及 `message` |
| GET | `/api/stats` | 已审批会话 | 无 | `200`，统计对象 |

用户摘要包含 `id`、`username`、`nickname`、`role`、`status`、`created_at`。审计日志 `limit` 默认 100，允许 1-500。

统计对象：

```json
{
  "total_records": 120,
  "total_feeds": 80,
  "total_ml": 6400,
  "tracked_days": 14,
  "pending_users": 1
}
```

备份结构：

```json
{
  "version": 1,
  "exported_at": "2026-11-23T10:00:00.123456+08:00",
  "tables": {
    "records": {
      "columns": ["id", "baby_id", "user_id", "type", "sub_type"],
      "rows": []
    }
  }
}
```

允许的表为 `babies`、`records`、`settings`、`users`、`quick_buttons`、`weight_logs`、`vaccine_records`、`vaccine_plan_overrides`、`vaccine_plan_deleted`、`vaccine_custom_plans`、`health_followup_records`、`health_followup_overrides`、`countdown_events`。未知表、未知列、重复列或任何插入错误都会使整次恢复失败并回滚。

`POST /api/data/clear` 只清除记录表，不清除用户、设置、成长、疫苗、健康随访和倒数日数据。

## MCP 控制面 API

| 方法 | 路径 | 认证 | 请求 | 成功响应 |
|---|---|---|---|---|
| GET | `/api/mcp/config` | 管理员 | 无 | `200`，MCP 配置对象 |
| PUT | `/api/mcp/config` | 管理员 | `enabled`、`permission_level`、`acknowledge_full_access` | `200`，配置对象及 `message` |
| GET | `/api/mcp/api-key` | 管理员 | 无 | `200`，`api_key` |
| POST | `/api/mcp/api-key` | 管理员 | 无 | `200`，新的 `api_key` |
| POST/GET/DELETE | `/mcp` | MCP API Key | MCP Streamable HTTP 请求 | MCP 协议响应 |

MCP 配置对象：

```json
{
  "enabled": true,
  "available": true,
  "endpoint": "/mcp",
  "permission_level": "basic",
  "permission_label": "基础",
  "permission_summary": "只读最近 30 天的记录、成长数据和宝宝资料",
  "recent_data_days": 30,
  "full_access_warning": "完全权限允许 MCP 读取全部历史数据并修改业务配置，启用前请先备份数据。",
  "message": "MCP 服务已开启"
}
```

`permission_level` 为 `basic`、`advanced` 或 `full`。从其他档位切换到 `full` 时必须同时提交 `acknowledge_full_access: true`。`POST /api/mcp/api-key` 会轮换密钥并立即使旧密钥失效。

`/mcp` 只接受 `Authorization: Bearer <MCP_API_KEY>`，不使用网页 Cookie、HA API Key 或 URL 查询参数。工具、权限边界和请求示例见 [MCP 功能与权限说明](MCP_PERMISSIONS.md)。

## Home Assistant API

HA 读取接口同样必须鉴权，可使用有效 HA API Key 或已审批网页会话。HA 写入接口只接受有效 HA API Key；即使携带管理员网页会话，也不能替代按钮写入密钥。

| 方法 | 路径 | 认证 | 请求 | 成功响应 |
|---|---|---|---|---|
| GET | `/api/ha/api-key` | 管理员会话 | 无 | `200`，`api_key` |
| POST | `/api/ha/api-key` | 管理员会话 | 无 | `200`，新的 `api_key` |
| GET | `/api/ha/status` | HA Key 或已审批会话 | 可选 `date` | `200`，传感器实体 |
| GET | `/api/ha/feed-today` | HA Key 或已审批会话 | 可选 `date` | `200`，传感器实体 |
| GET | `/api/ha/last-feed` | HA Key 或已审批会话 | 无 | `200`，传感器实体 |
| GET | `/api/ha/excrete-today` | HA Key 或已审批会话 | 可选 `date` | `200`，传感器实体 |
| GET | `/api/ha/buttons` | HA Key 或已审批会话 | 无 | `200`，HA 按钮数组 |
| GET | `/api/ha/button/{id}` | HA Key 或已审批会话 | 无 | `200`，HA 实体；按钮不存在时为 `404` |
| POST | `/api/ha/button/{id}` | HA Key | 无或任意 JSON | `200`，按钮实体及 `record_id` |
| POST | `/api/ha/button/{id}/press` | HA Key | 无或任意 JSON | 同按钮触发接口 |

HA 密钥可放在 `Authorization: Bearer <KEY>`、`X-API-Key: <KEY>` 或 `?api_key=<KEY>`。推荐使用请求头，避免 Key 出现在代理日志和浏览器历史中。

传感器实体统一格式：

```json
{
  "state": 420,
  "attributes": {
    "unit_of_measurement": "ml",
    "friendly_name": "今日奶量",
    "date": "2026-11-23",
    "total_feed_ml": 420,
    "feed_count": 6,
    "target_ml": 500,
    "remaining_ml": 80,
    "feed_progress": 0.84,
    "progress_percent": 84,
    "urine_count": 5,
    "stool_count": 2,
    "last_feed_time": "2026-11-23 09:30:00"
  }
}
```

HA 按钮对象：

```json
{
  "id": 1,
  "label": "配方奶 60ml",
  "type": "feed",
  "sub_type": "formula",
  "amount": 60,
  "icon": "mdi:bottle-soda",
  "state": "off"
}
```

按钮触发成功后返回 `state: "on"` 和 `record_id`，2 秒后状态恢复为 `off`。HA 创建的记录备注为 `[HA]`。完整配置示例见 [Home Assistant 集成指南](ha-integration.md)。
