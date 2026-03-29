from types import SimpleNamespace

import pytest

from app.services.storage_service import assert_social_discoverable, build_social_bandwidth_snapshot, build_social_bandwidth_snapshots, serialize_profile


class FakeScalarValueDb:
    def __init__(self, scalar_value=0, execute_rows=None):
        self.scalar_value = scalar_value
        self.execute_rows = execute_rows or []

    def scalar(self, _statement):
        return self.scalar_value

    def execute(self, _statement):
        return type('ExecuteResult', (), {'all': lambda _self: list(self.execute_rows)})()


def test_build_social_bandwidth_snapshot_marks_saturated_user_hidden():
    db = FakeScalarValueDb(scalar_value=3)

    snapshot = build_social_bandwidth_snapshot(
        db,
        user_id='user_1',
        matching_enabled=True,
        active_thread_limit=3,
    )

    assert snapshot['activeThreadCount'] == 3
    assert snapshot['saturated'] is True
    assert snapshot['discoverable'] is False
    assert snapshot['status'] == 'hidden_due_to_bandwidth'


def test_build_social_bandwidth_snapshot_contains_cooling_thread_count():
    class CoolingDb(FakeScalarValueDb):
        def __init__(self):
            super().__init__(scalar_value=1)
            self.calls = 0

        def scalar(self, _statement):
            self.calls += 1
            return 1 if self.calls == 1 else 2

    db = CoolingDb()

    snapshot = build_social_bandwidth_snapshot(
        db,
        user_id='user_1',
        matching_enabled=True,
        active_thread_limit=3,
    )

    assert snapshot['activeThreadCount'] == 1
    assert snapshot['coolingThreadCount'] == 2
    assert snapshot['discoverable'] is True


def test_build_social_bandwidth_snapshots_aggregates_both_thread_sides():
    db = FakeScalarValueDb(execute_rows=[('user_a', 'user_b', 2), ('user_c', 'user_a', 1)])

    snapshots = build_social_bandwidth_snapshots(
        db,
        user_ids=['user_a', 'user_b', 'user_c'],
        matching_enabled_by_user={'user_a': True, 'user_b': True, 'user_c': False},
        active_thread_limit=3,
    )

    assert snapshots['user_a']['activeThreadCount'] == 3
    assert snapshots['user_a']['discoverable'] is False
    assert snapshots['user_b']['activeThreadCount'] == 2
    assert snapshots['user_b']['discoverable'] is True
    assert snapshots['user_c']['status'] == 'disabled'


def test_serialize_profile_contains_cooling_thread_count():
    profile = SimpleNamespace(
        id='prof_user_1',
        user_id='user_1',
        display_name='User 1',
        tier='Free',
        token_balance=12,
        notification_channels={},
        matching_enabled=True,
        is_admin=False,
        created_at=None,
        updated_at=None,
    )

    payload = serialize_profile(profile, {'activeThreadCount': 1, 'coolingThreadCount': 2, 'activeThreadLimit': 3, 'discoverable': True})

    assert payload['socialBandwidth']['coolingThreadCount'] == 2


def test_serialize_profile_contains_social_bandwidth_payload():
    profile = SimpleNamespace(
        id='prof_user_1',
        user_id='user_1',
        display_name='User 1',
        tier='Free',
        token_balance=12,
        notification_channels={},
        matching_enabled=True,
        is_admin=False,
        created_at=None,
        updated_at=None,
    )

    payload = serialize_profile(profile, {'activeThreadCount': 2, 'activeThreadLimit': 3, 'discoverable': True})

    assert payload['socialBandwidth']['activeThreadCount'] == 2
    assert payload['socialBandwidth']['activeThreadLimit'] == 3


def test_assert_social_discoverable_rejects_saturated_user():
    with pytest.raises(ValueError) as exc_info:
        assert_social_discoverable({'saturated': True, 'discoverable': False}, matching_enabled=True)

    assert 'bandwidth' in str(exc_info.value).lower()


def test_assert_social_discoverable_rejects_disabled_profile():
    with pytest.raises(ValueError) as exc_info:
        assert_social_discoverable({'saturated': False, 'discoverable': False}, matching_enabled=False)

    assert 'disabled' in str(exc_info.value).lower()