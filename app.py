import os
import sqlite3
import hashlib
import json as json_module
import threading
import time
from datetime import datetime, date, timedelta
from flask import Flask, render_template, request, jsonify, g, send_file, session, redirect, url_for
from io import StringIO, BytesIO
from werkzeug.security import generate_password_hash, check_password_hash
import csv
import secrets
import string
from functools import wraps

app = Flask(__name__)
app.config['DATABASE'] = os.path.join(os.path.dirname(__file__), 'data', 'baby.db')
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'baby-tracker-secret-key-change-in-prod')
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)


# ── Login Required Decorator ───────────────────────────────

def login_required(f):
    """登录验证装饰器：未登录用户跳转到登录页"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('login_page'))
        db = get_db()
        user = db.execute("SELECT status FROM users WHERE id = ?", (session['user_id'],)).fetchone()
        if not user or user['status'] != 'approved':
            session.clear()
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return decorated_function


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
        CREATE TABLE IF NOT EXISTS health_followup_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            label TEXT NOT NULL UNIQUE,
            completed_date TEXT NOT NULL,
            note TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS health_followup_overrides (
            label TEXT NOT NULL,
            custom_due_date TEXT NOT NULL,
            UNIQUE(label)
        );
        CREATE TABLE IF NOT EXISTS countdown_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            target_date TEXT NOT NULL,
            note TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
    ''')

    try:
        db.execute("ALTER TABLE babies ADD COLUMN is_premature INTEGER DEFAULT 0")
    except Exception:
        pass

    db.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('custom_daily_target', '')")
    db.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('feeds_per_day', '8')")
    db.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('reminder_interval_min', '180')")
    default_coeffs = json_module.dumps({
        'day0': 60, 'day1': 60, 'day2_3': 80, 'day4_7': 100,
        'day8_14': 120, 'day15_28': 135, 'month1_3': 150,
        'month4_6': 150, 'month4_6_cap': 900,
        'month6_12_base': 800, 'month6_12_decay': 30, 'month6_12_min': 600,
        'year1_plus': 500,
    }, ensure_ascii=False)
    db.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('milk_coefficients', ?)", (default_coeffs,))

    admin_count = db.execute("SELECT COUNT(*) as c FROM users WHERE role='admin'").fetchone()['c']
    if admin_count == 0:
        db.execute(
            "INSERT INTO users (username, password_hash, nickname, role, status) VALUES (?, ?, ?, 'admin', 'approved')",
            ('admin', generate_password_hash('admin123'), '管理员', )
        )

    row = db.execute("SELECT COUNT(*) as c FROM babies").fetchone()
    if row['c'] == 0:
        db.execute(
            "INSERT INTO babies (name, gender, birth_date, weight) VALUES (?, ?, ?, ?)",
            ('宝宝', 'male', date.today().isoformat(), 3.0)
        )

    btn_count = db.execute("SELECT COUNT(*) as c FROM quick_buttons").fetchone()['c']
    if btn_count == 0:
        default_buttons = [
            ('feed', 'formula', '配方奶 60ml', 60, 1),
            ('feed', 'formula', '配方奶 90ml', 90, 2),
            ('feed', 'formula', '配方奶 120ml', 120, 3),
            ('feed', 'breast_left', '母乳(左)', 0, 4),
            ('feed', 'breast_right', '母乳(右)', 0, 5),
            ('feed', 'water', '喂水', 10, 6),
            ('timer', 'breast_timer', '⏱️ 母乳计时', 0, 7),
            ('excrete', 'urine', '排尿', 0, 8),
            ('excrete', 'stool', '排便', 0, 9),
            ('excrete', 'both', '尿+便', 0, 10),
            ('symptom', 'vomit', '吐奶', 0, 11),
            ('symptom', 'fever', '发热', 0, 12),
            ('symptom', 'jaundice', '黄疸', 0, 13),
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


# ── Timer States ──────────────────────────────────────────

_timer_states = {}


# ── Milk Estimation ───────────────────────────────────────

def estimate_milk(baby, settings_dict):
    custom = settings_dict.get('custom_daily_target', '')
    feeds_per_day = int(settings_dict.get('feeds_per_day', '8'))

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
@login_required
def dashboard():
    return render_template('dashboard.html')


@app.route('/login')
def login_page():
    if 'user_id' in session:
        return redirect(url_for('dashboard'))
    return render_template('login.html')


@app.route('/register')
def register_page():
    if 'user_id' in session:
        return redirect(url_for('dashboard'))
    return render_template('register.html')


@app.route('/history')
@login_required
def history_page():
    return redirect('/')


@app.route('/trends')
@login_required
def trends_page():
    return render_template('trends.html')


@app.route('/admin')
@login_required
def admin_page():
    if not is_admin():
        return redirect('/login')
    return render_template('admin.html')


@app.route('/vaccine')
@login_required
def vaccine_page():
    return render_template('vaccine.html', active_page='vaccine')


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
@login_required
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
@login_required
def get_quick_buttons():
    db = get_db()
    if is_admin():
        rows = db.execute("SELECT * FROM quick_buttons ORDER BY sort_order").fetchall()
    else:
        rows = db.execute("SELECT * FROM quick_buttons WHERE is_active = 1 ORDER BY sort_order").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/quick-buttons', methods=['POST'])
@login_required
def create_quick_button():
    if not is_admin():
        return jsonify({'error': '无权限'}), 403
    data = request.get_json()
    db = get_db()
    sort_order = data.get('sort_order', 0)
    db.execute("UPDATE quick_buttons SET sort_order = sort_order + 1 WHERE sort_order >= ?", (sort_order,))
    cursor = db.execute(
        "INSERT INTO quick_buttons (type, sub_type, label, amount, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)",
        (data['type'], data['sub_type'], data['label'], data.get('amount', 0), sort_order)
    )
    db.commit()
    add_log('添加按钮', 'quick_button', cursor.lastrowid, data['label'])
    return jsonify({'message': '已添加'}), 201


@app.route('/api/quick-buttons/<int:btn_id>', methods=['PUT'])
@login_required
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
@login_required
def reorder_quick_buttons():
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
@login_required
def delete_quick_button(btn_id):
    if not is_admin():
        return jsonify({'error': '无权限'}), 403
    db = get_db()
    deleted = db.execute("SELECT sort_order FROM quick_buttons WHERE id = ?", (btn_id,)).fetchone()
    db.execute("DELETE FROM quick_buttons WHERE id = ?", (btn_id,))
    if deleted:
        db.execute("UPDATE quick_buttons SET sort_order = sort_order - 1 WHERE sort_order > ?", (deleted['sort_order'],))
    db.commit()
    add_log('删除按钮', 'quick_button', btn_id, '')
    return jsonify({'message': '已删除'})


# ── API: Timer Buttons ────────────────────────────────────

@app.route('/api/timer/<int:btn_id>/toggle', methods=['POST'])
@login_required
def toggle_timer(btn_id):
    """切换计时器状态：开始/结束"""
    if not is_approved():
        return jsonify({'error': '请先登录'}), 401
    
    db = get_db()
    btn = db.execute("SELECT * FROM quick_buttons WHERE id = ? AND is_active = 1", (btn_id,)).fetchone()
    if not btn:
        return jsonify({'error': '按钮不存在'}), 404
    
    u = current_user()
    now = datetime.now()
    
    state = _timer_states.get(btn_id, {'is_running': False, 'start_time': None, 'duration_seconds': 0})
    
    if not state.get('is_running', False):
        state['is_running'] = True
        state['start_time'] = now.timestamp()
        state['duration_seconds'] = 0
        _timer_states[btn_id] = state
        
        return jsonify({
            'status': 'started',
            'message': f'开始计时: {btn["label"]}',
            'start_time': now.isoformat(),
            'btn_id': btn_id
        })
    else:
        start_time = state.get('start_time')
        if start_time:
            duration = int(now.timestamp() - start_time)
            duration = max(1, duration)
        else:
            duration = 0
        
        timestamp = now.strftime('%Y-%m-%d %H:%M:%S')
        amount = btn['amount'] if btn['amount'] is not None else 0
        
        cursor = db.execute(
            """INSERT INTO records (baby_id, user_id, type, sub_type, amount, duration, timestamp, note)
               VALUES (1, ?, ?, ?, ?, ?, ?, ?)""",
            (u['id'], btn['type'], btn['sub_type'], amount, duration, timestamp, f'[计时器] {duration}秒')
        )
        db.commit()
        add_log('计时器记录', 'record', cursor.lastrowid, f"{btn['label']} 时长: {duration}秒 @ {timestamp}")
        
        state['is_running'] = False
        state['start_time'] = None
        state['duration_seconds'] = duration
        _timer_states[btn_id] = state
        
        summary = _today_summary_data(db, None)
        summary['message'] = f'计时结束: {duration}秒'
        summary['duration'] = duration
        summary['record_id'] = cursor.lastrowid
        
        return jsonify(summary), 201


@app.route('/api/timer/<int:btn_id>/status', methods=['GET'])
@login_required
def get_timer_status(btn_id):
    """获取计时器当前状态"""
    state = _timer_states.get(btn_id, {'is_running': False, 'start_time': None, 'duration_seconds': 0})
    
    result = {
        'is_running': state.get('is_running', False),
        'duration_seconds': state.get('duration_seconds', 0),
        'btn_id': btn_id
    }
    
    if state.get('is_running') and state.get('start_time'):
        elapsed = int(time.time() - state['start_time'])
        result['elapsed_seconds'] = elapsed
        result['start_time'] = datetime.fromtimestamp(state['start_time']).isoformat()
    else:
        result['elapsed_seconds'] = 0
        result['start_time'] = None
    
    return jsonify(result)


# ── API: Quick Record ─────────────────────────────────────

@app.route('/api/quick-record/<int:btn_id>', methods=['POST'])
@login_required
def quick_record(btn_id):
    if not is_approved():
        return jsonify({'error': '请先登录'}), 401

    db = get_db()
    btn = db.execute("SELECT * FROM quick_buttons WHERE id = ? AND is_active = 1", (btn_id,)).fetchone()
    if not btn:
        return jsonify({'error': '按钮不存在'}), 404

    u = current_user()
    data = request.get_json() or {}
    timestamp = data.get('timestamp') or datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    target_date = data.get('date')

    cursor = db.execute(
        """INSERT INTO records (baby_id, user_id, type, sub_type, amount, timestamp)
           VALUES (1, ?, ?, ?, ?, ?)""",
        (u['id'], btn['type'], btn['sub_type'], btn['amount'] if btn['amount'] is not None else None, timestamp)
    )
    db.commit()
    add_log('快速记录', 'record', cursor.lastrowid, f"{btn['label']} @ {timestamp}")

    summary = _today_summary_data(db, target_date)
    summary['message'] = '记录成功'
    summary['record_id'] = cursor.lastrowid
    return jsonify(summary), 201


# ── API: Records ──────────────────────────────────────────

@app.route('/api/records/dates', methods=['GET'])
@login_required
def get_record_dates():
    db = get_db()
    rows = db.execute("SELECT DISTINCT substr(timestamp, 1, 10) as d FROM records ORDER BY d").fetchall()
    return jsonify([r['d'] for r in rows])


@app.route('/api/records/<int:record_id>', methods=['GET'])
@login_required
def get_record(record_id):
    db = get_db()
    r = db.execute("SELECT * FROM records WHERE id = ?", (record_id,)).fetchone()
    if not r:
        return jsonify({'error': '记录不存在'}), 404
    return jsonify(dict(r))


@app.route('/api/records', methods=['GET'])
@login_required
def get_records():
    db = get_db()
    rec_date = request.args.get('date', date.today().isoformat())
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
@login_required
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
    target_date = data.get('_date')
    summary = _today_summary_data(db, target_date)
    summary['message'] = '记录成功'
    summary['record_id'] = cursor.lastrowid
    return jsonify(summary), 201


@app.route('/api/records/<int:record_id>', methods=['PUT'])
@login_required
def update_record(record_id):
    if not is_approved():
        return jsonify({'error': '请先登录'}), 401

    db = get_db()
    existing = db.execute("SELECT * FROM records WHERE id = ?", (record_id,)).fetchone()
    if not existing:
        return jsonify({'error': '记录不存在'}), 404

    data = request.get_json()
    if data.get('type') and data['type'] not in ('feed', 'excrete', 'symptom', 'supplement'):
        return jsonify({'error': '无效的记录类型'}), 400

    target_date = data.get('_date')
    changes = []
    fields = ['type', 'sub_type', 'amount', 'duration', 'color', 'consistency', 'temperature', 'note', 'timestamp']
    for f in fields:
        if f in data:
            old_val = str(existing[f] or '')
            new_val = str(data[f] if data[f] is not None else '')
            if old_val != new_val:
                changes.append(f"{f}: '{old_val}'->'{new_val}'")

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
    summary = _today_summary_data(db, target_date)
    summary['message'] = '已更新'
    return jsonify(summary)


@app.route('/api/records/<int:record_id>', methods=['DELETE'])
@login_required
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
    target_date = request.args.get('date')
    summary = _today_summary_data(db, target_date)
    summary['message'] = '已删除'
    return jsonify(summary)


def _today_summary_data(db, target_date=None):
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
@login_required
def today_summary():
    target_date = request.args.get('date') or date.today().isoformat()
    db = get_db()
    return jsonify(_today_summary_data(db, target_date))


# ── API: Baby ─────────────────────────────────────────────

@app.route('/api/baby', methods=['GET'])
@login_required
def get_baby():
    db = get_db()
    baby = db.execute("SELECT * FROM babies LIMIT 1").fetchone()
    if not baby:
        return jsonify({'error': '未找到婴儿信息'}), 404
    return jsonify(dict(baby))


@app.route('/api/baby', methods=['PUT'])
@login_required
def update_baby():
    if not is_admin():
        return jsonify({'error': '仅管理员可修改'}), 403
    data = request.get_json()
    db = get_db()
    baby = db.execute("SELECT id FROM babies LIMIT 1").fetchone()
    is_premature = 1 if data.get('is_premature') else 0
    if baby:
        db.execute("UPDATE babies SET name=?, gender=?, birth_date=?, weight=?, is_premature=? WHERE id=?",
                    (data.get('name', '宝宝'), data.get('gender', 'male'),
                     data.get('birth_date', date.today().isoformat()),
                     data.get('weight', 3.0), is_premature, baby['id']))
    else:
        db.execute("INSERT INTO babies (name, gender, birth_date, weight, is_premature) VALUES (?, ?, ?, ?, ?)",
                    (data.get('name', '宝宝'), data.get('gender', 'male'),
                     data.get('birth_date', date.today().isoformat()),
                     data.get('weight', 3.0), is_premature))
    db.commit()
    add_log('修改婴儿信息', 'baby', 1, f"{data.get('name','')}/{data.get('weight','')}kg/{'早产儿' if is_premature else '足月儿'}")
    return jsonify({'message': '已更新'})


# ── API: Settings ─────────────────────────────────────────

@app.route('/api/settings', methods=['GET'])
@login_required
def get_settings():
    db = get_db()
    rows = db.execute("SELECT key, value FROM settings").fetchall()
    return jsonify({r['key']: r['value'] for r in rows})


@app.route('/api/settings', methods=['PUT'])
@login_required
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
@login_required
def get_milk_estimate():
    db = get_db()
    baby = db.execute("SELECT * FROM babies LIMIT 1").fetchone()
    settings_rows = db.execute("SELECT key, value FROM settings").fetchall()
    settings_dict = {r['key']: r['value'] for r in settings_rows}
    return jsonify(estimate_milk(dict(baby) if baby else None, settings_dict))


# ── API: Users (Admin) ────────────────────────────────────

@app.route('/api/users', methods=['GET'])
@login_required
def get_users():
    if not is_admin():
        return jsonify({'error': '无权限'}), 403
    db = get_db()
    rows = db.execute("SELECT id, username, nickname, role, status, created_at FROM users ORDER BY created_at DESC").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/users/<int:user_id>/approve', methods=['POST'])
@login_required
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
@login_required
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
@login_required
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
@login_required
def reset_user_password(user_id):
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
@login_required
def update_username(user_id):
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
@login_required
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
@login_required
def export_csv():
    if not is_admin():
        return jsonify({'error': '无权限'}), 403
    db = get_db()
    rows = db.execute("SELECT * FROM records ORDER BY timestamp DESC").fetchall()
    output = StringIO()
    writer = csv.writer(output)
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
@login_required
def backup_export():
    if not is_admin():
        return jsonify({'error': '无权限'}), 403
    db = get_db()
    backup = {
        'version': 1,
        'exported_at': datetime.now().isoformat(),
        'tables': {}
    }
    table_cols = {
        'babies': ['id', 'name', 'gender', 'birth_date', 'weight', 'is_premature', 'created_at'],
        'records': ['id', 'baby_id', 'user_id', 'type', 'sub_type', 'amount', 'duration', 'color', 'consistency', 'temperature', 'note', 'timestamp', 'created_at'],
        'settings': ['id', 'key', 'value', 'updated_at'],
        'users': ['id', 'username', 'password_hash', 'nickname', 'role', 'status', 'created_at'],
        'quick_buttons': ['id', 'type', 'sub_type', 'label', 'amount', 'sort_order', 'is_active', 'created_at'],
        'weight_logs': ['id', 'baby_id', 'weight', 'recorded_date', 'note', 'created_at'],
        'vaccine_records': ['id', 'vaccine_name', 'dose_index', 'vaccinated_date', 'note', 'created_at'],
        'vaccine_plan_overrides': ['vaccine_name', 'dose_index', 'custom_due_date'],
        'health_followup_records': ['id', 'label', 'completed_date', 'note', 'created_at'],
        'health_followup_overrides': ['label', 'custom_due_date'],
        'countdown_events': ['id', 'title', 'target_date', 'note', 'created_at'],
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
@login_required
def backup_restore():
    if not is_admin():
        return jsonify({'error': '无权限'}), 403

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

    restore_order = ['babies', 'users', 'settings', 'quick_buttons', 'records', 'weight_logs', 'vaccine_records', 'vaccine_plan_overrides', 'health_followup_records', 'health_followup_overrides', 'countdown_events']

    for table in restore_order:
        if table not in backup['tables']:
            continue
        tdata = backup['tables'][table]
        cols = tdata.get('columns', [])
        rows = tdata.get('rows', [])
        if not rows:
            continue

        try:
            db.execute(f"DELETE FROM {table}")
        except Exception:
            continue

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
@login_required
def clear_data():
    if not is_admin():
        return jsonify({'error': '无权限'}), 403
    db = get_db()
    db.execute("DELETE FROM records")
    db.commit()
    add_log('清除数据', 'data', None, '清除所有记录')
    target_date = request.args.get('date') or (request.get_json() or {}).get('_date')
    summary = _today_summary_data(db, target_date)
    summary['message'] = '所有记录已清除'
    return jsonify(summary)


@app.route('/api/stats', methods=['GET'])
@login_required
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
@login_required
def get_weight_logs():
    db = get_db()
    rows = db.execute("SELECT * FROM weight_logs ORDER BY recorded_date DESC").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/weight-logs', methods=['POST'])
@login_required
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
    db.execute("UPDATE babies SET weight = ? WHERE id = 1", (data['weight'],))
    db.commit()
    add_log('记录体重', 'weight_log', cursor.lastrowid, f"{data['weight']}kg @ {data['recorded_date']}")
    return jsonify({'id': cursor.lastrowid, 'message': '已记录'}), 201


@app.route('/api/weight-logs/<int:log_id>', methods=['DELETE'])
@login_required
def delete_weight_log(log_id):
    if not is_admin():
        return jsonify({'error': '仅管理员可删除'}), 403
    db = get_db()
    db.execute("DELETE FROM weight_logs WHERE id = ?", (log_id,))
    db.commit()
    add_log('删除体重', 'weight_log', log_id, '')
    return jsonify({'message': '已删除'})


@app.route('/api/weight-logs/<int:log_id>', methods=['PUT'])
@login_required
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
@login_required
def get_trends():
    days = request.args.get('days', 14, type=int)
    days = min(days, 90)
    weight_days = request.args.get('weight_days', days, type=int)
    weight_days = min(weight_days, 365)

    db = get_db()
    today = date.today()
    start_date = today - timedelta(days=days-1)
    weight_start = today - timedelta(days=weight_days-1)

    feed_daily = db.execute("""
        SELECT date(timestamp) as d,
               COALESCE(SUM(amount), 0) as total_ml,
               COUNT(*) as feed_count
        FROM records
        WHERE type='feed' AND timestamp >= ?
        GROUP BY date(timestamp) ORDER BY d
    """, (start_date.isoformat(),)).fetchall()

    excrete_daily = db.execute("""
        SELECT date(timestamp) as d,
               SUM(CASE WHEN sub_type IN ('urine','both') THEN 1 ELSE 0 END) as urine_count,
               SUM(CASE WHEN sub_type IN ('stool','both') THEN 1 ELSE 0 END) as stool_count
        FROM records
        WHERE type='excrete' AND timestamp >= ?
        GROUP BY date(timestamp) ORDER BY d
    """, (start_date.isoformat(),)).fetchall()

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

    weights = db.execute("""
        SELECT id, weight, recorded_date, note FROM weight_logs
        WHERE recorded_date >= ?
        ORDER BY recorded_date
    """, (weight_start.isoformat(),)).fetchall()

    baby = db.execute("SELECT * FROM babies LIMIT 1").fetchone()
    settings_rows = db.execute("SELECT key, value FROM settings").fetchall()
    settings_dict = {r['key']: r['value'] for r in settings_rows}
    estimate = estimate_milk(dict(baby) if baby else None, settings_dict)
    target_ml = estimate['daily_target_ml']

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
        'weight_days': weight_days,
    })


# ── Vaccine Schedule (2024 国家免疫规划) ──────────────────

VACCINE_SCHEDULE = [
    {"name": "乙肝疫苗", "short": "HepB", "age_months": 0, "dose_index": 1, "note": "出生24小时内"},
    {"name": "乙肝疫苗", "short": "HepB", "age_months": 1, "dose_index": 2, "note": ""},
    {"name": "乙肝疫苗", "short": "HepB", "age_months": 6, "dose_index": 3, "note": ""},
    {"name": "卡介苗", "short": "BCG", "age_months": 0, "dose_index": 1, "note": "出生时"},
    {"name": "脊灰灭活疫苗", "short": "IPV", "age_months": 2, "dose_index": 1, "note": ""},
    {"name": "脊灰灭活疫苗", "short": "IPV", "age_months": 3, "dose_index": 2, "note": ""},
    {"name": "脊灰减毒活疫苗", "short": "bOPV", "age_months": 4, "dose_index": 3, "note": ""},
    {"name": "脊灰减毒活疫苗", "short": "bOPV", "age_months": 48, "dose_index": 4, "note": "4岁"},
    {"name": "百白破疫苗", "short": "DTaP", "age_months": 2, "dose_index": 1, "note": "2025新规"},
    {"name": "百白破疫苗", "short": "DTaP", "age_months": 4, "dose_index": 2, "note": "2025新规"},
    {"name": "百白破疫苗", "short": "DTaP", "age_months": 6, "dose_index": 3, "note": "2025新规"},
    {"name": "百白破疫苗", "short": "DTaP", "age_months": 18, "dose_index": 4, "note": "18月龄加强"},
    {"name": "百白破疫苗", "short": "DTaP", "age_months": 72, "dose_index": 5, "note": "6岁加强"},
    {"name": "A群流脑多糖疫苗", "short": "MPSV-A", "age_months": 6, "dose_index": 1, "note": ""},
    {"name": "A群流脑多糖疫苗", "short": "MPSV-A", "age_months": 9, "dose_index": 2, "note": "间隔3月"},
    {"name": "A群C群流脑多糖疫苗", "short": "MPSV-AC", "age_months": 36, "dose_index": 1, "note": "3岁"},
    {"name": "A群C群流脑多糖疫苗", "short": "MPSV-AC", "age_months": 72, "dose_index": 2, "note": "6岁"},
    {"name": "麻腮风疫苗", "short": "MMR", "age_months": 8, "dose_index": 1, "note": ""},
    {"name": "麻腮风疫苗", "short": "MMR", "age_months": 18, "dose_index": 2, "note": ""},
    {"name": "乙脑减毒活疫苗", "short": "JE-L", "age_months": 8, "dose_index": 1, "note": ""},
    {"name": "乙脑减毒活疫苗", "short": "JE-L", "age_months": 24, "dose_index": 2, "note": "2岁"},
    {"name": "乙脑灭活疫苗", "short": "JE-I", "age_months": 8, "dose_index": 1, "note": "减毒替代方案"},
    {"name": "乙脑灭活疫苗", "short": "JE-I", "age_months": 8, "dose_index": 2, "note": "间隔7-10天"},
    {"name": "乙脑灭活疫苗", "short": "JE-I", "age_months": 24, "dose_index": 3, "note": "2岁"},
    {"name": "乙脑灭活疫苗", "short": "JE-I", "age_months": 72, "dose_index": 4, "note": "6岁"},
    {"name": "甲肝减毒活疫苗", "short": "HepA-L", "age_months": 18, "dose_index": 1, "note": "18月龄"},
    {"name": "甲肝灭活疫苗", "short": "HepA-I", "age_months": 18, "dose_index": 1, "note": "减毒替代方案"},
    {"name": "甲肝灭活疫苗", "short": "HepA-I", "age_months": 24, "dose_index": 2, "note": "间隔6月"},
]

HEALTH_FOLLOWUP_SCHEDULE = [
    {"label": "1月龄", "age_months": 1, "premature_only": False, "location": "社区（儿童健康管理建档）"},
    {"label": "3月龄", "age_months": 3, "premature_only": False, "location": "社区、区妇幼、市妇幼"},
    {"label": "6月龄", "age_months": 6, "premature_only": False, "location": "社区、区妇幼、市妇幼"},
    {"label": "8月龄", "age_months": 8, "premature_only": False, "location": "社区、区妇幼、市妇幼"},
    {"label": "12月龄", "age_months": 12, "premature_only": False, "location": "社区、区妇幼、市妇幼"},
    {"label": "18月龄", "age_months": 18, "premature_only": False, "location": "社区、区妇幼、市妇幼"},
    {"label": "24月龄", "age_months": 24, "premature_only": False, "location": "社区、区妇幼、市妇幼"},
    {"label": "30月龄", "age_months": 30, "premature_only": False, "location": "社区、区妇幼、市妇幼"},
    {"label": "36月龄", "age_months": 36, "premature_only": False, "location": "社区、区妇幼、市妇幼"},
    {"label": "4岁", "age_months": 48, "premature_only": False, "location": "社区"},
    {"label": "5岁", "age_months": 60, "premature_only": False, "location": "社区"},
    {"label": "6岁", "age_months": 72, "premature_only": False, "location": "社区"},
    {"label": "42天-2月龄", "age_months": 1.4, "premature_only": True, "location": "社区、区妇幼、市妇幼"},
    {"label": "4月龄(早产)", "age_months": 4, "premature_only": True, "location": "社区、区妇幼、市妇幼"},
    {"label": "5月龄(早产)", "age_months": 5, "premature_only": True, "location": "社区、区妇幼、市妇幼"},
    {"label": "10月龄(早产)", "age_months": 10, "premature_only": True, "location": "社区、区妇幼、市妇幼"},
    {"label": "15月龄(早产)", "age_months": 15, "premature_only": True, "location": "社区、区妇幼、市妇幼"},
    {"label": "21月龄(早产)", "age_months": 21, "premature_only": True, "location": "社区、区妇幼、市妇幼"},
]


@app.route('/api/vaccine/schedule', methods=['GET'])
@login_required
def vaccine_schedule():
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

    records = db.execute("SELECT * FROM vaccine_records ORDER BY vaccinated_date").fetchall()
    record_map = {}
    for r in records:
        record_map[(r['vaccine_name'], r['dose_index'])] = dict(r)

    overrides = db.execute("SELECT * FROM vaccine_plan_overrides").fetchall()
    override_map = {}
    for o in overrides:
        override_map[(o['vaccine_name'], o['dose_index'])] = o['custom_due_date']

    je_done = any(r['vaccine_name'].startswith('乙脑') for r in records)
    hepa_done = any(r['vaccine_name'].startswith('甲肝') for r in records)
    je_inactivated_done = any(r['vaccine_name'] == '乙脑灭活疫苗' for r in records)
    hepa_inactivated_done = any(r['vaccine_name'] == '甲肝灭活疫苗' for r in records)

    schedule_filtered = []
    for v in VACCINE_SCHEDULE:
        if v['short'] == 'JE-L' and je_inactivated_done:
            continue
        if v['short'] == 'JE-I' and not je_inactivated_done and je_done:
            continue
        if v['short'] == 'HepA-L' and hepa_inactivated_done:
            continue
        if v['short'] == 'HepA-I' and not hepa_inactivated_done and hepa_done:
            continue
        schedule_filtered.append(v)

    schedule = []
    for v in schedule_filtered:
        default_due = (birth + timedelta(days=int(v['age_months'] * 30.44))).strftime('%Y-%m-%d')
        key = (v['name'], v['dose_index'])
        rec = record_map.get(key)
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

    standard_names = {v['name'] for v in VACCINE_SCHEDULE}
    custom_records = [r for r in records if r['vaccine_name'] not in standard_names]
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

    last_done = None
    next_upcoming = None
    for s in schedule:
        if s['status'] == 'done':
            last_done = s
        elif s['status'] in ('upcoming', 'overdue'):
            if next_upcoming is None or s['due_date'] < next_upcoming['due_date']:
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
@login_required
def vaccine_record_add():
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
@login_required
def vaccine_record_delete():
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
@login_required
def update_vaccine_plan_date():
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
    rec = db.execute("SELECT 1 FROM vaccine_records WHERE vaccine_name = ? AND dose_index = ?", (vaccine_name, dose_index)).fetchone()
    if rec:
        return jsonify({'error': '已接种的项目不能修改计划日期'}), 400
    db.execute("INSERT OR REPLACE INTO vaccine_plan_overrides (vaccine_name, dose_index, custom_due_date) VALUES (?, ?, ?)",
               (vaccine_name, dose_index, custom_due_date))
    db.commit()
    add_log('修改计划日期', 'vaccine', None, f"{vaccine_name}第{dose_index}剂 → {custom_due_date}")
    return jsonify({'message': '计划日期已更新'})


@app.route('/api/vaccine/dates', methods=['GET'])
@login_required
def vaccine_dates():
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
    records = db.execute("SELECT vaccinated_date FROM vaccine_records").fetchall()
    result['vaccinated'] = [r['vaccinated_date'] for r in records if r['vaccinated_date']]

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
            if due_date <= today.isoformat():
                result['overdue'].append(due_date)
            else:
                result['upcoming'].append(due_date)

    return jsonify(result)


@app.route('/api/vaccine/day-records', methods=['GET'])
@login_required
def vaccine_day_records():
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
    records = db.execute("SELECT * FROM vaccine_records WHERE vaccinated_date = ?", (rec_date,)).fetchall()
    for r in records:
        result['vaccinated'].append({
            'name': r['vaccine_name'],
            'dose_index': r['dose_index'],
            'vaccinated_date': r['vaccinated_date'],
            'note': r['note'] or ''
        })

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


# ── API: Health Follow-up ──────────────────────────────────

@app.route('/api/health/schedule', methods=['GET'])
@login_required
def health_schedule():
    db = get_db()
    baby = db.execute("SELECT * FROM babies LIMIT 1").fetchone()
    if not baby or not baby['birth_date']:
        return jsonify({'error': '请先设置宝宝出生日期', 'schedule': [], 'overview': None})

    try:
        birth = datetime.strptime(baby['birth_date'], '%Y-%m-%d')
    except (ValueError, TypeError):
        return jsonify({'error': '出生日期格式无效', 'schedule': [], 'overview': None})

    is_premature = bool(baby['is_premature']) if 'is_premature' in baby.keys() else False
    today = date.today()
    schedule_list = [s for s in HEALTH_FOLLOWUP_SCHEDULE if not s['premature_only'] or is_premature]

    records = db.execute("SELECT * FROM health_followup_records").fetchall()
    record_map = {r['label']: dict(r) for r in records}

    overrides = db.execute("SELECT * FROM health_followup_overrides").fetchall()
    override_map = {o['label']: o['custom_due_date'] for o in overrides}

    schedule = []
    for s in schedule_list:
        default_due = (birth + timedelta(days=int(s['age_months'] * 30.44))).strftime('%Y-%m-%d')
        rec = record_map.get(s['label'])
        custom_due = override_map.get(s['label'])
        due_date = custom_due if (custom_due and not rec) else default_due
        entry = {
            **s,
            'due_date': due_date,
            'default_due_date': default_due,
            'status': 'done' if rec else ('overdue' if due_date <= today.isoformat() else 'upcoming'),
            'completed_date': rec['completed_date'] if rec else None,
            'note_text': rec['note'] if rec else '',
            'is_premature': s['premature_only'],
        }
        schedule.append(entry)

    schedule_labels = {s['label'] for s in schedule_list}
    for r in records:
        if r['label'] not in schedule_labels:
            schedule.append({
                'label': r['label'],
                'age_months': None,
                'premature_only': False,
                'location': '',
                'due_date': r['completed_date'],
                'default_due_date': r['completed_date'],
                'status': 'done',
                'completed_date': r['completed_date'],
                'note_text': r['note'] or '',
                'is_premature': False,
                'is_custom': True,
            })

    next_upcoming = None
    for s in schedule:
        if s['status'] in ('upcoming', 'overdue'):
            if next_upcoming is None or s['due_date'] < next_upcoming['due_date']:
                next_upcoming = s

    overview = {
        'is_premature': is_premature,
        'total': len(schedule),
        'done_count': sum(1 for s in schedule if s['status'] == 'done'),
        'overdue_count': sum(1 for s in schedule if s['status'] == 'overdue'),
        'next_upcoming': next_upcoming,
    }
    if next_upcoming:
        due = datetime.strptime(next_upcoming['due_date'], '%Y-%m-%d').date()
        overview['next_days'] = (due - today).days

    return jsonify({'schedule': schedule, 'overview': overview})


@app.route('/api/health/record', methods=['POST'])
@login_required
def health_record_add():
    if not is_approved():
        return jsonify({'error': '无权限'}), 403
    data = request.get_json()
    label = data.get('label', '').strip()
    completed_date = data.get('completed_date') or date.today().isoformat()
    note = data.get('note', '').strip()
    if not label:
        return jsonify({'error': '缺少随访名称'}), 400
    db = get_db()
    db.execute("INSERT OR REPLACE INTO health_followup_records (label, completed_date, note) VALUES (?, ?, ?)",
               (label, completed_date, note))
    db.commit()
    add_log('健康随访', 'health', None, f"{label} → {completed_date}")
    return jsonify({'message': '已记录'}), 201


@app.route('/api/health/record', methods=['DELETE'])
@login_required
def health_record_delete():
    if not is_approved():
        return jsonify({'error': '无权限'}), 403
    label = request.args.get('label', '').strip()
    if not label:
        return jsonify({'error': '缺少随访名称'}), 400
    db = get_db()
    db.execute("DELETE FROM health_followup_records WHERE label = ?", (label,))
    db.commit()
    add_log('删除随访', 'health', None, label)
    return jsonify({'message': '已删除'})


@app.route('/api/health/plan-date', methods=['PUT'])
@login_required
def update_health_plan_date():
    if not is_approved():
        return jsonify({'error': '无权限'}), 403
    data = request.get_json()
    label = data.get('label', '').strip()
    custom_due_date = data.get('custom_due_date', '').strip()
    if not label or not custom_due_date:
        return jsonify({'error': '参数不完整'}), 400
    db = get_db()
    db.execute("INSERT OR REPLACE INTO health_followup_overrides (label, custom_due_date) VALUES (?, ?)",
               (label, custom_due_date))
    db.commit()
    add_log('修改随访日期', 'health', None, f"{label} → {custom_due_date}")
    return jsonify({'message': '计划日期已更新'})


@app.route('/api/health/dates', methods=['GET'])
@login_required
def health_dates():
    db = get_db()
    baby = db.execute("SELECT * FROM babies LIMIT 1").fetchone()
    result = {'completed': [], 'upcoming': [], 'overdue': []}
    if not baby or not baby['birth_date']:
        return jsonify(result)

    try:
        birth = datetime.strptime(baby['birth_date'], '%Y-%m-%d')
    except (ValueError, TypeError):
        return jsonify(result)

    is_premature = bool(baby['is_premature']) if 'is_premature' in baby.keys() else False
    today = date.today()
    schedule_list = [s for s in HEALTH_FOLLOWUP_SCHEDULE if not s['premature_only'] or is_premature]

    records = db.execute("SELECT label, completed_date FROM health_followup_records").fetchall()
    record_set = {r['label'] for r in records}
    record_dates = {r['label']: r['completed_date'] for r in records}

    overrides = db.execute("SELECT * FROM health_followup_overrides").fetchall()
    override_map = {o['label']: o['custom_due_date'] for o in overrides}

    for s in schedule_list:
        if s['label'] in record_set:
            result['completed'].append(record_dates[s['label']])
        else:
            default_due = (birth + timedelta(days=int(s['age_months'] * 30.44))).strftime('%Y-%m-%d')
            due_date = override_map.get(s['label'], default_due)
            if due_date <= today.isoformat():
                result['overdue'].append(due_date)
            else:
                result['upcoming'].append(due_date)

    schedule_labels = {s['label'] for s in schedule_list}
    for r in records:
        if r['label'] not in schedule_labels:
            result['completed'].append(r['completed_date'])

    return jsonify(result)


@app.route('/api/health/day-records', methods=['GET'])
@login_required
def health_day_records():
    rec_date = request.args.get('date', date.today().isoformat())
    db = get_db()
    baby = db.execute("SELECT * FROM babies LIMIT 1").fetchone()
    result = {'completed': [], 'planned': []}
    if not baby or not baby['birth_date']:
        return jsonify(result)

    try:
        birth = datetime.strptime(baby['birth_date'], '%Y-%m-%d')
    except (ValueError, TypeError):
        return jsonify(result)

    is_premature = bool(baby['is_premature']) if 'is_premature' in baby.keys() else False
    today = date.today()
    schedule_list = [s for s in HEALTH_FOLLOWUP_SCHEDULE if not s['premature_only'] or is_premature]

    records = db.execute("SELECT * FROM health_followup_records WHERE completed_date = ?", (rec_date,)).fetchall()
    for r in records:
        result['completed'].append({
            'label': r['label'], 'completed_date': r['completed_date'], 'note': r['note'] or ''
        })

    record_set = {r['label'] for r in db.execute("SELECT label FROM health_followup_records").fetchall()}
    overrides = db.execute("SELECT * FROM health_followup_overrides").fetchall()
    override_map = {o['label']: o['custom_due_date'] for o in overrides}

    for s in schedule_list:
        if s['label'] not in record_set:
            default_due = (birth + timedelta(days=int(s['age_months'] * 30.44))).strftime('%Y-%m-%d')
            due_date = override_map.get(s['label'], default_due)
            if due_date == rec_date:
                result['planned'].append({
                    'label': s['label'], 'due_date': due_date, 'location': s['location'],
                    'status': 'overdue' if due_date <= today.isoformat() else 'upcoming'
                })

    return jsonify(result)


# ── API: Countdown Events ──────────────────────────────────

@app.route('/api/countdowns', methods=['GET'])
@login_required
def get_countdowns():
    db = get_db()
    rows = db.execute("SELECT * FROM countdown_events ORDER BY target_date").fetchall()
    today = date.today()
    result = []
    for r in rows:
        d = dict(r)
        try:
            target = datetime.strptime(r['target_date'], '%Y-%m-%d').date()
            d['days_left'] = (target - today).days
        except (ValueError, TypeError):
            d['days_left'] = None
        result.append(d)
    return jsonify(result)


@app.route('/api/countdowns', methods=['POST'])
@login_required
def add_countdown():
    if not is_approved():
        return jsonify({'error': '无权限'}), 403
    data = request.get_json()
    title = data.get('title', '').strip()
    target_date = data.get('target_date', '').strip()
    note = data.get('note', '').strip()
    if not title or not target_date:
        return jsonify({'error': '标题和日期不能为空'}), 400
    db = get_db()
    db.execute("INSERT INTO countdown_events (title, target_date, note) VALUES (?, ?, ?)",
               (title, target_date, note))
    db.commit()
    add_log('添加倒数日', 'countdown', None, f"{title} → {target_date}")
    return jsonify({'message': '已添加'}), 201


@app.route('/api/countdowns/<int:cid>', methods=['PUT'])
@login_required
def update_countdown(cid):
    if not is_approved():
        return jsonify({'error': '无权限'}), 403
    data = request.get_json()
    title = data.get('title', '').strip()
    target_date = data.get('target_date', '').strip()
    note = data.get('note', '').strip()
    if not title or not target_date:
        return jsonify({'error': '标题和日期不能为空'}), 400
    db = get_db()
    db.execute("UPDATE countdown_events SET title=?, target_date=?, note=? WHERE id=?",
               (title, target_date, note, cid))
    db.commit()
    add_log('修改倒数日', 'countdown', cid, f"{title} → {target_date}")
    return jsonify({'message': '已更新'})


@app.route('/api/countdowns/<int:cid>', methods=['DELETE'])
@login_required
def delete_countdown(cid):
    if not is_approved():
        return jsonify({'error': '无权限'}), 403
    db = get_db()
    db.execute("DELETE FROM countdown_events WHERE id=?", (cid,))
    db.commit()
    add_log('删除倒数日', 'countdown', cid, '')
    return jsonify({'message': '已删除'})


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
@login_required
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
@login_required
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

_ha_button_states = {}
_ha_button_timers = {}

ICON_MAP = {
    'breast': 'mdi:baby-bottle', 'formula': 'mdi:bottle-soda',
    'pumped': 'mdi:baby-bottle-outline', 'water': 'mdi:cup-water',
    'urine': 'mdi:water', 'stool': 'mdi:emoticon-poop',
    'both': 'mdi:baby-face-outline',
}


def _ha_btn_off(btn_id):
    _ha_button_states[btn_id] = 'off'


@app.route('/api/ha/buttons', methods=['GET'])
def ha_buttons():
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
    return _ha_do_press(btn_id)


def _ha_do_press(btn_id):
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
    try:
        size = int(size)
    except ValueError:
        size = 192
    size = min(max(size, 48), 512)

    from PIL import Image, ImageDraw

    bg_color = (0, 229, 160, 255)
    img = Image.new('RGBA', (size, size), bg_color)
    draw = ImageDraw.Draw(img)

    cx = size // 2
    cy = int(size * 0.48)
    unit = size / 100

    bottle_left = cx - 16 * unit
    bottle_right = cx + 16 * unit
    bottle_top = cy - 22 * unit
    bottle_bottom = cy + 24 * unit
    neck_left = cx - 8 * unit
    neck_right = cx + 8 * unit
    neck_top = cy - 32 * unit

    draw.rectangle([neck_left, neck_top, neck_right, bottle_top], fill='white')
    draw.rounded_rectangle([bottle_left, bottle_top, bottle_right, bottle_bottom],
                           radius=6 * unit, fill='white')
    nipple_top = cy - 38 * unit
    draw.ellipse([cx - 6 * unit, nipple_top, cx + 6 * unit, neck_top + 3 * unit],
                 fill='white')
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
