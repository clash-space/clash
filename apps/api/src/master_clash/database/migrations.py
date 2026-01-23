"""Database migrations using SQLAlchemy."""

import logging

from master_clash.config import get_settings
from master_clash.database.models import Base

logger = logging.getLogger(__name__)


async def apply_migrations() -> int:
    """
    Create all tables defined in ORM models.

    Returns:
        Number of tables (note: checkfirst=True prevents duplicates)
    """
    from sqlalchemy.ext.asyncio import create_async_engine

    settings = get_settings()
    db_url = settings.database_url

    if not db_url or not db_url.startswith(("postgres://", "postgresql://")):
        raise ValueError("DATABASE_URL must be PostgreSQL")

    # Convert to asyncpg driver
    if db_url.startswith("postgresql://"):
        base_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    else:
        base_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)

    # Remove URL parameters (asyncpg uses connect_args)
    base_url = base_url.split("?")[0].split("#")[0]

    # Create temporary engine for migrations
    engine = create_async_engine(
        base_url,
        echo=False,
        connect_args={"ssl": "require"},
    )

    try:
        # Create all tables with checkfirst=True (default behavior)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        table_count = len(Base.metadata.tables)
        logger.info(f"[Migrations] ✅ Schema ready with {table_count} table(s)")
        return table_count
    finally:
        await engine.dispose()


if __name__ == "__main__":
    import asyncio

    async def main():
        count = await apply_migrations()
        print(f"Schema ready with {count} table(s)")

    asyncio.run(main())
