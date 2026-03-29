from time import sleep

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.services.notification_service import run_notification_worker_loop


def main() -> None:
    settings = get_settings()
    while True:
        run_notification_worker_loop(
            SessionLocal,
            stop_when_idle=True,
            max_events=1,
            poll_interval_seconds=settings.notification_worker_poll_interval_seconds,
        )
        sleep(settings.notification_worker_poll_interval_seconds)


if __name__ == '__main__':
    main()
