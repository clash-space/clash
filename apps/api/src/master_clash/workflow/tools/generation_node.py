"""
Generation Node Tool

Provides the create_generation_node tool for creating image/video generation nodes.
"""

import logging
from typing import Literal

from langchain.tools import BaseTool, ToolRuntime
from pydantic import BaseModel, Field

from master_clash.workflow.backends import CanvasBackendProtocol

logger = logging.getLogger(__name__)


def create_generation_node_tool(backend: CanvasBackendProtocol) -> BaseTool:
    """Create create_generation_node tool (image/video)."""
    from langchain_core.tools import tool

    class GenerationNodeData(BaseModel):
        label: str = Field(
            description="Content-based descriptive label for the node (e.g., 'Hero entering temple', 'Final Video'). MUST NOT be generic like 'Generating image...' or 'Untitled'."
        )
        prompt: str | None = Field(
            default=None,
            description="DETAILED generation prompt for AI models. MUST be highly descriptive. Not required for video_editor nodes."
        )
        content: str | None = Field(
            default=None,
            description="Markdown content displayed to users (e.g., prompt notes, scene context)."
        )
        modelId: str | None = Field(  # noqa: N815
            default=None,
            description="Optional model ID to use for generation (e.g., 'nano-banana-pro').",
        )
        model: str | None = Field(
            default=None,
            description="Optional model ID alias (kept for backward compatibility).",
        )
        modelParams: dict[str, object] | None = Field(  # noqa: N815
            default=None,
            description="Optional model parameters as an object (NOT a JSON string), e.g. {'aspect_ratio': '21:9'}.",
        )
        aspectRatio: str | None = Field(  # noqa: N815
            default=None,
            description="Optional aspect ratio hint for frontend sizing (e.g., '16:9').",
        )
        modelName: str | None = Field(  # noqa: N815
            default=None, description="Optional model name override"
        )
        actionType: Literal["image-gen", "video-gen", "video-render"] | None = Field(  # noqa: N815
            default=None,
            description="Optional override; inferred from node_type when omitted",
        )
        upstreamNodeIds: list[str] = Field(  # noqa: N815
            default_factory=list,
            description="List of upstream node IDs to connect. For video_gen, MUST include at least one completed image node ID. For video_editor, include asset node IDs to add to timeline."
        )
        # video_editor specific fields
        timelineDsl: dict | None = Field(  # noqa: N815
            default=None,
            description="Timeline DSL structure for video_editor nodes (optional, will be initialized with defaults if not provided)",
        )

        class Config:
            extra = "allow"

    class CreateGenerationNodeInput(BaseModel):
        node_type: Literal["image_gen", "video_gen", "video_editor"] = Field(
            description="Generation node type: image_gen, video_gen, or video_editor (for timeline rendering)"
        )
        payload: GenerationNodeData = Field(
            description="Structured payload for generation node"
        )
        position: dict[str, float] | None = Field(
            default=None, description="Optional canvas coordinates {x, y}"
        )
        parent_id: str | None = Field(
            default=None,
            description="Optional parent group; defaults to current workspace when omitted",
        )
        upstream_node_id: str | None = Field(
            default=None,
            description="Optional upstream node ID to connect from (e.g., another PromptActionNode or image node for video generation)",
        )

    @tool(args_schema=CreateGenerationNodeInput)
    def create_generation_node(
        node_type: str,
        payload: GenerationNodeData,
        runtime: ToolRuntime,
        position: dict[str, float] | None = None,
        parent_id: str | None = None,
        upstream_node_id: str | None = None,
    ) -> str:
        """Create a new PromptActionNode (merged prompt + generation action) on the canvas.

        This creates a unified node that contains both:
        - The prompt content (visible to users in the UI)
        - The generation action (image-gen or video-gen)

        Use 'prompt' field for the AI generation prompt, and 'content' for user-facing markdown notes.
        Then use run_generation_node to trigger the actual generation.
        Returns the nodeId for the created PromptActionNode.
        """
        project_id = runtime.state.get("project_id", "")

        # Get workspace_group_id from runtime state (with configurable fallback)
        workspace_group_id_from_state = runtime.state.get("workspace_group_id")
        workspace_group_id_from_config = runtime.config.get("configurable", {}).get("workspace_group_id")

        # Use state first, fallback to config
        workspace_group_id = workspace_group_id_from_state or workspace_group_id_from_config

        # Debug logging to diagnose parent_id issues
        logger.info(f"[create_generation_node] Debug - parent_id arg: {parent_id}")
        logger.info(f"[create_generation_node] Debug - workspace_group_id from state: {workspace_group_id_from_state}")
        logger.info(f"[create_generation_node] Debug - workspace_group_id from config: {workspace_group_id_from_config}")
        logger.info(f"[create_generation_node] Debug - final workspace_group_id: {workspace_group_id}")
        logger.info(f"[create_generation_node] Debug - full runtime.state keys: {list(runtime.state.keys())}")

        # Auto-set parent_id from workspace if not explicitly provided
        if parent_id is None:
            if workspace_group_id:
                parent_id = workspace_group_id
                source = "state" if workspace_group_id_from_state else "config"
                logger.info(f"[create_generation_node] Auto-set parent_id from workspace ({source}): {parent_id}")
            else:
                # CRITICAL: If we're in a subagent context but workspace_group_id is missing,
                # this indicates a state propagation issue
                logger.warning(
                    f"[create_generation_node] ISSUE DETECTED: parent_id is None and workspace_group_id not found in state or config. "
                    f"This may indicate a state propagation problem in subagent execution. "
                    f"Available state keys: {list(runtime.state.keys())}"
                )

        logger.info(f"[create_generation_node] Creating {node_type} node with parent_id={parent_id}")

        resolved_backend = backend(runtime) if callable(backend) else backend

        # Prepare data with merged upstream IDs
        data_dict = payload.model_dump(exclude_none=True)

        # For video_editor, initialize timelineDsl if not provided
        if node_type == "video_editor" and "timelineDsl" not in data_dict:
            default_timeline = {
                "version": "1.0.0",
                "fps": 30,
                "compositionWidth": 1920,
                "compositionHeight": 1080,
                "durationInFrames": 0,
                "tracks": []
            }
            data_dict["timelineDsl"] = default_timeline
            logger.info("[create_generation_node] Initialized default timelineDsl for video_editor node")

        # For image/video gen, mirror prompt <-> content
        if node_type != "video_editor":
            if data_dict.get("prompt") and not data_dict.get("content"):
                data_dict["content"] = data_dict["prompt"]
            if data_dict.get("content") and not data_dict.get("prompt"):
                data_dict["prompt"] = data_dict["content"]

        final_upstream_ids = set(data_dict.get("upstreamNodeIds", []))
        if upstream_node_id:
            final_upstream_ids.add(upstream_node_id)
        data_dict["upstreamNodeIds"] = list(final_upstream_ids)

        try:
            result = resolved_backend.create_node(
                project_id=project_id,
                node_type=node_type,
                data=data_dict,
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
                if loro_client and not loro_client.connected:
                    logger.info("[LoroSync] Client not connected, attempting reconnect...")
                    loro_client.reconnect_sync()

                if loro_client and loro_client.connected:
                    try:
                        proposal = result.proposal
                        node_data = proposal.get("nodeData") or {}
                        parent_id_from_proposal = proposal.get("groupId")

                        # Determine node position strategy
                        # CRITICAL: Avoid calling get_all_nodes() - it causes performance bottlenecks
                        # when there are many nodes on the canvas, especially with parallel calls.
                        # Instead, let the frontend handle auto-layout for optimal performance.
                        if position is not None:
                            # Use explicitly provided position
                            node_position = position
                        elif parent_id_from_proposal:
                            # Nodes inside a group: use relative position within group
                            node_position = {"x": 50.0, "y": 50.0}
                        else:
                            # Root-level nodes: use NEEDS_LAYOUT_POSITION marker for frontend auto-layout
                            # Frontend will calculate the optimal position based on existing nodes and edges
                            # This avoids expensive get_all_nodes() calls and prevents agent hangs
                            node_position = {"x": -1, "y": -1}  # NEEDS_LAYOUT_POSITION
                            logger.info(f"[LoroSync] Using frontend auto-layout for node {result.node_id}")

                        # Set default dimensions based on node type
                        if node_type == "video_editor":
                            default_width = 400
                            default_height = 225
                            loro_type = "video-editor"
                            action_type = "video-render"
                        else:
                            default_width = 320
                            default_height = 220
                            loro_type = "action-badge"
                            action_type = "image-gen" if node_type == "image_gen" else "video-gen"

                        loro_node = {
                            "id": result.node_id,
                            "type": loro_type,
                            "position": node_position,
                            "data": {
                                **node_data,
                                "upstreamNodeIds": list(final_upstream_ids),
                                "actionType": action_type,
                            },
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

                        # Create edges for all upstream nodes
                        for up_id in final_upstream_ids:
                            edge_id = f"{up_id}-{result.node_id}"
                            loro_edge = {
                                "id": edge_id,
                                "source": up_id,
                                "target": result.node_id,
                                "type": "default"
                            }
                            loro_client.add_edge(edge_id, loro_edge)
                            logger.info(f"[LoroSync] Added edge {edge_id} from {up_id} to {result.node_id}")

                        loro_sync_success = True
                        logger.info(f"[LoroSync] Added generation node {result.node_id} to Loro")

                    except Exception as e:
                        loro_sync_error = str(e)
                        logger.error(f"[LoroSync] Failed to add generation node to Loro: {e}")
                else:
                    loro_sync_error = "Loro client not connected"
                    logger.warning(f"[LoroSync] Loro client not available, generation node {result.node_id} not synced")

            sync_status = "(synced to canvas)" if loro_sync_success else f"(sync failed: {loro_sync_error})" if loro_sync_error else "(not synced)"

            if loro_sync_error:
                return f"Error: Generation node {result.node_id} created but failed to sync to canvas: {loro_sync_error}"
            return f"Created generation node {result.node_id} {sync_status}. Use this ID to run the generation."

        except Exception as e:
            return f"Error creating generation node: {e}"

    return create_generation_node
