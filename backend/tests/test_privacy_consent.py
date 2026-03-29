from datetime import datetime
from types import SimpleNamespace

from app.services.storage_service import accept_privacy_consent, serialize_privacy_consent, serialize_profile


class FakeDb:
    def __init__(self):
        self.committed = False
        self.refreshed = []

    def commit(self):
        self.committed = True

    def refresh(self, item):
        self.refreshed.append(item)


def test_accept_privacy_consent_sets_snapshot(monkeypatch):
    profile = SimpleNamespace(
        id='prof_user_1',
        user_id='user_1',
        tier='Free',
        token_balance=10,
        notification_channels={},
        matching_enabled=True,
        is_admin=False,
        privacy_consent_version=None,
        privacy_consent_scope=None,
        privacy_consent_accepted_at=None,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db = FakeDb()

    monkeypatch.setattr('app.services.storage_service.get_or_create_user_profile', lambda _db, _user_id: profile)

    updated = accept_privacy_consent(db, 'user_1', version='lab-v1', scope='lab-interview')

    assert updated.privacy_consent_version == 'lab-v1'
    assert updated.privacy_consent_scope == 'lab-interview'
    assert updated.privacy_consent_accepted_at is not None
    assert db.committed is True


def test_serialize_privacy_consent_and_profile_include_payload():
    accepted_at = datetime.utcnow()
    profile = SimpleNamespace(
        id='prof_user_1',
        user_id='user_1',
        display_name='User 1',
        tier='Free',
        token_balance=12,
        notification_channels={},
        matching_enabled=True,
        is_admin=False,
        privacy_consent_version='lab-v1',
        privacy_consent_scope='lab-interview',
        privacy_consent_accepted_at=accepted_at,
        created_at=accepted_at,
        updated_at=accepted_at,
    )

    consent = serialize_privacy_consent(profile)
    payload = serialize_profile(profile)

    assert consent['accepted'] is True
    assert consent['acceptedAt'] == accepted_at.isoformat()
    assert payload['privacyConsent']['version'] == 'lab-v1'
    assert payload['privacyConsent']['scope'] == 'lab-interview'