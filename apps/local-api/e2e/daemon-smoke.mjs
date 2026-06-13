import { spawn } from "node:child_process";
import { createServer } from "node:http";
import net from "node:net";
import { mkdir, rm, writeFile } from "node:fs/promises";
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
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`clash ${args.join(" ")} timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 15000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (exitCode, signal) => {
      clearTimeout(timer);
      if (signal) reject(new Error(`clash ${args.join(" ")} terminated by ${signal}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
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
    CLASH_CREW_MEMBER_ID: "local-director",
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
          client.name === "local-director"
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
    assert(node.data?.actorAgentId === "local-director", "agent CLI-created node keeps the crew member id", node);
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

async function writeFakeCodexAcp(binDir) {
  await mkdir(binDir, { recursive: true });
  const wrapper = path.join(binDir, "codex");
  const agent = path.join(binDir, "fake-codex-acp.mjs");
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
      "import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';",
      "",
      "const argv = process.argv.slice(2);",
      "if (argv.includes('--help')) {",
      "  console.log('Usage: codex [OPTIONS] [PROMPT]\\n  --acp');",
      "  process.exit(0);",
      "}",
      "if (!argv.includes('--acp')) {",
      "  console.error('fake codex only supports --acp in this smoke test');",
      "  process.exit(2);",
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
      "    this.sessions.set(sessionId, { cwd: params.cwd || process.cwd() });",
      "    return { sessionId };",
      "  }",
      "  async authenticate() { return {}; }",
      "  async prompt(params) {",
      "    if (!this.sessions.has(params.sessionId)) throw new Error('unknown session ' + params.sessionId);",
      "    const projectId = process.env.CLASH_PROJECT_ID;",
      "    if (!projectId) throw new Error('CLASH_PROJECT_ID missing');",
      "    const created = JSON.parse(await runClash([",
      "      'canvas', 'add',",
      "      '--project', projectId,",
      "      '--type', 'text',",
      "      '--label', 'Real ACP CLI Note',",
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

async function exerciseRealAcpChildSession(startLocalApiServer, createLocalAgentToolEnv) {
  const realDataDir = path.join(repoRoot, ".tmp", "local-api-real-acp-e2e-data");
  const realHome = path.join(repoRoot, ".tmp", "local-api-real-acp-home");
  const fakeBinDir = path.join(repoRoot, ".tmp", "local-api-real-acp-bin");
  await rm(realDataDir, { recursive: true, force: true });
  await rm(realHome, { recursive: true, force: true });
  await rm(fakeBinDir, { recursive: true, force: true });
  await mkdir(realHome, { recursive: true });
  await writeFakeCodexAcp(fakeBinDir);

  const envSnapshot = {
    CLASH_ACP_BIN_DIR: process.env.CLASH_ACP_BIN_DIR,
    CLASH_LOCAL_ACP_MOCK: process.env.CLASH_LOCAL_ACP_MOCK,
    CLASH_LOCAL_DATA_DIR: process.env.CLASH_LOCAL_DATA_DIR,
    CLASH_NODE_EXEC_PATH: process.env.CLASH_NODE_EXEC_PATH,
    HOME: process.env.HOME,
  };
  const port = await findFreePort(49620);
  const origin = `http://127.0.0.1:${port}`;

  process.env.CLASH_ACP_BIN_DIR = fakeBinDir;
  delete process.env.CLASH_LOCAL_ACP_MOCK;
  process.env.CLASH_LOCAL_DATA_DIR = realDataDir;
  process.env.CLASH_NODE_EXEC_PATH = process.execPath;
  process.env.HOME = realHome;

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
      "real acp agent project",
      "--json",
    ], env));
    assert(project.id, "real ACP project create returns an id", project);

    const runtimes = await jsonFetch(`${origin}/api/v1/runtimes`);
    assert(
      runtimes.runtimes?.[0]?.agents?.some((agent) => agent.id === "codex-cli"),
      "fake codex ACP child is discovered as codex-cli",
      runtimes,
    );

    const session = await jsonFetch(`${origin}/api/v1/runtimes/desktop-local/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        crew_member_id: "local-director",
        project_id: project.id,
        agent_id: "codex-cli",
      }),
    });
    assert(session.session_id, "real ACP session is created", session);

    const ws = new WebSocket(`${origin.replace("http:", "ws:")}/api/v1/local-sessions/${encodeURIComponent(session.session_id)}/_stream`);
    const events = [];
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Timed out waiting for real ACP session disposal"));
      }, 20000);
      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({ type: "prompt", turn_id: "real-acp-turn", text: "use clash cli on the canvas" }));
      });
      ws.addEventListener("message", (event) => {
        const msg = JSON.parse(String(event.data));
        events.push(msg);
        if (msg.type === "session.complete" && msg.turn_id === "real-acp-turn") {
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
        event.event?.update?.content?.text?.startsWith("Fake ACP wrote node ")
      ),
      "real ACP child emits a text event after invoking clash CLI",
      events,
    );

    const nodes = JSON.parse(await runClashCli([
      "canvas",
      "list",
      "--project",
      project.id,
      "--json",
    ], env));
    const node = nodes.find((candidate) => candidate.data?.label === "Real ACP CLI Note");
    assert(node, "real ACP child created a canvas node through clash CLI", nodes);
    assert(node.data?.actorType === "agent", "real ACP CLI node is attributed to an agent", node);
    assert(node.data?.actorUserId === "local-user", "real ACP CLI node is attributed to the local user", node);
    assert(node.data?.actorAgentId === "local-director", "real ACP CLI node keeps the crew member id", node);

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

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function main() {
  process.env.CLASH_LOCAL_ACP_MOCK = "1";
  await rm(dataDir, { recursive: true, force: true });

  const port = await findFreePort(49500);
  const origin = `http://127.0.0.1:${port}`;
  const mockRemote = await startMockRemoteLoro();
  const { createLocalAgentToolEnv, startLocalApiServer } = await import("../dist/server.js");
  const server = await startLocalApiServer({ port, dataDir });

  try {
    const runtime = await exerciseLocalSession(origin);
    const cli = await exerciseAgentCliShim(origin, createLocalAgentToolEnv);
    const realAcp = await exerciseRealAcpChildSession(startLocalApiServer, createLocalAgentToolEnv);
    const loro = await exerciseLoroSync(origin, mockRemote);
    const fal = await exerciseFalMock(origin);
    console.log("[daemon-smoke] runtime", JSON.stringify(runtime));
    console.log("[daemon-smoke] agent-cli", JSON.stringify(cli));
    console.log("[daemon-smoke] real-acp", JSON.stringify(realAcp));
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
