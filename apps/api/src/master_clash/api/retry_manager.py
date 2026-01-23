"""Unified Retry Manager for AIGC Tasks - SQLAlchemy ORM version."""

import asyncio
import logging
import random
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from master_clash.database.di import get_db_context
from master_clash.database.models import AigcTask

logger = logging.getLogger(__name__)

# Retry strategies
RETRY_STRATEGY_EXPONENTIAL = "exponential"
RETRY_STRATEGY_LINEAR = "linear"
RETRY_STRATEGY_FIXED = "fixed"

# Configuration
DEFAULT_MAX_RETRIES = 3
DEFAULT_INITIAL_DELAY_MS = 5000
DEFAULT_MAX_DELAY_MS = 300000
DEFAULT_BACKOFF_FACTOR = 2.0
DEFAULT_JITTER_FACTOR = 0.1

STATUS_PENDING = "pending"
STATUS_PROCESSING = "processing"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"


def calculate_next_retry_time(
    retry_count: int,
    strategy: str = RETRY_STRATEGY_EXPONENTIAL,
    initial_delay_ms: int = DEFAULT_INITIAL_DELAY_MS,
    max_delay_ms: int = DEFAULT_MAX_DELAY_MS,
    backoff_factor: float = DEFAULT_BACKOFF_FACTOR,
    jitter_factor: float = DEFAULT_JITTER_FACTOR,
) -> int:
    """Calculate next retry timestamp with backoff and jitter."""
    now = int(datetime.utcnow().timestamp() * 1000)

    if strategy == RETRY_STRATEGY_EXPONENTIAL:
        delay_ms = initial_delay_ms * (backoff_factor ** retry_count)
    elif strategy == RETRY_STRATEGY_LINEAR:
        delay_ms = initial_delay_ms * (1 + retry_count)
    else:
        delay_ms = initial_delay_ms

    delay_ms = min(delay_ms, max_delay_ms)
    jitter = random.uniform(-jitter_factor, jitter_factor) * delay_ms
    delay_ms = delay_ms + jitter

    next_retry_at = now + int(delay_ms)
    logger.info(f"[RetryManager] Retry {retry_count + 1}: {delay_ms/1000:.1f}s delay (next: {next_retry_at})")

    return next_retry_at


async def schedule_retry(
    task_id: str,
    error_message: str,
    retry_strategy: str = RETRY_STRATEGY_EXPONENTIAL,
) -> bool:
    """Schedule a task for retry or mark as permanently failed."""
    async with get_db_context() as session:
        result = await session.execute(
            select(AigcTask.retry_count, AigcTask.max_retries, AigcTask.status)
            .where(AigcTask.task_id == task_id)
        )
        row = result.one_or_none()

        if not row:
            logger.error(f"[RetryManager] Task {task_id} not found")
            return False

        retry_count, max_retries, current_status = row

        if current_status == STATUS_COMPLETED:
            logger.info(f"[RetryManager] Task {task_id[:8]} already completed")
            return False

        if retry_count >= max_retries:
            logger.warning(f"[RetryManager] Task {task_id[:8]} exceeded max retries")
            result = await session.execute(
                select(AigcTask).where(AigcTask.task_id == task_id)
            )
            task = result.scalar_one()
            task.status = STATUS_FAILED
            task.error_message = f"Max retries exceeded: {error_message}"
            task.updated_at = int(datetime.utcnow().timestamp() * 1000)
            await session.commit()
            return False

        now = int(datetime.utcnow().timestamp() * 1000)
        next_retry_at = calculate_next_retry_time(retry_count=retry_count, strategy=retry_strategy)

        result = await session.execute(select(AigcTask).where(AigcTask.task_id == task_id))
        task = result.scalar_one()
        task.status = STATUS_FAILED
        task.error_message = error_message
        task.retry_count = retry_count + 1
        task.last_retry_at = now
        task.next_retry_at = next_retry_at
        task.retry_strategy = retry_strategy
        task.updated_at = now
        await session.commit()

        logger.info(f"[RetryManager] ✅ Scheduled retry {retry_count + 1}/{max_retries} for task {task_id[:8]}")
        return True


async def get_tasks_ready_for_retry(limit: int = 100) -> list[dict]:
    """Get tasks that are ready to be retried."""
    async with get_db_context() as session:
        now = int(datetime.utcnow().timestamp() * 1000)

        result = await session.execute(
            select(AigcTask)
            .where(
                (AigcTask.status == STATUS_FAILED)
                & (AigcTask.retry_count < AigcTask.max_retries)
                & (AigcTask.next_retry_at != None)
                & (AigcTask.next_retry_at <= now)
            )
            .order_by(AigcTask.next_retry_at.asc())
            .limit(limit)
        )
        tasks = result.scalars().all()

        if tasks:
            logger.info(f"[RetryManager] Found {len(tasks)} tasks ready for retry")

        return [
            {
                "task_id": t.task_id,
                "task_type": t.task_type,
                "project_id": t.project_id,
                "params": t.params,
                "retry_count": t.retry_count,
                "max_retries": t.max_retries,
            }
            for t in tasks
        ]


async def reset_task_for_retry(task_id: str) -> bool:
    """Reset task status from failed to pending for retry."""
    async with get_db_context() as session:
        now = int(datetime.utcnow().timestamp() * 1000)

        result = await session.execute(
            select(AigcTask).where(
                (AigcTask.task_id == task_id) & (AigcTask.status == STATUS_FAILED)
            )
        )
        task = result.scalar_one_or_none()

        if not task:
            return False

        task.status = STATUS_PENDING
        task.worker_id = None
        task.heartbeat_at = None
        task.lease_expires_at = None
        task.updated_at = now
        await session.commit()

        logger.info(f"[RetryManager] 🔄 Reset task {task_id[:8]} to pending")
        return True


async def retry_scheduler_loop(interval_seconds: int = 10):
    """Background loop that periodically checks and retries failed tasks."""
    logger.info(f"[RetryScheduler] 🚀 Starting (interval: {interval_seconds}s)")

    while True:
        try:
            tasks = await get_tasks_ready_for_retry(limit=100)

            for task in tasks:
                task_id = task["task_id"]
                task_type = task["task_type"]
                retry_count = task["retry_count"]
                max_retries = task["max_retries"]

                logger.info(f"[RetryScheduler] 🔄 Retrying {task_id[:8]} ({task_type}, attempt: {retry_count}/{max_retries})")

                success = await reset_task_for_retry(task_id)

                if success:
                    logger.info(f"[RetryScheduler] ✅ Task {task_id[:8]} queued")
                else:
                    logger.warning(f"[RetryScheduler] ⚠️ Failed to queue {task_id[:8]}")

            await asyncio.sleep(interval_seconds)

        except Exception as e:
            logger.error(f"[RetryScheduler] ❌ Error: {e}", exc_info=True)
            await asyncio.sleep(interval_seconds)


def start_retry_scheduler(interval_seconds: int = 10):
    """Start the retry scheduler as a background task."""
    asyncio.create_task(retry_scheduler_loop(interval_seconds))
    logger.info(f"[RetryScheduler] ✅ Started (interval: {interval_seconds}s)")
