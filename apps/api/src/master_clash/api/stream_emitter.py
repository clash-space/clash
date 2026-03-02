import asyncio
import logging
import uuid

from master_clash.context import ProjectContext
from master_clash.json_utils import dumps as json_dumps


logger = logging.getLogger(__name__)


class StreamEmitter:
    """Helper class to emit formatted SSE events."""

    def format_event(self, event_type: str, data: dict, thread_id: str | None = None) -> str:
        logger.info("Emitting event: %s - %s...", event_type, str(data)[:200])

        # Log to database if thread_id is provided
        if thread_id:
            from master_clash.services.session_interrupt import log_session_event

            # Use create_task to fire-and-forget the async log call
            asyncio.create_task(log_session_event(thread_id, event_type, data))

        return f"event: {event_type}\ndata: {json_dumps(data)}\n\n"

    def text(
        self,
        content: str,
        thread_id: str | None = None,
        agent: str = "MasterClash",
        agent_id: str | None = None,
    ) -> str:
        """Output text token/message."""
        payload: dict[str, str] = {"agent": agent, "content": content}
        if agent_id:
            payload["agent_id"] = agent_id
        return self.format_event("text", payload, thread_id=thread_id)

    def thinking(
        self,
        content: str,
        thread_id: str | None = None,
        agent: str | None = None,
        id: str | None = None,
        agent_id: str | None = None,
    ) -> str:
        """Output thinking token/message."""
        data: dict[str, str] = {"content": content}
        if agent:
            data["agent"] = agent
        if id:
            data["id"] = id
        if agent_id:
            data["agent_id"] = agent_id
        return self.format_event("thinking", data, thread_id=thread_id)

    def sub_agent_start(self, agent: str, task: str, id: str) -> str:
        logger.info("Sub-agent START: %s - %s (%s)", agent, task, id)
        return self.format_event("sub_agent_start", {"agent": agent, "task": task, "id": id})

    def sub_agent_end(self, agent: str, result: str, id: str) -> str:
        logger.info("Sub-agent END: %s (%s)", agent, id)
        return self.format_event("sub_agent_end", {"agent": agent, "result": result, "id": id})

    def end(self, thread_id: str | None = None) -> str:
        """Output stream end."""
        logger.info("=== STREAM END EVENT SENT === (thread_id=%s)", thread_id)
        return self.format_event("end", {}, thread_id=thread_id)

    async def tool_create_node(
        self,
        agent: str,
        tool_name: str,
        args: dict,
        proposal_data: dict,
        result_text: str,
    ):
        """Tool execution: Create Node."""
        tool_id = f"call_{uuid.uuid4().hex[:8]}"
        logger.info("Tool START: %s - %s (%s)", agent, tool_name, tool_id)
        yield self.format_event(
            "tool_start",
            {"agent": agent, "tool_name": tool_name, "args": args, "id": tool_id},
        )
        await asyncio.sleep(1)  # Simulate work
        logger.info("Node Proposal: %s", proposal_data.get("id"))
        yield self.format_event("node_proposal", proposal_data)
        logger.info("Tool END: %s - %s (%s)", agent, result_text, tool_id)
        yield self.format_event(
            "tool_end",
            {
                "agent": agent,
                "result": result_text,
                "status": "success",
                "id": tool_id,
                "tool": tool_name,
            },
            thread_id=None,  # Will be set in stream_workflow loop callers if needed
        )

    async def tool_poll_asset(
        self,
        agent: str,
        node_id: str,
        context: ProjectContext,
        get_asset_id_func,
    ):
        """Tool execution: Poll Asset Status."""
        tool_id = f"call_{uuid.uuid4().hex[:8]}"
        logger.info("Tool Poll START: %s - %s (%s)", agent, node_id, tool_id)
        yield self.format_event(
            "tool_start",
            {
                "agent": agent,
                "tool_name": "check_asset_status",
                "args": {"node_id": node_id},
                "id": tool_id,
            },
        )

        asset_id = get_asset_id_func(node_id, context)
        if not asset_id:
            logger.info("Tool Poll RETRY: %s", node_id)
            yield self.format_event(
                "tool_end",
                {
                    "agent": agent,
                    "result": "Still generating...",
                    "status": "success",
                    "id": tool_id,
                    "tool": "check_asset_status",
                },
            )
            yield self.format_event("retry", {})
            yield None  # Signal not found
        else:
            logger.info("Tool Poll SUCCESS: %s -> %s", node_id, asset_id)
            yield self.format_event(
                "tool_end",
                {
                    "agent": agent,
                    "result": f"Asset generated: {asset_id}",
                    "status": "success",
                    "id": tool_id,
                    "tool": "check_asset_status",
                },
            )
            yield asset_id  # Signal found
