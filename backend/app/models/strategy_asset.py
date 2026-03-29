from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class StrategyAsset(Base):
    __tablename__ = 'strategy_assets'

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    asset_key: Mapped[str] = mapped_column(String(128), index=True)
    version: Mapped[str] = mapped_column(String(64), index=True)
    asset_type: Mapped[str] = mapped_column(String(32), default='prompt')
    title: Mapped[str] = mapped_column(String(255), default='')
    content: Mapped[str] = mapped_column(Text)
    source_path: Mapped[str] = mapped_column(String(255), default='')
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)