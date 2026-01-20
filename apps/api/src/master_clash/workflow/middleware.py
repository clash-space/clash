"""Middleware system for agent lifecycle hooks.

Inspired by deepagents' middleware architecture, each middleware can:
- Wrap model calls (add system prompts, filter tools)
- Wrap tool calls (process results, validate inputs)
- Define state schema
- Hook into agent lifecycle
"""

import logging
from collections.abc import Callable
from typing import Annotated, Any, TypeVar

from langchain.agents.middleware.types import (
    AgentMiddleware,
    ModelRequest,
    ModelResponse,
)
from langchain.messages import SystemMessage
from langchain.tools import BaseTool, ToolRuntime
from langchain_core.messages import BaseMessage
from langgraph.graph import add_messages
from pydantic import BaseModel, Field, ValidationError

from master_clash.workflow.backends import (
    CanvasBackendProtocol,
    NodeInfo,
    StateCanvasBackend,
)
from master_clash.workflow.share_types import TimelineDSL
from master_clash.workflow.tools import (
    create_list_nodes_tool,
    create_read_node_tool,
    create_create_node_tool,
    create_generation_node_tool,
    create_run_generation_tool,
    create_wait_generation_tool,
    create_search_nodes_tool,
    create_list_model_cards_tool,
)

logger = logging.getLogger(__name__)

# Type aliases
T = TypeVar("T")
BackendFactory = Callable[["ToolRuntime"], CanvasBackendProtocol]


class AgentState:
    """Base agent state schema."""

    messages: Annotated[list[BaseMessage], add_messages]
    project_id: str
    workspace_group_id: str | None  # Optional workspace scope for sub-agents


class CanvasState(AgentState):
    """Extended state with canvas data."""

    canvas_nodes: dict[str, NodeInfo]  # node_id -> NodeInfo
    canvas_edges: dict[str, dict[str, Any]]  # edge_id -> edge data


def _canvas_reducer(
    left: dict[str, NodeInfo] | None,
    right: dict[str, NodeInfo],
) -> dict[str, NodeInfo]:
    """Merge canvas nodes, support deletion by setting value=None."""
    if left is None:
        return {k: v for k, v in right.items() if v is not None}
    result = {**left}
    for key, value in right.items():
        if value is None:
            result.pop(key, None)
        else:
            result[key] = value
    return result


class TimelineMiddleware(AgentMiddleware):
    """Middleware that provides timeline editing tools."""

    def __init__(self):
        self.tools = self._generate_timeline_tools()

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        """Add timeline tools to the model request."""

        timeline_prompt = """
You can control the video timeline via the DSL tools.

**CRITICAL**: You MUST be given a video-editor node ID to work with.
If you haven't been given a node_id, ask the director for it or request creating a new video-editor node first.

DSL Tools:
- read_dsl(node_id): Read the current timeline DSL from a video-editor node.
- patch_dsl(node_id, patch): Modify the timeline using JSON Patch operations on a video-editor node.

Example workflow:
1. Director provides you with a video-editor node_id (e.g., "editor-abc123")
2. You read the current state: read_dsl(node_id="editor-abc123")
3. You modify it: patch_dsl(node_id="editor-abc123", patch=[{"op": "add", "path": "/tracks/-", "value": {"id": "t1", "items": [...]}}])
"""
        if request.system_prompt:
            system_prompt = f"{request.system_prompt}\n\n{timeline_prompt}"
        else:
            system_prompt = timeline_prompt

        return handler(request.override(system_message=SystemMessage(system_prompt)))

    async def awrap_model_call(self, request, handler):
        """Add timeline tools to the model request."""

        timeline_prompt = """
You can control the video timeline via the DSL tools.

**CRITICAL**: You MUST be given a video-editor node ID to work with.
If you haven't been given a node_id, ask the director for it or request creating a new video-editor node first.

DSL Tools:
- read_dsl(node_id): Read the current timeline DSL from a video-editor node.
- patch_dsl(node_id, patch): Modify the timeline using JSON Patch operations on a video-editor node.

Example workflow:
1. Director provides you with a video-editor node_id (e.g., "editor-abc123")
2. You read the current state: read_dsl(node_id="editor-abc123")
3. You modify it: patch_dsl(node_id="editor-abc123", patch=[{"op": "add", "path": "/tracks/-", "value": {"id": "t1", "items": [...]}}])
"""
        if request.system_prompt:
            system_prompt = f"{request.system_prompt}\n\n{timeline_prompt}"
        else:
            system_prompt = timeline_prompt

        return await handler(
            request.override(system_message=SystemMessage(system_prompt))
        )

    def _generate_timeline_tools(self) -> list[BaseTool]:
        """Generate timeline tools."""
        # We need backend access for arrange_timeline, but TimelineMiddleware currently doesn't hold backend reference.
        # CanvasMiddleware holds backend.
        # We should probably move arrange_timeline to CanvasMiddleware or pass backend to TimelineMiddleware.
        return [self._read_dsl_tool(), self._patch_dsl_tool()]

    def _read_dsl_tool(self) -> BaseTool:
        """Create read_dsl tool."""
        from langchain_core.tools import tool
        import json

        class ReadDSLInput(BaseModel):
            node_id: str = Field(description="ID of the video-editor node containing the timeline DSL")

        @tool(args_schema=ReadDSLInput)
        def read_dsl(node_id: str, runtime: ToolRuntime) -> str:
            """Read the timeline DSL from a video-editor node.

            Returns the timelineDsl field from the node's data as a JSON string.
            If the node doesn't exist or has no timeline, returns an error message.
            """
            try:
                # Get Loro client from runtime
                loro_client = runtime.config.get("configurable", {}).get("loro_client")

                if not loro_client or not loro_client.connected:
                    return "Error: Loro client not connected. Cannot read node data."

                # Read node from Loro
                node_data = loro_client.get_node(node_id)
                if not node_data:
                    return f"Error: Node {node_id} not found."

                # Handle different node data formats
                if hasattr(node_data, "value"):
                    node_data = node_data.value

                if not isinstance(node_data, dict):
                    return f"Error: Invalid node data format for {node_id}"

                # Check node type
                if node_data.get("type") != "video-editor":
                    return f"Error: Node {node_id} is not a video-editor node (type: {node_data.get('type')})"

                # Get timelineDsl from node.data
                data = node_data.get("data", {})
                timeline_dsl = data.get("timelineDsl")

                if timeline_dsl is None:
                    # Return empty timeline structure
                    empty_timeline = {
                        "version": "1.0.0",
                        "fps": 30,
                        "compositionWidth": 1920,
                        "compositionHeight": 1080,
                        "durationInFrames": 0,
                        "tracks": []
                    }
                    return json.dumps(empty_timeline, indent=2)

                return json.dumps(timeline_dsl, indent=2)

            except Exception as e:
                logger.error(f"Error reading DSL from node {node_id}: {e}", exc_info=True)
                return f"Error reading DSL: {e}"

        return read_dsl

    def _patch_dsl_tool(self) -> BaseTool:
        """Create patch_dsl tool."""
        from langchain_core.tools import tool
        import json
        import jsonpatch

        class PatchDSLInput(BaseModel):
            node_id: str = Field(description="ID of the video-editor node containing the timeline DSL")
            patch: list[dict[str, Any]] = Field(
                description="JSON Patch operations (RFC 6902). Example: [{'op': 'replace', 'path': '/version', 'value': '1.0.1'}, {'op': 'add', 'path': '/tracks/-', 'value': {...}}]"
            )

        @tool(args_schema=PatchDSLInput)
        def patch_dsl(
            node_id: str,
            patch: list[dict[str, Any]],
            runtime: ToolRuntime,
        ) -> str:
            """Apply a JSON Patch to the timeline DSL of a video-editor node.

            This modifies the timelineDsl field in the node's data and updates the node in Loro.
            """
            try:
                # Get Loro client from runtime
                loro_client = runtime.config.get("configurable", {}).get("loro_client")

                if not loro_client or not loro_client.connected:
                    return "Error: Loro client not connected. Cannot modify node data."

                # Read current node data
                node_data = loro_client.get_node(node_id)
                if not node_data:
                    return f"Error: Node {node_id} not found."

                # Handle different node data formats
                if hasattr(node_data, "value"):
                    node_data = node_data.value

                if not isinstance(node_data, dict):
                    return f"Error: Invalid node data format for {node_id}"

                # Check node type
                if node_data.get("type") != "video-editor":
                    return f"Error: Node {node_id} is not a video-editor node (type: {node_data.get('type')})"

                # Get current timelineDsl
                data = node_data.get("data", {})
                current_dsl = data.get("timelineDsl")

                if current_dsl is None:
                    # Initialize with empty timeline
                    current_dsl = {
                        "version": "1.0.0",
                        "fps": 30,
                        "compositionWidth": 1920,
                        "compositionHeight": 1080,
                        "durationInFrames": 0,
                        "tracks": []
                    }

                # Apply JSON Patch
                patched_dsl = jsonpatch.apply_patch(current_dsl, patch)

                # Ensure critical fields are always present
                if "compositionWidth" not in patched_dsl:
                    patched_dsl["compositionWidth"] = 1920
                if "compositionHeight" not in patched_dsl:
                    patched_dsl["compositionHeight"] = 1080
                if "fps" not in patched_dsl:
                    patched_dsl["fps"] = 30

                # Validate against schema
                try:
                    TimelineDSL.model_validate(patched_dsl)
                except ValidationError as e:
                    logger.error(f"DSL validation failed for node {node_id}: {e}")
                    return f"Error: Invalid DSL structure: {e}"

                # Update upstream dependencies based on assets in timeline
                # This ensures the video-editor node is connected to the assets it uses
                asset_ids = set()
                for track in patched_dsl.get("tracks", []):
                    items = track.get("items") or []
                    for item in items:
                        if "assetId" in item:
                            asset_ids.add(item["assetId"])

                # Prepare updated data
                updated_data = {**data, "timelineDsl": patched_dsl}

                # CRITICAL FIX: Fill in missing 'src' and 'type' fields for items with assetId
                # The agent only sets assetId, but the renderer needs src and type
                # Normally the editor fills this in, but for patch_dsl we need to do it here
                all_nodes = loro_client.get_all_nodes()
                for track in patched_dsl.get("tracks", []):
                    for item in track.get("items", []):
                        asset_id = item.get("assetId")
                        if asset_id:
                            # Find the asset node and extract its src and type
                            asset_node = all_nodes.get(asset_id)
                            if asset_node and isinstance(asset_node, dict):
                                asset_data = asset_node.get("data", {})
                                asset_src = asset_data.get("src")
                                asset_type = asset_node.get("type")  # node type: 'image', 'video', 'audio'

                                if asset_src and not item.get("src"):
                                    item["src"] = asset_src
                                    logger.info(f"[patch_dsl] Filled src for item {item.get('id')}: {asset_src}")

                                if asset_type and not item.get("type"):
                                    item["type"] = asset_type
                                    logger.info(f"[patch_dsl] Filled type for item {item.get('id')}: {asset_type}")

                # Update the patched_dsl in updated_data after filling src
                updated_data["timelineDsl"] = patched_dsl

                if asset_ids:
                    current_upstreams = set(updated_data.get("upstreamNodeIds", []))
                    new_upstreams = current_upstreams.union(asset_ids)

                    if new_upstreams != current_upstreams:
                        updated_data["upstreamNodeIds"] = list(new_upstreams)
                        logger.info(f"Updated upstreamNodeIds for {node_id}: {updated_data['upstreamNodeIds']}")

                        # Add edges for new connections
                        for asset_id in asset_ids:
                            if asset_id not in current_upstreams:
                                edge_id = f"{asset_id}-{node_id}"
                                try:
                                    loro_edge = {
                                        "id": edge_id,
                                        "source": asset_id,
                                        "target": node_id,
                                        "type": "default"
                                    }
                                    loro_client.add_edge(edge_id, loro_edge)
                                    logger.info(f"Added dependency edge {edge_id} from {asset_id} to {node_id}")
                                except Exception as e:
                                    logger.warning(f"Failed to add edge {edge_id}: {e}")

                # CRITICAL FIX: Read the full node from Loro and update it completely
                # This ensures deep nested changes (like timelineDsl) trigger proper Loro events
                # that the frontend subscription can detect for preview updates
                nodes_map = loro_client.doc.get_map("nodes")
                full_node = nodes_map.get(node_id)

                # Extract full node value
                if hasattr(full_node, "value"):
                    full_node_dict = full_node.value
                elif hasattr(full_node, "to_dict"):
                    full_node_dict = full_node.to_dict()
                else:
                    all_nodes = nodes_map.get_deep_value() or {}
                    full_node_dict = all_nodes.get(node_id) or {}

                # Merge the updated data into the full node
                full_node_dict["data"] = updated_data

                # Use insert (not update_node) to trigger proper Loro change events
                logger.info(f"[patch_dsl] About to insert node {node_id} with updated timelineDsl")
                nodes_map.insert(node_id, full_node_dict)
                logger.info(f"[patch_dsl] Node inserted, now committing...")
                loro_client.doc.commit()
                logger.info(f"[patch_dsl] Commit completed for node {node_id}")

                logger.info(f"Successfully patched and committed timeline DSL for node {node_id}")

                logger.info(f"Successfully patched timeline DSL for node {node_id}")
                return f"Patch applied successfully to video-editor node {node_id}"

            except jsonpatch.JsonPatchException as e:
                logger.error(f"JSON Patch error for node {node_id}: {e}", exc_info=True)
                return f"Error: Invalid JSON Patch operation: {e}"
            except Exception as e:
                logger.error(f"Error patching DSL for node {node_id}: {e}", exc_info=True)
                return f"Error patching DSL: {e}"

        return patch_dsl


class CanvasMiddleware(AgentMiddleware):
    """Middleware that provides canvas tools.

    Similar to FilesystemMiddleware in deepagents, but for canvas operations.
    Tool implementations are extracted to master_clash.workflow.tools package.
    """

    def __init__(
        self,
        backend: CanvasBackendProtocol | BackendFactory | None = None,
    ):
        """Initialize canvas middleware.

        Args:
            backend: Canvas backend or factory function
        """
        self.backend = backend or StateCanvasBackend()
        self.tools = self._generate_canvas_tools()

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        """Add canvas tools to the model request."""
        canvas_prompt = self._get_canvas_prompt()
        if request.system_prompt:
            system_prompt = f"{request.system_prompt}\n\n{canvas_prompt}"
        else:
            system_prompt = canvas_prompt

        return handler(request.override(system_message=SystemMessage(system_prompt)))

    async def awrap_model_call(self, request, handler):
        """Add canvas tools to the model request."""
        canvas_prompt = self._get_canvas_prompt()
        if request.system_prompt:
            system_prompt = f"{request.system_prompt}\n\n{canvas_prompt}"
        else:
            system_prompt = canvas_prompt

        return await handler(
            request.override(system_message=SystemMessage(system_prompt))
        )

    def _get_canvas_prompt(self) -> str:
        """Get the canvas-specific system prompt."""
        return """
You have access to canvas tools for creating and managing visual content:
- list_canvas_nodes: List nodes on the canvas
- read_canvas_node: Read a specific node's data
- create_canvas_node: Create text/group/video-editor nodes
  - text: For notes and scripts
  - group: For organization (ALWAYS create groups first!)
  - video-editor: For timeline editing (creates a node with embedded timeline DSL)
- list_model_cards: List available model cards for a given asset kind (image/video/audio). Use this first to choose a model and parameters.
- create_generation_node: Create PromptActionNodes with embedded prompts for image/video generation
- run_generation_node: Run a generation node to produce the asset (call after create), OR run a video-editor node to render its timeline
- wait_for_generation: Wait for image/video generation to complete (ONLY pass image/video asset node IDs, NOT action-badge IDs)
- search_canvas: Search nodes by content

**CRITICAL: Always Organize in Groups**
1. FIRST create a Group to contain your work (e.g., "Scene 1", "Character Designs")
2. THEN create all content nodes with parentId pointing to that group
3. NEVER leave nodes floating outside of a group!

**Video Editor Workflow**:
- Create a video-editor node: `create_canvas_node(node_type="video-editor", payload={"label": "Final Video"})`
- This creates a node with an embedded timeline DSL
- The user or Editor sub-agent can manually arrange assets in the timeline through the UI
- The frontend automatically links assets to the video-editor when they are added to the timeline
- When ready, trigger rendering: `run_generation_node(node_id="editor-node-id")`

IMPORTANT: PromptActionNode Architecture:
- Prompt and action are now MERGED into a single node type
- When creating image_gen or video_gen nodes, include BOTH the prompt content AND action type in one node
- The 'prompt' field contains the generation prompt for the AI model
- The 'content' field contains the markdown prompt content visible to users
- You do NOT need to create separate prompt/text nodes - everything is in the PromptActionNode

Workflow:
1. Create a Group first (using create_canvas_node with type='group')
2. Call list_model_cards to pick a model and parameters (progressive disclosure)
3. Use create_generation_node with:
   - 'prompt': detailed generation prompt for the AI model
   - 'content': markdown description/notes for display
   - 'parent_id': The group ID from step 1 (REQUIRED!)
   - 'modelParams': MUST be an object (dict), not a JSON string
   - For video_gen: MUST include upstreamNodeIds with at least one completed image node ID
   - For image_gen: upstreamNodeIds are optional
4. Then use run_generation_node to trigger the generation
5. Call wait_for_generation to check status (pass the returned asset node ID, NOT the action-badge ID)
"""

    def _generate_canvas_tools(self) -> list[BaseTool]:
        """Generate canvas tools based on backend capabilities."""
        return [
            create_list_nodes_tool(self.backend),
            create_read_node_tool(self.backend),
            create_create_node_tool(self.backend),
            create_list_model_cards_tool(),
            create_generation_node_tool(self.backend),
            create_run_generation_tool(self.backend),
            create_wait_generation_tool(self.backend),
            create_search_nodes_tool(self.backend),
        ]
