"""Session interrupt service - SQLAlchemy ORM version."""

import asyncio
import logging
from datetime import datetime
from typing import Any, Literal

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from master_clash.database.checkpointer import get_async_checkpointer
from master_clash.database.di import get_db_context
from master_clash.database.models import SessionInterrupt
from master_clash.json_utils import dumps as json_dumps, loads as json_loads

logger = logging.getLogger(__name__)

SessionStatus = Literal["running", "completing", "interrupted", "completed"]


# === Session Operations ===

async def create_session(thread_id: str, project_id: str, title: str | None = None) -> None:
    """Create or update a session record when starting a workflow."""
    async with get_db_context() as session:
        now = datetime.utcnow()

        # Check if exists
        result = await session.execute(
            select(SessionInterrupt).where(SessionInterrupt.thread_id == thread_id)
        )
        session_obj = result.scalar_one_or_none()

        if session_obj:
            # Update existing
            session_obj.status = "running"
            session_obj.interrupted_at = None
            session_obj.updated_at = now
            session_obj.is_deleted = 0
        else:
            # Create new
            session_obj = SessionInterrupt(
                thread_id=thread_id,
                project_id=project_id,
                status="running",
                title=title,
                created_at=now,
                updated_at=now,
                is_deleted=0,
            )
            session.add(session_obj)

        await session.commit()
        logger.info(f"[Session] Created/updated session: {thread_id}")


async def request_interrupt(thread_id: str) -> bool:
    """Request interruption of a session."""
    async with get_db_context() as session:
        now = datetime.utcnow()

        result = await session.execute(
            select(SessionInterrupt).where(
                (SessionInterrupt.thread_id == thread_id)
                & (SessionInterrupt.status == "running")
                & (SessionInterrupt.is_deleted == 0)
            )
        )
        session_obj = result.scalar_one_or_none()

        if not session_obj:
            return False

        session_obj.status = "completing"
        session_obj.interrupted_at = now
        session_obj.updated_at = now
        await session.commit()

        logger.info(f"[Session] Interrupt requested: {thread_id}")
        return True


async def check_interrupt_flag(thread_id: str) -> bool:
    """Check if a session should be interrupted (sync version for callbacks)."""
    # This needs to be sync for LangGraph callbacks
    # Run async function in thread pool
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # Use create_task if loop is running
            future = asyncio.ensure_future(check_interrupt_flag_async(thread_id))
            # Don't await - return default value for sync context
            return False
        else:
            return loop.run_until_complete(check_interrupt_flag_async(thread_id))
    except:
        return False


async def check_interrupt_flag_async(thread_id: str) -> bool:
    """Async version of interrupt flag check."""
    async with get_db_context() as session:
        result = await session.execute(
            select(SessionInterrupt.status).where(
                (SessionInterrupt.thread_id == thread_id)
                & (SessionInterrupt.is_deleted == 0)
            )
        )
        status = result.scalar_one_or_none()

        if not status:
            return False

        should_interrupt = status in ("completing", "interrupted")
        if should_interrupt:
            logger.debug(f"[Session] Interrupt flag TRUE: {thread_id}")
        return should_interrupt


async def set_session_status(thread_id: str, status: SessionStatus) -> None:
    """Update session status."""
    async with get_db_context() as session:
        now = datetime.utcnow()

        result = await session.execute(
            select(SessionInterrupt).where(
                (SessionInterrupt.thread_id == thread_id)
                & (SessionInterrupt.is_deleted == 0)
            )
        )
        session_obj = result.scalar_one_or_none()

        if session_obj:
            session_obj.status = status
            session_obj.updated_at = now
            await session.commit()

            logger.info(f"[Session] Status updated: {thread_id} -> {status}")


async def get_session_status(thread_id: str) -> SessionStatus | None:
    """Get current session status."""
    async with get_db_context() as session:
        result = await session.execute(
            select(SessionInterrupt.status).where(
                (SessionInterrupt.thread_id == thread_id)
                & (SessionInterrupt.is_deleted == 0)
            )
        )
        return result.scalar_one_or_none()


async def delete_session(thread_id: str) -> bool:
    """Soft delete a session."""
    async with get_db_context() as session:
        now = datetime.utcnow()

        result = await session.execute(
            select(SessionInterrupt).where(SessionInterrupt.thread_id == thread_id)
        )
        session_obj = result.scalar_one_or_none()

        if session_obj:
            session_obj.is_deleted = 1
            session_obj.deleted_at = now
            session_obj.updated_at = now
            await session.commit()

            logger.info(f"[Session] Soft deleted: {thread_id}")
            return True

        return False


async def list_project_sessions(project_id: str) -> list[dict[str, Any]]:
    """List all session IDs and titles for a project."""
    async with get_db_context() as session:
        result = await session.execute(
            select(SessionInterrupt.thread_id, SessionInterrupt.title, SessionInterrupt.updated_at)
            .where(
                (SessionInterrupt.project_id == project_id)
                & (SessionInterrupt.is_deleted == 0)
            )
            .order_by(SessionInterrupt.updated_at.desc())
        )

        return [
            {
                "thread_id": row.thread_id,
                "title": row.title or f"Session {row.thread_id[-6:]}",
                "updated_at": row.updated_at,
            }
            for row in result.all()
        ]


async def generate_and_update_title(thread_id: str, first_message: Any) -> str:
    """Generate a summary title for a session using LLM and update DB."""
    def _extract_text(content: Any) -> str:
        if content is None:
            return ""
        if isinstance(content, list):
            return "".join(
                part.get("text", "")
                for part in content
                if isinstance(part, dict) and "text" in part
            )
        return str(content)

    try:
        from master_clash.workflow.multi_agent import create_default_llm

        llm = create_default_llm()
        msg_text = _extract_text(first_message)
        prompt = f"Summarize into a concise title (3-5 words max).\n\nRequest: {msg_text}"

        response = await llm.ainvoke(prompt)
        content = response.content
        title_text = _extract_text(content).strip().strip('"').strip("'")

        if not title_text:
            title_text = f"Session {thread_id[-6:]}"

        async with get_db_context() as session:
            result = await session.execute(
                select(SessionInterrupt).where(SessionInterrupt.thread_id == thread_id)
            )
            session_obj = result.scalar_one_or_none()

            if session_obj:
                session_obj.title = title_text
                session_obj.updated_at = datetime.utcnow()
                await session.commit()

                logger.info(f"[Session] Title generated: {title_text} for {thread_id}")

        return title_text

    except Exception as e:
        logger.error(f"[Session] Failed to generate title: {e}")
        return f"Session {thread_id[-6:]}"


async def get_session_history(thread_id: str) -> list[dict[str, Any]]:
    """Retrieve structured message history from LangGraph checkpoints."""
    logger.info(f"[SessionHistory] Fetching history for {thread_id}")

    checkpointer = await get_async_checkpointer()
    config = {"configurable": {"thread_id": thread_id}}

    checkpoint_tuple = await _get_checkpoint_tuple(checkpointer, config)
    if not checkpoint_tuple:
        logger.warning(f"[SessionHistory] No checkpoint for {thread_id}")
        return []

    state = checkpoint_tuple.checkpoint.get("channel_values", {})
    messages = state.get("messages", [])

    if not messages:
        logger.info(f"[SessionHistory] No messages for {thread_id}")
        return []

    tool_outputs = {}
    for msg in messages:
        if isinstance(msg, ToolMessage):
            tool_outputs[msg.tool_call_id] = msg.content

    history = []
    for msg in messages:
        if not isinstance(msg, BaseMessage):
            continue

        if isinstance(msg, HumanMessage):
            history.append({
                "type": "message",
                "role": "user",
                "content": msg.content,
                "id": msg.id or _generate_id(),
            })
        elif isinstance(msg, AIMessage):
            if isinstance(msg.content, list):
                for part in msg.content:
                    if isinstance(part, dict):
                        if part.get("type") == "thinking":
                            history.append({
                                "type": "thinking",
                                "content": part.get("thinking", ""),
                                "id": _generate_id(),
                            })
                        elif part.get("type") == "text":
                            history.append({
                                "type": "message",
                                "role": "assistant",
                                "content": part.get("text", ""),
                                "id": _generate_id(),
                            })
            elif isinstance(msg.content, str) and msg.content:
                history.append({
                    "type": "message",
                    "role": "assistant",
                    "content": msg.content,
                    "id": msg.id or _generate_id(),
                })

            if hasattr(msg, "tool_calls") and msg.tool_calls:
                for tc in msg.tool_calls:
                    tool_name = tc.get("name")
                    tool_args = tc.get("args", {})
                    tc_id = tc.get("id")

                    if tool_name == "task_delegation":
                        agent_name = tool_args.get("agent", "Specialist")
                        history.append({
                            "type": "agent_card",
                            "id": f"agent-{tc_id}",
                            "props": {
                                "agentId": tc_id,
                                "agentName": agent_name,
                                "status": "completed" if tc_id in tool_outputs else "working",
                                "persona": agent_name.lower(),
                                "logs": [],
                            },
                        })
                    else:
                        history.append({
                            "type": "tool_call",
                            "id": tc_id,
                            "props": {
                                "toolName": tool_name,
                                "args": tool_args,
                                "status": "success" if tc_id in tool_outputs else "pending",
                                "indent": False,
                            },
                        })

    logger.info(f"[SessionHistory] Generated {len(history)} items for {thread_id}")
    return history


def _generate_id() -> str:
    """Generate unique ID."""
    import random
    import string
    import time
    return str(int(time.time() * 1000)) + "".join(
        random.choices(string.ascii_lowercase + string.digits, k=7)
    )


async def _get_checkpoint_tuple(checkpointer: Any, config: dict[str, Any]):
    """Get checkpoint tuple from checkpointer."""
    aget = getattr(checkpointer, "aget_tuple", None)
    if callable(aget):
        try:
            return await aget(config)
        except NotImplementedError:
            pass

    get_tuple = getattr(checkpointer, "get_tuple", None)
    if callable(get_tuple):
        return await asyncio.to_thread(get_tuple, config)

    return None


async def get_session_events(thread_id: str) -> list[dict[str, Any]]:
    """Retrieve all logged events for a session."""
    from master_clash.database.models import SessionEvent

    async with get_db_context() as session:
        result = await session.execute(
            select(SessionEvent).where(SessionEvent.thread_id == thread_id)
            .order_by(SessionEvent.created_at.asc())
        )
        events = result.scalars().all()

        return [
            {
                "event_type": e.event_type,
                "payload": e.payload if isinstance(e.payload, dict) else {},
                "created_at": e.created_at,
            }
            for e in events
        ]


async def log_session_event(thread_id: str, event_type: str, payload: dict[str, Any]) -> None:
    """Log a streaming event to the database."""
    from master_clash.database.models import SessionEvent

    async with get_db_context() as session:
        event = SessionEvent(
            thread_id=thread_id,
            event_type=event_type,
            payload=payload,  # SQLAlchemy JSON type handles serialization
        )
        session.add(event)
        await session.commit()


async def get_session_history_from_events(thread_id: str) -> list[dict[str, Any]]:
    """Reconstruct message history from session events table."""
    events = await get_session_events(thread_id)

    # Convert events to display items format
    messages = []
    for event in events:
        event_type = event.get("event_type")
        payload = event.get("payload", {})

        if event_type == "user_message":
            messages.append({
                "type": "message",
                "role": "user",
                "content": payload.get("content", ""),
                "id": payload.get("id", _generate_id()),
            })
        elif event_type == "ai_message":
            messages.append({
                "type": "message",
                "role": "assistant",
                "content": payload.get("content", ""),
                "id": payload.get("id", _generate_id()),
            })
        elif event_type == "thinking":
            messages.append({
                "type": "thinking",
                "content": payload.get("content", ""),
                "id": payload.get("id", _generate_id()),
            })
        elif event_type == "tool_call":
            messages.append({
                "type": "tool_call",
                "id": payload.get("id", _generate_id()),
                "props": {
                    "toolName": payload.get("tool_name"),
                    "args": payload.get("args", {}),
                    "status": payload.get("status", "pending"),
                    "indent": False,
                },
            })
        elif event_type == "agent_card":
            messages.append({
                "type": "agent_card",
                "id": payload.get("id", _generate_id()),
                "props": {
                    "agentId": payload.get("agent_id"),
                    "agentName": payload.get("agent_name"),
                    "status": payload.get("status", "working"),
                    "persona": payload.get("agent_name", "").lower(),
                    "logs": payload.get("logs", []),
                },
            })

    return messages
