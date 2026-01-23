"""
Loro CRDT Sync Client

Main client class that composes all mixin operations for a complete
WebSocket client for syncing Loro CRDT documents with the sync server.
"""

import asyncio
import logging
from collections.abc import Callable
from typing import Any

import websockets
from loro import LoroDoc

from master_clash.loro_sync.batch import LoroBatchMixin
from master_clash.loro_sync.connection import LoroConnectionMixin
from master_clash.loro_sync.edges import LoroEdgesMixin
from master_clash.loro_sync.nodes import LoroNodesMixin
from master_clash.loro_sync.tasks import LoroTasksMixin

logger = logging.getLogger(__name__)


class LoroSyncClient(
    LoroConnectionMixin,
    LoroNodesMixin,
    LoroEdgesMixin,
    LoroBatchMixin,
    LoroTasksMixin,
):
    """
    WebSocket client for syncing Loro CRDT documents with the sync server.

    Usage:
        client = LoroSyncClient(
            project_id="proj_123",
            token="jwt_token",
            sync_server_url="ws://localhost:8787"
        )

        await client.connect()

        # Add a node
        client.add_node("node_image_cat", {
            "id": "node_image_cat",
            "type": "action-badge-image",
            "position": {"x": 100, "y": 200},
            "data": {
                "label": "Generated Cat",
                "status": "running"
            }
        })

        # Add an edge
        client.add_edge("e-upstream-node_image_cat", {
            "id": "e-upstream-node_image_cat",
            "source": "upstream_node",
            "target": "node_image_cat",
            "type": "default"
        })

        await client.disconnect()
    """

    def __init__(
        self,
        project_id: str,
        token: str | None = None,
        sync_server_url: str = "ws://localhost:8787",
        on_update: Callable[[dict[str, Any]], None] | None = None,
    ):
        self.project_id = project_id
        self.token = token
        self.sync_server_url = sync_server_url
        self.on_update = on_update

        self.doc = LoroDoc()
        self.ws: websockets.WebSocketClientProtocol | None = None
        self.connected = False
        self._pending_sends: set[asyncio.Task[None]] = set()
        self._ws_loop: asyncio.AbstractEventLoop | None = None
        self._disconnecting = False  # Flag to prevent auto-reconnect after intentional disconnect
        self._doc_op_queue: asyncio.Queue | None = None
        self._doc_op_task: asyncio.Task | None = None
        self._doc_op_loop: asyncio.AbstractEventLoop | None = None
        self._doc_op_lock = asyncio.Lock()


class LoroSyncClientSync:
    """
    Synchronous wrapper for LoroSyncClient.
    Runs the async client in a background thread.

    Usage:
        with LoroSyncClientSync(project_id="proj_123", token="jwt") as client:
            client.add_node("node_123", {...})
            client.add_edge("edge_123", {...})
    """

    def __init__(
        self,
        project_id: str,
        token: str,
        sync_server_url: str = "ws://localhost:8787",
    ):
        self.project_id = project_id
        self.token = token
        self.sync_server_url = sync_server_url
        self._client: LoroSyncClient | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    def __enter__(self):
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)

        self._client = LoroSyncClient(
            project_id=self.project_id,
            token=self.token,
            sync_server_url=self.sync_server_url,
        )

        self._loop.run_until_complete(self._client.connect())
        return self._client

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self._client:
            self._loop.run_until_complete(self._client.disconnect())
        if self._loop:
            self._loop.close()
