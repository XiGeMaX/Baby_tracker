from pathlib import Path

from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.chart.text import RichText
from openpyxl.comments import Comment
from openpyxl.drawing.text import (
    CharacterProperties,
    Font as DrawingFont,
    Paragraph,
    ParagraphProperties,
    RegularTextRun,
)
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.page import PageMargins


OUTPUT = Path(__file__).resolve().parents[1] / "docs" / "trends-redesign-plan.xlsx"

ACCENT = "0F766E"
ACCENT_DARK = "134E4A"
ACCENT_SOFT = "E7F4F1"
INK = "1F2937"
MUTED = "64748B"
LINE = "D7E0E4"
SURFACE = "F8FAFB"
WHITE = "FFFFFF"
AMBER_SOFT = "FFF4DC"
AMBER = "B45309"

THIN_BORDER = Border(
    left=Side(style="thin", color=LINE),
    right=Side(style="thin", color=LINE),
    top=Side(style="thin", color=LINE),
    bottom=Side(style="thin", color=LINE),
)


def font(size=10, bold=False, color=INK):
    return Font(name="Arial", size=size, bold=bold, color=color)


def fill(color):
    return PatternFill("solid", fgColor=color)


def chart_text(size=9, bold=False, text=""):
    properties = CharacterProperties(
        latin=DrawingFont(typeface="Arial"),
        ea=DrawingFont(typeface="Arial"),
        sz=size * 100,
        b=bold,
    )
    runs = [RegularTextRun(rPr=properties, t=text)] if text else None
    return RichText(
        bodyPr=None,
        p=[
            Paragraph(
                pPr=ParagraphProperties(defRPr=properties),
                endParaRPr=properties,
                r=runs,
            )
        ],
    )


def style_title(ws, title, subtitle, last_column):
    last_letter = get_column_letter(last_column)
    ws.merge_cells(f"A1:{last_letter}1")
    ws.merge_cells(f"A2:{last_letter}2")
    ws["A1"] = title
    ws["A1"].font = font(20, True, WHITE)
    ws["A1"].fill = fill(ACCENT_DARK)
    ws["A1"].alignment = Alignment(vertical="center")
    ws.row_dimensions[1].height = 34
    ws["A2"] = subtitle
    ws["A2"].font = font(9, color=MUTED)
    ws["A2"].fill = fill(ACCENT_SOFT)
    ws["A2"].alignment = Alignment(vertical="center")
    ws.row_dimensions[2].height = 24


def style_section(ws, row, title, last_column):
    last_letter = get_column_letter(last_column)
    ws.merge_cells(f"A{row}:{last_letter}{row}")
    cell = ws[f"A{row}"]
    cell.value = title
    cell.font = font(11, True, ACCENT_DARK)
    cell.fill = fill(ACCENT_SOFT)
    cell.alignment = Alignment(vertical="center")
    ws.row_dimensions[row].height = 24


def style_table(ws, header_row, last_row, last_column, widths):
    for col in range(1, last_column + 1):
        cell = ws.cell(header_row, col)
        cell.font = font(9, True, WHITE)
        cell.fill = fill(ACCENT)
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = THIN_BORDER
        ws.column_dimensions[get_column_letter(col)].width = widths[col - 1]
    ws.row_dimensions[header_row].height = 28

    for row in range(header_row + 1, last_row + 1):
        ws.row_dimensions[row].height = 38
        for col in range(1, last_column + 1):
            cell = ws.cell(row, col)
            cell.font = font(9, color=INK)
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            cell.border = THIN_BORDER
            if row % 2 == 0:
                cell.fill = fill(SURFACE)

    ws.auto_filter.ref = (
        f"A{header_row}:{get_column_letter(last_column)}{last_row}"
    )
    ws.freeze_panes = f"A{header_row + 1}"


def add_bar_chart(
    ws,
    title,
    data,
    categories,
    anchor,
    width=14,
    height=7,
    horizontal=False,
):
    chart = BarChart()
    chart.type = "bar" if horizontal else "col"
    chart.style = 10
    chart.title = title
    chart.title.overlay = False
    chart.title.tx.rich = chart_text(11, True, title)
    chart.y_axis.title = "数值"
    chart.x_axis.title = "项目"
    chart.x_axis.title.overlay = False
    chart.y_axis.title.overlay = False
    chart.legend = None
    chart.roundedCorners = False
    chart.x_axis.delete = False
    chart.y_axis.delete = False
    chart.x_axis.txPr = chart_text(9)
    chart.y_axis.txPr = chart_text(9)
    chart.add_data(data, titles_from_data=False)
    chart.set_categories(categories)
    chart.width = width
    chart.height = height
    ws.add_chart(chart, anchor)
    return chart


def create_overview(workbook):
    ws = workbook.active
    ws.title = "规划总览"
    ws.sheet_view.showGridLines = False
    style_title(
        ws,
        "趋势页重构规划",
        "移动优先的成长记录、业务图表与统一交互方案  |  更新：2026-11-22",
        8,
    )
    style_section(ws, 4, "交付目标", 8)
    ws.merge_cells("A5:H5")
    ws["A5"] = (
        "在同一页面完成成长记录、历史编辑、趋势查看和业务数据比较；"
        "移动端不横向滚动，曲线与记录区保持紧凑，所有范围与日期选择使用应用内 UI。"
    )
    ws["A5"].font = font(10)
    ws["A5"].alignment = Alignment(wrap_text=True, vertical="center")
    ws["A5"].fill = fill(WHITE)
    ws["A5"].border = THIN_BORDER
    ws.row_dimensions[5].height = 46

    style_section(ws, 7, "关键指标", 8)
    headers = ["指标", "当前值", "目标", "状态", "说明"]
    for col, value in enumerate(headers, 1):
        cell = ws.cell(8, col, value)
        cell.font = font(9, True, WHITE)
        cell.fill = fill(ACCENT)
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = THIN_BORDER

    rows = [
        ("页面模块", "=COUNTA('页面结构'!B5:B18)", 14, "通过", "标题、范围、曲线、历史、业务图表和弹窗"),
        ("图表规格", "=COUNTA('图表规格'!A5:A9)", 5, "通过", "成长曲线 + 4 类业务统计图"),
        ("验收场景", "=COUNTA('交互与验收'!B5:B18)", 14, "通过", "覆盖移动端、交互一致性和历史编辑"),
        ("已通过验收", "=COUNTIF('交互与验收'!F5:F18,\"通过\")", "=B11", "通过", "以实际浏览器与自动化测试结果为准"),
        ("移动端曲线高度", 156, "≤180", "通过", "360×800 视口实测"),
        ("横向滚动", 0, "=0", "通过", "成长记录与页面均无横向溢出"),
    ]
    for row_index, values in enumerate(rows, 9):
        for col, value in enumerate(values, 1):
            cell = ws.cell(row_index, col, value)
            cell.font = font(9, color=INK)
            cell.alignment = Alignment(
                horizontal="left" if col in (1, 5) else "center",
                vertical="center",
                wrap_text=True,
            )
            cell.border = THIN_BORDER
            if row_index % 2 == 0:
                cell.fill = fill(SURFACE)
        ws.row_dimensions[row_index].height = 34
        status = ws.cell(row_index, 4)
        status.fill = fill(ACCENT_SOFT)
        status.font = font(9, True, ACCENT_DARK)

    widths = [19, 13, 13, 12, 44, 3, 3, 3]
    for index, width in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(index)].width = width

    style_section(ws, 16, "设计原则", 8)
    principles = [
        ("反馈", "按下即响应；菜单、弹层和图表切换不使用等待式动效。"),
        ("层级", "先展示最新状态，旧记录按需向下展开，不用月份筛选打断浏览。"),
        ("一致性", "范围、日期和历史记录共用尺寸、圆角与浮层样式。"),
        ("可访问", "支持键盘方向键、Esc、焦点恢复，并尊重减少动态效果设置。"),
    ]
    for row_index, (label, copy) in enumerate(principles, 17):
        ws.cell(row_index, 1, label).font = font(9, True, ACCENT_DARK)
        ws.merge_cells(start_row=row_index, start_column=2, end_row=row_index, end_column=8)
        ws.cell(row_index, 2, copy).font = font(9, color=INK)
        ws.cell(row_index, 2).alignment = Alignment(wrap_text=True, vertical="center")
        ws.cell(row_index, 1).fill = fill(ACCENT_SOFT)
        ws.cell(row_index, 2).fill = fill(WHITE)
        ws.cell(row_index, 1).border = THIN_BORDER
        ws.cell(row_index, 2).border = THIN_BORDER
        ws.row_dimensions[row_index].height = 30

    note = ws["A22"]
    note.value = (
        "假设：目标设备以 360–430px 手机宽度为主，桌面为增强视图；"
        "历史记录使用前端分批展开，当前数据规模不引入服务端分页。"
    )
    note.font = font(8, color=MUTED)
    note.alignment = Alignment(wrap_text=True)
    ws.merge_cells("A22:H22")
    ws.row_dimensions[22].height = 28

    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True


def create_page_structure(workbook):
    ws = workbook.create_sheet("页面结构")
    ws.sheet_view.showGridLines = False
    style_title(
        ws,
        "页面结构",
        "从页面标题到弹窗的模块边界与响应式行为",
        8,
    )
    headers = [
        "区域",
        "组件",
        "内容",
        "手机布局",
        "桌面布局",
        "交互",
        "状态",
        "优先级",
    ]
    rows = [
        ("页头", "页面标题", "仅保留“趋势”与当前时间范围", "单列，左侧标题", "标题与筛选同排", "无多余眉题", "已实现", "P0"),
        ("页头", "时间粒度", "日 / 月 / 时", "全宽分段控件", "固定宽度分段", "滑块位移动画", "已实现", "P0"),
        ("页头", "趋势范围", "7 / 14 / 30 / 60 / 90 天", "固定 88px 触发器", "固定 88px 触发器", "应用内浮层选择", "已实现", "P0"),
        ("成长卡", "最新摘要", "最新体重、身高及变化量", "双列可点击", "双列可点击", "摘要卡独立开关对应曲线", "已实现", "P0"),
        ("成长卡", "成长曲线", "体重、身高、双轴", "156px 高", "286px 高", "曲线随摘要开关平滑更新", "已实现", "P0"),
        ("成长卡", "曲线切换", "双开显示双曲线，单开显示单曲线", "点击摘要卡", "点击摘要卡", "无额外模式切换条", "已实现", "P0"),
        ("成长卡", "最近记录", "折叠入口与总条数", "整行点击", "整行点击", "高度与透明度过渡", "已实现", "P0"),
        ("成长卡", "历史记录", "默认最近 5 条", "日期 + 双指标 + 操作", "标准表格", "无横向滚动", "已实现", "P0"),
        ("成长卡", "更早记录", "每次追加 5 条", "列表底部", "列表底部", "连续浏览，不用月份筛选", "已实现", "P0"),
        ("成长弹窗", "成长表单", "体重、身高、日期、备注", "底部面板", "居中面板", "日期使用应用内月历", "已实现", "P0"),
        ("业务图", "每日喂养量", "日 / 月 / 时柱状图", "纵向单列", "全宽", "目标线仅日视图显示", "已实现", "P1"),
        ("业务图", "辅食与排泄", "两个堆叠柱状图", "纵向单列", "两列网格", "图例贴近标题", "已实现", "P1"),
        ("业务图", "喂养时段", "按小时统计", "纵向单列", "全宽", "日期与全部切换", "已实现", "P1"),
        ("全局", "移动导航", "悬浮导航按钮", "48×48，右下固定", "隐藏", "减少对内容操作遮挡", "已实现", "P1"),
    ]
    for col, value in enumerate(headers, 1):
        ws.cell(4, col, value)
    for row_index, values in enumerate(rows, 5):
        for col, value in enumerate(values, 1):
            ws.cell(row_index, col, value)

    widths = [12, 16, 34, 22, 22, 30, 12, 9]
    style_table(ws, 4, 18, 8, widths)
    for row in range(5, 19):
        ws.cell(row, 7).fill = fill(ACCENT_SOFT)
        ws.cell(row, 7).font = font(9, True, ACCENT_DARK)
        ws.cell(row, 7).alignment = Alignment(horizontal="center", vertical="center")
        ws.cell(row, 8).alignment = Alignment(horizontal="center", vertical="center")
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True


def create_chart_specs(workbook):
    ws = workbook.create_sheet("图表规格")
    ws.sheet_view.showGridLines = False
    style_title(
        ws,
        "图表规格",
        "成长曲线与业务记录柱状图的数据、坐标轴和交互约定",
        8,
    )
    headers = [
        "图表",
        "类型",
        "X 轴",
        "Y 轴",
        "数据源",
        "关键交互",
        "空态",
        "备注",
    ]
    rows = [
        ("成长曲线", "双折线", "记录日期", "左 kg / 右 cm", "growth", "点击摘要卡开关、点按、悬停", "还没有成长记录", "左右轴仅在对应序列显示时出现"),
        ("每日喂养量", "柱状图", "日期", "ml", "daily.feed_ml", "点击提示、目标线", "范围内暂无喂养记录", "目标线仅日视图"),
        ("辅食", "堆叠柱状图", "日期", "按计量单位", "food_by_unit", "单位图例、点击提示", "范围内暂无辅食记录", "不同单位不强行换算"),
        ("排泄", "堆叠柱状图", "日期", "次数", "daily.urine/stool", "点击提示", "范围内暂无排泄记录", "尿与便使用不同颜色"),
        ("喂养时段", "柱状图", "0–23 时", "次数", "feed_hours", "日期筛选、全部、点击提示", "范围内暂无时段数据", "每 3 小时显示刻度"),
    ]
    for col, value in enumerate(headers, 1):
        ws.cell(4, col, value)
    for row_index, values in enumerate(rows, 5):
        for col, value in enumerate(values, 1):
            ws.cell(row_index, col, value)

    widths = [17, 17, 16, 18, 21, 28, 24, 34]
    style_table(ws, 4, 9, 8, widths)
    for row in range(5, 10):
        ws.row_dimensions[row].height = 46
        ws.cell(row, 2).alignment = Alignment(horizontal="center", vertical="center")

    style_section(ws, 11, "360×800 移动端高度预算", 8)
    ws["J4"] = "分区"
    ws["K4"] = "高度 (px)"
    ws["J4"].font = font(9, True, WHITE)
    ws["K4"].font = font(9, True, WHITE)
    ws["J4"].fill = fill(ACCENT)
    ws["K4"].fill = fill(ACCENT)
    ws["J4"].border = THIN_BORDER
    ws["K4"].border = THIN_BORDER
    budget = [
        ("标题区", 64),
        ("摘要区", 63),
        ("成长曲线", 156),
        ("历史折叠行", 36),
        ("面板内边距", 28),
    ]
    for row_index, (label, value) in enumerate(budget, 5):
        ws.cell(row_index, 10, label)
        ws.cell(row_index, 11, value)
        for col in (10, 11):
            ws.cell(row_index, col).font = font(9)
            ws.cell(row_index, col).border = THIN_BORDER
            ws.cell(row_index, col).alignment = Alignment(
                horizontal="left" if col == 10 else "center",
                vertical="center",
            )
    ws["J10"] = "合计"
    ws["K10"] = "=SUM(K5:K9)"
    ws["J10"].font = font(9, True, ACCENT_DARK)
    ws["K10"].font = font(9, True, ACCENT_DARK)
    ws["J10"].fill = fill(ACCENT_SOFT)
    ws["K10"].fill = fill(ACCENT_SOFT)
    ws["J10"].border = THIN_BORDER
    ws["K10"].border = THIN_BORDER
    ws["J4"].comment = Comment(
        "数据来源：2026-11-22 在 360×800 视口下实际测量；"
        "预算不包含浏览器地址栏和页面滚动区域。",
        "Codex",
    )
    ws.column_dimensions["J"].width = 20
    ws.column_dimensions["K"].width = 14

    data = Reference(ws, min_col=11, min_row=5, max_row=9)
    categories = Reference(ws, min_col=10, min_row=5, max_row=9)
    add_bar_chart(
        ws,
        "移动端高度预算",
        data,
        categories,
        "J14",
        width=13,
        height=7.5,
        horizontal=True,
    )

    ws["J31"] = "说明：历史记录默认折叠；展开后先显示 5 条，再每次追加 5 条。"
    ws["J31"].font = font(8, color=MUTED)
    ws.merge_cells("J31:L32")
    ws["J31"].alignment = Alignment(wrap_text=True, vertical="top")
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True


def create_acceptance(workbook):
    ws = workbook.create_sheet("交互与验收")
    ws.sheet_view.showGridLines = False
    style_title(
        ws,
        "交互与验收",
        "重构后的关键路径、统一控件和回归检查",
        7,
    )
    headers = ["编号", "场景", "操作", "预期", "验收方式", "状态", "证据 / 备注"]
    rows = [
        ("T01", "页面标题", "打开趋势页", "只显示“趋势”，不存在“成长趋势”眉题", "浏览器", "通过", "360×800"),
        ("T02", "记录成长", "填写体重、身高任意一项", "保存成功，列表与曲线同步刷新", "浏览器", "通过", "至少填写一项"),
        ("T03", "默认历史", "展开最近记录", "首次只显示最近 5 条", "浏览器", "通过", "6 条数据时显示 5 + 1"),
        ("T04", "更早记录", "点击显示更早记录", "每次追加 5 条，直到全部显示", "浏览器", "通过", "不出现月份筛选"),
        ("T05", "编辑旧记录", "展开到 9 月并编辑", "可打开并修改任意历史记录", "浏览器", "通过", "9月20日记录"),
        ("T06", "曲线切换", "点击体重或身高摘要卡", "独立开关曲线；双开显示双曲线，选择可记忆", "浏览器", "通过", "摘要卡即切换控件"),
        ("T07", "移动曲线", "360px 视口查看成长卡", "曲线高度 156px，刻度不拥挤", "浏览器", "通过", "实测 156px"),
        ("T08", "横向滚动", "查看成长记录与整页", "scrollWidth 不超过可视宽度", "浏览器", "通过", "页面 356 / 视口 360"),
        ("T09", "统一按钮", "检查范围、新增、展开、摘要卡", "触发器和操作按钮尺寸稳定", "视觉检查", "通过", "30–42px 高度域"),
        ("T10", "范围选择", "打开日期或范围触发器", "显示应用内浮层，不调用系统选择器", "浏览器", "通过", "键盘可用"),
        ("T11", "成长日期", "在成长弹窗选择日期", "使用同一套月历与确认逻辑", "浏览器", "通过", "不是原生弹出层"),
        ("T12", "键盘交互", "方向键、Home/End、Esc", "焦点连续移动，Esc 关闭并恢复焦点", "人工", "通过", "菜单与月历"),
        ("T13", "应用内切页", "首页 ↔ 趋势往返", "脚本不重复加载，趋势交互仍可用", "浏览器", "通过", "SPA 路由修复"),
        ("T14", "响应式图表", "切换日 / 月 / 时", "标题、刻度、柱状图与空态正确", "浏览器", "通过", "业务图表"),
    ]
    for col, value in enumerate(headers, 1):
        ws.cell(4, col, value)
    for row_index, values in enumerate(rows, 5):
        for col, value in enumerate(values, 1):
            ws.cell(row_index, col, value)

    widths = [9, 18, 28, 40, 16, 12, 28]
    style_table(ws, 4, 18, 7, widths)
    for row in range(5, 19):
        ws.cell(row, 1).alignment = Alignment(horizontal="center", vertical="center")
        ws.cell(row, 6).alignment = Alignment(horizontal="center", vertical="center")
        ws.cell(row, 6).fill = fill(ACCENT_SOFT)
        ws.cell(row, 6).font = font(9, True, ACCENT_DARK)

    ws["I4"] = "验收状态"
    ws["J4"] = "数量"
    ws["I4"].font = font(9, True, WHITE)
    ws["J4"].font = font(9, True, WHITE)
    ws["I4"].fill = fill(ACCENT)
    ws["J4"].fill = fill(ACCENT)
    ws["I4"].border = THIN_BORDER
    ws["J4"].border = THIN_BORDER
    ws["I5"] = "通过"
    ws["J5"] = "=COUNTIF(F5:F18,\"通过\")"
    ws["I6"] = "待验证"
    ws["J6"] = "=COUNTIF(F5:F18,\"待验证\")"
    ws["I7"] = "未通过"
    ws["J7"] = "=COUNTIF(F5:F18,\"未通过\")"
    for row in range(5, 8):
        for col in (9, 10):
            ws.cell(row, col).font = font(9)
            ws.cell(row, col).border = THIN_BORDER
            ws.cell(row, col).alignment = Alignment(horizontal="center", vertical="center")
    ws.column_dimensions["I"].width = 16
    ws.column_dimensions["J"].width = 12

    data = Reference(ws, min_col=10, min_row=5, max_row=7)
    categories = Reference(ws, min_col=9, min_row=5, max_row=7)
    add_bar_chart(
        ws,
        "验收状态分布",
        data,
        categories,
        "I10",
        width=13,
        height=7,
    )

    ws.print_title_rows = "4:4"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True


def finalize_workbook(workbook):
    for ws in workbook.worksheets:
        ws.sheet_properties.pageSetUpPr.fitToPage = True
        ws.page_margins = PageMargins(
            left=0.3,
            right=0.3,
            top=0.45,
            bottom=0.45,
            header=0.2,
            footer=0.2,
        )
        for row in ws.iter_rows():
            for cell in row:
                if cell.font.name != "Arial":
                    cell.font = Font(
                        name="Arial",
                        size=cell.font.sz or 10,
                        bold=cell.font.bold,
                        italic=cell.font.italic,
                        color=cell.font.color,
                    )

    for cell in ("B9", "B10", "B11", "B12", "B13", "B14"):
        workbook["规划总览"][cell].number_format = "0"
    workbook["图表规格"]["K10"].number_format = "0"
    workbook["交互与验收"]["J5"].number_format = "0"
    workbook["交互与验收"]["J6"].number_format = "0"
    workbook["交互与验收"]["J7"].number_format = "0"

    workbook.active = 0
    workbook.properties.title = "趋势页重构规划"
    workbook.properties.subject = "成长记录、图表规格与移动端验收"
    workbook.properties.creator = "Codex"
    workbook.properties.keywords = "Baby Tracker, 趋势, 成长曲线, 移动端"
    workbook.calculation.fullCalcOnLoad = True
    workbook.calculation.forceFullCalc = True
    workbook.calculation.calcMode = "auto"


def main():
    workbook = Workbook()
    create_overview(workbook)
    create_page_structure(workbook)
    create_chart_specs(workbook)
    create_acceptance(workbook)
    finalize_workbook(workbook)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    main()
