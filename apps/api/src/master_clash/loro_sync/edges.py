"""
Edge Operations for Loro Sync Client

Provides methods for adding, updating, removing, and reading edges.
"""

import logging
from collections.abc import Callable
from typing import Any

from loro import LoroDoc

logger = logging.getLogger(__name__)


class LoroEdgesMixin:
    """Mixin providing edge operations."""

    doc: LoroDoc
    def _run_doc_op_sync(self, op: Callable[[], None], label: str, timeout_s: float = 5.0) -> bool:
        """To be implemented by main class."""
        raise NotImplementedError

    def _send_update(self, update: bytes):
        """To be implemented by main class."""
        raise NotImplementedError

    def add_edge(self, edge_id: str, edge_data: dict[str, Any]):
        """Add a new edge to the canvas.

        Args:
            edge_id: Unique edge ID (format: "e-{source}-{target}")
            edge_data: Edge data including source, target, type, etc.
        """
        source = edge_data.get("source", "?")
        target = edge_data.get("target", "?")
        logger.info(f"[LoroSyncClient] ➕ Adding edge: {edge_id} ({source} → {target})")

        def op() -> None:
            edges_map = self.doc.get_map("edges")
            edges_map.insert(edge_id, edge_data)

        completed = self._run_doc_op_sync(op, f"add_edge:{edge_id}")
        if completed:
            logger.info(f"[LoroSyncClient] ✅ Edge added: {edge_id}")
        else:
            logger.info(f"[LoroSyncClient] 🕓 Edge add queued: {edge_id}")

    def update_edge(self, edge_id: str, edge_data: dict[str, Any]):
        """Update an existing edge.

        Args:
            edge_id: Edge ID to update
            edge_data: Partial edge data to merge
        """
        logger.info(f"[LoroSyncClient] 🔄 Updating edge: {edge_id}")

        def op() -> None:
            edges_map = self.doc.get_map("edges")

            existing_proxy = edges_map.get(edge_id)
            existing = {}
            if existing_proxy:
                if hasattr(existing_proxy, "value"):
                    existing = existing_proxy.value
                elif hasattr(existing_proxy, "to_dict"):
                    existing = existing_proxy.to_dict()

            if not isinstance(existing, dict):
                all_edges = edges_map.get_deep_value() or {}
                existing = all_edges.get(edge_id) or {}

            merged = {**existing, **edge_data}

            edges_map.insert(edge_id, merged)

        completed = self._run_doc_op_sync(op, f"update_edge:{edge_id}")
        if completed:
            logger.info(f"[LoroSyncClient] ✅ Edge updated: {edge_id}")
        else:
            logger.info(f"[LoroSyncClient] 🕓 Edge update queued: {edge_id}")

    def remove_edge(self, edge_id: str):
        """Remove an edge from the canvas.

        Args:
            edge_id: Edge ID to remove
        """
        logger.info(f"[LoroSyncClient] ➖ Removing edge: {edge_id}")

        def op() -> None:
            edges_map = self.doc.get_map("edges")
            edges_map.delete(edge_id)

        completed = self._run_doc_op_sync(op, f"remove_edge:{edge_id}")
        if completed:
            logger.info(f"[LoroSyncClient] ✅ Edge removed: {edge_id}")
        else:
            logger.info(f"[LoroSyncClient] 🕓 Edge removal queued: {edge_id}")

    def get_edge(self, edge_id: str) -> dict[str, Any] | None:
        """Get an edge by ID."""
        edges_map = self.doc.get_map("edges")
        all_edges = edges_map.get_deep_value() or {}
        edge = all_edges.get(edge_id)
        logger.debug(f"[LoroSyncClient] Get edge: {edge_id} -> {'found' if edge else 'not found'}")
        return edge

    def get_all_edges(self) -> dict[str, Any]:
        """Get all edges."""
        edges_map = self.doc.get_map("edges")
        edges = edges_map.get_deep_value() or {}
        logger.debug(f"[LoroSyncClient] Get all edges: {len(edges)} edges")
        return edges
