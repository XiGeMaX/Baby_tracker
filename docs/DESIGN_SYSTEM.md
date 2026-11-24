# Baby Tracker 界面设计标准

本文件是 Baby Tracker 前端界面的规范来源。新增或修改页面、组件、模板和动态生成内容时，必须遵守以下约束。视觉变量定义在 `static/css/style.css` 顶部，优先使用现有 CSS 变量和共享类，不在业务模板中另立字号、圆角、动效或控件样式。

## 1. 设计原则

- 以高频记录、快速扫描和重复操作为优先，不使用营销页式的大标题、装饰性卡片或无关动效。
- 页面层级只通过字号、字重、颜色和间距建立，不通过放大单个页面的标题来强调。
- 控件外观由应用主题统一提供。用户不应看到操作系统的下拉框、日期选择器、时间选择器或文件选择器外观。
- 相同的语义使用相同的组件和状态。危险操作、主操作、次操作和紧凑操作分别使用 `btn-danger`、`btn-primary`、`btn-secondary` 和对应紧凑尺寸。
- 所有交互必须支持键盘、触控、减少动态效果和高对比度环境。

## 2. 字体与字号

只使用以下语义字号。业务代码不得直接写入新的 `font-size` 数值，图表内部刻度等特殊场景除外。

| 语义 | 变量 | 字号 | 行高 | 用途 |
| --- | --- | ---: | ---: | --- |
| 页面标题 | `--text-page-title` | 20px | 1.25 | 总览、趋势、成长、管理、认证页标题 |
| 对话框/局部标题 | `--text-title` | 16px | 1.25 | 弹窗标题、主要分组标题 |
| 区块标题 | `--text-section` | 14px | 1.4 | 卡片和配置区标题 |
| 正文 | `--text-body` | 14px | 1.5 | 按钮、输入、正文、列表主信息 |
| 标签 | `--text-label` | 12px | 1.4 | 表单标签、辅助按钮、状态文字 |
| 元数据 | `--text-meta` | 11px | 1.4 | 日期、计数、版本、图表图例 |

字重只使用 `400`、`500`、`600`、`700`。页面标题使用 `600`，正文使用 `400`，标签和紧凑控件使用 `500`，主操作使用 `600`。字间距固定为 `0`，不使用负字间距。

## 3. 页面结构

- 页面根容器使用 `app-page`，需要固定垂直节奏时按其间距排列。
- 页面头部使用 `page-header`，标题容器使用 `page-heading`。
- 页面标题固定使用 `page-title`，所有页面的主标题必须保持同一字号和字重。
- 页面说明使用 `page-subtitle`，日期或范围元数据额外使用 `page-meta`。
- 右侧操作统一放入 `page-actions`。移动端允许换行，但不得挤压或覆盖标题。
- 卡片使用 `card` 或已有的语义卡片类。卡片内部只再分区块，不把卡片嵌套在卡片中作为装饰。
- 管理页的数据概览使用 `admin-data-metrics` 作为单一统计条；指标之间只用分隔线区分，不拆成多张带边框的小卡片。
- 数据相关操作使用 `admin-data-actions` 排列，桌面端等宽四列、移动端等宽两列。危险操作固定在操作组末尾，不单独放大或改变控件形状。

认证页沿用 `page-title`、`page-subtitle`、`card`、`field-label` 和 `input-field`，不建立独立的字号体系。

## 4. 间距与尺寸

间距只使用 `--space-1` 到 `--space-6`，分别为 4、8、12、16、20、24px。

- 控件标准高度：`--control-height`，40px。
- 紧凑控件高度：`--control-height-sm`，32px。
- 主要触控高度：`--control-height-lg`，44px。
- 页面和卡片间距优先使用 16px 或 20px。
- 移动端所有触控目标至少 32px，主操作应达到 40px 或以上。
- 固定格式元素应设置稳定宽高或最小尺寸，避免状态切换时布局跳动。

## 5. 圆角与层级

| 语义 | 变量 | 数值 |
| --- | --- | ---: |
| 小状态块/分段选中块 | `--radius-xs` | 6px |
| 输入框、按钮、列表操作 | `--radius-control` | 8px |
| 卡片、浮层 | `--radius-card` | 12px |
| 对话框 | `--radius-dialog` | 16px |
| 真实胶囊状态 | `--radius-pill` | 999px |

普通按钮、输入框和卡片不得使用全圆角。`rounded-full` 只用于头像、状态点、进度轨道、进度条和确实是胶囊语义的标签。

页面浮层使用 `--shadow-float`，对话框使用 `--shadow-dialog`。不得在模板中临时拼接新的阴影值。

## 6. 统一主题控件

可交互控件必须使用以下规则：

- 可见下拉框：使用 `select.input-field`，由 `static/js/theme-controls.js` 提升为 `.ui-select-trigger`。
- 可见日期框：使用 `input[type="date"].input-field`，提升为 `.ui-date-trigger`。
- 可见时间框：使用 `input[type="time"].input-field`，提升为 `.ui-time-trigger`。
- 时间选择必须使用上下循环滚轮，当前值固定在中心并保持明确选中态；点击、滚动和键盘选择后都应平滑吸附到中心。
- 可见文件框：使用 `input[type="file"].input-field`，提升为 `.ui-file-trigger`。
- 数字、文本、密码和备注输入使用 `input-field`。
- 复选框使用已完成主题化的原生输入，不另造不可访问的视觉替身。

原生 `select`、`date`、`time`、`file` 元素保留为数据和表单兼容层，但增强后必须不可见、不可聚焦，并由主题触发按钮承担键盘和触控交互。不得通过透明覆盖层直接唤起系统选择器。

趋势页已有的 `.range-pill` 应用内菜单和月历是专用模式，可以保留其触发按钮，但底层的 `range-native` 必须保持不可见且不进入 Tab 顺序。

所有表单标签使用 `field-label`，并通过 `for` 指向控件。控件包裹在标签内时，不得同时嵌套按钮。错误信息使用 `form-error` 和 `role="alert"`。

## 7. 按钮

- 主操作：`btn-primary`，每个视图或对话框原则上只有一个。
- 次操作：`btn-secondary`。
- 危险操作：`btn-danger`。
- 紧凑按钮：在按钮类上增加 `text-xs`，高度自动使用 32px。
- 图标按钮必须提供 `aria-label` 和可见的悬停说明，优先使用 Lucide 图标。
- 不得新增一类仅改变背景、圆角或动效的临时按钮。

按钮最小高度为 40px，紧凑按钮为 32px。按钮文字保持单行，长文本使用自适应布局而不是缩小字号。

## 8. 分段、标签和状态

- 页面模式切换使用 `trend-segment` 或现有分段控件。
- 页签使用 `growth-tabs` 和 `growth-tab`。
- 过滤项使用 `filter-pill`，选中状态不得只依赖颜色，应同时提供文字状态或 `aria-pressed`。
- 全部日程的八个分类固定使用 `schedule-filter-grid` 显示为四列两行，不得依赖断点或内容宽度改变行列数。
- 状态标签使用现有 `badge-*` 或 `admin-status-pill` 语义类。
- 疫苗剂次计划使用 `growth-dose-grid` 和 `vaccine-plan-button`，所有剂次按钮保持等高、等宽和相同圆角，状态只通过语义色区分。
- 数值、日期、版本使用 `font-mono` 或 `page-meta`，保持等宽数字。
- 数据统计条内的数值使用 `admin-data-value`，标签使用 `admin-data-label`；不得在业务模板中另写字号、字重或等宽字体。

## 9. 对话框

对话框必须使用以下结构：

```html
<div id="example-modal" class="app-modal hidden items-center justify-center"
     role="dialog" aria-modal="true" aria-labelledby="example-modal-title">
    <div class="app-modal-panel">
        <h3 id="example-modal-title" class="app-modal-title">标题</h3>
        <!-- 表单内容 -->
        <div class="modal-actions">
            <button type="button" class="btn-secondary">取消</button>
            <button type="button" class="btn-primary">保存</button>
        </div>
    </div>
</div>
```

- 打开和关闭统一调用 `openAppModal()` 与 `closeAppModal()`。
- 打开时先移除 `hidden` 并进入 `is-open`；关闭时先进入 `is-closing`，动画结束后再恢复 `hidden`，因此重新打开可以安全打断尚未完成的退场。
- Escape、点击遮罩和关闭按钮必须得到相同行为。
- 打开时焦点进入首选控件，关闭时回到触发元素。
- Tab 焦点在对话框内循环。
- 打开对话框时锁定页面滚动。
- 对话框宽度由 `app-modal-panel` 控制，业务模板不覆盖宽度、内边距、圆角、背景或阴影。
- 移动端对话框贴近底部安全区，内容过高时只滚动面板本身。
- 对话框标题、正文、字段标签和操作按钮沿用统一语义字号，不因所在页面或弹窗类型另立尺寸。

## 10. Toast 通知

- 全局只使用一个 `toast-stack`，由 `showToast(message, type)` 创建条目。不要为单个页面另造通知条或弹窗。
- Toast 默认出现在桌面右上角、移动端顶部居中，并在所有方向叠加安全区偏移；顶部间距必须避开刘海、灵动岛和挖孔，横屏时同时避让左右安全区。
- 同时最多展示 3 条。最新一条位于最前并完整显示，较旧条目以 10px 阶梯、轻微缩放和降低透明度形成半覆盖堆叠。
- 每条 Toast 独立计时和退场；某条消失后，其余条目必须从当前位置连续归位，不重新播放整组入场动画。
- 主状态使用 `success`，普通信息使用 `info`，表单校验使用 `warning`，请求或操作失败使用 `error`。图标统一使用 Lucide：`check-circle`、`info`、`triangle-alert`、`circle-alert`。
- 内容使用 `--text-body`、`--weight-medium` 和 `--line-body`，允许自然换行，不截断、不显示省略号。
- 容器背景使用 `--c-surface` 的半透明材质，边框使用 `--c-border-hover`，阴影使用 `--shadow-float`，圆角使用 `--radius-card`。
- Toast 不抢占焦点，不使用系统控件。`success`、`info` 和 `warning` 通过礼貌播报；`error` 使用即时播报，但不得打断当前输入。
- `prefers-reduced-motion` 下取消位移与缩放，仅保留短促透明度变化；`prefers-reduced-transparency` 或 `prefers-contrast: more` 下使用不透明表面并移除模糊。

```js
showToast('记录已更新');
showToast('保存失败，请重试', 'error');
```

## 11. 动效

只使用以下时间变量：

- `--motion-fast`：120ms，按钮按压、选择反馈。
- `--motion-standard`：180ms，颜色、边框、透明度和状态变化。
- `--motion-slow`：240ms，浮层、对话框和面板进入。
- `--motion-out`：主要交互曲线。
- `--motion-snappy`：短距离状态反馈。
- `--motion-exit`：退场曲线。

不得使用 `transition: all`。明确列出会变化的属性，通常是 `color`、`background-color`、`border-color`、`box-shadow`、`opacity`、`transform`/`scale` 和可预期的尺寸属性。

进入动效从轻微缩放和位移开始，退场更快。按压反馈只做轻微缩放。不得让重复数据刷新造成整页闪烁或大幅移动。

应用内菜单、日历和时间选择浮层必须锚定触发元素，使用计算后的稳定宽度，并在靠近视口边缘或移动端底部时自动调整位置。浮层内容宽度跟随浮层，不得伸缩到超出视口。

`prefers-reduced-motion: reduce` 下，动画和过渡缩短到 1ms，平滑滚动关闭。减少透明度或高对比度偏好下，浮层使用不透明背景并移除模糊。

## 12. 响应式与安全区

- 页面主体使用受约束宽度并保留移动端边距。
- 页面标题在所有断点保持 20px，不通过 `clamp()` 随视口放大。
- 移动端标题与操作区可以换行，但文字不得覆盖后续内容。
- 顶部 Toast 必须叠加 `env(safe-area-inset-top)`，并同时避让左右安全区；底部固定按钮和底部对话框必须叠加 `env(safe-area-inset-bottom)`。
- 横向溢出优先通过换行、分组或滚动容器解决，不压低全局字号。

## 13. 可访问性与验证

提交界面前至少验证：

1. 所有可见输入都有可访问名称。
2. 所有主题选择器都能用 Tab、Enter、Space、方向键和 Escape 操作。
3. 深色和浅色主题下文字、边框、焦点环和危险状态均清晰可见。
4. 桌面与 375px 宽移动视口无文字遮挡或控件溢出。
5. 对话框焦点进入、焦点循环、关闭后焦点恢复。
6. `prefers-reduced-motion` 下没有必须等待的长动画。
7. 页面中不存在可见的系统原生日期、时间、文件或下拉选择界面。

## 14. 静态资源版本

- 公共样式和页面脚本必须通过模板中的 `asset_version` 查询参数加载，避免浏览器缓存导致 HTML、CSS 和 JavaScript 版本错配。
- 修改 `static/css/style.css`、`static/js/` 下的页面脚本或 `static/sw.js` 时，必须同步递增 `internal/app/server.go` 中的 `assetVersion`；Service Worker 缓存名也要同步更新。
- 页面不应依赖未带版本参数的业务样式或页面脚本 URL。

用户可见的界面规则变更必须同步记录到 `CHANGELOG.md`。
