"""
Read Node Tool

Provides the read_node tool for reading node details.
"""

import logging

from langchain.tools import BaseTool, ToolRuntime
from pydantic import BaseModel, Field

from master_clash.workflow.backends import CanvasBackendProtocol, NodeInfo

logger = logging.getLogger(__name__)


def create_read_node_tool(backend: CanvasBackendProtocol) -> BaseTool:
    """Create read_node tool."""
    from langchain_core.tools import tool

    class ReadNodeInput(BaseModel):
        node_id: str = Field(description="Target node ID")

    @tool(args_schema=ReadNodeInput)
    def read_node(
        node_id: str,
        runtime: ToolRuntime,
    ) -> list[str | dict] | str:
        """Read a specific node's detailed data.
        For image, specially, you can see it.
        """
        project_id = runtime.state.get("project_id", "")

        # Try to get node from Loro first (real-time state)
        loro_client = runtime.config.get("configurable", {}).get("loro_client")
        node = None

        # Try to reconnect if not connected
        if loro_client and not loro_client.connected:
            logger.info("[LoroSync] Client not connected, attempting reconnect...")
            loro_client.reconnect_sync()

        if loro_client and loro_client.connected:
            try:
                node_data = loro_client.get_node(node_id)
                if node_data:
                    node = NodeInfo(
                        id=node_id,
                        type=node_data.get("type", "unknown"),
                        position=node_data.get("position", {"x": 0, "y": 0}),
                        data=node_data.get("data", {}),
                        parent_id=node_data.get("parentId"),
                    )
                    logger.info(f"[LoroSync] Read node {node_id} from Loro")
            except Exception as e:
                logger.error(f"[LoroSync] Failed to read node {node_id} from Loro: {e}")

        # Fall back to backend if Loro not available or node not found
        if node is None:
            resolved_backend = backend(runtime) if callable(backend) else backend
            node = resolved_backend.read_node(
                project_id=project_id,
                node_id=node_id,
            )

        if node is None:
            return f"Node {node_id} not found."

        data = node.data or {}
        name = data.get("label") or data.get("name") or node.id
        description = data.get("description") or data.get("content") or ""
        text_part = {
            "type": "text",
            "text": (
                f"{name}: {description} type: {node.type}"
                if description
                else name
            ),
        }

        # If the node is an image/video, return media + text parts
        if node.type in {"image", "video"}:
            from master_clash.utils import get_asset_base64

            def pick_source() -> str | None:
                for key in (
                    "base64",
                    "src",
                    "url",
                    "thumbnail",
                    "poster",
                    "cover",
                ):
                    value = data.get(key)
                    if isinstance(value, str) and value:
                        return value
                return None

            def to_base64_and_mime(
                source: str, default_mime: str
            ) -> tuple[str, str]:
                if source.startswith("data:"):
                    header, payload = source.split(",", 1)
                    mime = header.split(":", 1)[1].split(";")[0] or default_mime
                    return payload, mime
                if "base64," in source:
                    payload = source.split("base64,", 1)[1]
                    return payload, default_mime
                return get_asset_base64(source)

            source = pick_source()
            if source:
                try:
                    if node.type == "video":
                        pass
                    else:
                        base64_data, mime_type = to_base64_and_mime(
                            source, "image/jpeg"
                        )
                        media_part = {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime_type};base64,{base64_data}"
                            },
                        }
                        return [media_part, text_part]
                except Exception:
                    raw_part = (
                        {"type": "image_url", "image_url": source}
                        if node.type == "image"
                        else {"type": "media", "data": source}
                    )
                    return [raw_part, text_part]

            return [text_part]

        return [text_part]

    return read_node
