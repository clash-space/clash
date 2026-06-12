import { createServer } from "node:http";
import net from "node:net";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appDir, "..", "..");
const dataDir = process.env.CLASH_LOCAL_API_E2E_DATA_DIR ?? path.join(repoRoot, ".tmp", "local-api-e2e-data");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details === undefined ? "" : `: ${JSON.stringify(details)}`}`);
  }
}

async function findFreePort(start) {
  for (let port = start; port < start + 100; port += 1) {
    const ok = await new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
    });
    if (ok) return port;
  }
  throw new Error(`No free port found from ${start}`);
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function startMockRemoteLoro() {
  const port = await findFreePort(49520);
  const requests = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (/^\/loro\/.+\/snapshot$/.test(url.pathname) && req.method === "GET") {
      requests.push({ kind: "loro", method: "GET", path: url.pathname, authorization: req.headers.authorization ?? "" });
      res.writeHead(404);
      res.end();
      return;
    }
    if (/^\/loro\/.+\/updates$/.test(url.pathname) && req.method === "POST") {
      const raw = await readRequestBody(req);
      requests.push({
        kind: "loro",
        method: "POST",
        path: url.pathname,
        bytes: raw.byteLength,
        authorization: req.headers.authorization ?? "",
      });
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function waitForValue(fn, label, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = fn();
    if (value) return value;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function jsonFetch(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  assert(res.ok, `HTTP ${res.status} for ${url}`, body);
  return body;
}

async function exerciseLocalSession(origin) {
  const runtimes = await jsonFetch(`${origin}/api/v1/runtimes`);
  assert(runtimes.runtimes?.[0]?.hostname === "Mock Desktop", "mock runtime is discoverable", runtimes);
  assert(runtimes.runtimes[0].agents.some((agent) => agent.id === "mock-acp"), "mock ACP agent is listed", runtimes);

  const created = await jsonFetch(`${origin}/api/v1/runtimes/desktop-local/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ crew_id: "director", project_id: "daemon-e2e-project", agent_id: "mock-acp" }),
  });
  assert(created.session_id, "local ACP session is created", created);

  const ws = new WebSocket(`${origin.replace("http:", "ws:")}/api/v1/local-sessions/${encodeURIComponent(created.session_id)}/_stream`);
  const events = [];
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Timed out waiting for local ACP session.complete"));
    }, 10000);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "prompt", turn_id: "daemon-smoke-turn", text: "hello daemon helper" }));
    });
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));
      events.push(msg);
      if (msg.type === "session.complete" && msg.turn_id === "daemon-smoke-turn") {
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      }
    });
    ws.addEventListener("error", reject);
  });

  assert(events.some((event) => event.type === "session.ready"), "session.ready received", events);
  assert(
    events.some((event) => event.type === "session.event" && event.event?.text === "Mock ACP reply: hello daemon helper"),
    "mock ACP text event received",
    events,
  );
  assert(
    events.some((event) => event.type === "session.event" && event.event?.sessionUpdate === "clash.canvas.patch"),
    "mock ACP canvas patch event received",
    events,
  );

  const history = await jsonFetch(`${origin}/api/v1/local-sessions/${encodeURIComponent(created.session_id)}/messages`);
  assert(
    history.messages?.some((message) =>
      message.sender_kind === "crew" &&
      message.events?.some((event) => event.type === "text" && event.text === "Mock ACP reply: hello daemon helper")
    ),
    "local session history persists mock ACP reply",
    history,
  );
  return { sessionId: created.session_id, events: events.map((event) => event.type) };
}

async function exerciseLoroSync(origin, mockRemote) {
  const sync = await jsonFetch(`${origin}/api/v1/local/sync`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "cloud-sync",
      remote_loro_url: mockRemote.url,
      remote_loro_token: "clsh_daemon_smoke_token",
    }),
  });
  assert(sync.mode === "cloud-sync", "cloud sync config is enabled", sync);

  const created = await jsonFetch(`${origin}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "daemon e2e project" }),
  });
  const projectId = created.id;
  assert(projectId, "project created", created);

  const ws = new WebSocket(`${origin.replace("http:", "ws:")}/sync/${encodeURIComponent(projectId)}`);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  await waitForValue(
    () => mockRemote.requests.find((req) => req.method === "GET" && req.path.includes(encodeURIComponent(projectId))),
    "remote Loro snapshot fetch",
  );

  const { LoroDoc } = await import("loro-crdt");
  const doc = new LoroDoc();
  doc.getMap("nodes").set("daemon-e2e-node", {
    type: "text",
    position: { x: 80, y: 120 },
    data: { label: "Daemon E2E Loro" },
  });
  ws.send(doc.export({ mode: "snapshot" }));
  const update = await waitForValue(
    () => mockRemote.requests.find((req) =>
      req.method === "POST" &&
      req.path.includes(encodeURIComponent(projectId)) &&
      req.bytes > 0
    ),
    "remote Loro update append",
  );
  ws.close();
  return { projectId, updateBytes: update.bytes, authorization: update.authorization };
}

async function exerciseFalMock(origin) {
  async function submitAndComplete(modelId, input) {
    const submitted = await jsonFetch(`${origin}/fal/${modelId}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Key mock" },
      body: JSON.stringify(input),
    });
    assert(submitted.request_id?.startsWith("fal-mock-"), "fal request id has mock prefix", submitted);

    let status;
    for (let i = 0; i < 4; i += 1) {
      status = await jsonFetch(`${submitted.status_url}?logs=1`);
      if (status.status === "COMPLETED") break;
    }
    assert(status?.status === "COMPLETED", "fal request completes", status);
    return jsonFetch(submitted.response_url);
  }

  const image = await submitAndComplete("fal-ai/flux/dev", {
    prompt: "daemon e2e image",
    aspect_ratio: "16:9",
    output_type: "image",
  });
  assert(image.images?.[0]?.width === 1024 && image.images[0].height === 576, "image keeps 16:9 dimensions", image);
  assert(image.prompt === "daemon e2e image", "image keeps prompt", image);

  const video = await submitAndComplete("fal-ai/seedance-2/text-to-video", {
    prompt: "daemon e2e video",
    aspect_ratio: "9:16",
    duration: 3,
    output_type: "video",
  });
  assert(video.video?.width === 720 && video.video.height === 1280, "video keeps 9:16 dimensions", video);
  assert(video.video.duration === 3 && video.prompt === "daemon e2e video", "video keeps duration and prompt", video);

  const audio = await submitAndComplete("fal-ai/minimax/speech-02-hd", {
    prompt: "daemon e2e audio",
    duration: 4,
    output_type: "audio",
  });
  assert(audio.audio?.duration === 4, "audio keeps duration", audio);
  assert(audio.transcript === "daemon e2e audio" && audio.waveform?.length === 128, "audio keeps transcript and waveform", audio);

  return {
    image: image.images[0],
    video: video.video,
    audio: { duration: audio.audio.duration, waveform: audio.waveform.length },
  };
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function main() {
  process.env.CLASH_LOCAL_ACP_MOCK = "1";
  await rm(dataDir, { recursive: true, force: true });

  const port = await findFreePort(49500);
  const origin = `http://127.0.0.1:${port}`;
  const mockRemote = await startMockRemoteLoro();
  const { startLocalApiServer } = await import("../dist/server.js");
  const server = await startLocalApiServer({ port, dataDir });

  try {
    const runtime = await exerciseLocalSession(origin);
    const loro = await exerciseLoroSync(origin, mockRemote);
    const fal = await exerciseFalMock(origin);
    console.log("[daemon-smoke] runtime", JSON.stringify(runtime));
    console.log("[daemon-smoke] loro", JSON.stringify(loro));
    console.log("[daemon-smoke] fal", JSON.stringify(fal));
  } finally {
    await closeServer(server);
    await mockRemote.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
