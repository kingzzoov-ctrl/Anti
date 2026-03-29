from datetime import UTC, datetime

from app.services.notification_service import list_notification_events, replay_notification_event, serialize_notification_event


class FakeDb:
    def __init__(self, item=None):
        self.item = item
        self.committed = False
        self.refreshed = False
        self.scalar_items = []

    def get(self, _model, _id):
        return self.item

    def commit(self):
        self.committed = True

    def refresh(self, _item):
        self.refreshed = True

    def scalars(self, _statement):
        return type('ScalarResult', (), {'all': lambda _self: list(self.scalar_items)})()


def test_replay_notification_event_resets_dead_letter_state():
    item = type('Item', (), {
        'id': 'notify_1',
        'status': 'failed',
        'retry_count': 3,
        'last_error': 'boom',
        'dead_lettered_at': datetime.now(UTC),
        'started_at': datetime.now(UTC),
        'delivered_at': None,
        'updated_at': datetime.now(UTC),
        'scheduled_at': datetime.now(UTC),
    })()
    db = FakeDb(item)

    updated = replay_notification_event(db, 'notify_1')

    assert updated.status == 'queued'
    assert updated.retry_count == 0
    assert updated.last_error is None
    assert updated.dead_lettered_at is None
    assert db.committed is True
    assert db.refreshed is True


def test_serialize_notification_event_contains_dead_letter_fields():
    now = datetime.now(UTC)
    item = type('Item', (), {
        'id': 'notify_2',
        'user_id': 'user_1',
        'kind': 'match_ready',
        'channel': 'email',
        'status': 'failed',
        'title': 'title',
        'body': 'body',
        'payload': {},
        'idempotency_key': 'k1',
        'retry_count': 3,
        'max_retries': 3,
        'last_error': 'boom',
        'dead_lettered_at': now,
        'source_kind': 'match_record',
        'source_id': 'match_1',
        'created_at': now,
        'updated_at': now,
        'scheduled_at': now,
        'started_at': None,
        'delivered_at': None,
    })()

    payload = serialize_notification_event(item)

    assert payload['deadLetteredAt'] == now.isoformat()
    assert payload['idempotencyKey'] == 'k1'


def test_replay_notification_event_accepts_custom_schedule():
    now = datetime.now(UTC)
    future = now.replace(year=now.year + 1)
    item = type('Item', (), {
        'id': 'notify_3',
        'status': 'failed',
        'retry_count': 2,
        'last_error': 'timeout',
        'dead_lettered_at': now,
        'started_at': now,
        'delivered_at': None,
        'updated_at': now,
        'scheduled_at': now,
    })()
    db = FakeDb(item)

    updated = replay_notification_event(db, 'notify_3', scheduled_at=future)

    assert updated.status == 'queued'
    assert updated.scheduled_at == future
    assert updated.dead_lettered_at is None


def test_list_notification_events_returns_scalar_results():
    item_a = type('Item', (), {'id': 'notify_a'})()
    item_b = type('Item', (), {'id': 'notify_b'})()
    db = FakeDb()
    db.scalar_items = [item_a, item_b]

    items = list_notification_events(db, user_id='user_1', status='failed', source_kind='report_job', limit=20)

    assert [item.id for item in items] == ['notify_a', 'notify_b']