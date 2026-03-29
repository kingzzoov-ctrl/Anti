from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from typing import Any


def build_notification_events(*, user_id: str, kind: str, title: str, body: str, channels: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    channel_config = channels or {}
    events: list[dict[str, Any]] = []
    for channel, enabled in channel_config.items():
        normalized_enabled = enabled
        if isinstance(enabled, list):
            normalized_enabled = len(enabled) > 0
        if not normalized_enabled:
            continue
        events.append(
            {
                'id': f'notify_{user_id}_{kind}_{channel}_{int(datetime.utcnow().timestamp())}',
                'userId': user_id,
                'kind': kind,
                'channel': channel,
                'title': title,
                'body': body,
                'status': 'pending',
                'createdAt': datetime.utcnow().isoformat(),
            }
        )
    return events


def append_notifications(existing_payload: dict[str, Any] | None, events: Iterable[dict[str, Any]]) -> dict[str, Any]:
    payload = dict(existing_payload or {})
    current = list(payload.get('notifications', []))
    current.extend(list(events))
    payload['notifications'] = current[-50:]
    payload['lastNotificationAt'] = datetime.utcnow().isoformat()
    return payload
