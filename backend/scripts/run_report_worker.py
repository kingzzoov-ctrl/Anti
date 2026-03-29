from app.db.session import SessionLocal
from app.services.report_jobs import run_report_job_worker_loop
from app.core.config import get_settings


def main() -> int:
    settings = get_settings()
    processed = run_report_job_worker_loop(
        SessionLocal,
        stop_when_idle=False,
        max_jobs=None,
        poll_interval_seconds=settings.report_worker_poll_interval_seconds,
    )
    return processed


if __name__ == '__main__':
    main()
