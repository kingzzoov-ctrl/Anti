from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import select

from app.models.report_job import ReportJob
from app.services.interview_engine import build_report
from app.services.notification_service import append_notifications, build_notification_events, enqueue_notification_events, resolve_notification_channels, serialize_notification_event
from app.services.storage_service import get_or_create_user_profile, get_session_state, save_report, serialize_report


REPORT_JOB_STATUS = ('queued', 'running', 'completed', 'failed')


def create_report_job(db: Any, *, user_id: str, session_id: str, trigger_payload: dict[str, Any] | None = None) -> ReportJob:
    now = datetime.now(UTC)
    job = ReportJob(
        id=f'report_job_{uuid4().hex[:12]}',
        user_id=user_id,
        session_id=session_id,
        status='queued',
        progress=0,
        payload={
            'trigger': trigger_payload or {},
            'timeline': [
                {'status': 'queued', 'at': now.isoformat(), 'label': '报告任务已入队'},
            ],
        },
        created_at=now,
        updated_at=now,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def get_report_job(db: Any, job_id: str) -> ReportJob | None:
    return db.get(ReportJob, job_id)


def list_report_jobs(db: Any, *, user_id: str | None = None) -> list[ReportJob]:
    query = db.query(ReportJob).order_by(ReportJob.created_at.desc())
    if user_id:
        query = query.filter(ReportJob.user_id == user_id)
    return list(query.all())


def claim_next_report_job(db: Any) -> ReportJob | None:
    statement = (
        select(ReportJob)
        .where(ReportJob.status == 'queued')
        .order_by(ReportJob.created_at.asc())
        .with_for_update(skip_locked=True)
    )
    job = db.execute(statement).scalars().first()
    if job is None:
        return None
    _update_job(job, status='running', progress=max(int(job.progress or 0), 5), timeline_label='后台 worker 已认领任务')
    db.commit()
    db.refresh(job)
    return job


def run_report_job_worker_loop(
    session_factory: Any,
    *,
    stop_when_idle: bool = False,
    max_jobs: int | None = None,
    poll_interval_seconds: float = 2.0,
) -> int:
    processed = 0
    while True:
        job = None
        db = session_factory()
        try:
            job = claim_next_report_job(db)
            if job is None:
                if stop_when_idle:
                    return processed
            else:
                process_report_job(db, job.id)
                processed += 1
                if max_jobs is not None and processed >= max_jobs:
                    return processed
        except Exception:
            db.rollback()
        finally:
            db.close()
        if stop_when_idle and job is None:
            return processed
        from time import sleep
        sleep(poll_interval_seconds)


def _update_job(job: ReportJob, *, status: str | None = None, progress: int | None = None, error_message: str | None = None, report_id: str | None = None, timeline_label: str | None = None) -> None:
    now = datetime.now(UTC)
    if status is not None:
        job.status = status
    if progress is not None:
        job.progress = progress
    if error_message is not None:
        job.error_message = error_message
    if report_id is not None:
        job.report_id = report_id
    payload = dict(job.payload or {})
    timeline = list(payload.get('timeline', []))
    if timeline_label:
        timeline.append({'status': job.status, 'at': now.isoformat(), 'label': timeline_label})
    payload['timeline'] = timeline
    job.payload = payload
    job.updated_at = now
    if job.status == 'running' and job.started_at is None:
        job.started_at = now
    if job.status in {'completed', 'failed'}:
        job.completed_at = now


def process_report_job(db: Any, job_id: str) -> ReportJob:
    job = get_report_job(db, job_id)
    if job is None:
        raise ValueError('Report job not found')

    session = get_session_state(db, job.session_id)
    if session is None:
        _update_job(job, status='failed', progress=100, error_message='Session not found', timeline_label='源会话不存在，任务失败')
        db.commit()
        db.refresh(job)
        return job

    _update_job(job, status='running', progress=15, timeline_label='开始整合问询上下文')
    db.commit()

    try:
        report = build_report(
            session.payload.get('messages', []),
            job.user_id,
            job.session_id,
            session.payload.get('contextVariables', {}),
            session.payload.get('contradictions', []),
        )
        _update_job(job, progress=70, timeline_label='结构化报告已生成，准备落库')
        db.commit()

        entity = save_report(db, report)
        profile = get_or_create_user_profile(db, job.user_id)
        events = build_notification_events(
            user_id=job.user_id,
            kind='report_ready',
            title='洞见报告已生成',
            body='你的 Ariadne 洞见报告已准备完成，可立即查看。',
            channels=resolve_notification_channels('report_ready', profile),
        )
        queued_events = enqueue_notification_events(db, events, source_kind='report_job', source_id=job.id)
        queued_event_payloads = [serialize_notification_event(item) for item in queued_events]
        inbox_events = [item for item in queued_event_payloads if item.get('channel') == 'inbox']
        profile_payload = append_notifications({'notifications': profile.notification_channels.get('inbox', [])}, inbox_events)
        profile.notification_channels = {
            **(profile.notification_channels or {}),
            'inbox': profile_payload.get('notifications', []),
            'deliveryLog': queued_event_payloads[-20:],
        }
        session_payload = dict(session.payload or {})
        session_payload['reportJobId'] = job.id
        session_payload['latestReportId'] = entity.id
        session_payload = append_notifications(session_payload, inbox_events)
        session_payload['notificationDispatch'] = queued_event_payloads[-20:]
        session.payload = session_payload
        session.status = 'COMPLETED'
        session.updated_at = datetime.now(UTC)
        _update_job(job, status='completed', progress=100, report_id=entity.id, timeline_label='报告落库完成，任务结束')
        db.commit()
        db.refresh(job)
        db.refresh(session)
        return job
    except Exception as exc:
        _update_job(job, status='failed', progress=100, error_message=str(exc), timeline_label='报告流水线执行失败')
        db.commit()
        db.refresh(job)
        return job


def serialize_report_job(job: ReportJob, db: Any | None = None) -> dict[str, Any]:
    report_payload: dict[str, Any] | None = None
    if db is not None and job.report_id:
        from app.services.storage_service import get_report
        entity = get_report(db, job.report_id)
        if entity is not None:
            report_payload = serialize_report(entity, db)
    return {
        'id': job.id,
        'userId': job.user_id,
        'sessionId': job.session_id,
        'status': job.status,
        'progress': job.progress,
        'reportId': job.report_id,
        'errorMessage': job.error_message,
        'payload': job.payload or {},
        'report': report_payload,
        'createdAt': job.created_at.isoformat() if job.created_at else None,
        'updatedAt': job.updated_at.isoformat() if job.updated_at else None,
        'startedAt': job.started_at.isoformat() if job.started_at else None,
        'completedAt': job.completed_at.isoformat() if job.completed_at else None,
    }
