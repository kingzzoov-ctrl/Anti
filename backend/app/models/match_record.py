from datetime import datetime

from sqlalchemy import DateTime, Float, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class MatchRecord(Base):
    __tablename__ = 'match_records'

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id_a: Mapped[str] = mapped_column(String(64), index=True)
    user_id_b: Mapped[str] = mapped_column(String(64), index=True)
    source_report_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    resonance_score: Mapped[float] = mapped_column(Float, default=0)
    match_analysis: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(32), default='complete')
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)