import os
import sqlite3
import hashlib
import json as json_module
import threading
from datetime import datetime, date, timedelta
from flask import Flask, render_template, request, jsonify, g, send_file, session, redirect, url_for
from io import StringIO, BytesIO
from werkzeug.security import generate_password_hash, check_password_hash
import csv
import secrets
import string

app = Flask(__name__)
app.config['DATABASE'] = os.path.join(os.path.dirname(__file__), 'data', 'baby.db')
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'baby-tracker-secret-key-change-in-prod')
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)


@app.after_request
def set_cache_control(response):
    """API 响应禁止缓存，确保数据实时性"""
    if request.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
    return response

# ── Database ──────────────────────────────────────────────

def get_db():
    if 'db' not in g:
        os.makedirs(os.path.dirname(app.config['DATABASE']), exist_ok=True)
        g.db = sqlite3.connect(app.config['DATABASE'])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    db = get_db()
    db.executescript('''
        CREATE TABLE IF NOT EXISTS babies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL DEFAULT '宝宝',
            gender TEXT NOT NULL DEFAULT 'male',
            birth_date TEXT NOT NULL,
            weight REAL NOT NULL DEFAULT 3.0,
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            baby_id INTEGER NOT NULL DEFAULT 1,
            user_id INTEGER,
            type TEXT NOT NULL,
            sub_type TEXT NOT NULL,
            amount REAL,
            duration INTEGER,
            color TEXT,
            consistency TEXT,
            temperature REAL,
            note TEXT,
            timestamp TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL UNIQUE,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            nickname TEXT NOT NULL DEFAULT '',
            role TEXT NOT NULL DEFAULT 'user',
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS quick_buttons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            sub_type TEXT NOT NULL,
            label TEXT NOT NULL,
            amount REAL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            username TEXT NOT NULL DEFAULT '',
            action TEXT NOT NULL,
            target_type TEXT NOT NULL DEFAULT '',
            target_id INTEGER,
            detail TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS weight_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            baby_id INTEGER NOT NULL DEFAULT 1,
            weight REAL NOT NULL,
            recorded_date TEXT NOT NULL,
            note TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_records_baby_id ON records(baby_id);
        CREATE INDEX IF NOT EXISTS idx_records_type ON records(type);
        CREATE INDEX IF NOT EXISTS idx_records_timestamp ON records(timestamp);
        CREATE INDEX IF NOT EXISTS idx_records_user_id ON records(user_id);
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
        CREATE TABLE IF NOT EXISTS vaccine_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vaccine_name TEXT NOT NULL,
            dose_index INTEGER NOT NULL,
            vaccinated_date TEXT NOT NULL,
            note TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            UNIQUE(vaccine_name, dose_index)
        );
        CREATE TABLE IF NOT EXISTS vaccine_plan_overrides (
            vaccine_name TEXT NOT NULL,
            dose_index INTEGER NOT NULL,
            custom_due_date TEXT NOT NULL,
            UNIQUE(vaccine_name, dose_index)
        );
    ''')

    # 默认设置
    db.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('custom_daily_target', '')")
    db.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('feeds_per_day', '8')")
    db.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('reminder_interval_min', '180')")
    # 奶量估算系数（JSON格式，每个阶段: ml/kg/天）
    default_coeffs = json_module.dumps({
        'day0': 60,       # 出生当天固定值
        'day1': 60,       # 日龄1天 ml/kg
        'day2_3': 80,     # 日龄2-3天
        'day4_7': 100,    # 日龄4-7天
        'day8_14': 120,   # 日龄8-14天
        'day15_28': 135,  # 日龄15-28天
        'month1_3': 150,  # 1-3月龄
        'month4_6': 150,  # 4-6月龄(上限900)
        'month4_6_cap': 900,
        'month6_12_base': 800,  # 6-12月基础量
        'month6_12_decay': 30,  # 每月递减
        'month6_12_min': 600,   # 下限
        'year1_plus': 500,      # 1岁以上
    }, ensure_ascii=False)
    db.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('milk_coefficients', ?)", (default_coeffs,))

    # 默认管理员
    admin_count = db.execute("SELECT COUNT(*) as c FROM users WHERE role='admin'").fetchone()['c']
    if admin_count == 0:
        db.execute(
            "INSERT INTO users (username, password_hash, nickname, role, status) VALUES (?, ?, ?, 'admin', 'approved')",
            ('admin', generate_password_hash('admin123'), '管理员', )
        )

    # 默认婴儿
    row = db.execute("SELECT COUNT(*) as c FROM babies").fetchone()
    if row['c'] == 0:
        db.execute(
            "INSERT INTO babies (name, gender, birth_date, weight) VALUES (?, ?, ?, ?)",
            ('宝宝', 'male', date.today().isoformat(), 3.0)
        )

    # 默认快速记录按钮
    btn_count = db.execute("SELECT COUNT(*) as c FROM quick_buttons").fetchone()['c']
    if btn_count == 0:
        default_buttons = [
            ('feed', 'formula', '配方奶 60ml', 60, 1),
            ('feed', 'formula', '配方奶 90ml', 90, 2),
            ('feed', 'formula', '配方奶 120ml', 120, 3),
            ('feed', 'breast_left', '母乳(左)', 0, 4),
            ('feed', 'breast_right', '母乳(右)', 0, 5),
            ('feed', 'water', '喂水', 10, 6),
            ('excrete', 'urine', '排尿', 0, 7),
            ('excrete', 'stool', '排便', 0, 8),
            ('excrete', 'both', '尿+便', 0, 9),
            ('symptom', 'vomit', '吐奶', 0, 10),
            ('symptom', 'fever', '发热', 0, 11),
            ('symptom', 'jaundice', '黄疸', 0, 12),
        ]
        for b in default_buttons:
            db.execute(
                "INSERT INTO quick_buttons (type, sub_type, label, amount, sort_order) VALUES (?, ?, ?, ?, ?)", b
            )

    db.commit()

    _migrate_check_constraints(db)


def _migrate_check_constraints(db):
    try:
        schema = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='records'").fetchone()
        if schema and 'CHECK' in schema['sql']:
            db.execute("ALTER TABLE records RENAME TO _records_old")
            db.execute('''CREATE TABLE records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                baby_id INTEGER NOT NULL DEFAULT 1,
                user_id INTEGER,
                type TEXT NOT NULL,
                sub_type TEXT NOT NULL,
                amount REAL,
                duration INTEGER,
                color TEXT,
                consistency TEXT,
                temperature REAL,
                note TEXT,
                timestamp TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )''')
            cols = 'id,baby_id,user_id,type,sub_type,amount,duration,color,consistency,temperature,note,timestamp,created_at'
            db.execute(f"INSERT INTO records ({cols}) SELECT {cols} FROM _records_old")
            db.execute("DROP TABLE _records_old")
            db.execute("CREATE INDEX IF NOT EXISTS idx_records_baby_id ON records(baby_id)")
            db.execute("CREATE INDEX IF NOT EXISTS idx_records_type ON records(type)")
            db.execute("CREATE INDEX IF NOT EXISTS idx_records_timestamp ON records(timestamp)")
            db.execute("CREATE INDEX IF NOT EXISTS idx_records_user_id ON records(user_id)")
            db.commit()
    except Exception:
        pass

    try:
        schema = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='quick_buttons'").fetchone()
        if schema and 'CHECK' in schema['sql']:
            db.execute("ALTER TABLE quick_buttons RENAME TO _quick_buttons_old")
            db.execute('''CREATE TABLE quick_buttons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                sub_type TEXT NOT NULL,
                label TEXT NOT NULL,
                amount REAL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )''')
            cols = 'id,type,sub_type,label,amount,sort_order,is_active,created_at'
            db.execute(f"INSERT INTO quick_buttons ({cols}) SELECT {cols} FROM _quick_buttons_old")
            db.execute("DROP TABLE _quick_buttons_old")
            db.commit()
    except Exception:
        pass

    try:
        schema = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").fetchone()
        if schema and 'CHECK' in schema['sql']:
            db.execute("ALTER TABLE users RENAME TO _users_old")
            db.execute('''CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                nickname TEXT NOT NULL DEFAULT '',
                role TEXT NOT NULL DEFAULT 'user',
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )''')
            cols = 'id,username,password_hash,nickname,role,status,created_at'
            db.execute(f"INSERT INTO users ({cols}) SELECT {cols} FROM _users_old")
            db.execute("DROP TABLE _users_old")
            db.execute("CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)")
            db.commit()
    except Exception:
        pass


# ── Audit Log ─────────────────────────────────────────────

def add_log(action, target_type='', target_id=None, detail=''):
    """记录操作日志"""
    db = get_db()
    u = current_user()
    user_id = u['id'] if u else None
    username = (u['nickname'] or u['username']) if u else 'system'
    db.execute(
        "INSERT INTO audit_logs (user_id, username, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, username, action, target_type, target_id, detail)
    )
    db.commit()


def add_log_ha(action, target_type='', target_id=None, detail=''):
    """记录 HA 来源的操作日志"""
    db = get_db()
    u = db.execute("SELECT id, nickname, username FROM users WHERE role = 'admin' LIMIT 1").fetchone()
    user_id = u['id'] if u else None
    username = f"HA/{u['nickname'] or u['username']}" if u else 'HA'
    db.execute(
        "INSERT INTO audit_logs (user_id, username, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, username, action, target_type, target_id, detail)
    )
    db.commit()


# ── Auth Helpers ──────────────────────────────────────────

def current_user():
    if hasattr(g, '_current_user'):
        return g._current_user
    uid = session.get('user_id')
    if not uid:
        g._current_user = None
        return None
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    if not user:
        session.clear()
        g._current_user = None
        return None
    g._current_user = dict(user)
    return g._current_user


def is_admin():
    u = current_user()
    return u and u['role'] == 'admin' and u['status'] == 'approved'


def is_approved():
    u = current_user()
    return u and u['status'] == 'approved'


# ── Milk Estimation ───────────────────────────────────────

def estimate_milk(baby, settings_dict):
    custom = settings_dict.get('custom_daily_target', '')
    feeds_per_day = int(settings_dict.get('feeds_per_day', '8'))

    # 解析自定义系数
    default_coeffs = {
        'day0': 60, 'day1': 60, 'day2_3': 80, 'day4_7': 100,
        'day8_14': 120, 'day15_28': 135, 'month1_3': 150,
        'month4_6': 150, 'month4_6_cap': 900,
        'month6_12_base': 800, 'month6_12_decay': 30, 'month6_12_min': 600,
        'year1_plus': 500,
    }
    try:
        user_coeffs = json_module.loads(settings_dict.get('milk_coefficients', '{}'))
        default_coeffs.update(user_coeffs)
    except (ValueError, TypeError):
        pass
    c = default_coeffs

    if custom and custom.strip():
        target = float(custom)
        method = 'custom'
        detail = f'自定义目标: {target:.0f}ml/天'
    elif baby and baby['weight'] and baby['weight'] > 0:
        birth_str = baby['birth_date'] if baby['birth_date'] else ''
        if birth_str:
            birth = datetime.strptime(birth_str, '%Y-%m-%d').date()
            age_days = (date.today() - birth).days
        else:
            age_days = 30

        weight = baby['weight']

        if age_days <= 0:
            target = c['day0']
            method = 'weight'
            detail = f'出生首日: 固定 {target:.0f}ml/天'
        elif age_days <= 1:
            coeff = c['day1']
            target = weight * coeff
            method = 'weight'
            detail = f'日龄1天: {weight}kg × {coeff}ml/kg = {target:.0f}ml/天'
        elif age_days <= 3:
            coeff = c['day2_3']
            target = weight * coeff
            method = 'weight'
            detail = f'日龄{age_days}天: {weight}kg × {coeff}ml/kg = {target:.0f}ml/天'
        elif age_days <= 7:
            coeff = c['day4_7']
            target = weight * coeff
            method = 'weight'
            detail = f'日龄{age_days}天: {weight}kg × {coeff}ml/kg = {target:.0f}ml/天'
        elif age_days <= 14:
            coeff = c['day8_14']
            target = weight * coeff
            method = 'weight'
            detail = f'日龄{age_days}天: {weight}kg × {coeff}ml/kg = {target:.0f}ml/天'
        elif age_days <= 28:
            coeff = c['day15_28']
            target = weight * coeff
            method = 'weight'
            detail = f'日龄{age_days}天: {weight}kg × {coeff}ml/kg = {target:.0f}ml/天'
        elif age_days <= 90:
            coeff = c['month1_3']
            target = weight * coeff
            method = 'weight'
            detail = f'{age_days//30}月龄: {weight}kg × {coeff}ml/kg = {target:.0f}ml/天'
        elif age_days <= 180:
            coeff = c['month4_6']
            cap = c['month4_6_cap']
            target = min(weight * coeff, cap)
            method = 'weight'
            detail = f'{age_days//30}月龄: {weight}kg × {coeff}ml/kg = {target:.0f}ml/天(上限{cap}ml)'
        elif age_days <= 365:
            age_months = age_days // 30
            base = c['month6_12_base']
            decay = c['month6_12_decay']
            floor = c['month6_12_min']
            monthly_avg = max(floor, base - (age_months - 6) * decay)
            target = monthly_avg
            method = 'age_monthly'
            detail = f'{age_months}月龄: 月均参考 {monthly_avg:.0f}ml/天'
        else:
            target = c['year1_plus']
            method = 'age_monthly'
            detail = f'1岁以上: 建议 {target:.0f}ml/天'
    else:
        target = 500
        method = 'default'
        detail = '默认值: 500ml/天'

    per_feed = round(target / feeds_per_day) if feeds_per_day > 0 else 0
    per_feed = max(per_feed, 10)
    return {
        'daily_target_ml': round(target),
        'per_feed_ml': per_feed,
        'estimated_feeds_per_day': feeds_per_day,
        'method': method,
        'calculation_detail': detail,
        'coefficients': c
    }


# ── Template Context ──────────────────────────────────────

@app.context_processor
def inject_user():
    return {'current_user': current_user()}


# ── Page Routes ───────────────────────────────────────────

@app.route('/')
def dashboard():
    return render_template('dashboard.html')


@app.route('/login')
def login_page():
    return render_template('login.html')


@app.route('/register')
def register_page():
    return render_template('register.html')


@app.route('/history')
def history_page():
    return render_template('history.html')


@app.route('/trends')
def trends_page():
    return render_template('trends.html')


@app.route('/admin')
def admin_page():
    if not is_admin():
        return redirect('/login')
    return render_template('admin.html')


# ── API: Auth ─────────────────────────────────────────────

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({'error': '请输入用户名和密码'}), 400

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE username = ?", (data['username'],)).fetchone()
    if not user or not check_password_hash(user['password_hash'], data['password']):
        return jsonify({'error': '用户名或密码错误'}), 401

    if user['status'] == 'pending':
        return jsonify({'error': '账号待审批，请等待管理员审核'}), 403
    if user['status'] == 'rejected':
        return jsonify({'error': '账号已被拒绝，请联系管理员'}), 403

    session.permanent = True
    session['user_id'] = user['id']
    session['role'] = user['role']
    add_log('登录', 'user', user['id'], f"用户 {user['username']} 登录")
    return jsonify({
        'message': '登录成功',
        'user': {'id': user['id'], 'username': user['username'], 'nickname': user['nickname'], 'role': user['role']}
    })


@app.route('/api/auth/logout', methods=['POST'])
def logout():
    u = current_user()
    if u:
        add_log('登出', 'user', u['id'], f"用户 {u['username']} 登出")
    session.clear()
    return jsonify({'message': '已退出'})


@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({'error': '请输入用户名和密码'}), 400

    username = data['username'].strip()
    password = data['password']
    nickname = data.get('nickname', username).strip()

    if len(username) < 3:
        return jsonify({'error': '用户名至少3个字符'}), 400
    if len(password) < 6:
        return jsonify({'error': '密码至少6个字符'}), 400

    db = get_db()
    existing = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if existing:
        return jsonify({'error': '用户名已存在'}), 409

    db.execute(
        "INSERT INTO users (username, password_hash, nickname, role, status) VALUES (?, ?, ?, 'user', 'pending')",
        (username, generate_password_hash(password), nickname)
    )
    db.commit()
    add_log('注册', 'user', None, f"新用户注册: {username}")
    return jsonify({'message': '注册成功，请等待管理员审批'}), 201


@app.route('/api/auth/me', methods=['GET'])
def get_me():
    u = current_user()
    if not u:
        return jsonify({'user': None})
    return jsonify({
        'user': {
            'id': u['id'], 'username': u['username'],
            'nickname': u['nickname'], 'role': u['role'], 'status': u['status']
        }
    })


@app.route('/api/auth/nickname', methods=['PUT'])
def update_nickname():
    u = current_user()
    if not u:
        return jsonify({'error': '未登录'}), 401
    data = request.get_json()
    nickname = data.get('nickname', '').strip()
    if not nickname:
        return jsonify({'error': '昵称不能为空'}), 400
    db = get_db()
    old = u['nickname']
    db.execute("UPDATE users SET nickname = ? WHERE id = ?", (nickname, u['id']))
    db.commit()
    add_log('修改昵称', 'user', u['id'], f"'{old}' -> '{nickname}'")
    return jsonify({'message': '昵称已更新'})


# ── API: Quick Buttons ────────────────────────────────────

@app.route('/api/quick-buttons', methods=['GET'])
def get_quick_buttons():
    db = get_db()
    # 管理员看全部按钮，普通用户只看启用的
    if is_admin():
        rows = db.execute("SELECT * FROM quick_buttons ORDER BY sort_order").fetchall()
    else:
        rows = db.execute("SELECT * FROM quick_buttons WHERE is_active = 1 ORDER BY sort_order").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/quick-buttons', methods=['POST'])
def create_quick_button():
    if not is_admin():
        return jsonify({'error': '无权限'}), 403
    data = request.get_json()
    db = get_db()
    sort_order = data.get('sort_order', 0)
    # 将 >= sort_order 的已有按钮排序值全部 +1，避免冲突
    db.execute("UPDATE quick_buttons SET sort_order = sort_order + 1 WHERE sort_order >= ?", (sort_order,))
    cursor = db.execute(
        "INSERT INTO quick_buttons (type, sub_type, label, amount, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)",
        (data['type'], data['sub_type'], data['label'], data.get('amount', 0), sort_order)
    )
    db.commit()
    add_log('添加按钮', 'quick_button', cursor.lastrowid, data['label'])
    return jsonify({'message': '已添加'}), 201


@app.route('/api/quick-buttons/<int:btn_id>', methods=['PUT'])
def update_quick_button(btn_id):
    if not is_admin():
        return jsonify({'error': '无权限'}), 403
    data = request.get_json()
    db = get_db()

    existing = db.execute("SELECT * FROM quick_buttons WHERE id = ?", (btn_id,)).fetchone()
    if not existing:
        return jsonify({'error': '按钮不存在'}), 404

    all_fields = ['type', 'sub_type', 'label', 'amount', 'sort_order', 'is_active']
    updates = []
    params = []
    for f in all_fields:
        if f in data:
            updates.append(f"{f} = ?")
            params.append(data[f])

    if not updates:
        return jsonify({'message': '无变更'})

    new_order = data.get('sort_order', existing['sort_order'])
    if 'sort_order' in data and existing['sort_order'] != new_order:
        if new_order > existing['sort_order']:
            db.execute("UPDATE quick_buttons SET sort_order = sort_order - 1 WHERE sort_order > ? AND sort_order <= ? AND id != ?",
                       (existing['sort_order'], new_order, btn_id))
        else:
            db.execute("UPDATE quick_buttons SET sort_order = sort_order + 1 WHERE sort_order >= ? AND sort_order < ? AND id != ?",
                       (new_order, existing['sort_order'], btn_id))

    params.append(btn_id)
    db.execute(f"UPDATE quick_buttons SET {', '.join(updates)} WHERE id = ?", params)
    db.commit()
    add_log('修改按钮', 'quick_button', btn_id, data.get('label', ''))
    return jsonify({'message': '已更新'})


@app.route('/api/quick-buttons/reorder', methods=['POST'])
def reorder_quick_buttons():
    """接收按钮 ID 列表，按顺序重新分配 sort_order"""
    if not is_admin():
        return jsonify({'error': '无权限'}), 403
    data = request.get_json()
    ids = data.get('ids', [])
    db = get_db()
    for i, btn_id in enumerate(ids):
        db.execute("UPDATE quick_buttons SET sort_order = ? WHERE id = ?", (i + 1, btn_id))
    db.commit()
    return jsonify({'message': '排序已更新'})


@app.route('/api/quick-buttons/<int:btn_id>', methods=['DELETE'])
def delete_quick_button(btn_id):
    if not is_admin():
        return jsonify({'error': '无权限'}), 403
    db = get_db()
    # 获取被删按钮的排序值
    deleted = db.execute("SELECT sort_order FROM quick_buttons WHERE id = ?", (btn_id,)).fetchone()
    db.execute("DELETE FROM quick_buttons WHERE id = ?", (btn_id,))
    # 后面的按钮前移填补空位
    if deleted:
        db.execute("UPDATE quick_buttons SET sort_order = sort_order - 1 WHERE sort_order > ?", (deleted['sort_order'],))
    db.commit()
    add_log('删除按钮', 'quick_button', btn_id, '')
    return jsonify({'message': '已删除'})


# ── API: Quick Record (one-click) ─────────────────────────

@app.route('/api/quick-record/<int:btn_id>', methods=['POST'])
def quick_record(btn_id):
    if not is_approved():
        return jsonify({'error': '请先登录'}), 401

    db = get_db()
    btn = db.execute("SELECT * FROM quick_buttons WHERE id = ? AND is_active = 1", (btn_id,)).fetchone()
    if not btn:
        return jsonify({'error': '按钮不存在'}), 404

    u = current_user()
    # 使用前端传来的本地时间，若无则用服务端时间
    data = request.get_json() or {}
    timestamp = data.get('timestamp') or datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    # 前端传来的本地日期，用于概览查询，避免时区差异
    target_date = data.get('date')

    cursor = db.execute(
        """INSERT INTO records (baby_id, user_id, type, sub_type, amount, timestamp)
           VALUES (1, ?, ?, ?, ?, ?)""",
        (u['id'], btn['type'], btn['sub_type'], btn['amount'] if btn['amount'] is not None else None, timestamp)
    )
    db.commit()
    add_log('快速记录', 'record', cursor.lastrowid, f"{btn['label']} @ {timestamp}")

    # 直接返回更新后的今日概览数据，避免前端二次请求
    summary = _today_summary_data(db, target_date)
    summary['message'] = '记录成功'
    summary['record_id'] = cursor.lastrowid
    return jsonify(summary), 201


# ── API: Records ──────────────────────────────────────────

@app.route('/api/records/dates', methods=['GET'])
def get_record_dates():
    db = get_db()
    rows = db.execute("SELECT DISTINCT substr(timestamp, 1, 10) as d FROM records ORDER BY d").fetchall()
    return jsonify([r['d'] for r in rows])


@app.route('/api/records/<int:record_id>', methods=['GET'])
def get_record(record_id):
    db = get_db()
    r = db.execute("SELECT * FROM records WHERE id = ?", (record_id,)).fetchone()
    if not r:
        return jsonify({'error': '记录不存在'}), 404
    return jsonify(dict(r))


@app.route('/api/records', methods=['GET'])
def get_records():
    db = get_db()
    rec_date = request.args.get('date', date.today().isoformat())
    # 校验日期格式
    try:
        datetime.strptime(rec_date, '%Y-%m-%d')
    except ValueError:
        return jsonify({'error': '日期格式无效，需 YYYY-MM-DD'}), 400
    rec_type = request.args.get('type', None)
    if rec_type and rec_type not in ('feed', 'excrete', 'symptom', 'supplement'):
        return jsonify({'error': '无效的记录类型'}), 400
    start = f"{rec_date} 00:00:00"
    end = f"{rec_date} 23:59:59"

    if rec_type:
        rows = db.execute(
            "SELECT * FROM records WHERE timestamp >= ? AND timestamp <= ? AND type = ? ORDER BY timestamp DESC",
            (start, end, rec_type)
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM records WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC",
            (start, end)
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/records', methods=['POST'])
def create_record():
    if not is_approved():
        return jsonify({'error': '请先登录'}), 401
    data = request.get_json()
    if not data or 'type' not in data or 'sub_type' not in data:
        return jsonify({'error': '缺少必填字段'}), 400
    if data['type'] not in ('feed', 'excrete', 'symptom', 'supplement'):
        return jsonify({'error': '无效的记录类型'}), 400

    u = current_user()
    db = get_db()
    cursor = db.execute(
        """INSERT INTO records (baby_id, user_id, type, sub_type, amount, duration, color, consistency, temperature, note, timestamp)
           VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (u['id'], data['type'], data['sub_type'], data.get('amount'),
         data.get('duration'), data.get('color', ''), data.get('consistency', ''),
         data.get('temperature'), data.get('note', ''),
         data.get('timestamp', datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
    )
    db.commit()
    add_log('创建记录', 'record', cursor.lastrowid,
            f"{data['type']}/{data['sub_type']} {data.get('amount','')}ml")
    # 直接返回更新后的概览数据，避免前端二次请求命中不同 worker 读到旧数据
    target_date = data.get('_date')
    summary = _today_summary_data(db, target_date)
    summary['message'] = '记录成功'
    summary['record_id'] = cursor.lastrowid
    return jsonify(summary), 201


@app.route('/api/records/<int:record_id>', methods=['PUT'])
def update_record(record_id):
    """所有已登录用户均可编辑记录的所有内容"""
    if not is_approved():
        return jsonify({'error': '请先登录'}), 401

    db = get_db()
    existing = db.execute("SELECT * FROM records WHERE id = ?", (record_id,)).fetchone()
    if not existing:
        return jsonify({'error': '记录不存在'}), 404

    data = request.get_json()
    if data.get('type') and data['type'] not in ('feed', 'excrete', 'symptom', 'supplement'):
        return jsonify({'error': '无效的记录类型'}), 400

    # 前端传来的本地日期，用于概览查询
    target_date = data.get('_date')

    # 构建变更详情
    changes = []
    fields = ['type', 'sub_type', 'amount', 'duration', 'color', 'consistency', 'temperature', 'note', 'timestamp']
    for f in fields:
        if f in data:
            old_val = str(existing[f] or '')
            new_val = str(data[f] if data[f] is not None else '')
            if old_val != new_val:
                changes.append(f"{f}: '{old_val}'->'{new_val}'")

    # 逐字段更新，支持设为空值
    updates = []
    params = []
    for f in fields:
        if f in data:
            updates.append(f"{f} = ?")
            params.append(data[f])
    if updates:
        params.append(record_id)
        db.execute(f"UPDATE records SET {', '.join(updates)} WHERE id = ?", params)
    db.commit()
    add_log('编辑记录', 'record', record_id, '; '.join(changes) if changes else '无变更')
    # 直接返回更新后的概览数据，避免前端二次请求命中不同 worker 读到旧数据
    summary = _today_summary_data(db, target_date)
    summary['message'] = '已更新'
    return jsonify(summary)


@app.route('/api/records/<int:record_id>', methods=['DELETE'])
def delete_record(record_id):
    if not is_approved():
        return jsonify({'error': '请先登录'}), 401

    db = get_db()
    existing = db.execute("SELECT * FROM records WHERE id = ?", (record_id,)).fetchone()
    if not existing:
        return jsonify({'error': '记录不存在'}), 404

    detail = f"{existing['type']}/{existing['sub_type']} {existing['amount'] or ''}ml @ {existing['timestamp']}"
    db.execute("DELETE FROM records WHERE id = ?", (record_id,))
    db.commit()
    add_log('删除记录', 'record', record_id, detail)
    # 直接返回更新后的概览数据，避免前端二次请求命中不同 worker 读到旧数据
    target_date = request.args.get('date')
    summary = _today_summary_data(db, target_date)
    summary['message'] = '已删除'
    return jsonify(summary)


def _today_summary_data(db, target_date=None):
    """提取今日概览数据，供 quick_record 和 today_summary 共用"""
    if target_date is None:
        target_date = date.today().isoformat()
    today_str = target_date if isinstance(target_date, str) else target_date.isoformat()
    start = f"{today_str} 00:00:00"
    end = f"{today_str} 23:59:59"

    baby = db.execute("SELECT * FROM babies LIMIT 1").fetchone()
    settings_rows = db.execute("SELECT key, value FROM settings").fetchall()
    settings_dict = {r['key']: r['value'] for r in settings_rows}
    estimate = estimate_milk(dict(baby) if baby else None, settings_dict)

    today_records = db.execute(
        "SELECT * FROM records WHERE timestamp >= ? AND timestamp <= ? AND type IN ('feed', 'excrete')",
        (start, end)
    ).fetchall()
    feeds = [r for r in today_records if r['type'] == 'feed']
    excretes = [r for r in today_records if r['type'] == 'excrete']

    total_feed_ml = sum(f['amount'] or 0 for f in feeds)
    feed_count = len(feeds)
    target_ml = estimate['daily_target_ml']
    remaining_ml = max(0, target_ml - total_feed_ml)

    # 动态计算：根据今日实际平均每次奶量推算预计喂养次数
    if feed_count > 0 and total_feed_ml > 0:
        avg_per_feed = total_feed_ml / feed_count
        dynamic_feeds_per_day = max(feed_count, round(target_ml / avg_per_feed))
        dynamic_per_feed = round(remaining_ml / (dynamic_feeds_per_day - feed_count)) if dynamic_feeds_per_day > feed_count else round(avg_per_feed)
    else:
        dynamic_feeds_per_day = estimate['estimated_feeds_per_day']
        dynamic_per_feed = estimate['per_feed_ml']

    feeds_left = max(0, dynamic_feeds_per_day - feed_count)
    feed_progress = min(1.0, total_feed_ml / target_ml) if target_ml > 0 else 0

    urine_count = sum(1 for e in excretes if e['sub_type'] in ('urine', 'both'))
    stool_count = sum(1 for e in excretes if e['sub_type'] in ('stool', 'both'))

    last_feed = feeds[-1] if feeds else None
    last_feed_time = last_feed['timestamp'] if last_feed else None

    recent = db.execute("SELECT * FROM records ORDER BY timestamp DESC LIMIT 5").fetchall()

    buttons = []
    if is_approved():
        btn_rows = db.execute("SELECT * FROM quick_buttons WHERE is_active = 1 ORDER BY sort_order").fetchall()
        buttons = [dict(b) for b in btn_rows]

    return {
        'date': today_str,
        'total_feed_ml': round(total_feed_ml),
        'feed_count': feed_count,
        'target_ml': target_ml,
        'remaining_ml': round(remaining_ml),
        'estimated_feeds_per_day': dynamic_feeds_per_day,
        'estimated_feeds_left': feeds_left,
        'feed_progress': round(feed_progress, 3),
        'per_feed_ml': dynamic_per_feed,
        'urine_count': urine_count,
        'stool_count': stool_count,
        'last_feed_time': last_feed_time,
        'estimate': estimate,
        'recent_records': [dict(r) for r in recent],
        'quick_buttons': buttons,
        'logged_in': is_approved(),
        'is_admin': is_admin()
    }


@app.route('/api/records/today', methods=['GET'])
def today_summary():
    target_date = request.args.get('date') or date.today().isoformat()
    db = get_db()
    return jsonify(_today_summary_data(db, target_date))


# ── API: Baby ─────────────────────────────────────────────

@app.route('/api/baby', methods=['GET'])
def get_baby():
    db = get_db()
    baby = db.execute("SELECT * FROM babies LIMIT 1").fetchone()
    if not baby:
        return jsonify({'error': '未找到婴儿信息'}), 404
    return jsonify(dict(baby))


@app.route('/api/baby', methods=['PUT'])
def update_baby():
    if not is_admin():
        return jsonify({'error': '仅管理员可修改'}), 403
    data = request.get_json()
    db = get_db()
    baby = db.execute("SELECT id FROM babies LIMIT 1").fetchone()
    if baby:
        db.execute("UPDATE babies SET name=?, gender=?, birth_date=?, weight=? WHERE id=?",
                    (data.get('name', '宝宝'), data.get('gender', 'male'),
                     data.get('birth_date', date.today().isoformat()),
                     data.get('weight', 3.0), baby['id']))
    else:
        db.execute("INSERT INTO babies (name, gender, birth_date, weight) VALUES (?, ?, ?, ?)",
                    (data.get('name', '宝宝'), data.get('gender', 'male'),
                     data.get('birth_date', date.today().isoformat()),
                     data.get('weight', 3.0)))
    db.commit()
    add_log('修改婴儿信息', 'baby', 1, f"{data.get('name','')}/{data.get('weight','')}kg")
    return jsonify({'message': '已更新'})


# ── API: Settings ─────────────────────────────────────────

@app.route('/api/settings', methods=['GET'])
def get_settings():
    db = get_db()
    rows = db.execute("SELECT key, value FROM settings").fetchall()
    return jsonify({r['key']: r['value'] for r in rows})


@app.route('/api/settings', methods=['PUT'])
def update_settings():
    if not is_admin():
        return jsonify({'error': '仅管理员可修改'}), 403
    data = request.get_json()
    db = get_db()
    for key, value in data.items():
        db.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=?, updated_at=datetime('now','localtime')",
            (key, str(value), str(value))
        )
    db.commit()
    add_log('修改设置', 'settings', None, json_module.dumps(data, ensure_ascii=False))
    return jsonify({'message': '设置已更新'})


@app.route('/api/milk-estimate', methods=['GET'])
def get_milk_estimate():
    db = get_db()
    baby = db.execute("SELECT * FROM babies LIMIT 1").fetchone()
    settings_rows = db.execute("SELECT key, value FROM settings").fetchall()
    settings_dict = {r['key']: r['value'] for r in settings_rows}
    return jsonify(estimate_milk(dict(baby) if baby else None, settings_dict))


# ── API: Users (Admin) ────────────────────────────────────

@app.route('/api/users', methods=['GET'])
def get_users():
    if not is_admin():
        return jsonify({'error': '无权限'}), 403
    db = get_db()
    rows = db.execute("SELECT id, username, nickname, role, status, created_at FROM users ORDER BY created_at DESC").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/users/<int:user_id>/approve', methods=['POST'])
def approve_user(user_id):
    if not is_admin():
        return jsonify({'error': '无权限'}), 403
    db = get_db()
    user = db.execute("SELECT username FROM users WHERE id = ?", (user_id,)).fetchone()
    db.execute("UPDATE users SET status = 'approved' WHERE id = ?", (user_id,))
    db.commit()
    add_log('审批用户', 'user', user_id, f"批准 {user['username'] if user else user_id}")
    return jsonify({'message': '已批准'})


@app.route('/api/users/<int:user_id>/reject', methods=['POST'])
def reject_user(user_id):
    if not is_admin():
        return jsonify({'error': '无权限'}), 403
    db = get_db()
    user = db.execute("SELECT username FROM users WHERE id = ?", (user_id,)).fetchone()
    db.execute("UPDATE users SET status = 'rejected' WHERE id = ?", (user_id,))
    db.commit()
    add_log('审批用户', 'user', user_id, f"拒绝 {user['username'] if user else user_id}")
    return jsonify({'message': '已拒绝'})


@app.route('/api/users/<int:user_id>', methods=['DELETE'])
def delete_user(user_id):
    if not is_admin():
        return jsonify({'error': '无权限'}), 403
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if user and user['role'] == 'admin':
        return jsonify({'error': '不能删除管理员'}), 400
    db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    db.commit()
    add_log('删除用户', 'user', user_id, user['username'] if user else '')
    return jsonify({'message': '已删除'})


@app.route('/api/users/<int:user_id>/password', methods=['PUT'])
def reset_user_password(user_id):
    """管理员重置用户密码"""
    if not is_admin():
        return jsonify({'error': '无权限'}), 403
    data = request.get_json()
    new_password = data.get('password', '').strip()
    if len(new_password) < 6:
        return jsonify({'error': '密码至少6个字符'}), 400
    db = get_db()
    user = db.execute("SELECT username FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        return jsonify({'error': '用户不存在'}), 404
    db.execute("UPDATE users SET password_hash = ? WHERE id = ?",
               (generate_password_hash(new_password), user_id))
    db.commit()
    add_log('重置密码', 'user', user_id, f"重置 {user['username']} 的密码")
    return jsonify({'message': '密码已重置'})


@app.route('/api/users/<int:user_id>/username', methods=['PUT'])
def update_username(user_id):
    """管理员修改用户登录名"""
    if not is_admin():
        return jsonify({'error': '无权限'}), 403
    data = request.get_json()
    new_username = data.get('username', '').strip()
    if not new_username or len(new_username) < 2:
        return jsonify({'error': '用户名至少2个字符'}), 400
    db = get_db()
    user = db.execute("SELECT username FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        return jsonify({'error': '用户不存在'}), 404
    existing = db.execute("SELECT id FROM users WHERE username = ? AND id != ?", (new_username, user_id)).fetchone()
    if existing:
        return jsonify({'error': '用户名已存在'}), 409
    old_username = user['username']
    db.execute("UPDATE users SET username = ? WHERE id = ?", (new_username, user_id))
    db.commit()
    add_log('修改用户名', 'user', user_id, f"{old_username} → {new_username}")
    return jsonify({'message': '用户名已更新', 'username': new_username})


# ── API: Audit Logs ───────────────────────────────────────

@app.route('/api/audit-logs', methods=['GET'])
def get_audit_logs():
    if not is_admin():
        return jsonify({'error': '无权限'}), 403
    db = get_db()
    limit = request.args.get('limit', 100, type=int)
    limit = min(limit, 500)
    rows = db.execute(
        "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?", (limit,)
    ).fetchall()
    return jsonify([dict(r) for r in rows])


# ── API: Export ───────────────────────────────────────────

@app.route('/api/export/csv', methods=['GET'])
def export_csv():
    if not is_admin():
        return jsonify({'error': '无权限'}), 403
    db = get_db()
    rows = db.execute("SELECT * FROM records ORDER BY timestamp DESC").fetchall()
    output = StringIO()
    writer = csv.writer(output)
    # 中文列名 + 中文类型映射
    type_map = {'feed': '喂养', 'excrete': '排泄', 'symptom': '症状', 'supplement': '补充'}
    sub_map = {
        'breast_left': '母乳(左)', 'breast_right': '母乳(右)', 'formula': '配方奶', 'water': '水',
        'urine': '尿', 'stool': '便', 'both': '尿+便',
        'vomit': '呕吐', 'fever': '发热', 'jaundice': '黄疸', 'rash': '皮疹',
        'vitamin_d': '维D', 'vitamin_ad': '维AD', 'iron': '铁剂', 'calcium': '钙剂', 'dha': 'DHA', 'probiotics': '益生菌',
    }
    writer.writerow(['ID', '类型', '子类型', '量(ml)', '时长(分)', '颜色', '性状', '体温', '备注', '时间'])
    for r in rows:
        writer.writerow([r['id'], type_map.get(r['type'], r['type']), sub_map.get(r['sub_type'], r['sub_type']),
                         r['amount'], r['duration'], r['color'], r['consistency'], r['temperature'], r['note'], r['timestamp']])
    output.seek(0)
    buf = BytesIO()
    buf.write(output.getvalue().encode('utf-8-sig'))
    buf.seek(0)
    add_log('导出CSV', 'data', None, f'{len(rows)}条记录')
    return send_file(buf, mimetype='text/csv', as_attachment=True, download_name=f'baby_records_{date.today().isoformat()}.csv')


@app.route('/api/backup/export', methods=['GET'])
def backup_export():
    """导出完整数据库备份（JSON格式）"""
    if not is_admin():
        return jsonify({'error': '无权限'}), 403
    db = get_db()
    backup = {
        'version': 1,
        'exported_at': datetime.now().isoformat(),
        'tables': {}
    }
    # 导出所有数据表
    table_cols = {
        'babies': ['id', 'name', 'gender', 'birth_date', 'weight', 'created_at'],
        'records': ['id', 'baby_id', 'user_id', 'type', 'sub_type', 'amount', 'duration', 'color', 'consistency', 'temperature', 'note', 'timestamp', 'created_at'],
        'settings': ['id', 'key', 'value', 'updated_at'],
        'users': ['id', 'username', 'password_hash', 'nickname', 'role', 'status', 'created_at'],
        'quick_buttons': ['id', 'type', 'sub_type', 'label', 'amount', 'sort_order', 'is_active', 'created_at'],
        'weight_logs': ['id', 'baby_id', 'weight', 'recorded_date', 'note', 'created_at'],
        'vaccine_records': ['id', 'vaccine_name', 'dose_index', 'vaccinated_date', 'note', 'created_at'],
        'vaccine_plan_overrides': ['vaccine_name', 'dose_index', 'custom_due_date'],
    }
    for table, cols in table_cols.items():
        try:
            rows = db.execute(f"SELECT {','.join(cols)} FROM {table}").fetchall()
            backup['tables'][table] = {
                'columns': cols,
                'rows': [dict(zip(cols, row)) for row in rows]
            }
        except Exception:
            backup['tables'][table] = {'columns': cols, 'rows': []}

    buf = BytesIO()
    buf.write(json_module.dumps(backup, ensure_ascii=False, indent=2).encode('utf-8'))
    buf.seek(0)
    add_log('导出备份', 'data', None, '完整数据库备份')
    return send_file(buf, mimetype='application/json', as_attachment=True,
                     download_name=f'baby_backup_{date.today().isoformat()}.json')


@app.route('/api/backup/restore', methods=['POST'])
def backup_restore():
    """从JSON备份恢复数据"""
    if not is_admin():
        return jsonify({'error': '无权限'}), 403

    # 检查是否有上传文件
    if 'file' not in request.files:
        return jsonify({'error': '请选择备份文件'}), 400

    f = request.files['file']
    if not f.filename:
        return jsonify({'error': '文件为空'}), 400

    try:
        backup = json_module.loads(f.read().decode('utf-8'))
    except Exception as e:
        return jsonify({'error': f'文件解析失败: {str(e)}'}), 400

    if 'version' not in backup or 'tables' not in backup:
        return jsonify({'error': '无效的备份文件格式'}), 400

    db = get_db()
    restored_counts = {}

    # 恢复顺序：先恢复无外键依赖的表
    restore_order = ['babies', 'users', 'settings', 'quick_buttons', 'records', 'weight_logs', 'vaccine_records', 'vaccine_plan_overrides']

    for table in restore_order:
        if table not in backup['tables']:
            continue
        tdata = backup['tables'][table]
        cols = tdata.get('columns', [])
        rows = tdata.get('rows', [])
        if not rows:
            continue

        # 清空表（按依赖顺序反序删除）
        try:
            db.execute(f"DELETE FROM {table}")
        except Exception:
            continue

        # 插入数据
        placeholders = ','.join(['?'] * len(cols))
        col_str = ','.join(cols)
        count = 0
        for row in rows:
            values = [row.get(c) for c in cols]
            try:
                db.execute(f"INSERT OR IGNORE INTO {table} ({col_str}) VALUES ({placeholders})", values)
                count += 1
            except Exception:
                continue
        restored_counts[table] = count

    db.commit()
    add_log('恢复备份', 'data', None, f'恢复: {json_module.dumps(restored_counts, ensure_ascii=False)}')
    return jsonify({'message': '备份已恢复', 'counts': restored_counts})


@app.route('/api/data/clear', methods=['POST'])
def clear_data():
    if not is_admin():
        return jsonify({'error': '无权限'}), 403
    db = get_db()
    db.execute("DELETE FROM records")
    db.commit()
    add_log('清除数据', 'data', None, '清除所有记录')
    # 直接返回更新后的概览数据
    target_date = request.args.get('date') or (request.get_json() or {}).get('_date')
    summary = _today_summary_data(db, target_date)
    summary['message'] = '所有记录已清除'
    return jsonify(summary)


@app.route('/api/stats', methods=['GET'])
def get_stats():
    db = get_db()
    row = db.execute("""
        SELECT COUNT(*) as total_records,
               SUM(CASE WHEN type='feed' THEN 1 ELSE 0 END) as total_feeds,
               COALESCE(SUM(CASE WHEN type='feed' THEN amount ELSE 0 END), 0) as total_ml,
               COUNT(DISTINCT date(timestamp)) as tracked_days
        FROM records
    """).fetchone()
    pending = db.execute("SELECT COUNT(*) as c FROM users WHERE status='pending'").fetchone()['c']
    return jsonify({
        'total_records': row['total_records'],
        'total_feeds': row['total_feeds'],
        'total_ml': round(row['total_ml']),
        'tracked_days': row['tracked_days'],
        'pending_users': pending
    })


# ── API: Weight Logs ─────────────────────────────────────

@app.route('/api/weight-logs', methods=['GET'])
def get_weight_logs():
    db = get_db()
    rows = db.execute("SELECT * FROM weight_logs ORDER BY recorded_date DESC").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/weight-logs', methods=['POST'])
def add_weight_log():
    if not is_approved():
        return jsonify({'error': '请先登录'}), 401
    data = request.get_json()
    if not data or 'weight' not in data or 'recorded_date' not in data:
        return jsonify({'error': '缺少必填字段'}), 400
    db = get_db()
    cursor = db.execute(
        "INSERT INTO weight_logs (baby_id, weight, recorded_date, note) VALUES (1, ?, ?, ?)",
        (data['weight'], data['recorded_date'], data.get('note', ''))
    )
    # 同步更新婴儿当前体重
    db.execute("UPDATE babies SET weight = ? WHERE id = 1", (data['weight'],))
    db.commit()
    add_log('记录体重', 'weight_log', cursor.lastrowid, f"{data['weight']}kg @ {data['recorded_date']}")
    return jsonify({'id': cursor.lastrowid, 'message': '已记录'}), 201


@app.route('/api/weight-logs/<int:log_id>', methods=['DELETE'])
def delete_weight_log(log_id):
    if not is_admin():
        return jsonify({'error': '仅管理员可删除'}), 403
    db = get_db()
    db.execute("DELETE FROM weight_logs WHERE id = ?", (log_id,))
    db.commit()
    add_log('删除体重', 'weight_log', log_id, '')
    return jsonify({'message': '已删除'})


@app.route('/api/weight-logs/<int:log_id>', methods=['PUT'])
def update_weight_log(log_id):
    if not is_approved():
        return jsonify({'error': '无权限'}), 403
    data = request.get_json()
    weight = data.get('weight')
    recorded_date = data.get('recorded_date')
    note = data.get('note', '')
    if not weight or weight <= 0:
        return jsonify({'error': '请输入有效体重'}), 400
    if not recorded_date:
        return jsonify({'error': '请选择日期'}), 400
    db = get_db()
    db.execute("UPDATE weight_logs SET weight=?, recorded_date=?, note=? WHERE id=?",
               (weight, recorded_date, note, log_id))
    db.commit()
    add_log('编辑体重', 'weight_log', log_id, f"{weight}kg @ {recorded_date}")
    return jsonify({'message': '已更新'})


# ── API: Statistics ───────────────────────────────────────

@app.route('/api/stats/trends', methods=['GET'])
def get_trends():
    """获取趋势统计数据，默认最近14天"""
    days = request.args.get('days', 14, type=int)
    days = min(days, 90)

    db = get_db()
    today = date.today()
    start_date = today - timedelta(days=days-1)

    # 每日喂养量
    feed_daily = db.execute("""
        SELECT date(timestamp) as d,
               COALESCE(SUM(amount), 0) as total_ml,
               COUNT(*) as feed_count
        FROM records
        WHERE type='feed' AND timestamp >= ?
        GROUP BY date(timestamp) ORDER BY d
    """, (start_date.isoformat(),)).fetchall()

    # 每日排泄次数
    excrete_daily = db.execute("""
        SELECT date(timestamp) as d,
               SUM(CASE WHEN sub_type IN ('urine','both') THEN 1 ELSE 0 END) as urine_count,
               SUM(CASE WHEN sub_type IN ('stool','both') THEN 1 ELSE 0 END) as stool_count
        FROM records
        WHERE type='excrete' AND timestamp >= ?
        GROUP BY date(timestamp) ORDER BY d
    """, (start_date.isoformat(),)).fetchall()

    # 喂养时段分布
    feed_hours = db.execute("""
        SELECT CAST(strftime('%H', timestamp) AS INTEGER) as hour,
               COUNT(*) as count
        FROM records
        WHERE type='feed' AND timestamp >= ?
        GROUP BY hour ORDER BY hour
    """, (start_date.isoformat(),)).fetchall()

    feed_hours_by_day = db.execute("""
        SELECT DATE(timestamp) as date,
               CAST(strftime('%H', timestamp) AS INTEGER) as hour,
               COUNT(*) as count
        FROM records
        WHERE type='feed' AND timestamp >= ?
        GROUP BY date, hour ORDER BY date, hour
    """, (start_date.isoformat(),)).fetchall()

    # 体重记录
    weights = db.execute("""
        SELECT id, weight, recorded_date, note FROM weight_logs
        WHERE recorded_date >= ?
        ORDER BY recorded_date
    """, (start_date.isoformat(),)).fetchall()

    # 获取当前奶量目标
    baby = db.execute("SELECT * FROM babies LIMIT 1").fetchone()
    settings_rows = db.execute("SELECT key, value FROM settings").fetchall()
    settings_dict = {r['key']: r['value'] for r in settings_rows}
    estimate = estimate_milk(dict(baby) if baby else None, settings_dict)
    target_ml = estimate['daily_target_ml']

    # 填充空白天
    feed_map = {r['d']: dict(r) for r in feed_daily}
    excrete_map = {r['d']: dict(r) for r in excrete_daily}

    daily_data = []
    for i in range(days):
        d = (start_date + timedelta(days=i)).isoformat()
        daily_data.append({
            'date': d,
            'feed_ml': feed_map.get(d, {}).get('total_ml', 0),
            'feed_count': feed_map.get(d, {}).get('feed_count', 0),
            'urine_count': excrete_map.get(d, {}).get('urine_count', 0),
            'stool_count': excrete_map.get(d, {}).get('stool_count', 0),
        })

    return jsonify({
        'daily': daily_data,
        'feed_hours': [dict(r) for r in feed_hours],
        'feed_hours_by_day': [dict(r) for r in feed_hours_by_day],
        'weights': [dict(r) for r in weights],
        'target_ml': target_ml,
        'days': days,
    })


# ── Vaccine Schedule (2024 国家免疫规划) ──────────────────

# 国家免疫规划疫苗儿童免疫程序表（2024年版）
# age_months: 接种月龄（0=出生时, 1=1月龄, ...）
# dose_index: 第几剂（1-based）
# 注：自2025年1月1日起，百白破疫苗共接种5剂次
VACCINE_SCHEDULE = [
    # 乙肝疫苗 HepB - 出生时/1月龄/6月龄
    {"name": "乙肝疫苗", "short": "HepB", "age_months": 0, "dose_index": 1, "note": "出生24小时内"},
    {"name": "乙肝疫苗", "short": "HepB", "age_months": 1, "dose_index": 2, "note": ""},
    {"name": "乙肝疫苗", "short": "HepB", "age_months": 6, "dose_index": 3, "note": ""},
    # 卡介苗 BCG - 出生时
    {"name": "卡介苗", "short": "BCG", "age_months": 0, "dose_index": 1, "note": "出生时"},
    # 脊灰灭活疫苗 IPV - 2月龄/3月龄
    {"name": "脊灰灭活疫苗", "short": "IPV", "age_months": 2, "dose_index": 1, "note": ""},
    {"name": "脊灰灭活疫苗", "short": "IPV", "age_months": 3, "dose_index": 2, "note": ""},
    # 脊灰减毒活疫苗 bOPV - 4月龄/4岁
    {"name": "脊灰减毒活疫苗", "short": "bOPV", "age_months": 4, "dose_index": 3, "note": ""},
    {"name": "脊灰减毒活疫苗", "short": "bOPV", "age_months": 48, "dose_index": 4, "note": "4岁"},
    # 百白破疫苗 DTaP - 2025新规：2/4/6月龄+18月龄+6岁（共5剂）
    {"name": "百白破疫苗", "short": "DTaP", "age_months": 2, "dose_index": 1, "note": "2025新规"},
    {"name": "百白破疫苗", "short": "DTaP", "age_months": 4, "dose_index": 2, "note": "2025新规"},
    {"name": "百白破疫苗", "short": "DTaP", "age_months": 6, "dose_index": 3, "note": "2025新规"},
    {"name": "百白破疫苗", "short": "DTaP", "age_months": 18, "dose_index": 4, "note": "18月龄加强"},
    {"name": "百白破疫苗", "short": "DTaP", "age_months": 72, "dose_index": 5, "note": "6岁加强"},
    # A群流脑多糖疫苗 MPSV-A - 6月龄/9月龄
    {"name": "A群流脑多糖疫苗", "short": "MPSV-A", "age_months": 6, "dose_index": 1, "note": ""},
    {"name": "A群流脑多糖疫苗", "short": "MPSV-A", "age_months": 9, "dose_index": 2, "note": "间隔3月"},
    # A群C群流脑多糖疫苗 MPSV-AC - 3岁/6岁
    {"name": "A群C群流脑多糖疫苗", "short": "MPSV-AC", "age_months": 36, "dose_index": 1, "note": "3岁"},
    {"name": "A群C群流脑多糖疫苗", "short": "MPSV-AC", "age_months": 72, "dose_index": 2, "note": "6岁"},
    # 麻腮风疫苗 MMR - 8月龄/18月龄
    {"name": "麻腮风疫苗", "short": "MMR", "age_months": 8, "dose_index": 1, "note": ""},
    {"name": "麻腮风疫苗", "short": "MMR", "age_months": 18, "dose_index": 2, "note": ""},
    # 乙脑减毒活疫苗 JE-L - 8月龄/2岁
    {"name": "乙脑减毒活疫苗", "short": "JE-L", "age_months": 8, "dose_index": 1, "note": ""},
    {"name": "乙脑减毒活疫苗", "short": "JE-L", "age_months": 24, "dose_index": 2, "note": "2岁"},
    # 乙脑灭活疫苗 JE-I - 8月龄2剂/2岁/6岁（替代方案）
    {"name": "乙脑灭活疫苗", "short": "JE-I", "age_months": 8, "dose_index": 1, "note": "减毒替代方案"},
    {"name": "乙脑灭活疫苗", "short": "JE-I", "age_months": 8, "dose_index": 2, "note": "间隔7-10天"},
    {"name": "乙脑灭活疫苗", "short": "JE-I", "age_months": 24, "dose_index": 3, "note": "2岁"},
    {"name": "乙脑灭活疫苗", "short": "JE-I", "age_months": 72, "dose_index": 4, "note": "6岁"},
    # 甲肝减毒活疫苗 HepA-L - 18月龄
    {"name": "甲肝减毒活疫苗", "short": "HepA-L", "age_months": 18, "dose_index": 1, "note": "18月龄"},
    # 甲肝灭活疫苗 HepA-I - 18月龄/2岁（替代方案）
    {"name": "甲肝灭活疫苗", "short": "HepA-I", "age_months": 18, "dose_index": 1, "note": "减毒替代方案"},
    {"name": "甲肝灭活疫苗", "short": "HepA-I", "age_months": 24, "dose_index": 2, "note": "间隔6月"},
]


@app.route('/vaccine')
def vaccine_page():
    return render_template('vaccine.html', active_page='vaccine')


@app.route('/api/vaccine/schedule', methods=['GET'])
def vaccine_schedule():
    """返回疫苗规划 + 接种状态"""
    db = get_db()
    baby = db.execute("SELECT * FROM babies LIMIT 1").fetchone()
    if not baby or not baby['birth_date']:
        return jsonify({'error': '请先设置宝宝出生日期', 'schedule': [], 'overview': None})

    try:
        birth = datetime.strptime(baby['birth_date'], '%Y-%m-%d')
    except (ValueError, TypeError):
        return jsonify({'error': '出生日期格式无效', 'schedule': [], 'overview': None})

    today = date.today()
    age_days = (today - birth.date()).days
    age_months = age_days / 30.44

    # 获取已接种记录
    records = db.execute("SELECT * FROM vaccine_records ORDER BY vaccinated_date").fetchall()
    record_map = {}
    for r in records:
        record_map[(r['vaccine_name'], r['dose_index'])] = dict(r)

    # 获取自定义计划日期覆盖
    overrides = db.execute("SELECT * FROM vaccine_plan_overrides").fetchall()
    override_map = {}
    for o in overrides:
        override_map[(o['vaccine_name'], o['dose_index'])] = o['custom_due_date']

    # 互斥疫苗：如果已接种灭活则隐藏减毒，反之亦然
    # 乙脑：减毒(JE-L) vs 灭活(JE-I) 二选一
    # 甲肝：减毒(HepA-L) vs 灭活(HepA-I) 二选一
    je_done = any(r['vaccine_name'].startswith('乙脑') for r in records)
    hepa_done = any(r['vaccine_name'].startswith('甲肝') for r in records)
    je_inactivated_done = any(r['vaccine_name'] == '乙脑灭活疫苗' for r in records)
    hepa_inactivated_done = any(r['vaccine_name'] == '甲肝灭活疫苗' for r in records)

    # 默认显示减毒版；如果已接种灭活版则显示灭活版隐藏减毒版
    schedule_filtered = []
    for v in VACCINE_SCHEDULE:
        # 乙脑互斥
        if v['short'] == 'JE-L' and je_inactivated_done:
            continue
        if v['short'] == 'JE-I' and not je_inactivated_done and je_done:
            continue
        # 甲肝互斥
        if v['short'] == 'HepA-L' and hepa_inactivated_done:
            continue
        if v['short'] == 'HepA-I' and not hepa_inactivated_done and hepa_done:
            continue
        schedule_filtered.append(v)

    # 构建完整计划：标准计划 + 自定义疫苗记录
    schedule = []
    for v in schedule_filtered:
        default_due = (birth + timedelta(days=int(v['age_months'] * 30.44))).strftime('%Y-%m-%d')
        key = (v['name'], v['dose_index'])
        rec = record_map.get(key)
        # 如果有自定义计划日期且未接种，使用自定义日期
        custom_due = override_map.get(key)
        due_date = custom_due if (custom_due and not rec) else default_due
        entry = {
            **v,
            'due_date': due_date,
            'default_due_date': default_due,
            'status': 'done' if rec else ('overdue' if due_date <= today.isoformat() else 'upcoming'),
            'vaccinated_date': rec['vaccinated_date'] if rec else None,
            'note_text': rec['note'] if rec else v.get('note', ''),
            'is_custom': False,
        }
        schedule.append(entry)

    # 添加自定义疫苗记录（不在标准计划中的）
    standard_names = {v['name'] for v in VACCINE_SCHEDULE}
    custom_records = [r for r in records if r['vaccine_name'] not in standard_names]
    # 按疫苗名分组
    custom_groups = {}
    for r in custom_records:
        if r['vaccine_name'] not in custom_groups:
            custom_groups[r['vaccine_name']] = []
        custom_groups[r['vaccine_name']].append(dict(r))
    for name, recs in custom_groups.items():
        for rec in recs:
            schedule.append({
                'name': name,
                'short': 'Custom',
                'age_months': 0,
                'dose_index': rec['dose_index'],
                'note': '',
                'due_date': rec['vaccinated_date'],
                'status': 'done',
                'vaccinated_date': rec['vaccinated_date'],
                'note_text': rec['note'],
                'is_custom': True,
            })

    # 概览
    last_done = None
    next_upcoming = None
    for s in schedule:
        if s['status'] == 'done':
            last_done = s
        elif s['status'] in ('upcoming', 'overdue') and next_upcoming is None:
            next_upcoming = s

    overview = {
        'age_months': round(age_months, 1),
        'age_days': age_days,
        'total_doses': len(schedule),
        'done_count': sum(1 for s in schedule if s['status'] == 'done'),
        'overdue_count': sum(1 for s in schedule if s['status'] == 'overdue'),
        'last_done': last_done,
        'next_upcoming': next_upcoming,
    }
    if next_upcoming:
        due = datetime.strptime(next_upcoming['due_date'], '%Y-%m-%d').date()
        overview['next_days'] = (due - today).days

    return jsonify({'schedule': schedule, 'overview': overview})


@app.route('/api/vaccine/record', methods=['POST'])
def vaccine_record_add():
    """记录疫苗接种"""
    if not is_approved():
        return jsonify({'error': '无权限'}), 403
    data = request.get_json()
    db = get_db()
    db.execute(
        "INSERT OR REPLACE INTO vaccine_records (vaccine_name, dose_index, vaccinated_date, note) VALUES (?, ?, ?, ?)",
        (data['vaccine_name'], data['dose_index'], data['vaccinated_date'], data.get('note', ''))
    )
    db.commit()
    add_log('记录疫苗', 'vaccine', None, f"{data['vaccine_name']}第{data['dose_index']}剂")
    return jsonify({'message': '已记录'})


@app.route('/api/vaccine/record', methods=['DELETE'])
def vaccine_record_delete():
    """删除疫苗接种记录"""
    if not is_approved():
        return jsonify({'error': '无权限'}), 403
    data = request.get_json()
    db = get_db()
    db.execute("DELETE FROM vaccine_records WHERE vaccine_name = ? AND dose_index = ?",
               (data['vaccine_name'], data['dose_index']))
    db.commit()
    add_log('删除疫苗记录', 'vaccine', None, f"{data['vaccine_name']}第{data['dose_index']}剂")
    return jsonify({'message': '已删除'})


@app.route('/api/vaccine/plan-date', methods=['PUT'])
def update_vaccine_plan_date():
    """修改未接种项目的计划日期"""
    if not is_approved():
        return jsonify({'error': '无权限'}), 403
    data = request.get_json()
    vaccine_name = data.get('vaccine_name', '').strip()
    dose_index = data.get('dose_index')
    custom_due_date = data.get('custom_due_date', '').strip()
    if not vaccine_name or not dose_index:
        return jsonify({'error': '参数不完整'}), 400
    if not custom_due_date:
        return jsonify({'error': '请选择日期'}), 400
    db = get_db()
    # 检查是否已接种
    rec = db.execute("SELECT 1 FROM vaccine_records WHERE vaccine_name = ? AND dose_index = ?", (vaccine_name, dose_index)).fetchone()
    if rec:
        return jsonify({'error': '已接种的项目不能修改计划日期'}), 400
    db.execute("INSERT OR REPLACE INTO vaccine_plan_overrides (vaccine_name, dose_index, custom_due_date) VALUES (?, ?, ?)",
               (vaccine_name, dose_index, custom_due_date))
    db.commit()
    add_log('修改计划日期', 'vaccine', None, f"{vaccine_name}第{dose_index}剂 → {custom_due_date}")
    return jsonify({'message': '计划日期已更新'})


@app.route('/api/vaccine/dates', methods=['GET'])
def vaccine_dates():
    """返回疫苗日期信息供日历显示：已接种日期(黄点) + 未接种日期(红点) + 逾期日期(黑点)"""
    db = get_db()
    baby = db.execute("SELECT * FROM babies LIMIT 1").fetchone()
    result = {'vaccinated': [], 'overdue': [], 'upcoming': []}
    if not baby or not baby['birth_date']:
        return jsonify(result)

    try:
        birth = datetime.strptime(baby['birth_date'], '%Y-%m-%d')
    except (ValueError, TypeError):
        return jsonify(result)

    today = date.today()

    # 已接种日期
    records = db.execute("SELECT vaccinated_date FROM vaccine_records").fetchall()
    result['vaccinated'] = [r['vaccinated_date'] for r in records if r['vaccinated_date']]

    # 获取自定义计划日期覆盖
    overrides = db.execute("SELECT * FROM vaccine_plan_overrides").fetchall()
    override_map = {}
    for o in overrides:
        override_map[(o['vaccine_name'], o['dose_index'])] = o['custom_due_date']

    # 未接种：逾期(黑点) + 未到(红点)
    for v in VACCINE_SCHEDULE:
        key = (v['name'], v['dose_index'])
        rec = db.execute("SELECT 1 FROM vaccine_records WHERE vaccine_name = ? AND dose_index = ?", key).fetchone()
        if not rec:
            default_due = (birth + timedelta(days=int(v['age_months'] * 30.44))).strftime('%Y-%m-%d')
            due_date = override_map.get(key, default_due)
            if due_date <= today.isoformat():
                result['overdue'].append(due_date)
            else:
                result['upcoming'].append(due_date)

    return jsonify(result)


@app.route('/api/vaccine/day-records', methods=['GET'])
def vaccine_day_records():
    """返回某日的疫苗信息（已接种记录+未接种计划）"""
    rec_date = request.args.get('date', date.today().isoformat())
    db = get_db()
    baby = db.execute("SELECT * FROM babies LIMIT 1").fetchone()
    result = {'vaccinated': [], 'planned': []}
    if not baby or not baby['birth_date']:
        return jsonify(result)

    try:
        birth = datetime.strptime(baby['birth_date'], '%Y-%m-%d')
    except (ValueError, TypeError):
        return jsonify(result)

    today = date.today()

    # 已接种记录
    records = db.execute("SELECT * FROM vaccine_records WHERE vaccinated_date = ?", (rec_date,)).fetchall()
    for r in records:
        result['vaccinated'].append({
            'name': r['vaccine_name'],
            'dose_index': r['dose_index'],
            'vaccinated_date': r['vaccinated_date'],
            'note': r['note'] or ''
        })

    # 当日应接种但未接种的
    overrides = db.execute("SELECT * FROM vaccine_plan_overrides").fetchall()
    override_map = {}
    for o in overrides:
        override_map[(o['vaccine_name'], o['dose_index'])] = o['custom_due_date']

    for v in VACCINE_SCHEDULE:
        key = (v['name'], v['dose_index'])
        rec = db.execute("SELECT 1 FROM vaccine_records WHERE vaccine_name = ? AND dose_index = ?", key).fetchone()
        if not rec:
            default_due = (birth + timedelta(days=int(v['age_months'] * 30.44))).strftime('%Y-%m-%d')
            due_date = override_map.get(key, default_due)
            if due_date == rec_date:
                result['planned'].append({
                    'name': v['name'],
                    'dose_index': v['dose_index'],
                    'due_date': due_date,
                    'status': 'overdue' if due_date <= today.isoformat() else 'upcoming'
                })

    return jsonify(result)


# ── API: Home Assistant ───────────────────────────────────

def _check_ha_api_key():
    api_key = request.args.get('api_key') or request.headers.get('Authorization', '').replace('Bearer ', '')
    if not api_key:
        return False
    db = get_db()
    row = db.execute("SELECT value FROM settings WHERE key = 'ha_api_key'").fetchone()
    if not row or not row['value']:
        return False
    return secrets.compare_digest(api_key, row['value'])


@app.route('/api/ha/api-key', methods=['POST'])
def generate_ha_api_key():
    if not is_admin():
        return jsonify({'error': '无权限'}), 403
    new_key = secrets.token_urlsafe(32)
    db = get_db()
    db.execute("INSERT INTO settings (key, value) VALUES ('ha_api_key', ?) ON CONFLICT(key) DO UPDATE SET value=?, updated_at=datetime('now','localtime')",
               (new_key, new_key))
    db.commit()
    add_log('生成HA密钥', 'settings', None, '')
    return jsonify({'api_key': new_key})


@app.route('/api/ha/api-key', methods=['GET'])
def get_ha_api_key():
    if not is_admin():
        return jsonify({'error': '无权限'}), 403
    db = get_db()
    row = db.execute("SELECT value FROM settings WHERE key = 'ha_api_key'").fetchone()
    return jsonify({'api_key': row['value'] if row else ''})

@app.route('/api/ha/status', methods=['GET'])
def ha_status():
    target_date = request.args.get('date') or date.today().isoformat()
    db = get_db()
    s = _today_summary_data(db, target_date)
    progress = min(100, round(s['total_feed_ml'] / s['target_ml'] * 100)) if s['target_ml'] > 0 else 0
    return jsonify({
        'state': f"{s['total_feed_ml']}/{s['target_ml']}ml",
        'attributes': {
            'unit_of_measurement': 'ml', 'friendly_name': '今日奶量', 'icon': 'mdi:baby-bottle',
            'feed_count': s['feed_count'], 'target_ml': s['target_ml'],
            'consumed_ml': s['total_feed_ml'], 'remaining_ml': s['remaining_ml'],
            'progress_percent': progress, 'urine_count': s['urine_count'], 'stool_count': s['stool_count'],
            'per_feed_ml': s['per_feed_ml'], 'estimation_method': s['estimate']['method']
        }
    })


@app.route('/api/ha/feed-today', methods=['GET'])
def ha_feed_today():
    db = get_db()
    today_str = date.today().isoformat()
    start = f"{today_str} 00:00:00"
    end = f"{today_str} 23:59:59"
    feeds = db.execute("SELECT * FROM records WHERE timestamp >= ? AND timestamp <= ? AND type = 'feed' ORDER BY timestamp", (start, end)).fetchall()
    total_ml = sum(f['amount'] or 0 for f in feeds)
    return jsonify({'state': str(round(total_ml)), 'attributes': {'unit_of_measurement': 'ml', 'friendly_name': '今日喂养总量', 'icon': 'mdi:baby-bottle-outline', 'feed_count': len(feeds), 'feeds': [dict(f) for f in feeds]}})


@app.route('/api/ha/last-feed', methods=['GET'])
def ha_last_feed():
    db = get_db()
    feed = db.execute("SELECT * FROM records WHERE type = 'feed' ORDER BY timestamp DESC LIMIT 1").fetchone()
    if not feed:
        return jsonify({'state': 'unknown', 'attributes': {'friendly_name': '上次喂养', 'icon': 'mdi:baby-bottle'}})
    return jsonify({'state': feed['timestamp'], 'attributes': {'friendly_name': '上次喂养', 'icon': 'mdi:baby-bottle', 'sub_type': feed['sub_type'], 'amount_ml': feed['amount'], 'duration_min': feed['duration']}})


@app.route('/api/ha/excrete-today', methods=['GET'])
def ha_excrete_today():
    db = get_db()
    today_str = date.today().isoformat()
    start = f"{today_str} 00:00:00"
    end = f"{today_str} 23:59:59"
    excretes = db.execute("SELECT * FROM records WHERE timestamp >= ? AND timestamp <= ? AND type = 'excrete'", (start, end)).fetchall()
    urine = sum(1 for e in excretes if e['sub_type'] in ('urine', 'both'))
    stool = sum(1 for e in excretes if e['sub_type'] in ('stool', 'both'))
    return jsonify({'state': f'尿{urine}/便{stool}', 'attributes': {'friendly_name': '今日排泄', 'icon': 'mdi:diaper', 'urine_count': urine, 'stool_count': stool, 'total_count': len(excretes)}})


# ── HA 快速按钮开关 ──────────────────────────────────────

# 按钮开关状态：{btn_id: 'on'/'off'}，按下后保持 on 2秒再回弹
_ha_button_states = {}
_ha_button_timers = {}

ICON_MAP = {
    'breast': 'mdi:baby-bottle', 'formula': 'mdi:bottle-soda',
    'pumped': 'mdi:baby-bottle-outline', 'water': 'mdi:cup-water',
    'urine': 'mdi:water', 'stool': 'mdi:emoticon-poop',
    'both': 'mdi:baby-face-outline',
}


def _ha_btn_off(btn_id):
    """2秒后自动将按钮状态设为 off"""
    _ha_button_states[btn_id] = 'off'


@app.route('/api/ha/buttons', methods=['GET'])
def ha_buttons():
    """返回所有启用的快速按钮，供 HA 创建 REST 开关实体"""
    db = get_db()
    buttons = db.execute("SELECT * FROM quick_buttons WHERE is_active = 1 ORDER BY sort_order").fetchall()
    result = []
    for b in buttons:
        result.append({
            'id': b['id'],
            'label': b['label'],
            'type': b['type'],
            'sub_type': b['sub_type'],
            'amount': b['amount'],
            'icon': ICON_MAP.get(b['sub_type'], 'mdi:gesture-tap-button'),
            'state': _ha_button_states.get(b['id'], 'off'),
        })
    return jsonify(result)


@app.route('/api/ha/button/<int:btn_id>', methods=['GET', 'POST'])
def ha_button_state(btn_id):
    """HA 按钮端点：GET 查询状态，POST 触发记录"""
    if request.method == 'POST':
        return _ha_do_press(btn_id)
    db = get_db()
    btn = db.execute("SELECT * FROM quick_buttons WHERE id = ? AND is_active = 1", (btn_id,)).fetchone()
    if not btn:
        return jsonify({'state': 'unavailable', 'attributes': {'friendly_name': '未知按钮'}}), 404
    return jsonify({
        'state': _ha_button_states.get(btn_id, 'off'),
        'attributes': {
            'friendly_name': btn['label'],
            'icon': ICON_MAP.get(btn['sub_type'], 'mdi:gesture-tap-button'),
            'type': btn['type'],
            'sub_type': btn['sub_type'],
            'amount': btn['amount'],
        }
    })


@app.route('/api/ha/button/<int:btn_id>/press', methods=['POST'])
def ha_button_press(btn_id):
    """HA 开关备用端点：触发记录"""
    return _ha_do_press(btn_id)


def _ha_do_press(btn_id):
    """HA 快速记录核心逻辑"""
    if not _check_ha_api_key():
        return jsonify({'error': '未授权，请提供有效的 API 密钥'}), 401

    db = get_db()
    btn = db.execute("SELECT * FROM quick_buttons WHERE id = ? AND is_active = 1", (btn_id,)).fetchone()
    if not btn:
        return jsonify({'state': 'unavailable'}), 404

    u = db.execute("SELECT id, username, nickname FROM users WHERE role = 'admin' LIMIT 1").fetchone()
    if not u:
        return jsonify({'error': '无管理员账户'}), 500

    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    cursor = db.execute(
        """INSERT INTO records (baby_id, user_id, type, sub_type, amount, timestamp, note)
           VALUES (1, ?, ?, ?, ?, ?, ?)""",
        (u['id'], btn['type'], btn['sub_type'],
         btn['amount'] if btn['amount'] is not None else None, timestamp,
         '[HA]')
    )
    db.commit()

    add_log_ha('HA快速记录', 'record', cursor.lastrowid,
               f"{btn['label']} @ {timestamp}")

    _ha_button_states[btn_id] = 'on'

    if btn_id in _ha_button_timers:
        _ha_button_timers[btn_id].cancel()

    timer = threading.Timer(2.0, _ha_btn_off, args=(btn_id,))
    timer.daemon = True
    timer.start()
    _ha_button_timers[btn_id] = timer

    return jsonify({
        'state': 'on',
        'attributes': {
            'friendly_name': btn['label'],
            'icon': 'mdi:check-circle',
            'last_pressed': timestamp,
            'record_id': cursor.lastrowid,
        }
    })


# ── PWA Icon Generation ──────────────────────────────────

@app.route('/static/icons/icon-<size>.png')
def pwa_icon(size):
    """动态生成 PWA 图标 - 无边框全出血设计"""
    try:
        size = int(size)
    except ValueError:
        size = 192
    size = min(max(size, 48), 512)

    from PIL import Image, ImageDraw

    # 无边框：背景直接填满，无 margin
    bg_color = (0, 229, 160, 255)  # accent color #00e5a0
    img = Image.new('RGBA', (size, size), bg_color)
    draw = ImageDraw.Draw(img)

    # 奶瓶图标 - 居中偏上
    cx = size // 2
    cy = int(size * 0.48)
    unit = size / 100

    # 瓶身
    bottle_left = cx - 16 * unit
    bottle_right = cx + 16 * unit
    bottle_top = cy - 22 * unit
    bottle_bottom = cy + 24 * unit
    neck_left = cx - 8 * unit
    neck_right = cx + 8 * unit
    neck_top = cy - 32 * unit

    # 瓶颈
    draw.rectangle([neck_left, neck_top, neck_right, bottle_top], fill='white')
    # 瓶身
    draw.rounded_rectangle([bottle_left, bottle_top, bottle_right, bottle_bottom],
                           radius=6 * unit, fill='white')
    # 奶嘴
    nipple_top = cy - 38 * unit
    draw.ellipse([cx - 6 * unit, nipple_top, cx + 6 * unit, neck_top + 3 * unit],
                 fill='white')
    # 液面
    liquid_top = cy - 2 * unit
    draw.rounded_rectangle([bottle_left + 3 * unit, liquid_top,
                            bottle_right - 3 * unit, bottle_bottom - 3 * unit],
                           radius=4 * unit, fill=(0, 180, 120, 200))

    buf = BytesIO()
    img.save(buf, format='PNG')
    buf.seek(0)
    return send_file(buf, mimetype='image/png')

_db_initialized = False
_db_init_lock = threading.Lock()


@app.before_request
def ensure_db():
    global _db_initialized
    if not _db_initialized:
        with _db_init_lock:
            if not _db_initialized:
                init_db()
                _db_initialized = True


@app.cli.command('reset-password')
def reset_password_cmd():
    """重置管理员密码，生成随机密码并输出"""
    with app.app_context():
        db = get_db()
        admin = db.execute("SELECT id, username FROM users WHERE role = 'admin' LIMIT 1").fetchone()
        if not admin:
            print('错误: 未找到管理员账户')
            return
        alphabet = string.ascii_letters + string.digits
        new_pw = ''.join(secrets.choice(alphabet) for _ in range(10))
        db.execute("UPDATE users SET password_hash = ? WHERE id = ?",
                   (generate_password_hash(new_pw), admin['id']))
        db.commit()
        print(f'管理员 [{admin["username"]}] 密码已重置')
        print(f'新密码: {new_pw}')


if __name__ == '__main__':
    with app.app_context():
        init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)
