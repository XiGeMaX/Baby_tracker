import os
import json
import tempfile
import unittest
from datetime import date, timedelta
from unittest.mock import patch

import app as app_module
import ai_service
from werkzeug.security import generate_password_hash


def _generate_password_hash(password):
    # macOS system Python 3.9 may lack hashlib.scrypt; the app runs on Python 3.11.
    return generate_password_hash(password, method='pbkdf2:sha256')


class ApiTestCase(unittest.TestCase):
    def setUp(self):
        app_module.generate_password_hash = _generate_password_hash
        self.temp_dir = tempfile.TemporaryDirectory()
        app_module.app.config.update(
            DATABASE=os.path.join(self.temp_dir.name, 'test.db'),
            TESTING=True,
        )
        app_module._db_initialized = False
        app_module._ha_button_states.clear()
        for timer in app_module._ha_button_timers.values():
            timer.cancel()
        app_module._ha_button_timers.clear()
        self.client = app_module.app.test_client()
        self.client.get('/api/auth/me')

    def tearDown(self):
        for timer in app_module._ha_button_timers.values():
            timer.cancel()
        app_module._ha_button_timers.clear()
        app_module._ha_button_states.clear()
        app_module._db_initialized = False
        self.temp_dir.cleanup()

    def _insert_record(self, record_type, sub_type, amount, timestamp):
        with app_module.app.app_context():
            db = app_module.get_db()
            cursor = db.execute(
                """
                INSERT INTO records (baby_id, user_id, type, sub_type, amount, timestamp)
                VALUES (1, 1, ?, ?, ?, ?)
                """,
                (record_type, sub_type, amount, timestamp),
            )
            db.commit()
            return cursor.lastrowid

    def test_today_summary_uses_latest_feed_across_days(self):
        today = date.today().isoformat()
        yesterday = (date.today() - timedelta(days=1)).isoformat()

        self._insert_record('feed', 'breast_left', 70, f'{yesterday} 23:30:00')

        response = self.client.get(f'/api/records/today?date={today}')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload['total_feed_ml'], 0)
        self.assertEqual(payload['last_feed_time'], f'{yesterday} 23:30:00')

    def test_latest_feed_uses_id_as_tie_breaker(self):
        today = date.today().isoformat()
        timestamp = f'{today} 08:00:00'

        self._insert_record('feed', 'formula', 60, timestamp)
        latest_id = self._insert_record('feed', 'formula', 80, timestamp)

        response = self.client.get(f'/api/records/today?date={today}')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['last_feed_time'], timestamp)
        self.assertEqual(response.get_json()['total_feed_ml'], 140)

        with app_module.app.app_context():
            latest = app_module._get_latest_feed(app_module.get_db())
            self.assertEqual(latest['id'], latest_id)

    def test_latest_feed_includes_solid_food(self):
        today = date.today().isoformat()
        self._insert_record('feed', 'formula', 100, f'{today} 08:00:00')
        self._insert_record('feed', 'solid_food', 30, f'{today} 09:00:00')

        response = self.client.get(f'/api/records/today?date={today}')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['last_feed_time'], f'{today} 09:00:00')

    def test_ha_status_exposes_standard_sensor_payload(self):
        today = date.today().isoformat()
        yesterday = (date.today() - timedelta(days=1)).isoformat()

        self._insert_record('feed', 'formula', 120, f'{today} 08:00:00')
        self._insert_record('excrete', 'urine', None, f'{today} 09:00:00')
        self._insert_record('excrete', 'both', None, f'{today} 10:00:00')
        self._insert_record('feed', 'breast_right', 90, f'{yesterday} 23:00:00')

        response = self.client.get(f'/api/ha/status?date={today}')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()

        self.assertEqual(payload['state'], 120)
        self.assertEqual(payload['attributes']['total_feed_ml'], 120)
        self.assertEqual(payload['attributes']['feed_count'], 1)
        self.assertEqual(payload['attributes']['urine_count'], 2)
        self.assertEqual(payload['attributes']['stool_count'], 1)
        self.assertEqual(payload['attributes']['last_feed_time'], f'{today} 08:00:00')

        last_feed = self.client.get('/api/ha/last-feed').get_json()
        self.assertEqual(last_feed['state'], f'{today} 08:00:00')
        self.assertEqual(last_feed['attributes']['amount_ml'], 120)

    def test_ha_button_accepts_bearer_and_x_api_key_headers(self):
        with app_module.app.app_context():
            db = app_module.get_db()
            button_id = db.execute(
                "SELECT id FROM quick_buttons WHERE is_active = 1 ORDER BY sort_order LIMIT 1"
            ).fetchone()['id']
            db.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('ha_api_key', 'test-key')"
            )
            db.commit()

        response = self.client.post(
            f'/api/ha/button/{button_id}',
            headers={'Authorization': 'Bearer test-key'},
            json={'state': 'on'},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['state'], 'on')

        response = self.client.post(
            f'/api/ha/button/{button_id}',
            headers={'X-API-Key': 'test-key'},
            json={'state': 'on'},
        )
        self.assertEqual(response.status_code, 200)

        response = self.client.post(f'/api/ha/button/{button_id}', json={'state': 'on'})
        self.assertEqual(response.status_code, 401)


    # ── 批量录入 / AI 配置 / AI 识别（离线，全部 mock，不联网）──────────

    VALID_IMAGE = 'data:image/png;base64,ZmFrZQ=='  # base64(b'fake')，合法 data URL
    RECORD_REQUIRED_KEYS = (
        'type', 'sub_type', 'amount', 'duration', 'color', 'consistency',
        'temperature', 'note', 'timestamp', 'food_unit',
        'confidence', 'warnings', 'raw_text', 'valid', 'errors',
    )

    def _login_admin(self):
        with self.client.session_transaction() as sess:
            sess['user_id'] = 1

    def _count_records(self):
        with app_module.app.app_context():
            db = app_module.get_db()
            return db.execute("SELECT COUNT(*) AS c FROM records").fetchone()['c']

    def _blank_ai_env(self):
        # 保证"未配置"判定不受运行机环境变量影响；上下文退出自动恢复
        return patch.dict(os.environ, {
            'AI_VISION_BASE_URL': '', 'AI_VISION_API_KEY': '', 'AI_VISION_MODEL': '',
        })

    def test_batch_inserts_three_records(self):
        self._login_admin()
        today = date.today().isoformat()
        records = [
            {'type': 'feed', 'sub_type': 'formula', 'amount': 90, 'timestamp': f'{today} 08:00:00',
             'confidence': 0.9, 'valid': True, '_selected': True},
            {'type': 'feed', 'sub_type': 'formula', 'amount': 120, 'timestamp': f'{today} 10:00'},
            {'type': 'excrete', 'sub_type': 'stool', 'timestamp': f'{today} 09:00:00'},
        ]
        resp = self.client.post('/api/records/batch', json={'records': records, '_date': today})
        self.assertEqual(resp.status_code, 201)
        payload = resp.get_json()
        self.assertEqual(payload['inserted'], 3)
        self.assertEqual(len(payload['record_ids']), 3)
        self.assertIn('total_feed_ml', payload)
        self.assertEqual(payload['total_feed_ml'], 210)
        self.assertEqual(self._count_records(), 3)
        # 前端非 DB 字段应被忽略，不进库
        with app_module.app.app_context():
            db = app_module.get_db()
            cols = [r['name'] for r in db.execute("PRAGMA table_info(records)").fetchall()]
            self.assertNotIn('confidence', cols)

    def test_batch_invalid_type_rolls_back_whole_batch(self):
        self._login_admin()
        today = date.today().isoformat()
        records = [
            {'type': 'feed', 'sub_type': 'formula', 'amount': 90, 'timestamp': f'{today} 08:00:00'},
            {'type': 'NOT_A_TYPE', 'sub_type': 'formula', 'timestamp': f'{today} 09:00:00'},
            {'type': 'feed', 'sub_type': 'formula', 'amount': 100, 'timestamp': f'{today} 10:00:00'},
        ]
        resp = self.client.post('/api/records/batch', json={'records': records, '_date': today})
        self.assertEqual(resp.status_code, 400)
        self.assertIn('第2条', resp.get_json()['error'])
        self.assertEqual(resp.get_json()['index'], 2)
        self.assertEqual(self._count_records(), 0)  # 整批不写

    def test_batch_empty_array_rejected(self):
        self._login_admin()
        resp = self.client.post('/api/records/batch', json={'records': [], '_date': date.today().isoformat()})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self._count_records(), 0)

    def test_batch_requires_login(self):
        resp = self.client.post('/api/records/batch', json={
            'records': [{'type': 'feed', 'sub_type': 'formula'}],
            '_date': date.today().isoformat(),
        })
        self.assertEqual(resp.status_code, 401)

    def test_ai_config_requires_admin_and_never_echoes_full_key(self):
        # 未登录访问 GET /api/ai/config → 401/403
        with self._blank_ai_env():
            resp = self.client.get('/api/ai/config')
            self.assertIn(resp.status_code, (401, 403))

            self._login_admin()
            secret = 'sk-supersecret-abcd1234'
            put = self.client.put('/api/ai/config', json={
                'base_url': 'https://example.com/v1',
                'model': 'test-model',
                'api_key': secret,
            })
            self.assertEqual(put.status_code, 200)
            self.assertNotIn(secret, put.get_data(as_text=True))

            get = self.client.get('/api/ai/config')
            self.assertEqual(get.status_code, 200)
            body_text = get.get_data(as_text=True)
            self.assertNotIn(secret, body_text)  # 绝不回显完整密钥
            cfg = get.get_json()
            self.assertTrue(cfg['has_key'])
            self.assertEqual(cfg['api_key_masked'], '****1234')
            self.assertEqual(cfg['key_source'], 'db')
            self.assertTrue(cfg['configured'])

    def test_ai_config_put_empty_key_preserves_existing(self):
        self._login_admin()
        with self._blank_ai_env():
            self.client.put('/api/ai/config', json={
                'base_url': 'https://example.com/v1', 'model': 'm', 'api_key': 'sk-keep-9999'})
            # 省略 api_key 仅改 model，密钥应保留
            resp = self.client.put('/api/ai/config', json={
                'base_url': 'https://example.com/v1', 'model': 'm2'})
            self.assertEqual(resp.get_json()['config']['api_key_masked'], '****9999')
            self.assertEqual(resp.get_json()['config']['model'], 'm2')

    def test_backup_export_filters_ai_api_key(self):
        self._login_admin()
        with app_module.app.app_context():
            db = app_module.get_db()
            db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_vision_api_key', 'sk-topsecret-0000')")
            db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_vision_base_url', 'https://example.com/v1')")
            db.commit()
        resp = self.client.get('/api/backup/export')
        self.assertEqual(resp.status_code, 200)
        backup = json.loads(resp.data)
        self.assertEqual(backup['version'], 1)
        settings_rows = backup['tables']['settings']['rows']
        keys = [r['key'] for r in settings_rows]
        self.assertNotIn('ai_vision_api_key', keys)
        self.assertIn('ai_vision_base_url', keys)  # 其它 key 不受影响
        self.assertNotIn('sk-topsecret-0000', resp.get_data(as_text=True))
        self.assertEqual(backup['tables']['settings']['columns'], ['id', 'key', 'value', 'updated_at'])

    def test_ai_recognize_not_configured(self):
        self._login_admin()
        with self._blank_ai_env():
            resp = self.client.post('/api/ai/recognize', json={
                'image': self.VALID_IMAGE, 'date': date.today().isoformat()})
            self.assertEqual(resp.status_code, 400)
            payload = resp.get_json()
            self.assertEqual(payload['error'], '尚未配置 AI 服务')
            self.assertFalse(payload['configured'])

    def test_ai_recognize_returns_records_with_all_keys(self):
        self._login_admin()
        today = date.today().isoformat()
        raw = [
            {'type': '喂奶', 'sub_type': '配方奶', 'amount': '90', 'time': '08:30',
             'raw_text': '08:30 配方奶90ml', 'confidence': 0.95},
            {'type': '排泄', 'sub_type': '大便', 'time': '09:00',
             'raw_text': '09:00 大便', 'confidence': 0.4},
        ]
        # 用 env 提供 key 让 configured=True；recognize_image 完全 mock，绝不联网
        with patch.dict(os.environ, {'AI_VISION_API_KEY': 'sk-offline-test',
                                    'AI_VISION_BASE_URL': '', 'AI_VISION_MODEL': ''}):
            with patch.object(app_module.ai_service, 'recognize_image',
                              side_effect=lambda img, d, cfg=None: ai_service.normalize_records(raw, d)) as m:
                resp = self.client.post('/api/ai/recognize', json={
                    'image': self.VALID_IMAGE, 'date': today})
                self.assertTrue(m.called)
        self.assertEqual(resp.status_code, 200)
        payload = resp.get_json()
        self.assertEqual(payload['meta']['count'], 2)
        self.assertEqual(len(payload['records']), 2)
        for rec in payload['records']:
            for key in self.RECORD_REQUIRED_KEYS:
                self.assertIn(key, rec)
        # 顺带验证归一化：第1条映射为 feed/formula，时间拼接正确
        self.assertEqual(payload['records'][0]['type'], 'feed')
        self.assertEqual(payload['records'][0]['sub_type'], 'formula')
        self.assertEqual(payload['records'][0]['timestamp'], f'{today} 08:30:00')
        self.assertTrue(payload['records'][0]['valid'])

    def test_recognize_date_from_image(self):
        """图片里读到日期时优先采用；读不到则沿用弹窗所选日期，不猜测。"""
        today = '2026-11-09'
        raw = [
            # 完整日期：覆盖弹窗日期
            {'type': 'feed', 'sub_type': 'formula', 'date': '2026-11-08',
             'time': '08:30', 'confidence': 0.9},
            # 无日期：完全沿用弹窗日期，且不加任何日期相关提示
            {'type': 'feed', 'sub_type': 'formula', 'time': '09:30', 'confidence': 0.9},
            # 中文月日：年份取弹窗日期年份
            {'type': 'excrete', 'sub_type': 'urine', 'date': '11月7日',
             'time': '10:00', 'confidence': 0.9},
            # 斜杠 MM/DD
            {'type': 'excrete', 'sub_type': 'stool', 'date': '11/6',
             'time': '11:00', 'confidence': 0.9},
            # 非法日期：忽略，不处理
            {'type': 'symptom', 'sub_type': 'fever', 'date': '2026-13-45',
             'time': '12:00', 'confidence': 0.9},
        ]
        recs = ai_service.normalize_records(raw, today)
        self.assertEqual(len(recs), 5)

        self.assertEqual(recs[0]['timestamp'], '2026-11-08 08:30:00')
        self.assertTrue(recs[0]['date_recognized'])
        self.assertEqual(recs[0]['raw_date'], '2026-11-08')
        self.assertTrue(any('已采用图片中的日期' in w for w in recs[0]['warnings']))
        self.assertTrue(recs[0]['valid'])  # 仅为提示，不影响有效性

        self.assertEqual(recs[1]['timestamp'], f'{today} 09:30:00')
        self.assertFalse(recs[1]['date_recognized'])
        self.assertFalse(any('日期' in w for w in recs[1]['warnings']))

        self.assertEqual(recs[2]['timestamp'], '2026-11-07 10:00:00')
        self.assertTrue(recs[2]['date_recognized'])
        self.assertEqual(recs[3]['timestamp'], '2026-11-06 11:00:00')
        self.assertTrue(recs[3]['date_recognized'])

        self.assertEqual(recs[4]['timestamp'], f'{today} 12:00:00')
        self.assertFalse(recs[4]['date_recognized'])

    def test_recognized_date_yields_to_complete_timestamp(self):
        """AI 返回完整时间戳时，以时间戳里的日期为准（图片信息更完整）。"""
        rec = ai_service.normalize_records([{
            'type': 'feed', 'sub_type': 'formula', 'date': '2026-11-08',
            'timestamp': '2026-11-07 07:00:00', 'confidence': 0.9,
        }], '2026-11-09')[0]
        self.assertEqual(rec['timestamp'], '2026-11-07 07:00:00')
        self.assertTrue(rec['date_recognized'])

    # ── API Token（PWA / 原生客户端就绪）────────────────────────

    def test_token_requires_login(self):
        resp = self.client.post('/api/auth/token')
        self.assertEqual(resp.status_code, 401)

    def test_token_works_without_session_cookie(self):
        self._login_admin()
        resp = self.client.post('/api/auth/token')
        self.assertEqual(resp.status_code, 201)
        payload = resp.get_json()
        self.assertTrue(payload['token'])
        self.assertEqual(payload['expires_in'], app_module.TOKEN_MAX_AGE)

        # 全新客户端：无 session cookie，仅凭 Bearer token 访问 admin 接口
        anon = app_module.app.test_client()
        anon.get('/api/auth/me')
        h = {'Authorization': 'Bearer ' + payload['token']}
        self.assertEqual(anon.get('/api/ai/config', headers=h).status_code, 200)
        self.assertEqual(anon.post('/api/records/batch', headers=h, json={
            'records': [{'type': 'feed', 'sub_type': 'formula', 'amount': 60,
                         'timestamp': f'{date.today().isoformat()} 08:00:00'}],
            '_date': date.today().isoformat(),
        }).status_code, 201)
        self.assertEqual(self._count_records(), 1)

    def test_token_invalid_and_revoked_user(self):
        self._login_admin()
        token = self.client.post('/api/auth/token').get_json()['token']
        anon = app_module.app.test_client()
        anon.get('/api/auth/me')

        # 伪造 / 篡改 token 视为未登录（/api/ai/config 为 admin-only → 403）
        for bad in ('Bearer garbage', 'Bearer ' + token + 'x', ''):
            h = {'Authorization': bad} if bad else {}
            self.assertIn(anon.get('/api/ai/config', headers=h).status_code, (401, 403))

        # 用户被停用后，已签发的 token 立即失效
        with app_module.app.app_context():
            db = app_module.get_db()
            db.execute("UPDATE users SET status='rejected' WHERE id=1")
            db.commit()
        self.assertIn(
            anon.get('/api/ai/config', headers={'Authorization': 'Bearer ' + token}).status_code,
            (401, 403))

    def test_token_expires(self):
        """token 超过有效期后解析失败（模拟 31 天前的签发时间）。"""
        self._login_admin()
        token = self.client.post('/api/auth/token').get_json()['token']
        # 通过缩短 max_age 校验载荷确实带时间戳、且受有效期约束
        with app_module.app.test_request_context('/api/ai/config',
                                                 headers={'Authorization': 'Bearer ' + token}):
            with patch.object(app_module, 'TOKEN_MAX_AGE', -1):
                self.assertIsNone(app_module._uid_from_bearer_token())

    def test_ha_api_key_auth_unaffected_by_bearer_token(self):
        """HA 快速记录端点仍只读 HA 密钥，不被用户 token 认证干扰。"""
        with app_module.app.app_context():
            db = app_module.get_db()
            button_id = db.execute(
                "SELECT id FROM quick_buttons WHERE is_active = 1 ORDER BY sort_order LIMIT 1"
            ).fetchone()['id']
            db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('ha_api_key', 'ha-secret')")
            db.commit()

        self._login_admin()
        user_token = self.client.post('/api/auth/token').get_json()['token']
        anon = app_module.app.test_client()
        # 用户 token 不能冒充 HA 密钥
        resp = anon.post(f'/api/ha/button/{button_id}',
                         headers={'Authorization': 'Bearer ' + user_token},
                         json={'state': 'on'})
        self.assertEqual(resp.status_code, 401)
        # 真正的 HA 密钥仍可工作
        resp = anon.post(f'/api/ha/button/{button_id}',
                         headers={'Authorization': 'Bearer ha-secret'},
                         json={'state': 'on'})
        self.assertEqual(resp.status_code, 200)


if __name__ == '__main__':
    unittest.main()
