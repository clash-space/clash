"""
Node Operations for Loro Sync Client

Provides methods for adding, updating, removing, and reading nodes.
"""

import logging
from collections.abc import Callable
from typing import Any

from loro import LoroDoc

logger = logging.getLogger(__name__)

# Special position value indicating a node needs auto-layout by the frontend
# Frontend will detect this and calculate the proper position based on:
# - Reference node (source via edge in same group) -> insert to the right
# - No reference -> place at bottom of group/canvas
NEEDS_LAYOUT_POSITION = {"x": -1, "y": -1}


class LoroNodesMixin:
    """Mixin providing node operations."""

    doc: LoroDoc
    def _run_doc_op_sync(self, op: Callable[[], None], label: str, timeout_s: float = 5.0) -> bool:
        """To be implemented by main class."""
        raise NotImplementedError

    def _send_update(self, update: bytes):
        """To be implemented by main class."""
        raise NotImplementedError

    def add_node(self, node_id: str, node_data: dict[str, Any]):
        """Add a new node to the canvas.

        Args:
            node_id: Unique node ID (semantic ID recommended)
            node_data: Node data including type, position, data, etc.
        """
        node_type = node_data.get("type", "unknown")
        logger.info(f"[LoroSyncClient] ➕ Adding node: {node_id} (type: {node_type})")

        def op() -> None:
            nodes_map = self.doc.get_map("nodes")
            nodes_map.insert(node_id, node_data)

        completed = self._run_doc_op_sync(op, f"add_node:{node_id}")
        if completed:
            logger.info(f"[LoroSyncClient] ✅ Node added: {node_id}")
        else:
            logger.info(f"[LoroSyncClient] 🕓 Node add queued: {node_id}")

    def add_node_auto_layout(
        self,
        node_id: str,
        node_type: str,
        data: dict[str, Any],
        parent_id: str | None = None,
    ):
        """Add a new node with automatic layout by the frontend.

        The node will be placed at a special placeholder position (-1, -1).
        Frontend will detect this and calculate the proper position based on:
        - If there's a reference node (source via edge in same group) -> insert to the right
        - If no reference -> place at bottom of group/canvas

        Args:
            node_id: Unique node ID (semantic ID recommended)
            node_type: Node type (e.g., 'action-badge', 'image', 'video')
            data: Node data (label, status, url, etc.)
            parent_id: Optional parent group ID
        """
        node_data = {
            "type": node_type,
            "position": NEEDS_LAYOUT_POSITION.copy(),
            "data": data,
        }

        if parent_id:
            node_data["parentId"] = parent_id

        self.add_node(node_id, node_data)

    def update_node(self, node_id: str, node_data: dict[str, Any]):
        """Update an existing node (merge with existing data).

        Args:
            node_id: Node ID to update
            node_data: Partial node data to merge
        """
        logger.info(f"[LoroSyncClient] 🔄 Updating node: {node_id}")

        def op() -> None:
            nodes_map = self.doc.get_map("nodes")

            # Get existing node data safely
            existing_proxy = nodes_map.get(node_id)
            existing = {}
            if existing_proxy:
                if hasattr(existing_proxy, "value"):
                    existing = existing_proxy.value
                elif hasattr(existing_proxy, "to_dict"):
                    existing = existing_proxy.to_dict()

            if not isinstance(existing, dict):
                all_nodes = nodes_map.get_deep_value() or {}
                existing = all_nodes.get(node_id) or {}

            # Merge data
            merged = {**existing, **node_data}
            if "data" in existing and "data" in node_data:
                merged["data"] = {**existing.get("data", {}), **node_data.get("data", {})}

            nodes_map.insert(node_id, merged)

        completed = self._run_doc_op_sync(op, f"update_node:{node_id}")
        if completed:
            logger.info(f"[LoroSyncClient] ✅ Node updated: {node_id}")
        else:
            logger.info(f"[LoroSyncClient] 🕓 Node update queued: {node_id}")

    def remove_node(self, node_id: str):
        """Remove a node from the canvas.

        Args:
            node_id: Node ID to remove
        """
        logger.info(f"[LoroSyncClient] ➖ Removing node: {node_id}")

        def op() -> None:
            nodes_map = self.doc.get_map("nodes")
            nodes_map.delete(node_id)

        completed = self._run_doc_op_sync(op, f"remove_node:{node_id}")
        if completed:
            logger.info(f"[LoroSyncClient] ✅ Node removed: {node_id}")
        else:
            logger.info(f"[LoroSyncClient] 🕓 Node removal queued: {node_id}")

    def get_node(self, node_id: str) -> dict[str, Any] | None:
        """Get a node by ID."""
        nodes_map = self.doc.get_map("nodes")
        all_nodes = nodes_map.get_deep_value() or {}
        node = all_nodes.get(node_id)

        logger.debug(f"[LoroSyncClient] get_node({node_id}) Type: {type(node)}")
        logger.debug(f"[LoroSyncClient] Get node: {node_id} -> {'found' if node else 'not found'}")
        return node

    def get_all_nodes(self) -> dict[str, Any]:
        """Get all nodes."""
        nodes_map = self.doc.get_map("nodes")
        nodes = nodes_map.get_deep_value() or {}
        logger.debug(f"[LoroSyncClient] Get all nodes: {len(nodes)} nodes")
        return nodes
