"""Async PostgreSQL adapter using asyncpg."""

from __future__ import annotations

import logging
import re
from collections.abc import Iterable, Sequence
from typing import Any

import asyncpg

from master_clash.database.ports import AsyncDatabase

logger = logging.getLogger(__name__)


def _qmark_to_dollar(query: str) -> str:
    """Convert ? placeholders to $1, $2, ... style."""
    counter = [0]

    def replace(match: re.Match) -> str:
        counter[0] += 1
        return f"${counter[0]}"

    return re.sub(r"\?", replace, query)


class AsyncPgDatabase(AsyncDatabase):
    """Async PostgreSQL adapter with connection pooling."""

    db_type = "postgres"

    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    @classmethod
    async def create(cls, dsn: str, min_size: int = 2, max_size: int = 10) -> "AsyncPgDatabase":
        """Create instance with connection pool."""
        if "sslmode=" not in dsn:
            sep = "&" if "?" in dsn else "?"
            dsn = f"{dsn}{sep}sslmode=require"

        pool = await asyncpg.create_pool(dsn, min_size=min_size, max_size=max_size)
        logger.info(f"[DB] Pool created (min={min_size}, max={max_size})")
        return cls(pool)

    async def execute(self, query: str, params: Sequence[Any] | None = None) -> str:
        pg_query = _qmark_to_dollar(query)
        async with self._pool.acquire() as conn:
            return await conn.execute(pg_query, *(params or []))

    async def executemany(self, query: str, seq_of_params: Iterable[Sequence[Any]]) -> None:
        pg_query = _qmark_to_dollar(query)
        async with self._pool.acquire() as conn:
            await conn.executemany(pg_query, seq_of_params)

    async def fetchone(self, query: str, params: Sequence[Any] | None = None) -> dict[str, Any] | None:
        pg_query = _qmark_to_dollar(query)
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(pg_query, *(params or []))
            return dict(row) if row else None

    async def fetchall(self, query: str, params: Sequence[Any] | None = None) -> list[dict[str, Any]]:
        pg_query = _qmark_to_dollar(query)
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(pg_query, *(params or []))
            return [dict(row) for row in rows]

    async def fetchval(self, query: str, params: Sequence[Any] | None = None) -> Any:
        pg_query = _qmark_to_dollar(query)
        async with self._pool.acquire() as conn:
            return await conn.fetchval(pg_query, *(params or []))

    async def close(self) -> None:
        await self._pool.close()
        logger.info("[DB] Pool closed")

    def acquire(self):
        """Get connection for transactions."""
        return self._pool.acquire()
