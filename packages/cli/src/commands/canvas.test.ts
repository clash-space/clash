import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveAssetDownloadUrl, resolveCanvasPresenceOptions, resolveCanvasProjectId } from "./canvas";
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

test("canvas connect passes presence options into the daemon", () => {
  const source = readFileSync(new URL("./canvas.ts", import.meta.url), "utf8");

  assert.match(source, /startDaemon\(projectId, serverUrl, apiKey, resolveCanvasPresenceOptions\(\)\)/);
});

test("canvas direct writes expose read-token CAS options for agents", () => {
  const source = readFileSync(new URL("./canvas.ts", import.meta.url), "utf8");

  assert.match(source, /canvasNodeReadToken\(node\)/);
  assert.match(source, /readToken/);
  assert.match(source, /\.option\("--if-match <readToken>"/);
  assert.match(source, /actorClientType: resolveCanvasPresenceOptions\(\)\.clientType/);
  assert.match(source, /validateCanvasReadProof\(\{/);
  assert.match(source, /assertAgentHostWritePath/);
});

test("canvas exposes edge read tokens for agent edge CAS", () => {
  const source = readFileSync(new URL("./canvas.ts", import.meta.url), "utf8");

  assert.match(source, /\.command\("edges"\)/);
  assert.match(source, /canvasEdgeReadToken\(edge\)/);
  assert.match(source, /canvasEdgesReadToken\(baseEdges\)/);
  assert.match(source, /readToken/);
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
  assert.match(source, /--if-match <readToken>/);
  assert.match(source, /copy-on-write media node/);
  assert.match(daemonSource, /case "asset_cow_replace"/);
  assert.match(mediaReplacementSource, /copyOnWriteKind: "media-asset-replacement"/);
});

test("canvas add fallback checks createNode errors before wiring reference edges", () => {
  const source = readFileSync(new URL("./canvas.ts", import.meta.url), "utf8");

  assert.match(
    source,
    /const result = client\.createNode\(nodeId, options\.type, data, null, options\.parent \?\? null\);[\s\S]*if \(result\.error\) \{ console\.error\(`Error: \$\{result\.error\}`\); process\.exit\(1\); \}[\s\S]*const existing = client\.canvas\.listEdges\(\);/,
  );
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
