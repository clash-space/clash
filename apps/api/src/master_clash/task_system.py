"""Unified Task System with Persistent Retry - SQLAlchemy ORM version."""

import asyncio
import logging
import random
from datetime import datetime
from enum import Enum

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from master_clash.database.di import get_db_context
from master_clash.database.models import AigcTask

logger = logging.getLogger(__name__)


# === Task Status Enum ===

class TaskStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    DEAD = "dead"


# === Retry Strategy ===

class RetryStrategy(str, Enum):
    EXPONENTIAL = "exponential"
    LINEAR = "linear"
    FIXED = "fixed"


# === Configuration ===

DEFAULT_MAX_RETRIES = 3
LEASE_DURATION_MS = 3 * 60 * 1000  # 3 minutes
WORKER_ID = f"worker_{random.getrandbits(32):08x}"


def calculate_retry_delay(
    retry_count: int,
    strategy: RetryStrategy = RetryStrategy.EXPONENTIAL,
    initial_delay_ms: int = 5000,
    max_delay_ms: int = 300000,
    backoff_factor: float = 2.0,
    jitter_factor: float = 0.1,
) -> int:
    """Calculate retry delay with backoff and jitter."""
    if strategy == RetryStrategy.EXPONENTIAL:
        delay_ms = initial_delay_ms * (backoff_factor ** retry_count)
    elif strategy == RetryStrategy.LINEAR:
        delay_ms = initial_delay_ms * (1 + retry_count)
    else:
        delay_ms = initial_delay_ms

    delay_ms = min(delay_ms, max_delay_ms)
    jitter = random.uniform(-jitter_factor, jitter_factor) * delay_ms
    return int(delay_ms + jitter)


# === Task Operations ===

class TaskSystem:
    """Unified task system with ORM."""

    @staticmethod
    async def claim_task(task_id: str, worker_id: str | None = None) -> bool:
        """
        [ATOMIC] Claim task for processing with lease.

        Returns True if claimed, False if already claimed.
        """
        worker_id = worker_id or WORKER_ID
        now = int(datetime.utcnow().timestamp() * 1000)
        lease_expires = now + LEASE_DURATION_MS

        async with get_db_context() as session:
            result = await session.execute(
                select(AigcTask).where(
                    (AigcTask.task_id == task_id)
                    & (AigcTask.status == TaskStatus.PENDING)
                )
            )
            task = result.scalar_one_or_none()

            if not task:
                return False

            task.status = TaskStatus.PROCESSING
            task.worker_id = worker_id
            task.heartbeat_at = now
            task.lease_expires_at = lease_expires
            task.updated_at = now
            await session.commit()

            logger.info(f"[TaskSystem] ✅ Claimed task: {task_id[:8]} by {worker_id}")
            return True

    @staticmethod
    async def complete_task(
        task_id: str,
        result_url: str | None = None,
        result_data: dict | None = None,
    ) -> bool:
        """[ATOMIC] Mark task as completed."""
        now = int(datetime.utcnow().timestamp() * 1000)

        async with get_db_context() as session:
            result = await session.execute(
                select(AigcTask).where(
                    (AigcTask.task_id == task_id)
                    & (AigcTask.status == TaskStatus.PROCESSING)
                )
            )
            task = result.scalar_one_or_none()

            if not task:
                return False

            task.status = TaskStatus.COMPLETED
            task.result_url = result_url
            task.result_data = result_data if result_data else None  # SQLAlchemy JSON type handles serialization
            task.updated_at = now
            task.completed_at = now
            await session.commit()

            logger.info(f"[TaskSystem] ✅ Completed task: {task_id[:8]}")
            return True

    @staticmethod
    async def fail_task(
        task_id: str,
        error_message: str,
        retry_strategy: RetryStrategy = RetryStrategy.EXPONENTIAL,
    ) -> bool:
        """[ATOMIC] Mark task failed and schedule retry if available."""
        now = int(datetime.utcnow().timestamp() * 1000)

        async with get_db_context() as session:
            result = await session.execute(
                select(AigcTask).where(AigcTask.task_id == task_id)
            )
            task = result.scalar_one_or_none()

            if not task:
                return False

            # Check if max retries exceeded
            if task.retry_count >= task.max_retries:
                task.status = TaskStatus.DEAD
                task.error_message = f"Max retries exceeded: {error_message}"
                task.updated_at = now
                await session.commit()
                logger.warning(f"[TaskSystem] ❌ Task {task_id[:8]} permanently failed")
                return False

            # Schedule retry
            delay_ms = calculate_retry_delay(task.retry_count, retry_strategy)
            next_retry_at = now + delay_ms

            task.status = TaskStatus.FAILED
            task.error_message = error_message
            task.retry_count = task.retry_count + 1
            task.last_retry_at = now
            task.next_retry_at = next_retry_at
            task.retry_strategy = retry_strategy.value
            task.updated_at = now
            task.worker_id = None
            task.heartbeat_at = None
            task.lease_expires_at = None
            await session.commit()

            logger.info(f"[TaskSystem] 🔄 Scheduled retry {task.retry_count}/{task.max_retries}")
            return True

    @staticmethod
    async def renew_lease(task_id: str) -> bool:
        """Renew task lease."""
        now = int(datetime.utcnow().timestamp() * 1000)
        lease_expires = now + LEASE_DURATION_MS

        async with get_db_context() as session:
            result = await session.execute(
                select(AigcTask).where(AigcTask.task_id == task_id)
            )
            task = result.scalar_one_or_none()

            if not task:
                return False

            task.heartbeat_at = now
            task.lease_expires_at = lease_expires
            task.updated_at = now
            await session.commit()

            return True

    @staticmethod
    async def reset_task_for_retry(task_id: str) -> bool:
        """Reset failed task to pending for retry."""
        now = int(datetime.utcnow().timestamp() * 1000)

        async with get_db_context() as session:
            result = await session.execute(
                select(AigcTask).where(
                    (AigcTask.task_id == task_id)
                    & (AigcTask.status == TaskStatus.FAILED)
                )
            )
            task = result.scalar_one_or_none()

            if not task:
                return False

            task.status = TaskStatus.PENDING
            task.worker_id = None
            task.heartbeat_at = None
            task.lease_expires_at = None
            task.updated_at = now
            await session.commit()

            logger.info(f"[TaskSystem] 🔄 Reset task {task_id[:8]} for retry")
            return True

    @staticmethod
    async def cleanup_expired_leases() -> int:
        """Reset tasks with expired leases back to pending."""
        now = int(datetime.utcnow().timestamp() * 1000)

        async with get_db_context() as session:
            result = await session.execute(
                select(AigcTask).where(
                    (AigcTask.status == TaskStatus.PROCESSING)
                    & (AigcTask.lease_expires_at < now)
                )
            )
            tasks = result.scalars().all()

            count = len(tasks)
            if count > 0:
                for task in tasks:
                    task.status = TaskStatus.PENDING
                    task.worker_id = None
                    task.heartbeat_at = None
                    task.lease_expires_at = None
                    task.updated_at = now

                await session.commit()
                logger.warning(f"[TaskSystem] 🔓 Released {count} expired leases")

            return count


# === Background Scheduler ===

async def _scheduler_loop(
    retry_interval_seconds: int = 10,
    lease_cleanup_interval_seconds: int = 30,
):
    """Background scheduler for retries and lease cleanup."""
    logger.info("[TaskScheduler] 🚀 Starting scheduler")

    while True:
        try:
            # Cleanup expired leases
            await TaskSystem.cleanup_expired_leases()

            # Sleep before next cycle
            await asyncio.sleep(retry_interval_seconds)

        except Exception as e:
            logger.error(f"[TaskScheduler] ❌ Error: {e}", exc_info=True)
            await asyncio.sleep(retry_interval_seconds)


def start_task_scheduler():
    """Start background task scheduler."""
    asyncio.create_task(_scheduler_loop())
    logger.info("[TaskScheduler] ✅ Started")


# === Legacy API Compatibility ===

def get_database():
    """Legacy compatibility - deprecated."""
    raise RuntimeError("Use get_db_context() instead")


# Export TaskSystem class for direct use
claim_task = TaskSystem.claim_task
complete_task = TaskSystem.complete_task
fail_task = TaskSystem.fail_task
renew_lease = TaskSystem.renew_lease
reset_task_for_retry = TaskSystem.reset_task_for_retry
cleanup_expired_leases = TaskSystem.cleanup_expired_leases
