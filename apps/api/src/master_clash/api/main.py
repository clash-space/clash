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
from typing import Any

import requests
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

# from master_clash.video_analysis import VideoAnalysisOrchestrator, VideoAnalysisConfig, VideoAnalysisResult
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field

from master_clash.api.describe_router import router as describe_router
from master_clash.api.execute_router import router as execute_router
from master_clash.api.session_router import router as session_router
from master_clash.api.stream_emitter import StreamEmitter
from master_clash.api.tasks_router import router as tasks_router
from master_clash.api.thumbnail_router import router as thumbnail_router
from master_clash.config import get_settings
from master_clash.context import ProjectContext, set_project_context
from master_clash.loro_sync import LoroSyncClient
from master_clash.tools.description import generate_description
from master_clash.tools.kling_video import kling_video_gen
from master_clash.tools.nano_banana import nano_banana_gen
from master_clash.utils import image_to_base64
from master_clash.workflow.multi_agent import get_or_create_graph

# Configure logging
settings = get_settings()
logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.FileHandler("backend.log"), logging.StreamHandler()],
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
    emitter = StreamEmitter()

    if not resume and not user_input:
        raise HTTPException(
            status_code=400, detail="user_input is required when starting a new run"
        )

    def _extract_text(content: Any) -> str:
        if content is None:
            return ""
        if isinstance(content, list):
            return "".join(part.get("text", "") for part in content if isinstance(part, dict))
        return str(content)

    async def event_stream():
        # Initialize Loro sync client
        loro_client = LoroSyncClient(
            project_id=project_id,
            sync_server_url=settings.loro_sync_url or "ws://localhost:8787",
        )

        try:
            await loro_client.connect()
            logger.info(f"[LoroSync] Connected for project {project_id}")
        except Exception as e:
            logger.error(f"[LoroSync] Failed to connect: {e}")
            # Continue anyway - degrade gracefully

        # Create/update session record for interrupt tracking
        from master_clash.services.session_interrupt import (
            create_session,
            generate_and_update_title,
            set_session_status,
        )

        await create_session(thread_id, project_id)

        # If new session, trigger title generation in background
        if not resume and user_input:
            asyncio.create_task(generate_and_update_title(thread_id, user_input))

        logger.info(f"[Session] Started: thread_id={thread_id}, project_id={project_id}")

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
            # Log the original user input as an event for complete history replay
            from master_clash.services.session_interrupt import log_session_event

            log_session_event(thread_id, "user_message", {"content": user_input})

        config = {
            "configurable": {
                "thread_id": thread_id,
                "loro_client": loro_client,  # Inject Loro client into config
            }
        }
        stream_modes = ["messages", "custom"]  # Only messages and custom modes
        emitted_tool_ids = set()
        tool_id_to_name = {}  # Cache tool_call_id -> tool_name mapping
        tool_call_to_agent = {}  # Cache task_delegation tool_call_id -> target_agent_name mapping
        # Cache namespace (first element) -> (agent_name, agent_id)
        # agent_id is the task_delegation tool_call_id that spawned this namespace
        namespace_to_agent: dict[str, tuple[str, str | None]] = {}
        # Queue of pending delegations: when a new namespace appears right after task_delegation,
        # use the next queued (agent, tool_id) as its identity so agent_id == tool_call_id.

        def resolve_agent(namespace, fallback_agent: str | None) -> tuple[str | None, str | None]:
            """Map a namespace to a stable agent + agent_id (delegation tool_call_id)."""
            agent = fallback_agent
            agent_id = None
            ns_first = namespace[0] if namespace and isinstance(namespace[0], str) else None

            # 1) Try to derive agent_id from namespace (tools:<id> / calls:<id> / tools:call_xxx)
            if ns_first and ":" in ns_first:
                _, maybe_call = ns_first.split(":", 1)
                agent_id = maybe_call  # even if it lacks call_ prefix
                mapped_agent = tool_call_to_agent.get(agent_id)
                if mapped_agent:
                    agent = mapped_agent
                    namespace_to_agent[ns_first] = (mapped_agent, agent_id)

            # 2) Check cache
            if ns_first:
                cached = namespace_to_agent.get(ns_first)
                if cached:
                    agent, agent_id = cached
                    logger.info(
                        f"[AGENT_NAME] Resolved from cache: {ns_first} -> {agent} ({agent_id})"
                    )
                elif agent_id and not agent:
                    # 3) If we have an id but missing name, try mapping from tool_call_to_agent
                    mapped_agent = tool_call_to_agent.get(agent_id)
                    if mapped_agent:
                        agent = mapped_agent
                        namespace_to_agent[ns_first] = (mapped_agent, agent_id)
                        logger.info(
                            f"[AGENT_NAME] Mapped via tool_call_to_agent: {ns_first} -> {agent} ({agent_id})"
                        )

            # 4) Fallback id for isolation
            if ns_first and not agent_id:
                agent_id = ns_first
            return agent, agent_id

        try:
            # Get or create the workflow graph lazily with retry logic
            from psycopg import OperationalError as PsycopgOperationalError

            max_graph_retries = 2
            graph = None

            for attempt in range(max_graph_retries + 1):
                try:
                    graph = await get_or_create_graph()
                    break  # Success, exit retry loop
                except PsycopgOperationalError as e:
                    error_msg = str(e).lower()
                    if "ssl connection has been closed" in error_msg:
                        logger.warning(
                            f"SSL connection error while initializing graph (attempt {attempt + 1}/{max_graph_retries + 1}): {e}"
                        )
                        if attempt < max_graph_retries:
                            # Reset the connection pool to force fresh connections
                            from master_clash.database.pg_checkpointer import reset_connection_pool
                            await reset_connection_pool()
                            # Wait before retry
                            await asyncio.sleep(1.0 * (attempt + 1))
                        else:
                            logger.error(f"Failed to initialize graph after {max_graph_retries + 1} attempts")
                            raise
                    else:
                        # Non-SSL error, don't retry
                        raise
                except Exception as e:
                    logger.error(f"Unexpected error initializing graph: {e}", exc_info=True)
                    raise

            if graph is None:
                raise RuntimeError("Failed to initialize workflow graph")

            async for streamed in graph.astream(
                inputs,
                config=config,
                stream_mode=stream_modes,
                subgraphs=True,  # surface subgraph/custom events from nested calls
            ):
                namespace = []
                mode = None
                payload = streamed
                from langchain_core.load import dumps

                logger.info(f"Stream: streamed={dumps(streamed)}")
                # Format is [namespace, mode, data] where namespace is a list
                if isinstance(streamed, (list, tuple)) and len(streamed) == 3:
                    namespace, mode, payload = streamed
                    logger.debug(f"Stream: namespace={namespace}, mode={mode}")
                else:
                    logger.warning(
                        f"Unexpected stream format: type={type(streamed)}, len={len(streamed) if hasattr(streamed, '__len__') else 'N/A'}"
                    )

                if mode == "messages":
                    # Payload is a list: [msg_chunk_dict, metadata_dict]
                    if not isinstance(payload, (list, tuple)) or len(payload) != 2:
                        continue

                    msg_chunk_dict, metadata = payload

                    # Debug: Log metadata structure (only when there's a namespace or specific conditions)
                    if namespace:
                        logger.info(f"[STREAM DEBUG] mode=messages, namespace={namespace}")
                        if isinstance(metadata, dict):
                            logger.info(
                                f"[STREAM DEBUG] langgraph_node={metadata.get('langgraph_node')}"
                            )
                            logger.info(
                                f"[STREAM DEBUG] langgraph_triggers={metadata.get('langgraph_triggers')}"
                            )
                            logger.info(
                                f"[STREAM DEBUG] langgraph_path={metadata.get('langgraph_path')}"
                            )

                    agent_name = (
                        metadata.get("langgraph_node") if isinstance(metadata, dict) else None
                    )

                    # If this is the root graph (empty namespace) and node is 'agent', it's the Director
                    if not namespace and agent_name == "model":
                        logger.info("[AGENT_NAME] Root graph agent -> Director")
                        agent_name = "Director"
                    # Handle sub-graph: resolve agent name/id from task_delegation mapping
                    agent_name, agent_id = resolve_agent(namespace, agent_name)
                    #
                    agent_id = metadata.get("agent_id", "")
                    logger.info(f"real agent_id: {agent_id}")
                    # Normalize agent_id and prefer mapped agent name
                    if isinstance(agent_id, str) and agent_id.startswith("tools:"):
                        agent_id = agent_id.split(":", 1)[1]
                    mapped_agent = tool_call_to_agent.get(agent_id) if agent_id else None
                    if mapped_agent:
                        agent_name = mapped_agent

                    # Handle tool calls
                    tool_calls = []
                    if isinstance(msg_chunk_dict, dict):
                        kwargs = msg_chunk_dict.get("kwargs", {})
                        if isinstance(kwargs, dict):
                            tool_calls = kwargs.get("tool_calls", [])
                    else:
                        tool_calls = getattr(msg_chunk_dict, "tool_calls", [])

                    if tool_calls:
                        for tool_call in tool_calls:
                            # Handle both dict and object tool calls
                            if isinstance(tool_call, dict):
                                tool_name = tool_call.get("name")
                                tool_args = tool_call.get("args", {})
                                tool_id = tool_call.get("id")
                            else:
                                tool_name = getattr(tool_call, "name", None)
                                tool_args = getattr(tool_call, "args", {})
                                tool_id = getattr(tool_call, "id", None)

                            if tool_name and tool_id and tool_id not in emitted_tool_ids:
                                # Debug: Log tool_start
                                logger.info(
                                    f"[TOOL_START DEBUG] tool={tool_name}, id={tool_id}, agent={agent_name}"
                                )
                                logger.info(f"[TOOL_START DEBUG] namespace={namespace}")

                                emitted_tool_ids.add(tool_id)
                                tool_id_to_name[tool_id] = tool_name  # Cache tool name mapping

                                # If this is task_delegation, cache the target agent mapping
                                if tool_name == "task_delegation" and isinstance(tool_args, dict):
                                    target_agent = tool_args.get("agent")
                                    if target_agent:
                                        tool_call_to_agent[tool_id] = target_agent
                                        namespace_to_agent[f"tools:{tool_id}"] = (
                                            target_agent,
                                            tool_id,
                                        )
                                        namespace_to_agent[f"calls:{tool_id}"] = (
                                            target_agent,
                                            tool_id,
                                        )
                                        namespace_to_agent[tool_id] = (target_agent, tool_id)
                                        logger.info(
                                            f"[MAPPING] Cached: {tool_id} -> {target_agent}"
                                        )
                                        logger.info(
                                            f"[TOOL_START DEBUG] task_delegation args: {tool_args}"
                                        )
                                        logger.info(
                                            f"[TOOL_START DEBUG] target_agent: {target_agent}"
                                        )

                                yield emitter.format_event(
                                    "tool_start",
                                    {
                                        "id": tool_id,
                                        "tool": tool_name,
                                        "input": tool_args,
                                        "agent": agent_name or "Agent",
                                        "agent_id": agent_id,
                                    },
                                    thread_id=thread_id,
                                )

                    # Handle tool outputs (ToolMessage)
                    if isinstance(msg_chunk_dict, dict):
                        msg_type = msg_chunk_dict.get("type")
                        tool_call_id = msg_chunk_dict.get("tool_call_id")
                        content = msg_chunk_dict.get("content", "")
                        # Debug: Log ToolMessage checking
                        logger.info(
                            f"[TOOL_END DEBUG] Checking dict - type={msg_type}, tool_call_id={tool_call_id}"
                        )
                    else:
                        msg_type = getattr(msg_chunk_dict, "type", None)
                        tool_call_id = getattr(msg_chunk_dict, "tool_call_id", None)
                        content = getattr(msg_chunk_dict, "content", "")
                        # Debug: Log ToolMessage checking
                        logger.info(
                            f"[TOOL_END DEBUG] Checking obj - type={msg_type}, tool_call_id={tool_call_id}"
                        )
                        logger.info(
                            f"[TOOL_END DEBUG] Object type: {type(msg_chunk_dict).__name__}"
                        )

                    if msg_type == "tool" and tool_call_id:
                        # Get tool name from cache instead of from ToolMessage
                        tool_name = tool_id_to_name.get(tool_call_id, "unknown")

                        # For tool_end, we need to determine the correct agent
                        # If this is a task_delegation tool_end, the agent should be Director (the one who called it)
                        # Otherwise, use the resolved agent_name from namespace
                        tool_end_agent = agent_name
                        tool_end_agent_id = agent_id
                        if tool_name == "task_delegation":
                            # task_delegation is always called by Director
                            tool_end_agent = "Director"
                            tool_end_agent_id = (
                                tool_call_id  # use delegation call id as the block id
                            )
                        elif not namespace:
                            # Root graph, should be Director
                            tool_end_agent = "Director"
                            tool_end_agent_id = None
                        # else: use the resolved agent_name from namespace (sub-agent)

                        logger.info(
                            f"[TOOL_END] Emitting tool_end: id={tool_call_id}, tool={tool_name}, agent={tool_end_agent}"
                        )

                        # Determine if the tool execution was successful or failed
                        # Check if content indicates an error
                        is_error = isinstance(content, str) and (
                            content.lower().startswith("error")
                            or "error invoking tool" in content.lower()
                            or "field required" in content.lower()
                            or "validation error" in content.lower()
                        )
                        tool_status = "failed" if is_error else "success"

                        yield emitter.format_event(
                            "tool_end",
                            {
                                "id": tool_call_id,
                                "tool": tool_name,  # Use cached tool name
                                "result": content,
                                "status": tool_status,
                                "agent": tool_end_agent or "Agent",
                                "agent_id": tool_end_agent_id,
                            },
                            thread_id=thread_id,
                        )
                        continue
                    else:
                        # Debug: Log cases where tool_end is not emitted
                        if msg_type == "tool":
                            logger.warning(
                                f"[TOOL_END] ToolMessage without tool_call_id: {msg_chunk_dict}"
                            )
                        if tool_call_id and msg_type != "tool":
                            logger.warning(
                                f"[TOOL_END] Has tool_call_id but type is not 'tool': type={msg_type}, id={tool_call_id}"
                            )

                    # Extract content from the message chunk dict
                    if isinstance(msg_chunk_dict, dict):
                        kwargs = msg_chunk_dict.get("kwargs", {})
                        content = kwargs.get("content", []) if isinstance(kwargs, dict) else []
                    else:
                        content = getattr(msg_chunk_dict, "content", None)

                    logger.debug(
                        "stream messages chunk agent=%s content_preview=%s",
                        agent_name or "Agent",
                        repr(content)[:200] if content else "None",
                    )

                    # Handle list-style content parts (e.g., [{"type": "text", "text": "..."}])
                    if isinstance(content, list):
                        for part in content:
                            if not isinstance(part, dict):
                                continue
                            part_type = part.get("type")

                            # Handle thinking blocks
                            if part_type == "thinking":
                                thinking_text = part.get("thinking", "")
                                if thinking_text:
                                    logger.info(
                                        f"[THINKING] Sending thinking with agent={agent_name}, namespace={namespace}"
                                    )
                                    yield emitter.thinking(
                                        thinking_text,
                                        thread_id=thread_id,
                                        agent=agent_name or "Agent",
                                        agent_id=agent_id,
                                    )
                            # Handle text blocks
                            elif part_type == "text":
                                part_text = part.get("text", "")
                                if part_text:
                                    yield emitter.text(
                                        part_text,
                                        thread_id=thread_id,
                                        agent=agent_name or "Agent",
                                        agent_id=agent_id,
                                    )
                        continue

                    # Fallback for non-list content
                    text_content = _extract_text(content)
                    if text_content:
                        yield emitter.text(
                            text_content,
                            thread_id=thread_id,
                            agent=agent_name or "Agent",
                            agent_id=agent_id,
                        )

                elif mode == "custom":
                    data = payload
                    if isinstance(data, dict):
                        action = data.get("action")
                        # REMOVED: node_proposal SSE event - now handled via Loro CRDT
                        # Nodes are directly written to Loro document in middleware
                        # if action == "create_node_proposal" and data.get("proposal"):
                        #     yield emitter.format_event("node_proposal", data["proposal"])
                        #     continue
                        if action == "timeline_edit":
                            yield emitter.format_event("timeline_edit", data, thread_id=thread_id)
                            continue
                        if action == "rerun_generation_node":
                            # Emit rerun_generation_node event with nodeId, assetId, and nodeData
                            yield emitter.format_event(
                                "rerun_generation_node",
                                {
                                    "nodeId": data.get("nodeId"),
                                    "assetId": data.get("assetId"),
                                    "nodeData": data.get("nodeData"),
                                },
                                thread_id=thread_id,
                            )
                            continue
                        if action == "subagent_stream":
                            # Map subagent stream to thinking/text
                            agent = data.get("agent", "Agent")
                            _, agent_id = resolve_agent(namespace, agent)
                            content = data.get("content", "")
                            # For now, treat all subagent stream as 'thinking' or 'text' based on context
                            # The user specifically asked for 'thinking' block.
                            # Let's emit as 'thinking' for now to ensure it shows up in the agent card logs?
                            # Or better, if it's raw text from the model, it's likely the agent 'working'.
                            # In ChatbotCopilot.tsx, 'thinking' event adds to logs.
                            yield emitter.thinking(
                                content, thread_id=thread_id, agent=agent, agent_id=agent_id
                            )
                            continue
                        yield emitter.format_event("custom", data, thread_id=thread_id)

        except Exception as exc:  # pragma: no cover - surfaced to client
            # Check if this is an interrupt request
            from master_clash.workflow.interrupt_middleware import InterruptRequested

            if isinstance(exc, InterruptRequested):
                logger.info(f"[Session] Interrupted: thread_id={thread_id}")
                await set_session_status(thread_id, "interrupted")
                yield emitter.format_event(
                    "session_interrupted",
                    {
                        "thread_id": thread_id,
                        "message": "Session interrupted. You can resume later with the same thread_id.",
                    },
                    thread_id=thread_id,
                )
            else:
                logger.error("Stream workflow failed: %s", exc, exc_info=True)
                await set_session_status(thread_id, "completed")  # Mark as completed on error

                # Extract error message safely - avoid serialization issues
                error_msg = str(exc)
                if not error_msg or len(error_msg) > 500:
                    error_msg = f"{type(exc).__name__}: {str(exc)[:500]}"

                # Don't pass thread_id to avoid logging complex exception objects
                yield emitter.format_event("workflow_error", {"message": error_msg})

        # Always end the stream FIRST, before disconnecting Loro
        yield emitter.end(thread_id=thread_id)

        # Cleanup: Disconnect Loro client in background (non-blocking)
        # This prevents the SSE stream from waiting for the websocket to close
        async def cleanup_loro():
            try:
                await loro_client.disconnect()
                logger.info(f"[LoroSync] Disconnected for project {project_id}")
            except Exception as e:
                logger.error(f"[LoroSync] Failed to disconnect: {e}")

        asyncio.create_task(cleanup_loro())

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/api/generate-ids", response_model=GenerateSemanticIDResponse)
async def generate_semantic_ids(request: GenerateSemanticIDRequest):
    """Generate semantic IDs for a project.

    Returns human-readable, memorable IDs like "alpha-ocean-square"
    that are unique within the project scope.
    """
    try:
        from master_clash.semantic_id import create_id_checker, generate_unique_ids_for_project

        # Create generic checker (works with Postgres/SQLite)
        checker = create_id_checker()

        # Generate unique IDs
        ids = generate_unique_ids_for_project(request.project_id, request.count, checker)

        return GenerateSemanticIDResponse(ids=ids, project_id=request.project_id)

    except Exception as e:
        logger.error(f"Error generating semantic IDs: {e}")
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
