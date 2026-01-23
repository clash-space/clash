"""SQLite connection for LangGraph SqliteSaver (legacy checkpointer only)."""

import sqlite3
from pathlib import Path

from master_clash.config import get_settings


def get_db_path() -> Path:
    """Get the SQLite database file path for checkpointer."""
    settings = get_settings()

    if settings.database_url and settings.database_url.startswith("sqlite:///"):
        db_path = settings.database_url.replace("sqlite:///", "")
        return Path(db_path)

    # Default to local data directory
    return Path("data/checkpoints.db")


def get_db_connection() -> sqlite3.Connection:
    """Get a SQLite connection for LangGraph SqliteSaver."""
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def init_database(db_path: Path | None = None) -> None:
    """Initialize database for SQLite checkpointer (legacy)."""
    path = db_path or get_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"SQLite checkpointer DB at: {path}")


if __name__ == "__main__":
    init_database()
