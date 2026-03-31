"""
ClashAgent — connects to ProjectRoom via WebSocket and executes custom actions.

Protocol:
1. Connect to ws://<server>/sync/<projectId>?token=<token>
2. Receive initial Loro CRDT snapshot (binary)
3. Send register_custom_actions text message
4. Monitor incoming Loro updates for new entries in the 'tasks' map
5. When a matching task arrives, call the handler
6. Upload result via HTTP POST /api/custom-action/upload
7. Send complete_custom_task text message to update node status
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any
from urllib.parse import urlencode

import aiohttp

from .decorators import ActionDefinition
from .models import ActionContext, ActionResult

logger = logging.getLogger("clash_sdk")


class TaskState:
    """Tracks the state of an in-flight task."""

    def __init__(self, task_id: str, action_id: str, node_id: str):
        self.task_id = task_id
        self.action_id = action_id
        self.node_id = node_id
        self.status = "received"
        self.started_at = time.time()
        self.error: str | None = None


class ClashAgent:
    """
    Connects to a Clash ProjectRoom and executes registered custom actions.
    """

    def __init__(
        self,
        server_url: str,
        project_id: str,
        token: str,
        actions: list[ActionDefinition],
    ):
        self.server_url = server_url.rstrip("/")
        self.project_id = project_id
        self.token = token
        self.actions = {a.id: a for a in actions}
        self.active_tasks: dict[str, TaskState] = {}
        self.task_history: list[dict[str, Any]] = []
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._session: aiohttp.ClientSession | None = None
        self._running = False
        self._seen_tasks: set[str] = set()

    @property
    def http_url(self) -> str:
        """Convert ws:// to http:// for REST API calls."""
        url = self.server_url
        if url.startswith("ws://"):
            url = "http://" + url[5:]
        elif url.startswith("wss://"):
            url = "https://" + url[6:]
        return url

    async def connect(self) -> None:
        """Establish WebSocket connection and register actions."""
        self._session = aiohttp.ClientSession()
        ws_url = f"{self.server_url}/sync/{self.project_id}?{urlencode({'token': self.token})}"

        logger.info("Connecting to %s", ws_url)
        self._ws = await self._session.ws_connect(
            ws_url,
            headers={"x-client-type": "cli"},
        )

        # Wait for initial snapshot (first binary message)
        msg = await self._ws.receive()
        if msg.type == aiohttp.WSMsgType.BINARY:
            logger.info("Received initial snapshot (%d bytes)", len(msg.data))
        else:
            raise ConnectionError(f"Expected binary snapshot, got {msg.type}")

        # Register custom actions
        register_msg = json.dumps({
            "type": "register_custom_actions",
            "actions": [a.to_manifest() for a in self.actions.values()],
        })
        await self._ws.send_str(register_msg)
        logger.info(
            "Registered %d action(s): %s",
            len(self.actions),
            list(self.actions.keys()),
        )

    async def disconnect(self) -> None:
        """Unregister actions and close connection."""
        self._running = False
        if self._ws and not self._ws.closed:
            # Unregister actions
            unregister_msg = json.dumps({
                "type": "unregister_custom_actions",
                "actionIds": list(self.actions.keys()),
            })
            try:
                await self._ws.send_str(unregister_msg)
            except Exception:
                pass
            await self._ws.close()
        if self._session:
            await self._session.close()
        logger.info("Disconnected")

    async def run_forever(self) -> None:
        """Main loop: listen for Loro updates and process custom tasks."""
        self._running = True
        logger.info("Listening for tasks...")

        while self._running:
            if not self._ws or self._ws.closed:
                logger.warning("WebSocket closed, stopping")
                break

            try:
                msg = await asyncio.wait_for(self._ws.receive(), timeout=30.0)
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.error("WebSocket error: %s", e)
                break

            if msg.type == aiohttp.WSMsgType.BINARY:
                # Loro CRDT update — check for new tasks
                # We parse the JSON representation to find task entries
                # In practice, we'd use a Loro CRDT library for Python,
                # but for now we use a simpler approach: listen for text sideband
                pass
            elif msg.type == aiohttp.WSMsgType.TEXT:
                await self._handle_text_message(msg.data)
            elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSING, aiohttp.WSMsgType.CLOSED):
                logger.info("WebSocket closed by server")
                break
            elif msg.type == aiohttp.WSMsgType.ERROR:
                logger.error("WebSocket error")
                break

    async def _handle_text_message(self, text: str) -> None:
        """Handle JSON text sideband messages from ProjectRoom."""
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return

        # Activity messages may contain task dispatch info
        if data.get("type") == "activity" and data.get("action") == "added":
            # A node was added — check if it's a pending custom action node
            # We'll poll for tasks via HTTP as a simpler approach
            await self._poll_for_tasks()

    async def _poll_for_tasks(self) -> None:
        """Check for pending custom action tasks by reading nodes."""
        if not self._session:
            return

        try:
            url = f"{self.http_url}/api/v1/projects/{self.project_id}"
            # Use the ProjectRoom /nodes endpoint instead
            # This is an internal call that goes through the DO
            pass
        except Exception as e:
            logger.error("Failed to poll tasks: %s", e)

    async def _execute_task(self, task: dict[str, Any]) -> None:
        """Execute a custom action task."""
        task_id = task["taskId"]
        action_id = task.get("customActionId", "")
        node_id = task["nodeId"]
        project_id = task.get("projectId", self.project_id)

        if task_id in self._seen_tasks:
            return
        self._seen_tasks.add(task_id)

        action_def = self.actions.get(action_id)
        if not action_def:
            logger.warning("No handler for action '%s', skipping task %s", action_id, task_id)
            return

        state = TaskState(task_id, action_id, node_id)
        self.active_tasks[task_id] = state
        logger.info("Executing task %s (action: %s)", task_id, action_id)

        try:
            state.status = "running"
            ctx = ActionContext(
                task_id=task_id,
                node_id=node_id,
                project_id=project_id,
                action_id=action_id,
                prompt=task.get("prompt", ""),
                params=task.get("params", {}),
                output_type=task.get("outputType", action_def.output_type),
            )

            result = await action_def.handler(ctx)
            state.status = "uploading"

            # Upload result
            storage_key = None
            if result.type in ("image", "video") and result.data:
                storage_key = await self._upload_result(
                    project_id, task_id, node_id, result
                )
            elif result.type == "text":
                storage_key = None  # Text content is sent directly

            # Notify completion
            state.status = "completed"
            await self._complete_task(
                task_id, node_id, "completed", storage_key, result
            )

            duration_ms = (time.time() - state.started_at) * 1000
            logger.info(
                "Task %s completed in %.0fms", task_id, duration_ms
            )
            self.task_history.append({
                "taskId": task_id,
                "actionId": action_id,
                "status": "completed",
                "durationMs": duration_ms,
            })

        except Exception as e:
            state.status = "failed"
            state.error = str(e)
            logger.error("Task %s failed: %s", task_id, e)

            await self._complete_task(
                task_id, node_id, "failed", None, None, error=str(e)
            )
            self.task_history.append({
                "taskId": task_id,
                "actionId": action_id,
                "status": "failed",
                "error": str(e),
            })

        finally:
            del self.active_tasks[task_id]

    async def _upload_result(
        self,
        project_id: str,
        task_id: str,
        node_id: str,
        result: ActionResult,
    ) -> str:
        """Upload result file to R2 via the custom action upload endpoint."""
        if not self._session:
            raise RuntimeError("No HTTP session")

        url = f"{self.http_url}/api/custom-action/upload"
        form = aiohttp.FormData()
        form.add_field("projectId", project_id)
        form.add_field("taskId", task_id)
        form.add_field("nodeId", node_id)
        form.add_field("outputType", result.type)

        if result.data:
            form.add_field(
                "file",
                result.data,
                filename=f"result.{_ext(result.type)}",
                content_type=result.mime_type or "application/octet-stream",
            )

        headers = {"Authorization": f"Bearer {self.token}"}
        async with self._session.post(url, data=form, headers=headers) as resp:
            if resp.status != 200:
                body = await resp.text()
                raise RuntimeError(f"Upload failed ({resp.status}): {body}")
            data = await resp.json()
            return data.get("storageKey", "")

    async def _complete_task(
        self,
        task_id: str,
        node_id: str,
        status: str,
        storage_key: str | None,
        result: ActionResult | None,
        error: str | None = None,
    ) -> None:
        """Send complete_custom_task message via WebSocket."""
        if not self._ws or self._ws.closed:
            return

        msg: dict[str, Any] = {
            "type": "complete_custom_task",
            "taskId": task_id,
            "nodeId": node_id,
            "status": status,
            "result": {},
        }
        if storage_key:
            msg["result"]["storageKey"] = storage_key
        if result and result.content:
            msg["result"]["content"] = result.content
        if result and result.description:
            msg["result"]["description"] = result.description
        if error:
            msg["result"]["error"] = error

        await self._ws.send_str(json.dumps(msg))

    def process_loro_update(self, data: bytes) -> list[dict[str, Any]]:
        """
        Extract new tasks from a Loro CRDT update.

        Note: Full Loro CRDT parsing in Python requires a native binding.
        For now, this is a placeholder. In production, use loro-crdt Python
        bindings or parse the tasks map from the document state.
        """
        # TODO: Integrate with loro-crdt Python bindings when available
        return []


def _ext(output_type: str) -> str:
    return {"image": "png", "video": "mp4"}.get(output_type, "bin")


def run(
    server_url: str,
    project_id: str,
    token: str,
    actions: list[ActionDefinition] | None = None,
) -> None:
    """
    Convenience function to create an agent and run it.

    Example:
        from clash_sdk import action, ActionContext, ActionResult, run

        @action(id="echo", name="Echo", output_type="text")
        async def echo(ctx: ActionContext) -> ActionResult:
            return ActionResult.text(f"Echo: {ctx.prompt}")

        run(server_url="ws://localhost:8789", project_id="my-proj", token="...",
            actions=[echo])
    """
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    agent = ClashAgent(
        server_url=server_url,
        project_id=project_id,
        token=token,
        actions=actions or [],
    )

    async def _main() -> None:
        await agent.connect()
        try:
            await agent.run_forever()
        finally:
            await agent.disconnect()

    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        logger.info("Shutting down...")
