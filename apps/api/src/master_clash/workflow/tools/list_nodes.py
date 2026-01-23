"""
List Nodes Tool

Provides the list_canvas_nodes tool for listing nodes on the canvas.
Returns JSON format for easy parsing.
"""

import json
import logging
from collections import defaultdict
from typing import Literal

from langchain.tools import BaseTool, ToolRuntime
from pydantic import BaseModel, Field

from master_clash.workflow.backends import CanvasBackendProtocol, NodeInfo

logger = logging.getLogger(__name__)


def create_list_nodes_tool(backend: CanvasBackendProtocol) -> BaseTool:
    """Create list_canvas_nodes tool."""
    from langchain_core.tools import tool

    class ListCanvasNodesInput(BaseModel):
        node_type: Literal["text", "prompt", "group", "image", "video", "video-editor", "image_gen", "video_gen", "action-badge"] | None = Field(
            default=None, description="Optional filter by node type (text, group, video-editor, image_gen, video_gen, action-badge, image, video)"
        )
        parent_id: str | None = Field(
            default=None, description="Optional filter by parent group"
        )
        query: str | None = Field(
            default=None, description="Optional search query to filter nodes by label, description, content, or prompt"
        )

    @tool(args_schema=ListCanvasNodesInput)
    def list_nodes(
        runtime: ToolRuntime,
        node_type: str | None = None,
        parent_id: str | None = None,
        query: str | None = None,
    ) -> str:
        """List and search nodes. Returns JSON with truncated previews. Use read_node to get full details."""
        project_id = runtime.state.get("project_id", "")

        # Try to get nodes from Loro first (real-time state)
        loro_client = runtime.config.get("configurable", {}).get("loro_client")
        nodes = []

        if loro_client and loro_client.connected:
            try:
                loro_nodes_dict = loro_client.get_all_nodes()
                nodes = [
                    NodeInfo(
                        id=node_id,
                        type=node_data.get("type", "unknown"),
                        position=node_data.get("position", {"x": 0, "y": 0}),
                        data=node_data.get("data", {}),
                        parent_id=node_data.get("parentId"),
                    )
                    for node_id, node_data in loro_nodes_dict.items()
                ]
                logger.info(f"[LoroSync] Read {len(nodes)} nodes from Loro")
            except Exception as e:
                logger.error(f"[LoroSync] Failed to read from Loro: {e}")

        # Fall back to backend if Loro not available or failed
        if not nodes:
            resolved_backend = backend(runtime) if callable(backend) else backend
            nodes = resolved_backend.list_nodes(
                project_id=project_id, node_type=None, parent_id=None
            )
            logger.info(f"list canvas nodes from backend: {nodes}")

        if not nodes:
            return json.dumps({"nodes": [], "total": 0, "filters": {}})

        def truncate(text: str, max_len: int = 50) -> str:
            """Truncate text to max_len characters."""
            if not text:
                return ""
            text_str = str(text)
            if len(text_str) <= max_len:
                return text_str
            return text_str[:max_len] + "..."

        def matches_filter(node: NodeInfo) -> bool:
            # Filter by node type
            if node_type and node.type != node_type:
                return False

            # Filter by parent (if specified)
            if parent_id is not None and node.parent_id != parent_id:
                return False

            # Filter by search query (search in label, description, content, prompt)
            if query:
                query_lower = query.lower()
                label = node.data.get("label", "").lower()
                description = node.data.get("description", "").lower()
                content = str(node.data.get("content", "")).lower()
                prompt = node.data.get("prompt", "").lower()

                if not (query_lower in label or query_lower in description or
                        query_lower in content or query_lower in prompt):
                    return False

            return True

        # Filter nodes and build result list
        result_nodes = []
        for node in nodes:
            if matches_filter(node):
                # For description: use description if available, otherwise fallback to content for text nodes
                description = node.data.get("description", "")
                if not description and node.type == "text":
                    description = node.data.get("content", "")

                node_data = {
                    "id": node.id,
                    "type": node.type,
                    "label": truncate(node.data.get("label", ""), 50),
                    "description": truncate(description, 50),
                    "parent_id": node.parent_id,
                }
                result_nodes.append(node_data)

        # Sort: groups first, then by label
        result_nodes.sort(key=lambda n: (0 if n["type"] == "group" else 1, n["label"], n["id"]))

        # Build response
        response = {
            "nodes": result_nodes,
            "total": len(result_nodes),
            "filters": {}
        }

        if node_type:
            response["filters"]["type"] = node_type
        if query:
            response["filters"]["query"] = query
        if parent_id:
            response["filters"]["parent_id"] = parent_id

        return json.dumps(response, ensure_ascii=False, indent=2)

    return list_nodes
