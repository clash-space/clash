"""Async database abstraction port.

Single async interface for PostgreSQL via asyncpg.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterable, Sequence
from typing import Any


class AsyncDatabase(ABC):
    """Async database interface."""

    db_type: str = "postgres"

    @abstractmethod
    async def execute(self, query: str, params: Sequence[Any] | None = None) -> str:
        """Execute query, return status."""
        ...

    @abstractmethod
    async def executemany(self, query: str, seq_of_params: Iterable[Sequence[Any]]) -> None:
        """Execute query with multiple param sets."""
        ...

    @abstractmethod
    async def fetchone(self, query: str, params: Sequence[Any] | None = None) -> dict[str, Any] | None:
        """Fetch single row as dict."""
        ...

    @abstractmethod
    async def fetchall(self, query: str, params: Sequence[Any] | None = None) -> list[dict[str, Any]]:
        """Fetch all rows as list of dicts."""
        ...

    @abstractmethod
    async def fetchval(self, query: str, params: Sequence[Any] | None = None) -> Any:
        """Fetch single value."""
        ...

    @abstractmethod
    async def close(self) -> None:
        """Close connection pool."""
        ...
