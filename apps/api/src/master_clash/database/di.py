"""Async database dependency injection with SQLAlchemy."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from master_clash.config import get_settings
from master_clash.database.models import Base

# Global async engine and session factory
_async_engine = None
_async_session_factory = None


async def init_db() -> None:
    """Initialize async database engine and create tables."""
    global _async_engine, _async_session_factory

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    settings = get_settings()
    db_url = settings.database_url

    if not db_url or not db_url.startswith(("postgres://", "postgresql://")):
        raise ValueError("DATABASE_URL must be PostgreSQL")

    # Convert to asyncpg driver and clean URL parameters
    if db_url.startswith("postgresql://"):
        base_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    elif db_url.startswith("postgres://"):
        base_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)
    else:
        base_url = db_url

    # Remove sslmode from URL (asyncpg uses connect_args instead)
    base_url = base_url.split("?")[0].split("#")[0]

    _async_engine = create_async_engine(
        base_url,
        echo=False,
        pool_size=20,
        max_overflow=10,
        connect_args={"ssl": "require"},  # asyncpg SSL configuration
    )

    _async_session_factory = async_sessionmaker(
        _async_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    print(f"[DB] Initialized: {settings.database_url[:30]}...")


async def close_db() -> None:
    """Close database engine."""
    global _async_engine, _async_session_factory

    if _async_engine:
        await _async_engine.dispose()
        _async_engine = None
        _async_session_factory = None
        print("[DB] Closed")


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Get async database session (dependency injection)."""
    from sqlalchemy.ext.asyncio import AsyncSession

    if _async_session_factory is None:
        await init_db()

    async with _async_session_factory() as session:
        yield session


@asynccontextmanager
async def get_db_context() -> AsyncGenerator[AsyncSession, None]:
    """Get database session as context manager."""
    from sqlalchemy.ext.asyncio import AsyncSession

    if _async_session_factory is None:
        await init_db()

    async with _async_session_factory() as session:
        yield session


# Legacy compatibility for non-async code
def get_database():
    """Legacy sync database - DEPRECATED. Use get_db_context() instead."""
    import warnings
    warnings.warn(
        "get_database() is deprecated. Use async get_db_context() instead.",
        DeprecationWarning,
        stacklevel=2
    )
    raise RuntimeError(
        "Synchronous database access is removed. "
        "Use 'async with get_db_context() as session:' for async operations."
    )
