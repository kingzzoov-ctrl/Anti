from datetime import datetime
from sqlalchemy import String, DateTime, Float, Boolean, JSON
from sqlalchemy.orm import Mapped, mapped_column
from pgvector.sqlalchemy import Vector
from app.db.session import Base


class InsightReport(Base):
    __tablename__ = 'insight_reports'

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    raw_content: Mapped[dict] = mapped_column(JSON, nullable=False)
    v_feature: Mapped[list[float] | None] = mapped_column(Vector(7), nullable=True)
    v_embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
    consistency_score: Mapped[float] = mapped_column(Float, default=0)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
