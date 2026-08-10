"""Contract tests for clash_sdk.executable.serve()."""

import io
import json

from clash_sdk.executable import serve


def _lines(*messages):
    return io.StringIO("".join(json.dumps(m) + "\n" for m in messages))


def _invoke(export_id="execute", invocation_id="inv-1", values=None):
    return {
        "protocol": "clash.plugin.invoke/v1",
        "invocationId": invocation_id,
        "taskId": "task-1",
        "projectId": "project-1",
        "target": {
            "pluginId": "py-plugin",
            "version": "1.0.0",
            "exportId": export_id,
            "schemaHash": "sha256:" + "a" * 64,
            "kind": "provider-executor",
        },
        "input": {"values": values or {}, "references": []},
        "actor": {"kind": "system", "id": "test"},
    }


def _parse(out):
    return [json.loads(line) for line in out.getvalue().splitlines() if line.strip()]


def test_completes_with_outputs_list():
    out = io.StringIO()
    serve(
        {"execute": lambda inv, broker: [
            {"slot": "media", "kind": "value",
             "value": {"prompt": inv["input"]["values"]["prompt"]}},
        ]},
        stdin=_lines(_invoke(values={"prompt": "A paper moon"})),
        stdout=out,
    )
    (result,) = _parse(out)
    assert result == {
        "protocol": "clash.plugin.result/v1",
        "invocationId": "inv-1",
        "status": "completed",
        "outputs": [{"slot": "media", "kind": "value",
                     "value": {"prompt": "A paper moon"}}],
    }


def test_broker_roundtrip_matches_request_ids():
    out = io.StringIO()

    def execute(invocation, broker):
        credential = broker({"kind": "credential.handle", "secretId": "provider:py"})
        return [{"slot": "media", "kind": "value",
                 "value": {"handle": credential["handle"]}}]

    # The broker response must be consumed by requestId, so serve() has to
    # write the request before reading the scripted response below.
    stdin_messages = [
        _invoke(),
        {"protocol": "clash.plugin.broker-response/v1",
         "requestId": "py-inv-1-1",
         "status": "ok",
         "result": {"handle": "clash-secret://py-test"}},
    ]
    serve({"execute": execute}, stdin=_lines(*stdin_messages), stdout=out)
    request, result = _parse(out)
    assert request["protocol"] == "clash.plugin.broker-request/v1"
    assert request["requestId"] == "py-inv-1-1"
    assert request["operation"] == {"kind": "credential.handle", "secretId": "provider:py"}
    assert result["status"] == "completed"
    assert result["outputs"][0]["value"] == {"handle": "clash-secret://py-test"}


def test_broker_error_fails_the_invocation():
    out = io.StringIO()

    def execute(_invocation, broker):
        return broker({"kind": "network.fetch", "url": "https://x", "method": "GET", "headers": {}})

    serve(
        {"execute": execute},
        stdin=_lines(
            _invoke(),
            {"protocol": "clash.plugin.broker-response/v1",
             "requestId": "py-inv-1-1",
             "status": "error",
             "error": {"code": "denied", "message": "Network domain x is not declared."}},
        ),
        stdout=out,
    )
    _request, result = _parse(out)
    assert result["status"] == "failed"
    assert result["error"]["code"] == "denied"
    assert "not declared" in result["error"]["message"]


def test_unknown_export_fails_without_calling_handlers():
    out = io.StringIO()
    serve({"execute": lambda inv, broker: []},
          stdin=_lines(_invoke(export_id="missing")), stdout=out)
    (result,) = _parse(out)
    assert result["status"] == "failed"
    assert result["error"]["code"] == "unknown_export"


def test_handler_exception_surfaces_as_failed_result():
    out = io.StringIO()

    def execute(_invocation, _broker):
        raise ValueError("upstream rejected the request")

    serve({"execute": execute}, stdin=_lines(_invoke()), stdout=out)
    (result,) = _parse(out)
    assert result["status"] == "failed"
    assert result["error"]["message"] == "upstream rejected the request"
