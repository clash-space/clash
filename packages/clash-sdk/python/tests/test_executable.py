"""Contract tests for clash_sdk.executable.serve()."""

import io
import json

import pytest

from clash_sdk.executable import (
    HostDependencyError,
    _resolved_reference_from_host,
    serve,
)


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

    async def submit(invocation, context):
        assert not callable(context)
        assert not hasattr(context, "broker")
        assert all(hasattr(context, name) for name in (
            "store", "reference", "upload", "asset", "host_tools"))
        return [
            {"slot": "media", "kind": "value",
             "value": {"prompt": invocation["input"]["values"]["prompt"]}},
        ]

    serve(
        {"execute": {"submit": submit}},
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


def test_host_store_roundtrip_matches_request_ids():
    out = io.StringIO()

    async def submit(_invocation, context):
        account = await context.store.get("apiKey")
        return [{"slot": "media", "kind": "value",
                 "value": {"configured": bool(account)}}]

    # The Host response must be consumed by requestId, so serve() has to
    # write the request before reading the scripted response below.
    stdin_messages = [
        _invoke(),
        {"protocol": "clash.plugin.broker-response/v1",
         "requestId": "py-inv-1-1",
         "status": "ok",
         "result": {"value": "py-test-key"}},
    ]
    serve({"execute": {"submit": submit}}, stdin=_lines(*stdin_messages), stdout=out)
    request, result = _parse(out)
    assert request["protocol"] == "clash.plugin.broker-request/v1"
    assert request["requestId"] == "py-inv-1-1"
    assert request["operation"] == {"kind": "store.get", "key": "apiKey"}
    assert result["status"] == "completed"
    assert result["outputs"][0]["value"] == {"configured": True}


def test_host_dependency_error_fails_the_invocation():
    out = io.StringIO()

    async def submit(_invocation, context):
        return await context.reference({"asset": {
            "assetId": "asset-1", "uri": "clash-asset://asset-1", "kind": "image"}})

    serve(
        {"execute": {"submit": submit}},
        stdin=_lines(
            _invoke(),
            {"protocol": "clash.plugin.broker-response/v1",
             "requestId": "py-inv-1-1",
             "status": "error",
             "error": {"code": "unavailable", "message": "Asset asset-1 is unavailable."}},
        ),
        stdout=out,
    )
    _request, result = _parse(out)
    assert result["status"] == "failed"
    assert result["error"]["code"] == "unavailable"
    assert "unavailable" in result["error"]["message"]


def test_reference_resolves_the_full_slot_to_a_provider_url():
    out = io.StringIO()
    invocation = _invoke()
    reference = {
        "slot": "startFrame",
        "index": 0,
        "asset": {
            "assetId": "asset-1",
            "uri": "clash-asset://asset-1",
            "kind": "image",
            "mediaType": "image/png",
        },
    }
    invocation["input"]["references"] = [reference]
    seen = {}

    async def submit(current, context):
        seen["resolved"] = await context.reference(current["input"]["references"][0])
        return []

    serve(
        {"execute": {"submit": submit}},
        stdin=_lines(
            invocation,
            {
                "protocol": "clash.plugin.broker-response/v1",
                "requestId": "py-inv-1-1",
                "status": "ok",
                "result": {
                    "form": "provider-url",
                    "providerUrl": "https://objects.example.test/reference.png?sig=1",
                    "expiresAt": "2026-08-13T12:00:00.000Z",
                    "kind": "image",
                    "mediaType": "image/png",
                },
            },
        ),
        stdout=out,
    )
    request, result = _parse(out)
    assert request["operation"] == {"kind": "asset.resolve", "reference": reference}
    assert seen["resolved"] == {
        "form": "provider-url",
        "providerUrl": "https://objects.example.test/reference.png?sig=1",
        "expiresAt": "2026-08-13T12:00:00.000Z",
        "kind": "image",
        "mediaType": "image/png",
    }
    assert result["status"] == "completed"


def test_reference_decodes_host_bytes_base64_before_plugin_code_sees_it():
    out = io.StringIO()
    invocation = _invoke()
    reference = {
        "slot": "reference",
        "index": 0,
        "asset": {
            "assetId": "asset-1",
            "uri": "clash-asset://asset-1",
            "kind": "image",
        },
    }
    invocation["input"]["references"] = [reference]
    seen = {}

    async def submit(current, context):
        seen["resolved"] = await context.reference(current["input"]["references"][0])
        return []

    serve(
        {"execute": {"submit": submit}},
        stdin=_lines(
            invocation,
            {
                "protocol": "clash.plugin.broker-response/v1",
                "requestId": "py-inv-1-1",
                "status": "ok",
                "result": {
                    "form": "bytes",
                    "bytesBase64": "AQID",
                    "kind": "image",
                    "mediaType": "image/png",
                },
            },
        ),
        stdout=out,
    )
    request, result = _parse(out)
    assert request["operation"] == {"kind": "asset.resolve", "reference": reference}
    assert seen["resolved"] == {
        "form": "bytes",
        "bytes": b"\x01\x02\x03",
        "kind": "image",
        "mediaType": "image/png",
    }
    assert result["status"] == "completed"


def test_reference_preserves_an_empty_bytes_representation():
    out = io.StringIO()
    invocation = _invoke()
    reference = {
        "slot": "reference",
        "index": 0,
        "asset": {
            "assetId": "empty-asset",
            "uri": "clash-asset://empty-asset",
            "kind": "image",
        },
    }
    invocation["input"]["references"] = [reference]
    seen = {}

    async def submit(current, context):
        seen["resolved"] = await context.reference(current["input"]["references"][0])
        return []

    serve(
        {"execute": {"submit": submit}},
        stdin=_lines(
            invocation,
            {
                "protocol": "clash.plugin.broker-response/v1",
                "requestId": "py-inv-1-1",
                "status": "ok",
                "result": {"form": "bytes", "bytesBase64": "", "kind": "image"},
            },
        ),
        stdout=out,
    )
    _request, result = _parse(out)
    assert seen["resolved"] == {"form": "bytes", "bytes": b"", "kind": "image"}
    assert result["status"] == "completed"


def test_reference_rejects_the_retired_url_reach_dialect():
    out = io.StringIO()
    invocation = _invoke()
    reference = {
        "slot": "reference",
        "index": 0,
        "asset": {
            "assetId": "asset-1",
            "uri": "clash-asset://asset-1",
            "kind": "image",
        },
    }
    invocation["input"]["references"] = [reference]

    async def submit(current, context):
        await context.reference(current["input"]["references"][0])
        return []

    serve(
        {"execute": {"submit": submit}},
        stdin=_lines(
            invocation,
            {
                "protocol": "clash.plugin.broker-response/v1",
                "requestId": "py-inv-1-1",
                "status": "ok",
                "result": {
                    "form": "provider-url",
                    "providerUrl": "https://objects.example.test/reference.png?sig=1",
                    "expiresAt": "2026-08-13T12:00:00.000Z",
                    "url": "https://objects.example.test/legacy.png",
                    "reach": "public",
                },
            },
        ),
        stdout=out,
    )
    _request, result = _parse(out)
    assert result["status"] == "failed"
    assert result["error"]["code"] == "invalid_asset"


@pytest.mark.parametrize(
    ("provider_url", "expires_at"),
    [
        ("not-an-absolute-url", "2026-08-13T12:00:00.000Z"),
        ("https://", "2026-08-13T12:00:00.000Z"),
        ("https://objects.example.test/reference.png", "2026-02-31T12:00:00Z"),
    ],
)
def test_reference_rejects_an_invalid_provider_url_or_expiry(
    provider_url,
    expires_at,
):
    with pytest.raises(HostDependencyError):
        _resolved_reference_from_host({
            "form": "provider-url",
            "providerUrl": provider_url,
            "expiresAt": expires_at,
        })


def test_reference_resolves_text_through_the_host_instead_of_short_circuiting():
    out = io.StringIO()
    invocation = _invoke()
    reference = {
        "slot": "prompt",
        "index": 0,
        "text": {"nodeId": "text-1", "value": "A paper moon"},
    }
    invocation["input"]["references"] = [reference]
    seen = {}

    async def submit(current, context):
        seen["resolved"] = await context.reference(current["input"]["references"][0])
        return []

    serve(
        {"execute": {"submit": submit}},
        stdin=_lines(
            invocation,
            {
                "protocol": "clash.plugin.broker-response/v1",
                "requestId": "py-inv-1-1",
                "status": "ok",
                "result": {"form": "text", "text": "A paper moon"},
            },
        ),
        stdout=out,
    )
    request, result = _parse(out)
    assert request["operation"] == {"kind": "asset.resolve", "reference": reference}
    assert seen["resolved"] == {"form": "text", "text": "A paper moon"}
    assert result["status"] == "completed"


def test_unknown_export_fails_without_calling_handlers():
    out = io.StringIO()
    async def submit(_invocation, _context):
        return []

    serve({"execute": {"submit": submit}},
          stdin=_lines(_invoke(export_id="missing")), stdout=out)
    (result,) = _parse(out)
    assert result["status"] == "failed"
    assert result["error"]["code"] == "unknown_export"


def test_handler_exception_surfaces_as_failed_result():
    out = io.StringIO()

    async def submit(_invocation, _context):
        raise ValueError("upstream rejected the request")

    serve({"execute": {"submit": submit}}, stdin=_lines(_invoke()), stdout=out)
    (result,) = _parse(out)
    assert result["status"] == "failed"
    assert result["error"]["message"] == "upstream rejected the request"


def test_dispatches_poll_to_the_declared_poll_handler():
    out = io.StringIO()
    invocation = _invoke()
    invocation["operation"] = "poll"
    invocation["pollState"] = {"taskId": "upstream-1"}

    async def submit(_invocation, _context):
        raise AssertionError("submit must not run for a poll invocation")

    async def poll(current, _context):
        return [{"slot": "state", "kind": "value", "value": current["pollState"]}]

    serve(
        {"execute": {"submit": submit, "poll": poll}},
        stdin=_lines(invocation),
        stdout=out,
    )
    (result,) = _parse(out)
    assert result["status"] == "completed"
    assert result["outputs"][0]["value"] == {"taskId": "upstream-1"}


def test_typed_asset_and_host_tool_methods_hide_raw_operations():
    out = io.StringIO()

    async def submit(_invocation, context):
        generated = await context.host_tools.codex_imagegen.generate({
            "prompt": "A paper moon", "aspectRatio": "1:1", "slot": "image",
            "references": [],
        })
        stored = await context.asset({
            "slot": "copy", "kind": "image", "dataBase64": "AAAA",
        })
        return [
            {"slot": "image", "kind": "asset", "asset": generated},
            stored,
        ]

    serve(
        {"execute": {"submit": submit}},
        stdin=_lines(
            _invoke(),
            {"protocol": "clash.plugin.broker-response/v1",
             "requestId": "py-inv-1-1", "status": "ok",
             "result": {"assetId": "generated", "uri": "clash-asset://generated",
                        "kind": "image"}},
            {"protocol": "clash.plugin.broker-response/v1",
             "requestId": "py-inv-1-2", "status": "ok",
             "result": {"assetId": "copied", "uri": "clash-asset://copied",
                        "kind": "image"}},
        ),
        stdout=out,
    )
    tool_request, asset_request, result = _parse(out)
    assert tool_request["operation"]["kind"] == "codex.image.generate"
    assert asset_request["operation"] == {
        "kind": "asset.write", "slot": "copy", "assetKind": "image",
        "dataBase64": "AAAA",
    }
    assert [entry["asset"]["assetId"] for entry in result["outputs"]] == [
        "generated", "copied",
    ]


def test_asset_helper_rejects_a_host_projection_instead_of_exposing_it():
    out = io.StringIO()

    async def submit(_invocation, context):
        return [await context.asset({
            "slot": "media", "kind": "image", "dataBase64": "AAAA",
        })]

    serve(
        {"execute": {"submit": submit}},
        stdin=_lines(
            _invoke(),
            {"protocol": "clash.plugin.broker-response/v1",
             "requestId": "py-inv-1-1", "status": "ok",
             "result": {"assetId": "legacy", "uri": "clash-asset://legacy",
                        "kind": "image", "url": "https://assets.example/legacy.png",
                        "reach": "public"}},
        ),
        stdout=out,
    )
    _request, result = _parse(out)
    assert result["status"] == "failed"
    assert result["error"]["code"] == "invalid_asset"
    assert "Asset handle" in result["error"]["message"]
