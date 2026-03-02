"""
Unified AIGC Tasks API Router - SQLAlchemy ORM version.

- POST /api/tasks/submit - Submit task
- GET /api/tasks/{task_id} - Get status
- POST /api/tasks/{task_id}/heartbeat - Renew lease
- GET /api/tasks/dashboard - Task dashboard
- GET /api/tasks/stats - Statistics
"""

import asyncio
import logging
import uuid
from datetime import datetime
from typing import Any, Callable, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from master_clash.database.di import get_session
from master_clash.database.models import AigcTask
from master_clash.json_utils import loads as json_loads
from master_clash.services import generation_models, r2
from master_clash.services.generation_models import (
    ImageGenerationRequest,
    VideoGenerationRequest,
    generate_image,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

# Constants
LEASE_DURATION_MS = 3 * 60 * 1000
WORKER_ID = f"worker_{uuid.uuid4().hex[:8]}"

TaskType = Literal[
    "image_gen",
    "video_gen",
    "audio_gen",
    "image_desc",
    "video_desc",
    "video_render",
    "video_thumbnail",
]

STATUS_PENDING = "pending"
STATUS_PROCESSING = "processing"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"


# === Request/Response Models ===


class TaskSubmitRequest(BaseModel):
    task_type: TaskType
    project_id: str
    node_id: str | None = None
    params: dict = {}
    callback_url: str | None = None


class TaskSubmitResponse(BaseModel):
    task_id: str
    status: str = STATUS_PENDING


class TaskStatusResponse(BaseModel):
    task_id: str
    task_type: str
    status: str
    result_url: str | None = None
    result_data: dict | None = None
    error: str | None = None
    project_id: str | None = None
    node_id: str | None = None


class TaskDashboardItem(BaseModel):
    task_id: str
    task_type: str
    status: str
    project_id: str
    node_id: str | None = None
    created_at: int
    updated_at: int
    completed_at: int | None = None
    retry_count: int = 0
    max_retries: int = 3
    next_retry_at: int | None = None
    error_message: str | None = None
    worker_id: str | None = None
    result_url: str | None = None
    duration_ms: int | None = None
    retry_status: str | None = None


class TaskDashboardResponse(BaseModel):
    tasks: list[TaskDashboardItem]
    total: int
    page: int
    page_size: int
    stats: dict | None = None


class TaskStatsResponse(BaseModel):
    total_tasks: int
    pending: int
    processing: int
    completed: int
    failed: int
    dead: int
    success_rate: float
    avg_duration_ms: float | None = None
    total_retries: int
    tasks_with_retries: int


# === ORM Helpers ===


async def get_task_or_404(task_id: str, session: AsyncSession) -> AigcTask:
    """Get task by ID or raise 404."""
    result = await session.execute(select(AigcTask).where(AigcTask.task_id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    return task


def parse_params(task: AigcTask) -> dict:
    """Parse JSON params from task."""
    if task.params is None:
        return {}
    if isinstance(task.params, dict):
        return task.params
    return json_loads(task.params) if isinstance(task.params, str) else {}


def parse_result_data(task: AigcTask) -> dict | None:
    """Parse JSON result_data from task."""
    if not task.result_data:
        return None
    if isinstance(task.result_data, dict):
        return task.result_data
    return json_loads(task.result_data) if isinstance(task.result_data, str) else None


# === Endpoints ===


@router.post("/submit", response_model=TaskSubmitResponse)
async def submit_task(
    request: TaskSubmitRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
):
    """Submit an AIGC task."""
    # Idempotency check: prevent duplicate tasks for the same node
    if request.node_id:
        existing_task_result = await session.execute(
            select(AigcTask).where(
                AigcTask.project_id == request.project_id,
                AigcTask.status.in_([STATUS_PENDING, STATUS_PROCESSING]),
                # Check node_id in params JSON
                func.jsonb_extract_path_text(AigcTask.params, "node_id") == request.node_id,
            )
        )
        existing_task = existing_task_result.scalar_one_or_none()

        if existing_task:
            logger.info(
                f"[Tasks] ♻️ Returned existing active task {existing_task.task_id} for node {request.node_id}"
            )
            return TaskSubmitResponse(task_id=existing_task.task_id, status=existing_task.status)

    task_id = f"task_{uuid.uuid4().hex[:12]}"
    now = int(datetime.utcnow().timestamp() * 1000)

    # Create ORM model
    task = AigcTask(
        task_id=task_id,
        project_id=request.project_id,
        task_type=request.task_type,
        provider="python",
        status=STATUS_PENDING,
        params={
            **request.params,
            "node_id": request.node_id,
            "callback_url": request.callback_url,
        },  # SQLAlchemy JSON type handles serialization
        created_at=now,
        updated_at=now,
        max_retries=3,
    )
    session.add(task)
    await session.commit()

    # Queue background processing
    processor = {
        "image_gen": process_image_generation,
        "video_gen": process_video_generation,
        "audio_gen": process_audio_generation,
        "image_desc": process_image_description,
        "video_desc": process_video_description,
        "video_render": process_video_render,
        "video_thumbnail": process_video_thumbnail,
    }.get(request.task_type)

    if processor:
        background_tasks.add_task(
            processor,
            task_id,
            request.params,
            request.project_id,
            request.node_id,
            request.callback_url,
        )

    return TaskSubmitResponse(task_id=task_id)


@router.get("/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(
    task_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Get task status."""
    task = await get_task_or_404(task_id, session)
    params = parse_params(task)

    return TaskStatusResponse(
        task_id=task.task_id,
        task_type=task.task_type,
        status=task.status,
        result_url=task.result_url,
        result_data=parse_result_data(task),
        error=task.error_message,
        project_id=task.project_id,
        node_id=params.get("node_id"),
    )


@router.post("/{task_id}/heartbeat")
async def heartbeat(
    task_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Renew task lease."""
    task = await get_task_or_404(task_id, session)
    now = int(datetime.utcnow().timestamp() * 1000)
    task.heartbeat_at = now
    task.lease_expires_at = now + LEASE_DURATION_MS
    task.updated_at = now
    await session.commit()
    return {"status": "ok"}


# === Dashboard Endpoints ===


@router.get("/dashboard", response_model=TaskDashboardResponse)
async def get_task_dashboard(
    session: AsyncSession = Depends(get_session),
    status: str | None = None,
    task_type: str | None = None,
    project_id: str | None = None,
    page: int = 1,
    page_size: int = 50,
    include_stats: bool = False,
):
    """Get task dashboard with filtering and pagination."""
    page_size = min(page_size, 100)
    offset = (page - 1) * page_size

    # Build query
    query = select(AigcTask)
    if status:
        query = query.where(AigcTask.status == status)
    if task_type:
        query = query.where(AigcTask.task_type == task_type)
    if project_id:
        query = query.where(AigcTask.project_id == project_id)

    # Count total
    count_query = select(AigcTask.task_id).select_from(query)
    total_result = await session.execute(count_query)
    total = len(total_result.all())

    # Fetch paginated
    query = query.order_by(AigcTask.created_at.desc()).offset(offset).limit(page_size)
    result = await session.execute(query)
    tasks = result.scalars().all()

    # Transform to response
    items = []
    for task in tasks:
        params = parse_params(task)
        duration_ms = (task.completed_at - task.created_at) if task.completed_at else None

        retry_status = None
        if task.status == "failed" and task.retry_count > 0:
            if task.retry_count >= task.max_retries:
                retry_status = "max_retries_exceeded"
            elif task.next_retry_at:
                retry_status = "retrying"

        items.append(
            TaskDashboardItem(
                task_id=task.task_id,
                task_type=task.task_type,
                status=task.status,
                project_id=task.project_id,
                node_id=params.get("node_id"),
                created_at=task.created_at,
                updated_at=task.updated_at,
                completed_at=task.completed_at,
                retry_count=task.retry_count,
                max_retries=task.max_retries,
                next_retry_at=task.next_retry_at,
                error_message=task.error_message,
                worker_id=task.worker_id,
                result_url=task.result_url,
                duration_ms=duration_ms,
                retry_status=retry_status,
            )
        )

    stats = None
    if include_stats:
        stats = await _get_stats(session, project_id)

    return TaskDashboardResponse(
        tasks=items,
        total=total,
        page=page,
        page_size=page_size,
        stats=stats,
    )


@router.get("/stats", response_model=TaskStatsResponse)
async def get_task_statistics(
    session: AsyncSession = Depends(get_session),
    project_id: str | None = None,
):
    """Get task statistics."""
    stats = await _get_stats(session, project_id)
    return TaskStatsResponse(**stats)


async def _get_stats(session: AsyncSession, project_id: str | None) -> dict:
    """Helper to get statistics."""
    from sqlalchemy import func

    query = select(func.count(AigcTask.task_id))
    if project_id:
        query = query.where(AigcTask.project_id == project_id)

    # Get counts by status
    status_counts = {}
    for status_val in ["pending", "processing", "completed", "failed", "dead"]:
        q = select(func.count()).where(AigcTask.status == status_val)
        if project_id:
            q = q.where(AigcTask.project_id == project_id)
        result = await session.execute(q)
        status_counts[status_val] = result.scalar() or 0

    total_tasks = sum(status_counts.values())
    completed = status_counts["completed"]
    success_rate = (completed / total_tasks * 100) if total_tasks > 0 else 0.0

    # Get aggregates
    q = select(
        func.sum(AigcTask.retry_count),
        func.sum(func.case((AigcTask.retry_count > 0, 1), else_=0)),
        func.avg(AigcTask.completed_at - AigcTask.created_at),
    )
    if project_id:
        q = q.where(AigcTask.project_id == project_id)
    result = await session.execute(q)
    total_retries, tasks_with_retries, avg_duration = result.one()

    return {
        "total_tasks": total_tasks,
        "pending": status_counts["pending"],
        "processing": status_counts["processing"],
        "completed": completed,
        "failed": status_counts["failed"],
        "dead": status_counts["dead"],
        "success_rate": round(success_rate, 2),
        "avg_duration_ms": avg_duration,
        "total_retries": total_retries or 0,
        "tasks_with_retries": tasks_with_retries or 0,
    }


@router.get("/failed", response_model=TaskDashboardResponse)
async def get_failed_tasks(
    session: AsyncSession = Depends(get_session),
    project_id: str | None = None,
    include_retrying: bool = False,
    page: int = 1,
    page_size: int = 50,
):
    """Get failed tasks."""
    page_size = min(page_size, 100)
    offset = (page - 1) * page_size

    query = select(AigcTask).where((AigcTask.status == "failed") | (AigcTask.status == "dead"))
    if project_id:
        query = query.where(AigcTask.project_id == project_id)
    if not include_retrying:
        query = query.where(
            (AigcTask.retry_count >= AigcTask.max_retries) | (AigcTask.status == "dead")
        )

    # Count
    count_result = await session.execute(select(func.count()).select_from(query))
    total = count_result.scalar() or 0

    # Fetch
    query = query.order_by(AigcTask.updated_at.desc()).offset(offset).limit(page_size)
    result = await session.execute(query)
    tasks = result.scalars().all()

    items = []
    for task in tasks:
        params = parse_params(task)
        retry_status = "permanently_failed" if task.status == "dead" else None
        if task.status == "failed":
            if task.retry_count >= task.max_retries:
                retry_status = "max_retries_exceeded"
            elif task.next_retry_at:
                retry_status = "retrying"

        items.append(
            TaskDashboardItem(
                task_id=task.task_id,
                task_type=task.task_type,
                status=task.status,
                project_id=task.project_id,
                node_id=params.get("node_id"),
                created_at=task.created_at,
                updated_at=task.updated_at,
                completed_at=task.completed_at,
                retry_count=task.retry_count,
                max_retries=task.max_retries,
                next_retry_at=task.next_retry_at,
                error_message=task.error_message,
                worker_id=task.worker_id,
                result_url=task.result_url,
                retry_status=retry_status,
            )
        )

    return TaskDashboardResponse(
        tasks=items,
        total=total,
        page=page,
        page_size=page_size,
    )


# === Task Processors ===


async def process_image_generation(
    task_id: str, params: dict, project_id: str, node_id: str | None, callback_url: str | None
):
    """Process image generation task."""
    from sqlalchemy import select

    async with get_db_context() as session:
        result = await session.execute(select(AigcTask).where(AigcTask.task_id == task_id))
        task = result.scalar_one_or_none()
        if not task:
            return

        # Claim task
        now = int(datetime.utcnow().timestamp() * 1000)
        task.status = STATUS_PROCESSING
        task.worker_id = WORKER_ID
        task.heartbeat_at = now
        task.lease_expires_at = now + LEASE_DURATION_MS
        await session.commit()

        try:
            # Process - normalize parameters
            request_params = dict(params)
            # Known fields for ImageGenerationRequest
            known_fields = {"prompt", "model_id", "params", "reference_images"}

            # Map legacy field names
            if "model" in request_params and "model_id" not in request_params:
                request_params["model_id"] = request_params.pop("model")
            if "model_params" in request_params and "params" not in request_params:
                request_params["params"] = request_params.pop("model_params")

            # Collect unknown fields into params
            extra_params = {}
            for key in list(request_params.keys()):
                if key not in known_fields:
                    extra_params[key] = request_params.pop(key)

            if extra_params:
                if "params" not in request_params:
                    request_params["params"] = {}
                request_params["params"].update(extra_params)

            req = ImageGenerationRequest(**request_params)
            result = await generate_image(req)

            if not result.success:
                raise Exception(result.error or "Image generation failed")

            # Upload base64 result to R2
            import base64

            image_bytes = base64.b64decode(result.base64_data)
            r2_key = f"projects/{project_id}/generated/{task_id}.png"
            await r2.put_object(r2_key, image_bytes, "image/png")

            task.status = STATUS_COMPLETED
            task.result_url = r2_key  # Store r2_key directly, not r2://
            task.completed_at = now
            await session.commit()

            if callback_url:
                await _callback_to_loro(callback_url, task_id, "completed", r2_key, None, session)

        except Exception as e:
            logger.error(f"[Tasks] Image gen failed: {e}")
            await _fail_task_with_retry(task, str(e), session, callback_url)


async def process_video_generation(
    task_id: str, params: dict, project_id: str, node_id: str | None, callback_url: str | None
):
    """Process video generation task using Kling/KIE API."""
    from sqlalchemy import select

    async with get_db_context() as session:
        result = await session.execute(select(AigcTask).where(AigcTask.task_id == task_id))
        task = result.scalar_one_or_none()
        if not task:
            return

        # Claim task
        now = int(datetime.utcnow().timestamp() * 1000)
        task.status = STATUS_PROCESSING
        task.worker_id = WORKER_ID
        task.heartbeat_at = now
        task.lease_expires_at = now + LEASE_DURATION_MS
        await session.commit()

        try:
            prompt = params.get("prompt", "")
            model_id = (
                params.get("model")
                or params.get("model_id")
                or generation_models.DEFAULT_VIDEO_MODEL
            )
            model_params = params.get("model_params") or {}
            reference_images = (
                params.get("reference_images") or params.get("referenceImageUrls") or []
            )
            image_r2_key = params.get("image_r2_key") or (
                reference_images[0] if reference_images else None
            )
            duration = params.get("duration", 5)

            if image_r2_key and "image_r2_key" not in model_params:
                model_params["image_r2_key"] = image_r2_key
            if duration and "duration" not in model_params:
                model_params["duration"] = duration

            logger.info(f"[Tasks] 🎬 Processing video_gen: {task_id}, model: {model_id}")

            # Start heartbeat
            heartbeat_task = asyncio.create_task(_heartbeat_loop(task_id))

            try:
                # Submit video job
                submission = await generation_models.submit_video_job(
                    VideoGenerationRequest(
                        prompt=prompt,
                        project_id=project_id,
                        model_id=model_id,
                        params=model_params,
                        reference_images=reference_images,
                        callback_url=callback_url,
                        task_id=task_id,
                    )
                )

                if not submission.success:
                    raise Exception(submission.error or "Video submit failed")

                # If video is ready immediately (unlikely for video)
                if submission.r2_key:
                    task.status = STATUS_COMPLETED
                    task.result_url = submission.r2_key
                    task.completed_at = int(datetime.utcnow().timestamp() * 1000)
                    await session.commit()
                    if callback_url:
                        await _callback_to_loro(
                            callback_url, task_id, "completed", submission.r2_key, None, session
                        )
                    return

                external_task_id = submission.external_task_id
                if not external_task_id:
                    raise Exception("No external task id returned from provider")

                logger.info(
                    f"[Tasks] Video task submitted: {external_task_id} via {submission.provider}"
                )

                # Store external task info
                task.external_task_id = external_task_id
                task.external_service = submission.provider
                await session.commit()

                # Poll for completion
                max_polls = 60  # 60 * 30s = 30 minutes
                for i in range(max_polls):
                    await asyncio.sleep(30)

                    poll_result = await generation_models.poll_video_job(
                        model_id,
                        external_task_id,
                        project_id,
                    )
                    logger.info(
                        f"[Tasks] Video poll {i + 1}/{max_polls}: status={poll_result.status}"
                    )

                    if poll_result.status == "completed":
                        task.status = STATUS_COMPLETED
                        task.result_url = poll_result.r2_key
                        task.completed_at = int(datetime.utcnow().timestamp() * 1000)
                        await session.commit()
                        if callback_url:
                            await _callback_to_loro(
                                callback_url,
                                task_id,
                                "completed",
                                poll_result.r2_key,
                                None,
                                session,
                            )
                        return
                    elif poll_result.status == "failed":
                        raise Exception(poll_result.error or "Video generation failed")

                raise Exception("Video generation timed out after 30 minutes")

            finally:
                heartbeat_task.cancel()

        except Exception as e:
            logger.error(f"[Tasks] Video gen failed: {e}", exc_info=True)
            await _fail_task_with_retry(task, str(e), session, callback_url)


async def process_audio_generation(
    task_id: str, params: dict, project_id: str, node_id: str | None, callback_url: str | None
):
    """Process audio generation task (TTS)."""
    from sqlalchemy import select

    async with get_db_context() as session:
        result = await session.execute(select(AigcTask).where(AigcTask.task_id == task_id))
        task = result.scalar_one_or_none()
        if not task:
            return

        # Claim task
        now = int(datetime.utcnow().timestamp() * 1000)
        task.status = STATUS_PROCESSING
        task.worker_id = WORKER_ID
        task.heartbeat_at = now
        task.lease_expires_at = now + LEASE_DURATION_MS
        await session.commit()

        try:
            text = params.get("prompt") or params.get("text", "")
            model_id = (
                params.get("model")
                or params.get("model_id")
                or generation_models.DEFAULT_AUDIO_MODEL
            )
            model_params = params.get("model_params") or {}

            logger.info(f"[Tasks] 🎵 Processing audio_gen: {task_id}, model: {model_id}")

            # Start heartbeat
            heartbeat_task = asyncio.create_task(_heartbeat_loop(task_id))

            try:
                generation_result = await generation_models.generate_audio(
                    generation_models.AudioGenerationRequest(
                        text=text,
                        project_id=project_id,
                        model_id=model_id,
                        params=model_params,
                    )
                )

                if generation_result.success and generation_result.r2_key:
                    task.status = STATUS_COMPLETED
                    task.result_url = generation_result.r2_key
                    task.completed_at = int(datetime.utcnow().timestamp() * 1000)
                    await session.commit()
                    if callback_url:
                        await _callback_to_loro(
                            callback_url,
                            task_id,
                            "completed",
                            generation_result.r2_key,
                            None,
                            session,
                        )
                else:
                    raise Exception(generation_result.error or "No audio generated")

            finally:
                heartbeat_task.cancel()

        except Exception as e:
            logger.error(f"[Tasks] ❌ audio_gen failed: {e}", exc_info=True)
            await _fail_task_with_retry(task, str(e), session, callback_url)


async def process_image_description(
    task_id: str, params: dict, project_id: str, node_id: str | None, callback_url: str | None
):
    """Process image description task (AI vision)."""
    from sqlalchemy import select

    from master_clash.services import genai

    async with get_db_context() as session:
        result = await session.execute(select(AigcTask).where(AigcTask.task_id == task_id))
        task = result.scalar_one_or_none()
        if not task:
            return

        # Claim task
        now = int(datetime.utcnow().timestamp() * 1000)
        task.status = STATUS_PROCESSING
        task.worker_id = WORKER_ID
        task.heartbeat_at = now
        task.lease_expires_at = now + LEASE_DURATION_MS
        await session.commit()

        try:
            r2_key = params.get("r2_key")
            mime_type = params.get("mime_type", "image/png")

            logger.info(f"[Tasks] 🔍 Processing image_desc: {task_id}")

            # Start heartbeat
            heartbeat_task = asyncio.create_task(_heartbeat_loop(task_id))

            try:
                # Fetch from R2
                data, _ = await r2.fetch_object(r2_key)

                # Generate description using AI vision
                description = await genai.generate_description_from_bytes(data, mime_type)

                task.status = STATUS_COMPLETED
                task.result_data = {"description": description}
                task.completed_at = int(datetime.utcnow().timestamp() * 1000)
                await session.commit()

                if callback_url:
                    # Build updates for callback
                    updates = {"description": description, "status": "fin", "pendingTask": None}
                    await _send_loro_callback(callback_url, node_id, updates)

            finally:
                heartbeat_task.cancel()

        except Exception as e:
            logger.error(f"[Tasks] ❌ image_desc failed: {e}", exc_info=True)
            await _fail_task_with_retry(
                task, str(e), session, callback_url, on_final_fail=lambda: _send_loro_callback(
                    callback_url, node_id, {"status": "failed", "pendingTask": None}
                ) if callback_url and node_id else None
            )


async def process_video_description(
    task_id: str, params: dict, project_id: str, node_id: str | None, callback_url: str | None
):
    """Process video description task (AI vision)."""
    from sqlalchemy import select

    from master_clash.services import genai

    async with get_db_context() as session:
        result = await session.execute(select(AigcTask).where(AigcTask.task_id == task_id))
        task = result.scalar_one_or_none()
        if not task:
            return

        # Claim task
        now = int(datetime.utcnow().timestamp() * 1000)
        task.status = STATUS_PROCESSING
        task.worker_id = WORKER_ID
        task.heartbeat_at = now
        task.lease_expires_at = now + LEASE_DURATION_MS
        await session.commit()

        try:
            r2_key = params.get("r2_key")
            mime_type = params.get("mime_type", "video/mp4")

            logger.info(f"[Tasks] 🔍 Processing video_desc: {task_id}")

            # Start heartbeat
            heartbeat_task = asyncio.create_task(_heartbeat_loop(task_id))

            try:
                # Fetch from R2
                data, _ = await r2.fetch_object(r2_key)

                # Generate description using AI vision
                description = await genai.generate_description_from_bytes(data, mime_type)

                task.status = STATUS_COMPLETED
                task.result_data = {"description": description}
                task.completed_at = int(datetime.utcnow().timestamp() * 1000)
                await session.commit()

                if callback_url:
                    # Build updates for callback
                    updates = {"description": description, "status": "fin", "pendingTask": None}
                    await _send_loro_callback(callback_url, node_id, updates)

            finally:
                heartbeat_task.cancel()

        except Exception as e:
            logger.error(f"[Tasks] ❌ video_desc failed: {e}", exc_info=True)
            await _fail_task_with_retry(
                task, str(e), session, callback_url, on_final_fail=lambda: _send_loro_callback(
                    callback_url, node_id, {"status": "failed", "pendingTask": None}
                ) if callback_url and node_id else None
            )


async def process_video_render(
    task_id: str, params: dict, project_id: str, node_id: str | None, callback_url: str | None
):
    """
    Render video using Remotion CLI with Timeline DSL.

    This is different from video_gen (which generates new video using AI).
    video_render composites existing assets (videos, images, audio, text) using a timeline.
    """
    from sqlalchemy import select

    async with get_db_context() as session:
        result = await session.execute(select(AigcTask).where(AigcTask.task_id == task_id))
        task = result.scalar_one_or_none()
        if not task:
            return

        # Claim task
        now = int(datetime.utcnow().timestamp() * 1000)
        task.status = STATUS_PROCESSING
        task.worker_id = WORKER_ID
        task.heartbeat_at = now
        task.lease_expires_at = now + LEASE_DURATION_MS
        await session.commit()

        try:
            timeline_dsl = params.get("timeline_dsl") or params.get("timelineDsl", {})
            if not timeline_dsl:
                raise ValueError("Missing timeline_dsl in params")

            logger.info(f"[Tasks] 🎬 Processing video_render: {task_id}, node: {node_id}")
            logger.info(f"[Tasks] 📋 Timeline DSL tracks: {len(timeline_dsl.get('tracks', []))}")

            # Start heartbeat
            heartbeat_task = asyncio.create_task(_heartbeat_loop(task_id))

            try:
                # Import render service
                from master_clash.services.remotion_render import render_video_with_remotion

                result = await render_video_with_remotion(
                    timeline_dsl=timeline_dsl,
                    project_id=project_id,
                    task_id=task_id,
                )

                if result.success and result.r2_key:
                    task.status = STATUS_COMPLETED
                    task.result_url = result.r2_key
                    task.completed_at = int(datetime.utcnow().timestamp() * 1000)
                    await session.commit()
                    logger.info(f"[Tasks] ✅ video_render completed: {result.r2_key}")
                    if callback_url:
                        await _callback_to_loro(
                            callback_url, task_id, "completed", result.r2_key, None, session
                        )
                else:
                    raise Exception(result.error or "Render failed")

            finally:
                heartbeat_task.cancel()

        except Exception as e:
            logger.error(f"[Tasks] ❌ video_render failed: {e}", exc_info=True)
            await _fail_task_with_retry(task, str(e), session, callback_url)


async def process_video_thumbnail(
    task_id: str, params: dict, project_id: str, node_id: str | None, callback_url: str | None
):
    """Process video thumbnail task."""
    # TODO: Implement video thumbnail generation
    pass


# === Helper Functions ===

HEARTBEAT_INTERVAL_MS = 30 * 1000  # 30 seconds


async def _heartbeat_loop(task_id: str) -> None:
    """Background loop to renew task lease."""
    try:
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL_MS / 1000)
            await renew_lease(task_id)
            logger.debug(f"[Tasks] Heartbeat: {task_id}")
    except asyncio.CancelledError:
        pass


async def _send_loro_callback(callback_url: str, node_id: str | None, updates: dict) -> None:
    """Send callback to Loro sync server via HTTP POST."""
    if not callback_url or not node_id:
        return

    import httpx

    payload = {"nodeId": node_id, "updates": updates}

    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(callback_url, json=payload)
                if resp.status_code == 200:
                    logger.info(f"[Tasks] ✅ Callback sent for node {node_id[:8]}")
                    return
                logger.error(
                    f"[Tasks] Callback attempt {attempt + 1} failed: HTTP {resp.status_code}"
                )
        except Exception as e:
            logger.error(f"[Tasks] Callback attempt {attempt + 1} error: {e}", exc_info=True)
        if attempt < 2:
            await asyncio.sleep(1)

    logger.error(f"[Tasks] ❌ Callback failed after 3 attempts for node {node_id[:8]}")


async def renew_lease(task_id: str) -> bool:
    """Renew task lease (for heartbeat)."""
    from sqlalchemy import select

    async with get_db_context() as session:
        result = await session.execute(select(AigcTask).where(AigcTask.task_id == task_id))
        task = result.scalar_one_or_none()
        if not task:
            return False

        now = int(datetime.utcnow().timestamp() * 1000)
        task.heartbeat_at = now
        task.lease_expires_at = now + LEASE_DURATION_MS
        task.updated_at = now
        await session.commit()
        return True


async def _fail_task_with_retry(
    task: AigcTask,
    error: str,
    session: AsyncSession,
    callback_url: str | None = None,
    on_final_fail: Callable[..., Any] | None = None,
) -> None:
    """Fail task and schedule retry if needed.

    Args:
        task: The task to fail.
        error: Error message.
        session: Database session.
        callback_url: URL forloro callback on final failure.
        on_final_fail: Optional callback function to execute on final failure (before db commit).
    """
    from master_clash.api.retry_manager import RETRY_STRATEGY_EXPONENTIAL, schedule_retry

    retry_scheduled = await schedule_retry(
        task_id=task.task_id,
        error_message=error,
        retry_strategy=RETRY_STRATEGY_EXPONENTIAL,
    )

    if retry_scheduled:
        logger.info(f"[Tasks] 🔄 Task {task.task_id[:8]} scheduled for retry")
        return

    # Execute final failure callback if provided (e.g., for loro callbacks with node_id)
    if on_final_fail:
        await on_final_fail()

    now = int(datetime.utcnow().timestamp() * 1000)
    task.status = STATUS_FAILED
    task.error_message = error
    task.updated_at = now
    await session.commit()
    logger.warning(f"[Tasks] ❌ Task {task.task_id[:8]} permanently failed")

    if callback_url:
        await _callback_to_loro(callback_url, task.task_id, "failed", None, error, session)


async def _callback_to_loro(
    callback_url: str,
    task_id: str,
    status: str,
    result_url: str | None,
    error: str | None,
    session: AsyncSession,
):
    """Send callback to Loro sync server via HTTP POST."""
    import httpx

    if not callback_url:
        return

    # Get task to retrieve node_id and params
    result = await session.execute(select(AigcTask).where(AigcTask.task_id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        logger.warning(f"[Tasks] Callback failed: task {task_id} not found")
        return

    # Extract node_id and model from params
    params = task.params if isinstance(task.params, dict) else {}
    node_id = params.get("node_id")
    model_id = params.get("model") or params.get("model_id")

    if not node_id:
        logger.warning(f"[Tasks] Callback failed: no node_id for task {task_id}")
        return

    # Build updates payload based on status
    updates: dict[str, Any] = {
        "status": status,
        "pendingTask": None,  # Clear pending task on completion/error
    }

    if status == "completed" and result_url:
        updates["src"] = result_url

    if error:
        updates["error"] = error

    if model_id:
        updates["model"] = model_id

    payload = {"nodeId": node_id, "updates": updates}

    # Send HTTP POST with retry
    logger.info(f"[Tasks] 📤 Sending callback to {callback_url} for node {node_id}")
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(callback_url, json=payload)
                if resp.status_code == 200:
                    logger.info(f"[Tasks] ✅ Callback sent for node {node_id}, task {task_id[:8]}")
                    return
                else:
                    logger.warning(
                        f"[Tasks] Callback attempt {attempt + 1} failed: HTTP {resp.status_code} - {resp.text}"
                    )
        except Exception as e:
            logger.warning(f"[Tasks] Callback attempt {attempt + 1} error: {e!r}", exc_info=True)
            if attempt < 2:
                await asyncio.sleep(1 * (attempt + 1))

    logger.warning(
        f"[Tasks] ❌ Callback failed after 3 attempts: node {node_id}, task {task_id[:8]}"
    )


# Import after definition to avoid circular dependency
from master_clash.database.di import get_db_context
