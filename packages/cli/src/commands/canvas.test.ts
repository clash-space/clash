import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveAssetDownloadUrl,
  resolveCanvasActor,
  resolveCanvasPresenceOptions,
  resolveCanvasProjectId,
  resolveInstalledPluginAction,
} from "./canvas";
import { initProject } from "./projects";

test("marks spawned agent canvas sync as agent presence", () => {
  assert.deepEqual(resolveCanvasPresenceOptions({
    CLASH_AGENT_MEMBER_ID: "local-master-clash",
  }), {
    clientType: "agent",
    agentName: "local-master-clash",
  });
});

test("keeps human CLI canvas sync as cli presence", () => {
  assert.deepEqual(resolveCanvasPresenceOptions({}), {
    clientType: "cli",
  });
});

test("uses runtime-injected actor identity without a network lookup", async () => {
  await assert.doesNotReject(async () => {
    assert.deepEqual(await resolveCanvasActor({
      CLASH_USER_ID: "local-user",
      CLASH_AGENT_MEMBER_ID: "local-agent",
    }), {
      actorType: "agent",
      actorUserId: "local-user",
      actorAgentId: "local-agent",
    });
  });
});

test("canvas custom actions resolve executable plugin bindings from the active profile host", async () => {
  const action = await resolveInstalledPluginAction({
    actionId: "codex-imagegen",
    serverUrl: "http://127.0.0.1:49321",
    apiKey: "local-token",
    request: async () => new Response(JSON.stringify({
      actions: [{
        id: "codex-imagegen",
        outputType: "image",
        pluginBinding: {
          pluginId: "clash-codex-imagegen",
          version: "0.1.0",
          exportId: "generate-image",
          schemaHash: `sha256:${"a".repeat(64)}`,
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  assert.deepEqual(action?.pluginBinding, {
    pluginId: "clash-codex-imagegen",
    version: "0.1.0",
    exportId: "generate-image",
    schemaHash: `sha256:${"a".repeat(64)}`,
  });
  const source = readFileSync(new URL("./canvas.ts", import.meta.url), "utf8");
  assert.match(source, /getMap\("customActions"\)\.set\(action\.id, action\.definition\)/);
  assert.match(source, /await registerInstalledPluginAction\(projectId, installedPluginAction\)/);
});

test("canvas connect passes presence options into the daemon", () => {
  const source = readFileSync(new URL("./canvas.ts", import.meta.url), "utf8");

  assert.match(source, /startDaemon\(projectId, serverUrl, apiKey, resolveCanvasPresenceOptions\(\)\)/);
});

test("canvas direct writes use implicit cwd observations for agents", () => {
  const source = readFileSync(new URL("./canvas.ts", import.meta.url), "utf8");

  assert.match(source, /canvasNodeReadToken\(node\)/);
  assert.match(source, /recordWorktreeObservation/);
  assert.match(source, /requireWorktreeObservation/);
  assert.match(source, /observedVersion/);
  assert.doesNotMatch(source, /\.option\("--if-match <readToken>"/);
  assert.match(source, /actorClientType: resolveCanvasPresenceOptions\(\)\.clientType/);
  assert.match(source, /assertAgentHostWritePath/);
});

test("canvas records edge graph observations without exposing tokens", () => {
  const source = readFileSync(new URL("./canvas.ts", import.meta.url), "utf8");

  assert.match(source, /\.command\("edges"\)/);
  assert.match(source, /canvasEdgesReadToken\(baseEdges\)/);
  assert.match(source, /entityKind: "canvas-edges"/);
  assert.match(source, /printJson\(edges\)/);
  assert.doesNotMatch(source, /Graph read token/);
});

test("canvas node commands accept and propagate a concrete Canvas scope", () => {
  const source = readFileSync(new URL("./canvas.ts", import.meta.url), "utf8");

  assert.match(source, /--canvas <id>/);
  assert.match(source, /canvasId: activeCanvasId/);
  assert.match(source, /canvasId: activeCanvasId,/);
  assert.match(source, /client\.selectCanvas\(activeCanvasId\)/);
});

test("CLI exposes Project Canvas registry management with implicit observations", () => {
  const commandUrl = new URL("./canvases.ts", import.meta.url);
  assert.equal(existsSync(commandUrl), true);
  const source = readFileSync(commandUrl, "utf8");
  const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

  assert.match(indexSource, /canvasesCommand/);
  assert.match(source, /new Command\("canvases"\)/);
  assert.match(source, /\.command\("list"\)/);
  assert.match(source, /\.command\("create"\)/);
  assert.match(source, /\.command\("rename"\)/);
  assert.match(source, /\.command\("delete"\)/);
  assert.match(source, /recordWorktreeObservation/);
  assert.match(source, /requireWorktreeObservation/);
  assert.doesNotMatch(source, /--if-match/);
  assert.doesNotMatch(source, /--force/);
});

test("canvas get exposes whole-node immutability", () => {
  const source = readFileSync(new URL("./canvas.ts", import.meta.url), "utf8");
  const daemonSource = readFileSync(new URL("../lib/daemon.ts", import.meta.url), "utf8");

  assert.match(source, /immutable: immutable === true/);
  assert.match(source, /Immutable:/);
  assert.match(daemonSource, /immutable: isCanvasNodeImmutable/);
});

test("canvas exposes graph-aware batch delete read and apply commands", () => {
  const source = readFileSync(new URL("./canvas.ts", import.meta.url), "utf8");
  const daemonSource = readFileSync(new URL("../lib/daemon.ts", import.meta.url), "utf8");

  assert.match(source, /\.command\("delete-plan"\)/);
  assert.match(source, /\.command\("delete-batch"\)/);
  assert.match(source, /canvasBatchDeleteReadToken\(\{/);
  assert.match(source, /action: "batch_delete_plan"/);
  assert.match(source, /action: "delete_batch"/);
  assert.match(daemonSource, /case "batch_delete_plan"/);
  assert.match(daemonSource, /case "delete_batch"/);
});

test("canvas exposes explicit media asset copy-on-write replacement", () => {
  const source = readFileSync(new URL("./canvas.ts", import.meta.url), "utf8");
  const daemonSource = readFileSync(new URL("../lib/daemon.ts", import.meta.url), "utf8");
  const mediaReplacementSource = readFileSync(new URL("../../../shared-types/src/media-asset-replacement.ts", import.meta.url), "utf8");

  assert.match(source, /\.command\("replace-asset"\)/);
  assert.match(source, /action: "asset_cow_replace"/);
  assert.doesNotMatch(source, /--if-match <readToken>/);
  assert.match(source, /observedVersion/);
  assert.match(source, /copy-on-write media node/);
  assert.match(daemonSource, /case "asset_cow_replace"/);
  assert.match(mediaReplacementSource, /copyOnWriteKind: "media-asset-replacement"/);
});

test("canvas exposes one generic copy command for immutable nodes", () => {
  const source = readFileSync(new URL("./canvas.ts", import.meta.url), "utf8");
  const daemonSource = readFileSync(new URL("../lib/daemon.ts", import.meta.url), "utf8");

  assert.match(source, /\.command\("copy"\)/);
  assert.match(source, /action: "copy_node"/);
  assert.match(source, /requireCanvasObservation/);
  assert.match(daemonSource, /case "copy_node"/);
});

test("canvas exposes the same persisted spatial move used by MCP Canvas App", () => {
  const source = readFileSync(new URL("./canvas.ts", import.meta.url), "utf8");
  const daemonSource = readFileSync(new URL("../lib/daemon.ts", import.meta.url), "utf8");

  assert.match(source, /\.command\("move"\)/);
  assert.match(source, /\.requiredOption\("--x <number>"/);
  assert.match(source, /\.requiredOption\("--y <number>"/);
  assert.match(source, /action: "move"/);
  assert.match(daemonSource, /case "move"/);
  assert.match(daemonSource, /client\.canvas\.moveNode/);
});

test("canvas add fallback checks createNode errors before wiring reference edges", () => {
  const source = readFileSync(new URL("./canvas.ts", import.meta.url), "utf8");

  assert.match(
    source,
    /const result = client\.createNode\(nodeId, persistedNodeType, data, null, options\.parent \?\? null\);[\s\S]*if \(result\.error\) \{ console\.error\(`Error: \$\{result\.error\}`\); process\.exit\(1\); \}[\s\S]*const existing = client\.canvas\.listEdges\(\);/,
  );
});

test("canvas add exposes the distinct Remotion component node type", () => {
  const source = readFileSync(new URL("./canvas.ts", import.meta.url), "utf8");

  assert.match(source, /remotion-component/);
  assert.match(source, /Node type:.*remotion/);
  assert.match(source, /Body content.*Remotion TSX/);
});

test("asset downloader accepts absolute and relative signed URLs", () => {
  assert.equal(
    resolveAssetDownloadUrl("https://assets.example.com/file.png", "http://localhost:8788"),
    "https://assets.example.com/file.png",
  );
  assert.equal(
    resolveAssetDownloadUrl("/assets/projects/p1/file.png", "http://localhost:8788/"),
    "http://localhost:8788/assets/projects/p1/file.png",
  );
});

test("asset downloader marks cached files read-only", () => {
  const source = readFileSync(new URL("./canvas.ts", import.meta.url), "utf8");

  assert.match(source, /writeFileSync\(filePath,[\s\S]*mode: 0o444/);
  assert.match(source, /chmodSync\(filePath, 0o444\)/);
  assert.match(source, /chmodSync\(cachedPath, 0o444\)/);
});

test("resolves canvas project from clash init marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "clash-canvas-project-"));
  const { projectId } = await initProject({ cwd: root, projectId: "proj_marker_canvas" });

  assert.equal(await resolveCanvasProjectId({ cwd: root, env: {} }), projectId);
});
