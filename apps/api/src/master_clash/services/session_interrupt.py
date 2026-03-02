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
    from master_clash.json_utils import loads as json_loads

    async with get_db_context() as session:
        result = await session.execute(
            select(SessionEvent).where(SessionEvent.thread_id == thread_id)
            .order_by(SessionEvent.created_at.asc())
        )
        events = result.scalars().all()

        processed_events = []
        for e in events:
            payload = e.payload
            # Handle case where JSON is returned as string (e.g. SQLite)
            if isinstance(payload, str):
                try:
                    payload = json_loads(payload)
                except Exception:
                    logger.warning(f"Failed to parse payload JSON for event {e.id}")
                    payload = {}
            elif not isinstance(payload, dict):
                # Ensure payload is always a dict
                payload = {}

            processed_events.append({
                "event_type": e.event_type,
                "payload": payload,
                "created_at": e.created_at,
            })

        return processed_events


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
    # Map to find items by their ID for updates
    items_by_id = {}
    # Map to find nested log entries by tool ID
    tool_logs_by_id = {}

    for event in events:
        event_type = event.get("event_type")
        payload = event.get("payload", {})

        if event_type in ("user_message", "human"):
            # Handle user/human messages
            messages.append({
                "type": "message",
                "role": "user",
                "content": payload.get("content", ""),
                "id": payload.get("id", _generate_id()),
            })
        elif event_type in ("ai_message", "text", "assistant"):
            # Handle AI/assistant messages - map 'text' event to ai_message
            messages.append({
                "type": "message",
                "role": "assistant",
                "content": payload.get("content", payload.get("content", "")),
                "id": payload.get("id", _generate_id()),
            })
        elif event_type == "thinking":
            # Append thinking to the last agent card if it belongs to it, or create new
            agent_name = payload.get("agent")
            content = payload.get("content", "")
            # (Simplified: just show as thinking message for now to avoid complexity)
            messages.append({
                "type": "thinking",
                "content": content,
                "id": payload.get("id", _generate_id()),
            })
        elif event_type in ("tool_call", "tool_start"):
            # Handle tool calls
            tool_name = payload.get("tool_name") or payload.get("tool") or payload.get("name") or "unknown"
            args = payload.get("args") or payload.get("input") or payload.get("arguments") or {}
            status = payload.get("status", "pending")
            agent_name = payload.get("agent")
            agent_id = payload.get("agent_id")
            item_id = payload.get("id", _generate_id())

            # Logic to determine if standalone or nested
            is_standalone = True
            if agent_name and agent_name not in ("Director", "Agent", "agent", "MasterClash"):
                is_standalone = False

            # Special case: task_delegation is always standalone/special in frontend
            if tool_name == "task_delegation":
                is_standalone = True

            target_card = None
            if not is_standalone:
                # Try to find the active agent card to append to
                if agent_id and agent_id in items_by_id:
                     target_card = items_by_id[agent_id]
                elif agent_name:
                    # Find last card with this agent name
                    for msg in reversed(messages):
                        if msg.get("type") == "agent_card" and msg.get("props", {}).get("agentName") == agent_name:
                            target_card = msg
                            break

            if target_card:
                # Append to logs
                log_entry = {
                    "id": item_id,
                    "type": "tool_call",
                    "toolProps": {
                        "toolName": tool_name,
                        "args": args,
                        "status": status,
                        "indent": False,
                    }
                }
                if "logs" not in target_card["props"]:
                    target_card["props"]["logs"] = []
                target_card["props"]["logs"].append(log_entry)
                tool_logs_by_id[item_id] = log_entry
            else:
                # Create standalone message
                item = {
                    "type": "tool_call",
                    "id": item_id,
                    "props": {
                        "toolName": tool_name,
                        "args": args,
                        "status": status,
                        "indent": False,
                    },
                }
                messages.append(item)
                items_by_id[item_id] = item

        elif event_type == "tool_end":
            item_id = payload.get("id")
            status = payload.get("status", "success")
            result = payload.get("result")

            if item_id:
                # Try updating standalone tool
                if item_id in items_by_id:
                    tool_item = items_by_id[item_id]
                    if tool_item.get("type") == "tool_call":
                        tool_item["props"]["status"] = status
                        tool_item["props"]["result"] = result

                # Try updating nested tool log
                if item_id in tool_logs_by_id:
                    log_entry = tool_logs_by_id[item_id]
                    log_entry["toolProps"]["status"] = status
                    log_entry["toolProps"]["result"] = result

        elif event_type == "agent_card":
            item_id = payload.get("id", _generate_id())
            item = {
                "type": "agent_card",
                "id": item_id,
                "props": {
                    "agentId": payload.get("agent_id"),
                    "agentName": payload.get("agent_name"),
                    "status": payload.get("status", "working"),
                    "persona": payload.get("agent_name", "").lower(),
                    "logs": payload.get("logs", []),
                },
            }
            messages.append(item)
            if payload.get("agent_id"):
                items_by_id[payload.get("agent_id")] = item
            items_by_id[item_id] = item

        elif event_type in ("sub_agent_start", "sub_agent_card"):
            agent_name = payload.get("agent")
            item_id = payload.get("id", _generate_id())
            agent_id = payload.get("agent_id") or payload.get("id")

            item = {
                "type": "agent_card",
                "id": item_id,
                "props": {
                    "agentId": agent_id,
                    "agentName": agent_name,
                    "status": "working",
                    "persona": agent_name.lower() if agent_name else "",
                    "logs": [],
                },
            }
            messages.append(item)
            items_by_id[agent_id] = item

        elif event_type == "sub_agent_end":
            agent_id = payload.get("agent_id") or payload.get("id")
            agent_name = payload.get("agent")

            found = False
            if agent_id and agent_id in items_by_id:
                items_by_id[agent_id]["props"]["status"] = "completed"
                if payload.get("result"):
                     items_by_id[agent_id]["props"]["logs"].append({
                        "id": f"{agent_id}-end",
                        "type": "text",
                        "content": f"Completed: {payload.get('result')}"
                     })
                found = True

            if not found and agent_name:
                for msg in reversed(messages):
                    if msg.get("type") == "agent_card" and msg.get("props", {}).get("agentName") == agent_name:
                        msg["props"]["status"] = "completed"
                        break

        elif event_type == "workflow_error":
            messages.append({
                "type": "message",
                "role": "assistant",
                "content": f"Error: {payload.get('message', 'Unknown error')}",
                "id": payload.get("id", _generate_id()),
            })

        elif event_type == "session_interrupted":
            messages.append({
                "type": "message",
                "role": "assistant",
                "content": f"⏸️ {payload.get('message', 'Session interrupted.')}",
                "id": payload.get("id", _generate_id()),
            })

        elif event_type == "human_interrupt":
            messages.append({
                "type": "message",
                "role": "assistant",
                "content": f"✋ Human input requested: {payload.get('message', '')}",
                "id": payload.get("id", _generate_id()),
            })

    return messages
