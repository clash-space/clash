"""Canvas backend protocol and implementations.

This module defines the abstract interface for canvas operations,
similar to how deepagents abstracts filesystem operations.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable


@dataclass
class NodeInfo:
    """Information about a canvas node."""

    id: str
    type: str
    position: dict[str, float]
    data: dict[str, Any]
    parent_id: str | None = None


@dataclass
class EdgeInfo:
    """Information about a canvas edge."""

    id: str
    source: str
    target: str
    source_handle: str | None = None
    target_handle: str | None = None


@dataclass
class CreateNodeResult:
    """Result of creating a node."""

    node_id: str | None = None
    error: str | None = None
    proposal: dict[str, Any] | None = None  # SSE proposal data
    asset_id: str | None = None  # Pre-allocated asset ID for generation nodes


@dataclass
class UpdateNodeResult:
    """Result of updating a node."""

    success: bool = True
    error: str | None = None


@dataclass
class TaskStatusResult:
    """Result of checking task status."""

    status: str  # 'completed' | 'generating' | 'failed' | 'node_not_found'
    output: dict[str, Any] | None = None
    error: str | None = None


@dataclass
class TimelineOperation:
    """Timeline edit operation."""

    action: str  # 'add_clip' | 'remove_clip' | 'move_clip' | 'trim_clip'
    params: dict[str, Any]


@dataclass
class TimelineResult:
    """Result of timeline operation."""

    success: bool = True
    timeline_state: dict[str, Any] | None = None
    error: str | None = None


@runtime_checkable
class CanvasBackendProtocol(Protocol):
    """Unified canvas operation interface.

    This protocol defines all operations agents can perform on the canvas,
    similar to BackendProtocol in deepagents for filesystem operations.
    """

    def list_nodes(
        self,
        project_id: str,
        node_type: str | None = None,
        parent_id: str | None = None,
    ) -> list[NodeInfo]:
        """List nodes in the canvas.

        Args:
            project_id: Project identifier
            node_type: Optional filter by node type
            parent_id: Optional filter by parent (for groups)

        Returns:
            List of node information
        """
        ...

    def read_node(
        self,
        project_id: str,
        node_id: str,
    ) -> NodeInfo | None:
        """Read a single node's details.

        Args:
            project_id: Project identifier
            node_id: Node identifier

        Returns:
            Node information or None if not found
        """
        ...

    def create_node(
        self,
        project_id: str,
        node_type: str,
        data: dict[str, Any],
        position: dict[str, float] | None = None,
        parent_id: str | None = None,
    ) -> CreateNodeResult:
        """Create a new node on the canvas.

        Args:
            project_id: Project identifier
            node_type: Type of node (text, image_gen, video_gen, etc)
            data: Node data payload
            position: Optional position {x, y}
            parent_id: Optional parent for grouping

        Returns:
            Result with node_id or error
        """
        ...

    def update_node(
        self,
        project_id: str,
        node_id: str,
        data: dict[str, Any] | None = None,
        position: dict[str, float] | None = None,
    ) -> UpdateNodeResult:
        """Update an existing node.

        Args:
            project_id: Project identifier
            node_id: Node to update
            data: Optional data updates
            position: Optional position updates

        Returns:
            Result with success status
        """
        ...

    def create_edge(
        self,
        project_id: str,
        source: str,
        target: str,
        source_handle: str | None = None,
        target_handle: str | None = None,
    ) -> CreateNodeResult:
        """Create an edge between nodes.

        Args:
            project_id: Project identifier
            source: Source node ID
            target: Target node ID
            source_handle: Optional source handle
            target_handle: Optional target handle

        Returns:
            Result with edge_id or error
        """
        ...

    async def wait_for_task(
        self,
        project_id: str,
        node_id: str,
        timeout_seconds: float = 30.0,
    ) -> TaskStatusResult:
        """Wait for a generation task to complete.

        Args:
            project_id: Project identifier
            node_id: Node with generation task
            timeout_seconds: Max wait time

        Returns:
            Task status result
        """
        ...

    def timeline_edit(
        self,
        project_id: str,
        operations: Sequence[TimelineOperation],
    ) -> TimelineResult:
        """Perform timeline editing operations.

        Args:
            project_id: Project identifier
            operations: List of timeline operations

        Returns:
            Result with timeline state
        """
        ...

    def search_nodes(
        self,
        project_id: str,
        query: str,
        node_types: Sequence[str] | None = None,
    ) -> list[NodeInfo]:
        """Search nodes by content or metadata.

        Args:
            project_id: Project identifier
            query: Search query string
            node_types: Optional filter by types

        Returns:
            List of matching nodes
        """
        ...


class StateCanvasBackend:
    """Canvas backend using project context from frontend.

    This backend integrates with your existing context system:
    - Reads from get_project_context() (frontend synced state)
    - Writes via SSE proposals (create_node returns JSON for SSE emission)
    """

    def __init__(self):
        """Initialize state backend."""
        pass

    def list_nodes(
        self,
        project_id: str,
        node_type: str | None = None,
        parent_id: str | None = None,
    ) -> list[NodeInfo]:
        """List nodes from project context."""
        from master_clash.context import get_project_context

        context = get_project_context(project_id, force_refresh=True)
        if not context:
            return []

        nodes = []
        for node in context.nodes:
            # Filter by type if specified
            if node_type and node.type != node_type:
                continue
            # Filter by parent if specified
            if parent_id and node.parentId != parent_id:
                continue

            nodes.append(
                NodeInfo(
                    id=node.id,
                    type=node.type,
                    position={"x": node.position.get("x", 0), "y": node.position.get("y", 0)},
                    data=node.data,
                    parent_id=node.parentId,
                )
            )

        return nodes

    def read_node(
        self,
        project_id: str,
        node_id: str,
    ) -> NodeInfo | None:
        """Read node from project context."""
        from master_clash.context import find_node_by_id, get_project_context

        context = get_project_context(project_id, force_refresh=True)
        if not context:
            return None

        node = find_node_by_id(node_id, context)
        if not node:
            return None

        return NodeInfo(
            id=node.id,
            type=node.type,
            position={"x": node.position.get("x", 0), "y": node.position.get("y", 0)},
            data=node.data,
            parent_id=node.parentId,
        )

    def create_node(
        self,
        project_id: str,
        node_type: str,
        data: dict[str, Any],
        position: dict[str, float] | None = None,
        parent_id: str | None = None,
    ) -> CreateNodeResult:
        """Create node proposal for SSE emission.

        This returns a proposal that will be sent via SSE 'node_proposal' event.
        The frontend receives it and creates the actual node.
        """
        import uuid

        # Generate short UUID (8 characters)
        node_id = uuid.uuid4().hex[:8]

        # Generate proposal ID
        proposal_id = f"proposal-{uuid.uuid4().hex[:8]}"

        # Map types for frontend
        frontend_type = node_type
        proposal_type = "simple"
        asset_id = None

        if node_type == "image_gen":
            frontend_type = "action-badge-image"
            proposal_type = "generative"
            # Pre-allocate asset ID for generation nodes
            asset_id = uuid.uuid4().hex[:8]
        elif node_type == "video_gen":
            frontend_type = "action-badge-video"
            proposal_type = "generative"
            # Pre-allocate asset ID for generation nodes
            asset_id = uuid.uuid4().hex[:8]
        elif node_type == "group":
            proposal_type = "group"

        # Extract linkage hints so the frontend can auto-wire edges
        upstream_node_ids = data.get("upstreamNodeIds") or data.get("upstreamIds")

        # Build proposal
        proposal = {
            "id": proposal_id,
            "type": proposal_type,
            "nodeType": frontend_type,
            "nodeData": {"id": node_id, **data},
            "groupId": parent_id,
            "message": f"Proposed {node_type} node: {data.get('label', 'Untitled')}",
        }

        # Add assetId to proposal for generation nodes
        if asset_id:
            proposal["assetId"] = asset_id
            if "nodeData" in proposal and proposal["nodeData"] is not None:
                proposal["nodeData"]["assetId"] = asset_id
        if upstream_node_ids:
            # Deduplicate while preserving order
            seen = set()
            deduped = []
            for uid in upstream_node_ids:
                if uid and uid not in seen:
                    seen.add(uid)
                    deduped.append(uid)
            if deduped:
                proposal["upstreamNodeIds"] = deduped

        # Return proposal for middleware to emit via SSE
        return CreateNodeResult(
            node_id=node_id,
            error=None,
            proposal=proposal,
            asset_id=asset_id,
        )

    def update_node(
        self,
        project_id: str,
        node_id: str,
        data: dict[str, Any] | None = None,
        position: dict[str, float] | None = None,
    ) -> UpdateNodeResult:
        """Update node (not implemented yet)."""
        # TODO: Implement node update via SSE
        return UpdateNodeResult(
            success=True,
            error="Update not yet implemented via SSE",
        )

    def create_edge(
        self,
        project_id: str,
        source: str,
        target: str,
        source_handle: str | None = None,
        target_handle: str | None = None,
    ) -> CreateNodeResult:
        """Create edge (not implemented yet)."""
        # TODO: Implement edge creation via SSE
        edge_id = f"edge-{source}-{target}"
        return CreateNodeResult(
            node_id=edge_id,
            error="Edge creation not yet implemented via SSE",
        )

    async def wait_for_task(
        self,
        project_id: str,
        node_id: str,
        timeout_seconds: float = 30.0,
    ) -> TaskStatusResult:
        """Wait for generation task to complete."""
        from master_clash.context import (
            get_project_context,
            get_status,
        )

        context = get_project_context(project_id, force_refresh=True)
        if not context:
            return TaskStatusResult(
                status="node_not_found",
                error="No context found",
            )

        # Check if asset exists
        status = get_status(node_id, context)

        if not status:
            return TaskStatusResult(status="completed")

        if status != "completed":
            import asyncio

            await asyncio.sleep(timeout_seconds)
            status = get_status(node_id, context)
        if not status:
            return TaskStatusResult(status="completed")
        return TaskStatusResult(status=status)

    def timeline_edit(
        self,
        project_id: str,
        operations: Sequence[TimelineOperation],
    ) -> TimelineResult:
        """Edit timeline via SSE."""
        # TODO: Implement timeline editing via SSE
        # This should emit timeline_edit events
        return TimelineResult(
            success=True,
            timeline_state={"operations": [op.__dict__ for op in operations]},
            error="Timeline editing not yet implemented via SSE",
        )

    def search_nodes(
        self,
        project_id: str,
        query: str,
        node_types: Sequence[str] | None = None,
    ) -> list[NodeInfo]:
        """Search nodes by content across multiple fields (label, description, content, prompt)."""
        from master_clash.context import get_project_context

        context = get_project_context(project_id, force_refresh=True)
        if not context:
            return []

        query_lower = query.lower()
        matching_nodes = []

        for node in context.nodes:
            # Filter by type if specified
            if node_types and node.type not in node_types:
                continue

            # Comprehensive search across multiple fields
            label = node.data.get("label", "").lower()
            description = node.data.get("description", "").lower()
            content = str(node.data.get("content", "")).lower()
            prompt = node.data.get("prompt", "").lower()

            # Check if query matches any field
            matched = False
            match_fields = []

            if query_lower in label:
                matched = True
                match_fields.append("label")
            if query_lower in description:
                matched = True
                match_fields.append("description")
            if query_lower in content:
                matched = True
                match_fields.append("content")
            if query_lower in prompt:
                matched = True
                match_fields.append("prompt")

            if matched:
                # Add match_fields metadata to help with debugging
                node_info = NodeInfo(
                    id=node.id,
                    type=node.type,
                    position={"x": node.position.get("x", 0), "y": node.position.get("y", 0)},
                    data={**node.data, "_matched_fields": match_fields},
                    parent_id=node.parentId,
                )
                matching_nodes.append(node_info)

        return matching_nodes


class APICanvasBackend:
    """Canvas backend that calls external API.

    Similar to FilesystemBackend in deepagents, but for API operations.
    """

    def __init__(self, api_base_url: str, api_key: str | None = None):
        """Initialize API backend.

        Args:
            api_base_url: Base URL for canvas API
            api_key: Optional API key for authentication
        """
        self.api_base_url = api_base_url.rstrip("/")
        self.api_key = api_key

    def list_nodes(
        self,
        project_id: str,
        node_type: str | None = None,
        parent_id: str | None = None,
    ) -> list[NodeInfo]:
        """List nodes via API."""
        # TODO: Implement HTTP call
        raise NotImplementedError("API backend not implemented")

    def read_node(
        self,
        project_id: str,
        node_id: str,
    ) -> NodeInfo | None:
        """Read node via API."""
        raise NotImplementedError("API backend not implemented")

    def create_node(
        self,
        project_id: str,
        node_type: str,
        data: dict[str, Any],
        position: dict[str, float] | None = None,
        parent_id: str | None = None,
    ) -> CreateNodeResult:
        """Create node via API."""
        raise NotImplementedError("API backend not implemented")

    def update_node(
        self,
        project_id: str,
        node_id: str,
        data: dict[str, Any] | None = None,
        position: dict[str, float] | None = None,
    ) -> UpdateNodeResult:
        """Update node via API."""
        raise NotImplementedError("API backend not implemented")

    def create_edge(
        self,
        project_id: str,
        source: str,
        target: str,
        source_handle: str | None = None,
        target_handle: str | None = None,
    ) -> CreateNodeResult:
        """Create edge via API."""
        raise NotImplementedError("API backend not implemented")

    def wait_for_task(
        self,
        project_id: str,
        node_id: str,
        timeout_seconds: float = 30.0,
    ) -> TaskStatusResult:
        """Wait for task via API."""
        raise NotImplementedError("API backend not implemented")

    def timeline_edit(
        self,
        project_id: str,
        operations: Sequence[TimelineOperation],
    ) -> TimelineResult:
        """Edit timeline via API."""
        raise NotImplementedError("API backend not implemented")

    def search_nodes(
        self,
        project_id: str,
        query: str,
        node_types: Sequence[str] | None = None,
    ) -> list[NodeInfo]:
        """Search nodes via API."""
        raise NotImplementedError("API backend not implemented")
