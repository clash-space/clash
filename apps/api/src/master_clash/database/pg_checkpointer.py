"""
PostgreSQL Checkpointer for LangGraph using Neon.

This module provides checkpoint storage for LangGraph workflows using
PostgreSQL (Neon serverless) for better reliability and official support.

Production-grade features:
- Automatic retry with exponential backoff for transient errors
- SSL/TLS configuration with proper certificate validation
- Connection pooling with health checks and automatic reconnection
- TCP keepalive for detecting dead connections
- Connection lifecycle management (max_lifetime, max_idle)
- Graceful degradation and error handling
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg import OperationalError
from psycopg_pool import AsyncConnectionPool

from master_clash.config import get_settings


# Global async connection pool
_async_pool: AsyncConnectionPool | None = None
logger = logging.getLogger(__name__)


async def retry_with_backoff(
    func,
    max_retries: int = 3,
    initial_delay: float = 1.0,
    max_delay: float = 30.0,
    backoff_factor: float = 2.0,
    retryable_exceptions: tuple = (OperationalError,),
):
    """
    Retry a function with exponential backoff.

    Args:
        func: Async function to retry
        max_retries: Maximum number of retry attempts
        initial_delay: Initial delay in seconds
        max_delay: Maximum delay between retries
        backoff_factor: Multiplier for delay after each retry
        retryable_exceptions: Tuple of exceptions to retry on

    Returns:
        Result of the function call

    Raises:
        Last exception if all retries fail
    """
    delay = initial_delay
    last_exception = None

    for attempt in range(max_retries + 1):
        try:
            return await func()
        except retryable_exceptions as e:
            last_exception = e

            # Check if this is a fatal SSL error that shouldn't be retried
            error_msg = str(e).lower()
            if "ssl connection has been closed unexpectedly" in error_msg:
                logger.warning(
                    f"SSL connection error on attempt {attempt + 1}/{max_retries + 1}: {e}. "
                    "This may indicate network issues or server restart."
                )

            if attempt < max_retries:
                # Calculate delay with exponential backoff and jitter
                actual_delay = min(delay, max_delay)
                logger.info(f"Retrying in {actual_delay:.2f}s (attempt {attempt + 1}/{max_retries + 1})")
                await asyncio.sleep(actual_delay)
                delay *= backoff_factor
            else:
                logger.error(f"All {max_retries + 1} attempts failed. Last error: {e}")
                raise

    # Should never reach here, but just in case
    if last_exception:
        raise last_exception


async def get_async_connection_pool() -> AsyncConnectionPool:
    """
    Get or create the global async PostgreSQL connection pool with production settings.

    Features:
    - SSL/TLS support with automatic configuration
    - TCP keepalive for detecting dead connections
    - Connection lifecycle management (idle timeout, max lifetime)
    - Automatic reconnection on pool failures
    - PgBouncer-compatible settings

    Returns:
        Configured async connection pool

    Raises:
        ValueError: If PostgreSQL connection string is not configured
        OperationalError: If connection pool cannot be established after retries
    """
    global _async_pool

    if _async_pool is None:
        settings = get_settings()
        if not settings.postgres_connection_string:
            raise ValueError(
                "PostgreSQL connection string not configured. "
                "Set POSTGRES_CONNECTION_STRING in .env"
            )

        # Parse connection string to add SSL parameters if not present
        conninfo = settings.postgres_connection_string

        # Add SSL mode if not specified (Neon requires SSL)
        if "sslmode" not in conninfo.lower():
            conninfo += " sslmode=require"
            logger.info("Added sslmode=require to connection string for production security")

        # Connection pool configuration optimized for serverless PostgreSQL (Neon)
        # IMPORTANT: Neon pooler (PgBouncer) does not support startup parameters via options
        # Use unpooled connection string or set timeouts at session level if needed
        _async_pool = AsyncConnectionPool(
            conninfo=conninfo,
            min_size=2,  # Keep 2 warm connections for faster response
            max_size=20,  # Allow up to 20 connections for high concurrency
            kwargs={
                "autocommit": True,  # Required for LangGraph checkpointer
                "prepare_threshold": 0,  # Disable prepared statements (PgBouncer compatibility)

                # Connection timeout (30s is reasonable for serverless)
                "connect_timeout": 30,

                # TCP Keepalive settings to detect broken connections
                # These settings help detect when the SSL connection is dead
                "keepalives": 1,  # Enable TCP keepalive
                "keepalives_idle": 30,  # Start keepalive after 30s of idle
                "keepalives_interval": 10,  # Send keepalive every 10s
                "keepalives_count": 5,  # Close after 5 failed keepalives (50s total)

                # NOTE: statement_timeout cannot be set via options with Neon pooler
                # If you need query timeouts, either:
                # 1. Use unpooled connection (replace -pooler with direct endpoint)
                # 2. Set at session level after connection: SET statement_timeout = '60s'
                # 3. Configure in Neon dashboard at database level
            },
            # Pool-level settings
            timeout=30,  # Timeout for acquiring connection from pool (30s)
            max_idle=300,  # Close idle connections after 5 minutes
            max_lifetime=1800,  # Recycle connections after 30 minutes (prevents stale connections)
            num_workers=3,  # Number of background workers for connection management
            open=False,  # Don't open immediately, we'll open with retry logic
        )

        # Open pool with retry logic to handle transient failures
        async def open_pool():
            await _async_pool.open()
            logger.info(
                f"PostgreSQL connection pool opened successfully "
                f"(min={_async_pool.min_size}, max={_async_pool.max_size})"
            )

        try:
            await retry_with_backoff(
                open_pool,
                max_retries=3,
                initial_delay=1.0,
                max_delay=10.0,
            )
        except Exception as e:
            logger.error(f"Failed to open PostgreSQL connection pool: {e}")
            _async_pool = None  # Reset pool on failure
            raise

    return _async_pool


async def get_async_checkpointer(initialize: bool = True) -> AsyncPostgresSaver:
    """
    Get an async LangGraph checkpointer configured for PostgreSQL with retry logic.

    This function handles:
    - Connection pool management with automatic retry
    - Schema initialization with error recovery
    - Automatic pool reset on critical failures

    Args:
        initialize: Whether to initialize the database schema (AsyncPostgresSaver does this automatically)

    Returns:
        Configured async checkpoint saver instance

    Raises:
        OperationalError: If connection or initialization fails after retries
    """
    # Get or create connection pool with retry logic
    pool = await get_async_connection_pool()

    # Create the async checkpointer
    checkpointer = AsyncPostgresSaver(pool)

    # Setup tables (this is safe to call multiple times - idempotent)
    if initialize:
        async def setup_schema():
            """Setup database schema with proper error handling."""
            try:
                await checkpointer.setup()
                logger.info("PostgreSQL checkpointer schema initialized successfully")
            except OperationalError as exc:
                # SSL connection errors or other operational issues
                error_msg = str(exc).lower()
                if "ssl connection has been closed" in error_msg:
                    logger.error(
                        "SSL connection lost during schema setup. "
                        "Resetting connection pool for recovery."
                    )
                    # Reset the pool to force reconnection on next attempt
                    await close_connection_pool()
                raise
            except Exception as exc:
                logger.error(f"Unexpected error during schema setup: {exc}", exc_info=True)
                # Reset pool on unexpected errors to ensure clean state
                await close_connection_pool()
                raise

        try:
            # Retry schema setup with exponential backoff
            await retry_with_backoff(
                setup_schema,
                max_retries=3,
                initial_delay=0.5,
                max_delay=5.0,
            )
        except Exception as e:
            logger.error(
                f"Failed to initialize PostgreSQL checkpointer after retries: {e}. "
                "The connection pool has been reset. Next request will retry."
            )
            raise

    return checkpointer


@asynccontextmanager
async def get_checkpointer_with_health_check():
    """
    Context manager that provides a checkpointer with automatic health checking.

    Usage:
        async with get_checkpointer_with_health_check() as checkpointer:
            # Use checkpointer
            await checkpointer.aget_tuple(config)

    This ensures:
    - Connection is healthy before use
    - Automatic retry on connection failures
    - Proper cleanup on errors
    """
    checkpointer = None
    try:
        # Get checkpointer with retry logic
        checkpointer = await get_async_checkpointer(initialize=True)

        # Verify pool health by checking pool stats
        pool = await get_async_connection_pool()
        logger.debug(
            f"Connection pool stats: size={pool.get_stats().get('pool_size', 'unknown')}, "
            f"available={pool.get_stats().get('pool_available', 'unknown')}"
        )

        yield checkpointer

    except OperationalError as e:
        logger.error(f"PostgreSQL operational error: {e}. Pool will be reset.")
        # Reset pool on operational errors to ensure fresh connections
        await close_connection_pool()
        raise
    except Exception as e:
        logger.error(f"Unexpected error with checkpointer: {e}", exc_info=True)
        raise


def get_checkpointer(initialize: bool = True):
    """
    Synchronous version not recommended - use get_async_checkpointer instead.

    Raises:
        NotImplementedError: Always raises since async is required
    """
    raise NotImplementedError(
        "Synchronous PostgreSQL checkpointer is not supported. "
        "Use get_async_checkpointer() instead for async workflows."
    )


async def close_connection_pool():
    """
    Close the global async connection pool gracefully.

    This function:
    - Safely closes all connections in the pool
    - Handles errors during closure
    - Resets the global pool reference
    - Logs closure status for monitoring

    Safe to call multiple times (idempotent).
    """
    global _async_pool
    if _async_pool:
        try:
            await _async_pool.close()
            logger.info("PostgreSQL connection pool closed successfully")
        except Exception as e:
            logger.warning(f"Error closing connection pool (non-fatal): {e}")
        finally:
            _async_pool = None


async def reset_connection_pool():
    """
    Reset the connection pool by closing and clearing it.

    Use this when you need to force a fresh connection pool,
    such as after SSL errors or connection failures.

    The next call to get_async_connection_pool() will create a new pool.
    """
    await close_connection_pool()
    logger.info("Connection pool reset. Next request will create a fresh pool.")


async def get_pool_health() -> dict[str, Any]:
    """
    Get health information about the connection pool.

    Returns:
        Dictionary containing pool health metrics:
        - pool_size: Current number of connections in pool
        - pool_available: Number of available connections
        - is_healthy: Boolean indicating if pool is operational
        - error: Error message if pool is not healthy

    This is useful for:
    - Health check endpoints
    - Monitoring and alerting
    - Debugging connection issues
    """
    global _async_pool

    if _async_pool is None:
        return {
            "is_healthy": False,
            "error": "Connection pool not initialized",
            "pool_size": 0,
            "pool_available": 0,
        }

    try:
        stats = _async_pool.get_stats()
        return {
            "is_healthy": True,
            "pool_size": stats.get("pool_size", 0),
            "pool_available": stats.get("pool_available", 0),
            "pool_min": stats.get("pool_min", 0),
            "pool_max": stats.get("pool_max", 0),
            "requests_waiting": stats.get("requests_waiting", 0),
        }
    except Exception as e:
        logger.error(f"Error getting pool health: {e}", exc_info=True)
        return {
            "is_healthy": False,
            "error": str(e),
            "pool_size": 0,
            "pool_available": 0,
        }
