from app.services.notification_service import run_notification_worker_loop


class FakeDb:
    def rollback(self):
        pass

    def close(self):
        pass


class FakeSessionFactory:
    def __call__(self):
        return FakeDb()


def test_notification_worker_loop_stops_when_idle(monkeypatch):
    calls = {'claim': 0, 'process': 0}

    def fake_claim(_db):
        calls['claim'] += 1
        return None

    def fake_process(_db, _event_id):
        calls['process'] += 1

    monkeypatch.setattr('app.services.notification_service.claim_next_notification_event', fake_claim)
    monkeypatch.setattr('app.services.notification_service.process_notification_event', fake_process)

    processed = run_notification_worker_loop(FakeSessionFactory(), stop_when_idle=True, poll_interval_seconds=0)

    assert processed == 0
    assert calls['claim'] == 1
    assert calls['process'] == 0


def test_notification_worker_loop_processes_single_event(monkeypatch):
    calls = {'claim': 0, 'process': 0}

    class Event:
        id = 'evt_1'

    def fake_claim(_db):
        calls['claim'] += 1
        if calls['claim'] == 1:
            return Event()
        return None

    def fake_process(_db, _event_id):
        calls['process'] += 1

    monkeypatch.setattr('app.services.notification_service.claim_next_notification_event', fake_claim)
    monkeypatch.setattr('app.services.notification_service.process_notification_event', fake_process)

    processed = run_notification_worker_loop(FakeSessionFactory(), stop_when_idle=True, poll_interval_seconds=0)

    assert processed == 1
    assert calls['process'] == 1
