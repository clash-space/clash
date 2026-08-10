"""Stdio runner for sandboxed Clash executable plugins.

A v1 executable plugin speaks newline-delimited JSON over stdio:

- in:  ``clash.plugin.invoke/v1``
- out: ``clash.plugin.result/v1``
- side-channel: ``clash.plugin.broker-request/v1`` /
  ``clash.plugin.broker-response/v1`` for capability calls.

``serve`` implements that loop so a plugin only supplies handlers::

    from clash_sdk.executable import serve

    def execute(invocation, broker):
        credential = broker({"kind": "credential.handle",
                             "secretId": "provider:my-gateway"})
        response = broker({
            "kind": "network.fetch",
            "url": "https://gateway.example/generate",
            "method": "POST",
            "headers": {"content-type": "application/json"},
            "body": {"prompt": invocation["input"]["values"]["prompt"]},
            "credentialHandle": credential["handle"],
        })
        return [{"slot": "media", "kind": "value",
                 "value": {"url": response["body"]["url"],
                           "contentType": "image/png"}}]

    if __name__ == "__main__":
        serve({"my-gateway-execute": execute})

Handlers are keyed by ``target.exportId`` — the same dispatch contract as the
JS ``defineHostedExecutablePlugin``. A handler returns either a list of
outputs or a full ``clash.plugin.result/v1`` dict; raising surfaces as a
``failed`` result. Direct network access inside the sandbox is denied — every
external call must go through ``broker``.
"""

from __future__ import annotations

import json
import sys
import traceback
from typing import Any, Callable, Iterable, Mapping, TextIO

INVOKE_PROTOCOL = "clash.plugin.invoke/v1"
RESULT_PROTOCOL = "clash.plugin.result/v1"
BROKER_REQUEST_PROTOCOL = "clash.plugin.broker-request/v1"
BROKER_RESPONSE_PROTOCOL = "clash.plugin.broker-response/v1"

Broker = Callable[[Mapping[str, Any]], Any]
Handler = Callable[[Mapping[str, Any], Broker], Any]


class BrokerError(RuntimeError):
    """A broker operation was rejected by the host."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _write_line(out: TextIO, payload: Mapping[str, Any]) -> None:
    out.write(json.dumps(payload) + "\n")
    out.flush()


def _read_messages(stream: TextIO) -> Iterable[Mapping[str, Any]]:
    for raw in stream:
        raw = raw.strip()
        if not raw:
            continue
        try:
            message = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(message, dict):
            yield message


def _make_broker(
    invocation_id: str,
    stdin: TextIO,
    stdout: TextIO,
    counter: dict[str, int],
) -> Broker:
    def broker(operation: Mapping[str, Any]) -> Any:
        counter["value"] += 1
        request_id = f"py-{invocation_id}-{counter['value']}"
        _write_line(stdout, {
            "protocol": BROKER_REQUEST_PROTOCOL,
            "requestId": request_id,
            "invocationId": invocation_id,
            "operation": dict(operation),
        })
        for message in _read_messages(stdin):
            if message.get("protocol") != BROKER_RESPONSE_PROTOCOL:
                continue
            if message.get("requestId") != request_id:
                continue
            if message.get("status") == "ok":
                return message.get("result")
            error = message.get("error") or {}
            raise BrokerError(
                str(error.get("code", "broker_error")),
                str(error.get("message", "Plugin broker request failed.")),
            )
        raise BrokerError("broker_stream_closed", "Plugin broker stream closed.")

    return broker


def _result_from(handler_value: Any, invocation_id: str) -> Mapping[str, Any]:
    if isinstance(handler_value, Mapping) and handler_value.get("protocol") == RESULT_PROTOCOL:
        return handler_value
    outputs = handler_value if isinstance(handler_value, list) else []
    return {
        "protocol": RESULT_PROTOCOL,
        "invocationId": invocation_id,
        "status": "completed",
        "outputs": outputs,
    }


def serve(
    handlers: Mapping[str, Handler],
    *,
    stdin: TextIO | None = None,
    stdout: TextIO | None = None,
) -> None:
    """Run the executable-plugin stdio loop until stdin closes."""
    stdin = stdin if stdin is not None else sys.stdin
    stdout = stdout if stdout is not None else sys.stdout

    for message in _read_messages(stdin):
        if message.get("protocol") != INVOKE_PROTOCOL:
            continue
        invocation_id = str(message.get("invocationId", ""))
        export_id = str((message.get("target") or {}).get("exportId", ""))
        handler = handlers.get(export_id)
        if handler is None:
            _write_line(stdout, {
                "protocol": RESULT_PROTOCOL,
                "invocationId": invocation_id,
                "status": "failed",
                "error": {
                    "code": "unknown_export",
                    "message": f"No handler is registered for export {export_id!r}.",
                    "retryable": False,
                },
            })
            continue
        broker = _make_broker(invocation_id, stdin, stdout, {"value": 0})
        try:
            value = handler(message, broker)
            _write_line(stdout, _result_from(value, invocation_id))
        except BaseException as error:  # noqa: BLE001 — every failure must surface on the wire
            _write_line(stdout, {
                "protocol": RESULT_PROTOCOL,
                "invocationId": invocation_id,
                "status": "failed",
                "error": {
                    "code": getattr(error, "code", "handler_error"),
                    "message": str(error) or error.__class__.__name__,
                    "retryable": False,
                },
            })
            traceback.print_exc(file=sys.stderr)
