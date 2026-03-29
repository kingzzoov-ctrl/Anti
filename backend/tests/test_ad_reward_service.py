from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.services.storage_service import build_ad_reward_task_catalog, create_ad_reward_claim, serialize_ad_reward_claim


class FakeScalarResult:
    def __init__(self, items):
        self._items = items

    def all(self):
        return list(self._items)


class FakeDb:
    def __init__(self, claims=None, profile=None):
        self.claims = claims or []
        self.profile = profile
        self.added = []
        self.committed = False
        self.refreshed = []

    def scalars(self, _statement):
        return FakeScalarResult(self.claims)

    def add(self, item):
        self.added.append(item)
        self.claims.insert(0, item)

    def commit(self):
        self.committed = True

    def refresh(self, item):
        self.refreshed.append(item)


def test_build_ad_reward_task_catalog_marks_claimed_and_remaining_limit():
    claims = [SimpleNamespace(task_key='watch_ad_video')]

    items = build_ad_reward_task_catalog(claims=claims, daily_limit=3, reward_tokens=15)

    watched = next(item for item in items if item['taskKey'] == 'watch_ad_video')
    survey = next(item for item in items if item['taskKey'] == 'complete_survey')
    assert watched['alreadyClaimed'] is True
    assert watched['claimable'] is False
    assert survey['claimable'] is True
    assert survey['remainingDailyClaims'] == 2


def test_create_ad_reward_claim_grants_tokens_and_upgrades_tier(monkeypatch):
    profile = SimpleNamespace(
        id='prof_user_1',
        user_id='user_1',
        tier='Free',
        token_balance=10,
        updated_at=None,
    )
    db = FakeDb(profile=profile)

    monkeypatch.setattr('app.services.storage_service.get_or_create_user_profile', lambda _db, _user_id: profile)

    claim, updated_profile = create_ad_reward_claim(
        db,
        user_id='user_1',
        task_key='watch_ad_video',
        reward_tokens=15,
        daily_limit=3,
    )

    assert claim.task_key == 'watch_ad_video'
    assert updated_profile.token_balance == 25
    assert updated_profile.tier == 'Ad-Reward'
    assert db.committed is True


def test_create_ad_reward_claim_rejects_daily_limit(monkeypatch):
    profile = SimpleNamespace(id='prof_user_1', user_id='user_1', tier='Ad-Reward', token_balance=20, updated_at=None)
    claims = [SimpleNamespace(task_key='watch_ad_video'), SimpleNamespace(task_key='complete_survey')]
    db = FakeDb(claims=claims, profile=profile)

    monkeypatch.setattr('app.services.storage_service.get_or_create_user_profile', lambda _db, _user_id: profile)

    with pytest.raises(ValueError) as exc_info:
        create_ad_reward_claim(db, user_id='user_1', task_key='daily_checkin', reward_tokens=15, daily_limit=2)

    assert 'limit' in str(exc_info.value).lower()


def test_serialize_ad_reward_claim_outputs_iso_fields():
    now = datetime.now(UTC)
    entity = SimpleNamespace(
        id='adreward_1',
        user_id='user_1',
        task_key='watch_ad_video',
        reward_tokens=15,
        status='claimed',
        payload={'grantSource': 'ad-reward'},
        created_at=now,
        claimed_at=now,
    )

    payload = serialize_ad_reward_claim(entity)

    assert payload['id'] == 'adreward_1'
    assert payload['claimedAt'] == now.isoformat()