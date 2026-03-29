from datetime import UTC, datetime
from types import SimpleNamespace

from app.services.storage_service import list_similar_reports


class FakeScalarResult:
    def __init__(self, items):
        self._items = items

    def all(self):
        return list(self._items)


class FakeDb:
    def __init__(self, reports=None, pgvector_items=None, raise_on_scalars=False):
        self.reports = reports or []
        self.pgvector_items = pgvector_items or []
        self.raise_on_scalars = raise_on_scalars
        self.pgvector_attempted = False

    def scalars(self, _statement):
        if not self.pgvector_attempted and self.raise_on_scalars:
            self.pgvector_attempted = True
            raise RuntimeError('pgvector unavailable')
        if not self.pgvector_attempted and self.pgvector_items:
            self.pgvector_attempted = True
            return FakeScalarResult(self.pgvector_items)
        return FakeScalarResult(self.reports)


def _report(report_id: str, user_id: str, embedding: list[float], *, public: bool = True, consistency: float = 0.9):
    return SimpleNamespace(
        id=report_id,
        user_id=user_id,
        v_embedding=embedding,
        is_public=public,
        consistency_score=consistency,
        created_at=datetime.now(UTC),
    )


def test_list_similar_reports_supports_memory_engine_ranking():
    db = FakeDb(
        reports=[
            _report('r1', 'u1', [1.0, 0.0]),
            _report('r2', 'u2', [0.8, 0.2]),
            _report('r3', 'u3', [0.0, 1.0]),
        ]
    )

    items = list_similar_reports(
        db,
        source_embedding=[1.0, 0.0],
        vector_search_engine='memory',
        exclude_user_id='self',
        exclude_report_ids=[],
        public_only=True,
        min_consistency=0.6,
        limit=2,
    )

    assert [item.id for item in items] == ['r1', 'r2']


def test_list_similar_reports_falls_back_to_memory_when_pgvector_fails():
    db = FakeDb(
        reports=[
            _report('r1', 'u1', [0.1, 0.9]),
            _report('r2', 'u2', [1.0, 0.0]),
        ],
        raise_on_scalars=True,
    )

    items = list_similar_reports(
        db,
        source_embedding=[1.0, 0.0],
        vector_search_engine='pgvector',
        limit=1,
    )

    assert [item.id for item in items] == ['r2']


def test_list_similar_reports_supports_hybrid_merge():
    pgvector_first = _report('r_pg', 'u_pg', [0.4, 0.6])
    memory_first = _report('r_mem', 'u_mem', [1.0, 0.0])
    db = FakeDb(
        reports=[memory_first, pgvector_first],
        pgvector_items=[pgvector_first],
    )

    items = list_similar_reports(
        db,
        source_embedding=[1.0, 0.0],
        vector_search_engine='hybrid',
        limit=2,
    )

    assert [item.id for item in items] == ['r_pg', 'r_mem']