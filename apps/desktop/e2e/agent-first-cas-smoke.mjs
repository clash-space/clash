import { spawn, spawnSync } from "node:child_process";
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
const require = createRequire(import.meta.url);
const tsxLoader = require.resolve("tsx");

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
    { cwd: workspace, encoding: "utf8" },
  );
  return {
    command: `clash production ${args.join(" ")}`,
    status: result.status,
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
      env: { ...process.env, ...env },
    },
  );
  return {
    command: `clash canvas ${args.join(" ")}`,
    status: result.status,
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

function parseStdoutJson(result) {
  return JSON.parse(result.stdout);
}

function baseReadToken(readToken) {
  return typeof readToken === "string" ? readToken.split(":receipt:")[0] : readToken;
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
    import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
      process.stdout.write(JSON.stringify({ ready: true, projectId, sockPath }) + "\\n");
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
  let directCanvas = null;
  let directCanvasCli = null;
  try {
    await seedWorkspace();
    promptPack = await runStoryboardPromptPackCas();
    reviewGate = await runReviewGateCas();
    directCanvas = runDirectCanvasReadTokenCas();
    directCanvasCli = await runDirectCanvasCliReadTokenCas();
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
    },
    artifacts: {
      promptPack,
      reviewGate,
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
