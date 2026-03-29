from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime
from math import sqrt
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.exposure_log import ExposureLog
from app.models.ad_reward_claim import AdRewardClaim
from app.models.insight_report import InsightReport
from app.models.match_record import MatchRecord
from app.models.session_state import SessionState
from app.models.social_thread import SocialThread
from app.models.strategy_asset import StrategyAsset
from app.models.system_config import SystemConfig
from app.models.user_profile import UserProfile


def _utcnow_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _report_meta(raw_content: dict[str, Any] | None) -> dict[str, Any]:
    payload = raw_content or {}
    meta = payload.get('reportMeta')
    return meta if isinstance(meta, dict) else {}


def _report_source_session_id(raw_content: dict[str, Any] | None) -> str:
    return str(_report_meta(raw_content).get('sourceSessionId') or '').strip()


def _report_lineage_id(raw_content: dict[str, Any] | None, report_id: str | None = None) -> str:
    meta = _report_meta(raw_content)
    lineage_id = str(meta.get('lineageId') or '').strip()
    if lineage_id:
        return lineage_id
    session_id = _report_source_session_id(raw_content)
    if session_id:
        return f'lineage_{session_id}'
    return str(report_id or '')


def _list_lineage_reports(db: Session, *, user_id: str | None, lineage_id: str) -> list[InsightReport]:
    reports = list_reports(db, user_id=user_id)
    return [item for item in reports if _report_lineage_id(item.raw_content, item.id) == lineage_id]


def _build_report_lineage_snapshot(db: Session, entity: InsightReport) -> dict[str, Any]:
    lineage_id = _report_lineage_id(entity.raw_content, entity.id)
    session_id = _report_source_session_id(entity.raw_content)
    lineage_reports = _list_lineage_reports(db, user_id=entity.user_id, lineage_id=lineage_id)
    sorted_reports = sorted(
        lineage_reports,
        key=lambda item: ((item.created_at or datetime.min), str(item.id)),
    )
    current_index = next((index for index, item in enumerate(sorted_reports) if item.id == entity.id), len(sorted_reports) - 1)
    latest_report = sorted_reports[-1] if sorted_reports else entity
    previous_report = sorted_reports[current_index - 1] if current_index > 0 else None
    return {
        'lineageId': lineage_id,
        'sourceSessionId': session_id or None,
        'version': current_index + 1 if current_index >= 0 else 1,
        'versionCount': len(sorted_reports) or 1,
        'isLatestVersion': latest_report.id == entity.id if latest_report else True,
        'latestReportId': latest_report.id if latest_report else entity.id,
        'previousVersionId': previous_report.id if previous_report else None,
    }


THREAD_UNLOCK_REQUIREMENTS: dict[int, int] = {0: 0, 1: 5, 2: 10, 3: 15}
THREAD_ACTIVE_STATUSES = {'active'}
THREAD_COOLDOWN_STATUSES = {'cooldown'}
THREAD_STAGE_POLICY: dict[int, dict[str, Any]] = {
    0: {
        'label': '匿名试探',
        'allowedActions': ['基础寒暄', '轻量兴趣交换', '回应节奏观察'],
        'blockedActions': ['索要联系方式', '高压追问隐私', '跳过边界确认'],
        'guidance': '先建立最小安全感，不要把匿名阶段直接推成情感承诺。',
    },
    1: {
        'label': '主题交换',
        'allowedActions': ['生活主题交换', '轻量价值观试探', '破冰问题延展'],
        'blockedActions': ['强行定义关系', '站外导流', '越界试探创伤细节'],
        'guidance': '适合从兴趣和节奏转入稳定话题，但仍应避免过快索取。',
    },
    2: {
        'label': '边界试探',
        'allowedActions': ['沟通频率协商', '边界与偏好说明', '冲突风格预判'],
        'blockedActions': ['联系方式交换', '情绪施压', '跳过风险讨论直接线下约见'],
        'guidance': '可以讨论边界与关系节奏，但尚未进入站外连接阶段。',
    },
    3: {
        'label': '深层解锁',
        'allowedActions': ['申请交换联系方式', '确认站外沟通边界', '讨论推进节奏'],
        'blockedActions': ['忽视高风险提醒', '胁迫式交换联系方式'],
        'guidance': '达到深层解锁后仍需结合风险等级与双方节奏决定是否站外连接。',
    },
}

CONTACT_EXCHANGE_PATTERNS = [
    '微信',
    'vx',
    'vx',
    'wechat',
    'qq',
    '电话',
    '手机号',
    '手机',
    '邮箱',
    'email',
    'e-mail',
    'telegram',
    'tg',
    'line',
    'whatsapp',
    'discord',
    'instagram',
    'ig',
    '联系方式',
]
OFFLINE_MEETING_PATTERNS = ['线下见面', '出来见', '见一面', '约见面', '线下约', '约会', '见面']
RELATIONSHIP_ESCALATION_PATTERNS = ['做我男朋友', '做我女朋友', '确定关系', '在一起', '官宣', '直接谈恋爱']
PRIVACY_PROBE_PATTERNS = ['家庭住址', '住哪', '住在哪里', '公司地址', '身份证', '真实姓名', '前任创伤', '童年创伤']
EMOTIONAL_PRESSURE_PATTERNS = ['必须给我', '现在就给我', '别废话', '赶紧发我', '你要是不', '立刻']


def _count_effective_thread_messages(messages: list[dict[str, Any]] | None) -> int:
    return sum(1 for item in (messages or []) if not item.get('isSystemMessage') and str(item.get('content', '')).strip())


def _normalize_message_text(value: str) -> str:
    return str(value or '').strip().lower().replace(' ', '')


def _contains_any_pattern(content: str, patterns: list[str]) -> bool:
    normalized = _normalize_message_text(content)
    if not normalized:
        return False
    return any(pattern.lower().replace(' ', '') in normalized for pattern in patterns)


def _looks_like_contact_exchange(content: str) -> bool:
    normalized = _normalize_message_text(content)
    if not normalized:
        return False
    if _contains_any_pattern(normalized, CONTACT_EXCHANGE_PATTERNS):
        return True
    return '@' in normalized or any(char.isdigit() for char in normalized) and sum(char.isdigit() for char in normalized) >= 7


def _looks_like_offline_meeting(content: str) -> bool:
    return _contains_any_pattern(content, OFFLINE_MEETING_PATTERNS)


def _looks_like_relationship_escalation(content: str) -> bool:
    return _contains_any_pattern(content, RELATIONSHIP_ESCALATION_PATTERNS)


def _looks_like_privacy_probe(content: str) -> bool:
    return _contains_any_pattern(content, PRIVACY_PROBE_PATTERNS)


def _looks_like_emotional_pressure(content: str) -> bool:
    return _contains_any_pattern(content, EMOTIONAL_PRESSURE_PATTERNS)


def _enforce_thread_message_policy(
    candidate_messages: list[dict[str, Any]],
    *,
    stage: int,
    contact_exchange_status: dict[str, Any],
) -> None:
    if not candidate_messages:
        return

    blockers = [str(item) for item in contact_exchange_status.get('blockers', []) if str(item).strip()]
    for item in candidate_messages:
        content = str(item.get('content', '')).strip()
        if not content:
            continue

        requests_contact = _looks_like_contact_exchange(content)
        requests_offline = _looks_like_offline_meeting(content)
        requests_relationship_lock = _looks_like_relationship_escalation(content)
        requests_privacy_probe = _looks_like_privacy_probe(content)
        requests_pressure = _looks_like_emotional_pressure(content)

        if stage <= 0 and requests_contact:
            raise ValueError('当前阶段禁止索要或交换联系方式')
        if stage <= 0 and requests_privacy_probe:
            raise ValueError('匿名试探阶段禁止高压追问隐私')

        if stage <= 1 and requests_relationship_lock:
            raise ValueError('当前阶段禁止强行定义关系，请继续完成主题交换')
        if stage <= 1 and requests_contact:
            raise ValueError('当前阶段禁止站外导流或交换联系方式')
        if stage <= 1 and requests_privacy_probe:
            raise ValueError('当前阶段禁止越界试探创伤或隐私细节')

        if stage == 2 and requests_contact:
            raise ValueError('边界试探阶段暂不允许交换联系方式')
        if stage == 2 and requests_offline:
            raise ValueError('当前阶段需先完成风险讨论，暂不支持直接线下约见')
        if stage == 2 and requests_pressure:
            raise ValueError('边界试探阶段禁止情绪施压')

        if stage >= 3 and requests_contact and not bool(contact_exchange_status.get('allowed')):
            detail = blockers[0] if blockers else str(contact_exchange_status.get('reason') or '当前仍不满足联系方式交换条件')
            raise ValueError(f'当前仍不允许交换联系方式：{detail}')
        if stage >= 3 and requests_pressure and requests_contact:
            raise ValueError('深层解锁后也禁止胁迫式交换联系方式')


def _derive_unlock_stage(message_count: int) -> int:
    stage = 0
    for candidate_stage, required_count in THREAD_UNLOCK_REQUIREMENTS.items():
        if message_count >= required_count:
            stage = candidate_stage
    return min(3, stage)


def _build_unlock_milestones(
    stage: int,
    *,
    message_count: int,
    source: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    defaults = {
        0: ('匿名试探', '建立连接后立即可用'),
        1: ('主题交换', '累计 5 条有效消息，开放稳定话题交换'),
        2: ('边界试探', '累计 10 条有效消息，允许讨论边界与关系节奏'),
        3: ('深层解锁', '累计 15 条有效消息，允许申请交换联系方式'),
    }
    source_map = {int(item.get('stage', -1)): item for item in (source or [])}
    items: list[dict[str, Any]] = []
    for milestone_stage in range(4):
        required_count = THREAD_UNLOCK_REQUIREMENTS[milestone_stage]
        remaining = max(0, required_count - message_count)
        base = {
            'stage': milestone_stage,
            'label': defaults[milestone_stage][0],
            'requirement': defaults[milestone_stage][1],
            'requiredMessageCount': required_count,
            'remainingMessageCount': remaining,
            'unlocked': stage >= milestone_stage,
        }
        items.append({**base, **source_map.get(milestone_stage, {}), 'unlocked': stage >= milestone_stage, 'remainingMessageCount': remaining})
    return items


def _build_tension_handbook(tension_report: dict[str, Any] | None) -> dict[str, Any]:
    report = tension_report or {}
    zones = report.get('tensionZones') if isinstance(report.get('tensionZones'), list) else []
    top_zones = sorted(
        [item for item in zones if isinstance(item, dict)],
        key=lambda item: float(item.get('severity', 0) or 0),
        reverse=True,
    )[:3]
    warnings = [str(item.get('description', '')).strip() for item in top_zones if str(item.get('description', '')).strip()]
    critical_warning = report.get('criticalWarning')
    if critical_warning:
        warnings.insert(0, str(critical_warning))
    return {
        'title': '双人火药桶说明书',
        'summary': str(report.get('summary', '') or '当前关系火药桶说明书尚在生成中。'),
        'criticalWarning': str(critical_warning) if critical_warning else None,
        'guidance': [str(item) for item in report.get('guidance', [])] if isinstance(report.get('guidance'), list) else [],
        'hotspots': top_zones,
        'warnings': warnings,
    }


def _build_stage_policy(stage: int) -> dict[str, Any]:
    policy = THREAD_STAGE_POLICY.get(stage, THREAD_STAGE_POLICY[0])
    return {
        'stage': stage,
        'label': policy['label'],
        'allowedActions': list(policy['allowedActions']),
        'blockedActions': list(policy['blockedActions']),
        'guidance': policy['guidance'],
    }


def _build_contact_exchange_status(*, stage: int, message_count: int, tension_report: dict[str, Any] | None) -> dict[str, Any]:
    required_count = THREAD_UNLOCK_REQUIREMENTS[3]
    remaining = max(0, required_count - message_count)
    blockers: list[str] = []
    critical_warning = None
    relationship_fit_label = None
    relationship_fit_score = 0.0
    severe_zone_count = 0
    max_severity = 0.0
    if isinstance(tension_report, dict):
        value = tension_report.get('criticalWarning')
        critical_warning = str(value) if value else None
        relationship_fit = tension_report.get('relationshipFit')
        if isinstance(relationship_fit, dict):
            relationship_fit_label = str(relationship_fit.get('label') or '') or None
            relationship_fit_score = float(relationship_fit.get('score', 0) or 0)
        zones = tension_report.get('tensionZones') if isinstance(tension_report.get('tensionZones'), list) else []
        severities = [float(item.get('severity', 0) or 0) for item in zones if isinstance(item, dict)]
        severe_zone_count = sum(1 for item in severities if item >= 8)
        max_severity = max(severities, default=0.0)

    if stage < 3 or remaining > 0:
        blockers.append('未达到深层解锁消息门槛')
    if critical_warning:
        blockers.append('存在关键风险提醒')
    if relationship_fit_score and relationship_fit_score < 62:
        blockers.append('匹配质量仍偏低')
    if severe_zone_count >= 2 or max_severity >= 9:
        blockers.append('高危张力点过多')

    allowed = not blockers
    if allowed:
        reason = '已满足交换联系方式门槛，建议先确认站外沟通边界。'
    elif critical_warning:
        reason = '存在高风险提醒，建议继续在站内验证边界与稳定性。'
    elif relationship_fit_score and relationship_fit_score < 62:
        reason = '当前匹配质量仍偏低，建议继续观察互动稳定性。'
    else:
        reason = '需完成深层解锁并通过风险校验后方可交换联系方式'
    return {
        'allowed': allowed,
        'requiredStage': 3,
        'requiredMessageCount': required_count,
        'remainingMessageCount': remaining,
        'criticalWarning': critical_warning,
        'relationshipFitLabel': relationship_fit_label,
        'relationshipFitScore': relationship_fit_score,
        'severeZoneCount': severe_zone_count,
        'blockers': blockers,
        'reason': reason,
    }


def _build_unlock_state(*, stage: int, message_count: int) -> dict[str, Any]:
    next_stage = min(3, stage + 1)
    next_required = THREAD_UNLOCK_REQUIREMENTS.get(next_stage, THREAD_UNLOCK_REQUIREMENTS[3])
    return {
        'effectiveMessageCount': message_count,
        'currentStage': stage,
        'nextStage': None if stage >= 3 else next_stage,
        'nextStageRequiredMessageCount': None if stage >= 3 else next_required,
        'remainingMessageCount': 0 if stage >= 3 else max(0, next_required - message_count),
        'isFullyUnlocked': stage >= 3,
    }


def _parse_optional_datetime(value: str | datetime | None) -> datetime | None:
    if value is None or value == '':
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).replace(tzinfo=None)
    except ValueError:
        return None


def _normalize_thread_status(status: str | None, cooldown_until: datetime | None) -> str:
    normalized = str(status or 'active').strip().lower()
    if normalized in {'closed', 'archived'}:
        return 'closed'
    if normalized in {'cooldown', 'cooling', 'paused'}:
        if cooldown_until and cooldown_until > _utcnow_naive():
            return 'cooldown'
        return 'active'
    return 'active'


def _build_thread_governance_state(*, status: str, cooldown_until: datetime | None, closed_at: datetime | None, governance_note: str | None) -> dict[str, Any]:
    now = _utcnow_naive()
    normalized_status = _normalize_thread_status(status, cooldown_until)
    is_cooling = normalized_status == 'cooldown' and cooldown_until is not None and cooldown_until > now
    is_closed = normalized_status == 'closed'
    if is_closed:
        label = '已关闭'
        reason = '该线程已退出深度社交通道，不再占用匹配带宽。'
    elif is_cooling:
        label = '冷却中'
        reason = '该线程处于冷却态，暂不允许继续发送消息，但已释放 discover 带宽。'
    else:
        label = '活跃中'
        reason = '该线程仍占用深度社交通道名额。'
    return {
        'status': normalized_status,
        'label': label,
        'isActive': normalized_status == 'active',
        'isCoolingDown': is_cooling,
        'isClosed': is_closed,
        'cooldownUntil': cooldown_until.isoformat() if cooldown_until else None,
        'closedAt': closed_at.isoformat() if closed_at else None,
        'governanceNote': str(governance_note or '').strip() or None,
        'reason': reason,
    }


def _build_unlock_system_message(stage: int) -> dict[str, Any]:
    milestone = _build_unlock_milestones(stage, message_count=THREAD_UNLOCK_REQUIREMENTS.get(stage, 0))
    milestone_label = next((item['label'] for item in milestone if item['stage'] == stage), f'阶段 {stage}')
    return {
        'id': f'sys_unlock_{stage}_{int(_utcnow_naive().timestamp() * 1000)}',
        'senderId': 'system',
        'content': f'🔓 {milestone_label} 已解锁 — 可进入更深一层的关系试探',
        'timestamp': _utcnow_naive().isoformat(),
        'isSystemMessage': True,
    }


def _sanitize_thread_messages(
    messages: list[dict[str, Any]] | None,
    *,
    participant_ids: set[str],
    existing_messages: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    existing = list(existing_messages or [])
    incoming = list(messages or [])
    base_count = len(existing)
    if existing and len(incoming) >= base_count:
        if incoming[:base_count] != existing:
            raise ValueError('Thread messages must be appended without rewriting history')
        candidate_items = incoming[base_count:]
    elif existing and incoming:
        raise ValueError('Thread messages must be appended without truncating history')
    else:
        candidate_items = incoming
    sanitized: list[dict[str, Any]] = []
    for item in candidate_items:
        if not isinstance(item, dict):
            continue
        if item.get('isSystemMessage'):
            continue
        sender_id = str(item.get('senderId', '')).strip()
        content = str(item.get('content', '')).strip()
        if sender_id not in participant_ids or not content:
            continue
        sanitized.append(
            {
                'id': str(item.get('id') or f'msg_{sender_id}_{int(_utcnow_naive().timestamp() * 1000)}'),
                'senderId': sender_id,
                'content': content,
                'timestamp': str(item.get('timestamp') or _utcnow_naive().isoformat()),
            }
        )
    return existing + sanitized, sanitized


def upsert_system_config(db: Session, key: str, value: str, value_type: str = 'string') -> SystemConfig:
    entity = db.get(SystemConfig, key)
    if entity is None:
        entity = SystemConfig(key=key, value=value, type=value_type)
        db.add(entity)
    else:
        entity.value = value
        entity.type = value_type
    db.commit()
    db.refresh(entity)
    return entity


def update_system_config(db: Session, key: str, value: str, value_type: str | None = None) -> SystemConfig | None:
    entity = db.get(SystemConfig, key)
    if entity is None:
        return None
    entity.value = value
    if value_type is not None:
        entity.type = value_type
    db.commit()
    db.refresh(entity)
    return entity


def list_system_configs(db: Session) -> list[SystemConfig]:
    return list(db.scalars(select(SystemConfig).order_by(SystemConfig.key)).all())


def upsert_strategy_asset(
    db: Session,
    *,
    asset_key: str,
    version: str,
    asset_type: str,
    title: str,
    content: str,
    source_path: str,
    is_active: bool,
) -> StrategyAsset:
    query = select(StrategyAsset).where(StrategyAsset.asset_key == asset_key, StrategyAsset.version == version)
    entity = db.scalars(query).first()
    now = _utcnow_naive()
    if is_active:
        active_items = db.scalars(select(StrategyAsset).where(StrategyAsset.asset_key == asset_key, StrategyAsset.is_active.is_(True))).all()
        for item in active_items:
            item.is_active = False
            item.updated_at = now

    if entity is None:
        entity = StrategyAsset(
            asset_key=asset_key,
            version=version,
            asset_type=asset_type,
            title=title,
            content=content,
            source_path=source_path,
            is_active=is_active,
            created_at=now,
            updated_at=now,
        )
        db.add(entity)
    else:
        entity.asset_type = asset_type
        entity.title = title
        entity.content = content
        entity.source_path = source_path
        entity.is_active = is_active
        entity.updated_at = now
    db.commit()
    db.refresh(entity)
    return entity


AD_REWARD_TASK_CATALOG: list[dict[str, Any]] = [
    {
        'taskKey': 'watch_ad_video',
        'title': '观看激励视频',
        'description': '完成一次激励视频观看后领取 Token。',
    },
    {
        'taskKey': 'complete_survey',
        'title': '完成简短问卷',
        'description': '完成一份平台问卷后领取 Token。',
    },
    {
        'taskKey': 'daily_checkin',
        'title': '每日签到',
        'description': '完成每日签到后领取 Token。',
    },
]


def list_ad_reward_claims(db: Session, *, user_id: str | None = None) -> list[AdRewardClaim]:
    query = select(AdRewardClaim).order_by(AdRewardClaim.claimed_at.desc())
    if user_id:
        query = query.where(AdRewardClaim.user_id == user_id)
    return list(db.scalars(query).all())


def serialize_ad_reward_claim(entity: AdRewardClaim) -> dict[str, Any]:
    return {
        'id': entity.id,
        'userId': entity.user_id,
        'taskKey': entity.task_key,
        'rewardTokens': int(entity.reward_tokens or 0),
        'status': entity.status,
        'payload': entity.payload or {},
        'createdAt': entity.created_at.isoformat() if entity.created_at else None,
        'claimedAt': entity.claimed_at.isoformat() if entity.claimed_at else None,
    }


def build_ad_reward_task_catalog(
    *,
    claims: list[AdRewardClaim],
    daily_limit: int,
    reward_tokens: int,
) -> list[dict[str, Any]]:
    normalized_limit = max(1, int(daily_limit or 1))
    remaining = max(0, normalized_limit - len(claims))
    claimed_keys = {str(item.task_key) for item in claims}
    items: list[dict[str, Any]] = []
    for task in AD_REWARD_TASK_CATALOG:
        already_claimed = task['taskKey'] in claimed_keys
        items.append(
            {
                **task,
                'rewardTokens': int(reward_tokens or 0),
                'alreadyClaimed': already_claimed,
                'claimable': (not already_claimed) and remaining > 0,
                'remainingDailyClaims': remaining,
            }
        )
    return items


def create_ad_reward_claim(
    db: Session,
    *,
    user_id: str,
    task_key: str,
    reward_tokens: int,
    daily_limit: int,
) -> tuple[AdRewardClaim, UserProfile]:
    normalized_task_key = str(task_key or '').strip()
    if normalized_task_key not in {item['taskKey'] for item in AD_REWARD_TASK_CATALOG}:
        raise ValueError('Unknown ad reward task')

    current_claims = list_ad_reward_claims(db, user_id=user_id)
    if len(current_claims) >= max(1, int(daily_limit or 1)):
        raise ValueError('Ad reward daily limit reached')
    if any(str(item.task_key) == normalized_task_key for item in current_claims):
        raise ValueError('Ad reward task already claimed today')

    now = _utcnow_naive()
    claim = AdRewardClaim(
        id=f'adreward_{user_id}_{normalized_task_key}_{int(now.timestamp())}',
        user_id=user_id,
        task_key=normalized_task_key,
        reward_tokens=int(reward_tokens or 0),
        status='claimed',
        payload={'grantSource': 'ad-reward', 'grantedAt': now.isoformat()},
        created_at=now,
        claimed_at=now,
    )
    db.add(claim)

    profile = get_or_create_user_profile(db, user_id)
    profile.token_balance = float(profile.token_balance or 0) + float(reward_tokens or 0)
    if str(profile.tier or '').strip().lower() == 'free':
        profile.tier = 'Ad-Reward'
    profile.updated_at = now
    db.commit()
    db.refresh(claim)
    db.refresh(profile)
    return claim, profile


def list_strategy_assets(db: Session, asset_key: str | None = None) -> list[StrategyAsset]:
    query = select(StrategyAsset)
    if asset_key:
        query = query.where(StrategyAsset.asset_key == asset_key)
    query = query.order_by(StrategyAsset.asset_key.asc(), StrategyAsset.created_at.desc())
    return list(db.scalars(query).all())


def get_active_strategy_asset(db: Session, asset_key: str) -> StrategyAsset | None:
    query = (
        select(StrategyAsset)
        .where(StrategyAsset.asset_key == asset_key, StrategyAsset.is_active.is_(True))
        .order_by(StrategyAsset.updated_at.desc())
    )
    return db.scalars(query).first()


def activate_strategy_asset(db: Session, asset_key: str, version: str, *, reason: str = 'admin-console-manual-switch', operator: str | None = None) -> StrategyAsset | None:
    entity = db.scalars(select(StrategyAsset).where(StrategyAsset.asset_key == asset_key, StrategyAsset.version == version)).first()
    if entity is None:
        return None

    now = _utcnow_naive()
    active_items = db.scalars(select(StrategyAsset).where(StrategyAsset.asset_key == asset_key, StrategyAsset.is_active.is_(True))).all()
    previous_version = ''
    for item in active_items:
        previous_version = previous_version or str(item.version or '')
        item.is_active = False
        item.updated_at = now

    entity.is_active = True
    entity.activated_from_version = previous_version
    entity.rollback_note = str(reason or 'admin-console-manual-switch')
    entity.rollback_operator = str(operator or '').strip()
    entity.rollback_at = now
    entity.updated_at = now
    db.commit()
    db.refresh(entity)
    return entity


def get_or_create_user_profile(db: Session, user_id: str) -> UserProfile:
    query = select(UserProfile).where(UserProfile.user_id == user_id)
    entity = db.scalars(query).first()
    if entity is None:
        entity = UserProfile(
            id=f'prof_{user_id}',
            user_id=user_id,
            tier='Free',
            token_balance=0,
            notification_channels={'email': False, 'sms': False, 'wechat': False},
            matching_enabled=True,
            is_admin=False,
        )
        db.add(entity)
        db.commit()
        db.refresh(entity)
    return entity


def list_user_profiles(db: Session) -> list[UserProfile]:
    query = select(UserProfile).order_by(UserProfile.created_at.desc())
    return list(db.scalars(query).all())


def update_user_profile(db: Session, profile_id: str, data: dict[str, Any]) -> UserProfile | None:
    entity = db.get(UserProfile, profile_id)
    if entity is None:
        return None

    field_map = {
        'displayName': 'display_name',
        'tier': 'tier',
        'tokenBalance': 'token_balance',
        'notificationChannels': 'notification_channels',
        'matchingEnabled': 'matching_enabled',
        'isAdmin': 'is_admin',
        'updatedAt': 'updated_at',
    }
    for key, value in data.items():
        attr = field_map.get(key)
        if not attr:
          continue
        if attr in {'matching_enabled', 'is_admin'}:
            setattr(entity, attr, bool(value))
        elif attr == 'token_balance':
            setattr(entity, attr, float(value))
        elif attr == 'updated_at':
            setattr(entity, attr, _utcnow_naive())
        else:
            setattr(entity, attr, value)
    db.commit()
    db.refresh(entity)
    return entity


def serialize_privacy_consent(entity: UserProfile) -> dict[str, Any]:
    accepted_at_value = getattr(entity, 'privacy_consent_accepted_at', None)
    accepted_at = accepted_at_value.isoformat() if accepted_at_value else None
    return {
        'accepted': bool(accepted_at_value),
        'acceptedAt': accepted_at,
        'version': getattr(entity, 'privacy_consent_version', None),
        'scope': getattr(entity, 'privacy_consent_scope', None),
    }


def accept_privacy_consent(db: Session, user_id: str, *, version: str, scope: str) -> UserProfile:
    entity = get_or_create_user_profile(db, user_id)
    now = _utcnow_naive()
    entity.privacy_consent_version = str(version or 'lab-v1')
    entity.privacy_consent_scope = str(scope or 'lab-interview')
    entity.privacy_consent_accepted_at = entity.privacy_consent_accepted_at or now
    entity.updated_at = now
    db.commit()
    db.refresh(entity)
    return entity


def consume_user_tokens(db: Session, user_id: str, amount: float) -> tuple[bool, UserProfile, float]:
    profile = get_or_create_user_profile(db, user_id)
    current_balance = float(profile.token_balance or 0)
    if current_balance < amount:
        return False, profile, current_balance

    profile.token_balance = current_balance - amount
    profile.updated_at = _utcnow_naive()
    db.commit()
    db.refresh(profile)
    return True, profile, float(profile.token_balance or 0)


def set_user_token_balance(db: Session, user_id: str, amount: float) -> UserProfile:
    profile = get_or_create_user_profile(db, user_id)
    profile.token_balance = float(amount)
    profile.updated_at = _utcnow_naive()
    db.commit()
    db.refresh(profile)
    return profile


def save_session_state(db: Session, session_id: str, user_id: str, status: str, current_stage: str, turn_count: int, max_turns: int, payload: dict[str, Any]) -> SessionState:
    entity = db.get(SessionState, session_id)
    now = _utcnow_naive()
    if entity is None:
        entity = SessionState(
            id=session_id,
            user_id=user_id,
            status=status,
            current_stage=current_stage,
            turn_count=turn_count,
            max_turns=max_turns,
            payload=payload,
            created_at=now,
            updated_at=now,
        )
        db.add(entity)
    else:
        entity.status = status
        entity.current_stage = current_stage
        entity.turn_count = turn_count
        entity.max_turns = max_turns
        entity.payload = payload
        entity.updated_at = now
    db.commit()
    db.refresh(entity)
    return entity


def get_session_state(db: Session, session_id: str) -> SessionState | None:
    return db.get(SessionState, session_id)


def get_report(db: Session, report_id: str) -> InsightReport | None:
    return db.get(InsightReport, report_id)


def get_social_thread(db: Session, thread_id: str) -> SocialThread | None:
    return db.get(SocialThread, thread_id)


def get_match_record(db: Session, match_id: str) -> MatchRecord | None:
    return db.get(MatchRecord, match_id)


def list_session_states(db: Session, user_id: str) -> list[SessionState]:
    query = select(SessionState).where(SessionState.user_id == user_id).order_by(SessionState.updated_at.desc())
    return list(db.scalars(query).all())


def list_all_session_states(db: Session) -> list[SessionState]:
    query = select(SessionState).order_by(SessionState.updated_at.desc())
    return list(db.scalars(query).all())


def save_report(db: Session, report: dict[str, Any]) -> InsightReport:
    raw_content = dict(report.get('rawContent') or {})
    report_meta = dict(_report_meta(raw_content))
    source_session_id = str(report_meta.get('sourceSessionId') or '').strip()
    lineage_id = str(report_meta.get('lineageId') or '').strip() or (f'lineage_{source_session_id}' if source_session_id else report['id'])
    report_meta['lineageId'] = lineage_id
    raw_content['reportMeta'] = report_meta

    entity = InsightReport(
        id=report['id'],
        user_id=report['userId'],
        raw_content=raw_content,
        v_feature=list((report.get('vFeature') or {}).values()) or None,
        v_embedding=report.get('vEmbedding') or None,
        consistency_score=float(report.get('consistencyScore', 0)),
        is_public=bool(report.get('isPublic', False)),
        created_at=_utcnow_naive(),
    )
    db.merge(entity)
    db.commit()
    db.refresh(entity)
    return entity


def list_reports(db: Session, user_id: str | None = None, public_only: bool = False) -> list[InsightReport]:
    query = select(InsightReport)
    if user_id:
        query = query.where(InsightReport.user_id == user_id)
    if public_only:
        query = query.where(InsightReport.is_public.is_(True))
    query = query.order_by(InsightReport.created_at.desc())
    return list(db.scalars(query).all())


def _normalize_vector_search_engine(value: str | None) -> str:
    engine = str(value or 'pgvector').strip().lower()
    if engine in {'memory', 'in-memory', 'python'}:
        return 'memory'
    if engine in {'hybrid', 'mixed'}:
        return 'hybrid'
    return 'pgvector'


def _cosine_similarity(source: list[float], target: list[float]) -> float:
    size = min(len(source), len(target))
    if size <= 0:
        return 0.0
    dot = sum(float(source[index] or 0) * float(target[index] or 0) for index in range(size))
    source_norm = sqrt(sum(float(source[index] or 0) ** 2 for index in range(size)))
    target_norm = sqrt(sum(float(target[index] or 0) ** 2 for index in range(size)))
    if source_norm == 0 or target_norm == 0:
        return 0.0
    return dot / (source_norm * target_norm)


def _filter_similarity_candidates(
    reports: list[InsightReport],
    *,
    exclude_user_id: str | None,
    exclude_report_ids: list[str] | None,
    public_only: bool,
    min_consistency: float | None,
) -> list[InsightReport]:
    excluded_report_ids = set(exclude_report_ids or [])
    items: list[InsightReport] = []
    for item in reports:
        if public_only and not bool(item.is_public):
            continue
        if exclude_user_id and item.user_id == exclude_user_id:
            continue
        if excluded_report_ids and item.id in excluded_report_ids:
            continue
        if min_consistency is not None and float(item.consistency_score or 0) < float(min_consistency):
            continue
        items.append(item)
    return items


def _list_similar_reports_memory(
    db: Session,
    *,
    source_embedding: list[float],
    exclude_user_id: str | None,
    exclude_report_ids: list[str] | None,
    public_only: bool,
    min_consistency: float | None,
    limit: int,
) -> list[InsightReport]:
    candidates = _filter_similarity_candidates(
        list_reports(db, public_only=public_only),
        exclude_user_id=exclude_user_id,
        exclude_report_ids=exclude_report_ids,
        public_only=public_only,
        min_consistency=min_consistency,
    )
    ranked = sorted(
        [item for item in candidates if item.v_embedding],
        key=lambda item: _cosine_similarity(source_embedding, [float(value or 0) for value in (item.v_embedding or [])]),
        reverse=True,
    )
    return ranked[:limit]


def list_similar_reports(
    db: Session,
    *,
    source_embedding: list[float] | None,
    vector_search_engine: str = 'pgvector',
    exclude_user_id: str | None = None,
    exclude_report_ids: list[str] | None = None,
    public_only: bool = True,
    min_consistency: float | None = None,
    limit: int = 24,
) -> list[InsightReport]:
    normalized_embedding = [float(item or 0) for item in (source_embedding or [])]
    if not normalized_embedding:
        return []

    normalized_engine = _normalize_vector_search_engine(vector_search_engine)

    if normalized_engine == 'memory':
        return _list_similar_reports_memory(
            db,
            source_embedding=normalized_embedding,
            exclude_user_id=exclude_user_id,
            exclude_report_ids=exclude_report_ids,
            public_only=public_only,
            min_consistency=min_consistency,
            limit=limit,
        )

    query = select(InsightReport).where(InsightReport.v_embedding.is_not(None))
    if public_only:
        query = query.where(InsightReport.is_public.is_(True))
    if exclude_user_id:
        query = query.where(InsightReport.user_id != exclude_user_id)
    if exclude_report_ids:
        query = query.where(InsightReport.id.not_in(exclude_report_ids))
    if min_consistency is not None:
        query = query.where(InsightReport.consistency_score >= min_consistency)
    try:
        query = query.order_by(InsightReport.v_embedding.cosine_distance(normalized_embedding)).limit(limit)
        pgvector_items = list(db.scalars(query).all())
    except Exception:
        if normalized_engine == 'pgvector':
            return _list_similar_reports_memory(
                db,
                source_embedding=normalized_embedding,
                exclude_user_id=exclude_user_id,
                exclude_report_ids=exclude_report_ids,
                public_only=public_only,
                min_consistency=min_consistency,
                limit=limit,
            )
        pgvector_items = []

    if normalized_engine == 'hybrid':
        memory_items = _list_similar_reports_memory(
            db,
            source_embedding=normalized_embedding,
            exclude_user_id=exclude_user_id,
            exclude_report_ids=exclude_report_ids,
            public_only=public_only,
            min_consistency=min_consistency,
            limit=limit * 2,
        )
        merged: list[InsightReport] = []
        seen_ids: set[str] = set()
        for item in [*pgvector_items, *memory_items]:
            if item.id in seen_ids:
                continue
            seen_ids.add(item.id)
            merged.append(item)
        return merged[:limit]

    return pgvector_items


def get_daily_exposure_counts(
    db: Session,
    *,
    user_ids: list[str],
    date: str | None = None,
    channel: str | None = None,
    action: str | None = None,
) -> dict[str, int]:
    if not user_ids:
        return {}

    target_date = date or _utcnow_naive().date().isoformat()
    query = (
        select(ExposureLog.user_id, func.count(ExposureLog.id))
        .where(ExposureLog.user_id.in_(user_ids))
        .where(func.date(ExposureLog.created_at) == target_date)
        .group_by(ExposureLog.user_id)
    )
    if channel:
        query = query.where(ExposureLog.channel == channel)
    if action:
        query = query.where(ExposureLog.action == action)

    rows = db.execute(query).all()
    return {str(user_id): int(count or 0) for user_id, count in rows}


def create_exposure_logs(
    db: Session,
    *,
    user_ids: list[str],
    report_ids: list[str],
    channel: str,
    action: str,
) -> None:
    records = [
        ExposureLog(user_id=user_id, report_id=report_id, channel=channel, action=action)
        for user_id, report_id in zip(user_ids, report_ids, strict=False)
    ]
    if not records:
        return
    db.add_all(records)
    db.commit()


def list_social_threads(db: Session, user_id: str) -> list[SocialThread]:
    query = (
        select(SocialThread)
        .where((SocialThread.user_id_a == user_id) | (SocialThread.user_id_b == user_id))
        .order_by(SocialThread.updated_at.desc())
    )
    return list(db.scalars(query).all())


def count_active_social_threads(db: Session, user_id: str) -> int:
    query = select(func.count(SocialThread.id)).where(
        ((SocialThread.user_id_a == user_id) | (SocialThread.user_id_b == user_id))
        & (SocialThread.status.in_(tuple(THREAD_ACTIVE_STATUSES)))
    )
    return int(db.scalar(query) or 0)


def count_cooling_social_threads(db: Session, user_id: str) -> int:
    query = select(func.count(SocialThread.id)).where(
        ((SocialThread.user_id_a == user_id) | (SocialThread.user_id_b == user_id))
        & (SocialThread.status.in_(tuple(THREAD_COOLDOWN_STATUSES)))
    )
    return int(db.scalar(query) or 0)


def build_social_bandwidth_snapshot(
    db: Session,
    *,
    user_id: str,
    matching_enabled: bool,
    active_thread_limit: int,
) -> dict[str, Any]:
    normalized_limit = max(1, int(active_thread_limit or 1))
    active_thread_count = count_active_social_threads(db, user_id)
    cooling_thread_count = count_cooling_social_threads(db, user_id)
    saturated = active_thread_count >= normalized_limit
    discoverable = bool(matching_enabled) and not saturated
    return {
        'activeThreadCount': active_thread_count,
        'coolingThreadCount': cooling_thread_count,
        'activeThreadLimit': normalized_limit,
        'remainingSlots': max(0, normalized_limit - active_thread_count),
        'saturated': saturated,
        'discoverable': discoverable,
        'status': 'hidden_due_to_bandwidth' if bool(matching_enabled) and saturated else ('disabled' if not bool(matching_enabled) else 'available'),
    }


def build_social_bandwidth_snapshots(
    db: Session,
    *,
    user_ids: list[str],
    matching_enabled_by_user: dict[str, bool],
    active_thread_limit: int,
) -> dict[str, dict[str, Any]]:
    unique_user_ids = [item for item in dict.fromkeys(user_ids) if str(item).strip()]
    if not unique_user_ids:
        return {}

    normalized_limit = max(1, int(active_thread_limit or 1))
    query = (
        select(SocialThread.user_id_a, SocialThread.user_id_b, func.count(SocialThread.id))
        .where((SocialThread.user_id_a.in_(unique_user_ids)) | (SocialThread.user_id_b.in_(unique_user_ids)))
        .group_by(SocialThread.user_id_a, SocialThread.user_id_b)
    )
    rows = db.execute(query).all()
    counts = {user_id: 0 for user_id in unique_user_ids}
    cooling_counts = {user_id: 0 for user_id in unique_user_ids}
    for user_id_a, user_id_b, count in rows:
        current_count = int(count or 0)
        if user_id_a in counts:
            counts[str(user_id_a)] += current_count
        if user_id_b in counts and user_id_b != user_id_a:
            counts[str(user_id_b)] += current_count

    cooldown_rows = db.execute(
        select(SocialThread.user_id_a, SocialThread.user_id_b, func.count(SocialThread.id))
        .where(((SocialThread.user_id_a.in_(unique_user_ids)) | (SocialThread.user_id_b.in_(unique_user_ids))) & (SocialThread.status.in_(tuple(THREAD_COOLDOWN_STATUSES))))
        .group_by(SocialThread.user_id_a, SocialThread.user_id_b)
    ).all()
    for user_id_a, user_id_b, count in cooldown_rows:
        current_count = int(count or 0)
        if user_id_a in cooling_counts:
            cooling_counts[str(user_id_a)] += current_count
        if user_id_b in cooling_counts and user_id_b != user_id_a:
            cooling_counts[str(user_id_b)] += current_count

    snapshots: dict[str, dict[str, Any]] = {}
    for user_id in unique_user_ids:
        matching_enabled = bool(matching_enabled_by_user.get(user_id, True))
        active_thread_count = int(counts.get(user_id, 0))
        saturated = active_thread_count >= normalized_limit
        snapshots[user_id] = {
            'activeThreadCount': active_thread_count,
            'coolingThreadCount': int(cooling_counts.get(user_id, 0)),
            'activeThreadLimit': normalized_limit,
            'remainingSlots': max(0, normalized_limit - active_thread_count),
            'saturated': saturated,
            'discoverable': matching_enabled and not saturated,
            'status': 'hidden_due_to_bandwidth' if matching_enabled and saturated else ('disabled' if not matching_enabled else 'available'),
        }
    return snapshots


def assert_social_discoverable(bandwidth_snapshot: dict[str, Any], *, matching_enabled: bool) -> None:
    if not bool(matching_enabled):
        raise ValueError('Matching disabled for current profile')
    if bool((bandwidth_snapshot or {}).get('saturated')):
        raise ValueError('Social bandwidth exhausted; close or cool down existing threads before discover')


def list_match_records(db: Session, user_id: str | None = None) -> list[MatchRecord]:
    query = select(MatchRecord).order_by(MatchRecord.created_at.desc())
    if user_id:
        query = query.where((MatchRecord.user_id_a == user_id) | (MatchRecord.user_id_b == user_id))
    return list(db.scalars(query).all())


def save_match_record(
    db: Session,
    *,
    match_id: str,
    user_id_a: str,
    user_id_b: str,
    source_report_id: str | None,
    resonance_score: float,
    match_analysis: dict[str, Any],
    status: str = 'complete',
) -> MatchRecord:
    entity = db.get(MatchRecord, match_id)
    if entity is None:
        entity = MatchRecord(
            id=match_id,
            user_id_a=user_id_a,
            user_id_b=user_id_b,
            source_report_id=source_report_id,
            resonance_score=resonance_score,
            match_analysis=match_analysis,
            status=status,
        )
        db.add(entity)
    else:
        entity.user_id_a = user_id_a
        entity.user_id_b = user_id_b
        entity.source_report_id = source_report_id
        entity.resonance_score = resonance_score
        entity.match_analysis = match_analysis
        entity.status = status
    db.commit()
    db.refresh(entity)
    return entity


def list_exposure_logs(
    db: Session,
    *,
    user_id: str | None = None,
    date: str | None = None,
) -> list[dict[str, Any]]:
    query = select(ExposureLog).order_by(ExposureLog.created_at.desc())
    if user_id:
        query = query.where(ExposureLog.user_id == user_id)

    logs = list(db.scalars(query).all())
    aggregated: dict[tuple[str, str], dict[str, Any]] = {}
    for item in logs:
        day = item.created_at.date().isoformat() if item.created_at else ''
        if date and day != date:
            continue
        key = (item.user_id, day)
        current = aggregated.get(key)
        if current is None:
            aggregated[key] = {
                'id': f'{item.user_id}:{day}',
                'userId': item.user_id,
                'date': day,
                'dailyExposureCount': 1,
            }
        else:
            current['dailyExposureCount'] += 1

    return sorted(
        aggregated.values(),
        key=lambda entry: (entry['date'], entry['dailyExposureCount']),
        reverse=True,
    )


def build_admin_stats(db: Session) -> dict[str, int]:
    profiles = list_user_profiles(db)
    sessions = list_all_session_states(db)
    reports = list_reports(db)
    matches = list_match_records(db)
    today = _utcnow_naive().date().isoformat()
    exposures = list_exposure_logs(db, date=today)
    return {
        'users': len(profiles),
        'sessions': len(sessions),
        'reports': len(reports),
        'matches': len(matches),
        'todayExposures': sum(int(item['dailyExposureCount']) for item in exposures),
    }


def save_social_thread(
    db: Session,
    *,
    thread_id: str,
    user_id_a: str,
    user_id_b: str,
    match_id: str | None,
    unlock_stage: int,
    icebreakers: list[Any],
    tension_report: dict[str, Any],
    unlock_milestones: list[dict[str, Any]],
    messages: list[dict[str, Any]],
    status: str = 'active',
    cooldown_until: str | datetime | None = None,
    governance_note: str | None = None,
) -> SocialThread:
    entity = db.get(SocialThread, thread_id)
    now = _utcnow_naive()
    normalized_cooldown_until = _parse_optional_datetime(cooldown_until)
    normalized_status = _normalize_thread_status(status, normalized_cooldown_until)
    closed_at = now if normalized_status == 'closed' else None
    if entity is not None and entity.closed_at and normalized_status == 'closed':
        closed_at = entity.closed_at
    if normalized_status != 'cooldown':
        normalized_cooldown_until = None
    if entity is not None and entity.status == 'closed' and normalized_status != 'closed':
        raise ValueError('Closed thread cannot be reopened')
    participant_ids = {user_id_a, user_id_b} - {''}
    existing_messages = list(entity.messages or []) if entity is not None else []
    if normalized_status in {'cooldown', 'closed'} and len(messages or []) > len(existing_messages):
        raise ValueError('Cooling or closed thread cannot receive new messages')
    normalized_messages, appended_messages = _sanitize_thread_messages(
        messages,
        participant_ids=participant_ids,
        existing_messages=existing_messages,
    )
    previous_stage = int(entity.unlock_stage or 0) if entity is not None else 0
    effective_message_count = _count_effective_thread_messages(normalized_messages)
    normalized_stage = _derive_unlock_stage(effective_message_count)
    normalized_milestones = _build_unlock_milestones(
        normalized_stage,
        message_count=effective_message_count,
        source=unlock_milestones,
    )
    contact_exchange_status = _build_contact_exchange_status(
        stage=normalized_stage,
        message_count=effective_message_count,
        tension_report=tension_report,
    )
    _enforce_thread_message_policy(
        appended_messages,
        stage=normalized_stage,
        contact_exchange_status=contact_exchange_status,
    )
    if normalized_stage > previous_stage:
        normalized_messages.append(_build_unlock_system_message(normalized_stage))
    if entity is None:
        entity = SocialThread(
            id=thread_id,
            user_id_a=user_id_a,
            user_id_b=user_id_b,
            match_id=match_id,
            unlock_stage=normalized_stage,
            icebreakers=icebreakers,
            tension_report=tension_report,
            unlock_milestones=normalized_milestones,
            messages=normalized_messages,
            status=normalized_status,
            cooldown_until=normalized_cooldown_until,
            closed_at=closed_at,
            governance_note=str(governance_note or '').strip(),
            created_at=now,
            updated_at=now,
        )
        db.add(entity)
    else:
        entity.user_id_a = user_id_a
        entity.user_id_b = user_id_b
        entity.match_id = match_id
        entity.unlock_stage = normalized_stage
        entity.icebreakers = icebreakers
        entity.tension_report = tension_report
        entity.unlock_milestones = normalized_milestones
        entity.messages = normalized_messages
        entity.status = normalized_status
        entity.cooldown_until = normalized_cooldown_until
        entity.closed_at = closed_at
        entity.governance_note = str(governance_note or entity.governance_note or '').strip()
        entity.updated_at = now
    db.commit()
    db.refresh(entity)
    return entity


def update_report_public_state(db: Session, report_id: str, is_public: bool) -> InsightReport | None:
    entity = db.get(InsightReport, report_id)
    if entity is None:
        return None
    entity.is_public = is_public
    db.commit()
    db.refresh(entity)
    return entity


def serialize_session(entity: SessionState) -> dict[str, Any]:
    return {
        'id': entity.id,
        'userId': entity.user_id,
        'status': entity.status,
        'currentStage': entity.current_stage,
        'turnCount': entity.turn_count,
        'maxTurns': entity.max_turns,
        'contextVariables': entity.payload.get('contextVariables', {}),
        'extractedContradictions': entity.payload.get('contradictions', []),
        'messages': entity.payload.get('messages', []),
        'tokenConsumed': entity.payload.get('tokenConsumed', 0),
        'stateContext': entity.payload.get('stateContext', {}),
        'readiness': entity.payload.get('readiness', False),
        'offTopicCount': entity.payload.get('offTopicCount', 0),
        'badCaseFlags': entity.payload.get('badCaseFlags', []),
        'completionReason': entity.payload.get('completionReason'),
        'payload': entity.payload,
        'createdAt': entity.created_at.isoformat() if entity.created_at else None,
        'updatedAt': entity.updated_at.isoformat() if entity.updated_at else None,
    }


def serialize_report(entity: InsightReport, db: Session | None = None) -> dict[str, Any]:
    raw_content = entity.raw_content or {}
    v_feature = entity.v_feature or []
    lineage_snapshot = _build_report_lineage_snapshot(db, entity) if db is not None else {
        'lineageId': _report_lineage_id(raw_content, entity.id),
        'sourceSessionId': _report_source_session_id(raw_content) or None,
        'version': raw_content.get('version', 1),
        'versionCount': 1,
        'isLatestVersion': True,
        'latestReportId': entity.id,
        'previousVersionId': None,
    }
    return {
        'id': entity.id,
        'userId': entity.user_id,
        'title': raw_content.get('title') or 'Ariadne 结构化洞见报告',
        'rawContent': entity.raw_content,
        'vFeature': {
            'v1Security': v_feature[0] if len(v_feature) > 0 else 0,
            'v2Power': v_feature[1] if len(v_feature) > 1 else 0,
            'v3Boundary': v_feature[2] if len(v_feature) > 2 else 0,
            'v4Conflict': v_feature[3] if len(v_feature) > 3 else 0,
            'v5Emotion': v_feature[4] if len(v_feature) > 4 else 0,
            'v6Values': v_feature[5] if len(v_feature) > 5 else 0,
            'v7Consistency': v_feature[6] if len(v_feature) > 6 else 0,
        },
        'consistencyScore': entity.consistency_score,
        'vEmbedding': entity.v_embedding or [],
        'isPublic': entity.is_public,
        'version': lineage_snapshot['version'],
        'lineageId': lineage_snapshot['lineageId'],
        'sourceSessionId': lineage_snapshot['sourceSessionId'],
        'versionCount': lineage_snapshot['versionCount'],
        'isLatestVersion': lineage_snapshot['isLatestVersion'],
        'latestReportId': lineage_snapshot['latestReportId'],
        'previousVersionId': lineage_snapshot['previousVersionId'],
        'createdAt': entity.created_at.isoformat() if entity.created_at else None,
    }


def serialize_social_thread(entity: SocialThread) -> dict[str, Any]:
    messages = entity.messages or []
    message_count = _count_effective_thread_messages(messages)
    unlock_stage = _derive_unlock_stage(message_count)
    milestones = _build_unlock_milestones(
        unlock_stage,
        message_count=message_count,
        source=entity.unlock_milestones or [],
    )
    tension_report = entity.tension_report or {}
    governance_state = _build_thread_governance_state(
        status=getattr(entity, 'status', 'active'),
        cooldown_until=getattr(entity, 'cooldown_until', None),
        closed_at=getattr(entity, 'closed_at', None),
        governance_note=getattr(entity, 'governance_note', ''),
    )
    return {
        'id': entity.id,
        'userIdA': entity.user_id_a,
        'userIdB': entity.user_id_b,
        'matchId': entity.match_id,
        'unlockStage': unlock_stage,
        'icebreakers': entity.icebreakers or [],
        'tensionReport': tension_report,
        'unlockMilestones': milestones,
        'messages': messages,
        'unlockState': _build_unlock_state(stage=unlock_stage, message_count=message_count),
        'stagePolicy': _build_stage_policy(unlock_stage),
        'tensionHandbook': _build_tension_handbook(tension_report),
        'contactExchangeStatus': _build_contact_exchange_status(
            stage=unlock_stage,
            message_count=message_count,
            tension_report=tension_report,
        ),
        'status': governance_state['status'],
        'cooldownUntil': governance_state['cooldownUntil'],
        'closedAt': governance_state['closedAt'],
        'governanceNote': governance_state['governanceNote'],
        'governanceState': governance_state,
        'createdAt': entity.created_at.isoformat() if entity.created_at else None,
        'updatedAt': entity.updated_at.isoformat() if entity.updated_at else None,
    }


def serialize_match_record(entity: MatchRecord) -> dict[str, Any]:
    return {
        'id': entity.id,
        'userIdA': entity.user_id_a,
        'userIdB': entity.user_id_b,
        'sourceReportId': entity.source_report_id,
        'resonanceScore': entity.resonance_score,
        'matchAnalysis': entity.match_analysis or {},
        'status': entity.status,
        'createdAt': entity.created_at.isoformat() if entity.created_at else None,
    }


def serialize_strategy_asset(entity: StrategyAsset) -> dict[str, Any]:
    return {
        'id': entity.id,
        'assetKey': entity.asset_key,
        'version': entity.version,
        'assetType': entity.asset_type,
        'title': entity.title,
        'content': entity.content,
        'sourcePath': entity.source_path,
        'isActive': entity.is_active,
        'activatedFromVersion': getattr(entity, 'activated_from_version', '') or None,
        'rollbackNote': getattr(entity, 'rollback_note', '') or None,
        'rollbackOperator': getattr(entity, 'rollback_operator', '') or None,
        'rollbackAt': entity.rollback_at.isoformat() if getattr(entity, 'rollback_at', None) else None,
        'createdAt': entity.created_at.isoformat() if entity.created_at else None,
        'updatedAt': entity.updated_at.isoformat() if entity.updated_at else None,
    }


def serialize_configs(entities: Iterable[SystemConfig]) -> list[dict[str, Any]]:
    return [{'key': item.key, 'value': item.value, 'type': item.type, 'updatedAt': None} for item in entities]


def serialize_profile(entity: UserProfile, bandwidth_snapshot: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        'id': entity.id,
        'userId': entity.user_id,
        'displayName': entity.display_name,
        'tier': entity.tier,
        'tokenBalance': float(entity.token_balance or 0),
        'notificationChannels': entity.notification_channels or {},
        'matchingEnabled': bool(entity.matching_enabled),
        'socialBandwidth': bandwidth_snapshot or {},
        'privacyConsent': serialize_privacy_consent(entity),
        'isAdmin': bool(entity.is_admin),
        'createdAt': entity.created_at.isoformat() if entity.created_at else None,
        'updatedAt': entity.updated_at.isoformat() if entity.updated_at else None,
    }
