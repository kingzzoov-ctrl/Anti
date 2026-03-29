from datetime import datetime

from sqlalchemy import DateTime, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class SocialThread(Base):
    __tablename__ = 'social_threads'

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id_a: Mapped[str] = mapped_column(String(64), index=True)
    user_id_b: Mapped[str] = mapped_column(String(64), index=True)
    match_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    unlock_stage: Mapped[int] = mapped_column(default=0)
    icebreakers: Mapped[list] = mapped_column(JSON, default=list)
    tension_report: Mapped[dict] = mapped_column(JSON, default=dict)
    unlock_milestones: Mapped[list] = mapped_column(JSON, default=list)
    messages: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)