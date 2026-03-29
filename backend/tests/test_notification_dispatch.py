from app.services.notification_service import deliver_notification_event, dispatch_notification_events


class DummyDb:
    pass


def test_deliver_notification_event_marks_inbox_delivered(monkeypatch):
    monkeypatch.setattr('app.services.notification_service.get_runtime_config', lambda _db: {})
    event = {
        'id': 'notify_1',
        'channel': 'inbox',
        'title': 'hello',
        'body': 'world',
    }

    delivered = deliver_notification_event(DummyDb(), event)

    assert delivered['status'] == 'delivered'
    assert delivered['deliveryMeta']['channel'] == 'inbox'


def test_deliver_notification_event_skips_missing_endpoint(monkeypatch):
    monkeypatch.setattr('app.services.notification_service.get_runtime_config', lambda _db: {'NOTIFY_EMAIL_ENDPOINT': ''})
    event = {
        'id': 'notify_2',
        'channel': 'email',
        'title': 'hello',
        'body': 'world',
    }

    delivered = deliver_notification_event(DummyDb(), event)

    assert delivered['status'] == 'skipped'
    assert delivered['deliveryMeta']['reason'] == 'missing_endpoint'


def test_dispatch_notification_events_handles_failures(monkeypatch):
    def broken(_db, event):
        if event['channel'] == 'email':
            raise RuntimeError('boom')
        return {**event, 'status': 'delivered'}

    monkeypatch.setattr('app.services.notification_service.deliver_notification_event', broken)
    items = dispatch_notification_events(DummyDb(), [
        {'id': '1', 'channel': 'email'},
        {'id': '2', 'channel': 'inbox'},
    ])

    assert items[0]['status'] == 'failed'
    assert items[1]['status'] == 'delivered'
