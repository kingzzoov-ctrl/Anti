from app.services.report_jobs import run_report_job_worker_loop


class FakeDb:
    def rollback(self):
        pass

    def close(self):
        pass


class FakeSessionFactory:
    def __call__(self):
        return FakeDb()


def test_worker_loop_stops_when_idle(monkeypatch):
    calls = {'claim': 0, 'process': 0}

    def fake_claim(_db):
        calls['claim'] += 1
        return None

    def fake_process(_db, _job_id):
        calls['process'] += 1

    monkeypatch.setattr('app.services.report_jobs.claim_next_report_job', fake_claim)
    monkeypatch.setattr('app.services.report_jobs.process_report_job', fake_process)

    processed = run_report_job_worker_loop(FakeSessionFactory(), stop_when_idle=True, poll_interval_seconds=0)

    assert processed == 0
    assert calls['claim'] == 1
    assert calls['process'] == 0


def test_worker_loop_processes_single_job(monkeypatch):
    calls = {'claim': 0, 'process': 0}

    class Job:
        id = 'job_1'

    def fake_claim(_db):
        calls['claim'] += 1
        if calls['claim'] == 1:
            return Job()
        return None

    def fake_process(_db, _job_id):
        calls['process'] += 1

    monkeypatch.setattr('app.services.report_jobs.claim_next_report_job', fake_claim)
    monkeypatch.setattr('app.services.report_jobs.process_report_job', fake_process)

    processed = run_report_job_worker_loop(FakeSessionFactory(), stop_when_idle=True, poll_interval_seconds=0)

    assert processed == 1
    assert calls['process'] == 1
