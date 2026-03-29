from __future__ import annotations

from datetime import datetime
import json
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.ariadne import (
    AdRewardClaimRequest,
    DeepMatchRequest,
    DiscoverRequest,
    GenerateReportRequest,
    GenericResponse,
    IcebreakerRequest,
    InterviewStreamRequest,
    InterviewTurnRequest,
    NotificationReplayRequest,
    PrivacyConsentAcceptRequest,
    ReportJobCreateRequest,
    SessionStateUpsertRequest,
    SocialThreadUpsertRequest,
    StrategyAssetActivateRequest,
    SystemConfigUpdateRequest,
    TogglePublicRequest,
    UserProfileUpdateRequest,
)
from app.services.interview_engine import build_interview_reply, build_report
from app.services.match_engine import build_deep_match, build_discovery_cards
from app.services.notification_service import append_notifications, build_notification_events, enqueue_notification_events, get_notification_event, list_notification_events, replay_notification_event, resolve_notification_channels, serialize_notification_event
from app.services.report_jobs import create_report_job, get_report_job, list_report_jobs, serialize_report_job
from app.services.rate_limit import consume, consume_token_balance
from app.services.redis_state import load_state, save_state
from app.services.runtime_config import get_runtime_config
from app.services.storage_service import (
    accept_privacy_consent,
    assert_social_discoverable,
    build_ad_reward_task_catalog,
    build_social_bandwidth_snapshot,
    build_social_bandwidth_snapshots,
    create_ad_reward_claim,
    build_admin_stats,
    create_exposure_logs,
    get_or_create_user_profile,
    get_daily_exposure_counts,
    get_match_record,
    get_report,
    get_session_state,
    get_social_thread,
    list_all_session_states,
    list_ad_reward_claims,
    list_exposure_logs,
    list_match_records,
    list_reports,
    list_similar_reports,
    list_session_states,
    list_social_threads,
    list_system_configs,
    list_user_profiles,
    save_report,
    save_session_state,
    save_match_record,
    save_social_thread,
    set_user_token_balance,
    activate_strategy_asset,
    serialize_configs,
    serialize_ad_reward_claim,
    serialize_match_record,
    serialize_privacy_consent,
    serialize_profile,
    serialize_report,
    serialize_session,
    serialize_social_thread,
    serialize_strategy_asset,
    update_system_config,
    update_report_public_state,
    update_user_profile,
    list_strategy_assets,
    get_active_strategy_asset,
    upsert_system_config,
)
from app.services.runtime_config import list_runtime_configs

router = APIRouter()


def _format_sse_event(event: str, data: dict) -> str:
    return f'event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n'


def _build_interview_turn_payload(payload: InterviewTurnRequest, db: Session) -> dict:
    cost, remaining_tokens = _ensure_token_budget(db, payload.user_id, cost_key='TOKEN_COST_INTERVIEW_TURN', bucket_suffix='interview')
    session_id = payload.session_id or f'session_{uuid4().hex[:12]}'
    existing = get_session_state(db, session_id)
    persisted_payload = existing.payload if existing else {}
    redis_payload = load_state(session_id) or {}
    turn_count = int((existing.turn_count if existing else redis_payload.get('turnCount', payload.turn_count)) or 0)
    current_stage = (existing.current_stage if existing else redis_payload.get('currentStage', payload.current_stage)) or 'DIVERGENT'

    prior_messages = persisted_payload.get('messages', payload.messages)
    prior_context_variables = persisted_payload.get('contextVariables', {})
    prior_contradictions = persisted_payload.get('contradictions', [])
    prior_state_context = persisted_payload.get('stateContext', {})
    result = build_interview_reply(
        payload.message,
        turn_count + 1,
        current_stage,
        prior_messages,
        prior_context_variables,
        prior_contradictions,
        prior_state_context,
    )
    messages = [
        *prior_messages,
        {'role': 'user', 'content': payload.message},
        {'role': 'assistant', 'content': result['reply'], 'stage': result['stage']},
    ]
    previous_consumed = int(persisted_payload.get('tokenConsumed', 0) or 0)
    state_payload = {
        'messages': messages,
        'contradictions': result['contradictions'],
        'contextVariables': result.get('contextVariables', prior_context_variables),
        'tokenConsumed': previous_consumed + int(cost),
        'stateContext': result.get('stateContext', prior_state_context),
        'readiness': bool((result.get('stateContext') or {}).get('readiness', False)),
        'offTopicCount': int((result.get('stateContext') or {}).get('offTopicCount', 0) or 0),
        'badCaseFlags': list((result.get('stateContext') or {}).get('badCaseFlags', [])),
        'completionReason': (result.get('stateContext') or {}).get('completionReason'),
    }
    status = 'COMPLETED' if result['stage'] in {'COMPLETE', 'REPORT_READY'} else 'IN_PROGRESS'
    entity = save_session_state(
        db,
        session_id=session_id,
        user_id=payload.user_id,
        status=status,
        current_stage=result['stage'],
        turn_count=turn_count + 1,
        max_turns=payload.max_turns,
        payload=state_payload,
    )
    save_state(session_id, serialize_session(entity))
    return {
        'session': serialize_session(entity),
        'assistantReply': result['reply'],
        'currentStage': result['stage'],
        'contradictions': result['contradictions'],
        'contextVariables': result.get('contextVariables', prior_context_variables),
        'stateContext': result.get('stateContext', prior_state_context),
        'readiness': bool((result.get('stateContext') or {}).get('readiness', False)),
        'offTopicCount': int((result.get('stateContext') or {}).get('offTopicCount', 0) or 0),
        'badCaseFlags': list((result.get('stateContext') or {}).get('badCaseFlags', [])),
        'completionReason': (result.get('stateContext') or {}).get('completionReason'),
        'tokenCost': cost,
        'remainingTokens': remaining_tokens,
    }


def _ensure_token_budget(db: Session, user_id: str, *, cost_key: str, bucket_suffix: str) -> tuple[float, float]:
    runtime_config = get_runtime_config(db)
    cost = float(runtime_config[cost_key])
    allowed, _ = consume(f'ariadne:token:{bucket_suffix}:{user_id}', capacity=60, refill_per_second=1, requested=1)
    if not allowed:
        raise HTTPException(status_code=429, detail='Too many requests')

    profile = get_or_create_user_profile(db, user_id)
    ok, remaining = consume_token_balance(
        f'ariadne:balance:{user_id}',
        current_balance=float(profile.token_balance or 0),
        cost=cost,
        min_balance=0,
    )
    if not ok:
        raise HTTPException(
            status_code=402,
            detail={
                'error': 'insufficient_tokens',
                'required': cost,
                'remaining': float(profile.token_balance or 0),
            },
        )
    set_user_token_balance(db, user_id, remaining)
    return cost, remaining


@router.get('/status')
def ariadne_status() -> GenericResponse:
    return GenericResponse(
        ok=True,
        message='Ariadne backend is running',
        data={
            'service': 'ariadne',
            'mode': 'fastapi',
            'capabilities': ['interview', 'report-generate', 'discover', 'deep-match', 'icebreakers'],
        },
    )


@router.get('/runtime/config')
def get_runtime_config_route(db: Session = Depends(get_db)) -> GenericResponse:
    return GenericResponse(data={'items': list_runtime_configs(db)})


@router.get('/runtime/strategy-assets')
def get_strategy_assets(asset_key: str | None = Query(default=None), db: Session = Depends(get_db)) -> GenericResponse:
    items = [serialize_strategy_asset(item) for item in list_strategy_assets(db, asset_key=asset_key)]
    return GenericResponse(data={'items': items})


@router.get('/runtime/strategy-assets/{asset_key}/active')
def get_active_asset(asset_key: str, db: Session = Depends(get_db)) -> GenericResponse:
    entity = get_active_strategy_asset(db, asset_key)
    if entity is None:
        raise HTTPException(status_code=404, detail='Strategy asset not found')
    return GenericResponse(data=serialize_strategy_asset(entity))


@router.post('/runtime/strategy-assets/{asset_key}/activate')
def post_activate_asset(asset_key: str, payload: StrategyAssetActivateRequest, db: Session = Depends(get_db)) -> GenericResponse:
    entity = activate_strategy_asset(db, asset_key, payload.version, reason=payload.reason, operator=payload.operator)
    if entity is None:
        raise HTTPException(status_code=404, detail='Strategy asset not found')
    return GenericResponse(data=serialize_strategy_asset(entity))


@router.get('/runtime/stats')
def get_runtime_stats(db: Session = Depends(get_db)) -> GenericResponse:
    return GenericResponse(data=build_admin_stats(db))


@router.put('/runtime/config/{config_key}')
def put_runtime_config(config_key: str, payload: SystemConfigUpdateRequest, db: Session = Depends(get_db)) -> GenericResponse:
    entity = update_system_config(db, config_key, payload.value, payload.type)
    if entity is None:
        entity = upsert_system_config(db, config_key, payload.value, payload.type or 'string')
    return GenericResponse(
        data={
            'key': entity.key,
            'value': entity.value,
            'type': entity.type,
            'description': next((item.get('description') for item in list_runtime_configs(db) if item.get('key') == entity.key), None),
            'source': 'system-config',
            'updatedAt': None,
        }
    )


@router.get('/profiles/{user_id}')
def get_profile(user_id: str, db: Session = Depends(get_db)) -> GenericResponse:
    profile = get_or_create_user_profile(db, user_id)
    runtime_config = get_runtime_config(db)
    bandwidth_snapshot = build_social_bandwidth_snapshot(
        db,
        user_id=profile.user_id,
        matching_enabled=bool(profile.matching_enabled),
        active_thread_limit=int(runtime_config['SOCIAL_ACTIVE_THREAD_LIMIT']),
    )
    return GenericResponse(data=serialize_profile(profile, bandwidth_snapshot))


@router.get('/profiles/{user_id}/privacy-consent')
def get_profile_privacy_consent(user_id: str, db: Session = Depends(get_db)) -> GenericResponse:
    profile = get_or_create_user_profile(db, user_id)
    return GenericResponse(data=serialize_privacy_consent(profile))


@router.post('/profiles/{user_id}/privacy-consent')
def post_profile_privacy_consent(user_id: str, payload: PrivacyConsentAcceptRequest, db: Session = Depends(get_db)) -> GenericResponse:
    if payload.user_id != user_id:
        raise HTTPException(status_code=400, detail='User mismatch')
    profile = accept_privacy_consent(db, user_id, version=payload.version, scope=payload.scope)
    runtime_config = get_runtime_config(db)
    bandwidth_snapshot = build_social_bandwidth_snapshot(
        db,
        user_id=profile.user_id,
        matching_enabled=bool(profile.matching_enabled),
        active_thread_limit=int(runtime_config['SOCIAL_ACTIVE_THREAD_LIMIT']),
    )
    return GenericResponse(
        data={
            'consent': serialize_privacy_consent(profile),
            'profile': serialize_profile(profile, bandwidth_snapshot),
        }
    )


@router.get('/profiles')
def get_profiles(db: Session = Depends(get_db)) -> GenericResponse:
    profile_entities = list_user_profiles(db)
    runtime_config = get_runtime_config(db)
    bandwidth_by_user = build_social_bandwidth_snapshots(
        db,
        user_ids=[item.user_id for item in profile_entities],
        matching_enabled_by_user={item.user_id: bool(item.matching_enabled) for item in profile_entities},
        active_thread_limit=int(runtime_config['SOCIAL_ACTIVE_THREAD_LIMIT']),
    )
    profiles = [serialize_profile(item, bandwidth_by_user.get(item.user_id)) for item in profile_entities]
    return GenericResponse(data={'items': profiles})


@router.get('/ad-rewards/tasks')
def get_ad_reward_tasks(user_id: str, db: Session = Depends(get_db)) -> GenericResponse:
    profile = get_or_create_user_profile(db, user_id)
    runtime_config = get_runtime_config(db)
    claims = list_ad_reward_claims(db, user_id=user_id)
    items = build_ad_reward_task_catalog(
        claims=claims,
        daily_limit=int(runtime_config['AD_REWARD_DAILY_LIMIT']),
        reward_tokens=int(runtime_config['AD_REWARD_TOKEN_REWARD']),
    )
    return GenericResponse(
        data={
            'tier': profile.tier,
            'items': items,
            'claims': [serialize_ad_reward_claim(item) for item in claims],
        }
    )


@router.post('/ad-rewards/tasks/{task_key}/claim')
def post_ad_reward_claim(task_key: str, payload: AdRewardClaimRequest, db: Session = Depends(get_db)) -> GenericResponse:
    runtime_config = get_runtime_config(db)
    try:
        claim, profile = create_ad_reward_claim(
            db,
            user_id=payload.user_id,
            task_key=task_key,
            reward_tokens=int(runtime_config['AD_REWARD_TOKEN_REWARD']),
            daily_limit=int(runtime_config['AD_REWARD_DAILY_LIMIT']),
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = 400
        if 'limit' in detail.lower():
            status_code = 409
        raise HTTPException(status_code=status_code, detail=detail) from exc
    return GenericResponse(
        data={
            'claim': serialize_ad_reward_claim(claim),
            'profile': serialize_profile(profile),
        }
    )


@router.patch('/profiles/{profile_id}')
def patch_profile(profile_id: str, payload: UserProfileUpdateRequest, db: Session = Depends(get_db)) -> GenericResponse:
    data = payload.model_dump(by_alias=True, exclude_none=True)
    profile = update_user_profile(db, profile_id, data)
    if profile is None:
        raise HTTPException(status_code=404, detail='Profile not found')
    runtime_config = get_runtime_config(db)
    bandwidth_snapshot = build_social_bandwidth_snapshot(
        db,
        user_id=profile.user_id,
        matching_enabled=bool(profile.matching_enabled),
        active_thread_limit=int(runtime_config['SOCIAL_ACTIVE_THREAD_LIMIT']),
    )
    return GenericResponse(data=serialize_profile(profile, bandwidth_snapshot))


@router.get('/sessions')
def get_sessions(user_id: str | None = Query(default=None), db: Session = Depends(get_db)) -> GenericResponse:
    items = list_session_states(db, user_id) if user_id else list_all_session_states(db)
    sessions = [serialize_session(item) for item in items]
    return GenericResponse(data={'items': sessions})


@router.get('/sessions/{session_id}')
def get_session(session_id: str, db: Session = Depends(get_db)) -> GenericResponse:
    session = get_session_state(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail='Session not found')
    return GenericResponse(data=serialize_session(session))


@router.put('/sessions/{session_id}')
def put_session(session_id: str, payload: SessionStateUpsertRequest, db: Session = Depends(get_db)) -> GenericResponse:
    entity = save_session_state(
        db,
        session_id=session_id,
        user_id=payload.user_id,
        status=payload.status,
        current_stage=payload.current_stage,
        turn_count=payload.turn_count,
        max_turns=payload.max_turns,
        payload={
            'messages': payload.messages,
            'contradictions': payload.extracted_contradictions,
            'contextVariables': payload.context_variables,
            'tokenConsumed': payload.token_consumed,
            'stateContext': {},
            'readiness': False,
            'offTopicCount': 0,
            'badCaseFlags': [],
            'completionReason': None,
        },
    )
    save_state(session_id, serialize_session(entity))
    return GenericResponse(data=serialize_session(entity))


@router.post('/interview/turn')
def interview_turn(payload: InterviewTurnRequest, db: Session = Depends(get_db)) -> GenericResponse:
    return GenericResponse(data=_build_interview_turn_payload(payload, db))


@router.post('/interview/stream')
def interview_stream(payload: InterviewStreamRequest, db: Session = Depends(get_db)) -> StreamingResponse:
    request_payload = InterviewTurnRequest(
        sessionId=payload.session_id,
        userId=payload.user_id,
        userMessage=payload.message,
        messages=payload.messages,
        currentStage=payload.current_stage,
        turnCount=payload.turn_count,
        maxTurns=payload.max_turns,
    )
    turn_payload = _build_interview_turn_payload(request_payload, db)

    def generate() -> object:
        session = turn_payload.get('session', {})
        assistant_reply = str(turn_payload.get('assistantReply', ''))
        yield _format_sse_event('session', session)
        yield _format_sse_event(
            'meta',
            {
                'currentStage': turn_payload.get('currentStage'),
                'contradictions': turn_payload.get('contradictions', []),
                'stateContext': turn_payload.get('stateContext'),
                'readiness': turn_payload.get('readiness'),
                'offTopicCount': turn_payload.get('offTopicCount'),
                'badCaseFlags': turn_payload.get('badCaseFlags', []),
                'completionReason': turn_payload.get('completionReason'),
                'tokenCost': turn_payload.get('tokenCost'),
                'remainingTokens': turn_payload.get('remainingTokens'),
            },
        )
        for index, chunk in enumerate([assistant_reply[i:i + 48] for i in range(0, len(assistant_reply), 48)] or ['']):
            yield _format_sse_event('chunk', {'index': index, 'delta': chunk})
        yield _format_sse_event('done', turn_payload)

    return StreamingResponse(generate(), media_type='text/event-stream')


@router.post('/report/generate')
def generate_report(payload: GenerateReportRequest, db: Session = Depends(get_db)) -> GenericResponse:
    cost, remaining_tokens = _ensure_token_budget(db, payload.user_id, cost_key='TOKEN_COST_GENERATE_REPORT', bucket_suffix='report')
    session = get_session_state(db, payload.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail='Session not found')

    report = build_report(
        session.payload.get('messages', []),
        payload.user_id,
        payload.session_id,
        session.payload.get('contextVariables', {}),
        session.payload.get('contradictions', []),
    )
    entity = save_report(db, report)
    response_payload = serialize_report(entity, db)
    response_payload.update(
        {
            'tokenCost': cost,
            'remainingTokens': remaining_tokens,
        }
    )
    return GenericResponse(data=response_payload)


@router.post('/report/jobs')
def create_async_report_job(payload: ReportJobCreateRequest, db: Session = Depends(get_db)) -> GenericResponse:
    _ensure_token_budget(db, payload.user_id, cost_key='TOKEN_COST_GENERATE_REPORT', bucket_suffix='report-job')
    session = get_session_state(db, payload.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail='Session not found')
    job = create_report_job(
        db,
        user_id=payload.user_id,
        session_id=payload.session_id,
        trigger_payload={'messagesCount': len(payload.messages)},
    )
    return GenericResponse(data=serialize_report_job(job, db))


@router.get('/report/jobs')
def get_async_report_jobs(user_id: str | None = Query(default=None), db: Session = Depends(get_db)) -> GenericResponse:
    items = [serialize_report_job(item, db) for item in list_report_jobs(db, user_id=user_id)]
    return GenericResponse(data={'items': items})


@router.get('/report/jobs/{job_id}')
def get_async_report_job(job_id: str, db: Session = Depends(get_db)) -> GenericResponse:
    entity = get_report_job(db, job_id)
    if entity is None:
        raise HTTPException(status_code=404, detail='Report job not found')
    return GenericResponse(data=serialize_report_job(entity, db))


@router.get('/reports')
def get_reports(
    user_id: str | None = Query(default=None),
    public_only: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> GenericResponse:
    reports = [serialize_report(item, db) for item in list_reports(db, user_id=user_id, public_only=public_only)]
    return GenericResponse(data={'items': reports})


@router.get('/reports/{report_id}')
def get_report_detail(report_id: str, db: Session = Depends(get_db)) -> GenericResponse:
    report = get_report(db, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail='Report not found')
    return GenericResponse(data=serialize_report(report, db))


@router.patch('/reports/{report_id}/public')
def patch_report_public(report_id: str, payload: TogglePublicRequest, db: Session = Depends(get_db)) -> GenericResponse:
    report = update_report_public_state(db, report_id, payload.is_public)
    if report is None:
        raise HTTPException(status_code=404, detail='Report not found')
    return GenericResponse(data=serialize_report(report, db))


@router.get('/threads')
def get_threads(user_id: str | None = Query(default=None), db: Session = Depends(get_db)) -> GenericResponse:
    if user_id:
        threads = [serialize_social_thread(item) for item in list_social_threads(db, user_id)]
    else:
        profiles = list_user_profiles(db)
        seen_ids: set[str] = set()
        threads = []
        for profile in profiles:
            for item in list_social_threads(db, profile.user_id):
                if item.id in seen_ids:
                    continue
                seen_ids.add(item.id)
                threads.append(serialize_social_thread(item))
    return GenericResponse(data={'items': threads})


@router.get('/exposure-logs')
def get_exposure_logs(
    user_id: str | None = Query(default=None),
    date: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> GenericResponse:
    return GenericResponse(data={'items': list_exposure_logs(db, user_id=user_id, date=date)})


@router.get('/threads/{thread_id}')
def get_thread(thread_id: str, db: Session = Depends(get_db)) -> GenericResponse:
    thread = get_social_thread(db, thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail='Thread not found')
    return GenericResponse(data=serialize_social_thread(thread))


@router.put('/threads/{thread_id}')
def put_thread(thread_id: str, payload: SocialThreadUpsertRequest, db: Session = Depends(get_db)) -> GenericResponse:
    if payload.user_id_a == payload.user_id_b:
        raise HTTPException(status_code=400, detail='Thread participants must be different users')

    existing = get_social_thread(db, thread_id)
    if existing is not None:
        member_pair = {existing.user_id_a, existing.user_id_b}
        incoming_pair = {payload.user_id_a, payload.user_id_b}
        if member_pair != incoming_pair:
            raise HTTPException(status_code=400, detail='Thread participants cannot be changed')
        match_id = existing.match_id
        tension_report = existing.tension_report or payload.tension_report
        icebreakers = existing.icebreakers or payload.icebreakers
    else:
        match_id = payload.match_id
        tension_report = payload.tension_report
        icebreakers = payload.icebreakers

    try:
        entity = save_social_thread(
            db,
            thread_id=thread_id,
            user_id_a=payload.user_id_a,
            user_id_b=payload.user_id_b,
            match_id=match_id,
            unlock_stage=payload.unlock_stage,
            icebreakers=icebreakers,
            tension_report=tension_report,
            unlock_milestones=payload.unlock_milestones,
            messages=payload.messages,
            status=payload.status,
            cooldown_until=payload.cooldown_until,
            governance_note=payload.governance_note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return GenericResponse(data=serialize_social_thread(entity))


@router.get('/matches')
def get_matches(user_id: str | None = Query(default=None), db: Session = Depends(get_db)) -> GenericResponse:
    items = [serialize_match_record(item) for item in list_match_records(db, user_id)]
    return GenericResponse(data={'items': items})


@router.get('/matches/{match_id}')
def get_match_detail(match_id: str, db: Session = Depends(get_db)) -> GenericResponse:
    entity = get_match_record(db, match_id)
    if entity is None:
        raise HTTPException(status_code=404, detail='Match not found')
    return GenericResponse(data=serialize_match_record(entity))


@router.get('/notifications')
def get_notifications(
    user_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    source_kind: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
) -> GenericResponse:
    items = [serialize_notification_event(item) for item in list_notification_events(db, user_id=user_id, status=status, source_kind=source_kind, limit=limit)]
    return GenericResponse(data={'items': items})


@router.get('/notifications/{event_id}')
def get_notification_detail(event_id: str, db: Session = Depends(get_db)) -> GenericResponse:
    entity = get_notification_event(db, event_id)
    if entity is None:
        raise HTTPException(status_code=404, detail='Notification event not found')
    return GenericResponse(data=serialize_notification_event(entity))


@router.post('/notifications/{event_id}/replay')
def post_notification_replay(event_id: str, payload: NotificationReplayRequest, db: Session = Depends(get_db)) -> GenericResponse:
    scheduled_at = None
    if payload.scheduled_at:
        try:
            scheduled_at = datetime.fromisoformat(payload.scheduled_at.replace('Z', '+00:00'))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail='Invalid scheduledAt') from exc
    try:
        entity = replay_notification_event(db, event_id, scheduled_at=scheduled_at)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return GenericResponse(data=serialize_notification_event(entity))


@router.post('/match/discover')
def discover(payload: DiscoverRequest, db: Session = Depends(get_db)) -> GenericResponse:
    runtime_config = get_runtime_config(db)
    source_profile = get_or_create_user_profile(db, payload.user_id)
    bandwidth_snapshot = build_social_bandwidth_snapshot(
        db,
        user_id=payload.user_id,
        matching_enabled=bool(source_profile.matching_enabled),
        active_thread_limit=int(runtime_config['SOCIAL_ACTIVE_THREAD_LIMIT']),
    )
    try:
        assert_social_discoverable(bandwidth_snapshot, matching_enabled=bool(source_profile.matching_enabled))
    except ValueError as exc:
        detail = str(exc)
        status_code = 403 if 'disabled' in detail.lower() else 409
        raise HTTPException(status_code=status_code, detail=detail) from exc

    cost, remaining_tokens = _ensure_token_budget(db, payload.user_id, cost_key='TOKEN_COST_DISCOVER', bucket_suffix='discover')
    source_reports = list_reports(db, user_id=payload.user_id)
    if not source_reports:
        raise HTTPException(status_code=404, detail='Source report not found')

    consistency_threshold = float(runtime_config['CONSISTENCY_MIN_THRESHOLD'])
    decay_factor = float(runtime_config['MATCH_DECAY_FACTOR'])
    resonance_threshold = float(runtime_config['MATCH_RESONANCE_THRESHOLD'])
    source_entity = source_reports[0]
    source_report = serialize_report(source_entity)
    candidate_entities = list_similar_reports(
        db,
        source_embedding=source_report.get('vEmbedding'),
        vector_search_engine=str(runtime_config.get('VECTOR_SEARCH_ENGINE', 'pgvector')),
        exclude_user_id=payload.user_id,
        exclude_report_ids=[source_entity.id],
        public_only=True,
        min_consistency=consistency_threshold,
        limit=24,
    )
    if not candidate_entities:
        candidate_entities = [
            item
            for item in list_reports(db, public_only=True)
            if item.user_id != payload.user_id and item.id != source_entity.id and float(item.consistency_score or 0) >= consistency_threshold
        ]

    candidate_profiles = {item.user_id: get_or_create_user_profile(db, item.user_id) for item in candidate_entities}
    candidate_bandwidth = build_social_bandwidth_snapshots(
        db,
        user_ids=list(candidate_profiles.keys()),
        matching_enabled_by_user={user_id: bool(profile.matching_enabled) for user_id, profile in candidate_profiles.items()},
        active_thread_limit=int(runtime_config['SOCIAL_ACTIVE_THREAD_LIMIT']),
    )
    candidate_entities = [
        item
        for item in candidate_entities
        if bool(candidate_bandwidth.get(item.user_id, {}).get('discoverable', True))
    ]
    if not candidate_entities:
        return GenericResponse(data={'items': [], 'tokenCost': cost, 'remainingTokens': remaining_tokens})

    candidates = [serialize_report(item) for item in candidate_entities]
    exposure_counts = get_daily_exposure_counts(
        db,
        user_ids=[item.user_id for item in candidate_entities],
        channel='discovery',
        action='impression',
    )
    candidate_by_report_id = {item.id: item for item in candidate_entities}
    ranked_items: list[dict] = []
    for card in build_discovery_cards(source_report, candidates):
        entity = candidate_by_report_id.get(str(card.get('reportId')))
        exposed_user_id = entity.user_id if entity is not None else ''
        exposure_count = exposure_counts.get(exposed_user_id, 0)
        visibility_factor = max(0.0, 1 - (exposure_count * decay_factor))
        visibility_score = round(float(card.get('resonanceScore', 0) or 0) * visibility_factor, 4)
        if visibility_score < resonance_threshold:
            continue
        ranked_items.append(
            {
                **card,
                'exposureCount': exposure_count,
                'visibilityScore': visibility_score,
            }
        )

    ranked_items.sort(
        key=lambda item: (float(item.get('visibilityScore', 0) or 0), float(item.get('resonanceScore', 0) or 0)),
        reverse=True,
    )

    create_exposure_logs(
        db,
        user_ids=[item.user_id for item in candidate_entities if item.id in {card['reportId'] for card in ranked_items}],
        report_ids=[item.id for item in candidate_entities if item.id in {card['reportId'] for card in ranked_items}],
        channel='discovery',
        action='impression',
    )
    return GenericResponse(data={'items': ranked_items, 'tokenCost': cost, 'remainingTokens': remaining_tokens})


@router.post('/match/deep')
def deep_match(payload: DeepMatchRequest, db: Session = Depends(get_db)) -> GenericResponse:
    cost, remaining_tokens = _ensure_token_budget(db, payload.user_id, cost_key='TOKEN_COST_DEEP_MATCH', bucket_suffix='deep-match')
    source_reports = list_reports(db, user_id=payload.user_id)
    if not source_reports:
        raise HTTPException(status_code=404, detail='Source report not found')

    source_entity = source_reports[0]
    source_report = serialize_report(source_entity)
    recalled_candidates = list_similar_reports(
        db,
        source_embedding=source_report.get('vEmbedding'),
        vector_search_engine=str(get_runtime_config(db).get('VECTOR_SEARCH_ENGINE', 'pgvector')),
        exclude_user_id=payload.user_id,
        exclude_report_ids=[source_entity.id],
        public_only=True,
        limit=48,
    )
    target_report = next((item for item in recalled_candidates if item.id == payload.target_report_id), None)
    candidate_source = 'vector-recall'
    if target_report is None:
        target_report = get_report(db, payload.target_report_id)
        candidate_source = 'direct-report'
    if target_report is None:
        raise HTTPException(status_code=404, detail='Target report not found')

    serialized_target_report = serialize_report(target_report)
    result = build_deep_match(source_report, serialized_target_report)
    match_id = str(result.get('matchId') or f'match_{uuid4().hex[:12]}')
    source_report_id = payload.target_report_id
    target_user_id = target_report.user_id
    result['matchId'] = match_id
    result['candidateSource'] = candidate_source
    entity = save_match_record(
        db,
        match_id=match_id,
        user_id_a=payload.user_id,
        user_id_b=target_user_id,
        source_report_id=source_report_id,
        resonance_score=float(result.get('resonanceScore', 0)),
        match_analysis=result,
        status='complete',
    )
    source_profile = get_or_create_user_profile(db, payload.user_id)
    target_profile = get_or_create_user_profile(db, target_user_id)
    source_events = build_notification_events(
        user_id=payload.user_id,
        kind='match_ready',
        title='深度匹配推演已完成',
        body='你的匹配推演结果已准备完成，可查看张力分析与破冰建议。',
        channels=resolve_notification_channels('match_ready', source_profile),
    )
    target_events = build_notification_events(
        user_id=target_user_id,
        kind='match_ready',
        title='你收到一条新的匹配推演',
        body='系统已为你生成一条新的匹配推演，可查看当前关系张力与互动建议。',
        channels=resolve_notification_channels('match_ready', target_profile),
    )
    queued_source = enqueue_notification_events(db, source_events, source_kind='match_record', source_id=entity.id)
    queued_target = enqueue_notification_events(db, target_events, source_kind='match_record', source_id=f'{entity.id}:target')
    source_payloads = [serialize_notification_event(item) for item in queued_source]
    target_payloads = [serialize_notification_event(item) for item in queued_target]
    source_inbox = [item for item in source_payloads if item.get('channel') == 'inbox']
    target_inbox = [item for item in target_payloads if item.get('channel') == 'inbox']
    source_profile.notification_channels = {
        **(source_profile.notification_channels or {}),
        'inbox': append_notifications({'notifications': source_profile.notification_channels.get('inbox', [])}, source_inbox).get('notifications', []),
        'deliveryLog': [*(source_profile.notification_channels.get('deliveryLog', []) or []), *source_payloads][-20:],
    }
    target_profile.notification_channels = {
        **(target_profile.notification_channels or {}),
        'inbox': append_notifications({'notifications': target_profile.notification_channels.get('inbox', [])}, target_inbox).get('notifications', []),
        'deliveryLog': [*(target_profile.notification_channels.get('deliveryLog', []) or []), *target_payloads][-20:],
    }
    db.commit()
    return GenericResponse(data=serialize_match_record(entity) | {'matchAnalysis': result, **result, 'tokenCost': cost, 'remainingTokens': remaining_tokens})


@router.post('/match/icebreakers')
def icebreakers(payload: IcebreakerRequest, db: Session = Depends(get_db)) -> GenericResponse:
    entity = get_match_record(db, payload.match_id)
    if entity is not None:
        analysis = entity.match_analysis or {}
        items = analysis.get('icebreakers', [])
        return GenericResponse(data={'items': items, 'icebreakers': items, 'matchId': entity.id})

    source_reports = list_reports(db, user_id=payload.user_id) if payload.user_id else []
    thread = get_social_thread(db, payload.thread_id)
    if source_reports and thread is not None and thread.user_id_b:
        target_reports = list_reports(db, user_id=thread.user_id_b)
        if target_reports:
            deep_match_result = build_deep_match(serialize_report(source_reports[0]), serialize_report(target_reports[0]))
            return GenericResponse(data={'items': deep_match_result['icebreakers'], 'icebreakers': deep_match_result['icebreakers']})

    deep_match_result = build_deep_match({'vFeature': {}}, {'vFeature': {}})
    return GenericResponse(data={'items': deep_match_result['icebreakers'], 'icebreakers': deep_match_result['icebreakers']})
