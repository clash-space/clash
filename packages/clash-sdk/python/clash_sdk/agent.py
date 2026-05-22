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
import os
import time
from typing import Any
from urllib.parse import urlencode

import aiohttp

from .decorators import ActionDefinition
from .models import ActionContext, ActionResult, AssetOutput

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
        runtime_id: str | None = None,
    ):
        self.server_url = server_url.rstrip("/")
        self.project_id = project_id
        self.token = token
        self.actions = {a.id: a for a in actions}
        # runtime_id identifies WHICH local machine hosts this action.
        # The server uses it to gate dispatch on the runtime being online
        # (deriveRuntimeStatus). Falls back to CLASH_RUNTIME_ID env so the
        # bridge daemon can inject it when supervising subprocess actions.
        #
        # If unset, register_custom_actions on the server side will reject
        # us — bail loudly during connect() rather than after a sleep.
        # Dev path: `export CLASH_RUNTIME_ID=$(jq -r .runtimeId ~/.clash/credentials.json)`
        # (the bridge writes credentials.json during `clash setup`).
        self.runtime_id = runtime_id or os.environ.get("CLASH_RUNTIME_ID") or None
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
        if not self.runtime_id:
            raise RuntimeError(
                "CLASH_RUNTIME_ID is required to host custom actions. "
                "Set it via env or constructor arg. Quick dev path: "
                "export CLASH_RUNTIME_ID=$(jq -r .runtimeId ~/.clash/credentials.json)"
            )

        self._session = aiohttp.ClientSession()
        ws_url = f"{self.server_url}/sync/{self.project_id}?{urlencode({'token': self.token})}"

        logger.info(
            "Connecting to %s (runtime_id=%s…)",
            ws_url,
            self.runtime_id[:8] if self.runtime_id else "?",
        )
        self._ws = await self._session.ws_connect(
            ws_url,
            headers={
                "x-client-type": "cli",
                # Server validates this against the runtime table; the
                # WS upgrade returns 403 if the runtime doesn't exist or
                # belongs to a different user than the API token.
                "x-runtime-id": self.runtime_id,
            },
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
        """Handle JSON text sideband messages from ProjectRoom.

        The CLI agent connection (`x-client-type: cli`) gets a JSON
        sideband whenever NodeProcessor dispatches a custom-action
        task to a local runtime. Wire shape:

            {type: "custom_task_assigned", task: {...task record...}}
        """
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return

        if data.get("type") == "custom_task_assigned":
            task = data.get("task") or {}
            task_id = task.get("taskId")
            if not task_id:
                logger.warning("custom_task_assigned with no taskId, ignoring")
                return
            logger.debug("Got custom_task_assigned task_id=%s action=%s", task_id, task.get("customActionId"))
            # Dedup BEFORE scheduling — two sideband messages
            # arriving in the same event-loop tick would otherwise
            # both queue handlers before either reached the seen-set
            # check inside _execute_task. The race fires when
            # ProjectRoom both broadcasts a fresh dispatch and
            # replays it on a near-simultaneous reconnect (each
            # spawns N extra siblings server-side).
            if task_id in self._seen_tasks:
                return
            self._seen_tasks.add(task_id)
            # Long-running actions (Pillow slicing, ML inference)
            # may take seconds — run concurrently so the receive
            # loop keeps processing messages.
            asyncio.create_task(self._execute_task(task))

    async def _execute_task(self, task: dict[str, Any]) -> None:
        """Execute a custom action task."""
        task_id = task["taskId"]
        action_id = task.get("customActionId", "")
        node_id = task["nodeId"]
        project_id = task.get("projectId", self.project_id)

        # Dedup happens at the entry point (_handle_text_message) now —
        # if we got here, _seen_tasks already contains task_id from the
        # caller. Re-checking would always short-circuit. Note that the
        # `process_loro_update` placeholder (currently a no-op) might
        # call this directly someday; if that lands, it must add to
        # _seen_tasks before calling.

        action_def = self.actions.get(action_id)
        if not action_def:
            logger.warning("No handler for action '%s', skipping task %s", action_id, task_id)
            return

        state = TaskState(task_id, action_id, node_id)
        self.active_tasks[task_id] = state
        logger.info("Executing task %s (action: %s)", task_id, action_id)

        try:
            state.status = "running"
            refs = task.get("refs") or {}
            ctx = ActionContext(
                task_id=task_id,
                node_id=node_id,
                project_id=project_id,
                action_id=action_id,
                prompt=task.get("prompt", ""),
                params=task.get("params", {}),
                output_type=task.get("outputType", action_def.output_type),
                reference_image_r2_keys=list(refs.get("image") or []),
                reference_video_r2_keys=list(refs.get("video") or []),
                reference_audio_r2_keys=list(refs.get("audio") or []),
                fetch_asset=self.fetch_asset,
            )

            result = await action_def.handler(ctx)
            state.status = "uploading"

            # Upload each binary output, build asset descriptors for
            # the complete message. Text outputs ride along with no
            # upload — server stamps `data.content` directly.
            assets: list[dict[str, Any]] = []
            for idx, out in enumerate(result.outputs):
                if out.type == "text":
                    assets.append({
                        "type": "text",
                        "content": out.content or "",
                        "label": out.label,
                    })
                    continue
                if not out.data:
                    raise RuntimeError(
                        f"AssetOutput[{idx}] type={out.type} has no data"
                    )
                storage_key = await self._upload_one(
                    project_id, task_id, node_id, out, idx
                )
                assets.append({
                    "type": out.type,
                    "storageKey": storage_key,
                    "mimeType": out.mime_type,
                    "label": out.label,
                })

            state.status = "completed"
            await self._complete_task(
                task_id, node_id, "completed", assets, result.description
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
                task_id, node_id, "failed", [], None, error=str(e)
            )
            self.task_history.append({
                "taskId": task_id,
                "actionId": action_id,
                "status": "failed",
                "error": str(e),
            })

        finally:
            del self.active_tasks[task_id]

    async def fetch_asset(self, storage_key: str) -> bytes:
        """Download a reference asset by R2 storage key.

        Used by action handlers that need to operate on their input
        images (e.g. grid_split). The agent's bearer token mints a
        signed URL, then we stream the bytes back. The signed URL
        machinery already enforces project-level auth — we don't
        need additional checks here.
        """
        if not self._session:
            raise RuntimeError("No HTTP session")
        sign_url = f"{self.http_url}/assets/sign?key={storage_key}"
        headers = {"Authorization": f"Bearer {self.token}"}
        async with self._session.get(sign_url, headers=headers) as resp:
            if resp.status != 200:
                body = await resp.text()
                raise RuntimeError(f"Sign failed ({resp.status}): {body}")
            signed = (await resp.json()).get("url")
        if not signed:
            raise RuntimeError(f"No signed URL returned for {storage_key}")
        get_url = f"{self.http_url}{signed}" if signed.startswith("/") else signed
        async with self._session.get(get_url) as resp:
            if resp.status != 200:
                body = await resp.text()
                raise RuntimeError(f"Fetch failed ({resp.status}): {body}")
            return await resp.read()

    async def _upload_one(
        self,
        project_id: str,
        task_id: str,
        node_id: str,
        out: AssetOutput,
        idx: int,
    ) -> str:
        """Upload one binary asset; returns its R2 storage key.

        Multi-output actions call this once per binary output. The
        `outputIndex` form field tells the server to suffix the R2
        key so sibling uploads from the same task don't collide.
        """
        if not self._session:
            raise RuntimeError("No HTTP session")

        url = f"{self.http_url}/api/custom-action/upload"
        form = aiohttp.FormData()
        form.add_field("projectId", project_id)
        form.add_field("taskId", task_id)
        form.add_field("nodeId", node_id)
        form.add_field("outputType", out.type)
        form.add_field("outputIndex", str(idx))
        form.add_field(
            "file",
            out.data or b"",
            filename=f"result-{idx}.{_ext(out.type)}",
            content_type=out.mime_type or "application/octet-stream",
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
        assets: list[dict[str, Any]],
        description: str | None,
        error: str | None = None,
    ) -> None:
        """Send complete_custom_task message via WebSocket.

        Wire shape:
            {
              type: "complete_custom_task",
              taskId, nodeId, status,
              result: {
                assets: [{type, storageKey?, content?, mimeType?, label?}, ...],
                description?, error?
              }
            }
        """
        if not self._ws or self._ws.closed:
            return

        result: dict[str, Any] = {"assets": assets}
        if description:
            result["description"] = description
        if error:
            result["error"] = error

        msg: dict[str, Any] = {
            "type": "complete_custom_task",
            "taskId": task_id,
            "nodeId": node_id,
            "status": status,
            "result": result,
        }
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
    return {"image": "png", "video": "mp4", "audio": "mp3"}.get(output_type, "bin")


def run(
    server_url: str,
    project_id: str,
    token: str,
    actions: list[ActionDefinition] | None = None,
    runtime_id: str | None = None,
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
        runtime_id=runtime_id,
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
