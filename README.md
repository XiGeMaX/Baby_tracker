<div align="center">

# Baby Tracker

**新生儿与婴幼儿喂养、排泄和成长数据记录系统**

自托管部署，数据默认保存在本机 SQLite 数据库中，支持手机浏览器、PWA 和 Home Assistant。

[![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.0-000000?logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![Docker](https://img.shields.io/badge/GHCR-baby__tracker-2496ED?logo=docker&logoColor=white)](https://github.com/XiGeMaX/Baby_tracker/pkgs/container/baby_tracker)
[![License](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

</div>

## 项目简介

Baby Tracker 是一个面向家庭使用的轻量级婴儿记录应用，覆盖日常喂养、排泄、体重、疫苗、健康随访和倒数日等场景。后端使用 Flask，数据存储使用 SQLite，前端以服务端模板和原生 JavaScript 为主，可以通过 Docker 快速部署到 NAS、家用服务器或云主机。

首次启动会自动创建 SQLite 数据库和默认管理员账户，默认用户名为 `admin`，密码为 `admin123`。正式使用前请立即修改默认密码，并设置独立的 `SECRET_KEY`。

## 功能概览

### 总览仪表盘

- 展示今日奶量、目标奶量、剩余奶量、喂养次数和排泄次数。
- 根据宝宝出生日期、体重和自定义参数估算每日奶量及单次建议奶量。
- 显示最近一次喂养，按全部记录中的最新喂养时间计算，不受当前查询日期影响。
- 提供可排序、可启用的快捷记录按钮，支持喂养、排泄、症状、辅食等记录类型。
- 展示所选日期的记录明细，并支持新增、编辑和删除。

### 拍照识别与批量录入

- 在总览页拍照或从相册选图，前端先用 Canvas 压缩（最长边 1600px、JPEG 0.8），再由后端调用 OpenAI 兼容的 `/chat/completions` 视觉模型提取结构化**候选记录**。
- 识别范围通用：手写记录本、其他 App 截图、奶瓶/尿布实物照都尝试抽取成多条喂养（含辅食）、排泄、症状、补充记录；图片中能读到日期时一并识别并优先采用（读不到则沿用弹窗所选录入日期，不猜测），每条候选带置信度与警告，低置信度行在界面标黄。
- 所有候选进入「总览确认」弹窗，可逐行核对、编辑、勾选、删除，支持多张照片累积与手动添加行，顶部实时汇总共 N 条、将录入 X 条与喂养合计 Y ml。
- **录入前总览确认**：AI 只产候选、不直接写库；确认后一次性 `POST /api/records/batch` 单事务写入，失败整批回滚并记录一条操作日志。
- 批量录入不依赖 AI，可纯手动使用；入口在总览页，所有已登录（approved）用户可用。
- 通过管理页「AI 识别配置」或环境变量切换 OpenAI / 通义千问 / 智谱 GLM-4V / 本地 Ollama（只改 base_url 和 model），详见 [AI 识别配置与使用指南](docs/ai-vision.md)。
- 拍照识别使用标准库 `urllib.request` 与已有 Pillow 完成接口调用和图片压缩，无需新增 Python 依赖。

### 趋势分析

- 体重趋势和体重记录管理。
- 每日喂养量和目标参考线。
- 每日辅食摄入趋势。
- 排尿、排便趋势。
- 单日 24 小时喂养或排泄时段分布。
- 支持 7 天、14 天、30 天等统计范围，图表由 Chart.js 渲染。

### 成长与日程

- 基于 2024 版疫苗计划展示接种进度、剂次和计划日期。
- 支持记录接种日期、备注、自定义疫苗及互斥疫苗方案。
- 提供 0 至 6 岁儿童健康随访计划。
- 支持健康随访记录、自定义随访项目和倒数日。
- 通过日历和列表查看记录、计划和逾期状态。

### 管理与数据

- 用户注册、管理员审批、角色管理和密码管理。
- 宝宝资料、奶量目标、喂养次数和快捷按钮配置。
- 操作日志、数据统计、CSV 导出和 JSON 备份恢复。
- Home Assistant API 密钥管理、实体选择和配置生成向导。

### 使用体验

- 响应式布局，适合手机和桌面浏览器。
- 前端页面切换和移动端底部导航。
- 亮色、暗色主题。
- PWA 安装（含标准/可遮罩图标与桌面快捷方式）、全部页面脚本与样式离线缓存；Tailwind 已本地静态构建，不依赖 CDN。
- 登录会话有效期为 30 天；另提供长期 API Token 供 PWA / 原生客户端调用（见下文）。

## 界面预览

| 总览仪表盘 | 趋势分析 |
| --- | --- |
| ![总览仪表盘](screenshots/dashboard.png) | ![趋势分析](screenshots/trends.png) |

| 成长与日程 | 历史记录 |
| --- | --- |
| ![成长与日程](screenshots/vaccine.png) | ![历史记录](screenshots/history.png) |

## 快速开始

### Docker Compose 部署

仓库未内置 `docker-compose.yml`，请在部署目录中自行创建。下面的配置使用 GitHub Container Registry 中的镜像，并将数据保存到宿主机 `./data`：

```yaml
services:
  baby-tracker:
    container_name: baby_tracker
    image: ghcr.io/xigemax/baby_tracker:latest
    ports:
      - "8964:5000"
    volumes:
      - ./data:/app/data
    environment:
      TZ: Asia/Shanghai
      SECRET_KEY: "please-change-this-secret-key"
    restart: unless-stopped
```

启动服务：

```bash
docker compose up -d
```

更新镜像：

```bash
docker compose pull
docker compose up -d
```

启动后访问 `http://<服务器地址>:8964`。首次启动会创建 `data/baby.db` 和默认管理员账户。

### 本地开发

推荐使用 Python 3.11：

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export SECRET_KEY="local-development-secret"
python app.py
```

开发服务器监听 `0.0.0.0:5000`，本机访问地址为 `http://127.0.0.1:5000`。`app.py` 在直接运行时启用 Flask 调试模式，不应直接用于生产环境。

### 运行测试

```bash
python -m unittest -v
```

测试使用临时数据库，不会修改正常运行时的 `data/baby.db`。

## 配置与数据

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SECRET_KEY` | `baby-tracker-secret-key-change-in-prod` | Flask 会话签名密钥。生产环境必须设置随机且不可公开的值。 |
| `TZ` | Docker 镜像中为 `Asia/Shanghai` | 容器时区，影响记录时间和日期统计。 |
| `FLASK_APP` | Docker 镜像中为 `app.py` | Flask CLI 使用的应用入口，例如执行密码重置命令时使用。 |
| `AI_VISION_BASE_URL` | `https://api.openai.com/v1` | AI 视觉识别服务的 OpenAI 兼容接口地址。优先级高于管理页配置；也可在管理页设置。 |
| `AI_VISION_API_KEY` | 空 | AI 视觉识别服务的 API Key。优先级高于管理页配置；也可在管理页设置。 |
| `AI_VISION_MODEL` | `gpt-4o-mini` | AI 视觉识别使用的模型名。优先级高于管理页配置；也可在管理页设置。 |
| `AI_VISION_MAX_TOKENS` | 不设置（使用服务商默认） | 单次响应最大输出 token。默认不下发该参数，由服务商/模型决定；记录较多时可在管理页「AI 识别配置」或此变量中显式设置（256~32768）。 |
| `AI_VISION_TIMEOUT` | 不设置（不限时） | 单次 AI 请求的超时秒数。默认不设超时，避免长耗时识别被提前中断；如需保护可设为如 `120`。 |
| `AI_VISION_LOG_LEVEL` | `INFO` | AI 识别日志级别（`DEBUG` / `INFO` / `WARNING` / `ERROR`）。 |
| `AI_VISION_LOG_RAW` | `1` | 是否记录模型原始返回内容。设为 `0` 只记录摘要（请求、耗时、条数、告警），适合不希望落库记录内容的场景。 |
| `AI_VISION_LOG_MAX_CHARS` | `4000` | 单条日志中原始返回内容的最大字符数，超出部分截断。 |

### SQLite 持久化

运行数据库固定为 `data/baby.db`，应用首次启动时自动创建。Docker 部署必须挂载 `/app/data`，否则重建容器后数据会丢失。

### AI 识别日志

AI 拍照识别的调用与返回会写入日志，便于排查「识别失败 / 结果不准 / 返回非 JSON」等问题：

- **输出位置**：容器标准输出（`docker logs baby_tracker`）+ `data/ai_vision.log`（随 `data` 卷持久化，5MB × 3 份滚动）；
- **记录内容**：请求地址与模型、耗时、HTTP 状态、模型原始返回内容、逐条解析结果（类型/时间/告警）、失败原因；
- **不记录**：图片本身、API Key（日志中会做脱敏）；
- **在线查看**：管理页 → 「AI 识别日志」卡片，管理员可直接查看最近 100/200/500 行，或调用 `GET /api/ai/logs?lines=200`。

SQLite 启用了 WAL 模式，数据库运行时可能同时存在 `baby.db-wal` 和 `baby.db-shm` 文件。推荐使用管理面板中的 JSON 备份功能；如果直接复制数据库文件，应先停止容器，确保 WAL 中的数据已写入主数据库。

## Home Assistant 集成

管理界面提供 Home Assistant 配置向导，可生成传感器、开关和 API 密钥配置。完整说明见 [Home Assistant 集成指南](docs/ha-integration.md)。

### 传感器

只读传感器无需 API 密钥，统一返回 `state` 和 `attributes`：

| 端点 | 说明 |
| --- | --- |
| `GET /api/ha/status` | 今日奶量、目标、进度和排泄概览 |
| `GET /api/ha/feed-today` | 今日喂养详情 |
| `GET /api/ha/last-feed` | 最近一次喂养 |
| `GET /api/ha/excrete-today` | 今日排泄详情 |

### 快速记录开关

每个启用的快捷按钮会对应一个 HA REST 开关：

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

快速记录接口支持 `Authorization: Bearer <API_KEY>` 和 `X-API-Key: <API_KEY>` 请求头。旧版 `?api_key=` 参数仍兼容，但新配置应使用请求头。开关打开后执行记录，状态保持 `on` 约 2 秒，随后自动恢复为 `off`。

## API 概览

所有业务接口位于 `/api` 下，返回 JSON；CSV、JSON 备份和文件下载接口除外。管理端接口使用 Flask 登录会话或长期 API Token，Home Assistant 快速记录接口使用独立的 API 密钥。API 响应禁用浏览器缓存，避免读取过期的统计数据。

| 范围 | 主要端点 | 说明 |
| --- | --- | --- |
| 认证 | `/api/auth/login`、`/api/auth/logout`、`/api/auth/register`、`/api/auth/me`、`/api/auth/token` | 登录、退出、注册、当前用户信息和长期 API Token 签发 |
| 快捷记录 | `/api/quick-buttons`、`/api/quick-record/<id>` | 快捷按钮管理和一键记录 |
| 日常记录 | `/api/records`、`/api/records/<id>`、`/api/records/today` | 记录查询、新增、修改和删除 |
| 宝宝与设置 | `/api/baby`、`/api/settings`、`/api/milk-estimate` | 宝宝资料、系统设置和奶量估算 |
| 统计与体重 | `/api/stats`、`/api/stats/trends`、`/api/weight-logs` | 首页统计、趋势数据和体重记录 |
| 疫苗与健康 | `/api/vaccine/*`、`/api/health/*`、`/api/countdowns` | 疫苗、随访和倒数日 |
| 用户与审计 | `/api/users/*`、`/api/audit-logs` | 用户审批、管理和操作日志 |
| 数据管理 | `/api/export/csv`、`/api/backup/export`、`/api/backup/restore` | 导出、备份和恢复 |
| AI 识别 | `/api/ai/status`、`/api/ai/config`、`/api/ai/recognize`、`/api/ai/logs` | 配置读取、通用配置管理、拍照识别（返回候选记录，不入库）与识别日志查看 |
| 批量录入 | `/api/records/batch` | 总览确认后一次性写入多条记录，单事务、失败整批回滚 |
| Home Assistant | `/api/ha/status`、`/api/ha/last-feed`、`/api/ha/button/<id>` | HA 传感器和快速记录开关 |

### API Token（PWA / 原生客户端）

除浏览器会话 Cookie 外，所有 `/api/*` 同时接受 `Authorization: Bearer <token>`：

```bash
# 1. 先用浏览器会话登录，再签发长期 token（有效期 30 天，与会话一致）
curl -X POST -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"******"}' http://<服务器>/api/auth/login
curl -X POST -b cookies.txt http://<服务器>/api/auth/token

# 2. 之后无需 Cookie，直接携带 token 访问任意 /api/* 接口
curl -H 'Authorization: Bearer <TOKEN>' http://<服务器>/api/records/today
```

Token 基于 `SECRET_KEY` 对 `user_id` 签名，不写入数据库、不进入 JSON 备份；修改 `SECRET_KEY` 会使所有已签发 token 失效。用户被删除或状态不再是「已批准」时 token 立即失效。`/api/ha/button/<id>` 仍只认独立的 HA API 密钥，与用户 token 互不影响。

## 项目结构

```text
.
├── app.py                                  # Flask 应用入口、数据库初始化、页面路由和 REST API
├── ai_service.py                           # AI 视觉识别服务：OpenAI 兼容调用、结果解析与归一化
├── requirements.txt                        # Python 运行依赖
├── tailwind.config.js                      # Tailwind 本地构建配置（扫描模板与 JS 生成静态 CSS）
├── tailwind.input.css                      # Tailwind 构建入口（@tailwind 指令）
├── Dockerfile                              # Python 3.11 + Gunicorn 生产镜像
├── .dockerignore                           # Docker 构建排除规则
├── .gitignore                              # Git 排除规则，包含运行数据
├── LICENSE                                 # GNU GPL v3.0 许可证
├── README.md                               # 项目说明
├── .github/
│   └── workflows/
│       └── docker-publish.yml              # 构建并发布 Docker Hub / GHCR 镜像
├── docs/
│   ├── ha-integration.md                   # Home Assistant 集成与 API 指南
│   ├── ai-vision.md                        # AI 识别配置与使用指南
│   ├── vaccine-schedule-2024.xlsx          # 2024 版疫苗计划源数据
│   └── 0-6岁儿童健康随访预约卡.xlsx         # 健康随访计划源数据
├── templates/
│   ├── base.html                           # 页面骨架、导航和公共资源
│   ├── dashboard.html                      # 总览仪表盘
│   ├── trends.html                         # 趋势分析
│   ├── vaccine.html                        # 疫苗、健康随访和倒数日
│   ├── admin.html                          # 用户、设置、数据和 HA 管理
│   ├── login.html                          # 登录页
│   └── register.html                       # 注册页
├── static/
│   ├── css/
│   │   ├── style.css                       # 全局样式、主题和响应式布局
│   │   └── tailwind.css                    # Tailwind CLI 本地构建产物（已提交，运行时不依赖 CDN）
│   ├── icons/                              # PWA 图标（192/512 标准 + 512 maskable）
│   ├── js/
│   │   ├── app.js                          # 公共交互、请求和通知
│   │   ├── spa.js                          # 页面切换与路由处理
│   │   ├── dashboard.js                    # 总览页数据与记录交互
│   │   ├── batch.js                        # 拍照压缩、总览确认与批量提交
│   │   ├── trends.js                       # 图表和体重记录
│   │   ├── vaccine.js                      # 疫苗、随访和倒数日
│   │   └── admin.js                        # 管理面板和 HA 配置生成
│   ├── manifest.json                       # PWA 清单
│   └── sw.js                               # Service Worker
├── tests/
│   ├── __init__.py
│   └── test_api.py                         # 核心 API 回归测试
├── screenshots/
│   ├── dashboard.png                       # 总览界面截图
│   ├── trends.png                          # 趋势界面截图
│   ├── vaccine.png                         # 成长与日程截图
│   └── history.png                         # 历史记录截图
└── data/                                   # 运行时目录，不纳入 Git
    └── baby.db                             # SQLite 数据库，首次启动时创建
```

### 目录职责

- `app.py`：当前项目的主要后端入口。包含数据表初始化、兼容旧数据库的迁移逻辑、认证与权限、CLI 命令、页面路由，以及记录、统计、疫苗、健康、备份和 HA 等 REST API。
- `ai_service.py`：AI 视觉识别服务，负责 OpenAI 兼容 `/chat/completions` 接口调用、返回结果解析与候选记录归一化，只产候选不写库。
- `templates/`：Jinja2 页面模板。`base.html` 统一加载导航、本地构建的 `tailwind.css`、Lucide、公共脚本和 PWA Service Worker，其余模板对应四个主要功能页面及登录注册页。
- `tailwind.config.js` / `tailwind.input.css`：Tailwind 本地构建配置与入口，产物为 `static/css/tailwind.css`（已提交仓库）。修改样式类名后需重建：`npx tailwindcss@3.4.17 -c tailwind.config.js -i tailwind.input.css -o static/css/tailwind.css --minify`。
- `static/`：浏览器端资源和 PWA 文件。每个主要页面有独立脚本，`app.js` 与 `spa.js` 提供公共能力和页面切换；`static/js/batch.js` 负责拍照压缩、总览确认弹窗与批量提交；`static/icons/` 提供 PWA 安装图标；`sw.js` 预缓存全部页面脚本、样式与图标并让离线 API 请求明确失败。
- `docs/`：Home Assistant 集成文档、AI 识别配置与使用指南（`docs/ai-vision.md`）及两个业务计划表。Excel 文件是疫苗和健康随访计划的资料来源。
- `tests/`：基于 Flask 测试客户端的 API 回归测试，覆盖记录、HA 传感器、最新一次喂养和 HA 快速记录认证。
- `.github/workflows/`：推送 `main`、`master` 或发布 Release 时构建镜像，并推送到配置好的 Docker Hub 仓库和 `ghcr.io/xigemax/baby_tracker`。
- `data/`：运行数据目录，不提交到 Git。Docker 部署时应将宿主机目录挂载到容器的 `/app/data`。

## 技术架构

| 层级 | 实现 |
| --- | --- |
| 后端 | Python 3.11、Flask 3.0、Werkzeug |
| 数据存储 | SQLite，启用 WAL 模式和按查询字段建立索引 |
| 页面渲染 | Jinja2 模板 |
| 前端 | 原生 JavaScript、Tailwind CSS（本地静态构建产物，不依赖 CDN） |
| 图表与图标 | Chart.js、Lucide |
| PWA | Web App Manifest（含标准/可遮罩图标与桌面快捷方式）、Service Worker 离线缓存 |
| 认证 | Flask 会话 Cookie（`SameSite=Lax`）+ 基于 `SECRET_KEY` 签名的长期 Bearer Token |
| 拍照识别 | 标准库 `urllib.request` 调用 OpenAI 兼容视觉接口 + 已有 Pillow 压缩图片，无需新增依赖 |
| 生产服务 | Gunicorn，2 workers、timeout 120s，监听 `0.0.0.0:5000` |
| 容器与发布 | Docker、GitHub Actions、GHCR、Docker Hub |

## 运维与安全

- 修改默认管理员密码，并为生产环境设置高强度 `SECRET_KEY`。**修改 `SECRET_KEY` 会使所有登录会话与已签发的 API Token 全部失效**。
- 不要把服务直接暴露到公网。需要远程访问时，建议使用 HTTPS 反向代理、VPN 或仅允许可信网络访问；当前会话 Cookie 刻意未设置 `Secure` 以兼容 HTTP 局域网访问，若已启用 HTTPS 反向代理可按需覆盖 `SESSION_COOKIE_SECURE`。
- 为 Home Assistant API 密钥设置合理的存放方式，推荐使用 HA 的 `secrets.yaml`。
- AI API Key 不会出现在 JSON 备份中：密钥保存在 settings 表、管理页只显示掩码，且管理面板的 JSON 备份导出会过滤掉 API Key。
- 使用第三方 AI 服务时，待识别的图片会发送给该服务商；内网或隐私敏感场景建议改用本地 Ollama，详见 [AI 识别配置与使用指南](docs/ai-vision.md)。
- 定期通过管理面板导出 JSON 备份，并确认挂载的 `data` 目录可恢复。
- 用户审批、API 密钥变更、数据导出和恢复等操作可在操作日志中追溯。

忘记管理员密码时，可在运行中的容器内执行：

```bash
docker exec baby_tracker flask reset-password
```

该命令会生成一个随机密码并输出到终端。登录后请立即修改。

## 参与开发

1. 从 `main` 创建功能分支。
2. 保持改动范围清晰，并同步补充相关 API 测试。
3. 提交前运行 `python -m unittest -v`。
4. 通过 Pull Request 说明变更内容、验证方式和可能的影响。

## 许可证

本项目使用 [GNU General Public License v3.0](LICENSE)。
