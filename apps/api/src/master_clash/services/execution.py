import asyncio
import logging
import uuid
import json
from typing import Any, AsyncGenerator, Dict, List, Optional, Set, Tuple

from langchain_core.messages import HumanMessage
from master_clash.api.stream_emitter import StreamEmitter
from master_clash.context import ProjectContext
from master_clash.services.session_interrupt import (
    log_session_event,
    check_interrupt_flag_async,
    set_session_status,
    create_session,
    generate_and_update_title,
)
from master_clash.workflow.multi_agent import get_or_create_graph
from master_clash.config import get_settings
from master_clash.loro_sync import LoroSyncClient

logger = logging.getLogger(__name__)

class SessionExecution:
    """
    Manages the execution of a single session's workflow.
    Runs the agent loop, poller loop for cancellation, and consumer loop for broadcasting/persistence.
    """

    def __init__(self, thread_id: str, project_id: str):
        self.thread_id = thread_id
        self.project_id = project_id
        self.internal_queue: asyncio.Queue[Tuple[str, Dict[str, Any], Optional[str]]] = asyncio.Queue()
        self.subscribers: Set[asyncio.Queue[str]] = set()
        self.tasks: List[asyncio.Task] = []
        self.is_running = False
        self.emitter = StreamEmitter()
        self.settings = get_settings()

    async def start(
        self,
        inputs: Optional[Dict[str, Any]],
        config: Dict[str, Any],
        user_input: Optional[str] = None,
        resume: bool = False
    ):
        """Start the execution loops."""
        if self.is_running:
            logger.warning(f"Session {self.thread_id} is already running.")
            return

        self.is_running = True

        # Start the 3 loops
        self.tasks.append(asyncio.create_task(self._worker_loop(inputs, config, user_input, resume)))
        self.tasks.append(asyncio.create_task(self._poller_loop()))
        self.tasks.append(asyncio.create_task(self._consumer_loop()))

        logger.info(f"[SessionExecution] Started session {self.thread_id}")

    async def stop(self):
        """Stop all execution loops."""
        if not self.is_running:
            return

        self.is_running = False

        # Cancel all tasks
        for task in self.tasks:
            task.cancel()

        # Wait for tasks to finish (ignore cancellation errors)
        if self.tasks:
            await asyncio.gather(*self.tasks, return_exceptions=True)

        self.tasks.clear()

        # Clear subscribers? No, maybe keep them? But the stream ends.
        # We should probably close subscribers queues to signal end of stream?
        # But SSE expects "end" event.

        logger.info(f"[SessionExecution] Stopped session {self.thread_id}")

    async def subscribe(self) -> AsyncGenerator[str, None]:
        """Subscribe to the event stream."""
        queue = asyncio.Queue()
        self.subscribers.add(queue)

        try:
            while True:
                # Wait for data
                data = await queue.get()
                if data == "__END__":
                    break
                yield data
        finally:
            self.subscribers.discard(queue)

    async def _worker_loop(
        self,
        inputs: Optional[Dict[str, Any]],
        config: Dict[str, Any],
        user_input: Optional[str],
        resume: bool
    ):
        """Runs the graph and pushes formatted events to internal_queue."""
        # Initialize Loro sync client
        loro_client = LoroSyncClient(
            project_id=self.project_id,
            sync_server_url=self.settings.loro_sync_url or "ws://localhost:8787",
        )

        try:
            await loro_client.connect()
            logger.info(f"[LoroSync] Connected for project {self.project_id}")

            # Inject Loro client into config
            if "configurable" not in config:
                config["configurable"] = {}
            config["configurable"]["loro_client"] = loro_client

            # Setup session in DB
            await create_session(self.thread_id, self.project_id)

            if not resume and user_input:
                # Trigger title generation
                asyncio.create_task(generate_and_update_title(self.thread_id, user_input))

                # Log user message
                await self._enqueue_event("user_message", {"content": user_input}, None)

            # Graph initialization logic
            from psycopg import OperationalError as PsycopgOperationalError
            max_graph_retries = 2
            graph = None

            for attempt in range(max_graph_retries + 1):
                try:
                    graph = await get_or_create_graph()
                    break
                except PsycopgOperationalError as e:
                    if "ssl connection has been closed" in str(e).lower() and attempt < max_graph_retries:
                         from master_clash.database.pg_checkpointer import reset_connection_pool
                         await reset_connection_pool()
                         await asyncio.sleep(1.0 * (attempt + 1))
                    else:
                        raise
                except Exception as e:
                    logger.error(f"Unexpected error initializing graph: {e}", exc_info=True)
                    raise

            if graph is None:
                raise RuntimeError("Failed to initialize workflow graph")

            stream_modes = ["messages", "custom"]

            # State tracking for formatting (copied from main.py)
            emitted_tool_ids = set()
            tool_id_to_name = {}
            tool_call_to_agent = {}
            namespace_to_agent: Dict[str, Tuple[str, Optional[str]]] = {}

            def resolve_agent(namespace, fallback_agent: str | None) -> Tuple[str | None, str | None]:
                """Map a namespace to a stable agent + agent_id (delegation tool_call_id)."""
                agent = fallback_agent
                agent_id = None
                ns_first = namespace[0] if namespace and isinstance(namespace[0], str) else None

                if ns_first and ":" in ns_first:
                    _, maybe_call = ns_first.split(":", 1)
                    agent_id = maybe_call
                    mapped_agent = tool_call_to_agent.get(agent_id)
                    if mapped_agent:
                        agent = mapped_agent
                        namespace_to_agent[ns_first] = (mapped_agent, agent_id)

                if ns_first:
                    cached = namespace_to_agent.get(ns_first)
                    if cached:
                        agent, agent_id = cached
                    elif agent_id and not agent:
                        mapped_agent = tool_call_to_agent.get(agent_id)
                        if mapped_agent:
                            agent = mapped_agent
                            namespace_to_agent[ns_first] = (mapped_agent, agent_id)

                if ns_first and not agent_id:
                    agent_id = ns_first
                return agent, agent_id

            def _extract_text(content: Any) -> str:
                if content is None:
                    return ""
                if isinstance(content, list):
                    return "".join(part.get("text", "") for part in content if isinstance(part, dict))
                return str(content)

            # --- Main Graph Execution ---
            async for streamed in graph.astream(
                inputs,
                config=config,
                stream_mode=stream_modes,
                subgraphs=True,
            ):
                namespace = []
                mode = None
                payload = streamed

                if isinstance(streamed, (list, tuple)) and len(streamed) == 3:
                    namespace, mode, payload = streamed

                if mode == "messages":
                    if not isinstance(payload, (list, tuple)) or len(payload) != 2:
                        continue

                    msg_chunk_dict, metadata = payload

                    agent_name = metadata.get("langgraph_node") if isinstance(metadata, dict) else None
                    if not namespace and agent_name == "model":
                        agent_name = "MasterClash"

                    agent_name, agent_id = resolve_agent(namespace, agent_name)
                    agent_id_meta = metadata.get("agent_id", "")

                    if isinstance(agent_id_meta, str) and agent_id_meta.startswith("tools:"):
                        agent_id_meta = agent_id_meta.split(":", 1)[1]

                    mapped_agent = tool_call_to_agent.get(agent_id_meta) if agent_id_meta else None
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
                            if isinstance(tool_call, dict):
                                tool_name = tool_call.get("name")
                                tool_args = tool_call.get("args", {})
                                tool_id = tool_call.get("id")
                            else:
                                tool_name = getattr(tool_call, "name", None)
                                tool_args = getattr(tool_call, "args", {})
                                tool_id = getattr(tool_call, "id", None)

                            if tool_name and tool_id and tool_id not in emitted_tool_ids:
                                emitted_tool_ids.add(tool_id)
                                tool_id_to_name[tool_id] = tool_name

                                if tool_name == "task_delegation" and isinstance(tool_args, dict):
                                    target_agent = tool_args.get("agent")
                                    if target_agent:
                                        tool_call_to_agent[tool_id] = target_agent
                                        namespace_to_agent[f"tools:{tool_id}"] = (target_agent, tool_id)
                                        namespace_to_agent[f"calls:{tool_id}"] = (target_agent, tool_id)
                                        namespace_to_agent[tool_id] = (target_agent, tool_id)

                                # Create event data
                                event_data = {
                                    "id": tool_id,
                                    "tool": tool_name,
                                    "input": tool_args,
                                    "agent": agent_name or "Agent",
                                    "agent_id": agent_id_meta,
                                }
                                # Generate SSE string without side-effect logging
                                sse_string = self.emitter.format_event("tool_start", event_data, thread_id=None)
                                await self._enqueue_event("tool_start", event_data, sse_string)

                    # Handle tool outputs (ToolMessage)
                    if isinstance(msg_chunk_dict, dict):
                        msg_type = msg_chunk_dict.get("type")
                        tool_call_id = msg_chunk_dict.get("tool_call_id")
                        content = msg_chunk_dict.get("content", "")
                    else:
                        msg_type = getattr(msg_chunk_dict, "type", None)
                        tool_call_id = getattr(msg_chunk_dict, "tool_call_id", None)
                        content = getattr(msg_chunk_dict, "content", "")

                    if msg_type == "tool" and tool_call_id:
                        tool_name = tool_id_to_name.get(tool_call_id, "unknown")
                        tool_end_agent = agent_name
                        tool_end_agent_id = agent_id_meta

                        if tool_name == "task_delegation":
                            tool_end_agent = "Director"
                            tool_end_agent_id = tool_call_id
                        elif not namespace:
                            tool_end_agent = "Director"
                            tool_end_agent_id = None

                        is_error = isinstance(content, str) and (
                            content.lower().startswith("error")
                            or "error invoking tool" in content.lower()
                            or "field required" in content.lower()
                            or "validation error" in content.lower()
                        )
                        tool_status = "failed" if is_error else "success"

                        event_data = {
                            "id": tool_call_id,
                            "tool": tool_name,
                            "result": content,
                            "status": tool_status,
                            "agent": tool_end_agent or "Agent",
                            "agent_id": tool_end_agent_id,
                        }
                        sse_string = self.emitter.format_event("tool_end", event_data, thread_id=None)
                        await self._enqueue_event("tool_end", event_data, sse_string)
                        continue

                    # Extract content
                    if isinstance(msg_chunk_dict, dict):
                        kwargs = msg_chunk_dict.get("kwargs", {})
                        content = kwargs.get("content", []) if isinstance(kwargs, dict) else []
                    else:
                        content = getattr(msg_chunk_dict, "content", None)

                    if isinstance(content, list):
                        for part in content:
                            if not isinstance(part, dict):
                                continue
                            part_type = part.get("type")

                            if part_type == "thinking":
                                thinking_text = part.get("thinking", "")
                                if thinking_text:
                                    data = {"content": thinking_text, "agent": agent_name or "Agent", "agent_id": agent_id_meta}
                                    sse_string = self.emitter.format_event("thinking", data, thread_id=None)
                                    await self._enqueue_event("thinking", data, sse_string)
                            elif part_type == "text":
                                part_text = part.get("text", "")
                                if part_text:
                                    data = {"content": part_text, "agent": agent_name or "Agent", "agent_id": agent_id_meta}
                                    sse_string = self.emitter.format_event("text", data, thread_id=None)
                                    await self._enqueue_event("text", data, sse_string)
                        continue

                    text_content = _extract_text(content)
                    if text_content:
                        data = {"content": text_content, "agent": agent_name or "Agent", "agent_id": agent_id_meta}
                        sse_string = self.emitter.format_event("text", data, thread_id=None)
                        await self._enqueue_event("text", data, sse_string)

                elif mode == "custom":
                    data = payload
                    if isinstance(data, dict):
                        action = data.get("action")

                        if action == "timeline_edit":
                            sse_string = self.emitter.format_event("timeline_edit", data, thread_id=None)
                            await self._enqueue_event("timeline_edit", data, sse_string)
                            continue

                        if action == "rerun_generation_node":
                            event_data = {
                                "nodeId": data.get("nodeId"),
                                "assetId": data.get("assetId"),
                                "nodeData": data.get("nodeData"),
                            }
                            sse_string = self.emitter.format_event("rerun_generation_node", event_data, thread_id=None)
                            await self._enqueue_event("rerun_generation_node", event_data, sse_string)
                            continue

                        if action == "subagent_stream":
                            agent = data.get("agent", "Agent")
                            _, agent_id = resolve_agent(namespace, agent)
                            content = data.get("content", "")

                            event_data = {"content": content, "agent": agent, "agent_id": agent_id}
                            sse_string = self.emitter.format_event("thinking", event_data, thread_id=None)
                            await self._enqueue_event("thinking", event_data, sse_string)
                            continue

                        sse_string = self.emitter.format_event("custom", data, thread_id=None)
                        await self._enqueue_event("custom", data, sse_string)

            # Execution finished successfully
            await self._enqueue_event("end", {}, self.emitter.format_event("end", {}, thread_id=None))

        except asyncio.CancelledError:
            logger.info(f"[SessionExecution] Worker cancelled for {self.thread_id}")

            # Inject cancellation message into graph state so LLM knows it was interrupted
            try:
                # We need to access the graph to update state.
                # But graph is a compiled graph, we need to use checkpointer/config.
                # However, since we are cancelling, we might not have time or ability to update safely if not in a node.
                # But the plan says: "Inject a HumanMessage... using graph.aupdate_state"
                if graph:
                     await graph.aupdate_state(
                        config,
                        {"messages": [HumanMessage(content="[SYSTEM] Task interrupted by user. Please resume or wait for instructions.")]},
                     )
            except Exception as e:
                logger.error(f"Failed to update state on interrupt: {e}")

            # Emit session_interrupted event
            msg = "Session interrupted. You can resume later."
            data = {"thread_id": self.thread_id, "message": msg}
            sse = self.emitter.format_event("session_interrupted", data, thread_id=None)
            await self._enqueue_event("session_interrupted", data, sse)

            # Update status in DB
            await set_session_status(self.thread_id, "interrupted")

        except Exception as exc:
            logger.error(f"[SessionExecution] Worker error: {exc}", exc_info=True)

            # Mark as completed (or failed) on error
            await set_session_status(self.thread_id, "completed")

            error_msg = str(exc)
            if not error_msg or len(error_msg) > 500:
                error_msg = f"{type(exc).__name__}: {str(exc)[:500]}"

            data = {"message": error_msg}
            sse = self.emitter.format_event("workflow_error", data, thread_id=None)
            await self._enqueue_event("workflow_error", data, sse)

            # End stream
            await self._enqueue_event("end", {}, self.emitter.format_event("end", {}, thread_id=None))

        finally:
            # Disconnect Loro
            try:
                await loro_client.disconnect()
                logger.info(f"[LoroSync] Disconnected for project {self.project_id}")
            except Exception as e:
                logger.error(f"[LoroSync] Failed to disconnect: {e}")

            # Cleanup subscribers by sending end signal
            for sub in self.subscribers:
                await sub.put("__END__")

            # Remove from manager
            SessionExecutionManager.remove_session(self.thread_id)

            # Cancel other tasks
            for task in self.tasks:
                if task != asyncio.current_task() and not task.done():
                    task.cancel()

    async def _poller_loop(self):
        """Polls DB for interrupt signals."""
        try:
            while True:
                if await check_interrupt_flag_async(self.thread_id):
                    logger.info(f"[Poller] Interrupt detected for {self.thread_id}")
                    # Cancel worker task
                    if self.tasks and not self.tasks[0].done():
                        self.tasks[0].cancel()
                    break

                await asyncio.sleep(1.0)
        except asyncio.CancelledError:
            pass

    async def _consumer_loop(self):
        """Consumes events from internal_queue, logs to DB, and broadcasts to subscribers."""
        try:
            while True:
                event_type, payload, sse_string = await self.internal_queue.get()

                # 1. Log to DB (fire and forget? No, we can await here since it's a separate loop)
                try:
                    await log_session_event(self.thread_id, event_type, payload)
                except Exception as e:
                    logger.error(f"Failed to log event {event_type}: {e}")

                # 2. Broadcast to subscribers
                if sse_string:
                    for sub in self.subscribers:
                        try:
                            await sub.put(sse_string)
                        except Exception as e:
                            logger.error(f"Failed to put to subscriber: {e}")

                self.internal_queue.task_done()

                if event_type == "end" or event_type == "session_interrupted":
                     # We can maybe stop the consumer?
                     # But we should keep it running until the session is fully stopped/cleaned up.
                     # But effectively this is the end of the stream.
                     pass

        except asyncio.CancelledError:
            pass

    async def _enqueue_event(self, event_type: str, payload: Dict[str, Any], sse_string: Optional[str]):
        """Helper to put event into internal queue."""
        await self.internal_queue.put((event_type, payload, sse_string))


class SessionExecutionManager:
    """Singleton to manage active session executions."""

    _instance = None
    _sessions: Dict[str, SessionExecution] = {}

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(SessionExecutionManager, cls).__new__(cls)
        return cls._instance

    @classmethod
    def get_session(cls, thread_id: str) -> Optional[SessionExecution]:
        return cls._sessions.get(thread_id)

    @classmethod
    def create_session(cls, thread_id: str, project_id: str) -> SessionExecution:
        session = SessionExecution(thread_id, project_id)
        cls._sessions[thread_id] = session
        return session

    @classmethod
    def remove_session(cls, thread_id: str):
        if thread_id in cls._sessions:
            del cls._sessions[thread_id]

execution_manager = SessionExecutionManager()
