import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "..", "..");
const runId = process.env.CLASH_AGENT_FIRST_CAS_RUN_ID || new Date().toISOString().replace(/[:.]/g, "-");
const artifactRoot = path.resolve(
  process.env.CLASH_AGENT_FIRST_CAS_ARTIFACT_ROOT ||
    path.join(repoRoot, ".tmp", "agent-first-cas", runId),
);
const workspace = path.join(artifactRoot, "workspace");
const reportPath = path.join(artifactRoot, "agent-first-cas-report.json");
const cliEntry = path.join(repoRoot, "packages", "cli", "src", "index.ts");
const require = createRequire(path.join(repoRoot, "packages", "cli", "package.json"));
const tsxLoader = require.resolve("tsx");
const CLI_TIMEOUT_MS = 20_000;

const checks = [];

function now() {
  return new Date().toISOString();
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runProduction(args) {
  const result = spawnSync(
    process.execPath,
    ["--import", tsxLoader, cliEntry, "production", ...args],
    { cwd: workspace, encoding: "utf8", timeout: CLI_TIMEOUT_MS },
  );
  return {
    command: `clash production ${args.join(" ")}`,
    status: result.status,
    error: result.error ? String(result.error.message || result.error) : "",
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runCanvas(args, env = {}) {
  const result = spawnSync(
    process.execPath,
    ["--import", tsxLoader, cliEntry, "canvas", ...args],
    {
      cwd: workspace,
      encoding: "utf8",
      timeout: CLI_TIMEOUT_MS,
      env: { ...process.env, ...env },
    },
  );
  return {
    command: `clash canvas ${args.join(" ")}`,
    status: result.status,
    error: result.error ? String(result.error.message || result.error) : "",
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runText(args, env = {}) {
  const result = spawnSync(
    process.execPath,
    ["--import", tsxLoader, cliEntry, "text", ...args],
    {
      cwd: workspace,
      encoding: "utf8",
      timeout: CLI_TIMEOUT_MS,
      env: { ...process.env, ...env },
    },
  );
  return {
    command: `clash text ${args.join(" ")}`,
    status: result.status,
    error: result.error ? String(result.error.message || result.error) : "",
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runTimeline(args, env = {}) {
  const result = spawnSync(
    process.execPath,
    ["--import", tsxLoader, cliEntry, "timeline", ...args],
    {
      cwd: workspace,
      encoding: "utf8",
      timeout: CLI_TIMEOUT_MS,
      env: { ...process.env, ...env },
    },
  );
  return {
    command: `clash timeline ${args.join(" ")}`,
    status: result.status,
    error: result.error ? String(result.error.message || result.error) : "",
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function recordCheck(name, pass, evidence, extra = {}) {
  checks.push({
    name,
    status: pass ? "pass" : "fail",
    observedAt: now(),
    evidence,
    ...extra,
  });
  if (!pass) {
    throw new Error(`${name}: ${evidence}`);
  }
}

function requireCheckPassed(name) {
  if (!checks.some((check) => check.name === name && check.status === "pass")) {
    throw new Error(`required check missing: ${name}`);
  }
}

function parseStdoutJson(result) {
  return JSON.parse(result.stdout);
}

function baseReadToken(readToken) {
  return typeof readToken === "string" ? readToken.split(":receipt:")[0] : readToken;
}

function readOptionalText(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function readJsonLines(filePath) {
  return readOptionalText(filePath)
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function runTsxEval(source) {
  const result = spawnSync(
    process.execPath,
    ["--import", tsxLoader, "--input-type=module", "-e", source],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`tsx eval failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

async function startCliDaemonSocket(options) {
  const daemonModule = pathToFileURL(path.join(repoRoot, "packages", "cli", "src", "lib", "daemon.ts")).href;
  const sharedTypesModule = pathToFileURL(path.join(repoRoot, "packages", "shared-types", "src", "index.ts")).href;
  const source = `
    import { createServer } from "node:net";
    import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
    import { join } from "node:path";
    import { LoroSyncClient } from ${JSON.stringify(sharedTypesModule)};
    import daemon from ${JSON.stringify(daemonModule)};

    const projectId = ${JSON.stringify(options.projectId)};
    const clashHome = ${JSON.stringify(options.clashHome)};
    const { handleCommandForTest } = daemon;
    if (typeof handleCommandForTest !== "function") {
      throw new Error("daemon handleCommandForTest export missing");
    }

    const socketDir = join(clashHome, "sockets");
    const commandLogPath = join(clashHome, "daemon-command-log.jsonl");
    mkdirSync(socketDir, { recursive: true });
    const sockPath = join(socketDir, projectId + ".sock");
    const pidPath = join(socketDir, projectId + ".pid");
    rmSync(sockPath, { force: true });
    writeFileSync(pidPath, String(process.pid));

    const client = new LoroSyncClient({
      serverUrl: "http://localhost:0",
      projectId,
      token: "test",
    });
    client.createNode("text-cli", "text", { label: "CLI Text", content: "before" });
    client.createNode("timeline-cli", "video-editor", {
      label: "CLI Timeline",
      timelineDsl: {
        compositionWidth: 1080,
        compositionHeight: 1920,
        fps: 30,
        durationInFrames: 60,
        tracks: [{ id: "main", items: [] }],
      },
    });
    client.createNode("delete-cli", "text", { label: "Delete CLI", content: "before" });

    const server = createServer((conn) => {
      let buf = "";
      conn.on("data", (chunk) => {
        buf += chunk.toString();
        const newline = buf.indexOf("\\n");
        if (newline === -1) return;
        const line = buf.slice(0, newline);
        try {
          const cmd = JSON.parse(line);
          appendFileSync(commandLogPath, JSON.stringify({ action: cmd.action, nodeId: cmd.nodeId, actorClientType: cmd.actorClientType }) + "\\n");
          const result = handleCommandForTest(client, cmd);
          conn.end(JSON.stringify(result) + "\\n");
        } catch (error) {
          conn.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + "\\n");
        }
      });
    });

    function cleanup() {
      try { server.close(); } catch {}
      try { rmSync(sockPath, { force: true }); } catch {}
      try { rmSync(pidPath, { force: true }); } catch {}
    }
    process.on("SIGTERM", () => { cleanup(); process.exit(0); });
    process.on("SIGINT", () => { cleanup(); process.exit(0); });
    server.listen(sockPath, () => {
      process.stdout.write(JSON.stringify({ ready: true, projectId, sockPath, commandLogPath }) + "\\n");
    });
    setInterval(() => {}, 30_000);
  `;

  const child = spawn(
    process.execPath,
    ["--import", tsxLoader, "--input-type=module", "-e", source],
    {
      cwd: repoRoot,
      env: { ...process.env, CLASH_HOME: options.clashHome },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const logs = { stdout: "", stderr: "" };
  const ready = await new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => {
      rejectReady(new Error(`daemon socket did not become ready. stdout=${logs.stdout} stderr=${logs.stderr}`));
    }, 10_000);
    child.stdout.on("data", (chunk) => {
      logs.stdout += chunk.toString();
      for (const line of logs.stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.ready) {
            clearTimeout(timeout);
            resolveReady(parsed);
            return;
          }
        } catch {}
      }
    });
    child.stderr.on("data", (chunk) => {
      logs.stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectReady(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      rejectReady(new Error(`daemon socket exited before ready: code=${code} signal=${signal} stdout=${logs.stdout} stderr=${logs.stderr}`));
    });
  });

  return {
    child,
    logs,
    ready,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await new Promise((resolveStop) => {
        const timeout = setTimeout(resolveStop, 2_000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolveStop();
        });
      });
    },
  };
}

async function startRevisionIndexHost() {
  const hostDir = path.join(artifactRoot, "revision-index-host");
  const requestsPath = path.join(hostDir, "requests.jsonl");
  const revisionsPath = path.join(hostDir, "revisions.json");
  const source = `
    import { createServer } from "node:http";
    import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
    import { dirname } from "node:path";

    const requestsPath = ${JSON.stringify(requestsPath)};
    const revisionsPath = ${JSON.stringify(revisionsPath)};
    const revisions = [];
    const revisionContents = new Map();
    mkdirSync(dirname(requestsPath), { recursive: true });
    writeFileSync(requestsPath, "");
    writeFileSync(revisionsPath, "[]\\n");

    function persistRevisions() {
      writeFileSync(revisionsPath, JSON.stringify(revisions, null, 2) + "\\n");
    }

    async function readRequestJson(request) {
      let raw = "";
      for await (const chunk of request) raw += chunk.toString();
      return raw ? JSON.parse(raw) : {};
    }

    function sendJson(response, status, body) {
      const payload = JSON.stringify(body);
      response.writeHead(status, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        connection: "close",
      });
      response.end(payload);
    }

    function sendText(response, status, body, contentType) {
      response.writeHead(status, {
        "content-type": contentType,
        "content-length": Buffer.byteLength(body),
        connection: "close",
      });
      response.end(body);
    }

    const server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url || "/", "http://127.0.0.1");
        appendFileSync(requestsPath, JSON.stringify({ method: request.method, path: url.pathname, search: url.search }) + "\\n");
        if (request.method === "GET" && url.pathname === "/api/v1/me") {
          sendJson(response, 200, { id: "agent-first-cas-user" });
          return;
        }
        if (request.method === "POST" && url.pathname === "/api/v1/text-revisions") {
          const body = await readRequestJson(request);
          if (!body.revision?.revisionId) {
            sendJson(response, 400, { error: "missing revision" });
            return;
          }
          const existing = revisions.find((revision) => revision.revisionId === body.revision.revisionId);
          if (!existing) {
            revisions.push(body.revision);
            if (typeof body.content === "string") {
              revisionContents.set(body.revision.revisionId, body.content);
            }
            persistRevisions();
          }
          sendJson(response, 200, {
            revision: body.revision,
            mutation: {
              operation: "text_revision_index",
              entity: { kind: "text", id: \`\${body.revision.projectId}:\${body.revision.nodeId}\` },
              resultEntityId: body.revision.revisionId,
              accepted: true,
              forced: false,
            },
          });
          return;
        }
        if (request.method === "POST" && url.pathname === "/api/v1/timeline-revisions") {
          const body = await readRequestJson(request);
          if (!body.revision?.revisionId) {
            sendJson(response, 400, { error: "missing revision" });
            return;
          }
          const existing = revisions.find((revision) => revision.revisionId === body.revision.revisionId);
          if (!existing) {
            revisions.push(body.revision);
            if (typeof body.content === "string") {
              revisionContents.set(body.revision.revisionId, body.content);
            }
            persistRevisions();
          }
          sendJson(response, 200, {
            revision: body.revision,
            mutation: {
              operation: "timeline_revision_index",
              entity: { kind: "timeline", id: \`\${body.revision.projectId}:\${body.revision.nodeId}\` },
              resultEntityId: body.revision.revisionId,
              accepted: true,
              forced: false,
            },
          });
          return;
        }
        const match = url.pathname.match(/^\\/api\\/v1\\/projects\\/([^/]+)\\/text-revisions$/);
        if (request.method === "GET" && match) {
          const projectId = decodeURIComponent(match[1]);
          const nodeId = url.searchParams.get("nodeId");
          const limit = Number(url.searchParams.get("limit") || "50");
          const filtered = revisions
            .filter((revision) => revision.projectId === projectId && (!nodeId || revision.nodeId === nodeId))
            .slice(0, Number.isFinite(limit) ? limit : 50);
          sendJson(response, 200, { revisions: filtered });
          return;
        }
        const textContentMatch = url.pathname.match(/^\\/api\\/v1\\/projects\\/([^/]+)\\/text-revisions\\/([^/]+)\\/content$/);
        if (request.method === "GET" && textContentMatch) {
          const projectId = decodeURIComponent(textContentMatch[1]);
          const revisionId = decodeURIComponent(textContentMatch[2]);
          const revision = revisions.find((item) =>
            item.projectId === projectId &&
            item.revisionId === revisionId &&
            item.kind === "clash.text.revision"
          );
          const content = revisionContents.get(revisionId);
          if (!revision || typeof content !== "string") {
            sendJson(response, 404, { error: "revision content not found" });
            return;
          }
          sendText(response, 200, content, "text/markdown; charset=utf-8");
          return;
        }
        const timelineMatch = url.pathname.match(/^\\/api\\/v1\\/projects\\/([^/]+)\\/timeline-revisions$/);
        if (request.method === "GET" && timelineMatch) {
          const projectId = decodeURIComponent(timelineMatch[1]);
          const nodeId = url.searchParams.get("nodeId");
          const limit = Number(url.searchParams.get("limit") || "50");
          const filtered = revisions
            .filter((revision) => revision.projectId === projectId && revision.kind === "clash.timeline.revision" && (!nodeId || revision.nodeId === nodeId))
            .slice(0, Number.isFinite(limit) ? limit : 50);
          sendJson(response, 200, { revisions: filtered });
          return;
        }
        const timelineContentMatch = url.pathname.match(/^\\/api\\/v1\\/projects\\/([^/]+)\\/timeline-revisions\\/([^/]+)\\/content$/);
        if (request.method === "GET" && timelineContentMatch) {
          const projectId = decodeURIComponent(timelineContentMatch[1]);
          const revisionId = decodeURIComponent(timelineContentMatch[2]);
          const revision = revisions.find((item) =>
            item.projectId === projectId &&
            item.revisionId === revisionId &&
            item.kind === "clash.timeline.revision"
          );
          const content = revisionContents.get(revisionId);
          if (!revision || typeof content !== "string") {
            sendJson(response, 404, { error: "revision content not found" });
            return;
          }
          sendText(response, 200, content, "application/yaml; charset=utf-8");
          return;
        }
        sendJson(response, 404, { error: "not found" });
      } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    });

    function cleanup() {
      try { server.close(); } catch {}
    }
    process.on("SIGTERM", () => { cleanup(); process.exit(0); });
    process.on("SIGINT", () => { cleanup(); process.exit(0); });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      process.stdout.write(JSON.stringify({
        ready: true,
        url: \`http://127.0.0.1:\${address.port}\`,
        requestsPath,
        revisionsPath,
      }) + "\\n");
    });
    setInterval(() => {}, 30_000);
  `;

  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", source],
    { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
  const logs = { stdout: "", stderr: "" };
  const ready = await new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => {
      rejectReady(new Error(`text revision index host did not become ready. stdout=${logs.stdout} stderr=${logs.stderr}`));
    }, 10_000);
    child.stdout.on("data", (chunk) => {
      logs.stdout += chunk.toString();
      for (const line of logs.stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.ready) {
            clearTimeout(timeout);
            resolveReady(parsed);
            return;
          }
        } catch {}
      }
    });
    child.stderr.on("data", (chunk) => {
      logs.stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectReady(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      rejectReady(new Error(`text revision index host exited before ready: code=${code} signal=${signal} stdout=${logs.stdout} stderr=${logs.stderr}`));
    });
  });

  return {
    url: ready.url,
    logs,
    get requests() {
      return readJsonLines(requestsPath);
    },
    get revisions() {
      const raw = readOptionalText(revisionsPath);
      return raw ? JSON.parse(raw) : [];
    },
    close: async () => {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await new Promise((resolveClose) => {
        const timeout = setTimeout(resolveClose, 2_000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolveClose();
        });
      });
    },
  };
}

async function seedWorkspace() {
  await mkdir(workspace, { recursive: true });
  await writeJson(path.join(workspace, "actions", "storyboard-review.json"), {
    actionId: "action-storyboard-fill",
    targetAssetId: "asset-storyboard",
    metadataKind: "image.storyboard-consistency",
    producer: "agent-first-cas-smoke",
    metadata: {
      kind: "image.storyboard-consistency",
      characters: [
        {
          id: "hero",
          name: "夜班店员",
          referenceAssetIds: ["asset-hero-front"],
          requiredViews: ["front"],
        },
      ],
      scenes: [
        { id: "store-night", referenceAssetIds: ["asset-store"], prompt: "rainy convenience store" },
      ],
      panels: [
        {
          id: "panel-1",
          sceneId: "store-night",
          characterIds: ["hero"],
          assetId: "asset-panel-1",
        },
      ],
    },
  });
  await writeJson(path.join(workspace, "pipeline.manifest.json"), {
    schemaVersion: 1,
    projectKind: "short-drama",
    stages: ["brief", "plan", "review", "export"],
    editableFiles: ["plans/prompt-pack.json"],
    protectedFiles: ["snapshot.bin", "local.sqlite"],
    requiredSystemCapabilities: ["review.stage-gates"],
  });
  await writeJson(path.join(workspace, "qa", "delivery", "validation.json"), {
    verdict: "pass",
  });
}

async function runStoryboardPromptPackCas() {
  const project = runProduction([
    "project-storyboard-prompt-pack",
    "--action",
    "actions/storyboard-review.json",
    "--out",
    "plans/prompt-pack.json",
    "--json",
  ]);
  recordCheck(
    "storyboard prompt-pack read step produced lock",
    project.status === 0,
    project.stderr || project.stdout,
    { command: project.command },
  );
  const projected = parseStdoutJson(project);
  const promptPackPath = path.join(workspace, "plans", "prompt-pack.json");
  const lockPath = path.join(workspace, "plans", "prompt-pack.lock.json");

  await copyFile(promptPackPath, path.join(workspace, "plans", "missing-lock.prompt-pack.json"));
  const missingLock = runProduction([
    "apply-storyboard-prompt-pack",
    "--file",
    "plans/missing-lock.prompt-pack.json",
    "--json",
  ]);
  recordCheck(
    "missing read proof rejected",
    missingLock.status === 1 && /CAS lock|Failed to read storyboard prompt-pack/i.test(missingLock.stderr),
    missingLock.stderr,
    { command: missingLock.command },
  );

  const sourceActionPath = path.join(workspace, "actions", "storyboard-review.json");
  const originalSourceAction = JSON.parse(await readFile(sourceActionPath, "utf8"));
  const changedSourceAction = JSON.parse(JSON.stringify(originalSourceAction));
  changedSourceAction.metadata.panels.push({
    id: "panel-2",
    sceneId: "store-night",
    characterIds: ["hero"],
    assetId: "asset-panel-2",
  });
  await writeJson(sourceActionPath, changedSourceAction);
  const staleSource = runProduction([
    "apply-storyboard-prompt-pack",
    "--file",
    "plans/prompt-pack.json",
    "--lock",
    "plans/prompt-pack.lock.json",
    "--json",
  ]);
  recordCheck(
    "source action stale read proof rejected",
    staleSource.status === 1 && /Stale storyboard prompt-pack source action rejected/i.test(staleSource.stderr),
    staleSource.stderr,
    { command: staleSource.command },
  );
  await writeJson(sourceActionPath, originalSourceAction);
  const sourceRefresh = runProduction([
    "project-storyboard-prompt-pack",
    "--action",
    "actions/storyboard-review.json",
    "--out",
    "plans/prompt-pack.json",
    "--json",
  ]);
  recordCheck(
    "source action read proof refresh succeeded",
    sourceRefresh.status === 0,
    sourceRefresh.stderr || sourceRefresh.stdout,
    { command: sourceRefresh.command },
  );

  const promptPack = JSON.parse(await readFile(promptPackPath, "utf8"));
  promptPack.prompts[0].prompt += "; approved close-up";
  await writeJson(promptPackPath, promptPack);
  const apply = runProduction([
    "apply-storyboard-prompt-pack",
    "--file",
    "plans/prompt-pack.json",
    "--lock",
    "plans/prompt-pack.lock.json",
    "--json",
  ]);
  recordCheck(
    "fresh read proof apply succeeded",
    apply.status === 0,
    apply.stderr || apply.stdout,
    { command: apply.command },
  );
  const applied = parseStdoutJson(apply);

  const stale = runProduction([
    "apply-storyboard-prompt-pack",
    "--file",
    "plans/prompt-pack.json",
    "--lock",
    "plans/prompt-pack.lock.json",
    "--json",
  ]);
  recordCheck(
    "stale read proof rejected",
    stale.status === 1 && /Stale storyboard prompt-pack apply rejected/i.test(stale.stderr),
    stale.stderr,
    { command: stale.command },
  );

  const refresh = runProduction([
    "project-storyboard-prompt-pack",
    "--action",
    "actions/storyboard-review.json",
    "--out",
    "plans/prompt-pack.json",
    "--json",
  ]);
  recordCheck(
    "refresh read proof succeeded",
    refresh.status === 0,
    refresh.stderr || refresh.stdout,
    { command: refresh.command },
  );
  const refreshedPromptPack = JSON.parse(await readFile(promptPackPath, "utf8"));
  refreshedPromptPack.prompts[0].prompt += "; copy-on-write branch";
  await writeJson(promptPackPath, refreshedPromptPack);
  const replace = runProduction([
    "replace-storyboard-prompt-pack",
    "--file",
    "plans/prompt-pack.json",
    "--lock",
    "plans/prompt-pack.lock.json",
    "--json",
  ]);
  recordCheck(
    "copy-on-write replace succeeded",
    replace.status === 0,
    replace.stderr || replace.stdout,
    { command: replace.command },
  );
  const replaced = parseStdoutJson(replace);
  const managedProjection = JSON.parse(await readFile(applied.projectionPath, "utf8"));
  const replacementProjection = JSON.parse(await readFile(replaced.projectionPath, "utf8"));
  recordCheck(
    "copy-on-write preserved source projection",
    !managedProjection.promptPack.prompts[0].prompt.includes("copy-on-write branch") &&
      replacementProjection.promptPack.prompts[0].prompt.includes("copy-on-write branch"),
    `managed=${applied.projectionPath}; cow=${replaced.projectionPath}`,
    {
      managedProjectionPath: applied.projectionPath,
      replacementProjectionPath: replaced.projectionPath,
    },
  );

  return {
    projected,
    promptPackPath,
    lockPath,
    managedProjectionPath: applied.projectionPath,
    replacementProjectionPath: replaced.projectionPath,
  };
}

async function runReviewGateCas() {
  const plan = runProduction([
    "plan-review-gate",
    "--pipeline",
    "pipeline.manifest.json",
    "--stage",
    "export",
    "--artifact",
    "qa/delivery/validation.json",
    "--out",
    "reviews/gates/export.review-gate.json",
    "--json",
  ]);
  recordCheck(
    "review gate read step produced path-bound lock",
    plan.status === 0,
    plan.stderr || plan.stdout,
    { command: plan.command },
  );
  await copyFile(
    path.join(workspace, "reviews", "gates", "export.review-gate.json"),
    path.join(workspace, "reviews", "gates", "copied-export.review-gate.json"),
  );
  const wrongFile = runProduction([
    "approve-review-gate",
    "--gate",
    "reviews/gates/copied-export.review-gate.json",
    "--lock",
    "reviews/gates/export.review-gate.lock.json",
    "--reviewer",
    "qa-agent",
    "--decision",
    "approve",
    "--json",
  ]);
  recordCheck(
    "wrong file lock rejected",
    wrongFile.status === 1 && /Review gate path does not match CAS lock/i.test(wrongFile.stderr),
    wrongFile.stderr,
    { command: wrongFile.command },
  );
  const planned = parseStdoutJson(plan);
  return {
    gatePath: planned.gatePath,
    lockPath: planned.lockPath,
  };
}

function runDirectCanvasReadTokenCas() {
  const daemonModule = pathToFileURL(path.join(repoRoot, "packages", "cli", "src", "lib", "daemon.ts")).href;
  const sharedTypesModule = pathToFileURL(path.join(repoRoot, "packages", "shared-types", "src", "index.ts")).href;
  const result = runTsxEval(`
    import { LoroSyncClient } from ${JSON.stringify(sharedTypesModule)};
    import daemon from ${JSON.stringify(daemonModule)};
    const { handleCommandForTest } = daemon;
    if (typeof handleCommandForTest !== "function") {
      throw new Error("daemon handleCommandForTest export missing");
    }

    const client = new LoroSyncClient({
      serverUrl: "http://localhost:0",
      projectId: "project-agent-first-cas",
      token: "test",
    });
    client.createNode("text-1", "text", { label: "Script", content: "before" });
    const firstRead = handleCommandForTest(client, { action: "get", nodeId: "text-1" });
    const firstReadToken = firstRead.readToken;
    const missingUpdate = handleCommandForTest(client, {
      action: "update",
      nodeId: "text-1",
      label: "missing read token",
      actorClientType: "agent",
    });
    client.updateNode("text-1", { label: "concurrent edit" });
    const staleUpdate = handleCommandForTest(client, {
      action: "update",
      nodeId: "text-1",
      label: "stale read token",
      actorClientType: "agent",
      ifMatch: firstReadToken,
    });
    const freshRead = handleCommandForTest(client, { action: "get", nodeId: "text-1" });
    const freshReadToken = freshRead.readToken;
    const freshUpdate = handleCommandForTest(client, {
      action: "update",
      nodeId: "text-1",
      label: "fresh read token",
      actorClientType: "agent",
      ifMatch: freshReadToken,
    });
    client.createNode("delete-1", "text", { label: "Delete me", content: "before" });
    const missingDelete = handleCommandForTest(client, {
      action: "delete",
      nodeId: "delete-1",
      actorClientType: "agent",
    });
    console.log(JSON.stringify({
      missingUpdate,
      staleUpdate,
      freshUpdate,
      missingDelete,
      firstRead,
      freshRead,
      finalLabel: client.readNode("text-1")?.data?.label,
      deleteStillExists: Boolean(client.readNode("delete-1")),
    }));
  `);

  recordCheck(
    "direct canvas missing read token rejected",
    /read proof|--if-match/i.test(JSON.stringify(result.missingUpdate)) &&
      result.finalLabel !== "missing read token",
    JSON.stringify(result.missingUpdate),
  );
  recordCheck(
    "direct canvas stale read token rejected",
    /Stale canvas update rejected/i.test(JSON.stringify(result.staleUpdate)) &&
      result.finalLabel === "fresh read token",
    JSON.stringify(result.staleUpdate),
  );
  recordCheck(
    "direct canvas fresh read token accepted",
    result.freshUpdate?.updated === true &&
      typeof result.freshUpdate?.readToken === "string" &&
      result.finalLabel === "fresh read token",
    JSON.stringify(result.freshUpdate),
  );
  recordCheck(
    "direct canvas mutation envelope recorded",
    result.freshUpdate?.mutation?.operation === "canvas_update" &&
      result.freshUpdate?.mutation?.entity?.kind === "canvas-node" &&
      result.freshUpdate?.mutation?.entity?.id === "text-1" &&
      result.freshUpdate?.mutation?.expectedReadToken === result.freshRead?.readToken &&
      result.freshUpdate?.mutation?.beforeReadToken === baseReadToken(result.freshRead?.readToken) &&
      result.freshUpdate?.mutation?.afterReadToken === result.freshUpdate?.readToken &&
      result.freshUpdate?.mutation?.resultEntityId === "text-1" &&
      result.freshUpdate?.mutation?.accepted === true &&
      result.freshUpdate?.mutation?.forced === false,
    JSON.stringify(result.freshUpdate?.mutation),
  );
  recordCheck(
    "direct canvas delete read token required",
    /read proof|--if-match/i.test(JSON.stringify(result.missingDelete)) &&
      result.deleteStillExists === true,
    JSON.stringify(result.missingDelete),
  );
  return result;
}

function runProjectionPathGuards() {
  const symlinkTarget = path.join(artifactRoot, "outside-projection-target");
  const lockSymlinkTarget = path.join(artifactRoot, "outside-lock-target");
  mkdirSync(path.join(symlinkTarget, "text"), { recursive: true });
  mkdirSync(lockSymlinkTarget, { recursive: true });
  symlinkSync(symlinkTarget, path.join(workspace, "symlinked-projections"), "dir");
  mkdirSync(path.join(workspace, "projections", "text"), { recursive: true });
  mkdirSync(path.join(workspace, "projections", "timelines"), { recursive: true });
  mkdirSync(path.join(workspace, "timelines"), { recursive: true });
  mkdirSync(path.join(workspace, "reviews", "gates"), { recursive: true });
  mkdirSync(path.join(workspace, "qa", "pipeline"), { recursive: true });
  mkdirSync(path.join(workspace, "exports", "captions"), { recursive: true });
  mkdirSync(path.join(workspace, "exports", "handoff"), { recursive: true });
  mkdirSync(path.join(workspace, "references"), { recursive: true });
  writeFileSync(path.join(workspace, "projections", "timelines", "captions.timeline.yaml"), [
    "fps: 30",
    "durationInFrames: 60",
    "tracks:",
    "  - id: captions",
    "    role: subtitle",
    "    items:",
    "      - id: clean-caption",
    "        type: caption",
    "        from: 0",
    "        durationInFrames: 30",
    "        cues:",
    "          - id: cue-1",
    "            startFrame: 0",
    "            durationInFrames: 30",
    "            text: 大家好",
    "            wordIds: [w1]",
    "            sourceStartFrame: 0",
    "            sourceEndFrame: 30",
    "        wordRefs:",
    "          - id: w1",
    "            text: 大家好",
    "            sourceStartFrame: 0",
    "            sourceEndFrame: 30",
    "        sourceToOutputMap:",
    "          - sourceStartFrame: 0",
    "            sourceEndFrame: 30",
    "            outputStartFrame: 0",
    "            outputEndFrame: 30",
    "",
  ].join("\n"), "utf8");
  writeFileSync(path.join(workspace, "references", "roles.json"), `${JSON.stringify([
    {
      roleId: "hero-front",
      assetId: "asset-hero-front",
      role: "identity-front",
      path: "assets/reference-sheets/hero-front.png",
    },
  ], null, 2)}\n`, "utf8");
  writeFileSync(path.join(workspace, "pipeline.path-guard.manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    projectKind: "short-drama",
    stages: ["analysis"],
    artifacts: [
      { kind: "action", stage: "analysis", path: "actions/storyboard-review.json" },
      { kind: "metadata", stage: "analysis", path: "projections/metadata/storyboard.json" },
      { kind: "asset", stage: "analysis", path: "assets/manifest.json" },
      { kind: "projection", stage: "analysis", path: "projections/timelines/storyboard.yaml", casRequired: true },
    ],
  }, null, 2)}\n`, "utf8");
  writeFileSync(path.join(lockSymlinkTarget, "script.lock.json"), "{}\n", "utf8");
  writeFileSync(path.join(lockSymlinkTarget, "main.timeline.lock.json"), "{}\n", "utf8");
  writeFileSync(path.join(lockSymlinkTarget, "unsafe-prompt-pack.lock.json"), "{}\n", "utf8");
  writeFileSync(path.join(lockSymlinkTarget, "unsafe.review-gate.lock.json"), "{}\n", "utf8");
  writeFileSync(path.join(lockSymlinkTarget, "unsafe.pipeline-validation.json"), "{}\n", "utf8");
  writeFileSync(path.join(lockSymlinkTarget, "unsafe.reference-roles.json"), "{}\n", "utf8");
  writeFileSync(path.join(lockSymlinkTarget, "unsafe.captions.srt"), "outside\n", "utf8");
  writeFileSync(path.join(lockSymlinkTarget, "unsafe.timeline.csv"), "outside\n", "utf8");
  writeFileSync(path.join(lockSymlinkTarget, "unsafe.timeline.handoff.json"), "{}\n", "utf8");
  symlinkSync(
    path.join(lockSymlinkTarget, "script.lock.json"),
    path.join(workspace, "projections", "text", "script.lock.json"),
  );
  symlinkSync(
    path.join(lockSymlinkTarget, "main.timeline.lock.json"),
    path.join(workspace, "timelines", "main.timeline.lock.json"),
  );
  symlinkSync(
    path.join(lockSymlinkTarget, "unsafe-prompt-pack.lock.json"),
    path.join(workspace, "plans", "unsafe-prompt-pack.lock.json"),
  );
  symlinkSync(
    path.join(lockSymlinkTarget, "unsafe.review-gate.lock.json"),
    path.join(workspace, "reviews", "gates", "unsafe.review-gate.lock.json"),
  );
  symlinkSync(
    path.join(lockSymlinkTarget, "unsafe.pipeline-validation.json"),
    path.join(workspace, "qa", "pipeline", "unsafe.pipeline-validation.json"),
  );
  symlinkSync(
    path.join(lockSymlinkTarget, "unsafe.reference-roles.json"),
    path.join(workspace, "actions", "unsafe.reference-roles.json"),
  );
  symlinkSync(
    path.join(lockSymlinkTarget, "unsafe.captions.srt"),
    path.join(workspace, "exports", "captions", "unsafe.srt"),
  );
  symlinkSync(
    path.join(lockSymlinkTarget, "unsafe.timeline.csv"),
    path.join(workspace, "exports", "handoff", "unsafe.timeline.csv"),
  );
  symlinkSync(
    path.join(lockSymlinkTarget, "unsafe.timeline.handoff.json"),
    path.join(workspace, "exports", "handoff", "unsafe.timeline.handoff.json"),
  );

  const textPull = runText([
    "pull",
    "--project",
    "project-agent-first-path-guards",
    "--node",
    "text-1",
    "--file",
    "../outside-text.md",
    "--json",
  ]);
  recordCheck(
    "text pull rejects projection path outside cwd",
    textPull.status === 1 && /Projection file path must stay inside the current project cwd/i.test(textPull.stderr),
    textPull.stderr || textPull.stdout,
    { command: textPull.command },
  );

  const textForcedApply = runText([
    "apply",
    "--project",
    "project-agent-first-path-guards",
    "--node",
    "text-1",
    "--file",
    "../outside-text.md",
    "--force",
    "--json",
  ]);
  recordCheck(
    "text forced apply rejects projection path outside cwd",
    textForcedApply.status === 1 &&
      /Projection file path must stay inside the current project cwd/i.test(textForcedApply.stderr),
    textForcedApply.stderr || textForcedApply.stdout,
    { command: textForcedApply.command },
  );

  const textSymlinkPull = runText([
    "pull",
    "--project",
    "project-agent-first-path-guards",
    "--node",
    "text-1",
    "--file",
    "symlinked-projections/text/script.md",
    "--json",
  ]);
  recordCheck(
    "text pull rejects symlinked projection path outside cwd",
    textSymlinkPull.status === 1 &&
      /Projection file path must not traverse a symlink outside the current project cwd/i.test(textSymlinkPull.stderr),
    textSymlinkPull.stderr || textSymlinkPull.stdout,
    { command: textSymlinkPull.command },
  );

  const textLockSidecarPull = runText([
    "pull",
    "--project",
    "project-agent-first-path-guards",
    "--node",
    "text-1",
    "--file",
    "projections/text/script.md",
    "--json",
  ]);
  recordCheck(
    "text pull rejects symlinked lock sidecar outside cwd",
    textLockSidecarPull.status === 1 &&
      /Projection lock sidecar path must not traverse a symlink outside the current project cwd/i.test(textLockSidecarPull.stderr),
    textLockSidecarPull.stderr || textLockSidecarPull.stdout,
    { command: textLockSidecarPull.command },
  );

  const timelinePull = runTimeline([
    "pull",
    "--project",
    "project-agent-first-path-guards",
    "--node",
    "timeline-1",
    "--file",
    "../outside.timeline.yaml",
    "--json",
  ]);
  recordCheck(
    "timeline pull rejects projection path outside cwd",
    timelinePull.status === 1 &&
      /Projection file path must stay inside the current project cwd/i.test(timelinePull.stderr),
    timelinePull.stderr || timelinePull.stdout,
    { command: timelinePull.command },
  );

  const timelineForcedApply = runTimeline([
    "apply",
    "--project",
    "project-agent-first-path-guards",
    "--node",
    "timeline-1",
    "--file",
    "../outside.timeline.yaml",
    "--force",
    "--json",
  ]);
  recordCheck(
    "timeline forced apply rejects projection path outside cwd",
    timelineForcedApply.status === 1 &&
      /Projection file path must stay inside the current project cwd/i.test(timelineForcedApply.stderr),
    timelineForcedApply.stderr || timelineForcedApply.stdout,
    { command: timelineForcedApply.command },
  );

  const timelineSymlinkForcedApply = runTimeline([
    "apply",
    "--project",
    "project-agent-first-path-guards",
    "--node",
    "timeline-1",
    "--file",
    "symlinked-projections/main.timeline.yaml",
    "--force",
    "--json",
  ]);
  recordCheck(
    "timeline forced apply rejects symlinked projection path outside cwd",
    timelineSymlinkForcedApply.status === 1 &&
      /Projection file path must not traverse a symlink outside the current project cwd/i.test(timelineSymlinkForcedApply.stderr),
    timelineSymlinkForcedApply.stderr || timelineSymlinkForcedApply.stdout,
    { command: timelineSymlinkForcedApply.command },
  );

  const timelineLockSidecarPull = runTimeline([
    "pull",
    "--project",
    "project-agent-first-path-guards",
    "--node",
    "timeline-1",
    "--file",
    "timelines/main.timeline.yaml",
    "--json",
  ]);
  recordCheck(
    "timeline pull rejects symlinked lock sidecar outside cwd",
    timelineLockSidecarPull.status === 1 &&
      /Projection lock sidecar path must not traverse a symlink outside the current project cwd/i.test(timelineLockSidecarPull.stderr),
    timelineLockSidecarPull.stderr || timelineLockSidecarPull.stdout,
    { command: timelineLockSidecarPull.command },
  );

  const storyboardPromptPackLockSidecar = runProduction([
    "project-storyboard-prompt-pack",
    "--action",
    "actions/storyboard-review.json",
    "--out",
    "plans/unsafe-prompt-pack.json",
    "--json",
  ]);
  recordCheck(
    "storyboard prompt-pack project rejects symlinked lock sidecar outside cwd",
    storyboardPromptPackLockSidecar.status === 1 &&
      /Projection lock sidecar path must not traverse a symlink outside the current project cwd/i.test(storyboardPromptPackLockSidecar.stderr),
    storyboardPromptPackLockSidecar.stderr || storyboardPromptPackLockSidecar.stdout,
    { command: storyboardPromptPackLockSidecar.command },
  );

  const reviewGateLockSidecar = runProduction([
    "plan-review-gate",
    "--pipeline",
    "pipeline.manifest.json",
    "--stage",
    "export",
    "--artifact",
    "qa/delivery/validation.json",
    "--out",
    "reviews/gates/unsafe.review-gate.json",
    "--json",
  ]);
  recordCheck(
    "review gate plan rejects symlinked lock sidecar outside cwd",
    reviewGateLockSidecar.status === 1 &&
      /Agent file lock sidecar path must not traverse a symlink outside the current project cwd/i.test(reviewGateLockSidecar.stderr),
    reviewGateLockSidecar.stderr || reviewGateLockSidecar.stdout,
    { command: reviewGateLockSidecar.command },
  );

  const pipelineValidationReport = runProduction([
    "validate-pipeline-manifest",
    "--pipeline",
    "pipeline.path-guard.manifest.json",
    "--out",
    "qa/pipeline/unsafe.pipeline-validation.json",
    "--json",
  ]);
  recordCheck(
    "pipeline validation rejects symlinked report path outside cwd",
    pipelineValidationReport.status === 1 &&
      /Agent file path must not traverse a symlink outside the current project cwd/i.test(pipelineValidationReport.stderr),
    pipelineValidationReport.stderr || pipelineValidationReport.stdout,
    { command: pipelineValidationReport.command },
  );

  const referenceRolesAction = runProduction([
    "plan-reference-roles",
    "--target-asset",
    "asset-reference-pack",
    "--roles",
    "references/roles.json",
    "--out",
    "actions/unsafe.reference-roles.json",
    "--json",
  ]);
  recordCheck(
    "reference roles plan rejects symlinked action path outside cwd",
    referenceRolesAction.status === 1 &&
      /Agent file path must not traverse a symlink outside the current project cwd/i.test(referenceRolesAction.stderr),
    referenceRolesAction.stderr || referenceRolesAction.stdout,
    { command: referenceRolesAction.command },
  );

  const captionExport = runProduction([
    "export-captions",
    "--timeline",
    "projections/timelines/captions.timeline.yaml",
    "--out",
    "exports/captions/unsafe.srt",
    "--json",
  ]);
  recordCheck(
    "caption export rejects symlinked output path outside cwd",
    captionExport.status === 1 &&
      /Agent file path must not traverse a symlink outside the current project cwd/i.test(captionExport.stderr),
    captionExport.stderr || captionExport.stdout,
    { command: captionExport.command },
  );

  const timelineHandoff = runProduction([
    "export-timeline-handoff",
    "--timeline",
    "projections/timelines/captions.timeline.yaml",
    "--out",
    "exports/handoff/unsafe.timeline.csv",
    "--json",
  ]);
  recordCheck(
    "timeline handoff export rejects symlinked output path outside cwd",
    timelineHandoff.status === 1 &&
      /Agent file path must not traverse a symlink outside the current project cwd/i.test(timelineHandoff.stderr),
    timelineHandoff.stderr || timelineHandoff.stdout,
    { command: timelineHandoff.command },
  );

  const timelineHandoffManifest = runProduction([
    "export-timeline-handoff",
    "--timeline",
    "projections/timelines/captions.timeline.yaml",
    "--out",
    "exports/handoff/manifest-safe.timeline.csv",
    "--manifest",
    "exports/handoff/unsafe.timeline.handoff.json",
    "--json",
  ]);
  recordCheck(
    "timeline handoff export rejects symlinked manifest path outside cwd",
    timelineHandoffManifest.status === 1 &&
      /Agent file path must not traverse a symlink outside the current project cwd/i.test(timelineHandoffManifest.stderr),
    timelineHandoffManifest.stderr || timelineHandoffManifest.stdout,
    { command: timelineHandoffManifest.command },
  );

  return {
    textPull: { status: textPull.status, stderr: textPull.stderr },
    textForcedApply: { status: textForcedApply.status, stderr: textForcedApply.stderr },
    textSymlinkPull: { status: textSymlinkPull.status, stderr: textSymlinkPull.stderr },
    textLockSidecarPull: { status: textLockSidecarPull.status, stderr: textLockSidecarPull.stderr },
    timelinePull: { status: timelinePull.status, stderr: timelinePull.stderr },
    timelineForcedApply: { status: timelineForcedApply.status, stderr: timelineForcedApply.stderr },
    timelineSymlinkForcedApply: { status: timelineSymlinkForcedApply.status, stderr: timelineSymlinkForcedApply.stderr },
    timelineLockSidecarPull: { status: timelineLockSidecarPull.status, stderr: timelineLockSidecarPull.stderr },
    storyboardPromptPackLockSidecar: {
      status: storyboardPromptPackLockSidecar.status,
      stderr: storyboardPromptPackLockSidecar.stderr,
    },
    reviewGateLockSidecar: {
      status: reviewGateLockSidecar.status,
      stderr: reviewGateLockSidecar.stderr,
    },
    pipelineValidationReport: {
      status: pipelineValidationReport.status,
      stderr: pipelineValidationReport.stderr,
    },
    referenceRolesAction: {
      status: referenceRolesAction.status,
      stderr: referenceRolesAction.stderr,
    },
    captionExport: {
      status: captionExport.status,
      stderr: captionExport.stderr,
    },
    timelineHandoff: {
      status: timelineHandoff.status,
      stderr: timelineHandoff.stderr,
    },
    timelineHandoffManifest: {
      status: timelineHandoffManifest.status,
      stderr: timelineHandoffManifest.stderr,
    },
  };
}

async function runTextCutExportProvenance() {
  await writeJson(path.join(workspace, "analysis", "transcripts", "talking-head.json"), {
    fps: 30,
    backendId: "local-agent-first-asr",
    modelId: "local-agent-first-model",
    language: "zh-CN",
    averageConfidence: 0.94,
    words: [
      { id: "w1", text: "大家", startFrame: 0, endFrame: 12 },
      { id: "w2", text: "嗯", startFrame: 12, endFrame: 18 },
      { id: "w3", text: "今天", startFrame: 30, endFrame: 42 },
      { id: "w4", text: "开始", startFrame: 42, endFrame: 72 },
    ],
  });
  await writeJson(path.join(workspace, "assets", "manifest.json"), {
    assets: [{ id: "asset-talk", type: "video", path: "assets/source/talk.mp4", metadata: {} }],
  });

  const plan = runProduction([
    "plan-text-cut",
    "--transcript",
    "analysis/transcripts/talking-head.json",
    "--target-asset",
    "asset-talk",
    "--out",
    "actions/talking-head-text-cut.json",
    "--min-silence-frames",
    "10",
    "--json",
  ]);
  recordCheck(
    "text-cut action planning produced local action",
    plan.status === 0 && parseStdoutJson(plan).actionPath.endsWith(path.join("actions", "talking-head-text-cut.json")),
    plan.stderr || plan.stdout,
    { command: plan.command },
  );

  const exported = runProduction([
    "export-text-cut-media",
    "--action",
    "actions/talking-head-text-cut.json",
    "--source-asset",
    "asset-talk",
    "--output-asset",
    "asset-talk-clean",
    "--assets",
    "assets/manifest.json",
    "--json",
  ]);
  const exportedPayload = exported.status === 0 ? parseStdoutJson(exported) : null;
  const cutPackage = exportedPayload ? JSON.parse(readFileSync(exportedPayload.packagePath, "utf8")) : null;
  const ffmpegPlan = exportedPayload ? JSON.parse(readFileSync(exportedPayload.ffmpegPlanPath, "utf8")) : null;
  const assets = JSON.parse(readFileSync(path.join(workspace, "assets", "manifest.json"), "utf8"));
  const outputAsset = assets.assets.find((asset) => asset.id === "asset-talk-clean");
  const outputMetadata = outputAsset?.metadata?.["talking-head.media-cut-export"];
  recordCheck(
    "text-cut export records source action provenance",
    exported.status === 0 &&
      exportedPayload?.sourceActionPath === "actions/talking-head-text-cut.json" &&
      /^[a-f0-9]{16}$/.test(exportedPayload?.sourceActionHash ?? "") &&
      cutPackage?.sourceActionPath === exportedPayload.sourceActionPath &&
      cutPackage?.sourceActionHash === exportedPayload.sourceActionHash &&
      ffmpegPlan?.sourceActionPath === exportedPayload.sourceActionPath &&
      ffmpegPlan?.sourceActionHash === exportedPayload.sourceActionHash &&
      outputMetadata?.sourceActionPath === exportedPayload.sourceActionPath &&
      outputMetadata?.sourceActionHash === exportedPayload.sourceActionHash,
    exported.stderr || exported.stdout,
    {
      command: exported.command,
      packagePath: exportedPayload?.packagePath,
      ffmpegPlanPath: exportedPayload?.ffmpegPlanPath,
      sourceActionHash: exportedPayload?.sourceActionHash,
    },
  );

  const outsideActionDir = path.join(artifactRoot, "outside-text-cut-action");
  mkdirSync(outsideActionDir, { recursive: true });
  const outsideActionPath = path.join(outsideActionDir, "talking-head-text-cut.json");
  writeFileSync(outsideActionPath, readFileSync(path.join(workspace, "actions", "talking-head-text-cut.json")));
  symlinkSync(outsideActionPath, path.join(workspace, "actions", "linked-talking-head-text-cut.json"));
  const symlinkedActionExport = runProduction([
    "export-text-cut-media",
    "--action",
    "actions/linked-talking-head-text-cut.json",
    "--source-asset",
    "asset-talk",
    "--output-asset",
    "asset-talk-linked",
    "--assets",
    "assets/manifest.json",
    "--json",
  ]);
  recordCheck(
    "text-cut export rejects symlinked source action outside cwd",
    symlinkedActionExport.status === 1 &&
      /action path must stay inside the project/i.test(symlinkedActionExport.stderr),
    symlinkedActionExport.stderr || symlinkedActionExport.stdout,
    { command: symlinkedActionExport.command },
  );

  return {
    export: {
      outputAssetId: exportedPayload?.outputAssetId,
      packagePath: exportedPayload?.packagePath,
      ffmpegPlanPath: exportedPayload?.ffmpegPlanPath,
      sourceActionPath: exportedPayload?.sourceActionPath,
      sourceActionHash: exportedPayload?.sourceActionHash,
    },
    symlinkedActionExport: {
      status: symlinkedActionExport.status,
      stderr: symlinkedActionExport.stderr,
    },
  };
}

async function runDirectCanvasCliReadTokenCas() {
  const publicCliCanvasUpdateCommand = "clash canvas update";
  const projectId = "project-agent-first-cas-cli";
  const clashHome = path.join(tmpdir(), `clash-agent-first-cas-${process.pid}-${Date.now()}`);
  const env = {
    CLASH_HOME: clashHome,
    CLASH_AGENT_MEMBER_ID: "agent-first-cas-smoke",
    CLASH_AGENT_NAME: "Agent First CAS Smoke",
  };
  const daemon = await startCliDaemonSocket({ projectId, clashHome });
  try {
    const firstRead = runCanvas([
      "get",
      "--project",
      projectId,
      "--node",
      "text-cli",
      "--json",
    ], env);
    recordCheck(
      "direct canvas CLI get produced read token",
      firstRead.status === 0 && typeof parseStdoutJson(firstRead).readToken === "string",
      firstRead.stderr || firstRead.stdout,
      { command: firstRead.command, daemon: daemon.ready },
    );
    const firstReadPayload = parseStdoutJson(firstRead);
    const firstReadToken = firstReadPayload.readToken;

    const missingUpdate = runCanvas([
      "update",
      "--project",
      projectId,
      "--node",
      "text-cli",
      "--label",
      "missing cli token",
      "--json",
    ], env);
    recordCheck(
      "direct canvas CLI missing read token rejected",
      missingUpdate.status === 1 && /read proof|--if-match/i.test(missingUpdate.stderr),
      missingUpdate.stderr || missingUpdate.stdout,
      { command: publicCliCanvasUpdateCommand, actualCommand: missingUpdate.command },
    );

    const concurrent = runCanvas([
      "update",
      "--project",
      projectId,
      "--node",
      "text-cli",
      "--label",
      "concurrent cli edit",
      "--force",
      "--json",
    ], env);
    recordCheck(
      "direct canvas CLI force concurrent edit succeeded",
      concurrent.status === 0 && parseStdoutJson(concurrent).updated === true,
      concurrent.stderr || concurrent.stdout,
      { command: concurrent.command },
    );

    const staleUpdate = runCanvas([
      "update",
      "--project",
      projectId,
      "--node",
      "text-cli",
      "--label",
      "stale cli token",
      "--if-match",
      firstReadToken,
      "--json",
    ], env);
    recordCheck(
      "direct canvas CLI stale read token rejected",
      staleUpdate.status === 1 && /Stale canvas update rejected/i.test(staleUpdate.stderr),
      staleUpdate.stderr || staleUpdate.stdout,
      { command: staleUpdate.command },
    );

    const freshRead = runCanvas([
      "get",
      "--project",
      projectId,
      "--node",
      "text-cli",
      "--json",
    ], env);
    const freshReadPayload = parseStdoutJson(freshRead);
    const freshUpdate = runCanvas([
      "update",
      "--project",
      projectId,
      "--node",
      "text-cli",
      "--label",
      "fresh cli token",
      "--if-match",
      freshReadPayload.readToken,
      "--json",
    ], env);
    const freshUpdatePayload = freshUpdate.status === 0 ? parseStdoutJson(freshUpdate) : null;
    const finalRead = runCanvas([
      "get",
      "--project",
      projectId,
      "--node",
      "text-cli",
      "--json",
    ], env);
    const finalReadPayload = finalRead.status === 0 ? parseStdoutJson(finalRead) : null;
    recordCheck(
      "direct canvas CLI fresh read token accepted",
      freshUpdate.status === 0 &&
        freshUpdatePayload?.updated === true &&
        finalReadPayload?.data?.label === "fresh cli token",
      freshUpdate.stderr || freshUpdate.stdout || finalRead.stderr || finalRead.stdout,
      { command: freshUpdate.command },
    );
    recordCheck(
      "direct canvas CLI mutation envelope recorded",
      freshUpdatePayload?.mutation?.operation === "canvas_update" &&
        freshUpdatePayload?.mutation?.entity?.kind === "canvas-node" &&
        freshUpdatePayload?.mutation?.entity?.id === "text-cli" &&
        freshUpdatePayload?.mutation?.expectedReadToken === freshReadPayload.readToken &&
        freshUpdatePayload?.mutation?.beforeReadToken === baseReadToken(freshReadPayload.readToken) &&
        freshUpdatePayload?.mutation?.afterReadToken === freshUpdatePayload.readToken &&
        freshUpdatePayload?.mutation?.resultEntityId === "text-cli" &&
        freshUpdatePayload?.mutation?.accepted === true &&
        freshUpdatePayload?.mutation?.forced === false,
      JSON.stringify(freshUpdatePayload?.mutation),
      { command: freshUpdate.command },
    );

    const missingDelete = runCanvas([
      "delete",
      "--project",
      projectId,
      "--node",
      "delete-cli",
      "--yes",
      "--json",
    ], env);
    const deleteRead = runCanvas([
      "get",
      "--project",
      projectId,
      "--node",
      "delete-cli",
      "--json",
    ], env);
    recordCheck(
      "direct canvas CLI delete read token required",
      missingDelete.status === 1 &&
        /read proof|--if-match/i.test(missingDelete.stderr) &&
        deleteRead.status === 0,
      missingDelete.stderr || missingDelete.stdout,
      { command: missingDelete.command },
    );

    const revisionHost = await startRevisionIndexHost();
    let textPullPayload = null;
    let textApplyPayload = null;
    let textHistoryPayload = null;
    let textContentPayload = null;
    let timelinePullPayload = null;
    let timelineApplyPayload = null;
    let timelineHistoryPayload = null;
    let timelineContentPayload = null;
    try {
      const revisionEnv = {
        ...env,
        CLASH_API_URL: revisionHost.url,
        CLASH_API_KEY: "agent-first-cas-key",
      };
      const textPull = runText([
        "pull",
        "--project",
        projectId,
        "--node",
        "text-cli",
        "--json",
      ], revisionEnv);
      textPullPayload = textPull.status === 0 ? parseStdoutJson(textPull) : null;
      recordCheck(
        "text history read step produced lock",
        textPull.status === 0 &&
          typeof textPullPayload?.readToken === "string" &&
          typeof textPullPayload?.filePath === "string" &&
          typeof textPullPayload?.lockPath === "string",
        textPull.stderr || textPull.stdout,
        { command: textPull.command },
      );
      await writeFile(textPullPayload.filePath, "history-indexed copy\n", "utf8");
      const textApply = runText([
        "apply",
        "--project",
        projectId,
        "--node",
        "text-cli",
        "--json",
      ], revisionEnv);
      textApplyPayload = textApply.status === 0 ? parseStdoutJson(textApply) : null;
      recordCheck(
        "text apply registered host text revision index",
        textApply.status === 0 &&
          textApplyPayload?.textRevisionIndex?.indexed === true &&
          typeof textApplyPayload?.textRevision?.revisionId === "string" &&
          revisionHost.revisions.some((revision) => revision.revisionId === textApplyPayload.textRevision.revisionId),
        textApply.stderr || textApply.stdout || textApply.error,
        {
          command: textApply.command,
          revisionHostUrl: revisionHost.url,
          revisionHostRequests: revisionHost.requests,
          daemonCommandLog: readOptionalText(daemon.ready.commandLogPath),
        },
      );
      const textHistory = runText([
        "history",
        "--project",
        projectId,
        "--node",
        "text-cli",
        "--limit",
        "1",
        "--json",
      ], revisionEnv);
      textHistoryPayload = textHistory.status === 0 ? parseStdoutJson(textHistory) : null;
      recordCheck(
        "text history reads host revision index",
        textHistory.status === 0 &&
          textHistoryPayload?.projectId === projectId &&
          textHistoryPayload?.nodeId === "text-cli" &&
          textHistoryPayload?.revisions?.[0]?.revisionId === textApplyPayload.textRevision.revisionId &&
          textHistoryPayload?.revisions?.[0]?.sourceFileHash === textApplyPayload.textRevision.sourceFileHash &&
          revisionHost.requests.some((request) =>
            request.method === "POST" && request.path === "/api/v1/text-revisions"
          ) &&
          revisionHost.requests.some((request) =>
            request.method === "GET" &&
            request.path === `/api/v1/projects/${projectId}/text-revisions` &&
            request.search.includes("nodeId=text-cli")
          ),
        textHistory.stderr || textHistory.stdout,
        { command: textHistory.command, revisionHostRequests: revisionHost.requests },
      );
      const textContent = runText([
        "content",
        "--project",
        projectId,
        "--revision",
        textApplyPayload.textRevision.revisionId,
        "--out",
        "revisions/text-cli.recovered.md",
        "--json",
      ], revisionEnv);
      textContentPayload = textContent.status === 0 ? parseStdoutJson(textContent) : null;
      recordCheck(
        "text content restores host revision body",
        textContent.status === 0 &&
          textContentPayload?.projectId === projectId &&
          textContentPayload?.revisionId === textApplyPayload.textRevision.revisionId &&
          readOptionalText(textContentPayload?.filePath) === "history-indexed copy\n" &&
          revisionHost.requests.some((request) =>
            request.method === "GET" &&
            request.path === `/api/v1/projects/${projectId}/text-revisions/${textApplyPayload.textRevision.revisionId}/content`
          ),
        textContent.stderr || textContent.stdout,
        { command: textContent.command, textContentPayload, revisionHostRequests: revisionHost.requests },
      );

      const timelinePull = runTimeline([
        "pull",
        "--project",
        projectId,
        "--node",
        "timeline-cli",
        "--timeline",
        "history-indexed",
        "--json",
      ], revisionEnv);
      timelinePullPayload = timelinePull.status === 0 ? parseStdoutJson(timelinePull) : null;
      recordCheck(
        "timeline history read step produced lock",
        timelinePull.status === 0 &&
          typeof timelinePullPayload?.readToken === "string" &&
          typeof timelinePullPayload?.filePath === "string" &&
          typeof timelinePullPayload?.lockPath === "string",
        timelinePull.stderr || timelinePull.stdout,
        { command: timelinePull.command },
      );
      await writeFile(timelinePullPayload.filePath, [
        "compositionWidth: 1080",
        "compositionHeight: 1920",
        "fps: 30",
        "durationInFrames: 60",
        "tracks:",
        "  - id: main",
        "    items:",
        "      - id: cli-shot",
        "        type: video",
        "        from: start",
        "        durationInFrames: 60",
        "        sourceNodeId: text-cli",
        "",
      ].join("\n"), "utf8");
      const timelineApply = runTimeline([
        "apply",
        "--project",
        projectId,
        "--node",
        "timeline-cli",
        "--timeline",
        "history-indexed",
        "--json",
      ], revisionEnv);
      timelineApplyPayload = timelineApply.status === 0 ? parseStdoutJson(timelineApply) : null;
      recordCheck(
        "timeline apply registered host timeline revision index",
        timelineApply.status === 0 &&
          timelineApplyPayload?.timelineRevisionIndex?.indexed === true &&
          typeof timelineApplyPayload?.timelineRevision?.revisionId === "string" &&
          revisionHost.revisions.some((revision) => revision.revisionId === timelineApplyPayload.timelineRevision.revisionId),
        timelineApply.stderr || timelineApply.stdout || timelineApply.error,
        {
          command: timelineApply.command,
          revisionHostUrl: revisionHost.url,
          revisionHostRequests: revisionHost.requests,
          daemonCommandLog: readOptionalText(daemon.ready.commandLogPath),
        },
      );
      const timelineHistory = runTimeline([
        "history",
        "--project",
        projectId,
        "--node",
        "timeline-cli",
        "--limit",
        "1",
        "--json",
      ], revisionEnv);
      timelineHistoryPayload = timelineHistory.status === 0 ? parseStdoutJson(timelineHistory) : null;
      recordCheck(
        "timeline history reads host revision index",
        timelineHistory.status === 0 &&
          timelineHistoryPayload?.projectId === projectId &&
          timelineHistoryPayload?.nodeId === "timeline-cli" &&
          timelineHistoryPayload?.revisions?.[0]?.revisionId === timelineApplyPayload.timelineRevision.revisionId &&
          timelineHistoryPayload?.revisions?.[0]?.sourceFileHash === timelineApplyPayload.timelineRevision.sourceFileHash &&
          revisionHost.requests.some((request) =>
            request.method === "POST" && request.path === "/api/v1/timeline-revisions"
          ) &&
          revisionHost.requests.some((request) =>
            request.method === "GET" &&
            request.path === `/api/v1/projects/${projectId}/timeline-revisions` &&
            request.search.includes("nodeId=timeline-cli")
          ),
        timelineHistory.stderr || timelineHistory.stdout,
        { command: timelineHistory.command, revisionHostRequests: revisionHost.requests },
      );
      const timelineContent = runTimeline([
        "content",
        "--project",
        projectId,
        "--revision",
        timelineApplyPayload.timelineRevision.revisionId,
        "--out",
        "revisions/timeline-cli.recovered.timeline.yaml",
        "--json",
      ], revisionEnv);
      timelineContentPayload = timelineContent.status === 0 ? parseStdoutJson(timelineContent) : null;
      recordCheck(
        "timeline content restores host revision body",
        timelineContent.status === 0 &&
          timelineContentPayload?.projectId === projectId &&
          timelineContentPayload?.revisionId === timelineApplyPayload.timelineRevision.revisionId &&
          readOptionalText(timelineContentPayload?.filePath)?.includes("sourceNodeId: text-cli") === true &&
          revisionHost.requests.some((request) =>
            request.method === "GET" &&
            request.path === `/api/v1/projects/${projectId}/timeline-revisions/${timelineApplyPayload.timelineRevision.revisionId}/content`
          ),
        timelineContent.stderr || timelineContent.stdout,
        { command: timelineContent.command, timelineContentPayload, revisionHostRequests: revisionHost.requests },
      );
    } finally {
      await revisionHost.close();
    }

    return {
      projectId,
      clashHome,
      daemon: daemon.ready,
      firstRead: firstReadPayload,
      missingUpdate: { status: missingUpdate.status, stderr: missingUpdate.stderr },
      concurrent: parseStdoutJson(concurrent),
      staleUpdate: { status: staleUpdate.status, stderr: staleUpdate.stderr },
      freshRead: freshReadPayload,
      freshUpdate: freshUpdatePayload,
      finalRead: finalReadPayload,
      missingDelete: { status: missingDelete.status, stderr: missingDelete.stderr },
      deleteStillExists: deleteRead.status === 0,
      textRevisionHistory: {
        pull: textPullPayload,
        apply: textApplyPayload,
        history: textHistoryPayload,
        content: textContentPayload,
      },
      timelineRevisionHistory: {
        pull: timelinePullPayload,
        apply: timelineApplyPayload,
        history: timelineHistoryPayload,
        content: timelineContentPayload,
      },
    };
  } finally {
    await daemon.stop();
  }
}

async function main() {
  await mkdir(artifactRoot, { recursive: true });
  const startedAt = now();
  let status = "pass";
  let summary = "Agent-first CAS smoke passed";
  let promptPack = null;
  let reviewGate = null;
  let projectionPathGuards = null;
  let textCutExport = null;
  let directCanvas = null;
  let directCanvasCli = null;
  try {
    await seedWorkspace();
    promptPack = await runStoryboardPromptPackCas();
    reviewGate = await runReviewGateCas();
    projectionPathGuards = runProjectionPathGuards();
    textCutExport = await runTextCutExportProvenance();
    directCanvas = runDirectCanvasReadTokenCas();
    directCanvasCli = await runDirectCanvasCliReadTokenCas();
    requireCheckPassed("text history reads host revision index");
    requireCheckPassed("text content restores host revision body");
    requireCheckPassed("timeline history reads host revision index");
    requireCheckPassed("timeline content restores host revision body");
  } catch (error) {
    status = "fail";
    summary = error instanceof Error ? error.message : String(error);
  }

  const report = {
    schemaVersion: 1,
    status,
    summary,
    run: {
      artifactRoot,
      workspace,
      startedAt,
      finishedAt: now(),
    },
    checks,
    booleans: {
      missingReadProofRejected: checks.some((check) => check.name === "missing read proof rejected" && check.status === "pass"),
      staleReadProofRejected: checks.some((check) => check.name === "stale read proof rejected" && check.status === "pass"),
      sourceActionStaleReadProofRejected: checks.some(
        (check) => check.name === "source action stale read proof rejected" && check.status === "pass",
      ),
      wrongFileLockRejected: checks.some((check) => check.name === "wrong file lock rejected" && check.status === "pass"),
      copyOnWritePreservedSource: checks.some((check) => check.name === "copy-on-write preserved source projection" && check.status === "pass"),
      directCanvasMissingReadTokenRejected: checks.some((check) => check.name === "direct canvas missing read token rejected" && check.status === "pass"),
      directCanvasStaleReadTokenRejected: checks.some((check) => check.name === "direct canvas stale read token rejected" && check.status === "pass"),
      directCanvasFreshReadTokenAccepted: checks.some((check) => check.name === "direct canvas fresh read token accepted" && check.status === "pass"),
      directCanvasMutationEnvelopeRecorded: checks.some((check) => check.name === "direct canvas mutation envelope recorded" && check.status === "pass"),
      directCanvasDeleteReadTokenRequired: checks.some((check) => check.name === "direct canvas delete read token required" && check.status === "pass"),
      directCanvasCliMissingReadTokenRejected: checks.some((check) => check.name === "direct canvas CLI missing read token rejected" && check.status === "pass"),
      directCanvasCliStaleReadTokenRejected: checks.some((check) => check.name === "direct canvas CLI stale read token rejected" && check.status === "pass"),
      directCanvasCliFreshReadTokenAccepted: checks.some((check) => check.name === "direct canvas CLI fresh read token accepted" && check.status === "pass"),
      directCanvasCliMutationEnvelopeRecorded: checks.some((check) => check.name === "direct canvas CLI mutation envelope recorded" && check.status === "pass"),
      directCanvasCliDeleteReadTokenRequired: checks.some((check) => check.name === "direct canvas CLI delete read token required" && check.status === "pass"),
      textHistoryReadsHostRevisionIndex: checks.some((check) => check.name === "text history reads host revision index" && check.status === "pass"),
      textContentRestoresHostRevisionBody: checks.some((check) => check.name === "text content restores host revision body" && check.status === "pass"),
      timelineHistoryReadsHostRevisionIndex: checks.some((check) => check.name === "timeline history reads host revision index" && check.status === "pass"),
      timelineContentRestoresHostRevisionBody: checks.some((check) => check.name === "timeline content restores host revision body" && check.status === "pass"),
      textCutExportSourceProvenanceRecorded: checks.some((check) => check.name === "text-cut export records source action provenance" && check.status === "pass"),
      textCutExportSymlinkActionRejected: checks.some((check) => check.name === "text-cut export rejects symlinked source action outside cwd" && check.status === "pass"),
      projectionPathOutsideCwdRejected: [
          "text pull rejects projection path outside cwd",
          "text forced apply rejects projection path outside cwd",
          "text pull rejects symlinked projection path outside cwd",
          "text pull rejects symlinked lock sidecar outside cwd",
          "timeline pull rejects projection path outside cwd",
          "timeline forced apply rejects projection path outside cwd",
          "timeline forced apply rejects symlinked projection path outside cwd",
          "timeline pull rejects symlinked lock sidecar outside cwd",
          "storyboard prompt-pack project rejects symlinked lock sidecar outside cwd",
          "review gate plan rejects symlinked lock sidecar outside cwd",
          "pipeline validation rejects symlinked report path outside cwd",
          "reference roles plan rejects symlinked action path outside cwd",
          "caption export rejects symlinked output path outside cwd",
          "timeline handoff export rejects symlinked output path outside cwd",
          "timeline handoff export rejects symlinked manifest path outside cwd",
        ].every((name) =>
          checks.some((check) => check.name === name && check.status === "pass"),
      ),
    },
    artifacts: {
      promptPack,
      reviewGate,
      projectionPathGuards,
      textCutExport,
      directCanvas,
      directCanvasCli,
    },
  };
  await writeJson(reportPath, report);
  console.log("[agent-first-cas] report", reportPath);
  console.log(JSON.stringify({
    status,
    reportPath,
    workspace,
    checks: checks.length,
  }));
  if (status !== "pass") process.exit(1);
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  await mkdir(artifactRoot, { recursive: true });
  await writeJson(reportPath, {
    schemaVersion: 1,
    status: "fail",
    summary: message,
    checks,
  });
  console.error(message);
  process.exit(1);
});
