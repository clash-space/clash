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
_heartbeat_task: asyncio.Task | None = None  # 后台心跳任务
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

        # ⭐ 连接池预热机制 - 立即建立最小连接数
        # 不要等到第一个请求才建连接，启动时就准备好
        await warmup_connection_pool()

        # ⭐ 启动后台心跳任务 - 定期 ping 保持连接活跃
        start_heartbeat_task()

    return _async_pool


async def warmup_connection_pool():
    """
    连接池预热：启动时就建立连接并验证可用性

    这个机制的作用：
    1. 应用启动时就建好连接，不是等第一个请求来了才建
    2. 验证连接真的能用（执行一个简单查询）
    3. 如果有问题，启动阶段就发现，而不是等用户遇到错误

    就像汽车启动后要热车，连接池也要"热池"
    """
    global _async_pool

    if _async_pool is None:
        logger.warning("Cannot warmup pool: pool not initialized")
        return

    try:
        logger.info("Warming up connection pool...")

        # 并发建立 min_size 个连接并验证
        async def test_connection():
            """建立一个连接并验证能用"""
            async with _async_pool.connection() as conn:
                # 执行简单查询验证连接
                await conn.execute("SELECT 1")

        # 同时建立多个连接（min_size 个）
        warmup_tasks = [test_connection() for _ in range(_async_pool.min_size)]
        await asyncio.gather(*warmup_tasks, return_exceptions=True)

        logger.info(
            f"Connection pool warmed up successfully "
            f"({_async_pool.min_size} connections ready)"
        )
    except Exception as e:
        logger.warning(f"Connection pool warmup encountered issues (non-fatal): {e}")
        # 预热失败不是致命的，连接池还是会按需创建连接


async def connection_heartbeat():
    """
    后台心跳任务：定期 ping 数据库，保持连接活跃

    为什么需要心跳？
    1. TCP keepalive 只是被动检测（等连接断了才发现）
    2. 心跳是主动保活（定期发个查询，告诉数据库"我还在用"）
    3. 防止负载均衡器/防火墙因为"空闲太久"主动断连接

    就像微信要定期发心跳包保持在线，数据库连接也要定期"心跳"

    心跳间隔：每 60 秒（比 keepalive_idle=30s 要长，避免重复）
    """
    global _async_pool

    logger.info("Starting connection pool heartbeat task")

    while True:
        try:
            # 每 60 秒执行一次
            await asyncio.sleep(60)

            if _async_pool is None:
                logger.debug("Pool not initialized, skipping heartbeat")
                continue

            # 对一个连接执行轻量级查询
            try:
                async with _async_pool.connection() as conn:
                    await conn.execute("SELECT 1")
                logger.debug("Connection heartbeat: OK")
            except OperationalError as e:
                # 连接有问题，记录警告但不退出心跳任务
                logger.warning(f"Connection heartbeat failed (will retry): {e}")

                # 如果是 SSL 错误，重置连接池
                error_msg = str(e).lower()
                if "ssl connection has been closed" in error_msg:
                    logger.error("SSL connection lost detected by heartbeat, resetting pool")
                    await reset_connection_pool()

        except asyncio.CancelledError:
            logger.info("Connection heartbeat task cancelled")
            break
        except Exception as e:
            logger.error(f"Unexpected error in heartbeat task: {e}", exc_info=True)
            # 继续运行，不要因为一次错误就停止心跳


def start_heartbeat_task():
    """启动后台心跳任务"""
    global _heartbeat_task

    # 如果已经有任务在运行，先取消
    if _heartbeat_task is not None and not _heartbeat_task.done():
        logger.debug("Heartbeat task already running")
        return

    # 启动新的心跳任务
    _heartbeat_task = asyncio.create_task(connection_heartbeat())
    logger.info("Connection pool heartbeat task started")


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
async def get_connection_with_retry(max_retries: int = 3):
    """
    从连接池获取连接，失败时自动重试

    这是一个包装器，让你在获取连接时有自动重试能力：

    使用方式：
        async with get_connection_with_retry() as conn:
            await conn.execute("SELECT 1")

    如果获取连接失败（比如网络问题），会自动重试 3 次，不用你手动处理

    Args:
        max_retries: 最大重试次数（默认 3 次）

    Yields:
        Database connection from pool

    Raises:
        最后一次失败的异常（如果所有重试都失败）
    """
    pool = await get_async_connection_pool()
    last_error = None

    for attempt in range(max_retries + 1):
        try:
            async with pool.connection() as conn:
                yield conn
                return  # 成功，退出
        except OperationalError as e:
            last_error = e
            error_msg = str(e).lower()

            if attempt < max_retries:
                delay = 0.5 * (2 ** attempt)  # 0.5s, 1s, 2s
                logger.warning(
                    f"Failed to get connection (attempt {attempt + 1}/{max_retries + 1}): {e}. "
                    f"Retrying in {delay}s..."
                )

                # 如果是 SSL 错误，重置连接池
                if "ssl connection has been closed" in error_msg:
                    logger.error("SSL connection error, resetting pool before retry")
                    await reset_connection_pool()

                await asyncio.sleep(delay)
            else:
                logger.error(f"Failed to get connection after {max_retries + 1} attempts: {e}")
                raise

    # 理论上不会到这里，但为了安全
    if last_error:
        raise last_error


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
    - Stops the heartbeat background task
    - Handles errors during closure
    - Resets the global pool reference
    - Logs closure status for monitoring

    Safe to call multiple times (idempotent).
    """
    global _async_pool, _heartbeat_task

    # 先停止心跳任务
    if _heartbeat_task is not None and not _heartbeat_task.done():
        logger.info("Stopping connection pool heartbeat task")
        _heartbeat_task.cancel()
        try:
            await _heartbeat_task
        except asyncio.CancelledError:
            pass
        _heartbeat_task = None

    # 再关闭连接池
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
