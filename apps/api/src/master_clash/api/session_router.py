"""Session management API endpoints.

Provides endpoints for session status and interrupt control:
- GET /api/v1/session/{thread_id}/status - Get session status
- POST /api/v1/session/{thread_id}/interrupt - Request session interruption
"""

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from master_clash.services.session_interrupt import (
    get_session_status,
    request_interrupt,
    get_session_history_from_events,
    list_project_sessions,
    delete_session,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/session", tags=["session"])


class SessionStatusResponse(BaseModel):
    """Response for session status endpoint."""
    thread_id: str = Field(..., description="Session thread ID")
    status: str | None = Field(None, description="Session status: running, completing, interrupted, completed")
    exists: bool = Field(..., description="Whether session exists")


class InterruptResponse(BaseModel):
    """Response for interrupt endpoint."""
    thread_id: str = Field(..., description="Session thread ID")
    success: bool = Field(..., description="Whether interrupt request was accepted")
    status: str = Field(..., description="New session status")
    message: str = Field(..., description="Human-readable message")


@router.get("/{thread_id}/status", response_model=SessionStatusResponse)
async def get_session_status_endpoint(thread_id: str):
    """Get the current status of a session.
    
    Returns:
        Session status information
    """
    logger.info(f"[SessionAPI] Status check: thread_id={thread_id}")
    
    status = await get_session_status(thread_id)

    return SessionStatusResponse(
        thread_id=thread_id,
        status=status,
        exists=status is not None,
    )


@router.post("/{thread_id}/interrupt", response_model=InterruptResponse)
async def interrupt_session_endpoint(thread_id: str):
    """Request interruption of a running session.
    
    The session will complete its current step and then stop gracefully.
    The client can resume the session later using the same thread_id.
    
    Returns:
        Interrupt confirmation
    """
    logger.info(f"[SessionAPI] Interrupt requested: thread_id={thread_id}")
    
    success = await request_interrupt(thread_id)
    
    if success:
        return InterruptResponse(
            thread_id=thread_id,
            success=True,
            status="completing",
            message="Interrupt requested. Session will stop after current step.",
        )
    else:
        # Check if session exists
        status = await get_session_status(thread_id)
        if status is None:
            raise HTTPException(
                status_code=404,
                detail=f"Session not found: {thread_id}",
            )
        elif status in ("interrupted", "completed"):
            return InterruptResponse(
                thread_id=thread_id,
                success=False,
                status=status,
                message=f"Session already {status}.",
            )
        else:
            return InterruptResponse(
                thread_id=thread_id,
                success=False,
                status=status,
                message=f"Could not interrupt session with status: {status}",
            )


class SessionHistoryResponse(BaseModel):
    """Response for session history endpoint."""
    thread_id: str = Field(..., description="Session thread ID")
    messages: list[dict] = Field(..., description="List of messages in the session")


@router.get("/{thread_id}/history", response_model=SessionHistoryResponse)
async def get_session_history_endpoint(thread_id: str):
    """Get the message history of a session using event replay.
    
    Loads events from the session_events table for the given thread_id 
    and reconstructs the display items.
    """
    logger.info(f"[SessionAPI] Event-based history requested: thread_id={thread_id}")
    
    messages = await get_session_history_from_events(thread_id)
    
    return SessionHistoryResponse(
        thread_id=thread_id,
        messages=messages,
    )


class ProjectSessionListResponse(BaseModel):
    """Response for project session list endpoint."""
    project_id: str = Field(..., description="Project ID")
    sessions: list[dict[str, Any]] = Field(..., description="List of session objects for this project")


@router.get("/project/{project_id}/list", response_model=ProjectSessionListResponse)
async def list_project_sessions_endpoint(project_id: str):
    """List all sessions for a specific project.
    
    Returns:
        List of session thread IDs
    """
    logger.info(f"[SessionAPI] Project session list requested: project_id={project_id}")
    
    sessions = await list_project_sessions(project_id)

    return ProjectSessionListResponse(
        project_id=project_id,
        sessions=sessions,
    )
@router.delete("/{thread_id}")
async def delete_session_endpoint(thread_id: str):
    """Delete a session and all its associated data.
    
    Args:
        thread_id: Session identifier
    """
    logger.info(f"[SessionAPI] Deleting session: {thread_id}")
    success = await delete_session(thread_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete session")
    return {"success": True, "thread_id": thread_id}
