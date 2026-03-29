from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from app.services.notification_service import claim_next_notification_event, process_notification_event, serialize_notification_event


class FakeScalarResult:
    def __init__(self, item):
        self._item = item

    def first(self):
        return self._item


class FakeExecuteResult:
    def __init__(self, item):
        self._item = item

    def scalars(self):
        return FakeScalarResult(self._item)


class FakeDb:
    def __init__(self, item=None):
        self.item = item
        self.committed = False
        self.refreshed = False
        self.added = []

    def execute(self, _statement):
        return FakeExecuteResult(self.item)

    def commit(self):
        self.committed = True

    def refresh(self, _item):
        self.refreshed = True

    def get(self, _model, _id):
        return self.item

    def add(self, item):
        self.added.append(item)


def test_claim_next_notification_event_marks_running():
    item = SimpleNamespace(
        id='notify_evt_1',
        status='queued',
        scheduled_at=datetime.now(UTC) - timedelta(seconds=1),
        started_at=None,
        updated_at=datetime.now(UTC),
    )
    db = FakeDb(item)

    claimed = claim_next_notification_event(db)

    assert claimed is item
    assert item.status == 'running'
    assert item.started_at is not None
    assert db.committed is True
    assert db.refreshed is True


def test_process_notification_event_requeues_on_failure(monkeypatch):
    item = SimpleNamespace(
        id='notify_evt_2',
        status='running',
        channel='email',
        payload={'id': 'notify_evt_2', 'channel': 'email'},
        retry_count=0,
        max_retries=3,
        last_error=None,
        updated_at=datetime.now(UTC),
        scheduled_at=datetime.now(UTC),
        delivered_at=None,
    )
    db = FakeDb(item)

    monkeypatch.setattr('app.services.notification_service.get_runtime_config', lambda _db: {'NOTIFICATION_RETRY_BACKOFF_SECONDS': 10})

    def broken(_db, _payload):
        raise RuntimeError('boom')

    monkeypatch.setattr('app.services.notification_service.deliver_notification_event', broken)

    processed = process_notification_event(db, item.id)

    assert processed.status == 'queued'
    assert processed.retry_count == 1
    assert processed.last_error == 'boom'


def test_serialize_notification_event_outputs_iso_fields():
    now = datetime.now(UTC)
    item = SimpleNamespace(
        id='notify_evt_3',
        user_id='user_1',
        kind='report_ready',
        channel='inbox',
        status='queued',
        title='hello',
        body='world',
        payload={},
        idempotency_key='report_job:job_1:user_1:report_ready:inbox',
        retry_count=0,
        max_retries=3,
        last_error=None,
        dead_lettered_at=None,
        source_kind='report_job',
        source_id='job_1',
        created_at=now,
        updated_at=now,
        scheduled_at=now,
        started_at=None,
        delivered_at=None,
    )

    payload = serialize_notification_event(item)

    assert payload['id'] == 'notify_evt_3'
    assert payload['scheduledAt'] == now.isoformat()
    assert payload['idempotencyKey'] == 'report_job:job_1:user_1:report_ready:inbox'


def test_process_notification_event_marks_dead_letter(monkeypatch):
    item = SimpleNamespace(
        id='notify_evt_4',
        status='running',
        channel='email',
        payload={'id': 'notify_evt_4', 'channel': 'email'},
        retry_count=2,
        max_retries=3,
        last_error=None,
        dead_lettered_at=None,
        updated_at=datetime.now(UTC),
        scheduled_at=datetime.now(UTC),
        delivered_at=None,
    )
    db = FakeDb(item)

    monkeypatch.setattr('app.services.notification_service.get_runtime_config', lambda _db: {'NOTIFICATION_RETRY_BACKOFF_SECONDS': 10})
    monkeypatch.setattr('app.services.notification_service.deliver_notification_event', lambda _db, _payload: (_ for _ in ()).throw(RuntimeError('boom')))

    processed = process_notification_event(db, item.id)

    assert processed.status == 'failed'
    assert processed.dead_lettered_at is not None
