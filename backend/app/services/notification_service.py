from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import httpx
from sqlalchemy import select

from app.models.notification_event import NotificationEvent
from app.services.runtime_config import get_runtime_config


def _normalize_tier(value: str | None) -> str:
    tier = str(value or 'free').strip().lower()
    if tier in {'premium', 'pro', 'paid'}:
        return 'premium'
    if tier in {'ad-reward', 'ad_reward', 'reward'}:
        return 'ad-reward'
    return 'free'


def resolve_notification_channels(kind: str, profile: Any) -> dict[str, Any]:
    channels = dict(getattr(profile, 'notification_channels', {}) or {})
    tier = _normalize_tier(getattr(profile, 'tier', 'free'))
    if kind == 'weekly_digest':
        if tier == 'premium':
            return {
                'inbox': bool(channels.get('inbox', True)),
                'email': bool(channels.get('email', True)),
                'telegram': bool(channels.get('telegram', False)),
                'wechat': bool(channels.get('wechat', False)),
            }
        if tier == 'ad-reward':
            return {
                'inbox': bool(channels.get('inbox', True)),
                'email': bool(channels.get('email', True)),
            }
        return {
            'inbox': bool(channels.get('inbox', True)),
            'email': bool(channels.get('email', False)),
        }
    if kind == 'report_ready':
        if tier == 'premium':
            return {
                'inbox': bool(channels.get('inbox', True)),
                'email': bool(channels.get('email', True)),
                'telegram': bool(channels.get('telegram', False)),
                'wechat': bool(channels.get('wechat', False)),
            }
        return {
            'inbox': bool(channels.get('inbox', True)),
            'email': bool(channels.get('email', False)),
        }
    if kind == 'match_ready':
        if tier == 'premium':
            return {
                'inbox': bool(channels.get('inbox', True)),
                'email': bool(channels.get('email', True)),
                'telegram': bool(channels.get('telegram', False)),
                'wechat': bool(channels.get('wechat', False)),
            }
        if tier == 'ad-reward':
            return {
                'inbox': bool(channels.get('inbox', True)),
                'email': bool(channels.get('email', False)),
            }
        return {'inbox': bool(channels.get('inbox', True))}
    return channels


def _build_idempotency_key(event: dict[str, Any], *, source_kind: str | None, source_id: str | None) -> str:
    return ':'.join(
        [
            str(source_kind or 'notification'),
            str(source_id or event.get('id') or ''),
            str(event.get('userId') or ''),
            str(event.get('kind') or ''),
            str(event.get('channel') or ''),
        ]
    )


def build_notification_events(*, user_id: str, kind: str, title: str, body: str, channels: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    channel_config = channels or {}
    events: list[dict[str, Any]] = []
    now = datetime.now(UTC)
    for channel, enabled in channel_config.items():
        normalized_enabled = enabled
        if isinstance(enabled, list):
            normalized_enabled = len(enabled) > 0
        if not normalized_enabled:
            continue
        events.append(
            {
                'id': f'notify_{user_id}_{kind}_{channel}_{int(now.timestamp())}',
                'userId': user_id,
                'kind': kind,
                'channel': channel,
                'title': title,
                'body': body,
                'status': 'pending',
                'createdAt': now.isoformat(),
            }
        )
    return events


def _coerce_event_time(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value.astimezone(UTC) if value.tzinfo else value.replace(tzinfo=UTC)
    text = str(value or '').strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace('Z', '+00:00'))
        return parsed.astimezone(UTC) if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    except ValueError:
        return None


def _collect_inbox_digest_items(profile: Any, *, cutoff: datetime) -> list[dict[str, Any]]:
    channels = dict(getattr(profile, 'notification_channels', {}) or {})
    inbox = channels.get('inbox')
    if not isinstance(inbox, list):
        return []

    items: list[dict[str, Any]] = []
    for raw in inbox:
        if not isinstance(raw, dict):
            continue
        created_at = _coerce_event_time(raw.get('createdAt'))
        if created_at is None or created_at < cutoff:
            continue
        items.append(
            {
                'id': str(raw.get('id') or ''),
                'title': str(raw.get('title') or raw.get('kind') or '通知更新'),
                'body': str(raw.get('body') or ''),
                'channel': str(raw.get('channel') or 'inbox'),
                'kind': str(raw.get('kind') or 'generic'),
                'createdAt': created_at.isoformat(),
            }
        )
    return items


def build_weekly_digest_events_for_profile(
    profile: Any,
    *,
    queued_events: Iterable[NotificationEvent | dict[str, Any]] | None = None,
    lookback_days: int = 7,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    current = now or datetime.now(UTC)
    cutoff = current - timedelta(days=max(1, int(lookback_days or 7)))
    user_id = str(getattr(profile, 'user_id', '') or '')
    if not user_id or _normalize_tier(getattr(profile, 'tier', 'free')) != 'free':
        return []

    digest_items = _collect_inbox_digest_items(profile, cutoff=cutoff)
    for raw in queued_events or []:
        payload = serialize_notification_event(raw) if isinstance(raw, NotificationEvent) else dict(raw or {})
        created_at = _coerce_event_time(payload.get('createdAt'))
        if created_at is None or created_at < cutoff:
            continue
        digest_items.append(
            {
                'id': str(payload.get('id') or ''),
                'title': str(payload.get('title') or payload.get('kind') or '通知更新'),
                'body': str(payload.get('body') or ''),
                'channel': str(payload.get('channel') or 'inbox'),
                'kind': str(payload.get('kind') or 'generic'),
                'createdAt': created_at.isoformat(),
            }
        )

    deduped: dict[str, dict[str, Any]] = {}
    for item in digest_items:
        key = str(item.get('id') or f"{item.get('kind')}:{item.get('channel')}:{item.get('createdAt')}")
        deduped[key] = item
    sorted_items = sorted(deduped.values(), key=lambda item: str(item.get('createdAt') or ''), reverse=True)
    if not sorted_items:
        return []

    preview_lines = [
        f"- [{item['kind']}/{item['channel']}] {item['title']}"
        for item in sorted_items[:5]
    ]
    title = 'Ariadne 每周通知摘要'
    body = '\n'.join([
        f'最近 {max(1, int(lookback_days or 7))} 天共有 {len(sorted_items)} 条通知更新。',
        *preview_lines,
    ])
    channels = resolve_notification_channels('weekly_digest', profile)
    events = build_notification_events(
        user_id=user_id,
        kind='weekly_digest',
        title=title,
        body=body,
        channels=channels,
    )
    for event in events:
        event['payload'] = {
            'summaryItems': sorted_items[:10],
            'windowDays': max(1, int(lookback_days or 7)),
            'digestGeneratedAt': current.isoformat(),
        }
    return events


def build_weekly_digest_events_for_profiles(
    db: Any,
    profiles: Iterable[Any],
    *,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    runtime_config = get_runtime_config(db)
    lookback_days = int(runtime_config.get('WEEKLY_DIGEST_LOOKBACK_DAYS') or 7)
    created: list[dict[str, Any]] = []
    for profile in profiles:
        user_id = str(getattr(profile, 'user_id', '') or '')
        queued_events = list_notification_events(db, user_id=user_id, limit=50) if user_id else []
        created.extend(
            build_weekly_digest_events_for_profile(
                profile,
                queued_events=queued_events,
                lookback_days=lookback_days,
                now=now,
            )
        )
    return created


def append_notifications(existing_payload: dict[str, Any] | None, events: Iterable[dict[str, Any]]) -> dict[str, Any]:
    payload = dict(existing_payload or {})
    current = list(payload.get('notifications', []))
    current.extend(list(events))
    payload['notifications'] = current[-50:]
    payload['lastNotificationAt'] = datetime.now(UTC).isoformat()
    return payload


def enqueue_notification_events(
    db: Any,
    events: Iterable[dict[str, Any]],
    *,
    source_kind: str | None = None,
    source_id: str | None = None,
) -> list[NotificationEvent]:
    runtime_config = get_runtime_config(db)
    now = datetime.now(UTC)
    max_retries = int(runtime_config.get('NOTIFICATION_MAX_RETRIES') or 3)
    created: list[NotificationEvent] = []
    for event in events:
        idempotency_key = _build_idempotency_key(event, source_kind=source_kind, source_id=source_id)
        existing = db.scalars(select(NotificationEvent).where(NotificationEvent.idempotency_key == idempotency_key)).first()
        if existing is not None and existing.status in {'queued', 'running', 'delivered', 'skipped'}:
            created.append(existing)
            continue
        item = NotificationEvent(
            id=str(event.get('id') or f'notify_evt_{uuid4().hex[:16]}'),
            user_id=str(event.get('userId') or ''),
            kind=str(event.get('kind') or 'generic'),
            channel=str(event.get('channel') or 'inbox'),
            status='queued',
            title=str(event.get('title') or ''),
            body=str(event.get('body') or ''),
            payload=dict(event),
            idempotency_key=idempotency_key,
            retry_count=0,
            max_retries=max_retries,
            last_error=None,
            dead_lettered_at=None,
            source_kind=source_kind,
            source_id=source_id,
            created_at=now,
            updated_at=now,
            scheduled_at=now,
        )
        db.add(item)
        created.append(item)
    db.commit()
    for item in created:
        db.refresh(item)
    return created


def serialize_notification_event(item: NotificationEvent) -> dict[str, Any]:
    return {
        'id': item.id,
        'userId': item.user_id,
        'kind': item.kind,
        'channel': item.channel,
        'status': item.status,
        'title': item.title,
        'body': item.body,
        'payload': item.payload or {},
        'idempotencyKey': item.idempotency_key,
        'retryCount': item.retry_count,
        'maxRetries': item.max_retries,
        'lastError': item.last_error,
        'deadLetteredAt': item.dead_lettered_at.isoformat() if item.dead_lettered_at else None,
        'sourceKind': item.source_kind,
        'sourceId': item.source_id,
        'createdAt': item.created_at.isoformat() if item.created_at else None,
        'updatedAt': item.updated_at.isoformat() if item.updated_at else None,
        'scheduledAt': item.scheduled_at.isoformat() if item.scheduled_at else None,
        'startedAt': item.started_at.isoformat() if item.started_at else None,
        'deliveredAt': item.delivered_at.isoformat() if item.delivered_at else None,
    }


def get_notification_event(db: Any, event_id: str) -> NotificationEvent | None:
    return db.get(NotificationEvent, event_id)


def list_notification_events(
    db: Any,
    *,
    user_id: str | None = None,
    status: str | None = None,
    source_kind: str | None = None,
    limit: int = 100,
) -> list[NotificationEvent]:
    statement = select(NotificationEvent).order_by(NotificationEvent.created_at.desc())
    if user_id:
        statement = statement.where(NotificationEvent.user_id == user_id)
    if status:
        statement = statement.where(NotificationEvent.status == status)
    if source_kind:
        statement = statement.where(NotificationEvent.source_kind == source_kind)
    statement = statement.limit(limit)
    return list(db.scalars(statement).all())


def replay_notification_event(db: Any, event_id: str, *, scheduled_at: datetime | None = None) -> NotificationEvent:
    item = db.get(NotificationEvent, event_id)
    if item is None:
        raise ValueError('Notification event not found')
    now = datetime.now(UTC)
    item.status = 'queued'
    item.retry_count = 0
    item.last_error = None
    item.dead_lettered_at = None
    item.started_at = None
    item.delivered_at = None
    item.updated_at = now
    item.scheduled_at = scheduled_at or now
    db.commit()
    db.refresh(item)
    return item


def claim_next_notification_event(db: Any) -> NotificationEvent | None:
    now = datetime.now(UTC)
    statement = (
        select(NotificationEvent)
        .where(NotificationEvent.status == 'queued')
        .where(NotificationEvent.scheduled_at <= now)
        .order_by(NotificationEvent.scheduled_at.asc(), NotificationEvent.created_at.asc())
        .with_for_update(skip_locked=True)
    )
    item = db.execute(statement).scalars().first()
    if item is None:
        return None
    item.status = 'running'
    item.started_at = now
    item.updated_at = now
    db.commit()
    db.refresh(item)
    return item


def deliver_notification_event(db: Any, event: dict[str, Any]) -> dict[str, Any]:
    runtime_config = get_runtime_config(db)
    channel = str(event.get('channel') or '').strip().lower()
    if channel == 'inbox':
        return {
            **event,
            'status': 'delivered',
            'deliveredAt': datetime.now(UTC).isoformat(),
            'deliveryMeta': {'channel': 'inbox', 'mode': 'local-only'},
        }

    endpoint_map = {
        'email': str(runtime_config.get('NOTIFY_EMAIL_ENDPOINT') or ''),
        'telegram': str(runtime_config.get('NOTIFY_TELEGRAM_ENDPOINT') or ''),
        'wechat': str(runtime_config.get('NOTIFY_WECHAT_ENDPOINT') or ''),
    }
    endpoint = endpoint_map.get(channel, '')
    if not endpoint:
        return {
            **event,
            'status': 'skipped',
            'deliveryMeta': {'reason': 'missing_endpoint', 'channel': channel},
        }

    with httpx.Client(timeout=5.0) as client:
        response = client.post(endpoint, json=event)
        response.raise_for_status()

    return {
        **event,
        'status': 'delivered',
        'deliveredAt': datetime.now(UTC).isoformat(),
        'deliveryMeta': {'channel': channel, 'endpoint': endpoint},
    }


def process_notification_event(db: Any, event_id: str) -> NotificationEvent:
    item = db.get(NotificationEvent, event_id)
    if item is None:
        raise ValueError('Notification event not found')

    runtime_config = get_runtime_config(db)
    backoff_seconds = float(runtime_config.get('NOTIFICATION_RETRY_BACKOFF_SECONDS') or 30.0)
    payload = dict(item.payload or {})

    try:
        delivered = deliver_notification_event(db, payload)
        item.payload = delivered
        item.status = str(delivered.get('status') or 'delivered')
        item.last_error = None
        item.dead_lettered_at = None
        item.updated_at = datetime.now(UTC)
        if item.status in {'delivered', 'skipped'}:
            item.delivered_at = datetime.now(UTC)
        db.commit()
        db.refresh(item)
        return item
    except Exception as exc:
        item.retry_count = int(item.retry_count or 0) + 1
        item.last_error = str(exc)
        item.updated_at = datetime.now(UTC)
        item.payload = {
            **payload,
            'status': 'failed',
            'deliveryMeta': {'error': str(exc), 'channel': payload.get('channel')},
        }
        if item.retry_count >= int(item.max_retries or 0):
            item.status = 'failed'
            item.dead_lettered_at = datetime.now(UTC)
        else:
            item.status = 'queued'
            item.scheduled_at = datetime.now(UTC) + timedelta(seconds=backoff_seconds * item.retry_count)
        db.commit()
        db.refresh(item)
        return item


def dispatch_notification_events(db: Any, events: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    delivered: list[dict[str, Any]] = []
    for event in events:
        try:
            delivered.append(deliver_notification_event(db, event))
        except Exception as exc:
            delivered.append(
                {
                    **event,
                    'status': 'failed',
                    'deliveryMeta': {'error': str(exc), 'channel': event.get('channel')},
                }
            )
    return delivered


def run_notification_worker_loop(
    session_factory: Any,
    *,
    stop_when_idle: bool = False,
    max_events: int | None = None,
    poll_interval_seconds: float = 2.0,
) -> int:
    processed = 0
    while True:
        item = None
        db = session_factory()
        try:
            item = claim_next_notification_event(db)
            if item is None:
                if stop_when_idle:
                    return processed
            else:
                process_notification_event(db, item.id)
                processed += 1
                if max_events is not None and processed >= max_events:
                    return processed
        except Exception:
            db.rollback()
        finally:
            db.close()
        if stop_when_idle and item is None:
            return processed
        from time import sleep
        sleep(poll_interval_seconds)
