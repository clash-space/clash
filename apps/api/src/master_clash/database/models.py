"""SQLAlchemy ORM models."""

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Index, JSON, String, Text, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class AigcTask(Base):
    """AIGC task model."""

    __tablename__ = "aigc_tasks"

    task_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    task_type: Mapped[str] = mapped_column(String(32), nullable=False)
    provider: Mapped[str] = mapped_column(String(32), default="python")
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    params: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    result_url: Mapped[str | None] = mapped_column(Text)
    result_data: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    error_message: Mapped[str | None] = mapped_column(Text)
    worker_id: Mapped[str | None] = mapped_column(String(64))
    heartbeat_at: Mapped[int | None] = mapped_column(BigInteger)
    lease_expires_at: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    completed_at: Mapped[int | None] = mapped_column(BigInteger)
    max_retries: Mapped[int] = mapped_column(default=3)
    retry_count: Mapped[int] = mapped_column(default=0)
    last_retry_at: Mapped[int | None] = mapped_column(BigInteger)
    next_retry_at: Mapped[int | None] = mapped_column(BigInteger)
    retry_strategy: Mapped[str | None] = mapped_column(String(32))
    external_task_id: Mapped[str | None] = mapped_column(String(128))
    external_service: Mapped[str | None] = mapped_column(String(64))

    __table_args__ = (
        Index("idx_tasks_status_lease", "status", "lease_expires_at"),
        Index("idx_tasks_retry", "status", "next_retry_at"),
    )

    def to_dict(self) -> dict[str, Any]:
        return {c.name: getattr(self, c.name) for c in self.__table__.columns}


class SessionInterrupt(Base):
    """Session interrupt model."""

    __tablename__ = "session_interrupts"

    thread_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), default="running")
    title: Mapped[str | None] = mapped_column(Text)
    interrupted_at: Mapped[datetime | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(server_default=text("CURRENT_TIMESTAMP"))
    is_deleted: Mapped[int] = mapped_column(default=0)
    deleted_at: Mapped[datetime | None] = mapped_column()

    __table_args__ = (
        Index("idx_session_deleted", "is_deleted", "project_id"),
    )


class SessionEvent(Base):
    """Session event model for history replay."""

    __tablename__ = "session_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    thread_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(server_default=text("CURRENT_TIMESTAMP"))
