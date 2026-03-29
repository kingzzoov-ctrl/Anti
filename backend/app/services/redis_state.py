from __future__ import annotations

import json
from typing import Any

from redis import Redis

from app.core.config import get_settings


def get_redis_client() -> Redis:
    settings = get_settings()
    return Redis.from_url(settings.redis_url, decode_responses=True)


def session_state_key(session_id: str) -> str:
    return f'ariadne:session:{session_id}'


def save_state(session_id: str, payload: dict[str, Any]) -> None:
    client = get_redis_client()
    client.set(session_state_key(session_id), json.dumps(payload, ensure_ascii=False), ex=60 * 60 * 24)


def load_state(session_id: str) -> dict[str, Any] | None:
    client = get_redis_client()
    raw = client.get(session_state_key(session_id))
    if not raw:
        return None
    return json.loads(raw)
