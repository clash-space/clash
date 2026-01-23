"""
Batch Operations for Loro Sync Client

Provides atomic batch operations for updating multiple nodes and edges.
"""

import logging
from collections.abc import Callable
from typing import Any

from loro import LoroDoc

logger = logging.getLogger(__name__)


class LoroBatchMixin:
    """Mixin providing batch operations."""

    doc: LoroDoc
    def _run_doc_op_sync(self, op: Callable[[], None], label: str, timeout_s: float = 5.0) -> bool:
        """To be implemented by main class."""
        raise NotImplementedError

    def batch_update_graph(self, nodes: dict[str, Any] = None, edges: dict[str, Any] = None):
        """Atomically set (insert/update) multiple nodes AND edges in a single transaction.

        Args:
            nodes: Dictionary where keys are node IDs and values are the full node data.
            edges: Dictionary where keys are edge IDs and values are the full edge data.
        """
        nodes = nodes or {}
        edges = edges or {}

        if not nodes and not edges:
            return

        logger.info(f"[LoroSyncClient] 📦 Batch graph update ({len(nodes)} nodes, {len(edges)} edges)")

        def op() -> None:
            if nodes:
                nodes_map = self.doc.get_map("nodes")
                for node_id, node_data in nodes.items():
                    # Ensure node_data is a dict (sanitization)
                    if hasattr(node_data, "value"):
                        try:
                            val = node_data.value
                            if isinstance(val, dict):
                                node_data = val
                        except Exception:
                            pass
                    elif hasattr(node_data, "to_dict"):
                        try:
                            val = node_data.to_dict()
                            if isinstance(val, dict):
                                node_data = val
                        except Exception:
                            pass
                    nodes_map.insert(node_id, node_data)

            if edges:
                edges_map = self.doc.get_map("edges")
                for edge_id, edge_data in edges.items():
                    # Ensure edge_data is a dict (sanitization)
                    if hasattr(edge_data, "value"):
                        try:
                            val = edge_data.value
                            if isinstance(val, dict):
                                edge_data = val
                        except Exception:
                            pass
                    elif hasattr(edge_data, "to_dict"):
                        try:
                            val = edge_data.to_dict()
                            if isinstance(val, dict):
                                edge_data = val
                        except Exception:
                            pass
                    edges_map.insert(edge_id, edge_data)

        completed = self._run_doc_op_sync(op, "batch_update_graph")
        if completed:
            logger.info("[LoroSyncClient] ✅ Batch graph transaction completed")
        else:
            logger.info("[LoroSyncClient] 🕓 Batch graph update queued")
