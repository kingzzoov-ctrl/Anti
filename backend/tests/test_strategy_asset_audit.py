from datetime import UTC, datetime

from app.services.storage_service import activate_strategy_asset, serialize_strategy_asset


class FakeScalarResult:
    def __init__(self, items):
        self.items = list(items)

    def first(self):
        return self.items[0] if self.items else None

    def all(self):
        return list(self.items)


class FakeDb:
    def __init__(self, target, active_items):
        self.target = target
        self.active_items = list(active_items)
        self.committed = False
        self.refreshed = False
        self.calls = 0

    def scalars(self, _statement):
        self.calls += 1
        return FakeScalarResult([self.target] if self.calls == 1 else self.active_items)

    def commit(self):
        self.committed = True

    def refresh(self, _item):
        self.refreshed = True


def test_activate_strategy_asset_records_previous_version_and_operator():
    old = type('Asset', (), {'version': 'v1', 'is_active': True, 'updated_at': None})()
    target = type('Asset', (), {
        'asset_key': 'MATCH',
        'version': 'v2',
        'is_active': False,
        'updated_at': None,
        'activated_from_version': '',
        'rollback_note': '',
        'rollback_operator': '',
        'rollback_at': None,
    })()
    db = FakeDb(target, [old])

    updated = activate_strategy_asset(db, 'MATCH', 'v2', reason='rollback-hotfix', operator='admin_1')

    assert updated.is_active is True
    assert updated.activated_from_version == 'v1'
    assert updated.rollback_note == 'rollback-hotfix'
    assert updated.rollback_operator == 'admin_1'
    assert isinstance(updated.rollback_at, datetime)
    assert old.is_active is False
    assert db.committed is True
    assert db.refreshed is True


def test_serialize_strategy_asset_contains_audit_fields():
    now = datetime.now(UTC)
    entity = type('Asset', (), {
        'id': 1,
        'asset_key': 'REPORT',
        'version': 'v3',
        'asset_type': 'prompt',
        'title': 'Report Prompt',
        'content': '...',
        'source_path': 'skills/report.skill.md',
        'is_active': True,
        'activated_from_version': 'v2',
        'rollback_note': 'manual-switch',
        'rollback_operator': 'admin_2',
        'rollback_at': now,
        'created_at': now,
        'updated_at': now,
    })()

    payload = serialize_strategy_asset(entity)

    assert payload['activatedFromVersion'] == 'v2'
    assert payload['rollbackNote'] == 'manual-switch'
    assert payload['rollbackOperator'] == 'admin_2'
    assert payload['rollbackAt'] == now.isoformat()