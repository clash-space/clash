"""
Description generation API router.

Endpoints:
- POST /api/describe/submit - Submit description task
- GET /api/describe/{task_id} - Get task status
"""

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from master_clash.database.di import get_db_context
from master_clash.database.models import AigcTask
from master_clash.json_utils import dumps as json_dumps, loads as json_loads
from master_clash.services import r2, genai

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/describe", tags=["describe"])

# Task status constants
STATUS_PENDING = "pending"
STATUS_PROCESSING = "processing"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"


# === Models ===

class DescribeSubmitRequest(BaseModel):
    """Request to submit a description task."""
    r2_key: str = Field(..., description="R2 object key")
    mime_type: str = Field(..., description="MIME type")
    project_id: str = Field(..., description="Project ID")
    node_id: str = Field(..., description="Node ID")


class DescribeSubmitResponse(BaseModel):
    """Response with task ID."""
    task_id: str
    status: str = STATUS_PENDING


class DescribeStatusResponse(BaseModel):
    """Task status response."""
    task_id: str
    status: str
    description: str | None = None
    error: str | None = None
    node_id: str | None = None
    project_id: str | None = None


# === Task Operations ===

async def create_task(task_id: str, project_id: str, node_id: str, r2_key: str, mime_type: str) -> None:
    """Create task in DB."""
    now = int(datetime.utcnow().timestamp() * 1000)
    params = {"r2_key": r2_key, "mime_type": mime_type, "node_id": node_id}

    async with get_db_context() as session:
        task = AigcTask(
            task_id=task_id,
            project_id=project_id,
            task_type="description",
            status=STATUS_PENDING,
            params=params,  # SQLAlchemy JSON type handles serialization
            created_at=now,
            updated_at=now,
            max_retries=3,
        )
        session.add(task)
        await session.commit()


async def update_task(task_id: str, status: str, result_data: dict = None, error: str = None) -> None:
    """Update task in DB."""
    now = int(datetime.utcnow().timestamp() * 1000)

    async with get_db_context() as session:
        result = await session.execute(
            select(AigcTask).where(AigcTask.task_id == task_id)
        )
        task = result.scalar_one_or_none()

        if not task:
            return

        task.status = status
        task.updated_at = now

        if status == STATUS_COMPLETED and result_data:
            task.result_data = result_data  # SQLAlchemy JSON type handles serialization
            task.completed_at = now
        elif error:
            task.error_message = error

        await session.commit()


async def get_task(task_id: str) -> dict | None:
    """Get task from DB."""
    async with get_db_context() as session:
        result = await session.execute(
            select(AigcTask).where(AigcTask.task_id == task_id)
        )
        task = result.scalar_one_or_none()
        return task.__dict__ if task else None


# === Background Processing ===

async def process_description_task(task_id: str, r2_key: str, mime_type: str) -> None:
    """Background task to generate description."""
    try:
        logger.info(f"[Describe] Processing {task_id}")
        await update_task(task_id, STATUS_PROCESSING)
        
        # Fetch from R2 using S3 client
        data, _ = await r2.fetch_object(r2_key)
        
        # Generate description using LangChain + Vertex AI
        description = await genai.generate_description_from_bytes(data, mime_type)
        
        await update_task(task_id, STATUS_COMPLETED, result_data={"description": description})
        logger.info(f"[Describe] Completed {task_id}")
        
    except Exception as e:
        logger.error(f"[Describe] Failed {task_id}: {e}")
        await update_task(task_id, STATUS_FAILED, error=str(e))


# === Endpoints ===

@router.post("/submit", response_model=DescribeSubmitResponse)
async def submit_description_task(request: DescribeSubmitRequest, background_tasks: BackgroundTasks):
    """Submit description generation task."""
    task_id = f"desc_{uuid.uuid4().hex[:12]}"
    
    logger.info(f"[Describe] Submit {task_id} for {request.r2_key}")
    
    await create_task(task_id, request.project_id, request.node_id, request.r2_key, request.mime_type)
    
    background_tasks.add_task(process_description_task, task_id, request.r2_key, request.mime_type)
    
    return DescribeSubmitResponse(task_id=task_id)


@router.get("/{task_id}", response_model=DescribeStatusResponse)
async def get_description_status(task_id: str):
    """Get description task status."""
    task = await get_task(task_id)

    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    # SQLAlchemy JSON type returns dict directly
    params = task.get("params", {})
    if isinstance(params, str):
        params = json_loads(params)

    result_data = task.get("result_data") or {}
    if isinstance(result_data, str):
        result_data = json_loads(result_data)

    return DescribeStatusResponse(
        task_id=task_id,
        status=task["status"],
        description=result_data.get("description") if isinstance(result_data, dict) else None,
        error=task.get("error_message"),
        node_id=params.get("node_id") if isinstance(params, dict) else None,
        project_id=task.get("project_id"),
    )
