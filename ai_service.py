"""AI 视觉识别服务（OpenAI 兼容 /chat/completions）。

纯函数式模块，不依赖 Flask，只用标准库实现：
- 配置读取 / 脱敏
- chat completions 调用与连通性测试
- 图片识别结果的解析与归一化

约定：app.py 负责把 settings 表读成 dict 传给 get_effective_config()。
"""

import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, date

DEFAULT_BASE_URL = 'https://api.openai.com/v1'
DEFAULT_MODEL = 'gpt-4o-mini'

ALLOWED_TYPES = ('feed', 'excrete', 'symptom', 'supplement')

# 已知的 sub_type 白名单（应用允许自定义值，所以仅用于"已是白名单则保留"的判断）
KNOWN_SUB_TYPES = {
    'formula', 'breast_left', 'breast_right', 'breast', 'water', 'solid_food',
    'urine', 'stool', 'both', 'vomit', 'fever', 'jaundice', 'rash',
    'vitamin_d', 'vitamin_ad', 'iron', 'calcium', 'dha', 'probiotics',
}

# 记录字段（前端总览确认页与 /api/records/batch 都会用到）
RECORD_KEYS = (
    'type', 'sub_type', 'amount', 'duration', 'color', 'consistency',
    'temperature', 'note', 'timestamp', 'food_unit',
    'confidence', 'warnings', 'raw_text', 'valid', 'errors',
)


def get_effective_config(settings_dict):
    """返回实际生效的 AI 配置。

    优先级：环境变量 > settings 表 > 默认值。
    key_source 表示"实际生效的 key"来源：env / db / none。
    configured = 有 base_url 且 有 key。

    :param settings_dict: 由调用方传入的 settings 表 {key: value} 字典
    """
    settings_dict = settings_dict or {}

    env_base = (os.environ.get('AI_VISION_BASE_URL') or '').strip()
    env_key = (os.environ.get('AI_VISION_API_KEY') or '').strip()
    env_model = (os.environ.get('AI_VISION_MODEL') or '').strip()

    db_base = str(settings_dict.get('ai_vision_base_url') or '').strip()
    db_key = str(settings_dict.get('ai_vision_api_key') or '').strip()
    db_model = str(settings_dict.get('ai_vision_model') or '').strip()

    base_url = env_base or db_base or DEFAULT_BASE_URL
    model = env_model or db_model or DEFAULT_MODEL

    if env_key:
        api_key = env_key
        key_source = 'env'
    elif db_key:
        api_key = db_key
        key_source = 'db'
    else:
        api_key = ''
        key_source = 'none'

    return {
        'base_url': base_url,
        'model': model,
        'api_key': api_key,
        'key_source': key_source,
        'configured': bool(base_url and api_key),
    }


def mask_key(key):
    """密钥脱敏：只显示后 4 位，如 ****abcd；无 key 返回空串。"""
    key = (key or '').strip()
    if not key:
        return ''
    return '****' + key[-4:]


def call_chat_completions(config, messages, timeout=60):
    """向 OpenAI 兼容 /chat/completions 发 POST，返回解析后的 JSON。

    错误统一转成 RuntimeError（友好中文），不泄漏堆栈 / 密钥。
    """
    config = config or {}
    base_url = (config.get('base_url') or DEFAULT_BASE_URL).rstrip('/')
    api_key = config.get('api_key') or ''
    model = config.get('model') or DEFAULT_MODEL
    url = base_url + '/chat/completions'

    body = {
        'model': model,
        'messages': messages,
        'temperature': 0.1,
        'max_tokens': 2000,
    }
    data = json.dumps(body, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=data,
        method='POST',
        headers={
            'Authorization': 'Bearer ' + api_key,
            'Content-Type': 'application/json',
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode('utf-8', errors='replace')
    except urllib.error.HTTPError as e:
        # 读取上游错误 body，提取可读的错误信息
        try:
            err_body = e.read().decode('utf-8', errors='replace')
        except Exception:
            err_body = ''
        upstream = _extract_upstream_error(err_body)
        upstream = _redact_key(upstream, api_key)
        raise RuntimeError('AI 服务返回 HTTP %s%s' % (e.code, ('：' + upstream) if upstream else '，请检查配置'))
    except urllib.error.URLError as e:
        reason = getattr(e, 'reason', e)
        if 'timed out' in str(reason).lower() or isinstance(reason, TimeoutError):
            raise RuntimeError('连接 AI 服务超时，请稍后重试')
        raise RuntimeError('无法连接 AI 服务：%s' % reason)
    except TimeoutError:
        raise RuntimeError('连接 AI 服务超时，请稍后重试')
    except OSError as e:
        raise RuntimeError('网络错误：%s' % e)

    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        raise RuntimeError('AI 服务返回内容不是有效 JSON')


def _redact_key(text, api_key):
    """从上游错误信息里抹掉可能回显的 API Key，避免泄漏。"""
    if not text:
        return text
    result = text
    if api_key:
        result = result.replace(api_key, '***')
    # 兜底：抹掉 sk- 开头的疑似密钥
    import re as _re
    return _re.sub(r'sk-[A-Za-z0-9_\-]{8,}', '***', result)


def _extract_upstream_error(body):
    """从上游错误 JSON 中尽量提取 error.message。"""
    if not body:
        return ''
    try:
        obj = json.loads(body)
        err = obj.get('error') if isinstance(obj, dict) else None
        if isinstance(err, dict):
            return str(err.get('message') or err.get('code') or '')
        if isinstance(err, str):
            return err
        if isinstance(obj, dict) and obj.get('message'):
            return str(obj['message'])
    except (ValueError, TypeError):
        pass
    return body[:200]


def test_connection(config):
    """发一条极小的纯文本 messages 验证连通性，返回 (ok, message)。"""
    messages = [{'role': 'user', 'content': '请只回复 OK 两个字符。'}]
    try:
        result = call_chat_completions(config, messages, timeout=20)
        choices = result.get('choices') if isinstance(result, dict) else None
        if not choices:
            return False, 'AI 服务未返回有效响应'
        return True, '连接成功'
    except RuntimeError as e:
        return False, str(e)
    except Exception:
        return False, '连接失败：未知错误'


SYSTEM_PROMPT = """你是婴儿日常记录助手。从图片（手写记录本 / App 截图 / 实物照）中抽取喂养、排泄、症状、补充类记录。
只返回一个 JSON 对象，不要输出 markdown、代码围栏或任何解释文字。格式如下：
{"records":[{"type":"...","sub_type":"...","amount":...,"duration":...,"color":"...","consistency":"...","temperature":...,"note":"...","date":"YYYY-MM-DD","time":"HH:MM","raw_text":"...","confidence":0.9}]}

type 允许值（中文说法示例）：
- feed（喂养 / 吃奶 / 奶 / 喂）：配方奶、母乳喂养、喂水、辅食
- excrete（排泄 / 尿布 / 大小便）：排尿、排便、尿+便
- symptom（症状）：吐奶、发烧、黄疸、皮疹
- supplement（补充 / 营养 / 维生素）：维D、维AD、铁、钙、DHA、益生菌

sub_type 允许值清单（尽量映射，中文说法示例）：
formula（配方奶/奶粉/牛奶）、breast_left（母乳左/左乳）、breast_right（母乳右/右乳）、water（水）、solid_food（辅食/米粉/果泥/米糊）、urine（尿）、stool（便/大便/粑粑）、both（大小便/尿+便/尿便）、vomit（吐奶/呕吐）、fever（发烧/发热）、jaundice（黄疸）、rash（皮疹/湿疹）、vitamin_d（维D/维生素D）、vitamin_ad（维AD）、iron（铁）、calcium（钙）、dha（DHA）、probiotics（益生菌）。

要求：
- date 为记录日期，格式 YYYY-MM-DD；图片中能清晰看到日期（如记录本抬头、表头、截图日期）才填写，看不清或没有则留空，绝对不要根据拍摄时间等猜测或编造。只有月日没有年份时可写 MM-DD。
- time 尽量用 HH:MM（24 小时制），无法判断则留空。
- amount 为毫升 / 克等数值，duration 为分钟数值，temperature 为摄氏度数值，只填数字不带单位。
- 无法判断的字段留空（空字符串或 null），不要编造数据。
- raw_text 填该条记录对应的图片原文片段。
- confidence 为该条记录 0~1 的置信度。
- 图中没有记录时返回 {"records":[]}。
"""


def recognize_image(image_data_url, date_str, config=None):
    """识别图片中的数据，返回归一化后的记录列表 list[dict]。

    解析失败抛 RuntimeError（友好中文）；单条记录异常被逐条兜底，不影响整批。
    """
    config = config or get_effective_config({})
    if not config.get('configured'):
        raise RuntimeError('尚未配置 AI 服务')

    user_content = [
        {
            'type': 'text',
            'text': ('请识别这张图片中的婴儿记录，记录日期基准为 %s。'
                     '按系统提示的 JSON 格式返回，时间用 HH:MM，无法判断的字段留空，不要编造。') % date_str,
        },
        {'type': 'image_url', 'image_url': {'url': image_data_url}},
    ]
    messages = [
        {'role': 'system', 'content': SYSTEM_PROMPT},
        {'role': 'user', 'content': user_content},
    ]

    result = call_chat_completions(config, messages)
    content = _get_message_content(result)
    parsed = _parse_json_content(content)
    raw_records = parsed.get('records') if isinstance(parsed, dict) else None
    if not isinstance(raw_records, list):
        raise RuntimeError('AI 返回内容不是有效 JSON')

    return normalize_records(raw_records, date_str)


def _get_message_content(result):
    try:
        return result['choices'][0]['message']['content']
    except (KeyError, IndexError, TypeError):
        raise RuntimeError('AI 返回内容缺少 choices.message.content')


def _parse_json_content(content):
    """剥离代码围栏，截取第一个 { 到最后一个 }，再 json.loads。"""
    if not isinstance(content, str):
        raise RuntimeError('AI 返回内容不是有效 JSON')
    text = content.strip()
    # 去掉 ```json ... ``` / ``` ... ``` 围栏
    text = re.sub(r'^```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```$', '', text)
    start = text.find('{')
    end = text.rfind('}')
    if start == -1 or end == -1 or end < start:
        raise RuntimeError('AI 返回内容不是有效 JSON')
    try:
        return json.loads(text[start:end + 1])
    except (ValueError, TypeError):
        raise RuntimeError('AI 返回内容不是有效 JSON')


# ── 归一化 ────────────────────────────────────────────────

_TYPE_KEYWORDS = (
    ('feed', ('喂养', '吃奶', '奶', '喂')),
    ('excrete', ('排泄', '尿布', '大小便')),
    ('symptom', ('症状',)),
    ('supplement', ('补充', '营养', '维生素')),
)

# 顺序很重要：更具体的模式放前面（如"母乳左"要先于"母乳"，"大小便"要先于"尿"/"便"）
_SUB_TYPE_RULES = (
    ('尿+便', 'both'), ('大小便', 'both'), ('尿便', 'both'),
    ('配方奶', 'formula'), ('奶粉', 'formula'), ('牛奶', 'formula'),
    ('母乳左', 'breast_left'), ('左乳', 'breast_left'),
    ('母乳右', 'breast_right'), ('右乳', 'breast_right'),
    ('母乳', 'breast_left'),
    ('水', 'water'),
    ('辅食', 'solid_food'), ('米粉', 'solid_food'), ('果泥', 'solid_food'), ('米糊', 'solid_food'),
    ('尿', 'urine'),
    ('便', 'stool'), ('大便', 'stool'), ('粑粑', 'stool'),
    ('吐奶', 'vomit'), ('呕吐', 'vomit'),
    ('发烧', 'fever'), ('发热', 'fever'),
    ('黄疸', 'jaundice'),
    ('皮疹', 'rash'), ('湿疹', 'rash'),
    ('维d', 'vitamin_d'), ('维生素d', 'vitamin_d'),
    ('维ad', 'vitamin_ad'),
    ('铁', 'iron'), ('钙', 'calcium'), ('dha', 'dha'), ('益生菌', 'probiotics'),
)

_FULL_TS_RE = re.compile(r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$')
_SHORT_TS_RE = re.compile(r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$')
_HHMM_RE = re.compile(r'^\d{1,2}:\d{2}$')
_FULL_DATE_RE = re.compile(r'^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$')
_MD_DATE_RE = re.compile(r'^(\d{1,2})[-/.月](\d{1,2})日?$')
_CN_MD_DATE_RE = re.compile(r'^(\d{1,2})月(\d{1,2})日$')


def _map_type(value):
    """返回 (type, error_or_None)。"""
    s = str(value or '').strip()
    low = s.lower()
    if low in ALLOWED_TYPES:
        return low, None
    for enum_val, keywords in _TYPE_KEYWORDS:
        for kw in keywords:
            if kw in low:
                return enum_val, None
    return '', '无法识别记录类型'


def _map_sub_type(value):
    """返回 (sub_type, warning_or_None)。已是白名单值则保留；都不匹配保留原文并给 warning。"""
    s = str(value or '').strip()
    low = s.lower()
    if low in KNOWN_SUB_TYPES:
        return low, None
    for pattern, enum_val in _SUB_TYPE_RULES:
        if pattern in low:
            if enum_val == 'breast_left' and pattern == '母乳':
                return enum_val, '母乳侧别未识别，默认左'
            return enum_val, None
    return s, '子类型未匹配标准值，请核对'


def _parse_recognized_date(value, fallback_date):
    """解析 AI 从图片里读到的日期。

    返回 (YYYY-MM-DD 或 None, 原始文本)。只在图片中确实读到合法日期时返回；
    看不清/没有/非法一律返回 None（调用方沿用弹窗所选日期，不做任何猜测）。
    只有 MM-DD 时年份取 fallback_date 的年份。
    """
    s = str(value or '').strip()
    if not s:
        return None, ''

    m = _FULL_DATE_RE.match(s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return date(y, mo, d).isoformat(), s
        except ValueError:
            return None, s

    m = _CN_MD_DATE_RE.match(s) or _MD_DATE_RE.match(s)
    if m:
        mo, d = int(m.group(1)), int(m.group(2))
        try:
            year = int(str(fallback_date)[:4])
        except (ValueError, TypeError):
            year = date.today().year
        try:
            return date(year, mo, d).isoformat(), s
        except ValueError:
            return None, s
    return None, s


def _normalize_timestamp(raw, date_str, warnings, recognized_date=None):
    """从 time / timestamp 字段解析时间戳，返回 YYYY-MM-DD HH:MM:SS 字符串。

    recognized_date 非空时表示图片里读到了日期，优先级高于弹窗所选 date_str；
    但如果 AI 直接返回了完整时间戳，则以完整时间戳的日期为准（图片信息更完整）。
    """
    effective_date = recognized_date or date_str
    candidate = raw.get('time')
    if candidate in (None, ''):
        candidate = raw.get('timestamp')
    ts = str(candidate or '').strip()

    if not ts:
        warnings.append('时间未识别，已用当前时间')
        return datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    if _FULL_TS_RE.match(ts):
        try:
            datetime.strptime(ts, '%Y-%m-%d %H:%M:%S')
            return ts
        except ValueError:
            warnings.append('时间格式无效，已用当前时间')
            return datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    if _SHORT_TS_RE.match(ts):
        try:
            datetime.strptime(ts, '%Y-%m-%d %H:%M')
            return ts + ':00'
        except ValueError:
            warnings.append('时间格式无效，已用当前时间')
            return datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    if _HHMM_RE.match(ts):
        h, m = ts.split(':')
        h, m = int(h), int(m)
        if 0 <= h <= 23 and 0 <= m <= 59:
            return '%s %02d:%02d:00' % (effective_date, h, m)
        warnings.append('时间格式无效，已用当前时间')
        return datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    warnings.append('时间格式无效，已用当前时间')
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def _to_number(value, integer=False):
    """能转 float/int 则转，否则 (None, True非法标志)。空值视为未提供。"""
    if value is None or value == '':
        return None, False
    try:
        if integer:
            return int(float(value)), False
        return float(value), False
    except (ValueError, TypeError):
        return None, True


def _str_field(value):
    if value is None:
        return ''
    return str(value)[:200]


def _normalize_one(raw, date_str):
    """归一化单条记录；返回结果 dict（含 valid/errors/warnings）。"""
    warnings = []
    errors = []

    if not isinstance(raw, dict):
        # 非字典项兜底成一条无效记录
        return {
            'type': '', 'sub_type': '', 'amount': None, 'duration': None,
            'color': '', 'consistency': '', 'temperature': None, 'note': '',
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'food_unit': '', 'confidence': 0.0,
            'date_recognized': False, 'raw_date': '',
            'warnings': [], 'raw_text': str(raw), 'valid': False,
            'errors': ['记录条目格式无效'],
        }

    rec_type, type_err = _map_type(raw.get('type'))
    if type_err:
        errors.append(type_err)

    sub_type, sub_warn = _map_sub_type(raw.get('sub_type'))
    if sub_warn:
        warnings.append(sub_warn)

    amount, amt_bad = _to_number(raw.get('amount'))
    if amt_bad:
        warnings.append('奶量/用量数值无效，已置空')
    duration, dur_bad = _to_number(raw.get('duration'), integer=True)
    if dur_bad:
        warnings.append('时长数值无效，已置空')
    temperature, temp_bad = _to_number(raw.get('temperature'))
    if temp_bad:
        warnings.append('体温数值无效，已置空')

    try:
        confidence = float(raw.get('confidence', 0.5))
    except (ValueError, TypeError):
        confidence = 0.5
    if not (0 <= confidence <= 1):
        confidence = 0.5
    if confidence < 0.6:
        warnings.append('识别置信度较低，请核对')

    recognized_date, raw_date = _parse_recognized_date(raw.get('date'), date_str)
    if recognized_date:
        # 提示性信息（不改变 valid）：让用户知道该行日期来自图片而非弹窗所选日期
        warnings.append('已采用图片中的日期 %s' % recognized_date)

    timestamp = _normalize_timestamp(raw, date_str, warnings, recognized_date)

    return {
        'date_recognized': bool(recognized_date),
        'raw_date': _str_field(raw_date),
        'type': rec_type,
        'sub_type': sub_type,
        'amount': amount,
        'duration': duration,
        'color': _str_field(raw.get('color')),
        'consistency': _str_field(raw.get('consistency')),
        'temperature': temperature,
        'note': _str_field(raw.get('note')),
        'timestamp': timestamp,
        'food_unit': 'g' if sub_type == 'solid_food' else '',
        'confidence': confidence,
        'warnings': warnings,
        'raw_text': _str_field(raw.get('raw_text')),
        'valid': len(errors) == 0,
        'errors': errors,
    }


def normalize_records(raw, date_str):
    """逐条归一化；单条异常 try/except 兜底，不让坏数据毁掉整批。"""
    results = []
    for item in (raw or []):
        try:
            results.append(_normalize_one(item, date_str))
        except Exception as e:  # 单条兜底
            results.append({
                'type': '', 'sub_type': '', 'amount': None, 'duration': None,
                'color': '', 'consistency': '', 'temperature': None, 'note': '',
                'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'food_unit': '', 'confidence': 0.0,
                'date_recognized': False, 'raw_date': '',
                'warnings': ['该条记录解析异常，请手动补录：%s' % type(e).__name__],
                'raw_text': str(item)[:200], 'valid': False,
                'errors': ['该条记录解析异常'],
            })
    return results
