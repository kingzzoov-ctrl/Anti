from datetime import datetime
from sqlalchemy import Boolean, DateTime, JSON, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base


class UserProfile(Base):
    __tablename__ = 'user_profiles'

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tier: Mapped[str] = mapped_column(String(50), default='Free')
    token_balance: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    notification_channels: Mapped[dict] = mapped_column(JSON, default=dict)
    matching_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    privacy_consent_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    privacy_consent_scope: Mapped[str | None] = mapped_column(String(255), nullable=True)
    privacy_consent_accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
