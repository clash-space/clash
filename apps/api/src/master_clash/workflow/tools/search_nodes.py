"""
Search Nodes Tool

Provides the search_canvas tool for searching nodes by content.
"""

import logging

from langchain.tools import BaseTool, ToolRuntime
from pydantic import BaseModel, Field

from master_clash.workflow.backends import CanvasBackendProtocol

logger = logging.getLogger(__name__)


def create_search_nodes_tool(backend: CanvasBackendProtocol) -> BaseTool:
    """Create search_canvas tool."""
    from langchain_core.tools import tool

    class SearchCanvasInput(BaseModel):
        query: str = Field(description="Search query")
        node_types: list[str] | None = Field(
            default=None, description="Optional filter by node types"
        )

    @tool(args_schema=SearchCanvasInput)
    def search_canvas(
        query: str,
        runtime: ToolRuntime,
        node_types: list[str] | None = None,
    ) -> str:
        """Search nodes by label, description, content, or prompt text."""
        project_id = runtime.state.get("project_id", "")
        resolved_backend = backend(runtime) if callable(backend) else backend

        try:
            nodes = resolved_backend.search_nodes(
                project_id=project_id,
                query=query,
                node_types=node_types,
            )

            if not nodes:
                return f"No nodes found matching '{query}'."

            # Format results in a readable way
            lines = [f"Found {len(nodes)} node(s) matching '{query}':\n"]

            for i, node in enumerate(nodes, 1):
                label = node.data.get("label", "Untitled")
                node_type = node.type
                matched_fields = node.data.get("_matched_fields", [])

                lines.append(f"{i}. {label}")
                lines.append(f"   ID: {node.id}")
                lines.append(f"   Type: {node_type}")

                if matched_fields:
                    lines.append(f"   Matched in: {', '.join(matched_fields)}")

                # Show a preview of the content/description
                if "description" in matched_fields and node.data.get("description"):
                    desc = node.data["description"]
                    preview = desc[:100] + "..." if len(desc) > 100 else desc
                    lines.append(f"   Description: {preview}")

                if "content" in matched_fields and node.data.get("content"):
                    content = str(node.data["content"])
                    preview = content[:100] + "..." if len(content) > 100 else content
                    lines.append(f"   Content: {preview}")

                if "prompt" in matched_fields and node.data.get("prompt"):
                    prompt = node.data["prompt"]
                    preview = prompt[:100] + "..." if len(prompt) > 100 else prompt
                    lines.append(f"   Prompt: {preview}")

                lines.append("")  # Empty line between results

            return "\n".join(lines)

        except Exception as e:
            logger.error(f"Error searching nodes: {e}")
            return f"Error searching: {e}"

    return search_canvas
