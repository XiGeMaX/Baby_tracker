# Baby Tracker - Home Assistant 集成指南

通过管理面板的 HA 配置向导，4 步即可完成 Home Assistant 集成，在 HA 仪表盘中查看宝宝数据并远程记录。

---

## 快速配置（管理面板向导）

### 步骤 1：生成 API 密钥

1. 登录管理面板，滚动到「Home Assistant 集成」区域
2. 点击「生成」按钮生成 API 密钥
3. 点击「复制」保存密钥

> 密钥用于快速记录接口认证，重新生成后旧密钥立即失效。

### 步骤 2：填写服务地址

输入 Baby Tracker 在局域网中的 IP 地址和端口（默认 `8964`），HA 需能访问此地址。

### 步骤 3：选择需要的实体

按需勾选传感器（只读）和开关（可远程记录）：

- **传感器**：今日奶量概览、今日喂养详情、上次喂养、今日排泄
- **开关**：每个启用的快速记录按钮对应一个 HA 开关

### 步骤 4：生成配置代码

点击「生成配置代码」按钮，根据勾选项自动生成完整 YAML 配置，点击「复制」粘贴到 HA 的 `configuration.yaml` 中，重启或 reload HA 即可生效。

> 建议将 API 密钥存入 HA 的 `secrets.yaml`，使用 `!secret baby_tracker_api_key` 引用，避免明文暴露。

---

## 手动配置

如果不使用向导，可按以下步骤手动配置。

### 认证方式

快速记录接口需要 API 密钥，通过以下任一方式传递：

| 方式 | 格式 |
|---|---|
| URL 参数 | `?api_key=<YOUR_API_KEY>` |
| HTTP 头 | `Authorization: Bearer <YOUR_API_KEY>` |
| HTTP 头 | `X-API-Key: <YOUR_API_KEY>` |

> 传感器接口（只读）无需密钥。

### 传感器配置

```yaml
sensor:
  - platform: rest
    name: "宝宝今日奶量"
    resource: "http://<IP>:8964/api/ha/status"
    value_template: "{{ value_json.state }}"
    unit_of_measurement: "ml"
    json_attributes_path: "$.attributes"
    json_attributes:
      - total_feed_ml
      - feed_count
      - target_ml
      - remaining_ml
      - feed_progress
      - urine_count
      - stool_count
      - last_feed_time
      - estimated_feeds_left
      - per_feed_ml
    scan_interval: 300

  - platform: rest
    name: "宝宝今日排泄"
    resource: "http://<IP>:8964/api/ha/excrete-today"
    value_template: "{{ value_json.state }}"
    json_attributes_path: "$.attributes"
    json_attributes:
      - urine_count
      - stool_count
      - total_count
    scan_interval: 300
```

### 开关配置

每个快速按钮对应一个 REST 开关，打开即记录一次，2 秒后自动回弹关闭：

```yaml
switch:
  - platform: rest
    name: "喂养-母乳30ml"
    resource: "http://<IP>:8964/api/ha/button/1"
    body_on: '{"state":"on"}'
    body_off: '{"state":"off"}'
    is_on_template: "{{ value_json.state == 'on' }}"
    headers:
      Authorization: "Bearer <YOUR_API_KEY>"
      Content-Type: application/json
    scan_interval: 5
```

**关键说明：**
- `resource` 末尾数字是按钮 ID（从 `/api/ha/buttons` 获取）
- HA 打开开关时 POST 到 `resource` URL 触发记录
- 记录成功后状态保持 `on` 2 秒，自动回弹 `off`
- API 密钥通过 `Authorization: Bearer` 或 `X-API-Key` 请求头传递，也兼容旧的 URL 参数

---

## 仪表盘卡片示例

```yaml
type: entities
title: 宝宝喂养
entities:
  - sensor.bao_bao_jin_ri_nai_liang
  - switch.wei_yang_mu_ru30ml
  - switch.wei_yang_pei_fang_nai60ml
  - switch.pai_xie_pai_niao
```

Markdown 卡片：

```yaml
type: markdown
content: |
  ## 🍼 今日喂养
  **奶量**: {{ state_attr('sensor.bao_bao_jin_ri_nai_liang', 'total_feed_ml') }} / {{ state_attr('sensor.bao_bao_jin_ri_nai_liang', 'target_ml') }} ml
  **次数**: {{ state_attr('sensor.bao_bao_jin_ri_nai_liang', 'feed_count') }} 次
  **剩余**: {{ state_attr('sensor.bao_bao_jin_ri_nai_liang', 'remaining_ml') }} ml ({{ state_attr('sensor.bao_bao_jin_ri_nai_liang', 'estimated_feeds_left') }} 次)
  **排尿**: {{ state_attr('sensor.bao_bao_jin_ri_nai_liang', 'urine_count') }} 次 | **排便**: {{ state_attr('sensor.bao_bao_jin_ri_nai_liang', 'stool_count') }} 次
  **上次喂养**: {{ state_attr('sensor.bao_bao_jin_ri_nai_liang', 'last_feed_time') or '暂无' }}
```

---

## API 参考

HA 传感器接口统一返回实体结构：

```json
{
  "state": 420,
  "attributes": {
    "unit_of_measurement": "ml",
    "feed_count": 6,
    "target_ml": 500,
    "urine_count": 5,
    "stool_count": 2
  }
}
```

HA 配置应使用 `value_json.state` 读取主状态，并通过 `json_attributes_path: "$.attributes"` 读取属性。`date=YYYY-MM-DD` 参数可指定需要查询的日期。

### 传感器 API（无需认证）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/ha/status` | GET | 今日概览（奶量、排泄、进度） |
| `/api/ha/feed-today` | GET | 今日喂养详情 |
| `/api/ha/last-feed` | GET | 上次喂养信息 |
| `/api/ha/excrete-today` | GET | 今日排泄详情 |

### 开关 API

| 端点 | 方法 | 认证 | 说明 |
|---|---|---|---|
| `/api/ha/buttons` | GET | 不需要 | 获取所有启用按钮列表 |
| `/api/ha/button/<id>` | GET | 不需要 | 查询按钮状态（HA 轮询） |
| `/api/ha/button/<id>` | POST | **需要** | 触发记录（HA 开关打开时调用） |
| `/api/ha/button/<id>/press` | POST | **需要** | 触发记录（备用端点） |

### 密钥管理 API（仅管理员）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/ha/api-key` | GET | 查看当前 API 密钥 |
| `/api/ha/api-key` | POST | 生成新密钥（旧密钥立即失效） |

### 开关工作流程

```
HA 打开开关 → POST /api/ha/button/<id>
              Authorization: Bearer <KEY>
                ↓
         验证 API 密钥
         ┌─ 无效 → 返回 401 未授权
         └─ 有效 ↓
         创建记录（备注标记 [HA]）
         日志记录：用户 HA/<admin>，操作 HA快速记录
         返回 state: "on"
                ↓
         2 秒后状态自动变为 "off"
                ↓
HA 轮询 GET /api/ha/button/<id> → state: "off"
                ↓
         开关自动回弹关闭
```

---

## 注意事项

1. **API 密钥安全**：密钥等同于操作权限，请勿公开分享。重新生成后旧密钥立即失效，需同步更新 HA 配置
2. **按钮 ID 对应**：管理面板中添加/删除按钮后，按钮 ID 可能变化，需同步更新 HA 配置
3. **扫描间隔**：建议 `scan_interval: 5`，太频繁会增加服务器负担，太慢则开关回弹不及时
4. **网络**：确保 HA 能访问 Baby Tracker 的 IP 和端口
5. **时区**：Baby Tracker 容器已设置 `TZ=Asia/Shanghai`，API 返回的时间为北京时间
6. **密钥存储**：建议将 API 密钥存入 HA 的 `secrets.yaml`，避免在配置文件中明文暴露
7. **记录标识**：通过 HA 创建的记录，备注栏自动标记 `[HA]`，操作日志显示 `HA/<管理员昵称>`
