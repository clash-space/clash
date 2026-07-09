import { spawn } from "node:child_process";
import { createServer } from "node:http";
import net from "node:net";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const appDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appDir, "..", "..");
const dataDir = process.env.CLASH_LOCAL_API_E2E_DATA_DIR ?? path.join(repoRoot, ".tmp", "local-api-e2e-data");
const cliTimeoutMs = Number(process.env.CLASH_CLI_E2E_TIMEOUT_MS ?? "45000");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details === undefined ? "" : `: ${JSON.stringify(details)}`}`);
  }
}

function requestBodyText(request) {
  return JSON.stringify(request?.body ?? {});
}

async function findFreePort(start) {
  const failures = [];
  for (let port = start; port < start + 100; port += 1) {
    const ok = await new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", (error) => {
        failures.push(`${port}:${error.code ?? error.message}`);
        resolve(false);
      });
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
    });
    if (ok) return port;
  }
  throw new Error(`No free port found from ${start}. Last bind errors: ${failures.slice(-5).join(", ")}`);
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function exactArrayBuffer(view) {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
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

async function startMockOpenAiImages() {
  const port = await findFreePort(49540);
  const requests = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname === "/v1/images/generations" && req.method === "POST") {
      const raw = await readRequestBody(req);
      const body = raw.byteLength ? JSON.parse(raw.toString("utf8")) : {};
      requests.push({
        method: "POST",
        path: url.pathname,
        authorization: req.headers.authorization ?? "",
        body,
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "img-daemon-smoke",
        data: [{ b64_json: Buffer.from("daemon-openai-image").toString("base64") }],
      }));
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

async function startMockCodexResponses() {
  const port = await findFreePort(49680);
  const requests = [];

  function responseEvent(event, data) {
    return `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname === "/v1/models" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        object: "list",
        data: [
          { id: "gpt-5.5", object: "model", created: 0, owned_by: "stub" },
          { id: "gpt-5.4-mini", object: "model", created: 0, owned_by: "stub" },
        ],
      }));
      return;
    }
    if (url.pathname === "/v1/responses" && req.method === "POST") {
      const raw = await readRequestBody(req);
      const body = raw.byteLength ? JSON.parse(raw.toString("utf8")) : {};
      requests.push({
        method: "POST",
        path: url.pathname,
        authorization: req.headers.authorization ?? "",
        accept: req.headers.accept ?? "",
        body,
      });

      const response = {
        id: "resp_daemon_stub_1",
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        status: "completed",
        model: body.model || "gpt-5.5",
        output: [
          {
            id: "msg_daemon_stub_1",
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", annotations: [], text: "stub ok" }],
          },
        ],
        usage: {
          input_tokens: 1,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 2,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 3,
        },
      };
      const item = response.output[0];
      const part = item.content[0];
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(responseEvent("response.created", { response: { ...response, status: "in_progress", output: [] } }));
      res.write(responseEvent("response.in_progress", { response: { ...response, status: "in_progress", output: [] } }));
      res.write(responseEvent("response.output_item.added", { output_index: 0, item: { ...item, content: [] } }));
      res.write(responseEvent("response.content_part.added", { output_index: 0, content_index: 0, part: { ...part, text: "" } }));
      res.write(responseEvent("response.output_text.delta", {
        output_index: 0,
        content_index: 0,
        item_id: item.id,
        delta: "stub ok",
      }));
      res.write(responseEvent("response.output_text.done", {
        output_index: 0,
        content_index: 0,
        item_id: item.id,
        text: "stub ok",
      }));
      res.write(responseEvent("response.content_part.done", {
        output_index: 0,
        content_index: 0,
        part,
      }));
      res.write(responseEvent("response.output_item.done", { output_index: 0, item }));
      res.write(responseEvent("response.completed", { response }));
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
    const value = await fn();
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
    body: JSON.stringify({ agent_template_id: "master-clash", project_id: "daemon-e2e-project", agent_id: "mock-acp" }),
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

  await waitForValue(
    async () => {
      const history = await jsonFetch(`${origin}/api/v1/local-sessions/${encodeURIComponent(created.session_id)}/messages`);
      return history.messages?.some((message) =>
        message.sender_kind === "agent" &&
        message.events?.some((event) => event.type === "text" && event.text === "Mock ACP reply: hello daemon helper")
      )
        ? history
        : null;
    },
    "local session history persists mock ACP reply",
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

  const created = await jsonFetch(`${origin}/api/v1/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "daemon e2e project" }),
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
  ws.send(exactArrayBuffer(doc.export({ mode: "snapshot" })));
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

async function runClashCli(args, env) {
  const child = spawn("clash", args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
      CLASH_NODE_EXEC_PATH: process.execPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const code = await new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, cliTimeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (exitCode, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`clash ${args.join(" ")} timed out after ${cliTimeoutMs}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      } else if (signal) {
        reject(new Error(`clash ${args.join(" ")} terminated by ${signal}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }
      else resolve(exitCode ?? 1);
    });
  });
  if (code !== 0) {
    throw new Error(`clash ${args.join(" ")} exited ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  return stdout.trim();
}

async function exerciseAgentCliShim(origin, createLocalAgentToolEnv) {
  const env = createLocalAgentToolEnv({
    dataDir,
    apiBaseUrl: origin,
    env: process.env,
  });
  const created = JSON.parse(await runClashCli([
    "projects",
    "create",
    "--name",
    "daemon agent cli project",
    "--json",
  ], env));
  assert(created.id, "agent CLI project create returns an id", created);

  const observer = new WebSocket(`${origin.replace("http:", "ws:")}/sync/${encodeURIComponent(created.id)}`);
  const presenceMessages = [];
  observer.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    const msg = JSON.parse(String(event.data));
    if (msg.type === "presence") presenceMessages.push(msg);
  });
  await new Promise((resolve, reject) => {
    observer.addEventListener("open", resolve, { once: true });
    observer.addEventListener("error", reject, { once: true });
  });

  const agentEnv = {
    ...env,
    CLASH_AGENT_MEMBER_ID: "local-master-clash",
    CLASH_PROJECT_ID: created.id,
  };

  try {
    const added = JSON.parse(await runClashCli([
      "canvas",
      "add",
      "--project",
      created.id,
      "--type",
      "text",
      "--label",
      "Agent CLI Note",
      "--content",
      "created through the local agent CLI shim",
      "--json",
    ], agentEnv));
    assert(added.node_id, "agent CLI canvas add returns a node id", added);
    await waitForValue(
      () => presenceMessages.some((msg) =>
        msg.clients?.some((client) =>
          client.clientType === "agent" &&
          client.userId === "local-user" &&
          client.name === "local-master-clash"
        )
      ),
      "agent CLI presence as local user surrogate",
    );

    const listed = JSON.parse(await runClashCli([
      "canvas",
      "list",
      "--project",
      created.id,
      "--json",
    ], env));
    const node = listed.find((candidate) => candidate.id === added.node_id);
    assert(node, "agent CLI canvas list can read the node it created", { added, listed });
    assert(node.data?.actorType === "agent", "agent CLI-created node is attributed to an agent", node);
    assert(node.data?.actorUserId === "local-user", "CLI-created node resolves the local user id", node);
    assert(node.data?.actorAgentId === "local-master-clash", "agent CLI-created node keeps the agent member id", node);
    return {
      projectId: created.id,
      nodeId: added.node_id,
      actorType: node.data.actorType,
      actorUserId: node.data.actorUserId,
      actorAgentId: node.data.actorAgentId,
    };
  } finally {
    observer.close();
  }
}

async function exerciseLocalVarsDisabled(origin) {
  const list = await fetch(`${origin}/api/v1/vars`);
  const put = await fetch(`${origin}/api/v1/vars/FAL_API_KEY`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "fal-daemon-smoke-key" }),
  });
  assert(list.status === 404, "local vars list endpoint is not exposed", { status: list.status });
  assert(put.status === 404, "local vars write endpoint is not exposed", { status: put.status });
  return { listStatus: list.status, writeStatus: put.status };
}

async function exerciseCliModelProviders(origin, createLocalAgentToolEnv) {
  const env = createLocalAgentToolEnv({
    dataDir,
    apiBaseUrl: origin,
    env: process.env,
  });

  const seeded = await jsonFetch(`${origin}/api/v1/model-providers`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      providers: [
        { providerId: "fal", enabled: true, weight: 10, credentials: { apiKey: "fal-model-provider-smoke-key" } },
      ],
    }),
  });
  assert(
    seeded.providers?.some((provider) => provider.providerId === "fal" && provider.configuredCredentials?.includes("apiKey")),
    "local provider account API stores fal credentials",
    seeded,
  );

  const configured = JSON.parse(await runClashCli([
    "models",
    "provider",
    "set",
    "fal",
    "--weight",
    "75",
    "--json",
  ], env));
  const falProvider = configured.find((provider) => provider.providerId === "fal" && provider.upstreamId === "fal");
  assert(falProvider?.weight === 75, "agent CLI model provider set stores fal weight", configured);

  const providersEnvelope = JSON.parse(await runClashCli([
    "models",
    "providers",
    "--json",
  ], env));
  const providers = providersEnvelope.providers;
  assert(Array.isArray(providers), "agent CLI model providers returns a providers array", providersEnvelope);
  assert(typeof providersEnvelope.readToken === "string" && providersEnvelope.readToken.length > 0, "agent CLI model providers returns a read token", providersEnvelope);
  assert(
    providers.some((provider) => provider.providerId === "fal" && provider.configuredCredentials?.includes("apiKey")),
    "agent CLI model providers lists configured fal credentials",
    providersEnvelope,
  );

  const available = JSON.parse(await runClashCli([
    "models",
    "catalog",
    "--tier",
    "available",
    "--json",
  ], env));
  assert(
    available.some((entry) => entry.model?.id === "nano-banana-2" && entry.selectedRoute?.providerId === "fal"),
    "agent CLI model catalog lists fal-routed available models",
    available,
  );

  return { provider: "fal", weight: falProvider.weight, available: available.length };
}

async function exerciseOpenAiProviderGeneration(origin, mockOpenAi) {
  const configured = await jsonFetch(`${origin}/api/v1/model-providers`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      providers: [
        {
          providerId: "official",
          upstreamId: "openai",
          region: "global",
          enabled: true,
          weight: 100,
          credentials: { apiKey: "sk-daemon-openai" },
        },
      ],
    }),
  });
  assert(
    configured.providers?.some((provider) =>
      provider.providerId === "official" &&
      provider.upstreamId === "openai" &&
      provider.configuredCredentials?.includes("apiKey")
    ),
    "local provider account API stores OPENAI_API_KEY",
    configured,
  );

  const created = await jsonFetch(`${origin}/api/v1/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "daemon provider e2e project" }),
  });
  const projectId = created.id;
  assert(projectId, "provider e2e project created", created);

  const ws = new WebSocket(`${origin.replace("http:", "ws:")}/sync/${encodeURIComponent(projectId)}`);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for sync room handshake")), 5000);
    ws.addEventListener("message", () => {
      clearTimeout(timeout);
      resolve(true);
    }, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  try {
    const { LoroDoc } = await import("loro-crdt");
    const nodeId = "openai-provider-e2e-node";
    const doc = new LoroDoc();
    doc.getMap("nodes").set(nodeId, {
      type: "image",
      position: { x: 80, y: 120 },
      data: {
        label: "OpenAI Provider E2E",
        prompt: "daemon openai provider image",
        actionType: "image-gen",
        modelId: "gpt-image-2",
        model: "gpt-image-2",
        modelParams: { size: "1024x1024", output_format: "png", count: 1 },
        status: "pending",
      },
    });
    ws.send(exactArrayBuffer(doc.export({ mode: "snapshot" })));

    const assetId = "local-asset-local-gen-openai-provider-e2e-node";
    const asset = await waitForValue(async () => {
      const res = await fetch(`${origin}/api/v1/assets/${encodeURIComponent(assetId)}`);
      if (!res.ok) return null;
      return res.json();
    }, "OpenAI provider generated asset", 15000);

    assert(asset.metadata?.provider === "openai", "generated asset records the OpenAI provider", asset);
    assert(asset.metadata?.modelEndpoint === "gpt-image-2", "generated asset records the OpenAI model endpoint", asset);
    assert(asset.sourceModel === "gpt-image-2", "generated asset keeps the selected model", asset);

    const request = mockOpenAi.requests.find((item) => item.path === "/v1/images/generations");
    assert(request, "local OpenAI endpoint receives the generation request", mockOpenAi.requests);
    assert(request.authorization === "Bearer sk-daemon-openai", "OpenAI request uses the locally stored key", request);
    assert(request.body?.model === "gpt-image-2", "OpenAI request uses the routed provider model", request);
    assert(request.body?.prompt === "daemon openai provider image", "OpenAI request keeps the node prompt", request);

    return {
      projectId,
      assetId,
      provider: asset.metadata.provider,
      modelEndpoint: asset.metadata.modelEndpoint,
    };
  } finally {
    ws.close();
  }
}

async function writeFakeCodexAcp(binDir) {
  await mkdir(binDir, { recursive: true });
  const wrapper = path.join(binDir, "codex-acp");
  const agent = path.join(binDir, "fake-codex-acp.mjs");
  const sdkUrl = pathToFileURL(require.resolve("@agentclientprotocol/sdk", {
    paths: [path.join(repoRoot, "packages", "clash-bridge")],
  })).href;
  await writeFile(
    wrapper,
    [
      "#!/bin/sh",
      "DIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)",
      "exec node \"$DIR/fake-codex-acp.mjs\" \"$@\"",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  await writeFile(
    agent,
    [
      "#!/usr/bin/env node",
      "import { spawn } from 'node:child_process';",
      "import { randomUUID } from 'node:crypto';",
      "import { Readable, Writable } from 'node:stream';",
      `import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from ${JSON.stringify(sdkUrl)};`,
      "",
      "const argv = process.argv.slice(2);",
      "if (argv.includes('--help')) {",
      "  console.log('Usage: codex-acp [OPTIONS]');",
      "  process.exit(0);",
      "}",
      "",
      "function runClash(args) {",
      "  return new Promise((resolve, reject) => {",
      "    const child = spawn('clash', args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });",
      "    let stdout = '';",
      "    let stderr = '';",
      "    child.stdout.setEncoding('utf8');",
      "    child.stderr.setEncoding('utf8');",
      "    child.stdout.on('data', (chunk) => { stdout += chunk; });",
      "    child.stderr.on('data', (chunk) => { stderr += chunk; });",
      "    child.once('error', reject);",
      "    child.once('exit', (code, signal) => {",
      "      if (code === 0) resolve(stdout.trim());",
      "      else reject(new Error('clash ' + args.join(' ') + ' exited ' + (signal || code) + '\\nstdout:\\n' + stdout + '\\nstderr:\\n' + stderr));",
      "    });",
      "  });",
      "}",
      "",
      "function configOptions(state = {}) {",
      "  return [",
      "    {",
      "      id: 'mode',",
      "      name: 'Mode',",
      "      type: 'select',",
      "      category: 'mode',",
      "      currentValue: state.mode || 'full-access',",
      "      options: [",
      "        { value: 'read-only', name: 'Read only' },",
      "        { value: 'auto', name: 'Auto' },",
      "        { value: 'full-access', name: 'Full access' },",
      "      ],",
      "    },",
      "    {",
      "      id: 'model',",
      "      name: 'Model',",
      "      type: 'select',",
      "      category: 'model',",
      "      currentValue: state.model || 'gpt-5.5',",
      "      options: [",
      "        { value: 'gpt-5.5', name: 'GPT-5.5', description: 'Codex conversational model' },",
      "        { value: 'gpt-5.4', name: 'GPT-5.4', description: 'Codex compatibility profile' },",
      "      ],",
      "    },",
      "    {",
      "      id: 'reasoning_effort',",
      "      name: 'Reasoning',",
      "      type: 'select',",
      "      category: 'thought_level',",
      "      currentValue: state.reasoning_effort || 'low',",
      "      options: [",
      "        { value: 'low', name: 'Low' },",
      "        { value: 'medium', name: 'Medium' },",
      "        { value: 'high', name: 'High' },",
      "        { value: 'xhigh', name: 'Extra High' },",
      "      ],",
      "    },",
      "  ];",
      "}",
      "",
      "class FakeCodexAcpAgent {",
      "  constructor(connection) {",
      "    this.connection = connection;",
      "    this.sessions = new Map();",
      "  }",
      "  async initialize() {",
      "    return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: { loadSession: false, promptCapabilities: {} } };",
      "  }",
      "  async newSession(params) {",
      "    const sessionId = randomUUID();",
      "    const state = { cwd: params.cwd || process.cwd(), mode: 'full-access', model: 'gpt-5.5', reasoning_effort: 'low' };",
      "    this.sessions.set(sessionId, state);",
      "    return { sessionId, configOptions: configOptions(state) };",
      "  }",
      "  async authenticate() { return {}; }",
      "  async setSessionConfigOption(params) {",
      "    const state = this.sessions.get(params.sessionId);",
      "    if (!state) throw new Error('unknown session ' + params.sessionId);",
      "    state[params.configId] = params.value;",
      "    return { configOptions: configOptions(state) };",
      "  }",
      "  async prompt(params) {",
      "    if (!this.sessions.has(params.sessionId)) throw new Error('unknown session ' + params.sessionId);",
      "    await this.connection.sessionUpdate({",
      "      sessionId: params.sessionId,",
      "      update: {",
      "        sessionUpdate: 'agent_thought_chunk',",
      "        content: { type: 'text', text: 'Checking the canvas before editing.' },",
      "        messageId: 'local-api-fake-thought',",
      "      },",
      "    });",
      "    await this.connection.sessionUpdate({",
      "      sessionId: params.sessionId,",
      "      update: {",
      "        sessionUpdate: 'tool_call',",
      "        toolCallId: 'local-api-fake-clash-cli',",
      "        title: 'Run clash canvas add',",
      "        kind: 'execute',",
      "        status: 'in_progress',",
      "        rawInput: { command: 'clash canvas add' },",
      "      },",
      "    });",
      "    const projectId = process.env.CLASH_PROJECT_ID;",
      "    if (!projectId) throw new Error('CLASH_PROJECT_ID missing');",
      "    const created = JSON.parse(await runClash([",
      "      'canvas', 'add',",
      "      '--project', projectId,",
      "      '--type', 'text',",
      "      '--label', 'Fake ACP CLI Note',",
      "      '--content', 'created by fake ACP child through clash CLI',",
      "      '--json',",
      "    ]));",
      "    await this.connection.sessionUpdate({",
      "      sessionId: params.sessionId,",
      "      update: {",
      "        sessionUpdate: 'agent_message_chunk',",
      "        content: { type: 'text', text: 'Fake ACP wrote node ' + created.node_id },",
      "      },",
      "    });",
      "    await this.connection.sessionUpdate({",
      "      sessionId: params.sessionId,",
      "      update: {",
      "        sessionUpdate: 'tool_call_update',",
      "        toolCallId: 'local-api-fake-clash-cli',",
      "        status: 'completed',",
      "        rawOutput: created,",
      "      },",
      "    });",
      "    return { stopReason: 'end_turn' };",
      "  }",
      "  async cancel() {}",
      "}",
      "",
      "const input = Writable.toWeb(process.stdout);",
      "const output = Readable.toWeb(process.stdin);",
      "new AgentSideConnection((connection) => new FakeCodexAcpAgent(connection), ndJsonStream(input, output));",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return wrapper;
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function writeCodexStubConfig(home, mockCodex) {
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(home, "config.toml"),
    [
      'model = "gpt-5.5"',
      'model_provider = "stub-openai"',
      'approval_policy = "never"',
      'sandbox_mode = "danger-full-access"',
      'model_reasoning_effort = "low"',
      "",
      "[model_providers.stub-openai]",
      'name = "Stub OpenAI"',
      `base_url = "${mockCodex.url}/v1"`,
      'env_key = "OPENAI_API_KEY"',
      'wire_api = "responses"',
      "supports_websockets = false",
      "",
    ].join("\n"),
    "utf8",
  );
}

function hasConfigOption(options, category) {
  return Array.isArray(options) && options.some((option) => option?.category === category);
}

async function exerciseFakeCodexAcpChildSession(startLocalApiServer, createLocalAgentToolEnv) {
  const fakeDataDir = path.join(repoRoot, ".tmp", "local-api-fake-acp-e2e-data");
  const fakeHome = path.join(repoRoot, ".tmp", "local-api-fake-acp-home");
  const fakeBinDir = path.join(repoRoot, ".tmp", "local-api-fake-acp-bin");
  await rm(fakeDataDir, { recursive: true, force: true });
  await rm(fakeHome, { recursive: true, force: true });
  await rm(fakeBinDir, { recursive: true, force: true });
  await mkdir(fakeHome, { recursive: true });
  await writeFakeCodexAcp(fakeBinDir);

  const envSnapshot = {
    CLASH_ACP_TEST_BIN_DIR: process.env.CLASH_ACP_TEST_BIN_DIR,
    CLASH_ACP_BIN_DIR: process.env.CLASH_ACP_BIN_DIR,
    CLASH_E2E_STUB_ACP: process.env.CLASH_E2E_STUB_ACP,
    CLASH_LOCAL_DATA_DIR: process.env.CLASH_LOCAL_DATA_DIR,
    CLASH_NODE_EXEC_PATH: process.env.CLASH_NODE_EXEC_PATH,
    HOME: process.env.HOME,
  };
  const port = await findFreePort(49620);
  const origin = `http://127.0.0.1:${port}`;

  delete process.env.CLASH_ACP_TEST_BIN_DIR;
  process.env.CLASH_ACP_BIN_DIR = fakeBinDir;
  delete process.env.CLASH_E2E_STUB_ACP;
  process.env.CLASH_LOCAL_DATA_DIR = fakeDataDir;
  process.env.CLASH_NODE_EXEC_PATH = process.execPath;
  process.env.HOME = fakeHome;

  let server;
  try {
    server = await startLocalApiServer({ port, dataDir: fakeDataDir });
    const env = createLocalAgentToolEnv({
      dataDir: fakeDataDir,
      apiBaseUrl: origin,
      env: process.env,
    });
    const project = JSON.parse(await runClashCli([
      "projects",
      "create",
      "--name",
      "fake acp agent project",
      "--json",
    ], env));
    assert(project.id, "fake ACP project create returns an id", project);

    const runtimes = await jsonFetch(`${origin}/api/v1/runtimes`);
    assert(
      runtimes.runtimes?.[0]?.agents?.some((agent) => agent.id === "codex-acp"),
      "fake Zed Codex ACP child is discovered as codex-acp",
      runtimes,
    );

    const session = await jsonFetch(`${origin}/api/v1/runtimes/desktop-local/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_member_id: "local-master-clash",
        project_id: project.id,
        agent_id: "codex-acp",
      }),
    });
    assert(session.session_id, "fake ACP session is created", session);

    const ws = new WebSocket(`${origin.replace("http:", "ws:")}/api/v1/local-sessions/${encodeURIComponent(session.session_id)}/_stream`);
    const events = [];
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error(`Timed out waiting for fake ACP session disposal: ${JSON.stringify(events.slice(-8))}`));
      }, 20000);
      let promptSent = false;
      ws.addEventListener("message", (event) => {
        const msg = JSON.parse(String(event.data));
        events.push(msg);
        if (msg.type === "session.error") {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(`fake ACP session error: ${msg.message}`));
          return;
        }
        if (msg.type === "session.ready") {
          const options = msg.config_options || [];
          if (!options.some((option) => option.category === "model")) {
            clearTimeout(timeout);
            ws.close();
            reject(new Error(`session.ready did not include ACP model config option: ${JSON.stringify(msg)}`));
            return;
          }
          if (!options.some((option) => option.category === "thought_level")) {
            clearTimeout(timeout);
            ws.close();
            reject(new Error(`session.ready did not include ACP thought_level config option: ${JSON.stringify(msg)}`));
            return;
          }
          ws.send(JSON.stringify({ type: "set_config_option", config_id: "model", value: "gpt-5.4" }));
          return;
        }
        if (
          msg.type === "session.config_options" &&
          msg.config_options?.some((option) => option.id === "model" && option.currentValue === "gpt-5.4") &&
          !promptSent
        ) {
          promptSent = true;
          ws.send(JSON.stringify({ type: "prompt", turn_id: "fake-acp-turn", text: "use clash cli on the canvas" }));
          return;
        }
        if (msg.type === "session.complete" && msg.turn_id === "fake-acp-turn") {
          ws.send(JSON.stringify({ type: "dispose" }));
          return;
        }
        if (msg.type === "session.disposed" && msg.session_id === session.session_id) {
          clearTimeout(timeout);
          ws.close();
          resolve(true);
        }
      });
      ws.addEventListener("error", reject);
    });

    assert(
      events.some((event) =>
        event.type === "session.event" &&
        event.event?.content?.text?.startsWith("Fake ACP wrote node ")
      ),
      "fake ACP child emits a text event after invoking clash CLI",
      events,
    );
    assert(
      events.some((event) =>
        event.type === "session.event" &&
        event.event?.sessionUpdate === "tool_call" &&
        event.event?.toolCallId === "local-api-fake-clash-cli"
      ),
      "fake ACP child emits a tool_call event",
      events,
    );

    const nodes = JSON.parse(await runClashCli([
      "canvas",
      "list",
      "--project",
      project.id,
      "--json",
    ], env));
    const node = nodes.find((candidate) => candidate.data?.label === "Fake ACP CLI Note");
    assert(node, "fake ACP child created a canvas node through clash CLI", nodes);
    assert(node.data?.actorType === "agent", "fake ACP CLI node is attributed to an agent", node);
    assert(node.data?.actorUserId === "local-user", "fake ACP CLI node is attributed to the local user", node);
    assert(node.data?.actorAgentId === "local-master-clash", "fake ACP CLI node keeps the agent member id", node);

    return {
      sessionId: session.session_id,
      projectId: project.id,
      nodeId: node.id,
      actorType: node.data.actorType,
      actorUserId: node.data.actorUserId,
      actorAgentId: node.data.actorAgentId,
    };
  } finally {
    if (server) await closeServer(server);
    restoreEnv(envSnapshot);
  }
}

async function exerciseOfficialCodexAcpWithStubModel(startLocalApiServer, createLocalAgentToolEnv) {
  const realDataDir = path.join(repoRoot, ".tmp", "local-api-official-codex-acp-e2e-data");
  const codexHome = path.join(repoRoot, ".tmp", "local-api-official-codex-acp-home");
  const tapPath = path.join(repoRoot, ".tmp", "local-api-official-codex-acp-events.jsonl");
  await rm(realDataDir, { recursive: true, force: true });
  await rm(codexHome, { recursive: true, force: true });
  await rm(tapPath, { force: true });

  const mockCodex = await startMockCodexResponses();
  await writeCodexStubConfig(codexHome, mockCodex);

  const envSnapshot = {
    CLASH_ACP_TEST_BIN_DIR: process.env.CLASH_ACP_TEST_BIN_DIR,
    CLASH_ACP_BIN_DIR: process.env.CLASH_ACP_BIN_DIR,
    CLASH_E2E_STUB_ACP: process.env.CLASH_E2E_STUB_ACP,
    CLASH_LOCAL_DATA_DIR: process.env.CLASH_LOCAL_DATA_DIR,
    CLASH_NODE_EXEC_PATH: process.env.CLASH_NODE_EXEC_PATH,
    CLASH_ACP_TAP: process.env.CLASH_ACP_TAP,
    CODEX_HOME: process.env.CODEX_HOME,
    CODEX_API_KEY: process.env.CODEX_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    HOME: process.env.HOME,
  };
  const port = await findFreePort(49720);
  const origin = `http://127.0.0.1:${port}`;

  process.env.CLASH_ACP_TEST_BIN_DIR = path.join(repoRoot, "packages", "clash-bridge", "node_modules", ".bin");
  delete process.env.CLASH_ACP_BIN_DIR;
  delete process.env.CLASH_E2E_STUB_ACP;
  process.env.CLASH_LOCAL_DATA_DIR = realDataDir;
  process.env.CLASH_NODE_EXEC_PATH = process.execPath;
  process.env.CLASH_ACP_TAP = tapPath;
  process.env.CODEX_HOME = codexHome;
  process.env.HOME = codexHome;
  process.env.OPENAI_API_KEY = "sk-daemon-codex-stub";
  delete process.env.CODEX_API_KEY;

  let server;
  try {
    server = await startLocalApiServer({ port, dataDir: realDataDir });
    const env = createLocalAgentToolEnv({
      dataDir: realDataDir,
      apiBaseUrl: origin,
      env: process.env,
    });
    const project = JSON.parse(await runClashCli([
      "projects",
      "create",
      "--name",
      "official codex acp project",
      "--json",
    ], env));
    assert(project.id, "official codex ACP project create returns an id", project);

    const runtimes = await jsonFetch(`${origin}/api/v1/runtimes`);
    assert(
      runtimes.runtimes?.[0]?.agents?.some((agent) => agent.id === "codex-acp"),
      "official Zed Codex ACP is discovered as codex-acp",
      runtimes,
    );

    const session = await jsonFetch(`${origin}/api/v1/runtimes/desktop-local/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_member_id: "local-master-clash",
        project_id: project.id,
        agent_id: "codex-acp",
      }),
    });
    assert(session.session_id, "official codex ACP session is created", session);

    const ws = new WebSocket(`${origin.replace("http:", "ws:")}/api/v1/local-sessions/${encodeURIComponent(session.session_id)}/_stream`);
    const events = [];
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error(`Timed out waiting for official codex ACP session disposal: ${JSON.stringify(events.slice(-8))}`));
      }, 30000);
      let promptSent = false;
      ws.addEventListener("message", (event) => {
        const msg = JSON.parse(String(event.data));
        events.push(msg);
        if (msg.type === "session.error") {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(`official codex ACP session error: ${msg.message}`));
          return;
        }
        if (msg.type === "session.ready") {
          const options = msg.config_options || [];
          if (!hasConfigOption(options, "model")) {
            clearTimeout(timeout);
            ws.close();
            reject(new Error(`session.ready did not include ACP model config option: ${JSON.stringify(msg)}`));
            return;
          }
          if (!hasConfigOption(options, "thought_level")) {
            clearTimeout(timeout);
            ws.close();
            reject(new Error(`session.ready did not include ACP thought_level config option: ${JSON.stringify(msg)}`));
            return;
          }
          ws.send(JSON.stringify({ type: "set_config_option", config_id: "model", value: "gpt-5.4-mini" }));
          return;
        }
        if (
          msg.type === "session.config_options" &&
          msg.config_options?.some((option) => option.id === "model" && option.currentValue === "gpt-5.4-mini") &&
          !promptSent
        ) {
          promptSent = true;
          ws.send(JSON.stringify({
            type: "prompt",
            turn_id: "official-codex-acp-turn",
            text: "Say exactly stub ok.",
          }));
          return;
        }
        if (msg.type === "session.complete" && msg.turn_id === "official-codex-acp-turn") {
          ws.send(JSON.stringify({ type: "dispose" }));
          return;
        }
        if (msg.type === "session.disposed" && msg.session_id === session.session_id) {
          clearTimeout(timeout);
          ws.close();
          resolve(true);
        }
      });
      ws.addEventListener("error", reject);
    });

    assert(
      events.some((event) =>
        event.type === "session.event" &&
        event.event?.sessionUpdate === "agent_message_chunk" &&
        event.event?.content?.text === "stub ok"
      ),
      "official codex ACP emits assistant text from the stub model",
      events,
    );
    assert(
      events.some((event) =>
        event.type === "session.event" &&
        event.event?.sessionUpdate === "usage_update"
      ),
      "official codex ACP emits usage updates",
      events,
    );
    const request = mockCodex.requests.find((item) => item.path === "/v1/responses");
    assert(request, "official codex ACP called the stub Responses API", mockCodex.requests);
    assert(request.authorization === "Bearer sk-daemon-codex-stub", "official codex ACP used the stub API key", request);
    assert(request.accept.includes("text/event-stream"), "official codex ACP requested Responses SSE", request);
    assert(request.body?.stream === true, "official codex ACP enabled response streaming", request.body);
    assert(request.body?.model === "gpt-5.4-mini", "official codex ACP honored ACP model config", request.body);
    assert(Array.isArray(request.body?.tools) && request.body.tools.length > 0, "official codex ACP exposed tool schemas to the model", request.body);
    const requestText = requestBodyText(request);
    assert(
      requestText.includes("# Clash agent contract (read first)"),
      "official codex ACP request includes the Clash prompt contract",
    );
    assert(
      requestText.includes("Master Clash"),
      "official codex ACP request includes the single Master Clash identity",
    );
    assert(
      requestText.includes(`CLASH_PROJECT_ID=${project.id}`),
      "official codex ACP request includes the active Clash project id",
    );
    assert(
      requestText.includes("# User request") && requestText.includes("Say exactly stub ok."),
      "official codex ACP request preserves the user request after the Clash contract",
    );
    assert(
      !requestText.includes("No AGENTS.md was found"),
      "official codex ACP request used fallback guidance instead of installed AGENTS.md",
    );

    return {
      sessionId: session.session_id,
      projectId: project.id,
      model: request.body.model,
      toolCount: request.body.tools.length,
      requestCount: mockCodex.requests.length,
      promptContract: "clash-contract-present",
      eventTypes: events
        .filter((event) => event.type === "session.event")
        .map((event) => event.event?.sessionUpdate ?? event.event?.type ?? "unknown"),
    };
  } finally {
    if (server) await closeServer(server);
    await mockCodex.close();
    restoreEnv(envSnapshot);
  }
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function main() {
  const envSnapshot = {
    CLASH_E2E_STUB_ACP: process.env.CLASH_E2E_STUB_ACP,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  };
  process.env.CLASH_E2E_STUB_ACP = "1";
  await rm(dataDir, { recursive: true, force: true });

  const port = await findFreePort(49500);
  const origin = `http://127.0.0.1:${port}`;
  const mockRemote = await startMockRemoteLoro();
  const mockOpenAi = await startMockOpenAiImages();
  process.env.OPENAI_BASE_URL = `${mockOpenAi.url}/v1`;
  const { createLocalAgentToolEnv, startLocalApiServer } = await import("../dist/server.js");
  const server = await startLocalApiServer({ port, dataDir });

  try {
    const runtime = await exerciseLocalSession(origin);
    const localVars = await exerciseLocalVarsDisabled(origin);
    const modelProviders = await exerciseCliModelProviders(origin, createLocalAgentToolEnv);
    const openai = await exerciseOpenAiProviderGeneration(origin, mockOpenAi);
    const cli = await exerciseAgentCliShim(origin, createLocalAgentToolEnv);
    const fakeAcp = await exerciseFakeCodexAcpChildSession(startLocalApiServer, createLocalAgentToolEnv);
    const officialCodexAcp = await exerciseOfficialCodexAcpWithStubModel(startLocalApiServer, createLocalAgentToolEnv);
    const loro = await exerciseLoroSync(origin, mockRemote);
    const fal = await exerciseFalMock(origin);
    console.log("[daemon-smoke] runtime", JSON.stringify(runtime));
    console.log("[daemon-smoke] local-vars-disabled", JSON.stringify(localVars));
    console.log("[daemon-smoke] model-providers", JSON.stringify(modelProviders));
    console.log("[daemon-smoke] openai", JSON.stringify(openai));
    console.log("[daemon-smoke] agent-cli", JSON.stringify(cli));
    console.log("[daemon-smoke] fake-acp", JSON.stringify(fakeAcp));
    console.log("[daemon-smoke] official-codex-acp", JSON.stringify(officialCodexAcp));
    console.log("[daemon-smoke] loro", JSON.stringify(loro));
    console.log("[daemon-smoke] fal", JSON.stringify(fal));
  } finally {
    await closeServer(server);
    await mockRemote.close();
    await mockOpenAi.close();
    restoreEnv(envSnapshot);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
