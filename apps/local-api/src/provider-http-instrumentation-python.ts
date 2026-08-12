import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PYTHON_SITE_CUSTOMIZE = String.raw`
import base64
import datetime
import email.message
import hashlib
import io
import json
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid

_MODE = os.environ.get("CLASH_PROVIDER_TRAFFIC_MODE", "")
_TRAFFIC_PATH = os.environ.get("CLASH_PROVIDER_TRAFFIC_PATH", "")
_STUB_PATH = os.environ.get("CLASH_PROVIDER_TRAFFIC_STUB_PATH", "")
_LOCK = threading.Lock()
_SECRET_KEY = re.compile(r"authorization|api[-_]?key|access[-_]?key|private[-_]?key|secret|token|password|assertion|cookie|signature|credential", re.I)
_PROJECT_RESOURCE = re.compile(r"projects/[^/?#]+/locations/")
_TEXT_CONTENT = re.compile(r"json|text|xml|javascript|svg|event-stream|x-www-form-urlencoded", re.I)


def _timestamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _secret_key(key):
    return bool(_SECRET_KEY.search(str(key))) or str(key).lower() == "key"


def _normalize_url(value):
    try:
        parsed = urllib.parse.urlsplit(str(value))
    except Exception:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    hostname = parsed.hostname or ""
    if parsed.port:
        hostname += ":" + str(parsed.port)
    if parsed.username:
        username = urllib.parse.quote(parsed.username, safe="")
        password = ":[redacted]" if parsed.password else ""
        hostname = username + password + "@" + hostname
    query = []
    for key, value in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True):
        query.append((key, "[redacted]" if _secret_key(key) else value))
    path = _PROJECT_RESOURCE.sub("projects/PROJECT_ID/locations/", parsed.path)
    return urllib.parse.urlunsplit((parsed.scheme, hostname, path, urllib.parse.urlencode(query), parsed.fragment))


def _normalize(value):
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        url = _normalize_url(value)
        return url if url is not None else _PROJECT_RESOURCE.sub("projects/PROJECT_ID/locations/", value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        data = bytes(value)
        return {"$binary": {"encoding": "base64", "data": base64.b64encode(data).decode("ascii"), "byteLength": len(data)}}
    if isinstance(value, (list, tuple)):
        return [_normalize(item) for item in value]
    if isinstance(value, dict):
        return {str(key): "[redacted]" if _secret_key(key) else _normalize(item) for key, item in value.items()}
    return str(value)


def _headers(value):
    if value is None:
        return {}
    try:
        items = value.items()
    except AttributeError:
        items = value
    result = {}
    for key, item in items:
        name = str(key).lower()
        text = str(item)
        if _secret_key(name):
            text = "[redacted]"
        elif name == "content-type" and text.lower().startswith("multipart/form-data"):
            text = "multipart/form-data"
        result[name] = text
    return result


def _content_type(headers):
    if headers is None:
        return ""
    try:
        items = headers.items()
    except AttributeError:
        items = headers
    for key, value in items:
        if str(key).lower() == "content-type":
            return str(value)
    return ""


def _multipart_payload(data, content_type):
    if not isinstance(data, (bytes, bytearray, memoryview)):
        return None
    try:
        from email import policy
        from email.parser import BytesParser
        envelope = b"Content-Type: " + content_type.encode("utf-8") + b"\r\nMIME-Version: 1.0\r\n\r\n" + bytes(data)
        message = BytesParser(policy=policy.default).parsebytes(envelope)
        entries = []
        for part in message.iter_parts():
            name = part.get_param("name", header="content-disposition")
            filename = part.get_filename()
            payload = part.get_payload(decode=True) or b""
            if filename is None:
                entries.append({"name": name or "", "value": payload.decode(part.get_content_charset() or "utf-8")})
            else:
                entries.append({"name": name or "", "file": {
                    "name": filename,
                    "type": part.get_content_type() or "application/octet-stream",
                    "byteLength": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }})
        return {"$multipart": entries}
    except Exception:
        return None


def _transport_payload(value, headers=None):
    content_type = _content_type(headers)
    if value is None:
        return None
    if content_type.lower().startswith("multipart/form-data"):
        multipart = _multipart_payload(value, content_type)
        if multipart is not None:
            return multipart
    if isinstance(value, (bytes, bytearray, memoryview)):
        data = bytes(value)
        if not _TEXT_CONTENT.search(content_type) and content_type.strip() != "":
            return _normalize(data)
        try:
            value = data.decode("utf-8")
        except UnicodeDecodeError:
            return _normalize(data)
    if isinstance(value, str):
        try:
            return _normalize(json.loads(value))
        except Exception:
            if "=" in value and "&" in value:
                try:
                    return _normalize(dict(urllib.parse.parse_qsl(value, keep_blank_values=True)))
                except Exception:
                    pass
            return _normalize(value)
    return _normalize(value)


def _decoded_headers(headers):
    result = _headers(headers)
    result.pop("content-encoding", None)
    result.pop("content-length", None)
    result.pop("transfer-encoding", None)
    return result


def _append(event):
    line = (json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    with _LOCK:
        descriptor = os.open(_TRAFFIC_PATH, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            os.write(descriptor, line)
        finally:
            os.close(descriptor)


def _active_stub():
    if not _STUB_PATH:
        raise RuntimeError("Provider traffic recording requires an active stub path.")
    with open(_STUB_PATH, "r", encoding="utf-8") as handle:
        stub = json.load(handle)
    if not isinstance(stub, dict) or not isinstance(stub.get("id"), str):
        raise RuntimeError("Provider traffic active stub is invalid: " + _STUB_PATH)
    return stub


def _record_request(method, url, headers, body):
    request_id = "provider-test-" + str(uuid.uuid4())
    request = {
        "url": _normalize_url(url) or str(url),
        "method": str(method).upper(),
        "headers": _headers(headers),
    }
    payload = _transport_payload(body, headers)
    if body is not None:
        request["body"] = payload
    _append({
        "schemaVersion": 1,
        "type": "request",
        "timestamp": _timestamp(),
        "requestId": request_id,
        "stub": _active_stub(),
        "request": request,
    })
    return request_id


def _record_response(request_id, status, headers, body, decoded=True):
    response_headers = _decoded_headers(headers) if decoded else _headers(headers)
    response = {"status": int(status), "headers": response_headers}
    if body is not None:
        response["body"] = _transport_payload(body, response_headers)
    _append({
        "schemaVersion": 1,
        "type": "response",
        "timestamp": _timestamp(),
        "requestId": request_id,
        "response": response,
    })


def _record_error(request_id, error):
    _record_response(request_id, 0, {}, {"error": str(error)})


def _load_fixtures():
    with open(_TRAFFIC_PATH, "r", encoding="utf-8") as handle:
        events = [json.loads(line) for line in handle if line.strip()]
    by_id = {}
    order = []
    for event in events:
        request_id = event.get("requestId")
        if request_id not in by_id:
            by_id[request_id] = {}
            order.append(request_id)
        by_id[request_id][event.get("type")] = event
    fixtures = []
    for request_id in order:
        row = by_id[request_id]
        if "request" not in row or "response" not in row:
            raise RuntimeError("Provider test recording " + str(request_id) + " is incomplete")
        fixtures.append({
            "requestId": request_id,
            "request": row["request"]["request"],
            "response": row["response"]["response"],
        })
    return fixtures


_PENDING = _load_fixtures() if _MODE == "replay" and _TRAFFIC_PATH else []


def _payload_key(value):
    return json.dumps(_normalize(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _take_fixture(method, url, headers, body):
    normalized_url = _normalize_url(url) or str(url)
    normalized_body = _transport_payload(body, headers)
    for index, fixture in enumerate(_PENDING):
        request = fixture["request"]
        if (_normalize_url(request.get("url")) or request.get("url")) != normalized_url:
            continue
        if str(request.get("method", "GET")).upper() != str(method).upper():
            continue
        if "body" in request and _payload_key(request.get("body")) != _payload_key(normalized_body):
            continue
        return _PENDING.pop(index)
    raise RuntimeError("No provider test replay fixture for " + str(method).upper() + " " + normalized_url)


def _response_bytes(body):
    if body is None:
        return b""
    if isinstance(body, str):
        return body.encode("utf-8")
    if isinstance(body, bool):
        return ("true" if body else "false").encode("ascii")
    if isinstance(body, (int, float)):
        return str(body).encode("ascii")
    if isinstance(body, dict) and isinstance(body.get("$binary"), dict):
        return base64.b64decode(body["$binary"]["data"])
    return json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


class _BufferedUrllibResponse:
    def __init__(self, original, body):
        self._original = original
        self._buffer = io.BytesIO(body)

    def read(self, amount=-1):
        return self._buffer.read(amount)

    def readline(self, limit=-1):
        return self._buffer.readline(limit)

    def readlines(self, hint=-1):
        return self._buffer.readlines(hint)

    def __iter__(self):
        return iter(self._buffer)

    def __getattr__(self, name):
        return getattr(self._original, name)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()

    def close(self):
        self._buffer.close()
        self._original.close()


def _urllib_replay(fixture, url):
    response = fixture["response"]
    status = int(response.get("status", 0))
    if status == 0:
        error = response.get("body", {}).get("error", "provider replay failed")
        raise RuntimeError(str(error))
    headers = email.message.Message()
    for key, value in response.get("headers", {}).items():
        headers.add_header(str(key), str(value))
    body = _response_bytes(response.get("body"))
    result = urllib.response.addinfourl(io.BytesIO(body), headers, str(url), status)
    result.msg = "Recorded response"
    if status >= 400:
        raise urllib.error.HTTPError(str(url), status, result.msg, headers, result)
    return result


_ORIGINAL_URLLIB_OPEN = urllib.request.OpenerDirector.open


def _urllib_open(self, fullurl, data=None, timeout=urllib.request.socket._GLOBAL_DEFAULT_TIMEOUT):
    request = fullurl if isinstance(fullurl, urllib.request.Request) else urllib.request.Request(fullurl, data=data)
    body = data if data is not None else getattr(request, "data", None)
    method = request.get_method()
    url = request.full_url
    headers = dict(request.header_items())
    if _MODE == "replay":
        return _urllib_replay(_take_fixture(method, url, headers, body), url)
    request_id = _record_request(method, url, headers, body)
    try:
        response = _ORIGINAL_URLLIB_OPEN(self, fullurl, data=data, timeout=timeout)
        payload = response.read()
        response_headers = dict(response.headers.items())
        decoded = "content-encoding" not in {str(key).lower() for key in response_headers}
        _record_response(request_id, getattr(response, "status", response.getcode()), response_headers, payload, decoded=decoded)
        return _BufferedUrllibResponse(response, payload)
    except Exception as error:
        _record_error(request_id, error)
        raise


def _patch_requests():
    try:
        import requests
    except ImportError:
        return
    original_send = requests.sessions.Session.send

    def send(session, request, **kwargs):
        method = request.method
        url = request.url
        headers = request.headers
        body = request.body
        if _MODE == "replay":
            fixture = _take_fixture(method, url, headers, body)
            recorded = fixture["response"]
            status = int(recorded.get("status", 0))
            if status == 0:
                raise RuntimeError(str(recorded.get("body", {}).get("error", "provider replay failed")))
            response = requests.Response()
            response.status_code = status
            response.headers.update(_decoded_headers(recorded.get("headers", {})))
            response._content = _response_bytes(recorded.get("body"))
            response.url = url
            response.request = request
            return response
        request_id = _record_request(method, url, headers, body)
        try:
            response = original_send(session, request, **kwargs)
            _record_response(request_id, response.status_code, response.headers, response.content, decoded=True)
            return response
        except Exception as error:
            _record_error(request_id, error)
            raise

    requests.sessions.Session.send = send


def _patch_httpx():
    try:
        import httpx
    except ImportError:
        return
    original_send = httpx.Client.send
    original_async_send = httpx.AsyncClient.send

    def request_body(request):
        try:
            return request.content
        except Exception:
            return request.read()

    def replay(request, body):
        fixture = _take_fixture(request.method, str(request.url), request.headers, body)
        recorded = fixture["response"]
        status = int(recorded.get("status", 0))
        if status == 0:
            raise RuntimeError(str(recorded.get("body", {}).get("error", "provider replay failed")))
        return httpx.Response(status, headers=_decoded_headers(recorded.get("headers", {})), content=_response_bytes(recorded.get("body")), request=request)

    def send(client, request, *args, **kwargs):
        body = request_body(request)
        if _MODE == "replay":
            return replay(request, body)
        request_id = _record_request(request.method, str(request.url), request.headers, body)
        try:
            response = original_send(client, request, *args, **kwargs)
            content = response.read()
            _record_response(request_id, response.status_code, response.headers, content, decoded=True)
            return response
        except Exception as error:
            _record_error(request_id, error)
            raise

    async def async_send(client, request, *args, **kwargs):
        try:
            body = request.content
        except Exception:
            body = await request.aread()
        if _MODE == "replay":
            return replay(request, body)
        request_id = _record_request(request.method, str(request.url), request.headers, body)
        try:
            response = await original_async_send(client, request, *args, **kwargs)
            content = await response.aread()
            _record_response(request_id, response.status_code, response.headers, content, decoded=True)
            return response
        except Exception as error:
            _record_error(request_id, error)
            raise

    httpx.Client.send = send
    httpx.AsyncClient.send = async_send


def _patch_aiohttp():
    try:
        import aiohttp
        from multidict import CIMultiDict
        from yarl import URL
    except ImportError:
        return
    original_request = aiohttp.ClientSession._request

    class ReplayResponse:
        def __init__(self, method, url, request_headers, recorded):
            self.method = method
            self.url = URL(str(url))
            self.status = int(recorded.get("status", 0))
            self.reason = "Recorded response"
            self.headers = CIMultiDict(_decoded_headers(recorded.get("headers", {})))
            self._body = _response_bytes(recorded.get("body"))
            self.closed = False
            self.history = ()
            self.request_info = None
            if self.status == 0:
                raise RuntimeError(str(recorded.get("body", {}).get("error", "provider replay failed")))

        async def read(self):
            return self._body

        async def text(self, encoding=None, errors="strict"):
            return self._body.decode(encoding or "utf-8", errors=errors)

        async def json(self, encoding=None, loads=json.loads, content_type="application/json"):
            return loads(await self.text(encoding=encoding))

        def raise_for_status(self):
            if self.status >= 400:
                raise RuntimeError("Recorded HTTP status " + str(self.status))

        def release(self):
            self.closed = True

        def close(self):
            self.closed = True

        async def wait_for_close(self):
            self.closed = True

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc_value, traceback):
            self.release()

    async def request(session, method, str_or_url, **kwargs):
        headers = dict(session.headers)
        headers.update(dict(kwargs.get("headers") or {}))
        if "json" in kwargs:
            body = kwargs.get("json")
            headers.setdefault("content-type", "application/json")
        else:
            body = kwargs.get("data")
        if _MODE == "replay":
            fixture = _take_fixture(method, str(str_or_url), headers, body)
            return ReplayResponse(method, str_or_url, headers, fixture["response"])
        request_id = _record_request(method, str(str_or_url), headers, body)
        try:
            response = await original_request(session, method, str_or_url, **kwargs)
            content = await response.read()
            _record_response(request_id, response.status, response.headers, content, decoded=True)
            return response
        except Exception as error:
            _record_error(request_id, error)
            raise

    aiohttp.ClientSession._request = request


if _MODE in ("record", "replay") and _TRAFFIC_PATH:
    urllib.request.OpenerDirector.open = _urllib_open
    _patch_requests()
    _patch_httpx()
    _patch_aiohttp()
`;

let preparedPath: string | undefined;

export function providerHttpInstrumentationPythonPath(): string {
  if (preparedPath) return preparedPath;
  const digest = createHash("sha256")
    .update(PYTHON_SITE_CUSTOMIZE)
    .digest("hex")
    .slice(0, 16);
  const directory = join(tmpdir(), "clash-provider-http-python", digest);
  mkdirSync(directory, { recursive: true });
  try {
    writeFileSync(join(directory, "sitecustomize.py"), PYTHON_SITE_CUSTOMIZE, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  preparedPath = directory;
  return directory;
}
