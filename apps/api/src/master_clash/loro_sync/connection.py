"""
WebSocket Connection Management for Loro Sync Client

Handles WebSocket connection, disconnection, auto-reconnection,
and update sending/receiving.
"""

import asyncio
import logging
from collections.abc import Callable
from typing import Any
from urllib.parse import urlencode

import websockets
from loro import LoroDoc

logger = logging.getLogger(__name__)


class LoroConnectionMixin:
    """Mixin providing WebSocket connection management."""

    # These are expected to be set by the main class
    project_id: str
    token: str | None
    sync_server_url: str
    on_update: Callable[[dict[str, Any]], None] | None
    doc: LoroDoc
    ws: websockets.WebSocketClientProtocol | None
    connected: bool
    _pending_sends: set
    _ws_loop: asyncio.AbstractEventLoop | None
    _disconnecting: bool  # Flag to prevent auto-reconnect after intentional disconnect
    _local_update_subscription: Any  # Loro subscription object

    async def connect(self):
        """Connect to the sync server via WebSocket and start syncing."""
        if self.token:
            params = {"token": self.token}
            ws_url = f"{self.sync_server_url}/sync/{self.project_id}?{urlencode(params)}"
        else:
            ws_url = f"{self.sync_server_url}/sync/{self.project_id}"

        logger.info(f"[LoroSyncClient] 🔌 Connecting to {ws_url}")
        logger.info(f"[LoroSyncClient] Project ID: {self.project_id}")

        try:
            self.ws = await websockets.connect(
                ws_url,
                proxy=None,
                max_size=100 * 1024 * 1024,  # 100MB limit
            )
            self.connected = True
            self._ws_loop = asyncio.get_running_loop()
            logger.info(f"[LoroSyncClient] ✅ Connected to sync server (project: {self.project_id})")

            # Wait for initial state snapshot
            try:
                initial_msg = await asyncio.wait_for(self.ws.recv(), timeout=30.0)
                initial_data = bytes(initial_msg)
                logger.info(f"[LoroSyncClient] 📥 Received initial state ({len(initial_data)} bytes)")
                self.doc.import_(initial_data)
                logger.info("[LoroSyncClient] ✅ Applied initial state from server")
            except TimeoutError:
                logger.warning("[LoroSyncClient] ⚠️ Timeout waiting for initial state")
            except Exception as e:
                logger.error(f"[LoroSyncClient] ❌ Failed to import initial state: {e}")

            # Subscribe to local updates (automatic sync)
            self._local_update_subscription = self.doc.subscribe_local_update(
                lambda update: (self._send_update(bytes(update)), True)[1]
            )
            logger.info("[LoroSyncClient] Subscribed to local updates")

            # Start listening for updates
            asyncio.create_task(self._listen())
            logger.info("[LoroSyncClient] Started listening for updates from server")

        except Exception as e:
            logger.error(f"[LoroSyncClient] ❌ Connection failed: {e}")
            raise

    async def disconnect(self):
        """Disconnect from the sync server."""
        self._disconnecting = True  # Signal to _listen() not to auto-reconnect

        # Unsubscribe from local updates
        if self._local_update_subscription:
            self._local_update_subscription.unsubscribe()
            self._local_update_subscription = None
            logger.info("[LoroSyncClient] Unsubscribed from local updates")

        if self.ws:
            await self._flush_pending_sends()
            await self.ws.close()
            self.connected = False
            logger.info(f"[LoroSyncClient] 🔌 Disconnected from sync server (project: {self.project_id})")

    async def _flush_pending_sends(self, timeout_s: float = 2.0) -> None:
        if not self._pending_sends:
            return

        pending = list(self._pending_sends)
        try:
            await asyncio.wait_for(asyncio.gather(*pending, return_exceptions=True), timeout=timeout_s)
        except TimeoutError:
            logger.warning(
                f"[LoroSyncClient] ⚠️ Timed out flushing {len(pending)} pending send(s) before disconnect"
            )

    async def _listen(self):
        """Listen for updates from the sync server."""
        if not self.ws:
            logger.warning("[LoroSyncClient] ⚠️ Cannot listen: WebSocket not initialized")
            return

        logger.info("[LoroSyncClient] 👂 Listening for updates from server...")

        try:
            async for message in self.ws:
                update = bytes(message)
                update_size = len(update)
                logger.info(f"[LoroSyncClient] 📥 Received update from server ({update_size} bytes)")

                self.doc.import_(update)
                logger.debug("[LoroSyncClient] ✅ Applied update from server")

                if self.on_update:
                    self.on_update(self._get_state())
                    logger.debug("[LoroSyncClient] Triggered on_update callback")

        except websockets.exceptions.ConnectionClosed:
            self.connected = False
            if not self._disconnecting:  # Only reconnect if not intentionally disconnected
                logger.warning("[LoroSyncClient] ⚠️ WebSocket connection closed, attempting to reconnect...")
                await self._auto_reconnect()
        except Exception as e:
            self.connected = False
            if not self._disconnecting:
                logger.error(f"[LoroSyncClient] ❌ Error in listen loop: {e}")
                await self._auto_reconnect()

    async def _auto_reconnect(self, max_retries: int = 10, initial_delay: float = 1.0):
        """Attempt to automatically reconnect to the sync server with exponential backoff.

        Args:
            max_retries: Maximum number of reconnection attempts (default: 10, was 3)
            initial_delay: Initial delay in seconds, doubles each retry (default: 1.0s)
        """
        delay = initial_delay
        for attempt in range(max_retries):
            try:
                logger.info(f"[LoroSyncClient] 🔄 Reconnection attempt {attempt + 1}/{max_retries} (delay: {delay:.1f}s)...")
                await asyncio.sleep(delay)
                await self.connect()
                logger.info("[LoroSyncClient] ✅ Reconnected successfully")
                return
            except Exception as e:
                logger.error(f"[LoroSyncClient] ❌ Reconnection attempt {attempt + 1} failed: {e}")
                # Exponential backoff with cap at 30 seconds
                delay = min(delay * 2, 30.0)

        logger.error(f"[LoroSyncClient] ❌ Failed to reconnect after {max_retries} attempts")

    async def ensure_connected(self) -> bool:
        """Ensure the client is connected, attempting to reconnect if necessary."""
        if self.connected and self.ws:
            return True

        logger.info("[LoroSyncClient] 🔌 Connection lost, attempting to reconnect...")
        try:
            await self.connect()
            return self.connected
        except Exception as e:
            logger.error(f"[LoroSyncClient] ❌ Failed to reconnect: {e}")
            return False

    def reconnect_sync(self) -> bool:
        """Synchronous reconnection method for use in tool code."""
        if self.connected and self.ws:
            return True

        logger.info("[LoroSyncClient] 🔌 Attempting synchronous reconnection...")

        try:
            try:
                running_loop = asyncio.get_running_loop()
                if running_loop is self._ws_loop:
                    logger.warning("[LoroSyncClient] ⚠️ Cannot reconnect from within the same event loop")
                    return False
                else:
                    logger.warning("[LoroSyncClient] ⚠️ In different event loop, skipping reconnect")
                    return False
            except RuntimeError:
                pass

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(self.connect())
                return self.connected
            finally:
                pass
        except Exception as e:
            logger.error(f"[LoroSyncClient] ❌ Sync reconnection failed: {e}")
            return False

    def _send_update(self, update: bytes, timeout_s: float = 5.0):
        """Send a local update to the sync server with timeout.

        Args:
            update: Binary update data to send
            timeout_s: Timeout in seconds for send operation (default: 5s)

        Raises:
            TimeoutError: If send operation exceeds timeout
            Exception: If WebSocket is closed or send fails
        """
        if not (self.ws and self.connected):
            logger.warning("[LoroSyncClient] ⚠️ Cannot send update: not connected")
            return

        if not self._ws_loop:
            logger.warning("[LoroSyncClient] ⚠️ Cannot send update: no event loop reference")
            return

        update_size = len(update)
        logger.info(f"[LoroSyncClient] 📤 Sending update to server ({update_size} bytes)")

        try:
            try:
                current_loop = asyncio.get_running_loop()
            except RuntimeError:
                current_loop = None

            if current_loop is self._ws_loop:
                logger.debug("[LoroSyncClient] Same loop detected, creating task directly")
                task = current_loop.create_task(self.ws.send(update))
                self._pending_sends.add(task)
                task.add_done_callback(self._pending_sends.discard)
                logger.debug("[LoroSyncClient] ✅ Task created for send")
                return

            if self._ws_loop.is_running():
                logger.debug("[LoroSyncClient] WS loop is running, scheduling via run_coroutine_threadsafe")
                future = asyncio.run_coroutine_threadsafe(self.ws.send(update), self._ws_loop)

                # CRITICAL: Wait for send with timeout to prevent hangs
                try:
                    future.result(timeout=timeout_s)
                    logger.debug("[LoroSyncClient] ✅ Update sent successfully via thread-safe call")
                except TimeoutError:
                    logger.error(f"[LoroSyncClient] ❌ Send timed out after {timeout_s}s - marking as disconnected")
                    self.connected = False
                    raise
                except Exception as e:
                    logger.error(f"[LoroSyncClient] ❌ Error sending update: {e} - marking as disconnected")
                    self.connected = False
                    raise
            else:
                logger.warning("[LoroSyncClient] ⚠️ WS event loop is not running, cannot send update")
                self.connected = False

        except Exception as e:
            logger.error(f"[LoroSyncClient] ❌ Error in _send_update: {e}")
            self.connected = False
            raise

    def _get_state(self) -> dict[str, Any]:
        """Get the current state of the document as a dictionary."""
        nodes_map = self.doc.get_map("nodes")
        edges_map = self.doc.get_map("edges")
        tasks_map = self.doc.get_map("tasks")

        return {
            "nodes": {k: v for k, v in nodes_map.items()},
            "edges": {k: v for k, v in edges_map.items()},
            "tasks": {k: v for k, v in tasks_map.items()},
        }
