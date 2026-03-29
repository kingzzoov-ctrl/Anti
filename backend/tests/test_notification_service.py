from app.services.notification_service import append_notifications, build_notification_events


def test_build_notification_events_skips_disabled_channels():
    events = build_notification_events(
        user_id='user_1',
        kind='report_ready',
        title='报告完成',
        body='请查看最新报告',
        channels={
            'email': True,
            'telegram': False,
            'inbox': ['primary'],
        },
    )

    channels = {item['channel'] for item in events}
    assert channels == {'email', 'inbox'}
    assert all(item['kind'] == 'report_ready' for item in events)


def test_append_notifications_keeps_last_50_items():
    existing = {
        'notifications': [
            {'id': f'old_{index}'} for index in range(55)
        ]
    }
    payload = append_notifications(existing, [{'id': 'new_one'}])

    assert len(payload['notifications']) == 50
    assert payload['notifications'][-1]['id'] == 'new_one'
    assert 'lastNotificationAt' in payload
