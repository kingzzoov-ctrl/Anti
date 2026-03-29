from datetime import UTC, datetime
from types import SimpleNamespace

from app.services.report_jobs import claim_next_report_job, serialize_report_job


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
    def __init__(self, job):
        self.job = job
        self.committed = False
        self.refreshed = False

    def execute(self, _statement):
        return FakeExecuteResult(self.job)

    def commit(self):
        self.committed = True

    def refresh(self, _job):
        self.refreshed = True


def test_claim_next_report_job_marks_job_running():
    job = SimpleNamespace(
        id='report_job_1',
        status='queued',
        progress=0,
        error_message=None,
        report_id=None,
        payload={'timeline': []},
        updated_at=datetime.now(UTC),
        started_at=None,
        completed_at=None,
    )
    db = FakeDb(job)

    claimed = claim_next_report_job(db)

    assert claimed is job
    assert job.status == 'running'
    assert job.progress >= 5
    assert job.started_at is not None
    assert db.committed is True
    assert db.refreshed is True
    assert job.payload['timeline'][-1]['label'] == '后台 worker 已认领任务'


def test_serialize_report_job_outputs_iso_fields():
    now = datetime.now(UTC)
    job = SimpleNamespace(
        id='report_job_2',
        user_id='user_1',
        session_id='sess_1',
        status='queued',
        progress=0,
        report_id=None,
        error_message=None,
        payload={},
        created_at=now,
        updated_at=now,
        started_at=None,
        completed_at=None,
    )

    payload = serialize_report_job(job)

    assert payload['id'] == 'report_job_2'
    assert payload['status'] == 'queued'
    assert payload['createdAt'] == now.isoformat()
