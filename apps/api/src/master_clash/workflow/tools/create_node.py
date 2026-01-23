"""
Create Node Tool

Provides the create_node tool for creating text/group nodes.
"""

import logging
from typing import Any, Literal

from langchain.tools import BaseTool, ToolRuntime
from pydantic import BaseModel, Field

from master_clash.workflow.backends import CanvasBackendProtocol
from master_clash.workflow.share_types import TimelineDSL

logger = logging.getLogger(__name__)


def create_create_node_tool(backend: CanvasBackendProtocol) -> BaseTool:
    """Create create_node tool."""
    from langchain_core.tools import tool

    class CanvasNodeData(BaseModel):
        label: str = Field(description="Display label for the node")
        content: str | None = Field(
            default=None,
            description="Markdown/text content (text/prompt nodes)",
        )
        description: str | None = Field(
            default=None,
            description="Optional description (useful for group nodes)",
        )
        timelineDsl: dict[str, Any] | None = Field(
            default=None,
            description="Timeline DSL structure for video-editor nodes (optional, will be initialized with defaults if not provided)",
        )

        class Config:
            extra = "allow"

    class CreateNodeInput(BaseModel):
        node_type: Literal["text", "group"] = Field(
            description="Node type to create (text for notes/scripts, group for organization). NOTE: For image/video generation or video-editor, use create_generation_node instead."
        )
        payload: CanvasNodeData = Field(
            description="Structured payload for text/prompt/group nodes"
        )
        position: dict[str, float] | None = Field(
            default=None, description="Optional canvas coordinates {x, y}"
        )
        parent_id: str | None = Field(
            default=None,
            description="Optional parent group; defaults to current workspace when omitted",
        )

    @tool(args_schema=CreateNodeInput)
    def create_node(
        node_type: str,
        payload: CanvasNodeData,
        runtime: ToolRuntime,
        position: dict[str, float] | None = None,
        parent_id: str | None = None,
    ) -> str:
        """Create a new node on the canvas."""
        project_id = runtime.state.get("project_id", "")

        # Get workspace_group_id from runtime state (with configurable fallback)
        workspace_group_id_from_state = runtime.state.get("workspace_group_id")
        workspace_group_id_from_config = runtime.config.get("configurable", {}).get("workspace_group_id")

        # Use state first, fallback to config
        workspace_group_id = workspace_group_id_from_state or workspace_group_id_from_config

        # Debug logging to diagnose parent_id issues
        logger.info(f"[create_node] Debug - parent_id arg: {parent_id}")
        logger.info(f"[create_node] Debug - workspace_group_id from state: {workspace_group_id_from_state}")
        logger.info(f"[create_node] Debug - workspace_group_id from config: {workspace_group_id_from_config}")
        logger.info(f"[create_node] Debug - final workspace_group_id: {workspace_group_id}")
        logger.info(f"[create_node] Debug - full runtime.state keys: {list(runtime.state.keys())}")

        # RULE: Subagents working in a workspace MUST NOT create new groups
        # The Director is responsible for creating groups and assigning workspaces
        if node_type == "group" and workspace_group_id:
            logger.warning(
                f"[create_node] BLOCKED: Attempted to create group while workspace_group_id={workspace_group_id} is set. "
                "Subagents should not create groups - use the existing workspace instead."
            )
            return (
                f"Error: Cannot create a new group while working in workspace '{workspace_group_id}'. "
                "The Director has already assigned you a workspace group. "
                "Please create your content nodes (text, image_gen, video_gen) directly - "
                "they will be automatically placed in your assigned workspace."
            )

        # Auto-set parent_id from workspace if not explicitly provided
        if parent_id is None:
            if workspace_group_id:
                parent_id = workspace_group_id
                source = "state" if workspace_group_id_from_state else "config"
                logger.info(f"[create_node] Auto-set parent_id from workspace ({source}): {parent_id}")
            else:
                logger.warning(
                    f"[create_node] ISSUE DETECTED: parent_id is None and workspace_group_id not found in state or config. "
                    f"Node will be created at root level. "
                    f"Available state keys: {list(runtime.state.keys())}"
                )

        logger.info(f"[create_node] Creating {node_type} node with parent_id={parent_id}")

        resolved_backend = backend(runtime) if callable(backend) else backend

        try:
            node_data_dict = payload.model_dump(exclude_none=True)

            result = resolved_backend.create_node(
                project_id=project_id,
                node_type=node_type,
                data=node_data_dict,
                position=position,
                parent_id=parent_id,
            )

            if result.error:
                return f"Error: {result.error}"

            # Write node directly to Loro CRDT
            loro_sync_success = False
            loro_sync_error = None
            if result.proposal:
                loro_client = runtime.config.get("configurable", {}).get("loro_client")
                if loro_client and loro_client.connected:
                    try:
                        proposal = result.proposal
                        node_data = proposal.get("nodeData") or {}
                        parent_id_from_proposal = proposal.get("groupId")

                        if position is not None:
                            node_position = position
                        elif parent_id_from_proposal:
                            node_position = {"x": 50.0, "y": 50.0}
                        else:
                            # Use frontend auto-layout instead of calculating position manually
                            # This avoids the expensive get_all_nodes() call which can cause hangs
                            node_position = {"x": -1, "y": -1}  # NEEDS_LAYOUT_POSITION
                            logger.info(f"[LoroSync] Using frontend auto-layout for node {result.node_id}")

                        # Set default dimensions based on node type (matching frontend ProjectEditor.tsx)
                        resolved_type = proposal.get("nodeType") or node_type
                        if resolved_type == "group":
                            default_width = 400
                            default_height = 400
                        else:
                            # text nodes
                            default_width = 300
                            default_height = 300

                        loro_node = {
                            "id": result.node_id,
                            "type": resolved_type,
                            "position": node_position,
                            "data": node_data,
                            # ReactFlow node dimensions - critical for proper rendering
                            "width": default_width,
                            "height": default_height,
                            "style": {
                                "width": default_width,
                                "height": default_height,
                            },
                            **(
                                {"parentId": parent_id_from_proposal}
                                if parent_id_from_proposal
                                else {}
                            ),
                        }

                        loro_client.add_node(result.node_id, loro_node)
                        logger.info(f"[LoroSync] Added node {result.node_id} to Loro")

                        loro_sync_success = True
                    except Exception as e:
                        loro_sync_error = str(e)
                        logger.error(f"[LoroSync] Failed to add node to Loro: {e}")
                else:
                    loro_sync_error = "Loro client not connected"
                    logger.warning(f"[LoroSync] Loro client not available, node {result.node_id} not synced")

            if loro_sync_success:
                return f"Created node {result.node_id} (synced to canvas)"
            elif loro_sync_error:
                return f"Error: Node {result.node_id} created in backend but failed to sync to canvas: {loro_sync_error}"
            else:
                return f"Created node {result.node_id} (not synced - no Loro client)"

        except Exception as e:
            return f"Error creating node: {e}"

    return create_node
