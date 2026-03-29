from datetime import UTC, datetime, timedelta

from app.services.notification_service import append_notifications, build_notification_events, build_weekly_digest_events_for_profile, resolve_notification_channels


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


def test_resolve_notification_channels_supports_weekly_digest_for_free_users():
    profile = type('Profile', (), {
        'tier': 'Free',
        'notification_channels': {'inbox': True, 'email': True, 'telegram': True},
    })()

    channels = resolve_notification_channels('weekly_digest', profile)

    assert channels['inbox'] is True
    assert channels['email'] is True
    assert 'telegram' not in channels


def test_build_weekly_digest_events_for_profile_summarizes_recent_updates():
    now = datetime.now(UTC)
    profile = type('Profile', (), {
        'user_id': 'user_1',
        'tier': 'Free',
        'notification_channels': {
            'inbox': [
                {
                    'id': 'inbox_1',
                    'kind': 'report_ready',
                    'channel': 'inbox',
                    'title': '报告已生成',
                    'body': '请查看最新版本',
                    'createdAt': now.isoformat(),
                },
                {
                    'id': 'inbox_old',
                    'kind': 'match_ready',
                    'channel': 'inbox',
                    'title': '旧消息',
                    'body': 'ignore',
                    'createdAt': (now - timedelta(days=10)).isoformat(),
                },
            ],
            'email': True,
        },
    })()
    queued_events = [
        {
            'id': 'queue_1',
            'kind': 'match_ready',
            'channel': 'email',
            'title': '匹配成功',
            'body': '有新的深度匹配结果',
            'createdAt': now.isoformat(),
        }
    ]

    events = build_weekly_digest_events_for_profile(profile, queued_events=queued_events, lookback_days=7, now=now)

    assert {item['channel'] for item in events} == {'inbox', 'email'}
    assert all(item['kind'] == 'weekly_digest' for item in events)
    assert '最近 7 天共有 2 条通知更新' in events[0]['body']
    assert events[0]['payload']['summaryItems'][0]['id'] in {'inbox_1', 'queue_1'}


def test_build_weekly_digest_events_for_profile_skips_non_free_or_empty_profiles():
    now = datetime.now(UTC)
    premium = type('Profile', (), {
        'user_id': 'user_2',
        'tier': 'Premium',
        'notification_channels': {'inbox': []},
    })()
    free_empty = type('Profile', (), {
        'user_id': 'user_3',
        'tier': 'Free',
        'notification_channels': {'inbox': []},
    })()

    assert build_weekly_digest_events_for_profile(premium, queued_events=[], now=now) == []
    assert build_weekly_digest_events_for_profile(free_empty, queued_events=[], now=now) == []
