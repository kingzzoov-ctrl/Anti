from contextlib import asynccontextmanager
from threading import Event, Thread
from time import sleep

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import get_settings
from app.api.v1.router import api_router
from app.db.session import Base, SessionLocal, engine
from app.services.notification_service import run_notification_worker_loop
from app.services.report_jobs import run_report_job_worker_loop
from app.services.bootstrap import bootstrap_defaults

settings = get_settings()


def _run_report_job_worker(stop_event: Event) -> None:
    while not stop_event.is_set():
        run_report_job_worker_loop(
            SessionLocal,
            stop_when_idle=True,
            max_jobs=1,
            poll_interval_seconds=settings.report_worker_poll_interval_seconds,
        )
        sleep(settings.report_worker_poll_interval_seconds)


def _run_notification_worker(stop_event: Event) -> None:
    while not stop_event.is_set():
        run_notification_worker_loop(
            SessionLocal,
            stop_when_idle=True,
            max_events=1,
            poll_interval_seconds=settings.notification_worker_poll_interval_seconds,
        )
        sleep(settings.notification_worker_poll_interval_seconds)


@asynccontextmanager
async def lifespan(_: FastAPI):
    db = SessionLocal()
    try:
        Base.metadata.create_all(bind=engine)
        bootstrap_defaults(db)
    finally:
        db.close()

    stop_event = Event()
    report_worker = Thread(target=_run_report_job_worker, args=(stop_event,), daemon=True, name='ariadne-report-worker')
    notification_worker = Thread(target=_run_notification_worker, args=(stop_event,), daemon=True, name='ariadne-notification-worker')
    report_worker.start()
    notification_worker.start()
    try:
        yield
    finally:
        stop_event.set()
        report_worker.join(timeout=3)
        notification_worker.join(timeout=3)



app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)
app.include_router(api_router, prefix=settings.api_prefix)


@app.get('/healthz')
def healthz():
    return {'ok': True, 'service': settings.app_name}
