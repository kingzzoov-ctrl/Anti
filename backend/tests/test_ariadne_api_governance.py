from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.router import api_router
from app.db.session import get_db


class FakeScalarResult:
    def __init__(self, items):
        self.items = list(items)

    def first(self):
        return self.items[0] if self.items else None

    def all(self):
        return list(self.items)


class FakeQuery:
    def __init__(self, items):
        self.items = list(items)

    def order_by(self, *_args, **_kwargs):
        return self

    def filter(self, *_args, **_kwargs):
        return self

    def all(self):
        return list(self.items)


class FakeDb:
    def __init__(self):
        self.thread = None
        self.profile = None
        self.active_asset = None
        self.notification_event = None
        self.notification_events = []
        self.report_job = None
        self.report_jobs = []
        self.strategy_target = None
        self.strategy_active_items = []
        self.committed = False
        self.refreshed = False
        self._scalar_calls = 0

    def get(self, _model, item_id):
        if self.thread is not None and getattr(self.thread, 'id', None) == item_id:
            return self.thread
        if self.notification_event is not None and getattr(self.notification_event, 'id', None) == item_id:
            return self.notification_event
        if self.report_job is not None and getattr(self.report_job, 'id', None) == item_id:
            return self.report_job
        return None

    def scalars(self, _statement):
        self._scalar_calls += 1
        statement_text = str(_statement)
        if 'system_configs' in statement_text:
            return FakeScalarResult([])
        if 'notification_events' in statement_text:
            return FakeScalarResult(self.notification_events)
        if self.active_asset is not None and 'strategy_assets' in statement_text and 'is_active' in statement_text:
            return FakeScalarResult([self.active_asset])
        if self.strategy_target is not None:
            if self._scalar_calls == 1:
                return FakeScalarResult([self.strategy_target])
            return FakeScalarResult(self.strategy_active_items)
        if self.profile is not None:
            return FakeScalarResult([self.profile])
        return FakeScalarResult([])

    def scalar(self, _statement):
        return 0

    def execute(self, _statement):
        return type('ExecuteResult', (), {'all': lambda _self: []})()

    def query(self, _model):
        return FakeQuery(self.report_jobs)

    def add(self, item):
        if getattr(item, 'id', '').startswith('thread_'):
            self.thread = item
        elif getattr(item, 'user_id', None):
            self.profile = item

    def add_all(self, _items):
        return None

    def commit(self):
        self.committed = True

    def refresh(self, _item):
        self.refreshed = True


def create_client(fake_db: FakeDb) -> TestClient:
    app = FastAPI()
    app.include_router(api_router, prefix='/api/v1')
    def override_get_db():
        yield fake_db

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


def test_put_thread_returns_governance_payload():
    fake_db = FakeDb()
    client = create_client(fake_db)

    response = client.put(
        '/api/v1/ariadne/threads/thread_demo',
        json={
            'userIdA': 'user_a',
            'userIdB': 'user_b',
            'matchId': 'match_1',
            'unlockStage': 0,
            'icebreakers': ['从最近一次情绪起伏聊起'],
            'tensionReport': {'riskLevel': 'moderate'},
            'unlockMilestones': [],
            'messages': [],
            'status': 'cooldown',
            'cooldownUntil': '2099-01-01T00:00:00Z',
            'governanceNote': 'manual-bandwidth-release',
        },
    )

    assert response.status_code == 200
    payload = response.json()['data']
    assert payload['status'] == 'cooldown'
    assert payload['governanceState']['isCoolingDown'] is True
    assert payload['governanceState']['governanceNote'] == 'manual-bandwidth-release'
    assert payload['cooldownUntil'].startswith('2099-01-01T00:00:00')


def test_put_thread_rejects_reopening_closed_thread():
    fake_db = FakeDb()
    fake_db.thread = type('Thread', (), {
        'id': 'thread_closed',
        'user_id_a': 'user_a',
        'user_id_b': 'user_b',
        'match_id': 'match_1',
        'unlock_stage': 1,
        'icebreakers': [],
        'tension_report': {},
        'unlock_milestones': [],
        'messages': [],
        'status': 'closed',
        'cooldown_until': None,
        'closed_at': datetime.now(UTC).replace(tzinfo=None),
        'governance_note': 'done',
        'created_at': datetime.now(UTC).replace(tzinfo=None),
        'updated_at': datetime.now(UTC).replace(tzinfo=None),
    })()
    client = create_client(fake_db)

    response = client.put(
        '/api/v1/ariadne/threads/thread_closed',
        json={
            'userIdA': 'user_a',
            'userIdB': 'user_b',
            'unlockStage': 1,
            'icebreakers': [],
            'tensionReport': {},
            'unlockMilestones': [],
            'messages': [],
            'status': 'active',
        },
    )

    assert response.status_code == 400
    assert response.json()['detail'] == 'Closed thread cannot be reopened'


def test_activate_strategy_asset_route_returns_audit_fields():
    fake_db = FakeDb()
    fake_db.strategy_target = type('Asset', (), {
        'id': 2,
        'asset_key': 'MATCH',
        'version': 'v3',
        'asset_type': 'prompt',
        'title': 'Match Prompt',
        'content': '...',
        'source_path': 'skills/match.skill.md',
        'is_active': False,
        'activated_from_version': '',
        'rollback_note': '',
        'rollback_operator': '',
        'rollback_at': None,
        'created_at': datetime.now(UTC).replace(tzinfo=None),
        'updated_at': datetime.now(UTC).replace(tzinfo=None),
    })()
    fake_db.strategy_active_items = [type('Asset', (), {'version': 'v2', 'is_active': True, 'updated_at': None})()]
    client = create_client(fake_db)

    response = client.post(
        '/api/v1/ariadne/runtime/strategy-assets/MATCH/activate',
        json={
            'version': 'v3',
            'reason': 'admin-console-manual-switch',
            'operator': 'admin_7',
        },
    )

    assert response.status_code == 200
    payload = response.json()['data']
    assert payload['isActive'] is True
    assert payload['activatedFromVersion'] == 'v2'
    assert payload['rollbackNote'] == 'admin-console-manual-switch'
    assert payload['rollbackOperator'] == 'admin_7'


def test_get_profile_returns_social_bandwidth_payload():
    fake_db = FakeDb()
    now = datetime.now(UTC).replace(tzinfo=None)
    fake_db.profile = type('Profile', (), {
        'id': 'prof_user_a',
        'user_id': 'user_a',
        'display_name': 'User A',
        'tier': 'Free',
        'token_balance': 12,
        'notification_channels': {'email': False},
        'matching_enabled': True,
        'privacy_consent_accepted_at': None,
        'privacy_consent_version': None,
        'privacy_consent_scope': None,
        'is_admin': False,
        'created_at': now,
        'updated_at': now,
    })()
    client = create_client(fake_db)

    response = client.get('/api/v1/ariadne/profiles/user_a')

    assert response.status_code == 200
    payload = response.json()['data']
    assert payload['userId'] == 'user_a'
    assert payload['socialBandwidth']['activeThreadCount'] == 0
    assert payload['socialBandwidth']['coolingThreadCount'] == 0
    assert payload['socialBandwidth']['discoverable'] is True


def test_get_active_strategy_asset_returns_current_version():
    fake_db = FakeDb()
    now = datetime.now(UTC).replace(tzinfo=None)
    fake_db.active_asset = type('Asset', (), {
        'id': 3,
        'asset_key': 'REPORT',
        'version': 'v5',
        'asset_type': 'prompt',
        'title': 'Report Prompt',
        'content': '...',
        'source_path': 'skills/report.skill.md',
        'is_active': True,
        'activated_from_version': 'v4',
        'rollback_note': 'stabilize-report-logic',
        'rollback_operator': 'admin_3',
        'rollback_at': now,
        'created_at': now,
        'updated_at': now,
    })()
    client = create_client(fake_db)

    response = client.get('/api/v1/ariadne/runtime/strategy-assets/REPORT/active')

    assert response.status_code == 200
    payload = response.json()['data']
    assert payload['assetKey'] == 'REPORT'
    assert payload['version'] == 'v5'
    assert payload['isActive'] is True


def test_get_notifications_returns_event_items():
    fake_db = FakeDb()
    now = datetime.now(UTC)
    fake_db.notification_events = [
        type('NotificationEvent', (), {
            'id': 'evt_1',
            'user_id': 'user_a',
            'kind': 'report_ready',
            'channel': 'inbox',
            'status': 'queued',
            'title': '报告已生成',
            'body': '请查看最新报告',
            'payload': {'kind': 'report_ready'},
            'idempotency_key': 'report_job:job_1:user_a:report_ready:inbox',
            'retry_count': 0,
            'max_retries': 3,
            'last_error': None,
            'dead_lettered_at': None,
            'source_kind': 'report_job',
            'source_id': 'job_1',
            'created_at': now,
            'updated_at': now,
            'scheduled_at': now,
            'started_at': None,
            'delivered_at': None,
        })()
    ]
    client = create_client(fake_db)

    response = client.get('/api/v1/ariadne/notifications?user_id=user_a&status=queued&source_kind=report_job')

    assert response.status_code == 200
    items = response.json()['data']['items']
    assert len(items) == 1
    assert items[0]['id'] == 'evt_1'
    assert items[0]['sourceKind'] == 'report_job'
    assert items[0]['status'] == 'queued'


def test_post_notification_replay_resets_event_state():
    fake_db = FakeDb()
    now = datetime.now(UTC)
    fake_db.notification_event = type('NotificationEvent', (), {
        'id': 'evt_replay',
        'user_id': 'user_a',
        'kind': 'report_ready',
        'channel': 'email',
        'status': 'failed',
        'title': '报告已生成',
        'body': '请查看最新报告',
        'payload': {'kind': 'report_ready'},
        'idempotency_key': 'report_job:job_2:user_a:report_ready:email',
        'retry_count': 2,
        'max_retries': 3,
        'last_error': 'timeout',
        'dead_lettered_at': now,
        'source_kind': 'report_job',
        'source_id': 'job_2',
        'created_at': now,
        'updated_at': now,
        'scheduled_at': now,
        'started_at': now,
        'delivered_at': None,
    })()
    client = create_client(fake_db)

    response = client.post(
        '/api/v1/ariadne/notifications/evt_replay/replay',
        json={'scheduledAt': '2099-01-01T00:00:00Z'},
    )

    assert response.status_code == 200
    payload = response.json()['data']
    assert payload['id'] == 'evt_replay'
    assert payload['status'] == 'queued'
    assert payload['retryCount'] == 0
    assert payload['lastError'] is None
    assert payload['scheduledAt'].startswith('2099-01-01T00:00:00+00:00')
    assert fake_db.committed is True
    assert fake_db.refreshed is True


def test_get_async_report_job_returns_job_payload():
    fake_db = FakeDb()
    now = datetime.now(UTC)
    fake_db.report_job = type('ReportJob', (), {
        'id': 'report_job_123',
        'user_id': 'user_a',
        'session_id': 'session_1',
        'status': 'running',
        'progress': 70,
        'report_id': None,
        'error_message': None,
        'payload': {
            'trigger': {'messagesCount': 8},
            'timeline': [{'status': 'queued', 'at': now.isoformat(), 'label': '报告任务已入队'}],
        },
        'created_at': now,
        'updated_at': now,
        'started_at': now,
        'completed_at': None,
    })()
    client = create_client(fake_db)

    response = client.get('/api/v1/ariadne/report/jobs/report_job_123')

    assert response.status_code == 200
    payload = response.json()['data']
    assert payload['id'] == 'report_job_123'
    assert payload['status'] == 'running'
    assert payload['progress'] == 70
    assert payload['payload']['trigger']['messagesCount'] == 8


def test_get_async_report_jobs_returns_items():
    fake_db = FakeDb()
    now = datetime.now(UTC)
    fake_db.report_jobs = [
        type('ReportJob', (), {
            'id': 'report_job_001',
            'user_id': 'user_a',
            'session_id': 'session_1',
            'status': 'queued',
            'progress': 0,
            'report_id': None,
            'error_message': None,
            'payload': {'trigger': {'messagesCount': 3}, 'timeline': []},
            'created_at': now,
            'updated_at': now,
            'started_at': None,
            'completed_at': None,
        })()
    ]
    client = create_client(fake_db)

    response = client.get('/api/v1/ariadne/report/jobs?user_id=user_a')

    assert response.status_code == 200
    items = response.json()['data']['items']
    assert len(items) == 1
    assert items[0]['id'] == 'report_job_001'
    assert items[0]['status'] == 'queued'