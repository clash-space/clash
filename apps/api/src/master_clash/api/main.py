"""
@file main.py
@description Main entry point for the FastAPI backend server.
@module apps.api.src.master_clash.api

@responsibility
- Initializes the FastAPI application and middleware (CORS)
- Registers API routers (describe, tasks, execute, session)
- Handles global exceptions
- Manages SSE streaming endpoints for LangGraph workflows

@exports
- app: The FastAPI application instance
"""

import asyncio
import json
import logging
import uuid
from pathlib import Path
from typing import Any

import requests
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

# from master_clash.video_analysis import VideoAnalysisOrchestrator, VideoAnalysisConfig, VideoAnalysisResult
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field

from master_clash.api.describe_router import router as describe_router
from master_clash.api.execute_router import router as execute_router
from master_clash.api.session_router import router as session_router
from master_clash.api.tasks_router import router as tasks_router
from master_clash.api.thumbnail_router import router as thumbnail_router
from master_clash.config import get_settings
from master_clash.context import ProjectContext, set_project_context
from master_clash.services.execution import execution_manager
from master_clash.tools.description import generate_description
from master_clash.tools.kling_video import kling_video_gen
from master_clash.tools.nano_banana import nano_banana_gen
from master_clash.utils import image_to_base64

# Configure logging
# 配置日志系统，将日志分别输出到文件和控制台
# 日志文件存放在项目根目录的 .log 文件夹中
settings = get_settings()
log_dir = Path(__file__).resolve().parents[4] / ".log"
log_dir.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler(log_dir / "api.log", encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Master Clash API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers

app.include_router(describe_router)
app.include_router(tasks_router)
app.include_router(execute_router)
app.include_router(session_router)
app.include_router(thumbnail_router)

# Mount static files for task dashboard
STATIC_DIR = Path(__file__).parent.parent / "static"
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# Task dashboard page
@app.get("/dashboard")
async def task_dashboard():
    """Serve task dashboard HTML page."""
    dashboard_path = STATIC_DIR / "task_dashboard.html"
    if dashboard_path.exists():
        return FileResponse(str(dashboard_path))
    else:
        raise HTTPException(status_code=404, detail="Dashboard not found")


# === Startup & Shutdown Events ===

@app.on_event("startup")
async def startup_event():
    """Application startup - init DB pool and start background tasks."""
    logger.info("🚀 Starting Master Clash API...")

    # Initialize SQLAlchemy database pool
    try:
        from master_clash.database.di import init_db
        await init_db()
        logger.info("✅ Database pool initialized")
    except Exception as e:
        logger.error(f"❌ Failed to initialize database: {e}")
        raise

    # Apply database migrations (using SQLAlchemy)
    try:
        from master_clash.database.migrations import apply_migrations
        count = apply_migrations()
        logger.info(f"✅ Database migrations applied ({count} new)")
    except Exception as e:
        logger.warning(f"⚠️ Migration check skipped: {e}")

    # Start task scheduler
    from master_clash.task_system import start_task_scheduler
    start_task_scheduler()
    logger.info("✅ Task scheduler started")

    logger.info("✅ Master Clash API started successfully")


@app.on_event("shutdown")
async def shutdown_event():
    """Application shutdown - close DB pool."""
    logger.info("🛑 Shutting down Master Clash API...")

    try:
        from master_clash.database.di import close_db
        await close_db()
        logger.info("✅ Database pool closed")
    except Exception as e:
        logger.warning(f"⚠️ Error closing database: {e}")


class GenerateSemanticIDRequest(BaseModel):
    """Request to generate semantic IDs."""

    project_id: str = Field(..., description="Project ID for scoping")
    count: int = Field(default=1, ge=1, le=100, description="Number of IDs to generate")


class GenerateSemanticIDResponse(BaseModel):
    """Response with generated semantic IDs."""

    ids: list[str] = Field(..., description="List of generated semantic IDs")
    project_id: str = Field(..., description="Project ID")


class GenerateDescriptionResponse(BaseModel):
    """Response with generated description."""

    task_id: str = Field(..., description="Task ID")
    status: str = Field(default="processing", description="Task status")


@app.get("/api/v1/stream/{project_id}")
async def stream_workflow(
    project_id: str,
    thread_id: str,
    resume: bool = False,
    user_input: str = None,
    selected_node_ids: str = None,
):
    """Stream LangGraph workflow events as SSE using LangGraph streaming modes."""
    if not resume and not user_input:
        raise HTTPException(
            status_code=400, detail="user_input is required when starting a new run"
        )

    # Check for existing session
    session = execution_manager.get_session(thread_id)

    if not session:
        # Create new session if not exists
        session = execution_manager.create_session(thread_id, project_id)

        # Prepare inputs
        inputs = None
        if not resume:
            message = f"Project ID: {project_id}. {user_input}"

            # Append selected node IDs if provided
            if selected_node_ids:
                ids = [i.strip() for i in selected_node_ids.split(",") if i.strip()]
                if ids:
                    message += f"\n\n[SELECTED NODE IDS]\n{', '.join(ids)}"

            inputs = {
                "messages": [HumanMessage(content=message)],
                "project_id": project_id,
                "next": "Supervisor",
            }

        config = {
            "configurable": {
                "thread_id": thread_id,
                # loro_client will be injected by the worker loop
            }
        }

        # Start execution
        await session.start(inputs, config, user_input, resume)

    # Return stream
    return StreamingResponse(session.subscribe(), media_type="text/event-stream")


@app.post("/api/generate-ids", response_model=GenerateSemanticIDResponse)
async def generate_semantic_ids(request: GenerateSemanticIDRequest):
    """Generate short unique IDs for a project.

    Returns short UUIDs like "abc123xy" that are generated locally.
    The project_id parameter is kept for API compatibility but not used.
    """
    try:
        import uuid

        # Generate short UUIDs (8 characters each)
        ids = [uuid.uuid4().hex[:8] for _ in range(request.count)]

        return GenerateSemanticIDResponse(ids=ids, project_id=request.project_id)

    except Exception as e:
        logger.error(f"Error generating IDs: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.get("/api/health")
async def health_check():
    """
    Health check endpoint for monitoring and load balancers.

    Returns:
        JSON response with health status and PostgreSQL connection pool metrics
    """
    from master_clash.database.pg_checkpointer import get_pool_health

    try:
        pool_health = await get_pool_health()

        # Overall health status
        is_healthy = pool_health.get("is_healthy", False)

        return JSONResponse(
            status_code=200 if is_healthy else 503,
            content={
                "status": "healthy" if is_healthy else "unhealthy",
                "database": {
                    "postgres": pool_health,
                },
                "service": "master-clash-api",
            }
        )
    except Exception as e:
        logger.error(f"Health check failed: {e}", exc_info=True)
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "error": str(e),
                "service": "master-clash-api",
            }
        )


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Global exception handler."""
    import traceback

    logger.error(f"Global exception: {exc}")
    logger.debug(traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal Server Error: {str(exc)}", "type": type(exc).__name__},
    )


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "master_clash.api.main:app",
        host="0.0.0.0",
        port=8888,
        reload=True,  # Disable in production
    )
