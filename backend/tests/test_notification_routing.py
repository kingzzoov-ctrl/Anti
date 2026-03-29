from types import SimpleNamespace

from app.services.notification_service import resolve_notification_channels


def test_resolve_notification_channels_for_free_match_ready():
    profile = SimpleNamespace(tier='Free', notification_channels={'inbox': True, 'email': True, 'telegram': True})

    channels = resolve_notification_channels('match_ready', profile)

    assert channels == {'inbox': True}


def test_resolve_notification_channels_for_premium_report_ready():
    profile = SimpleNamespace(tier='Premium', notification_channels={'inbox': True, 'email': True, 'telegram': True, 'wechat': False})

    channels = resolve_notification_channels('report_ready', profile)

    assert channels['inbox'] is True
    assert channels['email'] is True
    assert channels['telegram'] is True